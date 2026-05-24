import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import {
  drawCrosswordPool, scanCrosswordWords,
  mountCrosswordMiniGame, CW_INTENT,
} from './crosswordMiniGame.js';

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x1_0000_0000; };
}

// Letter-value table (subset of HV) used by tests.
const HV_TEST = { א:1, ב:3, ג:3, ד:2, ה:1, ו:1, י:1, כ:5, ל:2, מ:3, נ:1, ס:1, ע:3, פ:4, ק:5, ר:1, ש:1, ת:1 };

test('drawCrosswordPool: returns exactly poolSize letters', () => {
  const pool = drawCrosswordPool(['א','ב','ג','ד','ה'], { rng: rngSeed(1), poolSize: 20 });
  assert.equal(pool.length, 20);
});

test('drawCrosswordPool: excludes jokers', () => {
  const pool = drawCrosswordPool(['?','?','א','ב','?','ג'], { rng: rngSeed(2), poolSize: 4 });
  assert.equal(pool.length, 4);
  // Real letters drawn first, then commons. No "?" in output.
  assert.ok(!pool.includes('?'));
});

test('drawCrosswordPool: pads with commonLetters when bag is short', () => {
  const pool = drawCrosswordPool(['א'], { rng: rngSeed(3), poolSize: 5, commonLetters: ['X','Y'] });
  assert.equal(pool.length, 5);
  assert.equal(pool[0], 'א');
  // Remaining slots cycle through commonLetters.
  assert.deepEqual(pool.slice(1), ['X','Y','X','Y']);
});

test('scanCrosswordWords: detects horizontal and vertical runs ≥ 2', () => {
  // 3×3 grid with horizontal 'אב' on row 0 and vertical 'אג' on col 0.
  const P = (l,v) => ({ l, v });
  const placements = [
    [P('א',1), P('ב',3), null],
    [P('ג',3), null,      null],
    [null,     null,      null],
  ];
  const validator = (w) => w === 'אב' || w === 'אג';
  const r = scanCrosswordWords(placements, { validator, rows: 3, cols: 3 });
  assert.deepEqual(Object.keys(r.legal).sort(), ['אב', 'אג']);
  assert.equal(r.legal['אב'], 4);
  assert.equal(r.legal['אג'], 4);
  assert.equal(r.score, 8);
  assert.equal(r.hasIllegal, false);
});

test('scanCrosswordWords: tags illegal runs in `illegal` (any → bonus zero)', () => {
  const P = (l,v) => ({ l, v });
  const placements = [
    [P('א',1), P('ב',3), null],
    [null,     null,     null],
  ];
  const r = scanCrosswordWords(placements, { validator: () => false, rows: 2, cols: 3 });
  assert.equal(r.score, 0);
  assert.equal(r.hasIllegal, true);
  assert.deepEqual(Object.keys(r.illegal), ['אב']);
});

test('scanCrosswordWords: ignores single-tile runs', () => {
  const P = (l,v) => ({ l, v });
  const placements = [
    [P('א',1), null, null],
    [null,     null, null],
  ];
  const r = scanCrosswordWords(placements, { validator: () => true, rows: 2, cols: 3 });
  assert.deepEqual(r.legal, {});
  assert.deepEqual(r.illegal, {});
});

test('scanCrosswordWords: dedups repeated words', () => {
  const P = (l,v) => ({ l, v });
  const placements = [
    [P('א',1), P('ב',3), null, P('א',1), P('ב',3)],
  ];
  const r = scanCrosswordWords(placements, { validator: () => true, rows: 1, cols: 5 });
  assert.deepEqual(Object.keys(r.legal), ['אב']);
});

test('mount (no-DOM): place + submit scores legal words by tile-value sum', () => {
  bus._reset();
  const events = [];
  bus.on(CW_INTENT.RESULT, r => events.push(r));
  const validator = (w) => w === 'אב';
  const game = mountCrosswordMiniGame({
    bus,
    bag: ['א', 'ב'],
    validator,
    hv: HV_TEST,
    rows: 3, cols: 3, poolSize: 2,
    rng: rngSeed(1), doc: null,
  });
  // Pool always normalizes to length 2 in this test.
  const idxA = game._puzzle.pool.indexOf('א');
  const idxB = game._puzzle.pool.indexOf('ב');
  // Place א at (0,0)
  game.selectPool(idxA); game.place(0, 0);
  // Place ב at (0,1)
  game.selectPool(idxB); game.place(0, 1);
  game.submit();
  assert.equal(events.length, 1);
  assert.equal(events[0].success, true);
  // א + ב = 1 + 3 = 4
  assert.equal(events[0].earnedPts, 4);
  assert.equal(events[0].hasIllegal, false);
  assert.equal(events[0].legalCount, 1);
});

