// avatarStoreScreen — wires #savatar-store (the store, "חנות"), plus the purchase-confirm
// (#ov-store-confirm) and daily-reward (#ov-daily-reward) overlays. The catalog lives
// in game/account/boostieCatalog.js and the coin transactions in profileService.js;
// this module is DOM + bus only.
//
// Three tabs (.store-tab / #store-panel-<tab>): avatars, skins (app colour palettes,
// skinCatalog.js — try on for 30 s, buy, use) and coins (packs for real money, COIN_PACKS).
//
// The avatars tab has two sections (D-boostie-xp):
//   Boosties  — owned ones show their level, an XP bar and the next form; locked ones
//               unlock free when a Boostie reaches level 7, or for coins.
//   Reactions — the free set is always owned; the rest are bought for coins. Tapping a
//               tile (owned or not) plays it on your equipped Boostie in the preview
//               stage (#store-rx-preview): live 3D where the scoreboard would run it,
//               otherwise the still with the reaction's emoji.
// Tapping a Boostie card (not its buttons) brings that Boostie to life in its card for
// CARD_PREVIEW_MS — locked ones too, in full colour — so the player gets a feel for it.
//
// Render with STORE_RENDER { coins, boosties, equippedAvatar, ownedReactions, ownedSkins }
// (the skin in use arrives with SKIN_CHANGED from skinController.js); the coin
// packs' Play prices with STORE_COIN_PRICES { prices }; the rewarded-video card with
// STORE_ADS { left, coins } (left = videos still allowed today; null hides the card,
// outside the Android app). Clicks emit:
//   STORE_INTENT.EQUIP            { id }    — owned Boostie → equip it
//   EVO_SHOW                { id, from, to } — replay the latest evolution (evolutionScreen)
//   STORE_INTENT.CONFIRM_PURCHASE { id }    — confirmed buy, id = 'boostie:bubo' | 'reaction:wink' | 'skin:stone'
//   STORE_INTENT.TRY_SKIN         { id }    — "נסו עכשיו": a 30-second try-on of skin id
//   STORE_INTENT.USE_SKIN         { id }    — an owned skin's "הפעלה"
//   STORE_INTENT.BUY_COINS        { id }    — coin pack tapped, id = COIN_PACKS key
//   STORE_INTENT.WATCH_AD                   — "watch a video" card tapped (videos left)
//   STORE_INTENT.CLOSE                      — back to where the store was opened from
// main.js performs the purchase and re-emits STORE_RENDER (the profile watch).

import { $, on, setText } from '../domHelpers.js';
import { COIN_ICON_HTML } from './coinIcon.js';
import {
  BOOSTIES, CHAIN_ORDER, STARTER_BOOSTIES, BOOSTIE_LEVELS, BOOSTIE_REACTIONS,
  boostieStillSrc, ownsReaction, parseStoreItem,
} from '../../game/account/boostieCatalog.js';
import { SKINS, SKIN_IDS, DEFAULT_SKIN, ownsSkin, isSkinId } from '../../game/account/skinCatalog.js';
import { SKIN_CHANGED } from '../skinController.js';
import { normalizeBoosties, progressToNext, equippedBoostie } from '../../game/account/boostieXp.js';
import { EVO_SHOW } from '../boostie3d/evolutionData.js';
import { createScoreboardLive } from '../boostie3d/scoreboardLive.js';
import { COIN_PACKS } from '../../game/account/economy.js';

export const STORE_INTENT = Object.freeze({
  OPEN:             'store/open',
  EQUIP:            'store/equip',
  PURCHASE:         'store/purchase',         // tile tapped → open confirm
  CONFIRM_PURCHASE: 'store/confirmPurchase',  // confirm button → run the buy
  CANCEL_PURCHASE:  'store/cancelPurchase',
  BUY_COINS:        'store/buyCoins',         // coin pack for real money
  WATCH_AD:         'store/watchAd',          // rewarded video for coins (Android app)
  TRY_SKIN:         'store/trySkin',          // 30-second skin try-on
  USE_SKIN:         'store/useSkin',          // switch to an owned skin
  CLOSE:            'store/close',
});

export const STORE_RENDER = 'store/render';
export const STORE_COIN_PRICES = 'store/coinPrices';   // { prices } from Google Play
export const STORE_ADS = 'store/ads';                   // { left, coins } rewarded videos

