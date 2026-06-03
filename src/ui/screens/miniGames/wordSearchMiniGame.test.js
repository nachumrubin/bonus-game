import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import {
  placeWords, extractWord, matchPlacement,
  mountWordSearchMiniGame, WS_INTENT,
  HEBREW_WORD_POOL,
} from './wordSearchMiniGame.js';

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const WORDS = ['שלום', 'בית', 'דרך', 'מלך', 'יום'];

test('placeWords: returns size×size grid with at least one placement', () => {
  const { grid, placements } = placeWords(WORDS, { size: 8, maxWords: 5, rng: rngSeed(42) });
  assert.equal(grid.length, 8);
  assert.equal(grid[0].length, 8);
  assert.ok(placements.length >= 1, 'expected at least one placement');
});

test('placeWords: each placement is on a straight or diagonal line and matches the grid', () => {
  const { grid, placements } = placeWords(WORDS, { size: 8, rng: rngSeed(7) });
  for (const p of placements) {
    // Legacy parity: 8 directions = 4 cardinal + 4 diagonal. dr/dc must be
    // one of -1/0/+1 with at least one non-zero component.
    assert.ok([-1, 0, 1].includes(p.dr) && [-1, 0, 1].includes(p.dc) && (p.dr !== 0 || p.dc !== 0));
    const extracted = extractWord(grid, p.from, p.to);
    assert.equal(extracted, p.word);
  }
});

test('placeWords: restricted to horizontal+vertical when caller asks', () => {
  const { placements } = placeWords(WORDS, {
    size: 8,
    rng: rngSeed(3),
    directions: [[0, 1], [1, 0], [0, -1], [-1, 0]],
  });
  for (const p of placements) {
    assert.ok(p.dr === 0 || p.dc === 0, 'expected horizontal or vertical only');
  }
});

test('placeWords: empty cells are filled with Hebrew letters', () => {
  const { grid } = placeWords(WORDS, { size: 6, rng: rngSeed(2) });
  for (const row of grid) {
    for (const ch of row) {
      assert.match(ch, /[א-ת]/);
    }
  }
});

test('placeWords: respects maxWords cap', () => {
  const { placements } = placeWords([...WORDS, 'אבא','גמל'], { size: 10, maxWords: 2, rng: rngSeed(1) });
  assert.ok(placements.length <= 2);
});

test('placeWords: words too long for grid are skipped', () => {
  const { placements } = placeWords(['אאאאאאאאאא'], { size: 4, rng: rngSeed(0) });
  assert.equal(placements.length, 0);
});

test('extractWord: horizontal forward', () => {
  const grid = [['א','ב','ג'],['ד','ה','ו']];
  assert.equal(extractWord(grid, { r: 0, c: 0 }, { r: 0, c: 2 }), 'אבג');
});

test('extractWord: vertical reverse', () => {
  const grid = [['א'],['ב'],['ג']];
  assert.equal(extractWord(grid, { r: 2, c: 0 }, { r: 0, c: 0 }), 'גבא');
});

test('extractWord: diagonal ↘ returns the line', () => {
  const grid = [['א','ב'],['ג','ד']];
  assert.equal(extractWord(grid, { r: 0, c: 0 }, { r: 1, c: 1 }), 'אד');
});

test('extractWord: diagonal ↙ (reverse) returns the line', () => {
  const grid = [['א','ב','ג'],['ד','ה','ו'],['ז','ח','ט']];
  assert.equal(extractWord(grid, { r: 0, c: 2 }, { r: 2, c: 0 }), 'גהז');
});

test('extractWord: non-45-degree slope returns null', () => {
  const grid = [['א','ב','ג'],['ד','ה','ו'],['ז','ח','ט']];
  assert.equal(extractWord(grid, { r: 0, c: 0 }, { r: 2, c: 1 }), null);
});

test('extractWord: out of bounds returns null', () => {
  const grid = [['א','ב'],['ג','ד']];
  assert.equal(extractWord(grid, { r: 0, c: 0 }, { r: 5, c: 0 }), null);
});

