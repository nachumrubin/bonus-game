// Room-code service — manages PENDING shareable game codes.
//
// Symmetry note (vs inviteService): inviteService is for friend-targeted
// invites (the inviter knows the invitee's uid). roomCodeService is for the
// "share-a-code" path where the inviter doesn't know who'll join — anyone
// with the code can claim it.
//
// Architecture choice: we DO NOT pre-create the real /rooms/{roomId} when
// the host clicks "create." A room exists only once both players are known.
// Until then, the host's intent lives at /pendingRooms/{code} and contains
// the host's profile + chosen mode + settings. When a guest claims the
// code, we run a single transaction that:
//   1. reads & deletes the pending entry (atomic — first claimer wins)
//   2. creates the real room with both players (slot 0 = host, slot 1 = guest)
//   3. flips status straight to PLAYING and stores the randomized starting
//      slot so both clients see the same coin-toss result
//
// This eliminates the legacy orphan-room class of bugs where a host created
// a room, never had a guest join, and the room sat in /rooms forever.
//
// Codes are 6-digit numeric strings (matches the legacy `genRoomCode()`
// surface so existing share links keep working — except now they go through
// /pendingRooms instead of /rooms).

import { PATH, STATUS } from './schema.js';
import * as roomService from './roomService.js';
import { createInitialState } from '../core/gameEngine.js';

const PENDING_PATH = 'pendingRooms';
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CODE_LENGTH = 6;
const MAX_GENERATE_ATTEMPTS = 8;

function randomStartingSlot() {
  return Math.random() < 0.5 ? 0 : 1;
}

function pendingRef(db, code) {
  return db.ref(`${PENDING_PATH}/${code}`);
}

