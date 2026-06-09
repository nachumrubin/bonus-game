import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { createTurnTimerController } from './turnTimerController.js';

function makeEl() {
  const cls = new Set();
  return {
    textContent: '',
    classList: {
      add(c) { cls.add(c); },
      remove(...c) { c.forEach(x => cls.delete(x)); },
      contains(c) { return cls.has(c); },
      toggle(c, on) { on ? cls.add(c) : cls.delete(c); },
    },
  };
}

function makeRoot(timer, wrap) {
  return {
    querySelector(sel) {
      if (sel === '#turn-timer-value') return timer;
      if (sel === '#turn-timer') return wrap;
      return null;
    },
  };
}

function makeSession(now) {
  const dispatched = [];
  return {
    state: {
      mode: 'random-live',
      status: 'playing',
      currentTurnSlot: 1,
      turnNumber: 3,
      settings: { timelimit: true, botTime: 20 },
      turnDeadlineMs: now + 10_000,
    },
    dispatch(cmd) { dispatched.push(cmd); },
    dispatched,
  };
}

test('renders remaining seconds into #turn-timer-value', () => {
  bus._reset();
  let now = 1_000;
  const session = makeSession(now);
  const timer = makeEl();
  const wrap = makeEl();
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(timer, wrap),
    sessionRef: () => session,
    now: () => now,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  assert.equal(timer.textContent, '10');
  now = 10_500;
  ctl.sync();
  assert.equal(timer.textContent, '1');
  assert.ok(wrap.classList.contains('urgent'));
  ctl.dispose();
});

test('auto-passes current turn when timer reaches zero', () => {
  bus._reset();
  let now = 1_000;
  const session = makeSession(now);
  session.state.turnDeadlineMs = 900;
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(makeEl(), makeEl()),
    sessionRef: () => session,
    now: () => now,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  assert.equal(session.dispatched[0].type, CMD.PASS_TURN);
  assert.equal(session.dispatched[0].payload.reason, 'timeout');
  ctl.sync();
  assert.equal(session.dispatched.length, 1, 'same turn only times out once');
  ctl.dispose();
});

test('does NOT auto-create a deadline for live online modes — server is authoritative', () => {
  // Online live modes derive turnDeadlineMs from the room. If we auto-set
  // a local one here, the two clients would compute different values
  // (anchored to each client's now()) and the clocks would drift apart.
  // See turnTimerController.ensureDeadline.
  bus._reset();
  const now = 5_000;
  const session = makeSession(now);
  session.state.turnDeadlineMs = null;
  const timer = makeEl();
  const wrap = makeEl();
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(timer, wrap),
    sessionRef: () => session,
    now: () => now,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  assert.equal(session.state.turnDeadlineMs, null, 'state.turnDeadlineMs untouched');
  assert.equal(timer.textContent, '--', 'displays placeholder until server publishes deadline');
  ctl.dispose();
});

test('bonus pending freezes the timer until award is acknowledged', () => {
  bus._reset();
  let nowMs = 1_000;
  const session = {
    state: {
      mode: 'offline-solo',
      status: 'playing',
      currentTurnSlot: 1,
      turnNumber: 4,
      settings: { timelimit: true, botTime: 20 },
      turnDeadlineMs: 0,
    },
    dispatched: [],
    dispatch(cmd) { this.dispatched.push(cmd); },
  };
  const timerEl = makeEl();
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(timerEl, makeEl()),
    sessionRef: () => session,
    now: () => nowMs,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  // Initial sync builds a fresh 20s deadline; display ticks normally.
  assert.equal(timerEl.textContent, '20');
  nowMs = 6_000;
  ctl.sync();
  assert.equal(timerEl.textContent, '15');

  // A bonus mini-game starts — the timer freezes back at 20 and the engine
  // shouldn't see a timeout dispatch even after the original deadline.
  bus.emit('bonus/pending', {});
  assert.equal(timerEl.textContent, '20', 'timer freezes at the full clock');
  nowMs = 60_000; // long past the original deadline
  ctl.sync();
  assert.equal(timerEl.textContent, '20', 'timer stays frozen during the bonus');
  assert.equal(session.dispatched.length, 0, 'no auto-pass while frozen');

  // Acknowledgement / mini-game resolution unfreezes and resets the clock.
  bus.emit('bonus/resolved', {});
  // Fresh deadline computed from `now` — bot gets its own full 20s.
  assert.equal(session.state.turnDeadlineMs, 80_000);
  assert.equal(timerEl.textContent, '20');
  ctl.dispose();
});

test('menu pause freezes the timer at the REMAINING time and resumes from it (preserves remaining seconds)', () => {
  bus._reset();
  let nowMs = 1_000;
  const session = {
    state: {
      mode: 'offline-solo',
      status: 'playing',
      currentTurnSlot: 1,
      turnNumber: 4,
      settings: { timelimit: true, botTime: 20 },
      turnDeadlineMs: 0,
    },
    dispatched: [],
    dispatch(cmd) { this.dispatched.push(cmd); },
  };
  const timerEl = makeEl();
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(timerEl, makeEl()),
    sessionRef: () => session,
    now: () => nowMs,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  // Initial sync builds a fresh 20s deadline.
  assert.equal(timerEl.textContent, '20');
  // 7 seconds in — display reads 13.
  nowMs = 8_000;
  ctl.sync();
  assert.equal(timerEl.textContent, '13');

  // User opens the pause overlay.
  bus.emit('game/paused', {});
  assert.equal(timerEl.textContent, '13', 'menu pause freezes at the remaining time, not the full clock');

  // Long real-world delay while paused (e.g. 5 minutes).
  nowMs = 308_000;
  ctl.sync();
  assert.equal(timerEl.textContent, '13', 'display stays frozen at remaining while paused');
  assert.equal(session.dispatched.length, 0, 'no auto-pass while paused');

  // User resumes — deadline shifts forward by 300 s, remaining is still 13.
  bus.emit('game/resumed', {});
  assert.equal(session.state.turnDeadlineMs, nowMs + 13_000,
    'deadline shifts by the paused duration so remaining time is preserved');
  ctl.sync();
  assert.equal(timerEl.textContent, '13', 'after resume the display reads the same remaining seconds');

  // 5 seconds after resume — display ticks to 8.
  nowMs += 5_000;
  ctl.sync();
  assert.equal(timerEl.textContent, '8');
  ctl.dispose();
});

