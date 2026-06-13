import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { END_INTENT } from '../screens/endGameScreen.js';
import { PAUSE_INTENT, PAUSE_OPEN } from '../screens/pauseScreen.js';
import { BACK_INTENT, BACK_OPEN } from '../screens/backConfirmScreen.js';
import { COIN_INTENT } from '../screens/coinTossScreen.js';
import { SETTINGS_OPEN, SETTINGS_CHANGED } from '../screens/settingsScreen.js';
import { RESIGN_INTENT, RESIGN_OPEN } from '../screens/resignConfirmScreen.js';
import { on } from '../domHelpers.js';
import {
  applyGameSettingsToGlobals,
  mergeUiPreferences,
  normalizeGameSettings,
  saveGameSettings,
  uiPreferencePatchFromSettings,
} from '../../game/settings/settingsCompat.js';
import * as audioService from '../audioService.js';
import { saveLocalGame, clearLocalGame } from '../../game/sessions/localSaveService.js';
import { MENU_REFRESH } from '../screens/menuScreen.js';

export function createGameFlowController({
  bus,
  root = globalThis.document,
  activeGameRef = () => globalThis.__spine?.activeGame ?? null,
  startGame = () => {},
  showScreen = () => {},
  enterCoin = () => {},
  storage = globalThis.localStorage ?? null,
} = {}) {
  if (!bus) throw new Error('createGameFlowController: bus required');

  const cleanups = [];

  wireButton('#btn-pause', () => bus.emit(PAUSE_OPEN, currentPlayerPayload()));
  wireButtons('button[onclick="openSettings()"]', () => bus.emit(SETTINGS_OPEN, {}));

  // The end-menu button needs special handling: we cache the .tb-tx span
  // at mount time BEFORE wireButtons() strips the onclick attribute.
  // Otherwise the EV.GAME_STARTED listener below couldn't find the button
  // again — `button[onclick="openEndMenu()"]` matches nothing once the
  // attribute is gone.
  const endMenuBtn = root?.querySelector?.('button[onclick="openEndMenu()"]') ?? null;
  const endMenuTx  = endMenuBtn?.querySelector?.('.tb-tx') ?? null;
  wireButtons('button[onclick="openEndMenu()"]', () => bus.emit(BACK_OPEN, {}));

  // Offline modes can pause-and-save from the back-confirm overlay, so the
  // top-bar end button reads "סיים / שמור" to advertise the save path.
  // Online (live/async) games have no local-save option, so we keep the
  // shorter "סיום" label there.
  cleanups.push(bus.on(EV.GAME_STARTED, ({ mode } = {}) => {
    if (!endMenuTx) return;
    if (mode === 'offline-solo' || mode === 'offline-2p') {
      endMenuTx.innerHTML = 'סיים<br>/ שמור';
    } else {
      endMenuTx.textContent = 'סיום';
    }
  }));
  wireButtons('button[onclick="toggleMusic()"]', () => {
    const { enabled } = audioService.toggle();
    // Emit SETTINGS_CHANGED so the settings overlay (if open) repaints its
    // music yes/no pill, and the existing SETTINGS_CHANGED handler persists
    // the new value through the legacy gameSettings path. audioService is
    // idempotent on identical state so the round-trip is harmless.
    bus.emit(SETTINGS_CHANGED, { music: enabled });
  });
  audioService.refreshButton();

  cleanups.push(bus.on(EV.GAME_COMPLETED, () => {
    const ag = activeGameRef();
    const session = ag?.session;
    if (!session?.state) return;
    // A finished game can't be resumed. Clear the saved-game slot if this
    // active game was resumed from it (or if this offline game just ended
    // — leaves no stale offline save behind).
    if (!ag.online && storage) clearLocalGame(storage);
    bus.emit('overlay/end/open', {
      winnerSlot: winnerSlot(session.state),
      scores: { ...session.state.scores },
      players: session.state.players,
      abandonedBy: session.state.abandonedBy,
    });
    bus.emit(MENU_REFRESH, { hasSavedGame: false });
  }));

  cleanups.push(bus.on(END_INTENT.GO_HOME, () => {
    endActiveGame();
    hideOverlay('ov-end');
    showScreen('sh');
  }));

  cleanups.push(bus.on(END_INTENT.REMATCH, () => {
    const ag = activeGameRef();
    const session = ag?.session;
    if (!session?.state) return;
    const { mode, players } = session.state;
    endActiveGame();
    hideOverlay('ov-end');
    if (mode === 'offline-2p' || mode === 'offline-solo') {
      startGame({
        mode,
        bot: mode === 'offline-solo',
        p1Name: players?.[0]?.displayName,
        p2Name: players?.[1]?.displayName,
      });
    } else {
      showScreen('so');
    }
  }));

  cleanups.push(bus.on(PAUSE_INTENT.RESUME, () => hideOverlay('ov-pause')));
  cleanups.push(bus.on(PAUSE_INTENT.SAVE_AND_EXIT, () => {
    const ag = activeGameRef();
    if (ag?.online && !ag?.isAsync) {
      hideOverlay('ov-pause');
      ag.session?.dispatch?.({ type: CMD.RESIGN_GAME, payload: { slot: ag.session.mySlot } });
      return;
    }
    // Offline 2P / vs-Bot: serialize the engine state to localStorage so
    // the home-screen "המשך משחק" button can rebuild the session later.
    const state = ag?.session?.state;
    let saved = false;
    if (state && storage) {
      saved = saveLocalGame(storage, {
        mode: state.mode,
        bot: ag.mode === 'offline-solo' || !!ag.bot || state.mode === 'offline-solo',
        difficulty: ag.difficulty,
        state,
      });
    }
    endActiveGame();
    showScreen('sh');
    if (saved) bus.emit(MENU_REFRESH, { hasSavedGame: true });
  }));
  cleanups.push(bus.on(PAUSE_INTENT.QUIT_NO_SAVE, () => {
    const ag = activeGameRef();
    if (ag?.online && !ag?.isAsync) {
      bus.emit(RESIGN_OPEN, { slot: ag.session?.mySlot ?? ag.session?.state?.currentTurnSlot });
      return;
    }
    // Discard any existing saved offline game — the user explicitly asked
    // to quit without saving, so any prior save from THIS resumed slot
    // would be stale.
    if (ag?.resumedFromLocalSave && storage) {
      clearLocalGame(storage);
      bus.emit(MENU_REFRESH, { hasSavedGame: false });
    }
    endActiveGame();
    showScreen('sh');
  }));

  cleanups.push(bus.on(BACK_INTENT.STAY, () => hideOverlay('ov-back-confirm')));
  cleanups.push(bus.on(BACK_INTENT.PAUSE_AND_SAVE, () => {
    hideOverlay('ov-back-confirm');
    bus.emit(PAUSE_OPEN, currentPlayerPayload());
  }));
  cleanups.push(bus.on(BACK_INTENT.LEAVE, () => {
    const ag = activeGameRef();
    if (ag?.online) {
      // Online (live AND async): the top-bar "סיום" button means END the
      // game, so resign — the engine fires GAME_COMPLETED and the online
      // session writes the terminal status to Firebase (clearing the async
      // index). For async this is the only way to actually finish a game;
      // the separate "home" button (#btn-async-home) is the leave-and-resume
      // path. The user already confirmed via the back-confirm dialog, so we
      // skip the resign-confirm step and dispatch straight away.
      ag.session?.dispatch?.({ type: CMD.RESIGN_GAME, payload: { slot: ag.session.mySlot } });
      hideOverlay('ov-back-confirm');
      return;
    }
    // Offline "צא בלי לשמור" abandons the in-progress game. If it was
    // resumed from a saved slot, drop the save so it doesn't reappear.
    if (ag?.resumedFromLocalSave && storage) {
      clearLocalGame(storage);
      bus.emit(MENU_REFRESH, { hasSavedGame: false });
    }
    endActiveGame();
    showScreen('sh');
  }));

  cleanups.push(bus.on(SETTINGS_CHANGED, (changes = {}) => {
    const state = activeGameRef()?.session?.state;
    const current = normalizeGameSettings({ ...(globalThis.gameSettings ?? {}), ...(state?.settings ?? {}) });
    const next = applyGameSettingsToGlobals(globalThis, { ...current, ...changes });
    if (state?.settings) Object.assign(state.settings, next);
    saveGameSettings(globalThis.localStorage, next);
    const prefPatch = uiPreferencePatchFromSettings(changes);
    if (Object.keys(prefPatch).length) {
      const prefs = mergeUiPreferences(globalThis.localStorage, prefPatch);
      activeGameRef()?.animationController?.setEnabled?.(prefs.animationsEnabled);
      if (Object.prototype.hasOwnProperty.call(prefPatch, 'music')) {
        audioService.setEnabled(prefs.music);
      }
    }
  }));

  cleanups.push(bus.on(RESIGN_INTENT.CONFIRM, ({ slot } = {}) => {
    const ag = activeGameRef();
    const resignSlot = (slot === 0 || slot === 1)
      ? slot
      : ag?.session?.mySlot ?? ag?.session?.state?.currentTurnSlot;
    ag?.session?.dispatch?.({ type: CMD.RESIGN_GAME, payload: { slot: resignSlot } });
  }));

  cleanups.push(bus.on(COIN_INTENT.ENTER, () => enterCoin()));

  function wireButton(selector, handler) {
    const el = root?.querySelector?.(selector);
    if (!el) return;
    el.removeAttribute?.('onclick');
    cleanups.push(on(el, 'click', (e) => {
      e.preventDefault?.();
      handler(e);
    }));
  }

  function wireButtons(selector, handler) {
    const els = root?.querySelectorAll?.(selector);
    if (els?.length) {
      for (const el of els) wireSpecificButton(el, handler);
      return;
    }
    wireButton(selector, handler);
  }

  function wireSpecificButton(el, handler) {
    el.removeAttribute?.('onclick');
    cleanups.push(on(el, 'click', (e) => {
      e.preventDefault?.();
      handler(e);
    }));
  }

  function currentPlayerPayload() {
    const state = activeGameRef()?.session?.state;
    const slot = state?.currentTurnSlot ?? 0;
    return { playerName: state?.players?.[slot]?.displayName };
  }

  function endActiveGame() {
    try { activeGameRef()?.end?.(); } catch (e) { console.warn('[gameFlowController.end]', e); }
  }

  function hideOverlay(id) {
    root?.getElementById?.(id)?.classList?.add('hidden');
  }

  function dispose() {
    for (const off of cleanups.splice(0)) {
      try { off(); } catch {}
    }
  }

  return { dispose };
}

function winnerSlot(state) {
  const a = state?.scores?.[0] ?? 0;
  const b = state?.scores?.[1] ?? 0;
  // A tied score (incl. 0-0) is a draw even if a player abandoned — a walkout
  // at a tie isn't a win for the other side.
  if (a === b) return null;
  if (state?.abandonedBy === 0) return 1;
  if (state?.abandonedBy === 1) return 0;
  return a > b ? 0 : 1;
}
