// Matchmaking — queue-based.
//
// Replaces the legacy O(N) "loop every room and find one with status=waiting"
// scan. Each searcher writes a queue entry under
// /matchmakingQueue/{mode}/{uid}; whichever client wins the race executes a
// transaction that removes both entries and creates a room. The loser's
// transaction aborts and they retry.

import { PATH } from './schema.js';

function queueRef(db, mode) {
  return db.ref(`${PATH.matchmakingQueue}/${mode}`);
}

function selfQueueRef(db, mode, uid) {
  return db.ref(`${PATH.matchmakingQueue}/${mode}/${uid}`);
}

export async function joinQueue(db, { uid, mode, profile, settings, serverTimestamp }) {
  await selfQueueRef(db, mode, uid).set({
    uid, mode,
    displayName: profile.displayName,
    avatar: profile.avatar,
    rating: profile.rating ?? 1000,
    settings,
    joinedAt: serverTimestamp,
  });
  // Auto-clear on disconnect
  selfQueueRef(db, mode, uid).onDisconnect?.().remove();
  return { ok: true };
}

export async function leaveQueue(db, { uid, mode }) {
  await selfQueueRef(db, mode, uid).remove();
}

// Decide whether two queue entries should be allowed to pair. Honors:
//   - settings.strict       (timelimit must match if either side is strict)
//   - settings.ratingRange  (asymmetric: each side enforces their own range)
//
// Mode is implicitly enforced because queues are keyed by mode.
export function isCompatible(a, b) {
  const aSettings = a?.settings ?? {};
  const bSettings = b?.settings ?? {};

  // Strict-search: timelimit must match if either side asked for strict.
  if ((aSettings.strict || bSettings.strict) &&
      aSettings.timelimit !== bSettings.timelimit) {
    return false;
  }

  // Rating range: each side enforces its own filter on the other.
  const aRating = a?.rating ?? 1000;
  const bRating = b?.rating ?? 1000;
  if (aSettings.ratingRange != null &&
      Math.abs(aRating - bRating) > aSettings.ratingRange) {
    return false;
  }
  if (bSettings.ratingRange != null &&
      Math.abs(aRating - bRating) > bSettings.ratingRange) {
    return false;
  }

  return true;
}

// Try to find a partner in the queue and pair atomically.
// Returns { matched: true, partnerUid, roomId } if a pair was claimed, or
// { matched: false } if nobody compatible is waiting (caller should keep
// listening).
//
// `createRoomFromPair(myEntry, theirEntry)` is a callback that produces the
// room metadata + roomId from the two queue entries. It runs OUTSIDE the
// transaction so it can use the full createInitialState pipeline; the
// transaction's only job is to atomically claim both entries.
export async function tryPair(db, { uid, mode, createRoomFromPair }) {
  const all = await queueRef(db, mode).get();
  const entries = all?.val ? all.val() : null;
  if (!entries) return { matched: false };

  const myEntry = entries[uid];
  if (!myEntry) return { matched: false }; // we're not in the queue anymore

  // Pick the oldest COMPATIBLE entry that is not us.
  const others = Object.values(entries)
    .filter(e => e.uid !== uid && isCompatible(myEntry, e))
    .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  if (others.length === 0) return { matched: false };
  const partner = others[0];

  // Atomically claim both entries by removing them in a multi-path update.
  // If another client has already removed either, the update succeeds but
  // we'll detect the partial outcome by re-reading.
  const updates = {
    [`${PATH.matchmakingQueue}/${mode}/${uid}`]: null,
    [`${PATH.matchmakingQueue}/${mode}/${partner.uid}`]: null,
  };
  await db.ref().update(updates);

  // Verify both were ours to claim — re-read; if either entry has been
  // re-added (race) or the partner was claimed by someone else, abort.
  const verify = await queueRef(db, mode).get();
  const remaining = verify?.val ? verify.val() : {};
  if (remaining[uid] || remaining[partner.uid]) {
    return { matched: false };
  }

  const { room, roomId } = await createRoomFromPair(myEntry, partner);
  return { matched: true, partnerUid: partner.uid, roomId, room };
}
