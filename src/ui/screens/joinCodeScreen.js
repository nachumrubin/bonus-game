// joinCodeScreen — Phase 2 takeover for #ov-join-code.
//
// Reads the 6-digit code + display name on confirm-click and emits
// JC_INTENT.CONFIRM. main.js (under ?takeover=online) calls
// roomCodeService.claimByCode with the result, then mounts the online
// game session via startOnlineGameViaSpine.
//
// Code validation (must be exactly 6 digits) is done both by the legacy
// inline `oninput` filter (digits only, max 6) AND here at click time.
// We surface a JC_INTENT.ERROR for invalid codes so main.js can paint
// #jc-error if it wants to (we don't touch the DOM error label here).

import { $, on, setText } from '../domHelpers.js';

export const JC_INTENT = Object.freeze({
  CONFIRM: 'joinCode/confirm',
  CANCEL:  'joinCode/cancel',
  ERROR:   'joinCode/error',
});

const CODE_RE = /^\d{6}$/;

export function readJoinCodeInputs(root = globalThis.document) {
  const code = ($('#jc-code', root)?.value ?? '').trim();
  const name = ($('#jc-name', root)?.value ?? '').trim() || 'שחקן 2';
  return { code, name };
}

export function mountJoinCodeScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountJoinCodeScreen: bus required');

  const cleanups = [];
  const errEl   = $('#jc-error', root);
  const confirm = $('button[onclick="jcConfirm()"]', root);
  const cancel  = $('button[onclick="ovClose(\'ov-join-code\')"]', root);

  if (confirm) {
    confirm.removeAttribute?.('onclick');
    cleanups.push(on(confirm, 'click', () => {
      const { code, name } = readJoinCodeInputs(root);
      if (!CODE_RE.test(code)) {
        if (errEl) setText(errEl, 'הקוד חייב להכיל 6 ספרות');
        bus.emit(JC_INTENT.ERROR, { reason: 'invalid-code', code });
        return;
      }
      if (errEl) setText(errEl, '');
      bus.emit(JC_INTENT.CONFIRM, { code, name });
    }));
  }
  if (cancel) {
    cancel.removeAttribute?.('onclick');
    cleanups.push(on(cancel, 'click', () => bus.emit(JC_INTENT.CANCEL, {})));
  }

  // Allow main.js to surface server-side errors back to the user.
  const offError = bus.on(JC_INTENT.ERROR, (payload = {}) => {
    if (!errEl) return;
    if (payload.reason === 'invalid-code')      setText(errEl, 'הקוד חייב להכיל 6 ספרות');
    else if (payload.reason === 'not-found')    setText(errEl, 'לא נמצא משחק עם הקוד הזה');
    else if (payload.reason === 'expired')      setText(errEl, 'הקוד פג תוקף');
    else if (payload.reason === 'self-claim')   setText(errEl, 'אי אפשר להצטרף למשחק שיצרת');
    else if (payload.reason === 'already-claimed') setText(errEl, 'מישהו כבר הצטרף למשחק הזה');
    else if (payload.message)                   setText(errEl, payload.message);
  });

  function unmount() {
    for (const off of cleanups) try { off(); } catch {}
    try { offError(); } catch {}
    cleanups.length = 0;
  }

  return { unmount };
}
