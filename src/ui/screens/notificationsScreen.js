// notificationsScreen — wires #snotif (the notification inbox).
//
// Shows pending game invites and friend requests with per-item
// accept / reject buttons. All Firebase work happens in main.js;
// this module is pure presentational + intent-emitting.

import { $, on } from '../domHelpers.js';
import { avatarMarkup, setAvatarEl } from './avatarScreens.js';
import { MENU_INTENT } from './menuScreen.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

export const NOTIF_BANNER_SHOW = 'notif/bannerShow';

export const NOTIF_INTENT = Object.freeze({
  ACCEPT_INVITE: 'notif/acceptInvite',
  REJECT_INVITE: 'notif/rejectInvite',
  ACCEPT_FRIEND: 'notif/acceptFriend',
  REJECT_FRIEND: 'notif/rejectFriend',
  MARK_SUPPORT_REPLY_READ: 'notif/markSupportReplyRead',
  BACK:          'notif/back',
});

export const NOTIF_RENDER = 'notif/render';

const MODE_LABEL = {
  'friend-live':  'משחק לייב',
  'friend-async': 'משחק אסינכרוני',
  'random-live':  'משחק לייב',
  'random-async': 'משחק אסינכרוני',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function buildInviteHtml(invite) {
  const avatar = avatarMarkup(invite.fromAvatar, { fallback: '🎮' });
  const name   = escapeHtml(invite.fromName ?? 'שחקן');
  const mode   = escapeHtml(MODE_LABEL[invite.mode] ?? 'משחק');
  const id     = escapeHtml(invite.inviteId);
  return (
    `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.05);border-radius:8px;margin-bottom:6px;">`
    + `<div style="font-size:24px;flex-shrink:0;">${avatar}</div>`
    + `<div style="flex:1;min-width:0;">`
    +   `<div style="font-size:13px;font-weight:700;color:#fff;">${name}</div>`
    +   `<div style="font-size:11px;color:rgba(255,255,255,.5);">${mode}</div>`
    + `</div>`
    + `<button data-notif-accept-invite="${id}" style="background:#1ed760;border:none;border-radius:6px;padding:5px 10px;font-family:Heebo,sans-serif;font-size:12px;font-weight:900;color:#000;cursor:pointer;">הצטרף</button>`
    + `<button data-notif-reject-invite="${id}" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:5px 10px;font-family:Heebo,sans-serif;font-size:12px;color:rgba(255,255,255,.7);cursor:pointer;">דחה</button>`
    + `</div>`
  );
}

function buildFriendRequestHtml(req) {
  const avatar = avatarMarkup(req.fromAvatar, { fallback: '👤' });
  const name   = escapeHtml(req.fromName ?? req.fromUid ?? 'שחקן');
  const uid    = escapeHtml(req.fromUid);
  return (
    `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.05);border-radius:8px;margin-bottom:6px;">`
    + `<div style="font-size:24px;flex-shrink:0;">${avatar}</div>`
    + `<div style="flex:1;min-width:0;">`
    +   `<div style="font-size:13px;font-weight:700;color:#fff;">${name}</div>`
    +   `<div style="font-size:11px;color:rgba(255,255,255,.5);">בקשת חברות</div>`
    + `</div>`
    + `<button data-notif-accept-friend="${uid}" style="background:#1ed760;border:none;border-radius:6px;padding:5px 10px;font-family:Heebo,sans-serif;font-size:12px;font-weight:900;color:#000;cursor:pointer;">קבל</button>`
    + `<button data-notif-reject-friend="${uid}" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:5px 10px;font-family:Heebo,sans-serif;font-size:12px;color:rgba(255,255,255,.7);cursor:pointer;">דחה</button>`
    + `</div>`
  );
}

function supportReplyTime(reply) {
  const ms = reply?.createdAt ?? reply?.respondedAt ?? null;
  return typeof ms === 'number' && Number.isFinite(ms)
    ? new Date(ms).toLocaleString('he-IL')
    : '';
}

function buildSupportReplyHtml(reply) {
  const id = escapeHtml(reply.id ?? reply.notificationId ?? '');
  const title = escapeHtml(reply.title ?? 'עדכון לפנייה שלך');
  const message = escapeHtml(reply.message ?? '');
  const originalMessage = escapeHtml(reply.originalMessage ?? '');
  const reason = escapeHtml(reply.reasonLabel ?? reply.reason ?? '');
  const outcome = escapeHtml(reply.outcomeLabel ?? reply.outcome ?? '');
  const when = escapeHtml(supportReplyTime(reply));
  return (
    `<div class="nf-support-card">`
    + `<div style="flex:1;min-width:0;">`
    +   `<div style="font-size:13px;font-weight:900;color:#fff;">${title}</div>`
    +   `<div style="font-size:12px;line-height:1.45;color:rgba(255,255,255,.78);white-space:pre-wrap;overflow-wrap:anywhere;">${message}</div>`
    +   `${originalMessage ? `<div class="nf-support-original"><span>הפנייה המקורית:</span>${originalMessage}</div>` : ''}`
    +   `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:10px;color:rgba(255,255,255,.48);">`
    +     `${outcome ? `<span>${outcome}</span>` : ''}`
    +     `${reason ? `<span>${reason}</span>` : ''}`
    +     `${when ? `<span>${when}</span>` : ''}`
    +   `</div>`
    + `</div>`
    + `<button data-notif-read-support="${id}" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:5px 10px;font-family:Heebo,sans-serif;font-size:12px;color:rgba(255,255,255,.85);cursor:pointer;">סמן כנקרא</button>`
    + `</div>`
  );
}

export function mountNotificationsScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountNotificationsScreen: bus required');

  const emptyEl     = $('#notif-empty',        root);
  const invitesWrap = $('#notif-invites-wrap', root);
  const invitesList = $('#notif-invites-list', root);
  const friendsWrap = $('#notif-friends-wrap', root);
  const friendsList = $('#notif-friends-list', root);
  const supportWrap = $('#notif-support-wrap', root);
  const supportList = $('#notif-support-list', root);

  let currentInvites        = [];
  let currentFriendRequests = [];
  let currentSupportReplies = [];

  const cleanups = [];

  function delegateClick(container) {
    if (!container?.addEventListener) return;
    cleanups.push(on(container, 'click', (e) => {
      const btn = e.target?.tagName === 'BUTTON' ? e.target : e.target?.closest?.('button');
      if (!btn) return;
      const acceptInvite = btn.getAttribute?.('data-notif-accept-invite');
      const rejectInvite = btn.getAttribute?.('data-notif-reject-invite');
      const acceptFriend = btn.getAttribute?.('data-notif-accept-friend');
      const rejectFriend = btn.getAttribute?.('data-notif-reject-friend');
      const readSupport = btn.getAttribute?.('data-notif-read-support');
      if (acceptInvite) {
        const inv = currentInvites.find(i => i.inviteId === acceptInvite);
        bus.emit(NOTIF_INTENT.ACCEPT_INVITE, inv ?? { inviteId: acceptInvite });
      }
      if (rejectInvite) {
        const inv = currentInvites.find(i => i.inviteId === rejectInvite);
        bus.emit(NOTIF_INTENT.REJECT_INVITE, inv ?? { inviteId: rejectInvite });
      }
      if (acceptFriend) bus.emit(NOTIF_INTENT.ACCEPT_FRIEND, { fromUid: acceptFriend });
      if (rejectFriend) bus.emit(NOTIF_INTENT.REJECT_FRIEND, { fromUid: rejectFriend });
      if (readSupport) bus.emit(NOTIF_INTENT.MARK_SUPPORT_REPLY_READ, { id: readSupport });
    }));
  }

  delegateClick(invitesList);
  delegateClick(friendsList);
  delegateClick(supportList);

  function repaint() {
    const hasInvites   = currentInvites.length > 0;
    const hasRequests  = currentFriendRequests.length > 0;
    const hasSupport   = currentSupportReplies.length > 0;
    const isEmpty      = !hasInvites && !hasRequests && !hasSupport;

    if (emptyEl)     emptyEl.style.display     = isEmpty      ? '' : 'none';
    if (invitesWrap) invitesWrap.style.display  = hasInvites  ? '' : 'none';
    if (friendsWrap) friendsWrap.style.display  = hasRequests ? '' : 'none';
    if (supportWrap) supportWrap.style.display  = hasSupport  ? '' : 'none';
    if (invitesList) invitesList.innerHTML       = currentInvites.map(buildInviteHtml).join('');
    if (friendsList) friendsList.innerHTML       = currentFriendRequests.map(buildFriendRequestHtml).join('');
    if (supportList) supportList.innerHTML       = currentSupportReplies.map(buildSupportReplyHtml).join('');
  }

  cleanups.push(bus.on(NOTIF_RENDER, ({ invites, friendRequests, supportReplies } = {}) => {
    if (Array.isArray(invites))        currentInvites        = invites;
    if (Array.isArray(friendRequests)) currentFriendRequests = friendRequests;
    if (Array.isArray(supportReplies)) currentSupportReplies = supportReplies;
    repaint();
  }));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}

