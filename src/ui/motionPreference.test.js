import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMotionPreference } from './motionPreference.js';
import { UI_PREFERENCES_KEY } from '../game/settings/settingsCompat.js';

function storage(initialPrefs) {
  const data = new Map();
  if (initialPrefs) data.set(UI_PREFERENCES_KEY, JSON.stringify(initialPrefs));
  return {
    setItem(k, v) { data.set(k, String(v)); },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    _data: data,
  };
}

function matchMediaFn(matches) {
  return () => ({
    matches,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
}

function fakeRoot() {
  const attrs = new Map();
  return {
    setAttribute(k, v) { attrs.set(k, v); },
    removeAttribute(k) { attrs.delete(k); },
    _attrs: attrs,
  };
}

test('default: no explicit choice + OS normal → full motion', () => {
  const root = fakeRoot();
  const mp = createMotionPreference({ storage: storage(), matchMediaFn: matchMediaFn(false), root });
  assert.equal(mp.isReduced(), false);
  assert.equal(mp.animationsEnabled(), true);
  assert.equal(mp.explicit(), 'auto');
  assert.equal(root._attrs.has('data-reduced-motion'), false);
});

test('OS reduced + no explicit choice → reduced (follows OS)', () => {
  const root = fakeRoot();
  const mp = createMotionPreference({ storage: storage(), matchMediaFn: matchMediaFn(true), root });
  assert.equal(mp.isReduced(), true);
  assert.equal(mp.animationsEnabled(), false);
  assert.equal(root._attrs.get('data-reduced-motion'), '1');
});

test('explicit off overrides OS reduced', () => {
  const root = fakeRoot();
  const mp = createMotionPreference({
    storage: storage({ reducedMotion: 'off' }),
    matchMediaFn: matchMediaFn(true),
    root,
  });
  assert.equal(mp.isReduced(), false, 'explicit off wins over OS reduce');
  assert.equal(mp.osPrefersReduced(), true);
  assert.equal(root._attrs.get('data-full-motion'), '1', 'CSS media-query override is stamped');
  assert.equal(root._attrs.has('data-reduced-motion'), false);
});

test('explicit on overrides OS normal', () => {
  const root = fakeRoot();
  const mp = createMotionPreference({
    storage: storage({ reducedMotion: 'on' }),
    matchMediaFn: matchMediaFn(false),
    root,
  });
  assert.equal(mp.isReduced(), true, 'explicit on wins over OS normal');
  assert.equal(root._attrs.get('data-reduced-motion'), '1');
  assert.equal(root._attrs.has('data-full-motion'), false);
});

test('OS preference is NOT persisted as an explicit choice', () => {
  const s = storage(); // empty — no explicit preference stored
  const mp = createMotionPreference({ storage: s, matchMediaFn: matchMediaFn(true), root: fakeRoot() });
  assert.equal(mp.isReduced(), true);
  // Resolving from the OS must never write the OS value back into storage.
  assert.equal(s._data.has(UI_PREFERENCES_KEY), false, 'storage untouched — OS pref not persisted');
  assert.equal(mp.explicit(), 'auto', 'stored choice stays auto');
});

test('legacy skipAnimations:true migrates to reduced', () => {
  const mp = createMotionPreference({
    storage: storage({ skipAnimations: true }),
    matchMediaFn: matchMediaFn(false),
    root: fakeRoot(),
  });
  assert.equal(mp.isReduced(), true, 'legacy animations-off honoured as reduced');
});

test('refresh() re-stamps the root attribute after a stored change', () => {
  const s = storage();
  const root = fakeRoot();
  const mp = createMotionPreference({ storage: s, matchMediaFn: matchMediaFn(false), root });
  assert.equal(root._attrs.has('data-reduced-motion'), false);
  s.setItem(UI_PREFERENCES_KEY, JSON.stringify({ reducedMotion: 'on' }));
  let notified = null;
  mp.onChange((reduced) => { notified = reduced; });
  mp.refresh();
  assert.equal(root._attrs.get('data-reduced-motion'), '1');
  assert.equal(notified, true, 'listeners are notified on refresh');
});

test('degrades safely when matchMedia is unavailable', () => {
  const mp = createMotionPreference({ storage: storage(), matchMediaFn: null, root: fakeRoot() });
  assert.equal(mp.osPrefersReduced(), false);
  assert.equal(mp.isReduced(), false);
});
