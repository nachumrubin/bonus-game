import { EV } from '../../events/eventTypes.js';
import { CMD } from '../../events/commands.js';
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
  TUTORIAL_LOCK_CELL,
} from '../../game/sessions/tutorialSession.js';
import { BONUS_RESOLVED } from './bonusActivationController.js';

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
  let botMoves = 0;
  // Steps:
  //   idle | singleTile | recallDemo | first | dictQuery |
  //   botFirst | illegalInfo | exchangePrompt | botSecond |
  //   lockInfo | waitForBot3 | parallelWords | bonus | done
  let currentStep = 'idle';
  let lastTipKey = '';
  let waitingForBonus = false;
  let botStuckTimer = null;


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

  cleanups.push(bus.on(TUTORIAL_INTENT.NEXT, () => {
    if (currentStep === 'illegalInfo') {
      currentStep = 'exchangePrompt';
      emitTip('exchange', exchangeTip());
    } else if (currentStep === 'lockInfo') {
      // Player read the lock tip but skipped the lock — jump straight to bonus.
      currentStep = 'bonus';
      emitTip('bonus', bonusSquareTip());
    } else if (currentStep === 'parallelWords') {
      currentStep = 'bonus';
      emitTip('bonus', bonusSquareTip());
    } else {
      bus.emit(TUTORIAL_CLEAR, {});
    }
  }));
  cleanups.push(bus.on(TUTORIAL_INTENT.SKIP, () => {
    active = false;
    resetState();
    bus.emit(TUTORIAL_CLEAR, {});
  }));

  cleanups.push(bus.on(EV.GAME_STARTED, ({ mode } = {}) => {
    if (mode !== 'tutorial') return;
    active = true;
    resetState();
    currentStep = 'singleTile';
    emitTip('singleTile', singleTileTip());
  }));

  // Steps where slot=0 MOVE_CONFIRMED counts as the first player word.
  // Includes early steps in case the player presses שבץ before going through
  // the full singleTile / recallDemo / dictQuery walkthrough.
  const FIRST_WORD_STEPS = new Set(['singleTile', 'recallDemo', 'first', 'dictQuery']);

  cleanups.push(bus.on(EV.MOVE_CONFIRMED, ({ slot } = {}) => {
    const session = activeGameRef()?.session;
    if (!active || session?.state?.mode !== 'tutorial') return;
    if (slot === 0) {
      if (FIRST_WORD_STEPS.has(currentStep)) {
        // Player confirmed their first word (שלום). Bot's turn next.
        currentStep = 'botFirst';
        emitClear();
      } else if (currentStep === 'lockInfo') {
        // Player placed the lock. Wait for bot's 3rd scripted move (parallel words demo).
        currentStep = 'waitForBot3';
        emitClear();
      } else if (currentStep === 'bonus') {
        // Player placed the bonus tile (שלומי). Defer completion tip until
        // BONUS_RESOLVED (mini-game overlay z-index 9999 > #tut-tip z-index 8200).
        currentStep = 'done';
        waitingForBonus = true;
      }
      // All other steps: ignore — player shouldn't be making moves right now.
      return;
    }
    if (slot === 1) {
      // Bot actually played — cancel the stuck-bot safety timer.
      if (botStuckTimer) { clearTimeout(botStuckTimer); botStuckTimer = null; }
      botMoves += 1;
      if (botMoves === 1 && currentStep !== 'done') {
        // Bot played its first scripted move. Teach illegal moves (user taps הבא to continue).
        currentStep = 'illegalInfo';
        emitTip('illegalInfo', illegalMoveTip());
      }
      // Fire lockTip for bot's second move unless we are already past that point.
      if (botMoves === 2 &&
          currentStep !== 'done' &&
          currentStep !== 'lockInfo' &&
          currentStep !== 'waitForBot3' &&
          currentStep !== 'parallelWords' &&
          currentStep !== 'bonus' &&
          currentStep !== 'exchangePrompt') {
        // 'exchangePrompt' excluded: if the player hasn't exchanged yet (e.g.
        // their turn was auto-passed after a word rejection), hold off on
        // lockTip until TILES_EXCHANGED fires.
        currentStep = 'lockInfo';
        emitTip('lockInfo', lockTip());
      }
      // Fire parallelWordsTip for bot's third move.
      // Normal path: player locked first → step='waitForBot3'.
      // Rejection path: exchange used player's turn so bot-3 fires while
      // step='lockInfo' (player never had a chance to lock before bot-3).
      // Handle both so the tutorial doesn't get stuck at waitForBot3.
      if (botMoves === 3 && (currentStep === 'waitForBot3' || currentStep === 'lockInfo')) {
        currentStep = 'parallelWords';
        emitTip('parallelWords', parallelWordsTip());
      }
    }
  }));

  // Player exchanged a tile — advance past the exchange step.
  // If bot-2 has already played (e.g. after an illegal-word auto-pass), go
  // straight to lockInfo; otherwise wait for the bot's second scripted move.
  cleanups.push(bus.on(EV.TILES_EXCHANGED, ({ slot } = {}) => {
    if (!active || slot !== 0) return;
    if (currentStep === 'exchangePrompt' || currentStep === 'illegalInfo') {
      if (botMoves >= 2) {
        currentStep = 'lockInfo';
        emitTip('lockInfo', lockTip());
      } else {
        currentStep = 'botSecond';
        emitTip('botSecond', waitingBotTip());
      }
    }
  }));

  // Player placed a lock — advance past lockInfo regardless of currentStep.
  cleanups.push(bus.on(EV.LOCK_PLACED, ({ slot } = {}) => {
    if (!active || slot !== 0) return;
    if (currentStep === 'lockInfo') {
      currentStep = 'waitForBot3';
      emitClear();
    }
  }));

  // Safety net: if it becomes the bot's turn but the bot has exhausted its
  // scripted moves and never calls MOVE_CONFIRMED, auto-pass after 2 s so
  // the player isn't left waiting forever. Runs even in 'done' state so the
  // bot passes after the mini-game completes and the game doesn't freeze.
  cleanups.push(bus.on(EV.TURN_CHANGED, ({ currentTurnSlot } = {}) => {
    if (!active) return;
    if (currentTurnSlot === 1) {
      botStuckTimer = setTimeout(() => {
        botStuckTimer = null;
        const session = activeGameRef()?.session;
        if (!session || session.state?.mode !== 'tutorial') return;
        if (session.state?.currentTurnSlot !== 1) return;
        try { session.dispatch({ type: CMD.PASS_TURN, payload: { reason: 'pass' } }); } catch {}
      }, 2000);
    } else {
      if (botStuckTimer) { clearTimeout(botStuckTimer); botStuckTimer = null; }
    }
  }));

  // Illegal-word rejection:
  //   • At illegalInfo: the player demonstrated the mechanic — now show the
  //     exchange tip. The game auto-passes their turn (~1100 ms) so the bot
  //     plays move 2 while the exchange tip is visible. Bot-2 does NOT fire
  //     lockTip when currentStep === 'exchangePrompt' (excluded above); lockTip
  //     fires via TILES_EXCHANGED once the player exchanges on their next turn.
  //   • At exchangePrompt: rejection is ignored — the player must exchange.
  cleanups.push(bus.on(EV.INVALID_MOVE_REJECTED, ({ reason } = {}) => {
    if (!active) return;
    if (currentStep === 'illegalInfo' && reason === 'word-not-in-dictionary') {
      currentStep = 'exchangePrompt';
      emitTip('exchange', exchangeTip());
    }
  }));

  // Player clicked בדוק inside the dictionary — the word has been checked,
  // so now prompt them to close the dictionary and confirm with שבץ.
  cleanups.push(bus.on(DICT_INTENT.CHECK_QUERY, () => {
    if (!active) return;
    if (currentStep === 'dictQuery') {
      emitTip('play', playButtonTip());
    }
  }));

  // Mini-game completion: show the completion tip without autoCloseMs so it
  // stays visible after the result overlay (z-index 9999) is dismissed and
  // the player can read it at their own pace.
  cleanups.push(bus.on(BONUS_RESOLVED, () => {
    if (!active || !waitingForBonus) return;
    waitingForBonus = false;
    emitTip('completion', {
      label: 'כל הכבוד!',
      text: 'הפעלת בוסט! קיבלת ניקוד נוסף מהמשבצת. זה הסוד של המשחק — נסה להגיע למשבצות הבוסט. סיימת את ההדרכה.',
      selectors: ['#sv1'],
    });
  }));

  // Live tile preview — drives per-step placement prompts.
  cleanups.push(bus.on(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, ({ tiles = [] } = {}) => {
    if (!active) return;

    // ── singleTile: wait for ANY tile to be placed ──────────────────────
    if (currentStep === 'singleTile') {
      if (tiles.length >= 1) {
        currentStep = 'recallDemo';
        emitTip('recallDemo', recallTip());
      }
      return;
    }

    // ── recallDemo: wait for player to recall all placed tiles ──────────
    if (currentStep === 'recallDemo') {
      if (tiles.length === 0) {
        currentStep = 'first';
        emitTip('first', firstMoveTip());
      }
      return;
    }

    // ── first / dictQuery: guide toward placing all 4 שלום tiles ────────
    if (currentStep === 'first' || currentStep === 'dictQuery') {
      const allPlaced = TUTORIAL_CELLS.every(e => tiles.some(t => t.r === e.r && t.c === e.c));
      if (allPlaced) {
        if (lastTipKey !== 'dictQuery' && lastTipKey !== 'play') {
          currentStep = 'dictQuery';
          emitTip('dictQuery', dictQueryTip());
        }
      } else {
        // Player removed a tile — revert to placement tip.
        if (lastTipKey === 'dictQuery' || lastTipKey === 'play') {
          currentStep = 'first';
          emitTip('first', firstMoveTip());
        } else if (lastTipKey !== 'first' && lastTipKey !== 'singleTile' && lastTipKey !== 'recallDemo') {
          emitTip('first', firstMoveTip());
        }
      }
      return;
    }

    // ── bonus: guide toward placing 'י' on the bonus square ─────────────
    if (currentStep === 'bonus') {
      const allPlaced = tiles.some(t => t.r === TUTORIAL_BONUS_CELL.r && t.c === TUTORIAL_BONUS_CELL.c);
      if (allPlaced) {
        emitTip('play', playButtonTip());
      } else if (lastTipKey === 'play') {
        emitTip('bonus', bonusSquareTip());
      }
    }
  }));

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
    botMoves = 0;
    currentStep = 'idle';
    lastTipKey = '';
    waitingForBonus = false;
    if (botStuckTimer) { clearTimeout(botStuckTimer); botStuckTimer = null; }
  }

  function dispose() {
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { dispose };
}

