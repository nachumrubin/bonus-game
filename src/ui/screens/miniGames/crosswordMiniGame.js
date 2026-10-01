// crosswordMiniGame — B8 "בוסט שבץ נא אישי" (faithful port of the legacy
// buildCrossword from index.html ~6448).
//
// Rules (matching legacy):
//   • 5×7 grid, 60-second timer.
//   • Pool: 20 letters drawn from the active game's tile bag (jokers
//     excluded). If the bag has fewer than 20 real tiles, pad with a
//     repeating common-letter cycle. Each pool tile is consumable once.
//   • Click a pool tile to select; click a grid cell to place. Click a
//     placed tile to return it to the pool. ↩ recall returns everything.
//   • Live scan: every change reads every horizontal and vertical run of
//     ≥2 placed tiles, validates each through the dictionary, and shows
//     ✓word / ✗word in the status bar with the running legal-word score.
//   • Finalize rule: if ANY illegal word remains on the board → total
//     bonus = 0. Otherwise total = Σ(legal_word_tile_values).
//   • Tile values come from the HV letter-distribution table.
//
// Public surface:
//   drawCrosswordPool(bag, opts)             → string[] (length = poolSize)
//   scanCrosswordWords(placements, opts)     → { legal, illegal, score, hasIllegal }
//   mountCrosswordMiniGame(opts)             → { unmount, _puzzle, place?, recall?, submit? }
//   playCrosswordForBonus(opts)
//   CW_INTENT.RESULT

import { startBonusTimer } from './bonusTimer.js';
import { confettiBurst, bonusResultHtml, startResultCount, escapeHtml } from './bonusFx.js';
import { setTone } from './bonusUi.js';
import { g, getGender } from '../../genderText.js';
import { BOOST_BOLT_ICON_HTML } from '../../boostIcon.js';

const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_POOL_SIZE   = 20;
const DEFAULT_ROWS = 5;
const DEFAULT_COLS = 7;
const DEFAULT_COMMON_LETTERS = ['א','ב','ל','מ','נ','ר','ש','ת'];

export const CW_INTENT = Object.freeze({
  RESULT: 'crossword/result',
});

// Draw the puzzle's letter pool from the active game bag. Jokers are
// skipped (they have no letter value). Falls back to a cycle through
// commonLetters when the bag is short. Pure — does not mutate `bag`.
export function drawCrosswordPool(bag, {
  rng = Math.random,
  poolSize = DEFAULT_POOL_SIZE,
  commonLetters = DEFAULT_COMMON_LETTERS,
} = {}) {
  const drawn = [];
  if (Array.isArray(bag) && bag.length) {
    const shuffled = bag.slice().sort(() => rng() - 0.5);
    for (let i = 0; i < shuffled.length && drawn.length < poolSize; i++) {
      if (shuffled[i] !== '?') drawn.push(shuffled[i]);
    }
  }
  let fillerIdx = 0;
  while (drawn.length < poolSize) {
    drawn.push(commonLetters[fillerIdx % commonLetters.length]);
    fillerIdx++;
  }
  return drawn;
}

// Scan every horizontal and vertical run of ≥2 placed tiles, evaluate each
// through `validator`, and tally tile-value points via `hv` (letter → pts).
// `placements[r][c] = { l, v }` or null. Returns:
//   legal:    { word: pts, ... }
//   illegal:  { word: pts, ... }
//   score:    Σ legal.pts  (UI uses this for live status)
//   hasIllegal: whether any illegal run was found (legacy: any illegal → 0)
export function scanCrosswordWords(placements, {
  validator = () => true,
  rows = placements.length,
  cols = placements[0]?.length ?? 0,
} = {}) {
  const legal = {};
  const illegal = {};
  const seen = new Set();

  const record = (word, pts) => {
    if (word.length < 2 || seen.has(word)) return;
    seen.add(word);
    if (validator(word)) legal[word] = pts;
    else illegal[word] = pts;
  };

  // Horizontal runs read RIGHT-TO-LEFT (Hebrew). The board is laid out
  // `direction: ltr` (column 0 = leftmost cell), so a player spelling a Hebrew
  // word puts its FIRST letter in the RIGHTMOST cell of the run. Walking the
  // columns left→right therefore visits the word backwards — we PREPEND each
  // letter so the assembled string is the word as it actually reads. Appending
  // here (the old behaviour) scored e.g. "גיא" as "איג" and marked it illegal.
  for (let r = 0; r < rows; r++) {
    let word = '', pts = 0, len = 0;
    for (let c = 0; c < cols; c++) {
      const cell = placements[r]?.[c];
      if (cell) { word = cell.l + word; pts += cell.v ?? 0; len++; }
      else { if (len >= 2) record(word, pts); word = ''; pts = 0; len = 0; }
    }
    if (len >= 2) record(word, pts);
  }
  // Vertical runs are unaffected: Hebrew stacks top-to-bottom, so appending
  // while walking rows downward already yields the correct reading order.
  for (let c = 0; c < cols; c++) {
    let word = '', pts = 0, len = 0;
    for (let r = 0; r < rows; r++) {
      const cell = placements[r]?.[c];
      if (cell) { word += cell.l; pts += cell.v ?? 0; len++; }
      else { if (len >= 2) record(word, pts); word = ''; pts = 0; len = 0; }
    }
    if (len >= 2) record(word, pts);
  }

  const score = Object.values(legal).reduce((a, b) => a + b, 0);
  return { legal, illegal, score, hasIllegal: Object.keys(illegal).length > 0 };
}

