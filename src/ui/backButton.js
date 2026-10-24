// Android back button (and the browser ←) — what one press does.
//
// main.js parks a sentinel history entry so a press fires `popstate` instead
// of leaving the app, takes a snapshot of what is on screen (backSnapshot)
// and asks decideBack() what to do. Priority, first match wins:
//
//   1. the exit question is open        → close it (stay in the app)
//   2. the in-game end menu is open     → close it, back to the game
//   3. any other overlay is open        → press its close (סגור) button;
//                                         an overlay without one (mini-game,
//                                         matchmaking, results…) swallows it
//   4. post-game board review           → back to the results
//   5. game screen                      → open the end menu (סיים / שמור),
//                                         never leave the game directly
//   6. coin toss                        → nothing (it moves on by itself)
//   7. home                             → ask whether to exit the app
//   8. any other screen                 → the previous screen (home at most)

export const HOME_SCREEN = 'sh';
export const GAME_SCREEN = 'sg';
export const EXIT_OVERLAY = 'ov-exit-confirm';
export const GAME_MENU_OVERLAY = 'ov-back-confirm';

export const BACK_ACTION = Object.freeze({
  CLOSE_EXIT: 'closeExit',
  CLOSE_GAME_MENU: 'closeGameMenu',
  CLOSE_OVERLAY: 'closeOverlay',
  IGNORE: 'ignore',
  END_REVIEW: 'endReview',
  OPEN_GAME_MENU: 'openGameMenu',
  ASK_EXIT: 'askExit',
  NAVIGATE: 'navigate',
});

// A press never steps back into a finished trip: past the game (or the coin
// toss in front of it) lies only that game's setup, so it goes home instead.
const GAME_BOUNDARY = new Set([GAME_SCREEN, 'scoin']);

// The screen before `current` in the visited `stack` (root first). Tolerates a
// stack that has drifted from what is really showing: everything from the
// last `current` up is dropped; a screen the stack never saw goes home.
export function previousScreen(stack = [], current = null) {
  const i = stack.lastIndexOf(current);
  const before = i >= 0 ? stack.slice(0, i) : [];
  for (let k = before.length - 1; k >= 0; k--) {
    if (GAME_BOUNDARY.has(before[k])) return HOME_SCREEN;
    if (before[k] !== current) return before[k];
  }
  return HOME_SCREEN;
}

/**
 * @param {object} snap
 * @param {string|null} snap.screen        the visible screen id
 * @param {Array<{id:string, closeable:boolean}>} snap.overlays  open overlays, topmost last
 * @param {boolean} [snap.reviewing]       the post-game board review is up
 * @param {string[]} [snap.stack]          visited screens, root first
 * @returns {{ action: string, overlay?: string, screen?: string }}
 */
export function decideBack({ screen = null, overlays = [], reviewing = false, stack = [] } = {}) {
  const ids = overlays.map(o => o.id);
  if (ids.includes(EXIT_OVERLAY)) return { action: BACK_ACTION.CLOSE_EXIT };
  if (ids.includes(GAME_MENU_OVERLAY)) return { action: BACK_ACTION.CLOSE_GAME_MENU };
  if (overlays.length) {
    const top = overlays[overlays.length - 1];
    return top.closeable
      ? { action: BACK_ACTION.CLOSE_OVERLAY, overlay: top.id }
      : { action: BACK_ACTION.IGNORE };
  }
  if (reviewing) return { action: BACK_ACTION.END_REVIEW };
  if (screen === GAME_SCREEN) return { action: BACK_ACTION.OPEN_GAME_MENU };
  if (screen === 'scoin') return { action: BACK_ACTION.IGNORE };
  if (screen === HOME_SCREEN || !screen) return { action: BACK_ACTION.ASK_EXIT };
  return { action: BACK_ACTION.NAVIGATE, screen: previousScreen(stack, screen) };
}

const CLOSE_SEL = '[aria-label="סגור"]';

function shown(el) {
  return !!el && !el.classList?.contains?.('hidden') && el.offsetParent !== null;
}

// What is on screen right now, read from the DOM (the visible `.screen`, the
// open `.ov` overlays in document order, and whether each has a visible
// close button).
export function backSnapshot(doc = globalThis.document, { screenIds = [], stack = [] } = {}) {
  let screen = null;
  for (const id of screenIds) {
    const el = doc?.getElementById?.(id);
    if (el && !el.classList?.contains?.('hidden')) { screen = id; break; }
  }
  const overlays = [];
  for (const ov of doc?.querySelectorAll?.('.ov:not(.hidden)') ?? []) {
    if (!ov.id) continue;
    const close = Array.from(ov.querySelectorAll?.(CLOSE_SEL) ?? []).find(shown);
    overlays.push({ id: ov.id, closeable: !!close });
  }
  const review = doc?.getElementById?.('board-review-back');
  return { screen, overlays, reviewing: !!review && !review.classList?.contains?.('hidden'), stack };
}

// Press the overlay's own close button, so its controller runs exactly as if
// the player had tapped ✕.
export function clickOverlayClose(doc, id) {
  const ov = doc?.getElementById?.(id);
  const close = Array.from(ov?.querySelectorAll?.(CLOSE_SEL) ?? []).find(shown);
  close?.click?.();
  return !!close;
}
