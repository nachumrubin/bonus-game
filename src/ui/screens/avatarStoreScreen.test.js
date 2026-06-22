import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountAvatarStoreScreen, STORE_INTENT, STORE_RENDER,
  DAILY_REWARD_SHOW,
} from './avatarStoreScreen.js';
import { STORE_PRICES } from './avatarStore.js';

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
    '#daily-reward-ok': els.dailyOk,
  };
  return { els, root: { querySelector: (sel) => map[sel] ?? null } };
}

// Build a fake click target resolving to a store tile button.
function tileTarget(id, action) {
  const btn = { getAttribute: (k) => ({ 'data-store-id': id, 'data-action': action }[k] ?? null) };
  return { closest: (sel) => sel === 'button.store-tile' ? btn : null };
}

test('STORE_RENDER: paints sections, tile states, and the coin balance', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 300, ownedAvatars: ['rare_1'], equippedAvatar: 'common_2' });

  assert.equal(els.balance.textContent, '300');
  const html = els.grid.innerHTML;
  // common is always owned (free) and common_2 is equipped
  assert.match(html, /data-store-id="common_2"[^>]*data-action="equip"/);
  assert.match(html, /is-equipped"[^>]*data-store-id="common_2"/);
  // owned rare → equip action
  assert.match(html, /data-store-id="rare_1"[^>]*data-action="equip"/);
  // affordable unowned rare (250 ≤ 300) → buy
  assert.match(html, /data-store-id="rare_2"[^>]*data-action="buy"/);
  // epic costs 700 > 300 → too expensive
  assert.match(html, /data-store-id="epic_1"[^>]*data-action="tooexpensive"/);
});

test('clicking an owned/free tile emits EQUIP', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  const equips = [];
  bus.on(STORE_INTENT.EQUIP, (p) => equips.push(p.id));
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 0, ownedAvatars: [], equippedAvatar: null });
  els.grid.fireClick(tileTarget('common_5', 'equip'));
  assert.deepEqual(equips, ['common_5']);
});

test('clicking an affordable tile opens the confirm overlay; confirm emits CONFIRM_PURCHASE', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  const purchases = [];
  const confirms = [];
  bus.on(STORE_INTENT.PURCHASE, (p) => purchases.push(p.id));
  bus.on(STORE_INTENT.CONFIRM_PURCHASE, (p) => confirms.push(p.id));
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 1000, ownedAvatars: [], equippedAvatar: null });

  els.grid.fireClick(tileTarget('epic_3', 'buy'));
  assert.deepEqual(purchases, ['epic_3']);
  assert.equal(els.confirmOv.classList.contains('hidden'), false); // overlay shown
  assert.match(els.confirmPrice.innerHTML, new RegExp(String(STORE_PRICES.epic)));
  assert.match(els.confirmPrice.innerHTML, /gold coin\.png/); // coin image, not emoji

  els.confirmYes.fireClick();
  assert.deepEqual(confirms, ['epic_3']);
  assert.equal(els.confirmOv.classList.contains('hidden'), true); // closed after confirm
});

test('clicking a too-expensive tile shows a hint and does not purchase', () => {
  bus._reset();
  const { els, root } = makeStoreRoot();
  let purchased = false;
  bus.on(STORE_INTENT.PURCHASE, () => { purchased = true; });
  mountAvatarStoreScreen({ root, bus });
  bus.emit(STORE_RENDER, { coins: 10, ownedAvatars: [], equippedAvatar: null });
  els.grid.fireClick(tileTarget('legendary_1', 'tooexpensive'));
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
