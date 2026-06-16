// hiddenWordMiniGame — B11 מילה נסתרת.
//
// A 4×4 grid of Hebrew letters hides one 3-letter dictionary word along a
// straight or diagonal line. Every other cell is a random Hebrew letter, so
// other valid words may form in the grid by chance. The player has 20
// seconds to select a straight/diagonal run that spells a real word.
//
// Crucially: because the random fill can produce unintended words, a
// selection is accepted whenever it spells a word that is IN THE DICTIONARY —
// it is never string-compared to the single word we hid. The hidden word
// merely guarantees at least one solution exists. Find any dictionary word
// (forward or reverse) and the bonus is awarded.
//
// Rules:
//   • 4×4 grid (16 cells)
//   • one hidden 3-letter dictionary word (guarantees a solution exists)
//   • 8 directions: horizontal, vertical, and all 4 diagonals
//   • 10-second timer
//   • Tap one cell to start the selection, tap a second cell on the same
//     straight/diagonal line to commit. Same cell twice = cancel.
//   • The committed run must be exactly the hidden word's length (3 letters);
//     it is read forward AND reverse, and if either is a valid dictionary word
//     the round is won. Shorter incidental runs (e.g. 2 letters) don't count.
//   • Award is all-or-nothing: 30 points on the first valid word, else 0.
//   • Empty cells filled with random Hebrew letters (no final forms).
//   • "סיים" finishes early.
//
// Public surface:
//   placeHiddenWord(words, opts)    → { grid, hidden }
//   readLine(grid, from, to)        → string | null (supports diagonals)
//   mountHiddenWordMiniGame(opts)   → { unmount, _puzzle, submit?, finish? }
//   playHiddenWordForBonus(opts)
//
// The mount renders into the legacy #ov-bonus / #bchal overlay when those
// DOM nodes exist (the normal in-game path); otherwise it falls back to a
// self-mounted fixed overlay (Node tests, isolated harness).

const HEBREW_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');

// Map final-form letters to their base forms so grid tiles never show sofit chars.
const SOFIT_TO_BASE = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
function normWord(w) { return [...w].map(ch => SOFIT_TO_BASE[ch] ?? ch).join(''); }

const ALL_DIRECTIONS = [
  [0, 1], [0, -1],            // horizontal
  [1, 0], [-1, 0],            // vertical
  [1, 1], [1, -1],            // ↘ / ↙
  [-1, 1], [-1, -1],          // ↗ / ↖
];

import { startBonusTimer } from './bonusTimer.js';
import { g, getGender } from '../../genderText.js';
import { isMiniGameWord } from '../../../game/core/hebrewDictionary.js';

const DEFAULT_SIZE = 4;
const DEFAULT_WORD_LEN = 3;
const DEFAULT_DURATION_MS = 10_000;
const DEFAULT_REWARD_PTS = 30;

export const HW_INTENT = Object.freeze({
  RESULT: 'hiddenWord/result',
});

function placeAt(grid, letters, r, c, dr, dc, size) {
  for (let i = 0; i < letters.length; i++) {
    const rr = r + dr * i, cc = c + dc * i;
    if (rr < 0 || rr >= size || cc < 0 || cc >= size) return null;
    const cur = grid[rr][cc];
    if (cur && cur !== letters[i]) return null;
  }
  const next = grid.map(row => row.slice());
  for (let i = 0; i < letters.length; i++) next[r + dr * i][c + dc * i] = letters[i];
  const last = letters.length - 1;
  return {
    grid: next,
    placement: {
      word: letters.join(''),
      from: { r, c },
      to:   { r: r + dr * last, c: c + dc * last },
      dr, dc,
    },
  };
}

