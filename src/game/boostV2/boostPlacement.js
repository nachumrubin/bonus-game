// Boost 2.0 — Boost placement validator (spec §18–21).
//
// General rule: a Boost goes on an empty grid square, not occupied by
// another Boost (active or in the same batch), within Manhattan distance
// `rules.boostPlacementDistance` of at least one letter tile on the board
// AFTER the proposed word placement. No rack knowledge, no dictionary search.
//
// Bridge Builder must additionally share a row or column with at least one
// other Boost in the final proposed layout (remaining active Boosts + the
// other placements of the same batch). When no arrangement of the batch can
// keep a Bridge aligned, that Bridge automatically becomes its predetermined
// fallback definition (spec §20); with several Bridges, the latest in FIFO
// order falls back first (AUDIT A7).
//
// Batch rule (spec §19, §21): the batch's entries are placed strictly in
// FIFO order. The longest placeable prefix is MANDATORY — a player can
// neither skip nor defer an entry that has a legal square; entries beyond
// it stay pending at the front of the queue.
// Pure.

import { FAMILY } from './challengeCatalog.js';

const key = (r, c) => `${r},${c}`;

// Board view after the proposed placement. `board` is state.board (10×10).
export function makeBoardView(board, placed = []) {
  const size = board.length;
  const extra = new Set(placed.map(p => key(p.r, p.c)));
  const occupied = (r, c) => r >= 0 && r < size && c >= 0 && c < size && (!!board[r][c] || extra.has(key(r, c)));
  return { size, occupied };
}

function nearTile(view, r, c, d) {
  for (let dr = -d; dr <= d; dr++) {
    const rem = d - Math.abs(dr);
    for (let dc = -rem; dc <= rem; dc++) {
      if (view.occupied(r + dr, c + dc)) return true;
    }
  }
  return false;
}

/**
 * Every square satisfying the GENERAL placement rule, row-major.
 * @param {{ view, blocked: Iterable<{r,c}>, rules }} args
 */
export function legalSquares({ view, blocked = [], rules }) {
  const b = new Set([...blocked].map(s => key(s.r, s.c)));
  const out = [];
  for (let r = 0; r < view.size; r++) {
    for (let c = 0; c < view.size; c++) {
      if (view.occupied(r, c) || b.has(key(r, c))) continue;
      if (!nearTile(view, r, c, rules.boostPlacementDistance)) continue;
      out.push({ r, c });
    }
  }
  return out;
}

// Deterministic preference order for automatic placement (timeouts, bots
// that defer to it, tests): closest to the board centre, then row, column.
export function preferenceOrder(squares, size = 10) {
  const mid = (size - 1) / 2;
  return [...squares].sort((a, b) =>
    (Math.abs(a.r - mid) + Math.abs(a.c - mid)) - (Math.abs(b.r - mid) + Math.abs(b.c - mid)) ||
    a.r - b.r || a.c - b.c);
}

export function isAligned(sq, layout) {
  return layout.some(o => !(o.r === sq.r && o.c === sq.c) && (o.r === sq.r || o.c === sq.c));
}

export function isBridge(definitions, definitionId) {
  return definitions[definitionId]?.family === FAMILY.BRIDGE_BUILDER;
}

// Find one arrangement for `isBridgeFlags.length` placements on distinct
// `legal` squares such that every flagged (Bridge) placement is aligned in
// the final layout `fixed ∪ arrangement`. Returns squares in input order or
// null. Bridges are assigned first; ordinary placements then only try
// squares that could align a still-unaligned Bridge, plus the first free
// square — complete for this problem and cheap (batches are ≤ 3).
export function findArrangement(isBridgeFlags, legal, fixed = []) {
  const k = isBridgeFlags.length;
  if (k === 0) return [];
  if (k > legal.length) return null;
  const order = [...isBridgeFlags.keys()].sort((a, b) => Number(isBridgeFlags[b]) - Number(isBridgeFlags[a]));
  const assign = new Array(k).fill(null);
  const used = new Set();
  const layout = () => [...fixed, ...assign.filter(Boolean)];
  const unalignedBridges = () => assign
    .map((sq, i) => (sq && isBridgeFlags[i] && !isAligned(sq, layout()) ? sq : null))
    .filter(Boolean);
  const bridgeCandidates = (() => {
    // Squares already aligned with a fixed Boost first → fast success.
    const aligned = legal.filter(s => isAligned(s, fixed));
    const rest = legal.filter(s => !isAligned(s, fixed));
    return [...aligned, ...rest];
  })();

  function rec(pos) {
    if (pos === k) return unalignedBridges().length === 0;
    const i = order[pos];
    let cands;
    if (isBridgeFlags[i]) {
      cands = bridgeCandidates;
    } else {
      const open = unalignedBridges();
      const helpers = legal.filter(s => !used.has(key(s.r, s.c)) && open.some(b => isAligned(s, [b])));
      const firstFree = legal.find(s => !used.has(key(s.r, s.c)) && !helpers.includes(s));
      cands = firstFree ? [...helpers, firstFree] : helpers;
    }
    const remainingOrdinary = order.slice(pos + 1).filter(j => !isBridgeFlags[j]).length;
    for (const s of cands) {
      const sk = key(s.r, s.c);
      if (used.has(sk)) continue;
      used.add(sk); assign[i] = s;
      // Prune: all Bridges placed, Bridges still unaligned, no helpers left.
      const bridgesDone = order.slice(pos + 1).every(j => !isBridgeFlags[j]);
      if (!(bridgesDone && remainingOrdinary === 0 && unalignedBridges().length > 0)) {
        if (rec(pos + 1)) return true;
      }
      used.delete(sk); assign[i] = null;
    }
    return false;
  }
  return rec(0) ? assign.map(s => ({ r: s.r, c: s.c })) : null;
}

