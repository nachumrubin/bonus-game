// Rule audit. One test per online write site in the spine. If any of these
// flips red, either the rule is wrong (fix firebase.database.rules.json) or
// the code's write is wrong (fix the relevant service). The matrix mirrors
// the writes catalogued in plan §"What's already done this session" + §"Rule
// audit + missing-rule fixes".

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withTestEnv, makeUserApp, makeAnonApp, seedWithoutRules, adminRead,
  assertSucceeds, assertFails,
} from './setup.mjs';

const HOST_UID  = 'host-uid';
const GUEST_UID = 'guest-uid';
const OTHER_UID = 'other-uid';

function pendingDoc(hostUid = HOST_UID, mode = 'friend-live') {
  return {
    hostUid,
    mode,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    hostProfile: { displayName: 'host', avatar: null, rating: 1000 },
    settings: { timelimit: true, botTime: 20 },
  };
}

function roomDoc({ roomId, hostUid = HOST_UID, guestUid = GUEST_UID, mode = 'friend-live', currentTurnSlot = 0, version = 1 } = {}) {
  return {
    roomId,
    schemaVersion: 2,
    mode,
    status: 'playing',
    version,
    currentTurnSlot,
    turnNumber: 1,
    moveHistory: [],
    scores: { 0: 0, 1: 0 },
    racks: { 0: [], 1: [] },
    bag: [],
    board: {},
    activeBoosts: [],
    lockedCells: [],
    lockInventory: { 0: [], 1: [] },
    settings: { timelimit: true, botTime: 20 },
    turnDeadlineMs: 0,
    missedTurns: { 0: 0, 1: 0 },
    players: {
      0: { uid: hostUid,  displayName: 'host',  avatar: null, joinedAt: Date.now() },
      1: { uid: guestUid, displayName: 'guest', avatar: null, joinedAt: Date.now() },
    },
    livePreview: null,
    createdAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// pendingRooms
// ─────────────────────────────────────────────────────────────────────────

test('pendingRooms: host can create their own pending', async () => {
  await withTestEnv(async (env) => {
    const host = makeUserApp(env, HOST_UID);
    await assertSucceeds(host.ref('pendingRooms/123456').set(pendingDoc()));
  });
});

test('pendingRooms: cannot create with someone else\'s hostUid', async () => {
  await withTestEnv(async (env) => {
    const guest = makeUserApp(env, GUEST_UID);
    await assertFails(guest.ref('pendingRooms/123456').set(pendingDoc(HOST_UID)));
  });
});

test('pendingRooms: cannot create with missing required fields', async () => {
  await withTestEnv(async (env) => {
    const host = makeUserApp(env, HOST_UID);
    // Missing createdAt + expiresAt — validate rule should reject.
    await assertFails(host.ref('pendingRooms/123456').set({ hostUid: HOST_UID, mode: 'friend-live' }));
  });
});

test('pendingRooms: guest (any authed user) can delete an existing pending', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('pendingRooms/123456').set(pendingDoc());
    });
    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(guest.ref('pendingRooms/123456').remove());
  });
});

test('pendingRooms: cannot delete a non-existent pending (rule requires data.exists)', async () => {
  await withTestEnv(async (env) => {
    const guest = makeUserApp(env, GUEST_UID);
    await assertFails(guest.ref('pendingRooms/999999').remove());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// rooms
// ─────────────────────────────────────────────────────────────────────────

test('rooms: a player can create a new room (schemaVersion=2 + they\'re in players)', async () => {
  await withTestEnv(async (env) => {
    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(guest.ref('rooms/room1').set(roomDoc({ roomId: 'room1' })));
  });
});

test('rooms: a non-player cannot create a room they\'re not in', async () => {
  await withTestEnv(async (env) => {
    const other = makeUserApp(env, OTHER_UID);
    await assertFails(other.ref('rooms/room1').set(roomDoc({ roomId: 'room1' })));
  });
});

test('rooms: current-turn player can commit a move (version+1 + matching turn slot)', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', currentTurnSlot: 0, version: 1 }));
    });
    const host = makeUserApp(env, HOST_UID);
    const next = { ...roomDoc({ roomId: 'room1', currentTurnSlot: 1, version: 2 }) };
    await assertSucceeds(host.ref('rooms/room1').set(next));
  });
});

