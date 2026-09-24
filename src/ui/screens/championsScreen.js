import { $, on } from '../domHelpers.js';
import { countUpDurationMs } from '../scoreAnimationTimings.js';
import { getMotionPreference } from '../motionPreference.js';

export const CHAMPS_INTENT = Object.freeze({
  OPEN: 'champions/open',
  CLOSE: 'champions/close',
});

export const CHAMPS_OPEN = 'champions/render/open';
export const CHAMPS_RENDER = 'champions/render';
export const CHAMPS_ERROR = 'champions/error';

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

export const CHAMPS_EMPTY_TITLE = 'אין דירוגים להצגה עדיין';
export const CHAMPS_EMPTY_SUB = 'שחקו עוד משחקים מדורגים כדי למלא את הטבלה';

export function buildChampionsEmptyHtml() {
  return '<div class="champs-empty champs-empty--copy">'
    + `<div class="champs-empty-title">${CHAMPS_EMPTY_TITLE}</div>`
    + `<div class="champs-empty-sub">${CHAMPS_EMPTY_SUB}</div>`
    + '</div>';
}

const MEDALS = [
  '<img src="assets/rewards/gold medal.png" alt="מקום ראשון" class="champ-medal-icon">',
  '<img src="assets/rewards/silver medal.png" alt="מקום שני" class="champ-medal-icon">',
  '<img src="assets/rewards/bronze medal.png" alt="מקום שלישי" class="champ-medal-icon">',
];

// postRank - preRank. Positive means the rank number went up (worsened).
// Null when either side was never captured — callers must not invent a rank.
export function rankShift(preRank, postRank) {
  const pre = Number(preRank);
  const post = Number(postRank);
  if (!Number.isInteger(pre) || !Number.isInteger(post)) return null;
  if (pre < 1 || post < 1) return null;
  return post - pre;
}

// Green ▲ when the player climbed (rank number went down). Red ▼ when they
// dropped. A zero change is omitted — a flat mark is noisier than silence.
export function rankDeltaMarkup(delta) {
  if (!Number.isInteger(delta) || delta === 0) return '';
  const improved = delta < 0;
  const places = Math.abs(delta);
  const cls = improved
    ? 'champ-rank-delta champ-rank-delta--up'
    : 'champ-rank-delta champ-rank-delta--down';
  const arrow = improved ? '▲' : '▼';
  const label = improved
    ? `עלייה של ${places} מקומות`
    : `ירידה של ${places} מקומות`;
  return `<span class="${cls}" dir="ltr" aria-label="${label}">${arrow}${places}</span>`;
}

// Place the current user back at their pre-game index inside the visible
// top-N so the end table can count ELO up and then slide the row.
// Returns null when either rank sits outside the rendered list (entering or
// leaving the top-N, or the outside-separator row). That cross-boundary
// slide is deferred — the static delta still renders.
export function stageLeaderboardEntries(entries, { myUid, preRank, postRank } = {}) {
  if (!Array.isArray(entries) || myUid == null) return null;
  if (!Number.isInteger(preRank) || !Number.isInteger(postRank)) return null;
  if (preRank === postRank) return null;
  if (preRank < 1 || postRank < 1) return null;
  if (preRank > entries.length || postRank > entries.length) return null;
  const from = postRank - 1;
  if (entries[from]?.uid !== myUid) return null;
  const next = entries.slice();
  const [me] = next.splice(from, 1);
  next.splice(preRank - 1, 0, me);
  return next;
}