export function singleTileTip() {
  return {
    label: 'שלב 1',
    text: 'בחר את האות ש מהמגש ולחץ על המשבצת הכחולה כדי להניח אותה שם.',
    selectors: ['#brack[letter=ש]', '#c5_6'],
  };
}

export function recallTip() {
  return {
    label: 'ביטול',
    text: 'כל הכבוד! שמת אות על הלוח. עכשיו לחץ על "בטל ↩" כדי להחזיר אותה למגש — כך תוכל לתקן טעויות בכל עת.',
    selectors: ['#btn-recall'],
  };
}

export function firstMoveTip() {
  return {
    label: 'שלב 2',
    text: 'עכשיו הנח את האותיות ש, ל, ו, מ על המשבצות המסומנות כדי ליצור את המילה "שלום".',
    selectors: [
      '#brack[letter=ש]',
      '#brack[letter=ל]',
      '#brack[letter=ו]',
      '#brack[letter=מ]',
      '#c5_6', '#c5_7', '#c5_8', '#c5_9',
    ],
  };
}

export function dictQueryTip() {
  return {
    label: 'מילון',
    text: 'לפני שמאשרים — כדאי לבדוק שהמילה תקינה! לחץ על "מילון" כדי לחפש את "שלום" במילון.',
    selectors: ['#btn-shailta'],
  };
}

