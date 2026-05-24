import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPushBody, KIND } from './pushPayloadBuilder.js';

test('TURN with subscriptionIds builds the legacy room-tokens shape', () => {
  const body = buildPushBody({
    appId: 'app-x',
    kind: KIND.TURN,
    subscriptionIds: ['sub-1'],
    ctx: { roomId: 'r1', opponentName: 'Bob' },
  });
  assert.equal(body.app_id, 'app-x');
  assert.deepEqual(body.include_subscription_ids, ['sub-1']);
  assert.equal(body.headings.en, 'תורך בבוסט!');
  assert.ok(body.contents.en.includes('Bob'));
  assert.equal(body.data.type, 'turn');
  assert.equal(body.data.roomId, 'r1');
});

test('INVITE with externalIds builds the alias-targeted shape with target_channel', () => {
  const body = buildPushBody({
    appId: 'app-x',
    kind: KIND.INVITE,
    externalIds: ['user-bob'],
    ctx: { roomId: 'r1', inviterName: 'Alice' },
  });
  assert.deepEqual(body.include_aliases, { external_id: ['user-bob'] });
  assert.equal(body.target_channel, 'push');
  assert.ok(body.contents.en.includes('Alice'));
  assert.equal(body.data.type, 'invite');
});

test('COMPLETED includes didWin in data + body reflects winner state', () => {
  const winBody = buildPushBody({
    appId: 'a',
    kind: KIND.COMPLETED,
    externalIds: ['u'],
    ctx: { roomId: 'r1', didWin: true },
  });
  assert.ok(winBody.contents.en.includes('ניצחת'));

  const loseBody = buildPushBody({
    appId: 'a',
    kind: KIND.COMPLETED,
    externalIds: ['u'],
    ctx: { roomId: 'r1', didWin: false },
  });
  assert.equal(loseBody.contents.en, 'המשחק הסתיים');
});

test('FRIEND_REQUEST title + body uses fromName', () => {
  const body = buildPushBody({
    appId: 'a',
    kind: KIND.FRIEND_REQUEST,
    externalIds: ['u'],
    ctx: { fromName: 'Carol' },
  });
  assert.ok(body.headings.en.includes('בקשת חברות'));
  assert.ok(body.contents.en.includes('Carol'));
});

test('caller can override title + body', () => {
  const body = buildPushBody({
    appId: 'a', kind: KIND.TURN,
    externalIds: ['u'],
    title: 'CUSTOM TITLE',
    body: 'CUSTOM BODY',
  });
  assert.equal(body.headings.en, 'CUSTOM TITLE');
  assert.equal(body.contents.en, 'CUSTOM BODY');
});

test('throws when appId is missing', () => {
  assert.throws(() => buildPushBody({ kind: KIND.TURN, externalIds: ['u'] }), /appId required/);
});

test('throws when no targeting is provided', () => {
  assert.throws(() => buildPushBody({ appId: 'a', kind: KIND.TURN }), /subscriptionIds or externalIds required/);
});

test('arbitrary data can be merged into the data envelope', () => {
  const body = buildPushBody({
    appId: 'a', kind: KIND.TURN,
    externalIds: ['u'],
    data: { foo: 'bar', priority: 5 },
  });
  assert.equal(body.data.foo, 'bar');
  assert.equal(body.data.priority, 5);
  assert.equal(body.data.type, 'turn'); // type still set from kind
});
