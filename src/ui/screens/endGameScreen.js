// endGameScreen — wraps #ov-end. Opens automatically on GAME_COMPLETED.
//
// Renders winner name, both players' scores, and rematch / home buttons.
// The leaderboard sub-section (#champions-wrap) is left to legacy for now —
// when champions are migrated, the spine will populate it via a separate
// module.

import { $, on, setText } from '../domHelpers.js';
import { EV } from '../../events/eventTypes.js';
import { RATING_EVT } from '../../game/account/ratingService.js';
import { setAvatarEl, AV_PROGRESS_BUMP, achievementIconSrc, isBotAvatar, nextAchievement } from './avatarScreens.js';
import { playOnHost, playOnImg } from '../avatarMotion/spritePlayer.js';
import { CHAMPS_RENDER } from './championsScreen.js';
import { confettiBurst } from './miniGames/bonusFx.js';

export const END_INTENT = Object.freeze({
  REMATCH: 'end/rematch',
  GO_HOME: 'end/goHome',
  VIEW_BOARD: 'end/viewBoard',
});

export const END_OPEN = 'overlay/end/open';
const COMPUTER_NAME_HE = '\u05D4\u05DE\u05D7\u05E9\u05D1';
const LEGACY_CROWN_VALUES = new Set(['crown', '\uD83D\uDC51']);
const RESULT_MOTION_CLASS = 'end-result-motion';
const RESULT_CLASSES = ['end-outcome-victory', 'end-outcome-draw', 'end-outcome-defeat'];
const ELO_REVEAL_MS = 420;

