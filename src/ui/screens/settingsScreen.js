// settingsScreen — Phase 1 wiring of #ov-settings.
//
// Scope: the 4 yes/no toggle pairs (timelimit, movelimit, music, showBothRacks),
// the 2 counter panels (botTime, maxMoves), and the close button. Each
// settings change emits SETTINGS_CHANGED with the diff.
//
// Out of scope (will be migrated separately):
//   - Notification permission button (§11 cross-cutting)
//   - Dictionary search panel (§8)
//   - Dictionary admin / suggestions (§8)
//
// The settings overlay itself stays the legacy DOM; we only own the
// click handlers on the controls.

import { $, on, setText } from '../domHelpers.js';
import { normalizeGameSettings } from '../../game/settings/settingsCompat.js';

export const SETTINGS_INTENT = Object.freeze({
  TOGGLE:  'settings/toggle',
  ADJUST:  'settings/adjust',
  CLOSE:   'settings/close',
});

export const SETTINGS_OPEN    = 'overlay/settings/open';
export const SETTINGS_CHANGED = 'settings/changed';

// Each toggle has a (key, yesId, noId) triple matching the legacy DOM.
const TOGGLES = [
  { key: 'timelimit',     yesId: 'sett-timelimit-yes',     noId: 'sett-timelimit-no' },
  { key: 'movelimit',     yesId: 'sett-movelimit-yes',     noId: 'sett-movelimit-no' },
  { key: 'music',         yesId: 'sett-music-yes',         noId: 'sett-music-no' },
  { key: 'showBothRacks', yesId: 'sett-showBothRacks-yes', noId: 'sett-showBothRacks-no' },
  { key: 'soundFx',       yesId: 'sett-soundfx-yes',       noId: 'sett-soundfx-no' },
  { key: 'vibration',     yesId: 'sett-vibration-yes',     noId: 'sett-vibration-no' },
];

// Each counter has (key, displayId, step).
const COUNTERS = [
  { key: 'botTime',  displayId: 'sett-bottime',  step: 5 },
  { key: 'maxMoves', displayId: 'sett-maxmoves', step: 5 },
];

export function mountSettingsScreen({ root = globalThis.document, bus, getSettings = () => globalThis.gameSettings } = {}) {
  if (!bus) throw new Error('mountSettingsScreen: bus required');
  const overlay = $('#ov-settings', root);
  if (!overlay) {
    console.warn('[settingsScreen] #ov-settings not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  // ─── Toggles ────────────────────────────────────────────
  for (const tog of TOGGLES) {
    const yes = $(`#${tog.yesId}`, overlay);
    const no  = $(`#${tog.noId}`, overlay);
    if (yes) {
      yes.removeAttribute('onclick');
      cleanups.push(on(yes, 'click', (e) => {
        e.preventDefault?.();
        toggleSetting(tog, true);
      }));
    }
    if (no) {
      no.removeAttribute('onclick');
      cleanups.push(on(no, 'click', (e) => {
        e.preventDefault?.();
        toggleSetting(tog, false);
      }));
    }
  }

  function toggleSetting(tog, value) {
    // Update the visible "active" pill class to match selection
    const yes = $(`#${tog.yesId}`, overlay);
    const no  = $(`#${tog.noId}`, overlay);
    if (yes?.classList) (value ? yes.classList.add('active-yes') : yes.classList.remove('active-yes'));
    if (no?.classList)  (value ? no.classList.remove('active-no') : no.classList.add('active-no'));
    bus.emit(SETTINGS_INTENT.TOGGLE, { key: tog.key, value });
    bus.emit(SETTINGS_CHANGED, { [tog.key]: value });
  }

  // ─── Counters ───────────────────────────────────────────
  for (const ctr of COUNTERS) {
    // Counter buttons are the +/- siblings of #sett-{key}; they don't have
    // unique IDs, so we look them up by their inline onclick string.
    const minus = $(`button[onclick="settAdj('${ctr.key}',-${ctr.step})"], div[onclick="settAdj('${ctr.key}',-${ctr.step})"]`, overlay);
    const plus  = $(`button[onclick="settAdj('${ctr.key}',${ctr.step})"], div[onclick="settAdj('${ctr.key}',${ctr.step})"]`, overlay);
    const display = $(`#${ctr.displayId}`, overlay);
    if (minus) {
      minus.removeAttribute('onclick');
      cleanups.push(on(minus, 'click', (e) => {
        e.preventDefault?.();
        adjustSetting(ctr, -ctr.step, display);
      }));
    }
    if (plus) {
      plus.removeAttribute('onclick');
      cleanups.push(on(plus, 'click', (e) => {
        e.preventDefault?.();
        adjustSetting(ctr, ctr.step, display);
      }));
    }
  }

  function adjustSetting(ctr, delta, displayEl) {
    const current = Number(displayEl?.textContent ?? 0);
    const normalized = normalizeGameSettings({ [ctr.key]: current + delta });
    const next = normalized[ctr.key];
    setText(displayEl, String(next));
    bus.emit(SETTINGS_INTENT.ADJUST, { key: ctr.key, delta, value: next });
    bus.emit(SETTINGS_CHANGED, { [ctr.key]: next });
  }

  // ─── Close button ───────────────────────────────────────
  const closeBtn = $('button[onclick="ovClose(\'ov-settings\')"]', overlay);
  if (closeBtn) {
    closeBtn.removeAttribute('onclick');
    cleanups.push(on(closeBtn, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(SETTINGS_INTENT.CLOSE);
      overlay.classList?.add('hidden');
    }));
  }

  cleanups.push(bus.on(SETTINGS_OPEN, () => {
    refreshControls(normalizeGameSettings(getSettings?.() ?? {}));
    overlay.classList?.remove('hidden');
  }));

  // External settings changes (e.g. the in-game music toolbar button) should
  // reflect immediately when the overlay is open. We only repaint the keys
  // that actually changed, so the user's in-progress counter edits aren't
  // clobbered by a refresh of unrelated fields.
  cleanups.push(bus.on(SETTINGS_CHANGED, (changes = {}) => {
    if (overlay.classList?.contains?.('hidden')) return;
    const merged = normalizeGameSettings({ ...(getSettings?.() ?? {}), ...changes });
    for (const tog of TOGGLES) {
      if (!Object.prototype.hasOwnProperty.call(changes, tog.key)) continue;
      const value = !!merged[tog.key];
      const yes = $(`#${tog.yesId}`, overlay);
      const no  = $(`#${tog.noId}`, overlay);
      if (yes?.classList) (value ? yes.classList.add('active-yes') : yes.classList.remove('active-yes'));
      if (no?.classList)  (value ? no.classList.remove('active-no') : no.classList.add('active-no'));
    }
    for (const ctr of COUNTERS) {
      if (!Object.prototype.hasOwnProperty.call(changes, ctr.key)) continue;
      setText($(`#${ctr.displayId}`, overlay), String(merged[ctr.key]).padStart(2, '0'));
    }
  }));

  function refreshControls(settings) {
    for (const tog of TOGGLES) {
      const value = !!settings[tog.key];
      const yes = $(`#${tog.yesId}`, overlay);
      const no = $(`#${tog.noId}`, overlay);
      if (yes?.classList) (value ? yes.classList.add('active-yes') : yes.classList.remove('active-yes'));
      if (no?.classList) (value ? no.classList.remove('active-no') : no.classList.add('active-no'));
    }
    for (const ctr of COUNTERS) {
      setText($(`#${ctr.displayId}`, overlay), String(settings[ctr.key]).padStart(2, '0'));
    }
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
