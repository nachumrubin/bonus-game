// wheelMiniGame — B13 wheel-of-fortune.
//
// The pure WHEEL_OUTCOMES table lives in bonusTileDefs.js; this module
// just adds:
//   - pickOutcome(rng, weights) — pure outcome selector
//   - mountWheelMiniGame({ bus, ... }) — DOM-mounted spin animation
//
// Each outcome is equally likely by default; callers can pass `weights`
// to favor cheap outcomes if balance tweaks are needed in the future.

import { WHEEL_OUTCOMES } from '../../../game/boosts/bonusTileDefs.js';
import { g, getGender } from '../../genderText.js';

export const WHEEL_INTENT = Object.freeze({
  RESULT: 'wheel/result',
});

export function listOutcomes() {
  return WHEEL_OUTCOMES.slice();
}

export function pickOutcome(rng = Math.random, weights = null) {
  const outcomes = WHEEL_OUTCOMES;
  if (!weights) {
    return outcomes[Math.floor(rng() * outcomes.length)];
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < outcomes.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return outcomes[i];
  }
  return outcomes[outcomes.length - 1];
}

// Map outcome.id → display label (used by the spin-result toast and the
// debug surface). Falls back to the outcome.label or the id itself.
export function labelFor(outcome) {
  if (!outcome) return '';
  if (outcome.label) return outcome.label;
  switch (outcome.id) {
    case 'extra_turn':   return 'תור נוסף 🎯';
    case 'double_2':     return 'הכפלה כפולה ×2';
    case 'timer_bonus':  return '+10 שניות ⏱';
    case 'skip_turn':    return 'דילוג על תור היריב 🚫';
    case 'tile_swap':    return 'החלפת אות חינם 🔄';
    case 'cancel_boost': return 'ביטול בוסט יריב 🛡';
    default: return outcome.id;
  }
}

// Short label that fits on the wheel slot. Matches the legacy buildWheel
// labels at HEAD:index.html:6190.
export function slotLabelFor(outcome) {
  if (!outcome) return '';
  switch (outcome.id) {
    case 'pts_50':       return '50 נקודות';
    case 'pts_1':        return '1 נקודה';
    case 'extra_turn':   return 'תור נוסף';
    case 'double_2':     return 'כפל ×2';
    case 'timer_bonus':  return '+10 שניות';
    case 'skip_turn':    return 'פספוס';
    case 'tile_swap':    return 'החלפת אות';
    case 'cancel_boost': return 'ביטול בוסט';
    default: return outcome.label ?? outcome.id;
  }
}

// Emoji icon per outcome — paired with the text label so each wheel slot
// shows what it pays out at a glance. Mirrors the legacy icon set
// (HEAD:index.html:6190 — ⭐ for +50, 🪙 for +1, ❌ for skip-turn, etc.).
export function slotIconFor(outcome) {
  if (!outcome) return '';
  switch (outcome.id) {
    case 'pts_50':       return '⭐';
    case 'pts_1':        return '🪙';
    case 'extra_turn':   return '🎯';
    case 'double_2':     return '✨';
    case 'timer_bonus':  return '⏱';
    case 'skip_turn':    return '❌';
    case 'tile_swap':    return '🔄';
    case 'cancel_boost': return '🛡';
    default: return '⚡';
  }
}