// Builder: hides one word of `wordLen` letters somewhere in a size×size grid
// and fills the rest with random Hebrew letters. Picks the first word from
// `words` (shuffled) whose normalised length matches and that fits the grid.
export function placeHiddenWord(words, {
  size = DEFAULT_SIZE,
  wordLen = DEFAULT_WORD_LEN,
  rng = Math.random,
  directions = ALL_DIRECTIONS,
} = {}) {
  const candidates = (Array.isArray(words) ? words : [])
    .filter(w => typeof w === 'string')
    .map(normWord)
    .filter(w => w.length === wordLen && w.length <= size && isMiniGameWord(w));
  // Shuffle so the same grid isn't produced every game.
  candidates.sort(() => rng() - 0.5);

  let grid = Array.from({ length: size }, () => Array(size).fill(null));
  let hidden = null;

  for (const word of candidates) {
    const letters = [...word];
    let placed = null;
    for (let t = 0; t < 200 && !placed; t++) {
      const d = directions[Math.floor(rng() * directions.length)];
      const r0 = Math.floor(rng() * size);
      const c0 = Math.floor(rng() * size);
      placed = placeAt(grid, letters, r0, c0, d[0], d[1], size);
    }
    if (!placed) {
      // Systematic fallback scan.
      outer:
      for (const d of directions) {
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) {
            placed = placeAt(grid, letters, r, c, d[0], d[1], size);
            if (placed) break outer;
          }
        }
      }
    }
    if (placed) { grid = placed.grid; hidden = placed.placement; break; }
  }

  const filled = grid.map(row => row.map(ch =>
    ch ?? HEBREW_LETTERS[Math.floor(rng() * HEBREW_LETTERS.length)],
  ));
  return { grid: filled, hidden };
}

// Read the letters along the straight or diagonal line from `from` to `to`.
// Returns null if the two points don't lie on the same row, column, or 45°
// diagonal, or if either is out of bounds.
export function readLine(grid, from, to) {
  if (!grid?.length) return null;
  if (!from || !to) return null;
  const { r: r1, c: c1 } = from;
  const { r: r2, c: c2 } = to;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (r1 < 0 || r1 >= rows || r2 < 0 || r2 >= rows || c1 < 0 || c1 >= cols || c2 < 0 || c2 >= cols) return null;

  const dRow = r2 - r1;
  const dCol = c2 - c1;
  const straight = dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol);
  if (!straight) return null;

  const len = Math.max(Math.abs(dRow), Math.abs(dCol)) + 1;
  const sr = dRow === 0 ? 0 : Math.sign(dRow);
  const sc = dCol === 0 ? 0 : Math.sign(dCol);
  let s = '';
  for (let i = 0; i < len; i++) s += grid[r1 + sr * i][c1 + sc * i];
  return s;
}

