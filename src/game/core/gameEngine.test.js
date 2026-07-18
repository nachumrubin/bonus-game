// End-to-end test of the engine via dispatch().
// Uses a tiny test dictionary seeded into the module-level DICT.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { createEngine, createInitialState } from './gameEngine.js';
import { DICT, addWordsFromText } from './hebrewDictionary.js';
import { setCommittedTile } from './board.js';
import { _resetAndRegister as resetBoostRegistry } from '../boosts/index.js';

// Silence isValid's logging during tests
const _origLog = console.log;
console.log = () => {};

function seedDict(words) {
  DICT.clear();
  addWordsFromText(words.join('\n'));
}

function freshEngine() {
  bus._reset();
  const state = createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'engine-test-seed',
    players: { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } },
  });
  const eng = createEngine({ state, bus });
  return { state, eng };
}

test('createInitialState seeds bonusAssignment with shuffled unique types incl. B11/B12/B13', () => {
  const types = new Set();
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
    const s = createInitialState({
      mode: 'offline-solo',
      tileBagSeed: seed,
      players: { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } },
    });
    assert.equal(s.bonusAssignment.length, 12,
      'every game has exactly 12 bonus slots populated');
    for (const entry of s.bonusAssignment) types.add(entry.type);
  }
  // Across enough seeds, the rare end-of-list types should appear at least once.
  for (const t of ['B11', 'B12', 'B13', 'B14']) {
    assert.ok(types.has(t), `${t} should appear in some bonus assignment across seeds`);
  }
});

function captureEvents() {
  const events = [];
  for (const [, t] of Object.entries(EV)) {
    bus.on(t, (payload) => events.push({ type: t, payload }));
  }
  return events;
}

test('GAME_STARTED fires when start() is called', () => {
  const { eng } = freshEngine();
  const events = captureEvents();
  eng.start();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, EV.GAME_STARTED);
});

test('CONFIRM_MOVE with a valid first-move horizontal placement commits and advances turn', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
    },
  });

  const types = events.map(e => e.type);
  assert.ok(types.includes(EV.MOVE_CONFIRMED));
  assert.ok(types.includes(EV.SCORE_CHANGED));
  assert.ok(types.includes(EV.TURN_CHANGED));
  assert.equal(state.scores[0], 4); // 1 + 3
  assert.equal(state.currentTurnSlot, 1);
  assert.equal(state.firstMove, false);
  assert.equal(state.moveHistory.length, 1);
});

test('CONFIRM_MOVE rejects when validator fails (gap)', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 6, letter: 'ב', val: 3 },
      ],
    },
  });

  const evt = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(evt);
  assert.equal(evt.payload.reason, 'has-gaps');
  assert.equal(state.firstMove, true); // unchanged
});

test('CONFIRM_MOVE rejects when a formed word is not in the dictionary', () => {
  seedDict(['אב']); // does NOT include 'גד'
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'ג', val: 5 },
        { r: 4, c: 5, letter: 'ד', val: 3 },
      ],
    },
  });

  const evt = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(evt);
  assert.equal(evt.payload.reason, 'word-not-in-dictionary');
});

test('CONFIRM_MOVE accepts legacy exact dictionary word מפורשת even if HebrewValidator rejects it', () => {
  seedDict(['מפורשת']);
  const previousValidator = globalThis.HebrewValidator;
  try {
    globalThis.HebrewValidator = {
      ready: true,
      validate: () => ({ valid: false, reason: 'stub-reject' }),
    };

    const { state, eng } = freshEngine();
    const events = captureEvents();
    state.currentTurnSlot = 0;
    state.racks[0] = ['מ', 'פ', 'ו', 'ר', 'ש', 'ת', 'א', 'ב'];

    eng.dispatch({
      type: CMD.CONFIRM_MOVE,
      payload: {
        placed: [
          { r: 4, c: 2, letter: 'מ', val: 2 },
          { r: 4, c: 3, letter: 'פ', val: 5 },
          { r: 4, c: 4, letter: 'ו', val: 1 },
          { r: 4, c: 5, letter: 'ר', val: 2 },
          { r: 4, c: 6, letter: 'ש', val: 3 },
          { r: 4, c: 7, letter: 'ת', val: 4 },
        ],
      },
    });

    assert.ok(events.some(e => e.type === EV.MOVE_CONFIRMED));
    assert.ok(!events.some(e => e.type === EV.INVALID_MOVE_REJECTED));
    assert.equal(state.board[4][2].letter, 'מ');
    assert.equal(state.currentTurnSlot, 1);
  } finally {
    if (previousValidator) globalThis.HebrewValidator = previousValidator;
    else delete globalThis.HebrewValidator;
  }
});

