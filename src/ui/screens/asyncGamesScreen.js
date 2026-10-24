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
import { registerOnboardingContent, ONBOARDING_SCREEN_ENTER } from '../controllers/onboardingController.js';
import { avatarIconSrc, ANON_AVATAR_SRC } from './avatarScreens.js';
import { MENU_INTENT } from './menuScreen.js';

export const MG_INTENT = Object.freeze({
  RESUME:  'myGames/resume',
  DISMISS: 'myGames/dismiss',
  POKE:    'myGames/poke',
  BACK:    'myGames/back',
});

export const MG_RENDER = 'myGames/render';

// "Your turn / their turn" tabs. A live game is "mine" when it's the player's
// turn (incl. the local saved game); everything else — waiting on the
// opponent and expired rows — lives under "theirs".
export function splitByTurn(sessions = []) {
  const mine = [];
  const theirs = [];
  for (const s of sessions) (s.isMyTurn && !s.isExpired ? mine : theirs).push(s);
  return { mine, theirs };
}

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

// One-time attention cues (BOOST_MOTION_SPEC §15): `mg-glint` sweeps once
// across a card that waits on the player when the screen opens; `mg-nudge`
// shakes once a card that turned to the player while the screen is showing.
// Nothing loops — after the cue the static "your turn" styling carries it.
export const MG_CUE = Object.freeze({ GLINT: 'mg-glint', NUDGE: 'mg-nudge' });
const CUE_STAGGER_MS = 70;
const CUE_STAGGER_MAX = 4;

export function buildRowHtml(s, { now = Date.now(), cue = null, cueIndex = 0 } = {}) {
  const ago = timeAgoLabel(s.lastUpdated, now);
  const myScore = Number(s.myScore ?? 0);
  const opScore = Number(s.opponentScore ?? 0);
  const cardCls = [
    'mg-card',
    s.isExpired ? 'is-expired' : '',
    s.isLocal   ? 'is-local'   : '',
    !s.isExpired && !s.isMyTurn ? 'is-waiting' : '',
    cue ?? '',
  ].filter(Boolean).join(' ');
  const cueStyle = cue
    ? ` style="--mg-cue-delay:${Math.min(cueIndex, CUE_STAGGER_MAX) * CUE_STAGGER_MS}ms"`
    : '';
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
  // Lead bar: my share of the combined score (cyan = me, gold = opponent).
  const total = myScore + opScore;
  const myPct = total > 0 ? Math.round((myScore / total) * 100) : 50;
  const avSrc = avatarIconSrc(s.opponentAvatar) || ANON_AVATAR_SRC;
  return ''
    + `<div data-mg-row="${escapeHtml(s.roomId)}" class="${cardCls}"${cueStyle}>`
    +   `<span class="mg-av"><img src="${escapeHtml(avSrc)}" alt=""></span>`
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
    +   `<div class="mg-lead" aria-hidden="true"><i class="mg-lead-me" style="width:${myPct}%"></i><i class="mg-lead-op" style="width:${100 - myPct}%"></i></div>`
    + '</div>';
}

export function buildListHtml(sessions = [], { now = Date.now(), cues = null } = {}) {
  let n = 0;
  return sessions.map((s) => {
    const cue = cues?.get?.(s.roomId) ?? null;
    return buildRowHtml(s, { now, cue, cueIndex: cue ? n++ : 0 });
  }).join('');
}

// Which cards get a cue on this render. `entering`: the first render since
// the screen opened — every card waiting on the player glints. Otherwise a
// card nudges only when it flipped to the player since the last render
// (`seen`: roomId → isMyTurn then). Returns the cues and the new `seen`.
export function turnCues(sessions = [], { seen = new Map(), entering = false } = {}) {
  const cues = new Map();
  const next = new Map();
  for (const s of sessions) {
    const mine = !!s.isMyTurn && !s.isExpired;
    next.set(s.roomId, mine);
    if (!mine) continue;
    if (entering) cues.set(s.roomId, MG_CUE.GLINT);
    else if (seen.get(s.roomId) === false) cues.set(s.roomId, MG_CUE.NUDGE);
  }
  return { cues, seen: next };
}

