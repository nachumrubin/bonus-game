// wordSearchMiniGame — B11 תפזורת (faithful port of the legacy
// buildWordSearch from index.html ~5933–6065).
//
// Rules (matching legacy):
//   • 10×10 grid
//   • 10 words drawn from a fixed 30-word Hebrew pool (no final-letter forms)
//   • 8 directions: horizontal, vertical, and all 4 diagonals
//   • 60-second timer
//   • Tap one cell to start the selection, tap a second cell on the same
//     straight/diagonal line to commit. Same cell twice = cancel.
//   • Forward and reverse readings both accept; first match wins.
//   • 10 points per word found, max 100 (10 × 10 words).
//   • Each found word coloured with a unique colour from a 10-entry palette;
//     the matching chip below the grid greys out.
//   • Empty cells filled with random Hebrew letters (no final forms).
//   • "סיים" finishes early with the partial score.
//
// Public surface:
//   placeWords(words, opts)        → { grid, placements }
//   extractWord(grid, from, to)    → string | null (supports diagonals)
//   matchPlacement(placements, a,b)→ placement | null
//   mountWordSearchMiniGame(opts)  → { unmount, _puzzle, submit?, finish? }
//   playWordSearchForBonus(opts)
//
// The mount renders into the legacy #ov-bonus / #bchal overlay when those
// DOM nodes exist (the normal in-game path); otherwise it falls back to a
// self-mounted fixed overlay (Node tests, isolated harness).

const HEBREW_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');

const ALL_DIRECTIONS = [
  [0, 1], [0, -1],            // horizontal
  [1, 0], [-1, 0],            // vertical
  [1, 1], [1, -1],            // ↘ / ↙
  [-1, 1], [-1, -1],          // ↗ / ↖
];

// Curated 30-word pool from the legacy game. 3–5 letters, no final-letter
// forms (ך / ם / ן / ף / ץ) so reverse-direction matches don't introduce
// invalid Hebrew.
export const HEBREW_WORD_POOL = Object.freeze([
  'ילד','ספר','בית','כלב','שיר','חלב','לחם','גשר','רגל','ראש',
  'דגל','שדה','ריח','דבש','רכב','חצר','שבת','ורד','לבד','שחר',
  'יחד','סוד','דבר','חבר','כלי','גדול','ארנב','כביש','מגדל','שורש',
]);

// 10-colour palette used by the legacy game to highlight found lines.
const FOUND_COLORS = [
  '#3cb371','#4a90d9','#e67e22','#9b59b6','#e74c3c',
  '#1abc9c','#f39c12','#2471a3','#884ea0','#1d8348',
];

import { startBonusTimer } from './bonusTimer.js';

const DEFAULT_SIZE = 10;
const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_PTS_PER_WORD = 10;
const DEFAULT_MAX_WORDS = 10;

export const WS_INTENT = Object.freeze({
  RESULT: 'wordSearch/result',
});

function tryPlaceAt(grid, word, r, c, dr, dc, size) {
  const letters = [...word];
  for (let i = 0; i < letters.length; i++) {
    const rr = r + dr * i, cc = c + dc * i;
    if (rr < 0 || rr >= size || cc < 0 || cc >= size) return null;
    const cur = grid[rr][cc];
    if (cur && cur !== letters[i]) return null;
  }
  const next = grid.map(row => row.slice());
  for (let i = 0; i < letters.length; i++) {
    next[r + dr * i][c + dc * i] = letters[i];
  }
  const last = letters.length - 1;
  return {
    grid: next,
    placement: {
      word,
      from: { r, c },
      to:   { r: r + dr * last, c: c + dc * last },
      dr, dc,
    },
  };
}

