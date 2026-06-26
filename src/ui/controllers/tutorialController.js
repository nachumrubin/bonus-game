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
  let playerMoves = 0;
  let botMoves = 0;
  // Steps:
  //   idle | singleTile | recallDemo | first | dictQuery |
  //   botFirst | illegalInfo | exchangePrompt | botSecond |
  //   lockInfo | bonus | done
  let currentStep = 'idle';
  let lastTipKey = '';
  let waitingForBonus = false;

  // Timers for auto-advancing informational tips
  let dictQueryTimer = null;
  let illegalTimer = null;
  let lockTimer = null;

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

  cleanups.push(bus.on(EV.GAME_STARTED, ({ mode } = {}) => {
    if (mode !== 'tutorial') return;
    active = true;
    resetState();
    currentStep = 'singleTile';
    emitTip('singleTile', singleTileTip());
  }));

  cleanups.push(bus.on(EV.MOVE_CONFIRMED, ({ slot } = {}) => {
    const session = activeGameRef()?.session;
    if (!active || session?.state?.mode !== 'tutorial') return;
    if (slot === 0) {
      playerMoves += 1;
      if (playerMoves === 1) {
        currentStep = 'botFirst';
        emitClear();
      } else if (playerMoves === 2) {
        // Player placed the bonus tile. Defer completion tip until
        // BONUS_RESOLVED (mini-game overlay z-index 9999 > #tut-tip z-index 8200).
        currentStep = 'done';
        waitingForBonus = true;
        clearAllTimers();
      }
      return;
    }
    if (slot === 1) {
      botMoves += 1;
      if (botMoves === 1 && currentStep !== 'done') {
        // Bot played its first scripted move. Teach illegal moves (informational),
        // then prompt the player to use tile exchange.
        currentStep = 'illegalInfo';
        emitTip('illegalInfo', illegalMoveTip());
        illegalTimer = setTimeout(() => {
          illegalTimer = null;
          if (currentStep === 'illegalInfo') {
            currentStep = 'exchangePrompt';
            emitTip('exchange', exchangeTip());
          }
        }, 4500);
      }
      if (botMoves === 2 && currentStep === 'botSecond') {
        // Bot played its second scripted move (after player exchanged).
        // Teach lock placement (informational, auto-advances to bonus step).
        currentStep = 'lockInfo';
        emitTip('lockInfo', lockTip());
        lockTimer = setTimeout(() => {
          lockTimer = null;
          if (currentStep === 'lockInfo') {
            currentStep = 'bonus';
            emitTip('bonus', bonusSquareTip());
          }
        }, 5500);
      }
    }
  }));

  // Player exchanged a tile — advance past the exchange step.
  cleanups.push(bus.on(EV.TILES_EXCHANGED, ({ slot } = {}) => {
    if (!active || slot !== 0) return;
    if (currentStep === 'exchangePrompt' || currentStep === 'illegalInfo') {
      if (illegalTimer) { clearTimeout(illegalTimer); illegalTimer = null; }
      currentStep = 'botSecond';
      emitClear();
    }
  }));

  // Dictionary overlay opened — advance past the dict-query tip to שבץ prompt.
  cleanups.push(bus.on(DICT_INTENT.OPEN_QUERY, () => {
    if (!active) return;
    if (currentStep === 'first' || currentStep === 'dictQuery') {
      if (dictQueryTimer) { clearTimeout(dictQueryTimer); dictQueryTimer = null; }
      // Small delay so the overlay opens before we swap the tip.
      setTimeout(() => {
        if (currentStep === 'first' || currentStep === 'dictQuery') {
          emitTip('play', playButtonTip());
        }
      }, 400);
    }
  }));

  // Mini-game completion: tip queues here while the result overlay is visible
  // (z-index 9999) and becomes visible the moment the player clicks "Continue".
  cleanups.push(bus.on(BONUS_RESOLVED, () => {
    if (!active || !waitingForBonus) return;
    waitingForBonus = false;
    emitTip('completion', {
      label: 'כל הכבוד!',
      text: 'הפעלת בוסט! קיבלת ניקוד נוסף מהמשבצת. זה הסוד של המשחק — נסה להגיע למשבצות הבוסט. סיימת את ההדרכה.',
      selectors: ['#sv1'],
      autoCloseMs: 6000,
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
          // Auto-advance to שבץ tip if player ignores the dict query.
          dictQueryTimer = setTimeout(() => {
            dictQueryTimer = null;
            if (currentStep === 'dictQuery') {
              emitTip('play', playButtonTip());
            }
          }, 7000);
        }
      } else {
        // Player removed a tile — cancel dict-query advance and revert to placement tip.
        if (dictQueryTimer) { clearTimeout(dictQueryTimer); dictQueryTimer = null; }
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

  function clearAllTimers() {
    if (dictQueryTimer) { clearTimeout(dictQueryTimer); dictQueryTimer = null; }
    if (illegalTimer) { clearTimeout(illegalTimer); illegalTimer = null; }
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  }

  function resetState() {
    playerMoves = 0;
    botMoves = 0;
    currentStep = 'idle';
    lastTipKey = '';
    waitingForBonus = false;
    clearAllTimers();
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
    autoCloseMs: 4000,
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
    text: 'אפשר לנעול משבצת! בחר 🔒 בתחתית המסך, לחץ על משבצת ריקה, ואשר עם שבץ — המתחרה לא יוכל לשים שם אות.',
    selectors: ['#lock-inv-display'],
    autoCloseMs: 5000,
  };
}

export function bonusSquareTip() {
  return {
    label: 'משבצות בוסט',
    text: 'סביב הלוח יש 12 משבצות בוסט. הנח את האות "י" על משבצת הבוסט המסומנת בצד שמאל כדי להאריך את המילה ל"שלומי" ולקבל בוסט.',
    selectors: ['#brack[letter=י]', '#bsq-10'],
  };
}
