// BOOST GLIDE — the screen-navigation motion system (Glide & Settle +
// Cascading Reveal). Data and pure helpers only: no DOM, no timers. The DOM
// wiring lives in src/ui/screens/screenTransitions.js, which is the single
// choke point every full-screen navigation already goes through (showSc).
//
// The numeric values here are the single source of truth. They are mirrored as
// CSS custom properties on `:root` in styles.css (--glide-*, --reveal-*) for the
// keyframes; boostGlide.test.js parses styles.css and fails if the two drift.
//
// See docs-md/BOOST_MOTION_SPEC.md §15 for the rationale.

// ── Glide & Settle — horizontal full-screen navigation ──────────────────
// Small displacement, not a full-width slide: the incoming screen travels
// 34px, the outgoing one 22px, both while cross-fading.
export const BOOST_GLIDE = Object.freeze({
  forwardDuration: 270,
  backwardDuration: 270,
  incomingOffset: 34,   // px the incoming screen starts away from its rest position
  outgoingOffset: 22,   // px the outgoing screen travels while fading out
  easing: 'cubic-bezier(0.2, 0, 0, 1)', // smooth deceleration, no overshoot
  // Boost is Hebrew-first (`<html dir="rtl">`): the back chip sits on the
  // RIGHT and points right (#gi-back), the home cards' chevrons point LEFT.
  // So in RTL "forward" is leftward-in-the-reading-order: the next screen
  // enters from the LEFT and the previous one exits to the right — the mirror
  // of the LTR convention. Set to false to use the LTR physical direction
  // (forward = enter from the right) regardless of document direction.
  mirrorInRtl: true,
});

// ── Cascading Reveal — staggered content entrance ───────────────────────
export const REVEAL = Object.freeze({
  verticalOffset: 10,   // px each group rises while fading in
  elementDuration: 210,
  staggerDelay: 50,
  initialOpacity: 0,
  // When a reveal rides on a forward Glide, the first group starts this long
  // after the glide begins so the two overlap rather than run back to back.
  glideLead: 40,
});

// ── Card morph — a home game-mode card becomes the screen it opens ───────
// Instead of the Glide, the screen grows out of the tapped card's box (its
// clip starts as the card's outline) while the card fades away and home
// recedes; going back to home from that screen shrinks it into the card
// again. Durations stay inside MAX_TOTAL_ENTRANCE. `armWindow`: how long a
// card tap stays good for the navigation it triggers. Wiring:
// screenTransitions.js (armCardMorph + showScreen); keyframes: styles.css.
export const CARD_MORPH = Object.freeze({
  openDuration: 380,
  closeDuration: 340,
  openEasing: 'cubic-bezier(0.3, 0, 0, 1)',
  closeEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  armWindow: 600,
});

// Upper bound for a full entrance (glide + every reveal group). Ordinary
// navigation must finish its visual sequence inside this window (≈400ms).
export const MAX_TOTAL_ENTRANCE = 420;

// Classes a screen carries while it is still arriving (BOOST GLIDE's incoming
// glide, the home build). Heavy per-screen work — e.g. starting a live-3D
// Boostie, whose WebGL setup is one long frame — waits until they are gone so
// it never freezes the entrance. Removing them is a class mutation, so a
// MutationObserver on the screen sees the moment it settles.
export const ENTERING_CLASSES = Object.freeze(['glide-in', 'morph-in', 'hb-building']);

export function isScreenEntering(el) {
  return ENTERING_CLASSES.some((c) => el?.classList?.contains?.(c));
}

// The root of the navigation tree. Navigating here is always "back".
export const HOME_SCREEN = 'sh';

// Hierarchy depth, used to pick a direction when the target screen is not in
// the visited history (e.g. Friends' back chip opens Profile even when the
// player came to Friends straight from the home nav). Unlisted screens = 1.
export const SCREEN_DEPTH = Object.freeze({
  sh: 0,
  so: 1, ss: 1, sprofile: 1, sstats: 1, smygames: 1, 'sav-gallery': 1,
  snotif: 1, sadmin: 1, 'sauth-signup': 1, 'sauth-login': 1,
  sfriends: 2, 'savatar-store': 2, scoin: 2,
  sg: 3,
});

// Reveal plans: which content groups enter, and in which order, on a
// meaningful entry into each screen. `step` is multiplied by
// REVEAL.staggerDelay; fractional steps are allowed. Selectors are scoped to
// the screen element unless `scope: 'doc'` (the home topbar lives outside #sh).
// Lists are revealed as ONE container — never row by row (rows load async).
// Screens with no plan (game, coin toss, admin) get the Glide only.
const GENERIC_PAGE_PLAN = Object.freeze([
  { sel: '.g-hdr', step: 0 },
  { sel: '.g-page > :not(.g-hdr)', step: 1 },
]);

