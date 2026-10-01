// crossingWordsMiniGame — B10 "שתי מילים חוצות" (faithful port of the
// legacy getDynamicCrossingPair + buildCrossingWords from
// index.html ~5714 / 6674).
//
// Rules (matching legacy):
//   • Pick two Hebrew words (3–6 letters, no final-letter forms — the
//     caller is expected to pass `norm()`-equivalent words) that share at
//     least one letter, excluding the four most-common letters (א, ה, ו, י).
//   • Word `h` is laid out horizontally on row `vpos`; word `v` is laid out
//     vertically on column `hpos`. They cross at (vpos, hpos) — the
//     shared letter, which is shown as `?`.
//   • Player has 20 seconds to type the missing letter.
//   • Correct → +40 points. Wrong / timeout → 0 points, the answer is
//     revealed.
//   • If no dynamic pair can be found, fall back to the legacy static pair:
//     {h:'תפוח', v:'חגים', hpos:3, vpos:0}.
//
// Public surface:
//   findCrossingPair(words, opts)           → { h, v, hpos, vpos, shared } | null
//   FALLBACK_CROSSING_PAIR                  → the legacy static fallback
//   gradeCrossingLetter(attempt, shared)    → boolean
//   mountCrossingWordsMiniGame(opts)        → { unmount, _puzzle, submit? }
//   playCrossingWordsForBonus(opts)
//   CR_INTENT.RESULT
//
// `submit(letter)` on the no-DOM return surface lets tests check a single
// guess without spinning up DOM.

import { startBonusTimer } from './bonusTimer.js';
import { confettiBurst, bonusResultHtml, startResultCount, escapeHtml } from './bonusFx.js';
import { isValid as isHebrewWordValid, isMiniGameWord } from '../../../game/core/hebrewDictionary.js';
import { g, getGender } from '../../genderText.js';
import { BOOST_BOLT_ICON_HTML } from '../../boostIcon.js';

const BLOCKED_SHARED = new Set(['א', 'ה', 'ו', 'י']);
const DEFAULT_DURATION_MS = 20_000;
const DEFAULT_PTS = 40;
const DEFAULT_MIN_LEN = 3;
const DEFAULT_MAX_LEN = 6;
const POOL_CAP = 200;
const PAIR_SCAN_WINDOW = 30;

export const FALLBACK_CROSSING_PAIR = Object.freeze({
  h: 'תפוח',
  v: 'חגים',
  hpos: 3,
  vpos: 0,
  shared: 'ח',
});

export const CR_INTENT = Object.freeze({
  RESULT: 'crossingWords/result',
});

// Pure picker. Looks for two words within the candidate pool whose
// intersection letter is not one of the four overly-common Hebrew letters.
// Mirrors getDynamicCrossingPair from the legacy spine.
export function findCrossingPair(words, {
  rng = Math.random,
  minLen = DEFAULT_MIN_LEN,
  maxLen = DEFAULT_MAX_LEN,
  poolCap = POOL_CAP,
  scanWindow = PAIR_SCAN_WINDOW,
  blockedShared = BLOCKED_SHARED,
} = {}) {
  if (!Array.isArray(words)) return null;
  const candidates = words.filter(w => typeof w === 'string' && w.length >= minLen && w.length <= maxLen && isMiniGameWord(w));
  if (candidates.length === 0) return null;
  // Shuffle the WHOLE candidate list before capping. The runtime dictionary
  // is alphabetically sorted, so slicing first (the old order) restricted the
  // pool to the leading run of words — all starting with א — which made the
  // crossing letter almost always ב (the first non-blocked letter of the
  // "אב…" cluster). Shuffling first draws a representative sample.
  const wc = candidates.slice().sort(() => rng() - 0.5).slice(0, poolCap);
  for (let i = 0; i < wc.length; i++) {
    const h = wc[i];
    const upper = Math.min(i + scanWindow, wc.length);
    for (let j = i + 1; j < upper; j++) {
      const v = wc[j];
      for (let hi = 0; hi < h.length; hi++) {
        const shared = h[hi];
        if (blockedShared.has(shared)) continue;
        const vi = v.indexOf(shared);
        if (vi >= 0) {
          return { h, v, hpos: hi, vpos: vi, shared };
        }
      }
    }
  }
  return null;
}

