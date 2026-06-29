import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountMatchmakingOverlayScreen,
  mountPartnerSearchOverlay,
  readMatchmakingFilters,
  MM_INTENT,
  PS_INTENT,
} from './matchmakingOverlayScreen.js';

function makeBtn({ id, onclick, classes = [] } = {}) {
  const cl = new Set(classes);
  const listeners = [];
  return {
    id,
    classList: {
      contains(c) { return cl.has(c); },
      add(c)      { cl.add(c); },
      remove(c)   { cl.delete(c); },
    },
    getAttribute(n) { return n === 'onclick' ? (onclick ?? null) : null; },
    setAttribute(n, v) { if (n === 'onclick') onclick = v; },
    removeAttribute() { onclick = null; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeOverlayDom({
  modeLiveActive = true,
  modeAsyncActive = false,
  spdActive = 40,  // 20 | 40 | 60
  rrActive = null, // null/100/200/500
  strictChecked = true,
  name = '',
} = {}) {
  const els = {
    modeLive:   makeBtn({ id: 'mm-mode-live',  classes: modeLiveActive  ? ['active'] : [] }),
    modeAsync:  makeBtn({ id: 'mm-mode-async', classes: modeAsyncActive ? ['active'] : [] }),
    spd20:      makeBtn({ id: 'mm-spd-20', classes: spdActive === 20 ? ['active'] : [] }),
    spd40:      makeBtn({ id: 'mm-spd-40', classes: spdActive === 40 ? ['active'] : [] }),
    spd60:      makeBtn({ id: 'mm-spd-60', classes: spdActive === 60 ? ['active'] : [] }),
    rrAny:      makeBtn({ id: 'mm-rr-any', classes: rrActive === null ? ['active'] : [] }),
    rr100:      makeBtn({ id: 'mm-rr-100', classes: rrActive === 100  ? ['active'] : [] }),
    rr200:      makeBtn({ id: 'mm-rr-200', classes: rrActive === 200  ? ['active'] : [] }),
    rr500:      makeBtn({ id: 'mm-rr-500', classes: rrActive === 500  ? ['active'] : [] }),
    strict:     { id: 'mm-strict-chk', checked: strictChecked },
    nameInput:  { id: 'mm-name', value: name },
    search:     makeBtn({ id: 'mm-search-btn', onclick: 'mmStartSearch()' }),
    cancel:     makeBtn({ onclick: 'mmCancel()' }),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#mm-mode-live':  return els.modeLive;
        case '#mm-mode-async': return els.modeAsync;
        case '#mm-spd-20':     return els.spd20;
        case '#mm-spd-40':     return els.spd40;
        case '#mm-spd-60':     return els.spd60;
        case '#mm-rr-100':     return els.rr100;
        case '#mm-rr-200':     return els.rr200;
        case '#mm-rr-500':     return els.rr500;
        case '#mm-strict-chk': return els.strict;
        case '#mm-name':       return els.nameInput;
        case '#mm-search-btn': return els.search;
        case 'button[onclick="mmCancel()"]': return els.cancel;
        default: return null;
      }
    },
  };
  return { root, els };
}

function makeClassList(initial = []) {
  const cl = new Set(initial);
  return {
    contains(c) { return cl.has(c); },
    add(c)      { cl.add(c); },
    remove(...cs) { for (const c of cs) cl.delete(c); },
  };
}

function makePartnerSearchDom() {
  const ids = {
    'ov-partner-search': { classList: makeClassList(['hidden']) },
    'ps-my-avatar': { innerHTML: '', textContent: '' },
    'ps-my-name': { textContent: '' },
    'ps-slot-reel': {
      innerHTML: '',
      style: {
        animation: '',
        setProperty(k, v) { this[k] = v; },
      },
      classList: makeClassList(),
      offsetHeight: 0,
    },
    'ps-slot-card': { classList: makeClassList() },
    'ps-slot-lbl': { textContent: '' },
    'ps-cancel-btn': makeBtn({ id: 'ps-cancel-btn' }),
  };
  return {
    ids,
    root: { getElementById: (id) => ids[id] ?? null },
  };
}

test('readMatchmakingFilters: live + spd-normal + any-range + strict (defaults)', () => {
  const { root } = makeOverlayDom();
  assert.deepEqual(readMatchmakingFilters(root), {
    legacyMode: 'live',
    spineMode: 'random-live',
    timelimit: true,
    botTime: 40,
    ratingRange: null,
    strict: true,
    name: null,
  });
});

test('readMatchmakingFilters: async forces timelimit=false and botTime=0', () => {
  const { root } = makeOverlayDom({ modeLiveActive: false, modeAsyncActive: true });
  const f = readMatchmakingFilters(root);
  assert.equal(f.legacyMode, 'async');
  assert.equal(f.spineMode, 'random-async');
  assert.equal(f.timelimit, false);
  assert.equal(f.botTime, 0);
});

test('readMatchmakingFilters: spd-fast sets botTime=20', () => {
  const { root } = makeOverlayDom({ spdActive: 20 });
  assert.equal(readMatchmakingFilters(root).botTime, 20);
  assert.equal(readMatchmakingFilters(root).timelimit, true);
});

test('readMatchmakingFilters: picks the active rating range', () => {
  const { root } = makeOverlayDom({ rrActive: 200 });
  assert.equal(readMatchmakingFilters(root).ratingRange, 200);
});

test('readMatchmakingFilters: strict defaults to true even if checkbox missing', () => {
  const root = { querySelector: () => null };
  assert.equal(readMatchmakingFilters(root).strict, true);
});

test('readMatchmakingFilters: trimmed name; empty becomes null', () => {
  assert.equal(readMatchmakingFilters(makeOverlayDom({ name: '  ' }).root).name, null);
  assert.equal(readMatchmakingFilters(makeOverlayDom({ name: 'נחום ' }).root).name, 'נחום');
});

test('mount: search click emits SEARCH with current filters', () => {
  bus._reset();
  const { root, els } = makeOverlayDom({
    modeLiveActive: false, modeAsyncActive: true, rrActive: 100, strictChecked: false, name: 'נחום',
  });
  const events = [];
  bus.on(MM_INTENT.SEARCH, (p) => events.push(p));
  mountMatchmakingOverlayScreen({ root, bus });

  els.search.fireClick();

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    legacyMode: 'async',
    spineMode: 'random-async',
    timelimit: false,
    botTime: 0,
    ratingRange: 100,
    strict: false,
    name: 'נחום',
  });
});

