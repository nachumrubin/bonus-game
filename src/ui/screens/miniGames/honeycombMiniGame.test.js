import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import {
  HONEYCOMB_GROUPS, pickHoneycombGroup, wordPoints,
  gradeHoneycombGuess, mountHoneycombMiniGame, HC_INTENT,
} from './honeycombMiniGame.js';

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x1_0000_0000; };
}

test('HONEYCOMB_GROUPS: legacy 12 hand-curated sets, frozen', () => {
  assert.equal(HONEYCOMB_GROUPS.length, 12);
  for (const g of HONEYCOMB_GROUPS) {
    assert.equal(typeof g.c, 'string');
    assert.equal(g.c.length, 1);
    assert.equal(g.o.length, 6);
  }
});

test('pickHoneycombGroup: returns center + 6 outer letters with center at letters[0]', () => {
  const g = pickHoneycombGroup(rngSeed(1));
  assert.equal(g.letters.length, 7);
  assert.equal(g.letters[0], g.center);
  assert.equal(g.outer.length, 6);
});

test('wordPoints: 2=3 | 3=5 | 4=8 | 5+=10 (legacy ladder)', () => {
  assert.equal(wordPoints(''), 0);
  assert.equal(wordPoints('א'), 0);
  assert.equal(wordPoints('אב'), 3);
  assert.equal(wordPoints('אבג'), 5);
  assert.equal(wordPoints('אבגד'), 8);
  assert.equal(wordPoints('אבגדה'), 10);
  assert.equal(wordPoints('אבגדהו'), 10);
  assert.equal(wordPoints('אבגדהוז'), 10);
});

test('gradeHoneycombGuess: rejects too-short / missing-center / duplicate / invalid', () => {
  const group = { center: 'מ', outer: ['י','ל','ה','ו','כ','ב'] };
  const dict = new Set(['מים', 'הלך', 'מילים']);
  const validator = (w) => dict.has(w);
  const found = new Set();

  assert.equal(gradeHoneycombGuess('',     group, validator, found).reason, 'no-input');
  assert.equal(gradeHoneycombGuess('א',    group, validator, found).reason, 'too-short');
  assert.equal(gradeHoneycombGuess('הלך',  group, validator, found).reason, 'missing-center');
  // Use a word that DOES contain 'מ' but is not in the dict — so it gets
  // past the missing-center check and is rejected as invalid by the
  // validator. 'מבץ' is not in `dict` (which only has מים/הלך/מילים).
  assert.equal(gradeHoneycombGuess('מבץ', group, validator, found).reason, 'invalid');

  const ok = gradeHoneycombGuess('מים', group, validator, found);
  assert.equal(ok.ok, true);
  assert.equal(ok.points, 5);

  found.add('מים');
  assert.equal(gradeHoneycombGuess('מים', group, validator, found).reason, 'duplicate');
});

test('gradeHoneycombGuess: respects an optional norm() — center check is post-normalization', () => {
  // Force the spine `norm` behaviour: strip suffix mems. Here we use a tiny
  // stub that says "the centre letter still counts even if it appears as a
  // suffix form" — e.g. ם becomes מ.
  const norm = (w) => (w ?? '').replace(/ם/g, 'מ');
  const group = { center: 'מ', outer: ['י','ל','ה','ו','כ','ב'] };
  const dict = new Set(['ים']);
  const validator = (w) => dict.has(w);
  const r = gradeHoneycombGuess('ים', group, validator, new Set(), norm);
  // 'ים' normalises to 'ימ' which contains 'מ' → passes center test.
  assert.equal(r.ok, true);
});

test('mount (no-DOM): accepts valid words, dedups, tallies points by length', () => {
  bus._reset();
  const events = [];
  bus.on(HC_INTENT.RESULT, r => events.push(r));
  const group = { center: 'מ', outer: ['י','ל','ה','ו','כ','ב'], letters: ['מ','י','ל','ה','ו','כ','ב'] };
  const dict = new Set(['מים', 'מילה', 'מלכים']);
  const game = mountHoneycombMiniGame({
    bus,
    group,
    validator: (w) => dict.has(w),
    rng: rngSeed(1), doc: null,
  });
  assert.equal(game.submit('מים').ok, true);     // +5
  assert.equal(game.submit('מילה').ok, true);    // +8
  assert.equal(game.submit('מלכים').ok, true);   // +10
  assert.equal(game.submit('מים').reason, 'duplicate');
  game.finish();
  assert.equal(events.length, 1);
  assert.equal(events[0].earnedPts, 5 + 8 + 10);
  assert.equal(events[0].foundCount, 3);
  assert.deepEqual(events[0].foundWords, ['מים', 'מילה', 'מלכים']);
  assert.equal(events[0].timedOut, false);
});

test('mount (no-DOM): wrong-letters from outside the honeycomb are still accepted if validator + center pass', () => {
  // Legacy game only enforces center-letter + dictionary; outside letters
  // are allowed. We mirror that — letters from outside the 7-set must NOT
  // be rejected by gradeHoneycombGuess.
  bus._reset();
  const group = { center: 'א', outer: ['ב','ג','ד','ה','ו','ז'], letters: ['א','ב','ג','ד','ה','ו','ז'] };
  const dict = new Set(['אבק']); // 'ק' is outside the honeycomb
  const game = mountHoneycombMiniGame({
    bus,
    group,
    validator: (w) => dict.has(w),
    rng: rngSeed(1), doc: null,
  });
  assert.equal(game.submit('אבק').ok, true);
});

test('mount (no-DOM): expire emits result with timedOut=true', () => {
  bus._reset();
  const events = [];
  bus.on(HC_INTENT.RESULT, r => events.push(r));
  const game = mountHoneycombMiniGame({
    bus,
    group: { center: 'מ', outer: ['י','ל','ה','ו','כ','ב'], letters: ['מ','י','ל','ה','ו','כ','ב'] },
    validator: (w) => w === 'מים',
    rng: rngSeed(1), doc: null,
  });
  game.submit('מים');
  game.expire();
  assert.equal(events[0].timedOut, true);
  assert.equal(events[0].earnedPts, 5);
});

test('mount (no-DOM): if no group is given, picks one from HONEYCOMB_GROUPS', () => {
  bus._reset();
  const game = mountHoneycombMiniGame({
    bus,
    validator: () => false,
    rng: rngSeed(1), doc: null,
  });
  // Picked centre must be one of the legacy 12 group centres.
  assert.ok(HONEYCOMB_GROUPS.some(g => g.c === game._puzzle.center));
});

test('mount: throws if bus is missing', () => {
  assert.throws(() => mountHoneycombMiniGame({}), /bus required/);
});