// Grade a single-letter guess. The original puzzle has one specific shared
// letter, but ANY letter that turns both substituted words into legal
// Hebrew words is a valid answer — the user-facing rule is "fill the
// crossing letter so both words are real," not "guess the exact letter we
// picked."
//
// `pair` is the full {h, v, hpos, vpos, shared} puzzle. `dictCheck` is an
// injectable validator (defaults to the Hebrew dictionary); callers can
// pass a stub in tests.
export function gradeCrossingLetter(attempt, sharedOrPair, { dictCheck = isHebrewWordValid } = {}) {
  if (typeof attempt !== 'string') return false;
  // Backwards-compatible signature: gradeCrossingLetter('א', 'א') still works.
  if (typeof sharedOrPair === 'string') {
    return attempt === sharedOrPair;
  }
  const pair = sharedOrPair;
  if (!pair || typeof pair.shared !== 'string') return false;
  if (attempt === pair.shared) return true;
  if (attempt.length !== 1) return false;
  if (typeof pair.h !== 'string' || typeof pair.v !== 'string') return false;
  if (typeof pair.hpos !== 'number' || typeof pair.vpos !== 'number') return false;
  const newH = pair.h.slice(0, pair.hpos) + attempt + pair.h.slice(pair.hpos + 1);
  const newV = pair.v.slice(0, pair.vpos) + attempt + pair.v.slice(pair.vpos + 1);
  try {
    return !!(dictCheck(newH) && dictCheck(newV));
  } catch {
    return false;
  }
}

