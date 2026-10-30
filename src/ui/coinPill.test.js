import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coinCountValue, showCoinCountUp } from './coinPill.js';

test('coinCountValue: starts at from, lands exactly on to, eases out', () => {
  assert.equal(coinCountValue(770, 870, 0), 770);
  assert.equal(coinCountValue(770, 870, 1), 870);
  assert.equal(coinCountValue(770, 870, 2), 870, 'clamped past the end');
  assert.equal(coinCountValue(770, 870, -1), 770, 'clamped before the start');
  assert.ok(coinCountValue(770, 870, 0.5) > 820, 'more than half way at half time (ease-out)');
});

test('showCoinCountUp: does nothing without a visible top bar', () => {
  const doc = { getElementById: () => null };
  assert.equal(showCoinCountUp({ from: 1, to: 2, doc }), false);
});
