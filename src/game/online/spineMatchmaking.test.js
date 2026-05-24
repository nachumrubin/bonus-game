// Two-client matchmaking simulation against the in-memory mock Firebase.
// Both clients share the same `db` (same reference), so a write by one
// fires the other's watchers — exactly how the real Firebase behaves
// across two browsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import { startMatchmaking, createRoomForPair } from './spineMatchmaking.js';
import { PATH } from './schema.js';

test('createRoomForPair: writes a v2 room with playing status and stamps activeRoom for both', async () => {
  const db = makeMockDb();
  const result = await createRoomForPair({
    db,
    mine:   { uid: 'a', displayName: 'A', avatar: null, joinedAt: 100 },
    theirs: { uid: 'b', displayName: 'B', avatar: null, joinedAt: 200 },
    mode: 'random-live',
    serverTimestamp: 1000,
    startingSlot: 1,
  });
  assert.ok(result.roomId);
  const room = db._data.rooms[result.roomId];
  assert.equal(room.schemaVersion, 2);
  assert.equal(room.status, 'waiting');
  assert.equal(room.players[0].uid, 'a');
  assert.equal(room.players[1].uid, 'b');
  assert.equal(room.currentTurnSlot, 1);
  assert.equal(db._data.users.a.activeRoom, result.roomId);
  assert.equal(db._data.users.b.activeRoom, result.roomId);
});

test('startMatchmaking: solo client joins queue and waits (no match yet)', async () => {
  const db = makeMockDb();
  let matched = null;
  const ctl = startMatchmaking({
    db, uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice', avatar: null, rating: 1000 },
    now: () => 100,
  });
  ctl.onMatched(p => { matched = p; });
  // Let microtasks flush
  await new Promise(r => setTimeout(r, 10));
  assert.equal(matched, null);
  // Verify alice is in the queue
  assert.ok(db._data.matchmakingQueue['random-live'].alice);
  await ctl.cancel();
});

test('startMatchmaking: two clients pair and both receive matched notifications', async () => {
  const db = makeMockDb();
  let aliceMatched = null;
  let bobMatched = null;
  let counter = 0;
  const now = () => ++counter;

  const aliceCtl = startMatchmaking({
    db, uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice', avatar: null, rating: 1000 },
    now,
  });
  aliceCtl.onMatched(p => { aliceMatched = p; });

  // Wait a moment for alice to settle in
  await new Promise(r => setTimeout(r, 5));

  const bobCtl = startMatchmaking({
    db, uid: 'bob', mode: 'random-live',
    profile: { displayName: 'Bob', avatar: null, rating: 1000 },
    now,
  });
  bobCtl.onMatched(p => { bobMatched = p; });

  // Allow async tryPair to flush
  await new Promise(r => setTimeout(r, 50));

  assert.ok(aliceMatched, 'alice should have been matched');
  assert.ok(bobMatched,   'bob should have been matched');
  assert.equal(aliceMatched.room.roomId, bobMatched.room.roomId);
  // mySlot should differ — one is 0, the other is 1
  assert.notEqual(aliceMatched.mySlot, bobMatched.mySlot);
  // Queue should be empty for this mode
  const remaining = db._data.matchmakingQueue['random-live'] ?? {};
  assert.equal(Object.keys(remaining).length, 0);
});

test('startMatchmaking: cancel removes the user from the queue', async () => {
  const db = makeMockDb();
  const ctl = startMatchmaking({
    db, uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice' }, now: () => 1,
  });
  await new Promise(r => setTimeout(r, 5));
  assert.ok(db._data.matchmakingQueue['random-live'].alice);
  await ctl.cancel();
  await new Promise(r => setTimeout(r, 5));
  const remaining = db._data.matchmakingQueue['random-live'] ?? {};
  assert.equal(remaining.alice ?? null, null);
});

test('startMatchmaking: late onMatched listener still receives the notification if registered before pairing', async () => {
  const db = makeMockDb();
  const aliceCtl = startMatchmaking({
    db, uid: 'alice', mode: 'random-live',
    profile: { displayName: 'Alice' }, now: () => 1,
  });
  let aliceMatched = null;
  aliceCtl.onMatched(p => { aliceMatched = p; });
  await new Promise(r => setTimeout(r, 5));
  const bobCtl = startMatchmaking({
    db, uid: 'bob', mode: 'random-live',
    profile: { displayName: 'Bob' }, now: () => 2,
  });
  let bobMatched = null;
  bobCtl.onMatched(p => { bobMatched = p; });
  await new Promise(r => setTimeout(r, 50));
  assert.ok(aliceMatched);
  assert.ok(bobMatched);
});
