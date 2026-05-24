import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountJokerPicker, JOKER_INTENT, JOKER_PICKER_LETTERS } from './jokerPicker.js';

function makeStubBtn() {
  const listeners = [];
  const attrs = {};
  return {
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {} },
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

function makeJokerDom() {
  const overlayClasses = new Set(['ov', 'hidden']);
  const overlay = {
    classList: {
      add(c) { overlayClasses.add(c); },
      remove(c) { overlayClasses.delete(c); },
      contains(c) { return overlayClasses.has(c); },
    },
    querySelector(sel) {
      if (sel === 'button[onclick="cancelJoker()"]') return cancelBtn;
      return null;
    },
  };
  const cancelAttrs = { onclick: 'cancelJoker()' };
  const cancelListeners = [];
  const cancelBtn = {
    classList: { add() {}, remove() {} },
    getAttribute(n) { return cancelAttrs[n] ?? null; },
    setAttribute(n, v) { cancelAttrs[n] = v; },
    removeAttribute(n) { delete cancelAttrs[n]; },
    addEventListener(ev, fn) { cancelListeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of cancelListeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
  const gridChildren = [];
  const grid = {
    innerHTML: '',
    set _innerHTML(v) { this.innerHTML = v; gridChildren.length = 0; },
    appendChild(c) { gridChildren.push(c); },
    children: gridChildren,
  };
  const root = {
    createElement: () => makeStubBtn(),
    querySelector(sel) {
      if (sel === '#ov-joker') return overlay;
      if (sel === '#jok-grid') return grid;
      if (sel === 'button[onclick="cancelJoker()"]') return cancelBtn;
      return null;
    },
  };
  return { root, overlay, cancelBtn, grid, gridChildren };
}

test('open() populates #jok-grid with one button per Hebrew letter', () => {
  bus._reset();
  const { root, gridChildren } = makeJokerDom();
  const picker = mountJokerPicker({ root, bus });
  picker.open();
  assert.equal(gridChildren.length, JOKER_PICKER_LETTERS.length);
  // Buttons render the letter inside a .bt2-l span (rack-tile shape).
  assert.ok(
    gridChildren[0].innerHTML.includes(JOKER_PICKER_LETTERS[0]),
    `joker option should contain ${JOKER_PICKER_LETTERS[0]}`,
  );
  assert.equal(gridChildren[0].dataset.letter, JOKER_PICKER_LETTERS[0]);
});

test('open() removes the hidden class on the overlay; close() re-adds it', () => {
  bus._reset();
  const { root, overlay } = makeJokerDom();
  const picker = mountJokerPicker({ root, bus });
  picker.open();
  assert.ok(!overlay.classList.contains('hidden'));
  picker.close();
  assert.ok(overlay.classList.contains('hidden'));
});

test('clicking a letter button emits JOKER_INTENT.PICKED with that letter', () => {
  bus._reset();
  const { root, gridChildren, overlay } = makeJokerDom();
  const picks = [];
  bus.on(JOKER_INTENT.PICKED, p => picks.push(p));
  const picker = mountJokerPicker({ root, bus });
  picker.open();
  // Click the 5th letter
  const idx = 4;
  gridChildren[idx].fireClick();
  assert.equal(picks.length, 1);
  assert.equal(picks[0].letter, JOKER_PICKER_LETTERS[idx]);
  // Picking a letter also closes the picker
  assert.ok(overlay.classList.contains('hidden'));
});

test('cancel button emits JOKER_INTENT.CANCELLED + closes the picker', () => {
  bus._reset();
  const { root, cancelBtn, overlay } = makeJokerDom();
  const events = [];
  bus.on(JOKER_INTENT.CANCELLED, () => events.push('cancel'));
  const picker = mountJokerPicker({ root, bus });
  picker.open();
  cancelBtn.fireClick();
  assert.equal(events.length, 1);
  assert.ok(overlay.classList.contains('hidden'));
});

test('open() is idempotent — second call does not duplicate grid children', () => {
  bus._reset();
  const { root, gridChildren } = makeJokerDom();
  const picker = mountJokerPicker({ root, bus });
  picker.open();
  const before = gridChildren.length;
  picker.close();
  picker.open();
  assert.equal(gridChildren.length, before);
});

test('open() excludes Hebrew final-letter forms from joker choices', () => {
  const finals = new Set(['ך', 'ם', 'ן', 'ף', 'ץ']);
  assert.equal(JOKER_PICKER_LETTERS.some(letter => finals.has(letter)), false);
});
