import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from '../online/mockFirebase.js';
import * as bus from '../../events/bus.js';
import {
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest, cancelFriendRequest,
  watchIncomingRequests, listFriends, watchFriends, removeFriend,
  filterFriendsByName, syncSelfToFriends, FRIENDS_EVT,
} from './friendsService.js';

const ALICE = { uid: 'alice', displayName: 'Alice', equippedAvatar: 'crown' };
const BOB   = { uid: 'bob',   displayName: 'Bob',   equippedAvatar: 'dragon' };

test('sendFriendRequest: writes to friendRequests/{toUid}/{fromUid}', async () => {
  const db = makeMockDb();
  const r = await sendFriendRequest(db, {
    fromUid: ALICE.uid, toUid: BOB.uid, fromName: ALICE.displayName, fromAvatar: ALICE.equippedAvatar,
    serverTimestamp: 100,
  });
  assert.equal(r.ok, true);
  const entry = (await db.ref(`friendRequests/${BOB.uid}/${ALICE.uid}`).get()).val();
  assert.equal(entry.fromName, 'Alice');
  assert.equal(entry.sentAt,    100);
});

test('sendFriendRequest: rejects self', async () => {
  const db = makeMockDb();
  const r = await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: ALICE.uid });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'self');
});

test('sendFriendRequest: rejects when already friends', async () => {
  const db = makeMockDb();
  await db.ref(`friends/${ALICE.uid}/${BOB.uid}`).set({ name: 'Bob' });
  const r = await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  assert.equal(r.reason, 'already-friends');
});

test('acceptFriendRequest: writes both directions and clears the request', async () => {
  const db = makeMockDb();
  await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid, fromName: 'Alice' });
  bus._reset();
  const events = [];
  bus.on(FRIENDS_EVT.REQUEST_ACCEPTED, (p) => events.push(p));
  const r = await acceptFriendRequest(db, {
    fromUid: ALICE.uid, toUid: BOB.uid,
    fromProfile: ALICE, toProfile: BOB, serverTimestamp: 200,
  });
  assert.equal(r.ok, true);
  assert.equal((await db.ref(`friends/${BOB.uid}/${ALICE.uid}`).get()).val().name, 'Alice');
  assert.equal((await db.ref(`friends/${ALICE.uid}/${BOB.uid}`).get()).val().name, 'Bob');
  assert.equal((await db.ref(`friendRequests/${BOB.uid}/${ALICE.uid}`).get()).val(), null);
  assert.equal(events.length, 1);
});

test('acceptFriendRequest: rejects when no pending request exists', async () => {
  const db = makeMockDb();
  const r = await acceptFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-request');
});

test('rejectFriendRequest: removes the entry and emits event', async () => {
  const db = makeMockDb();
  await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  bus._reset();
  let n = 0;
  bus.on(FRIENDS_EVT.REQUEST_REJECTED, () => { n++; });
  await rejectFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  assert.equal((await db.ref(`friendRequests/${BOB.uid}/${ALICE.uid}`).get()).val(), null);
  assert.equal(n, 1);
});

test('cancelFriendRequest: removes the entry', async () => {
  const db = makeMockDb();
  await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  await cancelFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  assert.equal((await db.ref(`friendRequests/${BOB.uid}/${ALICE.uid}`).get()).val(), null);
});

test('watchIncomingRequests fires on send + remove', async () => {
  const db = makeMockDb();
  const fires = [];
  const off = watchIncomingRequests(db, BOB.uid, (xs) => fires.push(xs.map(r => r.fromUid)));
  // Initial fire is empty
  assert.equal(fires[0]?.length, 0);
  await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  await new Promise(r => setTimeout(r, 5));
  assert.ok(fires.find(f => f.includes(ALICE.uid)));
  off();
});

test('listFriends + watchFriends', async () => {
  const db = makeMockDb();
  await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  await acceptFriendRequest(db, {
    fromUid: ALICE.uid, toUid: BOB.uid, fromProfile: ALICE, toProfile: BOB,
  });
  const list = await listFriends(db, ALICE.uid);
  assert.equal(list.length, 1);
  assert.equal(list[0].uid, BOB.uid);
  // watchFriends fires on changes
  const fires = [];
  const off = watchFriends(db, ALICE.uid, (xs) => fires.push(xs.length));
  await new Promise(r => setTimeout(r, 5));
  assert.ok(fires.length >= 1);
  off();
});

test('removeFriend: clears both directions', async () => {
  const db = makeMockDb();
  await sendFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid });
  await acceptFriendRequest(db, {
    fromUid: ALICE.uid, toUid: BOB.uid, fromProfile: ALICE, toProfile: BOB,
  });
  await removeFriend(db, { uid: ALICE.uid, friendUid: BOB.uid });
  assert.equal((await db.ref(`friends/${ALICE.uid}/${BOB.uid}`).get()).val(), null);
  assert.equal((await db.ref(`friends/${BOB.uid}/${ALICE.uid}`).get()).val(), null);
});

test('syncSelfToFriends: refreshes my avatar/name in each friend edge', async () => {
  const db = makeMockDb();
  // Become friends with the snapshot avatar 'crown', then equip a v2 avatar.
  await acceptFriendRequest(db, { fromUid: ALICE.uid, toUid: BOB.uid, fromProfile: ALICE, toProfile: BOB });
  await db.ref(`friends/${ALICE.uid}/${BOB.uid}`).set({ uid: BOB.uid, name: 'Bob', avatar: 'crown' });

  const r = await syncSelfToFriends(db, {
    uid: BOB.uid, friendUids: [ALICE.uid], avatar: 'epic_2', name: 'Bob',
  });
  assert.equal(r.ok, true);
  // BOB's edge inside ALICE's friend list now shows the v2 avatar.
  const edge = (await db.ref(`friends/${ALICE.uid}/${BOB.uid}`).get()).val();
  assert.equal(edge.avatar, 'epic_2');
  assert.equal(edge.name, 'Bob');
});

test('syncSelfToFriends: no-op without uid or friends', async () => {
  const db = makeMockDb();
  assert.equal((await syncSelfToFriends(db, { uid: 'x', friendUids: [] })).ok, false);
  assert.equal((await syncSelfToFriends(db, { uid: '', friendUids: ['a'], avatar: 'z' })).ok, false);
  // skips self-edge so no stray write
  const r = await syncSelfToFriends(db, { uid: 'a', friendUids: ['a'], avatar: 'z' });
  assert.equal(r.ok, false);
});

test('filterFriendsByName: case-insensitive substring', () => {
  const friends = [
    { uid: 'a', name: 'נחום' },
    { uid: 'b', name: 'דני'  },
    { uid: 'c', name: 'NACHUM' },
  ];
  assert.deepEqual(filterFriendsByName(friends, 'nachum').map(f => f.uid), ['c']);
  assert.deepEqual(filterFriendsByName(friends, 'נח').map(f => f.uid),     ['a']);
  assert.equal(filterFriendsByName(friends, '').length, 3);
});
