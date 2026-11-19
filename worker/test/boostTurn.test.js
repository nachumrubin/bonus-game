// Boost 2.0 turn endpoints (boostTurn.js) on an in-memory database with ETags.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleBoost, createBoostMatch, runBoostTurn, runBoostPlan, loadValidator, _resetCaches, MAX_CAS_ATTEMPTS,
} from '../src/boostTurn.js';
import { deserializeState } from '../../src/game/boostV2/authoritativeTurn.js';
import { legalOpeningSquares } from '../../src/game/boostV2/engineV2.js';
import { CMD } from '../../src/events/commands.js';
import { createRng } from '../../src/util/rng.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

// Nested-path RTDB stand-in. getWithEtag/putIfMatch mimic the REST ETag API.
function fakeDb() {
  const root = {};
  const ver = {};
  const parts = (p) => p.split('/').filter(Boolean);
  const read = (p) => parts(p).reduce((n, k) => (n == null ? null : (n[k] ?? null)), root);
  const write = (p, v) => {
    const ks = parts(p);
    let n = root;
    for (const k of ks.slice(0, -1)) n = (n[k] ??= {});
    if (v === null) delete n[ks.at(-1)]; else n[ks.at(-1)] = structuredClone(v);
  };
  const db = {
    root, ver, interfere: null, writes: [],
    async get(_e, p) { return structuredClone(read(p)); },
    async getWithEtag(_e, p) { return { value: structuredClone(read(p)), etag: `${p}#${ver[p] ?? 0}` }; },
    async putIfMatch(_e, p, v, etag) {
      await db.interfere?.(p);
      if (etag !== `${p}#${ver[p] ?? 0}`) return { ok: false, conflict: true };
      write(p, v); ver[p] = (ver[p] ?? 0) + 1; db.writes.push(p);
      return { ok: true };
    },
    async put(_e, p, v) { write(p, v); db.writes.push(p); },
    async patch(_e, p, v) { for (const [k, val] of Object.entries(v)) write(`${p}/${k}`, val); db.writes.push(p); },
    read,
  };
  return db;
}

const env = { FIREBASE_PROJECT_ID: 'p', DICTIONARY_URL: 'https://app.example/data/dictionary.txt' };
const PLAYERS = { 0: { uid: 'alice', displayName: 'A' }, 1: { uid: 'bob', displayName: 'B' } };
const ANY = () => true;
let n = 0;
const rid = () => `req${String(++n).padStart(8, '0')}`;
const deps = (db, extra = {}) => ({ db, validator: ANY, rng: createRng(`r${n}`), now: () => 1_800_000_000_000, ...extra });

async function setup() {
  const db = fakeDb();
  const r = await createBoostMatch(env, 'alice', { reqId: rid(), roomId: 'room-0001', mode: 'friend-async', players: PLAYERS }, deps(db));
  assert.ok(r.ok, r.reason);
  return db;
}
const secretState = (db) => deserializeState(db.read('boostV2Secret/room-0001').stateJson);
function opening(db) {
  const st = secretState(db);
  const rack = st.racks[st.currentTurnSlot].filter(l => l !== '?');
  return { type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 4, c: 4, letter: rack[0] }, { r: 4, c: 5, letter: rack[1] }] } };
}

beforeEach(() => _resetCaches());

test('create: writes secret, public room, racks and the async lobby index', async () => {
  const db = await setup();
  const room = db.read('rooms/room-0001');
  assert.equal(room.ruleset, 'BOOST_V2');
  assert.equal(room.authority, 'worker');
  assert.equal(room.version, 1);
  assert.ok(db.read('boostV2Secret/room-0001').stateJson);
  assert.equal(db.read('boostV2Racks/room-0001/0/tiles').length, 8);
  assert.ok(db.read('users/alice/asyncRooms/room-0001'));
  assert.ok(db.read('users/bob/asyncRooms/room-0001'));
  assert.ok(!JSON.stringify(room).includes('stateJson'));
});

