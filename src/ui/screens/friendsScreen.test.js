import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountFriendsScreen, buildRequestsHtml, buildFriendsListHtml,
  FRIENDS_INTENT, FRIENDS_RENDER,
} from './friendsScreen.js';

test('buildRequestsHtml: empty list', () => {
  assert.equal(buildRequestsHtml([]), '');
});

test('buildRequestsHtml: renders accept/reject buttons with fromUid', () => {
  const html = buildRequestsHtml([{ fromUid: 'u1', fromName: 'דני' }]);
  assert.match(html, /data-fr-accept="u1"/);
  assert.match(html, /data-fr-reject="u1"/);
  assert.match(html, /דני/);
});

test('buildRequestsHtml: escapes name', () => {
  const html = buildRequestsHtml([{ fromUid: 'u1', fromName: '<x>' }]);
  assert.match(html, /&lt;x&gt;/);
});

test('buildFriendsListHtml: empty placeholder', () => {
  const html = buildFriendsListHtml([]);
  assert.match(html, /אין חברים/);
});

test('buildFriendsListHtml: renders avatar + name + remove button', () => {
  const html = buildFriendsListHtml([{ uid: 'u1', name: 'נחום', avatar: '🦈' }]);
  assert.match(html, /data-fr-row="u1"/);
  assert.match(html, /🦈/);
  assert.match(html, /נחום/);
  assert.match(html, /data-fr-remove="u1"/);
});

function makeWrap() {
  const listeners = [];
  return {
    innerHTML: '',
    style: { display: '' },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick(target) { for (const l of listeners) if (l.ev === 'click') l.fn({ target }); },
  };
}
function makeEl(initial = {}) {
  const listeners = [];
  return {
    textContent: initial.textContent ?? '',
    value: initial.value ?? '',
    style: { display: '' },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makeRoot() {
  const els = {
    myId:        makeEl(),
    reqWrap:     makeWrap(),
    reqList:     makeWrap(),
    friendsList: makeWrap(),
    count:       makeEl(),
    addInput:    makeEl(),
    addStatus:   makeEl(),
    reqBadge:    makeEl(),
    copyStatus:  makeEl(),
    sendBtn:     makeEl(),
    backBtn:     makeEl(),
  };
  const root = {
    querySelector(sel) {
      switch (sel) {
        case '#fr-my-id':         return els.myId;
        case '#fr-requests-wrap': return els.reqWrap;
        case '#fr-requests-list': return els.reqList;
        case '#fr-friends-list':  return els.friendsList;
        case '#fr-friends-count': return els.count;
        case '#add-friend-input': return els.addInput;
        case '#add-friend-status':return els.addStatus;
        case '#friends-req-badge':return els.reqBadge;
        case '#fr-copy-status':   return els.copyStatus;
        case 'button[onclick="sendFriendRequest()"]': return els.sendBtn;
        case 'button[onclick="openProfileOrAuth()"]': return els.backBtn;
        default: return null;
      }
    },
  };
  return { root, els };
}

test('FRIENDS_RENDER paints my-id, requests, friends, count, badge', () => {
  bus._reset();
  const { root, els } = makeRoot();
  mountFriendsScreen({ root, bus });
  bus.emit(FRIENDS_RENDER, {
    myUserId: '123456',
    requests: [{ fromUid: 'u1', fromName: 'דני' }],
    friends:  [{ uid: 'u2', name: 'נחום', avatar: '👑' }, { uid: 'u3', name: 'X', avatar: '⭐' }],
  });
  assert.equal(els.myId.textContent, '123456');
  assert.match(els.reqList.innerHTML, /data-fr-accept="u1"/);
  assert.equal(els.reqWrap.style.display, '');
  assert.match(els.friendsList.innerHTML, /נחום/);
  assert.equal(els.count.textContent, '(2)');
  assert.equal(els.reqBadge.textContent, '1');
});

test('FRIENDS_RENDER with no requests hides the wrap and the badge', () => {
  bus._reset();
  const { root, els } = makeRoot();
  mountFriendsScreen({ root, bus });
  bus.emit(FRIENDS_RENDER, { requests: [] });
  assert.equal(els.reqWrap.style.display, 'none');
  assert.equal(els.reqBadge.style.display, 'none');
});

test('clicking my-id emits COPY_MY_ID', () => {
  bus._reset();
  const { root, els } = makeRoot();
  let n = 0;
  bus.on(FRIENDS_INTENT.COPY_MY_ID, () => { n++; });
  mountFriendsScreen({ root, bus });
  els.myId.fireClick();
  assert.equal(n, 1);
});

test('send button emits SEND_REQUEST with uppercased trimmed input', () => {
  bus._reset();
  const { root, els } = makeRoot();
  els.addInput.value = ' abc123 ';
  const events = [];
  bus.on(FRIENDS_INTENT.SEND_REQUEST, (p) => events.push(p));
  mountFriendsScreen({ root, bus });
  els.sendBtn.fireClick();
  assert.deepEqual(events, [{ userId: 'ABC123' }]);
});

test('accept / reject inside the request list emit intents', () => {
  bus._reset();
  const { root, els } = makeRoot();
  const got = [];
  bus.on(FRIENDS_INTENT.ACCEPT_REQUEST, (p) => got.push(['accept', p.fromUid]));
  bus.on(FRIENDS_INTENT.REJECT_REQUEST, (p) => got.push(['reject', p.fromUid]));
  mountFriendsScreen({ root, bus });
  bus.emit(FRIENDS_RENDER, { requests: [{ fromUid: 'u1', fromName: 'X' }] });
  // Simulate clicks
  els.reqList.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => k === 'data-fr-accept' ? 'u1' : null,
    closest() { return this; },
  });
  els.reqList.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => k === 'data-fr-reject' ? 'u2' : null,
    closest() { return this; },
  });
  assert.deepEqual(got, [['accept','u1'],['reject','u2']]);
});

test('remove inside the friends list emits REMOVE_FRIEND', () => {
  bus._reset();
  const { root, els } = makeRoot();
  let removed = null;
  bus.on(FRIENDS_INTENT.REMOVE_FRIEND, (p) => { removed = p.friendUid; });
  mountFriendsScreen({ root, bus });
  bus.emit(FRIENDS_RENDER, { friends: [{ uid: 'u9', name: 'X' }] });
  els.friendsList.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => k === 'data-fr-remove' ? 'u9' : null,
    closest() { return this; },
  });
  assert.equal(removed, 'u9');
});

test('back button emits BACK', () => {
  bus._reset();
  const { root, els } = makeRoot();
  let n = 0;
  bus.on(FRIENDS_INTENT.BACK, () => { n++; });
  mountFriendsScreen({ root, bus });
  els.backBtn.fireClick();
  assert.equal(n, 1);
});

test('throws if bus missing', () => {
  assert.throws(() => mountFriendsScreen({}), /bus required/);
});
