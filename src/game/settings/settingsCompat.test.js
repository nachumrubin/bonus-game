import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_SETTINGS_KEY,
  UI_PREFERENCES_KEY,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_UI_PREFERENCES,
  applyGameSettingsToGlobals,
  loadGameSettings,
  loadUiPreferences,
  mergeUiPreferences,
  normalizeGameSettings,
  saveGameSettings,
  saveUiPreferences,
  settingsFromLegacyGlobals,
  uiPreferencePatchFromSettings,
} from './settingsCompat.js';

function storage() {
  const data = new Map();
  return {
    setItem(k, v) { data.set(k, String(v)); },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    _data: data,
  };
}

test('normalizeGameSettings fills defaults and clamps numeric values', () => {
  const s = normalizeGameSettings({ botTime: 500, music: false });
  assert.equal(s.botTime, 120);
  assert.equal(s.music, false);
  assert.equal(s.showMoveSummary, true);
});

test('settingsFromLegacyGlobals maps old settings names then applies overrides', () => {
  const globals = {
    settings: { musicOn: false, computerTimerOn: false, computerTimerSecs: 45 },
    gameSettings: { showBothRacks: true },
  };
  const s = settingsFromLegacyGlobals(globals, { botTime: 30 });
  assert.equal(s.music, false);
  assert.equal(s.timelimit, false);
  assert.equal(s.botTime, 30);
  assert.equal(s.showBothRacks, true);
});

test('applyGameSettingsToGlobals mirrors into gameSettings and legacy settings object', () => {
  const globals = { settings: {} };
  const s = applyGameSettingsToGlobals(globals, { music: false, botTime: 35 });
  assert.equal(globals.gameSettings.botTime, 35);
  assert.equal(globals.settings.computerTimerSecs, 35);
  assert.equal(globals.settings.musicOn, false);
  assert.equal(s.timelimit, true);
});

test('load/save game settings uses the legacy storage key', () => {
  const s = storage();
  saveGameSettings(s, { botTime: 25, music: false });
  assert.equal(JSON.parse(s.getItem(LEGACY_SETTINGS_KEY)).botTime, 25);
  const globals = {};
  loadGameSettings(s, globals);
  assert.equal(globals.gameSettings.botTime, 25);
  assert.equal(globals.gameSettings.music, false);
});

test('UI preferences support animation skip, music, and last display name', () => {
  const s = storage();
  saveUiPreferences(s, { skipAnimations: true, music: false, lastDisplayName: '  Alice  ' });
  assert.deepEqual(JSON.parse(s.getItem(UI_PREFERENCES_KEY)), {
    animationsEnabled: false,
    music: false,
    soundFx: true,    // default applied by normalizer when not provided
    vibration: true,  // default applied by normalizer when not provided
    lastDisplayName: 'Alice',
  });
  assert.equal(loadUiPreferences(s).animationsEnabled, false);
  const next = mergeUiPreferences(s, { music: true });
  assert.equal(next.music, true);
  assert.equal(next.animationsEnabled, false);
});

test('uiPreferencePatchFromSettings extracts only preference-backed keys', () => {
  assert.deepEqual(uiPreferencePatchFromSettings({ music: false, botTime: 20 }), { music: false });
  assert.deepEqual(uiPreferencePatchFromSettings({ skipAnimations: true }), { animationsEnabled: false });
});

// ── Migration edge cases (GAP_REPORT item 14) ───────────────────────
// Past versions of the app may have written non-standard shapes to
// localStorage. The migration path must survive these without throwing
// or silently reverting all settings to defaults.

test('loadGameSettings: corrupt JSON in localStorage falls back to defaults without throwing', () => {
  const s = storage();
  s.setItem(LEGACY_SETTINGS_KEY, '{not valid json');
  const result = loadGameSettings(s, {});
  assert.equal(result.botTime, DEFAULT_GAME_SETTINGS.botTime);
  assert.equal(result.timelimit, DEFAULT_GAME_SETTINGS.timelimit);
});

test('loadGameSettings: out-of-range numeric values clamp instead of crashing', () => {
  const s = storage();
  s.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({
    botTime: 99999, appealsMax: 'banana',
  }));
  const result = loadGameSettings(s, {});
  assert.equal(result.botTime, 120, 'botTime clamped to max');
  assert.equal(result.appealsMax, DEFAULT_GAME_SETTINGS.appealsMax, 'non-numeric falls back to default');
});

test('loadGameSettings: unknown fields in storage are dropped; known fields preserved', () => {
  const s = storage();
  s.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({
    botTime: 45,
    legacyOnlyField: 'should-be-ignored',
    yetAnotherFutureField: { nested: true },
    music: false,
  }));
  const result = loadGameSettings(s, {});
  assert.equal(result.botTime, 45);
  assert.equal(result.music, false);
  assert.equal('legacyOnlyField' in result, false, 'unknown fields dropped by normalizer');
});

test('loadUiPreferences: missing key returns defaults (no throw)', () => {
  const s = storage();
  const result = loadUiPreferences(s);
  assert.equal(result.animationsEnabled, DEFAULT_UI_PREFERENCES.animationsEnabled);
  assert.equal(result.music, DEFAULT_UI_PREFERENCES.music);
  assert.equal(result.lastDisplayName, '');
});

test('loadUiPreferences: corrupt JSON falls back to defaults', () => {
  const s = storage();
  s.setItem(UI_PREFERENCES_KEY, 'not-json-at-all');
  const result = loadUiPreferences(s);
  assert.equal(result.animationsEnabled, DEFAULT_UI_PREFERENCES.animationsEnabled);
});

test('saveGameSettings: storage throwing (e.g., quota exceeded) is caught and returns false', () => {
  const failingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  assert.equal(saveGameSettings(failingStorage, DEFAULT_GAME_SETTINGS), false);
});

test('saveUiPreferences: storage throwing returns false instead of propagating', () => {
  const failingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  assert.equal(saveUiPreferences(failingStorage, DEFAULT_UI_PREFERENCES), false);
});
