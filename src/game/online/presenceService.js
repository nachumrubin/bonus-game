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
  const initiallyHidden = !!(doc && doc.visibilityState === 'hidden');
  await r.set({ connected: true, lastSeen: timestamp(), currentRoom, backgrounded: initiallyHidden });
  if (r.onDisconnect) {
    await r.onDisconnect().update({ connected: false, backgrounded: false, lastSeen: timestamp() });
  }
  const interval = setInterval(() => {
    r.update({ lastSeen: timestamp() }).catch(() => {});
  }, HEARTBEAT_MS);

  let visHandler = null;
  if (doc && typeof doc.addEventListener === 'function') {
    visHandler = () => {
      const hidden = doc.visibilityState === 'hidden';
      r.update({ backgrounded: hidden, lastSeen: timestamp() }).catch(() => {});
    };
    doc.addEventListener('visibilitychange', visHandler);
  }

  return {
    stop: async () => {
      clearInterval(interval);
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
