// Live-online turn-timeout watchdog.
//
// Wires `shouldClaimExpiredOnlineTurn` + `computeExpiredOnlineTurnState`
// (roomService.js) to the actual room state. Mirrors legacy
// `ensureOnlineTimeoutWatchdog()` at HEAD:index.html:10330: the OPPONENT
// (the player whose turn is NOT current) polls every ~350 ms; if the
// active player is past `turnDeadlineMs + graceMs`, the opponent runs a
// Firebase transaction that flips the turn and resets the deadline.
//
// Why the opponent and not the active player? In a live game, the active
// player may have disconnected/crashed; their browser cannot dispatch
// PASS_TURN. The opponent's watchdog is the only thing keeping the room
// from getting stuck.
//
// The transaction guards against double-claim: even when both sides
// somehow fire, only the first to commit produces a state change.
//
// Mounted by main.js when a `friend-live` / `random-live` session
// starts; disposed in `activeGame.end()`.

import { PATH } from './schema.js';
import { computeExpiredOnlineTurnState, shouldClaimExpiredOnlineTurn } from './roomService.js';

export const DEFAULT_WATCHDOG_TICK_MS = 350;
export const DEFAULT_WATCHDOG_GRACE_MS = 1000;

/**
 * @param {{
 *   db: any,
 *   roomId: string,
 *   mySlot: 0 | 1,
 *   limitMs: number,                  // turn time limit in ms (botTime * 1000 etc.)
 *   graceMs?: number,
 *   tickMs?: number,
 *   now?: () => number,
 *   setIntervalFn?: typeof setInterval,
 *   clearIntervalFn?: typeof clearInterval,
 * }} options
 */
export function createTimeoutWatchdog({
  db,
  roomId,
  mySlot,
  limitMs,
  graceMs = DEFAULT_WATCHDOG_GRACE_MS,
  tickMs = DEFAULT_WATCHDOG_TICK_MS,
  now = () => Date.now(),
  setIntervalFn = (typeof setInterval !== 'undefined' ? setInterval : null),
  clearIntervalFn = (typeof clearInterval !== 'undefined' ? clearInterval : null),
} = {}) {
  if (!db) throw new Error('createTimeoutWatchdog: db is required');
  if (!roomId) throw new Error('createTimeoutWatchdog: roomId is required');
  if (mySlot !== 0 && mySlot !== 1) throw new Error('createTimeoutWatchdog: mySlot must be 0 or 1');

  let disposed = false;
  let intervalHandle = null;
  // Promise returned by the most recent tick — exposed so tests can await it.
  let lastTickPromise = Promise.resolve(null);

  function buildHelperState(room) {
    return {
      turn: room.currentTurnSlot,
      currentTurnSlot: room.currentTurnSlot,
      passCount: Number(room._passCount ?? 0),
      moveCount: Array.isArray(room.moveHistory) ? room.moveHistory.length : 0,
      turnDeadlineMs: Number(room.turnDeadlineMs ?? 0),
      stateSeq: Number(room.version ?? 0),
      missedTurns: room.missedTurns ?? { 0: 0, 1: 0 },
    };
  }

  // Translate the helper's output back into the room schema. The helper
  // returns a flat patch with legacy field names (`turn`, `stateSeq`); the
  // room uses `currentTurnSlot` and `version`. Keep `_passCount` /
  // `missedTurns` since the spine reads them via the same fields.
  //
  // Also clear livePreview: the active player who just timed out may have
  // had tentative tiles broadcast via setLivePreview. Without clearing them
  // here, those ghost tiles stay on the opponent's board indefinitely
  // (the active player's tab is likely hung/disconnected, so they won't
  // clear it themselves).
  function applyPatchToRoom(room, patch) {
    return {
      ...room,
      currentTurnSlot: patch.currentTurnSlot,
      turnNumber: Number(room.turnNumber ?? 1) + 1,
      turnDeadlineMs: patch.turnDeadlineMs,
      version: patch.stateSeq,
      missedTurns: patch.missedTurns,
      _passCount: patch.passCount,
      livePreview: null,
      updatedAt: patch.ts ?? now(),
    };
  }

  async function tick() {
    if (disposed) return { committed: false, reason: 'disposed' };
    const ref = db.ref(`${PATH.rooms}/${roomId}`);
    // Warm the RTDB client's local cache before the transaction. Without
    // this, a cold client can receive an initial null value, return undefined
    // from the update function, and abort before the server state is loaded.
    let warmRoom = null;
    try {
      const snap = await ref.get();
      warmRoom = snap?.val ? snap.val() : null;
    } catch { /* transaction below will surface errors */ }
    const result = await ref.transaction((room) => {
      const current = room ?? warmRoom;
      if (!current) return;
      if (current.status !== 'playing') return;
      // Watchdog only runs in live timed mode. If the room settings turn
      // the timer off, no-op.
      if (!current.settings?.timelimit) return;
      // While the active player is in a bonus flow (mini-game, wheel, or
      // +N award overlay), the turn clock is conceptually frozen for both
      // clients. Rotating the turn here would (a) yank control away from
      // the active player mid-bonus and (b) collapse the spectator overlay
      // on the receiver, because the active player's local TURN_CHANGED
      // remote-sync handler clears liveBonus. Skip ticks until the active
      // player commits the deferred move (which clears liveBonus naturally).
      if (current.liveBonus?.active) return;
      // The active player's deadline must exist and be past now + grace.
      const state = buildHelperState(current);
      if (!shouldClaimExpiredOnlineTurn(state, mySlot, now(), graceMs)) return;
      const patch = computeExpiredOnlineTurnState(state, now(), Number(limitMs || 0));
      if (!patch) return;
      return applyPatchToRoom(current, patch);
    });
    return result;
  }

  if (typeof setIntervalFn === 'function') {
    intervalHandle = setIntervalFn(() => {
      // Track the latest tick so dispose() / tests can await it.
      lastTickPromise = tick().catch((e) => {
        // Network blips / transaction aborts shouldn't tear down the watchdog.
        // The next tick will retry.
        return { committed: false, error: e };
      });
    }, tickMs);
  }

  function dispose() {
    disposed = true;
    if (intervalHandle != null && typeof clearIntervalFn === 'function') {
      try { clearIntervalFn(intervalHandle); } catch { /* swallow */ }
      intervalHandle = null;
    }
  }

  return {
    tick,
    dispose,
    // Test helper — await the most recent tick scheduled by the interval.
    _lastTick: () => lastTickPromise,
  };
}
