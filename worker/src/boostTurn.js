// Boost 2.0 authoritative turn endpoints. Online Boost 2.0 matches are run
// here, not on the players' devices: the hidden challenge queue, the bag and
// both racks live in boostV2Secret/{roomId}, which no client can read, and
// every move is validated and scored by the app's own pure engine (bundled
// in by wrangler from src/game/boostV2/authoritativeTurn.js — the app and
// the Worker cannot drift).
//
//   POST /boost/create  {reqId, roomId, mode, players, settings?, startingSlot?}
//   POST /boost/turn    {reqId, roomId, command: {type, payload?, expectedVersion?}}
//   POST /boost/plan    {roomId, draft: {placed, swappedTiles?}}   (read-only preview)
//
// Each turn: verify the Firebase ID token → read the secret with its ETag →
// applyCommand → write it back only if unchanged (retry on conflict, like
// economy.js) → publish the public projection (rooms/{roomId}) and the
// per-player racks (boostV2Racks/{roomId}/{slot}). A retried reqId gets the
// first answer and writes nothing.

import { createMatch, applyCommand, planDraft, projectionsFromSecret } from '../../src/game/boostV2/authoritativeTurn.js';
import { createWordValidator, approvedFromSnapshot, blockedFromSnapshot } from '../../src/game/boostV2/sortedDictionary.js';
import { isRequestId } from '../../src/game/account/economy.js';
import { verifyFirebaseToken } from './verifyFirebaseToken.js';
import { rtdbGet, rtdbGetWithEtag, rtdbPutIfMatch, rtdbPut, rtdbPatch } from './firebaseRtdb.js';

export const BOOST_PATHS = ['/boost/create', '/boost/turn', '/boost/plan'];
export const MAX_CAS_ATTEMPTS = 6;
const DICT_TTL_MS = 60 * 60 * 1000;
const OVERLAY_TTL_MS = 5 * 60 * 1000;
const MODES = new Set(['friend-live', 'friend-async', 'random-live', 'random-async']);
const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_SETTINGS_BYTES = 2048;

const defaultDb = { get: rtdbGet, getWithEtag: rtdbGetWithEtag, putIfMatch: rtdbPutIfMatch, put: rtdbPut, patch: rtdbPatch };

// Server-side randomness for the bag seed and the deck shuffle.
export function cryptoRng() {
  const buf = new Uint32Array(1);
  return () => { crypto.getRandomValues(buf); return buf[0] / 4294967296; };
}

// ── dictionary (cached per isolate) ─────────────────────────────────────────
let dictCache = { text: null, at: -Infinity };
let overlayCache = { blocked: new Set(), approved: new Set(), at: -Infinity };
export function _resetCaches() {
  dictCache = { text: null, at: -Infinity };
  overlayCache = { blocked: new Set(), approved: new Set(), at: -Infinity };
}

export async function loadValidator(env, { fetchImpl = fetch, db = defaultDb, now = Date.now } = {}) {
  const t = now();
  if (!dictCache.text || t - dictCache.at > DICT_TTL_MS) {
    if (!env.DICTIONARY_URL) throw new Error('DICTIONARY_URL not set');
    const r = await fetchImpl(env.DICTIONARY_URL, { cf: { cacheTtl: 3600 } });
    if (!r.ok) {
      if (!dictCache.text) throw new Error(`dictionary fetch failed: ${r.status}`);
    } else {
      dictCache = { text: await r.text(), at: t };
    }
  }
  if (t - overlayCache.at > OVERLAY_TTL_MS) {
    try {
      const [rej, app] = await Promise.all([db.get(env, 'dictionaryRejected'), db.get(env, 'dictionaryApproved')]);
      overlayCache = { blocked: blockedFromSnapshot(rej), approved: approvedFromSnapshot(app), at: t };
    } catch (e) {
      // Keep the previous overlays; a stale overlay is better than no turn.
      console.warn('[boost] overlay refresh failed', e?.message ?? e);
    }
  }
  return createWordValidator({ text: dictCache.text, blocked: overlayCache.blocked, approved: overlayCache.approved });
}

// ── publish ─────────────────────────────────────────────────────────────────
// `players` is written once at creation and never re-patched: clients add
// players/{slot}/oneSignalSubId (push routing) after that.
const withoutPlayers = ({ players, ...rest }) => rest;

async function publish(env, roomId, { room, racks, version }, db, now) {
  await db.patch(env, `rooms/${roomId}`, withoutPlayers(room));
  await db.put(env, `boostV2Racks/${roomId}`, racks);
  if (room.status !== 'playing' && String(room.mode).endsWith('-async')) {
    await Promise.all([0, 1].map(s => room.players?.[s]?.uid
      && db.put(env, `users/${room.players[s].uid}/asyncRooms/${roomId}`, null)));
  }
  // Two commits can finish their projection writes out of order. If the secret
  // has moved on, publish the latest instead (converges after the last commit).
  const latest = await db.get(env, `boostV2Secret/${roomId}/version`);
  if (Number(latest) > version) {
    const { value: secret } = await db.getWithEtag(env, `boostV2Secret/${roomId}`);
    if (secret) {
      const p = projectionsFromSecret(secret, now());
      await db.patch(env, `rooms/${roomId}`, withoutPlayers(p.room));
      await db.put(env, `boostV2Racks/${roomId}`, p.racks);
    }
  }
}

function cleanPlayers(players) {
  const out = {};
  for (const s of [0, 1]) {
    const p = players?.[s];
    if (!p || typeof p.uid !== 'string' || !p.uid || p.uid.length > 128) return null;
    out[s] = { uid: p.uid, displayName: String(p.displayName ?? '').slice(0, 40) };
    if (typeof p.avatar === 'string') out[s].avatar = p.avatar.slice(0, 64);
  }
  return out;
}

