import test from 'node:test';
import assert from 'node:assert/strict';
import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { createTurnTimerController } from './turnTimerController.js';
import { createAnimationController } from './animationController.js';
import { scoreClockGraceMs, scoreSequenceLandingMs, countUpDurationMs } from '../scoreAnimationTimings.js';
import * as feedback from '../feedbackService.js';

function setup(t, { reducedMotion = false, soundFx = true, timerEnabled = true } = {}) {
  bus._reset();
  let now = 1000;
  const timers = new Map();
  let nextId = 0;
  const timerEl = { textContent: '' };
  const session = { mySlot: 0, state: {
    mode: 'offline-solo', status: 'playing', currentTurnSlot: 1, turnNumber: 1,
    settings: { timelimit: timerEnabled, botTime: 20 }, turnDeadlineMs: 0,
  }, dispatch: () => assert.fail('unexpected timeout during score presentation') };
  const flashes = [], sounds = [], ready = [];
  const ctl = createTurnTimerController({ bus, sessionRef: () => session,
    root: { querySelector: sel => sel === '#turn-timer-value' ? timerEl : null },
    now: () => now, prefersReducedMotion: () => reducedMotion,
    setIntervalFn: () => 1, clearIntervalFn: () => {},
    setTimeoutFn: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeoutFn: id => timers.delete(id),
  });
  const anim = createAnimationController({ bus, mySlot: 0, reducedMotion: () => reducedMotion });
  anim.setEnabled(!reducedMotion);
  anim.setRenderer({ yourTurnCue: payload => flashes.push({ at: now, payload }) });
  feedback.init({ bus, doc: {}, sessionRef: () => ({ mySlot: 0, session }),
    storage: { getItem: () => JSON.stringify({ soundFx, vibration: false }) },
    cueSink: cue => sounds.push({ at: now, cue }),
  });
  bus.on(EV.TURN_PRESENTATION_READY, payload => ready.push({ at: now, payload,
    remaining: session.state.turnDeadlineMs - now, display: timerEl.textContent }));
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end; ctl.sync();
  }
  function turn(slot = 0, number = 2) {
    session.state.currentTurnSlot = slot; session.state.turnNumber = number;
    bus.emit(EV.TURN_CHANGED, { currentTurnSlot: slot, turnNumber: number });
  }
  function score(payload, event = EV.OPPONENT_MOVED) {
    session.state.currentTurnSlot = 0; session.state.turnNumber = 2;
    bus.emit(event, { slot: 1, ...payload }); turn();
  }
  t.after(() => { ctl.dispose(); anim.dispose(); feedback.dispose(); bus._reset(); });
  return { session, timerEl, flashes, sounds, ready, timers, advance, turn, score, ctl };
}

for (const reducedMotion of [false, true]) {
  for (const soundFx of [false, true]) {
    test(`score grace -> full clock -> synchronized flash/audio (reduced=${reducedMotion}, sound=${soundFx})`, t => {
      const x = setup(t, { reducedMotion, soundFx });
      const payload = { wordTiles: [[{ val: 2 }], [{ val: 3 }]], score: 30, bonusExtra: 10, multiplier: 2 };
      const grace = scoreClockGraceMs({ wordCount: 2, ...payload, reducedMotion });
      bus.emit(EV.GAME_STARTED, {});
      x.turn(1, 1); x.turn(1, 1);
      assert.equal(x.flashes.length, 0, 'opening including duplicate stays silent');
      x.score(payload);
      x.turn();
      x.advance(grace - 1);
      assert.equal(x.timerEl.textContent, '20');
      assert.equal(x.flashes.length, 0);
      assert.equal(x.sounds.length, 0);
      if (!reducedMotion) assert.ok(grace >= scoreSequenceLandingMs({wordCount:2,...payload}) + countUpDurationMs(30));
      x.advance(1);
      assert.equal(x.ready.length, 1);
      assert.equal(x.ready[0].remaining, 20_000, 'full allowance starts at cue');
      assert.equal(x.ready[0].display, '20');
      assert.equal(x.flashes[0].at, x.ready[0].at);
      assert.deepEqual(x.sounds, soundFx ? [{ at: x.ready[0].at, cue: 'your-turn' }] : []);
      x.turn(); x.advance(1000);
      assert.equal(x.timerEl.textContent, '19');
      assert.equal(x.flashes.length, 1, 'duplicate does not replay');
    });
  }
}

test('queued timer bonus is preserved in the full incoming allowance', t => {
  const x = setup(t);
  x.session.state.turnTimerBonusMs = 10_000;
  x.score({ wordTiles: [[{val:1}]], score: 1 });
  x.advance(scoreClockGraceMs({ wordCount: 1 }));
  assert.equal(x.ready[0].remaining, 30_000);
  assert.equal(x.session.state.turnTimerBonusMs, 0);
});

test('opening on the local seat suppresses all duplicate opening sync events', t => {
  const x = setup(t);
  x.session.state.currentTurnSlot = 0;
  bus.emit(EV.GAME_STARTED, {});
  x.turn(0, 1); x.turn(0, 1); x.advance(3000);
  assert.equal(x.flashes.length, 0);
  assert.equal(x.sounds.length, 0);
});

test('Sound FX disabled during score presentation suppresses the pending sound', t => {
  const x = setup(t);
  x.score({ wordTiles: [[{val:1}]], score: 1 });
  feedback.setSoundEnabled(false);
  x.advance(scoreClockGraceMs({ wordCount: 1 }));
  assert.equal(x.flashes.length, 1);
  assert.equal(x.sounds.length, 0);
  feedback.setSoundEnabled(true); x.turn();
  assert.equal(x.sounds.length, 0, 'enabling sound does not replay a consumed turn');
});

