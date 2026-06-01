import { EV } from '../../events/eventTypes.js';
import { MENU_INTENT } from '../screens/menuScreen.js';
import {
  TUTORIAL_CLEAR,
  TUTORIAL_INTENT,
  TUTORIAL_OPEN,
  TUTORIAL_TIP,
} from '../screens/tutorialScreen.js';
import { GAME_SCREEN_INTENT } from '../screens/gameScreen.js';
import { DICT_INTENT } from '../screens/dictionaryScreen.js';
import {
  TUTORIAL_CELLS,
  TUTORIAL_BONUS_CELL,
} from '../../game/sessions/tutorialSession.js';

// Linear ordering of the demo steps that run AFTER the bonus-square core
// flow. Each entry maps to a `step*` tip + an enforced action (see the
// per-step listeners in createTutorialController). The order moves from
// non-destructive demos (query, recall) → turn-consuming demos (exchange,
// lock, joker, tile-swap) so the bot's PASS_TURN responses don't pile up
// before the player has tried the safe features.
export const EXTRA_STEP_ORDER = Object.freeze([
  'shailta',     // open the dictionary query overlay
  'recall',      // place ≥1 tile then tap בטל to return all
  'exchange',    // tap החלפת אות and exchange a tile
  'lock',        // place a lock on the board
  'joker',       // play a move using the '?' joker tile
  'tileSwap',    // replace a committed tile alongside a new placement
]);

