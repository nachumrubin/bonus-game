import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountAvatarStoreScreen, STORE_INTENT, STORE_RENDER,
  DAILY_REWARD_SHOW, dailyDaysHtml,
} from './avatarStoreScreen.js';
import { findReaction } from '../../game/account/boostieCatalog.js';
import { LEVEL_XP } from '../../game/account/boostieXp.js';

function makeEl() {
  return { textContent: '', innerHTML: '', style: { opacity: '0' } };
}
function makeOverlay() {
  const cl = new Set(['hidden']);
  return { classList: { contains: c => cl.has(c), add: c => cl.add(c), remove: c => cl.delete(c) } };
}
function makeBtn() {
  const listeners = [];
  return {
    listeners,
    removeAttribute() {},
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}
function makeGrid() {
  const listeners = [];
  return {
    innerHTML: '',
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    querySelectorAll() { return []; },
    fireClick(target) { for (const l of listeners) if (l.ev === 'click') l.fn({ target }); },
  };
}
function makeStoreRoot() {
  const els = {
    grid: makeGrid(),
    balance: makeEl(),
    hint: makeEl(),
    back: makeBtn(),
    confirmOv: makeOverlay(),
    confirmImg: makeEl(),
    confirmPrice: makeEl(),
    confirmYes: makeBtn(),
    confirmNo: makeBtn(),
    dailyOv: makeOverlay(),
    dailyCoins: makeEl(),
    dailyStreak: makeEl(),
    dailyDays: makeEl(),
    dailyOk: makeBtn(),
  };
  const map = {
    '#store-grid': els.grid,
    '#store-coin-balance': els.balance,
    '#store-hint': els.hint,
    '#store-back-btn': els.back,
    '#ov-store-confirm': els.confirmOv,
    '#store-confirm-avatar': els.confirmImg,
    '#store-confirm-price': els.confirmPrice,
    '#store-confirm-yes': els.confirmYes,
    '#store-confirm-no': els.confirmNo,
    '#ov-daily-reward': els.dailyOv,
    '#daily-reward-coins': els.dailyCoins,
    '#daily-reward-streak': els.dailyStreak,
    '#daily-reward-days': els.dailyDays,
    '#daily-reward-ok': els.dailyOk,
  };
  return { els, root: { querySelector: (sel) => map[sel] ?? null } };
}

// Build a fake click target resolving to a store action button.
function tileTarget(id, action) {
  const btn = { getAttribute: (k) => ({ 'data-store-id': id, 'data-store-action': action }[k] ?? null) };
  return { closest: (sel) => sel === '[data-store-action]' ? btn : null };
}

test('STORE_RENDER: Boostie cards show level, XP bar, next form; both starters are owned', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 300, boosties: { zapi: { xp: LEVEL_XP[2] + 50 } }, equippedAvatar: 'zapi', ownedReactions: [] });

  assert.equal(els.balance.textContent, '300');
  const html = els.grid.innerHTML;
  // owned + equipped Zapi at level 3, its full still, XP toward level 4, next-form bust
  assert.match(html, /bst-card is-owned is-equipped" data-boostie="zapi"/);
  assert.match(html, /boosties\/zapi\/l3_full\.webp/);
  assert.match(html, /שלב 3/);
  assert.match(html, new RegExp(`${LEVEL_XP[2] + 50} / ${LEVEL_XP[3]}`));
  assert.match(html, /boosties\/zapi\/l4_bust\.webp/);
  assert.match(html, /נבחר ✓/);
  // Bubo is a starter: owned, offered for equip, never sold
  assert.match(html, /bst-card is-owned" data-boostie="bubo"/);
  assert.match(html, /data-store-action="equip" data-store-id="bubo"/);
  assert.doesNotMatch(html, /boostie:bubo/);
  // reactions: free set owned, paid ones affordable at 300
  assert.match(html, /rx-tile is-owned" data-reaction="laugh"/);
  assert.match(html, /data-store-action="buy" data-store-id="reaction:wink"/);
});

test('STORE_RENDER: an owned, unequipped Boostie offers equip; top level shows no next form', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 0, boosties: { zapi: { xp: 99999 }, bubo: { xp: 0 } }, equippedAvatar: 'bubo', ownedReactions: ['yawn'] });
  const html = els.grid.innerHTML;
  assert.match(html, /data-store-action="equip" data-store-id="zapi"/);
  assert.match(html, /שלב מקסימלי!/);
  assert.doesNotMatch(html, /zapi\/l8/);
  assert.match(html, /rx-tile is-owned" data-reaction="yawn"/);
});

test('clicking an equip button emits EQUIP', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  const equips = [];
  bus.on(STORE_INTENT.EQUIP, (p) => equips.push(p.id));
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 0, boosties: { zapi: {}, bubo: {} }, equippedAvatar: 'zapi' });
  els.grid.fireClick(tileTarget('bubo', 'equip'));
  assert.deepEqual(equips, ['bubo']);
});

