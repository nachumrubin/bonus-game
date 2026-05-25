// disconnectScreen — wraps #ov-disconnect.
//
// Live mode only. Opens when opponent presence drops below the grace
// threshold and counts down. If countdown reaches 0, the spine emits
// AUTO_WIN_BY_DISCONNECT and main.js / the session resolves the game.
//
// The actual presence detection lives in presenceService; this screen is
// purely UI. main.js bridges PRESENCE event → DISCONNECT_OPEN.

import { $, on, setText } from '../domHelpers.js';

export const DISCONNECT_INTENT = Object.freeze({
  AUTO_WIN: 'disconnect/autoWin',
});

export const DISCONNECT_OPEN  = 'overlay/disconnect/open';
export const DISCONNECT_CLOSE = 'overlay/disconnect/close';

export const DEFAULT_GRACE_SECONDS = 15;

export function mountDisconnectScreen({ root = globalThis.document, bus, now = () => Date.now() } = {}) {
  if (!bus) throw new Error('mountDisconnectScreen: bus required');
  const overlay = $('#ov-disconnect', root);
  if (!overlay) {
    console.warn('[disconnectScreen] #ov-disconnect not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];
  let interval = null;

  const timerEl = $('#dc-timer', overlay);
  const barEl   = $('#dc-bar', overlay);
  const msgEl   = $('#dc-msg', overlay);

  cleanups.push(bus.on(DISCONNECT_OPEN, ({ seconds = DEFAULT_GRACE_SECONDS, opponentName } = {}) => {
    if (opponentName) setText(msgEl, `${opponentName} התנתק. ממתין לחזרה...`);
    const total = Math.max(1, seconds);
    const startedAt = now();
    const deadline = startedAt + total * 1000;

    function paint() {
      const remaining = Math.max(0, Math.ceil((deadline - now()) / 1000));
      setText(timerEl, String(remaining));
      if (barEl?.style) barEl.style.width = `${Math.max(0, remaining / total) * 100}%`;
      return remaining;
    }

    paint();
    overlay.classList?.remove('hidden');

    if (interval) clearInterval(interval);
    interval = setInterval(() => {
      const remaining = paint();
      if (remaining <= 0) {
        clearInterval(interval); interval = null;
        overlay.classList?.add('hidden');
        bus.emit(DISCONNECT_INTENT.AUTO_WIN);
      }
    }, 500);
  }));

  cleanups.push(bus.on(DISCONNECT_CLOSE, () => {
    if (interval) { clearInterval(interval); interval = null; }
    overlay.classList?.add('hidden');
  }));

  function unmount() {
    if (interval) { clearInterval(interval); interval = null; }
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
