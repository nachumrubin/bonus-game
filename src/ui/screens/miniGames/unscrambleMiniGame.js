// unscrambleMiniGame — shared B1 (long) + B3 (medium) mini-game.
//
// Pulls a Hebrew word of the configured length from the dictionary,
// scrambles its letters, and lets the player rebuild it tile-by-tile
// against a countdown.
//
// This module ships two surfaces:
//   - `pickPuzzle(words, len, rng)` — pure picker
//   - `mountUnscrambleMiniGame({ bus, ... })` — DOM-mounting variant
//
// The pure surface is the one tests cover. The DOM mount is best-effort
// and degrades gracefully when there's no document (returns a stub).

import { CMD } from '../../../events/commands.js';
import { confettiBurst } from './bonusFx.js';
import { g, getGender } from '../../genderText.js';
import { isMiniGameWord } from '../../../game/core/hebrewDictionary.js';

export const UNS_INTENT = Object.freeze({
  RESULT: 'unscramble/result',
});

const DEFAULTS = {
  long:   { wordLen: 6, durationMs: 45_000, earnedPts: 100 },
  medium: { wordLen: 4, durationMs: 30_000, earnedPts: 40  },
};

export function tierConfig(tier) {
  return DEFAULTS[tier] ?? DEFAULTS.medium;
}

// Fisher-Yates shuffle. Pure (uses injected rng).
export function shuffleLetters(word, rng = Math.random) {
  const arr = [...word];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // If the shuffle accidentally produced the original word (rare), do a
  // single rotate so the player has SOMETHING to do.
  if (arr.join('') === word && arr.length > 1) {
    arr.push(arr.shift());
  }
  return arr;
}

// Pick a puzzle word of the given length from the supplied list. Returns
// null if no word matches. `rng` is injectable.
export function pickPuzzle(words, len, rng = Math.random) {
  const matches = words.filter(w => w.length === len && isMiniGameWord(w));
  if (matches.length === 0) return null;
  const word = matches[Math.floor(rng() * matches.length)];
  return { word, scrambled: shuffleLetters(word, rng) };
}

// Validate a guess against the answer. Accepts:
//   - the exact picked answer, OR
//   - any same-length Hebrew word accepted by `validator` (so legitimate
//     anagrams of the puzzle letters — e.g. פטיש when the picked answer
//     was שטפי — score the boost instead of being marked wrong).
// The UI constrains tile choices to the puzzle's letters and requires
// every slot to be filled before submission, so a same-length validator-
// accepted guess is always a valid permutation by construction.
export function isCorrectAnswer(guess, answer, validator = null) {
  if (typeof guess !== 'string' || typeof answer !== 'string') return false;
  if (guess.length !== answer.length) return false;
  if (guess === answer) return true;
  return typeof validator === 'function' && !!validator(guess);
}