test('mount: cancel click emits CANCEL', () => {
  bus._reset();
  const { root, els } = makeOverlayDom();
  let cancels = 0;
  bus.on(MM_INTENT.CANCEL, () => { cancels++; });
  mountMatchmakingOverlayScreen({ root, bus });

  els.cancel.fireClick();
  assert.equal(cancels, 1);
});

test('mount: unmount stops further events', () => {
  bus._reset();
  const { root, els } = makeOverlayDom();
  let n = 0;
  bus.on(MM_INTENT.SEARCH, () => { n++; });
  const screen = mountMatchmakingOverlayScreen({ root, bus });
  els.search.fireClick();
  screen.unmount();
  els.search.fireClick();
  assert.equal(n, 1);
});

test('mount: missing buttons are tolerated (no throw)', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const screen = mountMatchmakingOverlayScreen({ root, bus });
  screen.unmount();
});

test('partner search: matched avatar renders image markup once', () => {
  bus._reset();
  const { root, ids } = makePartnerSearchDom();
  mountPartnerSearchOverlay({ root, bus });

  bus.emit(PS_INTENT.MATCHED, { avatar: 'rare_3', name: 'Tamar' });

  assert.match(ids['ps-slot-reel'].innerHTML, /assets\/avatars_v2\/rare\/hertzel\.png/);
  assert.doesNotMatch(ids['ps-slot-reel'].innerHTML, /&lt;img/);
});
