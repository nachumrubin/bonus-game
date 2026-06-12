// Tests for the notification service. The bus subscription path is exercised
// via the local emit() — we check that the right pushes fire (and nothing
// double-fires) when MOVE_CONFIRMED / TURN_CHANGED / GAME_COMPLETED happen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../events/bus.js';
import { EV } from '../events/eventTypes.js';
import {
  configure,
  attachBusSubscriptions,
  boot,
  loginUser,
  getSubscriptionId,
  pushInvite,
  pushInviteAccepted,
  pushInviteRejected,
  pushFriendRequest,
  pushFriendAccepted,
  pushReminder,
  pushExpired,
  _resetForTests,
} from './notificationService.js';

function captureSends() {
  const sent = [];
  configure({
    appId: 'test-app',
    pushWorkerUrl: 'https://test.invalid/push',
    getIdToken: async () => 'test-token',
    sendPush: async (body) => { sent.push(body); },
  });
  return sent;
}

test('pushInvite sends a push with the expected kind + recipient', async () => {
  _resetForTests();
  const sent = captureSends();
  await pushInvite({ inviteeUid: 'bob', inviterName: 'Alice', roomId: 'r1' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.type, 'invite');
  assert.deepEqual(sent[0].include_aliases.external_id, ['bob']);
  assert.ok(sent[0].contents.en.includes('Alice'));
});

test('boot failure leaves OneSignal login/subscription calls disabled', async () => {
  _resetForTests();
  const prevOneSignal = globalThis.OneSignal;
  const prevConfig = globalThis.APP_CONFIG;
  const prevWarn = console.warn;
  let loginCalls = 0;
  globalThis.APP_CONFIG = { onesignalAppId: 'bad-web-push-app' };
  globalThis.OneSignal = {
    init: async () => { throw new Error('App not configured for web push'); },
    login: async () => { loginCalls++; throw new Error('should not be called'); },
    User: { PushSubscription: { id: 'sub-1' } },
  };
  console.warn = () => {};

  try {
    assert.equal(await boot({ uid: 'u1' }), false);
    assert.equal(await loginUser('u1'), false);
    assert.equal(await getSubscriptionId(), null);
    assert.equal(loginCalls, 0);
  } finally {
    globalThis.OneSignal = prevOneSignal;
    globalThis.APP_CONFIG = prevConfig;
    console.warn = prevWarn;
    _resetForTests();
  }
});

test('pushInviteAccepted notifies the original inviter', async () => {
  _resetForTests();
  const sent = captureSends();
  await pushInviteAccepted({ inviterUid: 'alice', accepterName: 'Bob', roomId: 'r1' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.type, 'invite_accepted');
  assert.deepEqual(sent[0].include_aliases.external_id, ['alice']);
  assert.ok(sent[0].contents.en.includes('Bob'));
});

test('pushInviteRejected notifies the original inviter with invite_rejected kind', async () => {
  _resetForTests();
  const sent = captureSends();
  await pushInviteRejected({ inviterUid: 'alice', rejecterName: 'Bob' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.type, 'invite_rejected');
  assert.deepEqual(sent[0].include_aliases.external_id, ['alice']);
  assert.ok(sent[0].contents.en.includes('Bob'));
});

test('pushFriendRequest and pushFriendAccepted route to the recipient', async () => {
  _resetForTests();
  const sent = captureSends();
  await pushFriendRequest({ recipientUid: 'bob', senderName: 'Alice' });
  await pushFriendAccepted({ recipientUid: 'alice', accepterName: 'Bob' });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].data.type, 'friendRequest');
  assert.equal(sent[1].data.type, 'friendAccepted');
});

test('pushReminder and pushExpired use async-game notification kinds', async () => {
  _resetForTests();
  const sent = captureSends();
  await pushReminder({ recipientUid: 'bob', opponentName: 'Alice', roomId: 'r1', hoursIdle: 24 });
  await pushExpired({ recipientUid: 'bob', roomId: 'r1' });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].data.type, 'reminder');
  assert.equal(sent[0].data.roomId, 'r1');
  assert.equal(sent[1].data.type, 'expired');
});

test('TURN_CHANGED in async mode: sender pushes opponent once and dedups subsequent fires for the same turn', async () => {
  // Async push must be triggered by the SENDER (active player who just moved),
  // because the recipient may not be online to push themselves. The push
  // targets the opponent's uid/subscriptionId, not our own.
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  let session = {
    mode: 'friend-async',
    mySlot: 0,
    myUid: 'me',
    myName: 'Alice',
    opponentUid: 'them',
    opponentName: 'Bob',
    opponentSubscriptionId: 'sub-them',
    roomId: 'r-async',
    isBackgrounded: false,
  };
  attachBusSubscriptions({ bus, sessionRef: () => session });

  // We just made our move → currentTurnSlot flips to opponent (slot 1). Push expected.
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 2 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.type, 'turn');
  // Targeting: the opponent, not us.
  assert.deepEqual(sent[0].include_aliases?.external_id, ['them']);
  assert.deepEqual(sent[0].include_subscription_ids, ['sub-them']);
  // From the recipient's POV, the "opponent" who just played is us → myName.
  assert.ok(sent[0].contents.en.includes('Alice'));

  // Same TURN_CHANGED again (e.g. duplicate watcher fire) → no second push
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 2 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 1);

  // New turn number after opponent plays back → our turn again → no push from us
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 3 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 1);

  // Next time we move → fires again
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 4 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 2);
});

