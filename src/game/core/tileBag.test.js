import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HD } from './letterDistribution.js';
import { createBag, drawInto, returnTilesAndShuffle, bagSize, RACK_SIZE } from './tileBag.js';

const totalTiles = Object.values(HD).reduce((a, b) => a + b, 0);

test('createBag produces a bag of the expected total tile count', () => {
  const bag = createBag('seed-1');
  assert.equal(bagSize(bag), totalTiles);
});

test('createBag with the same seed is reproducible', () => {
  const a = createBag('reproducible');
  const b = createBag('reproducible');
  assert.deepEqual(a, b);
});

test('createBag with different seeds produces different orders', () => {
  const a = createBag('seed-A');
  const b = createBag('seed-B');
  // Astronomically unlikely to be equal by chance
  assert.notDeepEqual(a, b);
});

test('createBag preserves the letter distribution', () => {
  const bag = createBag('count-check');
  const counts = {};
  for (const t of bag) counts[t] = (counts[t] || 0) + 1;
  for (const [letter, expected] of Object.entries(HD)) {
    assert.equal(counts[letter], expected, `letter ${letter}`);
  }
});

test('drawInto fills an empty rack to RACK_SIZE', () => {
  const bag = createBag('draw-test');
  const rack = [];
  const drawn = drawInto(bag, rack);
  assert.equal(rack.length, RACK_SIZE);
  assert.equal(drawn, RACK_SIZE);
  assert.equal(bagSize(bag), totalTiles - RACK_SIZE);
});

test('drawInto tops up a partial rack', () => {
  const bag = createBag('topup-test');
  const rack = ['א', 'ב', 'ג'];
  drawInto(bag, rack);
  assert.equal(rack.length, RACK_SIZE);
});

test('drawInto stops when the bag is empty', () => {
  const bag = ['א', 'ב'];
  const rack = [];
  const drawn = drawInto(bag, rack);
  assert.equal(drawn, 2);
  assert.equal(rack.length, 2);
  assert.equal(bag.length, 0);
});

test('returnTilesAndShuffle puts tiles back and randomizes', () => {
  const bag = createBag('return-test');
  const before = bag.length;
  returnTilesAndShuffle(bag, ['א', 'ב'], 'reshuffle-seed');
  assert.equal(bag.length, before + 2);
});
