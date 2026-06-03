import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { modeDescriptor } from '../../game/sessions/modes.js';
import { PRESENCE_GRACE_MS, watchPresence as defaultWatchPresence } from '../../game/online/presenceService.js';
import { DISCONNECT_INTENT, DISCONNECT_OPEN, DISCONNECT_CLOSE } from '../screens/disconnectScreen.js';

export function createDisconnectController({
  bus,
  dbRef = () => globalThis.__spine?.db ?? null,
  sessionRef = () => globalThis.__spine?.activeGame?.session ?? null,
  watchPresence = defaultWatchPresence,
  graceMs = PRESENCE_GRACE_MS,
  now = () => Date.now(),
  pollMs = 5_000,
} = {}) {
  if (!bus) throw new Error('createDisconnectController: bus required');

  const cleanups = [];
  let unwatch = null;
  let pollInterval = null;
  let watchedUid = null;
  let lastPresence = null;

  // Disconnect state — persists across Firebase callbacks and poll ticks.
  // Semantics: ONLY a CONTINUOUS offline period > graceMs triggers the
  // overlay. The previous implementation accumulated across reconnect /
  // disconnect cycles without resetting on reconnect, so brief WebSocket
  // blips (extremely common: every mobile network switch, background-tab
  // throttle, slow Wi-Fi, brief Firebase WebSocket drop) added up over
  // a long game and falsely triggered the overlay even though the
  // opponent was "online from their own perspective" the whole time
  // (bug #2 surfaced by the simulator's presence-flicker scenario).
  //
  // The accumulator is kept (still summing during a single offline span
  // for the elapsed calculation) but it is RESET to 0 on every online
  // transition before any overlay opens. If the overlay is already open
  // we do NOT reset — the countdown should keep its current position so
  // a flicker right at the deadline doesn't grant a free extra grace.
  let disconnectOpen = false;
  let totalDisconnectedMs = 0;
  let disconnectStart = null;
  let awaitingTurnForAppClose = false;
  let offTurnChanged = null;

  cleanups.push(bus.on(EV.GAME_STARTED, resubscribe));
  cleanups.push(bus.on(EV.GAME_COMPLETED, () => {
    stopWatch();
    bus.emit(DISCONNECT_CLOSE, {});
  }));
  cleanups.push(bus.on(DISCONNECT_INTENT.AUTO_WIN, (payload = {}) => {
    const session = sessionRef();
    const mySlot = session?.mySlot;
    const opponentSlot = mySlot === 0 ? 1 : mySlot === 1 ? 0 : session?.state?.currentTurnSlot;
    const reason = payload?.reason ?? 'disconnect';
    session?.dispatch?.({ type: CMD.RESIGN_GAME, payload: { slot: opponentSlot, reason } });
  }));

  resubscribe();

  function resubscribe() {
    const session = sessionRef();
    const state = session?.state;
    const desc = modeDescriptor(state?.mode);
    const mySlot = session?.mySlot;
    const opponentSlot = mySlot === 0 ? 1 : mySlot === 1 ? 0 : null;
    const opponentUid = opponentSlot == null ? null : state?.players?.[opponentSlot]?.uid;
    const db = dbRef();

    if (!db || !desc.presenceCritical || !opponentUid) {
      stopWatch();
      return;
    }
    if (watchedUid === opponentUid) return;

    stopWatch();
    watchedUid = opponentUid;
    lastPresence = null;

    function handlePresence(presence) {
      const ts = now();
      const online = isPresenceOnline(presence, ts, graceMs);

      if (online) {
        // Opponent came back online. Sum the just-ended offline span only
        // if the overlay is already open (where the countdown depends on
        // historical accumulated time). Otherwise — the overlay hasn't
        // opened yet — RESET totalDisconnectedMs. This enforces strict
        // continuous-offline semantics: brief flickers that never
        // crossed graceMs in a single span do not stack up.
        if (disconnectStart !== null) {
          if (disconnectOpen) {
            totalDisconnectedMs += ts - disconnectStart;
          } else {
            totalDisconnectedMs = 0;
          }
          disconnectStart = null;
        }
        if (disconnectOpen) {
          disconnectOpen = false;
          bus.emit(DISCONNECT_CLOSE, {});
        }
        if (awaitingTurnForAppClose) {
          awaitingTurnForAppClose = false;
          if (offTurnChanged) { offTurnChanged(); offTurnChanged = null; }
        }
        return;
      }

      // App-close: backgrounded:true + connected:false → deliberate quit.
      // Bypasses the grace period — immediate resign (or after current move completes).
      if (isAppClosed(presence) && !awaitingTurnForAppClose) {
        awaitingTurnForAppClose = true;
        const sess = sessionRef();
        const currentTurnSlot = sess?.state?.currentTurnSlot;
        const sesMySlot = sess?.mySlot;

        if (currentTurnSlot === sesMySlot) {
          // I'm mid-move — finish it, then resign the opponent.
          offTurnChanged = bus.on(EV.TURN_CHANGED, () => {
            if (offTurnChanged) { offTurnChanged(); offTurnChanged = null; }
            bus.emit(DISCONNECT_INTENT.AUTO_WIN, { reason: 'left' });
          });
        } else {
          // Closing player's turn or unknown — resign immediately.
          bus.emit(DISCONNECT_INTENT.AUTO_WIN, { reason: 'left' });
        }
        return;
      }

      if (awaitingTurnForAppClose) return;

      // Internet disconnect / stale presence — accumulating grace + countdown.
      if (disconnectStart === null) {
        // For the stale-lastSeen fallback (no `connected` field in presence): anchor
        // the clock at when the heartbeat actually stopped, not when we first noticed.
        // This ensures the grace window reflects real offline duration.
        const lastSeen = Number(presence?.lastSeen || 0);
        const hasConnectedField = presence && typeof presence === 'object' && 'connected' in presence;
        if (!hasConnectedField && lastSeen > 0 && lastSeen < ts) {
          const staleMs = Math.min(ts - lastSeen, graceMs * 2);
          disconnectStart = ts - staleMs;
        } else {
          disconnectStart = ts;
        }
      }

      const maxMs = graceMs * 2;
      const elapsed = totalDisconnectedMs + (ts - disconnectStart);

      if (!disconnectOpen && elapsed >= graceMs) {
        const remainingSeconds = Math.max(1, Math.ceil((maxMs - elapsed) / 1000));
        disconnectOpen = true;
        bus.emit(DISCONNECT_OPEN, {
          seconds: remainingSeconds,
          opponentName: state?.players?.[opponentSlot]?.displayName,
        });
      }
    }

    unwatch = watchPresence(db, opponentUid, (presence) => {
      lastPresence = presence;
      handlePresence(presence);
    });

    // Poll periodically so stale lastSeen is caught even when Firebase's
    // onDisconnect hook hasn't fired yet.
    pollInterval = setInterval(() => {
      if (lastPresence != null) handlePresence(lastPresence);
    }, pollMs);
  }

  function stopWatch() {
    if (unwatch) { try { unwatch(); } catch {} unwatch = null; }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (offTurnChanged) { offTurnChanged(); offTurnChanged = null; }
    watchedUid = null;
    lastPresence = null;
    disconnectOpen = false;
    totalDisconnectedMs = 0;
    disconnectStart = null;
    awaitingTurnForAppClose = false;
  }

  function dispose() {
    stopWatch();
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { resubscribe, dispose };
}

// Returns true if the opponent's presence indicates they are reachable.
// backgrounded:true + connected:true = alive (game open in background, no overlay).
// connected:false = offline regardless of other fields.
export function isPresenceOnline(presence, nowMs = Date.now(), graceMs = PRESENCE_GRACE_MS) {
  if (presence === true) return true;
  if (!presence || typeof presence !== 'object') return !!presence;
  // Tab/app close writes backgrounded:true then connected:false — check
  // connected:false first so the closed state wins over the backgrounded flag.
  if (presence.connected === false) return false;
  // App backgrounded (game still open) with WebSocket alive — counts as online.
  if (presence.backgrounded === true) return true;
  if (presence.connected === true) return true;
  // Fallback when `connected` is absent (legacy / stale entries).
  const lastSeen = Number(presence.lastSeen || 0);
  return lastSeen > 0 && nowMs - lastSeen <= graceMs;
}

// Returns true when the opponent deliberately closed the app:
// visibilitychange set backgrounded:true, then Firebase onDisconnect fired connected:false.
export function isAppClosed(presence) {
  return !!(
    presence &&
    typeof presence === 'object' &&
    presence.connected === false &&
    presence.backgrounded === true
  );
}