// Builder: places up to `maxWords` words in the grid, picking from `words`.
// Uses 8 directions by default; pass directions:[[0,1],[1,0]] to restrict.
export function placeWords(words, {
  size = DEFAULT_SIZE,
  maxWords = DEFAULT_MAX_WORDS,
  rng = Math.random,
  directions = ALL_DIRECTIONS,
} = {}) {
  let grid = Array.from({ length: size }, () => Array(size).fill(null));
  const placements = [];

  // Shuffle then truncate (legacy: const wordList = [...POOL].sort(...).slice(0, 10)).
  const shuffled = words
    .filter(w => typeof w === 'string' && w.length >= 2 && w.length <= size)
    .slice()
    .sort(() => rng() - 0.5);
  const wordList = shuffled.slice(0, maxWords);

  for (const w of wordList) {
    let placed = false;
    // 300 random attempts, then systematic scan as a fallback (legacy).
    for (let t = 0; t < 300 && !placed; t++) {
      const d = directions[Math.floor(rng() * directions.length)];
      const r0 = Math.floor(rng() * size);
      const c0 = Math.floor(rng() * size);
      const result = tryPlaceAt(grid, w, r0, c0, d[0], d[1], size);
      if (result) {
        grid = result.grid;
        placements.push(result.placement);
        placed = true;
      }
    }
    if (!placed) {
      outer:
      for (const d of directions) {
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) {
            const result = tryPlaceAt(grid, w, r, c, d[0], d[1], size);
            if (result) {
              grid = result.grid;
              placements.push(result.placement);
              placed = true;
              break outer;
            }
          }
        }
      }
    }
  }

  const filled = grid.map(row => row.map(ch =>
    ch ?? HEBREW_LETTERS[Math.floor(rng() * HEBREW_LETTERS.length)],
  ));
  return { grid: filled, placements };
}

// Read the letters along the straight or diagonal line from `from` to `to`.
// Returns null if the two points don't lie on the same row, column, or
// 45° diagonal, or if either is out of bounds.
export function extractWord(grid, from, to) {
  if (!grid?.length) return null;
  if (!from || !to) return null;
  const { r: r1, c: c1 } = from;
  const { r: r2, c: c2 } = to;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (r1 < 0 || r1 >= rows || r2 < 0 || r2 >= rows || c1 < 0 || c1 >= cols || c2 < 0 || c2 >= cols) return null;

  const dRow = r2 - r1;
  const dCol = c2 - c1;
  // Must be horizontal, vertical, or 45° diagonal.
  const straight = dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol);
  if (!straight) return null;

  const len = Math.max(Math.abs(dRow), Math.abs(dCol)) + 1;
  const sr = dRow === 0 ? 0 : Math.sign(dRow);
  const sc = dCol === 0 ? 0 : Math.sign(dCol);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += grid[r1 + sr * i][c1 + sc * i];
  }
  return s;
}

// Match a player-drawn line against the placed words. Accepts the placement
// in either direction (so the player can drag forward or backward).
export function matchPlacement(placements, from, to) {
  for (const p of placements) {
    if (samePoint(p.from, from) && samePoint(p.to, to)) return p;
    if (samePoint(p.from, to)   && samePoint(p.to, from)) return p;
  }
  return null;
}

function samePoint(a, b) { return a?.r === b?.r && a?.c === b?.c; }

