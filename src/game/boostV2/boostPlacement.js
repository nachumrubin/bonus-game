// Boost 2.0 — Boost placement validator (spec §18–21).
//
// General rule: a Boost goes on an empty grid square, not occupied by
// another Boost (active or in the same batch), within Manhattan distance
// `rules.boostPlacementDistance` of at least one letter tile on the board
// AFTER the proposed word placement. No rack knowledge, no dictionary search.
//
// Bridge Builder has no placement restriction of its own (product decision,
// Nov 2026): it is placed like any other Boost. If no single word can later
// cover it together with another Boost, players simply consume it without
// completing it — no alignment rule, no fallback challenge.
//
// Batch rule (spec §19, §21): the batch's entries are placed strictly in
// FIFO order. The longest placeable prefix is MANDATORY — a player can
// neither skip nor defer an entry that has a legal square; entries beyond
// it stay pending at the front of the queue.
// Pure.

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

/**
 * Plan a replacement batch (spec §19–21).
 * @param {{ entries: Array<{instanceId, definitionId}>, legal: Array<{r,c}>, size?: number }} args
 * @returns {{ placeable: number,
 *             effective: Array<{instanceId, definitionId, effectiveDefinitionId}>,
 *             arrangement: Array<{r,c}> }}
 *   `placeable` = the mandatory FIFO prefix (one entry per free legal square);
 *   `arrangement` is one valid submission in deterministic preference order
 *   (timeouts, bots, tests). `effectiveDefinitionId` always equals
 *   `definitionId`; it is kept so stored Boosts keep one shape.
 */
export function planReplacements({ entries, legal, size = 10 }) {
  const placeable = Math.min(entries.length, legal.length);
  return {
    placeable,
    effective: entries.slice(0, placeable).map(e => ({
      instanceId: e.instanceId, definitionId: e.definitionId, effectiveDefinitionId: e.definitionId,
    })),
    arrangement: preferenceOrder(legal, size).slice(0, placeable).map(s => ({ r: s.r, c: s.c })),
  };
}

/**
 * Validate a player's submitted placements against a plan.
 * `placements` — [{ r, c, instanceId? }] in FIFO order.
 */
export function validatePlacements({ plan, placements, legal }) {
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
  return { ok: true };
}