function genCode() {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// Create a pending shareable room. Returns the chosen code.
//
// Retries up to a few times if the random code collides — extremely
// unlikely with a 1-in-a-million space, but we loop anyway because it's
// cheap and a collision would be confusing for the user.
export async function createPending(db, {
  hostUid, hostProfile, mode, settings = {},
  serverTimestamp = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  if (!hostUid) throw new Error('createPending: hostUid required');
  if (!mode)    throw new Error('createPending: mode required');

  const expiresAt = serverTimestamp + ttlMs;

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    const code = genCode();
    const ref = pendingRef(db, code);
    // Use a transaction so we don't clobber an existing pending entry.
    const result = await ref.transaction((current) => {
      if (current) return; // collision — retry
      return {
        code,
        hostUid,
        hostProfile: hostProfile ?? null,
        mode,
        settings,
        createdAt: serverTimestamp,
        expiresAt,
      };
    });
    if (!result?.committed) continue; // collision (or abort) — retry with a new code

    // Verify the write actually landed on the server. Firebase RTDB
    // transactions apply OPTIMISTICALLY to the local cache and resolve the
    // await before the server's security-rule check completes; if the
    // server later rejects the write, the SDK logs a warning and silently
    // reverts the local cache, but our await has already returned
    // committed:true. Without this read-back, the host would proceed to
    // set up the waiting room with a code that doesn't exist on the
    // server, and the subsequent cancelPending / claim flows would fail
    // with permission_denied because data.exists() is false.
    const verify = await ref.get();
    if (verify?.val ? verify.val() : null) return { code, expiresAt };
    // Server rejected the write. Surface clearly instead of looping.
    throw new Error(
      `createPending: write to /pendingRooms/${code} was rejected server-side ` +
      `(check Firebase rules + that auth.uid matches hostUid)`,
    );
  }
  throw new Error('createPending: exhausted code-generation attempts');
}

export async function readPending(db, code) {
  const snap = await pendingRef(db, code).get();
  return snap?.val ? snap.val() : null;
}

export function watchPending(db, code, cb) {
  const ref = pendingRef(db, code);
  const handler = (snap) => {
    const v = snap?.val ? snap.val() : null;
    cb(v);
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// Cancel a pending code. Idempotent — safe to call after the entry is gone.
export async function cancelPending(db, code) {
  await pendingRef(db, code).remove();
}

// Sweep expired pending entries. Called opportunistically on app open.
// Returns the number of entries removed.
export async function sweepExpired(db, now) {
  const snap = await db.ref(PENDING_PATH).get();
  const all = snap?.val ? snap.val() : null;
  if (!all) return 0;
  const removals = [];
  for (const [code, entry] of Object.entries(all)) {
    if (entry?.expiresAt && entry.expiresAt < now) {
      removals.push(pendingRef(db, code).remove());
    }
  }
  await Promise.all(removals);
  return removals.length;
}

// Atomically claim a pending code. The first caller wins; concurrent
// claimers see `{ ok: false, reason: 'already-claimed' }`.
//
// On success, also creates the real /rooms/{roomId} via roomService.createRoom
// with both players filled and status=PLAYING.
//
// `now` and `roomIdFn` are injectable for tests.
export async function claimByCode(db, {
  code, guestUid, guestProfile, now = Date.now(),
  roomIdFn = (ts) => `fc_${ts}_${Math.random().toString(36).slice(2, 8)}`,
  startingSlot = randomStartingSlot(),
}) {
  if (!code)      return { ok: false, reason: 'missing-code' };
  if (!guestUid)  return { ok: false, reason: 'missing-guest' };

  const ref = pendingRef(db, code);

  // Read first so we can build the room with both players. Concurrent
  // claims race here — second writer's transaction will see no current
  // value and abort.
  const snap = await ref.get();
  const entry = snap?.val ? snap.val() : null;
  if (!entry) return { ok: false, reason: 'not-found' };
  if (entry.expiresAt && entry.expiresAt < now) {
    await ref.remove();
    return { ok: false, reason: 'expired' };
  }
  if (entry.hostUid === guestUid) {
    return { ok: false, reason: 'self-claim' };
  }

  // Atomic delete — only one claimer wins. We use ref.remove() (not a
  // transaction) because Firebase RTDB transactions abort with
  // `committed: false` whenever the client cache is cold and the update
  // function returns undefined on the first (null-valued) call. That cold-
  // cache abort was producing false "already-claimed" errors right after
  // anonymous sign-in, when the SDK hasn't yet synced the pendingRooms
  // path.
  //
  // The atomicity guarantee comes from the security rule instead: it only
  // permits a delete when `data.exists()` server-side. The server processes
  // concurrent removes serially, so the first to land deletes the entry
  // and the rest fail with permission-denied — exactly the semantics we
  // want.
  try {
    await ref.remove();
  } catch (e) {
    return { ok: false, reason: 'already-claimed' };
  }

  // Create the real room.
  const roomId = roomIdFn(now);
  const players = {
    0: {
      uid: entry.hostUid,
      displayName: entry.hostProfile?.displayName ?? 'שחקן 1',
      avatar:      entry.hostProfile?.avatar ?? null,
      joinedAt:    entry.createdAt,
    },
    1: {
      uid: guestUid,
      displayName: guestProfile?.displayName ?? 'שחקן 2',
      avatar:      guestProfile?.avatar ?? null,
      joinedAt:    now,
    },
  };
  const engineState = createInitialState({
    mode: entry.mode,
    tileBagSeed: roomId,
    players,
    startingSlot,
    settings: entry.settings ?? {},
  });
  await roomService.createRoom(db, {
    roomId,
    mode: entry.mode,
    players,
    settings: entry.settings ?? {},
    engineState,
    serverTimestamp: now,
  });
  // Async games can start immediately. Live games stay WAITING until both
  // clients click through the coin screen; that ready handshake starts the
  // shared turn timer.
  if (entry.mode?.endsWith('-async')) {
    await db.ref(`${PATH.rooms}/${roomId}`).update({ status: STATUS.PLAYING });
  }

  return { ok: true, roomId };
}
