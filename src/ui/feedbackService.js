// feedbackService — short SFX (WebAudio synth) + haptic feedback (vibrate).
//
// Subscribes to bus events and produces a brief cue. All cues are gated on
// two persisted settings: `soundFx` and `vibration` (settingsCompat).
//
// Events listened to:
//   - EV.INVALID_MOVE_REJECTED  — illegal move (low buzz + short vibrate)
//   - EV.BOOST_ACTIVATED        — bonus square hit (upward chirp + pulse)
//                                 skipped when payload.consumed or .pending
//   - 'timer/tick'              — turn-timer reached 3, 2, or 1 second
//   - II_OPEN ('incomingInvite/open') — invite overlay opening
//   - EV.GAME_COMPLETED         — game over (3-note arpeggio + pattern)
//   - EV.TURN_CHANGED           — your turn (filtered; skipped on first turn)
//   - SETTINGS_CHANGED          — repaint internal enabled flags
//
// Public surface:
//   init({ storage, doc, bus, sessionRef? })
//   isSoundEnabled() / setSoundEnabled(bool)
//   isVibrationEnabled() / setVibrationEnabled(bool)
//   dispose()

import {
  loadUiPreferences,
  mergeUiPreferences,
  applyGameSettingsToGlobals,
  saveGameSettings,
  normalizeGameSettings,
} from '../game/settings/settingsCompat.js';
import { EV } from '../events/eventTypes.js';
import { II_OPEN } from './screens/incomingInviteScreen.js';
import { SETTINGS_CHANGED } from './screens/settingsScreen.js';

const state = {
  initialized: false,
  storage: null,
  doc: null,
  bus: null,
  sessionRef: null,
  soundFx: true,
  vibration: true,
  ctx: null,
  // Flips true the first time we observe a real user gesture (pointer/key).
  // Until then, ensureCtx() returns null so playTone() is a no-op — creating
  // an AudioContext pre-gesture starts it suspended and any later resume()
  // call triggers Chrome's "AudioContext was not allowed to start" warning.
  unlocked: false,
  unlockArmed: false,
  unlockHandler: null,
  cleanups: [],
  sawFirstTurn: false,
};

export function init({ storage, doc, bus, sessionRef } = {}) {
  if (state.initialized) return getStatus();
  state.storage = storage ?? globalThis.localStorage ?? null;
  state.doc = doc ?? globalThis.document ?? null;
  state.bus = bus ?? null;
  state.sessionRef = typeof sessionRef === 'function'
    ? sessionRef
    : () => globalThis.__spine?.activeGame ?? null;

  const prefs = loadUiPreferences(state.storage);
  state.soundFx = prefs.soundFx;
  state.vibration = prefs.vibration;
  state.initialized = true;

  armUnlock();
  subscribeBus();
  return getStatus();
}

export function isSoundEnabled() { return !!state.soundFx; }
export function isVibrationEnabled() { return !!state.vibration; }

export function setSoundEnabled(next) {
  const want = !!next;
  if (state.soundFx === want) return getStatus();
  state.soundFx = want;
  persist({ soundFx: want });
  return getStatus();
}

export function setVibrationEnabled(next) {
  const want = !!next;
  if (state.vibration === want) return getStatus();
  state.vibration = want;
  persist({ vibration: want });
  return getStatus();
}

export function getStatus() {
  return { soundFx: state.soundFx, vibration: state.vibration };
}

export function dispose() {
  for (const off of state.cleanups.splice(0)) {
    try { off(); } catch {}
  }
  if (state.unlockHandler && state.doc?.removeEventListener) {
    state.doc.removeEventListener('pointerdown', state.unlockHandler);
    state.doc.removeEventListener('keydown',     state.unlockHandler);
    state.doc.removeEventListener('touchstart',  state.unlockHandler);
  }
  state.unlockHandler = null;
  state.unlockArmed = false;
  state.unlocked = false;
  if (state.ctx && typeof state.ctx.close === 'function') {
    try { state.ctx.close(); } catch {}
  }
  state.ctx = null;
  state.initialized = false;
  state.sawFirstTurn = false;
}

// ─── Bus subscriptions ─────────────────────────────────────

function subscribeBus() {
  if (!state.bus?.on) return;
  state.cleanups.push(state.bus.on(EV.INVALID_MOVE_REJECTED, onInvalid));
  state.cleanups.push(state.bus.on(EV.BOOST_ACTIVATED, onBoost));
  state.cleanups.push(state.bus.on('timer/tick', onTimerTick));
  state.cleanups.push(state.bus.on(II_OPEN, onInvite));
  state.cleanups.push(state.bus.on(EV.GAME_COMPLETED, onGameOver));
  state.cleanups.push(state.bus.on(EV.GAME_STARTED, () => { state.sawFirstTurn = false; }));
  state.cleanups.push(state.bus.on(EV.TURN_CHANGED, onTurnChanged));
  state.cleanups.push(state.bus.on(SETTINGS_CHANGED, onSettingsChanged));
}

function onInvalid() {
  playTone({ freq: 180, dur: 140, type: 'square', gain: 0.18, slideTo: 120 });
  buzz([60]);
}

