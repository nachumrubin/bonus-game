// asyncSessionListScreen — renders the list of in-flight async games
// inside the lobby's #online-sessions-wrap.
//
// Data comes from `asyncSessionService.listAsyncSessions(db, uid)` which
// reads from the per-user index. This module is purely presentational —
// it accepts a `sessions` array on AS_RENDER and emits AS_INTENT.RESUME /
// AS_INTENT.DISMISS on user clicks; it does not touch Firebase directly.
//
// Renders into the legacy DOM under the existing `#online-sessions-wrap`
// container. Replaces the legacy localStorage-backed `checkForOnlineSession`
// renderer at index.html:11456 — but only when the bus emits AS_RENDER, so
// legacy + spine paths can coexist while the cutover finishes.

import { $, on } from '../domHelpers.js';

export const AS_INTENT = Object.freeze({
  RESUME:  'asyncSessionList/resume',
  DISMISS: 'asyncSessionList/dismiss',
});

export const AS_RENDER = 'asyncSessionList/render';

const MODE_ICON = {
  'random-async': '📬',
  'friend-async': '📬',
  'random-live':  '⚡',
  'friend-live':  '⚡',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&',  '&amp;')
    .replaceAll('<',  '&lt;')
    .replaceAll('>',  '&gt;')
    .replaceAll('"',  '&quot;')
    .replaceAll('\'', '&#39;');
}

export function timeAgoLabel(ts, now) {
  if (!ts) return '';
  const mins = Math.max(0, Math.floor((now - ts) / 60_000));
  if (mins < 60)   return `${mins} דק`;
  if (mins < 1440) return `${Math.floor(mins / 60)} שע`;
  return `${Math.floor(mins / 1440)} ימים`;
}

export function buildListHtml(sessions, { now = Date.now() } = {}) {
  if (!sessions?.length) return '';
  const rows = sessions.map((s) => {
    const ic = MODE_ICON[s.mode] ?? '📬';
    const turnLabel = s.isMyTurn ? 'תורך' : `תור ${escapeHtml(s.opponentName)}`;
    const turnCls = s.isMyTurn ? 'mine' : 'theirs';
    const ago = timeAgoLabel(s.lastUpdated, now);
    return ''
      + '<div class="async-row" style="display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid rgba(255,255,255,.07);">'
      +   '<div style="flex:1;min-width:0;">'
      +     `<div style="font-size:12px;font-weight:900;color:#fff;">${ic} נגד ${escapeHtml(s.opponentName)} - <span class="async-turn ${turnCls}">${turnLabel}</span></div>`
      +     `<div style="font-size:9px;color:rgba(255,255,255,.35);">${ago ? 'לפני ' + ago : ''}</div>`
      +   '</div>'
      +   `<button data-resume="${escapeHtml(s.roomId)}" style="background:#e8c840;border:none;border-radius:5px;font-family:Heebo,sans-serif;font-size:11px;font-weight:900;color:#000;padding:5px 10px;cursor:pointer;">המשך</button>`
      +   `<button data-dismiss="${escapeHtml(s.roomId)}" aria-label="הסר" style="background:none;border:none;font-size:15px;color:rgba(255,255,255,.3);padding:2px 6px;cursor:pointer;">×</button>`
      + '</div>';
  }).join('');
  return ''
    + '<div style="background:rgba(0,0,0,.18);border-radius:8px;padding:8px;">'
    +   '<div style="font-size:10px;color:rgba(255,255,255,.5);font-weight:700;text-align:center;margin-bottom:4px;">משחקים פעילים</div>'
    +   rows
    + '</div>';
}

export function mountAsyncSessionListScreen({ root = globalThis.document, bus, now = () => Date.now() } = {}) {
  if (!bus) throw new Error('mountAsyncSessionListScreen: bus required');

  const wrap = $('#online-sessions-wrap', root);
  if (!wrap) {
    console.warn('[asyncSessionList] #online-sessions-wrap not found');
    return { unmount() {} };
  }

  let cleanups = [];

  function render(sessions = []) {
    if (!sessions.length) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    wrap.innerHTML = buildListHtml(sessions, { now: now() });
    wrap.style.display = '';
  }

  // Click delegation for resume / dismiss buttons.
  cleanups.push(on(wrap, 'click', (e) => {
    const t = e.target;
    const btn = t?.tagName === 'BUTTON' ? t : (t?.closest?.('button') ?? null);
    if (!btn) return;
    const resume  = btn.getAttribute('data-resume');
    const dismiss = btn.getAttribute('data-dismiss');
    if (resume)  bus.emit(AS_INTENT.RESUME,  { roomId: resume });
    if (dismiss) bus.emit(AS_INTENT.DISMISS, { roomId: dismiss });
  }));

  cleanups.push(bus.on(AS_RENDER, ({ sessions } = {}) => render(sessions)));

  // Initial render — empty until someone calls AS_RENDER.
  render([]);

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups = [];
      wrap.innerHTML = '';
      wrap.style.display = 'none';
    },
  };
}
