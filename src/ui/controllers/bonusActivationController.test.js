import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { CMD } from '../../events/commands.js';
import { BDEFS } from '../../game/boosts/data.js';
import {
  createBonusActivationController,
  BONUS_PENDING, BONUS_RESOLVED, MINIGAME_CLOSED,
} from './bonusActivationController.js';

function makeSession(state) {
  const dispatched = [];
  return {
    state,
    dispatch: (cmd) => dispatched.push(cmd),
    _dispatched: dispatched,
  };
}

function bonusAt(idx) {
  return { r: BDEFS[idx].br, c: BDEFS[idx].bc };
}

test('immediate (auto) bonus dispatches ACTIVATE_BOOST and does not emit BONUS_PENDING', () => {
  bus._reset();
  // Find a B2 (auto) slot in BONUS_TYPES then assign it to BDEFS[0]
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B2' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 3 });
  const pending = [];
  bus.on(BONUS_PENDING, (p) => pending.push(p));

  createBonusActivationController({ bus, session });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });

  assert.equal(pending.length, 0);
  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].type, CMD.ACTIVATE_BOOST);
  assert.equal(session._dispatched[0].payload.boostId, 'auto_extra_score');
  assert.equal(session._dispatched[0].payload.payload.extra, 20);
  assert.equal(session._dispatched[0].payload.slot, 0);
  assert.equal(session._dispatched[0].payload.turnNumber, 3);
});

test('future-effect bonus (B5 extraTurn) dispatches a future-effect ACTIVATE_BOOST', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B5' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 4 });
  createBonusActivationController({ bus, session });

  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, placed: [bonusAt(2)] });

  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].payload.boostId, 'extra_turn');
});

test('mini-game bonus emits BONUS_PENDING; resolveMiniGame(success) dispatches earnedPts', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B1' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 1 });
  const pending = []; const resolved = [];
  bus.on(BONUS_PENDING,  (p) => pending.push(p));
  bus.on(BONUS_RESOLVED, (p) => resolved.push(p));
  const ctl = createBonusActivationController({ bus, session });

  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });

  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'minigame');
  assert.equal(pending[0].miniGameKey, 'b1_unscramble_or_fillmiddle');
  // Engine has not been touched yet
  assert.equal(session._dispatched.length, 0);

  // Player wins the mini-game: resolveMiniGame STAGES the award but does not
  // finalize (or emit BONUS_RESOLVED) until the result screen is dismissed.
  ctl.resolveMiniGame({ success: true, earnedPts: 100 });
  assert.equal(session._dispatched.length, 0, 'no dispatch until the result screen closes');
  assert.equal(resolved.length, 0, 'BONUS_RESOLVED deferred until close');

  // Player dismisses the mini-game's own result screen → finalize + pass turn.
  bus.emit(MINIGAME_CLOSED, {});
  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].type, CMD.FINALIZE_BOOST_AWARD);
  assert.equal(session._dispatched[0].payload.extra, 100);
  assert.equal(resolved.at(-1).success, true);
});

test('mini-game failure finalizes the pending move with zero bonus on close', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B3' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 1 });
  const ctl = createBonusActivationController({ bus, session });

  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });
  ctl.resolveMiniGame({ success: false, earnedPts: 40 });
  assert.equal(session._dispatched.length, 0);

  bus.emit(MINIGAME_CLOSED, {});
  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].type, CMD.FINALIZE_BOOST_AWARD);
  assert.equal(session._dispatched[0].payload.extra, 0);
});

test('wheel points outcome folds into the finalize extra on close', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B13' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 5 });
  const pending = [];
  bus.on(BONUS_PENDING, (p) => pending.push(p));
  const ctl = createBonusActivationController({ bus, session });

  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(1)] });

  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'wheel');
  ctl.resolveWheel({ outcomeId: 'pts_50' });
  assert.equal(session._dispatched.length, 0, 'staged until the wheel result closes');

  bus.emit(MINIGAME_CLOSED, {});
  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].type, CMD.FINALIZE_BOOST_AWARD);
  assert.equal(session._dispatched[0].payload.extra, 50);
  assert.deepEqual(session._dispatched[0].payload.queueBoosts, []);
});

