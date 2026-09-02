// Runtime verification for BOOST_MOTION_SPEC Phase 2B (spec §11 tests T1–T3).
// These exercise the REAL engine / controllers to gather evidence for the
// gate-flooring, freeze-flooring, and overlay-polling decisions, rather than
// inferring from static reading. Results are summarised in the phase report.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../src/events/bus.js';
import { CMD } from '../../src/events/commands.js';
import { EV } from '../../src/events/eventTypes.js';
import { createInitialState, createEngine } from '../../src/game/core/gameEngine.js';
import { createTurnTimerController } from '../../src/ui/controllers/turnTimerController.js';
import { createAnimationController } from '../../src/ui/controllers/animationController.js';
import { scoreClockGraceMs, REDUCED_MOTION_GRACE_MS } from '../../src/ui/scoreAnimationTimings.js';

// ── T1: is the interaction gate a correctness barrier or only visual? ──────
// Evidence: the engine binds every action to state.currentTurnSlot and mutates
// synchronously. So a UI gate that opens "early" cannot let a player act out of
// turn or twice as one slot — turn ownership lives in the engine, not the gate.
// Conclusion: the interaction gate is visual coherence + misclick avoidance →
// safe to floor under reduced motion (BOOST_MOTION_SPEC §9.3).
test('T1: engine owns turn ownership — actions bind to currentTurnSlot synchronously; an early-opened gate cannot cause an out-of-turn move', () => {
  bus._reset();
  const state = createInitialState({
    mode: 'offline-2p',
    tileBagSeed: 'verify-t1',
    players: { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } },
    startingSlot: 0,
    settings: {},
  });
  const engine = createEngine({ state, bus });
  assert.equal(state.currentTurnSlot, 0);

  engine.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'verify' } });
  assert.equal(state.currentTurnSlot, 1, 'dispatch advanced slot 0 → 1 synchronously (atomic)');

  // Simulate the player acting again the instant the gate would have opened:
  engine.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'verify' } });
  assert.equal(state.currentTurnSlot, 0, 'the second action bound to the engine turn (slot 1), never slot 0 twice');
});

// ── T2: is the turn-clock freeze correctness or fairness? ──────────────────
// Evidence: while frozen the timer suppresses the auto-pass dispatch even past
// the deadline; on resume the offline deadline is rebuilt fresh. A shortened
// (reduced-motion) freeze therefore causes no spurious auto-pass. Conclusion:
// the freeze is clock-fairness grace, safe to floor (BOOST_MOTION_SPEC §9.4).
function makeEl() {
  const c = new Set();
  return { textContent: '', classList: {
    add(x) { c.add(x); }, remove(...x) { x.forEach(y => c.delete(y)); },
    contains(x) { return c.has(x); }, toggle(x, on) { on ? c.add(x) : c.delete(x); },
  } };
}
function makeRoot(timer, wrap) {
  return { querySelector(s) { if (s === '#turn-timer-value') return timer; if (s === '#turn-timer') return wrap; return null; } };
}
function timerHarness({ reducedMotion }) {
  const dispatched = [];
  let now = 1_000_000;
  const session = { state: {
    mode: 'offline-2p', status: 'playing', currentTurnSlot: 0, turnNumber: 2,
    settings: { timelimit: true, botTime: 20 }, turnDeadlineMs: now + 3000,
  }, dispatch(c) { dispatched.push(c); } };
  let captured = null;
  const ctl = createTurnTimerController({
    bus, root: makeRoot(makeEl(), makeEl()), sessionRef: () => session,
    now: () => now,
    setIntervalFn: () => 1, clearIntervalFn: () => {},
    setTimeoutFn: (fn, ms) => { captured = { fn, ms }; return 7; },
    clearTimeoutFn: () => {},
    prefersReducedMotion: () => reducedMotion,
  });
  return { session, dispatched, ctl, get captured() { return captured; }, setNow(n) { now = n; } };
}