// Slide-down banner — replaces the blocking popup overlays for incoming
// game invites and rejected-invite notices. Slides in from behind the
// top bar, auto-dismisses after 7 s, or dismisses immediately on click.
// action === 'openNotifications' navigates to the inbox on click.
export function mountNotifBanner({ root = globalThis.document, bus } = {}) {
  if (!bus) return { unmount() {} };
  const banner   = $('#notif-banner', root);
  const avatarEl = $('#notif-banner-avatar', root);
  const textEl   = $('#notif-banner-text', root);
  if (!banner) return { unmount() {} };

  let dismissTimer  = null;
  let currentAction = 'dismiss';

  function hide() {
    globalThis.clearTimeout?.(dismissTimer);
    dismissTimer = null;
    banner.classList.remove('notif-banner--shown');
  }

  const cleanups = [];

  cleanups.push(on(banner, 'click', () => {
    if (currentAction === 'openNotifications') {
      bus.emit(MENU_INTENT.OPEN_NOTIFICATIONS, { source: 'banner' });
    } else if (currentAction === 'openSettings') {
      bus.emit(MENU_INTENT.OPEN_SETTINGS);
    }
    hide();
  }));

  cleanups.push(bus.on(NOTIF_BANNER_SHOW, ({ avatar, text, action } = {}) => {
    if (avatarEl) setAvatarEl(avatarEl, avatar, { fallback: '🔔' });
    if (textEl)   textEl.textContent   = text   ?? '';
    currentAction = action ?? 'dismiss';
    globalThis.clearTimeout?.(dismissTimer);
    banner.classList.add('notif-banner--shown');
    dismissTimer = globalThis.setTimeout?.(() => hide(), 7000);
  }));

  return {
    unmount() {
      globalThis.clearTimeout?.(dismissTimer);
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}

// Keep this in sync with notifications-inbox.html.
registerOnboardingContent('snotif', {
  icon: '🔔',
  title: 'הזמנות',
  bullets: [
    '🎮 הזמנות למשחק — קבל או דחה הזמנות',
    '👥 בקשות חברות — אשר שחקנים שהוסיפו אותך',
    'עדכוני פניות — קבל תשובות מהצוות על דיווחים והצעות',
  ],
});
