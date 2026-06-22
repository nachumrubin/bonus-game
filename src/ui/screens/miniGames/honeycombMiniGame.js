// honeycombMiniGame — B12 "דבורת המילים" (faithful port of the legacy
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
import { showBonusResult } from './bonusFx.js';
import { g, getGender } from '../../genderText.js';

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
  let chipsEl = null;
  let fbEl    = null;

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
    const entry = hexByLetter.get(letter);
    if (!entry) return;
    const { el, pressedBg, restBg } = entry;
    el.style.backgroundColor = pressedBg;
    setTimeout(() => { el.style.backgroundColor = restBg; }, 120);
  }

  function buildHexGrid() {
    const hc = doc.createElement('div');
    hc.style.cssText = 'position:relative;width:204px;height:177px;margin:0 auto 8px;';
    hexByLetter.clear();
    puzzle.letters.forEach((lt, i) => {
      const d = doc.createElement('div');
      const isC = i === 0;
      // Resting + pressed background colours per hex role. Center = gold,
      // outer = white ceramic Boost tile. The pressed shade is darker so the
      // click registers visually (the flash sets backgroundColor directly, so
      // these stay solid colours; depth comes from the inset shadows below).
      const restBg    = isC ? '#ffe27a' : '#eef3fb';
      const pressedBg = isC ? '#e8b62f' : '#c9d6ea';
      d.style.cssText = `position:absolute;left:${HEX_POSITIONS[i].l}px;top:${HEX_POSITIONS[i].t}px;width:${HEX_W}px;height:${HEX_H}px;`
        + 'clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);'
        + `background:${restBg};display:flex;align-items:center;justify-content:center;`
        + `font-size:23px;font-weight:900;color:${isC ? '#3a2400' : '#16233f'};cursor:pointer;user-select:none;`
        + 'box-shadow:inset 0 3px 0 rgba(255,255,255,.6), inset 0 -5px 7px rgba(0,0,0,.22);'
        + 'transition:background-color .08s ease-out;';
      d.textContent = lt;
      // Register the first hex carrying each letter so subsequent
      // duplicates (rare, but possible if a group repeats a letter) don't
      // override the original visual home of that letter.
      if (!hexByLetter.has(lt)) hexByLetter.set(lt, { el: d, restBg, pressedBg });
      d.addEventListener('mousedown', (e) => e.preventDefault?.());
      d.addEventListener('click', () => {
        flashHexForLetter(lt);
        if (!inputEl) return;
        inputEl.value = (inputEl.value ?? '') + lt;
        inputEl.focus?.();
      });
      hc.appendChild(d);
    });
    return hc;
  }

  function buildInputRow() {
    const wrap = doc.createElement('div');
    wrap.style.cssText = 'margin-bottom:7px;';
    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:5px;margin-bottom:6px;align-items:center;';

    inputEl = doc.createElement('input');
    inputEl.type = 'text';
    inputEl.id = 'hc-inp';
    inputEl.className = 'ri';
    inputEl.style.marginBottom = '0';
    inputEl.dir = 'rtl';
    inputEl.placeholder = 'הקלד מילה...';
    inputEl.inputMode = 'none';
    inputEl.addEventListener('keydown', (e) => {
      if (e?.key === 'Enter') { e.preventDefault?.(); attemptSubmit(); }
    });
    // Flash the matching hex when the player types a letter that's on the
    // honeycomb — same visual feedback as a pointer click on the hex.
    // The `input` event covers physical keyboards, IME composition, and
    // paste, so we don't need to special-case keydown vs keypress.
    let lastTypedLen = 0;
    inputEl.addEventListener('input', () => {
      const val = inputEl.value ?? '';
      if (val.length > lastTypedLen) {
        // One or more characters were appended — flash each new char's hex
        // (typically just one, but paste can introduce a run).
        for (let i = lastTypedLen; i < val.length; i++) {
          flashHexForLetter(val.charAt(i));
        }
      }
      lastTypedLen = val.length;
    });

    const clr = doc.createElement('button');
    clr.textContent = '⌫';
    clr.style.cssText = 'flex-shrink:0;height:46px;padding:0 14px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:11px;color:#fff;font-size:16px;cursor:pointer;';
    clr.addEventListener('click', () => { inputEl.value = ''; inputEl.focus?.(); });

    // Full-width "✓" submit BELOW the input line — a big, easy tap target to
    // finalize a word (the input + ⌫ sit on the row above).
    const ok = doc.createElement('button');
    ok.textContent = '✓';
    ok.className = 'bz-btn bz-btn-gold';
    ok.style.cssText = 'width:100%;font-size:18px;';
    ok.addEventListener('click', attemptSubmit);

    row.appendChild(inputEl);
    row.appendChild(clr);
    wrap.appendChild(row);
    wrap.appendChild(ok);
    return wrap;
  }

  function attemptSubmit() {
    if (!inputEl) return;
    const raw = inputEl.value;
    inputEl.value = '';
    const r = submitRaw(raw);
    if (r.ok) {
      if (scoreEl) scoreEl.textContent = totalScore + ' נקודות';
      addChip(accepted[accepted.length - 1]);
      showFb('+' + r.points + ' נקודות 🎉', '#8eff8e');
    } else {
      showFb(reasonMessage(r.reason, puzzle.center), '#ff8e8e');
    }
  }

  function reasonMessage(reason, center) {
    switch (reason) {
      case 'too-short':       return 'לפחות 2 אותיות';
      case 'missing-center':  return `חייב לכלול "${center}"!`;
      case 'duplicate':       return 'כבר נמצאה!';
      case 'invalid':         return 'מילה לא תקינה ✗';
      default:                return '';
    }
  }

  function addChip(entry) {
    if (!chipsEl) return;
    const chip = doc.createElement('span');
    chip.className = 'bz-chip';
    chip.textContent = entry.word + ' +' + entry.points;
    chipsEl.appendChild(chip);
    chipsEl.scrollTop = chipsEl.scrollHeight;
  }

  function showFb(msg, color) {
    if (!fbEl) return;
    fbEl.textContent = msg;
    fbEl.style.color = color || '#fff';
  }

  function attachLegacy() {
    bovic.textContent = '⚡';
    bovt.textContent  = 'דבורת המילים!';
    bovd.textContent  = `חבר מילים עם "${puzzle.center}" — 2אות=3 | 3=5 | 4=8 | 5+=10`;
    bchal.innerHTML = '';

    scoreEl = doc.createElement('div');
    scoreEl.style.cssText = 'text-align:center;font-size:12px;color:rgba(255,255,255,.7);margin-bottom:5px;';
    scoreEl.textContent = '0 נקודות';
    bchal.appendChild(scoreEl);

    bchal.appendChild(buildHexGrid());
    bchal.appendChild(buildInputRow());

    chipsEl = doc.createElement('div');
    chipsEl.style.cssText = 'max-height:68px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px;justify-content:center;direction:rtl;margin-bottom:4px;';
    bchal.appendChild(chipsEl);

    fbEl = doc.createElement('div');
    fbEl.id = 'hc-fb';
    fbEl.style.cssText = 'text-align:center;font-size:12px;min-height:16px;';
    bchal.appendChild(fbEl);

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

  // Premium success/failure screen (confetti + count-up on a win, calm
  // encouragement otherwise). Shared by the legacy + self-overlay paths.
  function renderHoneycombResult(containerEl, result, cardEl) {
    const win = result.earnedPts > 0;
    showBonusResult(containerEl, {
      success: win,
      emoji: result.earnedPts >= 30 ? '🎉' : result.earnedPts >= 10 ? '😊' : '😌',
      headline: result.foundCount ? `${result.foundCount} מילים` : 'אין מילים הפעם',
      points: win ? result.earnedPts : null,
      sub: win ? '' : 'המשך לשחק ולחפש הזדמנויות נוספות.',
      cardEl,
    });
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay bz-overlay';
    const card = doc.createElement('div');
    card.className = 'bz-card';

    const bolt = doc.createElement('div');
    bolt.className = 'bz-bolt';
    bolt.textContent = '🐝';
    card.appendChild(bolt);

    const title = doc.createElement('div');
    title.className = 'bz-title';
    title.textContent = 'דבורת המילים!';
    card.appendChild(title);

    scoreEl = doc.createElement('div');
    scoreEl.className = 'bz-sub';
    scoreEl.textContent = '0 נקודות';
    card.appendChild(scoreEl);

    card.appendChild(buildHexGrid());
    card.appendChild(buildInputRow());

    chipsEl = doc.createElement('div');
    chipsEl.style.cssText = 'max-height:68px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px;justify-content:center;direction:rtl;margin-bottom:4px;';
    card.appendChild(chipsEl);

    fbEl = doc.createElement('div');
    fbEl.style.cssText = 'text-align:center;font-size:12px;min-height:16px;margin-bottom:6px;';
    card.appendChild(fbEl);

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
