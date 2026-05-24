// Tests for the rewritten gameScreen against a hand-built DOM stub.
// We model a tiny subset of the legacy game screen: action buttons,
// score values, status bar, bag count, move counter, plus a 10x10 grid
// of cell elements indexed by id `c{r}_{c}` and an 8-slot rack at #brack.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { DICT, addWordsFromText } from '../../game/core/hebrewDictionary.js';
import { createLocalGameSession } from '../../game/sessions/localGameSession.js';
import { createGameController } from '../controllers/gameController.js';
import { createAnimationController } from '../controllers/animationController.js';
import { mountGameScreen, GAME_SCREEN_INTENT } from './gameScreen.js';

const _origLog = console.log;
console.log = () => {};

function makeEl({ id, classes = [] } = {}) {
  const listeners = [];
  const attrs = {};
  const cls = new Set(classes);
  const children = [];
  let parent = null;
  let textContent = '';
  let innerHTML = '';
  const el = {
    id: id ?? '',
    _attrs: attrs,
    _listeners: listeners,
    style: {},
    get className() { return Array.from(cls).join(' '); },
    set className(v) {
      cls.clear();
      String(v ?? '').split(/\s+/).filter(Boolean).forEach(c => cls.add(c));
    },
    classList: {
      add(...c) { c.forEach(x => cls.add(x)); },
      remove(...c) { c.forEach(x => cls.delete(x)); },
      contains(c) { return cls.has(c); },
    },
    get textContent() { return textContent; },
    set textContent(v) { textContent = v; innerHTML = String(v); },
    get innerHTML() { return innerHTML; },
    set innerHTML(v) { innerHTML = v; textContent = String(v).replace(/<[^>]+>/g, ''); children.length = 0; },
    get parentNode() { return parent; },
    get children() { return children; },
    appendChild(c) { children.push(c); c._setParent?.(el); return c; },
    remove() {
      if (!parent?.children) return;
      const i = parent.children.indexOf(el);
      if (i >= 0) parent.children.splice(i, 1);
    },
    _setParent(p) { parent = p; },
    getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, val) { attrs[name] = val; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    closest(selector) {
      // crude: only matches `[id^="c"]` and `.bt2`
      const m = selector.match(/^\[id\^="(.+)"\]$/);
      if (m) return el.id?.startsWith(m[1]) ? el : (parent?.closest?.(selector) ?? null);
      if (selector === '.bt2') return cls.has('bt2') ? el : (parent?.closest?.(selector) ?? null);
      return null;
    },
    fireClick(target) {
      for (const l of listeners) if (l.ev === 'click') l.fn({ target: target ?? el, preventDefault() {} });
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 10, top: 10, width: 20, height: 20 }; },
    get offsetWidth() { return 1; },
  };
  return el;
}

function makeGameDom() {
  const elements = new Map();
  function reg(id, classes) {
    const el = makeEl({ id, classes });
    elements.set(id, el);
    return el;
  }
  // Action buttons
  reg('btn-play');
  reg('btn-recall');
  const btnExchange = reg('btn-exchange');
  btnExchange._attrs.onclick = 'doExchange()';
  reg('bh')._attrs.onclick = "setDir('H')";
  reg('bv')._attrs.onclick = "setDir('V')";
  reg('is-bh');
  reg('is-bv');
  // Score panels
  reg('sv1'); reg('sv2'); reg('is-sv1'); reg('is-sv2');
  reg('sn1'); reg('sn2'); reg('is-sn1'); reg('is-sn2');
  reg('sb1'); reg('sb2'); reg('is-sb1'); reg('is-sb2');
  reg('scn1'); reg('scn2');
  // Misc
  reg('sbar'); reg('bag-count-text'); reg('lcd'); reg('turn-name'); reg('bag-display');
  reg('lock-inv-display'); reg('is-locks-1'); reg('is-locks-2');
  // Grid
  const grid = reg('game-grid');
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const cell = reg(`c${r}_${c}`, ['cell']);
      grid.appendChild(cell);
    }
  }
  for (let i = 0; i < 12; i++) reg(`bsq-${i}`);
  // Rack — empty container; gameScreen.renderRack will populate via innerHTML
  // We can't actually evaluate the innerHTML to spawn .bt2 children in our
  // stub, so the rack-click test uses a manually-constructed child set.
  reg('brack');
  const exchangeOverlay = reg('ov-exch', ['hidden']);
  const exchRack = reg('exch-rack');
  const exchCancel = reg('exch-cancel');
  exchCancel._attrs.onclick = "ovClose('ov-exch')";
  exchangeOverlay.appendChild(exchRack);
  exchangeOverlay.appendChild(exchCancel);
  const body = reg('body');

  const root = {
    body,
    createElement(tag) { return makeEl({ id: tag }); },
    getElementById(id) { return elements.get(id) ?? null; },
    querySelector(sel) {
      if (sel.startsWith('#')) return elements.get(sel.slice(1)) ?? null;
      if (sel === 'button[onclick="doExchange()"]') return btnExchange;
      if (sel === 'button[onclick="ovClose(\'ov-exch\')"]') return exchCancel;
      return null;
    },
  };
  return { root, elements };
}