export function playButtonTip() {
  return {
    label: 'אישור',
    text: 'יופי! עכשיו לחץ על "שבץ ✓" כדי לאשר את המהלך.',
    selectors: ['#btn-play'],
  };
}

export function illegalMoveTip() {
  return {
    label: 'מהלך לא חוקי',
    text: 'אם תנסה לאשר מילה שאינה במילון, המשחק ידחה אותה אוטומטית ויחזיר את האותיות למגש. כדאי לנסות פעם אחת!',
    selectors: [],
    showNext: true,
  };
}

export function exchangeTip() {
  return {
    label: 'החלפת אות',
    text: 'אפשר להחליף אות מהמגש! לחץ על "החלפת אות", בחר אות שברצונך להחליף ואשר.',
    selectors: ['#btn-exchange'],
  };
}

export function lockTip() {
  return {
    label: 'נעילת משבצת',
    text: 'אפשר לנעול משבצת כדי לחסום את היריב! בחר 🔒 מהסרגל למטה, לחץ על המשבצת שמתחת לאות ב (המסומנת בצהוב), ואשר עם שבץ.',
    selectors: [`#lock-inv-display`, `#c${TUTORIAL_LOCK_CELL.r}_${TUTORIAL_LOCK_CELL.c}`],
    showNext: true,
  };
}

export function parallelWordsTip() {
  return {
    label: 'מילים מקבילות',
    text: 'הבוט יצר שתי מילים במהלך אחד: "בת" (אופקית) ו"תות" (אנכית). כך אפשר לצבור ניקוד כפול — אות אחת משתתפת בשתי מילים!',
    selectors: [],
    showNext: true,
  };
}

export function waitingBotTip() {
  return {
    label: 'תור היריב',
    text: 'מצוין! המחשב עכשיו שם אות על הלוח...',
    selectors: [],
    autoCloseMs: 1500,
  };
}

export function bonusSquareTip() {
  return {
    label: 'משבצות בוסט',
    text: 'סביב הלוח יש 12 משבצות בוסט. יש לך ג\'וקר "?" — בחר אותו מהמגש, בחר "י" בחלון הבחירה, והנח על משבצת הבוסט המסומנת כדי להאריך ל"שלומי" ולקבל בוסט!',
    selectors: ['#brack[letter=?]', '#bsq-10'],
  };
}
