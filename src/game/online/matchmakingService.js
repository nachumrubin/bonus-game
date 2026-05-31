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
// transaction's only job is to atomically claim both entries — this is
// what guarantees a single winner when both clients run tryPair at the
// same instant (without it, both can "win", each builds its own room,
// and the two players end up in two different rooms with desynced state).
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

  // Atomically claim the pair via a transaction on a SHARED queue entry —
  // the one belonging to whichever uid sorts first. Both racing clients
  // (who picked each other as partner) compute the same path, so their
  // transactions serialize on the same node: only one sees `current` as
  // present and returns null to delete it; the other reads null and
  // aborts. The rules allow this because writing `null` satisfies the
  // `!newData.exists()` branch of the $uid write rule, no matter who is
  // authenticated. A transaction on the parent /matchmakingQueue/{mode}
  // node would be rejected — there is no .write rule at that level.
  const claimUid = uid < partner.uid ? uid : partner.uid;
  const otherUid = uid < partner.uid ? partner.uid : uid;
  const claim = await db.ref(`${PATH.matchmakingQueue}/${mode}/${claimUid}`)
    .transaction((current) => {
      if (!current) return; // abort — the other client already claimed
      return null;          // claim by deleting this entry
    });
  if (!claim?.committed) return { matched: false };

  // We own the pair. Best-effort: remove the other entry too so it doesn't
  // sit as a phantom in the queue. Rules also allow this (newData is null).
  try {
    await db.ref(`${PATH.matchmakingQueue}/${mode}/${otherUid}`).remove();
  } catch (err) {
    // If this fails the partner's listener will still see activeRoom flip
    // and proceed; the stale queue entry is recovered by the next tryPair
    // or the onDisconnect handler in joinQueue.
    console.warn('[matchmakingService.tryPair] removing partner queue entry failed', err);
  }

  const { room, roomId } = await createRoomFromPair(myEntry, partner);
  return { matched: true, partnerUid: partner.uid, roomId, room };
}
