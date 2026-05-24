// Low-severity gap parity: menu transition clickability + audio scheduling.
//
// Menu transition (legacy showSc at HEAD:index.html:3256-3274):
//   - Every screen change adds `screen-transitioning` to the active screen
//     for 380 ms. The CSS rule `.screen-transitioning, .screen-transitioning *
//     { pointer-events: none }` blocks clicks on the new screen + its
//     buttons during the fade-in animation.
//   - The home screen additionally gets `menu-enter` on `.hbtns` for the
//     staggered button-entrance animation (already covered in
//     screenTransitions.test.js).
//
// Audio scheduling (legacy musicTimeout/scheduleMelody at HEAD:7503-7561):
//   - Legacy synthesized Minuet in G via Web Audio. Spine replaces this
//     with an HTMLAudioElement loaded from APP_CONFIG.musicUrl — deliberate
//     simplification noted in src/ui/audioService.js header.
//   - Functional parity we DO need: enabling music starts playback,
//     disabling pauses it immediately, and the persisted preference is
//     honored on re-init.

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Menu transition: pointer-blocking on every screen change ──────────

function loadTransitions() {
  return import('../../src/ui/screens/screenTransitions.js');
}

function makeScreenEl(id) {
  const cls = new Set(['screen', 'hidden']);
  return {
    id,
    classList: {
      add(...c) { c.forEach(x => cls.add(x)); },
      remove(...c) { c.forEach(x => cls.delete(x)); },
      contains(c) { return cls.has(c); },
    },
    get offsetWidth() { return 1; },
    querySelector: () => null,
  };
}

function makeDoc(ids = ['sh', 'ss', 'sg', 'so', 'scoin']) {
  const els = new Map();
  for (const id of ids) els.set(id, makeScreenEl(id));
  return { doc: { getElementById: (id) => els.get(id) ?? null }, els };
}

test('parity: every screen transition adds screen-transitioning to the new screen', async () => {
  const { showScreen, _resetTransitionState } = await loadTransitions();
  const { doc, els } = makeDoc();

  let scheduled = null;
  const setTimeoutFn = (fn, ms) => { scheduled = { fn, ms }; return 1; };
  const clearTimeoutFn = () => {};

  showScreen('sg', { doc, setTimeoutFn, clearTimeoutFn });
  assert.ok(els.get('sg').classList.contains('screen-transitioning'),
    'new screen gets screen-transitioning to block pointer events');
  assert.ok(scheduled, 'cleanup timer scheduled');
  assert.equal(scheduled.ms, 380, 'duration matches legacy setTimeout(...380)');

  // Fire the cleanup — class lifts so the screen becomes interactive.
  scheduled.fn();
  assert.ok(!els.get('sg').classList.contains('screen-transitioning'),
    'screen-transitioning removed after the timer fires');

  _resetTransitionState();
});

test('parity: rapid home → setup → back cancels the stale transitioning class', async () => {
  const { showScreen, _resetTransitionState } = await loadTransitions();
  const { doc, els } = makeDoc();

  const timers = [];
  let cleared = 0;
  const setTimeoutFn = (fn, ms) => { const id = timers.push({ fn, ms, alive: true }); return id; };
  const clearTimeoutFn = (id) => { const t = timers[id - 1]; if (t) { t.alive = false; cleared++; } };

  showScreen('ss', { doc, setTimeoutFn, clearTimeoutFn });
  assert.ok(els.get('ss').classList.contains('screen-transitioning'));
  showScreen('sh', { doc, setTimeoutFn, clearTimeoutFn });

  // After the second transition, the stale timer must be cancelled and the
  // previous screen's transitioning class stripped (it's hidden anyway, but
  // cosmetically we want a clean state). The new screen gets blocked.
  assert.equal(cleared, 1, 'stale transition timer cleared');
  assert.ok(!els.get('ss').classList.contains('screen-transitioning'),
    'previous screen no longer carries screen-transitioning');
  assert.ok(els.get('sh').classList.contains('screen-transitioning'),
    'new screen blocked for its own fade-in');

  // Fire only the active timer.
  const liveTimer = timers.find(t => t.alive);
  liveTimer.fn();
  assert.ok(!els.get('sh').classList.contains('screen-transitioning'),
    'live timer cleared after firing');

  _resetTransitionState();
});

test('parity: _resetTransitionState clears any in-flight transition block', async () => {
  const { showScreen, _resetTransitionState } = await loadTransitions();
  const { doc, els } = makeDoc();
  showScreen('sg', { doc });
  assert.ok(els.get('sg').classList.contains('screen-transitioning'));
  _resetTransitionState();
  assert.ok(!els.get('sg').classList.contains('screen-transitioning'),
    'reset strips the class so subsequent tests start clean');
});

// ─── Audio scheduling: play/pause actually invoked, persists across init ──

