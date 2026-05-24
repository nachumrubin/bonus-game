import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { END_INTENT } from '../screens/endGameScreen.js';
import { PAUSE_INTENT, PAUSE_OPEN } from '../screens/pauseScreen.js';
import { BACK_INTENT } from '../screens/backConfirmScreen.js';
import { SETTINGS_CHANGED } from '../screens/settingsScreen.js';
import { RESIGN_INTENT, RESIGN_OPEN } from '../screens/resignConfirmScreen.js';
import { createGameFlowController } from './gameFlowController.js';

function makeEl() {
  const listeners = [];
  const attrs = {};
  const cls = new Set();
  return {
    classList: { add(c) { cls.add(c); }, contains(c) { return cls.has(c); } },
    getAttribute(n) { return attrs[n] ?? null; },
    setAttribute(n, v) { attrs[n] = v; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    click() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeRoot(elements = {}) {
  return {
    querySelector(sel) { return elements[sel] ?? null; },
    querySelectorAll(sel) { return elements[sel] ? [elements[sel]] : []; },
    getElementById(id) { return elements[`#${id}`] ?? null; },
  };
}

function makeActiveGame({ online = false, isAsync = false } = {}) {
  const dispatched = [];
  let ended = 0;
  return {
    online,
    isAsync,
    session: {
      mySlot: 0,
      state: {
        mode: 'offline-2p',
        currentTurnSlot: 0,
        scores: { 0: 10, 1: 4 },
        players: { 0: { displayName: 'A' }, 1: { displayName: 'B' } },
        settings: {},
      },
      dispatch(cmd) { dispatched.push(cmd); },
    },
    end() { ended++; },
    get ended() { return ended; },
    dispatched,
  };
}

test('GAME_COMPLETED is translated into END_OPEN payload', () => {
  bus._reset();
  const active = makeActiveGame();
  let payload = null;
  bus.on('overlay/end/open', (p) => { payload = p; });
  createGameFlowController({ bus, root: makeRoot(), activeGameRef: () => active });
  bus.emit(EV.GAME_COMPLETED, {});
  assert.equal(payload.winnerSlot, 0);
  assert.equal(payload.scores[0], 10);
});

test('pause quit in live online opens resign confirmation instead of ending immediately', () => {
  bus._reset();
  const active = makeActiveGame({ online: true, isAsync: false });
  let resignOpened = 0;
  bus.on(RESIGN_OPEN, () => { resignOpened++; });
  createGameFlowController({ bus, root: makeRoot(), activeGameRef: () => active });
  bus.emit(PAUSE_INTENT.QUIT_NO_SAVE, {});
  assert.equal(resignOpened, 1);
  assert.equal(active.ended, 0);
});

test('confirmed resign dispatches RESIGN_GAME for my slot', () => {
  bus._reset();
  const active = makeActiveGame({ online: true });
  createGameFlowController({ bus, root: makeRoot(), activeGameRef: () => active });
  bus.emit(RESIGN_INTENT.CONFIRM, {});
  assert.equal(active.dispatched[0].type, CMD.RESIGN_GAME);
  assert.equal(active.dispatched[0].payload.slot, 0);
});

test('settings changes update active session settings and legacy gameSettings', () => {
  bus._reset();
  const active = makeActiveGame();
  globalThis.gameSettings = {};
  const oldStorage = globalThis.localStorage;
  const saved = new Map();
  globalThis.localStorage = {
    setItem(k, v) { saved.set(k, String(v)); },
    getItem(k) { return saved.get(k) ?? null; },
  };
  createGameFlowController({ bus, root: makeRoot(), activeGameRef: () => active });
  bus.emit(SETTINGS_CHANGED, { timelimit: true, botTime: 15 });
  assert.equal(active.session.state.settings.timelimit, true);
  assert.equal(globalThis.gameSettings.botTime, 15);
  assert.equal(JSON.parse(saved.get('bonusGameSettingsV1')).botTime, 15);
  globalThis.localStorage = oldStorage;
  delete globalThis.gameSettings;
});

test('settings changes update animation preference', () => {
  bus._reset();
  const active = makeActiveGame();
  let enabled = null;
  active.animationController = { setEnabled(v) { enabled = v; } };
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = {
    _data: new Map(),
    setItem(k, v) { this._data.set(k, String(v)); },
    getItem(k) { return this._data.get(k) ?? null; },
  };
  createGameFlowController({ bus, root: makeRoot(), activeGameRef: () => active });
  bus.emit(SETTINGS_CHANGED, { skipAnimations: true });
  assert.equal(enabled, false);
  globalThis.localStorage = oldStorage;
});

test('pause and settings buttons emit overlay-open events', () => {
  bus._reset();
  const pause = makeEl();
  const settings = makeEl();
  pause.setAttribute('onclick', 'pauseGame()');
  settings.setAttribute('onclick', 'openSettings()');
  const root = makeRoot({ '#btn-pause': pause, 'button[onclick="openSettings()"]': settings });
  let pauseOpened = 0;
  let settingsOpened = 0;
  bus.on(PAUSE_OPEN, () => { pauseOpened++; });
  bus.on('overlay/settings/open', () => { settingsOpened++; });
  createGameFlowController({ bus, root, activeGameRef: () => makeActiveGame() });
  pause.click();
  settings.click();
  assert.equal(pauseOpened, 1);
  assert.equal(settingsOpened, 1);
});

test('end home and back leave dispose active game and route home', () => {
  bus._reset();
  const active = makeActiveGame();
  const screens = [];
  createGameFlowController({
    bus,
    root: makeRoot(),
    activeGameRef: () => active,
    showScreen: (id) => screens.push(id),
  });
  bus.emit(END_INTENT.GO_HOME, {});
  bus.emit(BACK_INTENT.LEAVE, {});
  assert.equal(active.ended, 2);
  assert.deepEqual(screens, ['sh', 'sh']);
});
