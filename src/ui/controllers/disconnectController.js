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
  let disconnectOpen = false;

  cleanups.push(bus.on(EV.GAME_STARTED, resubscribe));
  cleanups.push(bus.on(EV.GAME_COMPLETED, () => {
    stopWatch();
    bus.emit(DISCONNECT_CLOSE, {});
  }));
  cleanups.push(bus.on(DISCONNECT_INTENT.AUTO_WIN, () => {
    const session = sessionRef();
    const mySlot = session?.mySlot;
    const opponentSlot = mySlot === 0 ? 1 : mySlot === 1 ? 0 : session?.state?.currentTurnSlot;
    session?.dispatch?.({ type: CMD.RESIGN_GAME, payload: { slot: opponentSlot, reason: 'disconnect' } });
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
    disconnectOpen = false;

    function handlePresence(presence) {
      if (isPresenceOnline(presence, now(), graceMs)) {
        if (disconnectOpen) {
          disconnectOpen = false;
          bus.emit(DISCONNECT_CLOSE, {});
        }
        return;
      }
      if (!disconnectOpen) {
        disconnectOpen = true;
        bus.emit(DISCONNECT_OPEN, {
          seconds: Math.ceil(graceMs / 1000),
          opponentName: state?.players?.[opponentSlot]?.displayName,
        });
      }
    }

    unwatch = watchPresence(db, opponentUid, (presence) => {
      lastPresence = presence;
      handlePresence(presence);
    });

    // Poll periodically so a stale lastSeen is caught even when Firebase's
    // onDisconnect hook hasn't fired yet (can take up to a minute in RTDB).
    pollInterval = setInterval(() => {
      if (lastPresence != null) handlePresence(lastPresence);
    }, pollMs);
  }

  function stopWatch() {
    if (unwatch) {
      try { unwatch(); } catch {}
      unwatch = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    watchedUid = null;
    lastPresence = null;
    disconnectOpen = false;
  }

  function dispose() {
    stopWatch();
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { resubscribe, dispose };
}

export function isPresenceOnline(presence, nowMs = Date.now(), graceMs = PRESENCE_GRACE_MS) {
  if (presence === true) return true;
  if (!presence || typeof presence !== 'object') return !!presence;
  // Backgrounded tabs are alive but throttled. Don't fire the disconnect
  // overlay — the turn timer + missed-turns forfeit cover the away case.
  if (presence.backgrounded === true) return true;
  // Firebase onDisconnect explicitly cleared the connected flag: authoritative.
  if (presence.connected === false) return false;
  if (presence.connected === true) return true;
  // Fallback when `connected` is missing entirely (legacy / stale entries).
  const lastSeen = Number(presence.lastSeen || 0);
  return lastSeen > 0 && nowMs - lastSeen <= graceMs;
}
