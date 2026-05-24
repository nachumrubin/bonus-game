import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { MENU_INTENT } from '../screens/menuScreen.js';
import { TUTORIAL_INTENT, TUTORIAL_OPEN, TUTORIAL_TIP } from '../screens/tutorialScreen.js';
import { createTutorialController } from './tutorialController.js';

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

test('tutorial game events emit guided tips', () => {
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

  assert.equal(tips.length, 3);
  assert.ok(tips[0].selectors.includes('#c5_5'));
  assert.match(tips[1].text, /שלום/);
  assert.ok(tips[2].selectors.includes('#game-grid'));
});
