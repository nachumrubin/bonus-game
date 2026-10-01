import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLiveWordPreview } from './liveWordPreview.js';
import { createEmptyBoard } from '../game/core/board.js';

const t = (r, c, letter, val) => ({ r, c, letter, val });
const dict = (...words) => (w) => words.includes(w);

test('no placed tiles → null', () => {
  assert.equal(computeLiveWordPreview({ board: createEmptyBoard(), placed: [] }), null);
});

test('opening move: word + base score, validity from the checker', () => {
  const p = computeLiveWordPreview({
    board: createEmptyBoard(), firstMove: true,
    placed: [t(4, 3, 'א', 1), t(4, 4, 'ו', 1), t(4, 5, 'ר', 2)],
    isWordValid: dict('אור'),
  });
  assert.deepEqual(p, { word: 'אור', words: ['אור'], score: 4, valid: true });
});

test('not in dictionary → valid:false (score still computed)', () => {
  const p = computeLiveWordPreview({
    board: createEmptyBoard(), firstMove: true,
    placed: [t(4, 3, 'ר', 2), t(4, 4, 'ו', 1)], isWordValid: dict('אור'),
  });
  assert.equal(p.valid, false);
  assert.equal(p.word, 'רו');
});

test('no checker (dictionary not loaded) → valid:null', () => {
  const p = computeLiveWordPreview({ board: createEmptyBoard(), firstMove: true, placed: [t(0, 0, 'א', 1), t(0, 1, 'ב', 3)] });
  assert.equal(p.valid, null);
  assert.equal(p.score, 4);
});

test('extends a committed word and counts its letters (matches engine scoreMove)', () => {
  const board = createEmptyBoard();
  board[4][4] = { letter: 'ו', val: 1 };
  board[4][5] = { letter: 'ר', val: 2 };
  const p = computeLiveWordPreview({ board, placed: [t(4, 3, 'א', 1)], isWordValid: dict('אור') });
  assert.equal(p.word, 'אור');
  assert.equal(p.score, 4);
});

test('illegal shapes → null: gap, not collinear, disconnected, single letter', () => {
  const board = createEmptyBoard();
  board[0][0] = { letter: 'ב', val: 3 };
  const cases = [
    [t(4, 3, 'א', 1), t(4, 5, 'ב', 3)],          // gap (first move)
    [t(4, 3, 'א', 1), t(5, 4, 'ב', 3)],          // not in one line
  ];
  for (const placed of cases) assert.equal(computeLiveWordPreview({ board: createEmptyBoard(), firstMove: true, placed }), null);
  assert.equal(computeLiveWordPreview({ board, placed: [t(6, 6, 'א', 1), t(6, 7, 'ב', 3)] }), null); // not connected
  assert.equal(computeLiveWordPreview({ board: createEmptyBoard(), firstMove: true, placed: [t(4, 4, 'א', 1)] }), null);
});

test('bingo: all 8 rack tiles add the bonus', () => {
  const placed = 'אבגדהוזח'.split('').map((ch, i) => t(4, i + 1, ch, 1));
  const p = computeLiveWordPreview({ board: createEmptyBoard(), firstMove: true, placed });
  assert.equal(p.score, 8 + 50);
});
