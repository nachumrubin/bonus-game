// avatarStoreScreen — wires #savatar-store (the avatar store), plus the
// purchase-confirm (#ov-store-confirm) and daily-reward (#ov-daily-reward)
// overlays. Pure catalog/economy live in avatarStore.js / profileService.js;
// this module is DOM + bus only.
//
// Render with STORE_RENDER { coins, ownedAvatars, equippedAvatar }. Clicks emit:
//   STORE_INTENT.EQUIP            { id }   — own/free avatar → equip it
//   STORE_INTENT.CONFIRM_PURCHASE { id }   — confirmed buy (main.js does the txn)
//   STORE_INTENT.CLOSE                     — back to profile
// main.js performs the purchase and re-emits STORE_RENDER (the profile watch).

import { $, on, setText } from '../domHelpers.js';
import {
  STORE_CATEGORY_ORDER, CATEGORY_LABELS, STORE_PRICES,
  storeAvatarsByCategory, isOwned, priceFor, COIN_ICON_HTML,
} from './avatarStore.js';

export const STORE_INTENT = Object.freeze({
  OPEN:             'store/open',
  EQUIP:            'store/equip',
  PURCHASE:         'store/purchase',         // tile tapped → open confirm
  CONFIRM_PURCHASE: 'store/confirmPurchase',  // confirm button → run the buy
  CANCEL_PURCHASE:  'store/cancelPurchase',
  CLOSE:            'store/close',
});

export const STORE_RENDER = 'store/render';

export const DAILY_REWARD_SHOW = 'dailyReward/show';
export const DAILY_REWARD_ACK  = 'dailyReward/ack';

const FALLBACK_AVATAR_SRC = 'images/icons/anonymous player.png';

