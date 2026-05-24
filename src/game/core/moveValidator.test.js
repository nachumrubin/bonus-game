import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyBoard, setCommittedTile } from './board.js';
import { validateMove, isCollinear, hasGaps, isConnected, placedOnBonusSquare } from './moveValidator.js';

function makeState({ firstMove = false } = {}) {
  return { board: createEmptyBoard(), bonusBoard: new Map(), firstMove };
}

const T = (letter, val = 1) => ({ letter, val });

test('isCollinear: single tile is trivially collinear', () => {
  assert.equal(isCollinear([{ r: 4, c: 4 }]), true);
});

test('isCollinear: tiles in same row are collinear', () => {
  assert.equal(isCollinear([{ r: 4, c: 1 }, { r: 4, c: 2 }, { r: 4, c: 3 }]), true);
});

test('isCollinear: tiles in same column are collinear', () => {
  assert.equal(isCollinear([{ r: 1, c: 4 }, { r: 2, c: 4 }, { r: 3, c: 4 }]), true);
});

test('isCollinear: scattered tiles are not collinear', () => {
  assert.equal(isCollinear([{ r: 1, c: 1 }, { r: 2, c: 2 }]), false);
});

test('hasGaps: contiguous row has no gaps', () => {
  const s = makeState();
  assert.equal(hasGaps(s, [{ r: 4, c: 1 }, { r: 4, c: 2 }, { r: 4, c: 3 }]), false);
});

test('hasGaps: row with empty middle cell has gaps', () => {
  const s = makeState();
  assert.equal(hasGaps(s, [{ r: 4, c: 1 }, { r: 4, c: 3 }]), true);
});

test('hasGaps: gap is filled by a committed tile', () => {
  const s = makeState();
  setCommittedTile(s, 4, 2, T('א'));
  assert.equal(hasGaps(s, [{ r: 4, c: 1 }, { r: 4, c: 3 }]), false);
});

test('isConnected: first move is always connected', () => {
  const s = makeState({ firstMove: true });
  assert.equal(isConnected(s, [{ r: 4, c: 4 }]), true);
});

test('isConnected: second move requires neighbour', () => {
  const s = makeState();
  assert.equal(isConnected(s, [{ r: 4, c: 4 }]), false);
  setCommittedTile(s, 4, 5, T('א'));
  assert.equal(isConnected(s, [{ r: 4, c: 4 }]), true);
});

test('placedOnBonusSquare: detects placement on a bonus position', () => {
  // BDEFS includes {br:-1,bc:1} as a top bonus
  assert.ok(placedOnBonusSquare([{ r: -1, c: 1, letter: 'א', val: 1 }]));
  assert.equal(placedOnBonusSquare([{ r: 5, c: 5, letter: 'א', val: 1 }]), null);
});

test('validateMove rejects empty move', () => {
  const s = makeState({ firstMove: true });
  assert.equal(validateMove(s, []).reason, 'empty-move');
});

test('validateMove rejects non-collinear', () => {
  const s = makeState({ firstMove: true });
  const r = validateMove(s, [{ r: 1, c: 1 }, { r: 2, c: 2 }]);
  assert.equal(r.reason, 'not-collinear');
});

test('validateMove rejects gaps', () => {
  const s = makeState({ firstMove: true });
  const r = validateMove(s, [{ r: 4, c: 1 }, { r: 4, c: 3 }]);
  assert.equal(r.reason, 'has-gaps');
});

test('validateMove rejects first move on bonus square', () => {
  const s = makeState({ firstMove: true });
  // BDEFS has a top slot at (-1, 1)
  const r = validateMove(s, [{ r: -1, c: 1, letter: 'א', val: 1 }, { r: 0, c: 1, letter: 'ב', val: 3 }]);
  assert.equal(r.reason, 'first-move-on-bonus');
});

test('validateMove rejects disconnected non-first move', () => {
  const s = makeState();
  setCommittedTile(s, 0, 0, T('א'));
  const r = validateMove(s, [{ r: 5, c: 5, letter: 'ב', val: 3 }]);
  assert.equal(r.reason, 'not-connected');
});

test('validateMove accepts a valid first move', () => {
  const s = makeState({ firstMove: true });
  const r = validateMove(s, [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }]);
  assert.equal(r.ok, true);
});

test('validateMove accepts a valid second move connected to existing tile', () => {
  const s = makeState();
  setCommittedTile(s, 4, 4, T('א'));
  const r = validateMove(s, [{ r: 4, c: 5, letter: 'ב', val: 3 }, { r: 4, c: 6, letter: 'ג', val: 5 }]);
  assert.equal(r.ok, true);
});
