#!/usr/bin/env node
// Build an app-skin stylesheet: node scripts/build-skin-css.mjs [skinId]
//
// A skin is a light/dark re-colour of the whole app that a player can buy
// (see src/game/account/skinCatalog.js). Hand-overriding ~11k lines of dark
// "electric blue" CSS would rot every time a screen changes, so this script
// re-colours it mechanically:
//
//   1. Parse styles.css → menu-electric.css → screens-glass.css (load order).
//   2. For every declaration that carries a colour (background, color, border,
//      box-shadow, filter, fill/stroke, …) map each colour through the skin's
//      palette function, chosen by what the colour is *for* (text / surface /
//      line / shadow).
//   3. Emit only the changed declarations, each selector prefixed with
//      html[data-skin="<id>"] — so every override beats its own source rule and
//      the original cascade order between rules is preserved. Same !important.
//      Keyframes that change are re-emitted as "<name>--<id>" and the
//      animations that use them are pointed at the copies.
//   4. Append the hand-tuned layer skins/<id>-overrides.css (tokens, screen
//      backgrounds, board, tiles, logo, decor, new skin UI) which wins last.
//
// Output: skin-<id>.css at the repo root (linked from index.html). Re-run after
// editing any of the source stylesheets or the overrides file.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = ['styles.css', 'menu-electric.css', 'screens-glass.css'];

// ── colour parsing ──────────────────────────────────────────────────────────
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

function parseColor(s) {
  if (NAMED[s.toLowerCase?.()]) return [...NAMED[s.toLowerCase()]];
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const m = s.match(/rgba?\(([^)]*)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.some((p) => p.includes('var'))) return null;
  const v = parts.map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)));
  if (v.slice(0, 3).some(Number.isNaN)) return null;
  return [v[0], v[1], v[2], parts.length > 3 ? v[3] : 1];
}

function fmt([r, g, b, a]) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const al = Math.max(0, Math.min(1, Math.round(a * 1000) / 1000));
  if (al >= 1) return '#' + [r, g, b].map((x) => c(x).toString(16).padStart(2, '0')).join('');
  return `rgba(${c(r)},${c(g)},${c(b)},${String(al).replace(/^0\./, '.')})`;
}

function hsl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2, chroma = max - min;
  let h = 0;
  if (chroma) {
    if (max === R) h = ((G - B) / chroma) % 6;
    else if (max === G) h = (B - R) / chroma + 2;
    else h = (R - G) / chroma + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, l, chroma };
}

/** What a colour *is* in the dark theme. */
function classify(c) {
  const { h, l, chroma } = hsl(c);
  if (chroma < 0.12) return l > 0.6 ? 'light' : l < 0.35 ? 'dark' : 'grey';
  if (l > 0.82) return h >= 165 && h < 260 ? 'light' : 'tint';           // bluish whites read as "white"
  if (l < 0.3) return 'dark';
  if (h >= 165 && h < 250) return 'cyan';
  if (h >= 250 && h < 320) return 'purple';
  if (h >= 320 || h < 18) return 'red';
  if (h < 70) return l < 0.42 ? 'brown' : 'gold';
  return 'green';
}

