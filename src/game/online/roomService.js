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
import { setCommittedTile } from '../core/board.js';
import { createInitialState } from '../core/gameEngine.js';

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

export function initialTurnDeadlineMs(mode, settings = {}, nowMs = Date.now()) {
  if (!shouldUseSharedTurnTimer(mode, settings)) return null;
  return Number(nowMs || Date.now()) + turnLimitMsFromSettings(settings);
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
  if (Array.isArray(room.bag)) state.bag = [...room.bag];
  state.racks = { 0: [...(room.racks?.[0] ?? [])], 1: [...(room.racks?.[1] ?? [])] };
  state.board = deserializeBoard(room.board);
  state.bonusBoard = deserializeBonusBoard(room.bonusBoard);
  state.moveHistory = [...(room.moveHistory ?? [])];
  state.activeBoosts = [...(room.activeBoosts ?? [])];
  state.lockedCells = normalizeLockedCells(room.lockedCells);
  state.lockInventory = normalizeLockInventory(room.lockInventory);
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
export const MISSED_TURNS_FORFEIT_THRESHOLD = 2;

export function computeExpiredOnlineTurnState(state, nowMs, limitMs) {
  if (!state || typeof state !== 'object') return null;
  const now = Number(nowMs || Date.now());
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
  const now = Number(nowMs || Date.now());
  const grace = Number(graceMs || 0);
  return now >= deadline + grace;
}
