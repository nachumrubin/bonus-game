import { EV } from '../../events/eventTypes.js';
import { MENU_INTENT } from '../screens/menuScreen.js';
import {
  TUTORIAL_CLEAR,
  TUTORIAL_INTENT,
  TUTORIAL_OPEN,
  TUTORIAL_TIP,
} from '../screens/tutorialScreen.js';

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

  cleanups.push(bus.on(MENU_INTENT.OPEN_TUTORIAL, () => {
    bus.emit(TUTORIAL_OPEN, {});
  }));

  cleanups.push(bus.on(TUTORIAL_INTENT.START, () => {
    try { storage?.setItem?.('bonusGameTutSeen', '1'); } catch {}
    active = true;
    startTutorialGame();
  }));

  cleanups.push(bus.on(TUTORIAL_INTENT.BACK, () => {
    active = false;
    bus.emit(TUTORIAL_CLEAR, {});
    showScreen('sh');
  }));

  cleanups.push(bus.on(TUTORIAL_INTENT.NEXT, () => bus.emit(TUTORIAL_CLEAR, {})));
  cleanups.push(bus.on(TUTORIAL_INTENT.SKIP, () => {
    active = false;
    bus.emit(TUTORIAL_CLEAR, {});
  }));

  cleanups.push(bus.on(EV.GAME_STARTED, ({ mode } = {}) => {
    if (mode !== 'tutorial') return;
    active = true;
    bus.emit(TUTORIAL_TIP, firstMoveTip());
  }));

  cleanups.push(bus.on(EV.MOVE_CONFIRMED, ({ slot, words = [] } = {}) => {
    const session = activeGameRef()?.session;
    if (!active || session?.state?.mode !== 'tutorial') return;
    if (slot === 0) {
      bus.emit(TUTORIAL_TIP, {
        label: 'יפה',
        text: words[0] ? `המילה "${words[0]}" התקבלה. עכשיו הבוט מדגים תור קצר.` : 'מהלך יפה. עכשיו הבוט מדגים תור קצר.',
        selectors: ['#sv1', '#turn-name'],
      });
      return;
    }
    if (slot === 1) {
      bus.emit(TUTORIAL_TIP, {
        label: 'תור שני',
        text: 'הבוט שיחק מהלך קבוע. המשך לבנות מילים מחוברות ללוח.',
        selectors: ['#game-grid', '#brack'],
      });
    }
  }));

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
    selectors: ['#brack', '#c5_5', '#c5_6', '#c5_7', '#c5_8'],
  };
}
