// Server-synchronised clock.
//
// WHY THIS EXISTS
//
// `turnDeadlineMs` is an ABSOLUTE epoch timestamp. One client computes it
// (`commitTime + limitMs`) and writes it to the room; the OTHER client then
// enforces it — the opponent watchdog claims an expired turn, the turn timer
// counts it down, and the late-commit gate in onlineGameSession refuses a move
// past it. Every one of those comparisons used raw `Date.now()`, so the value
// only meant the same thing on both devices if their system clocks agreed.
//
// They don't. Phone clocks routinely drift by seconds. Prod room
// fc_1786040881489_8bjchc: a player submitted a move 5 s after a deadline the
// opponent's watchdog had already claimed, and the late-commit gate did not
// trip, because on HER device `Date.now()` had not yet passed
// `deadline + grace`. The commit lost the version race, was dropped, and cost
// her the game.
//
// Firebase RTDB publishes the fix at `.info/serverTimeOffset`: the number of
// milliseconds to add to this client's clock to approximate the server's. The
// SDK maintains it automatically and re-estimates it on every reconnect. With
// both clients anchored to the same server clock, an absolute deadline means
// the same instant everywhere.
//
// USAGE
//
//   startServerClock({ db })     once, at boot, after the Firebase app exists
//   serverNow()                  everywhere you would have called Date.now()
//                                for anything compared against turnDeadlineMs
//
// `serverNow()` is safe to call before (or without) sync: the offset starts at
// 0, so it degrades to exactly the previous `Date.now()` behaviour. That also
// makes it correct for offline modes, where the deadline is both written and
// read on the same device.

export const SERVER_CLOCK_SYNCED = 'evt/SERVER_CLOCK_SYNCED';

let offsetMs = 0;
let synced = false;
let detach = null;

/**
 * Subscribe to `.info/serverTimeOffset` and keep the local offset current.
 * Idempotent — a second call replaces the first subscription.
 * @param {{ db: any, bus?: { emit(type: string, payload?: any): void } }} options
 * @returns {{ stop(): void }}
 */
export function startServerClock({ db, bus } = {}) {
  stopServerClock();
  if (!db?.ref) return { stop() {} };
  let ref;
  try {
    ref = db.ref('.info/serverTimeOffset');
  } catch {
    // Environment without the special `.info` tree (some mocks) — stay at 0.
    return { stop() {} };
  }
  const handler = (snap) => {
    const next = Number(snap?.val ? snap.val() : 0);
    if (!Number.isFinite(next)) return;
    const changed = next !== offsetMs;
    offsetMs = next;
    synced = true;
    if (changed) bus?.emit?.(SERVER_CLOCK_SYNCED, { offsetMs });
  };
  try {
    ref.on('value', handler);
  } catch {
    return { stop() {} };
  }
  detach = () => { try { ref.off('value', handler); } catch { /* swallow */ } };
  return { stop: stopServerClock };
}

export function stopServerClock() {
  if (detach) {
    detach();
    detach = null;
  }
}

/** Current time on the server's clock, as best this client can estimate it. */
export function serverNow() {
  return Date.now() + offsetMs;
}

/** Milliseconds to add to `Date.now()` to reach server time. 0 until synced. */
export function getServerTimeOffsetMs() {
  return offsetMs;
}

/** Whether `.info/serverTimeOffset` has produced at least one value. */
export function isServerClockSynced() {
  return synced;
}

/**
 * Test seam: force an offset without a Firebase connection, so a test can
 * simulate two devices whose clocks disagree.
 */
export function _setServerTimeOffsetForTests(ms) {
  offsetMs = Number(ms) || 0;
  synced = true;
}

/** Test seam: back to an unsynced, zero-offset clock. */
export function _resetServerClockForTests() {
  stopServerClock();
  offsetMs = 0;
  synced = false;
}
