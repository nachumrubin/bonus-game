import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  buildChampionsHtml,
  CHAMPS_INTENT,
  CHAMPS_OPEN,
  CHAMPS_RENDER,
  CHAMPS_ERROR,
  mountChampionsScreen,
} from './championsScreen.js';

function makeEl({ hidden = true, onclick = null } = {}) {
  const listeners = [];
  const cls = new Set(hidden ? ['hidden'] : []);
  const attrs = onclick ? { onclick } : {};
  return {
    innerHTML: '',
    classList: {
      add(c) { cls.add(c); },
      remove(c) { cls.delete(c); },
      contains(c) { return cls.has(c); },
    },
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

function makeRoot({ overlay, home, end, close }) {
  overlay.querySelector = (sel) => sel === 'button[onclick="ovClose(\'ov-champs\')"]' ? close : null;
  return {
    querySelector(sel) {
      if (sel === '#ov-champs') return overlay;
      if (sel === '#champions-wrap-home') return home;
      if (sel === '#champions-wrap') return end;
      return null;
    },
  };
}

test('buildChampionsHtml renders empty and escaped rows', () => {
  assert.match(buildChampionsHtml([]), /champs-empty/);
  const html = buildChampionsHtml([{ uid: 'u<1', name: '<Alice>', rating: 1050 }]);
  assert.match(html, /&lt;Alice&gt;/);
  assert.match(html, /1050/);
  assert.match(html, /דירוג/);
});

test('CHAMPS_OPEN shows overlay and emits open intent', () => {
  bus._reset();
  const overlay = makeEl();
  const home = makeEl();
  const root = makeRoot({ overlay, home, end: makeEl(), close: makeEl({ onclick: "ovClose('ov-champs')" }) });
  let opens = 0;
  bus.on(CHAMPS_INTENT.OPEN, () => { opens++; });
  mountChampionsScreen({ root, bus });
  bus.emit(CHAMPS_OPEN, {});
  assert.ok(!overlay.classList.contains('hidden'));
  assert.match(home.innerHTML, /טוען/);
  assert.equal(opens, 1);
});

test('CHAMPS_RENDER paints home and end targets', () => {
  bus._reset();
  const home = makeEl();
  const end = makeEl();
  mountChampionsScreen({
    root: makeRoot({ overlay: makeEl(), home, end, close: makeEl() }),
    bus,
  });
  bus.emit(CHAMPS_RENDER, { entries: [{ uid: 'u1', name: 'Alice', rating: 1099 }] });
  assert.match(home.innerHTML, /Alice/);
  assert.match(end.innerHTML, /1099/);
});

test('CHAMPS_ERROR paints an error placeholder', () => {
  bus._reset();
  const home = makeEl();
  mountChampionsScreen({
    root: makeRoot({ overlay: makeEl(), home, end: makeEl(), close: makeEl() }),
    bus,
  });
  bus.emit(CHAMPS_ERROR, {});
  assert.match(home.innerHTML, /לא ניתן/);
});
