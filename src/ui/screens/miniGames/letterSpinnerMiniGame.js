// letterSpinnerMiniGame — B14 "אות פותחת" (opening letter).
//
// A close cousin of the honeycomb (כוורת). Two phases:
//
//   1. SPIN — a box flips rapidly through the Hebrew alphabet. The player
//      taps the box (or the "עצור" button) to stop it; whichever letter is
//      showing when it stops becomes the round's opening letter.
//   2. PLAY — the player then has 20 seconds to enter as many valid Hebrew
//      words as possible that START with that letter. Scoring matches the
//      honeycomb: by length 2=3, 3=5, 4=8, 5+=10. Repeats are rejected.
//
// The reward is the sum of all word scores (like כוורת), so the bonus is
// open-ended; B14's tilePts (50) is only the intro's headline figure.
//
// Public surface:
//   HEBREW_ALEPHBET                                   — spin letter pool
//   gradeLetterGuess(input, letter, validator, found, normFn)
//                                                     → { ok, points, normalized, reason }
//   mountLetterSpinnerMiniGame(opts)                  → { unmount, submit?, stop?, finish? }
//   playLetterSpinnerForBonus(opts)
//   LS_INTENT.RESULT
//
// Mounts into the legacy #ov-bonus / #bchal overlay when present, else a
// self-hosted fixed overlay (Node tests / isolated harness).

import { startBonusTimer } from './bonusTimer.js';
import { wordPoints } from './honeycombMiniGame.js';
import { g, getGender } from '../../genderText.js';

// No final-letter forms — a word never opens with a sofit letter.
export const HEBREW_ALEPHBET = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');

const DEFAULT_DURATION_MS = 20_000;
const DEFAULT_SPIN_MS = 80;

export const LS_INTENT = Object.freeze({
  RESULT: 'letterSpinner/result',
});

// Grade a single attempt against the chosen opening letter. `validator(word)`
// is the Hebrew dictionary check; `normFn(word)` is the spine's `norm`, used
// only for the de-duplication key (the start-letter test is on the raw word
// because that's what the player sees and types).
export function gradeLetterGuess(input, letter, validator, found, normFn = (x) => x) {
  if (typeof input !== 'string') return { ok: false, reason: 'no-input' };
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'no-input' };
  const chars = [...raw];
  if (chars.length < 2) return { ok: false, reason: 'too-short' };
  if (chars[0] !== letter) return { ok: false, reason: 'wrong-start' };
  const normRaw = normFn(raw);
  if (found instanceof Set && found.has(normRaw)) return { ok: false, reason: 'duplicate' };
  if (typeof validator !== 'function' || !validator(raw)) return { ok: false, reason: 'invalid' };
  return { ok: true, points: wordPoints(raw), normalized: normRaw };
}

