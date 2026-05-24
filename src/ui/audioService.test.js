import test from 'node:test';
import assert from 'node:assert/strict';

import * as audioService from './audioService.js';
import { loadUiPreferences, UI_PREFERENCES_KEY } from '../game/settings/settingsCompat.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function makeButton() {
  const icon = { textContent: '🎵' };
  const label = { textContent: 'מוזיקה' };
  const classes = new Set();
  const attrs = new Map();
  return {
    querySelector(sel) {
      if (sel === '.tb-ic') return icon;
      if (sel === '.tb-tx') return label;
      return null;
    },
    classList: {
      toggle(name, force) {
        const has = classes.has(name);
        const want = force === undefined ? !has : !!force;
        if (want) classes.add(name); else classes.delete(name);
      },
      contains: (n) => classes.has(n),
    },
    setAttribute(name, value) { attrs.set(name, value); },
    getAttribute: (n) => attrs.get(n) ?? null,
    _state: { icon, label, classes, attrs },
  };
}

function makeDoc(button) {
  return {
    querySelector(sel) { return sel === '#music-toggle' ? button : null; },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

test.afterEach(() => {
  audioService.dispose();
  delete globalThis.APP_CONFIG;
});

test('init reads persisted music pref and paints the button', () => {
  const storage = makeStorage({ [UI_PREFERENCES_KEY]: JSON.stringify({ music: false }) });
  const btn = makeButton();
  const status = audioService.init({ storage, doc: makeDoc(btn) });
  assert.equal(status.enabled, false);
  assert.equal(btn._state.icon.textContent, '🔇');
  assert.equal(btn._state.label.textContent, 'מושתק');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.ok(btn._state.classes.has('muted'));
});

test('toggle flips state, persists, and updates button', () => {
  const storage = makeStorage({ [UI_PREFERENCES_KEY]: JSON.stringify({ music: true }) });
  const btn = makeButton();
  audioService.init({ storage, doc: makeDoc(btn) });

  audioService.toggle();
  assert.equal(audioService.isEnabled(), false);
  assert.equal(loadUiPreferences(storage).music, false);
  assert.equal(btn._state.icon.textContent, '🔇');

  audioService.toggle();
  assert.equal(audioService.isEnabled(), true);
  assert.equal(loadUiPreferences(storage).music, true);
  assert.equal(btn._state.icon.textContent, '🎵');
});

test('setEnabled(true) is a no-op on identical state but still refreshes button', () => {
  const storage = makeStorage({ [UI_PREFERENCES_KEY]: JSON.stringify({ music: true }) });
  const btn = makeButton();
  audioService.init({ storage, doc: makeDoc(btn) });
  btn._state.icon.textContent = 'STALE';
  audioService.setEnabled(true);
  assert.equal(btn._state.icon.textContent, '🎵');
  assert.equal(loadUiPreferences(storage).music, true);
});

test('no source → toggle still works without throwing', () => {
  const storage = makeStorage({});
  const btn = makeButton();
  audioService.init({ storage, doc: makeDoc(btn) });
  assert.doesNotThrow(() => audioService.toggle());
  assert.equal(audioService.getStatus().hasSource, false);
});

test('APP_CONFIG.musicUrl is picked up as source', () => {
  globalThis.APP_CONFIG = { musicUrl: 'about:blank' };
  const storage = makeStorage({});
  const btn = makeButton();
  const originalAudio = globalThis.Audio;
  let constructed = 0;
  globalThis.Audio = class FakeAudio {
    constructor(src) { this.src = src; this.paused = true; constructed++; }
    play() { this.paused = false; return { catch: () => {} }; }
    pause() { this.paused = true; }
  };
  try {
    audioService.init({ storage, doc: makeDoc(btn) });
    assert.equal(audioService.getStatus().hasSource, true);
    assert.equal(constructed, 1);
  } finally {
    if (originalAudio) globalThis.Audio = originalAudio; else delete globalThis.Audio;
  }
});
