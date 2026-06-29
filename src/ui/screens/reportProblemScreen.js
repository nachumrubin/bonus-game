// Contact overlay (#ov-report). The "report a game problem" reason still
// sends the debug timeline context; other reasons use the same report channel.

import { $, on, setText } from '../domHelpers.js';
import { MENU_INTENT } from './menuScreen.js';

export const REPORT_SUBMIT = 'report/submit';   // { reason, userMessage }
export const REPORT_DONE   = 'report/done';     // { ok }

export function mountReportProblemScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountReportProblemScreen: bus required');
  const overlay = $('#ov-report', root);
  if (!overlay) { console.warn('[reportProblem] #ov-report not found - not mounted'); return { unmount() {} }; }

  const cleanups = [];
  const input = $('#report-message', overlay);
  const reason = $('#report-reason', overlay);
  const status = $('#report-status', overlay);
  const sendBtn = $('#report-send', overlay);
  const cancelBtn = $('#report-cancel', overlay);

  function open() {
    if (input) input.value = '';
    if (reason) reason.value = 'game-bug';
    setText(status, '');
    overlay.classList?.remove('hidden');
    reason?.focus?.();
  }

  function close() {
    overlay.classList?.add('hidden');
  }

  cleanups.push(bus.on(MENU_INTENT.OPEN_REPORT_PROBLEM, open));

  if (cancelBtn) cleanups.push(on(cancelBtn, 'click', close));
  if (sendBtn) {
    cleanups.push(on(sendBtn, 'click', () => {
      const userMessage = (input?.value ?? '').trim();
      const contactReason = reason?.value || 'game-bug';
      setText(status, 'שולח פנייה...');
      bus.emit(REPORT_SUBMIT, { reason: contactReason, userMessage });
    }));
  }

  cleanups.push(bus.on(REPORT_DONE, ({ ok = true } = {}) => {
    if (ok) {
      setText(status, 'תודה! הפנייה נשלחה');
      setTimeout(close, 1200);
    } else {
      setText(status, 'שליחת הפנייה נכשלה');
    }
  }));

  function unmount() {
    for (const off of cleanups) { try { off(); } catch { /* swallow */ } }
    cleanups.length = 0;
  }

  return { unmount };
}
