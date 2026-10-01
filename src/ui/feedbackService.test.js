import test from 'node:test';
import assert from 'node:assert/strict';
import * as bus from '../events/bus.js';
import { EV } from '../events/eventTypes.js';
import { RATING_EVT } from '../game/account/ratingService.js';
import { AV_UNLOCK_OPEN } from './screens/avatarScreens.js';
import * as feedback from './feedbackService.js';
import { BV_OPEN } from './screens/boostVetoScreen.js';
import { BI_OPEN } from './screens/bonusIntroScreen.js';
import { PS_INTENT } from './screens/matchmakingOverlayScreen.js';
import { NOTIF_BANNER_SHOW } from './screens/notificationsScreen.js';
import { SETTINGS_CHANGED } from './screens/settingsScreen.js';

function storageWith({ soundFx = true, vibration = true } = {}) {
  const values = new Map([['spine.uiPreferences', JSON.stringify({ soundFx, vibration })]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function setup(options = {}) {
  bus._reset();
  const cues = [];
  const haptics = [];
  const session = { mySlot: 0, session: { mySlot: 0, state: { currentTurnSlot: 0, turnNumber: 1 } } };
  feedback.init({
    storage: storageWith(options), bus, sessionRef: () => session,
    cueSink: cue => cues.push(cue), hapticSink: pattern => haptics.push(pattern),
  });
  return { cues, haptics, session, done: () => feedback.dispose() };
}

test('outcome cues are local, distinct, and duplicate completions are ignored', () => {
  const x = setup();
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 0, scores: { 0: 50, 1: 20 } });
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 0, scores: { 0: 50, 1: 20 } });
  bus.emit(EV.GAME_STARTED, {});
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: null, scores: { 0: 30, 1: 30 } });
  bus.emit(EV.GAME_STARTED, {});
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 1, scores: { 0: 10, 1: 40 } });
  assert.deepEqual(x.cues, ['game.win', 'game.draw', 'game.lose']);
  assert.deepEqual(x.haptics, [[80, 45, 110, 45, 160], [55, 45, 70], [45]]);
  x.done();
});

test('accepted word uses one sound moment and no score-landing haptic', () => {
  const x = setup();
  bus.emit(EV.MOVE_CONFIRMED, { words: ['אב'], score: 8 });
  bus.emit(EV.MOVE_CONFIRMED, { words: ['אב'], score: 8 });
  bus.emit(EV.SCORE_CHANGED, { slot: 0, score: 8 });
  bus.emit(EV.MOVE_SCORE_COMMITTED, { slot: 0, score: 8 });
  assert.deepEqual(x.cues, ['move.accepted']);
  assert.deepEqual(x.haptics, []);
  x.done();
});

test('sound and vibration preferences independently gate feedback', () => {
  const silent = setup({ soundFx: false, vibration: true });
  bus.emit(EV.INVALID_MOVE_REJECTED, {});
  assert.deepEqual(silent.cues, []);
  assert.deepEqual(silent.haptics, [[60]]);
  silent.done();
  const still = setup({ soundFx: true, vibration: false });
  bus.emit(EV.INVALID_MOVE_REJECTED, {});
  assert.deepEqual(still.cues, ['move.invalid']);
  assert.deepEqual(still.haptics, []);
  still.done();
});

test('Your Turn skips opening, opponent turns, and duplicate transition events', () => {
  const x = setup();
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 1 });
  x.session.session.state.currentTurnSlot = 1;
  x.session.session.state.turnNumber = 2;
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 2 });
  x.session.session.state.currentTurnSlot = 0;
  x.session.session.state.turnNumber = 3;
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 3 });
  assert.deepEqual(x.cues, [], 'logical turn change is silent');
  bus.emit(EV.TURN_PRESENTATION_READY, { currentTurnSlot: 1, turnNumber: 2 });
  bus.emit(EV.TURN_PRESENTATION_READY, { currentTurnSlot: 0, turnNumber: 3 });
  bus.emit(EV.TURN_PRESENTATION_READY, { currentTurnSlot: 0, turnNumber: 3 });
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 3 });
  assert.deepEqual(x.cues, ['turn.yours']);
  assert.deepEqual(x.haptics, [[30]]);
  x.done();
});

test('achievement and local Elo cues are dedicated and deduplicated', () => {
  const x = setup();
  bus.emit(AV_UNLOCK_OPEN, { achievement: { id: 'winner' } });
  bus.emit(AV_UNLOCK_OPEN, { achievement: { id: 'winner' } });
  bus.emit(RATING_EVT.CHANGED, { myBefore: 1000, myAfter: 1012 });
  bus.emit(RATING_EVT.CHANGED, { myBefore: 1000, myAfter: 1012 });
  bus.emit(RATING_EVT.CHANGED, { myBefore: 1012, myAfter: 1001 });
  assert.deepEqual(x.cues, ['achievement.unlock', 'elo.up', 'elo.down']);
  assert.deepEqual(x.haptics, [[70, 45, 110], [35, 30, 45], [55]]);
  x.done();
});

test('feedback is synchronous observation and never gates event progression', () => {
  const x = setup();
  let progressed = false;
  bus.on(EV.MOVE_CONFIRMED, () => { progressed = true; });
  bus.emit(EV.MOVE_CONFIRMED, { words: ['אב'] });
  assert.equal(progressed, true);
  x.done();
});

test('UI bus events map to their natural cues', () => {
  const x = setup();
  bus.emit(NOTIF_BANNER_SHOW, { text: 'invite', sound: 'invite.received' });
  bus.emit(NOTIF_BANNER_SHOW, { text: 'no sound field' });
  bus.emit(BV_OPEN, {});
  bus.emit(BI_OPEN, {});
  bus.emit(PS_INTENT.MATCHED, {});
  bus.emit('timer/warn', { secs: 10 });
  bus.emit('timer/timeout', {});
  assert.deepEqual(x.cues, ['invite.received', 'boost.vetoed', 'boost.intro', 'match.found', 'timer.warn', 'timer.timeout']);
  x.done();
});

test('timer ticks only for the last three seconds', () => {
  const x = setup();
  for (const secs of [5, 4, 3, 2, 1, 0]) bus.emit('timer/tick', { secs });
  assert.deepEqual(x.cues, ['timer.tick', 'timer.tick', 'timer.tick']);
  x.done();
});

test('sfxVolume setting persists and previews with a tile sound; turning sound on clicks', () => {
  const x = setup({ soundFx: false });
  bus.emit(SETTINGS_CHANGED, { soundFx: true });
  bus.emit(SETTINGS_CHANGED, { sfxVolume: 'low' });
  assert.equal(feedback.getStatus().sfxVolume, 'low');
  assert.deepEqual(x.cues, ['ui.toggle', 'tile.place']);
  x.done();
});

test('unknown cue ids are ignored and cueSeq caps the count', () => {
  const x = setup();
  feedback.cue('no.such.cue');
  feedback.cueSeq('opponent.tile', 1, 100);
  assert.deepEqual(x.cues, ['opponent.tile']);
  x.done();
});
