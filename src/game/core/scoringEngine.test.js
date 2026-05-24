import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyBoard, setCommittedTile } from './board.js';
import { getMainWord, getAllWords, scoreWord, scoreMove, BINGO_BONUS } from './scoringEngine.js';

function makeState() {
  return { board: createEmptyBoard(), bonusBoard: new Map() };
}

const tile = (letter, val) => ({ letter, val });

test('getMainWord: horizontal placement', () => {
  const s = makeState();
  const placed = [
    { r: 4, c: 4, letter: 'א', val: 1 },
    { r: 4, c: 5, letter: 'ב', val: 3 },
    { r: 4, c: 6, letter: 'ג', val: 5 },
  ];
  const w = getMainWord(s, placed);
  assert.equal(w.length, 3);
  assert.deepEqual(w.map(t => t.letter), ['א', 'ב', 'ג']);
});

test('getMainWord: extends through committed tiles on the same row', () => {
  const s = makeState();
  setCommittedTile(s, 4, 7, tile('ד', 3));
  const placed = [
    { r: 4, c: 4, letter: 'א', val: 1 },
    { r: 4, c: 5, letter: 'ב', val: 3 },
    { r: 4, c: 6, letter: 'ג', val: 5 },
  ];
  const w = getMainWord(s, placed);
  assert.deepEqual(w.map(t => t.letter), ['א', 'ב', 'ג', 'ד']);
  assert.deepEqual(w.map(t => t.ex), [false, false, false, true]);
});

test('getMainWord: vertical placement', () => {
  const s = makeState();
  const placed = [
    { r: 4, c: 4, letter: 'א', val: 1 },
    { r: 5, c: 4, letter: 'ב', val: 3 },
  ];
  const w = getMainWord(s, placed);
  assert.deepEqual(w.map(t => t.letter), ['א', 'ב']);
});

test('getAllWords: detects cross-words', () => {
  const s = makeState();
  // Existing column at c=5: ד at (3,5), ה at (5,5)
  setCommittedTile(s, 3, 5, tile('ד', 3));
  setCommittedTile(s, 5, 5, tile('ה', 4));
  // Player places horizontally across the gap, plus extends to one side
  const placed = [
    { r: 4, c: 4, letter: 'א', val: 1 },
    { r: 4, c: 5, letter: 'ב', val: 3 },
  ];
  const words = getAllWords(s, placed);
  // Main word horizontal: אב
  // Cross word vertical at c=5: ד-ב-ה
  assert.equal(words.length, 2);
  const texts = words.map(w => w.map(t => t.letter).join(''));
  assert.ok(texts.includes('אב'));
  assert.ok(texts.includes('דבה'));
});

test('getAllWords: dedups when single tile is the entire main word and a cross-word', () => {
  const s = makeState();
  // Two existing tiles around the placement point
  setCommittedTile(s, 4, 3, tile('ש', 3));
  setCommittedTile(s, 4, 5, tile('ם', 0)); // joker-like, val 0
  setCommittedTile(s, 3, 4, tile('א', 1));
  setCommittedTile(s, 5, 4, tile('ד', 3));
  const placed = [{ r: 4, c: 4, letter: 'ל', val: 2 }];
  const words = getAllWords(s, placed);
  // Should produce both horizontal (ש-ל-ם) and vertical (א-ל-ד), no dupes
  assert.equal(words.length, 2);
});

test('scoreWord: sums tile values', () => {
  const w = [{ val: 1 }, { val: 3 }, { val: 5 }];
  assert.equal(scoreWord(w), 9);
});

test('scoreMove: sums all words', () => {
  const words = [
    [{ val: 1 }, { val: 3 }],
    [{ val: 5 }, { val: 2 }],
  ];
  assert.equal(scoreMove(words, 2), 11);
});

test('scoreMove: adds bingo bonus when all 8 tiles played', () => {
  const words = [
    Array(8).fill(0).map(() => ({ val: 1 })),
  ];
  assert.equal(scoreMove(words, 8), 8 + BINGO_BONUS);
});

test('scoreMove: no bingo bonus for fewer tiles', () => {
  const words = [
    Array(7).fill(0).map(() => ({ val: 1 })),
  ];
  assert.equal(scoreMove(words, 7), 7);
});