// ── the Jerusalem Stone palette ─────────────────────────────────────────────
const rgba = (hex, a) => { const c = parseColor(hex); c[3] = a; return c; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const STONE_BG = 'radial-gradient(circle at 82% 12%, rgba(255,214,140,.55), transparent 28%), '
  + 'radial-gradient(ellipse 90% 40% at 50% 0, rgba(255,255,255,.7), transparent 70%), '
  + 'linear-gradient(180deg, #f8f2e6, #efe5d2 60%, #e6d8bf)';

const STONE = {
  // Whole-value swaps, tried before the per-colour map: the navy full-screen
  // gradient (every screen + full-screen sheets) becomes the limestone one.
  replace: [
    { props: /^background(-image)?$/, test: /#07123d[\s\S]*#03081[0-9a-f]|#07123d[\s\S]*#040a22/i, value: STONE_BG },
    // the navy board-cell gradient (board, mini-game cells, answer slots) → sand cell
    { props: /^(background(-image)?|--bz-cell)$/, test: /^linear-gradient\(180deg, #22438c, #1b3778\)$/i, value: '#eadfc8' },
  ],
  ink: '#2a2118', p1: '#12607a', p1lite: '#1b7f9e', p1deep: '#0f4f66', p2: '#a8480f',
  gold: '#e0a030', goldLine: '#c9962a', ok: '#1f8a52', bad: '#c0283c', purple: '#7a3fc0',
  map(c, mode) {
    const a = c[3], k = classify(c);
    const tint = (hex, f) => rgba(hex, clamp(a * f, 0.04, 1));
    switch (mode) {
      case 'text':
        if (k === 'light' || k === 'grey') return rgba(this.ink, a >= 1 ? 1 : clamp(a * 1.1 + 0.04, 0, 1));
        if (k === 'dark') { const { h } = hsl(c); return h >= 180 && h < 260 ? rgba('#ffffff', a) : null; }
        if (k === 'cyan' || (k === 'tint' && hsl(c).h >= 165 && hsl(c).h < 250)) return rgba(this.p1, a);
        if (k === 'gold' || (k === 'tint' && hsl(c).h < 70)) return rgba(this.p2, a);
        if (k === 'green' || k === 'tint' && hsl(c).h < 165) return rgba(this.ok, a);
        if (k === 'red' || k === 'tint') return rgba(this.bad, a);
        if (k === 'purple') return rgba(this.purple, a);
        if (k === 'brown') return rgba(this.ink, a);            // wood-tile letters → ink on limestone
        return null;
      case 'bg':
        if (k === 'light') return a >= 0.3 ? null : rgba('#ffffff', clamp(0.4 + a * 2.5, 0.45, 0.85));
        if (k === 'dark' || k === 'grey') {
          if (hsl(c).chroma < 0.05 && a < 0.6) return rgba('#78603c', clamp(a * 0.35, 0.05, 0.22)); // black recess → sand
          return a >= 0.9 ? rgba('#fffaf0', 1) : rgba('#fffcf5', clamp(a + 0.1, 0.82, 0.94));
        }
        if (k === 'cyan') return a < 0.5 ? tint(this.p1, 0.8) : rgba(hsl(c).l > 0.55 ? this.p1lite : this.p1deep, a);
        if (k === 'gold') return a < 0.5 ? tint(this.gold, 1.2) : null;
        if (k === 'brown') return null;
        return a < 0.5 ? rgba(fmt([c[0], c[1], c[2], 1]), clamp(a * 1.2, 0.05, 1)) : null;
      case 'line':
        if (k === 'light' || k === 'grey') return a >= 0.8 ? rgba(this.p1, 1) : rgba('#785a32', clamp(a * 1.1, 0.12, 0.3));
        if (k === 'dark') return rgba('#785a32', 0.25);
        if (k === 'cyan') return a < 0.35 ? rgba('#785a32', clamp(a, 0.14, 0.24)) : rgba(this.p1, clamp(a * 1.1, 0, 1));
        if (k === 'gold') return rgba(this.goldLine, clamp(a * 1.2, 0, 1));
        if (k === 'green') return rgba(this.ok, a);
        if (k === 'red') return rgba(this.bad, a);
        return null;
      case 'shadow':
        if (k === 'dark' || k === 'grey') return a >= 0.85 && hsl(c).chroma > 0.05 ? rgba('#b9a47c', 1) : rgba('#5a3c14', clamp(a * 0.35, 0.05, 0.22));
        if (k === 'light') return null;
        if (k === 'cyan') return a >= 0.8 ? rgba(this.p1, 1) : rgba(this.p1, clamp(a * 0.5, 0.05, 0.4));
        if (k === 'gold') return a >= 0.8 ? rgba(this.goldLine, 1) : rgba(this.gold, clamp(a * 0.6, 0.05, 0.45));
        if (k === 'brown') return null;
        return rgba(fmt([c[0], c[1], c[2], 1]), a >= 0.8 ? a : clamp(a * 0.5, 0.04, 0.4));
      default: return null;
    }
  },
};
// ── the Midnight Marble palette (dark → dark) ───────────────────────────────
// Classic's navy becomes neutral charcoal at the same lightness, cyan (me /
// primary) becomes gold, gold (opponent / reward) becomes pearl blue, and glows
// are toned down to soft gold — no neon.
const MARBLE_BG = 'radial-gradient(circle at 82% 12%, rgba(216,178,90,.16), transparent 30%), '
  + 'radial-gradient(ellipse 90% 40% at 50% 0, rgba(255,255,255,.06), transparent 70%), '
  + 'linear-gradient(180deg, #19191d, #0f0f12 60%, #08080a)';

const charcoal = (c, a = c[3]) => {
  const v = clamp(hsl(c).l * 255 * 0.95, 6, 70);
  return [v, v, v + 4, a];
};

const MARBLE = {
  replace: [
    { props: /^background(-image)?$/, test: /#07123d[\s\S]*#03081[0-9a-f]|#07123d[\s\S]*#040a22/i, value: MARBLE_BG },
    { props: /^(background(-image)?|--bz-cell)$/, test: /^linear-gradient\(180deg, #22438c, #1b3778\)$/i, value: '#2a2a30' },
  ],
  ink: '#f3eee3', p1: '#d8b25a', p1lite: '#ecca72', p1deep: '#bb913f', p2: '#9fb8dc',
  ok: '#5fbf8a', bad: '#ff6b6b', purple: '#b48cff', onGold: '#1a1408',
  map(c, mode) {
    const a = c[3], k = classify(c), { h } = hsl(c);
    switch (mode) {
      case 'text':
        if (k === 'light' || k === 'grey') return rgba(this.ink, a);
        if (k === 'dark') return h >= 180 && h < 260 ? rgba(this.onGold, a) : null;
        if (k === 'cyan' || (k === 'tint' && h >= 165 && h < 250)) return rgba(this.p1, a);
        if (k === 'gold' || (k === 'tint' && h < 70)) return rgba(this.p2, a);
        if (k === 'green' || (k === 'tint' && h < 165)) return rgba(this.ok, a);
        if (k === 'red' || k === 'tint') return rgba(this.bad, a);
        if (k === 'purple') return rgba(this.purple, a);
        if (k === 'brown') return rgba(this.p1, a);              // wood-tile letters → gold leaf
        return null;
      case 'bg':
        if (k === 'dark' || k === 'grey') return charcoal(c);
        if (k === 'light') return a >= 0.5 ? null : rgba('#ffffff', clamp(a * 0.6, 0.02, 0.1));
        if (k === 'cyan') return a < 0.5 ? rgba(this.p1, clamp(a * 0.7, 0.04, 0.3)) : rgba(hsl(c).l > 0.55 ? this.p1lite : this.p1deep, a);
        if (k === 'purple') return a < 0.5 ? rgba(this.purple, a * 0.7) : null;
        return null;                                             // gold stays gold, reds/greens stay
      case 'line':
        if (k === 'light' || k === 'grey') return a >= 0.8 ? rgba(this.p1, 1) : rgba(this.p1, clamp(a * 0.9, 0.1, 0.3));
        if (k === 'dark') return rgba('#000000', clamp(a, 0.3, 0.6));
        if (k === 'cyan') return rgba(this.p1, a < 0.35 ? clamp(a, 0.14, 0.28) : clamp(a * 0.9, 0, 1));
        if (k === 'gold') return rgba(this.p2, a);
        if (k === 'green') return rgba(this.ok, a);
        if (k === 'red') return rgba(this.bad, a);
        if (k === 'purple') return rgba(this.purple, a);
        return null;
      case 'shadow':
        if (k === 'dark' || k === 'grey') return a >= 0.85 && hsl(c).chroma > 0.05 ? rgba('#000000', 1) : charcoal(c, a);
        if (k === 'light') return rgba('#ffffff', clamp(a * 0.4, 0.02, 0.2));
        if (k === 'cyan') return a >= 0.8 ? rgba(this.p1deep, 1) : rgba(this.p1, clamp(a * 0.45, 0.04, 0.3));
        if (k === 'gold') return a >= 0.8 ? rgba(this.p1deep, 1) : rgba(this.p1, clamp(a * 0.5, 0.04, 0.3));
        if (k === 'purple') return rgba(this.purple, clamp(a * 0.5, 0.04, 0.3));
        return null;
      default: return null;
    }
  },
};
const SKINS = { stone: STONE, marble: MARBLE };

// ── value rewriting ─────────────────────────────────────────────────────────
function modeFor(prop) {
  if (prop === 'color' || prop === '-webkit-text-fill-color' || prop === 'caret-color' || prop === 'fill'
    || prop === 'stroke' || prop === 'text-decoration-color' || prop === 'accent-color') return 'text';
  if (prop.startsWith('background')) return 'bg';
  if (prop.startsWith('border') || prop.startsWith('outline') || prop === 'column-rule') return 'line';
  if (prop === 'box-shadow' || prop === 'text-shadow' || prop === 'filter' || prop === '-webkit-filter') return 'shadow';
  if (prop.startsWith('--')) return 'custom';
  return null;
}

function customMode(prop, value) {
  // Custom properties: guess by the token's name, else by the colour itself.
  if (/(ink|text|fg|dim|faint|col)\b/.test(prop)) return 'text';
  if (/(line|border|rc)\b/.test(prop)) return 'line';
  if (/(glass|bg|panel|surface|fill)\b/.test(prop)) return 'bg';
  return /gradient/.test(value) ? 'bg' : 'text';
}

function remapValue(value, mode, skin) {
  // never touch colours inside url(...)
  const parts = value.split(/(url\([^)]*\))/);
  let changed = false;
  const out = parts.map((seg) => {
    if (seg.startsWith('url(')) return seg;
    return seg.replace(COLOR_RE, (m) => {
      const c = parseColor(m);
      if (!c) return m;
      const n = skin.map(c, mode);
      if (!n) return m;
      const s = fmt(n);
      if (s.toLowerCase() !== m.toLowerCase()) changed = true;
      return s;
    });
  }).join('');
  return changed ? out : null;
}

// ── a tiny CSS parser (enough for these hand-written sheets) ────────────────
function stripComments(css) {
  // /* skin:keep-start */ … /* skin:keep-end */ fences rules that keep their own
  // colours under every skin (the try-on bar, the store's per-skin preview art).
  return css.replace(/\/\*\s*skin:keep-start[\s\S]*?skin:keep-end\s*\*\//g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchBrace(css, open) {
  let depth = 0, q = null;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return i; }
  }
  return css.length;
}

/** → [{type:'rule', sel, body} | {type:'at', prelude, children} | {type:'keyframes', name, prelude, body}] */
function parseBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i), semi = css.indexOf(';', i);
    if (open < 0) break;
    if (semi >= 0 && semi < open && css.slice(i, semi).trim().startsWith('@')) { i = semi + 1; continue; }
    const prelude = css.slice(i, open).trim();
    const close = matchBrace(css, open);
    const body = css.slice(open + 1, close);
    if (/^@(-webkit-)?keyframes\b/.test(prelude)) out.push({ type: 'keyframes', prelude, name: prelude.split(/\s+/)[1], body });
    else if (/^@(media|supports|container|layer)\b/.test(prelude)) out.push({ type: 'at', prelude, children: parseBlocks(body) });
    else if (prelude.startsWith('@')) { /* @font-face, @page … — no colours worth skinning */ }
    else if (prelude) out.push({ type: 'rule', sel: prelude, body });
    i = close + 1;
  }
  return out;
}

function splitTop(s, sep) {
  const out = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === '\\') { cur += s[++i] ?? ''; } else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseDecls(body) {
  return splitTop(body, ';').map((d) => {
    const k = d.indexOf(':');
    if (k < 0) return null;
    const prop = d.slice(0, k).trim().toLowerCase();
    let value = d.slice(k + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    return prop ? { prop, value, important } : null;
  }).filter(Boolean);
}

function prefixSelector(sel, scope) {
  return splitTop(sel, ',').map((s) => {
    s = s.trim();
    if (s.startsWith(':root')) return scope + s.slice(5);
    if (/^html(?![\w-])/.test(s)) return scope + s.slice(4);
    return `${scope} ${s}`;
  }).join(',\n');
}

// ── build ───────────────────────────────────────────────────────────────────
function build(id) {
  const skin = SKINS[id];
  if (!skin) throw new Error(`unknown skin "${id}" (have: ${Object.keys(SKINS).join(', ')})`);
  const scope = `html[data-skin="${id}"]`;
  const renamed = new Set();
  const keyframesOut = [];
  let rules = 0, decls = 0;

  const remapDecls = (body, { inKeyframe = false } = {}) => parseDecls(body).map(({ prop, value, important }) => {
    let mode = modeFor(prop);
    if (mode === 'custom') mode = customMode(prop, value);
    const swap = skin.replace?.find((r) => r.props.test(prop) && r.test.test(value));
    let next = swap ? swap.value : mode ? remapValue(value, mode, skin) : null;
    if (prop === 'text-shadow' && !inKeyframe && value !== 'none') next = 'none';
    if (!inKeyframe && (prop === 'animation' || prop === 'animation-name')) {
      const re = new RegExp(`(^|[\\s,])(${[...renamed].map((n) => n.replace(/[-]/g, '\\-')).join('|') || '\\b\\B'})(?=$|[\\s,])`, 'g');
      const v = value.replace(re, (_, pre, name) => `${pre}${name}--${id}`);
      if (v !== value) next = v;
    }
    // A colour declaration that needs no change is still re-emitted (scoped), so a
    // later `color: var(--x)` keeps beating an earlier literal colour we did remap.
    if (next == null && mode && !inKeyframe) next = value;
    return next == null ? null : `  ${prop}: ${next}${important ? ' !important' : ''};`;
  }).filter(Boolean);

  // pass 1: keyframes (so animations can be re-pointed in pass 2)
  const files = SOURCES.map((f) => ({ f, blocks: parseBlocks(stripComments(readFileSync(resolve(ROOT, f), 'utf8'))) }));
  const walkKeyframes = (blocks) => blocks.forEach((b) => {
    if (b.type === 'at') walkKeyframes(b.children);
    if (b.type !== 'keyframes') return;
    const frames = parseBlocks(b.body).filter((r) => r.type === 'rule');
    let any = false;
    const txt = frames.map((fr) => {
      const all = parseDecls(fr.body).map(({ prop, value, important }) => {
        let mode = modeFor(prop);
        if (mode === 'custom') mode = customMode(prop, value);
        const next = mode ? remapValue(value, mode, skin) : null;
        if (next != null) any = true;
        return `${prop}: ${next ?? value}${important ? ' !important' : ''};`;
      });
      return `  ${fr.sel} { ${all.join(' ')} }`;
    }).join('\n');
    if (!any) return;
    renamed.add(b.name);
    keyframesOut.push(`${b.prelude.split(/\s+/)[0]} ${b.name}--${id} {\n${txt}\n}`);
  });
  files.forEach(({ blocks }) => walkKeyframes(blocks));

  // pass 2: rules
  const emit = (blocks, indent = '') => blocks.map((b) => {
    if (b.type === 'rule') {
      const lines = remapDecls(b.body);
      if (!lines.length) return '';
      rules++; decls += lines.length;
      return `${indent}${prefixSelector(b.sel, scope).replace(/\n/g, '\n' + indent)} {\n${lines.map((l) => indent + l).join('\n')}\n${indent}}`;
    }
    if (b.type === 'at') {
      const inner = emit(b.children, indent + '  ');
      return inner.trim() ? `${indent}${b.prelude} {\n${inner}\n${indent}}` : '';
    }
    return '';
  }).filter(Boolean).join('\n');

  const sections = files.map(({ f, blocks }) => `/* ── generated from ${f} ── */\n${emit(blocks)}`);
  const hand = readFileSync(resolve(ROOT, 'skins', `${id}-overrides.css`), 'utf8');
  const out = [
    `/* GENERATED by scripts/build-skin-css.mjs ${id} — do not edit by hand.`,
    `   Edit skins/${id}-overrides.css (hand-tuned layer, appended last) or the`,
    `   palette in the script, then re-run: node scripts/build-skin-css.mjs ${id} */`,
    ...sections,
    `/* ── re-coloured keyframes ── */\n${keyframesOut.join('\n')}`,
    `/* ══ hand-tuned layer: skins/${id}-overrides.css ══ */\n${hand}`,
  ].join('\n\n') + '\n';
  writeFileSync(resolve(ROOT, `skin-${id}.css`), out);
  console.log(`skin-${id}.css: ${rules} rules, ${decls} declarations, ${renamed.size} keyframes, ${(out.length / 1024).toFixed(0)} KB`);
}

export { parseColor, classify, remapValue, prefixSelector, STONE, MARBLE };

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^\/?/, '/')}` || process.argv[1]?.endsWith('build-skin-css.mjs')) {
  // node scripts/build-skin-css.mjs [id ...] — no ids = every skin
  const ids = process.argv.slice(2);
  (ids.length ? ids : Object.keys(SKINS)).forEach(build);
}
