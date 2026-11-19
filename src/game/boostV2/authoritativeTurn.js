// Boost 2.0 — authoritative turn service (spec §26–28; AUDIT §6.1).
//
// Online Boost 2.0 matches are run by the Cloudflare Worker, not by the
// players' devices. This module is the Worker's game logic, kept pure (no
// fetch, no Firebase, no timers) so it is unit-tested in Node and bundled
// into the Worker by wrangler — the app and the Worker cannot drift.
//
// Storage model (all writes are the Worker's; clients cannot write any of it):
//   boostV2Secret/{roomId}  — the authoritative match: full engine state
//                             (bag, both racks, the complete hidden queue)
//                             as a JSON string + version + recent request ids.
//                             No client may read it.
//   rooms/{roomId}          — the PUBLIC projection: board, scores, turn,
//                             public Boost view (active + next two), move
//                             history with breakdowns, bag/rack COUNTS only.
//   boostV2Racks/{roomId}/{slot} — each player's own rack, readable only by
//                             that player.
//
// A command runs the real engine (createEngine + dispatch) on the stored
// state. Identity comes from the verified Firebase token, never the payload:
// a client cannot act for the other player, claim a timeout early, forge
// tile values, choose the timeout reason or touch the queue.
//
// Idempotency: every request carries a reqId. An accepted request's result
// is remembered in the secret; a retry returns that result and changes
// nothing. `expectedVersion` rejects commands built on a stale view.

import { createEngine, createInitialState } from '../core/gameEngine.js';
import { serializeBoard, deserializeBoard } from '../online/schema.js';
import {
  initialTurnDeadlineMs, shouldUseSharedTurnTimer, turnLimitMsFromSettings, MISSED_TURNS_FORFEIT_THRESHOLD,
} from '../online/roomService.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { RULESET } from './rulesConfig.js';
import { publicView, normalizeBoostV2State } from './matchStateV2.js';
import { planForMove } from './engineV2.js';
import { winnerSlot } from '../core/turnManager.js';

export const SECRET_SCHEMA = 1;
export const TIMEOUT_GRACE_MS = 1000;   // matches timeoutWatchdog DEFAULT_WATCHDOG_GRACE_MS
const RECENT_LIMIT = 40;

// Client-facing command names. CLAIM_TIMEOUT is Worker-only: the opponent
// asks the server to end an expired turn (replaces the client watchdog write).
export const BOOST_CMD = Object.freeze({
  CONFIRM_MOVE: CMD.CONFIRM_MOVE,
  PASS_TURN: CMD.PASS_TURN,
  EXCHANGE_TILE: CMD.EXCHANGE_TILE,
  PLACE_OPENING_BOOST: CMD.PLACE_OPENING_BOOST,
  RESIGN_GAME: CMD.RESIGN_GAME,
  CLAIM_STALL_END: CMD.CLAIM_STALL_END,
  CLAIM_TIMEOUT: 'cmd/CLAIM_TIMEOUT',
});

// ── state (de)serialisation ────────────────────────────────────────────────
export function serializeState(state) {
  const { exchangeRng, rng, ...rest } = state;
  return JSON.stringify({ ...rest, board: serializeBoard(state.board), bonusBoard: {} });
}

export function deserializeState(json) {
  const raw = JSON.parse(json);
  return {
    ...raw,
    board: deserializeBoard(raw.board),
    bonusBoard: new Map(),
    boostV2: normalizeBoostV2State(raw.boostV2),
  };
}

// Random string from an RNG (server-side seed; never leaves the secret).
function randomId(rng, len = 24) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[Math.floor(rng() * abc.length)];
  return s;
}

function slotOf(players, uid) {
  if (players?.[0]?.uid === uid) return 0;
  if (players?.[1]?.uid === uid) return 1;
  return -1;
}

function nextDeadline(meta, state, now) {
  if (state.status !== 'playing') return 0;
  if (!shouldUseSharedTurnTimer(meta.mode, meta.settings)) return null;
  return now + turnLimitMsFromSettings(meta.settings);
}

