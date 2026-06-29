// pauseScreen — wraps #ov-pause. Open with bus.emit(PAUSE_OPEN) (typically
// from the topbar pause button or a "back during async game" intent).
// Three actions: resume, save-and-exit, quit-without-save.

import { $, $$, on, setText } from '../domHelpers.js';
import { applyGenderToRoot, getGender } from '../genderText.js';
import { SETTINGS_CHANGED } from './settingsScreen.js';

export const PAUSE_INTENT = Object.freeze({
  RESUME:        'pause/resume',
  SAVE_AND_EXIT: 'pause/saveAndExit',
  QUIT_NO_SAVE:  'pause/quitNoSave',
});

export const PAUSE_OPEN = 'overlay/pause/open';

export function mountPauseScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountPauseScreen: bus required');
  const overlay = $('#ov-pause', root);
  if (!overlay) {
    console.warn('[pauseScreen] #ov-pause not found — not mounted');
    return { unmount() {} };
  }

  applyGenderToRoot(overlay, getGender());
  const cleanups = [];

  const buttons = [
    { sel: 'button[onclick="resumeGame()"]',         intent: PAUSE_INTENT.RESUME,        close: true },
    { sel: 'button[onclick="savePauseAndHome()"]',   intent: PAUSE_INTENT.SAVE_AND_EXIT, close: true },
    { sel: 'button[onclick="discardPauseAndHome()"]',intent: PAUSE_INTENT.QUIT_NO_SAVE,  close: true },
  ];

  // The "השהה ושמור" (pause-and-save) button — hidden for live games, which
  // can't be saved (the opponent's clock keeps running). Captured here because
  // the onclick attribute is stripped below, so it can't be re-selected later.
  let saveBtn = null;

  for (const def of buttons) {
    // querySelectorAll so both the X close-button and the primary action button
    // get wired — both share the same onclick attribute value in the HTML.
    for (const btn of $$(def.sel, overlay)) {
      if (def.intent === PAUSE_INTENT.SAVE_AND_EXIT) saveBtn = btn;
      btn.removeAttribute('onclick');
      cleanups.push(on(btn, 'click', (e) => {
        e.preventDefault?.();
        bus.emit(def.intent);
        if (def.close) overlay.classList?.add('hidden');
      }));
    }
  }

  // Showing the pause overlay must actually freeze the game (turn timer +
  // bot moves), otherwise "המשחק מושהה" is a lie and the user comes back
  // to a board the bot just played on. We emit dedicated game/paused →
  // game/resumed events that the turn-timer and bot session listen for.
  // We deliberately do NOT reuse bonus/pending — that event also triggers
  // the bonus intro overlay in main.js and resets the per-turn clock to
  // the full allowance (correct for mini-games, wrong for a menu pause).
  // game/* preserves the remaining time across the pause.
  let frozen = false;
  function freezeForPause()   { if (!frozen) { frozen = true;  bus.emit('game/paused');  } }
  function unfreezeForPause() { if (frozen)  { frozen = false; bus.emit('game/resumed'); } }
  cleanups.push(bus.on(PAUSE_INTENT.RESUME, unfreezeForPause));
  cleanups.push(bus.on(PAUSE_INTENT.SAVE_AND_EXIT, () => { frozen = false; }));
  cleanups.push(bus.on(PAUSE_INTENT.QUIT_NO_SAVE,  () => { frozen = false; }));

  cleanups.push(bus.on(PAUSE_OPEN, ({ playerName, isLive = false } = {}) => {
    if (playerName) setText($('#pause-player-name', overlay), playerName);
    if (saveBtn) saveBtn.style.display = isLive ? 'none' : '';
    applyGenderToRoot(overlay, getGender());
    overlay.classList?.remove('hidden');
    freezeForPause();
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