test('mount (no-DOM): any illegal run zeros the whole bonus', () => {
  bus._reset();
  const events = [];
  bus.on(CW_INTENT.RESULT, r => events.push(r));
  const validator = (w) => w === 'אב'; // 'אד' is illegal
  const game = mountCrosswordMiniGame({
    bus,
    bag: ['א','ב','א','ד'],
    validator,
    hv: HV_TEST,
    rows: 3, cols: 5, poolSize: 4,
    rng: rngSeed(1), doc: null,
  });
  const pool = game._puzzle.pool;
  const placeAt = (letter, r, c) => {
    const i = pool.findIndex((l, idx) => l === letter && !game._puzzle.placements.some(row => row.some(cell => cell?.poolIdx === idx)));
    assert.ok(i >= 0, `letter ${letter} not in pool`);
    game.selectPool(i); game.place(r, c);
  };
  placeAt('א', 0, 0); placeAt('ב', 0, 1);
  placeAt('א', 2, 0); placeAt('ד', 2, 1);
  game.submit();
  assert.equal(events[0].success, false);
  assert.equal(events[0].earnedPts, 0);
  assert.equal(events[0].hasIllegal, true);
});

test('mount (no-DOM): placing on a filled cell returns its tile to the pool', () => {
  bus._reset();
  const game = mountCrosswordMiniGame({
    bus,
    bag: ['א','ב'],
    validator: () => true,
    hv: HV_TEST,
    rows: 2, cols: 2, poolSize: 2,
    rng: rngSeed(1), doc: null,
  });
  game.selectPool(0); game.place(0, 0);
  assert.equal(game._puzzle.pool[0], null);
  assert.ok(game._puzzle.placements[0][0]);
  // Click the placed cell → returns to pool.
  game.place(0, 0);
  assert.notEqual(game._puzzle.pool[0], null);
  assert.equal(game._puzzle.placements[0][0], null);
});

test('mount (no-DOM): recallAll clears the board and refills the pool', () => {
  bus._reset();
  const game = mountCrosswordMiniGame({
    bus,
    bag: ['א','ב','ג'],
    validator: () => true,
    hv: HV_TEST,
    rows: 2, cols: 2, poolSize: 3,
    rng: rngSeed(1), doc: null,
  });
  game.selectPool(0); game.place(0, 0);
  game.selectPool(1); game.place(0, 1);
  game.recallAll();
  assert.ok(game._puzzle.pool.every(l => l != null));
  assert.ok(game._puzzle.placements.flat().every(c => c === null));
});

test('mount (no-DOM): expire scores whatever is on the board (timedOut flag set)', () => {
  bus._reset();
  const events = [];
  bus.on(CW_INTENT.RESULT, r => events.push(r));
  const game = mountCrosswordMiniGame({
    bus,
    bag: ['א','ב'],
    validator: (w) => w === 'אב',
    hv: HV_TEST,
    rows: 1, cols: 2, poolSize: 2,
    rng: rngSeed(1), doc: null,
  });
  // Place by letter rather than pool index so the test is shuffle-order
  // independent.
  const idxA = game._puzzle.pool.indexOf('א');
  const idxB = game._puzzle.pool.indexOf('ב');
  game.selectPool(idxA); game.place(0, 0);
  game.selectPool(idxB); game.place(0, 1);
  game.expire();
  assert.equal(events[0].timedOut, true);
  assert.equal(events[0].earnedPts, 4);
});

test('mount: throws if bus is missing', () => {
  assert.throws(() => mountCrosswordMiniGame({}), /bus required/);
});

test('mount (no-DOM): submit with empty board reports no-words failure', () => {
  bus._reset();
  const events = [];
  bus.on(CW_INTENT.RESULT, r => events.push(r));
  const game = mountCrosswordMiniGame({
    bus,
    bag: ['א','ב'],
    validator: () => true,
    hv: HV_TEST,
    rows: 2, cols: 2, poolSize: 2,
    rng: rngSeed(1), doc: null,
  });
  game.submit();
  assert.equal(events[0].success, false);
  assert.equal(events[0].earnedPts, 0);
  assert.equal(events[0].legalCount, 0);
  assert.equal(events[0].illegalCount, 0);
});
