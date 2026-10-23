// Screen transitions — BOOST GLIDE (Glide & Settle + Cascading Reveal).
//
// showScreen() is the single choke point for full-screen navigation (main.js
// routes showSc / showLegacyScreen / goHome through it). It swaps the visible
// `.screen` exactly as before and, on top of that, adds short-lived classes:
//
//   outgoing screen  .glide-out  — stays visible for one glide, drifts and fades
//   incoming screen  .glide-in   — drifts in from the side and fades up
//   content groups   .reveal-item (+ --reveal-delay) — staggered rise-in
//
// Every class (and the per-element custom properties) is stripped by a single
// cleanup timer, or immediately when the next navigation interrupts this one.
// Timing/offset values and the per-screen reveal plans live in
// src/ui/boostGlide.js; the keyframes live in styles.css (§1 Screen transition).
//
// Modals/overlays (.ov) never come through here, so they keep their own motion.

import {
  HOME_SCREEN, resolveDirection, nextHistory, glideSign, revealSchedule, entranceTotal,
} from '../boostGlide.js';

export const SCREEN_IDS = Object.freeze([
  'sh', 'ss', 'sg', 'so', 'scoin',
  'sprofile', 'sfriends', 'snotif',
  'sauth-signup', 'sauth-login', 'sav-gallery', 'savatar-store', 'sstats',
  'smygames', 'sadmin',
]);

const GLIDE_CLASSES = ['glide-in', 'glide-out'];
const REVEAL_CLASS = 'reveal-item';

// State held across calls so a stale timer from a previous navigation can be
// cancelled (rapid taps / rapid back-forward) and its classes flushed at once.
const state = {
  transitionTimer: null,
  transitionTarget: null,
  glideTimer: null,
  glideEls: [],      // screens (and the home topbar) carrying glide-* classes
  revealEls: [],     // elements carrying reveal-item
  hideTopbarOnSettle: false,
  topbar: null,
  history: [],       // visited screens, root first — used for direction only
  current: null,
};

// Mirrors legacy HEAD:index.html:3273 (`setTimeout(...380)`). The CSS rule
// `.screen.screen-transitioning, .screen.screen-transitioning *` sets
// `pointer-events:none`, blocking clicks on the new screen + its buttons
// during the entrance. Without this, a rapid double tap could land on a
// button of the screen that is still gliding in (double navigation).
const TRANSITION_BLOCK_MS = 380;

function isReducedDefault(doc) {
  return !!doc?.documentElement?.hasAttribute?.('data-reduced-motion');
}

function isRtlDefault(doc) {
  const root = doc?.documentElement;
  const dir = root?.dir || root?.getAttribute?.('dir') || '';
  return String(dir).toLowerCase() === 'rtl';
}

function setTopbarVisible(topbar, visible) {
  if (topbar?.style) topbar.style.display = visible ? '' : 'none';
}

// Strip every glide/reveal artefact immediately (interrupt or settle).
function settleGlide(clearTimeoutFn = clearTimeout) {
  if (state.glideTimer != null) {
    clearTimeoutFn(state.glideTimer);
    state.glideTimer = null;
  }
  for (const el of state.glideEls) {
    el.classList?.remove?.(...GLIDE_CLASSES);
    el.style?.removeProperty?.('--glide-dir');
  }
  for (const el of state.revealEls) {
    el.classList?.remove?.(REVEAL_CLASS);
    el.style?.removeProperty?.('--reveal-delay');
  }
  state.glideEls = [];
  state.revealEls = [];
  if (state.hideTopbarOnSettle) setTopbarVisible(state.topbar, false);
  state.hideTopbarOnSettle = false;
}

function applyReveal(doc, screenEl, schedule) {
  const out = [];
  for (const { sel, scope, delay } of schedule) {
    const root = scope === 'doc' ? doc : screenEl;
    let list = [];
    try { list = Array.from(root?.querySelectorAll?.(sel) ?? []); } catch { list = []; }
    for (const el of list) {
      if (out.includes(el)) continue;
      el.style?.setProperty?.('--reveal-delay', `${delay}ms`);
      el.classList?.add?.(REVEAL_CLASS);
      out.push(el);
    }
  }
  return out;
}

