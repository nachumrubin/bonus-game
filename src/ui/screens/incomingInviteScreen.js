// incomingInviteScreen — Phase 2 takeover for #ov-incoming-invite +
// #ov-invite-rejected.
//
// Pairs with inviteService.listenForInvites (recipient side) and
// listenForInviteAcks (sender side). The flow:
//
//   sender                              recipient
//   ──────                              ─────────
//                inviteService.sendInvite (no room yet)
//                                        listenForInvites fires
//                                        II_OPEN paints overlay
//                                            ↓ user clicks accept/reject
//                                        II_INTENT.ACCEPT / .REJECT
//   listenForInviteAcks fires           inviteService.acceptInvite / .rejectInvite
//      ↓ if rejected, IR_OPEN
//   ov-invite-rejected shows
//
// Screen plumbing only — main.js owns the inviteService calls and the
// followup createRoom(host+guest) on accept.

import { $, on, setText } from '../domHelpers.js';
import { setAvatarEl } from './avatarScreens.js';

export const II_INTENT = Object.freeze({
  ACCEPT: 'incomingInvite/accept',
  REJECT: 'incomingInvite/reject',
});

export const IR_INTENT = Object.freeze({
  CLOSE: 'inviteRejected/close',
});

export const II_OPEN  = 'incomingInvite/open';
export const II_CLOSE = 'incomingInvite/close';
export const IR_OPEN  = 'inviteRejected/open';
export const IR_CLOSE = 'inviteRejected/close';

const MODE_LABEL = {
  'friend-live':  'משחק לייב',
  'friend-async': 'משחק אסינכרוני',
  live:           'משחק לייב',
  async:          'משחק אסינכרוני',
};

export function mountIncomingInviteScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountIncomingInviteScreen: bus required');

  const overlay = $('#ov-incoming-invite', root);
  const avatarEl = $('#ii-avatar', root);
  const bodyEl   = $('#ii-body', root);
  const acceptBtn = $('button[onclick="_acceptIncomingInvite()"]', root);
  const rejectBtn = $('button[onclick="_dismissIncomingInvite()"]', root);

  const rejectedOverlay = $('#ov-invite-rejected', root);
  const rejectedDescEl  = $('#invite-rejected-desc', root);
  const rejectedCloseBtn = $('button[onclick="closeInviteRejectedNotice()"]', root);

  let pendingInvite = null;
  const cleanups = [];

  if (acceptBtn) {
    acceptBtn.removeAttribute?.('onclick');
    cleanups.push(on(acceptBtn, 'click', () => {
      bus.emit(II_INTENT.ACCEPT, pendingInvite ?? {});
      overlay?.classList?.add?.('hidden');
    }));
  }
  if (rejectBtn) {
    rejectBtn.removeAttribute?.('onclick');
    cleanups.push(on(rejectBtn, 'click', () => {
      bus.emit(II_INTENT.REJECT, pendingInvite ?? {});
      overlay?.classList?.add?.('hidden');
    }));
  }
  if (rejectedCloseBtn) {
    rejectedCloseBtn.removeAttribute?.('onclick');
    cleanups.push(on(rejectedCloseBtn, 'click', () => {
      bus.emit(IR_INTENT.CLOSE, {});
    }));
  }

  const offOpen = bus.on(II_OPEN, (invite = {}) => {
    pendingInvite = invite;
    if (avatarEl) setAvatarEl(avatarEl, invite.fromAvatar, { fallback: '👤' });
    if (bodyEl) {
      const modeLabel = MODE_LABEL[invite.mode] ?? '';
      const fromName = invite.fromName ?? 'שחקן';
      setText(bodyEl, modeLabel ? `${fromName} מזמין אותך ל${modeLabel}` : `${fromName} מזמין אותך למשחק`);
    }
    overlay?.classList?.remove?.('hidden');
  });
  const offClose = bus.on(II_CLOSE, () => {
    pendingInvite = null;
    overlay?.classList?.add?.('hidden');
  });
  const offRejOpen = bus.on(IR_OPEN, ({ message } = {}) => {
    if (rejectedDescEl) setText(rejectedDescEl, message ?? 'השחקן שהזמנת לא זמין כרגע.');
    rejectedOverlay?.classList?.remove?.('hidden');
  });
  const offRejClose = bus.on(IR_CLOSE, () => {
    rejectedOverlay?.classList?.add?.('hidden');
  });

  function unmount() {
    for (const off of cleanups) try { off(); } catch {}
    try { offOpen(); offClose(); offRejOpen(); offRejClose(); } catch {}
    cleanups.length = 0;
    pendingInvite = null;
  }

  // Test/inspection helper
  function getPending() { return pendingInvite; }

  return { unmount, getPending };
}
