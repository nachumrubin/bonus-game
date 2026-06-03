// Presence service.
//
// Each connected user writes /presence/{uid} = { connected, lastSeen, currentRoom?, backgrounded? }
// with an onDisconnect handler that auto-clears the connected flag. A heartbeat
// every 10s refreshes lastSeen.
//
// When the tab is hidden (Page Visibility API), we set backgrounded:true.
// Mobile browsers throttle setInterval heavily on hidden tabs, so lastSeen
// would otherwise stale and the opponent's overlay would incorrectly fire.
// The opponent's isPresenceOnline() treats backgrounded:true as "alive but
// paused" — no disconnect overlay, but the turn timer still expires, and
// missing 2 turns in a row forfeits the game.
//
// Online sessions read /presence/{partnerUid} to drive the live-mode
// disconnect grace timer. Async modes ignore presence entirely (the
// opponent is *expected* to be offline) — see plan §2 #14.

import { PATH } from './schema.js';

export const HEARTBEAT_MS = 10_000;
export const PRESENCE_GRACE_MS = 30_000;

function presenceRef(db, uid) {
  return db.ref(`${PATH.presence}/${uid}`);
}

export async function startPresence(db, {
  uid,
  currentRoom = null,
  serverTimestamp,
  doc = (typeof document !== 'undefined' ? document : null),
}) {
  const r = presenceRef(db, uid);
  const timestamp = () => typeof serverTimestamp === 'function' ? serverTimestamp() : (serverTimestamp ?? Date.now());
  const hiddenNow = () => !!(doc && doc.visibilityState === 'hidden');

  // Write full presence + arm onDisconnect. Called once at startup AND on
  // every WebSocket reconnect — see the .info/connected watcher below for
  // why. Idempotent: each call replaces the prior presence record entirely.
  async function affirmPresence() {
    try {
      await r.set({ connected: true, lastSeen: timestamp(), currentRoom, backgrounded: hiddenNow() });
      if (r.onDisconnect) {
        await r.onDisconnect().update({ connected: false, backgrounded: false, lastSeen: timestamp() });
      }
    } catch { /* swallow — heartbeat will retry, and .info/connected will re-fire on next reconnect */ }
  }
  await affirmPresence();

  // Restore-on-reconnect. The bug this guards against: the Firebase RTDB
  // server fires the armed onDisconnect handler whenever the WebSocket
  // drops — including transient drops from auth-token refresh, mobile
  // network switch, brief connectivity loss. That writes `connected:false`
  // to our /presence entry. When the SDK reconnects, our session has no
  // idea and just keeps the heartbeat going (which only updates lastSeen)
  // — so `connected` stays stuck at false from the server's perspective,
  // and the OPPONENT'S disconnectController sees us as offline forever
  // even though we are perfectly fine (bug #2 root cause).
  //
  // Fix: subscribe to RTDB's special `.info/connected` and on every
  // transition to true, re-write the full presence + re-arm onDisconnect.
  // The first callback fires synchronously with the current state at boot
  // so affirmPresence runs twice on startup; that's idempotent and the
  // cost (one extra .set) is negligible.
  let connectedRef = null;
  let connectedHandler = null;
  try {
    connectedRef = db.ref('.info/connected');
    connectedHandler = (snap) => {
      if (snap?.val() !== true) return;
      affirmPresence();
    };
    connectedRef.on('value', connectedHandler);
  } catch { /* .info/connected not available in this environment — ok */ }

  // Heartbeat: also re-affirms `connected:true` on every tick. Belt-and-
  // braces with the .info/connected watcher above — if the watcher misses
  // a reconnect for any reason (callback not yet registered when reconnect
  // happens, .info path unavailable), the heartbeat self-heals within
  // HEARTBEAT_MS (10s). Without this, a single onDisconnect-induced
  // `connected:false` would persist for the rest of the session.
  const interval = setInterval(() => {
    r.update({ connected: true, lastSeen: timestamp() }).catch(() => {});
  }, HEARTBEAT_MS);

  let visHandler = null;
  if (doc && typeof doc.addEventListener === 'function') {
    visHandler = () => {
      r.update({ backgrounded: hiddenNow(), lastSeen: timestamp(), connected: true }).catch(() => {});
    };
    doc.addEventListener('visibilitychange', visHandler);
  }

  return {
    stop: async () => {
      clearInterval(interval);
      if (connectedRef && connectedHandler) {
        try { connectedRef.off('value', connectedHandler); } catch { /* swallow */ }
      }
      if (doc && visHandler && typeof doc.removeEventListener === 'function') {
        try { doc.removeEventListener('visibilitychange', visHandler); } catch { /* swallow */ }
      }
      try { await r.update({ connected: false, lastSeen: timestamp(), currentRoom: null, backgrounded: false }); } catch { /* swallow */ }
    },
  };
}

// One-shot read of a user's presence. Returns { connected, lastSeen } or null.
export async function readPresenceOnce(db, uid) {
  if (!uid) return null;
  const snap = await presenceRef(db, uid).get();
  return snap?.val ? snap.val() : null;
}

// Subscribe to a partner's presence. cb is fired with { connected, lastSeen }
// each time it changes. Returns an unsubscribe.
export function watchPresence(db, partnerUid, cb) {
  const r = presenceRef(db, partnerUid);
  const handler = (snap) => {
    const v = snap?.val ? snap.val() : null;
    cb(v ?? { connected: false, lastSeen: 0 });
  };
  r.on('value', handler);
  return () => r.off('value', handler);
}
