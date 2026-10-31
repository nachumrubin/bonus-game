import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountFriendsScreen, buildRequestsHtml, buildFriendsListHtml, buildBlockedListHtml,
  FRIENDS_INTENT, FRIENDS_RENDER, FRIENDS_DETAIL_RENDER,
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

test('buildFriendsListHtml: renders avatar + name + menu button', () => {
  const html = buildFriendsListHtml([{ uid: 'u1', name: 'נחום', avatar: 'zapi:5' }]);
  assert.match(html, /data-fr-row="u1"/);
  assert.match(html, /assets\/avatars\/boosties\/zapi\/l5_bust\.webp/);
  assert.match(html, /נחום/);
  assert.match(html, /assets\/ui\/remote\.png/);
  assert.match(html, /data-fr-menu="u1"/);
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

function makeOverlay() {
  const listeners = [];
  return {
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick(target) { for (const l of listeners) if (l.ev === 'click') l.fn({ target }); },
  };
}

// A detail-overlay menu button carrying one data-fd-* attribute.
function fdButton(attr) {
  return {
    tagName: 'BUTTON',
    hasAttribute: (k) => k === attr,
    getAttribute: (k) => (k === attr ? '1' : null),
    closest(sel) { return sel === `[${attr}]` ? this : null; },
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
    copyBtn:     makeEl(),
    sendBtn:     makeEl(),
    backBtn:     makeEl(),
    detailOv:    makeOverlay(),
    fdClose:     makeEl(),
    fdAvatar:    makeEl(),
    fdName:      makeEl(),
    fdRating:    makeEl(),
    fdStats:     makeWrap(),
    fdRecent:    makeWrap(),
    fdGames:     makeWrap(),
    blockedWrap: makeWrap(),
    blockedList: makeWrap(),
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
        case '#fr-copy-btn':      return els.copyBtn;
        case '#ov-friend-detail': return els.detailOv;
        case '#fd-close':         return els.fdClose;
        case '#fd-active-games':  return els.fdGames;
        case '#fd-avatar':        return els.fdAvatar;
        case '#fd-name':          return els.fdName;
        case '#fd-rating':        return els.fdRating;
        case '#fd-stats':         return els.fdStats;
        case '#fd-recent':        return els.fdRecent;
        case '#fr-blocked-wrap':  return els.blockedWrap;
        case '#fr-blocked-list':  return els.blockedList;
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

// Regression: the friend-detail overlay must resolve an avatar *id* (e.g.
// 'crown') to its emoji, exactly like the friends list does. A past fix
// added resolveAvatar() to the list but missed the detail header, so the
// literal word "crown" rendered next to the friend's name.
test('FRIENDS_DETAIL_RENDER resolves an old avatar id to the starter Boostie (no literal "crown")', () => {
  bus._reset();
  const { root, els } = makeRoot();
  mountFriendsScreen({ root, bus });
  bus.emit(FRIENDS_DETAIL_RENDER, {
    friend: { uid: 'u9', name: 'הודיה', avatar: 'crown', rating: 811 },
    rivalEntry: null,
    vsRecent: [],
    activeGames: [],
    myUid: 'me',
  });
  assert.match(els.fdAvatar.innerHTML ?? '', /boosties\/zapi\/l1_bust\.webp/);
  assert.notEqual(els.fdAvatar.textContent, 'crown');
  assert.equal(els.fdName.textContent, 'הודיה');
});

test('FRIENDS_DETAIL_RENDER shows anonymous player image when avatar is the default', () => {
  bus._reset();
  const { root, els } = makeRoot();
  mountFriendsScreen({ root, bus });
  bus.emit(FRIENDS_DETAIL_RENDER, {
    friend: { uid: 'u9', name: 'דנה', avatar: '👤' },
    rivalEntry: null, vsRecent: [], activeGames: [], myUid: 'me',
  });
  assert.match(els.fdAvatar.innerHTML ?? '', /anonymous player/);
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

test('clicking share-code button emits COPY_MY_ID', () => {
  bus._reset();
  const { root, els } = makeRoot();
  let n = 0;
  bus.on(FRIENDS_INTENT.COPY_MY_ID, () => { n++; });
  mountFriendsScreen({ root, bus });
  els.copyBtn.fireClick();
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

test('block in the friend menu needs a second tap, then emits BLOCK_FRIEND', () => {
  bus._reset();
  const { root, els } = makeRoot();
  const blocked = [];
  bus.on(FRIENDS_INTENT.BLOCK_FRIEND, (p) => blocked.push(p.friendUid));
  mountFriendsScreen({ root, bus });
  els.detailOv.dataset.friendUid = 'u7';
  els.detailOv.fireClick(fdButton('data-fd-block'));
  assert.deepEqual(blocked, []);
  els.detailOv.fireClick(fdButton('data-fd-block'));
  assert.deepEqual(blocked, ['u7']);
});

test('report in the friend menu emits REPORT_PLAYER with uid and name', () => {
  bus._reset();
  const { root, els } = makeRoot();
  let seen = null;
  bus.on(FRIENDS_INTENT.REPORT_PLAYER, (p) => { seen = p; });
  mountFriendsScreen({ root, bus });
  Object.assign(els.detailOv.dataset, { friendUid: 'u8', friendName: 'דנה' });
  els.detailOv.fireClick(fdButton('data-fd-report'));
  assert.deepEqual(seen, { friendUid: 'u8', friendName: 'דנה' });
});

test('buildBlockedListHtml: escapes names and falls back to שחקן', () => {
  const html = buildBlockedListHtml([{ uid: 'u1', name: '<b>' }, { uid: 'u2', name: '' }]);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /data-fr-unblock="u1"/);
  assert.match(html, /שחקן/);
});

test('FRIENDS_RENDER blocked paints the list; unblock emits UNBLOCK', () => {
  bus._reset();
  const { root, els } = makeRoot();
  let unblocked = null;
  bus.on(FRIENDS_INTENT.UNBLOCK, (p) => { unblocked = p.blockedUid; });
  mountFriendsScreen({ root, bus });
  bus.emit(FRIENDS_RENDER, { blocked: [] });
  assert.equal(els.blockedWrap.style.display, 'none');
  bus.emit(FRIENDS_RENDER, { blocked: [{ uid: 'u5', name: 'דנה' }] });
  assert.equal(els.blockedWrap.style.display, '');
  assert.match(els.blockedList.innerHTML, /דנה/);
  els.blockedList.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => (k === 'data-fr-unblock' ? 'u5' : null),
    closest() { return this; },
  });
  assert.equal(unblocked, 'u5');
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