test('create: caller must be a player; ids and modes validated; no overwrite', async () => {
  const db = fakeDb();
  const base = { reqId: rid(), roomId: 'room-0002', mode: 'friend-live', players: PLAYERS };
  assert.equal((await createBoostMatch(env, 'mallory', base, deps(db))).reason, 'not-a-player');
  assert.equal((await createBoostMatch(env, 'alice', { ...base, roomId: 'x/../y' }, deps(db))).reason, 'bad-room-id');
  assert.equal((await createBoostMatch(env, 'alice', { ...base, mode: 'offline-solo' }, deps(db))).reason, 'bad-mode');
  assert.equal((await createBoostMatch(env, 'alice', { ...base, players: { 0: PLAYERS[0], 1: PLAYERS[0] } }, deps(db))).reason, 'bad-players');
  await db.put(env, 'rooms/room-0002', { schemaVersion: 2 });
  assert.equal((await createBoostMatch(env, 'alice', base, deps(db))).reason, 'room-exists', 'never clobbers a legacy room');
  const db2 = fakeDb();
  assert.ok((await createBoostMatch(env, 'alice', base, deps(db2))).ok);
  const again = await createBoostMatch(env, 'bob', base, deps(db2));
  assert.equal(again.existing, true, 'retry by either player is idempotent');
  assert.equal((await createBoostMatch(env, 'mallory', { ...base, players: { 0: PLAYERS[0], 1: { uid: 'mallory' } } }, deps(db2))).reason, 'room-exists');
});

test('turn: commits, publishes the projection + racks; a retried reqId writes nothing', async () => {
  const db = await setup();
  const reqId = rid();
  const r = await runBoostTurn(env, 'alice', { reqId, roomId: 'room-0001', command: opening(db) }, deps(db));
  assert.ok(r.ok, r.reason);
  assert.equal(r.version, 2);
  assert.equal(db.read('rooms/room-0001/version'), 2);
  assert.equal(db.read('rooms/room-0001/currentTurnSlot'), 1);
  assert.deepEqual(db.read('boostV2Racks/room-0001/0/tiles'), secretState(db).racks[0]);
  const writes = db.writes.length;
  const again = await runBoostTurn(env, 'alice', { reqId, roomId: 'room-0001', command: opening(db) }, deps(db));
  assert.equal(again.replay, true);
  assert.equal(db.writes.length, writes);
});

test('turn: side fields written by clients (ready, livePreview) survive a projection publish', async () => {
  const db = await setup();
  await db.put(env, 'rooms/room-0001/ready/0', true);
  await db.put(env, 'rooms/room-0001/players/1/oneSignalSubId', 'sub-123');
  await db.put(env, 'rooms/room-0001/liveReaction', { type: 'emoji', id: 'x', senderSlot: 1, ts: 1 });
  await runBoostTurn(env, 'alice', { reqId: rid(), roomId: 'room-0001', command: opening(db) }, deps(db));
  assert.equal(db.read('rooms/room-0001/ready/0'), true);
  assert.ok(db.read('rooms/room-0001/liveReaction'));
  assert.equal(db.read('rooms/room-0001/players/1/oneSignalSubId'), 'sub-123', 'push routing id kept');
});

test('turn: a concurrent commit forces a re-run on the new state (no double move)', async () => {
  const db = await setup();
  const cmd = opening(db);
  let raced = false;
  db.interfere = async (p) => {
    if (raced || !p.startsWith('boostV2Secret/')) return;
    raced = true;
    // Alice's duplicate tab lands the same move first, with a different reqId.
    db.interfere = null;
    await runBoostTurn(env, 'alice', { reqId: rid(), roomId: 'room-0001', command: cmd }, deps(db));
  };
  const r = await runBoostTurn(env, 'alice', { reqId: rid(), roomId: 'room-0001', command: cmd }, deps(db));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-your-turn', 're-run against the committed state, not applied twice');
  assert.equal(db.read('rooms/room-0001/version'), 2);
});

test('turn: gives up with busy after repeated conflicts', async () => {
  const db = await setup();
  let k = 0;
  db.interfere = async (p) => { if (p.startsWith('boostV2Secret/')) db.ver[p] = (db.ver[p] ?? 0) + 1 + (k++ * 0); };
  const r = await runBoostTurn(env, 'alice', { reqId: rid(), roomId: 'room-0001', command: opening(db) }, deps(db));
  assert.equal(r.reason, 'busy');
  assert.ok(MAX_CAS_ATTEMPTS > 1);
});

