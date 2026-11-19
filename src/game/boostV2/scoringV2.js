// Boost 2.0 — additive scoring + authoritative score breakdown (spec §6).
//
//   moveScore = Σ baseScore(word)  for every newly formed / extended word
//             + Σ reward(completed Boost)
//             + fullRackBonus      (+25 when exactly rackCapacity new tiles)
//
// No multipliers, no word-length bonus. A tile shared by two words counts in
// both. Words come from scoringEngine.getAllWords, which already excludes
// unchanged words and de-duplicates by coordinates. The breakdown returned
// here is THE record of the move — engine, UI, sync and history all read it.
// Pure.

import { wordId, wordBaseScore } from './challengeEvaluator.js';
import { HV } from '../core/letterDistribution.js';

export function fullRackBonusFor(placedCount, rules) {
  return placedCount === rules.rackCapacity ? rules.fullRackBonus : 0;
}

export function buildScoreBreakdown({ words, placedCount, boostResults = [], rules }) {
  const wordScores = words.map(w => ({
    wordId: wordId(w),
    text: w.map(t => t.letter).join(''),
    tiles: w.map(t => ({ r: t.r, c: t.c, letter: t.letter, val: Number(t.val) || 0, ex: !!t.ex })),
    baseScore: wordBaseScore(w),
  }));
  const baseScore = wordScores.reduce((s, w) => s + w.baseScore, 0);
  const results = boostResults.map(r => ({ ...r, qualifyingWordIds: [...r.qualifyingWordIds] }));
  const boostScore = results.reduce((s, r) => s + (r.completed ? r.reward : 0), 0);
  const fullRackBonus = fullRackBonusFor(placedCount, rules);
  return {
    words: wordScores,
    baseScore,
    boostResults: results,
    consumedBoostIds: results.filter(r => r.consumed).map(r => r.instanceId),
    completedBoostIds: results.filter(r => r.completed).map(r => r.instanceId),
    failedBoostIds: results.filter(r => r.consumed && !r.completed).map(r => r.instanceId),
    boostScore,
    fullRackBonus,
    totalScore: baseScore + boostScore + fullRackBonus,
  };
}

// Invariant helper (spec §43): total equals the sum of its parts.
export function breakdownIsConsistent(b) {
  const base = b.words.reduce((s, w) => s + w.baseScore, 0);
  const boost = b.boostResults.reduce((s, r) => s + (r.completed ? r.reward : 0), 0);
  return base === b.baseScore && boost === b.boostScore && b.totalScore === b.baseScore + b.boostScore + b.fullRackBonus;
}

// Endgame (spec §6.3): finalScore = accumulated − Σ value(remaining rack tiles).
// Racks hold letter strings; a joker is '?' (value 0 — existing rule).
export function rackPenalty(rack) {
  let s = 0;
  for (const l of rack ?? []) s += HV[l] ?? 0;
  return s;
}

export function computeFinalScores(scores, racks) {
  const deductions = { 0: rackPenalty(racks?.[0]), 1: rackPenalty(racks?.[1]) };
  const accumulated = { 0: scores?.[0] ?? 0, 1: scores?.[1] ?? 0 };
  return {
    accumulated,
    deductions,
    final: { 0: accumulated[0] - deductions[0], 1: accumulated[1] - deductions[1] },
  };
}
