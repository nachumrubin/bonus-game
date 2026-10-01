// bonusFx — shared celebration helpers for the bonus mini-games.
//
//   confettiBurst(container)            — spawns gold/cyan particles
//   countUp(el, to, opts)               — animates a number 0 → to
//   bonusResultHtml(opts)               — the shared result markup (medal,
//                                         headline, gold points, extra html)
//   showBonusResult(containerEl, opts)  — renders it + confetti + count-up
//   startResultCount(containerEl, pts)  — count-up for self-rendered results,
//                                         plus the win / fail sound (every
//                                         mini-game result passes through here)
//   wordTilesHtml(word, tone)           — a word as a row of small wood tiles
//
// Everything is defensive: with no usable DOM (tests pass plain objects or
// nothing) each function is a no-op, so importing this never forces a browser.

import { cue as cueSfx } from '../../feedbackService.js';

const CONFETTI_COLORS = ['#ffd23f', '#00d0ff', '#36d97a', '#ff5a8a', '#ffffff', '#b06bff'];

export function confettiBurst(container, { count = 28, doc = globalThis.document } = {}) {
  if (!container?.appendChild || !doc?.createElement) return null;
  const layer = doc.createElement('div');
  layer.className = 'bz-confetti';
  for (let i = 0; i < count; i++) {
    const piece = doc.createElement('i');
    piece.className = 'bz-confetti-piece';
    const x   = Math.round(Math.random() * 220 - 110);
    const y   = Math.round(Math.random() * 70 + 130);
    const rot = Math.round(Math.random() * 720 - 360);
    const delay = (Math.random() * 0.12).toFixed(2);
    const dur   = (0.8 + Math.random() * 0.6).toFixed(2);
    piece.style.cssText =
      `--bz-x:${x}px;--bz-y:${y}px;--bz-rot:${rot}deg;`
      + `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};`
      + `animation-delay:${delay}s;animation-duration:${dur}s;`
      + (Math.random() < 0.5 ? 'border-radius:50%;' : '');
    layer.appendChild(piece);
  }
  container.appendChild(layer);
  setTimeout(() => { try { layer.remove(); } catch { /* swallow */ } }, 1800);
  return layer;
}

export function countUp(el, to, { from = 0, durationMs = 650, prefix = '', suffix = '', tickSound = null } = {}) {
  if (!el) return;
  const target = Number(to) || 0;
  const start  = Number(from) || 0;
  const raf = globalThis.requestAnimationFrame;
  let shown = null;
  const setVal = (v) => {
    el.textContent = `${prefix}${v}${suffix}`;
    // Coin ticks while the number climbs (the cue itself is throttled).
    if (tickSound && shown != null && v !== shown) cueSfx(tickSound);
    shown = v;
  };
  if (typeof raf !== 'function' || target === start) { setVal(target); return; }
  const now = () => (globalThis.performance?.now?.() ?? Date.now());
  const t0 = now();
  function frame() {
    const t = Math.min(1, (now() - t0) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    setVal(Math.round(start + (target - start) * eased));
    if (t < 1) raf(frame);
  }
  raf(frame);
}

// Result-medal glyphs (#gi-* sprite in index.html). Stroke icons, except the
// star which reads better filled.
const RESULT_ICONS = Object.freeze({
  trophy: '<svg class="gi" aria-hidden="true"><use href="#gi-trophy"/></svg>',
  star:   '<svg class="gi f" aria-hidden="true"><use href="#gi-star"/></svg>',
  hour:   '<svg class="gi" aria-hidden="true"><use href="#gi-hour"/></svg>',
  x:      '<svg class="gi" aria-hidden="true"><use href="#gi-x"/></svg>',
  check:  '<svg class="gi" aria-hidden="true"><use href="#gi-check"/></svg>',
});

// Player-typed words end up in innerHTML — escape them.
export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// A word rendered as a row of small wood tiles (same tile as the board rack).
// `tone` adds a bezel colour: 'ok' (green), 'bad' (red) or '' (cyan).
export function wordTilesHtml(word, tone = '') {
  const letters = [...String(word ?? '')];
  if (!letters.length) return '';
  const cls = tone ? ` is-${tone}` : '';
  return `<div class="bz-word">${letters.map(ch => `<span class="bz-tile is-sm${cls}">${escapeHtml(ch)}</span>`).join('')}</div>`;
}

// Shared result markup for every mini-game (glass tray, ringed medal, gold
// count-up points). `tone`: 'win' | 'soft' | 'bad' (defaults from `success`).
// `icon`: a RESULT_ICONS key (defaults: trophy on a win, hourglass otherwise).
// `extraHtml` is appended inside the tray (word tiles, word lists, …).
export function bonusResultHtml({
  success = true,
  tone = success ? 'win' : 'soft',
  icon = success ? 'trophy' : 'hour',
  headline = '',
  points = null,
  sub = '',
  extraHtml = '',
} = {}) {
  const pointsHtml = points != null
    ? `<div class="bz-result-pts"><b dir="ltr">${success ? '+' : ''}<span data-bz-count>0</span></b><small>נקודות</small></div>`
    : '';
  return `<div class="bz-result is-${tone}">`
    +   `<div class="bz-result-medal">${RESULT_ICONS[icon] ?? RESULT_ICONS.star}</div>`
    +   (headline ? `<div class="bz-result-headline">${headline}</div>` : '')
    +   pointsHtml
    +   (sub ? `<div class="bz-result-sub">${sub}</div>` : '')
    +   extraHtml
    + `</div>`;
}

// Render the result into `containerEl`. On success it fires a confetti burst
// on the surrounding card and counts the points up; on failure it shows a
// calm, encouraging message (no red error styling).
//
//   { success, tone, icon, headline, points, sub, extraHtml, cardEl, doc }
export function showBonusResult(containerEl, {
  success = true,
  tone,
  icon,
  headline = '',
  points = null,
  sub = '',
  extraHtml = '',
  cardEl = null,
  doc = globalThis.document,
} = {}) {
  if (!containerEl || !('innerHTML' in containerEl)) return;
  containerEl.innerHTML = bonusResultHtml({ success, tone, icon, headline, points, sub, extraHtml });
  const card = cardEl
    || containerEl.closest?.('.bz-card, .ovc')
    || containerEl;
  if (success) confettiBurst(card, { doc });
  startResultCount(containerEl, points, { success });
}

// Count the points up inside an already-rendered result (for games that build
// their markup with bonusResultHtml themselves).
export function startResultCount(containerEl, points, { success = Number(points) > 0 } = {}) {
  cueSfx(success ? 'mg.success' : 'mg.fail');
  if (points == null) return;
  countUp(containerEl?.querySelector?.('[data-bz-count]'), points, { durationMs: 650, tickSound: 'mg.count' });
}
