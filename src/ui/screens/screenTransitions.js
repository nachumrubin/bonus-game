// Screen transition animations — extracted from main.js so the entrance
// animation wiring (screen-enter, menu-logo-enter, menu-enter) can be
// unit-tested in isolation.
//
// CSS keyframes live in styles.css; this module only adds/removes the
// trigger classes at the right moments.

export const SCREEN_IDS = Object.freeze([
  'sh', 'ss', 'sg', 'so', 'scoin',
  'sprofile', 'sfriends', 'snotif', 'schamps',
  'sauth-signup', 'sauth-login', 'sav-gallery', 'savatar-store', 'sstats',
  'smygames',
]);

// State held across calls so a stale menu-enter timer from a previous
// showSc('sh') doesn't strip pointer-events:none off the buttons early,
// and so a stale screen-transitioning timer can be replaced when the user
// rapidly navigates between screens.
const state = { menuEnterTimer: null, transitionTimer: null, transitionTarget: null };

// Mirrors legacy HEAD:index.html:3273 (`setTimeout(...380)`). The CSS rule
// `.screen.screen-transitioning, .screen.screen-transitioning *` sets
// `pointer-events:none`, blocking clicks on the new screen + its buttons
// during the fade-in. Without this, a rapid home → setup → back sequence
// could route clicks into buttons that haven't finished animating in.
const TRANSITION_BLOCK_MS = 380;

export function showScreen(id, { doc = globalThis.document, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  if (!doc) return null;
  let active = null;
  for (const s of SCREEN_IDS) {
    const el = doc.getElementById?.(s);
    if (!el) continue;
    // Clear screen-enter when hiding so animation-fill (opacity:1) doesn't
    // override .hidden's opacity:0.
    el.classList?.remove('screen-enter');
    if (s === id) {
      el.classList?.remove('hidden');
      active = el;
    } else {
      el.classList?.add('hidden');
    }
  }
  if (!active) return null;

  // Show the global topbar on every screen except the game board.
  // On the home screen the home button becomes the active/disabled indicator;
  // on all other screens it is a regular clickable navigation target.
  const topbar = doc.getElementById?.('global-topbar');
  if (topbar) {
    if (id === 'sg') {
      topbar.style.display = 'none';
    } else {
      topbar.style.display = '';
      const homeBtn = doc.getElementById?.('topbar-home-btn');
      if (homeBtn) {
        if (id === 'sh') {
          homeBtn.classList?.add('em-icon-btn--home-active');
          homeBtn.setAttribute?.('disabled', '');
          homeBtn.setAttribute?.('aria-current', 'page');
        } else {
          homeBtn.classList?.remove('em-icon-btn--home-active');
          homeBtn.removeAttribute?.('disabled');
          homeBtn.removeAttribute?.('aria-current');
        }
      }
    }
  }

  // Re-trigger entrance animation on the newly shown screen.
  void active.offsetWidth;
  active.classList?.add('screen-enter');

  // Pointer-block the new screen for the duration of the fade-in. If the
  // user is rapidly navigating, cancel a stale timer on a previous screen
  // before installing the new one so the previous screen doesn't get its
  // class stripped late while invisible (cosmetic) and so this screen's
  // block lasts the full window (clickability).
  if (state.transitionTimer != null) {
    clearTimeoutFn(state.transitionTimer);
    state.transitionTarget?.classList?.remove?.('screen-transitioning');
    state.transitionTimer = null;
    state.transitionTarget = null;
  }
  active.classList?.add('screen-transitioning');
  state.transitionTarget = active;
  state.transitionTimer = setTimeoutFn(() => {
    state.transitionTarget?.classList?.remove?.('screen-transitioning');
    state.transitionTimer = null;
    state.transitionTarget = null;
  }, TRANSITION_BLOCK_MS);

  if (id === 'sh') {
    const logo = active.querySelector?.('.hlogo');
    if (logo) {
      logo.classList?.remove('menu-logo-enter');
      void logo.offsetWidth;
      logo.classList?.add('menu-logo-enter');
    }
    const btns = active.querySelector?.('.hbtns');
    if (btns) {
      if (state.menuEnterTimer) {
        clearTimeoutFn(state.menuEnterTimer);
        state.menuEnterTimer = null;
      }
      btns.classList?.remove('menu-enter');
      void btns.offsetWidth;
      btns.classList?.add('menu-enter');
      // Last button delay 0.56s + 0.4s duration ≈ 0.96s. Remove `menu-enter`
      // after the stagger finishes so its `pointer-events:none` lifts.
      state.menuEnterTimer = setTimeoutFn(() => {
        btns.classList?.remove('menu-enter');
        state.menuEnterTimer = null;
      }, 1200);
    }
  }
  return active;
}

export function _resetTransitionState() {
  if (state.menuEnterTimer) {
    clearTimeout(state.menuEnterTimer);
    state.menuEnterTimer = null;
  }
  if (state.transitionTimer) {
    clearTimeout(state.transitionTimer);
    state.transitionTarget?.classList?.remove?.('screen-transitioning');
    state.transitionTimer = null;
    state.transitionTarget = null;
  }
}
