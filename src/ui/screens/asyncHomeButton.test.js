import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountAsyncHomeButton, AH_INTENT, AH_SHOW, AH_HIDE } from './asyncHomeButton.js';

function makeBtn({ onclick = 'goHome()' } = {}) {
  const attrs = { onclick };
  const listeners = [];
  return {
    style: { display: 'none' },
    getAttribute(n) { return attrs[n] ?? null; },
    setAttribute(n, v) { attrs[n] = v; },
    removeAttribute(n) { delete attrs[n]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() {
      for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} });
    },
  };
}

function makeRoot(btn) {
  return { querySelector: (sel) => sel === '#btn-async-home' ? btn : null };
}

test('mount: missing button is tolerated (no throw)', () => {
  bus._reset();
  const screen = mountAsyncHomeButton({ root: { querySelector: () => null }, bus });
  screen.unmount();
});

test('mount: strips legacy onclick; click emits AH_INTENT.GO_HOME', () => {
  bus._reset();
  const btn = makeBtn();
  const events = [];
  bus.on(AH_INTENT.GO_HOME, (p) => events.push(p));
  mountAsyncHomeButton({ root: makeRoot(btn), bus });
  assert.equal(btn.getAttribute('onclick'), null);
  btn.fireClick();
  assert.equal(events.length, 1);
});

test('AH_SHOW makes the button visible; AH_HIDE re-hides it', () => {
  bus._reset();
  const btn = makeBtn();
  mountAsyncHomeButton({ root: makeRoot(btn), bus });
  bus.emit(AH_SHOW, {});
  assert.equal(btn.style.display, '');
  bus.emit(AH_HIDE, {});
  assert.equal(btn.style.display, 'none');
});

test('unmount leaves the onclick attribute stripped', () => {
  bus._reset();
  const btn = makeBtn({ onclick: 'goHome()' });
  const screen = mountAsyncHomeButton({ root: makeRoot(btn), bus });
  screen.unmount();
  assert.equal(btn.getAttribute('onclick'), null);
});

test('unmount stops further click events', () => {
  bus._reset();
  const btn = makeBtn();
  let n = 0;
  bus.on(AH_INTENT.GO_HOME, () => { n++; });
  const screen = mountAsyncHomeButton({ root: makeRoot(btn), bus });
  btn.fireClick();
  screen.unmount();
  btn.fireClick();
  assert.equal(n, 1);
});