/**
 * Plan a replacement batch (spec §19–21).
 * @param {{ entries: Array<{instanceId, definitionId}>, definitions: object,
 *           legal: Array<{r,c}>, fixed: Array<{r,c}>, size?: number }} args
 * @returns {{ placeable: number,
 *             effective: Array<{instanceId, definitionId, effectiveDefinitionId, fallbackApplied}>,
 *             arrangement: Array<{r,c}> }}
 *   `effective` covers only the placeable prefix; `arrangement` is one legal
 *   arrangement for it in deterministic preference order (auto placement).
 */
export function planReplacements({ entries, definitions, legal, fixed = [], size = 10 }) {
  const ordered = preferenceOrder(legal, size);
  for (let p = Math.min(entries.length, legal.length); p >= 0; p--) {
    const sub = entries.slice(0, p);
    const flags = sub.map(e => isBridge(definitions, e.definitionId));
    const bridgeIdx = flags.map((f, i) => (f ? i : -1)).filter(i => i >= 0);
    for (let drop = 0; drop <= bridgeIdx.length; drop++) {
      const dropped = new Set(bridgeIdx.slice(bridgeIdx.length - drop));
      const tryFlags = flags.map((f, i) => f && !dropped.has(i));
      const arrangement = findArrangement(tryFlags, ordered, fixed);
      if (!arrangement) continue;
      const effective = sub.map((e, i) => {
        const fallback = dropped.has(i);
        return {
          instanceId: e.instanceId,
          definitionId: e.definitionId,
          effectiveDefinitionId: fallback ? definitions[e.definitionId].fallbackDefinitionId : e.definitionId,
          fallbackApplied: fallback,
        };
      });
      return { placeable: p, effective, arrangement };
    }
  }
  return { placeable: 0, effective: [], arrangement: [] };
}

/**
 * Validate a player's submitted placements against a plan.
 * `placements` — [{ r, c, instanceId? }] in FIFO order.
 */
export function validatePlacements({ plan, placements, legal, fixed = [], definitions }) {
  const list = Array.isArray(placements) ? placements : [];
  if (list.length !== plan.placeable) {
    return { ok: false, reason: 'boost-placement-count', expected: plan.placeable, got: list.length };
  }
  const legalSet = new Set(legal.map(s => key(s.r, s.c)));
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const r = Number(p?.r), c = Number(p?.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return { ok: false, reason: 'boost-placement-illegal', index: i };
    if (p.instanceId != null && p.instanceId !== plan.effective[i].instanceId) {
      return { ok: false, reason: 'boost-placement-order', index: i };
    }
    if (seen.has(key(r, c))) return { ok: false, reason: 'boost-placement-duplicate', index: i };
    if (!legalSet.has(key(r, c))) return { ok: false, reason: 'boost-placement-illegal', index: i };
    seen.add(key(r, c));
  }
  const finalLayout = [...fixed, ...list.map(p => ({ r: Number(p.r), c: Number(p.c) }))];
  for (let i = 0; i < list.length; i++) {
    if (!isBridge(definitions, plan.effective[i].effectiveDefinitionId)) continue;
    if (!isAligned({ r: Number(list[i].r), c: Number(list[i].c) }, finalLayout)) {
      return { ok: false, reason: 'bridge-not-aligned', index: i };
    }
  }
  return { ok: true };
}
