// Coin economy endpoints (economy.js) on an in-memory database with ETags.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEconomy, runOnProfile, creditPlay, MAX_CAS_ATTEMPTS } from '../src/economy.js';
import { applyDailyClaim, ACHIEVEMENT_COIN_REWARD, DAILY_BASE } from '../../src/game/account/economy.js';

// A tiny RTDB stand-in: get → { value, etag }, putIfMatch fails when the etag moved.
function fakeDb(initial = {}) {
  const data = structuredClone(initial);
  const ver = {};
  const writes = [];
  const db = {
    data, writes,
    interfere: null,   // (path) => void, runs between a read and the write
    async get(_env, path) { return { value: structuredClone(data[path] ?? null), etag: `${path}#${ver[path] ?? 0}` }; },
    async putIfMatch(_env, path, value, etag) {
      db.interfere?.(path);
      if (etag !== `${path}#${ver[path] ?? 0}`) return { ok: false, conflict: true };
      data[path] = structuredClone(value); ver[path] = (ver[path] ?? 0) + 1; writes.push(path);
      return { ok: true };
    },
    async put(_env, path, value) { data[path] = structuredClone(value); },
    bump(path, fn) { data[path] = fn(data[path]); ver[path] = (ver[path] ?? 0) + 1; },
  };
  return db;
}

const UID = 'u1';
const PROFILE = `users/${UID}/profile`;
const env = { FIREBASE_PROJECT_ID: 'p' };
const req = (action, body, token = 'tok') => new Request(`https://w.example/economy/${action}`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const verify = async (t) => {
  if (t === 'guest') return { sub: 'g', firebase: { sign_in_provider: 'anonymous' } };
  if (t !== 'tok') throw new Error('bad');
  return { sub: UID, firebase: { sign_in_provider: 'password' } };
};
const call = async (db, action, body, token) => (await handleEconomy(req(action, body, token), env, {}, { verify, db })).json();

test('buy: charges the catalog price once; a retried request id gets the same answer', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 600, ownedReactions: [] } });
  const r = await call(db, 'buy', { reqId: 'req-0000001', item: 'reaction:wink' });
  assert.equal(r.ok, true);
  assert.equal(db.data[PROFILE].coins, 350);
  assert.deepEqual(db.data[PROFILE].ownedReactions, ['wink']);
  const again = await call(db, 'buy', { reqId: 'req-0000001', item: 'reaction:wink' });
  assert.equal(again.ok, true, 'the replay answers like the first time');
  assert.equal(db.data[PROFILE].coins, 350, 'and charges nothing');
  assert.deepEqual(db.data[`coinLedger/${UID}/req-0000001`].delta, -250);
});

test('buy: refuses unaffordable, owned and unknown items without writing', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 100, ownedReactions: ['yawn'] } });
  assert.equal((await call(db, 'buy', { reqId: 'req-0000002', item: 'reaction:wink' })).reason, 'insufficient');
  assert.equal((await call(db, 'buy', { reqId: 'req-0000003', item: 'reaction:yawn' })).reason, 'already-owned');
  assert.equal((await call(db, 'buy', { reqId: 'req-0000004', item: 'reaction:laugh' })).reason, 'unknown-item');
  assert.equal(db.writes.length, 0);
});

test('claim-daily: once per day', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 0 } });
  const first = await call(db, 'claim-daily', { reqId: 'req-daily-1' });
  assert.equal(first.coinsAwarded, DAILY_BASE);
  const second = await call(db, 'claim-daily', { reqId: 'req-daily-2' });
  assert.equal(second.alreadyClaimedToday, true);
  assert.equal(db.data[PROFILE].coins, DAILY_BASE);
});

test('achievement: pays once, and only when it is really complete', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 0, stats: { gamesPlayed: 4 } } });
  assert.equal((await call(db, 'achievement', { reqId: 'req-ach-001', achievementId: 'first_steps' })).reason, 'not-complete');
  db.bump(PROFILE, (p) => ({ ...p, stats: { gamesPlayed: 5 } }));
  const paid = await call(db, 'achievement', { reqId: 'req-ach-002', achievementId: 'first_steps' });
  assert.equal(paid.reward, ACHIEVEMENT_COIN_REWARD.bronze);
  assert.equal((await call(db, 'achievement', { reqId: 'req-ach-003', achievementId: 'first_steps' })).reason, 'already-paid');
  assert.equal(db.data[PROFILE].coins, ACHIEVEMENT_COIN_REWARD.bronze);
});

test('compare-and-set: a profile written in between is read again, not overwritten', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 0, rating: 800 } });
  let once = true;
  db.interfere = (path) => { if (once) { once = false; db.bump(path, (p) => ({ ...p, rating: 812 })); } };
  const r = await runOnProfile(env, UID, 'req-cas-0001', (p) => applyDailyClaim(p, '2026-10-07'), { db });
  assert.equal(r.ok, true);
  assert.equal(db.data[PROFILE].rating, 812, "the game's rating write survives");
  assert.equal(db.data[PROFILE].coins, DAILY_BASE);
});

test('compare-and-set: gives up as busy after repeated conflicts', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 0 } });
  db.interfere = (path) => db.bump(path, (p) => ({ ...p }));
  const r = await runOnProfile(env, UID, 'req-cas-0002', (p) => applyDailyClaim(p, '2026-10-07'), { db });
  assert.deepEqual(r, { ok: false, reason: 'busy' });
  assert.equal(db.writes.length, 0);
  assert.ok(MAX_CAS_ATTEMPTS > 1);
});

test('requests: no token, a guest, a bad request id and unknown actions are refused', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 0 } });
  assert.equal((await call(db, 'buy', { reqId: 'req-0000009', item: 'reaction:wink' }, 'nope')).reason, 'invalid-token');
  assert.equal((await call(db, 'claim-daily', { reqId: 'req-0000010' }, 'guest')).reason, 'guest');
  assert.equal((await call(db, 'claim-daily', { reqId: 'x' })).reason, 'bad-request-id');
  assert.equal((await call(db, 'mint', { reqId: 'req-0000011' })).reason, 'unknown-action');
  assert.equal(db.writes.length, 0);
});

test('credit-play: a verified pack is credited once, consumed, and never pays a second account', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 10 }, 'users/u2/profile': { coins: 0 } });
  const consumed = [];
  const play = {
    verify: async (_e, { purchaseToken }) => (purchaseToken === 'pending' ? { ok: false, reason: 'pending' } : { ok: true, orderId: 'GPA.1234-5678', consumed: false }),
    consume: async (_e, p) => consumed.push(p.purchaseToken),
  };
  const body = { productId: 'coins_500', purchaseToken: 'tok-a' };
  const r = await creditPlay(env, UID, 'req-play-001', body, { db, play });
  assert.deepEqual([r.ok, r.credited, db.data[PROFILE].coins], [true, 500, 510]);
  assert.deepEqual(consumed, ['tok-a']);
  const replay = await creditPlay(env, UID, 'req-play-002', body, { db, play });
  assert.equal(replay.already, true, 'same order, new request id: no second credit');
  assert.equal(db.data[PROFILE].coins, 510);
  assert.equal((await creditPlay(env, 'u2', 'req-play-003', body, { db, play })).reason, 'order-used');
  assert.equal(db.data['users/u2/profile'].coins, 0);
  assert.equal((await creditPlay(env, UID, 'req-play-004', { productId: 'coins_500', purchaseToken: 'pending' }, { db, play })).reason, 'pending');
  assert.equal((await creditPlay(env, UID, 'req-play-005', { productId: 'coins_free', purchaseToken: 't' }, { db, play })).reason, 'bad-request');
});
