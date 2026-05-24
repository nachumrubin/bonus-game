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

  for (let r = 0; r < rows; r++) {
    let word = '', pts = 0, len = 0;
    for (let c = 0; c < cols; c++) {
      const cell = placements[r]?.[c];
      if (cell) { word += cell.l; pts += cell.v ?? 0; len++; }
      else { if (len >= 2) record(word, pts); word = ''; pts = 0; len = 0; }
    }
    if (len >= 2) record(word, pts);
  }
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
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = gridEl.querySelector(`[data-mb="${r}-${c}"]`);
        if (!el) continue;
        const t = placements[r][c];
        el.style.outline = selectedPoolIdx >= 0 ? '2px solid rgba(232,200,64,.5)' : 'none';
        if (t) {
          el.style.background = '#e8e0c8';
          el.style.color = '#111';
          el.innerHTML = `<div style="font-size:13px;font-weight:900;color:#111;line-height:1">${t.l}</div><div style="font-size:7px;color:#666;line-height:1">${t.v || ''}</div>`;
        } else {
          el.style.background = '#5ba3cc';
          el.style.color = '';
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
        t.style.cssText = 'width:28px;height:32px;opacity:0;pointer-events:none;flex-shrink:0;';
        poolEl.appendChild(t);
        return;
      }
      const sel = i === selectedPoolIdx;
      t.style.cssText = `width:28px;height:32px;background:${sel ? '#ffe870' : '#e8e0c8'};border:2px solid ${sel ? '#c0a800' : '#9a9080'};border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#111;cursor:pointer;box-shadow:0 ${sel ? '0' : '2'}px 0 #666050;transform:${sel ? 'translateY(-4px)' : 'none'};transition:all .1s;position:relative;`;
      t.innerHTML = `<span style="line-height:1">${l}</span><span style="font-size:7px;color:#666;position:absolute;bottom:2px;left:3px">${valueOf(l) || 0}</span>`;
      t.addEventListener('click', () => {
        selectedPoolIdx = (selectedPoolIdx === i) ? -1 : i;
        repaintPool();
        repaintGrid();
      });
      poolEl.appendChild(t);
    });
    const rec = doc.createElement('div');
    rec.style.cssText = 'width:28px;height:32px;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.2);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;color:rgba(255,255,255,.7);';
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
      statusLine.style.color = 'rgba(255,255,255,.7)';
      return;
    }
    const parts = [];
    legalWords.forEach(w => parts.push('✓' + w));
    illegalWords.forEach(w => parts.push('✗' + w));
    statusLine.textContent = parts.join(' | ') + ' — ' + score + ' נק\'';
    statusLine.style.color = illegalWords.length > 0 ? '#ffcc66' : '#8eff8e';
  }

  function buildGrid() {
    const g = doc.createElement('div');
    g.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px;background:#2a5878;border:2px solid #2a5878;border-radius:4px;margin-bottom:4px;width:100%;max-width:${cols * 32}px;`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = doc.createElement('div');
        cell.dataset.mb = `${r}-${c}`;
        cell.style.cssText = 'height:28px;background:#5ba3cc;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;border-radius:1px;';
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
    bovic.textContent = '⚡';
    bovt.textContent  = 'בוסט שבץ נא אישי!';
    bovd.textContent  = `ב-${Math.floor(durationMs/1000)} שניות הרכב מילים מהאותיות שלך — כל אות שימושית פעם אחת בלבד!`;
    bchal.innerHTML = '';

    const wrap = doc.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;';
    statusLine = doc.createElement('div');
    statusLine.style.cssText = 'font-size:11px;color:rgba(255,255,255,.8);text-align:center;min-height:18px;font-weight:700;';
    statusLine.textContent = 'בחר אות מהמגש ולחץ על משבצת';
    wrap.appendChild(statusLine);

    gridEl = buildGrid();
    wrap.appendChild(gridEl);

    poolEl = doc.createElement('div');
    poolEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;justify-content:center;padding:2px 0;';
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
    bok.textContent = 'סיים ▶';
    bok.addEventListener('click', handleSubmit);

    const stopBar = startBonusTimer({ doc, durationMs });

    return {
      finalize(result) {
        try { stopBar(); } catch { /* swallow */ }
        bok.removeEventListener('click', handleSubmit);
        bchal.innerHTML = renderResult(result);
        bok.textContent = 'המשך ▶';
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  function renderResult(result) {
    const legalWords = Object.keys(result.legal);
    const illegalWords = Object.keys(result.illegal);
    const total = legalWords.length + illegalWords.length;
    if (total === 0) {
      return `<div style="text-align:center;padding:8px 0;">
        <div style="font-size:26px">😔</div>
        <div style="font-size:13px;color:#ff8e8e;margin-top:4px">ללא מילים — ללא בוסט</div>
      </div>`;
    }
    const emoji   = illegalWords.length === 0 ? '🎉' : (legalWords.length > 0 ? '⚠️' : '😔');
    const headColor = illegalWords.length === 0 ? '#8eff8e' : '#ff8e8e';
    const headline = illegalWords.length === 0
      ? `כל הכבוד! ${legalWords.length} מילים חוקיות`
      : 'יש מילות ✗ — הבוסט מתאפס (0 נקודות)';
    let h = `<div style="text-align:center;margin-bottom:6px"><div style="font-size:24px">${emoji}</div><div style="font-size:13px;font-weight:900;color:${headColor};margin:3px 0">${headline}</div></div>`;
    h += `<div style="background:rgba(0,0,0,.22);border-radius:6px;padding:5px 10px;font-size:12px;color:#eee;line-height:1.7;">`;
    legalWords.forEach(w => {
      h += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:1px 0">
        <span><span style="color:#8eff8e;font-weight:700;margin-left:4px">✓</span><span style="font-weight:900">${w}</span></span>
        <span style="color:var(--by)">${result.legal[w]}</span>
      </div>`;
    });
    illegalWords.forEach(w => {
      h += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:1px 0;opacity:.8">
        <span><span style="color:#ff6e6e;font-weight:700;margin-left:4px">✗</span><span style="font-weight:900;text-decoration:line-through;color:#ff8e8e">${w}</span></span>
        <span style="color:#ff6e6e">0</span>
      </div>`;
    });
    h += `<div style="display:flex;justify-content:space-between;padding-top:4px;font-weight:900;border-top:2px solid rgba(255,255,255,.18);margin-top:2px">
      <span>סה״כ בוסט</span><span style="color:${result.earnedPts > 0 ? '#8eff8e' : '#ff8e8e'}">+${result.earnedPts}</span>
    </div></div>`;
    return h;
  }

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,19,61,.92);padding:20px;font-family:Heebo,sans-serif;';
    const card = doc.createElement('div');
    card.style.cssText = 'background:#0d2068;border-radius:14px;padding:18px;max-width:380px;color:#fff;text-align:center;';

    const title = doc.createElement('div');
    title.style.cssText = 'font-size:16px;font-weight:900;margin-bottom:4px;';
    title.textContent = '⚡ שבץ נא אישי';
    card.appendChild(title);

    statusLine = doc.createElement('div');
    statusLine.style.cssText = 'font-size:11px;color:rgba(255,255,255,.8);text-align:center;min-height:18px;font-weight:700;margin-bottom:6px;';
    statusLine.textContent = 'בחר אות מהמגש ולחץ על משבצת';
    card.appendChild(statusLine);

    gridEl = buildGrid();
    gridEl.style.margin = '0 auto 4px';
    card.appendChild(gridEl);

    poolEl = doc.createElement('div');
    poolEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;justify-content:center;padding:2px 0;';
    card.appendChild(poolEl);

    const submitBtn = doc.createElement('button');
    submitBtn.style.cssText = 'margin-top:8px;background:#e8c840;border:none;border-radius:8px;padding:8px 18px;font-family:inherit;font-size:14px;font-weight:900;color:#000;cursor:pointer;';
    submitBtn.textContent = 'סיים ▶';
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
