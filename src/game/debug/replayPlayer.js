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

import { boardCellsString } from './stateHash.js';

// Divergence is judged on the VISIBLE OUTCOME — the placed tiles and the two
// scores — not the full state hash. The full hash also covers turnNumber,
// currentTurnSlot, tileBagCount and rack counts, which legitimately differ by a
// step between two views captured microseconds apart (e.g. one client recorded
// just before its local turnNumber incremented). Comparing those flagged "לא
// תואם" on essentially every move even when the boards were identical. Two views
// agree when the same tiles sit on the board and the scoreboard matches.
export function snapshotOutcomeKey(snap) {
  if (!snap) return null;
  const c = snap.compact ?? {};
  return `${boardCellsString(snap.board)}~${c.hostScore ?? '?'}~${c.guestScore ?? '?'}~${c.status ?? ''}`;
}

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

// Timestamps are ms, but the replay reads at SECOND granularity so a single move
// — whose server, host and guest snapshots land a few ms apart — collapses to one
// step (one click advances all three boards) instead of three. The frame axis and
// the timeline rows share this same second list, so they stay 1:1.
const SEC = (t) => Math.floor(t / 1000);
function secondsOf(...streams) {
  const set = new Set();
  for (const arr of streams) for (const x of arr) set.add(SEC(x.t));
  return Array.from(set).sort((a, b) => a - b);
}

// Reduce the recorded BOOST_ACTIVATED events to the freshly-played bonuses in a
// time window (prevT, t], resolving each boost square's bonus type from the
// server snapshot's bonusAssignment. consumed/pending markers are dropped (they
// aren't a newly-played bonus), and duplicates (both clients log the same one)
// are collapsed by slot+square+effect.
function bonusesInWindow(events, prevT, t, serverSnap) {
  const assignment = Array.isArray(serverSnap?.bonusAssignment) ? serverSnap.bonusAssignment : [];
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (e.t <= prevT || e.t > t) continue;
    const p = e.payload ?? {};
    if (p.consumed || p.pending) continue;
    const key = `${p.slot}:${p.bonusIdx}:${p.boostId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      slot: p.slot ?? null,
      boostId: p.boostId ?? null,
      bonusIdx: p.bonusIdx ?? null,
      bonusType: (p.bonusIdx != null ? assignment[p.bonusIdx]?.type : null) ?? null,
      extra: Number(p.extra) || 0,
    });
  }
  return out;
}

/**
 * One frame per SECOND. Each panel shows its latest snapshot by the end of that
 * second, so stepping advances all three boards together. `t` is the second
 * boundary (ms) — equal to the matching timeline row's `t`.
 * @param {{ server?: any[], p0?: any[], p1?: any[], events?: any[] }} streams
 * @returns {Array<{ t, server, p0, p1, diverged, bonuses }>}
 */
export function buildReplayTimeline({ server = [], p0 = [], p1 = [], events = [] } = {}) {
  const S = norm(server), A = norm(p0), B = norm(p1);
  const allEv = norm(events);
  const boosts = allEv.filter((e) => e.type === 'BOOST_ACTIVATED');
  const seconds = secondsOf(S, A, B, allEv);
  let prevEnd = -Infinity;
  return seconds.map((sec) => {
    const end = sec * 1000 + 999;
    const srv = latestAtOrBefore(S, end);
    const a = latestAtOrBefore(A, end);
    const b = latestAtOrBefore(B, end);
    const present = [srv, a, b].map(snapshotOutcomeKey).filter((k) => k != null);
    const diverged = present.length > 1 && new Set(present).size > 1;
    const bonuses = bonusesInWindow(boosts, prevEnd, end, srv ?? a ?? b);
    prevEnd = end;
    return { t: sec * 1000, server: srv, p0: a, p1: b, diverged, bonuses };
  });
}

// Convenience: build frames straight from a getGameDebugTimeline() result.
export function framesFromTimeline(timeline = {}) {
  return buildReplayTimeline({
    server: timeline.snapshots ?? [],
    p0: timeline.clientSnapshots?.[0] ?? [],
    p1: timeline.clientSnapshots?.[1] ?? [],
    events: timeline.events ?? [],
  });
}

function serverRowLabel(s) {
  return `v${s.version ?? '?'} · ${s.compact?.hostScore ?? '?'}–${s.compact?.guestScore ?? '?'} · תור ${s.compact?.turnNumber ?? '?'}`;
}

// TIME-ALIGNED timeline — ONE row per second (timestamps are ms, but the
// timeline reads at second granularity: everything that happened in the same
// second shares a row). For each row, what EACH source saw that second:
//   • server (truth): the version(s) committed that second,
//   • each player: the event(s) THAT client recorded that second (it stamps
//     `slot`).
// Each cell is an array of labels (possibly several lines); an empty array means
// nothing happened for that source that second and renders blank ("----").
// Reading a row across answers "what did each side have at time T". Rows share
// the frame axis (snapshots + client snapshots + events) so row i ↔ frame i.
// Pure.
export function buildTimeline(timeline = {}) {
  const snaps = norm(timeline.snapshots ?? []);
  const c0 = norm(timeline.clientSnapshots?.[0] ?? []);
  const c1 = norm(timeline.clientSnapshots?.[1] ?? []);
  const events = norm(timeline.events ?? []);
  const seconds = secondsOf(snaps, c0, c1, events);
  const inSec = (arr, sec) => arr.filter((x) => SEC(x.t) === sec);
  return seconds.map((sec) => ({
    t: sec * 1000, // second boundary (ms) — equals the matching frame's t
    srv: inSec(snaps, sec).map(serverRowLabel),
    p0: inSec(events, sec).filter((e) => Number(e.slot) === 0).map((e) => e.summary ?? e.type ?? ''),
    p1: inSec(events, sec).filter((e) => Number(e.slot) === 1).map((e) => e.summary ?? e.type ?? ''),
  }));
}

// Everything the replay overlay needs from a stored timeline: the merged frames
// (boards/divergence/bonuses) plus the time-aligned per-source rows.
export function replayDataFromTimeline(timeline = {}) {
  return { frames: framesFromTimeline(timeline), rows: buildTimeline(timeline) };
}