test('pass resumes immediately; opponent turns and opening duplicates never cue locally', t => {
  const x = setup(t);
  x.turn(1, 1); x.turn(1, 1);
  x.turn();
  assert.equal(x.flashes.length, 1);
  assert.equal(x.timers.size, 0, 'pass adds no arbitrary delay');
  x.turn(1, 3);
  assert.equal(x.flashes.length, 1);
});

test('untimed games still receive the presentation cue after score grace', t => {
  const x = setup(t, { timerEnabled: false });
  x.score({ wordTiles: [[{val:1}]], score: 1 });
  x.advance(scoreClockGraceMs({ wordCount: 1 }));
  assert.equal(x.timerEl.textContent, '--');
  assert.equal(x.flashes.length, 1);
});

test('overlapping score events replace one freeze and cannot strand the clock', t => {
  const x = setup(t);
  const payload = { wordTiles: [[{val:1}]], score: 1 };
  x.score(payload); x.advance(100);
  x.score(payload, EV.MOVE_SCORE_COMMITTED);
  assert.equal(x.timers.size, 1);
  x.advance(scoreClockGraceMs({ wordCount: 1 }));
  assert.equal(x.ready[0].remaining, 20_000);
  assert.equal(x.flashes.length, 1);
});

test('deferred score grace starts when the award closes, then clock and cue resume', t => {
  const x = setup(t);
  bus.emit('bonus/pending');
  x.score({ scoringDeferred: true }, EV.MOVE_CONFIRMED);
  x.score({ wordTiles: [[{val:1}]], score: 1 }, EV.MOVE_SCORE_COMMITTED);
  x.advance(5000);
  assert.equal(x.flashes.length, 0);
  bus.emit('bonus/resolved');
  x.advance(scoreClockGraceMs({ wordCount: 1 }) - 1);
  assert.equal(x.flashes.length, 0);
  x.advance(1);
  assert.equal(x.ready[0].remaining, 20_000);
});

test('a later turn, completed game, new game, or disposal cannot leak a stale local cue', t => {
  const x = setup(t);
  x.score({ wordTiles: [[{val:1}]] }); x.turn(1, 3); x.advance(2000);
  assert.equal(x.flashes.length, 0);
  x.score({ wordTiles: [[{val:1}]] });
  x.session.state.status = 'completed'; bus.emit(EV.GAME_COMPLETED, {}); x.advance(2000);
  assert.equal(x.flashes.length, 0);
  x.session.state.status = 'playing'; x.score({ wordTiles: [[{val:1}]] });
  bus.emit(EV.GAME_STARTED, {}); x.advance(2000);
  assert.equal(x.flashes.length, 0);
  x.turn(1, 3); x.score({ wordTiles: [[{val:1}]] }); x.ctl.dispose(); x.advance(2000);
  assert.equal(x.flashes.length, 0);
});

test('late chip/count-up completion outlives nominal grace; last completion resumes the full clock once', t => {
  const x = setup(t);
  x.score({ wordTiles: [[{val:17}]], score: 17 });
  bus.emit(EV.SCORE_PRESENTATION_STARTED, { id: 'chip' });
  bus.emit(EV.SCORE_PRESENTATION_STARTED, { id: 'count-up' });
  x.advance(3000); // long frame stalls push presentation beyond nominal grace
  assert.equal(x.timerEl.textContent, '20');
  assert.equal(x.flashes.length, 0);
  assert.equal(x.sounds.length, 0);
  bus.emit(EV.SCORE_PRESENTATION_FINISHED, { id: 'count-up' });
  assert.equal(x.flashes.length, 0, 'chip/landing response still owns a hold');
  bus.emit(EV.SCORE_PRESENTATION_FINISHED, { id: 'chip' });
  assert.equal(x.ready[0].remaining, 20_000);
  assert.equal(x.flashes.length, 1);
  assert.deepEqual(x.sounds, [{ at: x.ready[0].at, cue: 'your-turn' }]);
  bus.emit(EV.SCORE_PRESENTATION_FINISHED, { id: 'chip' });
  x.turn(); x.advance(1000);
  assert.equal(x.flashes.length, 1);
  assert.equal(x.timerEl.textContent, '19');
});

test('fast presentation completion still respects canonical grace; old game completions are ignored', t => {
  const x = setup(t);
  x.score({ wordTiles: [[{val:1}]], score: 1 });
  bus.emit(EV.SCORE_PRESENTATION_STARTED, { id: 'old' });
  bus.emit(EV.SCORE_PRESENTATION_FINISHED, { id: 'old' });
  assert.equal(x.flashes.length, 0);
  x.advance(scoreClockGraceMs({wordCount:1}));
  assert.equal(x.flashes.length, 1);
  bus.emit(EV.SCORE_PRESENTATION_STARTED, { id: 'stale' });
  bus.emit(EV.GAME_STARTED, {});
  x.advance(1000);
  const deadline = x.session.state.turnDeadlineMs;
  bus.emit(EV.SCORE_PRESENTATION_FINISHED, { id: 'stale' });
  assert.equal(x.session.state.turnDeadlineMs, deadline);
});

test('screen teardown releases its score hold without playing the queued cue', t => {
  const x = setup(t);
  x.score({ wordTiles: [[{val:1}]], score: 1 });
  bus.emit(EV.SCORE_PRESENTATION_STARTED, { id: 'screen' });
  x.advance(3000);
  bus.emit(EV.SCORE_PRESENTATION_FINISHED, { id: 'screen', cancelled: true });
  assert.equal(x.flashes.length, 0);
  assert.equal(x.sounds.length, 0);
});
