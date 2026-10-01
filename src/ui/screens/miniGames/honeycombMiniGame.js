// honeycombMiniGame — B12 "כוורת" (faithful port of the legacy
// buildHoneycomb from index.html ~6072).
//
// Rules (matching legacy):
//   • 12 hand-picked letter sets (center + 6 outer). One is chosen at
//     random each play.
//   • Player types or taps Hebrew words into a single text input. Each
//     guess must:
//       – contain the center letter (after `norm`),
//       – be at least 2 letters long,
//       – be a valid Hebrew word per the morphological validator.
//     Letters from outside the honeycomb are allowed — the legacy game
//     only enforces "must include the center" + dictionary validity.
//   • Repeats are rejected (compared after `norm`).
//   • Score per word by length: 2=3, 3=5, 4=8, 5+=10.
//   • 40-second timer.
//   • Click an outer hex tile → appends its letter to the input (typing
//     helper). Click the center tile → same.
//   • ⌫ clears the input. Enter or ✓ submits.
//   • Finalize: total = Σ word scores. Result chip rendered with emoji
//     based on threshold (≥30, ≥10, lower).
//
// Public surface:
//   HONEYCOMB_GROUPS                      — the 12 letter sets
//   pickHoneycombGroup(rng)               → { center, outer, letters }
//   wordPoints(word)                      → number
//   gradeHoneycombGuess(input, group, validator, found, normFn)
//                                          → { ok, points, normalized, reason }
//   mountHoneycombMiniGame(opts)          → { unmount, _puzzle, submit?, expire? }
//   playHoneycombForBonus(opts)
//   HC_INTENT.RESULT

import { startBonusTimer } from './bonusTimer.js';
import { showBonusResult, escapeHtml } from './bonusFx.js';
import { g, getGender } from '../../genderText.js';
import { BOOST_BOLT_ICON_HTML } from '../../boostIcon.js';
import { buildWordEntry, buildWordFeed } from './bonusUi.js';

const DEFAULT_DURATION_MS = 40_000;

export const HC_INTENT = Object.freeze({
  RESULT: 'honeycomb/result',
});

export const HONEYCOMB_GROUPS = Object.freeze([
  { c: 'מ', o: ['י','ל','ה','ו','כ','ב'] },
  { c: 'ש', o: ['ל','ו','ד','ה','ק','מ'] },
  { c: 'ד', o: ['ב','ר','י','כ','ה','ל'] },
  { c: 'ל', o: ['מ','ה','ד','י','כ','ת'] },
  { c: 'ה', o: ['ו','ל','כ','ש','י','ד'] },
  { c: 'ר', o: ['א','ו','ל','ש','י','ה'] },
  { c: 'כ', o: ['ת','ב','ל','ה','ש','מ'] },
  { c: 'א', o: ['ב','ה','ו','כ','ל','מ'] },
  { c: 'י', o: ['ל','ד','ה','ו','ר','ש'] },
  { c: 'ת', o: ['כ','ל','ב','ה','ו','ר'] },
  { c: 'נ', o: ['ג','ד','ב','י','ת','ו'] },
  { c: 'ב', o: ['י','ת','ה','ר','ל','כ'] },
].map(g => Object.freeze({ ...g, o: Object.freeze(g.o.slice()) })));

// Legacy hex positions (left, top) in pixels, for the 7 bounding boxes:
// [center, top, upper-R, lower-R, bottom, lower-L, upper-L].
const HEX_POSITIONS = Object.freeze([
  { l: 71, t: 63 },
  { l: 71, t: 7  },
  { l: 118, t: 35 },
  { l: 118, t: 91 },
  { l: 71, t: 119 },
  { l: 24, t: 91 },
  { l: 24, t: 35 },
]);
const HEX_W = 62;
const HEX_H = 54;