// Mount the wheel UI. The animation is best-effort CSS — tests pass
// `doc: null` to get a stub that resolves immediately on `spin()`.
//
// `onResult({ outcomeId })` is invoked when the wheel stops; the bus
// also emits WHEEL_INTENT.RESULT so observers (animation controller,
// notifications) can hook in.
export function mountWheelMiniGame({
  bus,
  rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
  spinDurationMs = 3500,
} = {}) {
  if (!bus) throw new Error('mountWheelMiniGame: bus required');

  const chosen = pickOutcome(rng);
  let resolved = false;

  function finish() {
    if (resolved) return;
    resolved = true;
    bus.emit(WHEEL_INTENT.RESULT, { outcomeId: chosen.id, label: labelFor(chosen) });
    onResult({ outcomeId: chosen.id, label: labelFor(chosen) });
    try { host?.remove?.(); } catch {}
  }

  if (!doc?.createElement) {
    return {
      unmount: finish,
      spin: finish,
      _chosen: chosen,
    };
  }

  // ── DOM mount ──
  // Premium chrome (overlay, card, buttons, wheel rim/hub/pointer) lives in
  // the .bz-* classes in menu-electric.css; only the dynamic bits — the
  // conic-gradient segments and the final rotation — stay inline here.
  const host = doc.createElement('div');
  host.className = 'spine-wheel-overlay bz-overlay';

  const targetIdx = WHEEL_OUTCOMES.findIndex(o => o.id === chosen.id);
  const segCount = WHEEL_OUTCOMES.length;
  const segDeg   = 360 / segCount;
  // 5 full turns + land on the chosen segment.
  const finalRotation = 360 * 5 + (segCount - targetIdx) * segDeg - segDeg / 2;

  // Legacy palette — saturated, slightly muted segment colours that read
  // better against white-on-dark text. Mirrors COLORS in legacy
  // buildWheelOfFortune (HEAD:index.html:6199).
  const SEG_COLORS = ['#c0392b', '#d35400', '#b8860b', '#1e8449', '#1a7a6e', '#2471a3', '#7d3c98', '#1a5276'];
  const conicStops = WHEEL_OUTCOMES.map((_, i) => {
    const start = i * segDeg;
    const end = (i + 1) * segDeg;
    return `${SEG_COLORS[i % SEG_COLORS.length]} ${start}deg ${end}deg`;
  }).join(', ');

  // Prize icon + label centered in each slot. The whole unit is rotated
  // to its slot's centre angle, then the inner text wrap is
  // counter-rotated 180° so the icon sits above the label and both read
  // upright when the wheel stops on a top-aligned slot.
  const labelHtml = WHEEL_OUTCOMES.map((o, i) => {
    const centerDeg = i * segDeg + segDeg / 2;
    const icon = slotIconFor(o);
    const text = slotLabelFor(o);
    return `<div style="position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;
       transform:rotate(${centerDeg}deg);pointer-events:none;">
      <div style="margin-top:18px;transform:rotate(180deg);display:flex;flex-direction:column;align-items:center;
        gap:2px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);">
        <div style="font-size:20px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));">${icon}</div>
        <div style="font-size:10px;font-weight:800;white-space:nowrap;letter-spacing:-.2px;">${text}</div>
      </div>
    </div>`;
  }).join('');

  host.innerHTML = `
    <div class="bz-card">
      <div class="bz-burst" data-wheel="burst"></div>
      <div class="bz-bolt">🎡</div>
      <div class="bz-title">גלגל המזל!</div>
      <div class="bz-sub" id="spine-wheel-press-hint"></div>
      <div class="bz-wheel-wrap">
        <div class="bz-wheel-rim"></div>
        <div data-wheel="dial" class="bz-wheel" style="background:conic-gradient(${conicStops});
             transition:transform ${spinDurationMs}ms cubic-bezier(0.18, 0.89, 0.32, 1.27);">
          ${labelHtml}
        </div>
        <div class="bz-wheel-gloss"></div>
        <div data-wheel="hub" class="bz-wheel-hub">▶</div>
        <div class="bz-wheel-pointer"></div>
      </div>
      <div data-wheel="result" class="bz-wheel-result"></div>
      <button data-wheel="spin" class="bz-btn bz-btn-gold"></button>
    </div>`;

  doc.body?.appendChild(host);

  const spinBtn  = host.querySelector('[data-wheel="spin"]');
  const dial     = host.querySelector('[data-wheel="dial"]');
  const hub      = host.querySelector('[data-wheel="hub"]');
  const out      = host.querySelector('[data-wheel="result"]');
  const burst    = host.querySelector('[data-wheel="burst"]');
  const pressHint = host.querySelector('#spine-wheel-press-hint');
  if (spinBtn)   spinBtn.textContent   = g('spinBtn', getGender());
  if (pressHint) pressHint.textContent = g('pressWheel', getGender());
  let spinning = false;

  function doSpin() {
    if (spinning) return;
    spinning = true;
    if (spinBtn) spinBtn.disabled = true;
    if (dial) dial.style.transform = `rotate(${finalRotation}deg)`;
    // Online spectator: tell the opponent the wheel is spinning. The wheel
    // is event-driven (no per-second tick), so a single emit at spin-start
    // and another at result is enough to keep the spectator label fresh.
    try {
      bus?.emit?.('liveBonus/progress', {
        secsLeft: Math.ceil(spinDurationMs / 1000),
        label: 'גלגל המזל מסתובב',
      });
    } catch { /* swallow */ }
    setTimeout(() => {
      if (out) out.textContent = labelFor(chosen);
      if (hub) hub.textContent = '✓';
      // Reward "explosion" — gold bloom over the card the moment it lands.
      if (burst) burst.classList.add('is-on');
      try {
        bus?.emit?.('liveBonus/progress', { secsLeft: 0, label: labelFor(chosen) });
      } catch { /* swallow */ }
      setTimeout(finish, 1200); // tiny pause so the user reads the result
    }, spinDurationMs);
  }

  // Clicking the dial spins too — matches the legacy "click the wheel" feel.
  dial?.addEventListener('click', doSpin);
  spinBtn?.addEventListener('click', doSpin);

  return {
    unmount: finish,
    spin:    () => { doSpin(); /* test convenience */ },
    _chosen: chosen,
  };
}

// Convenience for main.js: bridge the result back through the
// bonusActivationController.
export function playWheelForBonus({ bus, controller, rng }) {
  return mountWheelMiniGame({
    bus, rng,
    onResult: ({ outcomeId }) => controller?.resolveWheel?.({ outcomeId }),
  });
}
