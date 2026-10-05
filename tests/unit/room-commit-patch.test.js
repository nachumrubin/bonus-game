// commitPatch / diffRoomForUpdate: bandwidth-lean room commits (October 2026).
// A commit writes only the changed fields + version as one atomic multi-path
// update; compare-and-set comes from the rooms rule (version must be +1),
// which the mock DB mirrors for rooms/<id> updates.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from '../../src/game/online/mockFirebase.js';
import { commitPatch, diffRoomForUpdate } from '../../src/game/online/roomService.js';

const base = () => ({
  roomId: 'r', schemaVersion: 2, version: 7, currentTurnSlot: 0, turnNumber: 5,
  scores: { 0: 10, 1: 20 },
  board: Array.from({ length: 100 }, (_, i) => (i === 44 ? { letter: 'א', val: 1, isJoker: false } : null)),
  moveHistory: [{ slot: 1, ts: 1, words: ['אב'], score: 4 }],
  racks: { 0: ['ב', 'ג'], 1: ['ד'] },
  bag: ['ה', 'ו', 'ז'],
  activeBoosts: [{ slot: 0, boostId: 'free_tile_swap' }],
  settings: { timelimit: true, botTime: 20 },
  lastMove: { slot: 1, ts: 1 },
});

test('diff: only changed fields and children, always with version', () => {
  const b = base();
  const n = structuredClone(b);
  n.version = 8;
  n.board[45] = { letter: 'ב', val: 3, isJoker: false };
  n.moveHistory.push({ slot: 0, ts: 2, words: ['אב'], score: 4 });
  n.scores[0] = 14;
  n.currentTurnSlot = 1;
  n.turnNumber = 6;
  n.lastMove = { slot: 0, ts: 2 };
  n.activeBoosts = [];
  const d = diffRoomForUpdate(b, n);
  assert.deepEqual(Object.keys(d).sort(), [
    'activeBoosts/0', 'board/45', 'currentTurnSlot', 'lastMove', 'moveHistory/1', 'scores/0', 'turnNumber', 'version',
  ]);
  assert.equal(d['activeBoosts/0'], null, 'removed entries are deleted');
  assert.equal(d.version, 8);
});

test('diff: key order and null≡missing do not create spurious writes', () => {
  const b = base();
  const n = { ...structuredClone(b), version: 8, settings: { botTime: 20, timelimit: true } };
  delete n.board; // board absent vs array of nulls + one tile → real change
  const n2 = { ...structuredClone(b), version: 8, settings: { botTime: 20, timelimit: true } };
  assert.deepEqual(Object.keys(diffRoomForUpdate(b, n2)), ['version']);
  assert.ok('board' in diffRoomForUpdate(b, n));
});

test('commitPatch: writes a small patch, result room reflects it, no aliasing', async () => {
  const db = makeMockDb();
  await db.ref('rooms/r').set(base());
  const local = { entry: { slot: 0, ts: 2, scoringDeferred: true } };
  const res = await commitPatch(db, 'r', 7, base(), () => ({ lastMove: local.entry, currentTurnSlot: 1 }));
  assert.equal(res.committed, true);
  assert.equal(res.writtenPaths, 3, 'lastMove + currentTurnSlot + version');
  const stored = (await db.ref('rooms/r').get()).val();
  assert.equal(stored.version, 8);
  assert.equal(stored.currentTurnSlot, 1);
  assert.deepEqual(stored.bag, ['ה', 'ו', 'ז'], 'untouched fields survive');
  local.entry.scoringDeferred = false;
  assert.equal(res.room.lastMove.scoringDeferred, true, 'returned room is a copy, not a live reference');
});

test('commitPatch: a stale base is rejected (version compare-and-set) without writing', async () => {
  const db = makeMockDb();
  await db.ref('rooms/r').set({ ...base(), version: 9, currentTurnSlot: 1 }); // someone else moved on
  const res = await commitPatch(db, 'r', 7, base(), () => ({ currentTurnSlot: 0, scores: { 0: 999, 1: 20 } }));
  assert.equal(res.committed, false);
  const stored = (await db.ref('rooms/r').get()).val();
  assert.equal(stored.version, 9);
  assert.equal(stored.scores[0], 10, 'nothing from the rejected write landed');
});

test('commitPatch: falls back to a transaction when the base copy does not match', async () => {
  const db = makeMockDb();
  await db.ref('rooms/r').set(base());
  const res = await commitPatch(db, 'r', 7, { ...base(), version: 6 }, (cur) => ({ turnNumber: cur.turnNumber + 1 }));
  assert.equal(res.committed, true);
  assert.equal((await db.ref('rooms/r').get()).val().turnNumber, 6);
});
