// roomStrategies.mjs — how two simulated players meet, using the REAL
// services the app calls (no hand-built room docs):
//
//   invite  inviteService.sendInvite → guest listenForInvites → acceptInvite
//           → host listenForInviteAcks
//   code    roomCodeService.createPending → guest claimByCode → host learns
//           the room from /users/{uid}/activeRoom (createRoom writes both)
//
// Matchmaking is pool-based (pairing is emergent) and lives in the soak
// runner. Each strategy resolves to { roomId } once BOTH sides know it.

import * as inviteService from '../../../src/game/online/inviteService.js';
import * as roomCodeService from '../../../src/game/online/roomCodeService.js';
import { serverNow } from '../../../src/game/online/serverClock.js';

const STRATEGY_TIMEOUT_MS = 30_000;

function withTimeout(promise, ms, label) {
  let h;
  return Promise.race([
    promise.finally(() => clearTimeout(h)),
    new Promise((_, rej) => { h = setTimeout(() => rej(new Error(`${label}: timed out after ${ms}ms`)), ms); }),
  ]);
}

function waitForActiveRoom(db, uid, { notRoomId = null } = {}) {
  return new Promise((resolve) => {
    const ref = db.ref(`users/${uid}/activeRoom`);
    const handler = (snap) => {
      const v = snap?.val ? snap.val() : null;
      if (v && v !== notRoomId) {
        ref.off('value', handler);
        resolve(v);
      }
    };
    ref.on('value', handler);
  });
}

/**
 * @param {{ host: {db,uid,profile}, guest: {db,uid,profile}, mode: string, settings: object, roomIdFn?: Function }} p
 */
export async function viaInvite({ host, guest, mode, settings, roomIdFn }) {
  return withTimeout((async () => {
    // Host waits on the ack, guest waits on the invite.
    let offAck = null;
    const ackP = new Promise((resolve, reject) => {
      offAck = inviteService.listenForInviteAcks(host.db, host.uid, (acks) => {
        const ack = acks.find(a => a.toUid === guest.uid);
        if (!ack) return;
        if (ack.accepted && ack.roomId) resolve(ack.roomId);
        else reject(new Error(`invite rejected: ${ack.reason ?? 'unknown'}`));
      });
    });
    let offInv = null;
    const inviteP = new Promise((resolve) => {
      offInv = inviteService.listenForInvites(guest.db, guest.uid, (invites) => {
        const inv = invites.find(i => i.fromUid === host.uid && i.status === 'pending');
        if (inv) resolve(inv);
      });
    });
    await inviteService.sendInvite(host.db, {
      fromUid: host.uid, fromName: host.profile.displayName, fromAvatar: host.profile.avatar ?? null,
      toUid: guest.uid, mode, settings, serverTimestamp: serverNow(),
    });
    const inv = await inviteP;
    // A human reads the invite before tapping accept.
    await sleep(500 + Math.random() * 2500);
    // Keep the invites listener attached through the accept, like the app
    // (main.js bootInviteListenersFor keeps it for the whole signed-in
    // session). acceptInvite's transaction aborts on a cold cache — with the
    // listener detached it reports a false 'invite-already-consumed'.
    const res = await inviteService.acceptInvite(guest.db, {
      toUid: guest.uid, inviteId: inv.inviteId, accepterProfile: guest.profile, now: serverNow(),
      ...(roomIdFn ? { roomIdFn } : {}),
    });
    offInv?.();
    if (!res.ok) throw new Error(`acceptInvite failed: ${res.reason}${res.error ? ` (${res.error})` : ''}`);
    const hostRoomId = await ackP;
    offAck?.();
    if (hostRoomId !== res.roomId) throw new Error(`invite ack roomId mismatch host=${hostRoomId} guest=${res.roomId}`);
    // Clear the ack like the app does after consuming it.
    await host.db.ref(`inviteAcks/${host.uid}/${guest.uid}`).remove().catch(() => {});
    return { roomId: res.roomId };
  })(), STRATEGY_TIMEOUT_MS, 'invite');
}

export async function viaCode({ host, guest, mode, settings, roomIdFn }) {
  return withTimeout((async () => {
    const prevHostRoom = (await host.db.ref(`users/${host.uid}/activeRoom`).get()).val?.() ?? null;
    const { code } = await roomCodeService.createPending(host.db, {
      hostUid: host.uid, hostProfile: host.profile, mode, settings, serverTimestamp: serverNow(),
    });
    const hostLearns = waitForActiveRoom(host.db, host.uid, { notRoomId: prevHostRoom });
    // The code travels over WhatsApp; the guest types it in.
    await sleep(1000 + Math.random() * 4000);
    const res = await roomCodeService.claimByCode(guest.db, {
      code, guestUid: guest.uid, guestProfile: guest.profile, now: serverNow(),
      ...(roomIdFn ? { roomIdFn } : {}),
    });
    if (!res.ok) throw new Error(`claimByCode failed: ${res.reason}`);
    const hostRoomId = await hostLearns;
    if (hostRoomId !== res.roomId) throw new Error(`code roomId mismatch host=${hostRoomId} guest=${res.roomId}`);
    return { roomId: res.roomId, code };
  })(), STRATEGY_TIMEOUT_MS, 'code');
}

export const STRATEGIES = Object.freeze({ invite: viaInvite, code: viaCode });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
