// feedbackService — routes bus events to SFX cues + haptic feedback (vibrate).
//
// Subscribes to bus events and plays a cue from sfx/sfxCatalog.js through
// sfx/sfxEngine.js (sample, or synth fallback). All cues are gated on the
// persisted settings `soundFx`, `vibration` and `sfxVolume` (settingsCompat).
//
// Events listened to (bus → cue):
//   - EV.INVALID_MOVE_REJECTED   → move.invalid
//   - EV.MOVE_CONFIRMED          → move.accepted (deduplicated)
//   - 'timer/warn' / 'timer/tick' / 'timer/timeout' → clock ticks, timeout
//   - II_OPEN, NOTIF_BANNER_SHOW (payload.sound) → invite / store / … cues
//   - EV.GAME_COMPLETED          → game.win / game.draw / game.lose
//   - EV.TURN_PRESENTATION_READY → turn.yours, synced with clock + flash
//   - AV_UNLOCK_OPEN             → achievement.unlock
//   - RATING_EVT.CHANGED         → elo.up / elo.down
//   - BV_OPEN / BI_OPEN          → boost.vetoed / boost.intro
//   - PS_INTENT.MATCHED / VS_INTRO_INTENT.SHOW → match.found / vs.intro
//   - DAILY_REWARD_SHOW          → coins.gain
//   - SETTINGS_CHANGED           → soundFx / vibration / sfxVolume
// In-game animation moments (boost electricity, bingo, tile cascade, turn
// effects, opponent tiles) are cued by animationController so they stay in
// sync with their visuals; screens call cue() for taps and placements.
// A delegated listener adds a very quiet ui.tap to plain buttons.
//
// Public surface:
//   init({ storage, doc, bus, sessionRef? })
//   isSoundEnabled() / setSoundEnabled(bool)
//   isVibrationEnabled() / setVibrationEnabled(bool)
//   cue(id, { vol?, rate?, haptic?, delayMs? }) — play a catalog cue directly
//   cueSeq(id, count, gapMs, opts?)             — the same cue N times, spaced
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
import { BV_OPEN } from './screens/boostVetoScreen.js';
import { BI_OPEN } from './screens/bonusIntroScreen.js';
import { PS_INTENT } from './screens/matchmakingOverlayScreen.js';
import { VS_INTRO_INTENT } from './screens/vsIntroScreen.js';
import { DAILY_REWARD_SHOW } from './screens/avatarStoreScreen.js';
import { NOTIF_BANNER_SHOW } from './screens/notificationsScreen.js';
import * as audioService from './audioService.js';
import * as sfx from './sfx/sfxEngine.js';
import { getCue } from './sfx/sfxCatalog.js';

// User-facing SFX volume steps → sfxEngine master gain.
export const SFX_VOLUME_LEVELS = Object.freeze({ low: 0.45, med: 0.75, high: 1 });

// Plain buttons get a very quiet tap. Controls with their own sound (play,
// recall, exchange, board, rack, mini-game tiles, reactions, settings
// switches) are excluded so a press never produces two sounds.
const UI_TAP_SELECTOR = 'button, [role="button"], .hm-card';
const UI_TAP_EXCLUDE = [
  '[data-sfx="off"]', '#btn-play', '#btn-recall', '#btn-exchange',
  '#game-grid', '#brack', '#ov-bonus', '.bz-overlay', '#ov-exchange',
  '.reaction-panel', '#reaction-panel', '.sett-info', '.set-yn',
].join(', ');

// Letter tiles / cells inside the boost mini-games.
const MG_TILE_SELECTOR = ['#ov-bonus', '.bz-overlay']
  .flatMap(root => ['.ut', '.xw-cell', '.hwcell', '.hc-hex'].map(t => `${root} ${t}`))
  .join(', ');

