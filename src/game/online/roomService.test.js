import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import {
  createRoom, readRoom, watchRoom, commitTransaction, engineStateFromRoom, setReady,
  markReadyAndMaybeStart, leaveRoom, setPlayerSubscriptionId, setSettings, setLivePreview,
} from './roomService.js';
import { createInitialState } from '../core/gameEngine.js';
import { STATUS } from './schema.js';

function fakeEngineState() {
  return createInitialState({
    mode: 'friend-live',
    tileBagSeed: 'room-test',
    players: {
      0: { uid: 'a', displayName: 'A' },
      1: { uid: 'b', displayName: 'B' },
    },
  });
}

const PLAYERS = {
  0: { uid: 'a', displayName: 'A', avatar: null, joinedAt: 1 },
  1: { uid: 'b', displayName: 'B', avatar: null, joinedAt: 1 },
};

test('createRoom writes the new-shape doc and stamps activeRoom on both users', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, {
    roomId: 'room-1', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000,
  });
  const room = await readRoom(db, 'room-1');
  assert.equal(room.roomId, 'room-1');
  assert.equal(room.schemaVersion, 2);
  assert.equal(room.status, STATUS.WAITING);
  assert.equal(room.version, 1);
  assert.equal(db._data.users.a.activeRoom, 'room-1');
  assert.equal(db._data.users.b.activeRoom, 'room-1');
});

test('commitTransaction with matching version succeeds and bumps version', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, { roomId: 'r2', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });

  const result = await commitTransaction(db, 'r2', 1, () => ({ scores: { 0: 10, 1: 0 } }));
  assert.equal(result.committed, true);
  const after = await readRoom(db, 'r2');
  assert.equal(after.version, 2);
  assert.equal(after.scores[0], 10);
});

test('commitTransaction with stale expectedVersion is aborted', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, { roomId: 'r3', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });

  // First write succeeds, takes version → 2
  await commitTransaction(db, 'r3', 1, () => ({ scores: { 0: 5, 1: 0 } }));
  // Second write with old expectedVersion=1 must abort
  const result = await commitTransaction(db, 'r3', 1, () => ({ scores: { 0: 99, 1: 0 } }));
  assert.equal(result.committed, false);
  const after = await readRoom(db, 'r3');
  assert.equal(after.scores[0], 5); // unchanged
  assert.equal(after.version, 2);
});

test('watchRoom fires on every update', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, { roomId: 'r4', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });

  const versions = [];
  const off = watchRoom(db, 'r4', (room) => { if (room) versions.push(room.version); });
  await commitTransaction(db, 'r4', 1, () => ({ scores: { 0: 5, 1: 0 } }));
  await commitTransaction(db, 'r4', 2, () => ({ scores: { 0: 8, 1: 0 } }));
  off();
  // Initial fire (v1) + two commits (v2, v3)
  assert.deepEqual(versions, [1, 2, 3]);
});

