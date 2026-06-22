// Loading-screen tips service.
//
// Selects a small set of weighted-random tips for each app launch,
// accounting for player experience level and recently shown tips.
// All storage access is injectable so the module is unit-testable in Node.js.

export const TIPS_HISTORY_KEY = 'boost_tips_history';
export const TIPS_GAMES_KEY   = 'boost_tips_games_played';

const MAX_HISTORY       = 10;
const SESSION_TIP_COUNT = 5;

// ── Player segmentation ──────────────────────────────────────────────────────

// Returns category weight distribution (0-100) for the given experience level.
// The weights are used as multipliers on each tip's own `weight` field.
function segmentWeights(gamesPlayed) {
  if (gamesPlayed < 10) {
    return { beginner: 70, intermediate: 5,  advanced: 5,  didYouKnow: 20 };
  }
  if (gamesPlayed < 50) {
    return { beginner: 40, intermediate: 30, advanced: 10, didYouKnow: 20 };
  }
  return   { beginner: 10, intermediate: 30, advanced: 40, didYouKnow: 20 };
}

// ── Storage helpers ──────────────────────────────────────────────────────────

export function getGamesPlayed(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(TIPS_GAMES_KEY);
    return v != null ? Math.max(0, parseInt(v, 10) || 0) : 0;
  } catch { return 0; }
}

export function cacheGamesPlayed(count, storage = globalThis.localStorage) {
  try { storage?.setItem(TIPS_GAMES_KEY, String(Math.max(0, count | 0))); } catch {}
}

function getHistory(storage) {
  try {
    const raw = storage?.getItem(TIPS_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function recordShownTips(ids, storage = globalThis.localStorage) {
  try {
    const history = getHistory(storage);
    const updated = [...history, ...ids].slice(-MAX_HISTORY);
    storage?.setItem(TIPS_HISTORY_KEY, JSON.stringify(updated));
  } catch {}
}

// ── Weighted random selection ────────────────────────────────────────────────

function effectiveWeight(tip, catWeights) {
  const catFactor = (catWeights[tip.category] ?? 5) / 100;
  return Math.max(0.001, (tip.weight ?? 5) * catFactor);
}

// Draws `count` distinct items from `pool` (each item must have `._w`).
function weightedSample(pool, count) {
  const result   = [];
  const remaining = [...pool];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const total = remaining.reduce((s, t) => s + t._w, 0);
    if (total <= 0) break;
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < remaining.length - 1; idx++) {
      r -= remaining[idx]._w;
      if (r <= 0) break;
    }
    result.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Select a session's worth of tips from the full catalogue.
 *
 * @param {object[]} allTips — the full catalogue (parsed tips.json)
 * @param {{ storage?: Storage, count?: number }} options
 * @returns {object[]} — up to `count` tip objects (without internal `_w` field)
 */
export function selectSessionTips(allTips, { storage = globalThis.localStorage, count = SESSION_TIP_COUNT } = {}) {
  const gamesPlayed = getGamesPlayed(storage);
  const history     = getHistory(storage);
  const historySet  = new Set(history);
  const catWeights  = segmentWeights(gamesPlayed);

  const eligible = allTips.filter(t =>
    t.enabled !== false &&
    (t.minGamesPlayed == null || gamesPlayed >= t.minGamesPlayed) &&
    (t.maxGamesPlayed == null || gamesPlayed <= t.maxGamesPlayed)
  );

  // Prefer tips not shown in the last MAX_HISTORY sessions.
  // If there aren't enough fresh tips, fall back to the full eligible set.
  const fresh = eligible.filter(t => !historySet.has(t.id));
  const pool  = fresh.length >= count ? fresh : eligible;

  const weighted = pool.map(t => ({ ...t, _w: effectiveWeight(t, catWeights) }));
  const selected = weightedSample(weighted, count);

  return selected.map(({ _w, ...tip }) => tip);
}

/**
 * Fetch and parse the tips catalogue.
 * Injectable `fetchFn` makes this testable (tests pass a stub).
 */
export async function loadTips(url = 'data/tips.json', fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') return [];
  try {
    const res = await fetchFn(url);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