const state = {
  initialized: false,
  storage: null,
  doc: null,
  bus: null,
  sessionRef: null,
  soundFx: true,
  vibration: true,
  sfxVolume: 'med',
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
  state.sfxVolume = SFX_VOLUME_LEVELS[prefs.sfxVolume] ? prefs.sfxVolume : 'med';
  state.initialized = true;

  sfx.init({
    doc: state.doc,
    isEnabled: () => state.soundFx,
    // Big moments (jingles, rewards) briefly lower the background music.
    onDuck: entry => { try { audioService.duck(entry.tier === 'stinger' ? 1800 : 1000); } catch {} },
  });
  sfx.setMasterVolume(SFX_VOLUME_LEVELS[state.sfxVolume]);
  subscribeBus();
  wireUiTaps();
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

export function cue(id, { vol, rate, haptic, delayMs = 0 } = {}) {
  const entry = getCue(id);
  if (!entry) return;
  if (delayMs > 0) {
    setTimeout(() => cue(id, { vol, rate, haptic }), delayMs);
    return;
  }
  reportCue(id);
  sfx.play(id, { vol, rate });
  const pattern = haptic !== undefined ? haptic : entry.haptic;
  if (pattern) buzz(pattern);
}

// The same cue `count` times, `gapMs` apart with a little human unevenness —
// e.g. an opponent's tiles landing one by one.
export function cueSeq(id, count, gapMs, opts = {}) {
  const n = Math.max(0, Math.min(8, Math.floor(Number(count) || 0)));
  let at = Number(opts.delayMs) || 0;
  for (let i = 0; i < n; i++) {
    cue(id, { ...opts, delayMs: at, haptic: i === 0 ? opts.haptic : null });
    at += gapMs * (0.85 + Math.random() * 0.3);
  }
}

export function getStatus() {
  return { soundFx: state.soundFx, vibration: state.vibration, sfxVolume: state.sfxVolume };
}

export function dispose() {
  for (const off of state.cleanups.splice(0)) {
    try { off(); } catch {}
  }
  sfx.dispose();
  state.initialized = false;
  state.sfxVolume = 'med';
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
  const on = (evt, fn) => state.cleanups.push(state.bus.on(evt, fn));
  on(EV.INVALID_MOVE_REJECTED, onInvalid);
  on(EV.MOVE_CONFIRMED, onMoveConfirmed);
  on('timer/warn', () => cue('timer.warn'));
  on('timer/tick', onTimerTick);
  on('timer/timeout', () => cue('timer.timeout'));
  on(II_OPEN, onInvite);
  on(NOTIF_BANNER_SHOW, (p = {}) => { if (p.sound) cue(p.sound); });
  on(EV.GAME_COMPLETED, onGameOver);
  on(AV_UNLOCK_OPEN, onAchievement);
  on(RATING_EVT.CHANGED, onRatingChanged);
  on(BV_OPEN, () => cue('boost.vetoed'));
  on(BI_OPEN, () => cue('boost.intro'));
  on(PS_INTENT.MATCHED, () => cue('match.found'));
  on(VS_INTRO_INTENT.SHOW, () => cue('vs.intro', { delayMs: 120 }));
  on(DAILY_REWARD_SHOW, () => cue('coins.gain', { delayMs: 250 }));
  on(EV.GAME_STARTED, resetGameDedup);
  on(EV.TURN_PRESENTATION_READY, onTurnChanged);
  on(SETTINGS_CHANGED, onSettingsChanged);
}

function onInvalid() {
  cue('move.invalid');
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
  cue('move.accepted');
}

function onTimerTick(payload) {
  const secs = Number(payload?.secs);
  if (!(secs >= 1 && secs <= 3)) return;
  // The clock tightens as it runs out: 3 → 2 → 1 rises slightly in pitch.
  cue('timer.tick', { rate: 1 + (3 - secs) * 0.06 });
}

function onInvite() {
  cue('invite.received');
}

const OUTCOME_CUE = { victory: 'game.win', draw: 'game.draw', defeat: 'game.lose' };

function onGameOver(payload = {}) {
  const outcome = localOutcome(payload);
  const scores = payload.scores ?? payload.finalScores ?? {};
  const signature = `${outcome}:${payload.winnerSlot ?? ''}:${payload.abandonedBy ?? ''}:${Number(scores[0] ?? 0)}:${Number(scores[1] ?? 0)}`;
  if (signature === state.lastOutcomeSignature) return;
  state.lastOutcomeSignature = signature;
  cue(OUTCOME_CUE[outcome]);
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
  cue('turn.yours');
}

function onAchievement({ achievement } = {}) {
  const signature = String(achievement?.id ?? 'unknown');
  if (signature === state.lastAchievementSignature) return;
  state.lastAchievementSignature = signature;
  cue('achievement.unlock');
}

function onRatingChanged({ myBefore, myAfter } = {}) {
  if (!Number.isFinite(myBefore) || !Number.isFinite(myAfter) || myAfter === myBefore) return;
  const signature = `${myBefore}:${myAfter}`;
  if (signature === state.lastRatingSignature) return;
  state.lastRatingSignature = signature;
  cue(myAfter > myBefore ? 'elo.up' : 'elo.down');
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
    // Confirm "sound on" audibly (turning it off stays silent).
    if (state.soundFx) cue('ui.toggle');
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'vibration')) {
    state.vibration = !!changes.vibration;
    persist({ vibration: state.vibration });
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'sfxVolume')) {
    const level = SFX_VOLUME_LEVELS[changes.sfxVolume] ? changes.sfxVolume : 'med';
    state.sfxVolume = level;
    sfx.setMasterVolume(SFX_VOLUME_LEVELS[level]);
    if (state.storage) {
      try { mergeUiPreferences(state.storage, { sfxVolume: level }); } catch {}
    }
    // Preview the new loudness with the most common sound in the game.
    cue('tile.place');
  }
}

// ─── Cue + haptic output ──────────────────────────────────

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
  // a user gesture has occurred in the frame. sfxEngine tracks that gesture
  // (same flag the audio path uses); skip silently before
  // it flips so background events like timer ticks don't spam the console.
  if (!sfx.isUnlocked()) return;
  const nav = globalThis.navigator;
  if (!nav || typeof nav.vibrate !== 'function') return;
  try { nav.vibrate(pattern); } catch {}
}

// ─── Delegated UI taps ─────────────────────────────────────

function wireUiTaps() {
  const doc = state.doc;
  if (!doc?.addEventListener) return;
  const onTap = (e) => {
    // Mini-game letters are wood tiles too — a light wooden tap.
    const tile = e.target?.closest?.(MG_TILE_SELECTOR);
    if (tile) {
      if (String(tile.textContent ?? '').trim()) cue('mg.tap');
      return;
    }
    const el = e.target?.closest?.(UI_TAP_SELECTOR);
    if (!el || el.disabled) return;
    if (el.closest?.(UI_TAP_EXCLUDE)) return;
    cue('ui.tap');
  };
  doc.addEventListener('pointerdown', onTap, true);
  state.cleanups.push(() => doc.removeEventListener('pointerdown', onTap, true));
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
