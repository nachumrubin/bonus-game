// Regression test for the empty-bag desync found by the live soak agents
// (October 2026, run 2026-10-01T18-21-19, game g3).
//
// Firebase never stores an empty array, so when the last tiles are drawn the
// room's `bag` key disappears. Before the fix:
//   1. onlineGameSession's watcher did `incoming.bag ?? state.bag`, so the
//      OTHER client kept its stale bag — and could then exchange/draw tiles
//      that no longer existed (tile duplication: 101 tiles in a 99-tile game).
//   2. engineStateFromRoom only copied `room.bag` when it was an array, so a
//      reconnect / forceResync / resume with an empty bag left the freshly
//      seeded FULL bag in the state.
//
// The mock DB runs with `emptyAsMissing` so it drops empty arrays like RTDB.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
import { CMD } from '../../src/events/commands.js';
import { makeMockDb } from '../../src/game/online/mockFirebase.js';
import { createRoom, readRoom, engineStateFromRoom } from '../../src/game/online/roomService.js';
import { createInitialState } from '../../src/game/core/gameEngine.js';
import { createOnlineGameSession } from '../../src/game/sessions/onlineGameSession.js';

const PLAYERS = {
  0: { uid: 'alice', displayName: 'Alice', avatar: null, joinedAt: 1 },
  1: { uid: 'bob',   displayName: 'Bob',   avatar: null, joinedAt: 2 },
};

const _origInfo = console.info;
console.info = () => {};

async function tick() { await new Promise(r => setImmediate(r)); }

async function setup(seed) {
  bus._reset();
  const db = makeMockDb({ emptyAsMissing: true });
  const engineState = createInitialState({ mode: 'friend-live', tileBagSeed: seed, players: PLAYERS, settings: {} });
  await createRoom(db, { roomId: 'room', mode: 'friend-live', players: PLAYERS, settings: {}, engineState, serverTimestamp: 1000 });
  await db.ref('rooms/room').update({ status: 'playing' });
  const room = await readRoom(db, 'room');
  const a = await createOnlineGameSession({ bus, db, room, mySlot: 0 });
  const b = await createOnlineGameSession({ bus, db, room, mySlot: 1 });
  a.start(); b.start();
  return { db, a, b };
}

test('mock emptyAsMissing: an empty bag is stored as a missing key', async () => {
  const db = makeMockDb({ emptyAsMissing: true });
  await db.ref('rooms/r').set({ bag: [], racks: { 0: ['א'], 1: [] }, version: 1 });
  const v = (await db.ref('rooms/r').get()).val();
  assert.equal(v.bag, undefined);
  assert.deepEqual(v.racks, { 0: ['א'] });
});

test('engineStateFromRoom: a room with no bag key has an EMPTY bag, not a fresh full one', () => {
  const st = createInitialState({ mode: 'friend-live', tileBagSeed: 'eb-1', players: PLAYERS, settings: {} });
  const room = { ...st, roomId: 'r', schemaVersion: 2, version: 9, board: [], bag: undefined };
  delete room.bag;
  const restored = engineStateFromRoom(room);
  assert.deepEqual(restored.bag, [], `expected empty bag, got ${restored.bag.length} tiles`);
});

test('watcher: when the bag empties on the server, the other client\'s bag empties too', async () => {
  const { db, a, b } = await setup('eb-2');
  const mover = a.state.currentTurnSlot === 0 ? a : b;
  const other = mover === a ? b : a;
  // The mover's client drew the last tiles (bag now empty) and passes; the
  // commit writes `bag: []`, which the database drops.
  mover.state.bag = [];
  mover.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(); await tick(); await tick();
  const room = await readRoom(db, 'room');
  assert.equal(room.bag, undefined, 'database dropped the empty bag');
  assert.equal(other.state.currentTurnSlot, room.currentTurnSlot, 'other client saw the pass');
  assert.deepEqual(other.state.bag, [], `other client must see an empty bag, still had ${other.state.bag.length}`);
});

test('watcher: with an empty server bag, the other client cannot exchange phantom tiles', async () => {
  const { db, a, b } = await setup('eb-3');
  const mover = a.state.currentTurnSlot === 0 ? a : b;
  const other = mover === a ? b : a;
  mover.state.bag = [];
  mover.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } });
  await tick(); await tick(); await tick();
  const before = await readRoom(db, 'room');
  const slot = other === a ? 0 : 1;
  const letter = other.state.racks[slot][0];
  try { other.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: [letter] } }); } catch { /* engine may throw */ }
  await tick(); await tick(); await tick();
  const after = await readRoom(db, 'room');
  const bagN = Array.isArray(after.bag) ? after.bag.length : 0;
  assert.equal(bagN, 0, 'no tiles may appear in the bag');
  assert.equal(after.version, before.version, 'the exchange must not commit');
});

test.after(() => { console.info = _origInfo; });

test('engineStateFromRoom: a player who spent every lock gets NO locks back on resync', () => {
  const st = createInitialState({ mode: 'friend-live', tileBagSeed: 'eb-4', players: PLAYERS, settings: {} });
  const room = { ...st, roomId: 'r', schemaVersion: 2, version: 9, board: [], lockInventory: { 1: [3, 5] } };
  const restored = engineStateFromRoom(room);
  assert.deepEqual(restored.lockInventory[0], [], 'slot 0 spent all locks — the dropped key means none left');
  assert.deepEqual(restored.lockInventory[1], [3, 5]);
});