function onBoost(payload) {
  if (payload?.consumed || payload?.pending) return;
  playTone({ freq: 660, dur: 180, type: 'sine', gain: 0.16, slideTo: 990 });
  buzz([40, 30, 40]);
}

function onTimerTick(payload) {
  const secs = Number(payload?.secs);
  if (!(secs >= 1 && secs <= 3)) return;
  playTone({ freq: 880, dur: 60, type: 'sine', gain: 0.14 });
  buzz([20]);
}

function onInvite() {
  playSequence([
    { freq: 784, dur: 120, type: 'sine', gain: 0.16 },
    { freq: 1175, dur: 120, type: 'sine', gain: 0.16, delay: 130 },
  ]);
  buzz([80, 60, 80]);
}

function onGameOver() {
  playSequence([
    { freq: 523, dur: 160, type: 'sine', gain: 0.18 },
    { freq: 659, dur: 160, type: 'sine', gain: 0.18, delay: 170 },
    { freq: 784, dur: 220, type: 'sine', gain: 0.18, delay: 340 },
  ]);
  buzz([120, 80, 120, 80, 200]);
}

function onTurnChanged() {
  // Suppress the very first TURN_CHANGED of a game — GAME_STARTED already
  // marks the opening. After that, fire only when control is on the local
  // human's slot (or always, in 2P local where mySlot is null).
  if (!state.sawFirstTurn) { state.sawFirstTurn = true; return; }
  const active = state.sessionRef?.();
  const mySlot = active?.mySlot;
  const currentSlot = active?.session?.state?.currentTurnSlot;
  if (mySlot != null && currentSlot !== mySlot) return;
  playTone({ freq: 523, dur: 90, type: 'triangle', gain: 0.12 });
  buzz([30]);
}

function onSettingsChanged(changes = {}) {
  if (Object.prototype.hasOwnProperty.call(changes, 'soundFx')) {
    state.soundFx = !!changes.soundFx;
    persist({ soundFx: state.soundFx });
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'vibration')) {
    state.vibration = !!changes.vibration;
    persist({ vibration: state.vibration });
  }
}

// ─── Audio engine ──────────────────────────────────────────

function ensureCtx() {
  if (!state.soundFx) return null;
  // Defer creation until we've seen a real gesture. Without this, an event
  // arriving before any user interaction (or a stray playTone call) would
  // create the AudioContext in suspended state, and Chrome would log
  // "AudioContext was not allowed to start" on the next resume().
  if (!state.unlocked) return null;
  if (state.ctx) return state.ctx;
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try {
    state.ctx = new Ctor();
  } catch {
    state.ctx = null;
  }
  return state.ctx;
}

function playTone({ freq = 440, dur = 120, type = 'sine', gain = 0.15, slideTo = null, delay = 0 } = {}) {
  const ctx = ensureCtx();
  if (!ctx) return;
  // Resume here (not in the unlock handler) so the resume() call lives in
  // the same call stack as the user action that triggered this SFX. Chrome
  // ties activation to the synchronous call chain — resuming this way
  // avoids the "AudioContext was not allowed to start" warning.
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    try { ctx.resume().catch(() => {}); } catch {}
  }
  const t0 = ctx.currentTime + Math.max(0, delay) / 1000;
  const t1 = t0 + dur / 1000;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t1);
  }
  // Quick attack + exponential decay so tones don't click.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

function playSequence(notes) {
  if (!Array.isArray(notes)) return;
  for (const n of notes) playTone(n);
}

function buzz(pattern) {
  if (!state.vibration) return;
  const nav = globalThis.navigator;
  if (!nav || typeof nav.vibrate !== 'function') return;
  try { nav.vibrate(pattern); } catch {}
}

// ─── iOS / autoplay unlock ─────────────────────────────────

function armUnlock() {
  const doc = state.doc;
  if (!doc?.addEventListener || state.unlockArmed) return;
  state.unlockArmed = true;
  // The handler is intentionally INERT — it just flips a flag the first
  // time we observe a user gesture. We deliberately do NOT touch any audio
  // API here (no AudioContext creation, no resume(), no silent-buffer
  // warm-up): those calls log Chrome's "AudioContext was not allowed to
  // start" warning if Chrome can't tie them to the activation. By the time
  // playTone() runs the user has clicked a button → game event → SFX, so
  // sticky activation is firmly established and the context can be created
  // and started cleanly there.
  const handler = () => {
    state.unlocked = true;
    state.unlockHandler = null;
  };
  state.unlockHandler = handler;
  doc.addEventListener('pointerdown', handler, { once: true });
  doc.addEventListener('keydown',     handler, { once: true });
  doc.addEventListener('touchstart',  handler, { once: true });
}

// ─── Persistence ───────────────────────────────────────────

function persist(patch) {
  if (!state.storage) return;
  try { mergeUiPreferences(state.storage, patch); } catch {}
  try {
    const merged = normalizeGameSettings({ ...(globalThis.gameSettings ?? {}), ...patch });
    applyGameSettingsToGlobals(globalThis, merged);
    saveGameSettings(state.storage, merged);
  } catch {}
}
