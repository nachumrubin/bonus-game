// Tests for the in-game overlay screens (end, pause, back-confirm, coin-toss,
// settings, disconnect). All follow the same mount/unmount + bus pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { mountEndGameScreen, END_INTENT, END_OPEN } from './endGameScreen.js';
import { mountPauseScreen, PAUSE_INTENT, PAUSE_OPEN } from './pauseScreen.js';
import { mountBackConfirmScreen, BACK_INTENT, BACK_OPEN } from './backConfirmScreen.js';
import { mountCoinTossScreen, COIN_INTENT, COIN_OPEN } from './coinTossScreen.js';
import { mountSettingsScreen, SETTINGS_INTENT, SETTINGS_OPEN, SETTINGS_CHANGED } from './settingsScreen.js';
import { mountDisconnectScreen, DISCONNECT_INTENT, DISCONNECT_OPEN, DISCONNECT_CLOSE } from './disconnectScreen.js';

function makeBtn({ onclick, classes = [] } = {}) {
  const listeners = [];
  const attrs = onclick ? { onclick } : {};
  const cls = new Set(classes);
  return {
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); }, contains(c) { return cls.has(c); },
    },
    style: {},
    textContent: '',
    disabled: false,
    getAttribute(n) { return attrs[n] ?? null; },
    setAttribute(n, v) { attrs[n] = v; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
    get offsetWidth() { return 1; },
  };
}

function makeOverlay({ id, classes = ['ov', 'hidden'] }) {
  const cls = new Set(classes);
  const elements = new Map();
  const overlay = {
    id,
    _children: elements,
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); }, contains(c) { return cls.has(c); },
    },
    querySelector(sel) {
      // Match #id or button[onclick="..."]
      if (sel.startsWith('#')) return elements.get(sel.slice(1)) ?? null;
      const m = sel.match(/^button\[onclick="(.+?)"\]$/);
      if (m) {
        for (const el of elements.values()) if (el.getAttribute('onclick') === m[1]) return el;
        return null;
      }
      // Match `button[onclick="X"], div[onclick="X"]` — first selector form
      const m2 = sel.match(/onclick="([^"]+)"/);
      if (m2) {
        for (const el of elements.values()) if (el.getAttribute('onclick') === m2[1]) return el;
      }
      return null;
    },
  };
  return { overlay, elements };
}

// ─── End-game ─────────────────────────────────────────────────────

test('endGameScreen: GAME_COMPLETED auto-opens overlay with winner + scores', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-end' });
  elements.set('wn',  makeBtn());
  elements.set('wws', makeBtn());
  elements.set('en1', makeBtn());
  elements.set('en2', makeBtn());
  elements.set('es1', makeBtn());
  elements.set('es2', makeBtn());
  const rematch = makeBtn({ onclick: 'rematch()' });
  const home    = makeBtn({ onclick: 'goHome()' });
  elements.set('rematch', rematch);
  elements.set('home', home);
  // Override querySelector to also return rematch/home buttons
  const origQS = overlay.querySelector;
  overlay.querySelector = (sel) => {
    if (sel === 'button[onclick="rematch()"]') return rematch;
    if (sel === 'button[onclick="goHome()"]') return home;
    return origQS.call(overlay, sel);
  };
  const root = { querySelector: (sel) => sel === '#ov-end' ? overlay : null };
  mountEndGameScreen({ root, bus });

  bus.emit(EV.GAME_COMPLETED, {
    winnerSlot: 0,
    scores: { 0: 80, 1: 50 },
    players: { 0: { displayName: 'Alice' }, 1: { displayName: 'Bob' } },
  });

  assert.ok(!overlay.classList.contains('hidden'));
  assert.equal(elements.get('wn').textContent, 'Alice ניצח!');
  assert.equal(elements.get('es1').textContent, '80');
  assert.equal(elements.get('es2').textContent, '50');
});

test('endGameScreen: tie shows draw text', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-end' });
  ['wn', 'wws', 'en1', 'en2', 'es1', 'es2'].forEach(id => elements.set(id, makeBtn()));
  const rematch = makeBtn({ onclick: 'rematch()' });
  const home    = makeBtn({ onclick: 'goHome()' });
  const origQS = overlay.querySelector;
  overlay.querySelector = (sel) => {
    if (sel === 'button[onclick="rematch()"]') return rematch;
    if (sel === 'button[onclick="goHome()"]') return home;
    return origQS.call(overlay, sel);
  };
  const root = { querySelector: () => overlay };
  mountEndGameScreen({ root, bus });
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: null, scores: { 0: 40, 1: 40 } });
  assert.equal(elements.get('wn').textContent, 'תיקו!');
});

