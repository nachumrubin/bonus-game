// Unit-tests for menuScreen. Uses a hand-built DOM stub (no jsdom needed)
// that implements just enough of the surface the screen touches:
// querySelector, addEventListener, removeEventListener, getAttribute,
// removeAttribute, setAttribute, style, textContent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountMenuScreen, MENU_INTENT, MENU_REFRESH } from './menuScreen.js';

function makeButton({ onclick, id }) {
  const listeners = [];
  const attrs = {};
  if (onclick) attrs.onclick = onclick;
  return {
    _attrs: attrs,
    _listeners: listeners,
    _clicked: 0,
    style: {},
    textContent: '',
    getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, val) { attrs[name] = val; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    click() {
      this._clicked++;
      for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} });
    },
    _id: id,
  };
}

function makeMenuDom() {
  const buttons = {
    profile:    makeButton({ onclick: 'openProfileOrAuth()' }),
    resume:     makeButton({ onclick: 'resumeSavedGame()',       id: 'btn-resume-home' }),
    twoPlayer:  makeButton({ onclick: "startSetup('vs')" }),
    bot:        makeButton({ onclick: "startSetup('bot')" }),
    online:     makeButton({ onclick: 'showOnlineLobby()' }),
    tutorial:   makeButton({ onclick: 'showTutorialIntro()' }),
    settings:   makeButton({ onclick: 'openSettings()' }),
    share:      makeButton({ onclick: 'shareGame()',              id: 'btn-share-game' }),
    nameLabel:  makeButton({ id: 'home-user-label' }),
    onlineBadge: makeButton({ id: 'online-badge' }),
  };

  const sh = {
    _children: Object.values(buttons),
    querySelector(selector) {
      // crude matcher for `button[onclick="..."]` and `#id`
      if (selector.startsWith('#')) {
        const id = selector.slice(1);
        return Object.values(buttons).find(b => b._id === id) ?? null;
      }
      const m = selector.match(/^button\[onclick="(.+)"\]$/);
      if (m) {
        const target = m[1];
        return Object.values(buttons).find(b => b.getAttribute('onclick') === target) ?? null;
      }
      return null;
    },
  };

  const root = {
    querySelector(sel) {
      if (sel === '#sh') return sh;
      return null;
    },
  };

  return { root, sh, buttons };
}

test('mount: replaces inline onclicks with bus-driven listeners', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  // After mount, the onclick attribute should be gone
  assert.equal(buttons.twoPlayer.getAttribute('onclick'), null);
  assert.equal(buttons.bot.getAttribute('onclick'), null);
  assert.equal(buttons.profile.getAttribute('onclick'), null);
  // And a click listener should be installed
  assert.equal(buttons.twoPlayer._listeners.length, 1);
});

test('mount: clicking 2-player emits the START_2P intent', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  const intentEvents = [];
  bus.on(MENU_INTENT.START_2P, (p) => intentEvents.push(p));

  mountMenuScreen({ root, bus });

  buttons.twoPlayer.click();

  assert.equal(intentEvents.length, 1);
  assert.equal(intentEvents[0].legacyArg, 'vs');
});

test('mount: clicking vs-bot emits START_VS_BOT', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  const intents = [];
  bus.on(MENU_INTENT.START_VS_BOT, (p) => intents.push(p));
  mountMenuScreen({ root, bus });
  buttons.bot.click();
  assert.equal(intents.length, 1);
  assert.equal(intents[0].legacyArg, 'bot');
});

test('mount: each button maps to its specific intent', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  const seen = new Map();
  for (const intent of Object.values(MENU_INTENT)) {
    bus.on(intent, () => seen.set(intent, (seen.get(intent) ?? 0) + 1));
  }
  mountMenuScreen({ root, bus });

  buttons.profile.click();
  buttons.resume.click();
  buttons.twoPlayer.click();
  buttons.bot.click();
  buttons.online.click();
  buttons.tutorial.click();
  buttons.settings.click();
  buttons.share.click();

  assert.equal(seen.get(MENU_INTENT.OPEN_PROFILE), 1);
  assert.equal(seen.get(MENU_INTENT.RESUME_SAVED), 1);
  assert.equal(seen.get(MENU_INTENT.START_2P), 1);
  assert.equal(seen.get(MENU_INTENT.START_VS_BOT), 1);
  assert.equal(seen.get(MENU_INTENT.OPEN_ONLINE_LOBBY), 1);
  assert.equal(seen.get(MENU_INTENT.OPEN_TUTORIAL), 1);
  assert.equal(seen.get(MENU_INTENT.OPEN_SETTINGS), 1);
  assert.equal(seen.get(MENU_INTENT.SHARE_GAME), 1);
});

test('MENU_REFRESH event toggles the resume button visibility', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  // Initial render: no saved game
  bus.emit(MENU_REFRESH, { hasSavedGame: false });
  assert.equal(buttons.resume.style.display, 'none');
  // Now saved game appears
  bus.emit(MENU_REFRESH, { hasSavedGame: true });
  assert.equal(buttons.resume.style.display, '');
});

test('MENU_REFRESH event toggles share button visibility based on isAuthed', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  bus.emit(MENU_REFRESH, { isAuthed: false });
  assert.equal(buttons.share.style.display, 'none');
  bus.emit(MENU_REFRESH, { isAuthed: true });
  assert.equal(buttons.share.style.display, '');
});

test('MENU_REFRESH updates the displayed name label', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  bus.emit(MENU_REFRESH, { displayName: 'נחום' });
  assert.equal(buttons.nameLabel.textContent, 'נחום');
});

test('MENU_REFRESH with isAuthed:false resets the name label to the default text', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  bus.emit(MENU_REFRESH, { displayName: 'נחום', isAuthed: true });
  assert.equal(buttons.nameLabel.textContent, 'נחום');
  bus.emit(MENU_REFRESH, { displayName: '', isAuthed: false });
  assert.equal(buttons.nameLabel.textContent, 'כניסה / הרשמה');
});

test('unmount: leaves inline onclicks stripped', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  const menu = mountMenuScreen({ root, bus });
  assert.equal(buttons.twoPlayer.getAttribute('onclick'), null);
  menu.unmount();
  assert.equal(buttons.twoPlayer.getAttribute('onclick'), null);
  assert.equal(buttons.bot.getAttribute('onclick'), null);
});

test('unmount: no longer fires bus intents on click', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  let count = 0;
  bus.on(MENU_INTENT.START_2P, () => { count++; });
  const menu = mountMenuScreen({ root, bus });
  menu.unmount();
  buttons.twoPlayer.click();
  assert.equal(count, 0);
});

test('mount: missing #sh root logs a warning and returns a no-op', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const _origWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const menu = mountMenuScreen({ root, bus });
    assert.equal(typeof menu.unmount, 'function');
    menu.unmount(); // no-op
    assert.equal(warned, 1);
  } finally {
    console.warn = _origWarn;
  }
});

test('mount throws when bus is not provided', () => {
  assert.throws(() => mountMenuScreen({ root: makeMenuDom().root }), /bus required/);
});