test('menu pause keeps state.turnDeadlineMs rebased so saveLocalGame captures the paused remaining', () => {
  // While the user sits on the pause overlay (e.g. reading, deciding), the
  // turn-timer must continuously rebase state.turnDeadlineMs to now + frozen
  // remaining. Otherwise a saveLocalGame call later would see the original
  // absolute deadline and compute (deadline - now) which is smaller than the
  // remaining time the player paused on.
  bus._reset();
  let nowMs = 1_000;
  const session = {
    state: {
      mode: 'offline-solo',
      status: 'playing',
      currentTurnSlot: 0,
      turnNumber: 1,
      settings: { timelimit: true, botTime: 20 },
      turnDeadlineMs: 0,
    },
    dispatched: [],
    dispatch(cmd) { this.dispatched.push(cmd); },
  };
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(makeEl(), makeEl()),
    sessionRef: () => session,
    now: () => nowMs,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  // 14 s in — 6 s remain.
  nowMs = 15_000;
  ctl.sync();
  bus.emit('game/paused', {});
  // 4 s later, the deadline must already be rebased to now+6 so a save
  // captures the same 6 s the player saw on screen.
  nowMs = 19_000;
  ctl.sync();
  assert.equal(session.state.turnDeadlineMs, nowMs + 6_000,
    'state.turnDeadlineMs is rebased to now + frozen remaining during pause');
  ctl.dispose();
});

test('menu pause state is cleared by GAME_STARTED — a resumed-saved-game ticks normally', () => {
  // Repro: user pauses mid-game and clicks "צא לתפריט" (save and exit).
  // pauseScreen never emits game/resumed for that path because the session
  // is being torn down; the controller's `menuPauseActive` stays true. When
  // the user later starts a new game (e.g. resumes the saved game), sync()
  // would otherwise see the stale frozen state and never tick the timer.
  bus._reset();
  let nowMs = 1_000;
  const session = {
    state: {
      mode: 'offline-solo',
      status: 'playing',
      currentTurnSlot: 0,
      turnNumber: 1,
      settings: { timelimit: true, botTime: 20 },
      turnDeadlineMs: 0,
    },
    dispatched: [],
    dispatch(cmd) { this.dispatched.push(cmd); },
  };
  const timerEl = makeEl();
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(timerEl, makeEl()),
    sessionRef: () => session,
    now: () => nowMs,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  // 7 s in, user pauses then saves+exits (no game/resumed fires).
  nowMs = 8_000;
  ctl.sync();
  assert.equal(timerEl.textContent, '13');
  bus.emit('game/paused', {});
  assert.equal(timerEl.textContent, '13');

  // A new game starts (resumed save or fresh game). The state object that
  // sessionRef returns is reused with fresh per-turn fields.
  session.state.turnNumber = 2;
  session.state.currentTurnSlot = 0;
  session.state.turnDeadlineMs = 0;
  session.state._turnTimerKey = null;
  nowMs = 1_000_000;
  bus.emit(EV.GAME_STARTED, { mode: session.state.mode });
  // Controller must have cleared menuPauseActive — sync now sees a fresh
  // game and computes a new 20 s deadline.
  assert.equal(timerEl.textContent, '20', 'timer must reset/run after a new game starts');
  nowMs += 4_000;
  ctl.sync();
  assert.equal(timerEl.textContent, '16', 'timer ticks normally after resume-from-save');
  ctl.dispose();
});

test('offline turn change resets the deadline (no leftover from previous turn)', () => {
  bus._reset();
  let nowMs = 1_000;
  const session = {
    state: {
      mode: 'offline-solo',
      status: 'playing',
      currentTurnSlot: 0,
      turnNumber: 3,
      settings: { timelimit: true, botTime: 20 },
      turnDeadlineMs: 0,
    },
    dispatched: [],
    dispatch(cmd) { this.dispatched.push(cmd); },
  };
  const ctl = createTurnTimerController({
    bus,
    root: makeRoot(makeEl(), makeEl()),
    sessionRef: () => session,
    now: () => nowMs,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  // Initial sync builds a fresh 20s deadline.
  assert.equal(session.state.turnDeadlineMs, 21_000);

  // Player makes a move 4 seconds in, leaving 16s on their clock. The
  // engine advances turn/turnNumber but leaves turnDeadlineMs alone.
  nowMs = 5_000;
  session.state.currentTurnSlot = 1;
  session.state.turnNumber = 4;
  bus.emit(EV.TURN_CHANGED, {});

  // The bot must NOT inherit the 16s leftover — it gets its own full 20s
  // starting from `now`.
  assert.equal(session.state.turnDeadlineMs, 25_000);
  ctl.dispose();
});