export function mountEndGameScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountEndGameScreen: bus required');

  const overlay = $('#ov-end', root);
  if (!overlay) {
    console.warn('[endGameScreen] #ov-end not found — not mounted');
    return { unmount() {} };
  }

  const cleanups = [];
  let lastResultSignature = null;
  const lastEloSignature = new Map();
  const eloFrames = new Map();

  const rematch = $('button[onclick="rematch()"]', overlay);
  const goHome  = $('button[onclick="goHome()"]', overlay);
  const viewBoard = $('button[onclick="reviewBoard()"]', overlay);

  if (viewBoard) {
    viewBoard.removeAttribute('onclick');
    cleanups.push(on(viewBoard, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(END_INTENT.VIEW_BOARD);
    }));
  }

  if (rematch) {
    rematch.removeAttribute('onclick');
    cleanups.push(on(rematch, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(END_INTENT.REMATCH);
    }));
  }
  if (goHome) {
    goHome.removeAttribute('onclick');
    cleanups.push(on(goHome, 'click', (e) => {
      e.preventDefault?.();
      bus.emit(END_INTENT.GO_HOME);
    }));
  }

  // ─── Auto-open on GAME_COMPLETED ────────────────────────
  cleanups.push(bus.on(EV.GAME_COMPLETED, ({ winnerSlot, scores, players, abandonedBy, abandonReason } = {}) => {
    bus.emit(END_OPEN, { winnerSlot, scores, players, abandonedBy, abandonReason });
  }));

  cleanups.push(bus.on(EV.GAME_STARTED, () => {
    lastResultSignature = null;
    lastEloSignature.clear();
  }));

  cleanups.push(bus.on(END_OPEN, (payload = {}) => {
    render(payload);
    overlay.classList?.remove('hidden');
  }));

  // Rating service emits this AFTER the local Elo write finishes, which is
  // typically a moment after GAME_COMPLETED. Pin the deltas onto the score
  // cards as they arrive.
  cleanups.push(bus.on(RATING_EVT.CHANGED, (payload = {}) => {
    renderEloDeltas(payload);
  }));

  // Highlight the logged-in user's row in the leaderboard once data arrives.
  cleanups.push(bus.on(CHAMPS_RENDER, () => {
    setTimeout(highlightMyChampRow, 0);
  }));

  // Achievement progress that moved this game (profile watch → AV_PROGRESS_BUMP):
  // the trophy bumps forward (3D 'bump' clip), its bar grows from the old to the
  // new value and a spark lands at the new position. Completed achievements get
  // the full unlock overlay instead, so they never appear here.
  cleanups.push(bus.on(AV_PROGRESS_BUMP, ({ bumps } = {}) => renderProgressBumps(bumps)));

  function renderProgressBumps(bumps, { next = false } = {}) {
    if (!Array.isArray(bumps) || !bumps.length || (!next && overlay.classList?.contains?.('hidden'))) return;
    const cards = $('.end-cards', overlay);
    const doc = overlay.ownerDocument;
    if (!cards?.insertAdjacentElement || !doc?.createElement) return;
    overlay.querySelector?.('.end-ach-progress')?.remove?.();
    const wrap = doc.createElement('div');
    wrap.className = next ? 'end-ach-progress end-ach-progress--next' : 'end-ach-progress';
    const pct = (n, t) => `${Math.max(0, Math.min(100, (n / t) * 100)).toFixed(1)}%`;
    wrap.innerHTML = bumps.map(({ achievement: a, from, to, target }) =>
      `<div class="end-ach-row" style="--from:${pct(from, target)};--to:${pct(to, target)}">`
      + `<img class="end-ach-ic" src="${achievementIconSrc(a)}" alt="">`
      + `<div class="end-ach-meta"><div class="end-ach-title"></div>`
      + `<div class="end-ach-bar"><i class="end-ach-fill"></i><i class="end-ach-spark"></i></div></div>`
      + `<div class="end-ach-count">${to}/${target}</div></div>`).join('');
    // Titles via textContent (data is ours, but keep the habit).
    wrap.querySelectorAll('.end-ach-title').forEach((el, i) => { el.textContent = bumps[i].achievement?.titleHe ?? ''; });
    cards.insertAdjacentElement('afterend', wrap);
    void wrap.offsetWidth;
    wrap.classList.add('is-go');
    if (!next) for (const img of wrap.querySelectorAll('img.end-ach-ic')) playOnImg(img, 'bump');
  }

  function render({ winnerSlot, scores = { 0: 0, 1: 0 }, players, abandonedBy, abandonReason } = {}) {
    clearEloDeltas();
    overlay.querySelector?.('.end-ach-progress')?.remove?.();
    setText($('#es1', overlay), String(scores[0] ?? 0));
    setText($('#es2', overlay), String(scores[1] ?? 0));
    setText($('#en1', overlay), players?.[0]?.displayName ?? 'שחקן 1');
    setText($('#en2', overlay), players?.[1]?.displayName ?? 'שחקן 2');
    // Lead bar under the two cards (cyan = slot 0 share, gold = slot 1).
    const s0 = Math.max(0, Number(scores?.[0]) || 0);
    const s1 = Math.max(0, Number(scores?.[1]) || 0);
    const share0 = s0 + s1 > 0 ? Math.round((s0 / (s0 + s1)) * 100) : 50;
    const lead0 = $('#end-lead-0', overlay);
    const lead1 = $('#end-lead-1', overlay);
    if (lead0?.style) lead0.style.width = `${share0}%`;
    if (lead1?.style) lead1.style.width = `${100 - share0}%`;

    setAvatarEl($('#end-av0', overlay), endAvatarValue(players?.[0]), { fallback: '\uD83D\uDC64', className: 'av-img' });
    setAvatarEl($('#end-av1', overlay), endAvatarValue(players?.[1]), { fallback: '\uD83D\uDC64', className: 'av-img' });

    const wn = $('#wn', overlay);
    const ws = $('#wws', overlay);
    const sessionSlot = globalThis.__spine?.activeGame?.session?.mySlot;
    const mySlot = sessionSlot === 0 || sessionSlot === 1 ? sessionSlot : 0;
    // Outcome rule:
    //   • walkout (abandonedBy set): ONLY 0-0 is a draw; any other score —
    //     including a non-zero tie like 10-10 — is a loss for the leaver, so
    //     the other side wins.
    //   • normal finish: equal scores are a draw, otherwise the higher wins.
    const score0 = Number(scores?.[0] ?? 0);
    const score1 = Number(scores?.[1] ?? 0);
    const walkout = abandonedBy === 0 || abandonedBy === 1;
    const effectiveWinner = walkout
      ? ((score0 === 0 && score1 === 0) ? null : 1 - abandonedBy)
      : (winnerSlot != null
          ? winnerSlot
          : (score0 === score1 ? null : (score0 > score1 ? 0 : 1)));

    const outcome = effectiveWinner == null
      ? 'draw'
      : (mySlot === effectiveWinner ? 'victory' : 'defeat');
    // "Next achievement" row: static until a real progress bump replaces it.
    try {
      const prof = globalThis.__spine?.currentProfile;
      const nxt = prof ? nextAchievement({ stats: prof.stats, ownedAvatars: prof.ownedAvatars }) : null;
      if (nxt) renderProgressBumps([nxt], { next: true });
    } catch { /* decorative */ }
    applyOutcomePresentation(outcome, { effectiveWinner, score0, score1, abandonedBy });

    applyCardStates(effectiveWinner);

    if (effectiveWinner == null) {
      setText(wn, 'המשחק הסתיים בתיקו');
      // Note the walkout when the draw came from a player leaving at a tie.
      const note = abandonedBy == null ? ''
        : (mySlot === abandonedBy ? 'עזבת את המשחק' : 'היריב עזב את המשחק');
      setText(ws, note);
      return;
    }

    const name = players?.[effectiveWinner]?.displayName ?? `שחקן ${effectiveWinner + 1}`;
    setText(wn, `${name} ניצח!`);
    setText(ws, abandonMessage({ abandonedBy, abandonReason, mySlot, scores }));
  }

  function applyCardStates(effectiveWinner) {
    const card0 = $('#end-card-0', overlay);
    const card1 = $('#end-card-1', overlay);
    for (const card of [card0, card1]) {
      if (!card) continue;
      card.classList.remove('is-winner', 'is-loser', 'is-draw');
    }
    if (effectiveWinner == null) {
      card0?.classList?.add('is-draw');
      card1?.classList?.add('is-draw');
    } else if (effectiveWinner === 0) {
      card0?.classList?.add('is-winner');
      card1?.classList?.add('is-loser');
    } else {
      card0?.classList?.add('is-loser');
      card1?.classList?.add('is-winner');
    }
  }

  function applyOutcomePresentation(outcome, { effectiveWinner, score0, score1, abandonedBy }) {
    for (const cls of RESULT_CLASSES) overlay.classList?.remove?.(cls);
    overlay.classList?.add?.(`end-outcome-${outcome}`);
    if (overlay.dataset) overlay.dataset.outcome = outcome;
    if (outcome !== 'victory') {
      for (const layer of overlay.querySelectorAll?.('.bz-confetti') ?? []) layer.remove?.();
    }

    const signature = `${outcome}:${effectiveWinner ?? 'draw'}:${score0}:${score1}:${abandonedBy ?? ''}`;
    if (signature === lastResultSignature) return;
    lastResultSignature = signature;

    overlay.classList?.remove?.(RESULT_MOTION_CLASS);
    // Force the one-shot class to begin only for a new completion event. This
    // is presentation-only; all result text and controls are already painted.
    void overlay.offsetWidth;
    overlay.classList?.add?.(RESULT_MOTION_CLASS);

    if (outcome === 'victory' && !prefersReducedMotion()) {
      confettiBurst($('.end-ovc', overlay), { count: 42 });
    }
    // The characters react too: the winner turns toward the camera, the loser
    // steps back and dims (restrained — spec: no celebration on defeat). A draw
    // stays still. No-ops under reduced motion or without a pose atlas.
    if (effectiveWinner === 0 || effectiveWinner === 1) {
      playOnHost($(`#end-av${effectiveWinner}`, overlay), 'win');
      playOnHost($(`#end-av${1 - effectiveWinner}`, overlay), 'loss');
    }
  }

  function endAvatarValue(player) {
    const value = player?.avatar ?? null;
    if (LEGACY_CROWN_VALUES.has(value)) return null;
    if (isBotAvatar(value) && player?.displayName !== COMPUTER_NAME_HE) return null;
    return value;
  }

  function highlightMyChampRow() {
    const mySlot = globalThis.__spine?.activeGame?.session?.mySlot;
    const session = globalThis.__spine?.activeGame?.session;
    const myUid = session?.state?.players?.[mySlot]?.uid ?? null;
    if (!myUid) return;
    const wrap = $('#champions-wrap', overlay);
    if (!wrap) return;
    for (const tr of wrap.querySelectorAll('tr[data-champ-uid]')) {
      const isMe = tr.getAttribute('data-champ-uid') === myUid;
      tr.classList.toggle('champ-me', isMe);
    }
  }

  function abandonMessage({ abandonedBy, abandonReason, mySlot, scores }) {
    if (abandonedBy == null) {
      const margin = Math.abs((scores?.[0] ?? 0) - (scores?.[1] ?? 0));
      return `בהפרש של ${margin}`;
    }
    const iLost = mySlot === abandonedBy;
    if (abandonReason === 'missed-turns') {
      return iLost
        ? 'הפסדת — לא שיחקת 2 תורים ברצף'
        : 'ניצחת — היריב לא שיחק 2 תורים ברצף';
    }
    if (abandonReason === 'disconnect') {
      return iLost
        ? 'הפסדת — התנתקת מהמשחק'
        : 'ניצחת — היריב התנתק מהמשחק';
    }
    if (abandonReason === 'left') {
      return iLost
        ? 'עזבת את המשחק'
        : 'ניצחת — היריב עזב את המשחק';
    }
    return iLost ? 'פרשת מהמשחק' : 'היריב פרש';
  }

  function clearEloDeltas() {
    setText($('#elo-delta-1', overlay), '');
    setText($('#elo-delta-2', overlay), '');
    $('#elo-delta-1', overlay)?.classList?.remove('up', 'down');
    $('#elo-delta-2', overlay)?.classList?.remove('up', 'down');
    lastEloSignature.clear();
  }

  function renderEloDeltas({ myBefore, myAfter, oppBefore, oppAfter } = {}) {
    const mySlot = globalThis.__spine?.activeGame?.session?.mySlot;
    if (mySlot !== 0 && mySlot !== 1) return;
    const oppSlot = mySlot === 0 ? 1 : 0;
    if (Number.isFinite(myBefore) && Number.isFinite(myAfter)) {
      paintDelta(mySlot + 1, myAfter - myBefore, myAfter);
    }
    if (Number.isFinite(oppBefore) && Number.isFinite(oppAfter)) {
      paintDelta(oppSlot + 1, oppAfter - oppBefore, oppAfter);
    }
  }

  function paintDelta(slotOneBased, delta, newRating) {
    const el = $(`#elo-delta-${slotOneBased}`, overlay);
    if (!el) return;
    el.classList?.remove('up', 'down');
    if (delta > 0) el.classList?.add('up');
    else if (delta < 0) el.classList?.add('down');
    const sign = delta > 0 ? '+' : '';
    const signature = `${newRating}:${delta}`;
    const label = `דירוג ${newRating} (${sign}${delta})`;
    el.setAttribute?.('aria-label', label);
    if (lastEloSignature.get(slotOneBased) === signature) {
      setText(el, label);
      return;
    }
    lastEloSignature.set(slotOneBased, signature);
    el.classList?.remove('elo-reveal');
    void el.offsetWidth;
    el.classList?.add('elo-reveal');
    animateEloValue(el, { from: newRating - delta, to: newRating, delta, sign, slotOneBased });
  }

  function animateEloValue(el, { from, to, delta, sign, slotOneBased }) {
    const oldFrame = eloFrames.get(slotOneBased);
    if (oldFrame != null) globalThis.cancelAnimationFrame?.(oldFrame);
    if (prefersReducedMotion() || typeof globalThis.requestAnimationFrame !== 'function') {
      setText(el, `דירוג ${to} (${sign}${delta})`);
      return;
    }
    const start = globalThis.performance?.now?.() ?? Date.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ELO_REVEAL_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setText(el, `דירוג ${Math.round(from + (to - from) * eased)} (${sign}${delta})`);
      if (t < 1) eloFrames.set(slotOneBased, globalThis.requestAnimationFrame(tick));
      else eloFrames.delete(slotOneBased);
    };
    eloFrames.set(slotOneBased, globalThis.requestAnimationFrame(tick));
  }

  function unmount() {
    for (const frame of eloFrames.values()) globalThis.cancelAnimationFrame?.(frame);
    eloFrames.clear();
    for (const off of cleanups) try { off(); } catch { /* swallow */ }
    cleanups.length = 0;
  }

  return { unmount };
}

function prefersReducedMotion() {
  return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}