const PLAYERS = { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } };

function fresh() {
  bus._reset();
  DICT.clear();
  addWordsFromText('אב\nאבג\n');
  const session = createLocalGameSession({
    bus, mode: 'offline-2p', tileBagSeed: 'gs-test', players: PLAYERS,
  });
  session.state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  session.state.racks[1] = ['ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע'];
  const controller = createGameController({ bus, session, mySlot: null });
  return { session, controller };
}

test('mount: removes inline onclick from #btn-play and #btn-recall', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  assert.equal(elements.get('btn-play').getAttribute('onclick'), null);
  assert.equal(elements.get('btn-recall').getAttribute('onclick'), null);
});

test('mount: clicking #btn-play with placed tiles dispatches CONFIRM_MOVE', () => {
  const { session, controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  controller.placeTile({ r: 4, c: 5, letter: 'ב', val: 3 });
  elements.get('btn-play').fireClick();
  assert.equal(session.state.scores[0], 4);
  assert.equal(session.state.currentTurnSlot, 1);
});

test('mount: clicking #btn-recall clears placed tiles', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  assert.equal(controller.view.placed.length, 1);
  elements.get('btn-recall').fireClick();
  assert.equal(controller.view.placed.length, 0);
});

test('exchange overlay swaps selected rack tiles and advances turn', () => {
  const { session, controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });

  elements.get('btn-exchange').fireClick();
  assert.ok(!elements.get('ov-exch').classList.contains('hidden'));

  const firstTile = elements.get('exch-rack').children[0];
  firstTile.fireClick();
  const confirm = elements.get('exch-rack').children.at(-1);
  confirm.fireClick();

  assert.ok(elements.get('ov-exch').classList.contains('hidden'));
  assert.equal(session.state.currentTurnSlot, 1);
  assert.equal(session.state.racks[0].length, 8);
});

test('exchange overlay cancel closes without dispatching exchange', () => {
  const { session, controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });

  elements.get('btn-exchange').fireClick();
  elements.get('exch-cancel').fireClick();

  assert.ok(elements.get('ov-exch').classList.contains('hidden'));
  assert.equal(session.state.currentTurnSlot, 0);
});

test('mount: score values reflect view-model on initial render', () => {
  const { session, controller } = fresh();
  session.state.scores = { 0: 12, 1: 8 };
  controller.view.scores = { 0: 12, 1: 8 };
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  assert.equal(elements.get('sv1').textContent, '12');
  assert.equal(elements.get('sv2').textContent, '8');
  assert.equal(elements.get('is-sv1').textContent, '12');
  assert.equal(elements.get('is-sv2').textContent, '8');
});

test('mount: active slot gets the "act" class on its score box', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  // Initial: slot 0 active
  assert.ok(elements.get('sb1').classList.contains('act'));
  assert.ok(!elements.get('sb2').classList.contains('act'));
});

test('mount: bag count + move counter render', () => {
  const { session, controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  // engineState.bag length is whatever is left after drawing 8+8 tiles
  const expected = String(session.state.bag.length);
  assert.equal(elements.get('bag-count-text').textContent, expected);
  assert.equal(elements.get('lcd').textContent, '01');
});

test('renderer reacts to MOVE_CONFIRMED — score updates, status bar resets', async () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  controller.placeTile({ r: 4, c: 5, letter: 'ב', val: 3 });
  controller.confirmMove();
  // The score now count-up animates from 0 → 4 (chip-arrival delay + ease).
  // Wait long enough for the tween to settle, then assert on the final text.
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal(elements.get('sv1').textContent, '4');
});

test('renderer reflects INVALID_MOVE_REJECTED reason in #sbar', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  controller.placeTile({ r: 4, c: 4, letter: 'ת', val: 4 });
  controller.confirmMove(); // 'ת' alone — word-too-short
  assert.equal(elements.get('sbar').textContent, 'המילה חייבת להיות לפחות 2 אותיות!');
});

