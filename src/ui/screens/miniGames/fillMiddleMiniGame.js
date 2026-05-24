// fillMiddleMiniGame — B1 "מלא את החסר" (faithful port of the legacy
// buildFillMiddle from index.html ~6360).
//
// Rules (matching legacy):
//   • The puzzle's anchor is a 6–7 letter Hebrew word with distinct first
//     and last letters.
//   • The player is shown the first letter, the last letter, and the
//     middle letters scrambled in a pool.
//   • Player clicks pool tiles to fill blanks left-to-right; clicks a
//     filled slot to return that letter to the pool; ⌫ undoes the most
//     recent fill.
//   • On submit: assemble first + middle (in slot order) + last, and
//     accept ANY Hebrew word that the validator approves — not just the
//     original answer. The legacy uses the morphological `isValid`.
//   • +100 points on success; 0 on wrong / timeout. The answer is
//     revealed on miss.
//   • 40-second timer.
//
// Public surface:
//   pickFillableWord(words, opts)
//   validateFillAttempt(attempt, validator)
//   mountFillMiddleMiniGame(opts)
//   playFillMiddleForBonus(opts)
//   FM_INTENT.RESULT

import { startBonusTimer } from './bonusTimer.js';

const DEFAULT_DURATION_MS = 40_000;
const DEFAULT_PTS = 100;
const DEFAULT_MIN_LEN = 6;
const DEFAULT_MAX_LEN = 7;

export const FM_INTENT = Object.freeze({
  RESULT: 'fillMiddle/result',
});

