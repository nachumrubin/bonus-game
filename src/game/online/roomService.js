// Room service — the ONLY place that writes /rooms/{roomId}.
//
// Replaces the legacy split where both startOnlineGame() and
// pushMoveToFirebase() wrote to the same path with three layers of dedup
// (pushId + stateSeq + moveCount). The new model has one writer and one
// transaction guard: every mutating call runs inside a Firebase transaction
// that aborts unless room.version equals the caller's expectedVersion.
//
// All functions take a `db` parameter (the Firebase database instance) so
// tests can inject a mock without touching the global SDK.

import {
  PATH, FIELD, STATUS, buildRoomDoc, deserializeBoard, deserializeBonusBoard,
  normalizeLockInventory, normalizeLockedCells,
  normalizeBonusAssignment, normalizeBonusSqUsed, normalizePendingBonuses,
} from './schema.js';
import { logGameEvent, upsertGameIndex } from '../debug/debugLogger.js';
import { DEBUG_EVENT } from '../debug/debugSchema.js';
import { setCommittedTile } from '../core/board.js';
import { createInitialState } from '../core/gameEngine.js';
import { serverNow } from './serverClock.js';

function roomRef(db, roomId) {
  return db.ref(`${PATH.rooms}/${roomId}`);
}

function asyncIndexRef(db, uid, roomId) {
  return db.ref(`${PATH.users}/${uid}/${PATH.usersAsyncRooms}/${roomId}`);
}

// Async-mode rooms get indexed under each player's
// /users/{uid}/asyncRooms/{roomId} so the lobby can list them. Live rooms
// don't get indexed — they're ephemeral and can only be resumed from the
// single /users/{uid}/activeRoom field.
function isAsyncMode(mode) {
  return mode?.endsWith('-async');
}

