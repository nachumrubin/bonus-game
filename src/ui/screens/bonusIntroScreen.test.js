import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountBonusIntroScreen, describeBonus,
  BI_INTENT, BI_OPEN, BI_CLOSE,
} from './bonusIntroScreen.js';

function makeEl(initial = {}) {
  const cl = new Set(initial.classes ?? []);
  const listeners = [];
  return {
    textContent: initial.textContent ?? '',
    classList: { contains(c) { return cl.has(c); }, add(c) { cl.add(c); }, remove(c) { cl.delete(c); } },
    getAttribute(n) { return n === 'onclick' ? (initial.onclick ?? null) : null; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeDom() {
  const els = {
    overlay: makeEl({ classes: ['hidden'] }),
    ic:      makeEl(),
    title:   makeEl(),
    desc:    makeEl(),
    start:   makeEl({ onclick: 'startBonusGame()' }),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#ov-bonus-intro':                            return els.overlay;
        case '#bintro-ic':                                 return els.ic;
        case '#bintro-title':                              return els.title;
        case '#bintro-desc':                               return els.desc;
        case 'button[onclick="startBonusGame()"]':         return els.start;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('describeBonus: known types', () => {
  assert.match(describeBonus('B1').title,  /אנגרמה/);
  assert.equal(describeBonus('B1').pts, 100);
  assert.match(describeBonus('B13').title, /גלגל/);
});

test('describeBonus: unknown type falls back', () => {
  const d = describeBonus('BX');
  assert.match(d.title, /בוסט/);
});

test('BI_OPEN paints title + desc + unhides', () => {
  bus._reset();
  const { root, els } = makeDom();
  mountBonusIntroScreen({ root, bus });
  bus.emit(BI_OPEN, { bonusType: 'B1', miniGameKey: 'b1_unscramble_or_fillmiddle' });
  assert.match(els.title.textContent, /אנגרמה/);
  assert.match(els.desc.textContent,  /100/);
  assert.equal(els.overlay.classList.contains('hidden'), false);
});

test('start button emits BI_INTENT.START with the open payload', () => {
  bus._reset();
  const { root, els } = makeDom();
  const events = [];
  bus.on(BI_INTENT.START, (p) => events.push(p));
  mountBonusIntroScreen({ root, bus });
  bus.emit(BI_OPEN, { bonusType: 'B13', miniGameKey: 'b13_wheel_of_fortune', kind: 'wheel' });
  els.start.fireClick();
  assert.equal(events.length, 1);
  assert.equal(events[0].bonusType, 'B13');
  assert.equal(events[0].kind, 'wheel');
  // Overlay re-hidden after click
  assert.equal(els.overlay.classList.contains('hidden'), true);
});

test('BI_CLOSE rehides + clears payload', () => {
  bus._reset();
  const { root, els } = makeDom();
  const screen = mountBonusIntroScreen({ root, bus });
  bus.emit(BI_OPEN, { bonusType: 'B1' });
  bus.emit(BI_CLOSE, {});
  assert.equal(els.overlay.classList.contains('hidden'), true);
  assert.equal(screen._peekPayload(), null);
});

test('unmount stops further events', () => {
  bus._reset();
  const { root, els } = makeDom();
  let n = 0;
  bus.on(BI_INTENT.START, () => { n++; });
  const screen = mountBonusIntroScreen({ root, bus });
  bus.emit(BI_OPEN, { bonusType: 'B1' });
  els.start.fireClick();
  screen.unmount();
  bus.emit(BI_OPEN, { bonusType: 'B1' });
  els.start.fireClick();
  assert.equal(n, 1);
});
