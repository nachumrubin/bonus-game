// Unit tests for the screen transition animation wiring.
//
// The legacy showSc added:
//   - `screen-enter` to the newly visible screen
//   - `menu-logo-enter` to `.hlogo` inside #sh
//   - `menu-enter` to `.hbtns` inside #sh (temporary; removed after stagger)
// These tests verify the spine showSc preserves that behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { showScreen, SCREEN_IDS, _resetTransitionState } from './screenTransitions.js';

function makeEl({ id, classes = [] } = {}) {
  const cls = new Set(classes);
  const children = [];
  let parent = null;
  const el = {
    id,
    style: {},
    get className() { return Array.from(cls).join(' '); },
    classList: {
      add(...c) { c.forEach(x => cls.add(x)); },
      remove(...c) { c.forEach(x => cls.delete(x)); },
      contains(c) { return cls.has(c); },
    },
    get parentNode() { return parent; },
    get children() { return children; },
    appendChild(c) { children.push(c); c._setParent?.(el); return c; },
    _setParent(p) { parent = p; },
    querySelector(sel) {
      // very crude: match `.className` and `#id`
      for (const c of children) {
        if (sel.startsWith('.') && c.className?.split(/\s+/).includes(sel.slice(1))) return c;
        if (sel.startsWith('#') && c.id === sel.slice(1)) return c;
      }
      return null;
    },
    get offsetWidth() { return 1; },
  };
  return el;
}

function makeDocWithScreens(extra = {}) {
  const elements = new Map();
  for (const id of SCREEN_IDS) {
    elements.set(id, makeEl({ id, classes: ['screen', 'hidden'] }));
  }
  // Add #sh children to mimic home screen markup
  const hlogo = makeEl({ id: 'hlogo', classes: ['hlogo'] });
  const hbtns = makeEl({ id: 'hbtns', classes: ['hbtns'] });
  elements.get('sh').appendChild(hlogo);
  elements.get('sh').appendChild(hbtns);
  Object.assign(elements, extra);
  return {
    elements,
    doc: {
      getElementById: (id) => elements.get(id) ?? null,
    },
  };
}

test('showScreen marks target screen visible and others hidden', () => {
  const { doc, elements } = makeDocWithScreens();
  showScreen('sg', { doc });
  assert.ok(!elements.get('sg').classList.contains('hidden'));
  assert.ok(elements.get('sh').classList.contains('hidden'));
  assert.ok(elements.get('ss').classList.contains('hidden'));
  _resetTransitionState();
});

test('showScreen adds screen-enter to the newly shown screen', () => {
  const { doc, elements } = makeDocWithScreens();
  showScreen('sg', { doc });
  assert.ok(elements.get('sg').classList.contains('screen-enter'),
    'shown screen should get screen-enter');
  assert.ok(!elements.get('sh').classList.contains('screen-enter'),
    'hidden screens should not retain screen-enter');
  _resetTransitionState();
});

test('showScreen("sh") adds menu-logo-enter to .hlogo and menu-enter to .hbtns', () => {
  const { doc, elements } = makeDocWithScreens();
  showScreen('sh', { doc });
  const sh = elements.get('sh');
  const logo = sh.querySelector('.hlogo');
  const btns = sh.querySelector('.hbtns');
  assert.ok(logo.classList.contains('menu-logo-enter'),
    '.hlogo should receive menu-logo-enter');
  assert.ok(btns.classList.contains('menu-enter'),
    '.hbtns should receive menu-enter');
  _resetTransitionState();
});

test('showScreen schedules menu-enter removal so pointer-events:none lifts', () => {
  const { doc, elements } = makeDocWithScreens();
  let scheduled = null;
  const setTimeoutFn = (fn, ms) => { scheduled = { fn, ms }; return 1; };
  const clearTimeoutFn = () => {};
  showScreen('sh', { doc, setTimeoutFn, clearTimeoutFn });
  assert.ok(scheduled, 'a menu-enter cleanup timer should be scheduled');
  assert.ok(scheduled.ms >= 1000 && scheduled.ms <= 1500,
    'cleanup delay should cover the staggered animation (≈ 0.96s)');
  // Fire the scheduled callback and verify menu-enter is removed.
  scheduled.fn();
  const btns = elements.get('sh').querySelector('.hbtns');
  assert.ok(!btns.classList.contains('menu-enter'),
    'menu-enter should be cleared once the stagger finishes');
  _resetTransitionState();
});

test('showScreen returns null when no matching screen element exists', () => {
  const result = showScreen('sg', { doc: { getElementById: () => null } });
  assert.equal(result, null);
});
