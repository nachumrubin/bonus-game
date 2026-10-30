// AdMob SSV callback (admobSsv.js): real ECDSA signatures from a test key standing in
// for Google's, and an in-memory database with ETags.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmobSsv, verifySsvQuery, derToP1363, _resetAdmobKeys, VERIFIER_KEYS_URL } from '../src/admobSsv.js';
import { AD_REWARD_COINS, AD_REWARDS_PER_DAY } from '../../src/game/account/economy.js';

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// r‖s → DER, as AdMob sends it.
function p1363ToDer(sig) {
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.subarray(i);
    if (v[0] & 0x80) v = Uint8Array.of(0, ...v);
    return [0x02, v.length, ...v];
  };
  const body = [...int(sig.subarray(0, 32)), ...int(sig.subarray(32))];
  return Uint8Array.of(0x30, body.length, ...body);
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
const KEY_ID = '3335741209';
let keyFetches = 0;
const fetchImpl = async (url) => {
  assert.equal(url, VERIFIER_KEYS_URL);
  keyFetches++;
  return new Response(JSON.stringify({ keys: [{ keyId: Number(KEY_ID), base64: Buffer.from(spki).toString('base64') }] }));
};

async function signedQuery(fields, { keyId = KEY_ID, tamper } = {}) {
  const msg = new URLSearchParams(fields).toString();
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(msg)));
  const q = `${tamper ? tamper(msg) : msg}&signature=${b64url(p1363ToDer(raw))}&key_id=${keyId}`;
  return q;
}

function fakeDb(initial = {}) {
  const data = structuredClone(initial);
  const ver = {};
  return {
    data,
    async get(_env, path) { return { value: structuredClone(data[path] ?? null), etag: `${path}#${ver[path] ?? 0}` }; },
    async putIfMatch(_env, path, value, etag) {
      if (etag !== `${path}#${ver[path] ?? 0}`) return { ok: false };
      data[path] = structuredClone(value); ver[path] = (ver[path] ?? 0) + 1;
      return { ok: true };
    },
    async put(_env, path, value) { data[path] = structuredClone(value); },
  };
}

const UID = 'Uid_abcdef123';
const PROFILE = `users/${UID}/profile`;
const fields = (txn, extra = {}) => ({
  ad_network: '5450213213286189855', ad_unit: '1234567890', reward_amount: '1', reward_item: 'coins',
  timestamp: '1798400000000', transaction_id: txn, user_id: UID, ...extra,
});
const call = async (db, query, env = {}) => handleAdmobSsv(new Request(`https://w.example/admob/ssv?${query}`), env, { db, fetchImpl });

beforeEach(() => { _resetAdmobKeys(); keyFetches = 0; });

test('derToP1363: strips the sign byte and left-pads short integers', () => {
  const sig = new Uint8Array(64); sig[0] = 0x80; sig[63] = 1;   // r needs a sign byte, s is short
  assert.deepEqual(derToP1363(p1363ToDer(sig)), sig);
});

test('verifySsvQuery: accepts Google-signed queries, rejects tampered ones and unknown keys', async () => {
  assert.equal(await verifySsvQuery(await signedQuery(fields('t1')), { fetchImpl }), true);
  assert.equal(await verifySsvQuery(await signedQuery(fields('t1'), { tamper: (m) => m.replace(UID, 'someone_else') }), { fetchImpl }), false);
  assert.equal(await verifySsvQuery(await signedQuery(fields('t1'), { keyId: '42' }), { fetchImpl }), false);
  assert.equal(await verifySsvQuery('user_id=x', { fetchImpl }), false);
});

test('ssv: a signed callback credits the player once per transaction, up to the daily cap', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 100 } });
  const first = await call(db, await signedQuery(fields('txn0001')));
  assert.equal(first.status, 200);
  assert.equal(db.data[PROFILE].coins, 100 + AD_REWARD_COINS);
  // AdMob retrying the same callback pays nothing more.
  await call(db, await signedQuery(fields('txn0001')));
  assert.equal(db.data[PROFILE].coins, 100 + AD_REWARD_COINS);
  assert.equal(db.data[`coinLedger/${UID}/ad-txn0001`].why, 'ad');
  for (let i = 2; i <= AD_REWARDS_PER_DAY + 2; i++) {
    assert.equal((await call(db, await signedQuery(fields(`txn000${i}`)))).status, 200);
  }
  assert.equal(db.data[PROFILE].coins, 100 + AD_REWARD_COINS * AD_REWARDS_PER_DAY, 'capped per day');
  assert.equal(keyFetches, 1, 'Google keys are cached');
});

test('ssv: refuses a bad signature; ignores the console test ping and other ad units', async () => {
  const db = fakeDb({ [PROFILE]: { coins: 0 } });
  const forged = await signedQuery(fields('txn9'), { tamper: (m) => m.replace('reward_amount=1', 'reward_amount=999') });
  assert.equal((await call(db, forged)).status, 403);
  assert.equal((await call(db, await signedQuery(fields('txn10', { user_id: '' })))).status, 200);
  assert.equal((await call(db, await signedQuery(fields('txn11')), { ADMOB_AD_UNIT_ID: '999' })).status, 200);
  assert.equal(db.data[PROFILE].coins, 0);
  // The configured unit is credited whether AdMob sends the number or the full id.
  await call(db, await signedQuery(fields('txn12', { ad_unit: 'ca-app-pub-1/1234567890' })), { ADMOB_AD_UNIT_ID: '1234567890' });
  await call(db, await signedQuery(fields('txn13')), { ADMOB_AD_UNIT_ID: '1234567890' });
  assert.equal(db.data[PROFILE].coins, 2 * AD_REWARD_COINS);
});
