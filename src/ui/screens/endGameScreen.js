// endGameScreen — wraps #ov-end. Opens automatically on GAME_COMPLETED.
//
// Renders winner name, both players' scores, and rematch / home buttons.
// The leaderboard sub-section (#champions-wrap) is left to legacy for now —
// when champions are migrated, the spine will populate it via a separate
// module.

import { $, on, setText } from '../domHelpers.js';
import { EV } from '../../events/eventTypes.js';
import { RATING_EVT } from '../../game/account/ratingService.js';

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

  // Rating service emits this AFTER the local Elo write finishes, which is
  // typically a moment after GAME_COMPLETED. Pin the deltas onto the score
  // cards as they arrive.
  cleanups.push(bus.on(RATING_EVT.CHANGED, (payload = {}) => {
    renderEloDeltas(payload);
  }));

  function render({ winnerSlot, scores = { 0: 0, 1: 0 }, players, abandonedBy, abandonReason } = {}) {
    clearEloDeltas();
    setText($('#es1', overlay), String(scores[0] ?? 0));
    setText($('#es2', overlay), String(scores[1] ?? 0));
    setText($('#en1', overlay), players?.[0]?.displayName ?? 'שחקן 1');
    setText($('#en2', overlay), players?.[1]?.displayName ?? 'שחקן 2');

    const wn = $('#wn', overlay);
    const ws = $('#wws', overlay);
    const mySlot = globalThis.__spine?.activeGame?.session?.mySlot;
    // Outcome rule:
    //   • walkout (abandonedBy set): ONLY 0-0 is a draw; any other score —
    //     including a non-zero tie like 10-10 — is a loss for the leaver, so
    //     the other side wins.
    //   • normal finish: equal scores are a draw, otherwise the higher wins.
    const score0 = Number(scores?.[0] ?? 0);
    const score1 = Number(scores?.[1] ?? 0);
    const walkout = abandonedBy === 0 || abandonedBy === 1;
    const effectiveWinner = walkout
      ? ((score0 === 0 && score1 === 0) ? null : 1 - abandonedBy)
      : (winnerSlot != null
          ? winnerSlot
          : (score0 === score1 ? null : (score0 > score1 ? 0 : 1)));

    if (effectiveWinner == null) {
      setText(wn, 'המשחק הסתיים בתיקו');
      // Note the walkout when the draw came from a player leaving at a tie.
      const note = abandonedBy == null ? ''
        : (mySlot === abandonedBy ? 'עזבת את המשחק' : 'היריב עזב את המשחק');
      setText(ws, note);
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
    if (abandonReason === 'left') {
      return iLost
        ? 'עזבת את המשחק'
        : 'ניצחת — היריב עזב את המשחק';
    }
    return iLost ? 'פרשת מהמשחק' : 'היריב פרש';
  }

  function clearEloDeltas() {
    setText($('#elo-delta-1', overlay), '');
    setText($('#elo-delta-2', overlay), '');
    $('#elo-delta-1', overlay)?.classList?.remove('up', 'down');
    $('#elo-delta-2', overlay)?.classList?.remove('up', 'down');
  }

  function renderEloDeltas({ myBefore, myAfter, oppBefore, oppAfter } = {}) {
    const mySlot = globalThis.__spine?.activeGame?.session?.mySlot;
    if (mySlot !== 0 && mySlot !== 1) return;
    const oppSlot = mySlot === 0 ? 1 : 0;
    if (Number.isFinite(myBefore) && Number.isFinite(myAfter)) {
      paintDelta(mySlot + 1, myAfter - myBefore, myAfter);
    }
    if (Number.isFinite(oppBefore) && Number.isFinite(oppAfter)) {
      paintDelta(oppSlot + 1, oppAfter - oppBefore, oppAfter);
    }
  }

  function paintDelta(slotOneBased, delta, newRating) {
    const el = $(`#elo-delta-${slotOneBased}`, overlay);
    if (!el) return;
    el.classList?.remove('up', 'down');
    if (delta > 0) el.classList?.add('up');
    else if (delta < 0) el.classList?.add('down');
    const sign = delta > 0 ? '+' : '';
    setText(el, `דירוג ${newRating} (${sign}${delta})`);
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
