// friendsScreen — wires #sfriends.
//
// Responsibilities:
//   - paint my-userId in #fr-my-id
//   - paint pending friend-requests list
//   - paint accepted-friends list
//   - 'add friend' input → emits FRIENDS_INTENT.SEND_REQUEST(userId)
//   - per-row accept/reject buttons → emit FRIENDS_INTENT.ACCEPT/REJECT
//   - 'copy my id' → write to clipboard if available, otherwise just paint a flash
//
// All Firebase work happens in friendsService; this module is pure
// presentational + intent-emitting.

import { $, on, setText } from '../domHelpers.js';

export const FRIENDS_INTENT = Object.freeze({
  COPY_MY_ID:     'friendsUi/copyMyId',
  SEND_REQUEST:   'friendsUi/sendRequest',
  ACCEPT_REQUEST: 'friendsUi/acceptRequest',
  REJECT_REQUEST: 'friendsUi/rejectRequest',
  REMOVE_FRIEND:  'friendsUi/removeFriend',
  BACK:           'friendsUi/back',
});

export const FRIENDS_RENDER = 'friendsUi/render';

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll('\'','&#39;');
}

export function buildRequestsHtml(requests = []) {
  if (!requests.length) return '';
  return requests.map(r =>
    `<div data-fr-request="${escapeHtml(r.fromUid)}" style="display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid rgba(255,255,255,.08);">`
    +   `<div style="flex:1;font-size:12px;color:#fff;font-weight:700;">${escapeHtml(r.fromName ?? r.fromUid)}</div>`
    +   `<button data-fr-accept="${escapeHtml(r.fromUid)}" style="background:#1ed760;border:none;border-radius:5px;padding:4px 10px;font-family:Heebo,sans-serif;font-size:11px;font-weight:900;color:#000;cursor:pointer;">קבל</button>`
    +   `<button data-fr-reject="${escapeHtml(r.fromUid)}" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:4px 10px;font-family:Heebo,sans-serif;font-size:11px;color:#fff;cursor:pointer;">דחה</button>`
    + `</div>`,
  ).join('');
}

export function buildFriendsListHtml(friends = []) {
  if (!friends.length) {
    return `<div style="font-size:11px;color:rgba(255,255,255,.3);text-align:center;padding:8px 0;">אין חברים עדיין</div>`;
  }
  return friends.map(f =>
    `<div data-fr-row="${escapeHtml(f.uid)}" style="display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid rgba(255,255,255,.06);">`
    +   `<div style="font-size:18px;">${escapeHtml(f.avatar ?? '👤')}</div>`
    +   `<div style="flex:1;font-size:12px;color:#fff;font-weight:700;">${escapeHtml(f.name ?? '?')}</div>`
    +   `<button data-fr-remove="${escapeHtml(f.uid)}" aria-label="הסר" style="background:none;border:none;font-size:14px;color:rgba(255,255,255,.4);cursor:pointer;">×</button>`
    + `</div>`,
  ).join('');
}

export function mountFriendsScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountFriendsScreen: bus required');

  const myIdEl   = $('#fr-my-id',       root);
  const reqWrap  = $('#fr-requests-wrap', root);
  const reqList  = $('#fr-requests-list', root);
  const friendsList = $('#fr-friends-list',  root);
  const friendsCount = $('#fr-friends-count', root);
  const addInput = $('#add-friend-input', root);
  const addStatus = $('#add-friend-status', root);
  const reqBadge = $('#friends-req-badge',  root);
  const sendBtn  = $('button[onclick="sendFriendRequest()"]', root);
  const backBtn  = $('button[onclick="openProfileOrAuth()"]', root);

  const cleanups = [];

  if (myIdEl) {
    cleanups.push(on(myIdEl, 'click', () => bus.emit(FRIENDS_INTENT.COPY_MY_ID, {})));
  }
  if (sendBtn) {
    sendBtn.removeAttribute?.('onclick');
    cleanups.push(on(sendBtn, 'click', (e) => {
      e?.preventDefault?.();
      const userId = (addInput?.value ?? '').trim().toUpperCase();
      bus.emit(FRIENDS_INTENT.SEND_REQUEST, { userId });
    }));
  }
  if (backBtn) {
    backBtn.removeAttribute?.('onclick');
    cleanups.push(on(backBtn, 'click', () => bus.emit(FRIENDS_INTENT.BACK, {})));
  }

  function delegateClick(container) {
    if (!container?.addEventListener) return;
    cleanups.push(on(container, 'click', (e) => {
      const t = e.target;
      const btn = t?.tagName === 'BUTTON' ? t : t?.closest?.('button');
      if (!btn) return;
      const accept = btn.getAttribute?.('data-fr-accept');
      const reject = btn.getAttribute?.('data-fr-reject');
      const remove = btn.getAttribute?.('data-fr-remove');
      if (accept) bus.emit(FRIENDS_INTENT.ACCEPT_REQUEST, { fromUid: accept });
      if (reject) bus.emit(FRIENDS_INTENT.REJECT_REQUEST, { fromUid: reject });
      if (remove) bus.emit(FRIENDS_INTENT.REMOVE_FRIEND,  { friendUid: remove });
    }));
  }
  delegateClick(reqList);
  delegateClick(friendsList);

  function paintRequests(requests = []) {
    if (reqWrap) reqWrap.style.display = requests.length ? '' : 'none';
    if (reqList) reqList.innerHTML = buildRequestsHtml(requests);
    if (reqBadge) {
      reqBadge.style.display = requests.length ? '' : 'none';
      setText(reqBadge, String(requests.length));
    }
  }
  function paintFriends(friends = []) {
    if (friendsList) friendsList.innerHTML = buildFriendsListHtml(friends);
    if (friendsCount) setText(friendsCount, `(${friends.length})`);
  }

  cleanups.push(bus.on(FRIENDS_RENDER, ({ myUserId, requests, friends, copyStatus, addStatus: addS } = {}) => {
    if (myIdEl && myUserId) setText(myIdEl, myUserId);
    if (Array.isArray(requests)) paintRequests(requests);
    if (Array.isArray(friends))  paintFriends(friends);
    const copyEl = $('#fr-copy-status', root);
    if (copyEl && copyStatus !== undefined) setText(copyEl, copyStatus ?? '');
    if (addStatus && addS !== undefined) setText(addStatus, addS ?? '');
  }));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
