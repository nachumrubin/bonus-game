// coinPill — a coin-balance tab that slides out from behind the profile block's
// bottom edge, counts the balance up to its new value and slides back in. Played
// after the daily reward is collected (main.js, DAILY_REWARD_ACK).
//
// The tab lives in #topbar-coin-pill-clip, a clip box hung from the block's bottom
// edge and inset by its corner radius, so the tab reads as part of the block. Under reduced
// motion the global blanket in styles.css drops the slide and the count jumps to
// the final value; the pill still shows and hides on the same schedule.

import { COIN_ICON_HTML } from './screens/coinIcon.js';
import { getMotionPreference } from './motionPreference.js';

export const COIN_PILL_TIMING = Object.freeze({
  slideMs: 320,    // keep in step with the .coin-pill transition in screens-glass.css
  countMs: 900,
  holdMs: 1100,
});

// The value shown at progress t (0..1): ease-out, so the count slows as it lands.
export function coinCountValue(from, to, t) {
  const p = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - p) ** 3;
  return Math.round(from + (to - from) * eased);
}

const BLOCK_RADIUS = 14;   // .em-profile-btn border-radius (screens-glass.css)

const fmt = (n) => Number(n).toLocaleString('he-IL');

let running = null;

export function showCoinCountUp({ from, to, doc = globalThis.document, win = globalThis } = {}) {
  const topbar = doc?.getElementById?.('global-topbar');
  const btn = doc?.getElementById?.('btn-profile-home');
  if (!topbar || !btn || topbar.style.display === 'none' || !Number.isFinite(to)) return false;
  running?.cancel();

  let clip = doc.getElementById('topbar-coin-pill-clip');
  if (!clip) {
    clip = doc.createElement('div');
    clip.id = 'topbar-coin-pill-clip';
    clip.setAttribute('aria-hidden', 'true');
    clip.innerHTML = `<div class="coin-pill" id="topbar-coin-pill">${COIN_ICON_HTML}<span class="coin-pill-val"></span></div>`;
    topbar.appendChild(clip);
  }
  const pill = clip.firstElementChild;
  const val = pill.querySelector('.coin-pill-val');

  // Hang the clip box from the block's bottom edge, inset past its rounded corners
  // (the top bar's own coordinates).
  const bar = topbar.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const inset = Math.min(BLOCK_RADIUS, b.width / 4);
  clip.style.top = `${b.bottom - bar.top}px`;
  clip.style.left = `${b.left - bar.left + inset}px`;
  clip.style.width = `${b.width - inset * 2}px`;

  const start = Number.isFinite(from) ? from : to;
  val.textContent = fmt(start);
  const reduced = getMotionPreference().isReduced();
  const timers = [];
  let raf = 0;
  const later = (fn, ms) => timers.push(win.setTimeout(fn, ms));

  pill.classList.remove('is-out');
  void pill.offsetWidth;   // restart the slide when it replays
  pill.classList.add('is-out');

  const t0 = COIN_PILL_TIMING.slideMs;
  later(() => {
    if (reduced || !win.requestAnimationFrame) { val.textContent = fmt(to); return; }
    const begin = win.performance?.now?.() ?? Date.now();
    const step = (now) => {
      const t = (now - begin) / COIN_PILL_TIMING.countMs;
      val.textContent = fmt(coinCountValue(start, to, t));
      if (t < 1) raf = win.requestAnimationFrame(step);
    };
    raf = win.requestAnimationFrame(step);
  }, t0);
  later(() => pill.classList.remove('is-out'), t0 + COIN_PILL_TIMING.countMs + COIN_PILL_TIMING.holdMs);

  running = {
    cancel() {
      timers.forEach((id) => win.clearTimeout(id));
      if (raf) win.cancelAnimationFrame?.(raf);
      running = null;
    },
  };
  return true;
}
