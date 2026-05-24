import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountMatchmakingOverlayScreen,
  readMatchmakingFilters,
  MM_INTENT,
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
  tlYesActive = true,
  tlNoActive = false,
  rrActive = null, // null/100/200/500
  strictChecked = true,
  name = '',
} = {}) {
  const els = {
    modeLive:   makeBtn({ id: 'mm-mode-live',  classes: modeLiveActive  ? ['active'] : [] }),
    modeAsync:  makeBtn({ id: 'mm-mode-async', classes: modeAsyncActive ? ['active'] : [] }),
    tlYes:      makeBtn({ id: 'mm-tl-yes', classes: tlYesActive ? ['active'] : [] }),
    tlNo:       makeBtn({ id: 'mm-tl-no',  classes: tlNoActive  ? ['active'] : [] }),
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
        case '#mm-tl-yes':     return els.tlYes;
        case '#mm-tl-no':      return els.tlNo;
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

test('readMatchmakingFilters: live + tl-yes + any-range + strict (defaults)', () => {
  const { root } = makeOverlayDom();
  assert.deepEqual(readMatchmakingFilters(root), {
    legacyMode: 'live',
    spineMode: 'random-live',
    timelimit: true,
    ratingRange: null,
    strict: true,
    name: null,
  });
});

test('readMatchmakingFilters: async forces timelimit=false regardless of tl button', () => {
  const { root } = makeOverlayDom({ modeLiveActive: false, modeAsyncActive: true });
  const f = readMatchmakingFilters(root);
  assert.equal(f.legacyMode, 'async');
  assert.equal(f.spineMode, 'random-async');
  assert.equal(f.timelimit, false);
});

test('readMatchmakingFilters: tl-no wins over tl-yes when both somehow active', () => {
  const { root } = makeOverlayDom({ tlYesActive: true, tlNoActive: true });
  assert.equal(readMatchmakingFilters(root).timelimit, false);
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
