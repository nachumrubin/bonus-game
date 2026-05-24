import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import * as roomService from './roomService.js';
import { createInitialState } from '../core/gameEngine.js';
import {
  listAsyncSessions, watchAsyncSessions, dismissForUid,
  summarizeForUid, hoursSince,
} from './asyncSessionService.js';

const ME    = { uid: 'me',  displayName: 'נחום' };
const OPP   = { uid: 'opp', displayName: 'דני'  };
const OPP2  = { uid: 'opp2', displayName: 'רות' };

function makeAsyncRoom(db, { roomId, players, currentTurnSlot = 0, status = 'playing', updatedAt = 1000 }) {
  const engineState = createInitialState({
    mode: 'random-async', tileBagSeed: roomId, players, startingSlot: 0, settings: {},
  });
  return roomService.createRoom(db, {
    roomId,
    mode: 'random-async',
    players,
    settings: {},
    engineState,
    serverTimestamp: updatedAt,
  }).then(async () => {
    await db.ref(`rooms/${roomId}`).update({ status, currentTurnSlot, updatedAt });
  });
}

test('listAsyncSessions: returns empty when no index entries', async () => {
  const db = makeMockDb();
  assert.deepEqual(await listAsyncSessions(db, ME.uid), []);
});

test('listAsyncSessions: returns active rooms with slot/opponent info', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, {
    roomId: 'r1',
    players: { 0: { ...ME }, 1: { ...OPP } },
    currentTurnSlot: 0, status: 'playing',
  });
  const list = await listAsyncSessions(db, ME.uid);
  assert.equal(list.length, 1);
  assert.equal(list[0].roomId, 'r1');
  assert.equal(list[0].mySlot, 0);
  assert.equal(list[0].opponentName, 'דני');
  assert.equal(list[0].isMyTurn, true);
});

test('listAsyncSessions: sorts my-turn first, then by lastUpdated desc', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'theirs-old',  players: { 0: { ...ME }, 1: { ...OPP } },  currentTurnSlot: 1, updatedAt: 100  });
  await makeAsyncRoom(db, { roomId: 'mine-newer',  players: { 0: { ...ME }, 1: { ...OPP2 } }, currentTurnSlot: 0, updatedAt: 200  });
  await makeAsyncRoom(db, { roomId: 'theirs-new',  players: { 0: { ...OPP }, 1: { ...ME } },  currentTurnSlot: 0, updatedAt: 300  });
  await makeAsyncRoom(db, { roomId: 'mine-older',  players: { 0: { ...OPP2 }, 1: { ...ME } }, currentTurnSlot: 1, updatedAt: 50   });

  const list = await listAsyncSessions(db, ME.uid);
  assert.deepEqual(list.map(s => s.roomId), [
    'mine-newer',  // my turn, newest
    'mine-older',  // my turn, older
    'theirs-new',  // their turn, newest
    'theirs-old',  // their turn, older
  ]);
});

test('listAsyncSessions: filters out completed/abandoned rooms', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'live-room', players: { 0: { ...ME }, 1: { ...OPP } }, status: 'playing' });
  await makeAsyncRoom(db, { roomId: 'done',      players: { 0: { ...ME }, 1: { ...OPP } }, status: 'completed' });
  await makeAsyncRoom(db, { roomId: 'gone',      players: { 0: { ...ME }, 1: { ...OPP } }, status: 'abandoned' });
  const list = await listAsyncSessions(db, ME.uid);
  assert.deepEqual(list.map(s => s.roomId), ['live-room']);
});

test('listAsyncSessions: skips entries where the room no longer exists', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'alive', players: { 0: { ...ME }, 1: { ...OPP } } });
  // Manually inject a stale index pointer that has no /rooms entry
  await db.ref(`users/${ME.uid}/asyncRooms/ghost`).set({ mode: 'random-async', createdAt: 1 });
  const list = await listAsyncSessions(db, ME.uid);
  assert.deepEqual(list.map(s => s.roomId), ['alive']);
});

