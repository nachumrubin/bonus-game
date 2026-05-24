// pauseScreen — wraps #ov-pause. Open with bus.emit(PAUSE_OPEN) (typically
// from the topbar pause button or a "back during async game" intent).
// Three actions: resume, save-and-exit, quit-without-save.

import { $, on, setText } from '../domHelpers.js';

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

  const cleanups = [];

  const buttons = [
    { sel: 'button[onclick="resumeGame()"]',         intent: PAUSE_INTENT.RESUME,        close: true },
    { sel: 'button[onclick="savePauseAndHome()"]',   intent: PAUSE_INTENT.SAVE_AND_EXIT, close: true },
    { sel: 'button[onclick="discardPauseAndHome()"]',intent: PAUSE_INTENT.QUIT_NO_SAVE,  close: true },
  ];

  for (const def of buttons) {
    const btn = $(def.sel, overlay);
    if (!btn) continue;
    btn.removeAttribute('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(def.intent);
      if (def.close) overlay.classList?.add('hidden');
    }));
  }

  cleanups.push(bus.on(PAUSE_OPEN, ({ playerName } = {}) => {
    if (playerName) setText($('#pause-player-name', overlay), playerName);
    overlay.classList?.remove('hidden');
  }));

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
