// avatarStoreScreen — wires #savatar-store (the store), plus the purchase-confirm
// (#ov-store-confirm) and daily-reward (#ov-daily-reward) overlays. The catalog lives
// in game/account/boostieCatalog.js and the coin transactions in profileService.js;
// this module is DOM + bus only.
//
// Two sections (D-boostie-xp):
//   Boosties  — owned ones show their level, an XP bar and the next form; locked ones
//               unlock free when a Boostie reaches level 7, or for coins.
//   Reactions — the free set is always owned; the rest are bought for coins. Tapping a
//               tile (owned or not) plays it on your equipped Boostie in the preview
//               stage (#store-rx-preview): live 3D where the scoreboard would run it,
//               otherwise the still with the reaction's emoji.
//
// Render with STORE_RENDER { coins, boosties, equippedAvatar, ownedReactions }. Clicks emit:
//   STORE_INTENT.EQUIP            { id }    — owned Boostie → equip it
//   EVO_SHOW                { id, from, to } — replay the latest evolution (evolutionScreen)
//   STORE_INTENT.CONFIRM_PURCHASE { id }    — confirmed buy, id = 'boostie:bubo' | 'reaction:wink'
//   STORE_INTENT.CLOSE                      — back to profile
// main.js performs the purchase and re-emits STORE_RENDER (the profile watch).

import { $, on, setText } from '../domHelpers.js';
import { COIN_ICON_HTML } from './coinIcon.js';
import {
  BOOSTIES, CHAIN_ORDER, STARTER_BOOSTIES, BOOSTIE_LEVELS, BOOSTIE_REACTIONS,
  boostieStillSrc, ownsReaction, parseStoreItem,
} from '../../game/account/boostieCatalog.js';
import { normalizeBoosties, progressToNext, equippedBoostie } from '../../game/account/boostieXp.js';
import { EVO_SHOW } from '../boostie3d/evolutionData.js';
import { createScoreboardLive } from '../boostie3d/scoreboardLive.js';

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

const FALLBACK_AVATAR_SRC = 'assets/avatars/anonymous player.png';
const PREVIEW_IDLE_MS = 8000;   // the stage closes (and frees its 3D) after this long idle

// The emoji each Boostie reaction shows where the Boostie is a still.
export const REACTION_ICON = Object.freeze(Object.fromEntries(BOOSTIE_REACTIONS.map((r) => [r.id, r.emoji])));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

// 7-day strip under the daily coins ("got" days dimmed, today lit). Day labels
// show the streak number so the row reads "יום 4" even after the first week.
export function dailyDaysHtml(days) {
  if (!Array.isArray(days) || !days.length) return '';
  return days.map((d) => {
    const cls = d.state === 'got' ? 'got' : d.state === 'today' ? 'today' : '';
    return `<div class="daily-day${cls ? ' ' + cls : ''}" data-day="${Number(d.n) || 0}">`
      + `<span class="daily-day-n">יום ${Number(d.n) || 0}</span>${COIN_ICON_HTML}`
      + `<span class="daily-day-c">${Number(d.coins) || 0}</span></div>`;
  }).join('');
}

export function normalizeStoreState(next = {}) {
  return {
    coins: Math.max(0, Math.floor(Number(next.coins) || 0)),
    boosties: normalizeBoosties(next.boosties),
    equippedAvatar: next.equippedAvatar ?? null,
    ownedReactions: Array.isArray(next.ownedReactions) ? next.ownedReactions : [],
  };
}

function priceButton(item, price, coins) {
  const action = coins >= price ? 'buy' : 'tooexpensive';
  return `<button class="bst-btn bst-btn--buy${action === 'buy' ? '' : ' is-short'}" data-store-action="${action}" data-store-id="${item}">`
    + `${price} ${COIN_ICON_HTML}</button>`;
}

