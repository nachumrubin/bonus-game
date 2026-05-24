// asyncHomeButton — wires the in-game `#btn-async-home` button.
//
// In async modes the player can leave the game mid-turn and come back
// later — leaving doesn't count as a resign. This module handles the
// button click + visibility:
//   - Visible when an async session is active (controlled via AH_SHOW)
//   - Click → emits AH_INTENT.GO_HOME so main.js can dispose the active
//     session UI (without dispatching RESIGN_GAME) and return to menu
//
// Pause-button visibility (`#btn-pause`) is the converse: shown during
// live games.

import { $, on } from '../domHelpers.js';

export const AH_INTENT = Object.freeze({
  GO_HOME: 'asyncHome/goHome',
});

export const AH_SHOW = 'asyncHome/show';
export const AH_HIDE = 'asyncHome/hide';

export function mountAsyncHomeButton({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAsyncHomeButton: bus required');

  const btn = $('#btn-async-home', root);
  if (!btn) {
    return { unmount() {} };
  }

  btn.removeAttribute?.('onclick');

  const cleanups = [];
  cleanups.push(on(btn, 'click', (e) => {
    e?.preventDefault?.();
    bus.emit(AH_INTENT.GO_HOME, {});
  }));

  cleanups.push(bus.on(AH_SHOW, () => { btn.style.display = ''; }));
  cleanups.push(bus.on(AH_HIDE, () => { btn.style.display = 'none'; }));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
