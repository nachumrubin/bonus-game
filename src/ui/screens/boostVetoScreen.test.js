import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountBoostVetoScreen, describeVeto,
  BV_INTENT, BV_OPEN, BV_CLOSE,
} from './boostVetoScreen.js';

function makeEl(initial = {}) {
  const cl = new Set(initial.classes ?? []);
  const listeners = [];
  return {
    textContent: initial.textContent ?? '',
    classList: { contains(c) { return cl.has(c); }, add(c) { cl.add(c); }, remove(c) { cl.delete(c); } },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeDom() {
  const els = {
    overlay: makeEl({ classes: ['hidden'] }),
    title:   makeEl(),
    desc:    makeEl(),
    close:   makeEl(),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#ov-boost-veto':  return els.overlay;
        case '#boost-veto-title': return els.title;
        case '#boost-veto-desc':  return els.desc;
        case 'button[onclick="ovClose(\'ov-boost-veto\')"]': return els.close;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('describeVeto: opponent-named', () => {
  assert.match(describeVeto({ opponentName: 'דני' }), /דני/);
  assert.match(describeVeto({}), /היריב/);
});

test('BV_OPEN paints + unhides; BV_CLOSE re-hides', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountBoostVetoScreen({ root, bus });
  bus.emit(BV_OPEN, { opponentName: 'נחום' });
  assert.match(els.desc.textContent, /נחום/);
  assert.equal(els.overlay.classList.contains('hidden'), false);
  bus.emit(BV_CLOSE, {});
  assert.equal(els.overlay.classList.contains('hidden'), true);
});

test('close button emits BV_INTENT.CLOSE and re-hides', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(BV_INTENT.CLOSE, () => { n++; });
  mountBoostVetoScreen({ root, bus });
  bus.emit(BV_OPEN, {});
  els.close.fireClick();
  assert.equal(n, 1);
  assert.equal(els.overlay.classList.contains('hidden'), true);
});

test('unmount stops further events', () => {
  bus._reset();
  const { root, els } = makeDom();
  const screen = mountBoostVetoScreen({ root, bus });
  screen.unmount();
  bus.emit(BV_OPEN, { opponentName: 'X' });
  assert.equal(els.overlay.classList.contains('hidden'), true);
});