export function mountAvatarStoreScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAvatarStoreScreen: bus required');

  const grid      = $('#store-grid', root);
  const balanceEl = $('#store-coin-balance', root);
  const hintEl    = $('#store-hint', root);
  const backBtn   = $('#store-back-btn', root);

  // Confirm overlay elements.
  const confirmOv    = $('#ov-store-confirm', root);
  const confirmImg   = $('#store-confirm-avatar', root);
  const confirmPrice = $('#store-confirm-price', root);
  const confirmYes   = $('#store-confirm-yes', root);
  const confirmNo    = $('#store-confirm-no', root);

  // Daily-reward overlay elements.
  const dailyOv     = $('#ov-daily-reward', root);
  const dailyCoins  = $('#daily-reward-coins', root);
  const dailyStreak = $('#daily-reward-streak', root);
  const dailyOk     = $('#daily-reward-ok', root);

  const cleanups = [];
  // Last render state — the confirm overlay needs coins/owned to validate.
  let state = { coins: 0, ownedAvatars: [], equippedAvatar: null };
  let pendingId = null; // avatar awaiting purchase confirmation

  function tileHtml(av) {
    const owned = isOwned(av.id, state.ownedAvatars);
    const equipped = av.id === state.equippedAvatar;
    const price = av.price;
    const affordable = state.coins >= price;

    const cls = ['store-tile', `store-tile--${av.category}`];
    let action;
    if (equipped)        { cls.push('is-equipped'); action = 'equip'; }
    else if (owned)      { cls.push('is-owned');    action = 'equip'; }
    else if (affordable) { cls.push('is-buy');      action = 'buy'; }
    else                 { cls.push('is-locked');   action = 'tooexpensive'; }

    let footer;
    if (equipped)      footer = '<span class="store-tile-tag is-equipped">נבחר ✓</span>';
    else if (owned)    footer = '<span class="store-tile-tag">בחר</span>';
    else               footer = `<span class="store-tile-price">${price} ${COIN_ICON_HTML}</span>`;

    return `<button class="${cls.join(' ')}" data-store-id="${av.id}" data-action="${action}">`
      + `<span class="store-tile-av"><img src="${av.src}" alt="" class="store-tile-img"></span>`
      + (owned || equipped ? '' : `<span class="store-tile-lock" aria-hidden="true">${affordable ? '' : '🔒'}</span>`)
      + footer
      + `</button>`;
  }

  function paint(next = {}) {
    state = {
      coins: Math.max(0, Math.floor(Number(next.coins) || 0)),
      ownedAvatars: Array.isArray(next.ownedAvatars) ? next.ownedAvatars : [],
      equippedAvatar: next.equippedAvatar ?? null,
    };
    if (balanceEl) setText(balanceEl, String(state.coins));
    if (!grid) return;

    const byCat = storeAvatarsByCategory();
    let html = '';
    for (const category of STORE_CATEGORY_ORDER) {
      const list = byCat[category] ?? [];
      if (!list.length) continue;
      const label = CATEGORY_LABELS[category] ?? category;
      const priceLabel = STORE_PRICES[category] > 0 ? `${STORE_PRICES[category]} ${COIN_ICON_HTML}` : 'חינם';
      html += `<div class="store-section store-section--${category}">`
        + `<div class="store-section-head"><span class="store-section-title">${label}</span>`
        + `<span class="store-section-price">${priceLabel}</span></div>`
        + `<div class="store-section-grid">${list.map(tileHtml).join('')}</div>`
        + `</div>`;
    }
    grid.innerHTML = html;

    // PNG load failure → swap to the generic person icon.
    for (const img of grid.querySelectorAll?.('.store-tile-img') ?? []) {
      img.onerror = () => { img.src = FALLBACK_AVATAR_SRC; img.onerror = null; };
    }
  }

  // msg may contain the inline coin <img>, so write HTML (messages are static
  // template strings, no user input).
  function flashHint(msg) {
    if (!hintEl) return;
    hintEl.innerHTML = msg;
    hintEl.style.opacity = '1';
    setTimeout(() => { if (hintEl) hintEl.style.opacity = '0'; }, 1800);
  }

  function openConfirm(id) {
    pendingId = id;
    if (confirmImg) confirmImg.innerHTML = `<img src="images/icons/avatars/${id}.png" alt="" class="store-confirm-img">`;
    if (confirmPrice) confirmPrice.innerHTML = `${priceFor(id)} ${COIN_ICON_HTML}`;
    confirmOv?.classList?.remove('hidden');
  }
  function closeConfirm() {
    pendingId = null;
    confirmOv?.classList?.add('hidden');
  }

  if (grid) {
    cleanups.push(on(grid, 'click', (e) => {
      const btn = e.target?.closest?.('button.store-tile');
      if (!btn) return;
      const id = btn.getAttribute('data-store-id');
      const action = btn.getAttribute('data-action');
      if (!id) return;
      if (action === 'equip')        bus.emit(STORE_INTENT.EQUIP, { id });
      else if (action === 'buy')     { bus.emit(STORE_INTENT.PURCHASE, { id }); openConfirm(id); }
      else                           flashHint(`חסרים לך מטבעות — ${priceFor(id)} ${COIN_ICON_HTML} נדרשים`);
    }));
  }

  if (backBtn) {
    backBtn.removeAttribute?.('onclick');
    cleanups.push(on(backBtn, 'click', (e) => { e?.preventDefault?.(); bus.emit(STORE_INTENT.CLOSE, {}); }));
  }

  if (confirmYes) cleanups.push(on(confirmYes, 'click', () => {
    const id = pendingId;
    closeConfirm();
    if (id) bus.emit(STORE_INTENT.CONFIRM_PURCHASE, { id });
  }));
  if (confirmNo) cleanups.push(on(confirmNo, 'click', () => {
    closeConfirm();
    bus.emit(STORE_INTENT.CANCEL_PURCHASE, {});
  }));

  // Daily-reward overlay.
  cleanups.push(bus.on(DAILY_REWARD_SHOW, ({ coins, streak } = {}) => {
    if (dailyCoins)  dailyCoins.innerHTML = `+${coins ?? 0} ${COIN_ICON_HTML}`;
    if (dailyStreak) setText(dailyStreak, streak > 1 ? `רצף של ${streak} ימים!` : 'ברוך הבא!');
    dailyOv?.classList?.remove('hidden');
  }));
  if (dailyOk) cleanups.push(on(dailyOk, 'click', () => {
    dailyOv?.classList?.add('hidden');
    bus.emit(DAILY_REWARD_ACK, {});
  }));

  cleanups.push(bus.on(STORE_RENDER, paint));

  return {
    paint,
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