test('T2: the clock freeze suppresses auto-pass while it holds, and a shortened reduced-motion freeze causes no spurious auto-pass', () => {
  bus._reset();
  const h = timerHarness({ reducedMotion: false });
  h.ctl.sync();

  // A scored move commits → freeze begins.
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, wordTiles: [[{}], [{}]], bonusExtra: 0, multiplier: 1 });
  assert.ok(h.captured, 'a freeze timeout was scheduled');
  assert.equal(h.captured.ms, scoreClockGraceMs({ wordCount: 2, bonusExtra: 0, multiplier: 1 }),
    'freeze duration comes from the shared fairness timing');

  // The deadline passes DURING the freeze — the timer must NOT auto-pass.
  h.setNow(h.session.state.turnDeadlineMs + 5000);
  h.ctl.sync();
  assert.equal(h.dispatched.length, 0, 'no auto-pass while frozen even though the deadline elapsed');

  // Resume rebuilds a fresh offline deadline; still no spurious pass.
  h.captured.fn();
  h.ctl.sync();
  assert.equal(h.dispatched.filter(c => c.type === CMD.PASS_TURN).length, 0, 'no spurious auto-pass after resume');

  bus._reset();
  const r = timerHarness({ reducedMotion: true });
  r.ctl.sync();
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, wordTiles: [[{}], [{}]], bonusExtra: 0, multiplier: 1 });
  assert.equal(r.captured.ms, REDUCED_MOTION_GRACE_MS, 'reduced motion shortens the freeze to the grace floor');
  r.setNow(r.session.state.turnDeadlineMs + 5000);
  r.ctl.sync();
  assert.equal(r.dispatched.length, 0, 'shortened freeze still suppresses auto-pass while it holds');
  r.captured.fn();
  r.ctl.sync();
  assert.equal(r.dispatched.filter(c => c.type === CMD.PASS_TURN).length, 0, 'no spurious auto-pass with the floored freeze');
});

test('T2b: the freeze now includes the ×N multiplier phase the old local copy omitted', () => {
  bus._reset();
  const h1 = timerHarness({ reducedMotion: false });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, wordTiles: [[{}], [{}]], bonusExtra: 0, multiplier: 1 });
  const noMult = h1.captured.ms;
  bus._reset();
  const h2 = timerHarness({ reducedMotion: false });
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, wordTiles: [[{}], [{}]], bonusExtra: 0, multiplier: 2 });
  const withMult = h2.captured.ms;
  assert.ok(withMult > noMult, 'a multiplier move now freezes longer (matches the visible sequence)');
});

// ── T3: can the overlay gate deadlock the score-commit animation? ──────────
// Evidence: if a bonus/pending is never matched by a resolved (dropped event /
// dispose mid-flow), the score-commit animation is held indefinitely. But the
// score is ALREADY committed in engine state — this is a dropped VISUAL, never
// a state problem. Under realistic (balanced-event) flows it flushes normally.
// Conclusion (BOOST_MOTION_SPEC §5.4 / task §8): no risky polling rewrite this
// phase; only the duplicated predicate is centralised (done in domHelpers).
test('T3: a leaked overlay count defers the score-commit ANIMATION (dropped visual), and a normal resolved flushes it', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });

  // Pending overlay whose matching resolved never arrives:
  bus.emit('bonus/pending');
  bus.emit(EV.MOVE_SCORE_COMMITTED, {
    slot: 0, placed: [], words: [], wordTiles: [[{ val: 5 }]],
    finalScore: 5, baseScore: 5, bonusExtra: 0, multiplier: 1,
  });
  assert.ok(!ac._directives.map(d => d.kind).includes('scoreMergeSequence'),
    'score-commit animation is held while the overlay count is positive (would defer indefinitely if the resolved is dropped)');

  // Realistic flow: the resolved event flushes the held animation.
  bus.emit('bonus/resolved');
  assert.ok(ac._directives.map(d => d.kind).includes('scoreMergeSequence'),
    'once the overlay resolves, the held score animation fires — no rewrite needed for the normal flow');
  ac.dispose();
});
