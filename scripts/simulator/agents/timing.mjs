// timing.mjs — WHEN in a turn a simulated player commits. Pure.
//
// Real races happen when a move lands just as the timer expires, so agents
// must not all act at the start of the turn. Each turn samples a phase from
// the persona's weights:
//
//   early     0–30 % of the turn
//   mid      30–85 %
//   late     85–97 %
//   deadline a band of ±1500 ms around the deadline, concentrated on the
//            edges that matter:
//              • just before the deadline           (deadline − 200 ms)
//              • at the deadline                    (± 60 ms)
//              • inside the watchdog grace          (0 … +grace)
//              • just past the grace (watchdog wins) (+grace … +grace+500)
//              • a broad band                        (−1500 … +1500)
//
// All times are on the SERVER clock (serverNow / room.turnDeadlineMs), the
// same clock the opponent's timeout watchdog and the local turn timer use.
//
// Untimed games (no deadline) sample a think time from the persona instead.

export const DEADLINE_BAND_MS = 1500;
export const DEADLINE_EDGES = Object.freeze(['before', 'at', 'inGrace', 'afterGrace', 'band']);

function pickWeighted(rng, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rng() * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function uniform(rng, lo, hi) { return lo + rng() * (hi - lo); }

/**
 * Plan when this turn's final action (commit / pass / exchange …) should fire.
 *
 * @param {object} p
 * @param {() => number} p.rng
 * @param {{ timing: object, untimedThinkMs: [number, number] }} p.persona
 * @param {number} p.nowMs        current server time
 * @param {number|null} p.deadlineMs  room.turnDeadlineMs (server clock) or null
 * @param {number} p.limitMs      full turn length (botTime × 1000) or 0
 * @param {number} [p.graceMs]    watchdog grace (DEFAULT_WATCHDOG_GRACE_MS)
 * @returns {{ phase: string, edge: string|null, atMs: number, offsetFromDeadlineMs: number|null }}
 */
export function planCommitTime({ rng, persona, nowMs, deadlineMs, limitMs, graceMs = 1000 }) {
  const timed = Number(deadlineMs) > 0 && Number(limitMs) > 0;
  if (!timed) {
    const [lo, hi] = persona.untimedThinkMs ?? [1000, 10000];
    // Log-uniform: most turns short, a long tail of slow ones.
    const ms = Math.exp(uniform(rng, Math.log(lo), Math.log(hi)));
    return { phase: 'untimed', edge: null, atMs: nowMs + ms, offsetFromDeadlineMs: null };
  }

  const turnStart = deadlineMs - limitMs;
  const phase = pickWeighted(rng, persona.timing);
  let atMs;
  let edge = null;
  switch (phase) {
    case 'early': atMs = turnStart + limitMs * uniform(rng, 0.0, 0.30); break;
    case 'mid':   atMs = turnStart + limitMs * uniform(rng, 0.30, 0.85); break;
    case 'late':  atMs = turnStart + limitMs * uniform(rng, 0.85, 0.97); break;
    default: {
      edge = DEADLINE_EDGES[Math.floor(rng() * DEADLINE_EDGES.length)];
      let off;
      switch (edge) {
        case 'before':     off = -200 + uniform(rng, -100, 100); break;
        case 'at':         off = uniform(rng, -60, 60); break;
        case 'inGrace':    off = uniform(rng, 0, graceMs); break;
        case 'afterGrace': off = graceMs + uniform(rng, 0, 500); break;
        default:           off = uniform(rng, -DEADLINE_BAND_MS, DEADLINE_BAND_MS);
      }
      atMs = deadlineMs + off;
    }
  }
  // Never schedule into the past (the turn may have started late for us —
  // e.g. our watcher saw TURN_CHANGED after a slow commit). Keep at least a
  // human reaction time after "now".
  atMs = Math.max(atMs, nowMs + 250);
  return { phase, edge, atMs, offsetFromDeadlineMs: Math.round(atMs - deadlineMs) };
}

/**
 * Spread `n` intermediate human actions (previews, lookups, reactions)
 * between now and the commit time. Returns absolute server times, ascending.
 */
export function spreadActions({ rng, nowMs, commitAtMs, n }) {
  const span = Math.max(0, commitAtMs - nowMs - 150);
  const out = [];
  for (let i = 0; i < n; i++) out.push(nowMs + 100 + rng() * span);
  return out.sort((a, b) => a - b);
}

// Histogram bucket for reporting commit offset relative to the deadline.
export function offsetBucket(offsetMs) {
  if (offsetMs == null) return 'untimed';
  if (offsetMs < -DEADLINE_BAND_MS) return '<-1.5s';
  const edges = [-1000, -500, -200, 0, 200, 500, 1000, 1500];
  let lo = -DEADLINE_BAND_MS;
  for (const e of edges) {
    if (offsetMs < e) return `[${lo},${e})`;
    lo = e;
  }
  return '>=+1.5s';
}