export function createTutorialController({
  bus,
  activeGameRef = () => globalThis.__spine?.activeGame ?? null,
  startTutorialGame = () => {},
  showScreen = () => {},
  storage = globalThis.localStorage,
} = {}) {
  if (!bus) throw new Error('createTutorialController: bus required');
  const cleanups = [];
  let active = false;
  let playerMoves = 0;
  let botMoves = 0;
  // Phase splits the tutorial into two halves. 'core' = the original four-
  // move bonus-square demo. 'extras' = the new linear demos driven by
  // EXTRA_STEP_ORDER. 'done' = terminal; exit timer is running.
  let phase = 'idle';
  let currentStep = 'idle';
  let extraIdx = -1;           // index into EXTRA_STEP_ORDER while phase==='extras'
  let prevPreviewCount = 0;    // track LIVE_PREVIEW_CHANGED transitions for recall detection
  let lastTipKey = '';         // last tip kind we emitted, to suppress dupes
  let exitTimer = null;        // scheduled return-to-home after the final step

  cleanups.push(bus.on(MENU_INTENT.OPEN_TUTORIAL, () => {
    bus.emit(TUTORIAL_OPEN, {});
  }));

  cleanups.push(bus.on(TUTORIAL_INTENT.START, () => {
    try { storage?.setItem?.('bonusGameTutSeen', '1'); } catch {}
    resetState();
    active = true;
    startTutorialGame();
  }));

  cleanups.push(bus.on(TUTORIAL_INTENT.BACK, () => {
    active = false;
    resetState();
    bus.emit(TUTORIAL_CLEAR, {});
    showScreen('sh');
  }));

  cleanups.push(bus.on(TUTORIAL_INTENT.NEXT, () => bus.emit(TUTORIAL_CLEAR, {})));
  cleanups.push(bus.on(TUTORIAL_INTENT.SKIP, () => {
    active = false;
    resetState();
    bus.emit(TUTORIAL_CLEAR, {});
  }));
  // Per-step skip from the "דלג על שלב זה" link inside a tip. Only
  // meaningful during the 'extras' phase — skipping a core step would
  // break the scripted bot's expected board state.
  cleanups.push(bus.on(TUTORIAL_INTENT.SKIP_STEP, () => {
    if (!active || phase !== 'extras') return;
    advanceExtraStep();
  }));

  function cancelExit() {
    if (exitTimer) { try { clearTimeout(exitTimer); } catch {} exitTimer = null; }
  }

  function scheduleExit(delayMs) {
    cancelExit();
    exitTimer = setTimeout(() => {
      exitTimer = null;
      if (!active) return;
      active = false;
      resetState();
      bus.emit(TUTORIAL_CLEAR, {});
      showScreen('sh');
    }, delayMs);
  }

  cleanups.push(bus.on(EV.GAME_STARTED, ({ mode } = {}) => {
    if (mode !== 'tutorial') return;
    active = true;
    resetState();
    phase = 'core';
    currentStep = 'first';
    emitTip('first', firstMoveTip());
  }));

  cleanups.push(bus.on(EV.MOVE_CONFIRMED, ({ slot, swappedTiles, placed } = {}) => {
    const session = activeGameRef()?.session;
    if (!active || session?.state?.mode !== 'tutorial') return;

    if (slot === 0) {
      playerMoves += 1;
      if (phase === 'core' && playerMoves === 1) {
        // Player placed שלום. Hide the tip while the bot takes its
        // scripted turn; bonusSquareTip appears when bot finishes.
        currentStep = 'bot';
        emitClear();
      } else if (phase === 'core' && playerMoves === 2) {
        // Player placed the bonus tile. Celebrate the bonus, but DON'T
        // claim the tutorial is over yet — the scripted bot still has
        // one final move queued (~700ms behind).
        currentStep = 'celebrated';
        emitTip('celebrate', {
          label: 'כל הכבוד!',
          text: 'הפעלת בונוס! קיבלת ניקוד נוסף מהמשבצת. זה הסוד של המשחק — נסה להגיע למשבצות הבונוס.',
          selectors: ['#sv1'],
          autoCloseMs: 3000,
        });
      } else if (phase === 'extras') {
        // The joker step advances when the confirmed move included a
        // joker placement. The tile-swap step advances when the move
        // included one or more swappedTiles. Other confirmed moves
        // during 'extras' don't advance — they're free play.
        const joker = Array.isArray(placed) && placed.some(p => p?.isJoker);
        const swapped = Array.isArray(swappedTiles) && swappedTiles.length > 0;
        if (currentStep === 'joker' && joker) advanceExtraStep();
        else if (currentStep === 'tileSwap' && swapped) advanceExtraStep();
      }
      return;
    }

    if (slot === 1) {
      botMoves += 1;
      if (phase === 'core' && botMoves === 1) {
        currentStep = 'bonus';
        emitTip('bonus', bonusSquareTip());
      } else if (phase === 'core' && botMoves === 2) {
        // Last scripted bot move. Roll into the extended demos.
        phase = 'extras';
        extraIdx = -1;
        advanceExtraStep();
      }
      // In phase='extras' the bot's PASS_TURN (see tutorialSession.js) is
      // surfaced as an EV.MOVE_CONFIRMED-style event for slot 1 only when
      // we treat passes as confirmed moves; the engine emits TURN_CHANGED
      // for a pass instead, so this branch normally won't fire. Either
      // way, no tutorial-tip action is needed.
    }
  }));

  // The player's pending placements come through this intent (gameScreen
  // emits it on every preview change). Two uses:
  //   1. Core phase: when all cells the current core step expects are
  //      filled, switch the tip to "click שבץ".
  //   2. Extras phase / recall step: detect the transition "had pending
  //      tiles → now zero" as "tapped בטל" and advance.
  cleanups.push(bus.on(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, ({ tiles = [] } = {}) => {
    if (!active) return;
    const count = Array.isArray(tiles) ? tiles.length : 0;
    if (phase === 'core' && (currentStep === 'first' || currentStep === 'bonus')) {
      const expected = currentStep === 'first' ? TUTORIAL_CELLS : [TUTORIAL_BONUS_CELL];
      const allPlaced = expected.every(e => tiles.some(t => t.r === e.r && t.c === e.c));
      if (allPlaced) {
        emitTip('play', playButtonTip());
      } else if (lastTipKey === 'play') {
        emitTip(currentStep, currentStep === 'first' ? firstMoveTip() : bonusSquareTip());
      }
    }
    if (phase === 'extras' && currentStep === 'recall' && prevPreviewCount > 0 && count === 0) {
      // The recall step is satisfied by either tapping בטל or double-
      // tapping each placed tile back to the rack. Either way the live
      // preview transitions from ≥1 tile to 0.
      advanceExtraStep();
    }
    // Joker step: once the placed joker tile appears in livePreview (i.e.
    // after the joker-letter picker has resolved), redirect attention to
    // the שבץ button so the player knows to confirm. If they recall the
    // joker, revert to the joker tip.
    if (phase === 'extras' && currentStep === 'joker') {
      const hasJoker = Array.isArray(tiles) && tiles.some(t => t?.isJoker);
      if (hasJoker) {
        emitTip('joker-play', playButtonTip());
      } else if (lastTipKey === 'joker-play') {
        emitTip('joker', jokerTip());
      }
    }
    prevPreviewCount = count;
  }));

  // Auto-advance hooks for the extra steps. Note: שאילתה advances on
  // CLOSE, not OPEN — opening the overlay alone isn't "using the feature";
  // we want the player to actually look up a word and dismiss the overlay
  // before we move on.
  cleanups.push(bus.on(DICT_INTENT.CLOSE_QUERY, () => {
    if (active && phase === 'extras' && currentStep === 'shailta') advanceExtraStep();
  }));
  cleanups.push(bus.on(EV.TILES_EXCHANGED, () => {
    if (active && phase === 'extras' && currentStep === 'exchange') advanceExtraStep();
  }));
  cleanups.push(bus.on(EV.LOCK_PLACED, () => {
    if (active && phase === 'extras' && currentStep === 'lock') advanceExtraStep();
  }));

  function advanceExtraStep() {
    phase = 'extras';
    extraIdx += 1;
    if (extraIdx >= EXTRA_STEP_ORDER.length) {
      // All extras finished — wrap up.
      phase = 'done';
      currentStep = 'done';
      emitTip('exit', {
        label: 'סיימת את ההדרכה',
        text: 'עברת על כל היכולות העיקריות. חוזרים לתפריט הראשי…',
        selectors: [],
        autoCloseMs: 3000,
      });
      scheduleExit(3000);
      return;
    }
    currentStep = EXTRA_STEP_ORDER[extraIdx];
    const builder = TIP_BUILDERS[currentStep];
    if (builder) emitTip(currentStep, builder());
  }

  function emitTip(key, payload) {
    if (lastTipKey === key) return;
    lastTipKey = key;
    bus.emit(TUTORIAL_TIP, payload);
  }

  function emitClear() {
    lastTipKey = 'clear';
    bus.emit(TUTORIAL_CLEAR, {});
  }

  function resetState() {
    cancelExit();
    playerMoves = 0;
    botMoves = 0;
    phase = 'idle';
    currentStep = 'idle';
    extraIdx = -1;
    prevPreviewCount = 0;
    lastTipKey = '';
  }

  function dispose() {
    cancelExit();
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { dispose };
}

export function firstMoveTip() {
  return {
    label: 'שלב 1',
    text: 'הנח את האותיות ש, ל, ו, מ על המשבצות המסומנות כדי ליצור את המילה "שלום".',
    selectors: [
      '#brack[letter=ש]',
      '#brack[letter=ל]',
      '#brack[letter=ו]',
      '#brack[letter=מ]',
      '#c5_6', '#c5_7', '#c5_8', '#c5_9',
    ],
  };
}

export function bonusSquareTip() {
  return {
    label: 'משבצות בונוס',
    text: 'סביב הלוח יש 12 משבצות בונוס. הנח את האות "י" על משבצת הבונוס המסומנת בצד שמאל כדי להאריך את המילה ל"שלומי" ולקבל בונוס.',
    selectors: ['#brack[letter=י]', '#bsq-10'],
  };
}

export function playButtonTip() {
  return {
    label: 'אישור',
    text: 'יופי! עכשיו לחץ על "שבץ ✓" כדי לאשר את המהלך.',
    selectors: ['#btn-play'],
  };
}

// ── Extra-step tip builders ────────────────────────────────────────────
// Each one returns { label, text, selectors, showSkip } so the tip overlay
// renders a "דלג על שלב זה" link the player can use to bypass the
// enforced action. The Hebrew copy walks through what to try and what
// will happen, since the bot won't move again until the player engages.

export function shailtaTip() {
  // Use #btn-shailta (added in game.html for this tip), NOT the
  // onclick-attribute selector — mountDictionaryScreen's patchClick strips
  // the onclick attribute at boot, so any selector that depends on it
  // never resolves and the pulse never lands.
  return {
    label: 'שלב נוסף — שאילתה',
    text: 'רוצה לבדוק אם מילה חוקית בלי לסכן את התור? לחץ על "שאילתה" בסרגל העליון, הקלד מילה ולחץ "בדוק". זו בדיקה בלבד — לא מוציאה אותיות מהמגש.',
    selectors: ['#btn-shailta'],
    showSkip: true,
  };
}

export function recallTip() {
  return {
    label: 'ביטול וסידור אותיות',
    text: 'הנח אות אחת או יותר על הלוח (בלי ללחוץ "שבץ"), ואז נסה: הקלדה כפולה על אות מחזירה אותה למגש; לחיצה על "בטל ↩" מחזירה את כל האותיות בבת אחת. כשהלוח ריק מאותיות חדשות נמשיך הלאה.',
    selectors: ['#btn-recall'],
    showSkip: true,
  };
}

export function exchangeTip() {
  return {
    label: 'החלפת אות',
    text: 'אם אין לך אותיות טובות, אפשר להחליף אות אחת בחינם בתחילת המשחק. לחץ על "החלפת אות", בחר אות מהמגש ואשר. החלפה צורכת את התור שלך.',
    selectors: ['#btn-exchange'],
    showSkip: true,
  };
}

export function lockTip() {
  return {
    label: 'נעילת משבצת',
    text: 'יש לך 3 נעילות בתחילת המשחק (פאנל ימני "נעילות"). נעילה חוסמת משבצת מהיריב למספר תורים. גרור או הפעל נעילה ובחר משבצת ריקה כדי לחסום אותה.',
    selectors: ['#lock-inv-display'],
    showSkip: true,
  };
}

export function jokerTip() {
  return {
    label: 'ג׳וקר 🃏',
    text: 'במגש שלך יש אריח ג׳וקר 🃏. הנח אותו על הלוח כחלק ממילה — תיפתח לך חלון לבחור איזו אות הוא ייצג. הג׳וקר שווה 0 נקודות.',
    selectors: ['#brack[letter=?]'],
    showSkip: true,
  };
}

export function tileSwapTip() {
  return {
    label: 'החלפת אות בלוח',
    text: 'פעם אחת בתור, אפשר להחליף אות שכבר נמצאת על הלוח באות מהמגש — אבל רק אם אתה גם מניח לפחות אות חדשה אחת באותו המהלך. נסה לבנות מילה כזו ולחץ "שבץ".',
    selectors: ['#btn-play'],
    showSkip: true,
  };
}

const TIP_BUILDERS = Object.freeze({
  shailta:   shailtaTip,
  recall:    recallTip,
  exchange:  exchangeTip,
  lock:      lockTip,
  joker:     jokerTip,
  tileSwap:  tileSwapTip,
});
