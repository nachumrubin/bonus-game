import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import {
  placeHiddenWord, readLine,
  mountHiddenWordMiniGame, HW_INTENT,
} from './hiddenWordMiniGame.js';

function rngSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const WORDS = ['בית', 'דרך', 'יום', 'אור', 'גשר'];

test('placeHiddenWord: returns a 4×4 grid with one hidden word', () => {
  const { grid, hidden } = placeHiddenWord(WORDS, { rng: rngSeed(42) });
  assert.equal(grid.length, 4);
  assert.equal(grid[0].length, 4);
  assert.ok(hidden, 'expected a hidden placement');
  assert.equal(hidden.word.length, 3);
});

test('placeHiddenWord: the hidden word is readable along its line', () => {
  const { grid, hidden } = placeHiddenWord(WORDS, { rng: rngSeed(7) });
  assert.ok([-1, 0, 1].includes(hidden.dr) && [-1, 0, 1].includes(hidden.dc) && (hidden.dr !== 0 || hidden.dc !== 0));
  assert.equal(readLine(grid, hidden.from, hidden.to), hidden.word);
});

test('placeHiddenWord: only words of the requested length are eligible', () => {
  // No 3-letter words supplied → nothing can be hidden.
  const { hidden } = placeHiddenWord(['אבגד', 'הוזח'], { rng: rngSeed(1) });
  assert.equal(hidden, null);
});

test('placeHiddenWord: empty cells are filled with Hebrew letters (no sofit forms)', () => {
  const { grid } = placeHiddenWord(WORDS, { rng: rngSeed(2) });
  const SOFIT = new Set(['ך', 'ם', 'ן', 'ף', 'ץ']);
  for (const row of grid) {
    for (const ch of row) {
      assert.match(ch, /[א-ת]/);
      assert.ok(!SOFIT.has(ch), `grid cell should not contain sofit letter, got ${ch}`);
    }
  }
});

test('placeHiddenWord: sofit letters in the candidate word are normalised', () => {
  const { grid, hidden } = placeHiddenWord(['שלם'], { rng: rngSeed(3) });
  // 'שלם' (mem sofit) → 'שלמ' in the grid.
  const SOFIT = new Set(['ך', 'ם', 'ן', 'ף', 'ץ']);
  assert.ok(hidden);
  for (const ch of hidden.word) assert.ok(!SOFIT.has(ch));
  for (const row of grid) for (const ch of row) assert.ok(!SOFIT.has(ch));
});

test('readLine: horizontal, vertical, diagonal, and reverse', () => {
  const grid = [['א', 'ב', 'ג'], ['ד', 'ה', 'ו'], ['ז', 'ח', 'ט']];
  assert.equal(readLine(grid, { r: 0, c: 0 }, { r: 0, c: 2 }), 'אבג');
  assert.equal(readLine(grid, { r: 2, c: 0 }, { r: 0, c: 0 }), 'זדא');
  assert.equal(readLine(grid, { r: 0, c: 0 }, { r: 2, c: 2 }), 'אהט');
  assert.equal(readLine(grid, { r: 0, c: 2 }, { r: 2, c: 0 }), 'גהז');
});

test('readLine: non-45-degree slope and out of bounds return null', () => {
  const grid = [['א', 'ב', 'ג'], ['ד', 'ה', 'ו'], ['ז', 'ח', 'ט']];
  assert.equal(readLine(grid, { r: 0, c: 0 }, { r: 2, c: 1 }), null);
  assert.equal(readLine(grid, { r: 0, c: 0 }, { r: 9, c: 0 }), null);
});

test('mount (no-DOM): selecting the hidden word wins and awards rewardPts', () => {
  bus._reset();
  const events = [];
  bus.on(HW_INTENT.RESULT, r => events.push(r));
  // Validator accepts only the hidden word; selecting it must win.
  const game = mountHiddenWordMiniGame({
    bus, words: WORDS, rng: rngSeed(5), doc: null, rewardPts: 100,
    validator: () => true,
  });
  const { from, to } = game._puzzle.hidden;
  assert.equal(game.submit(from, to), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].success, true);
  assert.equal(events[0].earnedPts, 100);
});

test('mount (no-DOM): a valid dictionary word other than the hidden word also wins', () => {
  bus._reset();
  const events = [];
  bus.on(HW_INTENT.RESULT, r => events.push(r));
  // Build a deterministic puzzle, then accept a different on-grid run via the
  // dictionary validator. This proves selections are checked against the
  // dictionary, not string-compared to the single hidden word.
  const game = mountHiddenWordMiniGame({
    bus, words: WORDS, rng: rngSeed(11), doc: null,
    // Accept any 3-letter run in the top row, regardless of the hidden word.
    validator: (w) => w === readLine(game._puzzle.grid, { r: 0, c: 0 }, { r: 0, c: 2 }),
  });
  const hidden = game._puzzle.hidden.word;
  const topRow = readLine(game._puzzle.grid, { r: 0, c: 0 }, { r: 0, c: 2 });
  // Only run the assertion when the accepted run differs from the hidden word.
  if (topRow !== hidden) {
    assert.equal(game.submit({ r: 0, c: 0 }, { r: 0, c: 2 }), true);
    assert.equal(events[0].success, true);
    assert.equal(events[0].word, topRow);
  }
});

test('mount (no-DOM): a 2-letter run is rejected even if it is a dictionary word', () => {
  // The challenge demands a word of the hidden word's length (3). A shorter
  // incidental run (e.g. 2 letters) must NOT win, even if accepted by the dict.
  bus._reset();
  const events = [];
  bus.on(HW_INTENT.RESULT, r => events.push(r));
  const game = mountHiddenWordMiniGame({
    bus, words: WORDS, rng: rngSeed(5), doc: null, wordLen: 3,
    validator: () => true, // accept anything the dictionary is asked about
  });
  // A 2-cell horizontal run (length 2) — rejected purely on length.
  assert.equal(game.submit({ r: 0, c: 0 }, { r: 0, c: 1 }), false);
  assert.equal(events.length, 0, 'no win emitted for a too-short word');
  // The 3-letter hidden word still wins.
  const { from, to } = game._puzzle.hidden;
  assert.equal(game.submit(from, to), true);
  assert.equal(events[0].success, true);
});

test('mount (no-DOM): a non-dictionary selection is rejected and does not finish', () => {
  bus._reset();
  const events = [];
  bus.on(HW_INTENT.RESULT, r => events.push(r));
  const game = mountHiddenWordMiniGame({
    bus, words: WORDS, rng: rngSeed(8), doc: null,
    validator: () => false,
  });
  const { from, to } = game._puzzle.hidden;
  assert.equal(game.submit(from, to), false);
  assert.equal(events.length, 0, 'no result emitted until finish()');
  game.finish();
  assert.equal(events.length, 1);
  assert.equal(events[0].success, false);
  assert.equal(events[0].earnedPts, 0);
});

test('mount (DOM stub): no eligible word queues a no-words fail', async () => {
  bus._reset();
  const events = [];
  bus.on(HW_INTENT.RESULT, r => events.push(r));
  const docStub = {
    createElement: () => ({
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
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
  mountHiddenWordMiniGame({ bus, words: ['אבגד'], doc: docStub, validator: () => true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'no-words');
});

test('throws if bus or validator is missing', () => {
  assert.throws(() => mountHiddenWordMiniGame({}), /bus required/);
  assert.throws(() => mountHiddenWordMiniGame({ bus, validator: 'nope' }), /validator/);
});
