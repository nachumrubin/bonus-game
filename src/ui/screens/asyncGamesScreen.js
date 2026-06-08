// asyncGamesScreen — full-screen list of the user's saved & in-flight games.
//
// Renders #smygames as a stack of "game cards":
//   - Identity (avatar + opponent name + status pill + time-ago) on one side
//   - Score, large and centered, as the dominant visual element
//   - Resume action + secondary dismiss (🗑) on the opposite side
//
// This module is purely presentational: it subscribes to MG_RENDER to
// receive a sessions array and emits MG_INTENT.RESUME / DISMISS / BACK
// on user clicks. Data plumbing (asyncSessionService + Firebase) lives
// in main.js, which translates these intents to the existing
// AS_INTENT.RESUME / AS_INTENT.DISMISS handlers.

import { $, on, setText } from '../domHelpers.js';

export const MG_INTENT = Object.freeze({
  RESUME:  'myGames/resume',
  DISMISS: 'myGames/dismiss',
  BACK:    'myGames/back',
});

export const MG_RENDER = 'myGames/render';

const AVATAR_ID_TO_EMOJI = {
  crown:'👑', star:'⭐', fire:'🔥', diamond:'💎', shark:'🦈',
  dragon:'🐉', tiger:'🐯', alien:'👾', wizard:'🧙', robot:'🤖',
  rocket:'🚀', knight:'🛡️', ninja:'🥷', genius:'🧠', vampire:'🧛',
};
function resolveAvatar(raw, fallback = '👤') {
  return AVATAR_ID_TO_EMOJI[raw] ?? raw ?? fallback;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll('\'','&#39;');
}

export function timeAgoLabel(ts, now) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return 'עכשיו';
  if (hours < 1)  return `לפני ${mins} דק'`;
  if (days  < 1)  return `לפני ${hours} שע'`;
  return `לפני ${days} ימים`;
}

// Status pill: { icon, text, cls }. The icon is an emoji glyph the user
// reads as part of the badge; cls selects the colour (green my-turn,
// neutral opponent-turn, gold local-save, muted expired).
function statusEntry(s) {
  if (s.isExpired) return { icon: '🔵', text: 'פג תוקף', cls: 'is-expired' };
  if (s.isLocal)   return { icon: '💾', text: 'משחק שמור', cls: 'is-local' };
  if (s.isMyTurn)  return { icon: '🟢', text: 'תורך', cls: 'is-mine' };
  return { icon: '🕒', text: `תור ${s.opponentName ?? 'היריב'}`, cls: 'is-theirs' };
}

export function buildRowHtml(s, { now = Date.now() } = {}) {
  const avatar = resolveAvatar(s.opponentAvatar);
  const ago = timeAgoLabel(s.lastUpdated, now);
  const status = statusEntry(s);
  const myScore = Number(s.myScore ?? 0);
  const opScore = Number(s.opponentScore ?? 0);
  const cardCls = [
    'mg-card',
    s.isExpired ? 'is-expired' : '',
    s.isLocal   ? 'is-local'   : '',
  ].filter(Boolean).join(' ');
  const actionBtn = s.isExpired
    ? ''
    : `<button class="mg-resume" data-mg-resume="${escapeHtml(s.roomId)}">המשך</button>`;
  // Score uses literal " : " around the colon so screen-reader output and
  // tests both see the canonical "N : N" form. Each number is wrapped in
  // its own span for typographic emphasis (mine is larger + gold).
  return ''
    + `<div data-mg-row="${escapeHtml(s.roomId)}" class="${cardCls}">`
    +   '<div class="mg-card-identity">'
    +     `<div class="mg-avatar" aria-hidden="true">${escapeHtml(avatar)}</div>`
    +     '<div class="mg-meta">'
    +       '<div class="mg-name">'
    +         escapeHtml(s.opponentName ?? '?')
    +       '</div>'
    +       `<span class="mg-status ${status.cls}">`
    +         `<span aria-hidden="true">${escapeHtml(status.icon)}</span>`
    +         escapeHtml(status.text)
    +       '</span>'
    +       (ago && !s.isMyTurn ? `<div class="mg-time">${escapeHtml(ago)}</div>` : '')
    +     '</div>'
    +   '</div>'
    +   '<div class="mg-score" aria-label="תוצאה">'
    +     `<span class="mg-score-mine">${myScore}</span>`
    +     ' <span class="mg-score-sep">:</span> '
    +     `<span class="mg-score-theirs">${opScore}</span>`
    +   '</div>'
    +   '<div class="mg-actions">'
    +     actionBtn
    +     `<button class="mg-dismiss" data-mg-dismiss="${escapeHtml(s.roomId)}" aria-label="הסר">🗑</button>`
    +   '</div>'
    + '</div>';
}

export function buildListHtml(sessions = [], { now = Date.now() } = {}) {
  return sessions.map(s => buildRowHtml(s, { now })).join('');
}

export function mountAsyncGamesScreen({ root = globalThis.document, bus, now = () => Date.now() } = {}) {
  if (!bus) throw new Error('mountAsyncGamesScreen: bus required');

  const list   = $('#mg-list',  root);
  const empty  = $('#mg-empty', root);
  const screen = $('#smygames', root);
  const count  = $('#mg-count', root);
  if (!list || !screen) {
    return { unmount() {}, refresh() {} };
  }

  let cleanups = [];

  function render(sessions = []) {
    if (count) setText(count, sessions.length ? String(sessions.length) : '');
    if (!sessions.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = buildListHtml(sessions, { now: now() });
  }

  // Click delegation for resume + dismiss.
  cleanups.push(on(list, 'click', (e) => {
    const t = e.target;
    const btn = t?.tagName === 'BUTTON' ? t : (t?.closest?.('button') ?? null);
    if (!btn) return;
    const resume  = btn.getAttribute('data-mg-resume');
    const dismiss = btn.getAttribute('data-mg-dismiss');
    if (resume)  bus.emit(MG_INTENT.RESUME,  { roomId: resume });
    if (dismiss) bus.emit(MG_INTENT.DISMISS, { roomId: dismiss });
  }));

  cleanups.push(bus.on(MG_RENDER, ({ sessions } = {}) => render(sessions)));

  // Empty until someone publishes MG_RENDER.
  render([]);

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups = [];
      list.innerHTML = '';
      if (count) setText(count, '');
    },
  };
}
