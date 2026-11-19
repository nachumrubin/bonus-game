import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildScoreBreakdown, breakdownIsConsistent, computeFinalScores, rackPenalty, fullRackBonusFor } from './scoringV2.js';
import { evaluateMoveBoosts } from './challengeEvaluator.js';
import { longWord, letterHunt } from './challengeCatalog.js';
import { BINGO_BONUS } from '../core/scoringEngine.js';
import { RULES, hw, vw, placedOf } from './testHelpers.js';

test('base score without Boosts sums every resulting word, shared tile counted in both', () => {
  const main = hw(4, 3, 'שלום');                    // 3+2+1+2 = 8
  const cross = vw(3, 4, 'אלף', [1]).map((t, i) => (i === 1 ? { ...t, ex: false } : t)); // 1+2+5 = 8
  const b = buildScoreBreakdown({ words: [main, cross], placedCount: 4, rules: RULES });
  assert.deepEqual(b.words.map(w => w.baseScore), [8, 8]);
  assert.equal(b.baseScore, 16);
  assert.equal(b.boostScore, 0);
  assert.equal(b.fullRackBonus, 0);
  assert.equal(b.totalScore, 16);
  assert.ok(breakdownIsConsistent(b));
});

test('existing tiles contribute to the word score', () => {
  const w = hw(4, 3, 'שלום', [3]);
  assert.equal(buildScoreBreakdown({ words: [w], placedCount: 1, rules: RULES }).totalScore, 8);
});

function scored(words, active, defs) {
  const placed = placedOf(...words);
  const boostResults = evaluateMoveBoosts({ activeBoosts: active, definitions: defs, words, placed });
  return buildScoreBreakdown({ words, placedCount: placed.length, boostResults, rules: RULES });
}

test('single successful Boost adds its reward', () => {
  const d = longWord(RULES, 'MEDIUM');
  const w = hw(4, 2, 'שלומות');
  const b = scored([w], [{ instanceId: 'x', r: 4, c: 2, effectiveDefinitionId: d.definitionId }], { [d.definitionId]: d });
  assert.equal(b.boostScore, 10);
  assert.equal(b.totalScore, b.baseScore + 10);
  assert.deepEqual(b.completedBoostIds, ['x']);
  assert.deepEqual(b.failedBoostIds, []);
});

test('failed Boost is consumed and adds zero', () => {
  const d = longWord(RULES, 'HARD');
  const b = scored([hw(4, 3, 'שלום')], [{ instanceId: 'x', r: 4, c: 3, effectiveDefinitionId: d.definitionId }], { [d.definitionId]: d });
  assert.deepEqual(b.consumedBoostIds, ['x']);
  assert.deepEqual(b.failedBoostIds, ['x']);
  assert.equal(b.boostScore, 0);
  assert.equal(b.totalScore, b.baseScore);
});

test('multiple + mixed Boosts stack', () => {
  const lw = longWord(RULES, 'EASY');
  const lh = letterHunt(RULES, 'EASY', 'ל');
  const lhFail = letterHunt(RULES, 'MEDIUM', 'ש');
  const defs = { [lw.definitionId]: lw, [lh.definitionId]: lh, [lhFail.definitionId]: lhFail };
  const b = scored([hw(4, 3, 'שלום')], [
    { instanceId: 'a', r: 4, c: 3, effectiveDefinitionId: lw.definitionId },
    { instanceId: 'b', r: 4, c: 4, effectiveDefinitionId: lh.definitionId },
    { instanceId: 'c', r: 4, c: 6, effectiveDefinitionId: lhFail.definitionId },
  ], defs);
  assert.equal(b.boostScore, 10);
  assert.deepEqual(b.completedBoostIds, ['a', 'b']);
  assert.deepEqual(b.failedBoostIds, ['c']);
  assert.ok(breakdownIsConsistent(b));
});

test('full-rack bonus: exactly 8 new tiles → +25 (legacy BINGO_BONUS constant untouched)', () => {
  assert.equal(fullRackBonusFor(8, RULES), 25);
  assert.equal(fullRackBonusFor(7, RULES), 0);
  assert.equal(fullRackBonusFor(5, RULES), 0); // emptying a short rack is not a full rack
  assert.equal(BINGO_BONUS, 50);
});

test('eight new tiles + two existing tiles still earns +25, and stacks with Boosts', () => {
  const d = longWord(RULES, 'HARD');
  const w = hw(0, 0, 'אבגדהוזחטי', [0, 1, 2, 3, 4, 5, 6, 7]);
  const b = scored([w], [{ instanceId: 'x', r: 0, c: 0, effectiveDefinitionId: d.definitionId }], { [d.definitionId]: d });
  assert.equal(b.fullRackBonus, 25);
  assert.equal(b.boostScore, 20);
  assert.equal(b.totalScore, b.baseScore + 45);
});

test('seven new tiles forming an eight-letter word: no bonus', () => {
  const w = hw(0, 0, 'אבגדהוזח', [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(buildScoreBreakdown({ words: [w], placedCount: 7, rules: RULES }).fullRackBonus, 0);
});

test('endgame: remaining rack value is deducted, not transferred; joker deducts 0', () => {
  assert.equal(rackPenalty(['צ', 'א', '?']), 10);
  const fs = computeFinalScores({ 0: 100, 1: 90 }, { 0: ['צ', 'ז'], 1: [] });
  assert.deepEqual(fs.deductions, { 0: 17, 1: 0 });
  assert.deepEqual(fs.final, { 0: 83, 1: 90 });
});

test('endgame: deductions can produce a draw', () => {
  const fs = computeFinalScores({ 0: 50, 1: 45 }, { 0: ['ס'], 1: [] });
  assert.equal(fs.final[0], fs.final[1]);
});
