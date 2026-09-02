import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTUP_PEAK_MS,
  MULT_MERGE_DELAY_MS,
  mergeSequenceTiming,
  scoreSequenceLandingMs,
  scoreInteractionGateMs,
  scoreClockGraceMs,
  REDUCED_MOTION_GATE_MS,
  REDUCED_MOTION_GRACE_MS,
} from './scoreAnimationTimings.js';

test('scoreSequenceLandingMs: bare move lands after a fixed short beat; scored move tracks the merge timeline', () => {
  assert.equal(scoreSequenceLandingMs({ wordCount: 0, bonusExtra: 0 }), 460);
  const scored = scoreSequenceLandingMs({ wordCount: 2, bonusExtra: 0, multiplier: 1 });
  assert.equal(scored, mergeSequenceTiming({ wordCount: 2, bonusExtra: 0, multiplier: 1 }).totalToPanelLanding);
});

test('scoreInteractionGateMs preserves the historical gate value (landing + count-up peak)', () => {
  // Historical formula was scoreAnimationLandingMs(...) + 900.
  const gate = scoreInteractionGateMs({ wordCount: 2, bonusExtra: 5, multiplier: 1 });
  assert.equal(gate, scoreSequenceLandingMs({ wordCount: 2, bonusExtra: 5, multiplier: 1 }) + COUNTUP_PEAK_MS);
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
