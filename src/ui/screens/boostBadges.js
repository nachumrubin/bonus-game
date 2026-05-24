// boostBadges — renders active-boost indicators on top of the player
// score panels.
//
// Reads from session.state.activeBoosts and derives a small badge set:
//   - "×N" multiplier badge       (boostId === 'multiply_next_turns')
//   - 🛡 cancel-shield badge      (boostId === 'cancel_next_opponent_bonus')
//   - 🔄 free-tile-swap button    (boostId === 'free_tile_swap')
//
// Re-renders on EV.BOOST_ACTIVATED, MOVE_CONFIRMED, TURN_CHANGED. The
// badges are appended to the existing legacy score-panel containers
// (#sn1, #sn2 wrappers via #scn1, #scn2 — falls back to body if those
// aren't found).

import { $, on } from '../domHelpers.js';
import { EV } from '../../events/eventTypes.js';

export const BB_INTENT = Object.freeze({
  REDEEM_TILE_SWAP: 'boostBadges/redeemTileSwap',
});

const BADGE_CONTAINER_CLASS = 'spine-boost-badges';

// Pure helper: produce a list of badge descriptors for one slot's boosts.
export function summarizeBoostsForSlot(activeBoosts, slot) {
  const mine = (activeBoosts ?? []).filter(b => b.slot === slot);
  const out = [];
  // Multiplier
  const mult = mine.find(b => b.boostId === 'multiply_next_turns');
  if (mult) {
    const m = mult.payload?.multiplier ?? 2;
    out.push({ id: 'multiplier', label: `×${m}`, color: '#e8c840' });
  }
  // Cancel shield (defensive)
  if (mine.find(b => b.boostId === 'cancel_next_opponent_bonus')) {
    out.push({ id: 'shield', label: '🛡', color: '#3a4cf9' });
  }
  // Skip turn (offensive — visible to mark "next opp turn skipped")
  if (mine.find(b => b.boostId === 'skip_opponent_turn')) {
    out.push({ id: 'skip', label: '🚫', color: '#ff8e8e' });
  }
  // Extra turn
  if (mine.find(b => b.boostId === 'extra_turn')) {
    out.push({ id: 'extra-turn', label: '🎯', color: '#1ed760' });
  }
  // Free tile swap
  if (mine.find(b => b.boostId === 'free_tile_swap')) {
    out.push({ id: 'tile-swap', label: '🔄', color: '#b06bff', clickable: true });
  }
  // Timer bonus (info-only)
  if (mine.find(b => b.boostId === 'timer_bonus')) {
    out.push({ id: 'timer', label: '⏱', color: '#1ed760' });
  }
  return out;
}

// Build the badge HTML string for one slot. Pure.
export function buildBadgeHtml(badges) {
  if (!badges?.length) return '';
  const cells = badges.map(b =>
    `<span data-badge="${b.id}" ${b.clickable ? `data-clickable="1" role="button" tabindex="0"` : ''} `
    + `style="display:inline-block;background:${b.color};color:#000;border-radius:6px;`
    + `padding:1px 5px;font-size:10px;font-weight:900;margin:0 2px;${b.clickable ? 'cursor:pointer;' : ''}">${b.label}</span>`,
  ).join('');
  return cells;
}

export function mountBoostBadges({ root = globalThis.document, bus, sessionRef } = {}) {
  if (!bus)        throw new Error('mountBoostBadges: bus required');
  if (!sessionRef) throw new Error('mountBoostBadges: sessionRef required');

  // Find the legacy score-panel containers; gracefully degrade to none.
  const slot0Panel = $('#scn1', root) ?? $('#sn1', root)?.parentElement ?? null;
  const slot1Panel = $('#scn2', root) ?? $('#sn2', root)?.parentElement ?? null;

  function ensureBadgeWrap(panel) {
    if (!panel) return null;
    let wrap = panel.querySelector?.(`.${BADGE_CONTAINER_CLASS}`);
    if (!wrap && panel.appendChild) {
      wrap = panel.ownerDocument?.createElement?.('div');
      if (wrap) {
        wrap.className = BADGE_CONTAINER_CLASS;
        wrap.style.cssText = 'display:flex;justify-content:center;gap:2px;margin-top:2px;flex-wrap:wrap;';
        panel.appendChild(wrap);
      }
    }
    return wrap;
  }

  function paint() {
    const session = sessionRef();
    const activeBoosts = session?.state?.activeBoosts ?? [];
    const wrap0 = ensureBadgeWrap(slot0Panel);
    const wrap1 = ensureBadgeWrap(slot1Panel);
    if (wrap0) wrap0.innerHTML = buildBadgeHtml(summarizeBoostsForSlot(activeBoosts, 0));
    if (wrap1) wrap1.innerHTML = buildBadgeHtml(summarizeBoostsForSlot(activeBoosts, 1));
  }

  // Re-paint on every event that could mutate activeBoosts.
  const cleanups = [];
  cleanups.push(bus.on(EV.BOOST_ACTIVATED, paint));
  cleanups.push(bus.on(EV.MOVE_CONFIRMED,  paint));
  cleanups.push(bus.on(EV.TURN_CHANGED,    paint));
  cleanups.push(bus.on(EV.GAME_STARTED,    paint));

  // Click delegation for tile-swap. The session.dispatch route is wired
  // by main.js subscribing to BB_INTENT.REDEEM_TILE_SWAP.
  function handleClick(e) {
    const t = e.target;
    if (!t?.getAttribute) return;
    const id = t.getAttribute('data-badge');
    if (id === 'tile-swap') bus.emit(BB_INTENT.REDEEM_TILE_SWAP, {});
  }
  if (slot0Panel?.addEventListener) cleanups.push(on(slot0Panel, 'click', handleClick));
  if (slot1Panel?.addEventListener) cleanups.push(on(slot1Panel, 'click', handleClick));

  // Initial paint
  paint();

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
    _paint: paint,
  };
}
