// backConfirmScreen — wraps #ov-back-confirm. Three actions on back-button
// press during a game: keep playing, pause + save, or leave without saving.

import { $, on } from '../domHelpers.js';
import { applyGenderToRoot, getGender } from '../genderText.js';
import { SETTINGS_CHANGED } from './settingsScreen.js';

export const BACK_INTENT = Object.freeze({
  STAY:           'back/stay',
  PAUSE_AND_SAVE: 'back/pauseAndSave',
  LEAVE:          'back/leave',
});

export const BACK_OPEN = 'overlay/back/open';

export function mountBackConfirmScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountBackConfirmScreen: bus required');
  const overlay = $('#ov-back-confirm', root);
  if (!overlay) {
    console.warn('[backConfirmScreen] #ov-back-confirm not found — not mounted');
    return { unmount() {} };
  }

  applyGenderToRoot(overlay, getGender());
  const cleanups = [];

  const buttons = [
    { sel: 'button[onclick="backConfirmStay()"]',                intent: BACK_INTENT.STAY },
    { sel: 'button[onclick="pauseGame();backConfirmStay()"]',    intent: BACK_INTENT.PAUSE_AND_SAVE },
    { sel: 'button[onclick="backConfirmLeave()"]',               intent: BACK_INTENT.LEAVE },
  ];

  for (const def of buttons) {
    const btn = $(def.sel, overlay);
    if (!btn) continue;
    btn.removeAttribute('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(def.intent);
      overlay.classList?.add('hidden');
    }));
  }

  cleanups.push(bus.on(BACK_OPEN, () => {
    applyGenderToRoot(overlay, getGender());
    overlay.classList?.remove('hidden');
  }));

  cleanups.push(bus.on(SETTINGS_CHANGED, (changes = {}) => {
    if ('gender' in changes) applyGenderToRoot(overlay, changes.gender);
  }));

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