// Pure picker: choose one of the 12 GROUPS at random. Returns an object
// holding the center letter, the 6 outer letters, and the merged 7-letter
// list in the legacy display order (center first).
export function pickHoneycombGroup(rng = Math.random) {
  const g = HONEYCOMB_GROUPS[Math.floor(rng() * HONEYCOMB_GROUPS.length)];
  return {
    center: g.c,
    outer: g.o.slice(),
    letters: [g.c, ...g.o],
  };
}

// Word scoring exactly as the legacy `wPts`: 2=3, 3=5, 4=8, 5+=10.
export function wordPoints(word) {
  if (typeof word !== 'string') return 0;
  const n = [...word].length;
  if (n >= 5) return 10;
  if (n === 4) return 8;
  if (n === 3) return 5;
  if (n === 2) return 3;
  return 0;
}

// Grade a single attempt. `validator(word)` is the Hebrew dictionary check
// (the legacy uses `isValid`). `normFn(word)` is the spine's `norm` (used
// for the center-letter test and the de-duplication key).
export function gradeHoneycombGuess(input, group, validator, found, normFn = (x) => x) {
  if (typeof input !== 'string') return { ok: false, reason: 'no-input' };
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'no-input' };
  if ([...raw].length < 2) return { ok: false, reason: 'too-short' };
  const normRaw = normFn(raw);
  const normCenter = normFn(group?.center ?? '');
  if (!normRaw.includes(normCenter)) return { ok: false, reason: 'missing-center' };
  if (found instanceof Set && found.has(normRaw)) return { ok: false, reason: 'duplicate' };
  if (typeof validator !== 'function' || !validator(raw)) return { ok: false, reason: 'invalid' };
  return { ok: true, points: wordPoints(raw), normalized: normRaw };
}