test('clicking an affordable item opens the confirm overlay; confirm emits CONFIRM_PURCHASE', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  const purchases = [];
  const confirms = [];
  bus.on(STORE_INTENT.PURCHASE, (p) => purchases.push(p.id));
  bus.on(STORE_INTENT.CONFIRM_PURCHASE, (p) => confirms.push(p.id));
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 5000, boosties: null, equippedAvatar: null });

  els.grid.fireClick(tileTarget('reaction:wink', 'buy'));
  assert.deepEqual(purchases, ['reaction:wink']);
  assert.equal(els.confirmOv.classList.contains('hidden'), false); // overlay shown
  assert.match(els.confirmImg.innerHTML, /boosties\/zapi\/l1_bust\.webp/);
  assert.match(els.confirmPrice.innerHTML, new RegExp(String(findReaction('wink').price)));
  assert.match(els.confirmPrice.innerHTML, /gold coin\.png/); // coin image, not emoji

  els.confirmYes.fireClick();
  assert.deepEqual(confirms, ['reaction:wink']);
  assert.equal(els.confirmOv.classList.contains('hidden'), true); // closed after confirm
});

test('buying a reaction previews it on your own Boostie', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 5000, boosties: { zapi: { xp: LEVEL_XP[1] } }, equippedAvatar: 'zapi' });
  els.grid.fireClick(tileTarget('reaction:yawn', 'buy'));
  assert.match(els.confirmImg.innerHTML, /boosties\/zapi\/l2_bust\.webp/);
  assert.match(els.confirmImg.innerHTML, /🥱/);
});

test('clicking a too-expensive item shows a hint and does not purchase', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  let purchased = false;
  bus.on(STORE_INTENT.PURCHASE, () => { purchased = true; });
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 10, boosties: null, equippedAvatar: null });
  els.grid.fireClick(tileTarget('reaction:yawn', 'tooexpensive'));
  assert.equal(purchased, false);
  assert.equal(els.hint.style.opacity, '1');
});

test('DAILY_REWARD_SHOW reveals the daily overlay with coins + streak text', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  mountAvatarStoreScreen({ root, bus });
  bus.emit(DAILY_REWARD_SHOW, { coins: 40, streak: 3 });
  assert.equal(els.dailyOv.classList.contains('hidden'), false);
  assert.match(els.dailyCoins.innerHTML, /\+40/);
  assert.match(els.dailyCoins.innerHTML, /gold coin\.png/); // coin image
  assert.match(els.dailyStreak.textContent, /3/);
});

test('DAILY_REWARD_SHOW paints the 7-day strip (got / today / next)', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  mountAvatarStoreScreen({ root, bus });
  const days = [1, 2, 3].map((n, i) => ({ n, coins: 20 + 10 * i, state: ['got', 'today', 'next'][i] }));
  bus.emit(DAILY_REWARD_SHOW, { coins: 30, streak: 2, days });
  const html = els.dailyDays.innerHTML;
  assert.equal((html.match(/class="daily-day[ "]/g) || []).length, 3);
  assert.match(html, /daily-day got" data-day="1"/);
  assert.match(html, /daily-day today" data-day="2"/);
  assert.match(html, /daily-day-c">40</);
});

test('dailyDaysHtml: empty / missing days render nothing', () => {
  assert.equal(dailyDaysHtml(undefined), '');
  assert.equal(dailyDaysHtml([]), '');
});

test('back button emits STORE_INTENT.CLOSE', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  let closed = false;
  bus.on(STORE_INTENT.CLOSE, () => { closed = true; });
  mountAvatarStoreScreen({ root, bus });
  els.back.fireClick();
  assert.equal(closed, true);
});

test('throws if bus missing', () => {
  assert.throws(() => mountAvatarStoreScreen({}), /bus required/);
});

test('store: tapping a reaction tile plays it on the equipped Boostie (owned or not)', async () => {
  const { els, root } = makeStoreRoot();
  const cls = new Set(['hidden']);
  const preview = {
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    querySelector: (sel) => ({ '.srp-av': av, '.srp-still': still, '.srp-cap': cap }[sel] ?? null),
  };
  const av = {}, still = { src: '' }, cap = { innerHTML: '' };
  const map = { '#store-rx-preview': preview };
  const rootWithPreview = { querySelector: (sel) => map[sel] ?? root.querySelector(sel) };
  const played = [];
  const liveCalls = [];
  const fakeLive = {
    sync: (v) => liveCalls.push(['sync', v]),
    ready: async () => true,
    play: (slot, clip) => { played.push([slot, clip]); return true; },
    dispose: () => liveCalls.push(['dispose']),
  };
  const screen = mountAvatarStoreScreen({ root: rootWithPreview, bus, createLive: ({ hosts }) => { liveCalls.push(['create', hosts()[0] === av]); return fakeLive; } });
  bus.emit(STORE_RENDER, { coins: 0, boosties: { bubo: { xp: LEVEL_XP[2] } }, equippedAvatar: 'bubo', ownedReactions: [] });
  const tile = { getAttribute: (k) => (k === 'data-reaction' ? 'yawn' : null) };
  els.grid.fireClick({ closest: (sel) => (sel === '[data-reaction]' ? tile : null) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(cls.has('hidden'), false, 'the stage opens');
  assert.match(still.src, /bubo/);
  assert.match(cap.innerHTML, /🥱/);
  assert.deepEqual(liveCalls.slice(0, 2), [['create', true], ['sync', [{ id: 'bubo', level: 3 }]]]);
  assert.deepEqual(played, [[0, 'yawn']], 'a reaction not yet bought still previews');
  bus.emit(STORE_INTENT.CLOSE, {});
  assert.equal(cls.has('hidden'), true);
  assert.deepEqual(liveCalls.at(-1), ['dispose']);
  screen.unmount();
});