test('rooms: non-current-turn player cannot commit a move', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', currentTurnSlot: 0, version: 1 }));
    });
    // Guest tries to write while it's the host's turn — rule's turn check rejects.
    const guest = makeUserApp(env, GUEST_UID);
    const bad = { ...roomDoc({ roomId: 'room1', currentTurnSlot: 0, version: 2 }) };
    await assertFails(guest.ref('rooms/room1').set(bad));
  });
});

test('rooms: a commit that skips version+1 is rejected (stale)', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', version: 5 }));
    });
    const host = makeUserApp(env, HOST_UID);
    // Tries to jump 5 → 7 (should be 6).
    const skipped = { ...roomDoc({ roomId: 'room1', currentTurnSlot: 1, version: 7 }) };
    await assertFails(host.ref('rooms/room1').set(skipped));
  });
});

test('rooms/{id}/status: either player can flip status without the turn check', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', currentTurnSlot: 0 }));
    });
    // Guest is NOT the current turn player but the /status child rule lets either player write it.
    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(guest.ref('rooms/room1/status').set('playing'));
  });
});

test('rooms/{id}/abandonedBy: either player can write the resigning slot marker', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', currentTurnSlot: 0 }));
    });
    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(guest.ref('rooms/room1/abandonedBy').set(1));
  });
});

test('rooms/{id}: participant can update status plus abandonedBy for resign', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', currentTurnSlot: 0 }));
    });
    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(guest.ref('rooms/room1').update({ status: 'abandoned', abandonedBy: 1 }));
  });
});

test('rooms/{id}/abandonedBy: non-player cannot write the resigning slot marker', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', currentTurnSlot: 0 }));
    });
    const other = makeUserApp(env, OTHER_UID);
    await assertFails(other.ref('rooms/room1/abandonedBy').set(1));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// users/{uid}/activeRoom
// ─────────────────────────────────────────────────────────────────────────

test('users/$uid/activeRoom: self-write succeeds', async () => {
  await withTestEnv(async (env) => {
    const host = makeUserApp(env, HOST_UID);
    await assertSucceeds(host.ref(`users/${HOST_UID}/activeRoom`).set('room1'));
  });
});

test('users/$uid/activeRoom: co-player cross-write succeeds when both are in the new room', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1' }));
    });
    // Guest writes host's activeRoom. Rule should allow it because both are players in room1.
    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(guest.ref(`users/${HOST_UID}/activeRoom`).set('room1'));
  });
});

test('users/$uid/activeRoom: non-coplayer cross-write fails', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1' }));
    });
    // Other (not a player in room1) tries to set host's activeRoom — rejected.
    const other = makeUserApp(env, OTHER_UID);
    await assertFails(other.ref(`users/${HOST_UID}/activeRoom`).set('room1'));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// users/{uid}/asyncRooms — the previously-missing rule
// ─────────────────────────────────────────────────────────────────────────

test('users/$uid/asyncRooms: co-player can write the index for both players', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', mode: 'friend-async' }));
    });
    const guest = makeUserApp(env, GUEST_UID);
    const meta = { mode: 'friend-async', createdAt: Date.now() };
    await assertSucceeds(guest.ref(`users/${HOST_UID}/asyncRooms/room1`).set(meta));
    await assertSucceeds(guest.ref(`users/${GUEST_UID}/asyncRooms/room1`).set(meta));
  });
});

test('users/$uid/asyncRooms: non-coplayer cannot write the index', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', mode: 'friend-async' }));
    });
    const other = makeUserApp(env, OTHER_UID);
    await assertFails(other.ref(`users/${HOST_UID}/asyncRooms/room1`).set({ mode: 'friend-async', createdAt: Date.now() }));
  });
});

