import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBonusActivation, resolveMiniGameResult, resolveWheelResult } from './bonusResolver.js';

test('B2 (auto, +20) produces an auto_extra_score entry', () => {
  const r = resolveBonusActivation({ bonusType: 'B2', slot: 0, turnNumber: 3 });
  assert.equal(r.miniGamePending, false);
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.entries[0], {
    slot: 0,
    boostId: 'auto_extra_score',
    payload: { extra: 20 },
    turnNumber: 3,
  });
});

test('B4 (auto, +1) and B9 (auto, +25) produce correct extras', () => {
  assert.equal(resolveBonusActivation({ bonusType: 'B4', slot: 1, turnNumber: 1 }).entries[0].payload.extra, 1);
  assert.equal(resolveBonusActivation({ bonusType: 'B9', slot: 1, turnNumber: 1 }).entries[0].payload.extra, 25);
});

test('B5 (extra turn) queues an extra_turn entry', () => {
  const r = resolveBonusActivation({ bonusType: 'B5', slot: 0, turnNumber: 4 });
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].boostId, 'extra_turn');
  assert.equal(r.entries[0].slot, 0);
});

test('B6 (×4 next) queues a multiply_next_turns entry with mult=4, turns=1', () => {
  const r = resolveBonusActivation({ bonusType: 'B6', slot: 1, turnNumber: 5 });
  assert.equal(r.entries[0].boostId, 'multiply_next_turns');
  assert.deepEqual(r.entries[0].payload, { multiplier: 4, turnsRemaining: 1 });
});

test('B7 (×2 next 2 turns) queues mult=2, turns=2', () => {
  const r = resolveBonusActivation({ bonusType: 'B7', slot: 0, turnNumber: 6 });
  assert.deepEqual(r.entries[0].payload, { multiplier: 2, turnsRemaining: 2 });
});

test('B1 (mini-game) returns miniGamePending with key', () => {
  const r = resolveBonusActivation({ bonusType: 'B1', slot: 0, turnNumber: 1 });
  assert.equal(r.miniGamePending, true);
  assert.equal(r.miniGameKey, 'b1_unscramble_or_fillmiddle');
  assert.equal(r.entries.length, 0);
});

test('B13 (wheel) returns wheelPending with key', () => {
  const r = resolveBonusActivation({ bonusType: 'B13', slot: 1, turnNumber: 7 });
  assert.equal(r.wheelPending, true);
  assert.equal(r.miniGameKey, 'b13_wheel_of_fortune');
});

test('unknown bonus type returns an error', () => {
  const r = resolveBonusActivation({ bonusType: 'BX', slot: 0, turnNumber: 1 });
  assert.ok(r.error);
});

test('mini-game success awards earnedPts as auto_extra_score', () => {
  const r = resolveMiniGameResult({ slot: 0, turnNumber: 2, success: true, earnedPts: 40 });
  assert.equal(r.entries[0].payload.extra, 40);
});

test('mini-game failure awards nothing', () => {
  const r = resolveMiniGameResult({ slot: 0, turnNumber: 2, success: false, earnedPts: 40 });
  assert.equal(r.entries.length, 0);
});

test('wheel pts_50 outcome adds auto_extra_score +50', () => {
  const r = resolveWheelResult({ slot: 0, turnNumber: 3, outcomeId: 'pts_50' });
  assert.equal(r.entries[0].payload.extra, 50);
});

test('wheel cancel_boost outcome queues a cancel_next_opponent_bonus entry', () => {
  const r = resolveWheelResult({ slot: 0, turnNumber: 3, outcomeId: 'cancel_boost' });
  assert.equal(r.entries[0].boostId, 'cancel_next_opponent_bonus');
});

test('wheel double_2 outcome queues a multiply_next_turns mult=2 turns=2', () => {
  const r = resolveWheelResult({ slot: 0, turnNumber: 3, outcomeId: 'double_2' });
  assert.equal(r.entries[0].boostId, 'multiply_next_turns');
  assert.deepEqual(r.entries[0].payload, { multiplier: 2, turnsRemaining: 2 });
});

test('wheel timer_bonus outcome queues a timer_bonus entry with seconds=10', () => {
  const r = resolveWheelResult({ slot: 1, turnNumber: 4, outcomeId: 'timer_bonus' });
  assert.equal(r.entries[0].boostId, 'timer_bonus');
  assert.equal(r.entries[0].payload.seconds, 10);
});
