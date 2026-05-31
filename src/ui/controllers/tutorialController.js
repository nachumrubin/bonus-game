import { EV } from '../../events/eventTypes.js';
import { MENU_INTENT } from '../screens/menuScreen.js';
import {
  TUTORIAL_CLEAR,
  TUTORIAL_INTENT,
  TUTORIAL_OPEN,
  TUTORIAL_TIP,
} from '../screens/tutorialScreen.js';
import { GAME_SCREEN_INTENT } from '../screens/gameScreen.js';
import {
  TUTORIAL_CELLS,
  TUTORIAL_BONUS_CELL,
} from '../../game/sessions/tutorialSession.js';

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
  let currentStep = 'idle';   // 'idle' | 'first' | 'bot' | 'bonus' | 'done'
  let lastTipKey = '';        // last tip kind we emitted, to suppress dupes

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
    currentStep = 'first';
    emitTip('first', firstMoveTip());
  }));

  cleanups.push(bus.on(EV.MOVE_CONFIRMED, ({ slot } = {}) => {
    const session = activeGameRef()?.session;
    if (!active || session?.state?.mode !== 'tutorial') return;
    if (slot === 0) {
      playerMoves += 1;
      if (playerMoves === 1) {
        // Player placed שלום. Hide the tip while the bot takes its
        // scripted turn; bonusSquareTip appears when bot finishes.
        currentStep = 'bot';
        emitClear();
      } else if (playerMoves === 2) {
        // Player placed the bonus tile. Show the completion message
        // briefly (no buttons — the box auto-dismisses).
        currentStep = 'done';
        emitTip('completion', {
          label: 'כל הכבוד!',
          text: 'הפעלת בונוס! קיבלת ניקוד נוסף מהמשבצת. זה הסוד של המשחק — נסה להגיע למשבצות הבונוס. סיימת את ההדרכה.',
          selectors: ['#sv1'],
          autoCloseMs: 4000,
        });
      }
      return;
    }
    if (slot === 1) {
      botMoves += 1;
      if (botMoves === 1) {
        currentStep = 'bonus';
        emitTip('bonus', bonusSquareTip());
      }
      // Subsequent bot moves don't show any tip — the tutorial is over.
    }
  }));

  // The player's pending placements come through this intent (gameScreen
  // emits it on every preview change). When all cells the current step
  // expects are filled, switch the tip to "click שבץ" so the next action
  // is unambiguous. If the player recalls a tile, revert to the step tip.
  cleanups.push(bus.on(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, ({ tiles = [] } = {}) => {
    if (!active) return;
    if (currentStep !== 'first' && currentStep !== 'bonus') return;
    const expected = currentStep === 'first' ? TUTORIAL_CELLS : [TUTORIAL_BONUS_CELL];
    const allPlaced = expected.every(e => tiles.some(t => t.r === e.r && t.c === e.c));
    if (allPlaced) {
      emitTip('play', playButtonTip());
    } else if (lastTipKey === 'play') {
      // Player removed a tile after we'd advanced to the play-button tip —
      // go back to the placement prompt for the current step.
      emitTip(currentStep, currentStep === 'first' ? firstMoveTip() : bonusSquareTip());
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
    playerMoves = 0;
    botMoves = 0;
    currentStep = 'idle';
    lastTipKey = '';
  }

  function dispose() {
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