export function buildChampionsHtml(entries = [], { myUid = null, myPosition = null, myEntry = null, rankDelta = null } = {}) {
  if (!entries.length && !myEntry) return buildChampionsEmptyHtml();

  const rows = entries.map((entry, i) => {
    const pos = i + 1;
    const isMe = myUid != null && entry.uid === myUid;
    // Show the position number for the current user so they can identify their rank;
    // show medal icons for everyone else in the top 3.
    const rankCell = `${MEDALS[i] ?? pos}${isMe ? rankDeltaMarkup(rankDelta) : ''}`;
    return `<tr data-champ-uid="${escapeHtml(entry.uid)}"${isMe ? ' class="champ-me"' : ''}>`
      + `<td>${rankCell}</td>`
      + `<td>${escapeHtml(entry.name)}</td>`
      + `<td${isMe ? ' data-champ-elo' : ''}>${Number(entry.rating) || 0}</td>`
      + `</tr>`;
  }).join('');

  // Append separator + user row when they are outside the displayed top-N.
  let outsideRow = '';
  if (myEntry && myPosition != null) {
    outsideRow = `<tr class="champ-outside-sep"><td colspan="3"></td></tr>`
      + `<tr data-champ-uid="${escapeHtml(myEntry.uid)}" class="champ-me champ-me--outside">`
      + `<td>${myPosition}${rankDeltaMarkup(rankDelta)}</td>`
      + `<td>${escapeHtml(myEntry.name)}</td>`
      + `<td data-champ-elo>${Number(myEntry.rating) || 0}</td>`
      + `</tr>`;
  }

  return '<table class="champs-table"><thead><tr><th>#</th><th>שם</th><th>דירוג</th></tr></thead><tbody>'
    + rows + outsideRow
    + '</tbody></table>';
}

function displayedRating(entries, myUid, myEntry) {
  const mine = (Array.isArray(entries) ? entries.find((e) => e.uid === myUid) : null) ?? myEntry;
  const n = Number(mine?.rating);
  return Number.isFinite(n) ? n : null;
}

