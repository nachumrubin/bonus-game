import { $, on, setText } from '../domHelpers.js';

export const RESIGN_INTENT = Object.freeze({
  CONFIRM: 'resign/confirm',
  CANCEL: 'resign/cancel',
});

export const RESIGN_OPEN = 'overlay/resign/open';
export const RESIGN_CLOSE = 'overlay/resign/close';

export function mountResignConfirmScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountResignConfirmScreen: bus required');
  const overlay = $('#ov-resign-confirm', root);
  if (!overlay) {
    console.warn('[resignConfirmScreen] #ov-resign-confirm not found - not mounted');
    return { unmount() {} };
  }

  const cleanups = [];
  let currentPayload = {};

  const msg = $('#resign-confirm-msg', overlay);
  const confirm = $('#resign-confirm-yes', overlay);
  const cancel = $('#resign-confirm-no', overlay);

  cleanups.push(on(confirm, 'click', (e) => {
    e.preventDefault?.();
    overlay.classList?.add('hidden');
    bus.emit(RESIGN_INTENT.CONFIRM, currentPayload);
  }));
  cleanups.push(on(cancel, 'click', (e) => {
    e.preventDefault?.();
    overlay.classList?.add('hidden');
    bus.emit(RESIGN_INTENT.CANCEL, currentPayload);
  }));

  cleanups.push(bus.on(RESIGN_OPEN, (payload = {}) => {
    currentPayload = payload;
    if (payload.playerName) setText(msg, `${payload.playerName}, לפרוש מהמשחק?`);
    overlay.classList?.remove('hidden');
  }));
  cleanups.push(bus.on(RESIGN_CLOSE, () => overlay.classList?.add('hidden')));

  function unmount() {
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { unmount };
}