export function mountAsyncGamesScreen({ root = globalThis.document, bus, now = () => Date.now() } = {}) {
  if (!bus) throw new Error('mountAsyncGamesScreen: bus required');

  const list   = $('#mg-list',  root);
  const empty  = $('#mg-empty', root);
  const screen = $('#smygames', root);
  const tabs   = $('#mg-tabs',  root);
  if (!list || !screen) {
    return { unmount() {}, refresh() {} };
  }

  let cleanups = [];
  let lastSessions = [];
  // null until the user picks a tab — then we auto-pick the first render:
  // "your turn" if anything waits on the player, else "their turn".
  let activeTab = null;
  // Turn cues: true until the first render the player actually sees after
  // opening the screen; `turnSeen` remembers each game's turn at that time.
  let entering = true;
  let turnSeen = new Map();

  function paintTabs(mine, theirs) {
    if (!tabs) return;
    tabs.style.display = '';
    for (const btn of tabs.querySelectorAll?.('[data-mg-tab]') ?? []) {
      const which = btn.getAttribute('data-mg-tab');
      btn.classList?.toggle('on', which === activeTab);
      const n = btn.querySelector?.('.n');
      if (n) n.textContent = String((which === 'mine' ? mine : theirs).length);
    }
  }

  function nudgeTab(which) {
    const btn = tabs?.querySelector?.(`[data-mg-tab="${which}"]`);
    if (!btn) return;
    btn.classList?.remove(MG_CUE.NUDGE);
    void btn.offsetWidth;   // restart the one-shot animation
    btn.classList?.add(MG_CUE.NUDGE);
  }

  // `fresh`: new data from MG_RENDER (a tab switch re-renders the same data
  // and never replays a cue).
  function render(sessions = lastSessions, { fresh = false } = {}) {
    lastSessions = sessions;
    let cues = null;
    if (fresh) {
      const showing = !screen.classList?.contains?.('hidden');
      const r = turnCues(sessions, { seen: turnSeen, entering: entering && showing });
      turnSeen = r.seen;
      if (showing) { cues = r.cues; entering = false; }
    }
    if (!sessions.length) {
      list.innerHTML = '';
      if (tabs) tabs.style.display = 'none';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (!tabs) {
      list.innerHTML = buildListHtml(sessions, { now: now(), cues });
      return;
    }
    const { mine, theirs } = splitByTurn(sessions);
    if (activeTab === null) activeTab = mine.length ? 'mine' : 'theirs';
    paintTabs(mine, theirs);
    const shown = activeTab === 'mine' ? mine : theirs;
    // A game that turned to the player under the other tab: nudge the
    // "your turn" tab instead (its count just went up).
    if (cues?.size && shown !== mine) nudgeTab('mine');
    list.innerHTML = shown.length
      ? buildListHtml(shown, { now: now(), cues })
      : `<div class="mg-tab-empty">${activeTab === 'mine' ? 'אין משחקים שממתינים לך' : 'אין משחקים שממתינים ליריב'}</div>`;
  }

  if (tabs) {
    cleanups.push(on(tabs, 'click', (e) => {
      const btn = e.target?.closest?.('[data-mg-tab]');
      if (!btn) return;
      const which = btn.getAttribute('data-mg-tab');
      if (which !== 'mine' && which !== 'theirs') return;
      activeTab = which;
      render();
    }));
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
  const emptyCta = $('#mg-empty-online', root);
  if (emptyCta) {
    emptyCta.removeAttribute?.('onclick');
    cleanups.push(on(emptyCta, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(MENU_INTENT.OPEN_ONLINE_LOBBY, {});
    }));
  }

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

  cleanups.push(bus.on(MG_RENDER, ({ sessions } = {}) => render(sessions ?? [], { fresh: true })));
  cleanups.push(bus.on(ONBOARDING_SCREEN_ENTER, ({ screenId } = {}) => {
    if (screenId === 'smygames') entering = true;
  }));

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
