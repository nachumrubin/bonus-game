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
//   - EV.TURN_PRESENTATION_READY — your turn, synchronized with clock + flash
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
import { AV_UNLOCK_OPEN } from './screens/avatarScreens.js';
import { RATING_EVT } from '../game/account/ratingService.js';

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
  lastTurnSignature: null,
  lastMoveSignature: null,
  lastOutcomeSignature: null,
  lastAchievementSignature: null,
  lastRatingSignature: null,
  cueSink: null,
  hapticSink: null,
};

export function init({ storage, doc, bus, sessionRef, cueSink, hapticSink } = {}) {
  if (state.initialized) return getStatus();
  state.storage = storage ?? globalThis.localStorage ?? null;
  state.doc = doc ?? globalThis.document ?? null;
  state.bus = bus ?? null;
  state.sessionRef = typeof sessionRef === 'function'
    ? sessionRef
    : () => globalThis.__spine?.activeGame ?? null;
  state.cueSink = typeof cueSink === 'function' ? cueSink : null;
  state.hapticSink = typeof hapticSink === 'function' ? hapticSink : null;

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
  state.lastTurnSignature = null;
  state.lastMoveSignature = null;
  state.lastOutcomeSignature = null;
  state.lastAchievementSignature = null;
  state.lastRatingSignature = null;
  state.cueSink = null;
  state.hapticSink = null;
}

// ─── Bus subscriptions ─────────────────────────────────────

function subscribeBus() {
  if (!state.bus?.on) return;
  state.cleanups.push(state.bus.on(EV.INVALID_MOVE_REJECTED, onInvalid));
  state.cleanups.push(state.bus.on(EV.MOVE_CONFIRMED, onMoveConfirmed));
  state.cleanups.push(state.bus.on(EV.BOOST_ACTIVATED, onBoost));
  state.cleanups.push(state.bus.on('timer/tick', onTimerTick));
  state.cleanups.push(state.bus.on(II_OPEN, onInvite));
  state.cleanups.push(state.bus.on(EV.GAME_COMPLETED, onGameOver));
  state.cleanups.push(state.bus.on(AV_UNLOCK_OPEN, onAchievement));
  state.cleanups.push(state.bus.on(RATING_EVT.CHANGED, onRatingChanged));
  state.cleanups.push(state.bus.on(EV.GAME_STARTED, resetGameDedup));
  state.cleanups.push(state.bus.on(EV.TURN_PRESENTATION_READY, onTurnChanged));
  state.cleanups.push(state.bus.on(SETTINGS_CHANGED, onSettingsChanged));
}

function onInvalid() {
  reportCue('invalid');
  playTone({ freq: 180, dur: 140, type: 'square', gain: 0.18, slideTo: 120 });
  buzz([60]);
}

function onMoveConfirmed(payload = {}) {
  if (!Array.isArray(payload.words) || payload.words.length === 0) return;
  const active = state.sessionRef?.();
  const turnNumber = payload.turnNumber ?? active?.session?.state?.turnNumber ?? '';
  const placed = Array.isArray(payload.placed)
    ? payload.placed.map(tile => `${tile.r},${tile.c}`).join(';')
    : '';
  const signature = `${payload.slot ?? ''}:${turnNumber}:${payload.words.join('|')}:${placed}:${payload.score ?? ''}`;
  if (signature === state.lastMoveSignature) return;
  state.lastMoveSignature = signature;
  reportCue('accepted');
  playTone({ freq: 360, dur: 55, type: 'triangle', gain: 0.07, slideTo: 420 });
}