function loadAudio() {
  return import('../../src/ui/audioService.js');
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function makeButton() {
  const icon = { textContent: '' };
  const label = { textContent: '' };
  const classes = new Set();
  return {
    querySelector(sel) { return sel === '.tb-ic' ? icon : sel === '.tb-tx' ? label : null; },
    classList: {
      toggle(name, force) { (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name); },
      contains: (n) => classes.has(n),
    },
    setAttribute() {},
    getAttribute: () => null,
  };
}

function makeDocForAudio(btn) {
  return {
    querySelector(sel) { return sel === '#music-toggle' ? btn : null; },
    addEventListener() {},
    removeEventListener() {},
  };
}

function installFakeAudio() {
  const instances = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.paused = true;
      this.playCount = 0;
      this.pauseCount = 0;
      instances.push(this);
    }
    play() { this.paused = false; this.playCount++; return { catch: () => {} }; }
    pause() { this.paused = true; this.pauseCount++; }
  }
  const prev = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  return {
    instances,
    restore: () => { if (prev) globalThis.Audio = prev; else delete globalThis.Audio; },
  };
}

test('parity: enabling music with a source actually calls Audio.play', async () => {
  const audio = await loadAudio();
  const { UI_PREFERENCES_KEY } = await import('../../src/game/settings/settingsCompat.js');
  const fake = installFakeAudio();
  globalThis.APP_CONFIG = { musicUrl: 'about:blank' };
  try {
    const storage = makeStorage({ [UI_PREFERENCES_KEY]: JSON.stringify({ music: true }) });
    audio.init({ storage, doc: makeDocForAudio(makeButton()) });
    assert.equal(fake.instances.length, 1, 'one Audio constructed');
    assert.equal(fake.instances[0].playCount, 1, 'play() invoked because music enabled');
    assert.equal(fake.instances[0].paused, false);
  } finally {
    audio.dispose();
    fake.restore();
    delete globalThis.APP_CONFIG;
  }
});

test('parity: disabling music immediately pauses the audio element', async () => {
  const audio = await loadAudio();
  const { UI_PREFERENCES_KEY } = await import('../../src/game/settings/settingsCompat.js');
  const fake = installFakeAudio();
  globalThis.APP_CONFIG = { musicUrl: 'about:blank' };
  try {
    const storage = makeStorage({ [UI_PREFERENCES_KEY]: JSON.stringify({ music: true }) });
    audio.init({ storage, doc: makeDocForAudio(makeButton()) });
    audio.setEnabled(false);
    assert.equal(fake.instances[0].paused, true, 'paused after setEnabled(false)');
    assert.ok(fake.instances[0].pauseCount >= 1, 'pause() invoked');
  } finally {
    audio.dispose();
    fake.restore();
    delete globalThis.APP_CONFIG;
  }
});

test('parity: re-init with persisted disabled does NOT auto-play', async () => {
  const audio = await loadAudio();
  const { UI_PREFERENCES_KEY } = await import('../../src/game/settings/settingsCompat.js');
  const fake = installFakeAudio();
  globalThis.APP_CONFIG = { musicUrl: 'about:blank' };
  try {
    // Simulate the user disabling music in a previous session.
    const storage = makeStorage({ [UI_PREFERENCES_KEY]: JSON.stringify({ music: false }) });
    audio.init({ storage, doc: makeDocForAudio(makeButton()) });
    assert.equal(fake.instances.length, 1, 'Audio still constructed (lazy source binding)');
    assert.equal(fake.instances[0].playCount, 0, 'play() NOT invoked when music disabled');
    assert.equal(fake.instances[0].pauseCount, 1, 'pause() invoked to enforce the off state');
  } finally {
    audio.dispose();
    fake.restore();
    delete globalThis.APP_CONFIG;
  }
});

test('parity: toggle persists and survives a dispose+init round trip', async () => {
  const audio = await loadAudio();
  const { UI_PREFERENCES_KEY, loadUiPreferences } = await import('../../src/game/settings/settingsCompat.js');
  const fake = installFakeAudio();
  globalThis.APP_CONFIG = { musicUrl: 'about:blank' };
  try {
    const storage = makeStorage({ [UI_PREFERENCES_KEY]: JSON.stringify({ music: true }) });
    audio.init({ storage, doc: makeDocForAudio(makeButton()) });
    audio.toggle(); // → false
    assert.equal(loadUiPreferences(storage).music, false);
    audio.dispose();

    // Simulate a reload — fresh module state, same storage.
    audio.init({ storage, doc: makeDocForAudio(makeButton()) });
    assert.equal(audio.isEnabled(), false, 'persisted preference honored on re-init');
    // Audio constructed twice across both inits; the post-reload instance
    // must not have played.
    const post = fake.instances.at(-1);
    assert.equal(post.playCount, 0, 'post-reload instance never auto-plays when disabled');
  } finally {
    audio.dispose();
    fake.restore();
    delete globalThis.APP_CONFIG;
  }
});

test('parity: no source → toggle does not throw and never tries to construct Audio', async () => {
  const audio = await loadAudio();
  const fake = installFakeAudio();
  // No APP_CONFIG.musicUrl
  try {
    const storage = makeStorage({});
    audio.init({ storage, doc: makeDocForAudio(makeButton()) });
    audio.toggle();
    audio.toggle();
    assert.equal(fake.instances.length, 0, 'no Audio constructed without a source');
  } finally {
    audio.dispose();
    fake.restore();
  }
});
