// waitingRoomScreen — Phase 2 takeover for #ov-waiting-room.
//
// The host has just created a shareable code; we show it, listen for the
// guest to claim, and expose cancel + WhatsApp share. Friend-invite
// (#wr-invite-name + #wr-invite-status) lives in the legacy-managed lower
// section for now; the spine-side equivalent is `inviteService.sendInvite`
// and will be migrated in slice 2d.

import { $, on, setText } from '../domHelpers.js';
import { g, getGender } from '../genderText.js';

export const WR_INTENT = Object.freeze({
  CANCEL:              'waitingRoom/cancel',
  SHARE_WHATSAPP:      'waitingRoom/shareWhatsApp',
  LIVE_INVITE_EXPIRED: 'waitingRoom/liveInviteExpired',
});

export const WR_OPEN             = 'waitingRoom/open';
export const WR_CLOSE            = 'waitingRoom/close';
// Emitted by main.js after a live friend-invite is sent successfully.
// Payload: { expiresAt: number } — epoch ms when the invite expires.
export const WR_LIVE_INVITE_SENT = 'waitingRoom/liveInviteSent';

const MODE_LABEL = {
  'friend-live':  '⚡ משחק לייב',
  'friend-async': '📬 משחק אסינכרוני',
  live:           '⚡ משחק לייב',
  async:          '📬 משחק אסינכרוני',
};

export function mountWaitingRoomScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountWaitingRoomScreen: bus required');

  const overlay        = $('#ov-waiting-room', root);
  const titleEl        = $('#wr-title', root);
  const codeEl         = $('#wr-code', root);
  const codeSect       = $('#wr-code-section', root);
  const modeEl         = $('#wr-mode-label', root);
  const cancelBtn      = $('#wr-cancel-btn', root) ?? $('button[onclick="crCancelRoom()"]', root);
  const shareBtn       = $('#wr-share-btn', root)  ?? $('button[onclick="crShareWhatsApp()"]', root);
  const inviteSect     = $('#wr-invite-section', root);
  const inviteInput    = $('#wr-invite-name', root);
  const inviteDropdown = $('#wr-invite-dropdown', root);
  const inviteStatus   = $('#wr-invite-status', root);
  const countdownEl    = $('#wr-countdown', root);

  let countdownTimer = null;

  function clearCountdown() {
    globalThis.clearInterval?.(countdownTimer);
    countdownTimer = null;
    if (countdownEl) countdownEl.style.display = 'none';
  }

  function startCountdown(expiresAt) {
    clearCountdown();
    if (!countdownEl) return;
    countdownEl.style.display = '';
    function tick() {
      const remaining = Math.max(0, expiresAt - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setText(countdownEl, `ההזמנה תפוג בעוד ${mins}:${String(secs).padStart(2, '0')}`);
      if (remaining <= 0) {
        globalThis.clearInterval?.(countdownTimer);
        countdownTimer = null;
        bus.emit(WR_INTENT.LIVE_INVITE_EXPIRED, {});
      }
    }
    tick();
    countdownTimer = globalThis.setInterval?.(tick, 1000);
  }

  function switchToFriendMode(name) {
    if (titleEl)    setText(titleEl, `ממתין ל${name}...`);
    if (codeSect)   codeSect.style.display   = 'none';
    if (shareBtn)   shareBtn.style.display   = 'none';
    if (inviteSect) inviteSect.style.display = 'none';
    if (modeEl)     modeEl.style.display     = 'none';
    if (cancelBtn)  { cancelBtn.style.flex = '1 1 100%'; cancelBtn.style.maxWidth = '100%'; }
  }

  function resetToNormalMode() {
    if (titleEl)    setText(titleEl, 'ממתין לשחקן שני...');
    if (codeSect)   codeSect.style.display   = '';
    if (shareBtn)   shareBtn.style.display   = '';
    if (inviteSect) inviteSect.style.display = '';
    if (modeEl)     modeEl.style.display     = '';
    if (cancelBtn)  { cancelBtn.style.flex = ''; cancelBtn.style.maxWidth = ''; }
  }

  const cleanups = [];
  if (cancelBtn) {
    cancelBtn.removeAttribute?.('onclick');
    cleanups.push(on(cancelBtn, 'click', () => bus.emit(WR_INTENT.CANCEL, {})));
  }
  if (shareBtn) {
    shareBtn.removeAttribute?.('onclick');
    cleanups.push(on(shareBtn, 'click', () => bus.emit(WR_INTENT.SHARE_WHATSAPP, {})));
  }

  // Close the friend dropdown when the input loses focus. The dropdown items
  // use onmousedown="event.preventDefault()" so clicking them doesn't blur
  // the input, letting the onclick fire first.
  if (inviteInput && inviteDropdown) {
    cleanups.push(on(inviteInput, 'blur', () => {
      inviteDropdown.style.display = 'none';
    }));
  }

  function resetInviteFields() {
    if (inviteInput)    { inviteInput.value = ''; delete inviteInput.dataset.selectedUid; }
    if (inviteDropdown) { inviteDropdown.innerHTML = ''; inviteDropdown.style.display = 'none'; }
    if (inviteStatus)   { inviteStatus.textContent = ''; inviteStatus.style.color = ''; }
  }

  const offOpen = bus.on(WR_OPEN, ({ code, mode, friendName, isAuthed } = {}) => {
    if (codeEl && code) setText(codeEl, code);
    if (modeEl && mode) setText(modeEl, MODE_LABEL[mode] ?? '');
    resetInviteFields();
    clearCountdown();
    if (friendName) switchToFriendMode(friendName);
    else resetToNormalMode();
    // Visitors (anonymous) have no friends list to invite from
    if (inviteSect && isAuthed !== undefined) {
      inviteSect.style.display = (isAuthed && !friendName) ? '' : 'none';
    }
    overlay?.classList?.remove?.('hidden');
  });
  const offClose = bus.on(WR_CLOSE, () => {
    overlay?.classList?.add?.('hidden');
    resetInviteFields();
    clearCountdown();
    resetToNormalMode();
  });
  const offLiveInviteSent = bus.on(WR_LIVE_INVITE_SENT, ({ expiresAt, friendName } = {}) => {
    if (friendName) switchToFriendMode(friendName);
    if (expiresAt) startCountdown(expiresAt);
  });

  function unmount() {
    clearCountdown();
    for (const off of cleanups) try { off(); } catch {}
    try { offOpen(); offClose(); offLiveInviteSent(); } catch {}
    cleanups.length = 0;
  }

  return { unmount };
}

// Helper for callers that don't have a bus context handy: build the
// WhatsApp share URL the legacy app uses.
export function buildWhatsAppShareUrl(code, gender) {
  const come = g('shareGameMsg', gender ?? getGender());
  const msg =
    `!הי, ${come} בוסט ביחד\nהקוד שלי: *${code}*\nפתח את המשחק ולחץ "הצטרף לפי קוד"`;
  return 'https://wa.me/?text=' + encodeURIComponent(msg);
}
