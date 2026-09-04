export const LEGACY_SETTINGS_KEY = 'bonusGameSettingsV1';
export const UI_PREFERENCES_KEY = 'spine.uiPreferences';

export const DEFAULT_GAME_SETTINGS = Object.freeze({
  confirm: false,
  timelimit: true,
  botTime: 40,
  music: true,
  soundFx: true,
  vibration: true,
  appealsMax: 0,
  showBothRacks: false,
  showMoveSummary: true,
  disableMessages: false,
});

export const DEFAULT_UI_PREFERENCES = Object.freeze({
  // reducedMotion is the tri-state source of truth for motion preference:
  //   'auto' — follow the OS prefers-reduced-motion setting (default)
  //   'on'   — explicitly reduce motion regardless of OS
  //   'off'  — explicitly keep full motion regardless of OS
  // The OS resolution happens at runtime in src/ui/motionPreference.js; this
  // pure module never reads matchMedia. `animationsEnabled` below is the
  // legacy boolean derived from reducedMotion for backward compatibility.
  reducedMotion: 'auto',
  animationsEnabled: true,
  music: true,
  soundFx: true,
  vibration: true,
  lastDisplayName: '',
  gender: 'זכר',
});

// Normalize any inbound value into the reducedMotion tri-state, migrating the
// legacy `skipAnimations` / `animationsEnabled` flags. An explicit legacy
// "animations off" (skipAnimations:true or animationsEnabled:false) becomes
// 'on'; anything unrecognised or absent becomes 'auto' (follow the OS), so
// existing stored preferences transparently start honouring the OS setting.
export function normalizeReducedMotion(raw = {}) {
  const rm = raw.reducedMotion;
  if (rm === 'on' || rm === true) return 'on';
  if (rm === 'off' || rm === false) return 'off';
  if (rm === 'auto') return 'auto';
  if (raw.skipAnimations === true || raw.animationsEnabled === false) return 'on';
  return 'auto';
}

export function normalizeGameSettings(input = {}) {
  const s = { ...DEFAULT_GAME_SETTINGS, ...(input ?? {}) };
  return {
    confirm: !!s.confirm,
    timelimit: !!s.timelimit,
    botTime: clampInt(s.botTime, 5, 120, DEFAULT_GAME_SETTINGS.botTime),
    music: !!s.music,
    soundFx: s.soundFx !== false,
    vibration: s.vibration !== false,
    appealsMax: clampInt(s.appealsMax, 0, 10, DEFAULT_GAME_SETTINGS.appealsMax),
    showBothRacks: !!s.showBothRacks,
    showMoveSummary: s.showMoveSummary !== false,
    disableMessages: !!s.disableMessages,
  };
}

export function settingsFromLegacyGlobals(globals = globalThis, overrides = {}) {
  const legacy = globals?.settings;
  const mapped = legacy ? {
    music: legacy.musicOn,
    timelimit: legacy.computerTimerOn,
    botTime: legacy.computerTimerSecs,
    appealsMax: legacy.appealsMax,
  } : {};
  return normalizeGameSettings({
    ...mapped,
    ...(globals?.gameSettings ?? {}),
    ...(overrides ?? {}),
  });
}

export function applyGameSettingsToGlobals(globals = globalThis, settings = {}) {
  const next = normalizeGameSettings(settings);
  if (!globals.gameSettings || typeof globals.gameSettings !== 'object') globals.gameSettings = {};
  Object.assign(globals.gameSettings, next);
  if (globals.settings && typeof globals.settings === 'object') {
    Object.assign(globals.settings, {
      musicOn: next.music,
      computerTimerOn: next.timelimit,
      computerTimerSecs: next.botTime,
      appealsMax: next.appealsMax,
    });
  }
  return next;
}

export function loadGameSettings(storage, globals = globalThis) {
  const saved = readJson(storage, LEGACY_SETTINGS_KEY);
  return applyGameSettingsToGlobals(globals, settingsFromLegacyGlobals(globals, saved ?? {}));
}

export function saveGameSettings(storage, settings) {
  if (!storage) return false;
  try {
    storage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(normalizeGameSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export function normalizeUiPreferences(input = {}) {
  const raw = input ?? {};
  const reducedMotion = normalizeReducedMotion(raw);
  // animationsEnabled is derived from the tri-state for legacy consumers.
  // An explicit reducedMotion wins; 'auto' keeps any legacy flag (or the
  // default true) — the OS is applied at runtime by motionPreference, not here.
  const animationsEnabled = reducedMotion === 'on'
    ? false
    : reducedMotion === 'off'
      ? true
      : raw.animationsEnabled != null
        ? !!raw.animationsEnabled
        : raw.skipAnimations != null
          ? !raw.skipAnimations
          : DEFAULT_UI_PREFERENCES.animationsEnabled;
  return {
    reducedMotion,
    animationsEnabled,
    music: raw.music != null ? !!raw.music : DEFAULT_UI_PREFERENCES.music,
    soundFx: raw.soundFx != null ? !!raw.soundFx : DEFAULT_UI_PREFERENCES.soundFx,
    vibration: raw.vibration != null ? !!raw.vibration : DEFAULT_UI_PREFERENCES.vibration,
    lastDisplayName: String(raw.lastDisplayName ?? raw.displayName ?? '').trim().slice(0, 40),
    gender: raw.gender === 'נקבה' ? 'נקבה' : 'זכר',
  };
}

export function loadUiPreferences(storage) {
  return normalizeUiPreferences(readJson(storage, UI_PREFERENCES_KEY) ?? {});
}

export function saveUiPreferences(storage, preferences) {
  if (!storage) return false;
  try {
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify(normalizeUiPreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}

export function mergeUiPreferences(storage, patch = {}) {
  const next = normalizeUiPreferences({ ...loadUiPreferences(storage), ...(patch ?? {}) });
  saveUiPreferences(storage, next);
  return next;
}

export function uiPreferencePatchFromSettings(changes = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(changes, 'music')) patch.music = !!changes.music;
  if (Object.prototype.hasOwnProperty.call(changes, 'soundFx')) patch.soundFx = !!changes.soundFx;
  if (Object.prototype.hasOwnProperty.call(changes, 'vibration')) patch.vibration = !!changes.vibration;
  if (Object.prototype.hasOwnProperty.call(changes, 'animationsEnabled')) patch.animationsEnabled = !!changes.animationsEnabled;
  if (Object.prototype.hasOwnProperty.call(changes, 'skipAnimations')) patch.animationsEnabled = !changes.skipAnimations;
  // The "Reduced motion" settings toggle emits a boolean; store it as the
  // explicit tri-state 'on'/'off' (never 'auto' — touching the control is an
  // explicit choice that overrides the OS default).
  if (Object.prototype.hasOwnProperty.call(changes, 'reducedMotion')) {
    patch.reducedMotion = changes.reducedMotion === 'on' || changes.reducedMotion === 'off'
      ? changes.reducedMotion
      : (changes.reducedMotion ? 'on' : 'off');
  }
  return patch;
}

function readJson(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
