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
  cleanups.push(bus.on(EV.GAME_COMPLETED, ({ winnerSlot, scores, players, abandonedBy } = {}) => {
    bus.emit(END_OPEN, { winnerSlot, scores, players, abandonedBy });
  }));

  cleanups.push(bus.on(END_OPEN, (payload = {}) => {
    render(payload);
    overlay.classList?.remove('hidden');
  }));

  function render({ winnerSlot, scores = { 0: 0, 1: 0 }, players, abandonedBy } = {}) {
    setText($('#es1', overlay), String(scores[0] ?? 0));
    setText($('#es2', overlay), String(scores[1] ?? 0));
    setText($('#en1', overlay), players?.[0]?.displayName ?? 'שחקן 1');
    setText($('#en2', overlay), players?.[1]?.displayName ?? 'שחקן 2');

    const wn = $('#wn', overlay);
    const ws = $('#wws', overlay);
    if (winnerSlot == null) {
      setText(wn, 'תיקו!');
      setText(ws, '');
    } else {
      const name = players?.[winnerSlot]?.displayName ?? `שחקן ${winnerSlot + 1}`;
      setText(wn, `${name} ניצח!`);
      const margin = Math.abs((scores[0] ?? 0) - (scores[1] ?? 0));
      setText(ws, abandonedBy != null ? 'היריב פרש' : `בהפרש של ${margin}`);
    }
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
