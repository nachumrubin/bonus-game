// Invite service.
//
// New rule (replaces the legacy invite/room overloading): an invite has NO
// room until it is accepted. The room is created inside the accept handler,
// atomically with consuming the invite. This eliminates the orphan-room
// class of bug where a friend invite created a room that was never cleaned
// up after a rejection.
//
// Lifecycle:  pending → accepted (room created)
//                     ↘ rejected
//                     ↘ expired
//                     ↘ cancelled

import { PATH, INVITE_STATUS, STATUS } from './schema.js';
import * as roomService from './roomService.js';
import { createInitialState } from '../core/gameEngine.js';

const DEFAULT_TTL_MS = {
  live:  5 * 60 * 1000,           // 5 minutes
  async: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function inviteRef(db, toUid, inviteId) {
  return db.ref(`${PATH.invites}/${toUid}/${inviteId}`);
}

function ackRef(db, fromUid, toUid) {
  return db.ref(`${PATH.inviteAcks}/${fromUid}/${toUid}`);
}

function newInviteId(serverTimestamp) {
  return `inv_${serverTimestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function randomStartingSlot() {
  return Math.random() < 0.5 ? 0 : 1;
}

export async function sendInvite(db, { fromUid, fromName, fromAvatar, toUid, mode, settings, serverTimestamp }) {
  const inviteId = newInviteId(serverTimestamp);
  const isLive = mode?.endsWith('-live');
  const ttl = isLive ? DEFAULT_TTL_MS.live : DEFAULT_TTL_MS.async;
  const expiresAt = (typeof serverTimestamp === 'number' ? serverTimestamp : Date.now()) + ttl;

  await inviteRef(db, toUid, inviteId).set({
    inviteId,
    fromUid, fromName, fromAvatar,
    toUid, mode, settings,
    status: INVITE_STATUS.PENDING,
    createdAt: serverTimestamp,
    expiresAt,
  });
  return { inviteId, expiresAt };
}

export async function acceptInvite(db, {
  toUid,
  inviteId,
  accepterProfile,
  now = Date.now(),
  roomIdFn = (ts) => `fi_${ts}_${Math.random().toString(36).slice(2, 8)}`,
  startingSlot = randomStartingSlot(),
} = {}) {
  const snap = await inviteRef(db, toUid, inviteId).get();
  const invite = snap?.val ? snap.val() : null;
  if (!invite) return { ok: false, reason: 'invite-not-found' };
  if (invite.status !== INVITE_STATUS.PENDING) return { ok: false, reason: 'invite-already-consumed' };
  if (invite.expiresAt && invite.expiresAt < now) {
    await inviteRef(db, toUid, inviteId).remove();
    return { ok: false, reason: 'invite-expired' };
  }
  if (invite.fromUid === toUid) return { ok: false, reason: 'self-accept' };

  // Read + delete in a transaction so duplicate-accepts can't both succeed.
  const ref = inviteRef(db, toUid, inviteId);
  const txn = await ref.transaction((current) => {
    if (!current) return; // already consumed
    if (current.status !== INVITE_STATUS.PENDING) return;
    return null; // delete on accept
  });
  if (!txn?.committed) return { ok: false, reason: 'invite-already-consumed' };

  const roomId = roomIdFn(now);
  const players = {
    0: {
      uid: invite.fromUid,
      displayName: invite.fromName ?? 'שחקן 1',
      avatar: invite.fromAvatar ?? null,
      joinedAt: invite.createdAt ?? now,
    },
    1: {
      uid: toUid,
      displayName: accepterProfile?.displayName ?? 'שחקן 2',
      avatar: accepterProfile?.avatar ?? null,
      joinedAt: now,
    },
  };
  const settings = invite.settings ?? {};
  const engineState = createInitialState({
    mode: invite.mode,
    tileBagSeed: roomId,
    players,
    startingSlot,
    settings,
  });
  // Past the invite-claim transaction, the invite is GONE. Any failure
  // creating the room (network blip, RTDB rules rejection, etc.) leaves
  // the sender's listener with no signal — they'd wait forever for an ack
  // that never arrives. Recover by writing a failure ack so the sender's
  // UI sees the rejection and can re-invite. (GAP_REPORT item 8.)
  try {
    await roomService.createRoom(db, {
      roomId,
      mode: invite.mode,
      players,
      settings,
      engineState,
      serverTimestamp: now,
    });
    // Async games can start immediately. Live invite games stay WAITING until
    // both clients click through the coin screen; that ready handshake starts
    // the shared turn timer.
    if (invite.mode?.endsWith('-async')) {
      await db.ref(`${PATH.rooms}/${roomId}`).update({ status: STATUS.PLAYING });
    }
  } catch (e) {
    try {
      await ackRef(db, invite.fromUid, toUid).set({
        inviteId,
        accepted: false,
        reason: 'room-create-failed',
        fromName: accepterProfile?.displayName ?? players[1].displayName,
        timestamp: now,
      });
    } catch (ackErr) {
      console.warn('[inviteService.acceptInvite] failed to write failure ack', ackErr);
    }
    return { ok: false, reason: 'room-create-failed', error: String(e?.message ?? e) };
  }
  await ackRef(db, invite.fromUid, toUid).set({
    inviteId,
    accepted: true,
    roomId,
    fromName: accepterProfile?.displayName ?? players[1].displayName,
    timestamp: now,
  });

  return { ok: true, roomId, invite };
}

// Read an invite without modifying it. Useful when the UI wants to show
// invite metadata before deciding to accept.
export async function readInvite(db, { toUid, inviteId }) {
  const snap = await inviteRef(db, toUid, inviteId).get();
  return snap?.val ? snap.val() : null;
}

export async function rejectInvite(db, { fromUid, toUid, inviteId, fromName, serverTimestamp }) {
  // Write rejection ack so sender's listener fires, then delete the invite.
  await ackRef(db, fromUid, toUid).set({
    inviteId,
    accepted: false,
    fromName,
    timestamp: serverTimestamp,
  });
  await inviteRef(db, toUid, inviteId).remove();
  return { ok: true };
}

export async function cancelInvite(db, { toUid, inviteId }) {
  await inviteRef(db, toUid, inviteId).remove();
  return { ok: true };
}

// Check whether a potential recipient can receive a live-game invite.
// Returns { available: true } or { available: false, reason: 'in-live-game' }.
// For async-mode invites this always returns available:true — async invites
// are deliverable regardless of game state.
export async function checkRecipientAvailability(db, toUid, mode) {
  if (!mode?.endsWith('-live')) return { available: true };
  try {
    const activeRoomSnap = await db.ref(`${PATH.users}/${toUid}/activeRoom`).get();
    const activeRoomId = activeRoomSnap?.val ? activeRoomSnap.val() : null;
    if (!activeRoomId) return { available: true };
    const modeSnap = await db.ref(`${PATH.rooms}/${activeRoomId}/mode`).get();
    const activeMode = modeSnap?.val ? modeSnap.val() : null;
    if (activeMode?.endsWith('-live')) return { available: false, reason: 'in-live-game' };
    return { available: true };
  } catch {
    return { available: true }; // non-fatal: allow the invite if the check fails
  }
}

// Subscribe to all incoming invites for `uid`. The cb is fired with each new
// invite that arrives; returns an unsubscribe function.
export function listenForInvites(db, uid, cb) {
  const r = db.ref(`${PATH.invites}/${uid}`);
  const handler = (snap) => {
    const raw = snap?.val ? snap.val() : null;
    if (!raw) { cb([]); return; }
    cb(Object.values(raw));
  };
  r.on('value', handler);
  return () => r.off('value', handler);
}

// Subscribe to invite acks for `senderUid`. Used by the inviter to learn that
// their invite was accepted/rejected.
export function listenForInviteAcks(db, senderUid, cb) {
  const r = db.ref(`${PATH.inviteAcks}/${senderUid}`);
  const handler = (snap) => {
    const raw = snap?.val ? snap.val() : null;
    if (!raw) { cb([]); return; }
    cb(Object.entries(raw).map(([toUid, ack]) => ({ toUid, ...ack })));
  };
  r.on('value', handler);
  return () => r.off('value', handler);
}

// Sweep expired invites for a user. Called opportunistically on app open.
// Returns the number of invites removed.
export async function sweepExpired(db, uid, now) {
  const snap = await db.ref(`${PATH.invites}/${uid}`).get();
  const all = snap?.val ? snap.val() : null;
  if (!all) return 0;
  const removals = [];
  for (const [id, inv] of Object.entries(all)) {
    if (inv.expiresAt && inv.expiresAt < now) {
      removals.push(inviteRef(db, uid, id).remove());
    }
  }
  await Promise.all(removals);
  return removals.length;
}
