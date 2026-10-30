// Account deletion (Google Play's account-deletion requirement; privacy policy
// "מחיקת חשבון"). The profile screen's "מחיקת חשבון" button posts here:
//
//   POST /account/delete   (Bearer Firebase ID token)  → { ok: true } | { ok: false, reason }
//
// The worker, with the service account (rules don't bind it), then:
//   1. removes everything that is the player's own: users/<uid> (profile, coins, owned
//      items, game index), globalRatings, presence, invites, inviteAcks, notifications,
//      the coin ledger, the matchmaking ticket, their name and short-id claims
//      (usernames/, userIds/ — only while they still point at this uid);
//   2. removes them from other players' data: friend edges (friends/<f>/<uid>) and the
//      friend requests they sent (friendRequests/<x>/<uid>);
//   3. renames them in finished and running rooms to DELETED_NAME, so the opponent's
//      game history stays readable without the deleted player's name;
//   4. deletes the OneSignal user (best effort) and, last, the Firebase Auth user.
// All database changes go in one multi-path update. Every step is idempotent, so a
// retry after a failure (the Auth user is deleted last) finishes the job.
// coinOrders/ is kept: it records which account a Play order paid, for refunds.

import { verifyFirebaseToken } from './verifyFirebaseToken.js';
import { rtdbGet, rtdbPatch, rtdbQueryEqual, signJwt } from './firebaseRtdb.js';

export const DELETED_NAME = 'שחקן שנמחק';

// Nodes keyed by the player's uid that go entirely.
const OWN_ROOTS = ['users', 'globalRatings', 'presence', 'invites', 'inviteAcks', 'userNotifications', 'coinLedger', 'friends', 'friendRequests'];

const keysOf = (v) => (v && typeof v === 'object' ? Object.keys(v) : []);

// → the multi-path update (path → null | value) that removes the player. Pure apart
// from the reads through `db`.
export async function buildDeletionUpdate(env, uid, db) {
  const updates = {};
  for (const root of OWN_ROOTS) updates[`${root}/${uid}`] = null;

  const profile = await db.get(env, `users/${uid}/profile`);
  const name = typeof profile?.displayName === 'string' ? profile.displayName.toLowerCase() : '';
  if (name && !/[.#$[\]/]/.test(name) && (await db.get(env, `usernames/${name}`)) === uid) {
    updates[`usernames/${name}`] = null;
  }
  const shortId = profile?.userId != null ? String(profile.userId) : '';
  if (/^[A-Za-z0-9_-]{1,32}$/.test(shortId) && (await db.get(env, `userIds/${shortId}`)) === uid) {
    updates[`userIds/${shortId}`] = null;
  }

  for (const f of keysOf(await db.get(env, `friends/${uid}`, { shallow: true }))) {
    if (f !== uid) updates[`friends/${f}/${uid}`] = null;
  }
  for (const r of keysOf(await db.get(env, 'friendRequests', { shallow: true }))) {
    if (r !== uid) updates[`friendRequests/${r}/${uid}`] = null;
  }
  for (const m of keysOf(await db.get(env, 'matchmakingQueue', { shallow: true }))) updates[`matchmakingQueue/${m}/${uid}`] = null;

  for (const slot of [0, 1]) {
    const rooms = await db.query(env, 'rooms', `players/${slot}/uid`, uid);
    for (const [roomId, room] of Object.entries(rooms ?? {})) {
      if (room?.players?.[slot]?.uid === uid) updates[`rooms/${roomId}/players/${slot}/displayName`] = DELETED_NAME;
    }
  }
  return updates;
}

// ─── Firebase Auth (Identity Toolkit) ────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
let authToken = null;
let authTokenUntil = 0;

async function authAccessToken(env, fetchImpl) {
  if (authToken && Date.now() < authTokenUntil - 60_000) return authToken;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON secret not set');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(sa, AUTH_SCOPE) }),
  });
  if (!r.ok) throw new Error(`Auth token exchange failed: ${r.status}`);
  const data = await r.json();
  authToken = data.access_token;
  authTokenUntil = Date.now() + (data.expires_in ?? 3600) * 1000;
  return authToken;
}

// Deletes the Firebase Auth user. An already-deleted user counts as done.
export async function deleteAuthUser(env, uid, { fetchImpl = fetch } = {}) {
  const token = await authAccessToken(env, fetchImpl);
  const r = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  if (r.ok) return;
  const text = await r.text().catch(() => '');
  if (text.includes('USER_NOT_FOUND')) return;
  throw new Error(`Auth delete failed: ${r.status} ${text.slice(0, 200)}`);
}

// The device subscriptions logged in as this uid (OneSignal external id). Best effort.
export async function deletePushUser(env, uid, { fetchImpl = fetch } = {}) {
  if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_REST_KEY) return;
  const r = await fetchImpl(`https://api.onesignal.com/apps/${encodeURIComponent(env.ONESIGNAL_APP_ID)}/users/by/external_id/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: { Authorization: 'Basic ' + env.ONESIGNAL_REST_KEY },
  });
  if (!r.ok && r.status !== 404) throw new Error(`OneSignal delete failed: ${r.status}`);
}

const defaultDb = { get: rtdbGet, query: rtdbQueryEqual, patch: rtdbPatch };

export async function deleteAccount(env, uid, { db = defaultDb, auth = deleteAuthUser, push = deletePushUser } = {}) {
  const updates = await buildDeletionUpdate(env, uid, db);
  await db.patch(env, '', updates);
  try { await push(env, uid); } catch (e) { console.warn('[account] push user delete', e?.message ?? e); }
  await auth(env, uid);
  return { ok: true };
}

function json(status, payload, headers) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export async function handleAccountDelete(request, env, cors, deps = {}) {
  const verify = deps.verify ?? verifyFirebaseToken;
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { ok: false, reason: 'missing-bearer' }, cors);
  let claims;
  try { claims = await verify(auth.slice(7), env.FIREBASE_PROJECT_ID); }
  catch { return json(401, { ok: false, reason: 'invalid-token' }, cors); }
  const uid = claims?.sub;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return json(400, { ok: false, reason: 'bad-uid' }, cors);
  try {
    return json(200, await deleteAccount(env, uid, deps), cors);
  } catch (e) {
    console.error('[account] delete', uid, e?.message ?? e);
    return json(500, { ok: false, reason: 'server-error' }, cors);
  }
}

export function _resetAuthToken() { authToken = null; authTokenUntil = 0; }
