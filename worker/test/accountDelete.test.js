// Account deletion (accountDelete.js) against an in-memory database tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAccountDelete, buildDeletionUpdate, deleteAuthUser, DELETED_NAME, _resetAuthToken } from '../src/accountDelete.js';

const ME = 'me_uid_123';
const BOB = 'bob_uid_456';

function tree() {
  return {
    users: { [ME]: { profile: { displayName: 'Nachum', userId: '1234', coins: 50 }, activeRoom: 'r1' }, [BOB]: { profile: { displayName: 'Bob' } } },
    usernames: { nachum: ME, bob: BOB },
    userIds: { 1234: ME },
    globalRatings: { [ME]: { rating: 1200 }, [BOB]: { rating: 1100 } },
    presence: { [ME]: { connected: true } },
    friends: { [ME]: { [BOB]: { name: 'Bob' } }, [BOB]: { [ME]: { name: 'Nachum' } } },
    friendRequests: { [BOB]: { [ME]: { fromName: 'Nachum' }, other_uid_1: { fromName: 'X' } }, [ME]: { carol_uid: { fromName: 'Carol' } } },
    matchmakingQueue: { classic: { [ME]: { ts: 1 }, [BOB]: { ts: 2 } } },
    coinLedger: { [ME]: { a: { delta: 5 } } },
    coinOrders: { o1: { uid: ME } },
    rooms: {
      r1: { players: [{ uid: ME, displayName: 'Nachum' }, { uid: BOB, displayName: 'Bob' }] },
      r2: { players: [{ uid: BOB, displayName: 'Bob' }, { uid: ME, displayName: 'Nachum' }] },
      r3: { players: [{ uid: BOB, displayName: 'Bob' }, { uid: 'z_uid_999', displayName: 'Z' }] },
    },
  };
}

function fakeDb(data) {
  const at = (path) => path.split('/').filter(Boolean).reduce((n, k) => (n == null ? undefined : n[k]), data);
  return {
    data,
    async get(_env, path, { shallow } = {}) {
      const v = structuredClone(at(path) ?? null);
      return shallow && v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map((k) => [k, true])) : v;
    },
    async query(_env, path, orderBy, value) {
      return Object.fromEntries(Object.entries(at(path) ?? {}).filter(([, c]) => orderBy.split('/').reduce((n, k) => n?.[k], c) === value));
    },
    async patch(_env, path, updates) {
      assert.equal(path, '');
      const keys = Object.keys(updates);
      for (const a of keys) for (const b of keys) assert.ok(a === b || !b.startsWith(`${a}/`), `ancestor paths in one update: ${a} / ${b}`);
      for (const [p, v] of Object.entries(updates)) {
        const parts = p.split('/');
        const last = parts.pop();
        let n = data;
        for (const k of parts) { if (n[k] == null) { if (v === null) { n = null; break; } n[k] = {}; } n = n[k]; }
        if (!n) continue;
        if (v === null) delete n[last]; else n[last] = v;
      }
    },
  };
}

const call = (deps, token = 'tok') => handleAccountDelete(
  new Request('https://w.example/account/delete', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }),
  { FIREBASE_PROJECT_ID: 'p' }, {}, deps,
);

test('delete: removes the player everywhere, renames them in rooms, deletes Auth last', async () => {
  const db = fakeDb(tree());
  const order = [];
  const patch = db.patch.bind(db);
  db.patch = async (...a) => { order.push('db'); return patch(...a); };
  const res = await call({
    db, verify: async () => ({ sub: ME }),
    push: async (_e, uid) => { order.push(`push:${uid}`); },
    auth: async (_e, uid) => { order.push(`auth:${uid}`); },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(order, ['db', `push:${ME}`, `auth:${ME}`]);
  const d = db.data;
  assert.equal(d.users[ME], undefined);
  assert.ok(d.users[BOB]);
  assert.deepEqual(d.usernames, { bob: BOB });
  assert.deepEqual(d.userIds, {});
  assert.deepEqual(Object.keys(d.globalRatings), [BOB]);
  assert.equal(d.presence[ME], undefined);
  assert.equal(d.friends[ME], undefined);
  assert.deepEqual(d.friends[BOB], {});
  assert.deepEqual(Object.keys(d.friendRequests[BOB]), ['other_uid_1']);
  assert.equal(d.friendRequests[ME], undefined);
  assert.deepEqual(Object.keys(d.matchmakingQueue.classic), [BOB]);
  assert.equal(d.coinLedger[ME], undefined);
  assert.deepEqual(d.coinOrders, { o1: { uid: ME } }, 'Play orders are kept');
  assert.equal(d.rooms.r1.players[0].displayName, DELETED_NAME);
  assert.equal(d.rooms.r1.players[0].uid, ME);
  assert.equal(d.rooms.r1.players[1].displayName, 'Bob');
  assert.equal(d.rooms.r2.players[1].displayName, DELETED_NAME);
  assert.equal(d.rooms.r3.players[1].displayName, 'Z');
});

test('delete: a name or short id now claimed by someone else is left alone; a retry is harmless', async () => {
  const t = tree();
  t.usernames.nachum = BOB; t.userIds['1234'] = BOB;
  const db = fakeDb(t);
  const u = await buildDeletionUpdate({}, ME, db);
  assert.equal('usernames/nachum' in u, false);
  assert.equal('userIds/1234' in u, false);
  await db.patch({}, '', u);
  // Second run (the Auth delete failed the first time): nothing left to find.
  await db.patch({}, '', await buildDeletionUpdate({}, ME, db));
  assert.equal(db.data.usernames.nachum, BOB);
});

test('delete: refuses without a valid token; a failed step is a 500 the app can retry', async () => {
  assert.equal((await call({}, null)).status, 401);
  assert.equal((await call({ verify: async () => { throw new Error('bad'); } })).status, 401);
  const db = fakeDb(tree());
  const res = await call({ db, verify: async () => ({ sub: ME }), push: async () => {}, auth: async () => { throw new Error('down'); } });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).reason, 'server-error');
  // A OneSignal failure doesn't block the deletion.
  const ok = await call({ db: fakeDb(tree()), verify: async () => ({ sub: ME }), push: async () => { throw new Error('x'); }, auth: async () => {} });
  assert.equal(ok.status, 200);
});

test('deleteAuthUser: calls Identity Toolkit; an already-deleted user counts as done', async () => {
  _resetAuthToken();
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const env = {
    FIREBASE_PROJECT_ID: 'boost-8ef11',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@x', private_key_id: 'k', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` }),
  };
  const calls = [];
  let reply = new Response('{}');
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }));
    return reply;
  };
  await deleteAuthUser(env, ME, { fetchImpl });
  assert.equal(calls[1].url, 'https://identitytoolkit.googleapis.com/v1/projects/boost-8ef11/accounts:delete');
  assert.deepEqual(JSON.parse(calls[1].body), { localId: ME });
  reply = new Response('{"error":{"message":"USER_NOT_FOUND"}}', { status: 400 });
  await deleteAuthUser(env, ME, { fetchImpl });
  reply = new Response('{"error":{"message":"PERMISSION_DENIED"}}', { status: 403 });
  await assert.rejects(deleteAuthUser(env, ME, { fetchImpl }), /403/);
});