test('lock inventory click then board click places a spine lock', () => {
  const { session, controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });

  const lockButton = elements.get('lock-inv-display').children[1];
  lockButton.fireClick();
  elements.get('game-grid').fireClick(elements.get('c4_4'));

  assert.equal(session.state.currentTurnSlot, 1);
  assert.deepEqual(session.state.lockInventory[0], [3, 5]);
  assert.equal(session.state.lockedCells[0].r, 4);
  assert.equal(session.state.lockedCells[0].c, 4);
  assert.ok(elements.get('c4_4').classList.contains('spine-lock-cell'));
});

test('cell click via grid delegation places the selected rack tile', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  // Click semantics for placed-this-turn tiles: first click selects, second
  // click on the same cell recalls. This test verifies the grid delegation
  // routes (r,c) correctly to onCellClick and that the second click recalls.
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  const cell = elements.get('c4_4');
  // First click: select. Placement still pending.
  elements.get('game-grid').fireClick(cell);
  assert.equal(controller.view.placed.length, 1, 'first click should select, not recall');
  // Second click on the same tile: recall.
  elements.get('game-grid').fireClick(cell);
  assert.equal(controller.view.placed.length, 0, 'second click on the selected tile should recall it');
});

test('selected placed tile: clicking an empty cell moves the tile', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  controller.placeTile({ r: 4, c: 4, letter: 'א', val: 1 });
  // First click selects the placed tile.
  elements.get('game-grid').fireClick(elements.get('c4_4'));
  // Click an empty cell — the tile should move there.
  elements.get('game-grid').fireClick(elements.get('c4_5'));
  assert.equal(controller.view.placed.length, 1, 'still exactly one pending placement');
  const p = controller.view.placed[0];
  assert.equal(p.r, 4);
  assert.equal(p.c, 5, 'tile coords should have moved to the empty cell');
  assert.equal(p.letter, 'א');
});

test('joker: clicking a cell with a "?" rack tile opens the picker and commits on PICKED', () => {
  const { session, controller } = fresh();
  // Force rack[0][0] to be a joker
  session.state.racks[0][0] = '?';
  controller.view.rackForMe = [...session.state.racks[0]];
  const { root, elements } = makeGameDom();

  // Stub joker picker
  let opened = 0;
  const jokerPicker = { open: () => { opened++; } };

  const screen = mountGameScreen({ controller, root, jokerPicker, bus });

  // Manually select rack index 0 (we don't have a real rack tile click in
  // the stub DOM; the controller-side path is exercised directly).
  // The screen's onCellClick path requires selectedRackIndex !== null,
  // so we hijack by simulating the rack-delegated click:
  const rackTile = { classList: { contains: () => false }, closest: () => rackTile };
  // Place rackTile as the first child of #brack so indexOf returns 0
  Object.defineProperty(elements.get('brack'), 'children', { value: [rackTile], configurable: true });
  elements.get('brack').fireClick(rackTile);

  // Now click cell (4,4)
  elements.get('c4_4').fireClick(elements.get('c4_4'));
  // Wait, the cell-click delegation path expects e.target to be inside grid;
  // simpler to fire on grid level with target=cell
  elements.get('game-grid').fireClick(elements.get('c4_4'));

  assert.equal(opened, 1, 'jokerPicker.open should have been called');

  // Now simulate the user picking 'מ'
  bus.emit('joker/picked', { letter: 'מ' });

  // The placement should now be in the controller's view as a joker tile
  const placed = controller.view.placed[0];
  assert.ok(placed, 'a placement should have been made');
  assert.equal(placed.letter, 'מ');
  assert.equal(placed.isJoker, true);
  assert.equal(placed.val, 0);

  screen.unmount();
});

test('joker: cancelling the picker leaves no placement and clears subs', () => {
  const { session, controller } = fresh();
  session.state.racks[0][0] = '?';
  controller.view.rackForMe = [...session.state.racks[0]];
  const { root, elements } = makeGameDom();
  let opened = 0;
  const jokerPicker = { open: () => { opened++; } };
  const screen = mountGameScreen({ controller, root, jokerPicker, bus });

  // Select joker, click cell
  const rackTile = { classList: { contains: () => false }, closest: () => rackTile };
  Object.defineProperty(elements.get('brack'), 'children', { value: [rackTile], configurable: true });
  elements.get('brack').fireClick(rackTile);
  elements.get('game-grid').fireClick(elements.get('c4_4'));
  assert.equal(opened, 1);

  // User cancels
  bus.emit('joker/cancelled');

  // No placement should have been made
  assert.equal(controller.view.placed.length, 0);

  // A subsequent PICKED should NOT cause a placement (subs were cleared)
  bus.emit('joker/picked', { letter: 'מ' });
  assert.equal(controller.view.placed.length, 0);

  screen.unmount();
});

