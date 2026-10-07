// Coin economy endpoints (Phase 6a). Coins can be bought with real money, so only this
// worker changes coins and owned items; the database rules refuse client writes to
// them. The rules themselves are the app's own pure functions (src/game/account/
// economy.js), bundled in by wrangler, so the app and the worker can't drift.
//
//   POST /economy/claim-daily   {reqId}                         today's login reward
//   POST /economy/achievement   {reqId, achievementId}          an achievement's reward, once
//   POST /economy/buy           {reqId, item}                   a store item for coins
//   POST /economy/claim-chain   {reqId}                         the next Boostie after level 7
//   POST /economy/credit-play   {reqId, productId, purchaseToken}  a Play coin pack (6b)
//
// Each request: verify the Firebase ID token → read users/<uid>/profile with its ETag →
// apply → write it back only if unchanged (retry on a conflict). The request id is
// remembered on the profile (econRecent), so a retried request gets the first answer
// instead of paying twice. Every coin change is also logged to coinLedger/<uid>/<reqId>.

import {
  applyDailyClaim, applyAchievementClaim, applyPurchase, applyChainClaim, applyCoinCredit,
  rememberRequest, coinDelta, isRequestId, ymdIn, orderKey, COIN_PACKS,
} from '../../src/game/account/economy.js';
import { verifyFirebaseToken } from './verifyFirebaseToken.js';
import { rtdbGetWithEtag, rtdbPutIfMatch, rtdbPut } from './firebaseRtdb.js';
import { verifyPlayPurchase, consumePlayPurchase } from './playBilling.js';

export const MAX_CAS_ATTEMPTS = 6;

const ACTIONS = {
  'claim-daily': () => ({ apply: (p) => applyDailyClaim(p, ymdIn()) }),
  achievement: (body) => ({ apply: (p, now) => applyAchievementClaim(p, String(body.achievementId ?? ''), now) }),
  buy: (body) => ({ apply: (p) => applyPurchase(p, String(body.item ?? '')) }),
  'claim-chain': () => ({ apply: (p) => applyChainClaim(p) }),
  'credit-play': null,   // special: verified with Google first (creditPlay below)
};

export const ECONOMY_PATHS = Object.keys(ACTIONS).map((a) => `/economy/${a}`);

// The compare-and-set loop. `apply(profile, now)` → { next?, result } (economy.js).
export async function runOnProfile(env, uid, reqId, apply, { db = defaultDb, now = () => Date.now() } = {}) {
  const path = `users/${uid}/profile`;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { value: p, etag } = await db.get(env, path);
    if (!p || typeof p !== 'object') return { ok: false, reason: 'no-profile' };
    const seen = p.econRecent?.[reqId];
    if (seen) return seen.result;
    const t = now();
    const { next, result } = apply(p, t);
    if (!next) return result;
    const write = await db.putIfMatch(env, path, rememberRequest(next, reqId, result, t), etag);
    if (!write.ok) continue;   // someone wrote the profile in between: read again
    const delta = coinDelta(p, next);
    if (delta) {
      db.put(env, `coinLedger/${uid}/${reqId}`, { delta, coins: next.coins, ts: t, why: result.why ?? null })
        .catch((e) => console.warn('[economy] ledger write failed', e?.message ?? e));
    }
    return result;
  }
  return { ok: false, reason: 'busy' };
}

const defaultDb = { get: rtdbGetWithEtag, putIfMatch: rtdbPutIfMatch, put: rtdbPut };

// A Play coin pack: check it with Google, claim the order for this player (an order is
// credited to one account only, ever), credit the coins, then consume it.
export async function creditPlay(env, uid, reqId, body, { db = defaultDb, play = { verify: verifyPlayPurchase, consume: consumePlayPurchase }, now = () => Date.now() } = {}) {
  const productId = String(body.productId ?? '');
  const purchaseToken = String(body.purchaseToken ?? '');
  if (!COIN_PACKS[productId] || !purchaseToken || purchaseToken.length > 4096) return { ok: false, reason: 'bad-request' };
  const check = await play.verify(env, { productId, purchaseToken });
  if (!check.ok) return { ok: false, reason: check.reason };
  const key = orderKey(check.orderId);
  if (!key) return { ok: false, reason: 'invalid' };
  // Claim the order globally (create-only), so the same token can't pay two accounts.
  const orderPath = `coinOrders/${key}`;
  const { value: owner, etag } = await db.get(env, orderPath);
  if (owner && owner.uid !== uid) return { ok: false, reason: 'order-used' };
  if (!owner) {
    const claim = await db.putIfMatch(env, orderPath, { uid, productId, ts: now() }, etag);
    if (!claim.ok) {
      const again = await db.get(env, orderPath);
      if (again.value?.uid !== uid) return { ok: false, reason: 'order-used' };
    }
  }
  const result = await runOnProfile(env, uid, reqId,
    (p, t) => { const r = applyCoinCredit(p, { orderId: check.orderId, productId }, t); r.result.why = `play:${productId}`; return r; },
    { db, now });
  if (result.ok && !check.consumed) {
    try { await play.consume(env, { productId, purchaseToken }); }
    catch (e) { console.warn('[economy] consume failed (Play refunds unconsumed packs after 3 days)', e?.message ?? e); }
  }
  return result;
}

function json(status, payload, headers) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// The fetch handler for /economy/*. deps are injectable for tests.
export async function handleEconomy(request, env, cors, deps = {}) {
  const verify = deps.verify ?? verifyFirebaseToken;
  const action = new URL(request.url).pathname.slice('/economy/'.length);
  if (!(action in ACTIONS)) return json(404, { ok: false, reason: 'unknown-action' }, cors);
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { ok: false, reason: 'missing-bearer' }, cors);
  let claims;
  try { claims = await verify(auth.slice(7), env.FIREBASE_PROJECT_ID); }
  catch { return json(401, { ok: false, reason: 'invalid-token' }, cors); }
  // Guests (anonymous accounts) don't earn or spend coins.
  if (claims?.firebase?.sign_in_provider === 'anonymous') return json(403, { ok: false, reason: 'guest' }, cors);
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, reason: 'bad-json' }, cors); }
  if (!isRequestId(body?.reqId)) return json(400, { ok: false, reason: 'bad-request-id' }, cors);
  try {
    const result = action === 'credit-play'
      ? await creditPlay(env, claims.sub, body.reqId, body, deps)
      : await runOnProfile(env, claims.sub, body.reqId, (p, t) => {
        const r = ACTIONS[action](body).apply(p, t);
        if (r.next) r.result.why = action;
        return r;
      }, deps);
    return json(200, result, cors);
  } catch (e) {
    console.error('[economy]', action, e?.message ?? e);
    return json(500, { ok: false, reason: 'server-error' }, cors);
  }
}
