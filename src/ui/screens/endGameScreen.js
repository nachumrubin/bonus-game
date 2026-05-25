// endGameScreen — wraps #ov-end. Opens automatically on GAME_COMPLETED.
//
// Renders winner name, both players' scores, and rematch / home buttons.
// The leaderboard sub-section (#champions-wrap) is left to legacy for now —
// when champions are migrated, the spine will populate it via a separate
// module.

import { $, on, setText } from '../domHelpers.js';
import { EV } from '../../events/eventTypes.js';

export const END_INTENT = Object.freeze({
  REMATCH: 'end/rematch',
  GO_HOME: 'end/goHome',
});

export const END_OPEN = 'overlay/end/open';

export function mountEndGameScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountEndGameScreen: bus required');

  const overlay = $('#ov-end', root);
  if (!overlay) {
    console.warn('[endGameScreen] #ov-end not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  const rematch = $('button[onclick="rematch()"]', overlay);
  const goHome  = $('button[onclick="goHome()"]', overlay);

  if (rematch) {
    rematch.removeAttribute('onclick');
    cleanups.push(on(rematch, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(END_INTENT.REMATCH);
    }));
  }
  if (goHome) {
    goHome.removeAttribute('onclick');
    cleanups.push(on(goHome, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(END_INTENT.GO_HOME);
    }));
  }

  // ─── Auto-open on GAME_COMPLETED ────────────────────────
  cleanups.push(bus.on(EV.GAME_COMPLETED, ({ winnerSlot, scores, players, abandonedBy, abandonReason } = {}) => {
    bus.emit(END_OPEN, { winnerSlot, scores, players, abandonedBy, abandonReason });
  }));

  cleanups.push(bus.on(END_OPEN, (payload = {}) => {
    render(payload);
    overlay.classList?.remove('hidden');
  }));

  function render({ winnerSlot, scores = { 0: 0, 1: 0 }, players, abandonedBy, abandonReason } = {}) {
    setText($('#es1', overlay), String(scores[0] ?? 0));
    setText($('#es2', overlay), String(scores[1] ?? 0));
    setText($('#en1', overlay), players?.[0]?.displayName ?? 'שחקן 1');
    setText($('#en2', overlay), players?.[1]?.displayName ?? 'שחקן 2');

    const wn = $('#wn', overlay);
    const ws = $('#wws', overlay);
    const mySlot = globalThis.__spine?.activeGame?.session?.mySlot;
    const effectiveWinner = winnerSlot != null
      ? winnerSlot
      : (abandonedBy === 0 ? 1 : abandonedBy === 1 ? 0 : null);

    if (effectiveWinner == null) {
      setText(wn, 'תיקו!');
      setText(ws, '');
      return;
    }

    const name = players?.[effectiveWinner]?.displayName ?? `שחקן ${effectiveWinner + 1}`;
    setText(wn, `${name} ניצח!`);
    setText(ws, abandonMessage({ abandonedBy, abandonReason, mySlot, scores }));
  }

  function abandonMessage({ abandonedBy, abandonReason, mySlot, scores }) {
    if (abandonedBy == null) {
      const margin = Math.abs((scores?.[0] ?? 0) - (scores?.[1] ?? 0));
      return `בהפרש של ${margin}`;
    }
    const iLost = mySlot === abandonedBy;
    if (abandonReason === 'missed-turns') {
      return iLost
        ? 'הפסדת — לא שיחקת 2 תורים ברצף'
        : 'ניצחת — היריב לא שיחק 2 תורים ברצף';
    }
    if (abandonReason === 'disconnect') {
      return iLost
        ? 'הפסדת — התנתקת מהמשחק'
        : 'ניצחת — היריב התנתק מהמשחק';
    }
    return iLost ? 'פרשת מהמשחק' : 'היריב פרש';
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
