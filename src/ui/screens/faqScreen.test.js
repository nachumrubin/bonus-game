// faqScreen unit tests. Hand-built DOM stub — no jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountFaqScreen } from './faqScreen.js';
import { MENU_INTENT } from './menuScreen.js';

function makeOverlay() {
  const classSet = new Set(['hidden']);
  return {
    classList: {
      add(c) { classSet.add(c); },
      remove(c) { classSet.delete(c); },
      contains(c) { return classSet.has(c); },
    },
  };
}

function makeRoot(overlay) {
  return {
    querySelector(sel) {
      if (sel === '#ov-faq') return overlay;
      return null;
    },
  };
}

test('OPEN_FAQ reveals the overlay', () => {
  bus._reset();
  const overlay = makeOverlay();
  mountFaqScreen({ root: makeRoot(overlay), bus });
  assert.equal(overlay.classList.contains('hidden'), true);
  bus.emit(MENU_INTENT.OPEN_FAQ);
  assert.equal(overlay.classList.contains('hidden'), false);
});

test('unmount: detaches subscription so OPEN_FAQ no longer reveals', () => {
  bus._reset();
  const overlay = makeOverlay();
  const f = mountFaqScreen({ root: makeRoot(overlay), bus });
  f.unmount();
  bus.emit(MENU_INTENT.OPEN_FAQ);
  assert.equal(overlay.classList.contains('hidden'), true);
});

test('missing #ov-faq returns a no-op mount', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const f = mountFaqScreen({ root, bus });
  assert.equal(typeof f.unmount, 'function');
  bus.emit(MENU_INTENT.OPEN_FAQ); // should not throw
});

test('throws when bus is missing', () => {
  assert.throws(() => mountFaqScreen({ root: makeRoot(makeOverlay()) }), /bus required/);
});