// ── projections ─────────────────────────────────────────────────────────────
export function projectRoom(state, meta, now) {
  const v2 = state.boostV2;
  const finished = state.status !== 'playing';
  return JSON.parse(JSON.stringify({
    roomId: meta.roomId,
    mode: meta.mode,
    status: state.status,
    schemaVersion: 2,
    ruleset: RULESET.BOOST_V2,
    authority: 'worker',
    createdAt: meta.createdAt,
    updatedAt: now,
    players: meta.players,
    settings: meta.settings ?? {},
    version: meta.version,
    currentTurnSlot: state.currentTurnSlot,
    turnNumber: state.turnNumber,
    turnDeadlineMs: meta.turnDeadlineMs ?? null,
    missedTurns: meta.missedTurns,
    scores: state.scores,
    passCount: state.passCount,
    moveCount: state.moveCount ?? 0,
    firstMove: state.firstMove,
    board: serializeBoard(state.board),
    bagCount: state.bag.length,
    rackCounts: { 0: state.racks[0].length, 1: state.racks[1].length },
    moveHistory: state.moveHistory,
    lastMove: state.moveHistory.at(-1) ?? null,
    boostV2: { ...publicView(v2), rules: v2.rules },
    endgame: v2.endgame ?? null,
    winnerSlot: finished ? winnerSlot(state) : null,
    abandonedBy: state.abandonedBy ?? null,
    abandonReason: state.abandonReason ?? null,
    endReason: state.endReason ?? null,
  }));
}

export function projectRacks(state, version) {
  return { 0: { tiles: [...state.racks[0]], version }, 1: { tiles: [...state.racks[1]], version } };
}

function secretDoc({ meta, state, recent, now }) {
  return { schema: SECRET_SCHEMA, ...meta, updatedAt: now, stateJson: serializeState(state), recent };
}

function splitSecret(secret) {
  const { schema, stateJson, recent, updatedAt, ...meta } = secret;
  return { meta: { ...meta, missedTurns: { 0: Number(meta.missedTurns?.[0]) || 0, 1: Number(meta.missedTurns?.[1]) || 0 } }, state: deserializeState(stateJson), recent: recent ?? {} };
}

// ── create ─────────────────────────────────────────────────────────────────
/**
 * Build a new authoritative match. `rng` must be a server-side random source
 * (crypto) — it seeds the bag and shuffles the deck; nothing derived from it
 * is ever written anywhere a client can read.
 */
export function createMatch({ roomId, mode, players, settings = {}, startingSlot = 0, now, rng, leadInMs = 0 }) {
  if (!roomId || !players?.[0]?.uid || !players?.[1]?.uid) throw new Error('createMatch: roomId and two players are required');
  if (players[0].uid === players[1].uid) throw new Error('createMatch: players must differ');
  const state = createInitialState({
    mode, tileBagSeed: randomId(rng), players, startingSlot: startingSlot === 1 ? 1 : 0, settings,
    ruleset: RULESET.BOOST_V2, boostQueueRng: rng,
  });
  const meta = {
    roomId, mode, players, settings, createdAt: now, version: 1,
    turnDeadlineMs: initialTurnDeadlineMs(mode, settings, now, { leadInMs }) ?? null,
    missedTurns: { 0: 0, 1: 0 },
  };
  return {
    secret: secretDoc({ meta, state, recent: {}, now }),
    room: projectRoom(state, meta, now),
    racks: projectRacks(state, meta.version),
  };
}

// Only the fields each command may carry — anything else a client sends is dropped.
function cleanPayload(type, payload = {}, slot) {
  switch (type) {
    case CMD.CONFIRM_MOVE:
      return { placed: payload.placed, swappedTiles: payload.swappedTiles, boostPlacements: payload.boostPlacements };
    case CMD.EXCHANGE_TILE:       return { letters: payload.letters };
    case CMD.PLACE_OPENING_BOOST: return { r: payload.r, c: payload.c };
    case CMD.PASS_TURN:           return { reason: 'pass' };
    case CMD.RESIGN_GAME:         return { slot, reason: 'resign' };
    case CMD.CLAIM_STALL_END:     return { slot };
    default: return null;
  }
}

