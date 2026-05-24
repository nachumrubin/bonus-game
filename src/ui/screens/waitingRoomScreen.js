// waitingRoomScreen — Phase 2 takeover for #ov-waiting-room.
//
// The host has just created a shareable code; we show it, listen for the
// guest to claim, and expose cancel + WhatsApp share. Friend-invite
// (#wr-invite-name + #wr-invite-status) lives in the legacy-managed lower
// section for now; the spine-side equivalent is `inviteService.sendInvite`
// and will be migrated in slice 2d.

import { $, on, setText } from '../domHelpers.js';

export const WR_INTENT = Object.freeze({
  CANCEL:         'waitingRoom/cancel',
  SHARE_WHATSAPP: 'waitingRoom/shareWhatsApp',
});

export const WR_OPEN  = 'waitingRoom/open';
export const WR_CLOSE = 'waitingRoom/close';

const MODE_LABEL = {
  'friend-live':  '⚡ משחק לייב',
  'friend-async': '📬 משחק אסינכרוני',
  live:           '⚡ משחק לייב',
  async:          '📬 משחק אסינכרוני',
};

export function mountWaitingRoomScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountWaitingRoomScreen: bus required');

  const overlay = $('#ov-waiting-room', root);
  const codeEl  = $('#wr-code', root);
  const modeEl  = $('#wr-mode-label', root);
  const cancelBtn = $('button[onclick="crCancelRoom()"]', root);
  const shareBtn  = $('button[onclick="crShareWhatsApp()"]', root);

  const cleanups = [];
  if (cancelBtn) {
    // Strip the legacy inline handler — `crCancelRoom`/`crShareWhatsApp`
    // aren't defined in the spine, so leaving onclick attached produces
    // "ReferenceError: crCancelRoom is not defined" alongside our bus
    // dispatch.
    cancelBtn.removeAttribute('onclick');
    cleanups.push(on(cancelBtn, 'click', () => bus.emit(WR_INTENT.CANCEL, {})));
  }
  if (shareBtn) {
    shareBtn.removeAttribute('onclick');
    cleanups.push(on(shareBtn, 'click', () => bus.emit(WR_INTENT.SHARE_WHATSAPP, {})));
  }

  const offOpen = bus.on(WR_OPEN, ({ code, mode } = {}) => {
    if (codeEl && code) setText(codeEl, code);
    if (modeEl && mode) setText(modeEl, MODE_LABEL[mode] ?? '');
    overlay?.classList?.remove?.('hidden');
  });
  const offClose = bus.on(WR_CLOSE, () => {
    overlay?.classList?.add?.('hidden');
  });

  function unmount() {
    for (const off of cleanups) try { off(); } catch {}
    try { offOpen(); } catch {}
    try { offClose(); } catch {}
    cleanups.length = 0;
  }

  return { unmount };
}

// Helper for callers that don't have a bus context handy: build the
// WhatsApp share URL the legacy app uses.
export function buildWhatsAppShareUrl(code) {
  const msg =
    `!הי, בוא נשחק בוסט ביחד\nהקוד שלי: *${code}*\nפתח את המשחק ולחץ "הצטרף לפי קוד"`;
  return 'https://wa.me/?text=' + encodeURIComponent(msg);
}
