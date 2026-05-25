// Friend-invite lifecycle parity vs. legacy invite flow.
//
// Legacy authority (HEAD:index.html):
//   - _listenForInvites(uid) at line 8544 — receiver-side invite listener.
//   - listenForInviteResponse / _acceptIncomingInvite / _dismissIncomingInvite
//     around line 8587 — receiver clicks accept or reject, sender's listener
//     fires inviteResponses (handleInviteRejected at line 8632 tears down any
//     room the sender had created and shows ov-invite-rejected).
//
// Legacy structural quirk: in some paths the sender created a room BEFORE the
// receiver had accepted (e.g. friend-async via roomCode). handleInviteRejected
// had to remove that room on reject. This was the "orphan-room class of bug"
// the spine inviteService explicitly designed out — see the header comment
// at src/game/online/inviteService.js.
//
// What we assert end-to-end (existing inviteService.test.js covers individual
// writes; existing incomingInviteScreen.test.js covers the overlay's reaction
// to bus events — but no test wires sender + receiver listeners against the
// SAME db to prove the full hand-off works):
//
//   • Reject: receiver-side rejectInvite triggers sender-side ack listener
//     with accepted:false; the invite is gone; NO room exists.
//   • Accept: receiver-side acceptInvite triggers sender-side ack listener
//     with accepted:true + roomId; the room exists, status=playing, both
//     players' activeRoom points at it; initial engine state is fresh.
//   • Concurrent accept: two near-simultaneous accept calls cannot both
//     succeed (the room-and-ack write must be transactional in spirit).

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/game/online/mockFirebase.js'),
    import('../../src/game/online/inviteService.js'),
    import('../../src/game/online/schema.js'),
    import('../../src/notifications/notificationService.js'),
  ]).then(([mock, invite, schema, notif]) => ({ mock, invite, schema, notif }));
  return modulesPromise;
}

async function setup() {
  const m = await loadModules();
  const db = m.mock.makeMockDb();
  return { db, ...m };
}

// ───────────────────────────────────────────────────────────────────────
// 1. Reject flow: sender + receiver listeners wired to the same db.
test('parity: receiver rejects; sender ack fires accepted:false; no orphan room', async () => {
  const { db, invite, schema } = await setup();

  // Receiver-side: wire the invite listener (real flow: incomingInviteScreen).
  const receivedInvites = [];
  const offRecv = invite.listenForInvites(db, 'bob', (list) => receivedInvites.push(list));

  // Sender-side: wire the ack listener (real flow: bootInviteListeners).
  const ackHistory = [];
  const offSend = invite.listenForInviteAcks(db, 'alice', (list) => ackHistory.push(list));

  // Sender ships an invite.
  const { inviteId } = await invite.sendInvite(db, {
    fromUid: 'alice', fromName: 'Alice', fromAvatar: '⭐',
    toUid: 'bob', mode: 'friend-async', settings: {},
    serverTimestamp: 1000,
  });

  // Receiver listener saw exactly one pending invite.
  const lastRecv = receivedInvites[receivedInvites.length - 1];
  assert.equal(lastRecv.length, 1);
  assert.equal(lastRecv[0].inviteId, inviteId);
  assert.equal(lastRecv[0].fromUid, 'alice');
  assert.equal(lastRecv[0].status, schema.INVITE_STATUS.PENDING);

  // Receiver clicks reject — bus would dispatch II_INTENT.REJECT; main.js calls:
  await invite.rejectInvite(db, {
    fromUid: 'alice', toUid: 'bob', inviteId,
    fromName: 'Bob', serverTimestamp: 2000,
  });

  // Sender's ack listener fired with accepted:false.
  const lastAck = ackHistory[ackHistory.length - 1];
  assert.equal(lastAck.length, 1);
  assert.equal(lastAck[0].toUid, 'bob');
  assert.equal(lastAck[0].accepted, false);
  assert.equal(lastAck[0].fromName, 'Bob');

  // Invite is gone from the receiver's mailbox.
  assert.equal(await invite.readInvite(db, { toUid: 'bob', inviteId }), null);

  // Spine invariant: rejection NEVER produces a room (legacy could leave one).
  assert.equal(db._data.rooms ?? undefined, undefined, 'no rooms created on rejection');
  assert.equal(db._data.users?.alice?.activeRoom ?? null, null);
  assert.equal(db._data.users?.bob?.activeRoom ?? null, null);

  offRecv(); offSend();
});

