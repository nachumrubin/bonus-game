import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../core/gameEngine.js';
import { setCommittedTile } from '../core/board.js';
import { canMakeWord, tryPlaceWord, findAnchors, searchBotMove, DIFFICULTY } from './botSearch.js';

const acceptAll = () => true;

function fresh({ firstMove = true } = {}) {
  const s = createInitialState({
    mode: 'offline-solo',
    tileBagSeed: 'bot-test',
    players: { 0: { uid: 'a' }, 1: { uid: 'b' } },
  });
  s.firstMove = firstMove;
  return s;
}

test('canMakeWord: rack has the letters', () => {
  assert.equal(canMakeWord('שלום', ['ש','ל','ו','ם','א']), true);
});

test('canMakeWord: missing a letter returns false', () => {
  assert.equal(canMakeWord('שלום', ['ש','ל','ו','א']), false);
});

test('canMakeWord: joker fills a gap', () => {
  assert.equal(canMakeWord('שלום', ['ש','ל','ו','?','א']), true);
});

test('canMakeWord: each rack tile counts once (no double-count)', () => {
  // 'אא' needs two א — only one in the rack
  assert.equal(canMakeWord('אא', ['א','ב']), false);
});

test('tryPlaceWord: lays a word on an empty board horizontally', () => {
  const s = fresh();
  s.racks[0] = ['א','ב','ג','ד','ה','ו','ז','ח'];
  const placed = tryPlaceWord(s, 'אבג', 4, 4, 'H', 0);
  assert.ok(placed);
  assert.equal(placed.length, 3);
  assert.deepEqual(placed.map(p => p.letter), ['א','ב','ג']);
});

test('tryPlaceWord: returns null when off-board', () => {
  const s = fresh();
  s.racks[0] = ['א','ב','ג'];
  // Goes off the right edge: column 9 + 3 letters → 9,10,11 (10/11 are not bonus pos here)
  const placed = tryPlaceWord(s, 'אבג', 4, 9, 'H', 0);
  assert.equal(placed, null);
});

test('tryPlaceWord: walks through committed tile when letter matches', () => {
  const s = fresh({ firstMove: false });
  setCommittedTile(s, 4, 5, { letter: 'ב', val: 3 });
  s.racks[0] = ['א','ג'];
  const placed = tryPlaceWord(s, 'אבג', 4, 4, 'H', 0);
  assert.ok(placed);
  assert.equal(placed.length, 2); // only א and ג are placed; ב is the committed tile
  assert.deepEqual(placed.map(p => p.letter), ['א', 'ג']);
});

test('tryPlaceWord: rejects when committed letter mismatches', () => {
  const s = fresh({ firstMove: false });
  setCommittedTile(s, 4, 5, { letter: 'ת', val: 4 });
  s.racks[0] = ['א','ב','ג'];
  const placed = tryPlaceWord(s, 'אבג', 4, 4, 'H', 0);
  assert.equal(placed, null);
});

test('findAnchors: returns empty cells adjacent to committed tiles', () => {
  const s = fresh({ firstMove: false });
  setCommittedTile(s, 4, 4, { letter: 'א', val: 1 });
  const anchors = findAnchors(s);
  // The 4 orthogonal neighbours of (4,4) should be anchors
  const keys = anchors.map(a => `${a.r},${a.c}`).sort();
  assert.ok(keys.includes('3,4'));
  assert.ok(keys.includes('5,4'));
  assert.ok(keys.includes('4,3'));
  assert.ok(keys.includes('4,5'));
});

test('searchBotMove: first move places a candidate near the centre', () => {
  const s = fresh();
  s.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];
  s.currentTurnSlot = 1;
  const move = searchBotMove(s, 1, ['אב', 'גד'], acceptAll, { difficulty: DIFFICULTY.HARD });
  assert.ok(move);
  assert.ok(move.placed.length >= 2);
  // Should be near centre (row 5, columns near 5)
  assert.equal(move.placed[0].r, 5);
});

test('searchBotMove: returns null when rack cannot spell anything from the list', () => {
  const s = fresh();
  s.racks[1] = ['ת','ת','ת','ת','ת','ת','ת','ת']; // only ת
  s.currentTurnSlot = 1;
  const move = searchBotMove(s, 1, ['אב'], acceptAll, { difficulty: DIFFICULTY.HARD });
  assert.equal(move, null);
});

test('searchBotMove: finds a placement on the second move that touches an existing tile', () => {
  const s = fresh({ firstMove: false });
  // Pre-place 'ב' at (4,5) — bot must hook off it
  setCommittedTile(s, 4, 5, { letter: 'ב', val: 3 });
  s.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];
  s.currentTurnSlot = 1;
  const move = searchBotMove(s, 1, ['אבג'], acceptAll, { difficulty: DIFFICULTY.HARD });
  assert.ok(move);
  assert.equal(move.word, 'אבג');
  // Some placed tile must be orthogonally adjacent to the committed 'ב'
  const touchesCommitted = move.placed.some(p =>
    [[p.r - 1, p.c], [p.r + 1, p.c], [p.r, p.c - 1], [p.r, p.c + 1]]
      .some(([ar, ac]) => ar === 4 && ac === 5)
  );
  assert.ok(touchesCommitted, 'placement must connect to existing tile');
});

test('searchBotMove: HARD picks the highest-scoring move on the second turn', () => {
  const s = fresh({ firstMove: false });
  // Pre-place 'א' at (4,5) so both candidate words can hook off it
  setCommittedTile(s, 4, 5, { letter: 'א', val: 1 });
  s.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];
  s.currentTurnSlot = 1;
  // Both 'אב' (score 1+3=4) and 'אה' (1+4=5) can be played by extending right of 'א'.
  // HARD should choose 'אה' for higher score.
  const move = searchBotMove(s, 1, ['אב', 'אה'], acceptAll, { difficulty: DIFFICULTY.HARD });
  assert.ok(move);
  assert.equal(move.word, 'אה');
});
