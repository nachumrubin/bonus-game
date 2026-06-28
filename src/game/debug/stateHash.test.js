import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardCellsString, boardHash, compactSnapshot, hashState } from './stateHash.js';

// A 2D board and the equivalent flat board for the same occupied cells.
function board2d() {
  const b = Array.from({ length: 10 }, () => Array(10).fill(null));
  b[4][4] = { letter: 'ש', val: 1 };
  b[4][5] = { letter: 'ל', val: 3, isJoker: true };
  return b;
}
function boardFlat() {
  const f = new Array(100).fill(null);
  f[44] = { letter: 'ש', val: 1 };
  f[45] = { letter: 'ל', val: 3, isJoker: true };
  return f;
}

test('boardHash is identical for equivalent 2D and flat boards', () => {
  assert.equal(boardCellsString(board2d()), boardCellsString(boardFlat()));
  assert.equal(boardHash(board2d()), boardHash(boardFlat()));
});

test('boardHash ignores val but reflects letter, position and joker', () => {
  const a = board2d();
  const b = board2d();
  b[4][4] = { letter: 'ש', val: 99 }; // val change only
  assert.equal(boardHash(a), boardHash(b), 'val does not affect the hash');
  b[4][4] = { letter: 'ת', val: 1 };  // letter change
  assert.notEqual(boardHash(a), boardHash(b), 'letter change changes the hash');
});

test('empty board hashes to the empty-cells hash', () => {
  assert.equal(boardCellsString(null), '');
  assert.equal(boardHash([]), boardHash(null));
});

test('compactSnapshot tolerates numeric and string slot keys', () => {
  const engine = {
    status: 'playing', currentTurnSlot: 1, turnNumber: 7,
    players: { 0: { uid: 'u0' }, 1: { uid: 'u1' } },
    scores: { 0: 30, 1: 44 }, racks: { 0: ['א','ב'], 1: ['ג'] },
    board: board2d(), bag: new Array(41).fill('א'),
    lastMove: { slot: 1, score: 14 },
  };
  const room = {
    status: 'playing', currentTurnSlot: 1, turnNumber: 7,
    players: { '0': { uid: 'u0' }, '1': { uid: 'u1' } },
    scores: { '0': 30, '1': 44 }, racks: { '0': ['א','ב'], '1': ['ג'] },
    board: boardFlat(), bag: new Array(41).fill('א'),
    lastMove: { slot: 1, score: 14 },
  };
  const c = compactSnapshot(engine);
  assert.equal(c.currentTurnUserId, 'u1');
  assert.equal(c.hostScore, 30);
  assert.equal(c.guestScore, 44);
  assert.equal(c.hostTilesCount, 2);
  assert.equal(c.guestTilesCount, 1);
  assert.equal(c.tileBagCount, 41);
  // Engine state and the equivalent room doc produce the same substantive hash.
  assert.equal(hashState(c), hashState(compactSnapshot(room)));
});

test('hashState changes when a substantive field changes, ignores lastMove', () => {
  const base = {
    status: 'playing', currentTurnSlot: 0, turnNumber: 3,
    players: { 0: { uid: 'a' }, 1: { uid: 'b' } },
    scores: { 0: 10, 1: 5 }, racks: { 0: ['א'], 1: ['ב'] },
    board: board2d(), bag: new Array(50).fill('א'),
  };
  const h = hashState(base);
  assert.equal(h, hashState({ ...base, lastMove: { score: 99 } }), 'lastMove does not affect hash');
  assert.notEqual(h, hashState({ ...base, scores: { 0: 11, 1: 5 } }), 'score change affects hash');
  assert.notEqual(h, hashState({ ...base, turnNumber: 4 }), 'turn change affects hash');
});