function onBoost(payload) {
  if (payload?.consumed || payload?.pending) return;
  reportCue('boost');
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

function onGameOver(payload = {}) {
  const outcome = localOutcome(payload);
  const scores = payload.scores ?? payload.finalScores ?? {};
  const signature = `${outcome}:${payload.winnerSlot ?? ''}:${payload.abandonedBy ?? ''}:${Number(scores[0] ?? 0)}:${Number(scores[1] ?? 0)}`;
  if (signature === state.lastOutcomeSignature) return;
  state.lastOutcomeSignature = signature;
  reportCue(outcome);
  if (outcome === 'victory') {
    playSequence([
      { freq: 523, dur: 130, type: 'sine', gain: 0.18 },
      { freq: 659, dur: 150, type: 'sine', gain: 0.19, delay: 125 },
      { freq: 784, dur: 260, type: 'sine', gain: 0.20, delay: 270 },
    ]);
    buzz([80, 45, 110, 45, 160]);
  } else if (outcome === 'draw') {
    playSequence([
      { freq: 440, dur: 130, type: 'sine', gain: 0.12 },
      { freq: 440, dur: 180, type: 'triangle', gain: 0.10, delay: 140 },
    ]);
    buzz([55, 45, 70]);
  } else {
    playSequence([
      { freq: 330, dur: 110, type: 'triangle', gain: 0.09 },
      { freq: 262, dur: 180, type: 'sine', gain: 0.08, delay: 105 },
    ]);
    buzz([45]);
  }
}

function onTurnChanged(payload = {}) {
  // Opening sync is suppressed by the clock controller. Both flash and audio
  // observe its ready event, never the earlier logical turn change.
  const active = state.sessionRef?.();
  const mySlot = active?.mySlot ?? active?.session?.mySlot;
  const currentSlot = payload.currentTurnSlot;
  if (mySlot != null && currentSlot !== mySlot) return;
  const turnNumber = payload.turnNumber ?? active?.session?.state?.turnNumber ?? '';
  const signature = `${currentSlot ?? payload.currentTurnSlot ?? ''}:${turnNumber}`;
  if (signature === state.lastTurnSignature) return;
  state.lastTurnSignature = signature;
  reportCue('your-turn');
  playTone({ freq: 523, dur: 90, type: 'triangle', gain: 0.12, slideTo: 659 });
  buzz([30]);
}

function onAchievement({ achievement } = {}) {
  const signature = String(achievement?.id ?? 'unknown');
  if (signature === state.lastAchievementSignature) return;
  state.lastAchievementSignature = signature;
  reportCue('achievement');
  playSequence([
    { freq: 587, dur: 105, type: 'sine', gain: 0.15 },
    { freq: 740, dur: 120, type: 'sine', gain: 0.16, delay: 95 },
    { freq: 880, dur: 190, type: 'triangle', gain: 0.15, delay: 205 },
  ]);
  buzz([70, 45, 110]);
}

function onRatingChanged({ myBefore, myAfter } = {}) {
  if (!Number.isFinite(myBefore) || !Number.isFinite(myAfter) || myAfter === myBefore) return;
  const signature = `${myBefore}:${myAfter}`;
  if (signature === state.lastRatingSignature) return;
  state.lastRatingSignature = signature;
  const gain = myAfter > myBefore;
  reportCue(gain ? 'elo-gain' : 'elo-loss');
  playTone({ freq: gain ? 440 : 370, dur: 105, type: 'triangle', gain: 0.10, slideTo: gain ? 554 : 294 });
  buzz(gain ? [35, 30, 45] : [55]);
}

function resetGameDedup() {
  state.lastTurnSignature = null;
  state.lastMoveSignature = null;
  state.lastOutcomeSignature = null;
  state.lastRatingSignature = null;
}

function localOutcome(payload = {}) {
  const scores = payload.scores ?? payload.finalScores ?? {};
  const score0 = Number(scores[0] ?? 0);
  const score1 = Number(scores[1] ?? 0);
  const abandonedBy = payload.abandonedBy;
  const walkout = abandonedBy === 0 || abandonedBy === 1;
  const winner = walkout
    ? ((score0 === 0 && score1 === 0) ? null : 1 - abandonedBy)
    : (payload.winnerSlot != null ? payload.winnerSlot : (score0 === score1 ? null : (score0 > score1 ? 0 : 1)));
  if (winner == null) return 'draw';
  const active = state.sessionRef?.();
  const rawSlot = active?.mySlot ?? active?.session?.mySlot;
  const mySlot = rawSlot === 0 || rawSlot === 1 ? rawSlot : 0;
  return winner === mySlot ? 'victory' : 'defeat';
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

function reportCue(name) {
  if (!state.soundFx) return;
  try { state.cueSink?.(name); } catch {}
}

function buzz(pattern) {
  if (!state.vibration) return;
  if (state.hapticSink) {
    try { state.hapticSink(pattern); } catch {}
    return;
  }
  // Chrome blocks navigator.vibrate() with an "Intervention" warning until
  // a user gesture has occurred in the frame. We track that gesture in
  // state.unlocked (same flag the audio path uses); skip silently before
  // it flips so background events like timer ticks don't spam the console.
  if (!state.unlocked) return;
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
