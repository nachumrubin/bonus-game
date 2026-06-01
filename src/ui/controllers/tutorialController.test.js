import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { MENU_INTENT } from '../screens/menuScreen.js';
import { TUTORIAL_INTENT, TUTORIAL_OPEN, TUTORIAL_TIP } from '../screens/tutorialScreen.js';
import { GAME_SCREEN_INTENT } from '../screens/gameScreen.js';
import { DICT_INTENT } from '../screens/dictionaryScreen.js';
import { createTutorialController, EXTRA_STEP_ORDER } from './tutorialController.js';

test('menu replay opens the tutorial intro and start launches tutorial game', () => {
  bus._reset();
  let opened = 0;
  let starts = 0;
  const storage = new Map();
  bus.on(TUTORIAL_OPEN, () => { opened++; });
  createTutorialController({
    bus,
    startTutorialGame: () => { starts++; },
    storage: { setItem: (k, v) => storage.set(k, v) },
  });

  bus.emit(MENU_INTENT.OPEN_TUTORIAL, {});
  bus.emit(TUTORIAL_INTENT.START, {});
  assert.equal(opened, 1);
  assert.equal(starts, 1);
  assert.equal(storage.get('bonusGameTutSeen'), '1');
});

test('tutorial game events emit guided tips through bonus-square demo', () => {
  bus._reset();
  const tips = [];
  const clears = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  bus.on('tutorial/clear', () => clears.push(true));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלומי'] });

  // 3 actionable tips: first-move prompt, bonus-square prompt, completion.
  // Intermediate "יפה" / "תור הבוט" tips were removed in favor of a clear
  // after the first player move (no buttons → would otherwise flash).
  assert.equal(tips.length, 3);
  // First move shifted +1 column so 'י' can land ON the bonus square at (5,10).
  assert.ok(tips[0].selectors.includes('#c5_6'));
  assert.ok(tips[0].selectors.includes('#c5_9'));
  // Bonus prompt now points the player AT the bonus square (not adjacent).
  assert.ok(tips[1].selectors.includes('#bsq-10'));
  assert.ok(tips[1].selectors.includes('#brack[letter=י]'));
  // Completion tip auto-closes (no buttons exist to dismiss it).
  assert.match(tips[2].text, /הפעלת בונוס/);
  assert.ok(tips[2].autoCloseMs > 0, 'completion tip auto-closes');
  // The clear between firstMoveTip and bonusSquareTip fires explicitly.
  assert.ok(clears.length >= 1);
});

test('bot\'s second move transitions into extras phase and emits שאילתה tip first', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלום'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['לב'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, words: ['שלומי'] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, words: ['תו'] });

  // 4 tips: first, bonus, celebrate, shailta (first extra step)
  assert.equal(tips.length, 4);
  assert.match(tips[3].label, /שאילתה/);
  assert.equal(tips[3].showSkip, true);
});

test('SKIP_STEP advances through every extra step and ends with the exit tip', async () => {
  bus._reset();
  const tips = [];
  let screenShown = null;
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
    showScreen: (id) => { screenShown = id; },
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });

  // Skip through each extra step. After EXTRA_STEP_ORDER.length skips,
  // the next advance triggers the exit tip.
  for (let i = 0; i < EXTRA_STEP_ORDER.length; i++) {
    bus.emit(TUTORIAL_INTENT.SKIP_STEP, {});
  }
  // last tip should be the exit tip
  const last = tips[tips.length - 1];
  assert.match(last.label, /סיימת/);
  assert.ok(last.autoCloseMs > 0);

  await new Promise((r) => setTimeout(r, last.autoCloseMs + 100));
  assert.equal(screenShown, 'sh');
});

test('DICT_INTENT.OPEN_QUERY does NOT advance — only CLOSE does', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });

  const before = tips.length;
  bus.emit(DICT_INTENT.OPEN_QUERY, {});
  assert.equal(tips.length, before, 'opening the overlay alone must not advance');

  bus.emit(DICT_INTENT.CLOSE_QUERY, {});
  assert.ok(tips.length > before, 'closing the overlay advances to next step');
  assert.match(tips[tips.length - 1].label, /ביטול/);
});

