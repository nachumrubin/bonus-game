// Presence service.
//
// Each connected user writes /presence/{uid} = { connected, lastSeen, currentRoom? }
// with an onDisconnect handler that auto-clears the connected flag. A heartbeat
// every 10s refreshes lastSeen.
//
// Online sessions read /presence/{partnerUid} to drive the live-mode
// disconnect grace timer. Async modes ignore presence entirely (the
// opponent is *expected* to be offline) — see plan §2 #14.

import { PATH } from './schema.js';

export const HEARTBEAT_MS = 10_000;
export const PRESENCE_GRACE_MS = 35_000;

function presenceRef(db, uid) {
  return db.ref(`${PATH.presence}/${uid}`);
}

export async function startPresence(db, { uid, currentRoom = null, serverTimestamp }) {
  const r = presenceRef(db, uid);
  const timestamp = () => typeof serverTimestamp === 'function' ? serverTimestamp() : (serverTimestamp ?? Date.now());
  await r.set({ connected: true, lastSeen: timestamp(), currentRoom });
  if (r.onDisconnect) {
    await r.onDisconnect().update({ connected: false, lastSeen: timestamp() });
  }
  const interval = setInterval(() => {
    r.update({ lastSeen: timestamp() }).catch(() => {});
  }, HEARTBEAT_MS);
  return {
    stop: async () => {
      clearInterval(interval);
      try { await r.update({ connected: false, lastSeen: timestamp(), currentRoom: null }); } catch { /* swallow */ }
    },
  };
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
