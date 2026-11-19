// Online session for Boost 2.0 (Worker-authoritative) rooms — Phase 7.
//
// The app's game screen, controller and Boost 2.0 layer read `session.state`
// and call `session.dispatch(cmd)`, exactly as for local games. Here the
// state is a MIRROR built from what this player may see:
//   rooms/{roomId}                    — the public projection (board, scores,
//                                       turn, active Boosts, next two cards…)
//   boostV2Racks/{roomId}/{mySlot}    — my own rack only
// The opponent's rack and the bag are placeholders of the right LENGTH; the
// hidden queue is placeholder cards (definition '__hidden__') after the two
// visible ones. Nothing here can learn more than the server publishes.
//
// Every action goes to the Worker (boostTurnClient); nothing is written to
// the room by this client. Room updates are turned into the same bus events
// the local engine emits (MOVE_CONFIRMED / OPPONENT_MOVED, TURN_CHANGED,
// BOOST_PLACED, BOOSTS_CHANGED, TILES_EXCHANGED, GAME_COMPLETED), so the UI,
// animations and push notifications work unchanged.
//
// A room update is applied only once my rack for the same version has
// arrived (the Worker writes both), so the screen never shows a new board
// with a stale rack. Live games: this client claims the opponent's expired
// turn through the Worker (deadline + grace on the server clock).

import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { deserializeBoard, PATH } from './schema.js';
import { TIMEOUT_GRACE_MS, BOOST_CMD } from '../boostV2/authoritativeTurn.js';
import { readBoostV2Room, readMyRack } from './boostTurnClient.js';

export const HIDDEN_DEFINITION_ID = '__hidden__';
export const HIDDEN_DEFINITION = Object.freeze({
  definitionId: HIDDEN_DEFINITION_ID, family: 'HIDDEN', difficulty: 'MEDIUM', evaluationScope: 'WORD',
  parameters: {}, reward: 0, hidden: true,
});
const RACK_WAIT_MS = 1500;
const TERMINAL = new Set(['completed', 'abandoned', 'expired']);

const arr = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));

// Engine-shaped boostV2 block from the public view.
export function boostV2FromPublic(pub) {
  const definitions = { [HIDDEN_DEFINITION_ID]: HIDDEN_DEFINITION };
  const addDef = (d) => { if (d?.definitionId) definitions[d.definitionId] = d; };
  const activeBoosts = arr(pub.activeBoosts).map(({ definition, ...b }) => { addDef(definition); return { ...b, r: Number(b.r), c: Number(b.c) }; });
  const upcoming = arr(pub.upcoming);
  for (const u of upcoming) addDef(u.definition);
  const visible = upcoming.map(u => ({ instanceId: u.instanceId, definitionId: u.definition?.definitionId ?? HIDDEN_DEFINITION_ID }));
  const hiddenCount = Math.max(0, (Number(pub.remainingInQueue) || 0) - visible.length);
  const entries = [...visible, ...Array.from({ length: hiddenCount }, () => ({ instanceId: null, definitionId: HIDDEN_DEFINITION_ID }))];
  let openingSetup = null;
  if (pub.openingSetup) {
    const os = pub.openingSetup;
    addDef(os.current?.definition);
    const placements = arr(os.placements).map(({ definition, ...p }) => { addDef(definition); return { ...p, r: Number(p.r), c: Number(p.c) }; });
    const total = Number(os.total) || 0;
    const effective = [];
    for (let i = 0; i < total; i++) {
      const p = placements[i];
      if (p) effective.push({ instanceId: p.instanceId, definitionId: p.definitionId, effectiveDefinitionId: p.effectiveDefinitionId });
      else if (i === placements.length && os.current?.definition) {
        effective.push({ instanceId: os.current.instanceId, definitionId: os.current.definitionId, effectiveDefinitionId: os.current.effectiveDefinitionId ?? os.current.definitionId });
      } else {
        // Before activation the queue cursor is 0, so step i is queue entry i.
        const e = entries[i];
        const known = e && definitions[e.definitionId] && e.definitionId !== HIDDEN_DEFINITION_ID;
        effective.push(known
          ? { instanceId: e.instanceId, definitionId: e.definitionId, effectiveDefinitionId: e.definitionId }
          : { instanceId: null, definitionId: HIDDEN_DEFINITION_ID, effectiveDefinitionId: HIDDEN_DEFINITION_ID });
      }
    }
    openingSetup = { order: arr(os.order).map(Number), placements, effective, returnSlot: null };
  }
  return {
    rulesVersion: pub.rulesVersion, deckVersion: pub.deckVersion, rules: pub.rules,
    definitions, phase: pub.phase, activeBoosts, openingSetup,
    queue: { deckVersion: pub.deckVersion, entries, cursor: 0 },
    consumedInstanceIds: [], lastMoveId: null, revision: Number(pub.revision) || 0,
  };
}