test('users/$uid/asyncRooms: either player can clear the index when game ends', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref('rooms/room1').set(roomDoc({ roomId: 'room1', mode: 'friend-async' }));
      await db.ref(`users/${HOST_UID}/asyncRooms/room1`).set({ mode: 'friend-async', createdAt: Date.now() });
      await db.ref(`users/${GUEST_UID}/asyncRooms/room1`).set({ mode: 'friend-async', createdAt: Date.now() });
    });
    const guest = makeUserApp(env, GUEST_UID);
    await assertSucceeds(guest.ref(`users/${HOST_UID}/asyncRooms/room1`).remove());
    await assertSucceeds(guest.ref(`users/${GUEST_UID}/asyncRooms/room1`).remove());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// invites / inviteAcks
// ─────────────────────────────────────────────────────────────────────────

test('invites: sender can write an invite addressed to the recipient', async () => {
  await withTestEnv(async (env) => {
    const sender = makeUserApp(env, HOST_UID);
    await assertSucceeds(sender.ref(`invites/${GUEST_UID}/inv1`).set({
      fromUid: HOST_UID,
      fromName: 'host',
      mode: 'friend-live',
      createdAt: Date.now(),
    }));
  });
});

test('invites: cannot send with fromUid that isn\'t you', async () => {
  await withTestEnv(async (env) => {
    const sender = makeUserApp(env, OTHER_UID);
    await assertFails(sender.ref(`invites/${GUEST_UID}/inv1`).set({
      fromUid: HOST_UID,
      mode: 'friend-live',
      createdAt: Date.now(),
    }));
  });
});

test('invites: recipient can delete their own invite', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref(`invites/${GUEST_UID}/inv1`).set({
        fromUid: HOST_UID, mode: 'friend-live', createdAt: Date.now(),
      });
    });
    const recipient = makeUserApp(env, GUEST_UID);
    await assertSucceeds(recipient.ref(`invites/${GUEST_UID}/inv1`).remove());
  });
});

test('inviteAcks: invitee can write an ack to the inviter\'s slot', async () => {
  await withTestEnv(async (env) => {
    const invitee = makeUserApp(env, GUEST_UID);
    await assertSucceeds(invitee.ref(`inviteAcks/${HOST_UID}/${GUEST_UID}`).set({
      accepted: true, roomId: 'room1', ts: Date.now(),
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// matchmakingQueue
// ─────────────────────────────────────────────────────────────────────────

test('matchmakingQueue: self-enqueue succeeds', async () => {
  await withTestEnv(async (env) => {
    const u = makeUserApp(env, HOST_UID);
    await assertSucceeds(u.ref(`matchmakingQueue/friend-live/${HOST_UID}`).set({ since: Date.now() }));
  });
});

test('matchmakingQueue: cannot enqueue someone else', async () => {
  await withTestEnv(async (env) => {
    const u = makeUserApp(env, HOST_UID);
    await assertFails(u.ref(`matchmakingQueue/friend-live/${GUEST_UID}`).set({ since: Date.now() }));
  });
});

test('matchmakingQueue: any authed user can dequeue (remove) any entry — pair-up cleanup', async () => {
  await withTestEnv(async (env) => {
    await seedWithoutRules(env, async (db) => {
      await db.ref(`matchmakingQueue/friend-live/${GUEST_UID}`).set({ since: Date.now() });
    });
    const otherPlayer = makeUserApp(env, HOST_UID);
    // Pair-winner removes the other player's queue entry.
    await assertSucceeds(otherPlayer.ref(`matchmakingQueue/friend-live/${GUEST_UID}`).remove());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// presence
// ─────────────────────────────────────────────────────────────────────────

test('presence/$uid: self-write succeeds', async () => {
  await withTestEnv(async (env) => {
    const u = makeUserApp(env, HOST_UID);
    await assertSucceeds(u.ref(`presence/${HOST_UID}`).set({ connected: true, lastSeen: Date.now() }));
  });
});

test('presence/$uid: cannot write another user\'s presence', async () => {
  await withTestEnv(async (env) => {
    const u = makeUserApp(env, HOST_UID);
    await assertFails(u.ref(`presence/${GUEST_UID}`).set({ connected: true, lastSeen: Date.now() }));
  });
});