export function mountCrossingWordsMiniGame({
  bus,
  words = [],
  durationMs = DEFAULT_DURATION_MS,
  pts = DEFAULT_PTS,
  rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
} = {}) {
  if (!bus) throw new Error('mountCrossingWordsMiniGame: bus required');

  const pair = findCrossingPair(words, { rng }) ?? FALLBACK_CROSSING_PAIR;
  const startedAt = Date.now();
  let resolved = false;
  let timer = null;
  let progressTimer = null;
  let legacyHook = null;
  let selfHost = null;

  function finish({ correct, attempt }) {
    if (resolved) return;
    resolved = true;
    if (timer) clearTimeout(timer);
    if (progressTimer) clearInterval(progressTimer);
    const earnedPts = correct ? pts : 0;
    const r = {
      success: !!correct,
      earnedPts,
      attempt: attempt ?? '',
      shared: pair.shared,
      // The full puzzle — the two crossing words and where they intersect — so
      // the debug recorder can show exactly what was asked (e.g. "תפוח ✕ חגים,
      // shared ח, player typed ק → lost"). Purely additive; existing consumers
      // ignore the extra fields.
      h: pair.h,
      v: pair.v,
      hpos: pair.hpos,
      vpos: pair.vpos,
    };
    bus.emit(CR_INTENT.RESULT, r);
    onResult(r);
    if (legacyHook) legacyHook.finalize(r);
    if (selfHost) try { selfHost.remove?.(); } catch {}
  }

  if (!doc?.createElement) {
    // Pure no-DOM API for tests: submit(letter) commits a guess and
    // finishes. expire() simulates the timer running out.
    return {
      _puzzle: pair,
      submit(letter) {
        const trimmed = typeof letter === 'string' ? letter.trim() : '';
        finish({ correct: gradeCrossingLetter(trimmed, pair.shared), attempt: trimmed });
      },
      expire() { finish({ correct: false, attempt: '' }); },
      finish: () => finish({ correct: false, attempt: '' }),
      unmount: () => finish({ correct: false, attempt: '' }),
    };
  }

  // Try to mount into the legacy #ov-bonus / #bchal overlay first.
  const bovic = doc.getElementById?.('bovic');
  const bovt  = doc.getElementById?.('bovt');
  const bovd  = doc.getElementById?.('bovd');
  const bchal = doc.getElementById?.('bchal');
  const bok   = doc.getElementById?.('bok');
  const ovBonus = doc.getElementById?.('ov-bonus');
  legacyHook = (bovic && bovt && bovd && bchal && bok && ovBonus) ? attachLegacy() : null;
  selfHost = legacyHook ? null : attachSelf();

  // Timer just expires once — no per-second tick is needed for a 20s
  // single-input challenge.
  timer = setTimeout(() => finish({ correct: false, attempt: '' }), durationMs);
  // Online spectator: tick out secsLeft for the opponent's overlay.
  let remainingMs = durationMs;
  emitProgress(Math.ceil(remainingMs / 1000));
  progressTimer = setInterval(() => {
    remainingMs -= 1000;
    if (remainingMs < 0) remainingMs = 0;
    emitProgress(Math.ceil(remainingMs / 1000));
  }, 1000);
  function emitProgress(secsLeft) {
    try {
      bus?.emit?.('liveBonus/progress', { secsLeft, label: 'מילים מצטלבות' });
    } catch { /* swallow */ }
  }

  return { _puzzle: pair, unmount: () => finish({ correct: false, attempt: '' }) };

  // ─── DOM helpers ────────────────────────────────────────

  function buildMiniGrid({ withInput = false } = {}) {
    const gridRows = pair.v.length;
    const gridCols = pair.h.length;
    const wrap = doc.createElement('div');
    wrap.className = 'cw-mini-grid';
    wrap.style.setProperty('--cw-cols', String(gridCols));
    let input = null;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cell = doc.createElement('div');
        cell.className = 'cw-cell is-empty';
        const isCross = r === pair.vpos && c === pair.hpos;
        const isHCell = r === pair.vpos;
        const isVCell = c === pair.hpos;
        if (isCross) {
          cell.className = 'cw-cell is-cross';
          if (withInput) {
            input = doc.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.dir = 'rtl';
            input.placeholder = '?';
            input.className = 'cw-input';
            input.setAttribute('aria-label', 'האות המשותפת');
            cell.appendChild(input);
          } else {
            cell.textContent = '?';
          }
        } else if (isHCell && c < pair.h.length) {
          cell.className = 'cw-cell is-letter';
          cell.textContent = pair.h[c];
        } else if (isVCell && r < pair.v.length) {
          cell.className = 'cw-cell is-letter';
          cell.textContent = pair.v[r];
        } else {
          cell.className = 'cw-cell is-empty';
        }
        wrap.appendChild(cell);
      }
    }
    return { wrap, input };
  }

  function attachLegacy() {
    bovic.innerHTML = BOOST_BOLT_ICON_HTML;
    bovt.textContent  = 'מילים מצטלבות!';
    bovd.textContent  = `מצא את האות המשותפת · ${Math.floor(durationMs / 1000)} שניות · ${pts} נקודות`;
    bchal.innerHTML = '';
    const { wrap, input } = buildMiniGrid({ withInput: true });
    bchal.appendChild(wrap);

    ovBonus.classList?.remove?.('hidden');
    setTimeout(() => input?.focus?.(), 0);

    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const handleSubmit = (e) => {
      e?.preventDefault?.();
      const attempt = (input?.value ?? '').trim();
      finish({ correct: gradeCrossingLetter(attempt, pair), attempt });
    };
    input?.addEventListener?.('keydown', (e) => {
      if (e.key === 'Enter') handleSubmit(e);
    });
    bok.textContent = 'בדוק ✓';
    bok.addEventListener('click', handleSubmit);

    const stopBar = startBonusTimer({ doc, durationMs });

    return {
      finalize(result) {
        try { stopBar(); } catch { /* swallow */ }
        bok.removeEventListener('click', handleSubmit);
        bchal.innerHTML = renderResult(result);
        startResultCount(bchal, result.success ? pts : null);
        if (result.success) confettiBurst(ovBonus?.querySelector?.('.ovc'));
        bok.textContent = g('continueMiniGame', getGender());
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  // Result: the crossing re-drawn with the shared letter filled in — green
  // bezel when the player's letter made two words, otherwise the correct
  // letter (and the player's wrong guess in red above it).
  function renderResult(result) {
    const solvedGrid = resultGridHtml(pair.shared, result.success ? 'ok' : 'given');
    if (!result.attempt) {
      return bonusResultHtml({
        success: false, icon: 'hour', headline: 'הזמן נגמר!',
        sub: 'התשובה:', extraHtml: solvedGrid,
      });
    }
    if (result.success) {
      return bonusResultHtml({
        success: true, headline: 'כל הכבוד!', points: pts,
        extraHtml: resultGridHtml(result.attempt, 'ok'),
      });
    }
    return bonusResultHtml({
      success: false, tone: 'bad', icon: 'x',
      headline: `האות ${escapeHtml(result.attempt)} לא יוצרת שתי מילים`,
      sub: 'התשובה הנכונה:', extraHtml: solvedGrid,
    });
  }

  // Static copy of the crossing grid with `letter` in the shared cell.
  function resultGridHtml(letter, tone) {
    const cells = [];
    for (let r = 0; r < pair.v.length; r++) {
      for (let c = 0; c < pair.h.length; c++) {
        if (r === pair.vpos && c === pair.hpos) {
          cells.push(`<div class="cw-cell is-letter is-${tone}">${escapeHtml(letter)}</div>`);
        } else if (r === pair.vpos) {
          cells.push(`<div class="cw-cell is-letter">${pair.h[c]}</div>`);
        } else if (c === pair.hpos) {
          cells.push(`<div class="cw-cell is-letter">${pair.v[r]}</div>`);
        } else {
          cells.push('<div class="cw-cell is-empty"></div>');
        }
      }
    }
    return `<div class="cw-mini-grid is-result" style="--cw-cols:${pair.h.length}">${cells.join('')}</div>`;
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay bz-overlay';
    const card = doc.createElement('div');
    card.className = 'bz-card';
    card.innerHTML = `
      <div class="bz-bolt">${BOOST_BOLT_ICON_HTML}</div>
      <div class="bz-title">מילים מצטלבות!</div>
      <div class="bz-sub">${Math.floor(durationMs / 1000)} שניות · ${pts} נקודות</div>
    `;
    const { wrap, input } = buildMiniGrid({ withInput: true });
    card.appendChild(wrap);
    const submitBtn = doc.createElement('button');
    submitBtn.setAttribute('data-cw', 'submit');
    submitBtn.className = 'bz-btn';
    submitBtn.textContent = 'בדוק ✓';
    card.appendChild(submitBtn);
    host.appendChild(card);
    doc.body?.appendChild(host);
    setTimeout(() => input?.focus?.(), 0);

    const handleSubmit = () => {
      const attempt = (input?.value ?? '').trim();
      finish({ correct: gradeCrossingLetter(attempt, pair), attempt });
    };
    submitBtn.addEventListener('click', handleSubmit);
    input?.addEventListener?.('keydown', (e) => {
      if (e.key === 'Enter') handleSubmit();
    });
    return host;
  }
}

export function playCrossingWordsForBonus({ bus, words, controller, rng }) {
  return mountCrossingWordsMiniGame({
    bus, words, rng,
    onResult: ({ success, earnedPts }) => controller?.resolveMiniGame?.({ success, earnedPts }),
  });
}
