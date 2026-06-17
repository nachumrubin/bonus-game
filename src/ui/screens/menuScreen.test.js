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
  const classes = new Set();
  if (onclick) attrs.onclick = onclick;
  return {
    _attrs: attrs,
    _listeners: listeners,
    _clicked: 0,
    style: {},
    textContent: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
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
    twoPlayer:  makeButton({ onclick: "startSetup('vs')" }),
    bot:        makeButton({ onclick: "startSetup('bot')" }),
    online:     makeButton({ onclick: 'showOnlineLobby()' }),
    tutorial:   makeButton({ onclick: 'showTutorialIntro()', id: 'topbar-help-btn' }),
    settings:   makeButton({ onclick: 'openSettings()' }),
    share:      makeButton({ onclick: 'shareGame()',              id: 'btn-share-game' }),
    nameLabel:  makeButton({ id: 'home-user-label' }),
    onlineBadge: makeButton({ id: 'online-badge' }),
    mgBadge:    makeButton({ id: 'mg-nav-badge' }),
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
  buttons.twoPlayer.click();
  buttons.bot.click();
  buttons.online.click();
  buttons.tutorial.click();
  buttons.settings.click();
  buttons.share.click();

  assert.equal(seen.get(MENU_INTENT.OPEN_PROFILE), 1);
  assert.equal(seen.get(MENU_INTENT.START_2P), 1);
  assert.equal(seen.get(MENU_INTENT.START_VS_BOT), 1);
  assert.equal(seen.get(MENU_INTENT.OPEN_ONLINE_LOBBY), 1);
  assert.equal(seen.get(MENU_INTENT.OPEN_HELP_MENU), 1);
  assert.equal(seen.get(MENU_INTENT.OPEN_SETTINGS), 1);
  assert.equal(seen.get(MENU_INTENT.SHARE_GAME), 1);
});

test('MENU_REFRESH paints the My-Games bottom-nav badge from `myGamesCount`', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  // No payload field → no change.
  buttons.mgBadge.textContent = '';
  buttons.mgBadge.style.display = 'none';
  bus.emit(MENU_REFRESH, { displayName: 'Alice' });
  assert.equal(buttons.mgBadge.textContent, '', 'no myGamesCount in payload → badge untouched');
  // Three open games.
  bus.emit(MENU_REFRESH, { myGamesCount: 3 });
  assert.equal(buttons.mgBadge.textContent, '3');
  assert.equal(buttons.mgBadge.style.display, '');
  // Zero open games hides the bubble.
  bus.emit(MENU_REFRESH, { myGamesCount: 0 });
  assert.equal(buttons.mgBadge.textContent, '');
  assert.equal(buttons.mgBadge.style.display, 'none');
});

test('MENU_REFRESH paints the My-Games badge green when it is my turn', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  // My turn somewhere → green class added.
  bus.emit(MENU_REFRESH, { myGamesCount: 2, myTurnInGame: true });
  assert.equal(buttons.mgBadge.textContent, '2');
  assert.equal(buttons.mgBadge.classList.contains('em-nav-badge--myturn'), true);
  // No longer my turn → green class removed (badge stays red).
  bus.emit(MENU_REFRESH, { myGamesCount: 2, myTurnInGame: false });
  assert.equal(buttons.mgBadge.classList.contains('em-nav-badge--myturn'), false);
  // myTurnInGame omitted → colour untouched.
  bus.emit(MENU_REFRESH, { myTurnInGame: true });
  bus.emit(MENU_REFRESH, { myGamesCount: 3 });
  assert.equal(buttons.mgBadge.classList.contains('em-nav-badge--myturn'), true,
    'omitting myTurnInGame leaves the colour as-is');
});

test('bell badge reflects only unreadCount, never the my-turn signal', () => {
  bus._reset();
  const { root, buttons } = makeMenuDom();
  mountMenuScreen({ root, bus });
  // A my-turn async game must NOT light the bell (empty inbox otherwise).
  bus.emit(MENU_REFRESH, { myTurnInGame: true, myGamesCount: 1 });
  assert.equal(buttons.onlineBadge.style.display, undefined,
    'my-turn signal leaves the bell badge untouched');
  // Real inbox items (invites + friend requests) light the bell.
  bus.emit(MENU_REFRESH, { unreadCount: 2 });
  assert.equal(buttons.onlineBadge.style.display, '');
  assert.equal(buttons.onlineBadge.textContent, '2');
  // Cleared inbox hides the bell.
  bus.emit(MENU_REFRESH, { unreadCount: 0 });
  assert.equal(buttons.onlineBadge.style.display, 'none');
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
