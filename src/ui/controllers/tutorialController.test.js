import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { MENU_INTENT } from '../screens/menuScreen.js';
import { TUTORIAL_INTENT, TUTORIAL_OPEN, TUTORIAL_TIP } from '../screens/tutorialScreen.js';
import { GAME_SCREEN_INTENT } from '../screens/gameScreen.js';
import { createTutorialController } from './tutorialController.js';
import { BONUS_RESOLVED } from './bonusActivationController.js';

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

  // After the bonus-tile move only 2 tips have fired (first + bonus prompt).
  // The completion tip is deferred until the mini-game resolves so it is not
  // hidden behind the .bz-overlay (z-index 9999 > #tut-tip z-index 8200).
  assert.equal(tips.length, 2, 'completion tip not yet shown before BONUS_RESOLVED');
  // First move shifted +1 column so 'י' can land ON the bonus square at (5,10).
  assert.ok(tips[0].selectors.includes('#c5_6'));
  assert.ok(tips[0].selectors.includes('#c5_9'));
  // Bonus prompt now points the player AT the bonus square (not adjacent).
  assert.ok(tips[1].selectors.includes('#bsq-10'));
  assert.ok(tips[1].selectors.includes('#brack[letter=י]'));

  // Mini-game completes → BONUS_RESOLVED → completion tip fires.
  bus.emit(BONUS_RESOLVED, { kind: 'minigame', slot: 0, success: true, earnedPts: 40 });
  assert.equal(tips.length, 3);
  assert.match(tips[2].text, /הפעלת בוסט/);
  assert.ok(tips[2].autoCloseMs > 0, 'completion tip auto-closes');
  // The clear between firstMoveTip and bonusSquareTip fires explicitly.
  assert.ok(clears.length >= 1);
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