// Pick a random fillable word: 6-7 letters with distinct first/last letters
// so the legacy `w[0] !== w[w.length-1]` constraint is preserved.
export function pickFillableWord(words, {
  rng = Math.random,
  minLen = DEFAULT_MIN_LEN,
  maxLen = DEFAULT_MAX_LEN,
} = {}) {
  if (!Array.isArray(words)) return null;
  const candidates = words.filter(w =>
    typeof w === 'string' &&
    w.length >= minLen && w.length <= maxLen &&
    w[0] !== w[w.length - 1],
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// `validator` is `(word) => boolean`. The legacy uses the morphological
// hebrewDictionary.isValid; tests can pass `(w) => dictSet.has(w)`.
export function validateFillAttempt(attempt, validator) {
  if (typeof attempt !== 'string' || attempt.length < 2) return false;
  if (typeof validator !== 'function') return false;
  return !!validator(attempt);
}

export function mountFillMiddleMiniGame({
  bus,
  answer,
  validator,
  durationMs = DEFAULT_DURATION_MS,
  pts = DEFAULT_PTS,
  doc = globalThis.document,
  rng = Math.random,
  onResult = () => {},
} = {}) {
  if (!bus) throw new Error('mountFillMiddleMiniGame: bus required');
  if (typeof answer !== 'string' || answer.length < 3) {
    queueMicrotask(() => {
      const r = { success: false, earnedPts: 0, reason: 'no-answer' };
      bus.emit(FM_INTENT.RESULT, r);
      onResult(r);
    });
    return { unmount() {}, _puzzle: null };
  }

  const first  = answer[0];
  const last   = answer[answer.length - 1];
  const middle = answer.slice(1, -1).split('');
  const n      = middle.length;
  const poolLetters = middle.slice().sort(() => rng() - 0.5);

  // Current fills: typed[i] = letter | null
  const typed = Array(n).fill(null);
  let resolved = false;
  let timer = null;
  let progressTimer = null;
  let legacyHook = null;
  let selfHost = null;
  // DOM refs assigned by attachLegacy()/attachSelf(). Declared up here so the
  // hoisted attach functions can read/write them without hitting the let TDZ —
  // they were previously declared further down, after the attach call site.
  let slotEls   = [];
  let poolTiles = [];

  function assemble() {
    return first + typed.map(c => c ?? '').join('') + last;
  }

  function settle({ correct, attempt }) {
    if (resolved) return;
    resolved = true;
    if (timer) clearTimeout(timer);
    if (progressTimer) clearInterval(progressTimer);
    const earnedPts = correct ? pts : 0;
    const r = {
      success: !!correct,
      earnedPts,
      attempt: attempt ?? assemble(),
      answer,
    };
    bus.emit(FM_INTENT.RESULT, r);
    onResult(r);
    if (legacyHook) legacyHook.finalize(r);
    if (selfHost) try { selfHost.remove?.(); } catch {}
  }

  // No-DOM API — for tests. Lets the harness drive fills / submit / expire.
  if (!doc?.createElement) {
    return {
      _puzzle: { answer, first, last, middle, poolLetters: poolLetters.slice() },
      fill(letter, slotIdx) {
        if (resolved) return false;
        const idx = (slotIdx === undefined) ? typed.indexOf(null) : slotIdx;
        if (idx < 0 || idx >= n || typed[idx] !== null) return false;
        const poolIdx = poolLetters.indexOf(letter);
        if (poolIdx < 0) return false;
        typed[idx] = letter;
        poolLetters[poolIdx] = null;
        return true;
      },
      clearSlot(slotIdx) {
        if (resolved) return false;
        const letter = typed[slotIdx];
        if (!letter) return false;
        typed[slotIdx] = null;
        const back = poolLetters.indexOf(null);
        if (back >= 0) poolLetters[back] = letter;
        return true;
      },
      submit() {
        const attempt = assemble();
        if (attempt.includes('')) {/* unreachable: empty letters render as '' */}
        const correct = typed.every(x => x !== null) && validateFillAttempt(attempt, validator);
        settle({ correct, attempt: typed.every(x => x !== null) ? attempt : '' });
      },
      expire() { settle({ correct: false, attempt: '' }); },
      finish: () => settle({ correct: false, attempt: '' }),
      unmount: () => settle({ correct: false, attempt: '' }),
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

  timer = setTimeout(() => settle({ correct: false, attempt: '' }), durationMs);
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
      bus?.emit?.('liveBonus/progress', { secsLeft, label: 'השלם את המילה' });
    } catch { /* swallow */ }
  }

  return { _puzzle: { answer, first, last, middle }, unmount: () => settle({ correct: false, attempt: '' }) };

  // ─── DOM helpers ────────────────────────────────────────

  function buildFrame() {
    const frame = doc.createElement('div');
    frame.style.cssText = 'display:flex;gap:4px;justify-content:center;align-items:center;margin-bottom:10px;flex-wrap:wrap;';

    const mkFixed = (l) => {
      const d = doc.createElement('div');
      d.className = 'ut sl fi';
      d.textContent = l;
      d.style.background = '#c8e8c8';
      d.style.borderColor = '#4a8a4a';
      d.style.borderStyle = 'solid';
      return d;
    };
    frame.appendChild(mkFixed(first));

    const slotEls = [];
    for (let i = 0; i < n; i++) {
      const si = i;
      const s = doc.createElement('div');
      s.className = 'ut sl';
      s.style.cursor = 'pointer';
      s.addEventListener('click', () => returnFromSlot(si, s));
      frame.appendChild(s);
      slotEls.push(s);
    }
    frame.appendChild(mkFixed(last));
    return { frame, slotEls };
  }

  function buildPool() {
    const poolRow = doc.createElement('div');
    poolRow.style.cssText = 'display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin-bottom:10px;';
    const poolTiles = [];
    poolLetters.forEach((l, poolIdx) => {
      const t = doc.createElement('div');
      t.className = 'ut';
      t.textContent = l;
      t.dataset.used = '0';
      t.dataset.poolIdx = String(poolIdx);
      t.addEventListener('click', () => onPoolClick(t, poolIdx));
      poolRow.appendChild(t);
      poolTiles.push(t);
    });

    const bk = doc.createElement('div');
    bk.className = 'ut';
    bk.textContent = '⌫';
    bk.addEventListener('click', onBackspace);
    poolRow.appendChild(bk);

    return { poolRow, poolTiles };
  }

  function attachLegacy() {
    bovic.textContent = '⚡';
    bovt.textContent  = 'בוסט 100 — מלא את החסר';
    bovd.textContent  = `המילה מתחילה ב-"${first}" ומסתיימת ב-"${last}" — סדר את ${n} האותיות למילה (${Math.floor(durationMs/1000)} שניות!)`;
    bchal.innerHTML = '';

    const { frame, slotEls: se } = buildFrame();
    const { poolRow, poolTiles: pt } = buildPool();
    slotEls = se;
    poolTiles = pt;
    bchal.appendChild(frame);
    bchal.appendChild(poolRow);

    ovBonus.classList?.remove?.('hidden');

    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const handleSubmit = (e) => {
      e?.preventDefault?.();
      if (typed.includes(null)) {
        flashStatus('מלא את כל המשבצות קודם!');
        return;
      }
      const attempt = assemble();
      settle({ correct: validateFillAttempt(attempt, validator), attempt });
    };
    bok.textContent = 'בדוק ✓';
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

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,19,61,.92);padding:20px;font-family:Heebo,sans-serif;';
    const card = doc.createElement('div');
    card.style.cssText = 'background:#0d2068;border-radius:14px;padding:18px;max-width:340px;color:#fff;text-align:center;';

    const title = doc.createElement('div');
    title.style.cssText = 'font-size:16px;font-weight:900;margin-bottom:4px;';
    title.textContent = '⚡ מלא את החסר';
    card.appendChild(title);

    const sub = doc.createElement('div');
    sub.style.cssText = 'font-size:11px;color:rgba(255,255,255,.55);margin-bottom:8px;';
    sub.textContent = `${first} … ${last} · ${Math.floor(durationMs/1000)} שניות · +${pts} נקודות`;
    card.appendChild(sub);

    const { frame, slotEls: se } = buildFrame();
    const { poolRow, poolTiles: pt } = buildPool();
    slotEls = se;
    poolTiles = pt;
    card.appendChild(frame);
    card.appendChild(poolRow);

    const submitBtn = doc.createElement('button');
    submitBtn.style.cssText = 'margin-top:8px;background:#e8c840;border:none;border-radius:8px;padding:8px 18px;font-family:inherit;font-size:14px;font-weight:900;color:#000;cursor:pointer;';
    submitBtn.textContent = 'בדוק ✓';
    submitBtn.addEventListener('click', () => {
      if (typed.includes(null)) return;
      const attempt = assemble();
      settle({ correct: validateFillAttempt(attempt, validator), attempt });
    });
    card.appendChild(submitBtn);

    host.appendChild(card);
    doc.body?.appendChild(host);
    return host;
  }

  function onPoolClick(tileEl, poolIdx) {
    if (resolved) return;
    if (tileEl.dataset.used === '1') return;
    const slotIdx = typed.indexOf(null);
    if (slotIdx < 0) return;
    const letter = poolLetters[poolIdx];
    if (letter == null) return;
    typed[slotIdx] = letter;
    slotEls[slotIdx].textContent = letter;
    slotEls[slotIdx].classList?.add?.('fi');
    tileEl.dataset.used = '1';
    tileEl.style.opacity = '0.3';
    tileEl.style.cursor  = 'default';
  }

  function returnFromSlot(slotIdx, slotEl) {
    if (resolved) return;
    const letter = typed[slotIdx];
    if (!letter) return;
    typed[slotIdx] = null;
    slotEl.textContent = '';
    slotEl.classList?.remove?.('fi');
    // Re-enable any pool tile carrying that letter (first match wins).
    for (const pt of poolTiles) {
      if (pt.textContent === letter && pt.dataset.used === '1') {
        pt.dataset.used = '0';
        pt.style.opacity = '1';
        pt.style.cursor  = 'pointer';
        break;
      }
    }
  }

  function onBackspace() {
    if (resolved) return;
    for (let i = n - 1; i >= 0; i--) {
      if (typed[i] !== null) {
        returnFromSlot(i, slotEls[i]);
        return;
      }
    }
  }

  function flashStatus(msg) {
    const setS = globalThis.setS;
    if (typeof setS === 'function') {
      try { setS(msg, 'err'); return; } catch {}
    }
    // No-op fallback.
  }

  function renderResult(result) {
    const answerLabel = `המילה הייתה: <strong style="font-size:22px;color:var(--by);display:block;margin-top:4px;letter-spacing:3px;">${answer}</strong>`;
    if (!result.attempt) {
      return `<div style="text-align:center;padding:8px 0;">
        <div style="font-size:32px;margin-bottom:6px;">⏰</div>
        <div style="font-size:13px;color:rgba(255,255,255,.7);margin-bottom:4px;">הזמן נגמר!</div>
        <div style="font-size:13px;color:rgba(255,255,255,.6);">${answerLabel}</div>
      </div>`;
    }
    if (result.success) {
      const same = result.attempt === answer;
      return `<div style="text-align:center;padding:8px 0;">
        <div style="font-size:32px;margin-bottom:6px;">✅</div>
        <div style="font-size:20px;font-weight:900;color:#8eff8e;margin-bottom:4px;letter-spacing:2px;">${result.attempt}</div>
        ${same ? '' : `<div style="font-size:12px;color:rgba(255,255,255,.6);margin-bottom:2px;">${answerLabel}</div>`}
        <div style="font-size:13px;color:#8eff8e;margin-top:4px;">כל הכבוד! +${result.earnedPts} נקודות 🎉</div>
      </div>`;
    }
    return `<div style="text-align:center;padding:8px 0;">
      <div style="font-size:32px;margin-bottom:6px;">❌</div>
      <div style="font-size:15px;color:#ff8e8e;margin-bottom:6px;letter-spacing:2px;">${result.attempt} — לא מילה תקפה</div>
      <div style="font-size:13px;color:rgba(255,255,255,.65);">${answerLabel}</div>
    </div>`;
  }
}

export function playFillMiddleForBonus({ bus, words, validator, controller, rng }) {
  const answer = pickFillableWord(words, { rng });
  if (!answer) {
    controller?.resolveMiniGame?.({ success: false, earnedPts: 0 });
    return null;
  }
  return mountFillMiddleMiniGame({
    bus, answer, validator, rng,
    onResult: ({ success, earnedPts }) => controller?.resolveMiniGame?.({ success, earnedPts }),
  });
}
