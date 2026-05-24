import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import { sendInvite, readInvite, acceptInvite, rejectInvite, cancelInvite, listenForInvites, listenForInviteAcks, sweepExpired } from './inviteService.js';
import { INVITE_STATUS } from './schema.js';

test('sendInvite writes to invites/{toUid}/{inviteId} with PENDING status', async () => {
  const db = makeMockDb();
  const { inviteId } = await sendInvite(db, {
    fromUid: 'a', fromName: 'Alice', fromAvatar: null,
    toUid: 'b', mode: 'friend-async', settings: {},
    serverTimestamp: 1000,
  });
  const inv = await readInvite(db, { toUid: 'b', inviteId });
  assert.ok(inv);
  assert.equal(inv.fromUid, 'a');
  assert.equal(inv.toUid, 'b');
  assert.equal(inv.status, INVITE_STATUS.PENDING);
  assert.ok(inv.expiresAt > inv.createdAt);
});

test('rejectInvite removes the invite and writes a rejection ack', async () => {
  const db = makeMockDb();
  const { inviteId } = await sendInvite(db, {
    fromUid: 'a', fromName: 'Alice', fromAvatar: null,
    toUid: 'b', mode: 'friend-async', settings: {},
    serverTimestamp: 1000,
  });
  await rejectInvite(db, { fromUid: 'a', toUid: 'b', inviteId, fromName: 'Bob', serverTimestamp: 2000 });
  const after = await readInvite(db, { toUid: 'b', inviteId });
  assert.equal(after, null);
  // ack written
  assert.equal(db._data.inviteAcks.a.b.accepted, false);
});

test('acceptInvite consumes invite, creates a room, and writes accepted ack with roomId', async () => {
  const db = makeMockDb();
  const { inviteId } = await sendInvite(db, {
    fromUid: 'a', fromName: 'Alice', fromAvatar: '⭐',
    toUid: 'b', mode: 'friend-async', settings: { timelimit: false },
    serverTimestamp: 1000,
  });

  const result = await acceptInvite(db, {
    toUid: 'b',
    inviteId,
    accepterProfile: { displayName: 'Bob', avatar: '👑' },
    now: 2000,
    roomIdFn: () => 'friend-room-1',
    startingSlot: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.roomId, 'friend-room-1');
  assert.equal(await readInvite(db, { toUid: 'b', inviteId }), null);
  assert.equal(db._data.rooms['friend-room-1'].status, 'playing');
  assert.equal(db._data.rooms['friend-room-1'].players[0].uid, 'a');
  assert.equal(db._data.rooms['friend-room-1'].players[1].uid, 'b');
  assert.equal(db._data.rooms['friend-room-1'].currentTurnSlot, 1);
  assert.equal(db._data.users.a.activeRoom, 'friend-room-1');
  assert.equal(db._data.users.b.activeRoom, 'friend-room-1');
  assert.equal(db._data.inviteAcks.a.b.accepted, true);
  assert.equal(db._data.inviteAcks.a.b.roomId, 'friend-room-1');
});

test('acceptInvite rejects duplicate accept after invite was consumed', async () => {
  const db = makeMockDb();
  const { inviteId } = await sendInvite(db, {
    fromUid: 'a', fromName: 'Alice', fromAvatar: null,
    toUid: 'b', mode: 'friend-live', settings: {},
    serverTimestamp: 1000,
  });
  await acceptInvite(db, {
    toUid: 'b',
    inviteId,
    accepterProfile: { displayName: 'Bob' },
    now: 2000,
    roomIdFn: () => 'friend-room-1',
  });

  const second = await acceptInvite(db, {
    toUid: 'b',
    inviteId,
    accepterProfile: { displayName: 'Bob' },
    now: 2001,
    roomIdFn: () => 'friend-room-2',
  });

  assert.equal(second.ok, false);
  assert.equal(second.reason, 'invite-not-found');
  assert.equal(db._data.rooms['friend-room-2'], undefined);
});

test('cancelInvite removes the invite (sender-initiated)', async () => {
  const db = makeMockDb();
  const { inviteId } = await sendInvite(db, {
    fromUid: 'a', fromName: 'Alice', fromAvatar: null,
    toUid: 'b', mode: 'friend-async', settings: {},
    serverTimestamp: 1000,
  });
  await cancelInvite(db, { toUid: 'b', inviteId });
  assert.equal(await readInvite(db, { toUid: 'b', inviteId }), null);
});

test('listenForInvites fires when an invite arrives', async () => {
  const db = makeMockDb();
  const seen = [];
  const off = listenForInvites(db, 'b', list => seen.push(list.length));
  // Initial fire is empty
  assert.deepEqual(seen, [0]);
  await sendInvite(db, {
    fromUid: 'a', fromName: 'A', fromAvatar: null, toUid: 'b',
    mode: 'friend-async', settings: {}, serverTimestamp: 1000,
  });
  assert.equal(seen[seen.length - 1], 1);
  off();
});

test('listenForInviteAcks fires on rejection', async () => {
  const db = makeMockDb();
  const acks = [];
  const off = listenForInviteAcks(db, 'a', list => acks.push(list));
  const { inviteId } = await sendInvite(db, {
    fromUid: 'a', fromName: 'A', fromAvatar: null, toUid: 'b',
    mode: 'friend-async', settings: {}, serverTimestamp: 1000,
  });
  await rejectInvite(db, { fromUid: 'a', toUid: 'b', inviteId, fromName: 'B', serverTimestamp: 2000 });
  const last = acks[acks.length - 1];
  assert.equal(last.length, 1);
  assert.equal(last[0].toUid, 'b');
  assert.equal(last[0].accepted, false);
  off();
});

test('sweepExpired removes only invites whose expiresAt is in the past', async () => {
  const db = makeMockDb();
  // One expired (live, ttl=5min, sent at t=0, sweep at t=10min)
  await sendInvite(db, {
    fromUid: 'a', fromName: 'A', fromAvatar: null, toUid: 'b',
    mode: 'friend-live', settings: {}, serverTimestamp: 0,
  });
  // One still valid
  await sendInvite(db, {
    fromUid: 'c', fromName: 'C', fromAvatar: null, toUid: 'b',
    mode: 'friend-async', settings: {}, serverTimestamp: 0,
  });
  const removed = await sweepExpired(db, 'b', 10 * 60 * 1000);
  assert.equal(removed, 1);
});