export function mountLetterSpinnerMiniGame({
  bus,
  validator = () => false,
  norm: normFn = (x) => x,
  letter = null,             // preset the opening letter (tests); else spun
  durationMs = DEFAULT_DURATION_MS,
  spinIntervalMs = DEFAULT_SPIN_MS,
  rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
} = {}) {
  if (!bus) throw new Error('mountLetterSpinnerMiniGame: bus required');

  const found = new Set();      // normalized words
  const accepted = [];          // [{ word, points }] in submission order
  let chosenLetter = letter;
  let totalScore = 0;
  let resolved = false;
  let phase = chosenLetter ? 'play' : 'spin';
  let spinTimer = null;
  let playTimer = null;
  let progressTimer = null;
  let spinIdx = Math.floor(rng() * HEBREW_ALEPHBET.length);
  let legacyHook = null;
  let selfHost = null;
  let inputEl = null;
  let scoreEl = null;
  let chipsEl = null;
  let fbEl = null;
  let spinEl = null;

  function submitRaw(raw) {
    if (resolved || phase !== 'play' || !chosenLetter) return { ok: false, reason: 'not-playing' };
    const r = gradeLetterGuess(raw, chosenLetter, validator, found, normFn);
    if (r.ok) {
      found.add(r.normalized);
      accepted.push({ word: raw.trim(), points: r.points });
      totalScore += r.points;
    }
    return r;
  }

  function finalize({ timedOut = false } = {}) {
    if (resolved) return;
    resolved = true;
    if (spinTimer) clearInterval(spinTimer);
    if (playTimer) clearTimeout(playTimer);
    if (progressTimer) clearInterval(progressTimer);
    const r = {
      success: totalScore > 0,
      earnedPts: totalScore,
      letter: chosenLetter,
      foundCount: accepted.length,
      foundWords: accepted.map(a => a.word),
      timedOut,
    };
    bus.emit(LS_INTENT.RESULT, r);
    onResult(r);
    if (legacyHook) legacyHook.finalize(r);
    if (selfHost) try { selfHost.remove?.(); } catch {}
  }

  // No DOM available — pure API for tests. If no letter was preset, pick one
  // deterministically from rng so submit() has something to grade against.
  if (!doc?.createElement) {
    if (!chosenLetter) { chosenLetter = HEBREW_ALEPHBET[spinIdx]; phase = 'play'; }
    return {
      get _letter() { return chosenLetter; },
      stop() { /* already in play in the no-DOM path */ return chosenLetter; },
      submit(input) { return submitRaw(typeof input === 'string' ? input : ''); },
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

  if (phase === 'spin') startSpin();
  else beginPlay();

  return {
    get _letter() { return chosenLetter; },
    stop: () => stopSpin(),
    submit: (raw) => commitSubmit(typeof raw === 'string' ? raw : ''),
    finish: () => finalize({ timedOut: false }),
    unmount: () => finalize({ timedOut: false }),
  };

  // ─── phase control ──────────────────────────────────────

  function paintSpin() {
    if (spinEl) spinEl.textContent = HEBREW_ALEPHBET[spinIdx % HEBREW_ALEPHBET.length];
  }

  function startSpin() {
    paintSpin();
    spinTimer = setInterval(() => {
      spinIdx = (spinIdx + 1) % HEBREW_ALEPHBET.length;
      paintSpin();
    }, spinIntervalMs);
  }

  function stopSpin() {
    if (phase !== 'spin' || resolved) return chosenLetter;
    if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
    chosenLetter = HEBREW_ALEPHBET[spinIdx % HEBREW_ALEPHBET.length];
    beginPlay();
    return chosenLetter;
  }

  function beginPlay() {
    phase = 'play';
    if (legacyHook) legacyHook.toPlay(chosenLetter);
    else if (selfHost) renderPlayInto(selfHost.querySelector?.('[data-ls="body"]'));
    playTimer = setTimeout(() => finalize({ timedOut: true }), durationMs);
    let remainingMs = durationMs;
    emitProgress(Math.ceil(remainingMs / 1000));
    progressTimer = setInterval(() => {
      remainingMs = Math.max(0, remainingMs - 1000);
      emitProgress(Math.ceil(remainingMs / 1000));
    }, 1000);
    inputEl?.focus?.();
  }

  function emitProgress(secsLeft) {
    try {
      bus?.emit?.('liveBonus/progress', { secsLeft, score: totalScore, label: 'אות פותחת' });
    } catch { /* swallow */ }
  }

  // ─── shared play-phase widgets ──────────────────────────

  function buildInputRow() {
    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:5px;margin-bottom:7px;align-items:center;';

    inputEl = doc.createElement('input');
    inputEl.type = 'text';
    inputEl.id = 'ls-inp';
    inputEl.className = 'ri';
    inputEl.style.marginBottom = '0';
    inputEl.dir = 'rtl';
    inputEl.placeholder = `מילה שמתחילה ב-${chosenLetter}...`;
    inputEl.addEventListener('keydown', (e) => {
      if (e?.key === 'Enter') { e.preventDefault?.(); attemptSubmit(); }
    });

    const clr = doc.createElement('button');
    clr.textContent = '⌫';
    clr.style.cssText = 'padding:8px 12px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:4px;color:#fff;font-size:14px;cursor:pointer;flex-shrink:0;';
    clr.addEventListener('click', () => { inputEl.value = ''; inputEl.focus?.(); });

    const ok = doc.createElement('button');
    ok.textContent = '✓';
    ok.style.cssText = 'padding:8px 14px;background:var(--by);border:none;border-radius:4px;font-weight:900;font-size:15px;cursor:pointer;flex-shrink:0;color:#111;';
    ok.addEventListener('click', attemptSubmit);

    row.appendChild(inputEl);
    row.appendChild(clr);
    row.appendChild(ok);
    return row;
  }

  // Submit a word and reflect the outcome in the play-phase UI. Shared by
  // the ✓ button / Enter key (attemptSubmit) and the programmatic submit().
  function commitSubmit(raw) {
    const r = submitRaw(raw);
    if (r.ok) {
      if (scoreEl) scoreEl.textContent = totalScore + ' נקודות';
      addChip(accepted[accepted.length - 1]);
      showFb('+' + r.points + ' נקודות 🎉', '#8eff8e');
    } else if (r.reason && r.reason !== 'not-playing') {
      showFb(reasonMessage(r.reason, chosenLetter), '#ff8e8e');
    }
    return r;
  }

  function attemptSubmit() {
    if (!inputEl) return;
    const raw = inputEl.value;
    inputEl.value = '';
    commitSubmit(raw);
    inputEl.focus?.();
  }

  function reasonMessage(reason, letter) {
    switch (reason) {
      case 'too-short':   return 'לפחות 2 אותיות';
      case 'wrong-start': return `חייב להתחיל ב-"${letter}"!`;
      case 'duplicate':   return 'כבר נמצאה!';
      case 'invalid':     return 'מילה לא תקינה ✗';
      default:            return '';
    }
  }

  function addChip(entry) {
    if (!chipsEl || !entry) return;
    const chip = doc.createElement('span');
    chip.style.cssText = 'font-size:11px;background:rgba(0,160,70,.3);border:1px solid rgba(0,180,70,.45);border-radius:3px;padding:2px 6px;color:#7eff9e;';
    chip.textContent = entry.word + ' +' + entry.points;
    chipsEl.appendChild(chip);
    chipsEl.scrollTop = chipsEl.scrollHeight;
  }

  function showFb(msg, color) {
    if (!fbEl) return;
    fbEl.textContent = msg;
    fbEl.style.color = color || '#fff';
  }

  function buildSpinBox() {
    const box = doc.createElement('div');
    box.className = 'lsbox';
    box.setAttribute('data-ls', 'spin');
    spinEl = box;
    box.textContent = HEBREW_ALEPHBET[spinIdx % HEBREW_ALEPHBET.length];
    box.addEventListener('click', () => stopSpin());
    return box;
  }

  function buildSpinHint() {
    const hint = doc.createElement('div');
    hint.style.cssText = 'text-align:center;font-size:12px;color:rgba(255,255,255,.7);margin:8px 0;';
    hint.textContent = 'לחץ על התיבה כדי לעצור על אות';
    return hint;
  }

  function renderPlayInto(container) {
    if (!container) return;
    container.innerHTML = '';

    const lead = doc.createElement('div');
    lead.style.cssText = 'text-align:center;font-size:13px;font-weight:700;color:#fff;margin-bottom:4px;';
    lead.innerHTML = `מילים שמתחילות ב-<span style="color:var(--by);font-size:18px">${chosenLetter}</span>`;
    container.appendChild(lead);

    scoreEl = doc.createElement('div');
    scoreEl.style.cssText = 'text-align:center;font-size:12px;color:rgba(255,255,255,.7);margin-bottom:5px;';
    scoreEl.textContent = '0 נקודות';
    container.appendChild(scoreEl);

    container.appendChild(buildInputRow());

    chipsEl = doc.createElement('div');
    chipsEl.style.cssText = 'max-height:68px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px;justify-content:center;direction:rtl;margin-bottom:4px;';
    container.appendChild(chipsEl);

    fbEl = doc.createElement('div');
    fbEl.style.cssText = 'text-align:center;font-size:12px;min-height:16px;';
    container.appendChild(fbEl);

    inputEl?.focus?.();
  }

  // ─── legacy overlay attach ──────────────────────────────

  function attachLegacy() {
    bovic.textContent = '⚡';
    bovt.textContent  = 'אות פותחת!';
    bovd.textContent  = `עצור על אות, ואז חבר מילים שמתחילות בה — 2אות=3 | 3=5 | 4=8 | 5+=10`;
    bchal.innerHTML = '';

    const body = doc.createElement('div');
    body.setAttribute('data-ls', 'body');
    if (phase === 'spin') {
      body.appendChild(buildSpinBox());
      body.appendChild(buildSpinHint());
    }
    bchal.appendChild(body);

    ovBonus.classList?.remove?.('hidden');

    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const handleSpinStop = (e) => { e?.preventDefault?.(); stopSpin(); };
    const handleFinish   = (e) => { e?.preventDefault?.(); finalize({ timedOut: false }); };
    bok.textContent = 'עצור ⏹';
    bok.addEventListener('click', handleSpinStop);

    let stopBar = null;

    return {
      toPlay() {
        bok.removeEventListener('click', handleSpinStop);
        bok.textContent = 'סיים ▶';
        bok.addEventListener('click', handleFinish);
        bovd.textContent = `מילים שמתחילות ב-"${chosenLetter}" — ${Math.floor(durationMs / 1000)} שניות`;
        renderPlayInto(body);
        stopBar = startBonusTimer({ doc, durationMs });
      },
      finalize(result) {
        try { stopBar?.(); } catch { /* swallow */ }
        bok.removeEventListener('click', handleSpinStop);
        bok.removeEventListener('click', handleFinish);
        bchal.innerHTML = renderResult(result);
        bok.textContent = g('continueMiniGame', getGender());
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  function renderResult(result) {
    const emoji = result.earnedPts >= 30 ? '🎉' : result.earnedPts >= 10 ? '😊' : '⏰';
    const color = result.earnedPts > 0 ? '#8eff8e' : 'rgba(255,255,255,.6)';
    return `<div style="text-align:center;padding:10px 0">
      <div style="font-size:30px;margin-bottom:6px">${emoji}</div>
      <div style="font-size:15px;font-weight:900;color:${color};margin-bottom:4px">
        ${result.foundCount} מילים — ${result.earnedPts} נקודות</div>
    </div>`;
  }

  // ─── self-hosted overlay (tests / isolated harness) ─────

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(6,19,61,.92);padding:20px;font-family:Heebo,sans-serif;';
    const card = doc.createElement('div');
    card.style.cssText = 'background:#0d2068;border-radius:14px;padding:18px;max-width:340px;color:#fff;text-align:center;';

    const title = doc.createElement('div');
    title.style.cssText = 'font-size:16px;font-weight:900;margin-bottom:8px;';
    title.textContent = '⚡ אות פותחת';
    card.appendChild(title);

    const body = doc.createElement('div');
    body.setAttribute('data-ls', 'body');
    if (phase === 'spin') {
      body.appendChild(buildSpinBox());
      body.appendChild(buildSpinHint());
    }
    card.appendChild(body);

    const submitBtn = doc.createElement('button');
    submitBtn.textContent = phase === 'spin' ? 'עצור ⏹' : 'סיים ▶';
    submitBtn.style.cssText = 'margin-top:6px;background:#e8c840;border:none;border-radius:8px;padding:8px 18px;font-family:inherit;font-size:14px;font-weight:900;color:#000;cursor:pointer;';
    submitBtn.addEventListener('click', () => {
      if (phase === 'spin') { stopSpin(); submitBtn.textContent = 'סיים ▶'; }
      else finalize({ timedOut: false });
    });
    card.appendChild(submitBtn);

    host.appendChild(card);
    doc.body?.appendChild(host);
    return host;
  }
}

export function playLetterSpinnerForBonus({ bus, validator, norm, controller, rng }) {
  return mountLetterSpinnerMiniGame({
    bus, validator, norm, rng,
    onResult: ({ success, earnedPts }) => controller?.resolveMiniGame?.({ success, earnedPts }),
  });
}