export const REVEAL_PLANS = Object.freeze({
  // Main menu: logo → profile/ELO → primary action → remaining actions →
  // secondary controls (0 / 50 / 100 / 150–200 / 210 ms).
  sh: Object.freeze([
    { sel: '.hlogo', step: 0 },
    { sel: '#global-topbar .em-profile-btn', step: 1, scope: 'doc' },
    { sel: '#home-turn-strip, .hm-cards > :nth-child(1)', step: 2 },
    { sel: '.hm-cards > :nth-child(2)', step: 3 },
    { sel: '.hm-cards > :nth-child(3)', step: 3.5 },
    { sel: '#home-lb-row, #home-bottom-nav, .credit', step: 4 },
    { sel: '#global-topbar .em-topbar-icons', step: 4.2, scope: 'doc' },
  ]),
  // Game mode selection: header → intro → mode options.
  so: Object.freeze([
    { sel: '.g-hdr', step: 0 },
    { sel: '.g-scroll > :not(.g-mode)', step: 1 },
    { sel: '.g-scroll > .g-mode', step: 2 },
  ]),
  // Game setup: header → options → start dock.
  ss: Object.freeze([
    { sel: '.g-hdr', step: 0 },
    { sel: '.g-scroll', step: 1 },
    { sel: '.g-dock', step: 2 },
  ]),
  // Friends: header → primary controls (my code, add friend) → lists container.
  sfriends: Object.freeze([
    { sel: '.g-hdr', step: 0 },
    { sel: '.g-scroll > :nth-child(-n+2)', step: 1 },
    { sel: '.g-scroll > :nth-child(n+3)', step: 2 },
  ]),
  // My games: header → tabs → list container.
  smygames: Object.freeze([
    { sel: '.g-hdr', step: 0 },
    { sel: '#mg-tabs', step: 1 },
    { sel: '.g-scroll', step: 2 },
  ]),
  // Statistics: header → summary (hero + archetype) → sections feed.
  sstats: Object.freeze([
    { sel: '.g-hdr', step: 0 },
    { sel: '.stats-hero, .st-archetype-card', step: 1 },
    { sel: '.stats-feed', step: 2 },
  ]),
  // Achievements: header → progress summary → grid container.
  'sav-gallery': Object.freeze([
    { sel: '.g-hdr', step: 0 },
    { sel: '.ach-g-summary', step: 1 },
    { sel: '#av-locked-hint, .g-scroll', step: 2 },
  ]),
  // Minimal header/content reveal.
  sprofile: GENERIC_PAGE_PLAN,
  snotif: GENERIC_PAGE_PLAN,
  'savatar-store': GENERIC_PAGE_PLAN,
  'sauth-signup': GENERIC_PAGE_PLAN,
  'sauth-login': GENERIC_PAGE_PLAN,
});

export function glideDuration(direction) {
  return direction === 'back' ? BOOST_GLIDE.backwardDuration : BOOST_GLIDE.forwardDuration;
}

// Decide the kind of entrance for a navigation from `current` to `target`.
//   'none'    — same screen re-shown (re-render / refresh): no animation
//   'launch'  — first screen shown (no outgoing screen): reveal only
//   'back'    — target is home, in the visited history, or shallower
//   'forward' — everything else
// `requested` ('forward' | 'back' | 'none') overrides the inference.
export function resolveDirection({ current, target, history = [], requested } = {}) {
  if (target && target === current) return 'none';
  if (requested === 'forward' || requested === 'back' || requested === 'none') {
    return current ? requested : 'launch';
  }
  if (!current) return 'launch';
  if (target === HOME_SCREEN) return 'back';
  if (history.includes(target)) return 'back';
  const depth = (id) => SCREEN_DEPTH[id] ?? 1;
  return depth(target) < depth(current) ? 'back' : 'forward';
}

// Next visited-history after navigating. Home resets the stack; going back
// truncates to the target; going forward pushes it.
export function nextHistory(history, target, direction) {
  if (!target) return history.slice();
  if (target === HOME_SCREEN) return [HOME_SCREEN];
  const idx = history.indexOf(target);
  if (idx >= 0) return history.slice(0, idx + 1);
  if (direction === 'back') {
    // Back to a screen we never visited (depth-based): replace the current top.
    return [...history.slice(0, -1), target];
  }
  if (direction === 'none') return history.slice();
  return [...history, target];
}

// Physical sign of the incoming screen's start offset: +1 = starts to the
// right of its rest position, -1 = starts to the left. The outgoing screen
// always travels the opposite way.
export function glideSign(direction, { rtl = false, mirrorInRtl = BOOST_GLIDE.mirrorInRtl } = {}) {
  const base = direction === 'back' ? -1 : 1;
  return rtl && mirrorInRtl ? -base : base;
}

// Reveal groups for an entrance, with absolute delays (ms). Reveals play on
// meaningful entries only: launch and forward. A back navigation returns to a
// screen the player has already seen, so it never re-staggers.
export function revealSchedule(screenId, direction, { plans = REVEAL_PLANS } = {}) {
  if (direction !== 'launch' && direction !== 'forward') return [];
  const plan = plans[screenId];
  if (!plan) return [];
  const lead = direction === 'forward' ? REVEAL.glideLead : 0;
  return plan.map(({ sel, step, scope = 'screen' }) => ({
    sel,
    scope,
    delay: Math.round(lead + step * REVEAL.staggerDelay),
  }));
}

// Total time until every class this entrance adds can be removed.
export function entranceTotal(direction, schedule) {
  const glide = (direction === 'forward' || direction === 'back') ? glideDuration(direction) : 0;
  const lastDelay = schedule.reduce((m, g) => Math.max(m, g.delay), -Infinity);
  const reveal = schedule.length ? lastDelay + REVEAL.elementDuration : 0;
  return Math.max(glide, reveal);
}
