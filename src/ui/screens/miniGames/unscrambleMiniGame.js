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
import { g, getGender } from '../../genderText.js';

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
  const matches = words.filter(w => w.length === len);
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

  const cfg = tierConfig(tier);
  const puzzle = pickPuzzle(words, cfg.wordLen, rng);

  if (!puzzle) {
    // No word of that length in the dictionary — degrade to "auto failure"
    // so we don't block the turn.
    queueMicrotask(() => {
      bus.emit(UNS_INTENT.RESULT, { success: false, earnedPts: 0, reason: 'no-word' });
      onResult({ success: false, earnedPts: 0, reason: 'no-word' });
    });
    return { unmount() {}, _puzzle: null };
  }

  if (!doc?.createElement) {
    // No DOM (test env). Surface the puzzle for the test to drive.
    let resolved = false;
    function resolve(success) {
      if (resolved) return;
      resolved = true;
      const r = { success, earnedPts: success ? cfg.earnedPts : 0 };
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
  host.className = 'spine-mini-overlay';
  host.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(6,19,61,.92);padding:20px;font-family:Heebo,sans-serif;';

  const placedSlots = puzzle.word.split('').map(() => '');

  function render() {
    host.innerHTML = `
      <div style="background:#0d2068;border-radius:14px;padding:24px;max-width:340px;width:100%;color:#fff;text-align:center;">
        <div style="font-size:44px;margin-bottom:6px;">⚡</div>
        <div style="font-size:18px;font-weight:900;margin-bottom:4px;" data-uns="build-title"></div>
        <div style="font-size:11px;color:rgba(255,255,255,.55);margin-bottom:8px;">
          <span data-uns="timer">${Math.floor(cfg.durationMs/1000)}</span> שניות · עד ${cfg.earnedPts} נקודות
        </div>
        <div style="height:6px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden;margin-bottom:14px;">
          <div data-uns="bar" style="height:100%;width:100%;background:#e8c840;border-radius:3px;transition:width ${cfg.durationMs}ms linear, background .5s;"></div>
        </div>
        <div data-uns="answer" style="display:flex;gap:6px;justify-content:center;margin-bottom:14px;flex-wrap:wrap;"></div>
        <div data-uns="bank"   style="display:flex;gap:6px;justify-content:center;margin-bottom:14px;flex-wrap:wrap;"></div>
        <div style="display:flex;gap:8px;">
          <button data-uns="submit" style="flex:1;background:#e8c840;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:900;color:#000;padding:8px;">בדוק</button>
          <button data-uns="give-up" style="flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:8px;font-family:inherit;font-size:14px;font-weight:700;color:#fff;padding:8px;">דלג</button>
        </div>
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
      slot.style.cssText = 'width:36px;height:42px;border:2px solid #e8c840;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;background:rgba(255,255,255,.05);cursor:pointer;';
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
      tile.style.cssText = 'width:36px;height:42px;border:none;border-radius:6px;background:#e8c840;color:#000;font-family:inherit;font-size:20px;font-weight:900;cursor:pointer;';
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
  function finish(success) {
    if (resolved) return;
    resolved = true;
    clearInterval(timer);
    // Show the correct word + outcome before dismissing — same overlay
    // used during play, just swapped to a result view.
    try { showResultView(success); } catch { /* swallow */ }
    const r = { success, earnedPts: success ? cfg.earnedPts : 0 };
    bus.emit(UNS_INTENT.RESULT, r);
    onResult(r);
  }
  function showResultView(success) {
    if (!host?.parentNode) return;
    const ok = success
      ? `<div style="font-size:22px;font-weight:900;color:#8eff8e;margin-bottom:4px;">כל הכבוד! +${cfg.earnedPts} נקודות</div>`
      : `<div style="font-size:18px;font-weight:900;color:#ff8888;margin-bottom:4px;">לא נכון</div>`;
    host.innerHTML = `
      <div style="background:#0d2068;border-radius:14px;padding:24px;max-width:340px;width:100%;color:#fff;text-align:center;">
        <div style="font-size:44px;margin-bottom:8px;">${success ? '🎉' : '⏰'}</div>
        ${ok}
        <div style="font-size:12px;color:rgba(255,255,255,.7);margin-bottom:6px;">המילה הנכונה היא:</div>
        <div style="font-size:30px;font-weight:900;color:#e8c840;letter-spacing:2px;margin-bottom:16px;">${puzzle.word}</div>
        <button data-uns="continue" style="width:100%;background:#e8c840;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:900;color:#000;padding:10px;"></button>
      </div>`;
    const contBtn = host.querySelector('[data-uns="continue"]');
    if (contBtn) contBtn.textContent = g('continueMiniGame', getGender());
    contBtn?.addEventListener('click', () => {
      try { host.remove(); } catch { /* swallow */ }
    });
  }

  // Build + mount
  doc.body?.appendChild(host);
  render();
  host.querySelector('[data-uns="submit"]')?.addEventListener('click', () => {
    finish(isCorrectAnswer(placedSlots.join(''), puzzle.word, validator));
  });
  host.querySelector('[data-uns="give-up"]')?.addEventListener('click', () => finish(false));

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

  return {
    unmount: () => finish(false),
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