// One Boostie card. `state` is normalizeStoreState output.
export function boostieCardHtml(id, state) {
  const b = BOOSTIES[id];
  const name = escapeHtml(b.name);
  const own = state.boosties[id];
  if (!own) {
    const chain = b.unlock === 'chain'
      ? `<div class="bst-unlock">נפתח בחינם כשבוסטי מגיע לשלב ${BOOSTIE_LEVELS}</div>` : '';
    return `<div class="bst-card is-locked" data-boostie="${id}">`
      + `<div class="bst-stage"><img class="bst-img" src="${boostieStillSrc(id, 1, 'full')}" alt="${name}"></div>`
      + `<div class="bst-info"><div class="bst-name">${name}</div>${chain}`
      + (b.price > 0 ? priceButton(`boostie:${id}`, b.price, state.coins) : '')
      + `</div></div>`;
  }
  const equipped = equippedBoostie(state).id === id;
  const p = progressToNext(own.xp);
  const pct = Math.round(p.ratio * 100);
  const xpLine = p.nextAt == null
    ? '<div class="bst-xp-txt">שלב מקסימלי!</div>'
    : `<div class="bst-xp-txt" dir="ltr"><span class="g-num">${p.xp} / ${p.nextAt}</span> XP</div>`;
  const next = p.level < BOOSTIE_LEVELS
    ? `<div class="bst-next"><img class="bst-next-img" src="${boostieStillSrc(id, p.level + 1)}" alt="">`
      + `<span>הצורה הבאה · שלב ${p.level + 1}</span></div>`
    : '';
  const equipBtn = equipped
    ? '<span class="bst-tag is-equipped">נבחר ✓</span>'
    : `<button class="bst-btn" data-store-action="equip" data-store-id="${id}">בחר</button>`;
  const watch = p.level > 1
    ? `<button class="bst-btn bst-btn--watch" data-store-action="watch" data-store-id="${id}" data-level="${p.level}">▶ התפתחות</button>`
    : '';
  const action = watch ? `<div class="bst-actions">${equipBtn}${watch}</div>` : equipBtn;
  return `<div class="bst-card is-owned${equipped ? ' is-equipped' : ''}" data-boostie="${id}">`
    + `<div class="bst-stage"><img class="bst-img" src="${boostieStillSrc(id, p.level, 'full')}" alt="${name}"></div>`
    + `<div class="bst-info"><div class="bst-name">${name} <span class="bst-lvl">שלב ${p.level}</span></div>`
    + `<div class="bst-xp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">`
    + `<div class="bst-xp-fill" style="width:${pct}%"></div></div>`
    + xpLine + next + action
    + `</div></div>`;
}

export function reactionTileHtml(r, state) {
  const owned = ownsReaction(r.id, state.ownedReactions);
  const footer = owned
    ? `<span class="bst-tag">${r.price === 0 ? 'חינם' : 'שלך ✓'}</span>`
    : priceButton(`reaction:${r.id}`, r.price, state.coins);
  return `<div class="rx-tile${owned ? ' is-owned' : ''}" data-reaction="${r.id}" role="button" tabindex="0" aria-label="${escapeHtml(r.name)} — הצג על הבוסטי שלך">`
    + `<span class="rx-ic" aria-hidden="true">${REACTION_ICON[r.id] ?? ''}</span>`
    + `<span class="rx-name">${escapeHtml(r.name)}</span>${footer}</div>`;
}

export function storeHtml(state) {
  // Starters first, then the locked ones in unlock order.
  const ids = [...STARTER_BOOSTIES, ...CHAIN_ORDER, ...Object.keys(BOOSTIES).filter((id) => !STARTER_BOOSTIES.includes(id) && !CHAIN_ORDER.includes(id))];
  return `<div class="store-section store-section--boosties">`
    + `<div class="store-section-head"><span class="store-section-title">בוסטים</span></div>`
    + `<div class="bst-list">${ids.map((id) => boostieCardHtml(id, state)).join('')}</div></div>`
    + `<div class="store-section store-section--reactions">`
    + `<div class="store-section-head"><span class="store-section-title">תגובות</span></div>`
    + `<div class="rx-grid">${BOOSTIE_REACTIONS.map((r) => reactionTileHtml(r, state)).join('')}</div></div>`;
}