test('joker: unmount clears any pending joker subscription', () => {
  const { session, controller } = fresh();
  session.state.racks[0][0] = '?';
  controller.view.rackForMe = [...session.state.racks[0]];
  const { root, elements } = makeGameDom();
  const jokerPicker = { open: () => {} };
  const screen = mountGameScreen({ controller, root, jokerPicker, bus });

  // Open picker
  const rackTile = { classList: { contains: () => false }, closest: () => rackTile };
  Object.defineProperty(elements.get('brack'), 'children', { value: [rackTile], configurable: true });
  elements.get('brack').fireClick(rackTile);
  elements.get('game-grid').fireClick(elements.get('c4_4'));

  // Unmount BEFORE the user picks
  screen.unmount();

  // Late PICKED shouldn't cause a placement on the disposed controller
  bus.emit('joker/picked', { letter: 'מ' });
  assert.equal(controller.view.placed.length, 0);
});

test('unmount: leaves action button onclick attributes stripped', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  const screen = mountGameScreen({ controller, root });
  screen.unmount();
  assert.equal(elements.get('btn-play').getAttribute('onclick'), null);
  assert.equal(elements.get('btn-recall').getAttribute('onclick'), null);
});

test('direction buttons update controller state and H/V indication', () => {
  const { controller } = fresh();
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root });
  assert.ok(elements.get('bh').classList.contains('a'));
  elements.get('bv').fireClick();
  assert.equal(controller.view.placementDirection, 'V');
  assert.ok(elements.get('bv').classList.contains('a'));
  assert.ok(!elements.get('bh').classList.contains('a'));
  elements.get('bh').fireClick();
  assert.equal(controller.view.placementDirection, 'H');
  assert.ok(elements.get('bh').classList.contains('a'));
});

test('live preview emits local tentative tiles for online player', () => {
  const { session } = fresh();
  const controller = createGameController({ bus, session, mySlot: 0 });
  const { root } = makeGameDom();
  const previews = [];
  bus.on(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, p => previews.push(p));
  mountGameScreen({ controller, root, bus });
  previews.length = 0;

  controller.placeTile({ r: 4, c: 4, letter: '׳', val: 1 });

  assert.deepEqual(previews.at(-1), {
    slot: 0,
    tiles: [{ r: 4, c: 4, letter: '׳', val: 1, isJoker: false }],
  });
});

test('live preview renders opponent ghost tiles', () => {
  const { session } = fresh();
  const controller = createGameController({ bus, session, mySlot: 0 });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, root, bus });

  session.state.livePreview = {
    slot: 1,
    tiles: [{ r: 5, c: 6, letter: '׳˜', val: 1, isJoker: false }],
  };
  bus.emit(EV.LIVE_PREVIEW_CHANGED, { livePreview: session.state.livePreview });

  assert.ok(elements.get('c5_6').classList.contains('spine-live-preview'));
  assert.match(elements.get('c5_6').innerHTML, /׳˜/);
});

test('animation renderer lights word tiles, floats score, and flashes score panel', async () => {
  const { controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });

  bus.emit(EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 4, c: 4, letter: 'א', val: 1 }],
    words: ['א'],
    wordTiles: [[{ r: 4, c: 4, letter: 'א', val: 1 }]],
    score: 1,
  });

  // Score-merge sequence: sum chip plants at the word, the word's +N
  // chip flies into the sum, then after a hold the sum flies into the
  // player panel. Timing for one word + no bonus extra:
  //   merge end  = 0 + 380 ms        (single word's flight)
  //   hold       = 420 ms
  //   sum flight = 480 ms
  //   → sum lands ~1280 ms after MOVE_CONFIRMED.
  assert.ok(elements.get('c4_4').classList.contains('scoring-word-glow'));
  await new Promise(r => setTimeout(r, 200));
  assert.ok(
    elements.get('body').children.some(el => el.classList.contains('scoring-float-label')),
    'the +TOTAL sum chip should be in the overlay during the merge sequence',
  );
  // score-pop fires when the sum chip lands (~1280 ms) and lingers ~500
  // ms. Sample inside that window.
  await new Promise(r => setTimeout(r, 1200));
  assert.ok(elements.get('sv1').classList.contains('score-pop'),
    'sv1 should receive score-pop once the sum chip arrives');
  animationController.dispose();
});

