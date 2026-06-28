// Game Debug Timeline — replay frame builder (pure).
//
// Merges the three stored snapshot streams (server-authoritative + each
// player's local view) onto a single timeline ordered by serverTimestamp. For
// each frame, every panel shows that source's latest snapshot AT-OR-BEFORE the
// frame time — so a client that lagged a move behind literally shows the older
// board while the server/other player have advanced. `diverged` flags frames
// where the present sources don't all agree (the inconsistency to investigate).
//
// Pure: no DOM, no Firebase.

function norm(arr) {
  return (arr ?? [])
    .map((s) => ({ ...s, t: Number(s.serverTimestamp ?? s.clientTimestamp ?? 0) }))
    .sort((a, b) => a.t - b.t);
}

function latestAtOrBefore(sorted, t) {
  let r = null;
  for (const s of sorted) {
    if (s.t <= t) r = s; else break;
  }
  return r;
}

/**
 * @param {{ server?: any[], p0?: any[], p1?: any[] }} streams
 * @returns {Array<{ t, server, p0, p1, diverged }>}
 */
export function buildReplayTimeline({ server = [], p0 = [], p1 = [] } = {}) {
  const S = norm(server), A = norm(p0), B = norm(p1);
  const times = Array.from(new Set([...S, ...A, ...B].map((s) => s.t))).sort((a, b) => a - b);
  return times.map((t) => {
    const srv = latestAtOrBefore(S, t);
    const a = latestAtOrBefore(A, t);
    const b = latestAtOrBefore(B, t);
    const present = [srv?.hash, a?.hash, b?.hash].filter((h) => h != null);
    const diverged = present.length > 1 && new Set(present).size > 1;
    return { t, server: srv, p0: a, p1: b, diverged };
  });
}

// Convenience: build frames straight from a getGameDebugTimeline() result.
export function framesFromTimeline(timeline = {}) {
  return buildReplayTimeline({
    server: timeline.snapshots ?? [],
    p0: timeline.clientSnapshots?.[0] ?? [],
    p1: timeline.clientSnapshots?.[1] ?? [],
  });
}
