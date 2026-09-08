import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTUP_PEAK_MS,
  COUNTUP_BASE_MS,
  MULT_MERGE_DELAY_MS,
  GATE_SETTLE_TAIL_MS,
  mergeSequenceTiming,
  countUpDurationMs,
  scoreSequenceLandingMs,
  scoreInteractionGateMs,
  scoreClockGraceMs,
  REDUCED_MOTION_GATE_MS,
  REDUCED_MOTION_GRACE_MS,
} from './scoreAnimationTimings.js';

test('scoreSequenceLandingMs: bare move lands after a fixed short beat; scored move tracks the merge timeline', () => {
  assert.equal(scoreSequenceLandingMs({ wordCount: 0, bonusExtra: 0 }), 360);
  const scored = scoreSequenceLandingMs({ wordCount: 2, bonusExtra: 0, multiplier: 1 });
  assert.equal(scored, mergeSequenceTiming({ wordCount: 2, bonusExtra: 0, multiplier: 1 }).totalToPanelLanding);
});

test('scoreInteractionGateMs is the chip landing plus a short fixed settle tail (decoupled from the count-up peak)', () => {
  // Phase 3B: the input gate no longer waits out the whole count-up — it reopens
  // a short beat after the sum chip lands; the count-up keeps climbing harmlessly.
  const gate = scoreInteractionGateMs({ wordCount: 2, bonusExtra: 5, multiplier: 1 });
  assert.equal(gate, scoreSequenceLandingMs({ wordCount: 2, bonusExtra: 5, multiplier: 1 }) + GATE_SETTLE_TAIL_MS);
  // And it is strictly shorter than the clock grace, which stays conservative.
  assert.ok(gate < scoreClockGraceMs({ wordCount: 2, bonusExtra: 5, multiplier: 1 }),
    'input reopens before the (fairness-conservative) clock grace elapses');
});

test('countUpDurationMs: small deltas are near-instant, large deltas are bounded by the peak', () => {
  assert.equal(countUpDurationMs(0), COUNTUP_BASE_MS);
  assert.equal(countUpDurationMs(2), COUNTUP_BASE_MS + 24);
  assert.equal(countUpDurationMs(-2), COUNTUP_BASE_MS + 24, 'magnitude only (sign-independent)');
  assert.equal(countUpDurationMs(10000), COUNTUP_PEAK_MS, 'never exceeds the peak');
  assert.ok(countUpDurationMs(4) < 300, 'a small everyday score resolves in well under 300ms');
});

test('scoreClockGraceMs now includes the ×N multiplier phase (the bug the old local copy omitted)', () => {
  const noMult = scoreClockGraceMs({ wordCount: 2, bonusExtra: 0, multiplier: 1 });
  const withMult = scoreClockGraceMs({ wordCount: 2, bonusExtra: 0, multiplier: 2 });
  assert.equal(withMult - noMult, MULT_MERGE_DELAY_MS, 'multiplier adds exactly the ×N chip delay');
});

test('scoreClockGraceMs: a bare move still grants the count-up peak grace', () => {
  assert.equal(scoreClockGraceMs({ wordCount: 0, bonusExtra: 0 }), COUNTUP_PEAK_MS);
});

test('reduced motion collapses gate + grace to their floors (not zero)', () => {
  assert.equal(scoreInteractionGateMs({ wordCount: 3, bonusExtra: 10, multiplier: 2, reducedMotion: true }), REDUCED_MOTION_GATE_MS);
  assert.equal(scoreClockGraceMs({ wordCount: 3, bonusExtra: 10, multiplier: 2, reducedMotion: true }), REDUCED_MOTION_GRACE_MS);
  assert.ok(REDUCED_MOTION_GATE_MS > 0 && REDUCED_MOTION_GRACE_MS > 0, 'floors are non-zero (misclick + clock grace)');
  // The floors are far shorter than the full choreography.
  assert.ok(REDUCED_MOTION_GATE_MS < scoreInteractionGateMs({ wordCount: 3, bonusExtra: 10, multiplier: 2 }));
});

test('reduced score grace covers the still-visible count-up without changing the input gate', () => {
  assert.equal(scoreClockGraceMs({ score: 30, reducedMotion: true }), countUpDurationMs(30));
  assert.equal(scoreClockGraceMs({ score: 100, reducedMotion: true }), COUNTUP_PEAK_MS);
});
