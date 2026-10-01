// bonusOutcomes.mjs — what a simulated player "scores" in a mini-game or
// wheel spin, and how long they spend in it. Pure.
//
// The real mini-game UIs run in the browser; headless agents resolve them
// through the same bonusActivationController.resolveMiniGame / resolveWheel
// calls the UIs make, with outcomes sampled here. The point values follow the
// real games' scoring (see main.js attachBonusFlow and bonusTileDefs.js):
//   B1  unscramble / fill-middle  +100 on success
//   B3  unscramble medium         +40  on success
//   B8  crossword 60s             sum of valid runs; any illegal run → 0
//   B10 crossing words            +40  on success
//   B11 hidden word               +30  on success
//   B12 honeycomb                 Σ per-word 3/5/8/10
//   B14 letter spinner            Σ per-word 3/5/8/10
//
// Durations are the real game clocks; the agent spends a fraction of it
// (solving early) plus a result-screen dwell before tapping המשך.

import { WHEEL_OUTCOMES } from '../../../src/game/boosts/bonusTileDefs.js';

const WORD_SCORES = [3, 5, 8, 10];

export const MINIGAME_SPECS = Object.freeze({
  b1_unscramble_or_fillmiddle: { durationMs: 40_000, successP: 0.5, fixedPts: 100 },
  b3_unscramble_medium:        { durationMs: 40_000, successP: 0.65, fixedPts: 40 },
  b8_crossword_60s:            { durationMs: 60_000, successP: 0.7, sumRange: [6, 70] },
  b10_crossing_words:          { durationMs: 30_000, successP: 0.5, fixedPts: 40 },
  b11_hidden_word:             { durationMs: 20_000, successP: 0.55, fixedPts: 30 },
  b12_honeycomb:               { durationMs: 40_000, wordsRange: [0, 6] },
  b14_letter_spinner:          { durationMs: 20_000, wordsRange: [0, 5] },
});

export const WHEEL_SPIN_MS = 6_000;

function int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

/** @returns {{ success: boolean, earnedPts: number }} */
export function sampleMiniGameOutcome(miniGameKey, rng) {
  const spec = MINIGAME_SPECS[miniGameKey];
  if (!spec) return { success: false, earnedPts: 0 };
  if (spec.wordsRange) {
    const n = int(rng, spec.wordsRange[0], spec.wordsRange[1]);
    let pts = 0;
    for (let i = 0; i < n; i++) pts += WORD_SCORES[int(rng, 0, WORD_SCORES.length - 1)];
    return { success: pts > 0, earnedPts: pts };
  }
  const success = rng() < spec.successP;
  if (!success) return { success: false, earnedPts: 0 };
  if (spec.sumRange) return { success: true, earnedPts: int(rng, spec.sumRange[0], spec.sumRange[1]) };
  return { success: true, earnedPts: spec.fixedPts };
}

export function sampleWheelOutcome(rng) {
  return WHEEL_OUTCOMES[int(rng, 0, WHEEL_OUTCOMES.length - 1)].id;
}

/**
 * How long the player stays in the mini-game before the result screen, and
 * how long they look at the result before tapping continue.
 * `timeScale` < 1 compresses mini-games for volume runs (default real time).
 */
export function sampleMiniGameDwell(kind, miniGameKey, rng, { timeScale = 1 } = {}) {
  const full = kind === 'wheel' ? WHEEL_SPIN_MS : (MINIGAME_SPECS[miniGameKey]?.durationMs ?? 30_000);
  // Some players finish fast, most use a good chunk, a few run the clock out.
  const r = rng();
  const frac = r < 0.2 ? 0.15 + rng() * 0.25 : r < 0.85 ? 0.4 + rng() * 0.5 : 1.0;
  const playMs = Math.round(full * (kind === 'wheel' ? 1 : frac) * timeScale);
  const resultDwellMs = Math.round((800 + rng() * 3500) * Math.min(1, timeScale * 2));
  return { playMs, resultDwellMs };
}
