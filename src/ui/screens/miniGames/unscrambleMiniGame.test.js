import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import {
  pickPuzzle, shuffleLetters, isCorrectAnswer, tierConfig,
  mountUnscrambleMiniGame, UNS_INTENT,
} from './unscrambleMiniGame.js';

// Deterministic RNG for repeatable tests.
function rngSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const HEBREW_WORDS = ['דגל', 'יום', 'אבא', 'בית', 'גמל',
                      'שלום', 'דרך', 'מלך',
                      'בקבוק', 'מטוסי', 'ארגון',
                      'ירושלם', 'מועדון', 'מסעדה'];

test('tierConfig: known tiers + fallback', () => {
  assert.equal(tierConfig('long').wordLen, 6);
  assert.equal(tierConfig('long').earnedPts, 100);
  assert.equal(tierConfig('medium').wordLen, 4);
  assert.equal(tierConfig('medium').earnedPts, 40);
  // Unknown tier → medium fallback
  assert.equal(tierConfig('xxx').wordLen, 4);
});

test('shuffleLetters: rotates if shuffle returns the original', () => {
  const stuckRng = () => 0; // floor(0 * (i+1)) === 0 always; produces a stable pattern
  const out = shuffleLetters('abcd', stuckRng);
  assert.notEqual(out.join(''), 'abcd');
});

test('shuffleLetters: respects rng order', () => {
  const out = shuffleLetters('abcde', rngSeed(42));
  assert.equal(out.length, 5);
  // All original letters present
  assert.deepEqual(out.slice().sort(), ['a','b','c','d','e']);
});

test('pickPuzzle: returns null when no word matches the length', () => {
  assert.equal(pickPuzzle(['short'], 99, rngSeed(1)), null);
});

test('pickPuzzle: picks a word of the requested length', () => {
  const p = pickPuzzle(HEBREW_WORDS, 4, rngSeed(7));
  assert.equal(p.word.length, 4);
  assert.equal(p.scrambled.length, 4);
  assert.deepEqual(p.scrambled.slice().sort(), p.word.split('').sort());
});

test('isCorrectAnswer: exact match wins; mismatch loses', () => {
  assert.equal(isCorrectAnswer('שלום', 'שלום'), true);
  assert.equal(isCorrectAnswer('שולם', 'שלום'), false);
  assert.equal(isCorrectAnswer('',     'שלום'), false);
  assert.equal(isCorrectAnswer(null,   'שלום'), false);
});

test('isCorrectAnswer: accepts any same-length validator-approved word (anagram path)', () => {
  // Picked answer was שטפי but the player formed פטיש (same letters, also
  // a valid Hebrew word). The unscramble UI constrains tile choices to the
  // puzzle letters, so any same-length validator-approved guess is a
  // legitimate permutation and should score the boost.
  const validator = (w) => ['שטפי', 'פטיש'].includes(w);
  assert.equal(isCorrectAnswer('פטיש', 'שטפי', validator), true,
    'a valid Hebrew anagram of the puzzle letters should be accepted');
  assert.equal(isCorrectAnswer('פטיש', 'שטפי'), false,
    'without a validator only the exact picked answer wins');
  // A same-length word that the validator rejects still loses.
  assert.equal(isCorrectAnswer('זזזז', 'שטפי', validator), false);
});

test('mount (no-DOM env): submit with correct guess fires UNS_INTENT.RESULT success', () => {
  bus._reset();
  const events = [];
  bus.on(UNS_INTENT.RESULT, (r) => events.push(r));
  const game = mountUnscrambleMiniGame({
    bus, words: HEBREW_WORDS, tier: 'medium', rng: rngSeed(9), doc: null,
  });
  assert.ok(game._puzzle, 'expected a puzzle to be picked');
  game.submit(game._puzzle.word);
  assert.equal(events.length, 1);
  assert.equal(events[0].success, true);
  assert.equal(events[0].earnedPts, 40);
});

test('mount (no-DOM env): submit with wrong guess fires fail', () => {
  bus._reset();
  const events = [];
  bus.on(UNS_INTENT.RESULT, (r) => events.push(r));
  const game = mountUnscrambleMiniGame({
    bus, words: HEBREW_WORDS, tier: 'long', rng: rngSeed(11), doc: null,
  });
  game.submit('wrong');
  assert.equal(events[0].success, false);
  assert.equal(events[0].earnedPts, 0);
});

test('mount: unmount before any submit fires fail', () => {
  bus._reset();
  const events = [];
  bus.on(UNS_INTENT.RESULT, (r) => events.push(r));
  const game = mountUnscrambleMiniGame({
    bus, words: HEBREW_WORDS, tier: 'medium', rng: rngSeed(2), doc: null,
  });
  game.unmount();
  assert.equal(events[0].success, false);
});

test('mount: empty wordlist fires no-word fail', async () => {
  bus._reset();
  const events = [];
  bus.on(UNS_INTENT.RESULT, (r) => events.push(r));
  let onResultCalls = 0;
  mountUnscrambleMiniGame({
    bus, words: [], tier: 'medium',
    onResult: () => { onResultCalls++; },
  });
  // Resolution is queued in a microtask
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'no-word');
  assert.equal(events[0].success, false);
  assert.equal(onResultCalls, 1);
});

test('mount: result is fired only once even if submit + unmount both happen', () => {
  bus._reset();
  const events = [];
  bus.on(UNS_INTENT.RESULT, (r) => events.push(r));
  const game = mountUnscrambleMiniGame({
    bus, words: HEBREW_WORDS, tier: 'medium', rng: rngSeed(3), doc: null,
  });
  game.submit(game._puzzle.word);
  game.unmount();
  assert.equal(events.length, 1);
});

test('throws if bus or words missing', () => {
  assert.throws(() => mountUnscrambleMiniGame({ words: [] }),  /bus required/);
  assert.throws(() => mountUnscrambleMiniGame({ bus }),         /words/);
});