export const DAILY_REWARD_SHOW = 'dailyReward/show';
export const DAILY_REWARD_ACK  = 'dailyReward/ack';

const FALLBACK_AVATAR_SRC = 'assets/avatars/anonymous player.png';
const PREVIEW_IDLE_MS = 8000;   // the stage closes (and frees its 3D) after this long idle
const CARD_PREVIEW_MS = 6500;   // a tapped Boostie card stays alive this long
const CARD_GOOD_AT_MS = 3200;   // …and does a second gesture about halfway

export const STORE_TABS = Object.freeze(['avatars', 'skins', 'coins']);

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
    ownedSkins: Array.isArray(next.ownedSkins) ? next.ownedSkins : [],
    activeSkin: isSkinId(next.activeSkin) ? next.activeSkin : DEFAULT_SKIN,
  };
}

const fmtCoins = (n) => (Number(n) || 0).toLocaleString('en-US');

// The arches of the Stone skin's limestone wall (store art, buy medallion, home decor).
const WALL_PATH = 'M0 50 L0 10 L366 10 L366 50 Z M30 50 L30 34 A14 14 0 0 1 58 34 L58 50 Z M120 50 L120 32 A16 16 0 0 1 152 32 L152 50 Z M214 50 L214 32 A16 16 0 0 1 246 32 L246 50 Z M308 50 L308 34 A14 14 0 0 1 336 34 L336 50 Z';

// The skin's preview art: a strip of board in its own colours. Styled per
// [data-skin-art] in screens-glass.css, so the card shows the skin whatever skin is on.
function skinArtHtml(id) {
  const cells = ['b', '', '', '', '', '', 'b', '', 't', 't', 't', 'tp', 'tp', '', '', '', '', '', '', '', ''];
  const letters = { 8: 'ש', 9: 'מ', 10: 'ש', 11: 'ו', 12: 'ת' };
  return `<div class="skp" data-skin-art="${id}" aria-hidden="true">`
    + `<svg class="skp-wall" viewBox="0 0 366 50" preserveAspectRatio="none"><path d="${WALL_PATH}" fill-rule="evenodd"/></svg>`
    + `<div class="skp-board" dir="ltr">${cells.map((c, i) => `<span class="skp-c${c ? ` skp-${c}` : ''}">${letters[i] ?? ''}</span>`).join('')}</div>`
    + `</div>`;
}

function skinSwatchesHtml(s) {
  return `<span class="skin-sw" aria-hidden="true">${s.swatches.map((c) => `<span style="background:${c}"></span>`).join('')}</span>`;
}

// One skin card. Paid + unowned: "נסו עכשיו" + price; owned: "הפעלה" or "בשימוש".
export function skinCardHtml(id, state) {
  const s = SKINS[id];
  const owned = ownsSkin(id, state.ownedSkins);
  const inUse = state.activeSkin === id;
  const info = `<div class="skin-info"><span class="skin-name">${escapeHtml(s.name)}</span>`
    + `<span class="skin-desc">${escapeHtml(s.desc)}</span></div>${skinSwatchesHtml(s)}`;
  const useOrOn = inUse
    ? '<span class="skin-tag is-on">בשימוש ✓</span>'
    : `<button class="bst-btn skin-use" data-store-action="useskin" data-store-id="${id}">הפעלה</button>`;
  if (s.price === 0) {
    return `<div class="skin-card skin-card--row${inUse ? ' is-on' : ''}" data-skin-card="${id}">`
      + `<div class="skin-thumb" data-skin-art="${id}" aria-hidden="true"><span></span><span></span><span></span></div>`
      + `<div class="skin-row-mid">${info}</div>${useOrOn}</div>`;
  }
  const canBuy = state.coins >= s.price;
  const tag = owned ? '' : `<span class="skin-new">חדש${s.light ? ' · ערכה בהירה' : ''}</span>`;
  const actions = owned ? useOrOn
    : `<button class="bst-btn skin-try" data-store-action="tryskin" data-store-id="${id}"><svg class="gi" aria-hidden="true"><use href="#gi-eye"/></svg>נסו עכשיו</button>`
      + `<button class="bst-btn bst-btn--buy skin-buy${canBuy ? '' : ' is-short'}" data-store-action="${canBuy ? 'buy' : 'tooexpensive'}" data-store-id="skin:${id}">${COIN_ICON_HTML}<span class="g-num">${fmtCoins(s.price)}</span></button>`;
  return `<div class="skin-card skin-card--hero${inUse ? ' is-on' : ''}${owned ? ' is-owned' : ''}" data-skin-card="${id}">`
    + tag + skinArtHtml(id)
    + `<div class="skin-head">${info}</div>`
    + `<div class="skin-actions">${actions}</div></div>`;
}

