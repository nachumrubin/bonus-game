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
import { avatarMarkup, setAvatarEl } from './avatarScreens.js';
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
  INVITE_CONTACTS:'friendsUi/inviteContacts',
  ENTER_GAME:     'friendsUi/enterGame',
});

// How many contacts must be invited to earn the "חבר מביא חבר" achievement.
// Mirrors INVITE_REQUIRED in inviteFriends.js — keep the two in sync.
export const REFERRAL_GOAL = 5;

export const FRIENDS_RENDER        = 'friendsUi/render';
export const FRIENDS_DETAIL_RENDER = 'friendsUi/detailRender';

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
    return `<div class="fr-empty">אין חברים עדיין</div>`;
  }
  return friends.map(f => {
    const online    = !!f.connected;
    const lastSeen  = !online && f.lastSeen ? formatLastSeen(f.lastSeen) : '';
    const ratingStr = f.rating != null ? String(f.rating) : '—';
    const dotClass  = online ? 'fr-online-dot fr-online-dot--on' : 'fr-online-dot';
    const statusText = online
      ? '🟢 מחובר כעת'
      : lastSeen ? `🟡 נראה לאחרונה ${escapeHtml(lastSeen)}` : '';
    return `<div class="fr-friend-card" data-fr-row="${escapeHtml(f.uid)}">`
      + `<div class="fr-av-wrap">`
      +   `<div class="fr-av-frame">${avatarMarkup(f.avatar, { fallback: '👤' })}</div>`
      +   `<span class="${dotClass}" aria-hidden="true"></span>`
      + `</div>`
      + `<div class="fr-friend-info">`
      +   `<div class="fr-friend-name">${escapeHtml(f.name ?? '?')}</div>`
      +   `<div class="fr-rating">⭐ ${escapeHtml(ratingStr)}</div>`
      +   `<div class="fr-friend-status">${statusText}</div>`
      + `</div>`
      + `<div class="fr-game-col">`
      +   `<button class="fr-game-btn" data-fr-menu="${escapeHtml(f.uid)}" aria-label="הזמן למשחק"><img class="fr-action-icon" src="images/icons/remote.png" alt=""></button>`
      +   `<div class="fr-game-lbl">הזמן למשחק</div>`
      + `</div>`
      + `<button class="fr-menu-btn" data-fr-menu="${escapeHtml(f.uid)}" aria-label="תפריט">⋮</button>`
      + `</div>`;
  }).join('');
}

function buildDetailStatsHtml(rival) {
  if (!rival || !rival.played) {
    return `<div class="fd-stats-empty">אין היסטוריה משותפת עדיין</div>`;
  }
  const col = (icon, val, lbl, valClass = '') =>
    `<div class="fd-stat-col">`
    + `<div class="fd-sc-icon">${icon}</div>`
    + `<div class="fd-sc-val${valClass ? ` ${valClass}` : ''}">${val}</div>`
    + `<div class="fd-sc-lbl">${lbl}</div>`
    + `</div>`;
  return col('🎮', rival.played, 'משחקים', 'fd-sc-val-gold')
    + `<div class="fd-stat-col fd-stat-mid">`
    + `<div class="fd-sc-icon">🏆</div>`
    + `<div class="fd-sc-val fd-sc-val-green">${rival.won}</div>`
    + `<div class="fd-sc-lbl">ניצחונות</div>`
    + `</div>`
    + col('🛡', rival.lost, 'הפסדים');
}

function buildDetailRecentHtml(games) {
  if (!games.length) {
    return `<div class="fd-recent-empty">אין משחקים קודמים עדיין</div>`;
  }
  return games.map(game => {
    const isWin  = game.result === 'win';
    const isLoss = game.result === 'loss';
    const resultClass = isWin ? 'fd-game-win' : isLoss ? 'fd-game-loss' : 'fd-game-draw';
    const resultIcon  = isWin ? '✓' : isLoss ? '✗' : '=';
    // direction:ltr locks the visual order so it always reads
    // "mine : theirs" left-to-right regardless of the parent's RTL flow.
    // Gold on the user's score makes "mine" unambiguous even when it's lower.
    const timeStr = game.ts ? formatLastSeen(game.ts) : '';
    return `<div class="fd-game-row">`
      + `<div class="fd-game-result ${resultClass}">${resultIcon}</div>`
      + `<div class="fd-game-scores">`
      + `<span class="fd-score-mine">${game.score}</span>`
      + `<span class="fd-score-sep">:</span>`
      + `<span class="fd-score-theirs">${game.opponentScore}</span>`
      + `</div>`
      + `<div class="fd-game-time">${escapeHtml(timeStr)}</div>`
      + `</div>`;
  }).join('');
}

