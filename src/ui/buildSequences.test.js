import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOME_BUILD, BOARD_BUILD, RACK_SLOTS, homeBuildTotal, boardBuildTotal, BOARD_BUILD_LEAD_MS,
  diagonalRank, clockwiseOrder, leftToRightOrder, boardBuildKind,
} from './buildTimeline.js';
import {
  playHomeBuild, playBoardBuild, finishBuilds, isBoardBuilding,
  wasBoardBuilt, rememberBoardBuilt, BOARD_INTRO_STARTED, BOARD_INTRO_FINISHED,
} from './buildSequences.js';

// ── Fake DOM: elements answer querySelector(All) from a selector table ────
function el(name, { hidden = false, children = [] } = {}) {
  const cls = new Set();
  const props = new Map();
  const table = new Map();
  const node = {
    name,
    children,
    style: {
      display: hidden ? 'none' : '',
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
      getPropertyValue: (k) => props.get(k) ?? '',
    },
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      contains: (c) => cls.has(c),
    },
    has: (c) => cls.has(c),
    prop: (k) => props.get(k),
    on(sel, value) { table.set(sel, value); return node; },
    querySelector: (sel) => { const v = table.get(sel); return Array.isArray(v) ? v[0] ?? null : v ?? null; },
    querySelectorAll: (sel) => { const v = table.get(sel); return v == null ? [] : [].concat(v); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  };
  return node;
}

function makeDoc({ reduced = false } = {}) {
  const listeners = new Map();
  const byId = new Map();
  const doc = {
    documentElement: { hasAttribute: (k) => k === 'data-reduced-motion' && reduced },
    getElementById: (id) => byId.get(id) ?? null,
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
    tap: () => listeners.get('pointerdown')?.(),
    listening: () => listeners.has('pointerdown'),
    byId,
  };
  return doc;
}

function homeDoc(opts) {
  const doc = makeDoc(opts);
  const sh = el('sh');
  const cards = [el('card1'), el('card2'), el('card3')];
  const turnStrip = el('turn', { hidden: true });
  const navItems = [el('nav1'), el('nav2'), el('nav3'), el('nav4')];
  const nav = el('nav').on('.em-nav-item', navItems);
  const logo = el('logo');
  const logoImg = el('logoImg');
  logo.on('img', logoImg);
  sh.on('#home-turn-strip', turnStrip).on('.hm-cards > *', cards).on('#home-lb-row', null)
    .on('#home-bottom-nav', nav).on('.credit', el('credit')).on('.hlogo', logo);
  const icons = [el('music'), el('gear'), el('help'), el('home', { hidden: true })];
  const avatar = el('avatar'); const name = el('name'); const elo = el('elo', { hidden: true });
  const profile = el('profile').on('.em-avatar-wrap', avatar).on('.em-player-name', name).on('.em-elo-badge', elo);
  const topbar = el('topbar').on('.em-topbar-icons > .em-icon-btn', icons).on('.em-profile-btn', profile);
  doc.byId.set('sh', sh);
  doc.byId.set('global-topbar', topbar);
  return { doc, sh, cards, turnStrip, navItems, nav, logo, logoImg, icons, avatar, name, elo, profile };
}

function boardDoc(opts) {
  const doc = makeDoc(opts);
  const sg = el('sg');
  const cells = Array.from({ length: 144 }, (_, i) => {
    const r = Math.floor(i / 12), c = i % 12;
    const isBoost = (r === 0 || r === 11 || c === 0 || c === 11) && (r + c) % 3 === 1;
    const node = el(`g${i}`);
    if (isBoost) node.classList.add('bsq');
    return node;
  });
  const grid = el('grid', { children: cells });
  const tiles = Array.from({ length: 8 }, (_, i) => el(`t${i}`));
  const rack = el('rack').on('.bt2:not(.emp)', tiles);
  const parts = {
    panel: el('panel'), bg: el('bg'), border: el('border'), grid, rack,
    sb1: el('sb1'), vs: el('vs'), sb2: el('sb2'), strip: el('strip'), top: el('top'), rail: el('rail'),
    bot: el('bot'), recall: el('recall'), exchange: el('exchange'), play: el('play'), gr: el('gr'),
  };
  sg.on('.board-center-inner', parts.panel).on('#board-bg', parts.bg).on('#board-border', parts.border)
    .on('#game-grid', grid).on('#is-sb1', parts.sb1).on('.gm-vs-center', parts.vs).on('#is-sb2', parts.sb2)
    .on('#info-strip', parts.strip).on('.gm-topbar', parts.top).on('#is-rail', parts.rail)
    .on('#brack', rack).on('.bot', parts.bot).on('#btn-recall', parts.recall)
    .on('#btn-exchange', parts.exchange).on('#btn-play', parts.play).on('.gr', parts.gr);
  doc.byId.set('sg', sg);
  return { doc, sg, cells, boosts: cells.filter(c => c.has('bsq')), parts };
}

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms, alive: true }); return timers.length; },
    clearTimeoutFn: (h) => { if (timers[h - 1]) timers[h - 1].alive = false; },
    runAll() { for (const t of timers.slice()) if (t.alive) { t.alive = false; t.fn(); } },
  };
}