test('PASS_TURN advances turn and increments passCount', () => {
  const { state, eng } = freshEngine();
  state.currentTurnSlot = 0;
  eng.dispatch({ type: CMD.PASS_TURN });
  assert.equal(state.currentTurnSlot, 1);
  assert.equal(state.passCount, 1);
});

test('four consecutive passes complete the game (May 2026 threshold)', () => {
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.scores = { 0: 30, 1: 10 };
  for (let i = 0; i < 4; i++) eng.dispatch({ type: CMD.PASS_TURN });
  const evt = events.find(e => e.type === EV.GAME_COMPLETED);
  assert.ok(evt);
  assert.equal(evt.payload.winnerSlot, 0);
  assert.equal(state.status, 'completed');
});

test('CLAIM_STALL_END ends the game with the leader as winner once threshold met', () => {
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.scores = { 0: 50, 1: 10 };
  state.passCount = 2;
  state.currentTurnSlot = 0;
  eng.dispatch({ type: CMD.CLAIM_STALL_END, payload: { slot: 0 } });
  const evt = events.find(e => e.type === EV.GAME_COMPLETED);
  assert.ok(evt);
  assert.equal(evt.payload.winnerSlot, 0);
  assert.equal(state.status, 'completed');
  assert.equal(state.endReason, 'stall-claim');
  assert.equal(state.claimedBy, 0);
});

test('CLAIM_STALL_END from the trailing player is rejected', () => {
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.scores = { 0: 50, 1: 10 };
  state.passCount = 2;
  eng.dispatch({ type: CMD.CLAIM_STALL_END, payload: { slot: 1 } });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(rejected);
  assert.equal(state.status !== 'completed', true);
});

test('CLAIM_STALL_END before the stall threshold is rejected', () => {
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.scores = { 0: 50, 1: 10 };
  state.passCount = 1;
  eng.dispatch({ type: CMD.CLAIM_STALL_END, payload: { slot: 0 } });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(rejected);
  assert.equal(state.status !== 'completed', true);
});

test('RESIGN_GAME ends with the other slot as winner', () => {
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.scores = { 0: 30, 1: 10 };
  state.currentTurnSlot = 0;
  eng.dispatch({ type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  const evt = events.find(e => e.type === EV.GAME_COMPLETED);
  assert.ok(evt);
  assert.equal(evt.payload.winnerSlot, 1);
  assert.equal(state.status, 'abandoned');
});

test('EXCHANGE_TILE swaps tiles and advances turn', () => {
  const { state, eng } = freshEngine();
  state.currentTurnSlot = 0;
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  const events = captureEvents();
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א', 'ב'] } });
  assert.equal(state.racks[0].length, 8);
  assert.equal(state.currentTurnSlot, 1);
  assert.ok(events.some(e => e.type === EV.TILES_EXCHANGED));
});

test('EXCHANGE_TILE with freeSwap consumes free_tile_swap boost without advancing turn', () => {
  const { state, eng } = freshEngine();
  state.currentTurnSlot = 0;
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.activeBoosts = [{ slot: 0, boostId: 'free_tile_swap', payload: {}, turnNumber: 1 }];
  const turnBefore = state.turnNumber;
  const events = captureEvents();
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א'], freeSwap: true } });
  assert.equal(state.racks[0].length, 8);
  assert.equal(state.currentTurnSlot, 0, 'turn must not advance on free swap');
  assert.equal(state.turnNumber, turnBefore);
  assert.equal(state.activeBoosts.length, 0, 'boost should be consumed');
  const exch = events.find(e => e.type === EV.TILES_EXCHANGED);
  assert.ok(exch);
  assert.equal(exch.payload.free, true);
  assert.ok(!events.some(e => e.type === EV.TURN_CHANGED), 'no TURN_CHANGED on free swap');
  assert.ok(events.some(e => e.type === EV.BOOST_ACTIVATED && e.payload.consumed === true));
});

test('EXCHANGE_TILE with freeSwap is rejected when no boost is banked', () => {
  const { state, eng } = freshEngine();
  state.currentTurnSlot = 0;
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.activeBoosts = [];
  const events = captureEvents();
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א'], freeSwap: true } });
  assert.equal(state.racks[0].length, 8, 'rack unchanged');
  assert.equal(state.currentTurnSlot, 0, 'turn unchanged');
  const rej = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(rej);
  assert.equal(rej.payload.reason, 'free-swap-unavailable');
});

test('EXCHANGE_TILE with freeSwap ignores boost belonging to opponent slot', () => {
  const { state, eng } = freshEngine();
  state.currentTurnSlot = 0;
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.activeBoosts = [{ slot: 1, boostId: 'free_tile_swap', payload: {}, turnNumber: 1 }];
  const events = captureEvents();
  eng.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: ['א'], freeSwap: true } });
  assert.equal(state.activeBoosts.length, 1, 'opponent boost must remain');
  const rej = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rej?.payload?.reason, 'free-swap-unavailable');
});

