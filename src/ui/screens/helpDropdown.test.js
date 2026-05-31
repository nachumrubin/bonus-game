// helpDropdown unit tests. Hand-built DOM stub — no jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountHelpDropdown } from './helpDropdown.js';
import { MENU_INTENT } from './menuScreen.js';

function makeEl({ classes = [], attrs = {} } = {}) {
  const classSet = new Set(classes);
  const listeners = [];
  return {
    style: {},
    _listeners: listeners,
    _attrs: { ...attrs },
    classList: {
      add(c)      { classSet.add(c); },
      remove(c)   { classSet.delete(c); },
      contains(c) { return classSet.has(c); },
    },
    contains(other) { return other === this; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    getAttribute(name) { return this._attrs[name] ?? null; },
    setAttribute(name, v) { this._attrs[name] = v; },
    removeAttribute(name) { delete this._attrs[name]; },
    getBoundingClientRect() { return { bottom: 50, right: 200, top: 10, left: 180, width: 20, height: 40 }; },
  };
}

function makeDom() {
  const items = [
    Object.assign(makeEl({ attrs: { 'data-action': 'tutorial' } }), { _action: 'tutorial' }),
    Object.assign(makeEl({ attrs: { 'data-action': 'guide' } }),    { _action: 'guide' }),
    Object.assign(makeEl({ attrs: { 'data-action': 'faq' } }),      { _action: 'faq' }),
  ];
  // Make each item click-callable.
  for (const it of items) {
    it.click = function () {
      for (const l of this._listeners) {
        if (l.ev === 'click') l.fn({ preventDefault() {}, stopPropagation() {} });
      }
    };
  }
  const dropdown = makeEl({ classes: ['hidden'] });
  dropdown.querySelectorAll = (sel) => sel === '.em-help-dropdown-item' ? items : [];
  const anchor = makeEl({ attrs: { onclick: 'showTutorialIntro()' } });
  const root = {
    documentElement: { clientWidth: 400 },
    querySelector(sel) {
      if (sel === '#em-help-dropdown') return dropdown;
      if (sel === 'button[onclick="showTutorialIntro()"]') return anchor;
      return null;
    },
    _docListeners: [],
    addEventListener(ev, fn, opts) { this._docListeners.push({ ev, fn, opts }); },
    removeEventListener(ev, fn, opts) {
      const i = this._docListeners.findIndex(l => l.ev === ev && l.fn === fn && l.opts === opts);
      if (i >= 0) this._docListeners.splice(i, 1);
    },
  };
  return { root, dropdown, items, anchor };
}

test('mount: hidden by default; OPEN_HELP_MENU reveals it', () => {
  bus._reset();
  const { root, dropdown } = makeDom();
  mountHelpDropdown({ root, bus });
  assert.equal(dropdown.classList.contains('hidden'), true);
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
  assert.equal(dropdown.classList.contains('hidden'), false);
});

test('OPEN_HELP_MENU toggles: second emit closes when already open', () => {
  bus._reset();
  const { root, dropdown } = makeDom();
  mountHelpDropdown({ root, bus });
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
  assert.equal(dropdown.classList.contains('hidden'), false);
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
  assert.equal(dropdown.classList.contains('hidden'), true);
});

test('tutorial item click emits OPEN_TUTORIAL and closes dropdown', () => {
  bus._reset();
  const { root, dropdown, items } = makeDom();
  const seen = [];
  bus.on(MENU_INTENT.OPEN_TUTORIAL, (p) => seen.push(p));
  mountHelpDropdown({ root, bus });
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
  items[0].click();
  assert.equal(seen.length, 1);
  assert.equal(dropdown.classList.contains('hidden'), true);
});

test('guide item click emits OPEN_GUIDE', () => {
  bus._reset();
  const { root, items } = makeDom();
  const seen = [];
  bus.on(MENU_INTENT.OPEN_GUIDE, (p) => seen.push(p));
  mountHelpDropdown({ root, bus });
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
  items[1].click();
  assert.equal(seen.length, 1);
});

test('faq item click emits OPEN_FAQ', () => {
  bus._reset();
  const { root, items } = makeDom();
  const seen = [];
  bus.on(MENU_INTENT.OPEN_FAQ, (p) => seen.push(p));
  mountHelpDropdown({ root, bus });
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
  items[2].click();
  assert.equal(seen.length, 1);
});

test('unmount: bus subscriptions detached', () => {
  bus._reset();
  const { root, dropdown } = makeDom();
  const dd = mountHelpDropdown({ root, bus });
  dd.unmount();
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
  // Hidden class never removed because the listener is detached.
  assert.equal(dropdown.classList.contains('hidden'), true);
});

test('missing #em-help-dropdown returns no-op mount', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const dd = mountHelpDropdown({ root, bus });
  assert.equal(typeof dd.unmount, 'function');
  // Should not throw
  bus.emit(MENU_INTENT.OPEN_HELP_MENU);
});
