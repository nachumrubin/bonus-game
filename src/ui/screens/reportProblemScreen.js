// Report-a-problem overlay (#ov-report) for the Game Debug Timeline.
//
// Opened from the help dropdown ("דווח על בעיה במשחק"). It only collects the
// user's message; main.js builds the full report (env, last actions, local
// snapshot, last event id) and writes it to /debugReports, then emits
// REPORT_DONE with a status to show here.

import { $, on, setText } from '../domHelpers.js';
import { MENU_INTENT } from './menuScreen.js';

export const REPORT_SUBMIT = 'report/submit';   // { userMessage }
export const REPORT_DONE   = 'report/done';     // { ok }

export function mountReportProblemScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountReportProblemScreen: bus required');
  const overlay = $('#ov-report', root);
  if (!overlay) { console.warn('[reportProblem] #ov-report not found — not mounted'); return { unmount() {} }; }

  const cleanups = [];
  const input  = $('#report-message', overlay);
  const status = $('#report-status', overlay);
  const sendBtn = $('#report-send', overlay);
  const cancelBtn = $('#report-cancel', overlay);

  function open() {
    if (input) input.value = '';
    setText(status, '');
    overlay.classList?.remove('hidden');
    input?.focus?.();
  }
  function close() { overlay.classList?.add('hidden'); }

  cleanups.push(bus.on(MENU_INTENT.OPEN_REPORT_PROBLEM, open));

  if (cancelBtn) cleanups.push(on(cancelBtn, 'click', close));
  if (sendBtn) {
    cleanups.push(on(sendBtn, 'click', () => {
      const userMessage = (input?.value ?? '').trim();
      setText(status, 'שולח...');
      bus.emit(REPORT_SUBMIT, { userMessage });
    }));
  }

  cleanups.push(bus.on(REPORT_DONE, ({ ok = true } = {}) => {
    if (ok) { setText(status, 'תודה! הדיווח נשלח ✓'); setTimeout(close, 1200); }
    else setText(status, 'שליחת הדיווח נכשלה');
  }));

  function unmount() {
    for (const off of cleanups) { try { off(); } catch { /* swallow */ } }
    cleanups.length = 0;
  }
  return { unmount };
}
