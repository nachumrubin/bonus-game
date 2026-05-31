import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from './gameEngine.js';
import {
  applyPass, applyExchange, applyResign, applyMove, isGameOver, winnerSlot,
  nextSlot, canClaimStallEnd, LEGACY_PASS_GAME_OVER_THRESHOLD, STALL_CLAIM_THRESHOLD,
} from './turnManager.js';

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

test(`isGameOver returns true after ${LEGACY_PASS_GAME_OVER_THRESHOLD} consecutive scoreless turns`, () => {
  const s = makeState();
  for (let i = 0; i < LEGACY_PASS_GAME_OVER_THRESHOLD; i++) applyPass(s);
  assert.equal(isGameOver(s), true);
});

test('isGameOver returns false while passCount is still below the threshold', () => {
  const s = makeState();
  for (let i = 0; i < LEGACY_PASS_GAME_OVER_THRESHOLD - 1; i++) applyPass(s);
  assert.equal(isGameOver(s), false);
});

test('exchanges count as scoreless turns toward game-over', () => {
  const s = makeState();
  for (let i = 0; i < LEGACY_PASS_GAME_OVER_THRESHOLD; i++) {
    // Force a known letter into the active player's rack each time, since
    // `applyExchange` swaps the letter back into the bag and draws a random
    // replacement.
    const slot = s.currentTurnSlot;
    s.racks[slot] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
    applyExchange(s, ['א']);
  }
  assert.equal(isGameOver(s), true);
});

test('mixed pass + exchange counts toward game-over', () => {
  const s = makeState();
  applyPass(s);                                             // 1
  s.racks[s.currentTurnSlot] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  applyExchange(s, ['א']);                                  // 2
  applyPass(s);                                             // 3
  s.racks[s.currentTurnSlot] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  applyExchange(s, ['א']);                                  // 4
  assert.equal(isGameOver(s), true);
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

test('applyExchange returns tiles to bag, draws replacements, advances turn, increments passCount', () => {
  const s = makeState();
  s.currentTurnSlot = 0;
  const before = s.bag.length;
  // Force known rack contents
  s.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  applyExchange(s, ['א', 'ב']);
  assert.equal(s.racks[0].length, 8);
  assert.equal(s.bag.length, before); // returned 2, drew 2 → net zero
  assert.equal(s.currentTurnSlot, 1);
  assert.equal(s.passCount, 1);       // counts as a scoreless turn
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

test('canClaimStallEnd: false until passCount reaches STALL_CLAIM_THRESHOLD', () => {
  const s = makeState();
  s.scores = { 0: 100, 1: 5 };
  s.passCount = STALL_CLAIM_THRESHOLD - 1;
  assert.equal(canClaimStallEnd(s, 0), false);
  s.passCount = STALL_CLAIM_THRESHOLD;
  assert.equal(canClaimStallEnd(s, 0), true);
});

test('canClaimStallEnd: false for the trailing player', () => {
  const s = makeState();
  s.scores = { 0: 100, 1: 5 };
  s.passCount = STALL_CLAIM_THRESHOLD;
  assert.equal(canClaimStallEnd(s, 1), false);
});

test('canClaimStallEnd: false on a tied score (neither side gets unilateral claim)', () => {
  const s = makeState();
  s.scores = { 0: 50, 1: 50 };
  s.passCount = STALL_CLAIM_THRESHOLD;
  assert.equal(canClaimStallEnd(s, 0), false);
  assert.equal(canClaimStallEnd(s, 1), false);
});

test('canClaimStallEnd: false after the game has already ended', () => {
  const s = makeState();
  s.scores = { 0: 100, 1: 5 };
  s.passCount = STALL_CLAIM_THRESHOLD;
  s.status = 'completed';
  assert.equal(canClaimStallEnd(s, 0), false);
});