// Mount the mini-game UI. When the legacy #ov-bonus / #bchal overlay exists
// (the normal in-game DOM) we render INTO it so the surrounding chrome
// (title / desc / OK button) is reused. Otherwise we fall back to a
// self-contained fixed overlay for Node tests / isolated harnesses.
export function mountHiddenWordMiniGame({
  bus,
  words = [],
  validator = () => false,
  size = DEFAULT_SIZE,
  wordLen = DEFAULT_WORD_LEN,
  rewardPts = DEFAULT_REWARD_PTS,
  durationMs = DEFAULT_DURATION_MS,
  directions = ALL_DIRECTIONS,
  rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
} = {}) {
  if (!bus) throw new Error('mountHiddenWordMiniGame: bus required');
  if (typeof validator !== 'function') throw new Error('mountHiddenWordMiniGame: validator function required');

  const puzzle = placeHiddenWord(words, { size, wordLen, rng, directions });
  const startedAt = Date.now();
  let resolved = false;
  let timer = null;
  let legacyHook = null;
  let selfHost = null;
  let foundWord = null;

  function elapsedSec() { return Math.floor((Date.now() - startedAt) / 1000); }

  // Accept a forward/reverse reading if it is a dictionary word. The selection
  // must be EXACTLY wordLen letters long — the challenge asks for an N-letter
  // word (the hidden word's length), so shorter incidental words (e.g. a
  // 2-letter run) don't count. Returns the matched word or null.
  function checkSelection(from, to) {
    const fwd = readLine(puzzle.grid, from, to);
    if (!fwd || fwd.length !== wordLen) return null;
    const rev = [...fwd].reverse().join('');
    if (validator(fwd)) return fwd;
    if (validator(rev)) return rev;
    return null;
  }

  function finish() {
    if (resolved) return;
    resolved = true;
    if (timer) clearInterval(timer);
    const success = !!foundWord;
    const r = {
      success,
      earnedPts: success ? rewardPts : 0,
      word: foundWord,
      hiddenWord: puzzle.hidden?.word ?? null,
    };
    bus.emit(HW_INTENT.RESULT, r);
    onResult(r);
    if (legacyHook) legacyHook.finalize(r);
    if (selfHost) try { selfHost.remove?.(); } catch {}
  }

  // No DOM available — return the pure submit/finish API used by tests.
  if (!doc?.createElement) {
    return {
      _puzzle: puzzle,
      submit: (from, to) => {
        if (resolved) return false;
        const hit = checkSelection(from, to);
        if (hit) { foundWord = hit; finish(); }
        return !!hit;
      },
      finish,
      unmount: finish,
    };
  }

  if (!puzzle.hidden) {
    queueMicrotask(() => {
      const r = { success: false, earnedPts: 0, word: null, reason: 'no-words' };
      bus.emit(HW_INTENT.RESULT, r);
      onResult(r);
    });
    return { unmount() {}, _puzzle: puzzle };
  }

  let firstSel = null;
  let cellEls = [];
  let statusEl = null;

  const bovic = doc.getElementById?.('bovic');
  const bovt  = doc.getElementById?.('bovt');
  const bovd  = doc.getElementById?.('bovd');
  const bchal = doc.getElementById?.('bchal');
  const bok   = doc.getElementById?.('bok');
  const ovBonus = doc.getElementById?.('ov-bonus');
  legacyHook = (bovic && bovt && bovd && bchal && bok && ovBonus) ? attachLegacy() : null;
  selfHost = legacyHook ? null : attachSelf();

  emitProgress();
  timer = setInterval(() => {
    if (resolved) return;
    if (elapsedSec() * 1000 >= durationMs) { finish(); return; }
    emitProgress();
  }, 1000);

  function emitProgress() {
    try {
      const secsLeft = Math.max(0, Math.ceil((durationMs - elapsedSec() * 1000) / 1000));
      bus?.emit?.('liveBonus/progress', {
        secsLeft,
        score: foundWord ? rewardPts : 0,
        label: 'מילה נסתרת',
      });
    } catch { /* swallow */ }
  }

  return {
    _puzzle: puzzle,
    unmount: finish,
  };

  // ─── DOM helpers ────────────────────────────────────────

  function attachLegacy() {
    bovic.textContent = '⚡';
    bovt.textContent  = 'מילה נסתרת!';
    bovd.textContent  = `מצא מילה אחת באורך ${wordLen} אותיות תוך ${Math.floor(durationMs / 1000)} שניות`;
    bchal.innerHTML = '';

    statusEl = doc.createElement('div');
    statusEl.style.cssText = 'text-align:center;font-size:13px;font-weight:700;color:rgba(255,255,255,.7);min-height:20px;margin-bottom:4px;';
    bchal.appendChild(statusEl);

    const gridEl = buildGridEl(doc);
    bchal.appendChild(gridEl);

    ovBonus.classList?.remove?.('hidden');

    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const handleEarly = (e) => { e?.preventDefault?.(); finish(); };
    bok.textContent = 'סיים ▶';
    bok.addEventListener('click', handleEarly);

    const stopBar = startBonusTimer({ doc, durationMs });

    return {
      finalize(result) {
        try { stopBar(); } catch { /* swallow */ }
        bok.removeEventListener('click', handleEarly);
        const emoji = result.success ? '🎉' : '⏰';
        const color = result.success ? '#8eff8e' : 'rgba(255,255,255,.6)';
        const line = result.success
          ? `מצאת את המילה "${result.word}"`
          : `לא נמצאה מילה — המילה הנסתרת הייתה "${result.hiddenWord}"`;
        bchal.innerHTML = `<div style="text-align:center;padding:10px 0">
          <div style="font-size:32px;margin-bottom:6px">${emoji}</div>
          <div style="font-size:15px;font-weight:900;color:${color};margin-bottom:5px">${line}</div>
          <div style="font-size:14px;color:var(--by);font-weight:700">+${result.earnedPts} נקודות</div>
        </div>`;
        bok.textContent = g('continueMiniGame', getGender());
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay hw-self-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,19,61,.92);padding:20px;font-family:Heebo,sans-serif;';
    doc.body?.appendChild(host);

    const inner = doc.createElement('div');
    inner.style.cssText = 'background:#0d2068;border-radius:14px;padding:18px;max-width:340px;color:#fff;text-align:center;';
    inner.innerHTML = `
      <div style="font-size:16px;font-weight:900;margin-bottom:2px;">⚡ מילה נסתרת</div>
      <div style="font-size:12px;color:rgba(255,255,255,.65);margin-bottom:8px;">מצא מילה באורך ${wordLen} אותיות</div>`;
    const statusHost = doc.createElement('div');
    statusHost.style.cssText = 'text-align:center;font-size:13px;font-weight:700;color:rgba(255,255,255,.7);min-height:20px;margin-bottom:4px;';
    statusEl = statusHost;
    inner.appendChild(statusHost);
    inner.appendChild(buildGridEl(doc));
    const doneBtn = doc.createElement('button');
    doneBtn.style.cssText = 'margin-top:12px;background:#e8c840;border:none;border-radius:8px;padding:8px 18px;font-family:inherit;font-size:14px;font-weight:900;color:#000;cursor:pointer;';
    doneBtn.textContent = 'סיים';
    doneBtn.addEventListener('click', finish);
    inner.appendChild(doneBtn);
    host.appendChild(inner);
    return host;
  }

  function buildGridEl(d) {
    const gridEl = d.createElement('div');
    gridEl.className = 'hwgrid';
    gridEl.style.setProperty('grid-template-columns', `repeat(${size}, 1fr)`);
    cellEls = [];
    for (let r = 0; r < size; r++) {
      cellEls[r] = [];
      for (let c = 0; c < size; c++) {
        const el = d.createElement('div');
        el.className = 'hwcell';
        el.textContent = puzzle.grid[r][c];
        el.addEventListener('click', () => onCell(r, c));
        gridEl.appendChild(el);
        cellEls[r][c] = el;
      }
    }
    return gridEl;
  }

  function setStatus(text, ok) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = ok === true ? '#8eff8e' : ok === false ? '#ff9e9e' : 'rgba(255,255,255,.7)';
  }

  function clearSel() {
    for (const row of cellEls) for (const el of row) el?.classList?.remove?.('hw-sel');
    firstSel = null;
  }

  function onCell(r, c) {
    if (resolved) return;
    if (!firstSel) {
      firstSel = { r, c };
      cellEls[r]?.[c]?.classList?.add('hw-sel');
      return;
    }
    const pr = firstSel.r, pc = firstSel.c;
    if (r === pr && c === pc) { clearSel(); return; }

    const dr = r - pr, dc = c - pc;
    const straight = dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
    if (!straight) {
      // Not on a line — restart selection from the new cell.
      clearSel();
      firstSel = { r, c };
      cellEls[r]?.[c]?.classList?.add('hw-sel');
      return;
    }

    const from = { r: pr, c: pc }, to = { r, c };
    const word = readLine(puzzle.grid, from, to);
    const hit = checkSelection(from, to);
    if (hit) {
      foundWord = hit;
      // Highlight the winning run.
      const len = Math.max(Math.abs(dr), Math.abs(dc));
      const sr = dr === 0 ? 0 : Math.sign(dr);
      const sc = dc === 0 ? 0 : Math.sign(dc);
      for (let i = 0; i <= len; i++) cellEls[pr + sr * i]?.[pc + sc * i]?.classList?.add('hw-hit');
      setStatus(`✓ ${hit}`, true);
      finish();
      return;
    }
    if (word && word.length !== wordLen) {
      setStatus(`✗ ${word} — צריך ${wordLen} אותיות`, false);
    } else {
      setStatus(word ? `✗ ${word}` : 'בחר אותיות על קו ישר', false);
    }
    clearSel();
  }
}

export function playHiddenWordForBonus({ bus, words, validator, controller, rng }) {
  return mountHiddenWordMiniGame({
    bus, words, validator, rng,
    onResult: ({ success, earnedPts }) => controller?.resolveMiniGame?.({ success, earnedPts }),
  });
}