// ── /boost/create ───────────────────────────────────────────────────────────
export async function createBoostMatch(env, uid, body, { db = defaultDb, now = Date.now, rng = cryptoRng() } = {}) {
  const roomId = String(body.roomId ?? '');
  if (!ROOM_ID_RE.test(roomId)) return { ok: false, reason: 'bad-room-id' };
  if (!MODES.has(body.mode)) return { ok: false, reason: 'bad-mode' };
  const players = cleanPlayers(body.players);
  if (!players || players[0].uid === players[1].uid) return { ok: false, reason: 'bad-players' };
  if (players[0].uid !== uid && players[1].uid !== uid) return { ok: false, reason: 'not-a-player' };
  const settings = body.settings && typeof body.settings === 'object' ? body.settings : {};
  if (JSON.stringify(settings).length > MAX_SETTINGS_BYTES) return { ok: false, reason: 'bad-settings' };

  const secretPath = `boostV2Secret/${roomId}`;
  const { value: existing, etag } = await db.getWithEtag(env, secretPath);
  if (existing) {
    const mine = existing.players?.[0]?.uid === uid || existing.players?.[1]?.uid === uid;
    return mine ? { ok: true, existing: true, version: existing.version } : { ok: false, reason: 'room-exists' };
  }
  const legacy = await db.get(env, `rooms/${roomId}`);
  if (legacy) return { ok: false, reason: 'room-exists' };

  const t = now();
  const created = createMatch({
    roomId, mode: body.mode, players, settings, startingSlot: body.startingSlot === 1 ? 1 : 0, now: t, rng,
    leadInMs: Math.max(0, Math.min(10_000, Number(body.leadInMs) || 0)),
  });
  const claim = await db.putIfMatch(env, secretPath, created.secret, etag);
  if (!claim.ok) return { ok: false, reason: 'busy' };
  await db.put(env, `rooms/${roomId}`, created.room);
  await db.put(env, `boostV2Racks/${roomId}`, created.racks);
  if (body.mode.endsWith('-async')) {
    const meta = { mode: body.mode, createdAt: t };
    await Promise.all([0, 1].map(s => db.put(env, `users/${players[s].uid}/asyncRooms/${roomId}`, meta)));
  }
  return { ok: true, version: 1, roomId };
}

// ── /boost/turn ─────────────────────────────────────────────────────────────
export async function runBoostTurn(env, uid, body, { db = defaultDb, now = Date.now, rng = cryptoRng(), validator } = {}) {
  const roomId = String(body.roomId ?? '');
  if (!ROOM_ID_RE.test(roomId)) return { ok: false, reason: 'bad-room-id' };
  const isWordValid = validator ?? await loadValidator(env, { db, now });
  const path = `boostV2Secret/${roomId}`;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { value: secret, etag } = await db.getWithEtag(env, path);
    if (!secret) return { ok: false, reason: 'no-match' };
    const t = now();
    const r = applyCommand({ secret, uid, reqId: body.reqId, command: body.command, now: t, isWordValid, rng });
    if (!r.secret) {
      const { secret: _s, room: _r, racks: _k, ...answer } = r;
      return answer;
    }
    const write = await db.putIfMatch(env, path, r.secret, etag);
    if (!write.ok) continue;   // another command landed first: re-run on the new state
    await publish(env, roomId, r, db, now);
    return { ok: true, result: r.result, version: r.version };
  }
  return { ok: false, reason: 'busy' };
}

// ── /boost/plan ─────────────────────────────────────────────────────────────
export async function runBoostPlan(env, uid, body, { db = defaultDb, now = Date.now, rng = cryptoRng(), validator } = {}) {
  const roomId = String(body.roomId ?? '');
  if (!ROOM_ID_RE.test(roomId)) return { ok: false, reason: 'bad-room-id' };
  const isWordValid = validator ?? await loadValidator(env, { db, now });
  const { value: secret } = await db.getWithEtag(env, `boostV2Secret/${roomId}`);
  if (!secret) return { ok: false, reason: 'no-match' };
  return planDraft({ secret, uid, draft: body.draft ?? {}, isWordValid, rng });
}

function json(status, payload, cors) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}

export async function handleBoost(request, env, cors, deps = {}) {
  const verify = deps.verify ?? verifyFirebaseToken;
  const path = new URL(request.url).pathname;
  if (!BOOST_PATHS.includes(path)) return json(404, { ok: false, reason: 'unknown-action' }, cors);
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { ok: false, reason: 'missing-bearer' }, cors);
  let claims;
  try { claims = await verify(auth.slice(7), env.FIREBASE_PROJECT_ID); }
  catch { return json(401, { ok: false, reason: 'invalid-token' }, cors); }
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, reason: 'bad-json' }, cors); }
  if (!body || typeof body !== 'object') return json(400, { ok: false, reason: 'bad-body' }, cors);
  if (path !== '/boost/plan' && !isRequestId(body.reqId)) return json(400, { ok: false, reason: 'bad-request-id' }, cors);
  try {
    const result = path === '/boost/create' ? await createBoostMatch(env, claims.sub, body, deps)
      : path === '/boost/turn' ? await runBoostTurn(env, claims.sub, body, deps)
        : await runBoostPlan(env, claims.sub, body, deps);
    // Game-rule rejections are 200 {ok:false}; only 'busy' asks the client to retry.
    return json(result.reason === 'busy' ? 503 : 200, result, cors);
  } catch (e) {
    console.error('[boost]', path, e?.message ?? e);
    return json(500, { ok: false, reason: 'server-error' }, cors);
  }
}