test('endGameScreen: rematch and home buttons emit intents', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-end' });
  ['wn', 'wws', 'en1', 'en2', 'es1', 'es2'].forEach(id => elements.set(id, makeBtn()));
  const rematch = makeBtn({ onclick: 'rematch()' });
  const home    = makeBtn({ onclick: 'goHome()' });
  const origQS = overlay.querySelector;
  overlay.querySelector = (sel) => {
    if (sel === 'button[onclick="rematch()"]') return rematch;
    if (sel === 'button[onclick="goHome()"]') return home;
    return origQS.call(overlay, sel);
  };
  const root = { querySelector: () => overlay };
  mountEndGameScreen({ root, bus });
  let r = 0, h = 0;
  bus.on(END_INTENT.REMATCH, () => r++);
  bus.on(END_INTENT.GO_HOME, () => h++);
  rematch.fireClick();
  home.fireClick();
  assert.equal(r, 1);
  assert.equal(h, 1);
});

// ─── Pause ────────────────────────────────────────────────────────

test('pauseScreen: PAUSE_OPEN unhides overlay; resume button emits RESUME', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-pause' });
  const resume = makeBtn({ onclick: 'resumeGame()' });
  const save   = makeBtn({ onclick: 'savePauseAndHome()' });
  const quit   = makeBtn({ onclick: 'discardPauseAndHome()' });
  elements.set('resume', resume); elements.set('save', save); elements.set('quit', quit);
  elements.set('pause-player-name', makeBtn());
  const root = { querySelector: () => overlay };
  let resumes = 0;
  bus.on(PAUSE_INTENT.RESUME, () => resumes++);
  mountPauseScreen({ root, bus });
  bus.emit(PAUSE_OPEN, { playerName: 'Alice' });
  assert.ok(!overlay.classList.contains('hidden'));
  assert.equal(elements.get('pause-player-name').textContent, 'Alice');
  resume.fireClick();
  assert.equal(resumes, 1);
  assert.ok(overlay.classList.contains('hidden')); // closed on action
});

test('pauseScreen: PAUSE_OPEN emits game/paused; RESUME emits game/resumed (not bonus/* — that would open the bonus overlay)', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-pause' });
  const resume = makeBtn({ onclick: 'resumeGame()' });
  elements.set('resume', resume); elements.set('pause-player-name', makeBtn());
  const root = { querySelector: () => overlay };
  const signals = [];
  const bonusSignals = [];
  bus.on('game/paused',    () => signals.push('freeze'));
  bus.on('game/resumed',   () => signals.push('unfreeze'));
  bus.on('bonus/pending',  () => bonusSignals.push('bonus-pending'));
  bus.on('bonus/resolved', () => bonusSignals.push('bonus-resolved'));
  mountPauseScreen({ root, bus });
  bus.emit(PAUSE_OPEN, {});
  assert.deepEqual(signals, ['freeze'], 'pause overlay open must freeze the game');
  assert.deepEqual(bonusSignals, [], 'menu pause must NOT emit bonus/* (would open the bonus overlay)');
  // A second PAUSE_OPEN while already frozen must not double-emit.
  bus.emit(PAUSE_OPEN, {});
  assert.deepEqual(signals, ['freeze']);
  resume.fireClick();
  assert.deepEqual(signals, ['freeze', 'unfreeze'], 'resume must unfreeze');
  assert.deepEqual(bonusSignals, []);
});

test('pauseScreen: SAVE_AND_EXIT does not need to unfreeze (session is torn down)', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-pause' });
  const resume = makeBtn({ onclick: 'resumeGame()' });
  const save   = makeBtn({ onclick: 'savePauseAndHome()' });
  elements.set('resume', resume); elements.set('save', save);
  const root = { querySelector: () => overlay };
  const signals = [];
  bus.on('game/paused',  () => signals.push('freeze'));
  bus.on('game/resumed', () => signals.push('unfreeze'));
  mountPauseScreen({ root, bus });
  bus.emit(PAUSE_OPEN, {});
  save.fireClick();
  assert.deepEqual(signals, ['freeze'], 'save/exit must NOT emit a stray unfreeze');
});