function runEngine(state, cmd, isWordValid, rng) {
  const events = [];
  state.exchangeRng = rng;
  const eng = createEngine({ state, bus: { emit: (type, payload) => events.push({ type, payload }) }, isWordValid });
  eng.dispatch(cmd);
  delete state.exchangeRng;
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  return { events, rejected: rejected ? rejected.payload : null };
}

function summarize(events) {
  const pick = (t) => events.find(e => e.type === t)?.payload ?? null;
  const move = pick(EV.MOVE_CONFIRMED);
  const done = pick(EV.GAME_COMPLETED);
  return JSON.parse(JSON.stringify({
    breakdown: move?.breakdown ?? null,
    boostPlacements: move?.boostPlacements ?? null,
    exchanged: pick(EV.TILES_EXCHANGED)?.count ?? null,
    boostPlaced: pick(EV.BOOST_PLACED)?.placement ?? null,
    gameCompleted: done ? { winnerSlot: done.winnerSlot, scores: done.scores, endgame: done.boostV2Endgame ?? null } : null,
  }));
}

function pruneRecent(recent) {
  const entries = Object.entries(recent).sort((a, b) => (b[1].ts ?? 0) - (a[1].ts ?? 0));
  return Object.fromEntries(entries.slice(0, RECENT_LIMIT));
}

/**
 * Apply one client command to a stored match.
 * @returns {{ ok: boolean, replay?: boolean, reason?: string, detail?: object,
 *             result?: object, version: number, secret?, room?, racks? }}
 *   `secret` / `room` / `racks` are present only when something must be written.
 */
export function applyCommand({ secret, uid, reqId, command, now, isWordValid, rng }) {
  const { meta, state, recent } = splitSecret(secret);
  if (recent[reqId]) return { ok: true, replay: true, result: recent[reqId].result, version: meta.version };
  const slot = slotOf(meta.players, uid);
  if (slot < 0) return { ok: false, reason: 'not-a-player', version: meta.version };
  if (command?.expectedVersion != null && Number(command.expectedVersion) !== meta.version) {
    return { ok: false, reason: 'stale-version', version: meta.version };
  }
  if (state.status !== 'playing') return { ok: false, reason: 'game-over', version: meta.version };
  const type = command?.type;

  let engineCmd;
  let missedTurns = { ...meta.missedTurns };
  if (type === BOOST_CMD.CLAIM_TIMEOUT) {
    const current = state.currentTurnSlot;
    if (slot === current) return { ok: false, reason: 'not-opponent', version: meta.version };
    const deadline = Number(meta.turnDeadlineMs) || 0;
    if (!deadline || now < deadline + TIMEOUT_GRACE_MS) return { ok: false, reason: 'turn-not-expired', version: meta.version };
    missedTurns[current] += 1;
    engineCmd = missedTurns[current] >= MISSED_TURNS_FORFEIT_THRESHOLD
      ? { type: CMD.RESIGN_GAME, payload: { slot: current, reason: 'missed-turns' } }
      : { type: CMD.PASS_TURN, payload: { reason: 'timeout' } };
  } else {
    const payload = cleanPayload(type, command?.payload ?? {}, slot);
    if (!payload) return { ok: false, reason: 'unknown-command', version: meta.version };
    const anyTurn = type === CMD.RESIGN_GAME || type === CMD.CLAIM_STALL_END;
    if (!anyTurn && slot !== state.currentTurnSlot) return { ok: false, reason: 'not-your-turn', version: meta.version };
    if (type === CMD.CONFIRM_MOVE) payload.moveId = reqId;
    engineCmd = { type, payload };
    if (!anyTurn) missedTurns[slot] = 0;
  }

  const prevStatus = state.status;
  const prevTurn = `${state.currentTurnSlot}:${state.turnNumber}:${state.boostV2.revision}`;
  const { events, rejected } = runEngine(state, engineCmd, isWordValid, rng);
  if (rejected) {
    const { placed, swappedTiles, boostPlacements, ...detail } = rejected;
    return { ok: false, reason: rejected.reason, detail: JSON.parse(JSON.stringify(detail)), version: meta.version };
  }
  const changed = state.status !== prevStatus
    || `${state.currentTurnSlot}:${state.turnNumber}:${state.boostV2.revision}` !== prevTurn;
  if (!changed) return { ok: false, reason: 'no-op', version: meta.version };

  if (engineCmd.payload?.reason === 'missed-turns') state.abandonReason = 'missed-turns';
  const nextMeta = { ...meta, version: meta.version + 1, missedTurns, turnDeadlineMs: nextDeadline(meta, state, now) };
  const result = { ...summarize(events), version: nextMeta.version };
  const nextRecent = pruneRecent({ ...recent, [reqId]: { result, ts: now } });
  return {
    ok: true,
    result,
    version: nextMeta.version,
    secret: secretDoc({ meta: nextMeta, state, recent: nextRecent, now }),
    room: projectRoom(state, nextMeta, now),
    racks: projectRacks(state, nextMeta.version),
  };
}