function fakeBus() {
  const events = [];
  const subs = new Map();
  return {
    events,
    emit: (type, p) => { events.push([type, p]); for (const fn of [...(subs.get(type) ?? [])]) fn(p); },
    on: (type, fn) => { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => subs.get(type).delete(fn); },
    count: (type) => subs.get(type)?.size ?? 0,
  };
}

const ms = (node, k = '--b-delay') => parseInt(node.prop(k), 10);

beforeEach(() => finishBuilds());

// ── Timeline ──────────────────────────────────────────────────────────────
test('home build: cards → nav glow → top icons → profile → logo, in that order', () => {
  const h = HOME_BUILD;
  assert.ok(h.cards.start < h.nav.start && h.nav.start < h.navGlow.start);
  assert.ok(h.navGlow.start < h.topIcons.start && h.topIcons.start < h.profile.start);
  assert.ok(h.profile.start < h.logo.start, 'the logo is the last thing to appear');
  const total = homeBuildTotal();
  assert.ok(total >= 1500 && total <= 2200, `home build ≈2 s (${total})`);
});

test('board build: unfold → boost sweep → cards → rack/tiles, total ≈2 s', () => {
  const b = BOARD_BUILD;
  assert.ok(b.boardBg.start <= b.cells.start && b.cells.start < b.boosts.start);
  assert.equal(b.wave, undefined, 'no second glow pass over the boost squares');
  assert.ok(b.cards.start < b.rack.start && b.rack.start < b.tiles.start && b.tiles.start <= b.buttons.start);
  const total = boardBuildTotal();
  assert.ok(total >= 1500 && total <= 2300, `board build ≈2 s (${total})`);
  assert.equal(BOARD_BUILD_LEAD_MS, total, 'online lead-in equals the build');
  assert.equal(b.quick.dur, 300);
  assert.equal(RACK_SLOTS, 8);
});

test('diagonalRank: 0 at the top-right corner, 1 at the bottom-left', () => {
  const box = { left: 0, top: 0, right: 100, width: 100, height: 100 };
  assert.equal(diagonalRank({ x: 100, y: 0 }, box), 0);
  assert.equal(diagonalRank({ x: 0, y: 100 }, box), 1);
  assert.equal(diagonalRank({ x: 0, y: 0 }, box), 0.5);
});

test('clockwiseOrder: starts top-right and goes down the right side', () => {
  const pts = [
    { x: 0, y: 0 },     // 0 top-left
    { x: 10, y: 0 },    // 1 top-right
    { x: 10, y: 10 },   // 2 bottom-right
    { x: 0, y: 10 },    // 3 bottom-left
    { x: 10, y: 5 },    // 4 right-middle
  ];
  assert.deepEqual(clockwiseOrder(pts), [1, 4, 2, 3, 0]);
  assert.deepEqual(leftToRightOrder([{ x: 30 }, { x: 10 }, { x: 20 }]), [1, 2, 0]);
});

test('boardBuildKind: full only for a brand-new game; resumes get the quick settle', () => {
  assert.equal(boardBuildKind({ mode: 'offline-solo' }), 'full');
  assert.equal(boardBuildKind({ mode: 'offline-solo', resumed: true }), 'quick');
  assert.equal(boardBuildKind({ mode: 'random-async', moveCount: 3 }), 'quick');
  assert.equal(boardBuildKind({ mode: 'random-async', turnNumber: 2 }), 'quick');
  assert.equal(boardBuildKind({ mode: 'random-async', alreadyBuilt: true }), 'quick');
  assert.equal(boardBuildKind({ mode: 'tutorial' }), 'none');
});