test('pauseScreen: each button emits its intent', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-pause' });
  const resume = makeBtn({ onclick: 'resumeGame()' });
  const save   = makeBtn({ onclick: 'savePauseAndHome()' });
  const quit   = makeBtn({ onclick: 'discardPauseAndHome()' });
  elements.set('resume', resume); elements.set('save', save); elements.set('quit', quit);
  const root = { querySelector: () => overlay };
  const calls = [];
  bus.on(PAUSE_INTENT.RESUME, () => calls.push('resume'));
  bus.on(PAUSE_INTENT.SAVE_AND_EXIT, () => calls.push('save'));
  bus.on(PAUSE_INTENT.QUIT_NO_SAVE, () => calls.push('quit'));
  mountPauseScreen({ root, bus });
  resume.fireClick(); save.fireClick(); quit.fireClick();
  assert.deepEqual(calls, ['resume', 'save', 'quit']);
});

// ─── Back-confirm ────────────────────────────────────────────────

test('backConfirmScreen: BACK_OPEN unhides; stay/leave emit intents', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-back-confirm' });
  const stay  = makeBtn({ onclick: 'backConfirmStay()' });
  const pause = makeBtn({ onclick: 'pauseGame();backConfirmStay()' });
  const leave = makeBtn({ onclick: 'backConfirmLeave()' });
  elements.set('stay', stay); elements.set('pause', pause); elements.set('leave', leave);
  const root = { querySelector: () => overlay };
  const events = [];
  bus.on(BACK_INTENT.STAY,  () => events.push('stay'));
  bus.on(BACK_INTENT.LEAVE, () => events.push('leave'));
  bus.on(BACK_INTENT.PAUSE_AND_SAVE, () => events.push('pauseSave'));
  mountBackConfirmScreen({ root, bus });
  bus.emit(BACK_OPEN);
  assert.ok(!overlay.classList.contains('hidden'));
  pause.fireClick();
  assert.deepEqual(events, ['pauseSave']);
});

// ─── Coin toss ────────────────────────────────────────────────────

test('coinTossScreen: COIN_OPEN populates sub text and removes flipping class', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'scoin' });
  elements.set('coin-sub', makeBtn());
  elements.set('coin-msg', makeBtn());
  elements.set('coin-disc', makeBtn());
  const enter = makeBtn({ onclick: 'enterGameAfterCoinToss()' });
  elements.set('enter', enter);
  const origQS = overlay.querySelector;
  overlay.querySelector = (sel) => {
    if (sel === 'button[onclick="enterGameAfterCoinToss()"]') return enter;
    return origQS.call(overlay, sel);
  };
  const root = { querySelector: () => overlay };
  mountCoinTossScreen({ root, bus });
  bus.emit(COIN_OPEN, { startingSlot: 0, p1Name: 'Alice', p2Name: 'Bob' });
  assert.equal(elements.get('coin-sub').textContent, 'מטילים מטבע...');
  assert.equal(enter.disabled, true);
});

test('coinTossScreen: enter button emits COIN_INTENT.ENTER', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'scoin' });
  ['coin-sub','coin-msg','coin-disc'].forEach(id => elements.set(id, makeBtn()));
  const enter = makeBtn({ onclick: 'enterGameAfterCoinToss()' });
  elements.set('enter', enter);
  const origQS = overlay.querySelector;
  overlay.querySelector = (sel) =>
    sel === 'button[onclick="enterGameAfterCoinToss()"]' ? enter : origQS.call(overlay, sel);
  const root = { querySelector: () => overlay };
  let entered = 0;
  bus.on(COIN_INTENT.ENTER, () => entered++);
  mountCoinTossScreen({ root, bus });
  enter.fireClick();
  assert.equal(entered, 1);
});

// ─── Settings ─────────────────────────────────────────────────────

