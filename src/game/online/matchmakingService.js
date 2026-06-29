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

// Decide whether two queue entries are ALLOWED to pair (a hard yes/no). Soft
// preferences — how desirable a compatible candidate is — are scored separately
// by matchDistance() and only affect which compatible candidate is chosen.
//
// Mode is implicitly enforced because queues are keyed by mode.
//
// "חיפוש מדויק" (exact search) is a per-player switch that makes ALL of that
// player's settings HARD constraints. A flexible (unchecked) player imposes no
// hard constraint — it will still pair with anyone in the pool, just preferring
// the closest match (see matchDistance / tryPair). Specifically:
//   - timelimit (live vs async) must match whenever EITHER side is strict.
//   - botTime (the live turn speed: בזק 20 / רגיל 40 / איטי 60) must match only
//     when BOTH sides are strict. If exactly one side is strict, they still pair
//     and the flexible side adopts the strict side's speed (resolved in
//     spineMatchmaking.createRoomForPair), so the strict player gets the pace it
//     asked for.
//   - ratingRange is a hard filter ONLY for the strict side(s). A flexible
//     searcher may pair with an opponent outside its preferred range if that's
//     all the pool offers; its range only influences candidate ranking.
export function isCompatible(a, b) {
  const aSettings = a?.settings ?? {};
  const bSettings = b?.settings ?? {};

  if ((aSettings.strict || bSettings.strict) &&
      aSettings.timelimit !== bSettings.timelimit) {
    return false;
  }
  if (aSettings.strict && bSettings.strict &&
      (aSettings.botTime ?? null) !== (bSettings.botTime ?? null)) {
    return false;
  }

  // Rating range is a hard filter only for a STRICT searcher.
  const ratingGap = Math.abs((a?.rating ?? 1000) - (b?.rating ?? 1000));
  if (aSettings.strict && aSettings.ratingRange != null &&
      ratingGap > aSettings.ratingRange) {
    return false;
  }
  if (bSettings.strict && bSettings.ratingRange != null &&
      ratingGap > bSettings.ratingRange) {
    return false;
  }

  return true;
}

// Score how close a (compatible) candidate is to `me`'s preferences — lower is
// better. Used to pick the BEST partner from the pool, realizing the flexible
// "pair me with the closest available player" semantics. Primary axis: the turn
// speed (a different pace is the largest experience gap, so a same-speed partner
// always wins over a different-speed one). Secondary axis: the rating gap.
// Callers tie-break equal distances by queue age (oldest first).
export function matchDistance(me, candidate) {
  const ms = me?.settings ?? {};
  const cs = candidate?.settings ?? {};
  const speedMismatch = (ms.botTime ?? null) !== (cs.botTime ?? null) ? 1 : 0;
  const ratingGap = Math.abs((me?.rating ?? 1000) - (candidate?.rating ?? 1000));
  return { speedMismatch, ratingGap };
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

  // Among COMPATIBLE candidates, pick the CLOSEST to my preferences (same turn
  // speed first, then smallest rating gap), tie-breaking by queue age so an
  // equally-good older waiter is served first.
  const others = Object.values(entries)
    .filter(e => e.uid !== uid && isCompatible(myEntry, e))
    .sort((a, b) => {
      const da = matchDistance(myEntry, a);
      const db = matchDistance(myEntry, b);
      if (da.speedMismatch !== db.speedMismatch) return da.speedMismatch - db.speedMismatch;
      if (da.ratingGap !== db.ratingGap) return da.ratingGap - db.ratingGap;
      return (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
    });
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
