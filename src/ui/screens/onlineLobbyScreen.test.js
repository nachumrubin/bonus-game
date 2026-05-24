import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountOnlineLobbyScreen, LOBBY_INTENT } from './onlineLobbyScreen.js';

function makeButton({ onclick }) {
  const listeners = [];
  const attrs = { onclick };
  return {
    getAttribute(n) { return attrs[n] ?? null; },
    setAttribute(n, v) { attrs[n] = v; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeLobbyDom() {
  const els = {
    create:    makeButton({ onclick: 'onlineCreateRoom()' }),
    join:      makeButton({ onclick: 'onlineJoinByCode()' }),
    matchmake: makeButton({ onclick: 'onlineMatchmaking()' }),
    back:      makeButton({ onclick: 'goHome()' }),
  };
  const so = {
    querySelector(sel) {
      switch (sel) {
        case 'button[onclick="onlineCreateRoom()"]':   return els.create;
        case 'button[onclick="onlineJoinByCode()"]':   return els.join;
        case 'button[onclick="onlineMatchmaking()"]':  return els.matchmake;
        case 'button[onclick="goHome()"]':             return els.back;
        default: return null;
      }
    },
  };
  const root = { querySelector(sel) { return sel === '#so' ? so : null; } };
  return { root, els };
}

test('mount: emits the correct intent for each button', () => {
  bus._reset();
  const { root, els } = makeLobbyDom();
  const intents = [];
  bus.on(LOBBY_INTENT.CREATE_ROOM,  () => intents.push('create'));
  bus.on(LOBBY_INTENT.JOIN_BY_CODE, () => intents.push('join'));
  bus.on(LOBBY_INTENT.MATCHMAKING,  () => intents.push('matchmake'));
  bus.on(LOBBY_INTENT.BACK,         () => intents.push('back'));

  mountOnlineLobbyScreen({ root, bus });

  els.create.fireClick();
  els.join.fireClick();
  els.matchmake.fireClick();
  els.back.fireClick();

  assert.deepEqual(intents,  ['create', 'join', 'matchmake', 'back']);
});

test('mount: removes inline onclicks; unmount leaves them stripped', () => {
  bus._reset();
  const { root, els } = makeLobbyDom();
  const screen = mountOnlineLobbyScreen({ root, bus });
  assert.equal(els.create.getAttribute('onclick'), null);
  screen.unmount();
  assert.equal(els.create.getAttribute('onclick'), null);
  assert.equal(els.join.getAttribute('onclick'),   null);
});

test('mount: missing #so root logs warning and returns no-op', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const _origWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const screen = mountOnlineLobbyScreen({ root, bus });
    screen.unmount();
    assert.equal(warned, 1);
  } finally {
    console.warn = _origWarn;
  }
});
