// settingsScreen — Phase 1 wiring of #ov-settings.
//
// Scope: yes/no toggle pairs (music, soundFx, vibration) and the close button. Each
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
import { applyGenderToRoot } from '../genderText.js';

export const SETTINGS_INTENT = Object.freeze({
  TOGGLE:  'settings/toggle',
  ADJUST:  'settings/adjust',
  CLOSE:   'settings/close',
});

export const SETTINGS_OPEN    = 'overlay/settings/open';
export const SETTINGS_CHANGED = 'settings/changed';

// Each toggle has a (key, yesId, noId) triple matching the legacy DOM.
const TOGGLES = [
  { key: 'music',     yesId: 'sett-music-yes',     noId: 'sett-music-no' },
  { key: 'soundFx',   yesId: 'sett-soundfx-yes',   noId: 'sett-soundfx-no' },
  { key: 'vibration', yesId: 'sett-vibration-yes', noId: 'sett-vibration-no' },
];

// Value-select controls: one of N string values. Each option has an id.
// The active option gets `active-yes`; others lose it.
const VALUE_SELECTS = [
  {
    key: 'gender',
    options: [
      { value: 'זכר',   id: 'sett-gender-zachar' },
      { value: 'נקבה', id: 'sett-gender-nekeiva' },
    ],
  },
];

const COUNTERS = [];

export function mountSettingsScreen({ root = globalThis.document, bus, getSettings = () => globalThis.gameSettings, getUiPrefs = () => ({}) } = {}) {
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

  // ─── Value-selects (e.g. gender: 'זכר' | 'נקבה') ───────
  for (const sel of VALUE_SELECTS) {
    for (const opt of sel.options) {
      const el = $(`#${opt.id}`, overlay);
      if (el) {
        cleanups.push(on(el, 'click', (e) => {
          e.preventDefault?.();
          selectSetting(sel, opt.value);
        }));
      }
    }
  }

  function selectSetting(sel, value) {
    for (const opt of sel.options) {
      const el = $(`#${opt.id}`, overlay);
      if (el?.classList) {
        if (opt.value === value) el.classList.add('active-yes');
        else el.classList.remove('active-yes');
      }
    }
    bus.emit(SETTINGS_INTENT.TOGGLE, { key: sel.key, value });
    bus.emit(SETTINGS_CHANGED, { [sel.key]: value });
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

  // ─── Info "i" tooltips ──────────────────────────────────
  // The .sett-info circles only revealed their .sett-tip via a CSS
  // `@media (hover:hover)` rule — so on touch devices (the app's primary
  // target) tapping did nothing. Wire tap/click to toggle the tip, positioned
  // as `fixed` near the icon so it escapes the overlay's `overflow-x:hidden`
  // clipping. Hover still works on desktop via the existing CSS.
  let openTip = null;
  function closeTip() {
    if (!openTip) return;
    openTip.classList.remove('tip-visible');
    openTip.style.left = openTip.style.top = openTip.style.bottom = openTip.style.transform = '';
    openTip = null;
  }
  function openTipFor(icon) {
    const tip = icon.querySelector?.('.sett-tip');
    if (!tip) return;
    closeTip();
    tip.classList.add('tip-visible');
    // Neutralize the CSS hover positioning before measuring, then place it.
    tip.style.left = '0px'; tip.style.top = '0px'; tip.style.bottom = 'auto'; tip.style.transform = 'none';
    const ir = icon.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const vw = globalThis.innerWidth || 360;
    let left = ir.left + ir.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, vw - tr.width - 8));
    let top = ir.top - tr.height - 8;            // prefer above the icon
    if (top < 8) top = ir.bottom + 8;            // flip below if no room
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    openTip = tip;
  }
  for (const icon of overlay.querySelectorAll?.('.sett-info') ?? []) {
    cleanups.push(on(icon, 'click', (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();
      const tip = icon.querySelector?.('.sett-tip');
      if (tip && tip === openTip) closeTip();   // tap again to dismiss
      else openTipFor(icon);
    }));
  }
  // Any tap/click elsewhere (or scroll) dismisses an open tip.
  const onDocClick = () => closeTip();
  if (root?.addEventListener) {
    root.addEventListener('click', onDocClick);
    cleanups.push(() => root.removeEventListener('click', onDocClick));
  }

  // ─── Close buttons ──────────────────────────────────────
  // Both the bottom "אישור ✓" button and the top-corner "×" close the
  // overlay. They share the legacy onclick="ovClose('ov-settings')", so wire
  // every match (not just the first) — otherwise the player can only dismiss
  // settings via אישור and the X does nothing through the spine path.
  const closeBtns = overlay.querySelectorAll?.('button[onclick="ovClose(\'ov-settings\')"]') ?? [];
  for (const closeBtn of closeBtns) {
    closeBtn.removeAttribute('onclick');
    cleanups.push(on(closeBtn, 'click', (e) => {
      e.preventDefault?.();
      closeTip();
      bus.emit(SETTINGS_INTENT.CLOSE);
      overlay.classList?.add('hidden');
    }));
  }

  cleanups.push(bus.on(SETTINGS_OPEN, () => {
    closeTip();
    const uiPrefs = getUiPrefs?.() ?? {};
    refreshControls(normalizeGameSettings(getSettings?.() ?? {}), uiPrefs);
    applyGenderToRoot(overlay, uiPrefs.gender);
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
    for (const sel of VALUE_SELECTS) {
      if (!Object.prototype.hasOwnProperty.call(changes, sel.key)) continue;
      const value = changes[sel.key];
      for (const opt of sel.options) {
        const el = $(`#${opt.id}`, overlay);
        if (el?.classList) {
          if (opt.value === value) el.classList.add('active-yes');
          else el.classList.remove('active-yes');
        }
      }
    }
    if ('gender' in changes) applyGenderToRoot(overlay, changes.gender);
  }));

  function refreshControls(settings, uiPrefs = {}) {
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
    for (const sel of VALUE_SELECTS) {
      const value = uiPrefs[sel.key] ?? sel.options[0].value;
      for (const opt of sel.options) {
        const el = $(`#${opt.id}`, overlay);
        if (el?.classList) {
          if (opt.value === value) el.classList.add('active-yes');
          else el.classList.remove('active-yes');
        }
      }
    }
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
