import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from './gameEngine.js';
import { applyPass, applyExchange, applyResign, applyMove, isGameOver, winnerSlot, nextSlot } from './turnManager.js';

function makeState() {
  return createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'turn-test-seed',
    players: { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } },
  });
}

test('nextSlot toggles 0↔1', () => {
  assert.equal(nextSlot(0), 1);
  assert.equal(nextSlot(1), 0);
});

test('applyPass increments passCount and advances turn', () => {
  const s = makeState();
  s.currentTurnSlot = 0;
  applyPass(s);
  assert.equal(s.passCount, 1);
  assert.equal(s.currentTurnSlot, 1);
  assert.equal(s.turnNumber, 2);
});

test('isGameOver returns true after six consecutive passes', () => {
  const s = makeState();
  for (let i = 0; i < 6; i++) applyPass(s);
  assert.equal(isGameOver(s), true);
});

test('isGameOver returns false when status is still playing and passCount < 6', () => {
  const s = makeState();
  for (let i = 0; i < 5; i++) applyPass(s);
  assert.equal(isGameOver(s), false);
});

test('applyMove resets passCount, refills rack, advances turn', () => {
  const s = makeState();
  s.currentTurnSlot = 0;
  s.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  applyPass(s); // passCount 1
  s.currentTurnSlot = 0;
  applyMove(s, [{ r: 4, c: 4, letter: 'א', val: 1 }], 5);
  assert.equal(s.passCount, 0);
  assert.equal(s.scores[0], 5);
  assert.equal(s.firstMove, false);
  assert.equal(s.currentTurnSlot, 1);
  // Rack should have been topped back up to 8
  assert.equal(s.racks[0].length, 8);
});

test('applyExchange returns tiles to bag, draws replacements, advances turn', () => {
  const s = makeState();
  s.currentTurnSlot = 0;
  const before = s.bag.length;
  // Force known rack contents
  s.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  applyExchange(s, ['א', 'ב']);
  assert.equal(s.racks[0].length, 8);
  assert.equal(s.bag.length, before); // returned 2, drew 2 → net zero
  assert.equal(s.currentTurnSlot, 1);
});

test('applyExchange throws when the rack lacks a requested letter', () => {
  const s = makeState();
  s.currentTurnSlot = 0;
  s.racks[0] = ['א', 'ב'];
  assert.throws(() => applyExchange(s, ['ת']), /rack does not contain/);
});

test('applyResign sets status abandoned + abandonedBy', () => {
  const s = makeState();
  applyResign(s, 0);
  assert.equal(s.status, 'abandoned');
  assert.equal(s.abandonedBy, 0);
  assert.equal(isGameOver(s), true);
});

test('winnerSlot: highest score wins', () => {
  const s = makeState();
  s.scores = { 0: 50, 1: 30 };
  assert.equal(winnerSlot(s), 0);
  s.scores = { 0: 30, 1: 50 };
  assert.equal(winnerSlot(s), 1);
});

test('winnerSlot: tie returns null', () => {
  const s = makeState();
  s.scores = { 0: 40, 1: 40 };
  assert.equal(winnerSlot(s), null);
});

test('winnerSlot: abandonment hands the win to the other slot', () => {
  const s = makeState();
  s.scores = { 0: 100, 1: 5 };
  applyResign(s, 0);
  assert.equal(winnerSlot(s), 1);
});
