// Build sequences — the two signature entrances that deliberately exceed the
// BOOST GLIDE budget (see docs-md/BOOST_MOTION_SPEC.md §16):
//
//   HOME_BUILD   the main menu assembles itself on cold launch
//   BOARD_BUILD  the game board is built in front of the player at game start
//
// Data and pure helpers only (no DOM, no timers). The DOM runner is
// src/ui/buildSequences.js; keyframes live in styles.css (§1c Build sequences).
// Every time is in ms from the start of the sequence. Durations and delays are
// handed to CSS as custom properties, so this file is the single source of
// truth — styles.css carries no timing of its own for these sequences.

// ── Main menu, cold launch only ────────────────────────────────────────
// Order: game-mode cards → bottom nav rises, each item glows in a sweep →
// top-bar icons slide in from the left, one by one → profile (avatar, name,
// ELO) → the logo flies in from above the screen, glows and settles.
// Buttons are tappable as soon as they land; any tap finishes the build.
export const HOME_BUILD = Object.freeze({
  cards:    Object.freeze({ start: 0,    stagger: 70, dur: 340 }),
  nav:      Object.freeze({ start: 260,  dur: 320 }),
  navGlow:  Object.freeze({ start: 420,  stagger: 90, dur: 360 }),
  topIcons: Object.freeze({ start: 640,  stagger: 70, dur: 320 }),
  profile:  Object.freeze({ start: 980,  dur: 360, textStagger: 90, textDur: 280 }),
  logo:     Object.freeze({ start: 1120, flyDur: 480, glowDur: 340 }),
  // With the per-tile layers (assets/ui/logo_tiles/, the normal case) the logo
  // is built instead of dropped: the four tiles that flew off the loading
  // screen fly back in, each from the side it left by (LOGO_TILE_EXITS), in
  // `order` → the ס charges → lightning strikes the whole ס (it flashes
  // white-hot for `impactDur`) → only then does it split → the logo glows. Then the single image (boost-logo.webp) takes over invisibly.
  logoTiles: Object.freeze({
    start: 900, order: Object.freeze(['bet', 'vav', 'tet', 'sam']), stagger: 90, flyDur: 480,
    hold: 80, chargeDur: 260, leaderDur: 80, impactDur: 200, splitDur: 340, glowDelay: 120, glowDur: 420, handoffDur: 220,
  }),
});

// The boot loader's tiles leave the screen before home builds: each one flies
// off in its own direction (unit-ish vector, screen axes, y down) with a spin
// in degrees, and comes back from the same side to build the home logo.
export const LOGO_TILE_EXITS = Object.freeze({
  bet: Object.freeze({ x: 1,     y: -0.55, spin: 26 }),
  vav: Object.freeze({ x: 0.45,  y: 1,     spin: -20 }),
  sam: Object.freeze({ x: -0.15, y: -1,    spin: 16 }),
  tet: Object.freeze({ x: -1,    y: 0.4,   spin: -28 }),
});
// dur: one tile's exit; stagger: between tiles (DOM order ב, ו, ס, ט);
// settle: share of a tile's exit spent snapping it from wherever its loop was
// back to rest before it flies.
export const LOADING_EXIT = Object.freeze({ dur: 380, stagger: 40, settle: 0.22 });

// Tapping the settled logo replays its strike: the ס's halves close up into
// the whole ס (`heal`), then the same charge → strike → split → glow as the
// build (HOME_BUILD.logoTiles durations).
export const LOGO_REPLAY = Object.freeze({ heal: 220, hold: 60 });
// While home sits idle a pulse of current runs down the ס's crack, every
// `every` ± `jitter`/2 ms, for `dur` ms. Silent.
export const LOGO_IDLE = Object.freeze({ every: 30000, jitter: 8000, dur: 900 });

// The strike from the moment the ס starts charging. strike: the lightning
// reaches the intact ס (its leader set off `leaderDur` earlier); split: the ס
// cracks into its halves. The last `handoffDur` crossfades the layer stack
// into the single image.
function strikeFrom(charge, L) {
  const strike = charge + L.chargeDur;
  const split = strike + L.impactDur;
  const glow = split + L.glowDelay;
  const end = Math.max(split + L.splitDur, glow + L.glowDur);
  return { charge, strike, split, glow, handoff: end - L.handoffDur, end };
}

// Moments of the tile-built logo, in ms from the start of the home build.
export function logoTilesTimes(L = HOME_BUILD.logoTiles) {
  const land = {};
  L.order.forEach((k, i) => { land[k] = L.start + i * L.stagger + L.flyDur; });
  const allLanded = L.start + (L.order.length - 1) * L.stagger + L.flyDur;
  return { land, allLanded, ...strikeFrom(allLanded + L.hold, L) };
}

// Moments of the tap replay, in ms from the tap.
export function logoReplayTimes(L = HOME_BUILD.logoTiles, R = LOGO_REPLAY) {
  return { heal: R.heal, ...strikeFrom(R.heal + R.hold, L) };
}

