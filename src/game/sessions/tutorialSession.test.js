import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { createLocalGameSession } from './localGameSession.js';
import {
  attachScriptedTutorialBot,
  buildTutorialFirstMove,
  seedTutorialRack,
  TUTORIAL_LETTERS,
  TUTORIAL_WORDS,
} from './tutorialSession.js';
import { addWordsFromText } from '../core/hebrewDictionary.js';

test('seedTutorialRack puts the guided letters at the front', () => {
  const state = {
    bag: ['ש', 'ל', 'ו', 'מ', 'א', 'ב', 'ג', 'ד'],
    racks: { 0: ['א', 'ב', 'ג', 'ד'] },
  };
  seedTutorialRack(state, 0);
  assert.deepEqual(state.racks[0].slice(0, 4), TUTORIAL_LETTERS);
  assert.equal(state.bag.includes('ש'), false);
});

test('scripted tutorial bot commits the first legacy tutorial response', () => {
  bus._reset();
  addWordsFromText(TUTORIAL_WORDS.join('\n'));
  const session = createLocalGameSession({
    bus,
    mode: 'tutorial',
    tileBagSeed: 'tutorial-test',
    players: { 0: { uid: 'p0' }, 1: { uid: 'bot' } },
    startingSlot: 0,
  });
  seedTutorialRack(session.state, 0);
  const bot = attachScriptedTutorialBot(session, { thinkingMs: 0, scheduler: (fn) => fn() });
  session.start();

  session.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: buildTutorialFirstMove() } });

  assert.equal(session.state.board[6][6].letter, 'ב');
  assert.equal(session.state.currentTurnSlot, 0);
  assert.equal(bot.nextMove, 1);
  assert.deepEqual(session.state.moveHistory.map(m => m.words[0]), ['שלומ', 'לב']);
});
