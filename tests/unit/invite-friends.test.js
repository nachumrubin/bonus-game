import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAY_STORE_URL,
  INVITE_REQUIRED,
  buildInviteMessage,
  buildSmsHref,
  contactsSupported,
  shareSupported,
  extractNumbers,
  runInviteFlow,
} from '../../src/ui/inviteFriends.js';

test('INVITE_REQUIRED is 5', () => {
  assert.equal(INVITE_REQUIRED, 5);
});

test('buildInviteMessage includes the Play Store URL', () => {
  const msg = buildInviteMessage();
  assert.match(msg, /play\.google\.com/);
  assert.ok(msg.includes(PLAY_STORE_URL));
});

test('buildSmsHref joins numbers and encodes the body', () => {
  const href = buildSmsHref(['111', '222'], 'hi there');
  assert.match(href, /^sms:111,222\?body=/);
  assert.match(href, /hi%20there/);
});

test('buildSmsHref tolerates empty numbers / body', () => {
  assert.equal(buildSmsHref([], ''), 'sms:');
  assert.equal(buildSmsHref(['1'], ''), 'sms:1');
});

test('extractNumbers pulls the first tel per contact, skips contacts without one', () => {
  const nums = extractNumbers([
    { name: ['A'], tel: ['111', '999'] },
    { name: ['B'], tel: [] },
    { name: ['C'] },
    { name: ['D'], tel: ['333'] },
  ]);
  assert.deepEqual(nums, ['111', '333']);
});

test('contactsSupported / shareSupported detect capabilities', () => {
  assert.equal(contactsSupported({ contacts: { select: () => {} } }), true);
  assert.equal(contactsSupported({}), false);
  assert.equal(contactsSupported(null), false);
  assert.equal(shareSupported({ share: () => {} }), true);
  assert.equal(shareSupported({}), false);
});

test('runInviteFlow: contacts path with >= required returns "sent" and opens SMS', async () => {
  const picked = [
    { tel: ['1'] }, { tel: ['2'] }, { tel: ['3'] }, { tel: ['4'] }, { tel: ['5'] },
  ];
  let openedHref = null;
  const res = await runInviteFlow({
    nav: { contacts: { select: async () => picked } },
    open: (href) => { openedHref = href; },
  });
  assert.equal(res.status, 'sent');
  assert.equal(res.count, 5);
  assert.match(openedHref, /^sms:1,2,3,4,5\?body=/);
});

test('runInviteFlow: contacts path with too few returns "too-few" and does not open SMS', async () => {
  let opened = false;
  const res = await runInviteFlow({
    nav: { contacts: { select: async () => [{ tel: ['1'] }, { tel: ['2'] }] } },
    open: () => { opened = true; },
  });
  assert.equal(res.status, 'too-few');
  assert.equal(res.count, 2);
  assert.equal(opened, false);
});

test('runInviteFlow: empty selection is treated as cancelled', async () => {
  const res = await runInviteFlow({
    nav: { contacts: { select: async () => [] } },
    open: () => {},
  });
  assert.equal(res.status, 'cancelled');
  assert.equal(res.count, 0);
});

test('runInviteFlow: picker throwing (dismissed) returns cancelled', async () => {
  const res = await runInviteFlow({
    nav: { contacts: { select: async () => { throw new Error('dismissed'); } } },
    open: () => {},
  });
  assert.equal(res.status, 'cancelled');
});

test('runInviteFlow: falls back to share when contacts unsupported, grants full batch', async () => {
  let shared = null;
  const res = await runInviteFlow({
    nav: { share: async (data) => { shared = data; } },
    open: () => {},
  });
  assert.equal(res.status, 'shared');
  assert.equal(res.count, INVITE_REQUIRED);
  assert.ok(shared.url);
});

test('runInviteFlow: share rejection returns cancelled', async () => {
  const res = await runInviteFlow({
    nav: { share: async () => { throw new Error('AbortError'); } },
    open: () => {},
  });
  assert.equal(res.status, 'cancelled');
});

test('runInviteFlow: falls back to clipboard when neither contacts nor share exist', async () => {
  let copied = null;
  const res = await runInviteFlow({
    nav: { clipboard: { writeText: async (t) => { copied = t; } } },
    open: () => {},
  });
  assert.equal(res.status, 'copied');
  assert.equal(res.count, INVITE_REQUIRED);
  assert.match(copied, /play\.google\.com/);
});

test('runInviteFlow: no channels available returns unsupported', async () => {
  const res = await runInviteFlow({ nav: {}, open: () => {} });
  assert.equal(res.status, 'unsupported');
  assert.equal(res.count, 0);
});
