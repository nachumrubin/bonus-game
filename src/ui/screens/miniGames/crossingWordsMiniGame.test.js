import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import {
  findCrossingPair, gradeCrossingLetter, FALLBACK_CROSSING_PAIR,
  mountCrossingWordsMiniGame, CR_INTENT,
} from './crossingWordsMiniGame.js';

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x1_0000_0000; };
}

test('findCrossingPair: returns null on empty input', () => {
  assert.equal(findCrossingPair([], { rng: rngSeed(1) }), null);
  assert.equal(findCrossingPair(null, { rng: rngSeed(1) }), null);
});

test('findCrossingPair: finds a pair sharing a non-blocked letter', () => {
  const pair = findCrossingPair(['תפוח', 'חגים', 'שלום'], { rng: rngSeed(1) });
  assert.ok(pair, 'expected a pair');
  assert.equal(pair.h[pair.hpos], pair.shared);
  assert.equal(pair.v[pair.vpos], pair.shared);
  // Blocked letters (א/ה/ו/י) should never be returned as the shared letter.
  assert.ok(!new Set(['א','ה','ו','י']).has(pair.shared));
});

test('findCrossingPair: skips pairs whose only shared letter is blocked', () => {
  // 'אוא' and 'איה' share only blocked letters → no pair found
  const pair = findCrossingPair(['אוא', 'איה'], { rng: rngSeed(1) });
  assert.equal(pair, null);
});

test('findCrossingPair: ignores words outside the length window', () => {
  // Only too-short and too-long words → no pair
  const pair = findCrossingPair(['אב', 'אבגדהוז'], { rng: rngSeed(1), minLen: 3, maxLen: 6 });
  assert.equal(pair, null);
});

test('FALLBACK_CROSSING_PAIR is internally consistent', () => {
  const { h, v, hpos, vpos, shared } = FALLBACK_CROSSING_PAIR;
  assert.equal(h[hpos], shared);
  assert.equal(v[vpos], shared);
});

test('gradeCrossingLetter: exact-match only', () => {
  assert.equal(gradeCrossingLetter('ח', 'ח'), true);
  assert.equal(gradeCrossingLetter('ב', 'ח'), false);
  assert.equal(gradeCrossingLetter('', 'ח'), false);
  assert.equal(gradeCrossingLetter(undefined, 'ח'), false);
});

test('gradeCrossingLetter: accepts a non-shared letter if both substituted words are legal', () => {
  const pair = { h: 'תפוח', v: 'חגים', hpos: 3, vpos: 0, shared: 'ח' };
  // dictCheck stub: 'תפוז' and 'זגים' are both "legal" → ז should be accepted
  // even though the picked shared letter was ח.
  const dictCheck = (w) => new Set(['תפוז', 'זגים', 'תפוח', 'חגים']).has(w);
  assert.equal(gradeCrossingLetter('ז', pair, { dictCheck }), true);
  assert.equal(gradeCrossingLetter('ח', pair, { dictCheck }), true);
  // ב produces words that aren't in the stub dict → rejected
  assert.equal(gradeCrossingLetter('ב', pair, { dictCheck }), false);
});

test('mount (no-DOM): correct guess emits success with the configured pts', () => {
  bus._reset();
  const events = [];
  bus.on(CR_INTENT.RESULT, r => events.push(r));
  const game = mountCrossingWordsMiniGame({
    bus, words: ['תפוח', 'חגים'], rng: rngSeed(1), doc: null,
  });
  const shared = game._puzzle.shared;
  game.submit(shared);
  assert.equal(events.length, 1);
  assert.equal(events[0].success, true);
  assert.equal(events[0].earnedPts, 40);
  assert.equal(events[0].shared, shared);
});

test('mount (no-DOM): wrong guess emits failure with 0 points', () => {
  bus._reset();
  const events = [];
  bus.on(CR_INTENT.RESULT, r => events.push(r));
  const game = mountCrossingWordsMiniGame({
    bus, words: ['תפוח', 'חגים'], rng: rngSeed(2), doc: null,
  });
  // Guarantee a non-matching letter
  const wrong = game._puzzle.shared === 'א' ? 'ב' : 'א';
  game.submit(wrong);
  assert.equal(events[0].success, false);
  assert.equal(events[0].earnedPts, 0);
});

test('mount (no-DOM): expire / unmount = failure with empty attempt', () => {
  bus._reset();
  const events = [];
  bus.on(CR_INTENT.RESULT, r => events.push(r));
  const game = mountCrossingWordsMiniGame({
    bus, words: ['תפוח', 'חגים'], rng: rngSeed(3), doc: null,
  });
  game.expire();
  assert.equal(events[0].success, false);
  assert.equal(events[0].earnedPts, 0);
  assert.equal(events[0].attempt, '');
});

test('mount: falls back to the legacy static pair when no dynamic pair fits', () => {
  bus._reset();
  const game = mountCrossingWordsMiniGame({
    bus, words: [], rng: rngSeed(1), doc: null,
  });
  assert.equal(game._puzzle.h, FALLBACK_CROSSING_PAIR.h);
  assert.equal(game._puzzle.v, FALLBACK_CROSSING_PAIR.v);
  assert.equal(game._puzzle.shared, FALLBACK_CROSSING_PAIR.shared);
});

test('mount: throws if bus is missing', () => {
  assert.throws(() => mountCrossingWordsMiniGame({}), /bus required/);
});

test('mount: ptsOption overrides the default', () => {
  bus._reset();
  const events = [];
  bus.on(CR_INTENT.RESULT, r => events.push(r));
  const game = mountCrossingWordsMiniGame({
    bus, words: ['תפוח', 'חגים'], rng: rngSeed(1), doc: null, pts: 75,
  });
  game.submit(game._puzzle.shared);
  assert.equal(events[0].earnedPts, 75);
});
