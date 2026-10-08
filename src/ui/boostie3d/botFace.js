// botFace — the bots' screen faces on the game scoreboard. The bot art (assets/avatars/bots,
// scripts/build-bot-stills.py) comes in two files per level: `_full` with the painted face and
// `_blank` with an empty screen. The scoreboard shows the blank one and this module draws the
// face over the screen as an SVG, so the face can change: it blinks now and then, smiles on a
// good move, goes wide-eyed on a boost. Only the face moves; the body stays still.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Screen rectangle as fractions of the 512 px still [x0, y0, x1, y1] (printed by the build
// script), the glow colour, and the face at rest — each bot keeps its personality.
export const BOT_FACES = Object.freeze({
  bot_easy:   { rect: [0.3023, 0.2863, 0.7035, 0.5424], color: '#b6f23a', rest: ['arc', 'grin'] },
  bot_medium: { rect: [0.3347, 0.2516, 0.6663, 0.4604], color: '#ffd21f', rest: ['round', 'smallsmile'] },
  bot_hard:   { rect: [0.3493, 0.2281, 0.6542, 0.4120], color: '#ff7a4d', rest: ['angry', 'frown'] },
});

export const EXPRESSIONS = Object.freeze(['rest', 'blink', 'happy', 'laugh', 'wow', 'stare', 'yawn', 'wink']);

// Game moment → expression (the 3D bots' mapping: good is happy, boost is wow).
export const MOMENT_FACE = Object.freeze({ turn: 'blink', good: 'happy', boost: 'wow' });

// viewBox 0 0 100 60. Eyes at x 27 / 73, y 24; mouth centred at x 50.
const EYES = {
  round:  '<circle cx="27" cy="24" r="9.5"/><circle cx="73" cy="24" r="9.5"/>',
  arc:    '<path d="M16 31Q27 13 38 31M62 31Q73 13 84 31" class="s"/>',
  closed: '<path d="M16 26H38M62 26H84" class="s"/>',
  angry:  '<path d="M13 15L40 27L35 36Q22 34 13 24Z"/><path d="M87 15L60 27L65 36Q78 34 87 24Z"/>',
  wide:   '<circle cx="27" cy="24" r="12.5"/><circle cx="73" cy="24" r="12.5"/><circle cx="27" cy="24" r="4.5" class="p"/><circle cx="73" cy="24" r="4.5" class="p"/>',
  wink:   '<circle cx="27" cy="24" r="9.5"/><path d="M62 26H84" class="s"/>',
};
const MOUTHS = {
  grin:       '<path d="M30 40H70Q67 57 50 57Q33 57 30 40Z"/>',
  smile:      '<path d="M36 44Q50 56 64 44" class="s"/>',
  smallsmile: '<path d="M41 46Q50 53 59 46" class="s"/>',
  o:          '<ellipse cx="50" cy="47" rx="7" ry="9"/>',
  flat:       '<path d="M39 48H61" class="s"/>',
  frown:      '<path d="M35 54Q50 40 65 54" class="s"/>',
  yawn:       '<ellipse cx="50" cy="46" rx="10" ry="12"/>',
};

// [eyes, mouth] for a bot level and an expression.
export function faceParts(level, expr) {
  const cfg = BOT_FACES[level];
  if (!cfg) return null;
  const [eyes, mouth] = cfg.rest;
  const angry = eyes === 'angry';
  switch (expr) {
    case 'blink': return ['closed', mouth];
    case 'happy': return angry ? ['angry', 'smallsmile'] : ['arc', 'grin'];
    case 'laugh': return angry ? ['closed', 'grin'] : ['arc', 'grin'];
    case 'wow':   return ['wide', 'o'];
    case 'stare': return ['wide', 'flat'];
    case 'yawn':  return ['closed', 'yawn'];
    case 'wink':  return angry ? ['angry', 'smallsmile'] : ['wink', mouth === 'grin' ? 'grin' : 'smile'];
    default:      return [eyes, mouth];
  }
}

