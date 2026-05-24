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

export function createGameFlowController({
  bus,
  root = globalThis.document,
  activeGameRef = () => globalThis.__spine?.activeGame ?? null,
  startGame = () => {},
  showScreen = () => {},
  enterCoin = () => {},
} = {}) {
  if (!bus) throw new Error('createGameFlowController: bus required');

  const cleanups = [];

  wireButton('#btn-pause', () => bus.emit(PAUSE_OPEN, currentPlayerPayload()));
  wireButtons('button[onclick="openSettings()"]', () => bus.emit(SETTINGS_OPEN, {}));
  wireButtons('button[onclick="openEndMenu()"]', () => bus.emit(BACK_OPEN, {}));
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
    bus.emit('overlay/end/open', {
      winnerSlot: winnerSlot(session.state),
      scores: { ...session.state.scores },
      players: session.state.players,
      abandonedBy: session.state.abandonedBy,
    });
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
    endActiveGame();
    showScreen('sh');
  }));
  cleanups.push(bus.on(PAUSE_INTENT.QUIT_NO_SAVE, () => {
    const ag = activeGameRef();
    if (ag?.online && !ag?.isAsync) {
      bus.emit(RESIGN_OPEN, { slot: ag.session?.mySlot ?? ag.session?.state?.currentTurnSlot });
      return;
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
    if (ag?.online && !ag?.isAsync) {
      // Live online: resign so the opponent is notified, then show end screen.
      // The user already confirmed "leave" via the back-confirm dialog so we
      // skip the resign-confirm step and go straight to the resign dispatch.
      ag.session?.dispatch?.({ type: CMD.RESIGN_GAME, payload: { slot: ag.session.mySlot } });
      hideOverlay('ov-back-confirm');
      return;
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
  if (state?.abandonedBy === 0) return 1;
  if (state?.abandonedBy === 1) return 0;
  const a = state?.scores?.[0] ?? 0;
  const b = state?.scores?.[1] ?? 0;
  return a === b ? null : a > b ? 0 : 1;
}
