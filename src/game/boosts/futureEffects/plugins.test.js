// Integration tests for the persistent-effect plugins through boostEngine.runHook.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { _resetAndRegister } from '../index.js';
import { runHook, TRIGGERS } from '../../core/boostEngine.js';

function fakeState({ slot = 0 } = {}) {
  return { currentTurnSlot: slot };
}

test('multiply_next_turns: ×2 on a 10-pt move yields 20 and decrements to 1 turn', () => {
  _resetAndRegister();
  const state = fakeState({ slot: 0 });
  const ctx = {
    state, score: 10,
    activeBoosts: [{
      slot: 0,
      boostId: 'multiply_next_turns',
      payload: { multiplier: 2, turnsRemaining: 2 },
      turnNumber: 1,
    }],
  };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 20);
  assert.equal(out.activeBoosts.length, 1);
  assert.equal(out.activeBoosts[0].payload.turnsRemaining, 1);
});

test('multiply_next_turns: last turn drops the entry', () => {
  _resetAndRegister();
  const ctx = {
    state: fakeState({ slot: 0 }),
    score: 5,
    activeBoosts: [{
      slot: 0,
      boostId: 'multiply_next_turns',
      payload: { multiplier: 4, turnsRemaining: 1 },
      turnNumber: 1,
    }],
  };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 20);
  assert.equal(out.activeBoosts.length, 0);
});

test('multiply_next_turns: ignored when wrong slot is on turn', () => {
  _resetAndRegister();
  const ctx = {
    state: fakeState({ slot: 1 }), // opponent's turn
    score: 10,
    activeBoosts: [{
      slot: 0, // multiplier owned by slot 0
      boostId: 'multiply_next_turns',
      payload: { multiplier: 3, turnsRemaining: 1 },
      turnNumber: 1,
    }],
  };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 10);
  // Entry preserved (canActivate returned false; not consumed)
  assert.equal(out.activeBoosts.length, 1);
});

test('auto_extra_score: adds extra to ctx.score and is consumed', () => {
  _resetAndRegister();
  const ctx = {
    state: fakeState({ slot: 0 }),
    score: 7,
    activeBoosts: [{
      slot: 0, boostId: 'auto_extra_score', payload: { extra: 25 }, turnNumber: 2,
    }],
  };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 32);
  assert.equal(out.activeBoosts.length, 0);
});

test('auto_extra_score: multiple stack on the same move', () => {
  _resetAndRegister();
  const ctx = {
    state: fakeState({ slot: 0 }),
    score: 0,
    activeBoosts: [
      { slot: 0, boostId: 'auto_extra_score', payload: { extra: 20 }, turnNumber: 2 },
      { slot: 0, boostId: 'auto_extra_score', payload: { extra: 25 }, turnNumber: 2 },
    ],
  };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 45);
  assert.equal(out.activeBoosts.length, 0);
});

test('extra_turn: sets ctx.repeatTurn = true on the booster\'s turn-end', () => {
  _resetAndRegister();
  const ctx = {
    endingSlot: 1,
    activeBoosts: [{ slot: 1, boostId: 'extra_turn', payload: {}, turnNumber: 4 }],
  };
  const out = runHook(TRIGGERS.ON_TURN_END, ctx);
  assert.equal(out.repeatTurn, true);
  assert.equal(out.activeBoosts.length, 0);
});

test('skip_opponent_turn: sets ctx.skipTurn when the opponent is about to play', () => {
  _resetAndRegister();
  const ctx = {
    startingSlot: 0, // opponent (booster is slot 1)
    activeBoosts: [{ slot: 1, boostId: 'skip_opponent_turn', payload: {}, turnNumber: 3 }],
  };
  const out = runHook(TRIGGERS.ON_TURN_START, ctx);
  assert.equal(out.skipTurn, true);
  assert.equal(out.activeBoosts.length, 0);
});

test('skip_opponent_turn: does not fire on the booster\'s own turn-start', () => {
  _resetAndRegister();
  const ctx = {
    startingSlot: 1, // booster's own turn
    activeBoosts: [{ slot: 1, boostId: 'skip_opponent_turn', payload: {}, turnNumber: 3 }],
  };
  const out = runHook(TRIGGERS.ON_TURN_START, ctx);
  assert.notEqual(out.skipTurn, true);
  assert.equal(out.activeBoosts.length, 1);
});

test('cancel_next_opponent_bonus: fires when opponent places a tile on a bonus square', () => {
  _resetAndRegister();
  const ctx = {
    state: fakeState({ slot: 1 }), // opponent's turn
    placed: [{ r: -1, c: 1, letter: 'א', val: 1 }], // BDEFS top slot
    activeBoosts: [{ slot: 0, boostId: 'cancel_next_opponent_bonus', payload: {}, turnNumber: 2 }],
  };
  const out = runHook(TRIGGERS.AFTER_MOVE_VALIDATE, ctx);
  assert.equal(out.suppressBonus, true);
  assert.equal(out.activeBoosts.length, 0);
});

test('cancel_next_opponent_bonus: does not fire when no bonus square is touched', () => {
  _resetAndRegister();
  const ctx = {
    state: fakeState({ slot: 1 }),
    placed: [{ r: 4, c: 4, letter: 'א', val: 1 }],
    activeBoosts: [{ slot: 0, boostId: 'cancel_next_opponent_bonus', payload: {}, turnNumber: 2 }],
  };
  const out = runHook(TRIGGERS.AFTER_MOVE_VALIDATE, ctx);
  assert.notEqual(out.suppressBonus, true);
  assert.equal(out.activeBoosts.length, 1);
});

test('timer_bonus: extends turnDeadlineMs on the booster\'s next turn-start', () => {
  _resetAndRegister();
  const ctx = {
    startingSlot: 0,
    turnDeadlineMs: 1_000_000,
    activeBoosts: [{ slot: 0, boostId: 'timer_bonus', payload: { seconds: 10 }, turnNumber: 5 }],
  };
  const out = runHook(TRIGGERS.ON_TURN_START, ctx);
  assert.equal(out.turnDeadlineMs, 1_010_000);
  assert.equal(out.activeBoosts.length, 0);
});
