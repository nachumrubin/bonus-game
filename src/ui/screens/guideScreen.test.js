// guideScreen unit tests. Hand-built DOM stub — no jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountGuideScreen } from './guideScreen.js';
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
      if (sel === '#ov-guide') return overlay;
      return null;
    },
  };
}

test('OPEN_GUIDE reveals the overlay', () => {
  bus._reset();
  const overlay = makeOverlay();
  mountGuideScreen({ root: makeRoot(overlay), bus });
  assert.equal(overlay.classList.contains('hidden'), true);
  bus.emit(MENU_INTENT.OPEN_GUIDE);
  assert.equal(overlay.classList.contains('hidden'), false);
});

test('unmount: detaches subscription so OPEN_GUIDE no longer reveals', () => {
  bus._reset();
  const overlay = makeOverlay();
  const g = mountGuideScreen({ root: makeRoot(overlay), bus });
  g.unmount();
  bus.emit(MENU_INTENT.OPEN_GUIDE);
  assert.equal(overlay.classList.contains('hidden'), true);
});

test('missing #ov-guide returns a no-op mount', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const g = mountGuideScreen({ root, bus });
  assert.equal(typeof g.unmount, 'function');
  bus.emit(MENU_INTENT.OPEN_GUIDE); // should not throw
});

test('throws when bus is missing', () => {
  assert.throws(() => mountGuideScreen({ root: makeRoot(makeOverlay()) }), /bus required/);
});
