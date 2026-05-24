import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import {
  mountBoostBadges, summarizeBoostsForSlot, buildBadgeHtml, BB_INTENT,
} from './boostBadges.js';

test('summarizeBoostsForSlot: empty', () => {
  assert.deepEqual(summarizeBoostsForSlot([], 0), []);
});

test('summarizeBoostsForSlot: only mine', () => {
  const boosts = [
    { slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 4 } },
    { slot: 1, boostId: 'multiply_next_turns', payload: { multiplier: 2 } },
  ];
  const mine0 = summarizeBoostsForSlot(boosts, 0);
  assert.equal(mine0.length, 1);
  assert.equal(mine0[0].label, '×4');
});

test('summarizeBoostsForSlot: shows shield + tile-swap', () => {
  const boosts = [
    { slot: 0, boostId: 'cancel_next_opponent_bonus' },
    { slot: 0, boostId: 'free_tile_swap' },
    { slot: 0, boostId: 'extra_turn' },
  ];
  const mine = summarizeBoostsForSlot(boosts, 0);
  const ids = mine.map(b => b.id).sort();
  assert.deepEqual(ids, ['extra-turn', 'shield', 'tile-swap']);
  assert.equal(mine.find(b => b.id === 'tile-swap').clickable, true);
});

test('buildBadgeHtml: empty', () => {
  assert.equal(buildBadgeHtml([]),  '');
  assert.equal(buildBadgeHtml(null), '');
});

test('buildBadgeHtml: includes clickable attr only when set', () => {
  const html = buildBadgeHtml([
    { id: 'multiplier', label: '×2', color: '#e8c840' },
    { id: 'tile-swap',  label: '🔄', color: '#b06bff', clickable: true },
  ]);
  assert.match(html, /data-badge="multiplier"/);
  // Multiplier is NOT clickable
  assert.doesNotMatch(html, /data-badge="multiplier"[^>]*data-clickable/);
  // Tile-swap IS clickable
  assert.match(html, /data-badge="tile-swap"[^>]*data-clickable="1"/);
});

function makePanel() {
  const inner = { className: '', style: { cssText: '' }, innerHTML: '' };
  const created = [];
  let appended = null;
  const ownerDoc = {
    createElement(t) {
      const el = { tagName: t.toUpperCase(), style: { cssText: '' }, className: '', innerHTML: '' };
      created.push(el);
      return el;
    },
  };
  const listeners = [];
  return {
    ownerDocument: ownerDoc,
    appendChild(c) { appended = c; },
    querySelector(sel) { return appended && (`.${appended.className}` === sel) ? appended : null; },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick(target) { for (const l of listeners) if (l.ev === 'click') l.fn({ target }); },
    _appended: () => appended,
  };
}

test('mount: paints initial badges into legacy score panels', () => {
  bus._reset();
  const slot0 = makePanel();
  const slot1 = makePanel();
  const root  = { querySelector: (sel) => sel === '#scn1' ? slot0 : sel === '#scn2' ? slot1 : null };
  const session = {
    state: { activeBoosts: [{ slot: 0, boostId: 'multiply_next_turns', payload: { multiplier: 2 } }] },
  };
  mountBoostBadges({ root, bus, sessionRef: () => session });
  assert.match(slot0._appended().innerHTML, /×2/);
  assert.equal(slot1._appended().innerHTML, '');
});

test('mount: re-paints on EV.BOOST_ACTIVATED', () => {
  bus._reset();
  const slot0 = makePanel();
  const root  = { querySelector: (sel) => sel === '#scn1' ? slot0 : null };
  const state = { activeBoosts: [] };
  mountBoostBadges({ root, bus, sessionRef: () => ({ state }) });
  // Initially empty
  assert.equal(slot0._appended().innerHTML, '');
  // Add a boost and emit
  state.activeBoosts.push({ slot: 0, boostId: 'cancel_next_opponent_bonus' });
  bus.emit(EV.BOOST_ACTIVATED, {});
  assert.match(slot0._appended().innerHTML, /🛡/);
});

test('mount: clicking the tile-swap badge emits BB_INTENT.REDEEM_TILE_SWAP', () => {
  bus._reset();
  const slot0 = makePanel();
  const root  = { querySelector: (sel) => sel === '#scn1' ? slot0 : null };
  const state = { activeBoosts: [{ slot: 0, boostId: 'free_tile_swap' }] };
  let n = 0;
  bus.on(BB_INTENT.REDEEM_TILE_SWAP, () => { n++; });
  mountBoostBadges({ root, bus, sessionRef: () => ({ state }) });

  // Simulate a click on a child element with data-badge="tile-swap"
  const target = { getAttribute: (k) => k === 'data-badge' ? 'tile-swap' : null };
  slot0.fireClick(target);
  assert.equal(n, 1);
});

test('mount: missing panels degrade silently', () => {
  bus._reset();
  const root = { querySelector: () => null };
  const screen = mountBoostBadges({ root, bus, sessionRef: () => ({ state: { activeBoosts: [] } }) });
  screen.unmount();
});

test('throws if bus or sessionRef missing', () => {
  assert.throws(() => mountBoostBadges({ sessionRef: () => ({}) }), /bus required/);
  assert.throws(() => mountBoostBadges({ bus }), /sessionRef required/);
});
