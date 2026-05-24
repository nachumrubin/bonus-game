import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from './mockFirebase.js';
import * as roomCodeService from './roomCodeService.js';

const HOST = { uid: 'host_1', displayName: 'נחום',  avatar: '🎮' };
const GUEST = { uid: 'guest_1', displayName: 'דני', avatar: '🐶' };

test('createPending writes a 6-digit code and round-trips via readPending', async () => {
  const db = makeMockDb();
  const { code, expiresAt } = await roomCodeService.createPending(db, {
    hostUid: HOST.uid, hostProfile: HOST, mode: 'friend-live',
    settings: { timelimit: true, botTime: 20 },
    serverTimestamp: 1_000,
  });
  assert.match(code, /^\d{6}$/);
  assert.equal(expiresAt, 1_000 + 30 * 60 * 1000);

  const read = await roomCodeService.readPending(db, code);
  assert.equal(read.code, code);
  assert.equal(read.hostUid, HOST.uid);
  assert.equal(read.mode, 'friend-live');
  assert.equal(read.settings.timelimit, true);
});

test('createPending throws if hostUid or mode missing', async () => {
  const db = makeMockDb();
  await assert.rejects(
    roomCodeService.createPending(db, { mode: 'friend-live' }),
    /hostUid required/,
  );
  await assert.rejects(
    roomCodeService.createPending(db, { hostUid: 'x' }),
    /mode required/,
  );
});

test('cancelPending removes the entry; subsequent read is null', async () => {
  const db = makeMockDb();
  const { code } = await roomCodeService.createPending(db, {
    hostUid: HOST.uid, hostProfile: HOST, mode: 'friend-live',
  });
  await roomCodeService.cancelPending(db, code);
  assert.equal(await roomCodeService.readPending(db, code), null);
});

test('cancelPending is idempotent', async () => {
  const db = makeMockDb();
  await roomCodeService.cancelPending(db, '999999'); // does not throw
});

test('claimByCode happy path: deletes pending, creates real room, sets activeRoom for both', async () => {
  const db = makeMockDb();
  const { code } = await roomCodeService.createPending(db, {
    hostUid: HOST.uid, hostProfile: HOST, mode: 'friend-live',
    settings: { timelimit: true, botTime: 20 },
    serverTimestamp: 1_000,
  });
  const result = await roomCodeService.claimByCode(db, {
    code, guestUid: GUEST.uid, guestProfile: GUEST, now: 2_000,
    roomIdFn: () => 'room_test_1',
    startingSlot: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.roomId, 'room_test_1');

  // Pending consumed
  assert.equal(await roomCodeService.readPending(db, code), null);

  // Real room exists with both players, waiting for both coin-enter clicks
  const room = (await db.ref('rooms/room_test_1').get()).val();
  assert.equal(room.mode, 'friend-live');
  assert.equal(room.status, 'waiting');
  assert.equal(room.players[0].uid, HOST.uid);
  assert.equal(room.players[1].uid, GUEST.uid);
  assert.equal(room.currentTurnSlot, 1);
  assert.equal(room.players[0].displayName, 'נחום');
  assert.equal(room.players[1].displayName, 'דני');

  // Both players' activeRoom set
  assert.equal((await db.ref(`users/${HOST.uid}/activeRoom`).get()).val(),  'room_test_1');
  assert.equal((await db.ref(`users/${GUEST.uid}/activeRoom`).get()).val(), 'room_test_1');
});

test('claimByCode rejects: code not found', async () => {
  const db = makeMockDb();
  const r = await roomCodeService.claimByCode(db, {
    code: 'X', guestUid: GUEST.uid, guestProfile: GUEST,
  });
  assert.deepEqual(r, { ok: false, reason: 'not-found' });
});

test('claimByCode rejects: missing inputs', async () => {
  const db = makeMockDb();
  assert.equal((await roomCodeService.claimByCode(db, { guestUid: 'g' })).reason, 'missing-code');
  assert.equal((await roomCodeService.claimByCode(db, { code: 'X'    })).reason, 'missing-guest');
});

test('claimByCode rejects: expired pending entry is removed', async () => {
  const db = makeMockDb();
  const { code } = await roomCodeService.createPending(db, {
    hostUid: HOST.uid, hostProfile: HOST, mode: 'friend-live',
    serverTimestamp: 1_000, ttlMs: 100,
  });
  const r = await roomCodeService.claimByCode(db, {
    code, guestUid: GUEST.uid, guestProfile: GUEST, now: 1_000_000,
  });
  assert.deepEqual(r, { ok: false, reason: 'expired' });
  assert.equal(await roomCodeService.readPending(db, code), null);
});

test('claimByCode rejects: self-claim (host trying to join own code)', async () => {
  const db = makeMockDb();
  const { code } = await roomCodeService.createPending(db, {
    hostUid: HOST.uid, hostProfile: HOST, mode: 'friend-live',
  });
  const r = await roomCodeService.claimByCode(db, {
    code, guestUid: HOST.uid, guestProfile: HOST,
  });
  assert.equal(r.reason, 'self-claim');
  // Pending entry is preserved
  assert.notEqual(await roomCodeService.readPending(db, code), null);
});

test('claimByCode: only the first concurrent claimer wins', async () => {
  const db = makeMockDb();
  const { code } = await roomCodeService.createPending(db, {
    hostUid: HOST.uid, hostProfile: HOST, mode: 'friend-live',
  });
  // Sequential claims (mock db is single-threaded but the second should
  // see the consumed entry)
  const r1 = await roomCodeService.claimByCode(db, {
    code, guestUid: GUEST.uid, guestProfile: GUEST, roomIdFn: () => 'room_a',
  });
  const r2 = await roomCodeService.claimByCode(db, {
    code, guestUid: 'guest_2', guestProfile: { displayName: 'אחר' }, roomIdFn: () => 'room_b',
  });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'not-found');
});

test('watchPending fires on creation, on update, and with null on cancel', async () => {
  const db = makeMockDb();
  const events = [];
  const off = roomCodeService.watchPending(db, '123456', (v) => events.push(v));

  // Initial fire returns null (no entry)
  assert.equal(events.length, 1);
  assert.equal(events[0], null);

  // Manually create at that exact code
  await db.ref('pendingRooms/123456').set({
    code: '123456', hostUid: HOST.uid, mode: 'friend-live', expiresAt: 9e15,
  });
  // Cancel — watcher fires with null
  await roomCodeService.cancelPending(db, '123456');

  assert.ok(events.length >= 3);
  assert.equal(events.at(-1), null);
  off();
});

test('sweepExpired removes only entries past the TTL', async () => {
  const db = makeMockDb();
  const a = await roomCodeService.createPending(db, {
    hostUid: 'h1', mode: 'friend-live', serverTimestamp: 100, ttlMs: 50,
  });
  const b = await roomCodeService.createPending(db, {
    hostUid: 'h2', mode: 'friend-live', serverTimestamp: 1000, ttlMs: 1_000_000,
  });
  // a should be expired at now=1000, b should not
  const removed = await roomCodeService.sweepExpired(db, 1000);
  assert.equal(removed, 1);
  assert.equal(await roomCodeService.readPending(db, a.code), null);
  assert.notEqual(await roomCodeService.readPending(db, b.code), null);
});
