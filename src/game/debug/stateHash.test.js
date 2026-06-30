import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardCellsString, boardHash, boardTileCount, compactSnapshot, hashState } from './stateHash.js';

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

test('boardTileCount includes bonus board tiles', () => {
  const bonusBoard = new Map([['-1,1', { letter: 'א', val: 1 }], ['10,5', { letter: 'ב', val: 3 }]]);
  assert.equal(boardTileCount(board2d(), bonusBoard), 4, '2 main-grid + 2 bonus-square tiles');
  assert.equal(boardTileCount(board2d()), 2, 'omitted bonusBoard keeps original count');
});

test('boardHash changes when a bonus board tile is added', () => {
  const bonusBoard = new Map([['-1,1', { letter: 'א', val: 1 }]]);
  assert.notEqual(boardHash(board2d(), bonusBoard), boardHash(board2d()),
    'bonus square tile must shift the hash');
});

test('compactSnapshot counts bonus board tiles and reflects them in boardHash', () => {
  const bonusBoard = new Map([['-1,1', { letter: 'א', val: 1 }]]);
  const base = {
    status: 'playing', currentTurnSlot: 0, turnNumber: 1,
    players: {}, scores: { 0: 0, 1: 0 }, racks: { 0: [], 1: [] },
    board: board2d(), bag: [],
  };
  const withBonus = compactSnapshot({ ...base, bonusBoard });
  const withoutBonus = compactSnapshot({ ...base, bonusBoard: new Map() });
  assert.equal(withBonus.boardTileCount, 3, '2 main + 1 bonus square tile');
  assert.equal(withoutBonus.boardTileCount, 2, 'empty bonus board = main-only count');
  assert.notEqual(withBonus.boardHash, withoutBonus.boardHash,
    'bonus square tile must be reflected in the board hash');
});
