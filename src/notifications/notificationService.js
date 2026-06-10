// Notification service.
//
// Replaces the legacy split where push triggers existed in BOTH
// pushMoveToFirebase() (line 10775) and listenForMoves() (line 10570). The
// new design subscribes ONCE to bus events and fires exactly one push per
// event — same event, same dispatcher.
//
// OneSignal init also collapses from two paths (index.html:8409 & 8876)
// into a single boot() call.
//
// The actual HTTP send is injected via `sendPush` so tests don't need fetch
// and so the network surface stays in one place. Production wires it to
// POST the OneSignal body to the Cloudflare push worker (see /worker), which
// holds the REST key as a secret and forwards to OneSignal. The browser never
// sees the REST key.

import { EV } from '../events/eventTypes.js';
import { buildPushBody, KIND } from './pushPayloadBuilder.js';
import { modeDescriptor } from '../game/sessions/modes.js';

let _booted = false;
let _bootPromise = null;
let _appId = null;
let _pushWorkerUrl = null;
let _getIdToken = null;
let _sendPush = null;
let _busSubs = [];
let _oneSignalReady = false;

export function configure({ appId, pushWorkerUrl, getIdToken, sendPush }) {
  _appId = appId;
  _pushWorkerUrl = pushWorkerUrl ?? null;
  _getIdToken = typeof getIdToken === 'function' ? getIdToken : null;
  _sendPush = sendPush ?? defaultSendPush;
}

