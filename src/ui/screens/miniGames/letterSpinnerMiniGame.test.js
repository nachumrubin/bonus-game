import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import {
  HEBREW_ALEPHBET, gradeLetterGuess,
  mountLetterSpinnerMiniGame, LS_INTENT,
} from './letterSpinnerMiniGame.js';

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

// A tiny dictionary for deterministic grading.
const DICT = new Set(['בית', 'בא', 'בקבוק', 'גמל', 'ילד']);
const validator = (w) => DICT.has(w);

test('gradeLetterGuess: accepts a valid word that starts with the letter, scored by length', () => {
  const r = gradeLetterGuess('בית', 'ב', validator, new Set());
  assert.equal(r.ok, true);
  assert.equal(r.points, 5); // 3 letters → 5
});

test('gradeLetterGuess: rejects a word that does not start with the letter', () => {
  const r = gradeLetterGuess('ילד', 'ב', validator, new Set());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'wrong-start');
});

test('gradeLetterGuess: rejects too-short, duplicate, and non-dictionary words', () => {
  assert.equal(gradeLetterGuess('ב', 'ב', validator, new Set()).reason, 'too-short');
  assert.equal(gradeLetterGuess('בלבל', 'ב', validator, new Set()).reason, 'invalid');
  const found = new Set(['בית']);
  assert.equal(gradeLetterGuess('בית', 'ב', validator, found).reason, 'duplicate');
});

test('gradeLetterGuess: length scoring matches honeycomb (2=3,3=5,4=8,5+=10)', () => {
  assert.equal(gradeLetterGuess('בא', 'ב', validator, new Set()).points, 3);
  assert.equal(gradeLetterGuess('בית', 'ב', validator, new Set()).points, 5);
  assert.equal(gradeLetterGuess('בקבוק', 'ב', validator, new Set()).points, 10);
});

test('mount (no-DOM): picks an opening letter and grades submissions against it', () => {
  bus._reset();
  const events = [];
  bus.on(LS_INTENT.RESULT, r => events.push(r));
  const game = mountLetterSpinnerMiniGame({
    bus, validator, doc: null, letter: 'ב',
  });
  assert.equal(game._letter, 'ב');
  assert.deepEqual(game.submit('בית').ok, true);
  assert.deepEqual(game.submit('בקבוק').ok, true);
  assert.equal(game.submit('ילד').ok, false); // wrong start
  game.finish();
  assert.equal(events.length, 1);
  assert.equal(events[0].success, true);
  assert.equal(events[0].earnedPts, 15); // 5 + 10
  assert.equal(events[0].foundCount, 2);
  assert.equal(events[0].letter, 'ב');
});

test('mount (no-DOM): no preset letter falls back to a deterministic rng pick', () => {
  bus._reset();
  const game = mountLetterSpinnerMiniGame({ bus, validator, doc: null, rng: rngSeed(3) });
  assert.ok(HEBREW_ALEPHBET.includes(game._letter), 'a real Hebrew letter is chosen');
});

test('mount (no-DOM): duplicate submissions are not double-counted', () => {
  bus._reset();
  const game = mountLetterSpinnerMiniGame({ bus, validator, doc: null, letter: 'ב' });
  assert.equal(game.submit('בית').ok, true);
  assert.equal(game.submit('בית').ok, false);
  game.finish();
});

test('HEBREW_ALEPHBET contains no final-letter forms', () => {
  const SOFIT = new Set(['ך', 'ם', 'ן', 'ף', 'ץ']);
  for (const ch of HEBREW_ALEPHBET) assert.ok(!SOFIT.has(ch));
  assert.equal(HEBREW_ALEPHBET.length, 22);
});

test('throws if bus is missing', () => {
  assert.throws(() => mountLetterSpinnerMiniGame({}), /bus required/);
});