export function mountCrosswordMiniGame({
  bus,
  bag = [],
  validator = () => false,
  hv = {},
  rows = DEFAULT_ROWS,
  cols = DEFAULT_COLS,
  poolSize = DEFAULT_POOL_SIZE,
  durationMs = DEFAULT_DURATION_MS,
  rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
} = {}) {
  if (!bus) throw new Error('mountCrosswordMiniGame: bus required');

  const pool = drawCrosswordPool(bag, { rng, poolSize });
  // placements[r][c] = { l, v, poolIdx } | null
  const placements = Array.from({ length: rows }, () => Array(cols).fill(null));
  let selectedPoolIdx = -1;
  let resolved = false;
  let timer = null;
  let progressTimer = null;
  let legacyHook = null;
  let selfHost = null;
  // DOM refs assigned inside attachLegacy()/attachSelf(); declared up here so
  // those (hoisted) functions can write to them without hitting the let TDZ —
  // the previous declarations sat *below* the attach call site.
  let statusLine = null;
  let gridEl     = null;
  let poolEl     = null;

  function valueOf(letter) {
    const v = hv?.[letter];
    return typeof v === 'number' ? v : 0;
  }

  function scan() {
    return scanCrosswordWords(placements, { validator, rows, cols });
  }

  function place(r, c) {
    if (resolved) return false;
    if (placements[r][c]) {
      // Return tile to pool.
      const { l, poolIdx } = placements[r][c];
      pool[poolIdx] = l;
      placements[r][c] = null;
      selectedPoolIdx = -1;
      return true;
    }
    if (selectedPoolIdx < 0) return false;
    const letter = pool[selectedPoolIdx];
    if (letter == null) return false;
    placements[r][c] = { l: letter, v: valueOf(letter), poolIdx: selectedPoolIdx };
    pool[selectedPoolIdx] = null;
    selectedPoolIdx = -1;
    return true;
  }

  function recallAll() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (placements[r][c]) {
          const { l, poolIdx } = placements[r][c];
          pool[poolIdx] = l;
          placements[r][c] = null;
        }
      }
    }
    selectedPoolIdx = -1;
  }

  function finalize({ timedOut = false } = {}) {
    if (resolved) return;
    resolved = true;
    if (timer) clearTimeout(timer);
    if (progressTimer) clearInterval(progressTimer);
    const breakdown = scan();
    const earnedPts = breakdown.hasIllegal ? 0 : breakdown.score;
    const r = {
      success: earnedPts > 0,
      earnedPts,
      legal: breakdown.legal,
      illegal: breakdown.illegal,
      hasIllegal: breakdown.hasIllegal,
      legalCount: Object.keys(breakdown.legal).length,
      illegalCount: Object.keys(breakdown.illegal).length,
      timedOut,
    };
    bus.emit(CW_INTENT.RESULT, r);
    onResult(r);
    if (legacyHook) legacyHook.finalize(r);
    if (selfHost) try { selfHost.remove?.(); } catch {}
  }

  // No-DOM API for tests.
  if (!doc?.createElement) {
    return {
      _puzzle: { rows, cols, pool, placements },
      selectPool(idx) {
        if (resolved) return false;
        if (idx === selectedPoolIdx) { selectedPoolIdx = -1; return true; }
        if (idx < 0 || idx >= pool.length || pool[idx] == null) return false;
        selectedPoolIdx = idx;
        return true;
      },
      place(r, c) { return place(r, c); },
      recallAll() { recallAll(); },
      scan,
      submit() { finalize({ timedOut: false }); },
      expire() { finalize({ timedOut: true }); },
      finish: () => finalize({ timedOut: false }),
      unmount: () => finalize({ timedOut: false }),
    };
  }

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
  // Online spectator: broadcast secsLeft + running score every second.
  let remainingMs = durationMs;
  emitProgress(Math.ceil(remainingMs / 1000));
  progressTimer = setInterval(() => {
    remainingMs -= 1000;
    if (remainingMs < 0) remainingMs = 0;
    emitProgress(Math.ceil(remainingMs / 1000));
  }, 1000);
  function emitProgress(secsLeft) {
    try {
      const running = scan();
      bus?.emit?.('liveBonus/progress', {
        secsLeft,
        score: running.hasIllegal ? 0 : running.score,
        label: 'תשבץ',
      });
    } catch { /* swallow — best-effort spectator broadcast */ }
  }

  return {
    _puzzle: { rows, cols, pool, placements },
    unmount: () => finalize({ timedOut: false }),
  };

  // ─── DOM helpers ────────────────────────────────────────

  function repaintGrid() {
    if (!gridEl) return;
    gridEl.classList?.toggle?.('is-armed', selectedPoolIdx >= 0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = gridEl.querySelector(`[data-mb="${r}-${c}"]`);
        if (!el) continue;
        const t = placements[r][c];
        if (t) {
          el.className = 'xw-cell is-filled';
          el.innerHTML = `<span class="xw-letter">${t.l}</span>`;
        } else {
          el.className = 'xw-cell';
          el.innerHTML = '';
        }
      }
    }
  }

  function repaintPool() {
    if (!poolEl) return;
    poolEl.innerHTML = '';
    pool.forEach((l, i) => {
      const t = doc.createElement('div');
      if (l == null) {
        t.className = 'xw-pool-placeholder';
        poolEl.appendChild(t);
        return;
      }
      const sel = i === selectedPoolIdx;
      t.className = `ut xw-pool-tile${sel ? ' is-selected' : ''}`;
      t.innerHTML = `<span class="xw-letter">${l}</span>`;
      t.addEventListener('click', () => {
        selectedPoolIdx = (selectedPoolIdx === i) ? -1 : i;
        repaintPool();
        repaintGrid();
      });
      poolEl.appendChild(t);
    });
    const rec = doc.createElement('div');
    rec.className = 'xw-recall';
    rec.textContent = '↩';
    rec.title = 'החזר הכל';
    rec.addEventListener('click', () => {
      recallAll();
      repaintGrid();
      repaintPool();
      updateStatus();
      if (statusLine) statusLine.textContent = 'כל האותיות הוחזרו';
    });
    poolEl.appendChild(rec);
  }

  function updateStatus() {
    if (!statusLine) return;
    const { legal, illegal, score } = scan();
    const legalWords = Object.keys(legal);
    const illegalWords = Object.keys(illegal);
    const total = legalWords.length + illegalWords.length;
    if (total === 0) {
      statusLine.textContent = 'הרכב מילה על הלוח';
      setTone(statusLine, 'bz-status', null);
      return;
    }
    const parts = [];
    legalWords.forEach(w => parts.push('✓' + w));
    illegalWords.forEach(w => parts.push('✗' + w));
    statusLine.textContent = parts.join(' | ') + ' — ' + score + ' נק\'';
    setTone(statusLine, 'bz-status', illegalWords.length > 0 ? 'warn' : 'ok');
  }

  function buildGrid() {
    const g = doc.createElement('div');
    g.className = 'xw-board';
    g.style.setProperty('--xw-cols', String(cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = doc.createElement('div');
        cell.dataset.mb = `${r}-${c}`;
        cell.className = 'xw-cell';
        cell.addEventListener('click', () => {
          const changed = place(r, c);
          if (!changed) return;
          repaintGrid();
          repaintPool();
          updateStatus();
        });
        g.appendChild(cell);
      }
    }
    return g;
  }

  function attachLegacy() {
    bovic.innerHTML = BOOST_BOLT_ICON_HTML;
    bovt.textContent  = 'תשבץ!';
    bovd.textContent  = `הרכב מילים מהאותיות שלך · כל אות פעם אחת · ${Math.floor(durationMs/1000)} שניות`;
    bchal.innerHTML = '';

    const wrap = doc.createElement('div');
    wrap.className = 'xw-wrap';
    statusLine = doc.createElement('div');
    statusLine.className = 'bz-status';
    statusLine.textContent = g('chooseLetterBoard', getGender());
    wrap.appendChild(statusLine);

    gridEl = buildGrid();
    wrap.appendChild(gridEl);

    poolEl = doc.createElement('div');
    poolEl.className = 'xw-pool';
    wrap.appendChild(poolEl);

    bchal.appendChild(wrap);
    ovBonus.classList?.remove?.('hidden');

    repaintGrid();
    repaintPool();

    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const handleSubmit = (e) => {
      e?.preventDefault?.();
      finalize({ timedOut: false });
    };
    bok.textContent = 'סיים';
    bok.addEventListener('click', handleSubmit);

    const stopBar = startBonusTimer({ doc, durationMs });

    return {
      finalize(result) {
        try { stopBar(); } catch { /* swallow */ }
        bok.removeEventListener('click', handleSubmit);
        bchal.innerHTML = renderResult(result);
        startResultCount(bchal, result.earnedPts > 0 ? result.earnedPts : null);
        if (isCleanWin(result)) confettiBurst(ovBonus?.querySelector?.('.ovc'));
        bok.textContent = g('continueMiniGame', getGender());
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  function isCleanWin(result) {
    return Object.keys(result.illegal ?? {}).length === 0
        && Object.keys(result.legal ?? {}).length > 0;
  }

  // Shared result tray + a per-word score list (✓ legal words with their
  // points, ✗ illegal words struck through — any ✗ zeroes the boost).
  function renderResult(result) {
    const legalWords = Object.keys(result.legal);
    const illegalWords = Object.keys(result.illegal);
    if (legalWords.length + illegalWords.length === 0) {
      return bonusResultHtml({
        success: false, headline: 'ללא מילים — ללא בוסט',
        sub: 'המשך לשחק ולחפש הזדמנויות נוספות.',
      });
    }
    let list = '<div class="xw-word-list">';
    legalWords.forEach(w => {
      list += `<div class="xw-word-row"><span><span class="xw-word-ok">✓</span>${escapeHtml(w)}</span><b>${result.legal[w]}</b></div>`;
    });
    illegalWords.forEach(w => {
      list += `<div class="xw-word-row is-bad"><span><span class="xw-word-bad">✗</span><span class="xw-word-invalid">${escapeHtml(w)}</span></span><b>0</b></div>`;
    });
    list += '</div>';
    const clean = illegalWords.length === 0;
    return bonusResultHtml({
      success: result.earnedPts > 0,
      tone: clean ? 'win' : 'bad',
      icon: clean ? 'trophy' : 'x',
      headline: clean
        ? (legalWords.length === 1 ? 'כל הכבוד! מילה חוקית אחת' : `כל הכבוד! ${legalWords.length} מילים חוקיות`)
        : 'יש מילה לא חוקית — הבוסט מתאפס',
      points: result.earnedPts > 0 ? result.earnedPts : null,
      extraHtml: list,
    });
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay bz-overlay';
    const card = doc.createElement('div');
    card.className = 'bz-card';

    const bolt = doc.createElement('div');
    bolt.className = 'bz-bolt';
    bolt.innerHTML = BOOST_BOLT_ICON_HTML;
    card.appendChild(bolt);

    const title = doc.createElement('div');
    title.className = 'bz-title';
    title.textContent = 'תשבץ!';
    card.appendChild(title);

    statusLine = doc.createElement('div');
    statusLine.className = 'bz-status';
    statusLine.textContent = g('chooseLetterBoard', getGender());
    card.appendChild(statusLine);

    gridEl = buildGrid();
    card.appendChild(gridEl);

    poolEl = doc.createElement('div');
    poolEl.className = 'xw-pool';
    card.appendChild(poolEl);

    const submitBtn = doc.createElement('button');
    submitBtn.className = 'bz-btn';
    submitBtn.textContent = 'סיים';
    submitBtn.addEventListener('click', () => finalize({ timedOut: false }));
    card.appendChild(submitBtn);

    host.appendChild(card);
    doc.body?.appendChild(host);

    repaintGrid();
    repaintPool();
    return host;
  }
}

export function playCrosswordForBonus({ bus, bag, validator, hv, controller, rng }) {
  return mountCrosswordMiniGame({
    bus, bag, validator, hv, rng,
    onResult: ({ success, earnedPts }) => controller?.resolveMiniGame?.({ success, earnedPts }),
  });
}