test('built-room memory is a bounded ring', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(wasBoardBuilt(storage, 'r1'), false);
  rememberBoardBuilt(storage, 'r1');
  assert.equal(wasBoardBuilt(storage, 'r1'), true);
  for (let i = 0; i < 50; i++) rememberBoardBuilt(storage, `x${i}`);
  assert.equal(wasBoardBuilt(storage, 'r1'), false, 'oldest dropped');
  assert.equal(JSON.parse(store.get('boost.boardBuiltRooms')).length, 40);
});

// ── Home runner ───────────────────────────────────────────────────────────
test('home build tags every group with its phase delay and cleans up', () => {
  const h = homeDoc();
  const t = fakeTimers();
  const cues = [];
  assert.equal(playHomeBuild({ doc: h.doc, cue: (id) => cues.push(id), reducedMotion: false, ...t }), true);
  assert.deepEqual(h.cards.map(c => ms(c)), [0, 70, 140]);
  assert.ok(!h.turnStrip.has('hb-rise'), 'hidden strip skipped');
  assert.ok(h.navItems.every(n => n.has('hb-glow')));
  assert.equal(ms(h.navItems[1]) - ms(h.navItems[0]), HOME_BUILD.navGlow.stagger);
  assert.equal(h.icons.filter(i => i.has('hb-slide')).length, 3, 'hidden home icon skipped');
  assert.equal(ms(h.icons[2]), HOME_BUILD.topIcons.start, 'without layout, the last (leftmost in RTL) leads');
  assert.ok(h.avatar.has('hb-pop') && h.name.has('hb-rise') && !h.elo.has('hb-rise'));
  assert.ok(h.logo.has('hb-logo') && h.logoImg.has('hb-logo-glow'));
  assert.ok(ms(h.logo) > ms(h.avatar), 'logo after the profile');
  assert.ok(h.doc.listening(), 'tap-to-finish armed');
  t.runAll();
  assert.ok(!h.logo.has('hb-logo') && !h.cards[0].has('hb-rise'));
  assert.equal(h.cards[0].prop('--b-delay'), undefined);
  assert.equal(h.doc.listening(), false);
  for (const id of ['build.card', 'build.glow', 'build.tick', 'build.pop', 'build.whoosh', 'build.land', 'build.wave']) {
    assert.ok(cues.includes(id), `${id} played`);
  }
});

test('home build: a tap finishes it at once and cancels pending sounds', () => {
  const h = homeDoc();
  const t = fakeTimers();
  const cues = [];
  playHomeBuild({ doc: h.doc, cue: (id) => cues.push(id), reducedMotion: false, ...t });
  h.doc.tap();
  assert.ok(!h.logo.has('hb-logo') && !h.cards[1].has('hb-rise'));
  const before = cues.length;
  t.runAll();
  assert.equal(cues.length, before, 'no sounds after the skip');
});

test('home build: skipped under reduced motion or when home is not showing', () => {
  const h = homeDoc({ reduced: true });
  assert.equal(playHomeBuild({ doc: h.doc, ...fakeTimers() }), false);
  const h2 = homeDoc();
  h2.sh.classList.add('hidden');
  assert.equal(playHomeBuild({ doc: h2.doc, reducedMotion: false, ...fakeTimers() }), false);
});

