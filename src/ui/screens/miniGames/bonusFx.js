// bonusFx — shared celebration helpers for the bonus mini-games.
//
//   confettiBurst(container)            — spawns gold/cyan particles
//   countUp(el, to, opts)               — animates a number 0 → to
//   showBonusResult(containerEl, opts)  — premium success/failure screen,
//                                         wiring confetti + count-up for you
//
// Everything is defensive: with no usable DOM (tests pass plain objects or
// nothing) each function is a no-op, so importing this never forces a browser.

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

export function countUp(el, to, { from = 0, durationMs = 650, prefix = '', suffix = '' } = {}) {
  if (!el) return;
  const target = Number(to) || 0;
  const start  = Number(from) || 0;
  const raf = globalThis.requestAnimationFrame;
  const setVal = (v) => { el.textContent = `${prefix}${v}${suffix}`; };
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

// Render a premium result screen into `containerEl`. On success it fires a
// confetti burst on the surrounding card and counts the points up; on failure
// it shows a calm, encouraging message (no red error styling).
//
//   { success, emoji, headline, points, sub, cardEl, doc }
export function showBonusResult(containerEl, {
  success = true,
  emoji = success ? '🎉' : '😌',
  headline = '',
  points = null,
  sub = '',
  cardEl = null,
  doc = globalThis.document,
} = {}) {
  if (!containerEl || !('innerHTML' in containerEl)) return;
  const pointsHtml = points != null
    ? `<div class="bz-result-big">${success ? '+' : ''}<span data-bz-count>0</span> נק'</div>`
    : '';
  containerEl.innerHTML =
    `<div class="bz-result ${success ? 'is-win' : 'is-soft'}">`
    +   `<div class="bz-result-emoji">${emoji}</div>`
    +   (headline ? `<div class="bz-result-headline">${headline}</div>` : '')
    +   pointsHtml
    +   (sub ? `<div class="bz-result-sub">${sub}</div>` : '')
    + `</div>`;
  const card = cardEl
    || containerEl.closest?.('.bz-card, .ovc')
    || containerEl;
  if (success) confettiBurst(card, { doc });
  if (points != null) {
    countUp(containerEl.querySelector?.('[data-bz-count]'), points, { durationMs: 650 });
  }
}