function buildDetailActiveGamesHtml(activeGames, myUid) {
  if (!activeGames.length) {
    return `<div class="fd-active-empty">`
      + `<div class="fd-active-empty-icon">🎮</div>`
      + `<div id="fd-active-empty-text"></div>`
      + `</div>`;
  }
  return activeGames.map(({ roomId, room }) => {
    const mySlot = room.players?.[0]?.uid === myUid ? 0 : 1;
    const modeLabel = room.mode?.endsWith('-async') ? '🔄 אסינכרוני' : '⚡ חי';
    return `<div class="fd-active-row">`
      + `<span class="fd-active-mode">${modeLabel}</span>`
      + `<button data-fd-enter="${escapeHtml(roomId)}" data-fd-slot="${mySlot}" class="fd-enter-btn">🕹 כנס</button>`
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
  const copyBtn = $('#fr-copy-btn', root);
  if (copyBtn) {
    cleanups.push(on(copyBtn, 'click', () => bus.emit(FRIENDS_INTENT.COPY_MY_ID, {})));
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
        const menu   = btn.getAttribute?.('data-fr-menu');
        if (accept) bus.emit(FRIENDS_INTENT.ACCEPT_REQUEST, { fromUid: accept });
        if (reject) bus.emit(FRIENDS_INTENT.REJECT_REQUEST, { fromUid: reject });
        if (remove) bus.emit(FRIENDS_INTENT.REMOVE_FRIEND,  { friendUid: remove });
        if (menu)   bus.emit(FRIENDS_INTENT.OPEN_DETAIL,    { friendUid: menu });
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
  const detailOv      = $('#ov-friend-detail', root);
  const fdClose       = $('#fd-close', root);
  const fdGames       = $('#fd-active-games', root);
  const fdOverflowBtn = $('#fd-overflow-btn', root);
  const fdOverflowMenu= $('#fd-overflow-menu', root);

  if (fdClose) {
    cleanups.push(on(fdClose, 'click', () => {
      detailOv?.classList?.add('hidden');
    }));
  }

  if (fdOverflowBtn && fdOverflowMenu) {
    cleanups.push(on(fdOverflowBtn, 'click', (e) => {
      e.stopPropagation();
      fdOverflowMenu.classList.toggle('hidden');
    }));
  }

  if (detailOv) {
    cleanups.push(on(detailOv, 'click', (e) => {
      if (e.target === detailOv) detailOv.classList?.add('hidden');
      if (fdOverflowMenu && !fdOverflowMenu.classList.contains('hidden')) {
        fdOverflowMenu.classList.add('hidden');
      }
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
      if (btn.hasAttribute('data-fd-remove')) {
        const uid = detailOv.dataset.friendUid;
        detailOv.classList?.add('hidden');
        bus.emit(FRIENDS_INTENT.REMOVE_FRIEND, { friendUid: uid });
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
  const referralBar    = $('#fr-referral-bar',    root);
  const referralCount  = $('#fr-referral-count',  root);
  const inviteStatusEl = $('#fr-invite-status',   root);
  const inviteCard     = $('[data-fr-invite-contacts]', root);

  if (inviteCard) {
    cleanups.push(on(inviteCard, 'click', (e) => {
      e?.preventDefault?.();
      bus.emit(FRIENDS_INTENT.INVITE_CONTACTS, {});
    }));
  }

  function paintFriends(friends = []) {
    if (friendsList) friendsList.innerHTML = buildFriendsListHtml(friends);
    if (friendsCount) setText(friendsCount, `(${friends.length})`);
  }

  // Referral progress tracks invites sent (not real friends) — the achievement
  // is earned by inviting REFERRAL_GOAL contacts.
  function paintReferral(invitesSent = 0) {
    const sent = Math.max(0, Number(invitesSent) || 0);
    const n = Math.min(sent, REFERRAL_GOAL);
    if (referralBar)   referralBar.style.width = `${(n / REFERRAL_GOAL) * 100}%`;
    if (referralCount) setText(referralCount, `${n}/${REFERRAL_GOAL}`);
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

    if (avatarEl)  setAvatarEl(avatarEl, friend.avatar, { fallback: '👤' });
    if (nameEl)    nameEl.textContent    = friend.name ?? '?';
    if (ratingEl)  ratingEl.textContent  = friend.rating != null ? `⭐ ${friend.rating}` : '';
    if (statsEl)   statsEl.innerHTML     = buildDetailStatsHtml(rivalEntry);
    if (recentEl)  recentEl.innerHTML    = buildDetailRecentHtml(vsRecent);
    if (fdGames) {
      fdGames.innerHTML = buildDetailActiveGamesHtml(activeGames, myUid);
      const emptyTextEl = fdGames.querySelector?.('#fd-active-empty-text');
      if (emptyTextEl) emptyTextEl.textContent = `אין לך כרגע משחקים פתוחים עם ${friend.name ?? '?'}`;
    }

    detailOv.classList?.remove('hidden');
  }));

  cleanups.push(bus.on(FRIENDS_RENDER, ({ myUserId, requests, friends, copyStatus, addStatus: addS, invitesSent, inviteStatus } = {}) => {
    if (myIdEl && myUserId) setText(myIdEl, myUserId);
    if (Array.isArray(requests)) paintRequests(requests);
    if (Array.isArray(friends))  paintFriends(friends);
    if (invitesSent !== undefined) paintReferral(invitesSent);
    const copyEl = $('#fr-copy-status', root);
    if (copyEl && copyStatus !== undefined) setText(copyEl, copyStatus ?? '');
    if (addStatus && addS !== undefined) setText(addStatus, addS ?? '');
    if (inviteStatusEl && inviteStatus !== undefined) setText(inviteStatusEl, inviteStatus ?? '');
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