test('wheel future-effect outcome is queued via finalize (no award modal) on close', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B13' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 5 });
  const ctl = createBonusActivationController({ bus, session });

  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(1)] });
  ctl.resolveWheel({ outcomeId: 'extra_turn' });
  bus.emit(MINIGAME_CLOSED, {});

  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].type, CMD.FINALIZE_BOOST_AWARD);
  assert.equal(session._dispatched[0].payload.extra, 0);
  assert.equal(session._dispatched[0].payload.queueBoosts.length, 1);
  assert.equal(session._dispatched[0].payload.queueBoosts[0].boostId, 'extra_turn');
});

test('does not refire when the same MOVE_CONFIRMED slot reactivates', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B2' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 1 });
  createBonusActivationController({ bus, session });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });
  assert.equal(session._dispatched.length, 1);
});

test('respects state.bonusSqUsed (used slots are skipped)', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B2' });
  const session = makeSession({
    bonusAssignment,
    bonusSqUsed: { 0: true },
    turnNumber: 1,
  });
  createBonusActivationController({ bus, session });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });
  assert.equal(session._dispatched.length, 0);
});

test('multiple bonus activations in one move all fire', () => {
  bus._reset();
  const bonusAssignment = BDEFS.map(() => ({ type: 'B2' }));
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 1 });
  createBonusActivationController({ bus, session });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0), bonusAt(3)] });
  assert.equal(session._dispatched.length, 2);
});

test('dispose stops the controller from dispatching', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B2' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 1 });
  const ctl = createBonusActivationController({ bus, session });
  ctl.dispose();
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });
  assert.equal(session._dispatched.length, 0);
});

test('skipPending finalizes the bot bonus without an award overlay and emits BONUS_RESOLVED', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B1' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 7 });
  const resolved = [];
  bus.on(BONUS_RESOLVED, (p) => resolved.push(p));
  const ctl = createBonusActivationController({ bus, session });

  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, placed: [bonusAt(0)] });
  assert.equal(session._dispatched.length, 0);

  const out = ctl.skipPending({ earnedPts: 50 });
  assert.equal(out.ok, true);
  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].type, CMD.FINALIZE_BOOST_AWARD);
  assert.equal(session._dispatched[0].payload.slot, 1);
  assert.equal(session._dispatched[0].payload.extra, 50);
  assert.equal(resolved.at(-1).skipped, true);
  assert.equal(resolved.at(-1).earnedPts, 50);
});

test('skipPending on wheel pending also finalizes without opening UI', () => {
  bus._reset();
  const bonusAssignment = new Array(BDEFS.length).fill({ type: 'B13' });
  const session = makeSession({ bonusAssignment, bonusSqUsed: {}, turnNumber: 2 });
  const ctl = createBonusActivationController({ bus, session });

  bus.emit(EV.MOVE_CONFIRMED, { slot: 1, placed: [bonusAt(1)] });
  const out = ctl.skipPending({ earnedPts: 0 });
  assert.equal(out.ok, true);
  assert.equal(session._dispatched.length, 1);
  assert.equal(session._dispatched[0].type, CMD.FINALIZE_BOOST_AWARD);
  assert.equal(session._dispatched[0].payload.extra, 0);
});

test('falls back to BONUS_TYPES[idx % len] when bonusAssignment is empty', () => {
  bus._reset();
  // BONUS_TYPES[0] is B1 → minigame, so we should see a BONUS_PENDING
  const session = makeSession({ bonusAssignment: [], bonusSqUsed: {}, turnNumber: 1 });
  const pending = [];
  bus.on(BONUS_PENDING, (p) => pending.push(p));
  createBonusActivationController({ bus, session });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [bonusAt(0)] });
  assert.equal(pending.length, 1);
});