test('turn: a stale projection is replaced by the latest one', async () => {
  const db = await setup();
  await runBoostTurn(env, 'alice', { reqId: rid(), roomId: 'room-0001', command: opening(db) }, deps(db));
  // Simulate an older publish landing late.
  await db.patch(env, 'rooms/room-0001', { version: 1, currentTurnSlot: 0 });
  await runBoostTurn(env, 'bob', { reqId: rid(), roomId: 'room-0001', command: { type: CMD.PASS_TURN } }, deps(db));
  assert.equal(db.read('rooms/room-0001/version'), 3);
});

test('plan: read-only preview for the player to move', async () => {
  const db = await setup();
  const before = JSON.stringify(db.read('boostV2Secret/room-0001'));
  const r = await runBoostPlan(env, 'alice', { roomId: 'room-0001', draft: opening(db).payload }, deps(db));
  assert.ok(r.ok, r.reason);
  assert.ok(r.breakdown.totalScore > 0);
  assert.equal(JSON.stringify(db.read('boostV2Secret/room-0001')), before);
  assert.equal((await runBoostPlan(env, 'bob', { roomId: 'room-0001', draft: opening(db).payload }, deps(db))).reason, 'not-your-turn');
});

test('finishing an async match removes it from both lobbies', async () => {
  const db = await setup();
  const r = await runBoostTurn(env, 'bob', { reqId: rid(), roomId: 'room-0001', command: { type: CMD.RESIGN_GAME } }, deps(db));
  assert.ok(r.ok);
  assert.equal(db.read('rooms/room-0001/status'), 'abandoned');
  assert.equal(db.read('users/alice/asyncRooms/room-0001'), null);
  assert.equal(db.read('users/bob/asyncRooms/room-0001'), null);
});

test('a full opening sequence through the endpoint', async () => {
  const db = await setup();
  const turn = (uid, command) => runBoostTurn(env, uid, { reqId: rid(), roomId: 'room-0001', command }, deps(db));
  assert.ok((await turn('alice', opening(db))).ok);
  assert.ok((await turn('bob', { type: CMD.PASS_TURN })).ok);
  for (const uid of ['bob', 'alice', 'bob']) {
    const legal = legalOpeningSquares(secretState(db));
    assert.ok((await turn(uid, { type: CMD.PLACE_OPENING_BOOST, payload: legal[0] })).ok);
  }
  const room = db.read('rooms/room-0001');
  assert.equal(room.boostV2.phase, 'NORMAL');
  assert.equal(room.boostV2.activeBoosts.length, 3);
  assert.equal(room.currentTurnSlot, 0);
});

test('validator: dictionary from DICTIONARY_URL + Firebase overlays, cached per isolate', async () => {
  const db = fakeDb();
  await db.put(env, 'dictionaryRejected/-a', { word: 'אבא' });
  await db.put(env, 'dictionaryApproved/זזז', true);
  let fetches = 0;
  const fetchImpl = async (url) => { fetches++; assert.equal(url, env.DICTIONARY_URL); return new Response('אב\nאבא\nשלום\n'); };
  const v = await loadValidator(env, { fetchImpl, db, now: () => 1000 });
  assert.equal(v('שלום'), true);
  assert.equal(v('אבא'), false, 'blocked overlay wins');
  assert.equal(v('זזז'), true, 'approved overlay');
  assert.equal(v('לא'), false);
  await loadValidator(env, { fetchImpl, db, now: () => 2000 });
  assert.equal(fetches, 1);
});

test('HTTP: auth required, request id required, busy → 503', async () => {
  const db = await setup();
  const verify = async (t) => { if (t !== 'tok') throw new Error('bad'); return { sub: 'alice' }; };
  const call = async (path, body, token = 'tok') => handleBoost(new Request(`https://w.example${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }), env, {}, { ...deps(db), verify });
  assert.equal((await call('/boost/turn', {}, 'nope')).status, 401);
  assert.equal((await call('/boost/turn', { roomId: 'room-0001' })).status, 400);
  assert.equal((await call('/boost/other', {})).status, 404);
  const ok = await call('/boost/turn', { reqId: rid(), roomId: 'room-0001', command: opening(db) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  const rejected = await call('/boost/turn', { reqId: rid(), roomId: 'room-0001', command: { type: CMD.PASS_TURN } });
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json()).reason, 'not-your-turn');
});