test('PLACE_LOCK consumes inventory, blocks the cell, and advances turn', () => {
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.currentTurnSlot = 0;

  eng.dispatch({ type: CMD.PLACE_LOCK, payload: { r: 4, c: 4, duration: 3 } });

  assert.equal(state.currentTurnSlot, 1);
  assert.deepEqual(state.lockInventory[0], [3, 5]);
  assert.equal(state.lockedCells.length, 1);
  assert.equal(state.lockedCells[0].remainingTurns, 3);
  assert.ok(events.some(e => e.type === EV.LOCK_PLACED));
  assert.ok(events.some(e => e.type === EV.LOCKS_CHANGED));
});

// ─── Word + lock in a single turn (CONFIRM_MOVE payload.lock) ───────────

test('CONFIRM_MOVE with a lock commits word and lock together in one turn', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
      lock: { r: 7, c: 7, duration: 3 },
    },
  });

  assert.ok(events.some(e => e.type === EV.MOVE_CONFIRMED), 'the word scores');
  assert.ok(state.scores[0] > 0);
  assert.equal(state.lockedCells.length, 1, 'the lock landed');
  assert.equal(state.lockedCells[0].remainingTurns, 3, 'fresh lock keeps its full duration');
  assert.equal(state.lockedCells[0].ownerSlot, 0);
  assert.deepEqual(state.lockInventory[0], [3, 5], 'exactly one lock spent');
  assert.equal(state.currentTurnSlot, 1, 'the turn advances exactly once');
  assert.equal(state.turnNumber, 2);
  // The online session commits on LOCK_PLACED; emitting it here as well as
  // MOVE_CONFIRMED would push the same turn to Firebase twice.
  assert.equal(events.filter(e => e.type === EV.LOCK_PLACED).length, 0,
    'combined move must not emit LOCK_PLACED — MOVE_CONFIRMED already commits it');
  assert.ok(events.some(e => e.type === EV.LOCKS_CHANGED), 'lock state still broadcast');
});

test('CONFIRM_MOVE with a lock: a rejected word leaves the lock unspent', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      // גד is not in the dictionary — the whole turn must be refused.
      placed: [
        { r: 4, c: 4, letter: 'ג', val: 1 },
        { r: 4, c: 5, letter: 'ד', val: 3 },
      ],
      lock: { r: 7, c: 7, duration: 3 },
    },
  });

  const rej = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rej?.payload?.reason, 'word-not-in-dictionary');
  assert.equal(state.lockedCells.length, 0, 'no lock on the board');
  assert.deepEqual(state.lockInventory[0], [3, 3, 5], 'inventory untouched — lock is not burned');
  assert.equal(state.currentTurnSlot, 0, 'still the same player to move');
});

test('CONFIRM_MOVE with an unavailable lock rejects before the word is applied', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;
  state.lockInventory[0] = [5];

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
      lock: { r: 7, c: 7, duration: 3 },
    },
  });

  const rej = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rej?.payload?.reason, 'lock-unavailable');
  assert.equal(state.scores[0], 0, 'the word must not score');
  assert.equal(state.board[4][4], null, 'the board must be untouched');
  assert.deepEqual(state.racks[0], ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'], 'rack untouched');
  assert.equal(state.currentTurnSlot, 0);
});