export function turnLimitMsFromSettings(settings = {}) {
  const seconds = Number(settings?.botTime ?? settings?.turnSeconds ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export function shouldUseSharedTurnTimer(mode, settings = {}) {
  return !isAsyncMode(mode) && !!settings?.timelimit && turnLimitMsFromSettings(settings) > 0;
}

// Deadlines are absolute epoch stamps read by BOTH clients, so they must be
// written on the shared server clock rather than whichever device happened to
// commit. See serverClock.js.
export function initialTurnDeadlineMs(mode, settings = {}, nowMs = serverNow()) {
  if (!shouldUseSharedTurnTimer(mode, settings)) return null;
  return Number(nowMs || serverNow()) + turnLimitMsFromSettings(settings);
}

// Create a new room from an engine state. Used after invite-accept and after
// matchmaking pairing. Caller has already generated the roomId.
export async function createRoom(db, { roomId, mode, players, settings, engineState, serverTimestamp }) {
  const doc = buildRoomDoc({
    roomId, mode, players, settings, engineState,
    createdAt: serverTimestamp,
  });
  doc.turnDeadlineMs = null;
  doc.missedTurns = { 0: 0, 1: 0 };
  await roomRef(db, roomId).set(doc);
  // Mark both players' active room
  await db.ref(`${PATH.users}/${players[0].uid}/activeRoom`).set(roomId);
  await db.ref(`${PATH.users}/${players[1].uid}/activeRoom`).set(roomId);
  // For async modes, also write the per-user index so the lobby can
  // enumerate the player's in-flight async games. Live rooms skip this —
  // they have no resumable lifetime beyond the active session.
  if (isAsyncMode(mode)) {
    const meta = { mode, createdAt: serverTimestamp };
    await asyncIndexRef(db, players[0].uid, roomId).set(meta);
    await asyncIndexRef(db, players[1].uid, roomId).set(meta);
  }
  // Debug timeline (best-effort, never blocks room creation): seed the game
  // index + a GAME_CREATED event so the admin can find this game later.
  upsertGameIndex(db, roomId, {
    hostName: players[0]?.displayName ?? null, guestName: players[1]?.displayName ?? null,
    hostUid: players[0]?.uid ?? null, guestUid: players[1]?.uid ?? null,
    mode, status: STATUS.WAITING, createdAt: Date.now(),
  });
  logGameEvent(db, roomId, {
    type: DEBUG_EVENT.GAME_CREATED,
    summary: `Room created (${mode}) — ${players[0]?.displayName ?? '?'} vs ${players[1]?.displayName ?? '?'}`,
    payload: { mode }, userId: players[0]?.uid ?? null,
  });
  return doc;
}

// Remove a room from BOTH players' async index. Idempotent.
// Called when a room transitions to a terminal status (completed, abandoned,
// expired) — see setStatus and asyncReminderService.
export async function clearAsyncIndex(db, roomId, uids = []) {
  await Promise.all(uids.filter(Boolean).map(uid =>
    asyncIndexRef(db, uid, roomId).remove(),
  ));
}

// Read once. Rooms are v2-only after cutover.
export async function readRoom(db, roomId) {
  const snap = await roomRef(db, roomId).get();
  return snap?.val ? snap.val() : null;
}

// Subscribe to all room updates. Returns an unsubscribe function. The cb
// receives the room (or null if it's been deleted).
export function watchRoom(db, roomId, cb) {
  const r = roomRef(db, roomId);
  const handler = (snap) => {
    cb(snap?.val ? snap.val() : null);
  };
  r.on('value', handler);
  return () => r.off('value', handler);
}

// Rebuild an engine state from a stored room. Used on reconnect/refresh.
export function engineStateFromRoom(room) {
  if (!room) throw new Error('engineStateFromRoom: room is null');

  const state = createInitialState({
    mode: room.mode,
    tileBagSeed: room.tileBagSeed,
    players: room.players,
    startingSlot: room.currentTurnSlot ?? 0,
    settings: room.settings ?? {},
  });
  // Replace the freshly-drawn racks / empty board with the persisted state
  state.scores = { ...room.scores };
  // Firebase never stores an empty array: once the last tiles are drawn the
  // `bag` key is simply absent. Absent therefore means EMPTY — never fall back
  // to the freshly seeded full bag from createInitialState (a resync/resume
  // would otherwise hand the client ~80 phantom tiles).
  state.bag = Array.isArray(room.bag) ? [...room.bag] : [];
  state.racks = { 0: [...(room.racks?.[0] ?? [])], 1: [...(room.racks?.[1] ?? [])] };
  state.board = deserializeBoard(room.board);
  state.bonusBoard = deserializeBonusBoard(room.bonusBoard);
  state.moveHistory = [...(room.moveHistory ?? [])];
  state.activeBoosts = [...(room.activeBoosts ?? [])];
  state.lockedCells = normalizeLockedCells(room.lockedCells);
  state.lockInventory = normalizeLockInventory(room.lockInventory, { missingMeansEmpty: true });
  state.bonusAssignment = normalizeBonusAssignment(room.bonusAssignment);
  state.bonusSqUsed = normalizeBonusSqUsed(room.bonusSqUsed);
  state.pendingBonuses = normalizePendingBonuses(room.pendingBonuses);
  state.currentTurnSlot = room.currentTurnSlot ?? 0;
  state.turnNumber = room.turnNumber ?? 1;
  state.firstMove = (room.moveHistory ?? []).length === 0;
  state.passCount = room._passCount ?? 0;
  state.status = room.status ?? STATUS.PLAYING;
  state.turnDeadlineMs = room.turnDeadlineMs ?? null;
  state.missedTurns = room.missedTurns ?? { 0: 0, 1: 0 };
  return state;
}

// Single writer for game-state changes. Runs inside a Firebase transaction
// that aborts unless room.version === expectedVersion.
//
// `produceUpdate(room)` is a pure function that takes the current room and
// returns the patch to apply (or null/undefined to abort). The patch is
// shallow-merged into the room.
export async function commitTransaction(db, roomId, expectedVersion, produceUpdate) {
  const result = await roomRef(db, roomId).transaction((current) => {
    if (!current) return; // abort: room doesn't exist
    if (current.version !== expectedVersion) return; // abort: stale
    const patch = produceUpdate(current);
    if (!patch) return;
    return { ...current, ...patch, version: expectedVersion + 1 };
  });
  // Compat SDK returns { committed, snapshot }; v9 returns { committed, snapshot }.
  // Both expose .committed.
  return {
    committed: !!result?.committed,
    room: result?.snapshot?.val ? result.snapshot.val() : null,
  };
}

// Bandwidth-lean version of commitTransaction (October 2026 staging load
// test: full-room transactions were the main cost — every commit re-sent and
// re-downloaded the whole room incl. the growing moveHistory).
//
// Writes ONLY the fields that changed, as one atomic multi-path update that
// always includes `version: expectedVersion + 1`. Compare-and-set still holds:
// the rooms/$roomId rule requires newData.version === data.version + 1, so a
// write built on a stale base is rejected by the server exactly like a
// transaction abort, and the update is all-or-nothing.
//
// `baseRoom` is the caller's latest copy of the server room. If it does not
// match `expectedVersion` we cannot diff safely and fall back to a full
// transaction. Same return shape as commitTransaction; `room` is the post-
// commit room as written.
export async function commitPatch(db, roomId, expectedVersion, baseRoom, produceUpdate) {
  if (!baseRoom || Number(baseRoom.version) !== Number(expectedVersion)) {
    return commitTransaction(db, roomId, expectedVersion, produceUpdate);
  }
  const patch = produceUpdate(baseRoom);
  if (!patch) return { committed: false, room: null };
  // Clone: the patch holds live references into the caller's engine state
  // (e.g. lastMove IS the moveHistory entry). The returned room becomes the
  // caller's "server copy" and must not change when local state mutates later
  // (a real write is serialized; a reference is not).
  const next = structuredClone({ ...baseRoom, ...patch, version: expectedVersion + 1 });
  const updates = diffRoomForUpdate(baseRoom, next);
  try {
    await roomRef(db, roomId).update(updates);
    return { committed: true, room: next, writtenPaths: Object.keys(updates).length };
  } catch (err) {
    return { committed: false, room: null, error: err };
  }
}

// Room fields diffed one level deeper (only changed children are written):
// collections that grow or change piecemeal.
const DEEP_DIFF_KEYS = new Set([
  'board', 'bonusBoard', 'moveHistory', 'racks', 'scores', 'bag', 'activeBoosts',
  'lockedCells', 'lockInventory', 'missedTurns', 'pendingBonuses', 'bonusSqUsed',
  'bonusAssignment', 'turnEffects', 'ready', 'settings',
]);

// Stable JSON with null ≡ undefined (Firebase drops nulls) and sorted keys
// (Firebase returns keys sorted; our objects may not be).
function canon(v) {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) {
    // Trailing/holey nulls are equivalent to absent entries.
    const out = [];
    for (let i = 0; i < v.length; i++) out.push(canon(v[i]));
    while (out.length && out[out.length - 1] === 'null') out.pop();
    return `[${out.join(',')}]`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter(k => v[k] !== undefined && v[k] !== null).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function sameValue(a, b) { return canon(a) === canon(b); }

function isContainer(v) { return v !== null && typeof v === 'object'; }

/**
 * Multi-path update (relative to the room) that turns `base` into `next`.
 * Exported for tests.
 */
export function diffRoomForUpdate(base, next) {
  const out = {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(next ?? {})]);
  for (const key of keys) {
    const b = base?.[key];
    const n = next?.[key];
    if (sameValue(b, n)) continue;
    if (DEEP_DIFF_KEYS.has(key) && isContainer(b) && isContainer(n)) {
      const childKeys = new Set([...Object.keys(b), ...Object.keys(n)]);
      for (const ck of childKeys) {
        if (!sameValue(b[ck], n[ck])) out[`${key}/${ck}`] = n[ck] === undefined ? null : n[ck];
      }
    } else {
      out[key] = n === undefined ? null : n;
    }
  }
  out.version = next.version;
  return out;
}

// Mark a slot as ready (coin-toss handshake). Both ready → status flips to playing.
export async function setReady(db, roomId, slot, ready = true) {
  await db.ref(`${PATH.rooms}/${roomId}/${FIELD.ready}/${slot}`).set(!!ready);
}

export async function markReadyAndMaybeStart(db, roomId, slot, nowMs = Date.now()) {
  if (!db) throw new Error('markReadyAndMaybeStart: db required');
  if (!roomId) throw new Error('markReadyAndMaybeStart: roomId required');
  if (slot !== 0 && slot !== 1) throw new Error('markReadyAndMaybeStart: bad slot');

  await setReady(db, roomId, slot, true);
  const room = await readRoom(db, roomId);
  if (!room) return null;
  const ready = {
    0: !!(room.ready?.[0] ?? room.ready?.['0']),
    1: !!(room.ready?.[1] ?? room.ready?.['1']),
    [slot]: true,
  };
  if (ready[0] && ready[1] && room.status !== STATUS.PLAYING) {
    await roomRef(db, roomId).update({
      status: STATUS.PLAYING,
      turnDeadlineMs: initialTurnDeadlineMs(room.mode, room.settings ?? {}, nowMs),
      updatedAt: nowMs,
    });
    return readRoom(db, roomId);
  }
  return { ...room, ready };
}

// Update room status — used for resign / abandonment. Status transitions
// don't go through the version transaction because they're authoritative
// (a resign is unconditional).
//
// Side-effect: terminal transitions (completed / abandoned / expired)
// remove the room from both players' async-rooms index so the lobby list
// stays clean. Reads the room first to discover the player uids.
export async function setStatus(db, roomId, status, extras = {}) {
  await db.ref(`${PATH.rooms}/${roomId}`).update({ status, ...extras });
  const isTerminal =
    status === STATUS.COMPLETED ||
    status === STATUS.ABANDONED ||
    status === STATUS.EXPIRED;
  if (!isTerminal) return;
  const room = await readRoom(db, roomId);
  if (!room || !isAsyncMode(room.mode)) return;
  const uids = [room.players?.[0]?.uid, room.players?.[1]?.uid].filter(Boolean);
  await clearAsyncIndex(db, roomId, uids);
}

// Leave the room: clear users/{uid}/activeRoom. Doesn't delete the room — that's
// owned by the lifecycle (abandoned status drives cleanup).
export async function leaveRoom(db, roomId, uid) {
  await db.ref(`${PATH.users}/${uid}/activeRoom`).set(null);
}

export async function setPlayerSubscriptionId(db, roomId, slot, oneSignalSubId) {
  if (!db) throw new Error('setPlayerSubscriptionId: db required');
  if (!roomId) throw new Error('setPlayerSubscriptionId: roomId required');
  if (slot !== 0 && slot !== 1) throw new Error('setPlayerSubscriptionId: bad slot');
  const value = oneSignalSubId ? String(oneSignalSubId) : null;
  await db.ref(`${PATH.rooms}/${roomId}/${FIELD.players}/${slot}/oneSignalSubId`).set(value);
}

export async function setSettings(db, roomId, settings = {}) {
  if (!db) throw new Error('setSettings: db required');
  if (!roomId) throw new Error('setSettings: roomId required');
  await db.ref(`${PATH.rooms}/${roomId}/${FIELD.settings}`).set({ ...(settings ?? {}) });
}

// Broadcast that the active player has entered a boost flow (auto bonus
// modal, mini-game, or wheel). Both clients use this signal to:
//   - freeze their turn timer (the boost flow takes time the active player
//     shouldn't be penalised for, and the opponent isn't waiting on a
//     normal "your turn just hasn't started yet" beat — they're waiting on
//     the boost UI to resolve);
//   - show a spectator overlay on the opponent so they understand what
//     the active player is doing.
//
// Payload is sanitised to a small fixed shape so a renamed field on the
// client can't leak into the room.
export async function setLiveBonus(db, roomId, payload) {
  if (!db) throw new Error('setLiveBonus: db required');
  if (!roomId) throw new Error('setLiveBonus: roomId required');
  if (payload == null) {
    await db.ref(`${PATH.rooms}/${roomId}/${FIELD.liveBonus}`).set(null);
    return;
  }
  const slot = Number(payload.slot);
  if (slot !== 0 && slot !== 1) throw new Error('setLiveBonus: bad slot');
  const clean = {
    active: true,
    slot,
    kind: String(payload.kind ?? 'auto'),
    bonusType: payload.bonusType ? String(payload.bonusType) : null,
    title: payload.title ? String(payload.title) : null,
    desc: payload.desc ? String(payload.desc) : null,
    icon: payload.icon ? String(payload.icon) : null,
    // The word(s) the active player just laid down, and their base (pre-bonus)
    // score. The move itself is committed but its SCORE is deferred until the
    // mini-game resolves, so the spectator overlay shows these to the opponent —
    // otherwise they'd sit for up to 60s with no idea what was played.
    // NOTE: distinct from `progress.score`, which is the mini-game's running score.
    words: Array.isArray(payload.words)
      ? payload.words.map(w => String(w)).filter(Boolean).slice(0, 8)
      : null,
    moveScore: Number.isFinite(Number(payload.moveScore)) ? Math.floor(Number(payload.moveScore)) : null,
    progress: payload.progress && typeof payload.progress === 'object'
      ? sanitiseProgress(payload.progress)
      : null,
    updatedAt: Number(payload.updatedAt) || Date.now(),
  };
  await db.ref(`${PATH.rooms}/${roomId}/${FIELD.liveBonus}`).set(clean);
}

// Incremental progress update during a mini-game / wheel. Skips the rest
// of the liveBonus payload (already on the server) and writes only the
// progress + updatedAt fields so the opponent's spectator UI can refresh.
export async function setLiveBonusProgress(db, roomId, progress) {
  if (!db) throw new Error('setLiveBonusProgress: db required');
  if (!roomId) throw new Error('setLiveBonusProgress: roomId required');
  if (!progress || typeof progress !== 'object') return;
  await db.ref(`${PATH.rooms}/${roomId}/${FIELD.liveBonus}`).update({
    progress: sanitiseProgress(progress),
    updatedAt: Date.now(),
  });
}

function sanitiseProgress(progress) {
  const out = {};
  if (progress.secsLeft != null && Number.isFinite(Number(progress.secsLeft))) {
    out.secsLeft = Math.max(0, Math.floor(Number(progress.secsLeft)));
  }
  if (progress.score != null && Number.isFinite(Number(progress.score))) {
    out.score = Math.floor(Number(progress.score));
  }
  if (progress.label) out.label = String(progress.label);
  return out;
}

export async function setLivePreview(db, roomId, { slot, tiles = [] } = {}) {
  if (!db) throw new Error('setLivePreview: db required');
  if (!roomId) throw new Error('setLivePreview: roomId required');
  if (slot !== 0 && slot !== 1) throw new Error('setLivePreview: bad slot');
  const preview = {
    slot,
    tiles: tiles.map(t => ({
      r: Number(t.r),
      c: Number(t.c),
      letter: String(t.letter ?? ''),
      val: Number(t.val ?? 0) || 0,
      isJoker: !!t.isJoker,
    })).filter(t => Number.isFinite(t.r) && Number.isFinite(t.c) && t.letter),
    updatedAt: Date.now(),
  };
  await db.ref(`${PATH.rooms}/${roomId}/${FIELD.livePreview}`).set(preview.tiles.length ? preview : null);
}

// Two consecutive missed turns by the same player force a forfeit. The
// loser is the player who failed to move twice in a row.
// Write a reaction payload to the room's liveReaction field.
// Not version-guarded — same pattern as livePreview / liveBonus.
// Only valid type/id combinations are accepted; senderSlot is clamped to 0|1.
export async function setLiveReaction(db, roomId, payload) {
  if (!db) throw new Error('setLiveReaction: db required');
  if (!roomId) throw new Error('setLiveReaction: roomId required');
  if (payload == null) {
    await db.ref(`${PATH.rooms}/${roomId}/${FIELD.liveReaction}`).set(null);
    return;
  }
  const senderSlot = payload.senderSlot === 1 ? 1 : 0;
  const clean = {
    type:       String(payload.type),
    id:         String(payload.id),
    senderSlot,
    ts:         Number(payload.ts) || Date.now(),
  };
  await db.ref(`${PATH.rooms}/${roomId}/${FIELD.liveReaction}`).set(clean);
}

export const MISSED_TURNS_FORFEIT_THRESHOLD = 2;

export function computeExpiredOnlineTurnState(state, nowMs, limitMs) {
  if (!state || typeof state !== 'object') return null;
  const now = Number(nowMs || serverNow());
  let currentTurn = Number(state.turn !== undefined ? state.turn : state.currentTurnSlot ?? 0);
  if (currentTurn !== 0 && currentTurn !== 1) currentTurn = 0;
  const nextTurn = currentTurn === 0 ? 1 : 0;
  const missedRaw = state.missedTurns || {};
  const missed = [
    Number(missedRaw[0] !== undefined ? missedRaw[0] : missedRaw['0'] || 0),
    Number(missedRaw[1] !== undefined ? missedRaw[1] : missedRaw['1'] || 0),
  ];
  missed[currentTurn] = Number(missed[currentTurn] || 0) + 1;
  missed[nextTurn] = 0;
  const nextDeadline = Number(limitMs || 0) > 0 ? now + Number(limitMs || 0) : 0;
  const passCountNow = Number(state.passCount || state._passCount || 0) + 1;
  const seq = Number(state.stateSeq || state.revision || 0) + 1;
  const forfeit = missed[currentTurn] >= MISSED_TURNS_FORFEIT_THRESHOLD;
  const base = {
    ...state,
    turn: nextTurn,
    currentTurnSlot: nextTurn,
    passCount: passCountNow,
    _passCount: passCountNow,
    moveCount: Number(state.moveCount || 0) + 1,
    turnDeadlineMs: nextDeadline,
    stateSeq: seq,
    missedTurns: { 0: missed[0], 1: missed[1] },
    ts: now,
  };
  if (forfeit) {
    base.status = STATUS.ABANDONED;
    base.abandonedBy = currentTurn;
    base.abandonReason = 'missed-turns';
    base.turnDeadlineMs = 0;
  }
  return base;
}

export function shouldClaimExpiredOnlineTurn(state, myIdx, nowMs, graceMs) {
  if (!state || typeof state !== 'object') return false;
  const myTurn = Number(myIdx);
  if (myTurn !== 0 && myTurn !== 1) return false;
  const currentTurn = Number(state.turn !== undefined ? state.turn : state.currentTurnSlot ?? 0);
  if (currentTurn === myTurn) return false;
  const deadline = Number(state.turnDeadlineMs || 0);
  if (!deadline) return false;
  const now = Number(nowMs || serverNow());
  const grace = Number(graceMs || 0);
  return now >= deadline + grace;
}