// ── Game board, new games only ─────────────────────────────────────────
// The board unfolds from the top-right corner (Hebrew reading start) as a
// diagonal cascade → boost squares pop in one after the other around the
// board, each glowing as it lands (the sweep itself is the wave — no second
// glow pass) → the score cards build → the rack and its buttons, led by the tiles floating onto the rack.
export const BOARD_BUILD = Object.freeze({
  boardBg:  Object.freeze({ start: 0,    dur: 460 }),
  cells:    Object.freeze({ start: 40,   spread: 300, dur: 300 }),
  boosts:   Object.freeze({ start: 520,  stagger: 38, dur: 300 }),
  cards:    Object.freeze({ start: 1180, stagger: 90, dur: 340 }),
  rack:     Object.freeze({ start: 1320, dur: 280 }),
  tiles:    Object.freeze({ start: 1380, stagger: 50, dur: 340 }),
  buttons:  Object.freeze({ start: 1500, stagger: 60, dur: 280 }),
  // Resuming a game in progress (My Games, local save, reconnect): no build,
  // just a short settle of the whole board.
  quick:    Object.freeze({ dur: 300 }),
});

// Rack size is fixed by the engine (RACK_SIZE = 8); the CSS has one
// nth-child rule per slot so tiles re-rendered mid-build keep their slot delay.
export const RACK_SLOTS = 8;

const end = (phase, count = 1) =>
  phase.start + Math.max(0, count - 1) * (phase.stagger ?? 0) + (phase.dur ?? 0);

// Total length of the home build for the given number of items per group.
// logoTiles: the logo is built from the tile layers rather than dropped whole.
export function homeBuildTotal({ cards = 3, navItems = 4, topIcons = 5, logoTiles = false } = {}) {
  const h = HOME_BUILD;
  return Math.max(
    end(h.cards, cards),
    h.nav.start + h.nav.dur,
    end(h.navGlow, navItems),
    end(h.topIcons, topIcons),
    h.profile.start + 2 * h.profile.textStagger + h.profile.textDur,
    h.profile.start + h.profile.dur,
    logoTiles ? logoTilesTimes(h.logoTiles).end : h.logo.start + h.logo.flyDur + h.logo.glowDur,
  );
}

// Total length of the board build (12 boost squares, 8 rack tiles, 3 buttons).
export function boardBuildTotal({ boosts = 12, tiles = RACK_SLOTS, buttons = 3 } = {}) {
  const b = BOARD_BUILD;
  return Math.max(
    b.boardBg.start + b.boardBg.dur,
    b.cells.start + b.cells.spread + b.cells.dur,
    end(b.boosts, boosts),
    end(b.cards, 3),
    b.rack.start + b.rack.dur,
    end(b.tiles, tiles),
    end(b.buttons, buttons),
  );
}

// Lead-in added to an online room's FIRST turn deadline so the starting
// player doesn't lose the build time (both clients play the same build).
export const BOARD_BUILD_LEAD_MS = boardBuildTotal();

// Normalised diagonal distance (0 at the top-right corner, 1 at bottom-left)
// for an element centre inside a box. Used for the unfold cascade.
export function diagonalRank({ x, y }, box) {
  const w = Math.max(1, box.width), h = Math.max(1, box.height);
  const dx = (box.right - x) / w;   // 0 at the right edge
  const dy = (y - box.top) / h;     // 0 at the top edge
  return Math.max(0, Math.min(1, (dx + dy) / 2));
}

// Order points clockwise around their common centre, starting from the point
// nearest the top-right corner of their bounding box. Screen coordinates: y
// grows downward, so increasing atan2 angle is clockwise. Returns the input
// indices in sweep order.
export function clockwiseOrder(points) {
  if (!points.length) return [];
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1e-9, maxX - minX), h = Math.max(1e-9, maxY - minY);
  let lead = 0, best = -Infinity;
  points.forEach((p, i) => {
    const score = (p.x - minX) / w + (maxY - p.y) / h;   // high = top-right
    if (score > best) { best = score; lead = i; }
  });
  const angle = (p) => Math.atan2(p.y - cy, p.x - cx);
  const start = angle(points[lead]);
  const TAU = Math.PI * 2;
  return points
    .map((p, i) => ({ i, a: (((angle(p) - start) % TAU) + TAU) % TAU }))
    .sort((m, n) => m.a - n.a)
    .map(o => o.i);
}

// Order points left-to-right by x (top-bar icons enter from the left, so the
// leftmost one leads).
export function leftToRightOrder(points) {
  return points.map((p, i) => ({ i, x: p.x })).sort((m, n) => m.x - n.x).map(o => o.i);
}

// Which board entrance a game start gets.
//   'full'  — a brand-new game seen for the first time on this device
//   'quick' — a resume (moves already played, local save, or a room this
//             device has already built once)
//   'none'  — tutorial (its scripted prompts need the board immediately)
export function boardBuildKind({ mode, resumed = false, moveCount = 0, turnNumber = 1, alreadyBuilt = false } = {}) {
  if (mode === 'tutorial') return 'none';
  if (resumed || alreadyBuilt) return 'quick';
  if (moveCount > 0 || Number(turnNumber) > 1) return 'quick';
  return 'full';
}
