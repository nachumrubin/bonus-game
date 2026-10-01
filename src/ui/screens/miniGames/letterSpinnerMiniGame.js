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
import { showBonusResult, escapeHtml } from './bonusFx.js';
import { buildWordEntry, buildWordFeed } from './bonusUi.js';
import { g, getGender } from '../../genderText.js';
import { BOOST_BOLT_ICON_HTML } from '../../boostIcon.js';
import { cue as cueSfx } from '../../feedbackService.js';

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
  let feed = null;     // buildWordFeed(): found-word chips + feedback line
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
      cueSfx('spinner.tick');
    }, spinIntervalMs);
  }

  function stopSpin() {
    if (phase !== 'spin' || resolved) return chosenLetter;
    if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
    cueSfx('spinner.stop');
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
    const { wrap, input } = buildWordEntry(doc, {
      inputId: 'ls-inp',
      placeholder: `מילה שמתחילה ב-${chosenLetter}...`,
      onSubmit: attemptSubmit,
    });
    inputEl = input;
    return wrap;
  }

  // Submit a word and reflect the outcome in the play-phase UI. Shared by
  // the ✓ button / Enter key (attemptSubmit) and the programmatic submit().
  function commitSubmit(raw) {
    const r = submitRaw(raw);
    if (r.ok) {
      if (scoreEl) scoreEl.textContent = totalScore + ' נקודות';
      feed?.addChip(accepted[accepted.length - 1]);
      feed?.say('+' + r.points + ' נקודות', 'ok');
    } else if (r.reason && r.reason !== 'not-playing') {
      feed?.say(reasonMessage(r.reason, chosenLetter), 'bad');
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
      case 'invalid':     return 'מילה לא תקינה';
      default:            return '';
    }
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
    hint.className = 'bz-hint';
    hint.textContent = 'לחץ על האות כדי לעצור';
    return hint;
  }

  // Spin phase: the big wood tile on a tray, with the hint under it.
  function buildSpin(container) {
    const tray = doc.createElement('div');
    tray.className = 'ls-tray';
    tray.appendChild(buildSpinBox());
    container.appendChild(tray);
    container.appendChild(buildSpinHint());
  }

  function renderPlayInto(container) {
    if (!container) return;
    container.innerHTML = '';

    // The chosen letter stays on screen as a small wood tile beside the score.
    const lead = doc.createElement('div');
    lead.className = 'ls-lead';
    lead.innerHTML = `<span class="bz-tile is-sm is-given">${escapeHtml(chosenLetter)}</span>`;
    scoreEl = doc.createElement('span');
    scoreEl.className = 'bz-score';
    scoreEl.textContent = '0 נקודות';
    lead.appendChild(scoreEl);
    container.appendChild(lead);

    container.appendChild(buildInputRow());

    feed = buildWordFeed(doc);
    container.appendChild(feed.chips);
    container.appendChild(feed.fb);

    inputEl?.focus?.();
  }

  // ─── legacy overlay attach ──────────────────────────────

  function attachLegacy() {
    bovic.innerHTML = BOOST_BOLT_ICON_HTML;
    bovt.textContent  = 'אות פותחת!';
    bovd.textContent  = `עצור על אות, ואז חבר מילים שמתחילות בה · מילה ארוכה = יותר נקודות`;
    bchal.innerHTML = '';

    const body = doc.createElement('div');
    body.setAttribute('data-ls', 'body');
    if (phase === 'spin') buildSpin(body);
    bchal.appendChild(body);

    ovBonus.classList?.remove?.('hidden');

    const prevOnclick = bok.getAttribute?.('onclick');
    bok.removeAttribute?.('onclick');
    const prevDisplay = bok.style.display;
    const handleSpinStop = (e) => { e?.preventDefault?.(); stopSpin(); };
    bok.textContent = 'עצור';
    bok.addEventListener('click', handleSpinStop);

    let stopBar = null;

    return {
      toPlay() {
        // No "סיים" button during play — the round ends on the timer (or
        // unmount). Hide the OK button until finalize shows "continue".
        bok.removeEventListener('click', handleSpinStop);
        bok.style.display = 'none';
        bovd.textContent = `מילים שמתחילות ב-"${chosenLetter}" — ${Math.floor(durationMs / 1000)} שניות`;
        renderPlayInto(body);
        stopBar = startBonusTimer({ doc, durationMs });
      },
      finalize(result) {
        try { stopBar?.(); } catch { /* swallow */ }
        bok.removeEventListener('click', handleSpinStop);
        bok.style.display = prevDisplay ?? '';
        renderSpinnerResult(bchal, result, ovBonus?.querySelector?.('.ovc'));
        bok.textContent = g('continueMiniGame', getGender());
        if (prevOnclick) bok.setAttribute?.('onclick', prevOnclick);
      },
    };
  }

  // Premium success/failure screen (confetti + count-up on a win).
  function renderSpinnerResult(containerEl, result, cardEl) {
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

  // ─── self-hosted overlay (tests / isolated harness) ─────

  function attachSelf() {
    const host = doc.createElement('div');
    host.className = 'spine-mini-overlay bz-overlay';
    const card = doc.createElement('div');
    card.className = 'bz-card';
    card.innerHTML = `
      <div class="bz-bolt">${BOOST_BOLT_ICON_HTML}</div>
      <div class="bz-title">אות פותחת!</div>
      <div class="bz-sub">עצור על אות, ואז חבר מילים שמתחילות בה</div>`;

    const body = doc.createElement('div');
    body.setAttribute('data-ls', 'body');
    body.className = 'bz-body';
    if (phase === 'spin') buildSpin(body);
    card.appendChild(body);

    // The spin phase needs a "עצור" control to stop the wheel; once stopped
    // there is no "סיים" button — the round ends on the timer (or unmount).
    if (phase === 'spin') {
      const stopBtn = doc.createElement('button');
      stopBtn.textContent = 'עצור';
      stopBtn.className = 'bz-btn';
      stopBtn.addEventListener('click', () => { stopSpin(); stopBtn.remove(); });
      card.appendChild(stopBtn);
    }

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
