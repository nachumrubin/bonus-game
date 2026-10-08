// Google Play Billing check for coin packs (Phase 6b). The Android app buys a pack
// through the Digital Goods API; the worker asks the Google Play Developer API whether
// the purchase token is real and paid, credits the coins once (economy.js), then
// consumes the purchase so the pack can be bought again.
//
// Required env:
//   PLAY_PACKAGE_NAME          (vars, public — the app id in the Play Console)
//   PLAY_SERVICE_ACCOUNT_JSON  (secret — a service account with access to the app in
//                               the Play Console: "View financial data, orders" and
//                               "Manage orders")

import { signJwt } from './firebaseRtdb.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

let cached = null;
let cachedUntil = 0;

async function accessToken(env, fetchImpl) {
  if (cached && Date.now() < cachedUntil - 60_000) return cached;
  if (!env.PLAY_SERVICE_ACCOUNT_JSON) throw new Error('PLAY_SERVICE_ACCOUNT_JSON secret not set');
  const sa = JSON.parse(env.PLAY_SERVICE_ACCOUNT_JSON);
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(sa, SCOPE) }),
  });
  if (!r.ok) throw new Error(`Play token exchange failed: ${r.status}`);
  const data = await r.json();
  cached = data.access_token;
  cachedUntil = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cached;
}

function tokenUrl(env, productId, purchaseToken) {
  return `${API}/${encodeURIComponent(env.PLAY_PACKAGE_NAME)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
}

// → { ok: true, orderId } for a completed, not yet consumed purchase;
//   { ok: false, reason } otherwise ('pending', 'cancelled', 'consumed', 'invalid').
export async function verifyPlayPurchase(env, { productId, purchaseToken }, { fetchImpl = fetch } = {}) {
  if (!env.PLAY_PACKAGE_NAME) throw new Error('PLAY_PACKAGE_NAME not set');
  const r = await fetchImpl(tokenUrl(env, productId, purchaseToken), {
    headers: { Authorization: `Bearer ${await accessToken(env, fetchImpl)}` },
  });
  if (r.status === 400 || r.status === 404 || r.status === 410) return { ok: false, reason: 'invalid' };
  if (!r.ok) throw new Error(`Play purchase check failed: ${r.status}`);
  const p = await r.json();
  if (p.purchaseState === 2) return { ok: false, reason: 'pending' };
  if (p.purchaseState !== 0) return { ok: false, reason: 'cancelled' };
  // Consumed already: either we credited it (economy.js finds the order) or it was
  // consumed elsewhere. The caller credits only orders it hasn't seen.
  return { ok: true, orderId: p.orderId, consumed: p.consumptionState === 1 };
}

export async function consumePlayPurchase(env, { productId, purchaseToken }, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${tokenUrl(env, productId, purchaseToken)}:consume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(env, fetchImpl)}` },
  });
  if (!r.ok && r.status !== 400) throw new Error(`Play consume failed: ${r.status}`);   // 400: already consumed
}

export function _resetPlayToken() { cached = null; cachedUntil = 0; }