function animateElo(el, from, to, { raf = globalThis.requestAnimationFrame, onDone } = {}) {
  const start = Number(from);
  const end = Number(to);
  const set = (v) => { el.textContent = String(v); };
  if (!el || !Number.isFinite(start) || !Number.isFinite(end) || start === end || typeof raf !== 'function') {
    if (el && Number.isFinite(end)) set(end);
    onDone?.();
    return;
  }
  const duration = countUpDurationMs(end - start);
  const now = () => (globalThis.performance?.now?.() ?? Date.now());
  const t0 = now();
  const frame = () => {
    const t = Math.min(1, (now() - t0) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    set(Math.round(start + (end - start) * eased));
    if (t < 1) raf(frame);
    else onDone?.();
  };
  set(start);
  raf(frame);
}

function measureRowTops(wrap) {
  const map = new Map();
  const rows = wrap.querySelectorAll?.('tr[data-champ-uid]');
  if (!rows) return map;
  for (const tr of rows) {
    const top = tr.getBoundingClientRect?.().top;
    if (Number.isFinite(top)) map.set(tr.getAttribute?.('data-champ-uid'), top);
  }
  return map;
}

function flipRows(wrap, beforeTops) {
  const rows = wrap.querySelectorAll?.('tr[data-champ-uid]');
  if (!rows || !beforeTops?.size) return;
  const movers = [];
  for (const tr of rows) {
    const prev = beforeTops.get(tr.getAttribute?.('data-champ-uid'));
    const next = tr.getBoundingClientRect?.().top;
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    const dy = prev - next;
    if (Math.abs(dy) < 1) continue;
    tr.style.transform = `translateY(${dy}px)`;
    tr.style.transition = 'transform 0s';
    movers.push(tr);
  }
  if (!movers.length) return;
  const raf = globalThis.requestAnimationFrame;
  const release = () => {
    for (const tr of movers) {
      tr.style.transition = 'transform 380ms ease';
      tr.style.transform = '';
    }
  };
  // Commit the inverse transform before the transition, or the browser
  // batches both writes and the row jumps instead of sliding.
  wrap.getBoundingClientRect?.();
  if (typeof raf === 'function') raf(() => raf(release));
  else release();
}

// End-table only. Paints the final leaderboard immediately when motion is
// off or the row cannot be staged inside the visible top-N. Otherwise shows
// the user at their pre-game slot, counts ELO from the pre-game value, then
// slides the row to the post-game slot.
export function playChampEndMotion(wrap, {
  entries = [],
  myUid = null,
  myPosition = null,
  myEntry = null,
  preRank = null,
  eloFrom = null,
  reducedMotion = false,
} = {}) {
  if (!wrap) return;
  const rankDelta = rankShift(preRank, myPosition);
  const finalHtml = buildChampionsHtml(entries, { myUid, myPosition, myEntry, rankDelta });
  const canQuery = typeof wrap.querySelector === 'function';
  const staged = (!reducedMotion && canQuery)
    ? stageLeaderboardEntries(entries, { myUid, preRank, postRank: myPosition })
    : null;
  const shown = displayedRating(entries, myUid, myEntry);
  const from = Number(eloFrom);
  const canCount = !reducedMotion && canQuery
    && Number.isFinite(from) && shown != null && from !== shown;

  wrap._champMotionGen = (wrap._champMotionGen ?? 0) + 1;
  const gen = wrap._champMotionGen;

  if (!staged) {
    wrap.innerHTML = finalHtml;
    if (!canCount) return;
    const cell = wrap.querySelector('tr.champ-me [data-champ-elo]');
    if (cell) animateElo(cell, from, shown);
    return;
  }

  const stagedEntries = staged.map((entry) => (
    entry.uid === myUid && Number.isFinite(from) ? { ...entry, rating: from } : entry
  ));
  wrap.innerHTML = buildChampionsHtml(stagedEntries, { myUid, rankDelta });

  const settle = () => {
    if (wrap._champMotionGen !== gen) return;
    const before = measureRowTops(wrap);
    wrap.innerHTML = finalHtml;
    if (before.size) flipRows(wrap, before);
  };

  if (canCount) {
    const cell = wrap.querySelector('tr.champ-me [data-champ-elo]');
    if (cell) {
      animateElo(cell, from, shown, { onDone: settle });
      return;
    }
  }
  settle();
}

export function mountChampionsScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountChampionsScreen: bus required');

  const overlay = $('#ov-champs', root);
  const homeWrap = $('#champions-wrap-home', root);
  const endWrap = $('#champions-wrap', root);
  const cleanups = [];

  const closeBtn = $('button[onclick="ovClose(\'ov-champs\')"]', overlay ?? root);
  if (closeBtn) {
    closeBtn.removeAttribute?.('onclick');
    cleanups.push(on(closeBtn, 'click', (e) => {
      e.preventDefault?.();
      overlay?.classList?.add('hidden');
      bus.emit(CHAMPS_INTENT.CLOSE, {});
    }));
  }

  cleanups.push(bus.on(CHAMPS_OPEN, () => {
    paintLoading(homeWrap);
    overlay?.classList?.remove('hidden');
    bus.emit(CHAMPS_INTENT.OPEN, {});
  }));

  cleanups.push(bus.on(CHAMPS_RENDER, ({
    entries = [],
    myUid = null,
    myPosition = null,
    myEntry = null,
    target = 'all',
    preRank = null,
    eloFrom = null,
  } = {}) => {
    // The anytime overlay never shows a match delta. Only the post-game table does.
    if (target === 'home' || target === 'all') {
      paint(homeWrap, buildChampionsHtml(entries, { myUid, myPosition, myEntry }));
    }
    if (target === 'end' || target === 'all') {
      playChampEndMotion(endWrap, {
        entries,
        myUid,
        myPosition,
        myEntry,
        preRank,
        eloFrom,
        reducedMotion: getMotionPreference().isReduced(),
      });
    }
  }));

  cleanups.push(bus.on(CHAMPS_ERROR, ({ target = 'all' } = {}) => {
    const html = buildChampionsEmptyHtml();
    if (target === 'home' || target === 'all') paint(homeWrap, html);
    if (target === 'end' || target === 'all') paint(endWrap, html);
  }));

  function paintLoading(el) {
    paint(el, '<div class="champs-empty">טוען דירוגים...</div>');
  }

  function paint(el, html) {
    if (el) el.innerHTML = html;
  }

  function unmount() {
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { unmount };
}
