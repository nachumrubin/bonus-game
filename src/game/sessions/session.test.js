// End-to-end test of localGameSession + attachBotPlayer.
// A full game runs autonomously: player 0 dispatches a confirm-move,
// player 1 (bot) responds, repeat until pass-pass ends the game.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { DICT, addWordsFromText } from '../core/hebrewDictionary.js';
import { createLocalGameSession } from './localGameSession.js';
import { attachBotPlayer } from './botGameSession.js';
import { setCommittedTile } from '../core/board.js';

// silence isValid logging
const _origLog = console.log;
console.log = () => {};

const players = { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } };

test('localGameSession.start fires GAME_STARTED', () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const session = createLocalGameSession({ bus, mode: 'offline-2p', tileBagSeed: 's1', players });
  let started = false;
  bus.on(EV.GAME_STARTED, () => { started = true; });
  session.start();
  assert.equal(started, true);
});

test('localGameSession.dispatch passes commands through to the engine', () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const session = createLocalGameSession({ bus, mode: 'offline-2p', tileBagSeed: 's2', players });
  session.state.racks[0] = ['א','ב','ג','ד','ה','ו','ז','ח'];

  const events = [];
  bus.on(EV.MOVE_CONFIRMED, p => events.push({ type: 'mv', p }));

  session.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
    },
  });
  assert.equal(events.length, 1);
  assert.equal(session.state.scores[0], 4);
});

test('attachBotPlayer: bot moves on its turn', () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const session = createLocalGameSession({ bus, mode: 'offline-solo', tileBagSeed: 'bot-e2e', players, startingSlot: 1 });
  session.state.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];

  attachBotPlayer(session, {
    slot: 1,
    wordList: ['אב'],
    isWordValid: () => true,
    thinkingMs: 0,
    scheduler: (fn) => fn(), // synchronous for testing
  });

  let moves = 0;
  bus.on(EV.MOVE_CONFIRMED, () => { moves++; });
  session.start();

  assert.equal(moves, 1);
  assert.equal(session.state.scores[1], 4); // 1 + 3 = 4
  assert.equal(session.state.currentTurnSlot, 0);
});

test('attachBotPlayer: getWordList is resolved when the bot acts', () => {
  bus._reset();
  DICT.clear();
  const alef = '\u05d0';
  const bet = '\u05d1';
  const word = `${alef}${bet}`;
  addWordsFromText(`${word}\n`);
  const session = createLocalGameSession({ bus, mode: 'offline-solo', tileBagSeed: 'bot-provider', players, startingSlot: 1 });
  session.state.racks[1] = [alef, bet, '\u05d2', '\u05d3', '\u05d4', '\u05d5', '\u05d6', '\u05d7'];

  let calls = 0;
  attachBotPlayer(session, {
    slot: 1,
    getWordList: () => { calls++; return [word]; },
    isWordValid: () => true,
    thinkingMs: 0,
    scheduler: (fn) => fn(),
  });

  session.start();

  assert.equal(calls, 1);
  assert.equal(session.state.scores[1], 4);
});

test('attachBotPlayer: forwards thinkingMs as the scheduler delay', () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const session = createLocalGameSession({ bus, mode: 'offline-solo', tileBagSeed: 'bot-think', players, startingSlot: 1 });
  session.state.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];

  const delays = [];
  attachBotPlayer(session, {
    slot: 1,
    wordList: ['אב'],
    isWordValid: () => true,
    thinkingMs: 5000, // hard-level delay
    scheduler: (fn, delay) => { delays.push(delay); fn(); },
  });
  session.start();

  assert.deepEqual(delays, [5000], 'the per-level thinkingMs is passed straight to the scheduler');
});

test('attachBotPlayer: passes when no valid move is available', () => {
  bus._reset();
  DICT.clear();
  const session = createLocalGameSession({ bus, mode: 'offline-solo', tileBagSeed: 'bot-pass', players, startingSlot: 1 });
  session.state.racks[1] = ['ת','ת','ת','ת','ת','ת','ת','ת'];

  attachBotPlayer(session, {
    slot: 1,
    wordList: ['אב'], // bot can't spell this with all-ת rack
    isWordValid: () => true,
    thinkingMs: 0,
    scheduler: (fn) => fn(),
  });

  session.start();
  assert.equal(session.state.passCount, 1);
  assert.equal(session.state.currentTurnSlot, 0);
});

test('attachBotPlayer: full game ends after six consecutive passes', () => {
  bus._reset();
  DICT.clear();
  const session = createLocalGameSession({ bus, mode: 'offline-solo', tileBagSeed: 'bot-end', players, startingSlot: 1 });
  // Both players have racks that can't form anything from the wordList → pass-pass ends game
  session.state.racks[0] = ['ת','ת','ת','ת','ת','ת','ת','ת'];
  session.state.racks[1] = ['ת','ת','ת','ת','ת','ת','ת','ת'];

  attachBotPlayer(session, {
    slot: 1,
    wordList: ['אב'],
    isWordValid: () => true,
    thinkingMs: 0,
    scheduler: (fn) => fn(),
  });

  let completed = null;
  bus.on(EV.GAME_COMPLETED, p => { completed = p; });

  session.start(); // bot passes (slot 1)
  for (let i = 0; i < 3 && session.state.status === 'playing'; i++) {
    session.dispatch({ type: CMD.PASS_TURN }); // human passes (slot 0)
  }

  assert.ok(completed);
  assert.equal(session.state.status, 'completed');
});

test('localGameSession.dispose removes bot subscriptions', () => {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const session = createLocalGameSession({ bus, mode: 'offline-solo', tileBagSeed: 'bot-disp', players, startingSlot: 1 });
  session.state.racks[1] = ['א','ב','ג','ד','ה','ו','ז','ח'];

  attachBotPlayer(session, {
    slot: 1,
    wordList: ['אב'],
    isWordValid: () => true,
    thinkingMs: 0,
    scheduler: (fn) => fn(),
  });
  session.dispose();

  let moves = 0;
  bus.on(EV.MOVE_CONFIRMED, () => { moves++; });

  // After dispose, even if we artificially fire TURN_CHANGED for bot, it should not act
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 2 });
  assert.equal(moves, 0);
});

console.log = _origLog;
