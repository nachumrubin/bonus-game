// Build sequences — DOM runner for the home build (cold launch) and the board
// build (game start). Timings/ordering: src/ui/buildTimeline.js. Keyframes:
// styles.css (§1c). Contract: docs-md/BOOST_MOTION_SPEC.md §16.
//
// Each run tags elements with a build class plus `--b-delay` / `--b-dur`
// (and a few extras), schedules its sound cues, and removes everything with
// ONE cleanup timer. Any pointerdown finishes the run instantly — the tap is
// NOT swallowed, so a player who taps a tile or a menu card mid-build gets
// both the finished screen and their action. Reduced motion: no build at all.

import {
  HOME_BUILD, BOARD_BUILD, RACK_SLOTS, homeBuildTotal, boardBuildTotal,
  diagonalRank, clockwiseOrder, leftToRightOrder,
  LOGO_TILE_EXITS, LOADING_EXIT, logoTilesTimes,
} from './buildTimeline.js';
import { LOGO_TILE_LAYERS } from './logoTilesLayout.js';
import { EV } from '../events/eventTypes.js';

// Per-tile logo layers rendered from the logo's Blender shot
// ("Blender designs/logo/render_logo_tiles.py"); LOGO_TILE_LAYERS places them
// over boost-logo.webp pixel-for-pixel.
const LOGO_TILES_DIR = 'assets/ui/logo_tiles/';
// Stacking front-to-back as in the Blender scene: ס, ו, ט, ב.
const LOGO_TILE_Z = Object.freeze({ bet: 1, tet: 2, vav: 3, sam: 4, samL: 4, samR: 4, bolt: 5 });
// Tiles whose final render carries a neighbour's shadow: they fly as `_bare`
// and the shadowed render fades in once every tile has landed.
const LOGO_SHADED = Object.freeze(['bet', 'vav', 'tet']);
// How far off-screen a tile starts / ends (along its exit direction).
const OFFSCREEN_VMAX = 95;

export function logoTileFiles() {
  return [
    ...Object.keys(LOGO_TILE_LAYERS).map(k => `logo_${k}.webp`),
    ...LOGO_SHADED.map(k => `logo_${k}_bare.webp`),
  ].map(f => LOGO_TILES_DIR + f);
}

// Warm the cache while the boot loader is up, so the tiles are decoded by the
// time home builds its logo.
export function preloadLogoTiles({ ImageCtor = globalThis.Image } = {}) {
  if (typeof ImageCtor !== 'function') return;
  for (const src of logoTileFiles()) {
    try { const im = new ImageCtor(); im.decoding = 'async'; im.src = src; } catch { /* swallow */ }
  }
}

function unitExit(key) {
  const v = LOGO_TILE_EXITS[key];
  if (!v) return null;
  const n = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / n, y: v.y / n, spin: v.spin };
}

// ── Boot loader exit ───────────────────────────────────────────────────
// The loader's tiles (`.app-loading-tile[data-tile]`) fly off the screen, each
// in its own direction (LOGO_TILE_EXITS); home's logo build brings them back
// from the same sides. Returns how long the caller should wait before lifting
// the loader (0 = no exit animation: reduced motion, no tiles, no WAAPI).
export function flyOutLoadingTiles({ doc = globalThis.document, root, reducedMotion } = {}) {
  if (!root || reducedFrom(reducedMotion, doc)) return 0;
  const tiles = Array.from(root.querySelectorAll?.('.app-loading-tile[data-tile]') ?? []);
  if (!tiles.length || tiles.some(t => typeof t.animate !== 'function')) return 0;
  const win = doc?.defaultView ?? globalThis;
  const reach = Math.hypot(win.innerWidth || 400, win.innerHeight || 800);
  const E = LOADING_EXIT;
  // Snapshot where each tile is in its loop before the loop is stopped, so a
  // tile caught mid-drop or mid-fade snaps back to rest rather than jumping.
  const from = tiles.map((t) => {
    const cs = win.getComputedStyle?.(t);
    return { transform: cs?.transform || 'none', opacity: cs?.opacity ?? '1' };
  });
  root.classList?.add?.('is-exiting');
  let longest = 0;
  tiles.forEach((t, i) => {
    const v = unitExit(t.dataset?.tile);
    if (!v) return;
    const delay = i * E.stagger;
    longest = Math.max(longest, delay + E.dur);
    t.animate([
      { transform: from[i].transform, opacity: from[i].opacity, easing: 'ease-out' },
      { transform: 'none', opacity: 1, offset: E.settle, easing: 'cubic-bezier(.55,0,.8,.3)' },
      { transform: `translate(${Math.round(v.x * reach)}px, ${Math.round(v.y * reach)}px) rotate(${v.spin * 3}deg)`, opacity: 1 },
    ], { duration: E.dur, delay, fill: 'both' });
  });
  return longest;
}