test('animation renderer applies tile-place-in and is-valid on MOVE_CONFIRMED', () => {
  const { controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });

  bus.emit(EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 3, c: 3, letter: 'א', val: 1 }],
    words: ['א'],
    wordTiles: [[{ r: 3, c: 3, letter: 'א', val: 1 }]],
    score: 1,
  });

  assert.ok(elements.get('c3_3').classList.contains('tile-place-in'),
    'placed cell should receive tile-place-in');
  assert.ok(elements.get('c3_3').classList.contains('is-valid'),
    'placed cell should receive is-valid (valid word flash)');
  animationController.dispose();
});

test('animation renderer adds illegal-tile + is-invalid then rollback-pop on INVALID_MOVE_REJECTED', async () => {
  const { controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });

  bus.emit(EV.INVALID_MOVE_REJECTED, {
    reason: 'word-not-in-dictionary',
    placed: [{ r: 2, c: 2, letter: 'א', val: 1 }],
    invalidWords: ['אא'],
  });

  // Immediately: illegal-tile is on the cell, is-invalid is on the .btile target.
  assert.ok(elements.get('c2_2').classList.contains('illegal-tile'),
    'cell should receive illegal-tile');
  assert.ok(elements.get('c2_2').classList.contains('is-invalid'),
    'tile target (cell fallback) should receive is-invalid');

  // After 700ms the rollback-pop kicks in and illegal-tile is removed.
  await new Promise(r => setTimeout(r, 720));
  assert.ok(!elements.get('c2_2').classList.contains('illegal-tile'),
    'illegal-tile should be removed before rollback');
  assert.ok(elements.get('c2_2').classList.contains('rollback-pop'),
    'rollback-pop should briefly flash on the cell');
  animationController.dispose();
});

test('TURN_CHANGED eventually swaps .act to the new player\'s box (after the count-up hold)', () => {
  const { session, controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });
  // Mirror the engine flow: state must reflect the new turn before
  // TURN_CHANGED fires (gameController.syncFromState reads from state).
  session.state.currentTurnSlot = 1;
  session.state.turnNumber = 2;
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 2 });
  // Glow stays on the previous slot until the count-up settles. Single-
  // word delay = 560 + 900 ≈ 1460 ms.
  assert.ok(!elements.get('sb2').classList.contains('act'),
    'glow should be held on the previous slot during the count-up');
  return new Promise(resolve => setTimeout(() => {
    assert.ok(elements.get('sb2').classList.contains('act'),
      'after the count-up settles the glow swaps to the new active slot');
    animationController.dispose();
    resolve();
  }, 1600));
});

test('animation renderer flashes score-panel-arrive on GAME_COMPLETED', () => {
  const { controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });

  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 0 });

  assert.ok(elements.get('sb1').classList.contains('score-panel-arrive'),
    'winner score box should receive score-panel-arrive');
  animationController.dispose();
});

test('animation renderer floats a BINGO label when all 8 tiles are placed', () => {
  const { controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });

  const placed = Array.from({ length: 8 }, (_, i) => ({ r: 5, c: i, letter: 'א', val: 1 }));
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed, words: ['אאאאאאאא'], wordTiles: [placed], score: 58 });

  const bingo = elements.get('body').children.find(el => el.classList.contains('bingo-label'));
  assert.ok(bingo, 'a bingo-label floating element should be appended to <body>');
  assert.match(bingo.textContent, /BINGO/);
  animationController.dispose();
});

test('animation renderer flashes bonus square and boost panel', () => {
  const { controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });

  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'auto_extra_score', bonusIdx: 3 });

  assert.ok(elements.get('bsq-3').classList.contains('bonus-activate'));
  assert.ok(elements.get('scn1').classList.contains('boost-pulse'));
  animationController.dispose();
});

test('animation renderer bounces bag and cascades rack on exchange', () => {
  const { controller } = fresh();
  const animationController = createAnimationController({ bus, mySlot: null });
  const { root, elements } = makeGameDom();
  mountGameScreen({ controller, animationController, root });

  bus.emit(EV.TILES_EXCHANGED, { count: 2 });

  assert.ok(elements.get('bag-display').classList.contains('bag-bounce'));
  assert.match(elements.get('brack').innerHTML, /anim-in/);
  animationController.dispose();
});

console.log = _origLog;