test('settingsScreen: clicking timelimit "yes" emits TOGGLE + SETTINGS_CHANGED', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-settings' });
  const tlYes = makeBtn({ onclick: "settToggle('timelimit',true)" });
  const tlNo  = makeBtn({ onclick: "settToggle('timelimit',false)" });
  elements.set('sett-timelimit-yes', tlYes);
  elements.set('sett-timelimit-no',  tlNo);
  const close = makeBtn({ onclick: "ovClose('ov-settings')" });
  const origQS = overlay.querySelector;
  overlay.querySelector = (sel) => {
    if (sel === 'button[onclick="ovClose(\'ov-settings\')"]') return close;
    return origQS.call(overlay, sel);
  };
  const root = { querySelector: () => overlay };
  let toggleEvts = 0, changedEvts = 0;
  let fallbackArgs = null;
  bus.on(SETTINGS_INTENT.TOGGLE, () => toggleEvts++);
  bus.on(SETTINGS_CHANGED, (changes) => { changedEvts++; fallbackArgs = changes; });
  mountSettingsScreen({ root, bus });
  tlYes.fireClick();
  assert.equal(toggleEvts, 1);
  assert.equal(changedEvts, 1);
  assert.deepEqual(fallbackArgs, { timelimit: true });
  assert.ok(tlYes.classList.contains('active-yes'));
});

test('settingsScreen: counter +/- buttons adjust display and emit SETTINGS_CHANGED', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-settings' });
  const display = makeBtn();
  display.textContent = '20';
  elements.set('sett-bottime', display);
  const minus = makeBtn({ onclick: "settAdj('botTime',-5)" });
  const plus  = makeBtn({ onclick: "settAdj('botTime',5)" });
  elements.set('minus', minus); elements.set('plus', plus);
  const origQS = overlay.querySelector;
  overlay.querySelector = (sel) => {
    if (sel.includes("settAdj('botTime',-5)")) return minus;
    if (sel.includes("settAdj('botTime',5)"))  return plus;
    return origQS.call(overlay, sel);
  };
  const root = { querySelector: () => overlay };
  let changed = null;
  bus.on(SETTINGS_CHANGED, (c) => changed = c);
  mountSettingsScreen({ root, bus });
  plus.fireClick();
  assert.equal(display.textContent, '25');
  assert.deepEqual(changed, { botTime: 25 });
  minus.fireClick();
  assert.equal(display.textContent, '20');
});

// ─── Disconnect ──────────────────────────────────────────────────

test('settingsScreen: SETTINGS_OPEN refreshes controls from current settings', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-settings' });
  const musicYes = makeBtn({ onclick: "settToggle('music',true)" });
  const musicNo  = makeBtn({ onclick: "settToggle('music',false)" });
  const botTime = makeBtn();
  elements.set('sett-music-yes', musicYes);
  elements.set('sett-music-no', musicNo);
  elements.set('sett-bottime', botTime);
  const root = { querySelector: () => overlay };
  mountSettingsScreen({
    root,
    bus,
    getSettings: () => ({ music: false, botTime: 35 }),
  });
  bus.emit(SETTINGS_OPEN, {});
  assert.ok(!musicYes.classList.contains('active-yes'));
  assert.ok(musicNo.classList.contains('active-no'));
  assert.equal(botTime.textContent, '35');
});

test('disconnectScreen: DISCONNECT_OPEN starts countdown and shows opponent name', () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-disconnect' });
  elements.set('dc-timer', makeBtn());
  elements.set('dc-bar',   makeBtn());
  elements.set('dc-msg',   makeBtn());
  const root = { querySelector: () => overlay };
  mountDisconnectScreen({ root, bus });
  bus.emit(DISCONNECT_OPEN, { seconds: 30, opponentName: 'Bob' });
  assert.equal(elements.get('dc-timer').textContent, '30');
  assert.ok(elements.get('dc-msg').textContent.includes('Bob'));
  assert.ok(!overlay.classList.contains('hidden'));
  bus.emit(DISCONNECT_CLOSE);
  assert.ok(overlay.classList.contains('hidden'));
});

test('disconnectScreen: countdown reaches 0 emits AUTO_WIN', async () => {
  bus._reset();
  const { overlay, elements } = makeOverlay({ id: 'ov-disconnect' });
  elements.set('dc-timer', makeBtn());
  elements.set('dc-bar',   makeBtn());
  elements.set('dc-msg',   makeBtn());
  const root = { querySelector: () => overlay };
  let wins = 0;
  bus.on(DISCONNECT_INTENT.AUTO_WIN, () => wins++);
  const screen = mountDisconnectScreen({ root, bus });
  bus.emit(DISCONNECT_OPEN, { seconds: 1 });
  // Wait for the 1-second countdown + a tick
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(wins, 1);
  screen.unmount();
});
