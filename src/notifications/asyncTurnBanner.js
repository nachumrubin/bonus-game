// asyncTurnBanner — opens an in-app banner / toast when the player has
// async games where it's their turn.
//
// Triggered on app boot AND whenever the spine emits MENU_REFRESH (i.e.
// the user navigated back to the menu). Pulls the user's async sessions,
// counts the my-turn ones, and fans out a toast.
//
// We don't want a banner for EVERY my-turn room every time — that's
// nagging. The dedup rule:
//   - Suppress if we've already shown a banner for this exact set of
//     my-turn roomIds within the last `dedupWindowMs` (default 60s).
// Implemented with an in-module Map of last-shown timestamps keyed by uid.

import * as inApp from './inAppNotificationService.js';

const DEFAULT_DEDUP_MS = 60 * 1000;
const lastShownByUid = new Map(); // uid → { signature, atMs }

function buildText(myTurnSessions) {
  if (myTurnSessions.length === 1) {
    const s = myTurnSessions[0];
    const opp = s.opponentName ?? 'יריב';
    return `תורך נגד ${opp}!`;
  }
  return `יש ${myTurnSessions.length} משחקים שמחכים לך!`;
}

// Pure helper: filter to my-turn sessions and produce a stable signature
// for dedup.
export function buildSignature(sessions) {
  return sessions
    .filter(s => s.isMyTurn)
    .map(s => s.roomId)
    .sort()
    .join('|');
}

// Public entry point. Pass the currently-listed sessions (caller fetched
// from asyncSessionService) plus the user's uid for dedup.
//
// `now`, `show`, and `dedupWindowMs` are injectable for tests.
export function maybeShow({
  uid, sessions = [],
  now = Date.now(),
  dedupWindowMs = DEFAULT_DEDUP_MS,
  show = (opts) => inApp.show(opts),
} = {}) {
  if (!uid) return { shown: false, reason: 'no-uid' };
  const myTurn = sessions.filter(s => s.isMyTurn);
  if (myTurn.length === 0) return { shown: false, reason: 'no-my-turn' };

  const signature = buildSignature(sessions);
  const last = lastShownByUid.get(uid);
  if (last && last.signature === signature && (now - last.atMs) < dedupWindowMs) {
    return { shown: false, reason: 'deduped' };
  }

  show({
    kind: inApp.TOAST_KIND.OK,
    text: buildText(myTurn),
    durationMs: 4500,
  });
  lastShownByUid.set(uid, { signature, atMs: now });
  return { shown: true };
}

// Test reset
export function _resetForTests() {
  lastShownByUid.clear();
}