// Mount a DOM-based unscramble UI. The host is an absolute-positioned
// overlay div appended to document.body. On result (success or timeout),
// fires `onResult({ success, earnedPts })` and tears itself down.
//
// `onResult` is the canonical callback; UNS_INTENT.RESULT is also emitted
// on the bus so other observers (e.g. animation controller) can react.
export function mountUnscrambleMiniGame({
  bus, words, tier = 'medium', rng = Math.random,
  doc = globalThis.document,
  onResult = () => {},
  validator = null,
} = {}) {
  if (!bus) throw new Error('mountUnscrambleMiniGame: bus required');
  if (!Array.isArray(words)) throw new Error('mountUnscrambleMiniGame: words[] required');

  // Signal that this mini-game's result screen has been dismissed, so the
  // bonusActivationController finalizes the staged award and passes the turn.
  // Fired ONCE, from every close path (continue button, fail/timeout continue,
  // hard-teardown, and the no-word degrade). Guarded so a double close can't
  // finalize twice.
  let closedEmitted = false;
  function emitClosed() {
    if (closedEmitted) return;
    closedEmitted = true;
    try { bus.emit('bonus/minigame-closed', {}); } catch { /* swallow */ }
  }

  const cfg = tierConfig(tier);
  const puzzle = pickPuzzle(words, cfg.wordLen, rng);

  if (!puzzle) {
    // No word of that length in the dictionary — degrade to "auto failure"
    // so we don't block the turn. There's no result screen to dismiss here, so
    // emit MINIGAME_CLOSED immediately after staging the (losing) result so the
    // controller finalizes and the turn passes.
    queueMicrotask(() => {
      bus.emit(UNS_INTENT.RESULT, { success: false, earnedPts: 0, reason: 'no-word' });
      onResult({ success: false, earnedPts: 0, reason: 'no-word' });
      emitClosed();
    });
    return { unmount() {}, _puzzle: null };
  }

  if (!doc?.createElement) {
    // No DOM (test env). Surface the puzzle for the test to drive.
    let resolved = false;
    function resolve(success) {
      if (resolved) return;
      resolved = true;
      const r = { success, earnedPts: success ? cfg.earnedPts : 0, answer: puzzle.word };
      bus.emit(UNS_INTENT.RESULT, r);
      onResult(r);
    }
    return {
      unmount: () => resolve(false),
      submit: (guess) => resolve(isCorrectAnswer(guess, puzzle.word, validator)),
      _puzzle: puzzle,
      _cfg: cfg,
    };
  }

  // ── DOM mount ──
  const host = doc.createElement('div');
  host.className = 'spine-mini-overlay bz-overlay';

  const placedSlots = puzzle.word.split('').map(() => '');

  function render() {
    host.innerHTML = `
      <div class="bz-card">
        <div class="bz-bolt">🔤</div>
        <div class="bz-title" data-uns="build-title"></div>
        <div class="bz-sub" data-uns="sub">
          <span data-uns="timer">${Math.floor(cfg.durationMs/1000)}</span> שניות · עד ${cfg.earnedPts} נקודות
        </div>
        <div class="tw" style="margin-bottom:14px;"><div data-uns="bar" class="tbar2" style="width:100%;transition:width ${cfg.durationMs}ms linear, background .5s;"></div></div>
        <div data-uns="answer" style="display:flex;gap:6px;justify-content:center;margin-bottom:14px;flex-wrap:wrap;"></div>
        <div data-uns="bank"   style="display:flex;gap:6px;justify-content:center;margin-bottom:14px;flex-wrap:wrap;"></div>
        <button data-uns="submit" class="bz-btn bz-btn-green" style="width:100%;">בדוק ✓</button>
      </div>`;
    const buildTitle = host.querySelector('[data-uns="build-title"]');
    if (buildTitle) buildTitle.textContent = g('buildWord', getGender());
    paintAnswer();
    paintBank();
    // Kick off the progress-bar shrink after a frame so the transition fires.
    const bar = host.querySelector('[data-uns="bar"]');
    if (bar) {
      requestAnimationFrame?.(() => {
        bar.style.width = '0%';
        setTimeout(() => { bar.style.background = '#e74c3c'; }, Math.floor(cfg.durationMs * 0.7));
      });
    }
  }

  function paintAnswer() {
    const wrap = host.querySelector('[data-uns="answer"]');
    if (!wrap) return;
    wrap.innerHTML = '';
    placedSlots.forEach((ch, i) => {
      const slot = doc.createElement('div');
      slot.style.cssText = ch
        ? 'width:40px;height:44px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#3a2400;cursor:pointer;background:linear-gradient(180deg,#ffe884,#ffc31f);box-shadow:inset 0 2px 0 rgba(255,255,255,.8),0 0 12px rgba(255,200,40,.6);'
        : 'width:40px;height:44px;border:2px dashed rgba(140,180,230,.45);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;background:rgba(255,255,255,.04);cursor:pointer;box-shadow:inset 0 0 12px rgba(0,60,140,.25);';
      slot.textContent = ch;
      slot.addEventListener('click', () => {
        if (!ch) return;
        // Return the letter to the bank
        placedSlots[i] = '';
        scrambled.push(ch); // simple — bank shows it appended
        paintAnswer();
        paintBank();
      });
      wrap.appendChild(slot);
    });
  }

  let scrambled = [...puzzle.scrambled];
  function paintBank() {
    const wrap = host.querySelector('[data-uns="bank"]');
    if (!wrap) return;
    wrap.innerHTML = '';
    scrambled.forEach((ch, i) => {
      const tile = doc.createElement('button');
      tile.textContent = ch;
      tile.style.cssText = 'width:40px;height:44px;border:1px solid rgba(120,90,30,.4);border-radius:9px;background:linear-gradient(180deg,#fbf4dd,#ddcfa6);color:#1a1206;font-family:inherit;font-size:20px;font-weight:900;cursor:pointer;box-shadow:inset 0 2px 0 rgba(255,255,255,.7),inset 0 -3px 5px rgba(120,90,30,.28),0 3px 6px rgba(0,0,0,.4);';
      tile.addEventListener('click', () => {
        const empty = placedSlots.findIndex(x => x === '');
        if (empty < 0) return;
        placedSlots[empty] = ch;
        scrambled.splice(i, 1);
        paintAnswer();
        paintBank();
      });
      wrap.appendChild(tile);
    });
  }

  let resolved = false;
  let revealTimer = null;
  let torn = false;
  function finish(success, guess = '') {
    if (resolved) return;
    resolved = true;
    clearInterval(timer);
    // Include the target word and the player's attempt so the debug recorder
    // can report what was scrambled and what they guessed. Additive only.
    const r = { success, earnedPts: success ? cfg.earnedPts : 0, answer: puzzle.word, attempt: guess || '' };
    bus.emit(UNS_INTENT.RESULT, r);
    onResult(r);
    // Visual outcome. On success we print the word the player made. On a
    // failure/timeout, physically rearrange the scrambled tiles into the
    // correct order — better UX than just printing the answer.
    try {
      if (success) showResultView(true, guess);
      else if (canAnimateReveal()) failReveal(guess);
      else showResultView(false, guess);
    } catch { try { showResultView(success, guess); } catch { /* swallow */ } }
  }

  // Failure ending. If the player actually submitted a (wrong) word, reject it
  // first with a red flash + shake, then rearrange into the answer. A timeout
  // (no guess) skips the rejection and goes straight to the rearrange.
  function failReveal(guess = '') {
    const answerWrap = host.querySelector('[data-uns="answer"]');
    const attempted = !!guess;
    if (!attempted || !answerWrap || typeof answerWrap.animate !== 'function') {
      revealCorrectWord(guess);
      return;
    }
    for (const t of [...(answerWrap.children || [])]) {
      t.style.background = 'linear-gradient(180deg,#ff9a9a,#e0503f)';
      t.style.color = '#5a0000';
      t.style.boxShadow = 'inset 0 2px 0 rgba(255,255,255,.5),0 0 12px rgba(231,76,60,.6)';
    }
    let advanced = false;
    const proceed = () => {
      if (advanced || torn) return;
      advanced = true;
      revealCorrectWord(guess);
    };
    try {
      const anim = answerWrap.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-9px)' },
        { transform: 'translateX(8px)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ], { duration: 400, easing: 'ease-in-out' });
      anim.onfinish = proceed;
      revealTimer = setTimeout(proceed, 480); // fallback if onfinish doesn't fire
    } catch { proceed(); }
  }

  function canAnimateReveal() {
    return !!host?.parentNode
      && typeof host.querySelector === 'function'
      && typeof globalThis.requestAnimationFrame === 'function';
  }

  // Correct-answer tile styling (matches a "placed" answer tile).
  const REVEAL_TILE_CSS = 'width:40px;height:44px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#3a2400;background:linear-gradient(180deg,#ffe884,#ffc31f);box-shadow:inset 0 2px 0 rgba(255,255,255,.8),0 0 12px rgba(255,200,40,.6);will-change:transform;';

  // Rearrange the tiles (a FLIP animation) from their current order into the
  // correct order so the player watches the intended word assemble itself.
  function revealCorrectWord(guess = '') {
    if (torn) return;
    const answerWrap = host.querySelector('[data-uns="answer"]');
    const bankWrap   = host.querySelector('[data-uns="bank"]');
    const titleEl    = host.querySelector('[data-uns="build-title"]');
    const subEl      = host.querySelector('[data-uns="sub"]');
    if (!answerWrap) { showResultView(false, guess); return; }

    // Header: the tiles themselves are the reveal, so just label them.
    const timedOut = !guess;
    if (titleEl) titleEl.textContent = timedOut ? 'נגמר הזמן ⏰' : 'לא נכון 😌';
    if (subEl)   subEl.textContent   = 'המילה הנכונה:';

    // Current visual order: filled answer slots (L→R) then leftover bank tiles.
    // Both together are always exactly the puzzle's letters (tiles are
    // conserved), so every target letter has a matching tile.
    const current = [...placedSlots.filter(Boolean), ...scrambled];
    const target  = puzzle.word.split('');

    // Rebuild all tiles in the answer row in their CURRENT order.
    answerWrap.style.flexWrap = 'wrap';
    answerWrap.innerHTML = '';
    if (bankWrap) bankWrap.innerHTML = '';
    const tiles = current.map((ch) => {
      const t = doc.createElement('div');
      t.textContent = ch;
      t.dataset.ch = ch;
      t.style.cssText = REVEAL_TILE_CSS;
      answerWrap.appendChild(t);
      return t;
    });

    const canMeasure = tiles.length > 0 && tiles.every(t => typeof t.getBoundingClientRect === 'function');
    const first = canMeasure ? tiles.map(t => t.getBoundingClientRect()) : null;

    // Assign each target letter to an unused tile of that letter, then reorder
    // the DOM to the target sequence (this is the "LAST" of the FLIP).
    const used = new Array(tiles.length).fill(false);
    const ordered = [];
    for (const L of target) {
      let idx = tiles.findIndex((t, k) => !used[k] && t.dataset.ch === L);
      if (idx < 0) idx = used.indexOf(false);
      if (idx < 0) break;
      used[idx] = true;
      ordered.push(tiles[idx]);
    }
    ordered.forEach(t => answerWrap.appendChild(t));
    // Defensive: drop any tile not used in the target sequence so the row shows
    // exactly the correct word (normally there are none — tiles are conserved).
    tiles.forEach(t => { if (!ordered.includes(t)) { try { t.remove(); } catch { /* swallow */ } } });

    if (!first) { showFailureChrome(); return; }

    // Invert (FIRST − LAST) then play back to identity so each tile slides
    // from where it was into its correct slot, staggered L→R.
    globalThis.requestAnimationFrame(() => {
      ordered.forEach((t) => {
        const f = first[tiles.indexOf(t)];
        const l = t.getBoundingClientRect();
        t.style.transition = 'none';
        t.style.transform  = `translate(${f.left - l.left}px, ${f.top - l.top}px)`;
      });
      globalThis.requestAnimationFrame(() => {
        ordered.forEach((t, i) => {
          t.style.transition = `transform .45s cubic-bezier(.2,.9,.3,1.35) ${i * 70}ms`;
          t.style.transform  = 'translate(0, 0)';
        });
      });
      revealTimer = setTimeout(showFailureChrome, 450 + ordered.length * 70 + 200);
    });
  }

  // After the rearrange settles, swap the "בדוק" button for a continue button.
  function showFailureChrome() {
    if (!host?.parentNode) return;
    const oldBtn = host.querySelector('[data-uns="submit"]');
    if (!oldBtn) return;
    const cont = oldBtn.cloneNode(false); // drop the submit listener
    cont.removeAttribute('data-uns');
    cont.className = 'bz-btn bz-btn-gold';
    cont.style.cssText = oldBtn.style.cssText;
    cont.textContent = g('continueMiniGame', getGender());
    cont.addEventListener('click', () => { try { host.remove(); } catch { /* swallow */ } emitClosed(); });
    oldBtn.replaceWith(cont);
  }
  function showResultView(success, guess = '') {
    if (!host?.parentNode) return;
    const ok = success
      ? `<div class="bz-result-headline">כל הכבוד!</div><div class="bz-result-big">+${cfg.earnedPts} נק'</div>`
      : `<div class="bz-result-headline">לא נכון</div>`;
    // On success show only the word the player actually made — the player may
    // have formed a different valid word than the picked one, and revealing the
    // "intended" word just confuses. On failure, reveal the picked answer.
    const revealLabel = success ? 'מצאת:' : 'המילה הנכונה היא:';
    const revealWord  = success ? guess  : puzzle.word;
    host.innerHTML = `
      <div class="bz-card">
        <div class="bz-result ${success ? 'is-win' : 'is-soft'}">
          <div class="bz-result-emoji">${success ? '🎉' : '😌'}</div>
          ${ok}
          <div class="bz-result-sub">${revealLabel}</div>
          <div style="font-size:30px;font-weight:900;color:#ffd23f;letter-spacing:2px;margin:6px 0 16px;filter:drop-shadow(0 0 10px rgba(255,190,40,.5));">${revealWord}</div>
          <button data-uns="continue" class="bz-btn bz-btn-gold" style="width:100%;"></button>
        </div>
      </div>`;
    if (success) confettiBurst(host.querySelector('.bz-card'));
    const contBtn = host.querySelector('[data-uns="continue"]');
    if (contBtn) contBtn.textContent = g('continueMiniGame', getGender());
    contBtn?.addEventListener('click', () => {
      try { host.remove(); } catch { /* swallow */ }
      emitClosed();
    });
  }

  // Build + mount
  doc.body?.appendChild(host);
  render();
  host.querySelector('[data-uns="submit"]')?.addEventListener('click', () => {
    const guess = placedSlots.join('');
    finish(isCorrectAnswer(guess, puzzle.word, validator), guess);
  });

  // Countdown. Also broadcast progress to any online spectator: the
  // opponent's bonusSpectatorScreen reads liveBonus/progress for the
  // secsLeft / score readout.
  let remainingMs = cfg.durationMs;
  emitProgress(Math.ceil(remainingMs / 1000));
  const timer = setInterval(() => {
    remainingMs -= 1000;
    const t = host.querySelector('[data-uns="timer"]');
    const secs = Math.max(0, Math.floor(remainingMs / 1000));
    if (t) t.textContent = String(secs);
    emitProgress(secs);
    if (remainingMs <= 0) finish(false);
  }, 1000);

  function emitProgress(secsLeft) {
    try {
      bus?.emit?.('liveBonus/progress', {
        secsLeft,
        label: cfg.tier === 'long' ? 'אנגרמה' : 'אנגרמה קצרה',
      });
    } catch { /* swallow — best-effort spectator broadcast */ }
  }

  // Hard teardown for external callers — resolve as a loss and remove the
  // overlay immediately, WITHOUT the reveal animation (which is only for the
  // in-overlay timeout/illegal-word ending the player actually sees).
  function hardTeardown() {
    torn = true;
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    if (!resolved) {
      resolved = true;
      clearInterval(timer);
      const r = { success: false, earnedPts: 0 };
      bus.emit(UNS_INTENT.RESULT, r);
      onResult(r);
    }
    try { host.remove(); } catch { /* swallow */ }
    emitClosed();
  }

  return {
    unmount: hardTeardown,
    _puzzle: puzzle,
    _cfg: cfg,
  };
}

// Convenience wrapper for main.js: dispatches the result through the
// bonusActivationController so engine + UI stay in sync.
export function playUnscrambleForBonus({
  bus, words, tier, controller, rng, validator,
}) {
  return mountUnscrambleMiniGame({
    bus, words, tier, rng, validator,
    onResult: ({ success, earnedPts }) => {
      controller?.resolveMiniGame?.({ success, earnedPts });
    },
  });
}

// Re-export so callers don't need to import from CMD module separately.
export { CMD };
