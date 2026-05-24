import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_SETTINGS_KEY,
  UI_PREFERENCES_KEY,
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
  const s = normalizeGameSettings({ botTime: 500, maxMoves: -2, music: false });
  assert.equal(s.botTime, 120);
  assert.equal(s.maxMoves, 5);
  assert.equal(s.music, false);
  assert.equal(s.showMoveSummary, true);
});

test('settingsFromLegacyGlobals maps old settings names then applies overrides', () => {
  const globals = {
    settings: { musicOn: false, computerTimerOn: false, computerTimerSecs: 45, moveLimitOn: true, moveLimit: 60 },
    gameSettings: { showBothRacks: true },
  };
  const s = settingsFromLegacyGlobals(globals, { botTime: 30 });
  assert.equal(s.music, false);
  assert.equal(s.timelimit, false);
  assert.equal(s.botTime, 30);
  assert.equal(s.movelimit, true);
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
