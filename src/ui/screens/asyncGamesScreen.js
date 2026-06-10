// asyncGamesScreen — full-screen list of the user's saved & in-flight games.
//
// Renders #smygames as a stack of game cards. Each card is a single
// horizontal row with three columns:
//   - Identity (opponent name + time-ago line)
//   - Score (gold pill, dominant)
//   - Action: a שחק button (enabled iff isMyTurn) for live cards, or a 🗑
//     trash button for expired cards (the only delete path on this screen).
//
// This module is purely presentational: it subscribes to MG_RENDER to
// receive a sessions array and emits MG_INTENT.RESUME / DISMISS / BACK /
// POKE on user clicks. Data plumbing (asyncSessionService + Firebase)
// lives in main.js, which handles those intents directly.

import { $, on } from '../domHelpers.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

export const MG_INTENT = Object.freeze({
  RESUME:  'myGames/resume',
  DISMISS: 'myGames/dismiss',
  POKE:    'myGames/poke',
  BACK:    'myGames/back',
});

export const MG_RENDER = 'myGames/render';

// Manual-poke cooldown. The button hides for 24 hours after the user
// clicks it. We gate on `lastPokedAt` (manual only) — NOT `lastReminderAt`
// (which the auto-cron sweep also writes). If we shared the field, a cron
// reminder that fired on app boot would hide the button for a full day
// even though the user never clicked.
const POKE_COOLDOWN_HOURS = 24;

export function canPoke(s, now = Date.now()) {
  if (!s || s.isExpired || s.isLocal) return false;
  if (s.isMyTurn) return false; // pointless to poke yourself
  if (!s.opponentUid) return false; // no addressable recipient
  const last = Number(s.lastPokedAt) || 0;
  if (last <= 0) return true;
  const hours = (now - last) / 3_600_000;
  return hours >= POKE_COOLDOWN_HOURS;
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

export function buildRowHtml(s, { now = Date.now() } = {}) {
  const ago = timeAgoLabel(s.lastUpdated, now);
  const myScore = Number(s.myScore ?? 0);
  const opScore = Number(s.opponentScore ?? 0);
  const cardCls = [
    'mg-card',
    s.isExpired ? 'is-expired' : '',
    s.isLocal   ? 'is-local'   : '',
    !s.isExpired && !s.isMyTurn ? 'is-waiting' : '',
  ].filter(Boolean).join(' ');
  // Expired games get the trash icon (only delete path on this screen).
  // Live games get a שחק button — enabled iff isMyTurn. The disabled state
  // is what tells the user "waiting on the opponent"; we no longer carry a
  // separate status pill. When it's NOT my turn (and the room isn't
  // expired/local), a 👋 poke button sits after the שחק button — clicking
  // it pushes a reminder to the opponent and hides the button for 24 h.
  //
  // Note: when !isMyTurn we use ONLY aria-disabled="true" (no HTML
  // `disabled` attribute) so the click still fires — the click handler
  // detects the aria-disabled state and shows the "תור היריב" tooltip
  // instead of dispatching MG_INTENT.RESUME.
  const action = s.isExpired
    ? `<button class="mg-dismiss" data-mg-dismiss="${escapeHtml(s.roomId)}" aria-label="הסר">🗑</button>`
    : `<button class="mg-play${s.isMyTurn ? '' : ' is-disabled'}" data-mg-resume="${escapeHtml(s.roomId)}"`
        + (s.isMyTurn ? '' : ' aria-disabled="true"')
        + '>שחק</button>'
      + (canPoke(s, now)
          ? `<button class="mg-poke" data-mg-poke="${escapeHtml(s.roomId)}" aria-label="דחוף את היריב">👋</button>`
          : '');
  // Score uses literal " : " around the colon so screen-reader output and
  // tests both see the canonical "N : N" form. Each number is wrapped in
  // its own span for typographic emphasis (mine is larger + gold).
  return ''
    + `<div data-mg-row="${escapeHtml(s.roomId)}" class="${cardCls}">`
    +   '<div class="mg-card-identity">'
    +     `<div class="mg-name">${escapeHtml(s.opponentName ?? '?')}</div>`
    +     (ago ? `<div class="mg-time">${escapeHtml(ago)}</div>` : '')
    +   '</div>'
    +   '<div class="mg-score" aria-label="תוצאה">'
    +     `<span class="mg-score-mine">${myScore}</span>`
    +     ' <span class="mg-score-sep">:</span> '
    +     `<span class="mg-score-theirs">${opScore}</span>`
    +   '</div>'
    +   action
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
  if (!list || !screen) {
    return { unmount() {}, refresh() {} };
  }

  let cleanups = [];

  function render(sessions = []) {
    if (!sessions.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = buildListHtml(sessions, { now: now() });
  }

  // Toast container — one floater pinned to the screen, reused across
  // clicks. Auto-clears after `TOAST_MS`. We append it to the screen
  // container so it scrolls with the cards rather than detaching.
  const TOAST_MS = 1800;
  let toastEl = null;
  let toastTimer = null;
  function showToast(text, kind = 'info') {
    const doc = screen?.ownerDocument ?? globalThis.document;
    if (!doc) return;
    if (!toastEl) {
      toastEl = doc.createElement?.('div');
      if (!toastEl) return;
      toastEl.className = 'mg-toast';
      screen.appendChild?.(toastEl);
    }
    toastEl.className = `mg-toast mg-toast--${kind} is-visible`;
    toastEl.textContent = text;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.className = 'mg-toast';
    }, TOAST_MS);
  }

  // Click delegation for resume + dismiss + poke.
  cleanups.push(on(list, 'click', (e) => {
    const t = e.target;
    const btn = t?.tagName === 'BUTTON' ? t : (t?.closest?.('button') ?? null);
    if (!btn) return;
    // Disabled שחק button: don't dispatch — show the "תור היריב" tooltip.
    if (btn.getAttribute('aria-disabled') === 'true') {
      showToast('זה תור היריב — חכה לתשובה', 'info');
      return;
    }
    const resume  = btn.getAttribute('data-mg-resume');
    const dismiss = btn.getAttribute('data-mg-dismiss');
    const poke    = btn.getAttribute('data-mg-poke');
    if (resume)  bus.emit(MG_INTENT.RESUME,  { roomId: resume });
    if (dismiss) bus.emit(MG_INTENT.DISMISS, { roomId: dismiss });
    if (poke) {
      bus.emit(MG_INTENT.POKE, { roomId: poke });
      // Optimistic feedback — the actual push is async and we trust the
      // main.js handler to log on failure. Showing a quick confirmation
      // is more important than waiting for the round-trip.
      showToast('היריב קיבל דחיפה 👋', 'ok');
    }
  }));

  cleanups.push(bus.on(MG_RENDER, ({ sessions } = {}) => render(sessions)));

  // Empty until someone publishes MG_RENDER.
  render([]);

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups = [];
      list.innerHTML = '';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = null;
      if (toastEl?.parentElement) toastEl.parentElement.removeChild(toastEl);
      toastEl = null;
    },
  };
}

// Keep this in sync with async-games-screen.html.
registerOnboardingContent('smygames', {
  icon: '🎮',
  title: 'המשחקים שלי',
  bullets: [
    '🟢 בתורי — לחץ "המשך" לשחק',
    '⏳ בתור היריב — ממתין לתשובת הצד השני',
    '💾 שמור — המשחק האופליין השמור במכשיר',
  ],
});