test('TILES_EXCHANGED auto-advances the exchange step', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  // shailta and recall still pending — skip into exchange.
  bus.emit(TUTORIAL_INTENT.SKIP_STEP, {});                                            // shailta → recall
  bus.emit(TUTORIAL_INTENT.SKIP_STEP, {});                                            // recall → exchange
  const beforeCount = tips.length;
  bus.emit(EV.TILES_EXCHANGED, { slot: 0, letters: ['א'] });
  assert.ok(tips.length > beforeCount, 'exchange tip should advance on TILES_EXCHANGED');
  assert.match(tips[tips.length - 1].label, /נעילת/);
});

test('joker step: placing a joker tile (livePreview) redirects to שבץ tip', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  for (let i = 0; i < 4; i++) bus.emit(TUTORIAL_INTENT.SKIP_STEP, {}); // → joker
  assert.match(tips[tips.length - 1].label, /ג׳וקר/);

  // Player places the joker on the board (livePreview update with isJoker)
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [{ r: 7, c: 7, letter: 'א', isJoker: true }],
  });
  assert.match(tips[tips.length - 1].label, /אישור/);   // playButtonTip
  assert.ok(tips[tips.length - 1].selectors.includes('#btn-play'));

  // Player recalls the joker → revert to joker tip
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, { slot: 0, tiles: [] });
  assert.match(tips[tips.length - 1].label, /ג׳וקר/);
});

test('joker placement (MOVE_CONFIRMED with isJoker) advances the joker step', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 1 });
  // skip ahead to joker
  for (let i = 0; i < 4; i++) bus.emit(TUTORIAL_INTENT.SKIP_STEP, {});
  // Now on joker. Confirm a regular move (no joker) — should NOT advance.
  const before = tips.length;
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [{ r: 7, c: 7, letter: 'א', isJoker: false }] });
  assert.equal(tips.length, before, 'plain move should not advance joker step');
  // Confirm a joker move — should advance.
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [{ r: 7, c: 7, letter: 'א', isJoker: true }] });
  assert.ok(tips.length > before);
  assert.match(tips[tips.length - 1].label, /החלפת אות בלוח/);
});

test('live-preview matching all expected cells advances to the play-button tip', () => {
  bus._reset();
  const tips = [];
  bus.on(TUTORIAL_TIP, (p) => tips.push(p));
  createTutorialController({
    bus,
    activeGameRef: () => ({ session: { state: { mode: 'tutorial' } } }),
  });

  bus.emit(EV.GAME_STARTED, { mode: 'tutorial' });
  // Player has placed only 2 of the 4 expected tiles — no transition.
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [
      { r: 5, c: 6, letter: 'ש' },
      { r: 5, c: 7, letter: 'ל' },
    ],
  });
  assert.equal(tips.length, 1, 'no new tip while placement is incomplete');

  // Now all 4 tiles for שלום are placed → playButtonTip fires.
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [
      { r: 5, c: 6, letter: 'ש' },
      { r: 5, c: 7, letter: 'ל' },
      { r: 5, c: 8, letter: 'ו' },
      { r: 5, c: 9, letter: 'מ' },
    ],
  });
  assert.equal(tips.length, 2);
  assert.ok(tips[1].selectors.includes('#btn-play'));
  assert.match(tips[1].text, /שבץ/);

  // Same complete payload again should NOT re-emit (lastTipKey dedup).
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [
      { r: 5, c: 6, letter: 'ש' },
      { r: 5, c: 7, letter: 'ל' },
      { r: 5, c: 8, letter: 'ו' },
      { r: 5, c: 9, letter: 'מ' },
    ],
  });
  assert.equal(tips.length, 2);

  // Player recalls one tile → revert to firstMoveTip.
  bus.emit(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, {
    slot: 0,
    tiles: [
      { r: 5, c: 6, letter: 'ש' },
      { r: 5, c: 7, letter: 'ל' },
      { r: 5, c: 8, letter: 'ו' },
    ],
  });
  assert.equal(tips.length, 3);
  assert.ok(tips[2].selectors.includes('#c5_6'));
});
