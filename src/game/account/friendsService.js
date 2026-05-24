// Friends service.
//
// Schema (matches legacy):
//   friends/{uid}/{friendUid}              → { name, avatar, addedAt }
//   friendRequests/{toUid}/{fromUid}       → { fromName, fromAvatar, sentAt }
//
// All operations return promise-shaped { ok, reason? } so callers can map
// to user-visible messages.

import * as bus from '../../events/bus.js';

export const PATH = Object.freeze({
  friends:        'friends',
  friendRequests: 'friendRequests',
});

export const FRIENDS_EVT = Object.freeze({
  REQUEST_RECEIVED: 'friends/requestReceived',
  REQUEST_ACCEPTED: 'friends/requestAccepted',
  REQUEST_REJECTED: 'friends/requestRejected',
  LIST_CHANGED:     'friends/listChanged',
});

function friendsRef(db, uid)         { return db.ref(`${PATH.friends}/${uid}`); }
function friendRef(db, uid, fid)     { return db.ref(`${PATH.friends}/${uid}/${fid}`); }
function requestsRef(db, uid)        { return db.ref(`${PATH.friendRequests}/${uid}`); }
function requestRef(db, toUid, fid)  { return db.ref(`${PATH.friendRequests}/${toUid}/${fid}`); }

// ── Requests ────────────────────────────────────────────────

export async function sendFriendRequest(db, { fromUid, toUid, fromName, fromAvatar, serverTimestamp = Date.now() }) {
  if (!fromUid || !toUid) return { ok: false, reason: 'missing-uid' };
  if (fromUid === toUid)  return { ok: false, reason: 'self' };
  // Don't double-send if already friends
  const already = await friendRef(db, fromUid, toUid).get();
  if (already?.val ? already.val() : null) return { ok: false, reason: 'already-friends' };
  await requestRef(db, toUid, fromUid).set({
    fromUid, fromName, fromAvatar: fromAvatar ?? null,
    sentAt: serverTimestamp,
  });
  return { ok: true };
}

// Accept a friend request: writes the friendship symmetrically (both
// directions) AND clears the pending request.
export async function acceptFriendRequest(db, { fromUid, toUid, fromProfile, toProfile, serverTimestamp = Date.now() }) {
  if (!fromUid || !toUid) return { ok: false, reason: 'missing-uid' };
  // Verify the request exists
  const reqSnap = await requestRef(db, toUid, fromUid).get();
  if (!(reqSnap?.val ? reqSnap.val() : null)) return { ok: false, reason: 'no-request' };

  await Promise.all([
    friendRef(db, toUid,   fromUid).set({
      uid: fromUid,
      name:   fromProfile?.displayName  ?? '',
      avatar: fromProfile?.equippedAvatar ?? null,
      addedAt: serverTimestamp,
    }),
    friendRef(db, fromUid, toUid).set({
      uid: toUid,
      name:   toProfile?.displayName    ?? '',
      avatar: toProfile?.equippedAvatar ?? null,
      addedAt: serverTimestamp,
    }),
    requestRef(db, toUid, fromUid).remove(),
  ]);
  bus.emit(FRIENDS_EVT.REQUEST_ACCEPTED, { fromUid, toUid });
  return { ok: true };
}

export async function rejectFriendRequest(db, { fromUid, toUid }) {
  if (!fromUid || !toUid) return { ok: false, reason: 'missing-uid' };
  await requestRef(db, toUid, fromUid).remove();
  bus.emit(FRIENDS_EVT.REQUEST_REJECTED, { fromUid, toUid });
  return { ok: true };
}

// Cancel a request you sent (the recipient hasn't responded yet).
export async function cancelFriendRequest(db, { fromUid, toUid }) {
  if (!fromUid || !toUid) return { ok: false, reason: 'missing-uid' };
  await requestRef(db, toUid, fromUid).remove();
  return { ok: true };
}

// Subscribe to the inbox of pending requests for `uid`. Returns
// unsubscribe.
export function watchIncomingRequests(db, uid, cb) {
  if (!uid) { cb([]); return () => {}; }
  const ref = requestsRef(db, uid);
  const handler = (snap) => {
    const raw = snap?.val ? snap.val() : null;
    if (!raw) { cb([]); return; }
    cb(Object.entries(raw).map(([fromUid, body]) => ({ fromUid, ...body })));
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// ── Friends list ────────────────────────────────────────────

export async function listFriends(db, uid) {
  if (!uid) return [];
  const snap = await friendsRef(db, uid).get();
  const raw = snap?.val ? snap.val() : null;
  if (!raw) return [];
  return Object.entries(raw).map(([fid, body]) => ({ uid: fid, ...body }));
}

export function watchFriends(db, uid, cb) {
  if (!uid) { cb([]); return () => {}; }
  const ref = friendsRef(db, uid);
  const handler = async () => {
    const list = await listFriends(db, uid);
    cb(list);
    bus.emit(FRIENDS_EVT.LIST_CHANGED, { uid, count: list.length });
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

export async function removeFriend(db, { uid, friendUid }) {
  if (!uid || !friendUid) return { ok: false, reason: 'missing-uid' };
  await Promise.all([
    friendRef(db, uid, friendUid).remove(),
    friendRef(db, friendUid, uid).remove(),
  ]);
  return { ok: true };
}

// Pure: filter friend list by name substring (case-insensitive).
export function filterFriendsByName(friends, query) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return friends.slice();
  return friends.filter(f => (f.name ?? '').toLowerCase().includes(q));
}

// Pure: returns true iff there's a pending outgoing request from `fromUid`
// to `toUid` (caller looks this up via requestRef and passes the entry in).
export function hasPendingRequest(entry) {
  return entry != null && typeof entry === 'object';
}