/**
 * Preview a draft move for the player whose turn it is: validates it exactly
 * like a real submission (on a throwaway copy) and returns the score
 * breakdown plus the replacement batch it would require — the queue entries
 * are revealed only for a valid draft that actually consumes Boosts.
 */
export function planDraft({ secret, uid, draft = {}, isWordValid, rng }) {
  const { meta, state } = splitSecret(secret);
  const slot = slotOf(meta.players, uid);
  if (slot < 0) return { ok: false, reason: 'not-a-player' };
  if (state.status !== 'playing') return { ok: false, reason: 'game-over' };
  if (slot !== state.currentTurnSlot) return { ok: false, reason: 'not-your-turn' };
  const placed = Array.isArray(draft.placed) ? draft.placed : [];
  const v2 = state.boostV2;
  const consumed = v2.activeBoosts
    .filter(b => placed.some(p => Number(p.r) === b.r && Number(p.c) === b.c))
    .map(b => b.instanceId);
  let planInfo;
  try {
    planInfo = planForMove(state, placed.map(p => ({ r: Number(p.r), c: Number(p.c) })), consumed);
  } catch {
    return { ok: false, reason: 'invalid-tile' };
  }
  const { events, rejected } = runEngine(state, {
    type: CMD.CONFIRM_MOVE,
    payload: { placed: draft.placed, swappedTiles: draft.swappedTiles, boostPlacements: planInfo.plan.arrangement },
  }, isWordValid, rng);
  if (rejected) return { ok: false, reason: rejected.reason, invalidWords: rejected.invalidWords ?? null };
  const move = events.find(e => e.type === EV.MOVE_CONFIRMED)?.payload;
  const endsMatch = events.some(e => e.type === EV.GAME_COMPLETED);
  const replacements = endsMatch ? [] : planInfo.plan.effective.map(e => ({
    instanceId: e.instanceId,
    fallbackApplied: e.fallbackApplied,
    definition: v2.definitions[e.effectiveDefinitionId],
  }));
  return JSON.parse(JSON.stringify({
    ok: true,
    breakdown: move.breakdown,
    replacements,
    legalSquares: endsMatch ? [] : planInfo.legal,
    pendingAfterMove: endsMatch ? 0 : planInfo.entries.length - planInfo.plan.placeable,
  }));
}

// Rebuild the public projections from a stored secret (the Worker uses this
// to re-publish the latest state if two commits' projection writes raced).
export function projectionsFromSecret(secret, now) {
  const { meta, state } = splitSecret(secret);
  return { version: meta.version, room: projectRoom(state, meta, now), racks: projectRacks(state, meta.version) };
}