test('CONFIRM_MOVE rejects a lock on a cell the same move fills', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
      lock: { r: 4, c: 5, duration: 3 },
    },
  });

  const rej = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rej?.payload?.reason, 'lock-cell-occupied');
  assert.equal(state.lockedCells.length, 0);
  assert.deepEqual(state.lockInventory[0], [3, 3, 5]);
});

test('CONFIRM_MOVE with a lock ticks existing locks but not the new one', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;
  state.lockedCells = [
    { id: 'old', r: 9, c: 9, ownerSlot: 1, remainingTurns: 2 },
  ];

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
      lock: { r: 7, c: 7, duration: 3 },
    },
  });

  const oldLock = state.lockedCells.find(l => l.r === 9 && l.c === 9);
  const newLock = state.lockedCells.find(l => l.r === 7 && l.c === 7);
  assert.equal(oldLock?.remainingTurns, 1, 'existing lock counts down like any move turn');
  assert.equal(newLock?.remainingTurns, 3, 'the lock placed this turn is exempt from its own tick');
});

// When a move lands on a bonus square, scoring (and the turn advance) defer
// until FINALIZE_BOOST_AWARD. A lock riding on that move must survive the wait
// and land on the far side of the deferred tick, exactly like the direct path.
test('FINALIZE_BOOST_AWARD places a deferred word+lock move\'s lock after the tick', () => {
  const { state, eng } = freshEngine();
  state.currentTurnSlot = 0;
  state.lockedCells = [{ id: 'old', r: 9, c: 9, ownerSlot: 1, remainingTurns: 2 }];
  // Stand in for a CONFIRM_MOVE that deferred its score for a bonus award.
  state.pendingScoreCommit = {
    slot: 0,
    baseScore: 10,
    multiplier: 1,
    historyIndex: -1,
    movePayload: { slot: 0, placed: [], words: [] },
    lock: { r: 7, c: 7, duration: 3, slot: 0 },
  };

  eng.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, extra: 5 } });

  assert.equal(state.scores[0], 15, 'base + bonus committed');
  const newLock = state.lockedCells.find(l => l.r === 7 && l.c === 7);
  assert.equal(newLock?.remainingTurns, 3, 'deferred lock keeps its full duration');
  assert.equal(newLock?.ownerSlot, 0);
  assert.deepEqual(state.lockInventory[0], [3, 5], 'inventory spent once, at finalize');
  const oldLock = state.lockedCells.find(l => l.r === 9 && l.c === 9);
  assert.equal(oldLock?.remainingTurns, 1, 'existing lock still ticked');
  assert.equal(state.currentTurnSlot, 1);
});

test('FINALIZE_BOOST_AWARD without a lock leaves the inventory alone', () => {
  const { state, eng } = freshEngine();
  state.currentTurnSlot = 0;
  state.pendingScoreCommit = {
    slot: 0, baseScore: 10, multiplier: 1, historyIndex: -1,
    movePayload: { slot: 0, placed: [], words: [] },
    lock: null,
  };

  eng.dispatch({ type: CMD.FINALIZE_BOOST_AWARD, payload: { slot: 0, extra: 5 } });

  assert.equal(state.lockedCells.length, 0);
  assert.deepEqual(state.lockInventory[0], [3, 3, 5]);
});

test('CONFIRM_MOVE without a lock is unaffected', () => {
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
    },
  });

  assert.equal(state.lockedCells.length, 0);
  assert.deepEqual(state.lockInventory[0], [3, 3, 5], 'no lock spent when none requested');
  assert.ok(state.scores[0] > 0);
});

test('locked cells reject tile placement until countdown expires', () => {
  seedDict(['׳׳‘']);
  const { state, eng } = freshEngine();
  const events = captureEvents();
  state.racks[0] = ['׳', '׳‘', '׳’', '׳“', '׳”', '׳•', '׳–', '׳—'];
  state.currentTurnSlot = 0;
  state.lockInventory[0] = [1];

  eng.dispatch({ type: CMD.PLACE_LOCK, payload: { r: 4, c: 4, duration: 1 } });
  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: '׳', val: 1 },
        { r: 4, c: 5, letter: '׳‘', val: 3 },
      ],
    },
  });

  const rejected = events.findLast?.(e => e.type === EV.INVALID_MOVE_REJECTED)
    ?? [...events].reverse().find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rejected?.payload?.reason, 'cell-locked');

  eng.dispatch({ type: CMD.PASS_TURN });
  assert.equal(state.lockedCells.length, 0);
});

