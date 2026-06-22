// matchmakingOverlayScreen — Phase 2 polish for #ov-matchmaking.
//
// The lobby's "matchmaking" button only OPENS this overlay; the user then
// picks mode (live/async), timelimit (yes/no), rating range, strict-search,
// and display name before clicking "search". This screen wires those final
// two buttons (#mm-search-btn and the mmCancel button) so that the spine's
// matchmaking flow runs with the user's actual filter selections instead of
// the hard-coded defaults that previously lived in main.js.
//
// Filter state is owned by legacy code (it toggles the `.active` class on
// the buttons via mmSetMode / mmSetTL / mmSetRatingRange). We just READ it
// from the DOM at click time — no duplicated state.
//
// Mode mapping: legacy 'live' / 'async' → spine 'random-live' / 'random-async'.

import { $, on } from '../domHelpers.js';
import { avatarMarkup, setAvatarEl } from './avatarScreens.js';
import { loadUiPreferences } from '../../game/settings/settingsCompat.js';

export const MM_INTENT = Object.freeze({
  SEARCH: 'matchmaking/search',
  CANCEL: 'matchmaking/cancel',
});

function readActiveMode(root) {
  if ($('#mm-mode-async', root)?.classList?.contains('active')) return 'async';
  return 'live'; // default + matches legacy initial state
}

function readBotTime(root) {
  for (const v of [20, 40, 60]) {
    if ($(`#mm-spd-${v}`, root)?.classList?.contains('active')) return v;
  }
  return 40;
}

function readActiveRatingRange(root) {
  for (const v of [100, 200, 500]) {
    if ($(`#mm-rr-${v}`, root)?.classList?.contains('active')) return v;
  }
  return null; // 'any' (or no button active → treat as any)
}

function readStrict(root) {
  const chk = $('#mm-strict-chk', root);
  return chk?.checked !== false; // default true (matches HTML `checked`)
}

function readName(root) {
  const input = $('#mm-name', root);
  const v = input?.value?.trim?.();
  const saved = loadUiPreferences(globalThis.localStorage).lastDisplayName;
  return v && v.length > 0 ? v : saved || null;
}

export function readMatchmakingFilters(root = globalThis.document) {
  const legacyMode = readActiveMode(root);
  return {
    legacyMode,
    spineMode: legacyMode === 'async' ? 'random-async' : 'random-live',
    timelimit: legacyMode === 'live',
    botTime: legacyMode === 'live' ? readBotTime(root) : 0,
    ratingRange: readActiveRatingRange(root),
    strict: readStrict(root),
    name: readName(root),
  };
}

export const PS_INTENT = Object.freeze({
  SHOW:    'partnerSearch/show',
  HIDE:    'partnerSearch/hide',
  MATCHED: 'partnerSearch/matched',
});

const SLOT_PROFILES = [
  { av: 'fire',      nm: 'שרה'   }, { av: 'shark',     nm: 'מרים'  },
  { av: 'diamond',   nm: 'יוסי'  }, { av: 'tiger',     nm: 'רונית' },
  { av: 'fox',       nm: 'נועה'  }, { av: 'bulb',      nm: 'אמיר'  },
  { av: 'handshake', nm: 'גיל'   }, { av: 'dragon',    nm: 'אלי'   },
  { av: 'wizard',    nm: 'תמר'   }, { av: 'shield',    nm: 'ניר'   },
  { av: 'bolt',      nm: 'לילך'  }, { av: 'alien',     nm: 'דוד'   },
  { av: 'robot',     nm: 'משה'   }, { av: 'trophy',    nm: 'עינת'  },
  { av: 'books',     nm: 'דניאל' }, { av: 'hero',      nm: 'אורה'  },
  { av: 'target',    nm: 'ענת'   },
];

const ITEM_H = 68;

function makeItem({ av, nm }) {
  return `<div class="ps-slot-item"><div class="ps-slot-av">${avatarMarkup(av, { fallback: '👑', className: 'av-img' })}</div><div class="ps-slot-nm">${nm}</div></div>`;
}