// Mount the mini-game UI. When the legacy #ov-bonus / #bchal overlay exists
// (the normal in-game DOM) we render INTO it so the surrounding chrome
// (title / desc / OK button) is reused. Otherwise we fall back to a
// self-contained fixed overlay for Node tests / isolated harnesses.
export function mountWordSearchMiniGame({
  bus,
  words = HEBREW_WORD_POOL,
  size = DEFAULT_SIZE,
  maxWords = DEFAULT_MAX_WORDS,
  ptsPerWord = DEFAULT_PTS_PER_WORD,
  durationMs = DEFAULT_DURATION_MS,
  directions = ALL_DIRECTIONS,
  rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
} = {}) {
  if (!bus) throw new Error('mountWordSearchMiniGame: bus required');
  if (!Array.isArray(words)) throw new Error('mountWordSearchMiniGame: words[] required');

  const puzzle = placeWords(words, { size, maxWords, rng, directions });
  const found = new Set();
  const startedAt = Date.now();
  let resolved = false;
  let timer = null;
  // Forward-declared because finish() runs in both the DOM and no-DOM paths
  // and must clean up whichever attachment was created later in the body.
  let legacyHook = null;
  let selfHost = null;

  function elapsedSec() {
    return Math.floor((Date.now() - startedAt) / 1000);
  }

  function finish() {
    if (resolved) return;
    resolved = true;
    if (timer) clearInterval(timer);
    const earnedPts = found.size * ptsPerWord;
    const r = {
      success: found.size > 0,
      earnedPts,
      foundCount: found.size,
      totalCount: puzzle.placements.length,
    };
    bus.emit(WS_INTENT.RESULT, r);
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
        const p = matchPlacement(puzzle.placements, from, to);
        if (p) found.add(p.word);
        return !!p;
      },
      finish,
      unmount: finish,
    };
  }

  if (puzzle.placements.length === 0) {
    queueMicrotask(() => {
      const r = { success: false, earnedPts: 0, foundCount: 0, reason: 'no-words' };
      bus.emit(WS_INTENT.RESULT, r);
      onResult(r);
    });
    return { unmount() {}, _puzzle: puzzle };
  }

  let firstSel = null;
  let colorIdx = 0;
  let cellEls = [];
  let scoreEl = null;
  const chips = {};

  // Try to attach to the legacy overlay first.
  const bovic = doc.getElementById?.('bovic');
  const bovt  = doc.getElementById?.('bovt');
  const bovd  = doc.getElementById?.('bovd');
  const bchal = doc.getElementById?.('bchal');
  const bok   = doc.getElementById?.('bok');
  const ovBonus = doc.getElementById?.('ov-bonus');
  legacyHook = (bovic && bovt && bovd && bchal && bok && ovBonus) ? attachLegacy() : null;
  selfHost = legacyHook ? null : attachSelf();

  // Tick the visible timer every second. Also broadcast secsLeft + running
  // score to the opponent's spectator overlay (online live mode).
  emitProgress();
  timer = setInterval(() => {
    if (resolved) return;
    if (elapsedSec() * 1000 >= durationMs) { finish(); return; }
    paintTimer();
    emitProgress();
  }, 1000);
  function emitProgress() {
    try {
      const secsLeft = Math.max(0, Math.ceil((durationMs - elapsedSec() * 1000) / 1000));
      bus?.emit?.('liveBonus/progress', {
        secsLeft,
        score: found.size * ptsPerWord,
        label: 'תפזורת',
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
    bovt.textContent  = 'תפזורת!';
    bovd.textContent  = `מצא ${puzzle.placements.length} מילים בתוך ${Math.floor(durationMs/1000)} שניות`;
    bchal.innerHTML = '';

    scoreEl = doc.createElement('div');
    scoreEl.style.cssText = 'text-align:center;font-size:12px;color:rgba(255,255,255,.65);margin-bottom:4px;';
    paintScore();
    bchal.appendChild(scoreEl);

    const gridEl = doc.createElement('div');
    gridEl.className = 'wsgrid';
    gridEl.style.setProperty('grid-template-columns', `repeat(${size}, 1fr)`);
    cellEls = [];
    for (let r = 0; r < size; r++) {
      cellEls[r] = [];
      for (let c = 0; c < size; c++) {
        const el = doc.createElement('div');
        el.className = 'wscell';
        el.textContent = puzzle.grid[r][c];
        el.addEventListener('click', () => onCell(r, c));
        gridEl.appendChild(el);
        cellEls[r][c] = el;
      }
    }
    bchal.appendChild(gridEl);

    const listEl = doc.createElement('div');
    listEl.className = 'wswords';
    for (const p of puzzle.placements) {
      const chip = doc.createElement('span');
      chip.className = 'wsword';
      chip.textContent = p.word;
      listEl.appendChild(chip);
      chips[p.word] = chip;
    }
    bchal.appendChild(listEl);

    ovBonus.classList?.remove?.('hidden');

    // Re-target the OK button for "finish early" while playing; the finalize
    // step will re-target it again to "continue" once the game has resolved.
    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const handleEarly = (e) => {
      e?.preventDefault?.();
      finish();
    };
    bok.textContent = 'סיים ▶';
    bok.addEventListener('click', handleEarly);

    const stopBar = startBonusTimer({ doc, durationMs });

    return {
      finalize(result) {
        try { stopBar(); } catch { /* swallow */ }
        bok.removeEventListener('click', handleEarly);
        const emoji = result.foundCount === result.totalCount ? '🎉'
          : result.foundCount >= 5 ? '😊' : '⏰';
        const color = result.foundCount > 0 ? '#8eff8e' : 'rgba(255,255,255,.6)';
        bchal.innerHTML = `<div style="text-align:center;padding:10px 0">
          <div style="font-size:32px;margin-bottom:6px">${emoji}</div>
          <div style="font-size:15px;font-weight:900;color:${color};margin-bottom:5px">
            מצאת ${result.foundCount} מתוך ${result.totalCount} מילים
          </div>
          <div style="font-size:14px;color:var(--by);font-weight:700">+${result.earnedPts} נקודות</div>
        </div>`;
        bok.textContent = 'המשך ▶';
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay ws-self-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,19,61,.92);padding:20px;font-family:Heebo,sans-serif;';
    doc.body?.appendChild(host);

    const cellSize = Math.min(28, Math.floor(280 / size));
    const cellHTML = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        cellHTML.push(`<div data-cell="${r},${c}" class="wscell" style="width:${cellSize}px;height:${cellSize}px;font-size:${Math.max(10, cellSize - 14)}px;">${puzzle.grid[r][c]}</div>`);
      }
    }
    const chipsHTML = puzzle.placements
      .map(p => `<span class="wsword" data-chip="${p.word}">${p.word}</span>`)
      .join('');

    host.innerHTML = `
      <div style="background:#0d2068;border-radius:14px;padding:18px;max-width:380px;color:#fff;text-align:center;">
        <div style="font-size:16px;font-weight:900;margin-bottom:4px;">⚡ תפזורת</div>
        <div data-ws="score" style="font-size:12px;color:rgba(255,255,255,.65);margin-bottom:6px;">0 / ${puzzle.placements.length} מילים</div>
        <div class="wsgrid" style="grid-template-columns:repeat(${size}, ${cellSize}px);margin:6px auto;">${cellHTML.join('')}</div>
        <div class="wswords">${chipsHTML}</div>
        <button data-ws="done" style="margin-top:12px;background:#e8c840;border:none;border-radius:8px;padding:8px 18px;font-family:inherit;font-size:14px;font-weight:900;color:#000;cursor:pointer;">סיים</button>
      </div>`;

    cellEls = [];
    for (let r = 0; r < size; r++) {
      cellEls[r] = [];
      for (let c = 0; c < size; c++) {
        const el = host.querySelector(`[data-cell="${r},${c}"]`);
        cellEls[r][c] = el;
        if (el) el.addEventListener('click', () => onCell(r, c));
      }
    }
    for (const p of puzzle.placements) {
      chips[p.word] = host.querySelector(`[data-chip="${p.word}"]`);
    }
    scoreEl = host.querySelector('[data-ws="score"]');
    host.querySelector('[data-ws="done"]')?.addEventListener('click', finish);
    return host;
  }

  function paintScore() {
    if (!scoreEl) return;
    const earned = found.size * ptsPerWord;
    scoreEl.textContent = `${found.size} / ${puzzle.placements.length} מילים${earned ? ` — ${earned} נקודות` : ''}`;
  }

  function paintTimer() {
    // Legacy chooses to surface the timer through the same status text; we
    // keep that lightweight — the running countdown isn't critical UX, the
    // finish() call on expiry is.
  }

  function onCell(r, c) {
    if (resolved) return;
    if (!firstSel) {
      firstSel = { r, c };
      cellEls[r]?.[c]?.classList?.add('ws-sel');
      return;
    }
    const pr = firstSel.r, pc = firstSel.c;
    cellEls[pr]?.[pc]?.classList?.remove('ws-sel');
    if (r === pr && c === pc) {
      firstSel = null;
      return;
    }
    const dr = r - pr, dc = c - pc;
    const straight = dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
    if (!straight) {
      // Treat as a new start point.
      firstSel = { r, c };
      cellEls[r]?.[c]?.classList?.add('ws-sel');
      return;
    }
    const len = Math.max(Math.abs(dr), Math.abs(dc));
    const sr = dr === 0 ? 0 : Math.sign(dr);
    const sc = dc === 0 ? 0 : Math.sign(dc);
    const line = [];
    for (let i = 0; i <= len; i++) line.push({ r: pr + sr * i, c: pc + sc * i });
    const str  = line.map(p => puzzle.grid[p.r][p.c]).join('');
    const strR = [...str].reverse().join('');
    const hit  = puzzle.placements.find(p => !found.has(p.word) && (str === p.word || strR === p.word));
    if (hit) {
      found.add(hit.word);
      const col = FOUND_COLORS[(colorIdx++) % FOUND_COLORS.length];
      for (const p of line) {
        const el = cellEls[p.r]?.[p.c];
        if (!el) continue;
        el.style.background = col;
        el.style.color = '#fff';
        el.style.borderRadius = '2px';
      }
      const chip = chips[hit.word];
      if (chip) {
        chip.classList?.add('ws-done');
        chip.style.background = col + '44';
      }
      paintScore();
      if (found.size === puzzle.placements.length) {
        finish();
        return;
      }
    }
    firstSel = null;
  }
}

export function playWordSearchForBonus({ bus, words, controller, rng }) {
  return mountWordSearchMiniGame({
    bus, words, rng,
    onResult: ({ success, earnedPts }) => controller?.resolveMiniGame?.({ success, earnedPts }),
  });
}
