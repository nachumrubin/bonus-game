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
// { matched: false } if nobody compatible is waiting / we should keep
// listening (the higher-uid waiter learns it was paired via its activeRoom).
//
// `createRoomFromPair(myEntry, theirEntry)` produces the room from the two
// queue entries. It runs only after BOTH queue nodes have been claimed.
//
// Concurrency model — why both nodes are claimed, and why only the lower uid
// drives:
//   The earlier version claimed a single SHARED node, min(me, partner). That
//   serialized two clients who picked EACH OTHER, but NOT two clients who both
//   picked the same partner: if that partner had the highest uid, each searcher
//   claimed its OWN (different) node, both transactions committed, and both
//   created a room with the shared partner — double-booking it. The third
//   player then sat in a coin toss against a phantom opponent. (Reported June
//   2026; see DECISIONS.md.)
//   Fix: a pair has exactly one driver — the LOWER uid. The driver claims BOTH
//   queue nodes (its own first, then the partner's). Any two pairings that
//   involve the same player both claim that player's node, so they serialize
//   on it; the loser aborts. Claiming OWN-first means a rollback only ever
//   re-adds our OWN entry, staying within the `auth.uid === $uid` write rule
//   (the rules allow deleting any node but writing only your own).
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

  // Only the lower-uid side drives the claim; the higher-uid side waits for
  // its activeRoom to flip (set by createRoom for both players). This makes a
  // pair have a single driver and lets that driver own both claims.
  if (uid > partner.uid) return { matched: false };

  // Claim our OWN node first.
  const selfClaim = await selfQueueRef(db, mode, uid).transaction((current) => {
    if (!current) return; // someone already claimed us — abort
    return null;          // claim by deleting
  });
  if (!selfClaim?.committed) return { matched: false };

  // Then claim the partner's node. If it's already gone (another pairing took
  // this partner), roll our own entry back into the queue and bail so we're
  // not silently dropped — the next queue change re-runs tryPair.
  const partnerClaim = await selfQueueRef(db, mode, partner.uid).transaction((current) => {
    if (!current) return; // partner already taken — abort
    return null;
  });
  if (!partnerClaim?.committed) {
    try {
      await selfQueueRef(db, mode, uid).set(myEntry);
      selfQueueRef(db, mode, uid).onDisconnect?.().remove();
    } catch (err) {
      console.warn('[matchmakingService.tryPair] re-queue after lost partner failed', err);
    }
    return { matched: false };
  }

  const { room, roomId } = await createRoomFromPair(myEntry, partner);
  return { matched: true, partnerUid: partner.uid, roomId, room };
}