test('CONFIRM_MOVE with extra_turn boost banked keeps the same player on turn', () => {
  resetBoostRegistry();
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;
  state.activeBoosts = [{ slot: 0, boostId: 'extra_turn', payload: {}, turnNumber: 1 }];
  const turnBefore = state.turnNumber;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
    },
  });

  assert.equal(state.currentTurnSlot, 0, 'extra_turn must keep the same player');
  assert.equal(state.turnNumber, turnBefore, 'turn number should not advance on a repeat turn');
  assert.equal(state.activeBoosts.length, 0, 'extra_turn entry is consumed after firing');
});

// Regression guard for the reported "×2 boost triples the score" bug. The
// multiplier must scale the committed score by EXACTLY its factor — base 4
// → 8 for ×2, → 16 for ×4 — never base + factor·base (which would be ×3 / ×5).
test('CONFIRM_MOVE with an active ×2 multiplier scores exactly 2× (not 3×)', () => {
  resetBoostRegistry();
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;
  state.activeBoosts = [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 2, turnsRemaining: 1 }, turnNumber: 1 }];

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }] },
  });

  assert.equal(state.scores[0], 8, 'base 4 × 2 === 8 (a ×3 result of 12 is the bug)');
  assert.equal(state.activeBoosts.length, 0, 'single-turn multiplier is consumed');
});

test('CONFIRM_MOVE with an active ×4 multiplier scores exactly 4×', () => {
  resetBoostRegistry();
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;
  state.activeBoosts = [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 4, turnsRemaining: 1 }, turnNumber: 1 }];

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }] },
  });

  assert.equal(state.scores[0], 16, 'base 4 × 4 === 16');
});

test('a ×2 multiplier owned by the opponent does NOT scale my move', () => {
  resetBoostRegistry();
  seedDict(['אב']);
  const { state, eng } = freshEngine();
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;
  // Boost belongs to slot 1; slot 0 is playing → it must not fire.
  state.activeBoosts = [{ slot: 1, boostId: 'multiply_next_turns', payload: { multiplier: 2, turnsRemaining: 1 }, turnNumber: 1 }];

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }] },
  });

  assert.equal(state.scores[0], 4, 'opponent multiplier must not apply to my score');
  assert.equal(state.activeBoosts.length, 1, 'opponent multiplier remains until their turn');
});

test('CONFIRM_MOVE with a tile swap returns the displaced letter to the rack', () => {
  resetBoostRegistry();
  seedDict(['דב']);
  const { state, eng } = freshEngine();
  // Pre-commit a tile we will swap out.
  setCommittedTile(state, 4, 4, { letter: 'א', val: 1 });
  state.firstMove = false;
  state.racks[0] = ['ד', 'ב', 'ג', 'ה', 'ו', 'ז', 'ח', 'ט'];
  state.currentTurnSlot = 0;
  const rackBefore = state.racks[0].length;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [{ r: 4, c: 5, letter: 'ב', val: 3 }],
      swappedTiles: [{ r: 4, c: 4, letter: 'ד', val: 3 }],
    },
  });

  assert.equal(state.racks[0].length, rackBefore, 'rack length must stay constant across a swap');
  assert.ok(state.racks[0].includes('א'), 'displaced board letter must return to the rack');
  assert.ok(!state.racks[0].includes('ד'), 'swap-in letter must leave the rack');
});

test('CONFIRM_MOVE forms a valid cross-word and counts both', () => {
  seedDict(['אב', 'דבה']);
  const { state, eng } = freshEngine();
  // Pre-place existing column tiles to set up a cross-word
  setCommittedTile(state, 3, 5, { letter: 'ד', val: 3 });
  setCommittedTile(state, 5, 5, { letter: 'ה', val: 4 });
  state.firstMove = false;
  state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  state.currentTurnSlot = 0;

  eng.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1 },
        { r: 4, c: 5, letter: 'ב', val: 3 },
      ],
    },
  });

  // Main word אב = 1 + 3 = 4
  // Cross word דבה = 3 + 3 + 4 = 10
  assert.equal(state.scores[0], 14);
  assert.equal(state.moveHistory[0].words.length, 2);
});

console.log = _origLog;