test('listAsyncSessions: skips entries where the user is not a participant', async () => {
  const db = makeMockDb();
  // Force-write a room where ME is not a player but the index points at it
  await db.ref('rooms/orphan').set({
    roomId: 'orphan', mode: 'random-async', status: 'playing',
    players: { 0: { ...OPP }, 1: { ...OPP2 } },
    currentTurnSlot: 0, updatedAt: 100,
  });
  await db.ref(`users/${ME.uid}/asyncRooms/orphan`).set({ mode: 'random-async', createdAt: 1 });
  assert.deepEqual(await listAsyncSessions(db, ME.uid), []);
});

test('summarizeForUid: returns null for completed rooms', () => {
  const r = {
    roomId: 'r', status: 'completed', mode: 'random-async',
    players: { 0: { uid: 'me' }, 1: { uid: 'opp' } },
  };
  assert.equal(summarizeForUid(r, 'me'), null);
});

test('summarizeForUid: returns null for non-participant', () => {
  const r = {
    roomId: 'r', status: 'playing', mode: 'random-async',
    players: { 0: { uid: 'a' }, 1: { uid: 'b' } },
    currentTurnSlot: 0,
  };
  assert.equal(summarizeForUid(r, 'me'), null);
});

test('hoursSince: returns Infinity for missing timestamp', () => {
  assert.equal(hoursSince(null, 100_000), Infinity);
});

test('hoursSince: computes elapsed hours', () => {
  const now = 100 * 60 * 60 * 1000;
  assert.equal(hoursSince(now - 24 * 60 * 60 * 1000, now), 24);
});

test('dismissForUid: removes only the calling user\'s index entry', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'shared', players: { 0: { ...ME }, 1: { ...OPP } } });
  await dismissForUid(db, ME.uid, 'shared');
  // ME's index now empty
  assert.deepEqual(await listAsyncSessions(db, ME.uid), []);
  // OPP's index still has it
  const oppList = await listAsyncSessions(db, OPP.uid);
  assert.equal(oppList.length, 1);
  // The room itself is untouched
  const room = await roomService.readRoom(db, 'shared');
  assert.equal(room.roomId, 'shared');
});

test('watchAsyncSessions fires on adds and removes', async () => {
  const db = makeMockDb();
  const fires = [];
  const off = watchAsyncSessions(db, ME.uid, (sessions) => fires.push(sessions.map(s => s.roomId)));

  // Add a room
  await makeAsyncRoom(db, { roomId: 'r1', players: { 0: { ...ME }, 1: { ...OPP } } });
  await new Promise(r => setTimeout(r, 5));
  // Remove via dismiss
  await dismissForUid(db, ME.uid, 'r1');
  await new Promise(r => setTimeout(r, 5));

  assert.ok(fires.length >= 2, `got ${fires.length} fires`);
  assert.ok(fires.some(f => f.includes('r1')));
  assert.equal(fires.at(-1).length, 0);
  off();
});

test('roomService.createRoom indexes async modes; setStatus(completed) clears index', async () => {
  const db = makeMockDb();
  await makeAsyncRoom(db, { roomId: 'r-clean', players: { 0: { ...ME }, 1: { ...OPP } } });
  assert.equal((await listAsyncSessions(db, ME.uid)).length, 1);
  await roomService.setStatus(db, 'r-clean', 'completed');
  assert.equal((await listAsyncSessions(db, ME.uid)).length, 0);
  assert.equal((await listAsyncSessions(db, OPP.uid)).length, 0);
});

test('roomService.createRoom does NOT index live modes', async () => {
  const db = makeMockDb();
  const players = { 0: { ...ME }, 1: { ...OPP } };
  const engineState = createInitialState({
    mode: 'random-live', tileBagSeed: 'r-live', players, startingSlot: 0, settings: {},
  });
  await roomService.createRoom(db, {
    roomId: 'r-live', mode: 'random-live', players, settings: {},
    engineState, serverTimestamp: 100,
  });
  // No index entry
  const idx = (await db.ref(`users/${ME.uid}/asyncRooms`).get()).val();
  assert.equal(idx, null);
});
