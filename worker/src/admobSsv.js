// AdMob rewarded-ad server-side verification (SSV). The Android app shows a rewarded
// video natively (RewardedAdActivity) with the player's Firebase uid as the SSV user id.
// When the player has earned the reward, AdMob itself calls
//
//   GET /admob/ssv?ad_network=…&ad_unit=…&custom_data=…&reward_amount=…&reward_item=…
//                  &timestamp=…&transaction_id=…&user_id=<uid>&signature=…&key_id=…
//
// signed with one of Google's ECDSA P-256 keys. Only a correctly signed callback credits
// coins (economy.js applyAdReward: a fixed amount, capped per day), once per transaction
// id. The app never asks for ad coins itself, so a modified client can't mint them.
//
// Optional env:
//   ADMOB_AD_UNIT_ID  (vars) — the rewarded ad unit's numeric id (the part after '/');
//                     when set, callbacks for any other unit are ignored.

import { applyAdReward, ymdIn } from '../../src/game/account/economy.js';
import { runOnProfile } from './economy.js';

export const VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const KEYS_TTL_MS = 24 * 3600 * 1000;

let keysCache = null;   // Map keyId → CryptoKey
let keysUntil = 0;

function b64ToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// AdMob signs with DER-encoded ECDSA; WebCrypto wants r‖s, 32 bytes each.
export function derToP1363(der) {
  if (der[0] !== 0x30) throw new Error('not a DER sequence');
  let i = 2 + (der[1] & 0x80 ? der[1] & 0x7f : 0);
  const out = new Uint8Array(64);
  for (let k = 0; k < 2; k++) {
    if (der[i] !== 0x02) throw new Error('not a DER integer');
    let len = der[i + 1];
    let start = i + 2;
    i = start + len;
    while (len > 32 && der[start] === 0) { start++; len--; }   // drop the sign byte
    if (len > 32) throw new Error('integer too long');
    out.set(der.subarray(start, start + len), k * 32 + (32 - len));
  }
  return out;
}

async function verifierKeys(fetchImpl) {
  if (keysCache && Date.now() < keysUntil) return keysCache;
  const r = await fetchImpl(VERIFIER_KEYS_URL);
  if (!r.ok) throw new Error(`AdMob verifier keys: ${r.status}`);
  const { keys = [] } = await r.json();
  const map = new Map();
  for (const k of keys) {
    if (!k?.base64) continue;
    map.set(String(k.keyId), await crypto.subtle.importKey(
      'spki', b64ToBytes(k.base64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    ));
  }
  keysCache = map;
  keysUntil = Date.now() + KEYS_TTL_MS;
  return map;
}

// rawQuery: the URL's query string without '?', exactly as received. The signed message
// is everything before '&signature='; signature and key_id are always the last two.
export async function verifySsvQuery(rawQuery, { fetchImpl = fetch } = {}) {
  const cut = rawQuery.indexOf('&signature=');
  if (cut < 0) return false;
  const params = new URLSearchParams(rawQuery);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) return false;
  let key = (await verifierKeys(fetchImpl)).get(keyId);
  if (!key) {   // Google rotated its keys since we cached them
    keysUntil = 0;
    key = (await verifierKeys(fetchImpl)).get(keyId);
    if (!key) return false;
  }
  let sig;
  try { sig = derToP1363(b64ToBytes(signature)); } catch { return false; }
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig,
    new TextEncoder().encode(rawQuery.slice(0, cut)));
}

const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;

// → a Response. AdMob only needs a 200; a non-200 makes it retry later.
export async function handleAdmobSsv(request, env, deps = {}) {
  const url = new URL(request.url);
  const raw = url.search.replace(/^\?/, '');
  const verify = deps.verifySsv ?? ((q) => verifySsvQuery(q, deps));
  let valid;
  try { valid = await verify(raw); }
  catch (e) { console.error('[admob] verify', e?.message ?? e); return new Response('error', { status: 500 }); }
  if (!valid) return new Response('bad signature', { status: 403 });

  const p = url.searchParams;
  const uid = p.get('user_id') ?? '';
  const txn = (p.get('transaction_id') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  // The AdMob console's "verify URL" test sends a signed callback without a user.
  if (!uid) return new Response('ok (no user)', { status: 200 });
  if (!UID_RE.test(uid) || !txn) return new Response('bad request', { status: 400 });
  // ad_unit may come as '8928038640' or 'ca-app-pub-…/8928038640': compare the number.
  if (env.ADMOB_AD_UNIT_ID && String(p.get('ad_unit') ?? '').split('/').pop() !== String(env.ADMOB_AD_UNIT_ID)) {
    return new Response('ok (other ad unit)', { status: 200 });
  }
  try {
    const result = await runOnProfile(env, uid, `ad-${txn}`.slice(0, 64), (prof) => {
      const r = applyAdReward(prof, ymdIn());
      if (r.next) r.result.why = 'ad';
      return r;
    }, deps);
    if (result?.reason === 'busy') return new Response('busy', { status: 503 });
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[admob] credit', e?.message ?? e);
    return new Response('error', { status: 500 });
  }
}

export function _resetAdmobKeys() { keysCache = null; keysUntil = 0; }
