// createRoomScreen — Phase 2 takeover for #ov-create-room.
//
// Reads filter state at confirm-click time (legacy still owns the toggle
// state via crSetMode / crToggleTL / crAdjTime, which mutate the `.active`
// class and the #cr-time-val text). On confirm we emit CR_INTENT.CONFIRM
// with a normalized payload so main.js can drive the spine roomCodeService.
//
// Mode mapping: legacy 'live' / 'async' → spine 'friend-live' / 'friend-async'
// (a shareable code is a "friend" mode in the spine taxonomy — randoms come
// in via matchmaking).

import { $, on } from '../domHelpers.js';
import { loadUiPreferences } from '../../game/settings/settingsCompat.js';

export const CR_INTENT = Object.freeze({
  CONFIRM: 'createRoom/confirm',
  CANCEL:  'createRoom/cancel',
});

function readActiveMode(root) {
  if ($('#cr-mode-async', root)?.classList?.contains('active')) return 'async';
  return 'live';
}

function readBotTime(root) {
  for (const v of [20, 40, 60]) {
    if ($(`#cr-spd-${v}`, root)?.classList?.contains('active')) return v;
  }
  return 40;
}

function readName(root) {
  const v = $('#cr-name', root)?.value?.trim?.();
  const saved = loadUiPreferences(globalThis.localStorage).lastDisplayName;
  return v && v.length > 0 ? v : saved || 'שחקן 1';
}

export function readCreateRoomFilters(root = globalThis.document) {
  const legacyMode = readActiveMode(root);
  return {
    legacyMode,
    spineMode: legacyMode === 'async' ? 'friend-async' : 'friend-live',
    timelimit: legacyMode === 'live',
    botTime: readBotTime(root),
    name: readName(root),
  };
}

export function mountCreateRoomScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountCreateRoomScreen: bus required');

  const cleanups = [];

  // ─── Speed buttons ─────────────────────────────────────
  for (const v of [20, 40, 60]) {
    const btn = $(`#cr-spd-${v}`, root);
    if (!btn) continue;
    cleanups.push(on(btn, 'click', () => {
      for (const x of [20, 40, 60]) $(`#cr-spd-${x}`, root)?.classList?.remove('active');
      btn.classList?.add('active');
    }));
  }

  const confirm = $('button[onclick="crConfirm()"]', root);
  const cancel  = $('button[onclick="ovClose(\'ov-create-room\')"]', root);

  if (confirm) {
    confirm.removeAttribute?.('onclick');
    cleanups.push(on(confirm, 'click', () => {
      bus.emit(CR_INTENT.CONFIRM, readCreateRoomFilters(root));
    }));
  }
  if (cancel) {
    cancel.removeAttribute?.('onclick');
    cleanups.push(on(cancel, 'click', () => {
      bus.emit(CR_INTENT.CANCEL, {});
    }));
  }

  function unmount() {
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}
