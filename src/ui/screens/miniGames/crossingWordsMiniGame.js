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
import { isValid as isHebrewWordValid } from '../../../game/core/hebrewDictionary.js';
import { g, getGender } from '../../genderText.js';

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
  const candidates = words.filter(w => typeof w === 'string' && w.length >= minLen && w.length <= maxLen);
  if (candidates.length === 0) return null;
  const wc = candidates.slice(0, poolCap).slice().sort(() => rng() - 0.5);
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
    wrap.style.cssText = `display:grid;grid-template-columns:repeat(${gridCols},32px);gap:2px;background:#2a5878;border:2px solid #2a5878;border-radius:3px;margin:8px auto;width:fit-content;`;
    let input = null;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cell = doc.createElement('div');
        cell.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;';
        const isCross = r === pair.vpos && c === pair.hpos;
        const isHCell = r === pair.vpos;
        const isVCell = c === pair.hpos;
        if (isCross) {
          cell.style.background = '#5ba3cc';
          cell.style.border = '2px solid #e8d040';
          cell.style.color = '#e8d040';
          if (withInput) {
            input = doc.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.dir = 'rtl';
            input.placeholder = '?';
            input.setAttribute('aria-label', 'האות המשותפת');
            input.style.cssText = 'width:28px;height:28px;background:transparent;border:none;outline:none;text-align:center;font-size:18px;font-weight:900;color:#e8d040;font-family:inherit;padding:0;caret-color:#e8d040;';
            cell.appendChild(input);
          } else {
            cell.textContent = '?';
          }
        } else if (isHCell && c < pair.h.length) {
          cell.style.background = '#e8e0c8';
          cell.style.color = '#111';
          cell.textContent = pair.h[c];
        } else if (isVCell && r < pair.v.length) {
          cell.style.background = '#e8e0c8';
          cell.style.color = '#111';
          cell.textContent = pair.v[r];
        } else {
          cell.style.background = 'transparent';
        }
        wrap.appendChild(cell);
      }
    }
    return { wrap, input };
  }

  function attachLegacy() {
    bovic.textContent = '⚡';
    bovt.textContent  = 'שתי מילים חוצות!';
    bovd.textContent  = `מצא את האות המשותפת לשתי המילים תוך ${Math.floor(durationMs / 1000)} שניות (+${pts} נקודות!)`;
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
        bok.textContent = g('continueMiniGame', getGender());
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  function renderResult(result) {
    const fill = (letter) => ({
      h: pair.h.slice(0, pair.hpos) + letter + pair.h.slice(pair.hpos + 1),
      v: pair.v.slice(0, pair.vpos) + letter + pair.v.slice(pair.vpos + 1),
    });
    const correct = fill(pair.shared);
    const correctWordsHtml = `<span style="font-weight:900;color:var(--by);">${correct.h}</span> · <span style="font-weight:900;color:var(--by);">${correct.v}</span>`;

    if (!result.attempt) {
      return `<div style="text-align:center;padding:8px 0;">
        <div style="font-size:32px;margin-bottom:6px;">⏰</div>
        <div style="font-size:13px;color:rgba(255,255,255,.7);margin-bottom:6px;">הזמן נגמר!</div>
        <div style="font-size:14px;color:rgba(255,255,255,.85);">התשובה: ${correctWordsHtml}</div>
      </div>`;
    }
    if (result.success) {
      const made = fill(result.attempt);
      return `<div style="text-align:center;padding:8px 0;">
        <div style="font-size:32px;margin-bottom:6px;">✅</div>
        <div style="font-size:18px;font-weight:900;color:#8eff8e;margin-bottom:4px;">${made.h} · ${made.v}</div>
        <div style="font-size:13px;color:#8eff8e;margin-top:4px;">כל הכבוד! הצלחת! 🎉</div>
      </div>`;
    }
    const made = fill(result.attempt);
    return `<div style="text-align:center;padding:8px 0;">
      <div style="font-size:32px;margin-bottom:6px;">❌</div>
      <div style="font-size:15px;color:#ff8e8e;margin-bottom:6px;">${made.h} · ${made.v} — לא תקין</div>
      <div style="font-size:13px;color:rgba(255,255,255,.75);">התשובה הנכונה: ${correctWordsHtml}</div>
    </div>`;
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,19,61,.92);padding:20px;font-family:Heebo,sans-serif;';
    const card = doc.createElement('div');
    card.style.cssText = 'background:#0d2068;border-radius:14px;padding:18px;max-width:340px;color:#fff;text-align:center;';
    card.innerHTML = `
      <div style="font-size:16px;font-weight:900;margin-bottom:4px;">⚡ שתי מילים חוצות</div>
      <div style="font-size:11px;color:rgba(255,255,255,.55);margin-bottom:8px;">${Math.floor(durationMs / 1000)} שניות · +${pts} נקודות</div>
    `;
    const { wrap, input } = buildMiniGrid({ withInput: true });
    card.appendChild(wrap);
    const inputRow = doc.createElement('div');
    inputRow.style.cssText = 'margin-top:10px;display:flex;gap:6px;justify-content:center;';
    const submitBtn = doc.createElement('button');
    submitBtn.setAttribute('data-cw', 'submit');
    submitBtn.style.cssText = 'background:#e8c840;border:none;border-radius:8px;padding:8px 14px;font-family:inherit;font-size:14px;font-weight:900;color:#000;cursor:pointer;';
    submitBtn.textContent = 'בדוק';
    inputRow.appendChild(submitBtn);
    card.appendChild(inputRow);
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
