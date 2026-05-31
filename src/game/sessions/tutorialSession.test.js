import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { createLocalGameSession } from './localGameSession.js';
import {
  attachScriptedTutorialBot,
  buildTutorialFirstMove,
  seedTutorialRack,
  seedTutorialBonusAssignment,
  TUTORIAL_BONUS_SLOT,
  TUTORIAL_LETTERS,
  TUTORIAL_WORDS,
} from './tutorialSession.js';
import { addWordsFromText } from '../core/hebrewDictionary.js';

test('seedTutorialBonusAssignment pins slot 10 to B3 without touching other slots', () => {
  const state = {
    bonusAssignment: Array.from({ length: 12 }, (_, i) => ({ type: `B${i + 1}`, pts: 10, ic: '?' })),
  };
  const originalSlot4 = state.bonusAssignment[4];
  seedTutorialBonusAssignment(state);
  assert.equal(TUTORIAL_BONUS_SLOT, 10);
  assert.equal(state.bonusAssignment[TUTORIAL_BONUS_SLOT].type, 'B3');
  assert.equal(state.bonusAssignment[TUTORIAL_BONUS_SLOT].pts, 40);
  // Other slots untouched.
  assert.equal(state.bonusAssignment[4], originalSlot4);
});

test('seedTutorialBonusAssignment no-ops when state has no bonusAssignment', () => {
  seedTutorialBonusAssignment({});                          // doesn't throw
  seedTutorialBonusAssignment({ bonusAssignment: null });   // doesn't throw
  seedTutorialBonusAssignment({ bonusAssignment: [] });     // too short → no-op
});

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

  // Bot's first scripted move is now ב at (6,7) — vertical "לב" with ל at (5,7).
  assert.equal(session.state.board[6][7].letter, 'ב');
  assert.equal(session.state.currentTurnSlot, 0);
  assert.equal(bot.nextMove, 1);
  assert.deepEqual(session.state.moveHistory.map(m => m.words[0]), ['שלומ', 'לב']);
});
