import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { DICT, addWordsFromText } from '../../game/core/hebrewDictionary.js';
import { createLocalGameSession } from '../../game/sessions/localGameSession.js';
import { createGameController } from './gameController.js';

const _origLog = console.log;
console.log = () => {};

const PLAYERS = { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } };

function fresh({ mySlot = 0 } = {}) {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\n');
  const session = createLocalGameSession({
    bus, mode: 'offline-2p', tileBagSeed: 'gc-test', players: PLAYERS,
  });
  session.state.racks[0] = ['א','ב','ג','ד','ה','ו','ז','ח'];
  session.state.racks[1] = ['ט','י','כ','ל','מ','נ','ס','ע'];
  const controller = createGameController({ bus, session, mySlot });
  return { session, controller };
}

test('view-model reflects initial state on creation', () => {
  const { controller } = fresh({ mySlot: 0 });
  assert.equal(controller.view.scores[0], 0);
  assert.equal(controller.view.currentTurnSlot, 0);
  assert.equal(controller.view.isMyTurn, true);
  assert.equal(controller.view.rackForMe.length, 8);
  assert.equal(controller.view.status, 'playing');
});

test('placeTile / recallTile / recallAll mutate the placed list and notify listeners', () => {
  const { controller } = fresh();
  const updates = [];
  controller.onChange(v => updates.push([...v.placed]));
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  controller.placeTile({ r: 4, c: 5, letter: 'ב', val: 3 });
  controller.recallTile(4, 4);
  controller.recallAll();
  assert.equal(updates.length, 4);
  assert.equal(updates[1].length, 2);
  assert.equal(updates[2].length, 1);
  assert.equal(updates[3].length, 0);
});

test('confirmMove dispatches CONFIRM_MOVE with the placed tiles', () => {
  const { session, controller } = fresh();
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  controller.placeTile({ r: 4, c: 5, letter: 'ב', val: 3 });
  controller.confirmMove();
  assert.equal(session.state.scores[0], 4);
  assert.equal(session.state.currentTurnSlot, 1);
});

test('view-model updates when MOVE_CONFIRMED fires', () => {
  const { session, controller } = fresh();
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  controller.placeTile({ r: 4, c: 5, letter: 'ב', val: 3 });
  controller.confirmMove();
  assert.equal(controller.view.scores[0], 4);
  assert.equal(controller.view.currentTurnSlot, 1);
  // After confirm, placed should be cleared
  assert.equal(controller.view.placed.length, 0);
  // lastMove records what just happened
  assert.equal(controller.view.lastMove?.score, 4);
});

test('INVALID_MOVE_REJECTED sets lastInvalidReason on the view', () => {
  const { controller } = fresh();
  // place a single tile (no opening word will form because there's no other tile)
  controller.placeTile({ r: 4, c: 4, letter: 'ת', val: 4 });
  controller.confirmMove();
  // 'ת' alone is one letter; engine rejects with word-too-short
  assert.equal(controller.view.lastInvalidReason, 'word-too-short');
});

test('passTurn forwards through session', () => {
  const { session, controller } = fresh();
  controller.passTurn();
  assert.equal(session.state.passCount, 1);
  assert.equal(controller.view.currentTurnSlot, 1);
});

test('exchangeTiles forwards the letters list', () => {
  const { session, controller } = fresh();
  controller.exchangeTiles(['א', 'ב']);
  assert.equal(session.state.currentTurnSlot, 1);
  assert.equal(session.state.racks[0].length, 8);
});

test('setPlacementDirection updates the view-model', () => {
  const { controller } = fresh();
  assert.equal(controller.view.placementDirection, 'H');
  controller.setPlacementDirection('V');
  assert.equal(controller.view.placementDirection, 'V');
  controller.setPlacementDirection('bad');
  assert.equal(controller.view.placementDirection, 'H');
});

test('placeLock forwards through session and syncs lock state', () => {
  const { session, controller } = fresh();
  controller.placeLock({ r: 4, c: 4, duration: 3 });
  assert.equal(session.state.currentTurnSlot, 1);
  assert.deepEqual(controller.view.lockInventory[0], [3, 5]);
  assert.equal(controller.view.lockedCells.length, 1);
  assert.equal(controller.view.lockedCells[0].remainingTurns, 3);
});

test('placeTile refuses locked cells in the tentative UI', () => {
  const { session, controller } = fresh();
  session.state.lockedCells = [{ id: 'lock-1', r: 4, c: 4, ownerSlot: 1, remainingTurns: 1 }];
  bus.emit(EV.LOCKS_CHANGED, {});
  const placed = controller.placeTile({ r: 4, c: 4, letter: 'A', val: 1 });
  assert.equal(placed, false);
  assert.equal(controller.view.placed.length, 0);
  assert.equal(controller.view.lastInvalidReason, 'cell-locked');
});

test('resign ends the game', () => {
  const { session, controller } = fresh();
  controller.resign();
  assert.equal(session.state.status, 'abandoned');
});

test('dispose removes subscriptions', () => {
  const { session, controller } = fresh();
  let updates = 0;
  controller.onChange(() => { updates++; });
  controller.dispose();
  // Manual emit after dispose: should be ignored
  bus.emit(EV.SCORE_CHANGED, { slot: 0, score: 999 });
  assert.equal(updates, 0);
});

console.log = _origLog;