test('TURN_CHANGED to MY slot in live mode + foregrounded does NOT push', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'friend-live',
      mySlot: 0, myUid: 'me', opponentUid: 'them', opponentName: 'Bob',
      opponentSubscriptionId: null, roomId: 'r-live',
      isBackgrounded: false,
    }),
  });
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 2 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 0);
});

test('TURN_CHANGED to MY slot in live mode + backgrounded DOES push', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'friend-live',
      mySlot: 0, myUid: 'me', opponentUid: 'them', opponentName: 'Bob',
      opponentSubscriptionId: null, roomId: 'r-live-bg',
      isBackgrounded: true,
    }),
  });
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 2 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 1);
});

test('TURN_CHANGED to OUR slot in async mode does NOT push (it is already our turn)', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'friend-async',
      mySlot: 0, myUid: 'me', myName: 'Alice',
      opponentUid: 'them', opponentName: 'Bob', opponentSubscriptionId: null,
      roomId: 'r-async-2',
    }),
  });
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 2 }); // our turn now → nothing for us to push
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 0);
});

test('TURN_CHANGED in async mode falls back to externalIds when opponent has no subscriptionId', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'random-async',
      mySlot: 0, myUid: 'me', myName: 'Alice',
      opponentUid: 'them', opponentName: 'Bob', opponentSubscriptionId: null,
      roomId: 'r-async-3',
    }),
  });
  bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 2 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].include_aliases?.external_id, ['them']);
  assert.equal(sent[0].include_subscription_ids, undefined);
});

test('GAME_COMPLETED pushes each player their own winner perspective + score', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'random-async',
      mySlot: 0, myUid: 'me', myName: 'Alice',
      opponentUid: 'them', opponentName: 'Bob',
      roomId: 'r-end',
    }),
  });
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 0, scores: { 0: 42, 1: 30 } });
  await new Promise(r => setTimeout(r, 0));

  // One push per player, each from that player's perspective.
  assert.equal(sent.length, 2);
  const mine = sent.find(p => p.include_aliases.external_id[0] === 'me');
  const theirs = sent.find(p => p.include_aliases.external_id[0] === 'them');
  assert.ok(mine && theirs);
  assert.equal(mine.data.type, 'completed');

  // Winner (slot 0 = me): "you won" + my score first.
  assert.equal(mine.data.didWin, true);
  assert.equal(mine.data.myScore, 42);
  assert.equal(mine.data.opponentScore, 30);
  assert.ok(mine.contents.en.includes('ניצחת'));
  assert.ok(mine.contents.en.includes('42:30'));

  // Loser (slot 1 = them): names the winner + their score first.
  assert.equal(theirs.data.didWin, false);
  assert.equal(theirs.data.myScore, 30);
  assert.equal(theirs.data.opponentScore, 42);
  assert.ok(theirs.contents.en.includes('Alice'));
  assert.ok(theirs.contents.en.includes('30:42'));
});

test('GAME_COMPLETED is sent once per room even if emitted twice', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'random-async',
      mySlot: 0, myUid: 'me', myName: 'Alice',
      opponentUid: 'them', opponentName: 'Bob',
      roomId: 'r-end-dup',
    }),
  });
  // Engine emit (real winnerSlot) + online-watcher emit (winnerSlot:null).
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 0, scores: { 0: 10, 1: 5 } });
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: null, scores: { 0: 10, 1: 5 } });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 2, 'two recipients, but only one round of pushes');
});

test('GAME_COMPLETED on a draw says תיקו to both', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'random-async',
      mySlot: 0, myUid: 'me', myName: 'Alice',
      opponentUid: 'them', opponentName: 'Bob',
      roomId: 'r-draw',
    }),
  });
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: null, scores: { 0: 20, 1: 20 } });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 2);
  for (const p of sent) {
    assert.equal(p.data.isDraw, true);
    assert.equal(p.data.didWin, false);
    assert.ok(p.contents.en.includes('תיקו'));
  }
});

test('GAME_COMPLETED in offline mode does not push', async () => {
  _resetForTests();
  bus._reset();
  const sent = captureSends();
  attachBusSubscriptions({
    bus,
    sessionRef: () => ({
      mode: 'offline-2p',
      mySlot: 0, myUid: 'me', opponentUid: null, roomId: null,
    }),
  });
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 0 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 0);
});