export function mountHoneycombMiniGame({
  bus,
  group,
  validator = () => false,
  norm: normFn = (x) => x,
  durationMs = DEFAULT_DURATION_MS,
  rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
} = {}) {
  if (!bus) throw new Error('mountHoneycombMiniGame: bus required');

  const puzzle = group ?? pickHoneycombGroup(rng);
  const found = new Set();      // normalized words
  const accepted = [];          // [{ word, points }] in submission order
  let totalScore = 0;
  let resolved = false;
  let timer = null;
  let progressTimer = null;
  let legacyHook = null;
  let selfHost = null;
  let inputEl = null;
  let scoreEl = null;
  let feed    = null;   // buildWordFeed(): found-word chips + feedback line

  function submitRaw(raw) {
    if (resolved) return { ok: false, reason: 'resolved' };
    const r = gradeHoneycombGuess(raw, puzzle, validator, found, normFn);
    if (r.ok) {
      found.add(r.normalized);
      const entry = { word: raw.trim(), points: r.points };
      accepted.push(entry);
      totalScore += r.points;
    }
    return r;
  }

  function finalize({ timedOut = false } = {}) {
    if (resolved) return;
    resolved = true;
    if (timer) clearTimeout(timer);
    if (progressTimer) clearInterval(progressTimer);
    const r = {
      success: totalScore > 0,
      earnedPts: totalScore,
      foundCount: accepted.length,
      foundWords: accepted.map(a => a.word),
      timedOut,
    };
    bus.emit(HC_INTENT.RESULT, r);
    onResult(r);
    if (legacyHook) legacyHook.finalize(r);
    if (selfHost) try { selfHost.remove?.(); } catch {}
  }

  if (!doc?.createElement) {
    return {
      _puzzle: puzzle,
      submit(input) {
        const r = submitRaw(typeof input === 'string' ? input : '');
        return r;
      },
      expire() { finalize({ timedOut: true }); },
      finish: () => finalize({ timedOut: false }),
      unmount: () => finalize({ timedOut: false }),
    };
  }

  // Per-letter hex element registry — populated by buildHexGrid and read
  // by flashHexForLetter so both pointer clicks AND keyboard input flash
  // the same hex. Declared before attachLegacy() runs to avoid a TDZ error,
  // since buildHexGrid reads it during mount.
  const hexByLetter = new Map();

  // ─── DOM mount ───────────────────────────────────────────
  const bovic = doc.getElementById?.('bovic');
  const bovt  = doc.getElementById?.('bovt');
  const bovd  = doc.getElementById?.('bovd');
  const bchal = doc.getElementById?.('bchal');
  const bok   = doc.getElementById?.('bok');
  const ovBonus = doc.getElementById?.('ov-bonus');
  legacyHook = (bovic && bovt && bovd && bchal && bok && ovBonus) ? attachLegacy() : null;
  selfHost = legacyHook ? null : attachSelf();

  timer = setTimeout(() => finalize({ timedOut: true }), durationMs);
  // Online spectator: tick out secsLeft + running score every second.
  let remainingMs = durationMs;
  emitProgress(Math.ceil(remainingMs / 1000));
  progressTimer = setInterval(() => {
    remainingMs -= 1000;
    if (remainingMs < 0) remainingMs = 0;
    emitProgress(Math.ceil(remainingMs / 1000));
  }, 1000);
  function emitProgress(secsLeft) {
    try {
      bus?.emit?.('liveBonus/progress', {
        secsLeft, score: totalScore, label: 'כוורת',
      });
    } catch { /* swallow */ }
  }

  return {
    _puzzle: puzzle,
    unmount: () => finalize({ timedOut: false }),
  };

  // ─── DOM helpers ────────────────────────────────────────

  function flashHexForLetter(letter) {
    const el = hexByLetter.get(letter);
    if (!el) return;
    el.classList?.add?.('is-pressed');
    setTimeout(() => el.classList?.remove?.('is-pressed'), 120);
  }

  // Wood hexes (cyan bezel; the required centre letter has a gold bezel) on
  // a glass tray — styled by .hc-* in screens-glass.css. Only the per-hex
  // position stays inline.
  function buildHexGrid() {
    const tray = doc.createElement('div');
    tray.className = 'hc-tray';
    const hc = doc.createElement('div');
    hc.className = 'hc-grid';
    hexByLetter.clear();
    puzzle.letters.forEach((lt, i) => {
      const d = doc.createElement('div');
      d.className = i === 0 ? 'hc-hex is-center' : 'hc-hex';
      d.style.cssText = `left:${HEX_POSITIONS[i].l}px;top:${HEX_POSITIONS[i].t}px;width:${HEX_W}px;height:${HEX_H}px;`;
      d.textContent = lt;
      // Register the first hex carrying each letter so subsequent
      // duplicates (rare, but possible if a group repeats a letter) don't
      // override the original visual home of that letter.
      if (!hexByLetter.has(lt)) hexByLetter.set(lt, d);
      d.addEventListener('mousedown', (e) => e.preventDefault?.());
      d.addEventListener('click', () => {
        flashHexForLetter(lt);
        if (!inputEl) return;
        inputEl.value = (inputEl.value ?? '') + lt;
        inputEl.focus?.();
      });
      hc.appendChild(d);
    });
    tray.appendChild(hc);
    return tray;
  }

  function buildInputRow() {
    const { wrap, input } = buildWordEntry(doc, {
      inputId: 'hc-inp',
      placeholder: 'הקלד מילה...',
      inputMode: 'none',
      onSubmit: attemptSubmit,
    });
    inputEl = input;
    // Flash the matching hex when the player types a letter that's on the
    // honeycomb — same visual feedback as a pointer click on the hex.
    // The `input` event covers physical keyboards, IME composition, and
    // paste, so we don't need to special-case keydown vs keypress.
    let lastTypedLen = 0;
    inputEl.addEventListener('input', () => {
      const val = inputEl.value ?? '';
      if (val.length > lastTypedLen) {
        for (let i = lastTypedLen; i < val.length; i++) flashHexForLetter(val.charAt(i));
      }
      lastTypedLen = val.length;
    });
    return wrap;
  }

  function attemptSubmit() {
    if (!inputEl) return;
    const raw = inputEl.value;
    inputEl.value = '';
    const r = submitRaw(raw);
    if (r.ok) {
      if (scoreEl) scoreEl.textContent = totalScore + ' נקודות';
      feed?.addChip(accepted[accepted.length - 1]);
      feed?.say('+' + r.points + ' נקודות', 'ok');
    } else {
      feed?.say(reasonMessage(r.reason, puzzle.center), 'bad');
    }
  }

  function reasonMessage(reason, center) {
    switch (reason) {
      case 'too-short':       return 'לפחות 2 אותיות';
      case 'missing-center':  return `חייב לכלול "${center}"!`;
      case 'duplicate':       return 'כבר נמצאה!';
      case 'invalid':         return 'מילה לא תקינה';
      default:                return '';
    }
  }

  // Score pill + hexes + entry row + found-word feed, into `container`.
  function buildPlay(container) {
    scoreEl = doc.createElement('div');
    scoreEl.className = 'bz-score';
    scoreEl.textContent = '0 נקודות';
    container.appendChild(scoreEl);
    container.appendChild(buildHexGrid());
    container.appendChild(buildInputRow());
    feed = buildWordFeed(doc);
    container.appendChild(feed.chips);
    container.appendChild(feed.fb);
  }

  function attachLegacy() {
    bovic.innerHTML = BOOST_BOLT_ICON_HTML;
    bovt.textContent  = 'כוורת!';
    bovd.textContent  = `חבר מילים עם האות "${puzzle.center}" · מילה ארוכה = יותר נקודות`;
    bchal.innerHTML = '';
    buildPlay(bchal);

    ovBonus.classList?.remove?.('hidden');

    // No "סיים" early-finish button: the round ends only on the timer (or
    // unmount). Hide the overlay's OK button during play; finalize() restores
    // it as the "continue" button once the round resolves.
    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const prevDisplay = bok.style.display;
    bok.style.display = 'none';

    const stopBar = startBonusTimer({ doc, durationMs });

    return {
      finalize(result) {
        try { stopBar(); } catch { /* swallow */ }
        bok.style.display = prevDisplay ?? '';
        renderHoneycombResult(bchal, result, ovBonus?.querySelector?.('.ovc'));
        bok.textContent = g('continueMiniGame', getGender());
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  // Shared result screen (confetti + count-up on a win, calm otherwise); the
  // found words stay visible as chips. Used by the legacy + self-overlay paths.
  function renderHoneycombResult(containerEl, result, cardEl) {
    const win = result.earnedPts > 0;
    const chips = result.foundWords?.length
      ? `<div class="bz-chips is-result">${result.foundWords.map(w => `<span class="bz-chip">${escapeHtml(w)}</span>`).join('')}</div>`
      : '';
    showBonusResult(containerEl, {
      success: win,
      headline: result.foundCount === 1 ? 'מצאת מילה אחת' : result.foundCount ? `מצאת ${result.foundCount} מילים` : 'אין מילים הפעם',
      points: win ? result.earnedPts : null,
      sub: win ? '' : 'המשך לשחק ולחפש הזדמנויות נוספות.',
      extraHtml: chips,
      cardEl,
    });
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay bz-overlay';
    const card = doc.createElement('div');
    card.className = 'bz-card';
    card.innerHTML = `
      <div class="bz-bolt">${BOOST_BOLT_ICON_HTML}</div>
      <div class="bz-title">כוורת!</div>
      <div class="bz-sub">חבר מילים עם האות "${puzzle.center}"</div>`;
    const body = doc.createElement('div');
    body.className = 'bz-body';
    buildPlay(body);
    card.appendChild(body);

    // No "סיים" button — the round ends on the timer (or unmount).

    host.appendChild(card);
    doc.body?.appendChild(host);
    return host;
  }
}

export function playHoneycombForBonus({ bus, validator, norm, controller, rng }) {
  return mountHoneycombMiniGame({
    bus, validator, norm, rng,
    onResult: ({ success, earnedPts }) => controller?.resolveMiniGame?.({ success, earnedPts }),
  });
}
