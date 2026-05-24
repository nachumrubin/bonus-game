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

const DEFAULT_GRACE_SECONDS = 30;

export function mountDisconnectScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountDisconnectScreen: bus required');
  const overlay = $('#ov-disconnect', root);
  if (!overlay) {
    console.warn('[disconnectScreen] #ov-disconnect not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];
  let interval = null;
  let secondsLeft = 0;

  const timerEl = $('#dc-timer', overlay);
  const barEl   = $('#dc-bar', overlay);
  const msgEl   = $('#dc-msg', overlay);

  cleanups.push(bus.on(DISCONNECT_OPEN, ({ seconds = DEFAULT_GRACE_SECONDS, opponentName } = {}) => {
    secondsLeft = seconds;
    if (opponentName) setText(msgEl, `${opponentName} התנתק. ממתין לחזרה...`);
    setText(timerEl, String(secondsLeft));
    if (barEl?.style) barEl.style.width = '100%';
    overlay.classList?.remove('hidden');

    if (interval) clearInterval(interval);
    const total = seconds;
    interval = setInterval(() => {
      secondsLeft -= 1;
      setText(timerEl, String(Math.max(0, secondsLeft)));
      if (barEl?.style) barEl.style.width = `${Math.max(0, secondsLeft / total) * 100}%`;
      if (secondsLeft <= 0) {
        clearInterval(interval); interval = null;
        overlay.classList?.add('hidden');
        bus.emit(DISCONNECT_INTENT.AUTO_WIN);
      }
    }, 1000);
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
