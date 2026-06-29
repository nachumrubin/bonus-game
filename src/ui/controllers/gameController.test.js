import { test, mock } from 'node:test';
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
  // place a single tile (no opening word will form because there's no other
  // tile). 'א' is in rack[0] so the move clears the placed-in-rack guard and
  // reaches the word-length check.
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  controller.confirmMove();
  // a single letter is too short; engine rejects with word-too-short
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

// ── Pending-tile recovery paths (GAP_REPORT.md item 2) ─────────────────
// `view.placed` is UI-only tentative state; the engine never sees it until
// confirmMove(). These tests prove the three known recovery paths clear the
// pending placement and leave the engine state coherent.

test('recovery: pending tiles clear when turn ends externally (timeout / pass / opponent claim)', () => {
  const { session, controller } = fresh({ mySlot: 0 });
  controller.placeTile({ r: 4, c: 4, letter: 'ג', val: 3, rackIndex: 2 });
  controller.placeTile({ r: 4, c: 5, letter: 'ד', val: 3, rackIndex: 3 });
  assert.equal(controller.view.placed.length, 2);

  // Simulate an external turn-end: timeout watchdog / manual pass / online
  // opponent claim all surface as TURN_CHANGED with no MOVE_CONFIRMED first.
  session.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'timeout' } });

  assert.equal(controller.view.placed.length, 0, 'pending placement cleared');
  assert.equal(controller.view.rackForMe.length, 8, 'rack untouched (engine never saw the placement)');
  assert.deepEqual(controller.view.rackForMe.sort(),
    ['א','ב','ג','ד','ה','ו','ז','ח'].sort(),
    'rack contents identical to start');
  assert.equal(controller.view.currentTurnSlot, 1, 'turn advanced');
  assert.equal(session.state.board[4][4], null, 'no tile committed to board');
  assert.equal(session.state.board[4][5], null, 'no tile committed to board');
});

test('recovery: invalid-word submit auto-passes after the shake animation and clears pending', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { session, controller } = fresh({ mySlot: 0 });
    // First move must touch center (4,4). 'בג' is not in DICT (only 'אב' is)
    // → engine emits INVALID_MOVE_REJECTED with reason 'word-not-in-dictionary'.
    controller.placeTile({ r: 4, c: 4, letter: 'ב', val: 3, rackIndex: 1 });
    controller.placeTile({ r: 4, c: 5, letter: 'ג', val: 3, rackIndex: 2 });
    controller.confirmMove();

    // Engine rejected the move synchronously; controller scheduled a 1100ms
    // auto-pass. Until the timer fires, placed tiles are intentionally still
    // visible so the player sees what was rejected.
    assert.equal(controller.view.lastInvalidReason, 'word-not-in-dictionary');
    assert.equal(controller.view.placed.length, 2, 'placed still visible during shake');
    assert.equal(controller.view.currentTurnSlot, 0, 'turn not yet advanced');

    // Advance the clock past the auto-pass delay.
    mock.timers.tick(1101);

    assert.equal(controller.view.placed.length, 0, 'pending placement cleared after shake');
    assert.equal(controller.view.rackForMe.length, 8, 'rack restored');
    assert.equal(controller.view.currentTurnSlot, 1, 'turn auto-passed');
    assert.equal(session.state.board[4][4], null, 'no tile committed to board');
    assert.equal(session.state.board[4][5], null, 'no tile committed to board');
  } finally {
    mock.timers.reset();
  }
});

// ── Intentional change: pending placements are UI-only (GAP_REPORT item 10) ─
// Pending tile placements live in the controller's view-model, not the engine
// state. This is intentional (registered in `docs/intentional-change-register.md`
// as "Pending tile placement ownership"). Consequence: if the controller is
// disposed (screen unmount, app backgrounded then re-init, etc.) and a fresh
// controller is created, the pending placement is lost — engine state was never
// touched, so the rack is intact and the player just re-places.
test('intentional change: disposing a controller discards pending placements; engine state untouched', () => {
  const { session, controller } = fresh({ mySlot: 0 });
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1, rackIndex: 0 });
  controller.placeTile({ r: 4, c: 5, letter: 'ב', val: 3, rackIndex: 1 });
  assert.equal(controller.view.placed.length, 2);
  // Snapshot engine state for comparison after dispose.
  const rackBefore = [...session.state.racks[0]];
  const boardBefore = session.state.board.map(row => row.map(t => t?.letter ?? null));

  controller.dispose();

  // Fresh controller (mimics screen remount). Pending placement is gone;
  // engine rack + board are exactly what they were before placeTile.
  const fresh2 = createGameController({ bus, session, mySlot: 0 });
  assert.equal(fresh2.view.placed.length, 0, 'pending placement was UI-only; gone on remount');
  assert.deepEqual([...session.state.racks[0]], rackBefore, 'rack untouched');
  assert.deepEqual(
    session.state.board.map(row => row.map(t => t?.letter ?? null)),
    boardBefore,
    'board untouched',
  );
  fresh2.dispose();
});

test('recovery: LOCK_PLACED bus event clears pending placement', () => {
  const { session, controller } = fresh({ mySlot: 0 });
  controller.placeTile({ r: 4, c: 4, letter: 'ה', val: 5, rackIndex: 4 });
  controller.placeTile({ r: 4, c: 5, letter: 'ו', val: 5, rackIndex: 5 });
  // Simulate a stale invalid-reason from a prior attempt so we can assert it
  // gets cleared along with the placement.
  controller.view.lastInvalidReason = 'has-gaps';
  assert.equal(controller.view.placed.length, 2);

  bus.emit(EV.LOCK_PLACED, { slot: 1, r: 7, c: 7, duration: 3 });

  assert.equal(controller.view.placed.length, 0, 'pending placement cleared');
  assert.equal(controller.view.lastInvalidReason, null, 'stale reject reason cleared');
  assert.equal(controller.view.rackForMe.length, 8, 'rack untouched');
});

console.log = _origLog;
