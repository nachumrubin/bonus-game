import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTION_MICRO, MOTION_FAST, MOTION_NORMAL, MOTION_REWARD,
  EASE_STANDARD, EASE_EXIT, EASE_BOUNCE,
  PRESS_SCALE_CONTROL, PRESS_SCALE_TILE,
} from './motionTokens.js';

test('duration tokens increase monotonically (micro < fast < normal < reward)', () => {
  assert.ok(MOTION_MICRO < MOTION_FAST);
  assert.ok(MOTION_FAST < MOTION_NORMAL);
  assert.ok(MOTION_NORMAL < MOTION_REWARD);
});

test('duration tokens have the approved values', () => {
  assert.equal(MOTION_MICRO, 120);
  assert.equal(MOTION_FAST, 220);
  assert.equal(MOTION_NORMAL, 320);
  assert.equal(MOTION_REWARD, 600);
});

test('easing tokens are cubic-bezier strings', () => {
  for (const ease of [EASE_STANDARD, EASE_EXIT, EASE_BOUNCE]) {
    assert.match(ease, /^cubic-bezier\(/);
  }
});

test('press scales are two distinct values inside (0,1); tile is deeper', () => {
  assert.ok(PRESS_SCALE_CONTROL > 0 && PRESS_SCALE_CONTROL < 1);
  assert.ok(PRESS_SCALE_TILE > 0 && PRESS_SCALE_TILE < 1);
  assert.ok(PRESS_SCALE_TILE < PRESS_SCALE_CONTROL, 'game piece presses deeper than a control');
});
