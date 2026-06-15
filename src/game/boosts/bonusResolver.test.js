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

// ── Mini-game branch coverage (GAP_REPORT item 6) ───────────────────
// Each mini-game bonus type returns miniGamePending + its own miniGameKey
// so the UI can route to the correct mini-game component. Previously only
// B1 was tested; the others (B3, B8, B10, B11, B12) were uncovered.

for (const [type, key] of [
  ['B3',  'b3_unscramble_medium'],
  ['B8',  'b8_crossword_60s'],
  ['B10', 'b10_crossing_words'],
  ['B11', 'b11_hidden_word'],
  ['B12', 'b12_honeycomb'],
  ['B14', 'b14_letter_spinner'],
]) {
  test(`${type} (mini-game) returns miniGamePending with key '${key}'`, () => {
    const r = resolveBonusActivation({ bonusType: type, slot: 0, turnNumber: 1 });
    assert.equal(r.miniGamePending, true,
      `${type} must be flagged as a pending mini-game (UI gates on this)`);
    assert.equal(r.miniGameKey, key,
      `${type} must point the UI at the '${key}' component`);
    assert.equal(r.entries.length, 0,
      `${type} must NOT queue activeBoosts entries until the mini-game resolves`);
  });
}

test('resolveMiniGameResult: success path applies regardless of which mini-game produced it', () => {
  // The result handler is shared across all mini-games — it only sees
  // { success, earnedPts }. Verify the conversion to auto_extra_score is
  // identical for sample earnings from each mini-game type.
  for (const earnedPts of [10, 25, 40, 50, 100]) {
    const r = resolveMiniGameResult({ slot: 0, turnNumber: 3, success: true, earnedPts });
    assert.equal(r.entries.length, 1, `success with earnedPts=${earnedPts}`);
    assert.equal(r.entries[0].boostId, 'auto_extra_score');
    assert.equal(r.entries[0].payload.extra, earnedPts);
    assert.equal(r.entries[0].slot, 0);
    assert.equal(r.entries[0].turnNumber, 3);
  }
});

// ── Wheel outcome coverage (GAP_REPORT item 6: "wheel outcome paths") ──
// WHEEL_OUTCOMES has 8 entries; only 4 were tested before this. Cover
// the remaining 4 so a future renaming/reshuffling fails loudly.

test('wheel pts_1 outcome adds auto_extra_score +1', () => {
  const r = resolveWheelResult({ slot: 0, turnNumber: 3, outcomeId: 'pts_1' });
  assert.equal(r.entries[0].boostId, 'auto_extra_score');
  assert.equal(r.entries[0].payload.extra, 1);
});

test('wheel extra_turn outcome queues an extra_turn entry', () => {
  const r = resolveWheelResult({ slot: 1, turnNumber: 5, outcomeId: 'extra_turn' });
  assert.equal(r.entries[0].boostId, 'extra_turn');
  assert.equal(r.entries[0].slot, 1);
  assert.equal(r.entries[0].turnNumber, 5);
});

test('wheel skip_turn outcome queues a skip_opponent_turn entry', () => {
  const r = resolveWheelResult({ slot: 0, turnNumber: 6, outcomeId: 'skip_turn' });
  assert.equal(r.entries[0].boostId, 'skip_opponent_turn');
});

test('wheel tile_swap outcome queues a free_tile_swap entry', () => {
  const r = resolveWheelResult({ slot: 1, turnNumber: 7, outcomeId: 'tile_swap' });
  assert.equal(r.entries[0].boostId, 'free_tile_swap');
});

test('wheel: unknown outcomeId returns an error and no entries', () => {
  const r = resolveWheelResult({ slot: 0, turnNumber: 1, outcomeId: 'not_a_real_outcome' });
  assert.ok(r.error);
  assert.equal(r.entries.length, 0);
});