async function defaultSendPush(body) {
  if (!_pushWorkerUrl) return; // not configured — skip silently
  let idToken = null;
  try { idToken = await _getIdToken?.(); } catch { /* swallow */ }
  if (!idToken) return; // unauthenticated — worker would reject anyway
  try {
    await fetch(_pushWorkerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn('[push] send failed', e);
  }
}

// One-time OneSignal SDK boot. Idempotent — concurrent callers await the
// same in-flight promise so a second call during sign-up doesn't race.
export async function boot({ uid } = {}) {
  if (_booted) return _oneSignalReady;
  if (_bootPromise) { await _bootPromise; return _oneSignalReady; }
  _booted = true;
  _bootPromise = (async () => {
    try {
      if (!globalThis.OneSignal) return false; // SDK not loaded; skip (silent fallback)
      const cfg = globalThis.APP_CONFIG ?? {};
      if (!cfg.onesignalAppId) return false;
      await globalThis.OneSignal.init({ appId: cfg.onesignalAppId, serviceWorkerPath: 'sw.js' });
      _oneSignalReady = true;
      if (uid) await globalThis.OneSignal.login(uid);
      return true;
    } catch (e) {
      const msg = String(e?.message ?? e ?? '');
      if (!msg.includes('App not configured for web push')) {
        console.warn('[notification.boot]', e);
      }
      _oneSignalReady = false;
      return false;
    }
  })();
  return _bootPromise;
}

export async function loginUser(uid) {
  if (!_oneSignalReady || !uid) return false;
  try {
    if (globalThis.OneSignal) await globalThis.OneSignal.login(uid);
    return true;
  } catch (e) {
    console.warn('[notification.login]', e);
    return false;
  }
}

export async function getSubscriptionId() {
  if (!_oneSignalReady) return null;
  try {
    return globalThis.OneSignal?.User?.PushSubscription?.id ?? null;
  } catch {
    return null;
  }
}

// Subscribe to bus events. Each subscription is deduplicated to fire once
// per logical event. Returns an unsubscribe-all function.
export function attachBusSubscriptions({ bus, sessionRef }) {
  detach();
  if (!bus) return () => {};

  // sessionRef is a getter that returns the current session info:
  //   { mode, mySlot, opponentUid, opponentName, opponentSubscriptionId, roomId }
  // It's a getter so the notification service tracks the active room without
  // holding a stale reference across game switches.

  const lastTurnNotified = new Map(); // roomId → turnNumber

  _busSubs.push(bus.on(EV.TURN_CHANGED, async ({ currentTurnSlot, turnNumber }) => {
    const s = sessionRef?.();
    if (!s?.mode || !s.roomId) return;
    const desc = modeDescriptor(s.mode);
    if (!desc.online) return;
    if (lastTurnNotified.get(s.roomId) === turnNumber) return; // dedup
    if (desc.pushOnMove === 'always') {
      // Async: the SENDER (active player who just moved) pushes the OPPONENT.
      // The opponent may not be online to push themselves — that's the whole
      // point of async play. We fire when the turn just left our slot, so
      // currentTurnSlot is now the opponent's. From the recipient's POV the
      // "opponentName" in the push body is US (we are their opponent), so
      // pass myName, not opponentName.
      if (currentTurnSlot === s.mySlot) return; // it's our turn now, nothing to push
      if (!s.opponentUid && !s.opponentSubscriptionId) return;
      lastTurnNotified.set(s.roomId, turnNumber);
      await sendPush(KIND.TURN, {
        externalIds: s.opponentUid ? [s.opponentUid] : null,
        subscriptionIds: s.opponentSubscriptionId ? [s.opponentSubscriptionId] : null,
        ctx: { roomId: s.roomId, opponentName: s.myName ?? null, isLive: false },
      });
      return;
    }
    if (desc.pushOnMove === 'ifBackgrounded') {
      // Live: the RECEIVER pushes themselves only if their tab is backgrounded.
      // Both players are typically online during live play, so this lets each
      // side detect its own foreground state and avoid noisy push when the
      // game is already on screen.
      if (currentTurnSlot !== s.mySlot) return; // opponent's turn — not ours to react
      if (!s.isBackgrounded) return;
      lastTurnNotified.set(s.roomId, turnNumber);
      await sendPush(KIND.TURN, {
        externalIds: [s.myUid],
        ctx: { roomId: s.roomId, opponentName: s.opponentName, isLive: true },
      });
    }
  }));

  _busSubs.push(bus.on(EV.GAME_COMPLETED, async ({ winnerSlot }) => {
    const s = sessionRef?.();
    if (!s?.mode || !s.roomId) return;
    if (!modeDescriptor(s.mode).online) return;
    await sendPush(KIND.COMPLETED, {
      externalIds: [s.myUid, s.opponentUid].filter(Boolean),
      ctx: { roomId: s.roomId, didWin: winnerSlot === s.mySlot },
    });
  }));

  return detach;
}

function detach() {
  for (const off of _busSubs) {
    try { off(); } catch { /* swallow */ }
  }
  _busSubs = [];
}

async function sendPush(kind, opts) {
  if (!_appId || !_sendPush) return;
  const body = buildPushBody({ appId: _appId, kind, ...opts });
  await _sendPush(body);
}

// Direct-send helpers for invite / friend events (called from inviteService /
// friendsService — those don't flow through the engine bus).
export async function pushInvite({ inviteeUid, inviterName, roomId }) {
  await sendPush(KIND.INVITE, {
    externalIds: [inviteeUid],
    ctx: { roomId, inviterName },
  });
}

export async function pushInviteAccepted({ inviterUid, accepterName, roomId }) {
  await sendPush(KIND.INVITE_ACCEPTED, {
    externalIds: [inviterUid],
    ctx: { roomId, opponentName: accepterName },
  });
}

export async function pushInviteRejected({ inviterUid, rejecterName }) {
  await sendPush(KIND.INVITE_REJECTED, {
    externalIds: [inviterUid],
    ctx: { opponentName: rejecterName },
  });
}

export async function pushFriendRequest({ recipientUid, senderName }) {
  await sendPush(KIND.FRIEND_REQUEST, {
    externalIds: [recipientUid],
    ctx: { fromName: senderName },
  });
}

export async function pushFriendAccepted({ recipientUid, accepterName }) {
  await sendPush(KIND.FRIEND_ACCEPTED, {
    externalIds: [recipientUid],
    ctx: { fromName: accepterName },
  });
}

export async function pushReminder({ recipientUid, opponentName, roomId, hoursIdle, gender }) {
  await sendPush(KIND.REMINDER, {
    externalIds: [recipientUid],
    ctx: { roomId, opponentName, hoursIdle, gender },
  });
}

export async function pushExpired({ recipientUid, roomId }) {
  await sendPush(KIND.EXPIRED, {
    externalIds: [recipientUid],
    ctx: { roomId },
  });
}

// Test reset — wipes module-level state.
export function _resetForTests() {
  _booted = false;
  _bootPromise = null;
  _appId = null;
  _pushWorkerUrl = null;
  _getIdToken = null;
  _sendPush = null;
  _oneSignalReady = false;
  detach();
}