// createLive: the live 3D factory (scoreboardLive; injectable for tests).
export function mountAvatarStoreScreen({
  root = globalThis.document,
  bus,
  prefersReducedMotion = () => false,
  createLive = (opts) => createScoreboardLive(opts),
} = {}) {
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
  const dailyDays   = $('#daily-reward-days', root);
  const dailyOk     = $('#daily-reward-ok', root);

  // Reaction preview stage.
  const previewEl    = $('#store-rx-preview', root);
  const previewAv    = previewEl?.querySelector?.('.srp-av') ?? null;
  const previewStill = previewEl?.querySelector?.('.srp-still') ?? null;
  const previewCap   = previewEl?.querySelector?.('.srp-cap') ?? null;
  const previewClose = previewEl?.querySelector?.('.srp-close') ?? null;

  const cleanups = [];
  // Last render state — the confirm overlay needs it.
  let state = normalizeStoreState({});
  let pendingId = null; // store item awaiting purchase confirmation
  let live = null;      // the preview's live 3D, while the stage is open
  let previewToken = 0;
  let idleTimer = 0;

  function paint(next = {}) {
    state = normalizeStoreState(next);
    if (balanceEl) setText(balanceEl, String(state.coins));
    if (!grid) return;
    grid.innerHTML = storeHtml(state);
    // Still load failure → the generic person icon.
    for (const img of grid.querySelectorAll?.('img.bst-img, img.bst-next-img') ?? []) {
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

  function openConfirm(item) {
    const it = parseStoreItem(item);
    if (!it) return;
    pendingId = item;
    if (confirmImg) {
      const mine = equippedBoostie(state);
      confirmImg.innerHTML = it.kind === 'boostie'
        ? `<img src="${boostieStillSrc(it.id, 1, 'full')}" alt="" class="store-confirm-img">`
        : `<img src="${boostieStillSrc(mine.id, mine.level)}" alt="" class="store-confirm-img">`
          + `<span class="store-confirm-rx" aria-hidden="true">${REACTION_ICON[it.id] ?? ''}</span>`;
    }
    if (confirmPrice) confirmPrice.innerHTML = `${it.price} ${COIN_ICON_HTML}`;
    confirmOv?.classList?.remove('hidden');
  }
  // ---------- reaction preview ----------
  // Plays reaction `id` on the equipped Boostie. Resolves true when the 3D played it.
  async function previewReaction(id) {
    const r = BOOSTIE_REACTIONS.find((x) => x.id === id);
    if (!r || !previewEl) return false;
    const token = ++previewToken;
    const mine = equippedBoostie(state);
    if (previewStill) {
      previewStill.src = boostieStillSrc(mine.id, mine.level);
      previewStill.alt = BOOSTIES[mine.id]?.name ?? '';
    }
    if (previewCap) previewCap.innerHTML = `<span class="srp-emoji" aria-hidden="true">${r.emoji}</span>${escapeHtml(r.name)}`;
    previewEl.classList?.remove('hidden');
    // Re-trigger the emoji pop (shown over the still; hidden while the 3D plays).
    previewEl.classList?.remove('is-pop');
    void previewEl.offsetWidth;
    previewEl.classList?.add('is-pop');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closePreview, PREVIEW_IDLE_MS);
    if (!previewAv || prefersReducedMotion()) return false;
    live ??= createLive({ hosts: () => [previewAv], prefersReducedMotion });
    live.sync([{ id: mine.id, level: mine.level }]);
    const ok = await live.ready(0);
    if (token !== previewToken || !live) return false;
    return ok && live.play(0, r.clip);
  }
  function closePreview() {
    clearTimeout(idleTimer);
    previewToken++;
    live?.dispose();
    live = null;
    previewEl?.classList?.add('hidden');
    previewEl?.classList?.remove('is-pop');
  }

  function closeConfirm() {
    pendingId = null;
    confirmOv?.classList?.add('hidden');
  }

  if (grid) {
    cleanups.push(on(grid, 'click', (e) => {
      const btn = e.target?.closest?.('[data-store-action]');
      if (!btn) {
        const tile = e.target?.closest?.('[data-reaction]');
        if (tile) previewReaction(tile.getAttribute('data-reaction'));
        return;
      }
      const id = btn.getAttribute('data-store-id');
      const action = btn.getAttribute('data-store-action');
      if (!id) return;
      if (action === 'equip')    bus.emit(STORE_INTENT.EQUIP, { id });
      else if (action === 'watch') {
        const to = Number(btn.getAttribute('data-level')) || 0;
        if (to > 1) bus.emit(EVO_SHOW, { id, from: to - 1, to });
      }
      else if (action === 'buy') { bus.emit(STORE_INTENT.PURCHASE, { id }); openConfirm(id); }
      else if (action === 'tooexpensive') {
        flashHint(`חסרים לך מטבעות — ${parseStoreItem(id)?.price ?? ''} ${COIN_ICON_HTML} נדרשים`);
      }
    }));
  }

  if (backBtn) {
    backBtn.removeAttribute?.('onclick');
    cleanups.push(on(backBtn, 'click', (e) => { e?.preventDefault?.(); bus.emit(STORE_INTENT.CLOSE, {}); }));
  }
  if (grid) cleanups.push(on(grid, 'keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tile = e.target?.closest?.('[data-reaction]');
    if (!tile || e.target !== tile) return;
    e.preventDefault?.();
    previewReaction(tile.getAttribute('data-reaction'));
  }));
  if (previewClose) cleanups.push(on(previewClose, 'click', closePreview));
  cleanups.push(bus.on(STORE_INTENT.CLOSE, closePreview));

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
  cleanups.push(bus.on(DAILY_REWARD_SHOW, ({ coins, streak, days } = {}) => {
    if (dailyCoins)  dailyCoins.innerHTML = `+${coins ?? 0} ${COIN_ICON_HTML}`;
    if (dailyStreak) setText(dailyStreak, streak > 1 ? `רצף של ${streak} ימים!` : 'ברוך הבא!');
    if (dailyDays) dailyDays.innerHTML = dailyDaysHtml(days);
    dailyOv?.classList?.remove('hidden');
  }));
  if (dailyOk) cleanups.push(on(dailyOk, 'click', () => {
    dailyOv?.classList?.add('hidden');
    bus.emit(DAILY_REWARD_ACK, {});
  }));

  cleanups.push(bus.on(STORE_RENDER, paint));

  return {
    paint,
    previewReaction,
    unmount() {
      closePreview();
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