// Fill (or refresh) the mirror state in place — the controller keeps a
// reference to `session.state`, so it must stay the same object.
export function applyRoomToState(state, room, myRack, mySlot) {
  const opp = mySlot === 0 ? 1 : 0;
  Object.assign(state, {
    schemaVersion: 2, ruleset: 'BOOST_V2', roomId: room.roomId, mode: room.mode, status: room.status,
    players: room.players, settings: room.settings ?? {},
    scores: { 0: Number(room.scores?.[0]) || 0, 1: Number(room.scores?.[1]) || 0 },
    currentTurnSlot: Number(room.currentTurnSlot) || 0, turnNumber: Number(room.turnNumber) || 1,
    passCount: Number(room.passCount) || 0, moveCount: Number(room.moveCount) || 0,
    firstMove: !!room.firstMove,
    board: deserializeBoard(room.board), bonusBoard: new Map(),
    bag: new Array(Number(room.bagCount) || 0).fill(null),
    racks: { [mySlot]: [...myRack], [opp]: new Array(Number(room.rackCounts?.[opp]) || 0).fill(null) },
    moveHistory: arr(room.moveHistory),
    turnDeadlineMs: room.turnDeadlineMs ?? null,
    lockedCells: [], lockInventory: { 0: [], 1: [] }, activeBoosts: [], bonusAssignment: [], bonusSqUsed: {}, pendingBonuses: [],
    abandonedBy: room.abandonedBy ?? null, abandonReason: room.abandonReason ?? null, endReason: room.endReason ?? null,
    version: Number(room.version) || 0,
    boostV2: boostV2FromPublic(room.boostV2 ?? {}),
  });
  return state;
}

function movePayload(m) {
  const b = m.breakdown;
  return {
    slot: m.slot, placed: arr(m.tiles), swappedTiles: arr(m.swappedTiles), words: arr(m.words), wordTiles: arr(m.wordTiles).map(arr),
    score: m.score, multiplier: 1,
    baseScore: b ? b.baseScore + b.fullRackBonus : m.score, bonusExtra: b ? b.boostScore : 0,
    ruleset: 'BOOST_V2', breakdown: b ?? null, boostPlacements: arr(m.boostPlacements),
  };
}

/**
 * @param {{ bus, db, room, mySlot: 0|1, client, now?: () => number,
 *           setTimer?, clearTimer? }} opts
 *   `client` — createBoostTurnClient(...) (submit / claimTimeout).
 *   `now` — the shared server clock (serverClock.serverNow) for timeouts.
 */
