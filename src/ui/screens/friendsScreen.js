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
import { g, getGender } from '../genderText.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

export const FRIENDS_INTENT = Object.freeze({
  COPY_MY_ID:     'friendsUi/copyMyId',
  SEND_REQUEST:   'friendsUi/sendRequest',
  ACCEPT_REQUEST: 'friendsUi/acceptRequest',
  REJECT_REQUEST: 'friendsUi/rejectRequest',
  REMOVE_FRIEND:  'friendsUi/removeFriend',
  BACK:           'friendsUi/back',
  OPEN_DETAIL:    'friendsUi/openDetail',
  INVITE_FRIEND:  'friendsUi/inviteFriend',
  ENTER_GAME:     'friendsUi/enterGame',
});

export const FRIENDS_RENDER        = 'friendsUi/render';
export const FRIENDS_DETAIL_RENDER = 'friendsUi/detailRender';

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll('\'','&#39;');
}

const AVATAR_ID_TO_EMOJI = {
  crown:'👑', star:'⭐', fire:'🔥', diamond:'💎', shark:'🦈',
  dragon:'🐉', tiger:'🐯', alien:'👾', wizard:'🧙', robot:'🤖',
  rocket:'🚀', knight:'🛡️', ninja:'🥷', genius:'🧠', vampire:'🧛',
};
function resolveAvatar(raw, fallback) {
  return AVATAR_ID_TO_EMOJI[raw] ?? raw ?? fallback;
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

export function formatLastSeen(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  const weeks = Math.floor(diff / 604_800_000);
  if (mins  <  1) return 'עכשיו';
  if (hours <  1) return `לפני ${mins} דק'`;
  if (days  <  1) return `לפני ${hours} שע'`;
  if (weeks <  1) return `לפני ${days} ימים`;
  if (weeks <  5) return `לפני ${weeks} שבועות`;
  const months = Math.floor(days / 30);
  return `לפני ${months} חודשים`;
}

export function buildFriendsListHtml(friends = []) {
  if (!friends.length) {
    return `<div style="font-size:11px;color:rgba(255,255,255,.3);text-align:center;padding:8px 0;">אין חברים עדיין</div>`;
  }
  return friends.map(f => {
    const online    = !!f.connected;
    const lastSeen  = !online && f.lastSeen ? formatLastSeen(f.lastSeen) : '';
    const ratingStr = f.rating != null ? String(f.rating) : '—';
    const dotClass  = online ? 'fr-online-dot fr-online-dot--on' : 'fr-online-dot';
    return `<div data-fr-row="${escapeHtml(f.uid)}" style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.06);">`
      + `<div style="font-size:20px;line-height:1;">${escapeHtml(resolveAvatar(f.avatar, '👤'))}</div>`
      + `<div style="flex:1;min-width:0;">`
      +   `<div style="font-size:12px;color:#fff;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.name ?? '?')}</div>`
      +   `<div style="font-size:10px;color:rgba(255,255,255,.45);">⭐ ${escapeHtml(ratingStr)}</div>`
      + `</div>`
      + `<div style="font-size:9px;color:rgba(255,255,255,.4);text-align:center;min-width:42px;">${escapeHtml(lastSeen)}</div>`
      + `<span class="${dotClass}" aria-hidden="true"></span>`
      + `<button data-fr-remove="${escapeHtml(f.uid)}" aria-label="הסר" style="background:none;border:none;font-size:14px;color:rgba(255,255,255,.35);cursor:pointer;padding:0 2px;">×</button>`
      + `</div>`;
  }).join('');
}

function buildDetailStatsHtml(rival) {
  if (!rival || !rival.played) {
    return `<span style="color:rgba(255,255,255,.3);">אין היסטוריה משותפת עדיין</span>`;
  }
  const pct = Math.round((rival.won / rival.played) * 100);
  return `משחקים: ${rival.played} &nbsp;|&nbsp; ניצחת: ${rival.won} &nbsp;|&nbsp; הפסדת: ${rival.lost}<br>`
    + `אחוז ניצחון: <b>${pct}%</b>`;
}

function buildDetailRecentHtml(games) {
  if (!games.length) {
    return `<span style="color:rgba(255,255,255,.3);">אין משחקים קודמים</span>`;
  }
  return games.map(g => {
    const icon = g.result === 'win' ? '✅' : g.result === 'loss' ? '❌' : '🤝';
    // direction:ltr locks the visual order so it always reads
    // "mine : theirs ✓" left-to-right regardless of the parent's RTL flow.
    // Gold (var(--by)) on the user's score makes "mine" unambiguous even
    // when their score is the lower number (e.g. a forfeit/timeout win).
    return `<div style="display:flex;gap:8px;padding:3px 0;font-size:12px;direction:ltr;justify-content:flex-end;align-items:baseline;">`
      + `<span style="color:var(--by,#f5c518);font-weight:900;">${g.score}</span>`
      + `<span style="color:rgba(255,255,255,.35);">:</span>`
      + `<span style="color:rgba(255,255,255,.6);">${g.opponentScore}</span>`
      + `<span>${icon}</span>`
      + `</div>`;
  }).join('');
}

function buildDetailActiveGamesHtml(activeGames, myUid) {
  if (!activeGames.length) {
    return `<button data-fd-invite="1" style="width:100%;padding:8px;border:none;border-radius:8px;`
      + `background:#1ed760;color:#000;font-family:Heebo,sans-serif;font-size:12px;font-weight:900;cursor:pointer;">`
      + `${g('inviteToGame', getGender())}</button>`;
  }
  return activeGames.map(({ roomId, room }) => {
    const mySlot = room.players?.[0]?.uid === myUid ? 0 : 1;
    const modeLabel = room.mode?.endsWith('-async') ? '🔄 אסינכרוני' : '⚡ חי';
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">`
      + `<span style="flex:1;font-size:11px;color:rgba(255,255,255,.55);">${modeLabel}</span>`
      + `<button data-fd-enter="${escapeHtml(roomId)}" data-fd-slot="${mySlot}" `
      + `style="padding:6px 12px;border:none;border-radius:6px;background:#f5c518;`
      + `color:#000;font-family:Heebo,sans-serif;font-size:11px;font-weight:900;cursor:pointer;">🕹 כנס</button>`
      + `</div>`;
  }).join('');
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
      if (btn) {
        const accept = btn.getAttribute?.('data-fr-accept');
        const reject = btn.getAttribute?.('data-fr-reject');
        const remove = btn.getAttribute?.('data-fr-remove');
        if (accept) bus.emit(FRIENDS_INTENT.ACCEPT_REQUEST, { fromUid: accept });
        if (reject) bus.emit(FRIENDS_INTENT.REJECT_REQUEST, { fromUid: reject });
        if (remove) bus.emit(FRIENDS_INTENT.REMOVE_FRIEND,  { friendUid: remove });
        return;
      }
      // Row click (no button) → open friend detail
      const row = t?.closest?.('[data-fr-row]');
      if (row) {
        const friendUid = row.getAttribute('data-fr-row');
        if (friendUid) bus.emit(FRIENDS_INTENT.OPEN_DETAIL, { friendUid });
      }
    }));
  }
  delegateClick(reqList);
  delegateClick(friendsList);

  // Friend detail overlay
  const detailOv  = $('#ov-friend-detail', root);
  const fdClose   = $('#fd-close', root);
  const fdGames   = $('#fd-active-games', root);

  if (fdClose) {
    cleanups.push(on(fdClose, 'click', () => {
      detailOv?.classList?.add('hidden');
    }));
  }
  if (detailOv) {
    cleanups.push(on(detailOv, 'click', (e) => {
      if (e.target === detailOv) detailOv.classList?.add('hidden');
    }));
    cleanups.push(on(detailOv, 'click', (e) => {
      const btn = e.target?.tagName === 'BUTTON' ? e.target : e.target?.closest?.('button');
      if (!btn) return;
      if (btn.hasAttribute('data-fd-invite')) {
        const uid    = detailOv.dataset.friendUid;
        const name   = detailOv.dataset.friendName;
        const avatar = detailOv.dataset.friendAvatar;
        detailOv.classList?.add('hidden');
        bus.emit(FRIENDS_INTENT.INVITE_FRIEND, { uid, name, avatar });
      }
      const enterRoomId = btn.getAttribute('data-fd-enter');
      if (enterRoomId) {
        const mySlot = Number(btn.getAttribute('data-fd-slot') ?? 0);
        detailOv.classList?.add('hidden');
        bus.emit(FRIENDS_INTENT.ENTER_GAME, { roomId: enterRoomId, mySlot });
      }
    }));
  }

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

  cleanups.push(bus.on(FRIENDS_DETAIL_RENDER, ({ friend, rivalEntry, vsRecent = [], activeGames = [], myUid } = {}) => {
    if (!detailOv || !friend) return;
    // Store friend data on overlay element for button handlers
    detailOv.dataset.friendUid    = friend.uid ?? '';
    detailOv.dataset.friendName   = friend.name ?? '';
    detailOv.dataset.friendAvatar = friend.avatar ?? '';

    const avatarEl  = $('#fd-avatar', root);
    const nameEl    = $('#fd-name', root);
    const ratingEl  = $('#fd-rating', root);
    const statsEl   = $('#fd-stats', root);
    const recentEl  = $('#fd-recent', root);

    if (avatarEl)  avatarEl.textContent  = resolveAvatar(friend.avatar, '👤');
    if (nameEl)    nameEl.textContent    = friend.name ?? '?';
    if (ratingEl)  ratingEl.textContent  = friend.rating != null ? `⭐ ${friend.rating}` : '';
    if (statsEl)   statsEl.innerHTML     = buildDetailStatsHtml(rivalEntry);
    if (recentEl)  recentEl.innerHTML    = buildDetailRecentHtml(vsRecent);
    if (fdGames)   fdGames.innerHTML     = buildDetailActiveGamesHtml(activeGames, myUid);

    detailOv.classList?.remove('hidden');
  }));

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

// Keep this in sync with friends-screen.html.
registerOnboardingContent('sfriends', {
  icon: '👥',
  title: 'חברים',
  bullets: [
    '🆔 המזהה שלך — שתף עם חברים כדי שיוסיפו אותך',
    '➕ הוסף לפי מזהה — הזן מזהה בן 6 תווים',
    '⏳ בקשות ממתינות — אשר חברים שהוסיפו אותך',
  ],
});
