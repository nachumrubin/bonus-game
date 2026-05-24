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
import { loadUiPreferences } from '../../game/settings/settingsCompat.js';

export const MM_INTENT = Object.freeze({
  SEARCH: 'matchmaking/search',
  CANCEL: 'matchmaking/cancel',
});

function readActiveMode(root) {
  if ($('#mm-mode-async', root)?.classList?.contains('active')) return 'async';
  return 'live'; // default + matches legacy initial state
}

function readActiveTimelimit(root) {
  // mm-tl-no being active wins over mm-tl-yes
  if ($('#mm-tl-no', root)?.classList?.contains('active')) return false;
  return true; // default
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
    timelimit: legacyMode === 'live' ? readActiveTimelimit(root) : false,
    ratingRange: readActiveRatingRange(root),
    strict: readStrict(root),
    name: readName(root),
  };
}

export function mountMatchmakingOverlayScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountMatchmakingOverlayScreen: bus required');

  const cleanups = [];
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