// ───────────────────────────────────────────────────────────────────────
// 2. Accept flow: room created, both activeRoom pointers set, fresh state.
test('parity: receiver accepts; room created with both players; fresh engine state', async () => {
  const { db, invite } = await setup();

  const ackHistory = [];
  const offSend = invite.listenForInviteAcks(db, 'alice', (list) => ackHistory.push(list));

  const { inviteId } = await invite.sendInvite(db, {
    fromUid: 'alice', fromName: 'Alice', fromAvatar: '⭐',
    toUid: 'bob', mode: 'friend-async',
    settings: { timelimit: false },
    serverTimestamp: 1000,
  });

  const result = await invite.acceptInvite(db, {
    toUid: 'bob',
    inviteId,
    accepterProfile: { displayName: 'Bob', avatar: '👑' },
    now: 2000,
    roomIdFn: () => 'room-accept-parity',
    startingSlot: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.roomId, 'room-accept-parity');

  // Sender's ack listener fires accepted:true with the roomId.
  const lastAck = ackHistory[ackHistory.length - 1];
  assert.equal(lastAck.length, 1);
  assert.equal(lastAck[0].accepted, true);
  assert.equal(lastAck[0].roomId, 'room-accept-parity');

  // Invite is consumed.
  assert.equal(await invite.readInvite(db, { toUid: 'bob', inviteId }), null);

  // Room created with both players and status=playing.
  const room = db._data.rooms['room-accept-parity'];
  assert.ok(room, 'room exists');
  assert.equal(room.status, 'playing');
  assert.equal(room.mode, 'friend-async');
  assert.equal(room.players[0].uid, 'alice');
  assert.equal(room.players[0].displayName, 'Alice');
  assert.equal(room.players[1].uid, 'bob');
  assert.equal(room.players[1].displayName, 'Bob');

  // Both users' activeRoom pointers set (legacy goal: a player who reloads
  // ends up back in the room).
  assert.equal(db._data.users.alice.activeRoom, 'room-accept-parity');
  assert.equal(db._data.users.bob.activeRoom, 'room-accept-parity');

  // Fresh engine state baked into the room (buildRoomDoc flattens engine
  // fields directly onto the room; firstMove is derived from moveHistory).
  assert.equal(room.scores[0], 0);
  assert.equal(room.scores[1], 0);
  assert.equal(room.currentTurnSlot, 0);
  assert.equal(room.turnNumber, 1);
  assert.equal((room.moveHistory ?? []).length, 0, 'firstMove is implied by empty moveHistory');
  assert.equal(room.racks[0].length, 8);
  assert.equal(room.racks[1].length, 8);
  // Empty board: serializeBoard produces a 10x10 grid of nulls.
  const occupied = (room.board ?? []).flat().filter(t => t != null).length;
  assert.equal(occupied, 0, 'no tiles on the board yet');
  // ready flags both false until both players mark ready.
  assert.equal(room.ready[0], false);
  assert.equal(room.ready[1], false);

  offSend();
});

// ───────────────────────────────────────────────────────────────────────
// 3. Double-accept race: only one acceptInvite call can succeed.
// Protects against the legacy bug where the sender could see two rooms
// created by racing accept paths.
test('parity: concurrent accepts — only the first succeeds; no duplicate room', async () => {
  const { db, invite } = await setup();

  const { inviteId } = await invite.sendInvite(db, {
    fromUid: 'alice', fromName: 'Alice', fromAvatar: null,
    toUid: 'bob', mode: 'friend-async', settings: {},
    serverTimestamp: 1000,
  });

  // Two accept attempts; sequentially (the mock db is synchronous so the
  // first finishes before the second runs — but the transactional consume
  // is what guarantees the second fails even when truly concurrent).
  const first = await invite.acceptInvite(db, {
    toUid: 'bob', inviteId,
    accepterProfile: { displayName: 'Bob' },
    now: 2000, roomIdFn: () => 'first-room',
  });
  const second = await invite.acceptInvite(db, {
    toUid: 'bob', inviteId,
    accepterProfile: { displayName: 'Bob' },
    now: 2001, roomIdFn: () => 'second-room',
  });

  assert.equal(first.ok, true);
  assert.equal(first.roomId, 'first-room');
  assert.equal(second.ok, false);
  assert.match(second.reason, /not-found|already-consumed/);

  // Only the first room exists.
  assert.ok(db._data.rooms['first-room']);
  assert.equal(db._data.rooms['second-room'], undefined);
  // activeRoom pointer still points at the first room.
  assert.equal(db._data.users.alice.activeRoom, 'first-room');
  assert.equal(db._data.users.bob.activeRoom, 'first-room');
});

// ───────────────────────────────────────────────────────────────────────
// 4. Expired-invite rejection at accept time.
// Legacy let invites linger in the receiver's mailbox indefinitely until a
// sweep; spine inviteService refuses to accept an expired invite and removes
// it. Player-visible: clicking accept on an old invite shows nothing weird
// happens (no room created) rather than starting a stale game.
test('parity: accepting an expired invite produces no room and the invite is cleaned up', async () => {
  const { db, invite } = await setup();

  // Live invite TTL is 5 minutes; createdAt=0, expiresAt=5min, accept at 10min.
  const { inviteId } = await invite.sendInvite(db, {
    fromUid: 'alice', fromName: 'Alice', fromAvatar: null,
    toUid: 'bob', mode: 'friend-live', settings: {},
    serverTimestamp: 0,
  });

  const result = await invite.acceptInvite(db, {
    toUid: 'bob', inviteId,
    accepterProfile: { displayName: 'Bob' },
    now: 10 * 60 * 1000,
    roomIdFn: () => 'expired-room',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invite-expired');
  assert.equal(await invite.readInvite(db, { toUid: 'bob', inviteId }), null);
  assert.equal(db._data.rooms?.['expired-room'], undefined);
});

// ───────────────────────────────────────────────────────────────────────
// 5. Sender cancels before receiver responds: invite vanishes, no ack written.
// Legacy could leave a stale invite in the receiver's mailbox; spine
// cancelInvite removes it cleanly.
test('parity: sender cancels; receiver listener sees the invite vanish; no ack', async () => {
  const { db, invite } = await setup();

  const recvHistory = [];
  const offRecv = invite.listenForInvites(db, 'bob', (list) => recvHistory.push(list.length));
  const ackHistory = [];
  const offSend = invite.listenForInviteAcks(db, 'alice', (list) => ackHistory.push(list.length));

  const { inviteId } = await invite.sendInvite(db, {
    fromUid: 'alice', fromName: 'Alice', fromAvatar: null,
    toUid: 'bob', mode: 'friend-async', settings: {},
    serverTimestamp: 1000,
  });
  assert.equal(recvHistory[recvHistory.length - 1], 1, 'receiver saw 1 invite');

  await invite.cancelInvite(db, { toUid: 'bob', inviteId });

  assert.equal(recvHistory[recvHistory.length - 1], 0, 'receiver sees invite removed');
  // Sender's ack listener should NOT have fired (cancellation is silent).
  // Initial listener fire with empty list is allowed (length 0).
  assert.ok(ackHistory.every(n => n === 0), 'no ack written for sender-initiated cancel');

  offRecv(); offSend();
});

// ───────────────────────────────────────────────────────────────────────
// 6. Recipient availability check — live invite to a player mid live game.
// The inviter should be blocked before the invite is even written.
test('checkRecipientAvailability: recipient in active live game blocks live invite', async () => {
  const { db, invite } = await setup();

  // Put bob in an active live room.
  await db.ref('users/bob/activeRoom').set('live-room-1');
  await db.ref('rooms/live-room-1').set({ mode: 'friend-live', status: 'playing' });

  const result = await invite.checkRecipientAvailability(db, 'bob', 'friend-live');
  assert.equal(result.available, false);
  assert.equal(result.reason, 'in-live-game');
});

test('checkRecipientAvailability: recipient in async game does NOT block live invite', async () => {
  const { db, invite } = await setup();

  // Bob is in an async room — live invite should still go through.
  await db.ref('users/bob/activeRoom').set('async-room-1');
  await db.ref('rooms/async-room-1').set({ mode: 'friend-async', status: 'playing' });

  const result = await invite.checkRecipientAvailability(db, 'bob', 'friend-live');
  assert.equal(result.available, true);
});

test('checkRecipientAvailability: recipient with no active room is always available', async () => {
  const { db, invite } = await setup();
  const result = await invite.checkRecipientAvailability(db, 'bob', 'friend-live');
  assert.equal(result.available, true);
});

test('checkRecipientAvailability: async invite is always available regardless of game state', async () => {
  const { db, invite } = await setup();

  // Even if bob is mid live game, async invites go through.
  await db.ref('users/bob/activeRoom').set('live-room-2');
  await db.ref('rooms/live-room-2').set({ mode: 'random-live', status: 'playing' });

  const result = await invite.checkRecipientAvailability(db, 'bob', 'friend-async');
  assert.equal(result.available, true);
});

// ───────────────────────────────────────────────────────────────────────
// 7. Push notification sent when invite is dispatched.
// notificationService.pushInvite is what delivers the invite to a closed app.
test('pushInvite delivers to the correct recipient uid with inviter name', async () => {
  const { notif } = await setup();
  notif._resetForTests();
  const sent = [];
  notif.configure({
    appId: 'test-app',
    restKey: 'test-key',
    sendPush: async (body) => sent.push(body),
  });

  await notif.pushInvite({ inviteeUid: 'bob', inviterName: 'Alice', roomId: null });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].include_aliases.external_id, ['bob']);
  assert.equal(sent[0].data.type, 'invite');
  assert.ok(sent[0].contents.en.includes('Alice'),
    'notification body must name the inviter');
});