export function createBoostV2OnlineSession({ bus, db, room: initialRoom, mySlot, client, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!bus || !db || !initialRoom || !client) throw new Error('createBoostV2OnlineSession: bus, db, room and client are required');
  const roomId = initialRoom.roomId;
  const state = {};
  let room = readBoostV2Room(initialRoom);
  let rack = { tiles: [], version: 0 };
  let pendingRoom = null;
  let rackWaitTimer = null;
  let timeoutTimer = null;
  let inFlight = false;
  let disposed = false;
  const subs = [];

  applyRoomToState(state, room, [], mySlot);

  function emitDiff(prev, next) {
    const prevHist = arr(prev.moveHistory).length;
    const nextHist = arr(next.moveHistory).length;
    const action = next.lastAction ?? null;
    if (nextHist > prevHist) {
      const m = arr(next.moveHistory)[nextHist - 1];
      bus.emit(m.slot === mySlot ? EV.MOVE_CONFIRMED : EV.OPPONENT_MOVED, movePayload(m));
      bus.emit(EV.SCORE_CHANGED, { slot: m.slot, score: state.scores[m.slot] });
    } else if (action?.type === 'exchange' && next.version !== prev.version) {
      bus.emit(EV.TILES_EXCHANGED, { slot: action.slot, count: action.count ?? 0, free: false });
    }
    const pSetup = prev.boostV2?.openingSetup;
    const nSetup = next.boostV2?.openingSetup;
    const prevPlaced = arr(pSetup?.placements).length;
    const nextPlaced = arr(nSetup?.placements).length;
    const setupEnded = prev.boostV2?.phase === 'OPENING_SETUP' && next.boostV2?.phase !== 'OPENING_SETUP';
    if (action?.type === 'setup' && (nextPlaced > prevPlaced || setupEnded)) {
      bus.emit(EV.BOOST_PLACED, { slot: action.slot, phase: next.boostV2?.phase });
    }
    if ((prev.boostV2?.revision ?? -1) !== (next.boostV2?.revision ?? -1) || prev.boostV2?.phase !== next.boostV2?.phase) {
      bus.emit(EV.BOOSTS_CHANGED, next.boostV2);
    }
    const turnMoved = prev.currentTurnSlot !== next.currentTurnSlot || prev.turnNumber !== next.turnNumber || prev.boostV2?.phase !== next.boostV2?.phase;
    if (!TERMINAL.has(next.status) && turnMoved) {
      const reason = next.boostV2?.phase === 'OPENING_SETUP' ? 'boost-setup' : (action?.type ?? 'remote-sync');
      bus.emit(EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber, reason, prevSlot: prev.currentTurnSlot });
    }
    if (TERMINAL.has(next.status) && !TERMINAL.has(prev.status)) {
      bus.emit(EV.GAME_COMPLETED, {
        status: next.status, winnerSlot: next.winnerSlot ?? null, scores: { ...state.scores },
        abandonedBy: next.abandonedBy ?? null, abandonReason: next.abandonReason ?? null,
        ...(next.endgame ? { boostV2Endgame: next.endgame } : {}),
      });
    }
  }

  function applyRoom(next) {
    const prev = room;
    room = next;
    applyRoomToState(state, next, readMyRack(rack), mySlot);
    if (prev.version !== next.version || prev.status !== next.status) emitDiff(prev, next);
    else bus.emit(EV.BOOSTS_CHANGED, next.boostV2); // rack-only refresh
    scheduleTimeoutClaim();
  }

  function tryFlush({ force = false } = {}) {
    if (!pendingRoom) return;
    if (!force && (Number(rack.version) || 0) < (Number(pendingRoom.version) || 0)) {
      if (!rackWaitTimer) rackWaitTimer = setTimer(() => { rackWaitTimer = null; tryFlush({ force: true }); }, RACK_WAIT_MS);
      return;
    }
    if (rackWaitTimer) { clearTimer(rackWaitTimer); rackWaitTimer = null; }
    const next = pendingRoom;
    pendingRoom = null;
    applyRoom(next);
  }

  function onRoom(raw) {
    if (disposed) return;
    const next = readBoostV2Room(raw);
    if (!next) return;
    if ((Number(next.version) || 0) < (Number(room.version) || 0)) return; // stale echo
    pendingRoom = next;
    tryFlush();
  }
  function onRack(raw) {
    if (disposed) return;
    rack = { tiles: readMyRack(raw), version: Number(raw?.version) || 0 };
    if (pendingRoom) tryFlush();
    else if (rack.version >= (Number(room.version) || 0)) applyRoom(room);
  }

  // ── live-game timeout claims (the opponent's expired turn) ───────────────
  function scheduleTimeoutClaim() {
    if (timeoutTimer) { clearTimer(timeoutTimer); timeoutTimer = null; }
    const deadline = Number(room.turnDeadlineMs) || 0;
    if (disposed || !deadline || room.status !== 'playing' || state.currentTurnSlot === mySlot) return;
    const delay = Math.max(0, deadline + TIMEOUT_GRACE_MS - now());
    const version = room.version;
    timeoutTimer = setTimer(async () => {
      timeoutTimer = null;
      if (disposed || room.version !== version || room.status !== 'playing') return;
      const r = await client.claimTimeout(roomId, { expectedVersion: version });
      if (!r?.ok && r?.reason === 'turn-not-expired') scheduleTimeoutClaim(); // clock skew: try again
    }, delay);
  }

  // ── commands → Worker ────────────────────────────────────────────────────
  const COMMANDS = new Set([CMD.CONFIRM_MOVE, CMD.PASS_TURN, CMD.EXCHANGE_TILE, CMD.PLACE_OPENING_BOOST, CMD.RESIGN_GAME, CMD.CLAIM_STALL_END]);
  function cleanPayload(cmd) {
    const p = cmd.payload ?? {};
    switch (cmd.type) {
      case CMD.CONFIRM_MOVE: return {
        placed: arr(p.placed).map(t => ({ r: t.r, c: t.c, letter: t.letter, isJoker: !!t.isJoker })),
        swappedTiles: arr(p.swappedTiles).map(t => ({ r: t.r, c: t.c, letter: t.letter, isJoker: !!t.isJoker })),
        boostPlacements: arr(p.boostPlacements).map(b => (b.instanceId ? { r: b.r, c: b.c, instanceId: b.instanceId } : { r: b.r, c: b.c })),
      };
      case CMD.EXCHANGE_TILE: return { letters: arr(p.letters) };
      case CMD.PLACE_OPENING_BOOST: return { r: p.r, c: p.c };
      default: return {};
    }
  }

  async function dispatch(cmd) {
    if (!cmd || !COMMANDS.has(cmd.type) || disposed) return;
    if (inFlight) { bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'request-pending' }); return; }
    inFlight = true;
    try {
      const r = await client.submit(roomId, { type: cmd.type, payload: cleanPayload(cmd) }, { expectedVersion: room.version });
      if (r?.ok) return; // the room update (via the listener) drives the UI
      if (r?.reason === 'stale-version') { await resync(); }
      bus.emit(EV.INVALID_MOVE_REJECTED, { reason: r?.reason ?? 'network', ...(r?.detail ?? {}) });
    } finally {
      inFlight = false;
    }
  }

  async function resync() {
    const snap = await db.ref(`${PATH.rooms}/${roomId}`).get();
    const val = snap?.val ? snap.val() : null;
    if (val) { pendingRoom = readBoostV2Room(val); tryFlush({ force: true }); }
  }

  async function markReady() {
    return client.submit(roomId, { type: BOOST_CMD.READY });
  }

  function start() {
    // The UI subscribes before start(); the listeners deliver the live room.
    const roomRef = db.ref(`${PATH.rooms}/${roomId}`);
    const rackRef = db.ref(`${PATH.boostV2Racks}/${roomId}/${mySlot}`);
    const h1 = (snap) => onRoom(snap?.val ? snap.val() : null);
    const h2 = (snap) => onRack(snap?.val ? snap.val() : null);
    roomRef.on('value', h1);
    rackRef.on('value', h2);
    subs.push(() => roomRef.off('value', h1), () => rackRef.off('value', h2));
    bus.emit(EV.GAME_STARTED, { mode: state.mode, players: state.players, currentTurnSlot: state.currentTurnSlot });
    scheduleTimeoutClaim();
  }

  function dispose() {
    disposed = true;
    if (rackWaitTimer) clearTimer(rackWaitTimer);
    if (timeoutTimer) clearTimer(timeoutTimer);
    for (const off of subs) try { off(); } catch { /* swallow */ }
    subs.length = 0;
  }

  return {
    state, bus, mode: initialRoom.mode, roomId, mySlot, online: true, ruleset: 'BOOST_V2',
    start, dispatch, dispose, markReady,
    resync: () => resync().catch(() => null),
    _subs: subs,
  };
}