export function mountPartnerSearchOverlay({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountPartnerSearchOverlay: bus required');

  const ov       = root.getElementById?.('ov-partner-search');
  const myAvEl   = root.getElementById?.('ps-my-avatar');
  const myNmEl   = root.getElementById?.('ps-my-name');
  const reelEl   = root.getElementById?.('ps-slot-reel');
  const slotCard = root.getElementById?.('ps-slot-card');
  const slotLbl  = root.getElementById?.('ps-slot-lbl');
  const cancelBtn = root.getElementById?.('ps-cancel-btn');

  const cleanups = [];

  if (cancelBtn) {
    cleanups.push(on(cancelBtn, 'click', () => bus.emit(MM_INTENT.CANCEL, {})));
  }

  function startSpin() {
    if (!reelEl) return;
    const all = [...SLOT_PROFILES, ...SLOT_PROFILES];
    reelEl.innerHTML = all.map(makeItem).join('');
    const spinDist = SLOT_PROFILES.length * ITEM_H;
    const spinDur  = (SLOT_PROFILES.length * 0.28).toFixed(2);
    reelEl.style.setProperty('--ps-spin-dist', `-${spinDist}px`);
    reelEl.style.setProperty('--ps-spin-dur',  `${spinDur}s`);
    reelEl.style.animation = ''; // clear any inline override from previous stop
    reelEl.classList.remove('ps-landing');
    slotCard?.classList.remove('ps-found');
    void reelEl.offsetHeight; // force reflow so browser picks up the cleared animation
    reelEl.classList.add('ps-spinning');
    if (slotLbl) slotLbl.textContent = 'מחפש...';
  }

  function showOverlay({ name, avatar } = {}) {
    if (myAvEl) setAvatarEl(myAvEl, avatar, { fallback: '👑' });
    if (myNmEl) myNmEl.textContent = name   || 'שחקן';
    startSpin();
    ov?.classList.remove('hidden');
  }

  function hideOverlay() {
    ov?.classList.add('hidden');
    if (reelEl) {
      reelEl.classList.remove('ps-spinning', 'ps-landing');
      reelEl.style.animation = 'none';
    }
    slotCard?.classList.remove('ps-found');
  }

  function showMatched({ name, avatar } = {}) {
    if (!reelEl) return;
    reelEl.classList.remove('ps-spinning');
    reelEl.style.animation = 'none';
    reelEl.innerHTML = makeItem({ av: avatarMarkup(avatar, { fallback: '👑' }), nm: name || 'שחקן' });
    void reelEl.offsetHeight; // force reflow before adding animation
    reelEl.classList.add('ps-landing');
    slotCard?.classList.add('ps-found');
    if (slotLbl) slotLbl.textContent = name || 'שחקן';
  }

  cleanups.push(
    bus.on(PS_INTENT.SHOW,    showOverlay),
    bus.on(PS_INTENT.HIDE,    hideOverlay),
    bus.on(PS_INTENT.MATCHED, showMatched),
  );

  function unmount() {
    for (const off of cleanups) try { off?.(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}

export function mountMatchmakingOverlayScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountMatchmakingOverlayScreen: bus required');

  const cleanups = [];

  // ─── Speed buttons ─────────────────────────────────────
  for (const v of [20, 40, 60]) {
    const btn = $(`#mm-spd-${v}`, root);
    if (!btn) continue;
    cleanups.push(on(btn, 'click', () => {
      for (const x of [20, 40, 60]) $(`#mm-spd-${x}`, root)?.classList?.remove('active');
      btn.classList?.add('active');
    }));
  }

  const search = $('#mm-search-btn', root);
  const cancel = $('button[onclick="mmCancel()"]', root);

  if (search) {
    search.removeAttribute?.('onclick');
    cleanups.push(on(search, 'click', () => {
      bus.emit(MM_INTENT.SEARCH, readMatchmakingFilters(root));
    }));
  }

  if (cancel) {
    cancel.removeAttribute?.('onclick');
    cleanups.push(on(cancel, 'click', () => {
      bus.emit(MM_INTENT.CANCEL, {});
    }));
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
