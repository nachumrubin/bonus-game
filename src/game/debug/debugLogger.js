// Game Debug Timeline — Firebase write/read helpers.
//
// Thin layer over RTDB for the debug nodes. Every write is APPEND-ONLY (push
// keys or version keys) and BEST-EFFORT: failures are swallowed (console.warn)
// so debug logging can never disrupt gameplay. Each record carries a server
// timestamp (sortable/authoritative) plus a client timestamp.
//
// gameId === roomId. Paths are defined in debugSchema.js.

import { DEBUG_PATH } from './debugSchema.js';

// Server-timestamp provider, injected once from main.js (Firebase ServerValue
// sentinel). Defaults to a client clock so the module works in tests/offline.
let serverTimestampProvider = () => Date.now();
export function configureDebugLogger({ serverTimestamp } = {}) {
  if (typeof serverTimestamp === 'function') serverTimestampProvider = serverTimestamp;
}

function meta() {
  return { serverTimestamp: serverTimestampProvider(), clientTimestamp: Date.now() };
}

// Real Firebase push refs expose `.key`; the test mock exposes `_path`.
function refKey(ref) {
  return ref?.key ?? (typeof ref?._path === 'string' ? ref._path.split('/').pop() : null);
}

async function safe(label, fn) {
  try { return await fn(); }
  catch (e) { console.warn(`[debug] ${label} failed:`, e?.message ?? e); return null; }
}

// Firebase RTDB set()/update() reject any value tree containing `undefined`.
// Debug payloads carry optional fields (e.g. a TURN_CHANGED with no `reason`,
// an event with no `userId`), so deep-prune undefined before writing — a missing
// optional field must never make a best-effort debug write throw. Undefined
// array elements become null (Firebase rejects undefined-in-array too).
export function pruneUndefined(value) {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : pruneUndefined(v)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = pruneUndefined(v);
    }
    return out;
  }
  return value;
}

// ── Environment helpers ────────────────────────────────────────────
export function appVersion() {
  try {
    return globalThis.document?.querySelector?.('meta[name="version"]')?.getAttribute?.('content') ?? null;
  } catch { return null; }
}

export function platformInfo() {
  const nav = globalThis.navigator ?? {};
  return {
    platform: nav.platform ?? null,
    deviceInfo: typeof nav.userAgent === 'string' ? nav.userAgent.slice(0, 256) : null,
  };
}

// ── Writers ────────────────────────────────────────────────────────

// Append one event to /gameEvents/{gameId}. Returns the eventId (push key) or null.
export function logGameEvent(db, gameId, event = {}) {
  if (!db || !gameId) return Promise.resolve(null);
  return safe('logGameEvent', async () => {
    const ref = db.ref(`${DEBUG_PATH.gameEvents}/${gameId}`).push();
    const eventId = refKey(ref);
    await ref.set(pruneUndefined({ eventId, gameId, ...event, ...meta() }));
    return eventId;
  });
}

// Write/overwrite the server-authoritative snapshot for a room version at
// /gameSnapshots/{gameId}/{key}. `key` is normally the room `version`.
export function createGameSnapshot(db, gameId, key, payload = {}) {
  if (!db || !gameId || key == null) return Promise.resolve(null);
  return safe('createGameSnapshot', async () => {
    await db.ref(`${DEBUG_PATH.gameSnapshots}/${gameId}/${key}`).set(pruneUndefined({ gameId, key, ...payload, ...meta() }));
    return key;
  });
}

// Append this device's local snapshot to /clientSnapshots/{gameId}/{slot}.
export function putClientSnapshot(db, gameId, slot, payload = {}) {
  if (!db || !gameId || (slot !== 0 && slot !== 1)) return Promise.resolve(null);
  return safe('putClientSnapshot', async () => {
    const ref = db.ref(`${DEBUG_PATH.clientSnapshots}/${gameId}/${slot}`).push();
    const id = refKey(ref);
    await ref.set(pruneUndefined({ id, gameId, slot, ...payload, ...meta() }));
    return id;
  });
}

// Append a warning to /debugWarnings/{gameId}. Returns warningId or null.
export function createDebugWarning(db, gameId, warning = {}) {
  if (!db || !gameId) return Promise.resolve(null);
  return safe('createDebugWarning', async () => {
    const ref = db.ref(`${DEBUG_PATH.debugWarnings}/${gameId}`).push();
    const warningId = refKey(ref);
    await ref.set(pruneUndefined({ warningId, gameId, ...warning, ...meta() }));
    return warningId;
  });
}

// Append a manual report (or captured client error) to /debugReports.
export function createDebugReport(db, report = {}) {
  if (!db) return Promise.resolve(null);
  return safe('createDebugReport', async () => {
    const ref = db.ref(DEBUG_PATH.debugReports).push();
    const reportId = refKey(ref);
    await ref.set(pruneUndefined({ reportId, ...report, ...meta() }));
    return reportId;
  });
}

// Maintain a small searchable summary row per game at /debugGameIndex/{gameId}.
export function upsertGameIndex(db, gameId, summary = {}) {
  if (!db || !gameId) return Promise.resolve(null);
  return safe('upsertGameIndex', async () => {
    await db.ref(`${DEBUG_PATH.debugGameIndex}/${gameId}`).update(pruneUndefined({ gameId, ...summary, updatedAt: serverTimestampProvider() }));
    return gameId;
  });
}

// ── Reads (admin) ──────────────────────────────────────────────────

function snapToArray(snap) {
  const v = snap?.val ? snap.val() : null;
  if (!v) return [];
  return Object.entries(v).map(([k, val]) => (val && typeof val === 'object' ? { _key: k, ...val } : { _key: k, value: val }));
}

// Load the full debug timeline for one game (admin use).
export async function getGameDebugTimeline(db, gameId) {
  if (!db || !gameId) return { events: [], snapshots: [], clientSnapshots: { 0: [], 1: [] }, warnings: [], reports: [], index: null };
  const [evSnap, snSnap, c0Snap, c1Snap, wSnap, idxSnap, repSnap] = await Promise.all([
    db.ref(`${DEBUG_PATH.gameEvents}/${gameId}`).get(),
    db.ref(`${DEBUG_PATH.gameSnapshots}/${gameId}`).get(),
    db.ref(`${DEBUG_PATH.clientSnapshots}/${gameId}/0`).get(),
    db.ref(`${DEBUG_PATH.clientSnapshots}/${gameId}/1`).get(),
    db.ref(`${DEBUG_PATH.debugWarnings}/${gameId}`).get(),
    db.ref(`${DEBUG_PATH.debugGameIndex}/${gameId}`).get(),
    db.ref(DEBUG_PATH.debugReports).get(),
  ]);
  const byTime = (a, b) => (a.serverTimestamp ?? a.clientTimestamp ?? 0) - (b.serverTimestamp ?? b.clientTimestamp ?? 0);
  const reports = snapToArray(repSnap).filter(r => r.gameId === gameId).sort(byTime);
  return {
    events: snapToArray(evSnap).sort(byTime),
    snapshots: snapToArray(snSnap).sort((a, b) => Number(a._key) - Number(b._key)),
    clientSnapshots: { 0: snapToArray(c0Snap).sort(byTime), 1: snapToArray(c1Snap).sort(byTime) },
    warnings: snapToArray(wSnap).sort(byTime),
    reports,
    index: idxSnap?.val ? idxSnap.val() : null,
  };
}