// ── Board runner ──────────────────────────────────────────────────────────
test('board build (full): unfold, boost sweep, cards, rack — and the intro events', () => {
  const b = boardDoc();
  const t = fakeTimers();
  const bus = fakeBus();
  const cues = [];
  const res = playBoardBuild({ doc: b.doc, bus, kind: 'full', cue: (id) => cues.push(id), reducedMotion: false, ...t });
  assert.equal(res.kind, 'full');
  assert.equal(bus.events[0][0], BOARD_INTRO_STARTED);
  assert.equal(bus.events[0][1].totalMs, res.total);
  assert.ok(isBoardBuilding());
  // RTL fallback geometry: index 0 (row 0, col 0) is the top-right corner.
  const nonBoost = b.cells.filter(c => !c.has('bsq'));
  assert.ok(nonBoost.every(c => c.has('bb-unfold')));
  assert.equal(ms(b.cells[1]) < ms(b.cells[143]) || b.cells[143].has('bsq'), true);
  assert.ok(ms(b.cells[2]) < ms(b.cells[130]), 'top-right unfolds before bottom-left');
  const boostDelays = b.boosts.map(x => ms(x)).sort((m, n) => m - n);
  assert.equal(boostDelays[0], BOARD_BUILD.boosts.start);
  assert.equal(boostDelays[1] - boostDelays[0], BOARD_BUILD.boosts.stagger);
  assert.ok(b.boosts.every(x => x.prop('--b-wave-delay') === undefined), 'no glow wave');
  assert.ok(b.parts.sb1.has('bb-card') && b.parts.sb2.has('bb-card') && b.parts.strip.has('bb-rise'));
  assert.ok(b.parts.rack.has('bb-tiles') && b.parts.bot.has('bb-rise') && b.parts.play.has('bb-rise'));
  assert.ok(b.parts.panel.has('bb-panel'));
  assert.equal(cues.filter(c => c === 'build.unfold').length, 1, 'unfold sound');
  t.runAll();
  assert.equal(bus.events.at(-1)[0], BOARD_INTRO_FINISHED);
  assert.ok(!b.cells[5].has('bb-unfold') && !b.parts.rack.has('bb-tiles'));
  assert.equal(isBoardBuilding(), false);
  for (const id of ['build.glow', 'build.card', 'build.tile']) assert.ok(cues.includes(id), `${id} played`);
  assert.ok(!cues.includes('build.wave'), 'no wave sound on the board');
});

test('board build: a tap finishes it and releases the clock immediately', () => {
  const b = boardDoc();
  const bus = fakeBus();
  playBoardBuild({ doc: b.doc, bus, kind: 'full', reducedMotion: false, ...fakeTimers() });
  b.doc.tap();
  assert.equal(bus.events.at(-1)[0], BOARD_INTRO_FINISHED);
  assert.ok(!b.parts.sb1.has('bb-card'));
});

test('board build: quick resume is a 300 ms settle with no events or sounds', () => {
  const b = boardDoc();
  const bus = fakeBus();
  const cues = [];
  const t = fakeTimers();
  const res = playBoardBuild({ doc: b.doc, bus, kind: 'quick', cue: (id) => cues.push(id), reducedMotion: false, ...t });
  assert.deepEqual(res, { kind: 'quick', total: 300 });
  assert.ok(b.parts.gr.has('bb-quick'));
  assert.equal(bus.events.length, 0);
  t.runAll();
  assert.ok(!b.parts.gr.has('bb-quick'));
  assert.equal(cues.length, 0);
});

test('board build: reduced motion or tutorial → nothing, no intro events', () => {
  const b = boardDoc({ reduced: true });
  const bus = fakeBus();
  assert.equal(playBoardBuild({ doc: b.doc, bus, kind: 'full', ...fakeTimers() }).kind, 'none');
  const b2 = boardDoc();
  assert.equal(playBoardBuild({ doc: b2.doc, bus, kind: 'none', reducedMotion: false, ...fakeTimers() }).kind, 'none');
  assert.equal(bus.events.length, 0);
});

test('finishBuilds (game torn down mid-build) emits the finish exactly once', () => {
  const b = boardDoc();
  const bus = fakeBus();
  const t = fakeTimers();
  playBoardBuild({ doc: b.doc, bus, kind: 'full', reducedMotion: false, ...t });
  finishBuilds();
  t.runAll();
  b.doc.tap();
  assert.equal(bus.events.filter(e => e[0] === BOARD_INTRO_FINISHED).length, 1);
});

test('board build yields to gameplay: a confirmed move finishes it before animating', async () => {
  const { EV } = await import('../events/eventTypes.js');
  const b = boardDoc();
  const bus = fakeBus();
  playBoardBuild({ doc: b.doc, bus, kind: 'full', reducedMotion: false, ...fakeTimers() });
  assert.equal(bus.count(EV.MOVE_CONFIRMED), 1);
  bus.emit(EV.MOVE_CONFIRMED, {});
  assert.ok(!b.cells[5].has('bb-unfold'), 'cells freed for the move animation');
  assert.equal(bus.events.filter(e => e[0] === BOARD_INTRO_FINISHED).length, 1);
  assert.equal(bus.count(EV.MOVE_CONFIRMED), 0, 'listeners removed');
});

