// bonusSpectatorScreen — wires #ov-bonus-spectator.
//
// Shown to the opponent while the active player is in a boost flow
// (mini-game, wheel, or +N award overlay). Read-only mirror: shows the
// bonus title/desc/icon and a live progress line (secsLeft, score) when
// the active player's mini-game broadcasts updates.
//
// Driven by LIVE_BONUS_CHANGED — main.js bridges this through the
// onlineGameSession watch of the room's `liveBonus` field. No interactive
// buttons; the overlay closes automatically when liveBonus goes null on
// the room (active player finished the boost, committed the move).

import { EV } from '../../events/eventTypes.js';
import { $, setText } from '../domHelpers.js';

export function mountBonusSpectatorScreen({ root = globalThis.document, bus, sessionRef } = {}) {
  if (!bus) throw new Error('mountBonusSpectatorScreen: bus required');

  const overlay = $('#ov-bonus-spectator', root);
  const iconEl  = $('#bspec-ic',           root);
  const titleEl = $('#bspec-title',        root);
  const descEl  = $('#bspec-desc',         root);
  const progEl  = $('#bspec-progress',     root);

  if (!overlay) {
    console.warn('[bonusSpectator] #ov-bonus-spectator not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  cleanups.push(bus.on(EV.LIVE_BONUS_CHANGED, ({ liveBonus } = {}) => {
    const mySlot = sessionRef?.()?.mySlot;
    const isOpponentBoost = liveBonus?.active
      && (mySlot === 0 || mySlot === 1)
      && liveBonus.slot !== mySlot;

    if (!isOpponentBoost) {
      overlay.classList?.add?.('hidden');
      return;
    }

    setText(iconEl, liveBonus.icon || '⚡');
    setText(titleEl, liveBonus.title || 'היריב מקבל בוסט!');
    setText(descEl, liveBonus.desc || '');
    setText(progEl, formatProgress(liveBonus.progress));
    overlay.classList?.remove?.('hidden');
  }));

  function unmount() {
    for (const off of cleanups) try { off(); } catch {}
    cleanups.length = 0;
    overlay?.classList?.add?.('hidden');
  }

  return { unmount };
}

export function formatProgress(progress) {
  if (!progress || typeof progress !== 'object') return '⏳ ממתין לתוצאה...';
  const parts = [];
  if (progress.label) parts.push(String(progress.label));
  if (progress.score != null) parts.push(`${progress.score} נקודות`);
  if (progress.secsLeft != null) parts.push(`⏱ ${progress.secsLeft}s`);
  return parts.length ? parts.join(' • ') : '⏳ ממתין לתוצאה...';
}