// Paid skins first (the featured card), then Classic, then the "more soon" slot.
export function skinsHtml(state) {
  const paid = SKIN_IDS.filter((id) => SKINS[id].price > 0);
  const free = SKIN_IDS.filter((id) => SKINS[id].price === 0);
  return '<div class="skin-lead">צבעו את כל האפליקציה — הלוח, האריחים והמסכים</div>'
    + [...paid, ...free].map((id) => skinCardHtml(id, state)).join('')
    + '<div class="skin-soon"><svg class="gi" aria-hidden="true"><use href="#gi-lock"/></svg>ערכות נוספות בקרוב</div>';
}

// The buy sheet's medallion for a skin: the limestone arches under a sun.
export function skinMedalHtml(id) {
  return `<span class="store-confirm-skin" data-skin-art="${id}" aria-hidden="true">`
    + '<svg viewBox="0 0 48 48"><path d="M8 40 L8 22 L40 22 L40 40 Z M14 40 L14 32 A5 5 0 0 1 24 32 L24 40 Z M27 40 L27 32 A5 5 0 0 1 37 32 L37 40 Z" fill="#f3e6cc" fill-rule="evenodd"/>'
    + '<path d="M8 22 L8 18 L13 18 L13 15 L18 15 L18 18 L30 18 L30 15 L35 15 L35 18 L40 18 L40 22 Z" fill="#f3e6cc"/>'
    + '<circle cx="36" cy="9" r="4" fill="#ffd57a"/></svg></span>';
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

// Coin packs for real money. The price is set in the Play Console (per country) and
// arrives with STORE_COIN_PRICES { prices: { coins_500: '9.90 ₪', … } } inside the
// Android app; until then (or in a browser) the card shows the coins only.
// Each pack has its own bag (small → large); an unknown pack shows the single coin.
export const COIN_PACK_ICON = Object.freeze({
  coins_500:  'assets/rewards/coin pack 500.png',
  coins_1200: 'assets/rewards/coin pack 1200.png',
  coins_3000: 'assets/rewards/coin pack 3000.png',
});

export function coinPacksHtml(packs = COIN_PACKS, prices = {}) {
  return `<div class="coin-packs">${Object.entries(packs).map(([id, p]) => (
    `<button class="coin-pack" data-store-action="coins" data-store-id="${escapeHtml(id)}">`
    + (COIN_PACK_ICON[id] ? `<img src="${COIN_PACK_ICON[id]}" class="coin-pack-img" alt="">` : COIN_ICON_HTML)
    + `<span class="coin-pack-n g-num">${Number(p.coins) || 0}</span>`
    + `<span class="coin-pack-l">מטבעות</span>`
    + (prices?.[id] ? `<span class="coin-pack-price" dir="ltr">${escapeHtml(prices[id])}</span>` : '')
    + `</button>`
  )).join('')}</div>`;
}

// The rewarded-video card: "+15 coins for a video, 3 left today". left 0 → greyed out
// until tomorrow; left null → no card (a browser, or a guest).
export function adCardHtml({ left = null, coins = 0 } = {}) {
  if (left == null) return '';
  const n = Math.max(0, Math.floor(Number(left) || 0));
  return `<button class="store-ad${n ? '' : ' is-done'}" data-store-action="ad"${n ? '' : ' disabled'}>`
    + `<span class="store-ad-play" aria-hidden="true">▶</span>`
    + `<span class="store-ad-t">צפו בסרטון קצר</span>`
    + `<span class="store-ad-c">+${Number(coins) || 0} ${COIN_ICON_HTML}</span>`
    + `<span class="store-ad-left">${n ? `נותרו ${n} היום` : 'חוזר מחר'}</span>`
    + `</button>`;
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
  const tabs      = [...(root?.querySelectorAll?.('.store-tab') ?? [])];
  const coinsEl   = $('#store-coins', root);
  const adEl      = $('#store-ad', root);
  const skinsEl   = $('#store-skins', root);

  // Confirm overlay elements.
  const confirmOv    = $('#ov-store-confirm', root);
  const confirmImg   = $('#store-confirm-avatar', root);
  const confirmPrice = $('#store-confirm-price', root);
  const confirmYes   = $('#store-confirm-yes', root);
  const confirmNo    = $('#store-confirm-no', root);
  const confirmTitle = $('#store-confirm-title', root);
  const confirmDesc  = $('#store-confirm-desc', root);
  const confirmAfter = $('#store-confirm-after', root);

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
  let cardLive = null;  // the tapped Boostie card's live 3D
  let cardToken = 0;
  let cardTimers = [];
  let cardEl = null;

  if (coinsEl) coinsEl.innerHTML = coinPacksHtml();

  function paintSkins() {
    if (skinsEl) skinsEl.innerHTML = skinsHtml(state);
  }

  function paint(next = {}) {
    state = normalizeStoreState({ activeSkin: state.activeSkin, ...next });
    if (balanceEl) setText(balanceEl, String(state.coins));
    paintSkins();
    if (!grid) return;
    closeCardPreview();   // the card it lived in is about to be replaced
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
    const skin = it.kind === 'skin' ? SKINS[it.id] : null;
    if (confirmImg) {
      const mine = equippedBoostie(state);
      confirmImg.innerHTML = it.kind === 'boostie'
        ? `<img src="${boostieStillSrc(it.id, 1, 'full')}" alt="" class="store-confirm-img">`
        : skin ? skinMedalHtml(it.id)
        : `<img src="${boostieStillSrc(mine.id, mine.level)}" alt="" class="store-confirm-img">`
          + `<span class="store-confirm-rx" aria-hidden="true">${REACTION_ICON[it.id] ?? ''}</span>`;
    }
    // The sheet reads differently for a skin (bought and switched on in one go).
    confirmOv?.classList?.toggle('is-skin', !!skin);
    if (confirmTitle) setText(confirmTitle, skin ? `לקנות את ${skin.name}?`
      : it.kind === 'boostie' ? 'לרכוש את האווטאר?' : 'לרכוש את התגובה?');
    if (confirmDesc) setText(confirmDesc, skin
      ? `${skin.light ? 'ערכה בהירה' : 'ערכה'} לכל המסכים, הלוח והאריחים. אפשר לחזור לקלאסי בכל רגע.` : '');
    if (confirmAfter) confirmAfter.innerHTML = `${fmtCoins(Math.max(0, state.coins - it.price))} ${COIN_ICON_HTML}`;
    if (confirmPrice) confirmPrice.innerHTML = `${fmtCoins(it.price)} ${COIN_ICON_HTML}`;
    if (confirmYes) confirmYes.innerHTML = skin ? 'קנייה והפעלה' : 'קנה';
    if (confirmNo) setText(confirmNo, skin ? 'לא עכשיו' : 'ביטול');
    confirmOv?.classList?.remove('hidden');
  }
  // ---------- reaction preview ----------
  // Plays reaction `id` on the equipped Boostie. Resolves true when the 3D played it.
  async function previewReaction(id) {
    const r = BOOSTIE_REACTIONS.find((x) => x.id === id);
    if (!r || !previewEl) return false;
    closeCardPreview();   // one live 3D at a time
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

  // ---------- Boostie card preview ----------
  // Brings the tapped card's Boostie to life: its signature move, a second gesture,
  // eyes and head moving in between; back to the still after CARD_PREVIEW_MS.
  async function previewCard(id) {
    const card = grid?.querySelector?.(`.bst-card[data-boostie="${id}"]`);
    const stage = card?.querySelector?.('.bst-stage');
    if (!BOOSTIES[id] || !stage || prefersReducedMotion()) return false;
    if (card === cardEl && cardLive) return true;   // already alive
    closeCardPreview();
    closePreview();       // one live 3D at a time
    const token = ++cardToken;
    cardEl = card;
    card.classList?.add('is-alive');
    const level = state.boosties[id] ? progressToNext(state.boosties[id].xp).level : 1;
    cardTimers.push(setTimeout(closeCardPreview, CARD_PREVIEW_MS));
    cardLive = createLive({ hosts: () => [stage], prefersReducedMotion, look: { lively: true, full: true } });
    cardLive.sync([{ id, level }]);
    const ok = await cardLive?.ready(0);
    if (token !== cardToken || !cardLive || !ok) return false;
    if (!cardLive.play(0, 'signature')) cardLive.play(0, 'good');
    cardTimers.push(setTimeout(() => { if (token === cardToken) cardLive?.play(0, 'good'); }, CARD_GOOD_AT_MS));
    return true;
  }
  function closeCardPreview() {
    cardToken++;
    for (const t of cardTimers) clearTimeout(t);
    cardTimers = [];
    cardLive?.dispose();
    cardLive = null;
    cardEl?.classList?.remove('is-alive');
    cardEl = null;
  }

  function selectTab(tab) {
    if (!STORE_TABS.includes(tab)) return;
    closePreview();
    closeCardPreview();
    for (const t of tabs) {
      const on = t.dataset?.tab === tab;
      t.classList?.toggle('on', on);
      t.setAttribute?.('aria-selected', on ? 'true' : 'false');
    }
    for (const id of STORE_TABS) $(`#store-panel-${id}`, root)?.classList?.toggle('on', id === tab);
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
        if (tile) { previewReaction(tile.getAttribute('data-reaction')); return; }
        const card = e.target?.closest?.('[data-boostie]');
        if (card) previewCard(card.getAttribute('data-boostie'));
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

  if (skinsEl) cleanups.push(on(skinsEl, 'click', (e) => {
    const btn = e.target?.closest?.('[data-store-action]');
    const id = btn?.getAttribute('data-store-id');
    if (!id) return;
    const action = btn.getAttribute('data-store-action');
    if (action === 'tryskin') bus.emit(STORE_INTENT.TRY_SKIN, { id });
    else if (action === 'useskin') bus.emit(STORE_INTENT.USE_SKIN, { id });
    else if (action === 'buy') { bus.emit(STORE_INTENT.PURCHASE, { id }); openConfirm(id); }
    else if (action === 'tooexpensive') {
      flashHint(`חסרים לך מטבעות — ${fmtCoins(parseStoreItem(id)?.price)} ${COIN_ICON_HTML} נדרשים`);
    }
  }));
  // The skin in use (or being tried on) changed: relabel the cards.
  cleanups.push(bus.on(SKIN_CHANGED, ({ chosen } = {}) => {
    state = { ...state, activeSkin: isSkinId(chosen) ? chosen : DEFAULT_SKIN };
    paintSkins();
  }));

  for (const t of tabs) cleanups.push(on(t, 'click', () => selectTab(t.dataset?.tab)));
  if (adEl) cleanups.push(on(adEl, 'click', (e) => {
    const btn = e.target?.closest?.('[data-store-action="ad"]');
    if (btn && !btn.disabled) bus.emit(STORE_INTENT.WATCH_AD, {});
  }));
  if (coinsEl) cleanups.push(on(coinsEl, 'click', (e) => {
    const id = e.target?.closest?.('[data-store-action="coins"]')?.getAttribute('data-store-id');
    if (id && COIN_PACKS[id]) bus.emit(STORE_INTENT.BUY_COINS, { id });
  }));

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
  cleanups.push(bus.on(STORE_INTENT.CLOSE, () => { closePreview(); closeCardPreview(); }));
  // Every visit starts on the avatars tab, unless the opener asks for one (Settings →
  // skins, the try-on banner's buy button).
  cleanups.push(bus.on(STORE_INTENT.OPEN, ({ tab } = {}) => selectTab(STORE_TABS.includes(tab) ? tab : 'avatars')));

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
  cleanups.push(bus.on(STORE_COIN_PRICES, ({ prices } = {}) => {
    if (coinsEl) coinsEl.innerHTML = coinPacksHtml(COIN_PACKS, prices);
  }));
  cleanups.push(bus.on(STORE_ADS, (ads = {}) => {
    if (adEl) adEl.innerHTML = adCardHtml(ads);
  }));

  paintSkins();

  return {
    paint,
    openConfirm,
    previewReaction,
    previewCard,
    selectTab,
    unmount() {
      closePreview();
      closeCardPreview();
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