test('engineStateFromRoom rebuilds engine state from a stored room', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  engineState.scores = { 0: 12, 1: 8 };
  await createRoom(db, { roomId: 'r5', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  const room = await readRoom(db, 'r5');
  const reconstructed = engineStateFromRoom(room);
  assert.equal(reconstructed.scores[0], 12);
  assert.equal(reconstructed.mode, 'friend-live');
});

test('engineStateFromRoom restores persisted bag for reconnect determinism', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, { roomId: 'r-bag', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  const persistedBag = ['א', 'ב', 'ג', 'ד'];
  await db.ref('rooms/r-bag').update({
    bag: persistedBag,
    racks: { 0: ['ה'], 1: ['ו'] },
  });
  const room = await readRoom(db, 'r-bag');
  const reconstructed = engineStateFromRoom(room);
  assert.deepEqual(reconstructed.bag, persistedBag);
  assert.deepEqual(reconstructed.racks, { 0: ['ה'], 1: ['ו'] });
});

test('engineStateFromRoom restores lock inventory and locked cells', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  engineState.lockedCells = [{ id: 'lock-1', r: 4, c: 5, ownerSlot: 0, remainingTurns: 2 }];
  engineState.lockInventory = { 0: [1, 3], 1: [1, 2, 3] };
  await createRoom(db, { roomId: 'r-locks', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  const room = await readRoom(db, 'r-locks');
  const reconstructed = engineStateFromRoom(room);
  assert.deepEqual(reconstructed.lockedCells, engineState.lockedCells);
  assert.deepEqual(reconstructed.lockInventory, engineState.lockInventory);
});

test('setReady marks a slot ready', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, { roomId: 'r6', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await setReady(db, 'r6', 0, true);
  const r = await readRoom(db, 'r6');
  assert.equal(r.ready[0], true);
});

test('markReadyAndMaybeStart starts live room and creates first deadline only after both slots are ready', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, {
    roomId: 'r-ready',
    mode: 'friend-live',
    players: PLAYERS,
    settings: { timelimit: true, botTime: 20 },
    engineState,
    serverTimestamp: 1000,
  });

  await markReadyAndMaybeStart(db, 'r-ready', 0, 2000);
  let room = await readRoom(db, 'r-ready');
  assert.equal(room.status, STATUS.WAITING);
  assert.equal(room.turnDeadlineMs ?? null, null);
  assert.equal(room.ready[0], true);
  assert.equal(room.ready[1], false);

  await markReadyAndMaybeStart(db, 'r-ready', 1, 3000);
  room = await readRoom(db, 'r-ready');
  assert.equal(room.status, STATUS.PLAYING);
  assert.equal(room.turnDeadlineMs, 23_000);
  assert.equal(room.ready[0], true);
  assert.equal(room.ready[1], true);
});

test('leaveRoom clears users/{uid}/activeRoom', async () => {
  const db = makeMockDb();
  const engineState = fakeEngineState();
  await createRoom(db, { roomId: 'r7', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await leaveRoom(db, 'r7', 'a');
  assert.equal(db._data.users.a.activeRoom ?? null, null);
});

test('setPlayerSubscriptionId writes under room players slot', async () => {
  const db = makeMockDb();
  await createRoom(db, { roomId: 'r8', mode: 'friend-live', players: PLAYERS, settings: {}, engineState: fakeEngineState(), serverTimestamp: 1000 });
  await setPlayerSubscriptionId(db, 'r8', 1, 'sub-1');
  assert.equal(db._data.rooms.r8.players[1].oneSignalSubId, 'sub-1');
});

test('setSettings writes room settings without touching version', async () => {
  const db = makeMockDb();
  await createRoom(db, { roomId: 'r-settings', mode: 'friend-live', players: PLAYERS, settings: { timelimit: true }, engineState: fakeEngineState(), serverTimestamp: 1000 });
  await setSettings(db, 'r-settings', { timelimit: false, botTime: 30 });
  assert.deepEqual(db._data.rooms['r-settings'].settings, { timelimit: false, botTime: 30 });
  assert.equal(db._data.rooms['r-settings'].version, 1);
});

test('setLivePreview writes and clears sanitized preview payload', async () => {
  const db = makeMockDb();
  await createRoom(db, { roomId: 'r9', mode: 'friend-live', players: PLAYERS, settings: {}, engineState: fakeEngineState(), serverTimestamp: 1000 });
  await setLivePreview(db, 'r9', { slot: 0, tiles: [{ r: 4, c: 5, letter: 'א', val: 1 }] });
  assert.equal(db._data.rooms.r9.livePreview.slot, 0);
  assert.deepEqual(db._data.rooms.r9.livePreview.tiles[0], { r: 4, c: 5, letter: 'א', val: 1, isJoker: false });
  await setLivePreview(db, 'r9', { slot: 0, tiles: [] });
  assert.equal(db._data.rooms.r9.livePreview ?? null, null);
});
