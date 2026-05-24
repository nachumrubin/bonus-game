// audioService — background-music toggle for the spine.
//
// Wraps a single HTMLAudioElement and keeps it in sync with the persisted
// `music` setting (settingsCompat). The toggle is wired by gameFlowController;
// the source URL is optional and supplied through window.APP_CONFIG.musicUrl
// (or by an explicit setSource call), so toggling still works as a UI-state
// flip even when no asset is configured.
//
// Public surface:
//   init({ storage, doc, source? })  – idempotent
//   setSource(url)
//   isEnabled() / setEnabled(bool)
//   toggle()                          – flips state, persists, returns new state
//   refreshButton()                   – paints the toolbar #music-toggle icon
//   dispose()

import {
  loadUiPreferences,
  mergeUiPreferences,
  applyGameSettingsToGlobals,
  saveGameSettings,
  normalizeGameSettings,
} from '../game/settings/settingsCompat.js';

const BUTTON_SELECTOR = '#music-toggle';

const state = {
  initialized: false,
  storage: null,
  doc: null,
  audio: null,
  source: '',
  enabled: true,
};

export function init({ storage, doc, source } = {}) {
  state.storage = storage ?? globalThis.localStorage ?? null;
  state.doc = doc ?? globalThis.document ?? null;
  const prefs = loadUiPreferences(state.storage);
  state.enabled = prefs.music;
  const fromConfig = globalThis.APP_CONFIG?.musicUrl ?? null;
  state.source = String(source ?? fromConfig ?? '').trim();
  state.initialized = true;
  refreshButton();
  applyPlaybackState();
  return getStatus();
}

export function setSource(url) {
  state.source = String(url ?? '').trim();
  if (state.audio) {
    try { state.audio.pause(); } catch {}
    state.audio = null;
  }
  applyPlaybackState();
}

export function isEnabled() {
  return !!state.enabled;
}

export function setEnabled(next) {
  const want = !!next;
  if (state.enabled === want) {
    refreshButton();
    applyPlaybackState();
    return getStatus();
  }
  state.enabled = want;
  persist(want);
  refreshButton();
  applyPlaybackState();
  return getStatus();
}

export function toggle() {
  return setEnabled(!state.enabled);
}

export function refreshButton() {
  const btn = state.doc?.querySelector?.(BUTTON_SELECTOR);
  if (!btn) return;
  const icon = btn.querySelector?.('.tb-ic');
  const label = btn.querySelector?.('.tb-tx');
  if (icon) icon.textContent = state.enabled ? '🎵' : '🔇';
  if (label) label.textContent = state.enabled ? 'מוזיקה' : 'מושתק';
  btn.classList?.toggle('muted', !state.enabled);
  btn.setAttribute?.('aria-pressed', state.enabled ? 'true' : 'false');
}

export function getStatus() {
  return {
    enabled: state.enabled,
    hasSource: !!state.source,
    playing: !!(state.audio && !state.audio.paused),
  };
}

export function dispose() {
  if (state.audio) {
    try { state.audio.pause(); } catch {}
  }
  state.audio = null;
  state.initialized = false;
}

function persist(next) {
  if (!state.storage) return;
  try {
    mergeUiPreferences(state.storage, { music: next });
  } catch {}
  try {
    const merged = normalizeGameSettings({ ...(globalThis.gameSettings ?? {}), music: next });
    applyGameSettingsToGlobals(globalThis, merged);
    saveGameSettings(state.storage, merged);
  } catch {}
}

function applyPlaybackState() {
  if (!state.source) return;
  if (!state.audio) {
    try {
      state.audio = new globalThis.Audio(state.source);
      state.audio.loop = true;
      state.audio.preload = 'auto';
      state.audio.volume = 0.4;
    } catch {
      state.audio = null;
      return;
    }
  }
  try {
    if (state.enabled) {
      const p = state.audio.play();
      if (p && typeof p.catch === 'function') {
        // Most browsers block autoplay until the user has interacted with the
        // page. We retry once after the next pointer event.
        p.catch(() => armAutoplayRetry());
      }
    } else {
      state.audio.pause();
    }
  } catch {}
}

function armAutoplayRetry() {
  const doc = state.doc;
  if (!doc?.addEventListener) return;
  const retry = () => {
    doc.removeEventListener('pointerdown', retry, true);
    doc.removeEventListener('keydown', retry, true);
    if (state.enabled) applyPlaybackState();
  };
  doc.addEventListener('pointerdown', retry, true);
  doc.addEventListener('keydown', retry, true);
}