export function showScreen(id, {
  doc = globalThis.document,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  direction: requested,
  reducedMotion,
  rtl,
} = {}) {
  if (!doc) return null;

  // Which screen is on stage right now (before the swap)?
  let outgoing = null;
  for (const s of SCREEN_IDS) {
    const el = doc.getElementById?.(s);
    if (el && s !== id && !el.classList?.contains?.('hidden')) { outgoing = el; break; }
  }
  const target = doc.getElementById?.(id);
  if (!target) {
    for (const s of SCREEN_IDS) doc.getElementById?.(s)?.classList?.add('hidden');
    return null;
  }

  const wasVisible = !target.classList?.contains?.('hidden');
  const current = wasVisible ? id : (outgoing ? outgoing.id : state.current);
  const reduced = typeof reducedMotion === 'function' ? !!reducedMotion() : (reducedMotion ?? isReducedDefault(doc));
  const direction = resolveDirection({
    current: current ?? null, target: id, history: state.history, requested,
  });
  state.history = nextHistory(state.history.length ? state.history : (current ? [current] : []), id, direction);
  state.current = id;

  // A re-show of the visible screen is a re-render, not a navigation: leave
  // any running entrance alone and do nothing visual.
  if (direction === 'none' && wasVisible && !outgoing) return target;

  // Interrupt whatever entrance is still running so this one starts clean.
  settleGlide(clearTimeoutFn);

  for (const s of SCREEN_IDS) {
    const el = doc.getElementById?.(s);
    if (!el) continue;
    if (s === id) el.classList?.remove('hidden');
    else el.classList?.add('hidden');
  }

  // Glass skin (tools/screens-mockup): the chip topbar belongs to the home
  // screen only — every other screen carries its own header with a back chip.
  // On the home screen the home button becomes the active/disabled indicator.
  const topbar = doc.getElementById?.('global-topbar');
  state.topbar = topbar;
  const leavingHome = outgoing?.id === HOME_SCREEN;
  if (topbar) {
    if (id !== HOME_SCREEN) {
      setTopbarVisible(topbar, false);
    } else {
      setTopbarVisible(topbar, true);
      const homeBtn = doc.getElementById?.('topbar-home-btn');
      if (homeBtn) {
        homeBtn.classList?.add('em-icon-btn--home-active');
        homeBtn.setAttribute?.('disabled', '');
        homeBtn.setAttribute?.('aria-current', 'page');
      }
    }
  }

  const animate = !reduced && direction !== 'none';
  const glides = animate && (direction === 'forward' || direction === 'back') && !!outgoing;
  const schedule = animate ? revealSchedule(id, direction) : [];

  if (glides || schedule.length) {
    // One reflow so re-adding a class restarts its animation.
    void target.offsetWidth;
  }

  if (glides) {
    const sign = glideSign(direction, { rtl: rtl ?? isRtlDefault(doc) });
    const mark = (el) => {
      el.style?.setProperty?.('--glide-dir', String(sign));
      state.glideEls.push(el);
    };
    mark(outgoing);
    outgoing.classList?.add('glide-out');
    mark(target);
    target.classList?.add('glide-in');
    // The topbar is part of the home screen visually: it leaves and returns
    // with it instead of popping out/in.
    if (topbar && leavingHome) {
      setTopbarVisible(topbar, true);
      state.hideTopbarOnSettle = true;
      mark(topbar);
      topbar.classList?.add('glide-out');
    } else if (topbar && id === HOME_SCREEN) {
      mark(topbar);
      topbar.classList?.add('glide-in');
    }
  }

  if (schedule.length) state.revealEls = applyReveal(doc, target, schedule);

  // Pointer-block the new screen for the duration of the entrance. If the
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
  target.classList?.add('screen-transitioning');
  state.transitionTarget = target;
  state.transitionTimer = setTimeoutFn(() => {
    state.transitionTarget?.classList?.remove?.('screen-transitioning');
    state.transitionTimer = null;
    state.transitionTarget = null;
  }, TRANSITION_BLOCK_MS);

  // One cleanup for the whole entrance: strips glide/reveal classes so no
  // transform/opacity animation lingers and a later re-render can't replay it.
  if (glides || state.revealEls.length) {
    const total = entranceTotal(glides ? direction : 'launch', schedule);
    state.glideTimer = setTimeoutFn(() => {
      state.glideTimer = null;
      settleGlide(clearTimeoutFn);
    }, total + 20);
  }

  return target;
}

// Replay the launch entrance (Cascading Reveal only, no Glide) on the screen
// that is currently visible. Used once on cold start, when the boot loader
// lifts — the first showScreen('sh') runs while the loader still covers it.
export function revealCurrentScreen({
  doc = globalThis.document,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  reducedMotion,
} = {}) {
  if (!doc || !state.current) return false;
  const reduced = typeof reducedMotion === 'function' ? !!reducedMotion() : (reducedMotion ?? isReducedDefault(doc));
  if (reduced) return false;
  const el = doc.getElementById?.(state.current);
  if (!el || el.classList?.contains?.('hidden')) return false;
  const schedule = revealSchedule(state.current, 'launch');
  if (!schedule.length) return false;
  settleGlide(clearTimeoutFn);
  void el.offsetWidth;
  state.revealEls = applyReveal(doc, el, schedule);
  if (!state.revealEls.length) return false;
  state.glideTimer = setTimeoutFn(() => {
    state.glideTimer = null;
    settleGlide(clearTimeoutFn);
  }, entranceTotal('launch', schedule) + 20);
  return true;
}

// Flush any running glide/reveal at once (a build sequence is about to take
// over the same elements).
export function settleEntrance({ clearTimeoutFn = clearTimeout } = {}) {
  settleGlide(clearTimeoutFn);
}

// Test/diagnostic view of the direction bookkeeping.
export function _getTransitionState() {
  return {
    current: state.current,
    history: state.history.slice(),
    gliding: state.glideEls.length > 0,
    revealing: state.revealEls.length > 0,
  };
}

export function _resetTransitionState() {
  if (state.transitionTimer) {
    clearTimeout(state.transitionTimer);
    state.transitionTarget?.classList?.remove?.('screen-transitioning');
    state.transitionTimer = null;
    state.transitionTarget = null;
  }
  settleGlide(clearTimeout);
  state.topbar = null;
  state.history = [];
  state.current = null;
}