export const BOARD_INTRO_STARTED = 'game/intro-started';
export const BOARD_INTRO_FINISHED = 'game/intro-finished';

const runs = { home: null, board: null };

// Gameplay always wins over the build: any of these finishes it at once, so a
// move (an online opponent's, a scripted one, a fresh GAME_STARTED) is never
// masked by a cell still unfolding.
const BOARD_YIELD_EVENTS = Object.freeze([
  EV.GAME_STARTED, EV.MOVE_CONFIRMED, EV.MOVE_SCORE_COMMITTED, EV.OPPONENT_MOVED,
  EV.TURN_CHANGED, EV.TILES_EXCHANGED, EV.LOCK_PLACED, EV.BOOST_ACTIVATED,
  EV.GAME_COMPLETED, EV.INVALID_MOVE_REJECTED, EV.LIVE_PREVIEW_CHANGED,
]);

function isShown(el) {
  if (!el) return false;
  if (el.style?.display === 'none') return false;
  if (typeof el.getClientRects === 'function') return el.getClientRects().length > 0;
  return true;
}

function centerOf(el) {
  const r = el?.getBoundingClientRect?.();
  if (!r || (!r.width && !r.height)) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function createRun({ doc, cue, setTimeoutFn, clearTimeoutFn, onFinish }) {
  const tagged = [];
  const timers = [];
  const unsubs = [];
  const adopted = [];   // nodes the run created; removed when it finishes
  let done = false;
  let listener = null;

  function tag(el, cls, vars = {}) {
    if (!el) return;
    for (const [k, v] of Object.entries(vars)) el.style?.setProperty?.(k, typeof v === 'number' ? `${Math.round(v)}ms` : String(v));
    el.classList?.add?.(cls);
    tagged.push({ el, cls, vars: Object.keys(vars) });
  }
  function sound(id, at, opts) {
    if (typeof cue !== 'function') return;
    const fire = () => { try { cue(id, opts); } catch { /* swallow */ } };
    if (at <= 0) fire();
    else timers.push(setTimeoutFn(fire, at));
  }
  function finish() {
    if (done) return;
    done = true;
    for (const t of timers.splice(0)) clearTimeoutFn(t);
    for (const { el, cls, vars } of tagged.splice(0)) {
      el.classList?.remove?.(cls);
      for (const k of vars) el.style?.removeProperty?.(k);
    }
    for (const node of adopted.splice(0)) { try { node.remove?.(); } catch { /* swallow */ } }
    if (listener) doc.removeEventListener?.('pointerdown', listener, true);
    listener = null;
    for (const off of unsubs.splice(0)) { try { off(); } catch { /* swallow */ } }
    try { onFinish?.(); } catch { /* swallow */ }
  }
  function start(totalMs) {
    timers.push(setTimeoutFn(finish, totalMs + 20));
    listener = () => finish();
    doc.addEventListener?.('pointerdown', listener, true);
  }
  function finishOn(bus, types) {
    if (typeof bus?.on !== 'function') return;
    for (const type of types) {
      const off = bus.on(type, () => finish());
      if (typeof off === 'function') unsubs.push(off);
    }
  }
  function adopt(node) { if (node) adopted.push(node); return node; }
  return { tag, sound, start, finish, finishOn, adopt, get done() { return done; } };
}

function reducedFrom(reducedMotion, doc) {
  if (typeof reducedMotion === 'function') return !!reducedMotion();
  if (reducedMotion != null) return !!reducedMotion;
  return !!doc?.documentElement?.hasAttribute?.('data-reduced-motion');
}

// ── Home build ─────────────────────────────────────────────────────────
// Returns true when the build started. Only call on cold launch (main.js
// does so when the boot loader lifts); every later arrival at home is a
// BOOST GLIDE back navigation.
export function playHomeBuild({
  doc = globalThis.document,
  cue = null,
  reducedMotion,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!doc) return false;
  const sh = doc.getElementById?.('sh');
  if (!sh || sh.classList?.contains?.('hidden')) return false;
  if (reducedFrom(reducedMotion, doc)) return false;
  runs.home?.finish();

  const H = HOME_BUILD;
  const run = createRun({ doc, cue, setTimeoutFn, clearTimeoutFn, onFinish: () => { runs.home = null; } });
  runs.home = run;
  // Marks home as still arriving (boostGlide.ENTERING_CLASSES): the live-3D
  // top-bar avatar waits for the build to finish before its WebGL setup.
  run.tag(sh, 'hb-building');
  const q = (sel, root = sh) => root.querySelector?.(sel) ?? null;
  const qa = (sel, root = sh) => Array.from(root.querySelectorAll?.(sel) ?? []);

  // 1. Game-mode cards (with the "your turn" strip before and the
  //    leaderboard row after them when they are showing).
  const cards = [q('#home-turn-strip'), ...qa('.hm-cards > *'), q('#home-lb-row')].filter(isShown);
  cards.forEach((el, i) => run.tag(el, 'hb-rise', { '--b-delay': H.cards.start + i * H.cards.stagger, '--b-dur': H.cards.dur }));
  run.sound('build.card', H.cards.start);

  // 2. Bottom nav rises, then each item glows in a sweep (reading order).
  const nav = q('#home-bottom-nav');
  run.tag(nav, 'hb-rise', { '--b-delay': H.nav.start, '--b-dur': H.nav.dur });
  run.tag(q('.credit'), 'hb-rise', { '--b-delay': H.nav.start, '--b-dur': H.nav.dur });
  const navItems = nav ? qa('.em-nav-item', nav).filter(isShown) : [];
  navItems.forEach((el, i) => {
    const at = H.navGlow.start + i * H.navGlow.stagger;
    run.tag(el, 'hb-glow', { '--b-delay': at, '--b-dur': H.navGlow.dur });
    run.sound('build.glow', at, { rate: 1 + i * 0.08 });
  });

  // 3. Top-bar icons slide in from the left, leftmost first.
  const topbar = doc.getElementById?.('global-topbar');
  const icons = topbar ? qa('.em-topbar-icons > .em-icon-btn', topbar).filter(isShown) : [];
  const pts = icons.map(centerOf);
  const order = pts.every(Boolean) ? leftToRightOrder(pts) : icons.map((_, i) => icons.length - 1 - i);
  order.forEach((idx, i) => {
    const at = H.topIcons.start + i * H.topIcons.stagger;
    run.tag(icons[idx], 'hb-slide', { '--b-delay': at, '--b-dur': H.topIcons.dur });
    run.sound('build.tick', at);
  });

  // 4. Profile: panel + avatar pop, then name, then ELO.
  const P = H.profile;
  const profile = topbar ? q('.em-profile-btn', topbar) : null;
  if (profile) {
    run.tag(profile, 'hb-rise', { '--b-delay': P.start, '--b-dur': P.textDur });
    run.tag(q('.em-avatar-wrap', profile), 'hb-pop', { '--b-delay': P.start, '--b-dur': P.dur });
    run.tag(q('.em-player-name', profile), 'hb-rise', { '--b-delay': P.start + P.textStagger, '--b-dur': P.textDur });
    const elo = q('.em-elo-badge', profile);
    if (isShown(elo)) run.tag(elo, 'hb-rise', { '--b-delay': P.start + 2 * P.textStagger, '--b-dur': P.textDur });
    run.sound('build.pop', P.start);
  }

  // 5. Logo: the loader's tiles fly back in and build it, the ס is struck by
  //    lightning and splits (buildLogoTiles). Without the layers (no DOM
  //    factory, logo not laid out) the single image flies in from above.
  const L = H.logo;
  const logo = q('.hlogo');
  const tilesBuilt = !!logo && buildLogoTiles(run, doc, logo);
  if (logo && !tilesBuilt) {
    run.tag(logo, 'hb-logo', { '--b-delay': L.start, '--b-dur': L.flyDur });
    run.tag(q('img', logo), 'hb-logo-glow', { '--b-delay': L.start + L.flyDur, '--b-dur': L.glowDur });
    run.sound('build.whoosh', L.start);
    run.sound('build.land', L.start + L.flyDur);
    run.sound('build.wave', L.start + L.flyDur);
  }

  run.start(homeBuildTotal({ cards: cards.length, navItems: navItems.length, topIcons: icons.length, logoTiles: tilesBuilt }));
  return true;
}

// The tile-built logo. A stack of layers (.hl-tiles) is laid exactly over the
// logo <img>, which hides while the build runs; when the run finishes the
// stack is removed and the image — identical to the settled stack — is back.
// Timing: HOME_BUILD.logoTiles / logoTilesTimes(). Keyframes: styles.css.
function buildLogoTiles(run, doc, logo) {
  const img = logo.querySelector?.('img.hl-img');
  if (!img?.offsetWidth || typeof doc.createElement !== 'function') return false;
  const L = HOME_BUILD.logoTiles;
  const T = logoTilesTimes(L);
  const px = (v) => `${Math.round(v)}ms`;

  // Makes .hlogo the positioned parent (so the offsets below are relative to
  // it) and hides the image until the hand-off, where the stack fades out over
  // it (the two match to the pixel bar anti-aliasing, so the swap is unseen).
  run.tag(logo, 'hb-logo-tiles', { '--b-handoff': T.handoff, '--b-handoff-dur': L.handoffDur });
  const stack = run.adopt(doc.createElement('div'));
  stack.className = 'hl-tiles';
  stack.setAttribute('aria-hidden', 'true');
  // Fractional box (offset* round to whole px, which would shift the layers
  // against the image by up to a pixel and make the hand-off visible).
  const ir = img.getBoundingClientRect?.() ?? { left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight };
  const lr = logo.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  const f = (v) => `${Math.round(v * 100) / 100}px`;
  stack.style.cssText = `left:${f(ir.left - lr.left - (logo.clientLeft || 0))};top:${f(ir.top - lr.top - (logo.clientTop || 0))};width:${f(ir.width)};height:${f(ir.height)};`
    + `--b-strike:${px(T.strike)};--b-split:${px(T.split)};--b-glow:${px(T.glow)};--b-glow-dur:${px(L.glowDur)}`;
  const layer = (key, cls) => {
    const [x, y, w, h] = LOGO_TILE_LAYERS[key];
    const d = doc.createElement('div');
    d.className = `hl-layer ${cls}`;
    d.style.cssText = `left:${x}%;top:${y}%;width:${w}%;height:${h}%;z-index:${LOGO_TILE_Z[key]}`;
    stack.appendChild(d);
    return d;
  };
  const pic = (parent, file, cls = '') => {
    const im = doc.createElement('img');
    im.src = LOGO_TILES_DIR + file;
    im.alt = '';
    if (cls) im.className = cls;
    parent.appendChild(im);
    return im;
  };

  // Each tile flies in from far off-screen on the side it left the loader by.
  L.order.forEach((key, i) => {
    const v = unitExit(key);
    const t = layer(key, 'hb-tile-in');
    t.style.setProperty('--b-delay', px(L.start + i * L.stagger));
    t.style.setProperty('--b-dur', px(L.flyDur));
    t.style.setProperty('--b-fx', `${(v.x * OFFSCREEN_VMAX).toFixed(1)}vmax`);
    t.style.setProperty('--b-fy', `${(v.y * OFFSCREEN_VMAX).toFixed(1)}vmax`);
    t.style.setProperty('--b-spin', `${v.spin * 3}deg`);
    if (LOGO_SHADED.includes(key)) {
      pic(t, `logo_${key}_bare.webp`);
      pic(t, `logo_${key}.webp`, 'hb-tile-shade').style.setProperty('--b-shade', px(T.allLanded));
    } else {
      // The intact ס charges up, takes the lightning whole (white-hot), and
      // is gone the instant it splits.
      const whole = pic(t, `logo_${key}.webp`, 'hb-tile-charge');
      whole.style.setProperty('--b-charge', px(T.charge));
      whole.style.setProperty('--b-charge-dur', px(L.chargeDur));
    }
    run.sound(key === 'sam' ? 'build.land' : 'build.tile', T.land[key]);
  });

  // The strike: a channel from the sky onto the top of the intact ס; after the
  // impact the bolt-shaped crack flashes and the two halves kick apart.
  for (const half of ['samL', 'samR']) {
    const h = layer(half, `hb-tile-split ${half === 'samL' ? 'is-left' : 'is-right'}`);
    h.style.setProperty('--b-dur', px(L.splitDur));
    pic(h, `logo_${half}.webp`);
  }
  pic(layer('bolt', 'hb-tile-bolt'), 'logo_bolt.webp').style.setProperty('--b-dur', px(L.splitDur));
  const [bx, by, bw] = LOGO_TILE_LAYERS.bolt;
  const sky = doc.createElement('div');
  sky.className = 'hl-sky';
  // The leader comes down for leaderDur and lands at the strike; the channel
  // then flickers through the impact and fades as the ס splits (.hl-sky).
  sky.style.cssText = `left:${(bx + bw * 0.65).toFixed(2)}%;bottom:${(100 - by).toFixed(2)}%;`
    + `--b-leader:${px(L.leaderDur)};--b-dur:${px(L.impactDur + 120)}`;
  sky.innerHTML = '<svg viewBox="0 0 40 1000" preserveAspectRatio="none"><polyline points="'
    + '22,0 14,90 26,170 10,260 24,330 12,420 28,500 15,580 25,660 9,740 23,820 14,900 20,1000" /></svg>';
  stack.appendChild(sky);

  logo.appendChild(stack);
  run.sound('build.whoosh', L.start);
  run.sound('build.charge', T.charge);
  run.sound('build.strike', T.strike);
  run.sound('build.wave', T.glow);
  return true;
}

// ── Board build ────────────────────────────────────────────────────────
// kind: 'full' | 'quick' | 'none' (see buildTimeline.boardBuildKind).
// A full build emits BOARD_INTRO_STARTED / BOARD_INTRO_FINISHED on the bus so
// the turn clock and the bot hold for exactly as long as the build lasts.
export function playBoardBuild({
  doc = globalThis.document,
  bus = null,
  kind = 'full',
  cue = null,
  reducedMotion,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  runs.board?.finish();
  if (!doc || kind === 'none') return { kind: 'none', total: 0 };
  const sg = doc.getElementById?.('sg');
  if (!sg) return { kind: 'none', total: 0 };
  if (reducedFrom(reducedMotion, doc)) return { kind: 'none', total: 0 };

  const q = (sel, root = sg) => root.querySelector?.(sel) ?? null;
  const qa = (sel, root = sg) => Array.from(root.querySelectorAll?.(sel) ?? []);
  const B = BOARD_BUILD;

  if (kind === 'quick') {
    const run = createRun({ doc, cue: null, setTimeoutFn, clearTimeoutFn, onFinish: () => { runs.board = null; } });
    runs.board = run;
    run.tag(q('.gr'), 'bb-quick', { '--b-delay': 0, '--b-dur': B.quick.dur });
    run.start(B.quick.dur);
    return { kind: 'quick', total: B.quick.dur };
  }

  let total = 0;
  const run = createRun({
    doc, cue, setTimeoutFn, clearTimeoutFn,
    onFinish: () => {
      runs.board = null;
      try { bus?.emit?.(BOARD_INTRO_FINISHED, {}); } catch { /* swallow */ }
    },
  });
  runs.board = run;

  // 1. Board: the wooden board opens from the top-right corner while the
  //    grid cells unfold in a diagonal cascade from that corner.
  //    The glass skin paints the panel as .board-center-inner::before (the
  //    pseudo inherits the vars); #board-bg / #board-border are the legacy
  //    layers, revealed the same way when a skin shows them.
  run.tag(q('.board-center-inner'), 'bb-panel', { '--b-delay': B.boardBg.start, '--b-dur': B.boardBg.dur });
  run.tag(q('#board-bg'), 'bb-reveal', { '--b-delay': B.boardBg.start, '--b-dur': B.boardBg.dur });
  run.tag(q('#board-border'), 'bb-reveal', { '--b-delay': B.boardBg.start, '--b-dur': B.boardBg.dur });
  run.sound('build.unfold', B.boardBg.start);
  const grid = q('#game-grid');
  const children = grid ? Array.from(grid.children ?? []) : [];
  const gridBox = grid?.getBoundingClientRect?.();
  const rtl = (grid && globalThis.getComputedStyle?.(grid)?.direction) !== 'ltr';
  const pos = (el, i) => {
    const c = gridBox && gridBox.width ? centerOf(el) : null;
    if (c) return c;
    // Not laid out (tests / hidden): derive from the 12×12 index. In RTL the
    // first column is physically on the right.
    const r = Math.floor(i / 12), col = i % 12;
    return { x: rtl ? 11 - col : col, y: r };
  };
  const box = gridBox && gridBox.width
    ? gridBox
    : { left: 0, top: 0, right: 11, width: 11, height: 11 };
  const boosts = [];
  children.forEach((el, i) => {
    const p = pos(el, i);
    if (el.classList?.contains?.('bsq')) { boosts.push({ el, p }); return; }
    const at = B.cells.start + diagonalRank(p, box) * B.cells.spread;
    run.tag(el, 'bb-unfold', { '--b-delay': at, '--b-dur': B.cells.dur });
  });

  // 2. Boost squares pop in one after the other, clockwise from the top
  //    right, each glowing as it lands. (No second glow pass: the sweep is the wave.)
  const order = clockwiseOrder(boosts.map(b => b.p));
  order.forEach((idx, i) => {
    const at = B.boosts.start + i * B.boosts.stagger;
    run.tag(boosts[idx].el, 'bb-boost', {
      '--b-delay': at,
      '--b-dur': B.boosts.dur,
    });
    run.sound('build.glow', at, { rate: 1 + i * 0.05 });
  });

  // 4. Score cards slide in from their own sides; top bar + VS badge with them.
  const cards = [q('#is-sb1'), q('.gm-vs-center'), q('#is-sb2')].filter(Boolean);
  const mid = (() => { const s = centerOf(sg); return s ? s.x : null; })();
  cards.forEach((el, i) => {
    const c = centerOf(el);
    const side = c && mid != null ? Math.sign(c.x - mid) : 0;
    run.tag(el, 'bb-card', {
      '--b-delay': B.cards.start + i * B.cards.stagger,
      '--b-dur': B.cards.dur,
      '--b-side': String(side), // unitless: multiplies a px offset
    });
  });
  // The strip's own glass panel builds with its first card (not left empty).
  run.tag(q('#info-strip'), 'bb-rise', { '--b-delay': B.cards.start, '--b-dur': B.cards.dur });
  run.tag(q('.gm-topbar'), 'bb-rise', { '--b-delay': B.cards.start, '--b-dur': B.cards.dur });
  run.tag(q('#is-rail'), 'bb-rise', { '--b-delay': B.cards.start + B.cards.stagger, '--b-dur': B.cards.dur });
  run.sound('build.card', B.cards.start);

  // 5. Rack + buttons, led by the tiles floating onto the rack. Rack tiles are
  //    re-rendered with innerHTML, so their per-slot delays come from
  //    nth-child rules keyed on #brack.bb-tiles (styles.css), not inline vars.
  const rack = q('#brack');
  // The rack panel (.bot: tray + action buttons) rises first, then the tiles.
  run.tag(q('.bot'), 'bb-rise', { '--b-delay': B.rack.start, '--b-dur': B.rack.dur });
  run.tag(rack, 'bb-tiles', {
    '--b-tiles-start': B.tiles.start,
    '--b-tiles-stagger': B.tiles.stagger,
    '--b-tiles-dur': B.tiles.dur,
  });
  const tileCount = rack ? Math.min(RACK_SLOTS, qa('.bt2:not(.emp)', rack).length || RACK_SLOTS) : 0;
  for (let i = 0; i < tileCount; i++) {
    run.sound('build.tile', B.tiles.start + i * B.tiles.stagger + Math.round(B.tiles.dur * 0.75));
  }
  const buttons = ['#btn-recall', '#btn-exchange', '#btn-play'].map(s => q(s)).filter(Boolean);
  buttons.forEach((el, i) => run.tag(el, 'bb-rise', { '--b-delay': B.buttons.start + i * B.buttons.stagger, '--b-dur': B.buttons.dur }));

  total = boardBuildTotal({ boosts: boosts.length, tiles: tileCount, buttons: buttons.length });
  try { bus?.emit?.(BOARD_INTRO_STARTED, { totalMs: total }); } catch { /* swallow */ }
  run.start(total);
  run.finishOn(bus, BOARD_YIELD_EVENTS);
  return { kind: 'full', total };
}

// Finish whatever build is running (game torn down mid-build, tests).
export function finishBuilds() {
  runs.home?.finish();
  runs.board?.finish();
}

export function isBoardBuilding() { return !!runs.board && !runs.board.done; }

// Rooms this device already played the full build for (async games are
// reopened many times before the first move). Small ring in localStorage.
const BUILT_KEY = 'boost.boardBuiltRooms';
const BUILT_MAX = 40;

export function wasBoardBuilt(storage, roomId) {
  if (!roomId) return false;
  try { return (JSON.parse(storage?.getItem?.(BUILT_KEY) ?? '[]') || []).includes(roomId); }
  catch { return false; }
}

export function rememberBoardBuilt(storage, roomId) {
  if (!roomId || !storage?.setItem) return;
  try {
    const list = (JSON.parse(storage.getItem(BUILT_KEY) ?? '[]') || []).filter(id => id !== roomId);
    list.push(roomId);
    storage.setItem(BUILT_KEY, JSON.stringify(list.slice(-BUILT_MAX)));
  } catch { /* swallow */ }
}