// The SVG markup (one string per bot and expression; pure, so it is testable and cacheable).
export function faceSvg(level, expr = 'rest') {
  const parts = faceParts(level, expr);
  if (!parts) return '';
  const [eyes, mouth] = parts;
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`
    + `<g fill="currentColor" stroke="currentColor">`
    + `<style>.s{fill:none;stroke-width:7.5;stroke-linecap:round}.p{fill:#04101a;stroke:none}g>*:not(.s){stroke:none}</style>`
    + `${EYES[eyes] ?? ''}${MOUTHS[mouth] ?? ''}</g></svg>`;
}

const INSET = 0.07;   // keep the face inside the glass

export function screenBox(level) {
  const cfg = BOT_FACES[level];
  if (!cfg) return null;
  const [x0, y0, x1, y1] = cfg.rect;
  const dx = (x1 - x0) * INSET, dy = (y1 - y0) * INSET;
  return { left: x0 + dx, top: y0 + dy, width: x1 - x0 - 2 * dx, height: y1 - y0 - 2 * dy };
}

const pct = (v) => `${(v * 100).toFixed(2)}%`;

// Faces for the scoreboard's slots. hostOf(slot) → the slot element (looked up each time).
export function createBotFaces({ hostOf, prefersReducedMotion = () => false, rand = Math.random, timers = globalThis } = {}) {
  const slots = [null, null];       // per slot: { level, el, expr, blinkT, holdT }
  let disposed = false;

  function clearTimers(s) { timers.clearTimeout(s.blinkT); timers.clearTimeout(s.holdT); s.blinkT = s.holdT = 0; }

  function paint(s, expr) {
    s.expr = expr;
    s.el.firstElementChild.innerHTML = faceSvg(s.level, expr);
  }

  function scheduleBlink(s) {
    if (disposed || prefersReducedMotion()) return;
    s.blinkT = timers.setTimeout(() => {
      if (disposed || slots.indexOf(s) < 0) return;
      if (s.expr === 'rest') {
        paint(s, 'blink');
        s.holdT = timers.setTimeout(() => { if (s.expr === 'blink') paint(s, 'rest'); }, 140);
      }
      scheduleBlink(s);
    }, 2200 + rand() * 3600);
  }

  const api = {
    // Call after every identity render: puts the face over a bot's blank screen (the host
    // innerHTML is rewritten when the avatar changes) and removes it for anyone else.
    sync(values) {
      [0, 1].forEach((slot) => {
        const host = hostOf(slot);
        const level = BOT_FACES[values?.[slot]] ? values[slot] : null;
        let s = slots[slot];
        if (s && (!level || s.level !== level || !host || !host.contains?.(s.el))) {
          clearTimers(s);
          s.el?.remove?.();
          slots[slot] = s = null;
        }
        if (!level || !host || s) return;
        const doc = host.ownerDocument;
        const el = doc.createElement('span');
        el.className = 'bot-face';
        el.setAttribute('aria-hidden', 'true');
        const box = screenBox(level);
        const inner = doc.createElement('span');
        inner.className = 'bot-face-screen';
        inner.style.cssText = `left:${pct(box.left)};top:${pct(box.top)};width:${pct(box.width)};height:${pct(box.height)};color:${BOT_FACES[level].color}`;
        el.append(inner);
        host.append(el);
        s = { level, el, expr: 'rest', blinkT: 0, holdT: 0 };
        slots[slot] = s;
        paint(s, 'rest');
        scheduleBlink(s);
      });
    },
    // A game moment (turn / good / boost) or an expression name; false when that slot has no bot face.
    react(slot, kind, holdMs = 1100) {
      const s = slots[slot];
      if (!s || disposed) return false;
      const expr = MOMENT_FACE[kind] ?? (EXPRESSIONS.includes(kind) ? kind : null);
      if (!expr) return false;
      clearTimers(s);
      paint(s, expr);
      s.holdT = timers.setTimeout(() => { paint(s, 'rest'); scheduleBlink(s); }, expr === 'blink' ? 160 : holdMs);
      return true;
    },
    has(slot) { return !!slots[slot]; },
    dispose() {
      disposed = true;
      for (const s of slots) if (s) { clearTimers(s); s.el?.remove?.(); }
      slots[0] = slots[1] = null;
    },
  };
  return api;
}