test('matchPlacement: matches forward and reverse', () => {
  const placements = [
    { word: 'בית', from: { r: 1, c: 1 }, to: { r: 1, c: 3 }, dr: 0, dc: 1 },
  ];
  assert.ok(matchPlacement(placements, { r: 1, c: 1 }, { r: 1, c: 3 }));
  assert.ok(matchPlacement(placements, { r: 1, c: 3 }, { r: 1, c: 1 }));
  assert.equal(matchPlacement(placements, { r: 0, c: 0 }, { r: 0, c: 2 }), null);
});

test('mount (no-DOM): submit a found word increments score (legacy 10 pts/word)', () => {
  bus._reset();
  const events = [];
  bus.on(WS_INTENT.RESULT, r => events.push(r));
  const game = mountWordSearchMiniGame({ bus, words: WORDS, rng: rngSeed(5), doc: null, durationMs: 100 });
  for (const p of game._puzzle.placements) {
    assert.equal(game.submit(p.from, p.to), true);
  }
  game.finish();
  assert.equal(events.length, 1);
  assert.equal(events[0].foundCount, game._puzzle.placements.length);
  // Faithful legacy port: 10 pts per word found.
  assert.equal(events[0].earnedPts, game._puzzle.placements.length * 10);
});

test('mount (no-DOM): wrong drag is rejected', () => {
  bus._reset();
  const game = mountWordSearchMiniGame({ bus, words: WORDS, rng: rngSeed(8), doc: null });
  assert.equal(game.submit({ r: 0, c: 0 }, { r: 7, c: 0 }), false);
});

test('mount: empty wordlist resolves as no-words fail (with explicit override)', async () => {
  bus._reset();
  const events = [];
  bus.on(WS_INTENT.RESULT, r => events.push(r));
  mountWordSearchMiniGame({ bus, words: [], doc: null });
  await Promise.resolve(); await Promise.resolve();
  // doc:null path returns the pure submit/finish API and doesn't auto-fail
  // on empty placements — instead the harness calls finish() manually.
  // Re-test with a DOM-backed stub so the auto-fail path fires.
});

test('mount (DOM stub): empty wordlist queues a no-words fail', async () => {
  bus._reset();
  const events = [];
  bus.on(WS_INTENT.RESULT, r => events.push(r));
  // Provide a minimal doc stub so the mount enters the DOM path.
  const docStub = {
    createElement: () => ({
      style: {}, classList: { add(){}, remove(){}, toggle(){} },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      appendChild() {}, addEventListener() {}, removeEventListener() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      remove() {},
      get innerHTML() { return ''; }, set innerHTML(_) {},
      get textContent() { return ''; }, set textContent(_) {},
    }),
    getElementById() { return null; },
    body: { appendChild() {} },
  };
  mountWordSearchMiniGame({ bus, words: [], doc: docStub });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'no-words');
});

test('default words fall back to the legacy HEBREW_WORD_POOL', () => {
  bus._reset();
  const game = mountWordSearchMiniGame({ bus, rng: rngSeed(5), doc: null });
  assert.ok(game._puzzle.placements.length > 0);
  for (const p of game._puzzle.placements) {
    assert.ok(HEBREW_WORD_POOL.includes(p.word), `${p.word} should be from the legacy pool`);
  }
});

test('throws if bus is missing or words option is not an array', () => {
  assert.throws(() => mountWordSearchMiniGame({}), /bus required/);
  assert.throws(() => mountWordSearchMiniGame({ bus, words: 'oops' }), /words/);
});

test('placeWords: sofit letters in input words are normalised to base forms in grid and p.word', () => {
  // 'שלום' ends with ם (mem sofit), 'מלך' ends with ך (kaf sofit).
  // Both should appear on the grid and in p.word with base-form letters (מ / כ).
  const sofitWords = ['שלום', 'מלך', 'בית'];
  const { grid, placements } = placeWords(sofitWords, { size: 8, rng: rngSeed(42) });
  const SOFIT = new Set(['ך', 'ם', 'ן', 'ף', 'ץ']);
  for (const row of grid) {
    for (const ch of row) {
      assert.ok(!SOFIT.has(ch), `grid cell should not contain sofit letter, got ${ch}`);
    }
  }
  for (const p of placements) {
    for (const ch of p.word) {
      assert.ok(!SOFIT.has(ch), `p.word should not contain sofit letter, got ${ch} in "${p.word}"`);
    }
  }
});
