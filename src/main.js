// Boost — new-spine entry point.
//
// Stage 10 cutover entry point. This module owns the app shell and boots
// unconditionally.
//
// On boot, this module:
//   1. Loads the Hebrew dictionary (./data/dictionary.base.txt)
//   2. Registers all boost plugins on the boostEngine
//   3. Exposes window.__spine with the live bus, engine factories, and
//      session adapters — so a tester can drive offline / bot / online
//      games from DevTools
//   4. Mounts a minimal demo session if URL also has &demo=offline2p
//      (otherwise the spine stays in standby waiting for explicit boot)
//
import * as bus from './events/bus.js';
import { CMD } from './events/commands.js';
import { EV } from './events/eventTypes.js';

import * as hebrewDictionary from './game/core/hebrewDictionary.js';
import { HV } from './game/core/letterDistribution.js';
import { createInitialState } from './game/core/gameEngine.js';
import { registerAllBoosts, _resetAndRegister, BDEFS, BONUS_TYPES } from './game/boosts/index.js';

import { createLocalGameSession } from './game/sessions/localGameSession.js';
import { attachBotPlayer } from './game/sessions/botGameSession.js';
import { attachScriptedTutorialBot, seedTutorialRack, TUTORIAL_WORDS } from './game/sessions/tutorialSession.js';
import { createOnlineGameSession } from './game/sessions/onlineGameSession.js';

import * as firebaseClient from './game/online/firebaseClient.js';
import * as roomService from './game/online/roomService.js';
import * as inviteService from './game/online/inviteService.js';
import * as matchmakingService from './game/online/matchmakingService.js';
import * as presenceService from './game/online/presenceService.js';
import * as roomCodeService from './game/online/roomCodeService.js';
import * as asyncSessionService from './game/online/asyncSessionService.js';
import * as asyncReminderService from './game/online/asyncReminderService.js';
import * as sessionPersistence from './game/online/sessionPersistence.js';
import { createTimeoutWatchdog } from './game/online/timeoutWatchdog.js';
import * as profileService from './game/account/profileService.js';
import * as friendsService from './game/account/friendsService.js';
import * as ratingService from './game/account/ratingService.js?v=20260513111500';
import * as dictionaryService from './game/account/dictionaryService.js';
import * as settingsCompat from './game/settings/settingsCompat.js';
import * as audioService from './ui/audioService.js';
import * as feedbackService from './ui/feedbackService.js';
import { startMatchmaking } from './game/online/spineMatchmaking.js';

import { createGameController } from './ui/controllers/gameController.js';
import { createAnimationController } from './ui/controllers/animationController.js';
import { createGameFlowController } from './ui/controllers/gameFlowController.js';
import { createTurnTimerController } from './ui/controllers/turnTimerController.js';
import { createDisconnectController } from './ui/controllers/disconnectController.js';
import { createTutorialController } from './ui/controllers/tutorialController.js';
import { mountGameScreen, GAME_SCREEN_INTENT, BONUS_AWARD_ACK } from './ui/screens/gameScreen.js';
import { showScreen as spineShowScreen } from './ui/screens/screenTransitions.js';
import { mountMenuScreen, MENU_INTENT, MENU_REFRESH } from './ui/screens/menuScreen.js';
import { mountSetupScreen, SETUP_INTENT, SETUP_OPEN } from './ui/screens/setupScreen.js';
import { mountOnlineLobbyScreen, LOBBY_INTENT } from './ui/screens/onlineLobbyScreen.js';
import { mountMatchmakingOverlayScreen, mountPartnerSearchOverlay, MM_INTENT, PS_INTENT } from './ui/screens/matchmakingOverlayScreen.js';
import { mountCreateRoomScreen, CR_INTENT } from './ui/screens/createRoomScreen.js';
import { mountWaitingRoomScreen, WR_INTENT, WR_OPEN, WR_CLOSE, WR_LIVE_INVITE_SENT, buildWhatsAppShareUrl } from './ui/screens/waitingRoomScreen.js';
import { mountJoinCodeScreen, JC_INTENT } from './ui/screens/joinCodeScreen.js';
import { mountIncomingInviteScreen, II_INTENT, IR_INTENT, II_OPEN, II_CLOSE, IR_OPEN, IR_CLOSE } from './ui/screens/incomingInviteScreen.js';
import { mountAsyncSessionListScreen, AS_INTENT, AS_RENDER } from './ui/screens/asyncSessionListScreen.js';
import { mountAsyncHomeButton, AH_INTENT, AH_SHOW, AH_HIDE } from './ui/screens/asyncHomeButton.js';
import * as asyncTurnBanner from './notifications/asyncTurnBanner.js';
import * as browserNotificationFallback from './notifications/browserNotificationFallback.js';
import { createBonusActivationController, BONUS_PENDING, BONUS_RESOLVED } from './ui/controllers/bonusActivationController.js';
import { mountBonusIntroScreen, BI_INTENT, BI_OPEN, BI_CLOSE, describeBonus } from './ui/screens/bonusIntroScreen.js';
import { mountBonusSpectatorScreen } from './ui/screens/bonusSpectatorScreen.js';
import { mountBoostVetoScreen, BV_INTENT, BV_OPEN, BV_CLOSE } from './ui/screens/boostVetoScreen.js';
import { mountBoostBadges, BB_INTENT } from './ui/screens/boostBadges.js';
import { mountUnscrambleMiniGame,    playUnscrambleForBonus    } from './ui/screens/miniGames/unscrambleMiniGame.js';
import { mountFillMiddleMiniGame,    playFillMiddleForBonus    } from './ui/screens/miniGames/fillMiddleMiniGame.js';
import { mountWheelMiniGame,         playWheelForBonus         } from './ui/screens/miniGames/wheelMiniGame.js';
import { mountWordSearchMiniGame,    playWordSearchForBonus    } from './ui/screens/miniGames/wordSearchMiniGame.js';
import { mountCrosswordMiniGame,     playCrosswordForBonus     } from './ui/screens/miniGames/crosswordMiniGame.js';
import { mountCrossingWordsMiniGame, playCrossingWordsForBonus } from './ui/screens/miniGames/crossingWordsMiniGame.js';
import { mountHoneycombMiniGame,     playHoneycombForBonus     } from './ui/screens/miniGames/honeycombMiniGame.js';
import { mountScoreBonusAnimation } from './ui/controllers/scoreBonusAnimation.js';
import { mountProfileScreen, PROFILE_INTENT, PROFILE_RENDER, avatarEmoji } from './ui/screens/profileScreen.js';
import { mountStatsScreen, STATS_INTENT } from './ui/screens/statsScreen.js';
import {
  mountAvatarPickerScreen, mountAvatarUnlockedScreen,
  AV_INTENT, AV_RENDER, AV_UNLOCK_OPEN, AV_UNLOCK_CLOSE,
  diffNewlyUnlocked, findAvatar,
} from './ui/screens/avatarScreens.js';
import { mountAuthScreens, AUTH_INTENT, AUTH_ERROR_HE } from './ui/screens/authScreens.js';
import { mountFriendsScreen, FRIENDS_INTENT, FRIENDS_RENDER, FRIENDS_DETAIL_RENDER } from './ui/screens/friendsScreen.js';
import { mountNotificationsScreen, mountNotifBanner, NOTIF_INTENT, NOTIF_RENDER, NOTIF_BANNER_SHOW } from './ui/screens/notificationsScreen.js';
import { mountChampionsScreen, CHAMPS_INTENT, CHAMPS_OPEN, CHAMPS_RENDER, CHAMPS_ERROR } from './ui/screens/championsScreen.js';
import { mountDictionaryScreen, DICT_INTENT, DICT_RENDER } from './ui/screens/dictionaryScreen.js';
import { mountTutorialScreen, TUTORIAL_INTENT, TUTORIAL_OPEN, TUTORIAL_CLOSE, TUTORIAL_TIP, TUTORIAL_CLEAR } from './ui/screens/tutorialScreen.js';
import { mountJokerPicker, JOKER_INTENT } from './ui/screens/jokerPicker.js';
import { mountEndGameScreen,    END_INTENT,        END_OPEN }        from './ui/screens/endGameScreen.js';
import { mountPauseScreen,      PAUSE_INTENT,      PAUSE_OPEN }      from './ui/screens/pauseScreen.js';
import { mountBackConfirmScreen,BACK_INTENT,       BACK_OPEN }       from './ui/screens/backConfirmScreen.js';
import { mountCoinTossScreen,   COIN_INTENT,       COIN_OPEN, COIN_WAITING } from './ui/screens/coinTossScreen.js';
import { mountSettingsScreen,   SETTINGS_INTENT,   SETTINGS_OPEN, SETTINGS_CHANGED } from './ui/screens/settingsScreen.js';
import { mountDisconnectScreen, DISCONNECT_INTENT, DISCONNECT_OPEN, DISCONNECT_CLOSE } from './ui/screens/disconnectScreen.js';
import { mountResignConfirmScreen, RESIGN_INTENT, RESIGN_OPEN, RESIGN_CLOSE } from './ui/screens/resignConfirmScreen.js';

import * as notificationService from './notifications/notificationService.js';
import * as inAppNotificationService from './notifications/inAppNotificationService.js';

const params = new URLSearchParams(globalThis.location?.search ?? '');
let activeFbDb = null;
let activeFbAuth = null;
let activeFbCurrentUser = null;
let activeFbServerTimestamp = null;
let dictionaryLoadPromise = null;
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCE-Im2HzYhJVlRd07uIHqcsCGTQQhYgDo',
  authDomain: 'boost-8ef11.firebaseapp.com',
  databaseURL: 'https://boost-8ef11-default-rtdb.firebaseio.com',
  projectId: 'boost-8ef11',
  storageBucket: 'boost-8ef11.firebasestorage.app',
  messagingSenderId: '816797852120',
  appId: '1:816797852120:web:bfb9ab25fe8e6d9860d2ad',
};

/**
 * @typedef {object} SpineDebugApi
 * @property {true} enabled
 * @property {number} stage
 * @property {typeof bus} bus
 * @property {() => Promise<number>} ensureDictionaryLoaded
 * @property {() => any} bootOffline2P
 * @property {(options?: { difficulty?: number }) => any} bootOfflineBot
 * @property {(options: object) => any} startGameViaSpine
 * @property {() => any} startTutorialViaSpine
 * @property {(options: object) => Promise<any>} startOnlineGameViaSpine
 */

async function boot() {
  if (globalThis.__screenPartialsReady) {
    try {
      await globalThis.__screenPartialsReady;
    } catch (e) {
      console.warn('[spine] screen partial load failed:', e);
    }
  }

  // Wait for DOMContentLoaded so the legacy DOM exists when our screens mount
  if (globalThis.document?.readyState === 'loading') {
    await new Promise(r => globalThis.document.addEventListener('DOMContentLoaded', r, { once: true }));
  }

  console.info('[spine] booting…');

  installCutoverGlobals();

  // ─── Boost registry ─────────────────────────────────────
  _resetAndRegister();

  // ─── Dictionary ─────────────────────────────────────────
  // Keep the first render path clear; the dictionary preloads in the
  // background and every word-facing feature can retry on demand.
  scheduleDictionaryPreload();

  // ─── Notifications boot ────────────────────────────────
  // Notification service boot is idempotent.
  const cfg = globalThis.APP_CONFIG ?? {};
  firebaseClient.configure({ firebaseConfig: cfg.firebaseConfig ?? DEFAULT_FIREBASE_CONFIG });
  if (cfg.onesignalAppId) {
    notificationService.configure({
      appId: cfg.onesignalAppId,
      pushWorkerUrl: cfg.pushWorkerUrl,
      getIdToken: async () => {
        try {
          return await activeFbCurrentUser?.getIdToken?.();
        } catch {
          return null;
        }
      },
    });
  }
  // Wait for sign-in to call notificationService.boot({ uid }) — that's the
  // session's job, not ours.

  const firebaseReady = ensureFirebaseGlobals()
    .catch((e) => {
      console.info('[spine] Firebase boot skipped:', e?.message ?? e);
      return null;
    });

  // Retry Firebase init when the browser regains connectivity, and ask the
  // Realtime Database to stop reconnecting while we're offline so the auth
  // refresh / websocket loops stop spamming ERR_INTERNET_DISCONNECTED.
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('online', () => {
      ensureFirebaseGlobals()
        .then(() => { try { activeFbDb?.goOnline?.(); } catch { /* swallow */ } })
        .catch((e) => console.info('[spine] Firebase online retry skipped:', e?.message ?? e));
    });
    globalThis.addEventListener('offline', () => {
      try { activeFbDb?.goOffline?.(); } catch { /* swallow */ }
    });
  }

  // Wire the in-app toast renderer to the legacy status bar (#sbar via
  // setS). Falls back to console if setS isn't on the page.
  inAppNotificationService.setRenderer(({ kind, text, durationMs }) => {
    const setS = globalThis.setS;
    if (typeof setS === 'function') {
      try { setS(text, kind === 'err' ? 'err' : kind === 'warn' ? 'err' : 'ok'); return; }
      catch { /* fall through */ }
    }
    console.info('[toast]', kind, text, '(' + durationMs + 'ms)');
  });

  const uiPreferences = settingsCompat.loadUiPreferences(globalThis.localStorage);
  const bootSettings = settingsCompat.loadGameSettings(globalThis.localStorage, globalThis);
  settingsCompat.applyGameSettingsToGlobals(globalThis, {
    ...bootSettings,
    music: uiPreferences.music,
  });
  audioService.init({ storage: globalThis.localStorage, doc: globalThis.document });
  feedbackService.init({ storage: globalThis.localStorage, doc: globalThis.document, bus });

  // ─── Debug surface ─────────────────────────────────────
  /** @type {SpineDebugApi & Record<string, any>} */
  globalThis.__spine = {
    enabled: true,
    stage: 10,
    bus,
    CMD, EV,
    get db() { return activeFbDb; },
    get auth() { return activeFbAuth; },
    get currentUser() { return activeFbCurrentUser; },
    hebrewDictionary,
    ensureDictionaryLoaded,
    createInitialState,
    sessions: { createLocalGameSession, attachBotPlayer, attachScriptedTutorialBot, createOnlineGameSession },
    online: { firebaseClient, roomService, inviteService, matchmakingService, presenceService, roomCodeService, asyncSessionService, asyncReminderService, sessionPersistence },
    account: { profileService, friendsService, ratingService, dictionaryService },
    settings: settingsCompat,
    ui: {
      createGameController, createAnimationController,
      mountGameScreen, GAME_SCREEN_INTENT, mountMenuScreen, mountSetupScreen, mountOnlineLobbyScreen, mountJokerPicker,
      mountEndGameScreen, mountPauseScreen, mountBackConfirmScreen, mountCoinTossScreen,
      mountSettingsScreen, mountDisconnectScreen, mountResignConfirmScreen,
      mountMatchmakingOverlayScreen, mountPartnerSearchOverlay, mountCreateRoomScreen, mountWaitingRoomScreen, mountJoinCodeScreen, mountIncomingInviteScreen,
      mountAsyncSessionListScreen, mountAsyncHomeButton,
      mountBonusIntroScreen, mountBoostVetoScreen, mountBoostBadges,
      mountUnscrambleMiniGame, mountWheelMiniGame,
      mountWordSearchMiniGame, mountCrosswordMiniGame,
      mountCrossingWordsMiniGame, mountHoneycombMiniGame,
      mountScoreBonusAnimation,
      mountProfileScreen, mountStatsScreen, mountAvatarPickerScreen, mountAvatarUnlockedScreen,
      mountAuthScreens, mountFriendsScreen, mountNotificationsScreen, mountChampionsScreen, mountDictionaryScreen, mountTutorialScreen,
      createTutorialController,
      createBonusActivationController,
      MENU_INTENT, MENU_REFRESH, SETUP_INTENT, SETUP_OPEN, LOBBY_INTENT, MM_INTENT,
      CR_INTENT, WR_INTENT, WR_OPEN, WR_CLOSE, WR_LIVE_INVITE_SENT,
      JC_INTENT, II_INTENT, IR_INTENT, II_OPEN, II_CLOSE, IR_OPEN, IR_CLOSE,
      AS_INTENT, AS_RENDER, AH_INTENT, AH_SHOW, AH_HIDE,
      BI_INTENT, BI_OPEN, BI_CLOSE,
      BV_INTENT, BV_OPEN, BV_CLOSE,
      BB_INTENT, BONUS_PENDING, BONUS_RESOLVED,
      JOKER_INTENT,
      CHAMPS_INTENT, CHAMPS_OPEN, CHAMPS_RENDER, CHAMPS_ERROR,
      DICT_INTENT, DICT_RENDER,
      PROFILE_INTENT, PROFILE_RENDER, STATS_INTENT, AV_INTENT, AV_RENDER, FRIENDS_INTENT, FRIENDS_RENDER, FRIENDS_DETAIL_RENDER,
      NOTIF_INTENT, NOTIF_RENDER, NOTIF_BANNER_SHOW,
      TUTORIAL_INTENT, TUTORIAL_OPEN, TUTORIAL_CLOSE, TUTORIAL_TIP, TUTORIAL_CLEAR,
      END_INTENT, END_OPEN, PAUSE_INTENT, PAUSE_OPEN, BACK_INTENT, BACK_OPEN,
      COIN_INTENT, COIN_OPEN, SETTINGS_INTENT, SETTINGS_OPEN, SETTINGS_CHANGED,
      DISCONNECT_INTENT, DISCONNECT_OPEN, DISCONNECT_CLOSE,
      RESIGN_INTENT, RESIGN_OPEN, RESIGN_CLOSE,
    },
    notifications: { notificationService, inAppNotificationService },
    boosts: { registerAllBoosts },

    // Convenience: spin up an offline 2-player session for smoke testing.
    bootOffline2P() {
      return startGameViaSpine({ mode: 'offline-2p' });
    },

    // Convenience: spin up an offline solo-vs-bot session.
    bootOfflineBot({ difficulty = 1 } = {}) {
      return startGameViaSpine({ mode: 'offline-solo', bot: true, difficulty });
    },

    // Used by menu/setup intents.
    startGameViaSpine,
    startTutorialViaSpine,

    // Used by online matchmaking.
    startOnlineGameViaSpine,
  };

  let activePresenceHandle = null;
  let activePresenceUid = null;
  let lastLivePreviewWrite = '';
  const recoveredSessionForUid = new Set();

  async function bootCrossCuttingFor(uid) {
    if (!uid) return;
    const db = activeFbDb;
    try {
      const pushReady = await notificationService.boot({ uid });
      if (pushReady) await notificationService.loginUser(uid);
    } catch (e) {
      console.warn('[spine] notification boot', e);
    }

    if (db && activePresenceUid !== uid) {
      try { await activePresenceHandle?.stop?.(); } catch {}
      activePresenceHandle = null;
      activePresenceUid = uid;
      try {
        activePresenceHandle = await presenceService.startPresence(db, {
          uid,
          currentRoom: globalThis.__spine?.activeGame?.session?.roomId ?? null,
          serverTimestamp: firebaseTimestamp(),
        });
      } catch (e) {
        console.warn('[spine] presence start', e);
      }
    }

    try { globalThis.__spine.bootInviteListeners?.(uid); } catch (e) { console.warn('[spine] invite boot', e); }
    try { globalThis.__spine.bootAsyncSessions?.(uid); } catch (e) { console.warn('[spine] async boot', e); }
    try { globalThis.__spine.bootAccount?.(uid); } catch (e) { console.warn('[spine] account boot', e); }

    // Toggle the settings overlay's "הגדרות מתקדמות" button visibility from
    // /admins/{uid}. Read once per auth event; non-admins never see the
    // button (so they never hit the admin-login password prompt either).
    refreshAdminUiFor(uid).catch((e) => console.warn('[spine] admin check', e));

    if (!recoveredSessionForUid.has(uid)) {
      recoveredSessionForUid.add(uid);
      attemptSavedOnlineRecovery(uid).catch((e) => console.warn('[spine] saved-session recovery', e));
    }
  }

  async function teardownCrossCuttingAuth() {
    try { await activePresenceHandle?.stop?.(); } catch {}
    activePresenceHandle = null;
    activePresenceUid = null;
    sessionPersistence.clearActiveOnlineSession(globalThis.localStorage);
    setDictAdvancedBtnVisible(false);
  }

  // /admins/{uid} controls whether the settings overlay surfaces the
  // הגדרות מתקדמות button. We check on every auth boot (the read itself
  // is gated by the same `.read: auth != null` rule).
  async function refreshAdminUiFor(uid) {
    if (!uid || !activeFbDb) { setDictAdvancedBtnVisible(false); return; }
    try {
      const snap = await activeFbDb.ref(`admins/${uid}`).get();
      setDictAdvancedBtnVisible(snap?.exists?.() === true && snap.val() === true);
    } catch (e) {
      console.warn('[spine] admin lookup failed', e);
      setDictAdvancedBtnVisible(false);
    }
  }
  function setDictAdvancedBtnVisible(visible) {
    const btn = globalThis.document?.getElementById?.('btn-dict-advanced');
    if (!btn) return;
    btn.style.display = visible ? '' : 'none';
  }

  function wireAuthCrossCutting() {
    const auth = activeFbAuth;
    if (auth?.onAuthStateChanged) {
      auth.onAuthStateChanged((user) => {
        if (user?.uid) bootCrossCuttingFor(user.uid);
        else teardownCrossCuttingAuth();
      });
    }
    if (activeFbCurrentUser?.uid) bootCrossCuttingFor(activeFbCurrentUser.uid);
  }

  globalThis.__spine.bootCrossCutting = bootCrossCuttingFor;
  globalThis.__spine.teardownCrossCuttingAuth = teardownCrossCuttingAuth;

  async function updatePresenceRoom(roomId) {
    const uid = activeFbCurrentUser?.uid;
    const db = activeFbDb;
    if (!uid || !db) return;
    try {
      await db.ref(`presence/${uid}`).update({
        currentRoom: roomId ?? null,
        lastSeen: firebaseTimestamp(),
      });
    } catch (e) {
      console.warn('[spine] presence room update', e);
    }
  }

  function saveCurrentOnlineSession() {
    const ag = globalThis.__spine?.activeGame;
    const uid = activeFbCurrentUser?.uid;
    const roomId = ag?.online ? ag.session?.roomId : null;
    if (!uid || !roomId) return;
    sessionPersistence.saveActiveOnlineSession(globalThis.localStorage, { roomId, userId: uid });
  }

  async function attemptSavedOnlineRecovery(uid) {
    const db = activeFbDb;
    if (!db || !uid || globalThis.__spine?.activeGame) return;
    const saved = sessionPersistence.readActiveOnlineSession(globalThis.localStorage);
    if (saved?.roomId && saved.userId === uid) {
      await resumeOnlineRoomById(saved.roomId, { skipCoin: true });
      return;
    }
    try {
      const snap = await db.ref(`users/${uid}/activeRoom`).get();
      const roomId = snap?.val ? snap.val() : null;
      if (roomId) await resumeOnlineRoomById(roomId, { skipCoin: true });
    } catch (e) {
      console.warn('[spine] activeRoom recovery', e);
    }
  }

  async function syncRoomSubscriptionId(roomId, slot) {
    const db = activeFbDb;
    const uid = activeFbCurrentUser?.uid;
    if (!db || !uid || !roomId || (slot !== 0 && slot !== 1)) return;
    try {
      const pushReady = await notificationService.boot({ uid });
      if (!pushReady) return;
      await notificationService.loginUser(uid);
      const subId = await notificationService.getSubscriptionId();
      if (subId) await roomService.setPlayerSubscriptionId(db, roomId, slot, subId);
    } catch (e) {
      console.warn('[spine] room subscription id', e);
    }
  }

  function wireServiceWorkerMessages() {
    const handler = (event) => handleServiceWorkerMessage(event?.data ?? event);
    try { globalThis.navigator?.serviceWorker?.addEventListener?.('message', handler); } catch {}
    globalThis.__spine.handleServiceWorkerMessage = handleServiceWorkerMessage;
  }

  function handleServiceWorkerMessage(data = {}) {
    const type = data.type ?? data.action;
    if (type === 'OPEN_TURN') {
      const roomId = data.roomId ?? data.room;
      if (roomId) resumeOnlineRoomById(roomId, { skipCoin: true });
      return;
    }
    if (type === 'OPEN_JOIN') {
      showLegacyScreen('so');
      const code = data.code ?? data.roomCode ?? '';
      const input = globalThis.document?.getElementById?.('jc-code');
      if (input && code) input.value = code;
      globalThis.document?.getElementById?.('ov-join-code')?.classList?.remove?.('hidden');
      return;
    }
    if (type === 'OPEN_PROFILE') {
      try { globalThis.openProfileOrAuth?.(); return; } catch {}
      showLegacyScreen('sprofile');
      return;
    }
    if (type === 'OPEN_GAME_SUMMARY') {
      const roomId = data.roomId ?? data.room;
      if (roomId) resumeOnlineRoomById(roomId, { skipCoin: true });
      else bus.emit(CHAMPS_OPEN, {});
    }
  }

  // Click router for the browser-notification fallback. browserNotificationFallback
  // returns a `{ target, roomCode }`-shaped route; translate that into the
  // service-worker message shape `handleServiceWorkerMessage` already knows
  // how to route, so both delivery paths route identically.
  function handleBrowserNotificationClick(route) {
    if (!route) return;
    switch (route.target) {
      case 'OPEN_TURN':
        handleServiceWorkerMessage({ type: 'OPEN_TURN', roomId: route.roomCode });
        return;
      case 'OPEN_JOIN':
        handleServiceWorkerMessage({ type: 'OPEN_JOIN', code: route.roomCode });
        return;
      case 'OPEN_GAME_SUMMARY':
        handleServiceWorkerMessage({ type: 'OPEN_GAME_SUMMARY', roomId: route.roomCode });
        return;
      case 'OPEN_FRIENDS':
        try { globalThis.openFriendsOrAuth?.(); } catch { /* swallow */ }
        return;
      default:
        return;
    }
  }
  globalThis.__spine.handleBrowserNotificationClick = handleBrowserNotificationClick;

  bus.on(EV.MOVE_CONFIRMED, () => {
    saveCurrentOnlineSession();
    const ag = globalThis.__spine?.activeGame;
    if (ag?.online) roomService.setLivePreview(activeFbDb, ag.session.roomId, { slot: ag.session.mySlot, tiles: [] }).catch(() => {});
  });

  bus.on(EV.GAME_COMPLETED, () => {
    const ag = globalThis.__spine?.activeGame;
    if (ag?.online) {
      sessionPersistence.clearActiveOnlineSession(globalThis.localStorage);
      updatePresenceRoom(null);
    }
  });

  bus.on(GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, ({ slot, tiles } = {}) => {
    const ag = globalThis.__spine?.activeGame;
    const db = activeFbDb;
    if (!ag?.online || !db || slot !== ag.session?.mySlot) return;
    const sig = JSON.stringify({ roomId: ag.session.roomId, slot, tiles });
    if (sig === lastLivePreviewWrite) return;
    lastLivePreviewWrite = sig;
    roomService.setLivePreview(db, ag.session.roomId, { slot, tiles }).catch((e) => {
      console.warn('[spine] live preview write', e);
    });
  });

  bus.on(SETTINGS_CHANGED, (changes = {}) => {
    const ag = globalThis.__spine?.activeGame;
    if (!ag?.online || !activeFbDb) return;
    const next = settingsCompat.normalizeGameSettings({ ...(ag.session.state.settings ?? {}), ...changes });
    roomService.setSettings(activeFbDb, ag.session.roomId, next)
      .catch((e) => console.warn('[spine] room settings write', e));
  });

  bus.on(EV.ROOM_SETTINGS_CHANGED, ({ settings } = {}) => {
    settingsCompat.applyGameSettingsToGlobals(globalThis, settings ?? {});
    settingsCompat.saveGameSettings(globalThis.localStorage, settings ?? {});
    globalThis.__spine?.turnTimerController?.sync?.();
  });

  notificationService.attachBusSubscriptions({
    bus,
    sessionRef: () => {
      const ag = globalThis.__spine?.activeGame;
      const session = ag?.session;
      if (!ag?.online || !session) return null;
      const mySlot = session.mySlot;
      const players = session.state?.players ?? {};
      return {
        mode: session.mode,
        roomId: session.roomId,
        mySlot,
        myUid: players[mySlot]?.uid ?? activeFbCurrentUser?.uid,
        opponentUid: players[1 - mySlot]?.uid,
        opponentName: players[1 - mySlot]?.displayName,
        opponentSubscriptionId: players[1 - mySlot]?.oneSignalSubId ?? null,
      };
    },
  });

  firebaseReady.then(() => wireAuthCrossCutting());
  wireServiceWorkerMessages();

  // ─── Menu + setup integration ─────────────────────────
  // Menu START_2P / START_VS_BOT route through the spine. They open #ss so
  // the user can pick names + difficulty, then PLAY_CLICKED starts the game.
    bus.on(MENU_INTENT.START_2P, () => {
      showLegacyScreen('ss');
      bus.emit(SETUP_OPEN, { mode: 'vs', initialDifficulty: 1 });
    });
    bus.on(MENU_INTENT.START_VS_BOT, () => {
      showLegacyScreen('ss');
      bus.emit(SETUP_OPEN, { mode: 'bot', initialDifficulty: 1 });
    });
    bus.on(MENU_INTENT.OPEN_PROFILE, () => {
      showLegacyScreen(activeFbCurrentUser?.uid ? 'sprofile' : 'sauth-login');
    });
    bus.on(MENU_INTENT.OPEN_ONLINE_LOBBY, () => {
      showLegacyScreen('so');
    });
    bus.on(MENU_INTENT.OPEN_SETTINGS, () => {
      bus.emit(SETTINGS_OPEN, {});
    });
    bus.on(MENU_INTENT.OPEN_STATS, () => {
      showLegacyScreen('sstats');
      statsScreen?.refresh?.();
    });
    bus.on(MENU_INTENT.OPEN_FRIENDS, () => {
      showLegacyScreen('sfriends');
    });
    bus.on(MENU_INTENT.OPEN_NOTIFICATIONS, () => {
      showLegacyScreen('snotif');
    });
    bus.on(MENU_INTENT.SHARE_GAME, async () => {
      // Prefer the native Web Share API on mobile (gives the user system
      // share targets — WhatsApp, Messages, etc.). Fall back to copying
      // the URL into the clipboard with a toast confirmation.
      const url = String(globalThis.location?.href ?? '').split('#')[0];
      const data = {
        title: 'בוסט — שבץ נא',
        text: 'בוא לשחק איתי בבוסט שבץ נא!',
        url,
      };
      const nav = globalThis.navigator;
      try {
        if (nav?.canShare?.(data) && typeof nav.share === 'function') {
          await nav.share(data);
          return;
        }
      } catch (e) {
        // user cancelled / browser refused — fall through to clipboard.
      }
      try {
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(url);
          globalThis.setS?.('הקישור הועתק ללוח 📋', 'ok');
          return;
        }
      } catch { /* swallow */ }
      globalThis.setS?.(url, 'ok');
    });
    bus.on(SETUP_INTENT.BACK_CLICKED, () => {
      showLegacyScreen('sh');
    });
    bus.on(LOBBY_INTENT.BACK, () => {
      showLegacyScreen('sh');
    });
    bus.on(LOBBY_INTENT.CREATE_ROOM, () => {
      globalThis.document?.getElementById?.('ov-create-room')?.classList?.remove?.('hidden');
      const nameInput = globalThis.document?.getElementById?.('cr-name');
      if (nameInput) {
        const name = lastProfile?.displayName ?? activeFbCurrentUser?.displayName
                  ?? settingsCompat.loadUiPreferences(globalThis.localStorage).lastDisplayName;
        if (name) nameInput.value = name;
      }
    });
    bus.on(LOBBY_INTENT.JOIN_BY_CODE, () => {
      globalThis.document?.getElementById?.('ov-join-code')?.classList?.remove?.('hidden');
      const nameInput = globalThis.document?.getElementById?.('jc-name');
      if (nameInput) {
        const name = lastProfile?.displayName ?? activeFbCurrentUser?.displayName
                  ?? settingsCompat.loadUiPreferences(globalThis.localStorage).lastDisplayName;
        if (name) nameInput.value = name;
      }
    });
    bus.on(LOBBY_INTENT.MATCHMAKING, () => {
      globalThis.document?.getElementById?.('ov-matchmaking')?.classList?.remove?.('hidden');
      const nameInput = globalThis.document?.getElementById?.('mm-name');
      if (nameInput) {
        const name = lastProfile?.displayName ?? activeFbCurrentUser?.displayName
                  ?? settingsCompat.loadUiPreferences(globalThis.localStorage).lastDisplayName;
        if (name) nameInput.value = name;
      }
    });

    function hideOnlineStartOverlays() {
      for (const id of ['ov-create-room', 'ov-waiting-room', 'ov-join-code', 'ov-matchmaking', 'ov-partner-search']) {
        globalThis.document?.getElementById?.(id)?.classList?.add?.('hidden');
      }
    }

    bus.on(SETUP_INTENT.PLAY_CLICKED, ({ mode, p1Name, p2Name, difficulty, botTime = 40, showBothRacks = false }) => {
      settingsCompat.mergeUiPreferences(globalThis.localStorage, { lastDisplayName: p1Name });
      const isBot = mode === 'bot';
      const startingSlot = Math.random() < 0.5 ? 0 : 1;
      const display2 = isBot ? 'המחשב' : p2Name;
      const offEnter = bus.on(COIN_INTENT.ENTER, () => {
        offEnter();
        startGameViaSpine({
          mode: isBot ? 'offline-solo' : 'offline-2p',
          bot:  isBot,
          difficulty,
          p1Name, p2Name,
          startingSlot,
          settings: { timelimit: true, botTime, showBothRacks },
        });
      });
      showLegacyScreen('scoin');
      bus.emit(COIN_OPEN, { startingSlot, p1Name, p2Name: display2 });
    });
  console.info('[spine] games route active — START_2P / START_VS_BOT route through #ss setup');

  // ─── Joker picker wiring ──────────────────────────────
  // The active gameScreen subscribes to JOKER_INTENT.PICKED directly when
  // a `?` rack tile is clicked. This top-level handler just logs.
  bus.on(JOKER_INTENT.PICKED, ({ letter }) => {
    console.info('[joker] picked', letter);
  });

  // In-game overlay intent wiring is owned by gameFlowController below.

  // ─── Online matchmaking integration ───────────────────
  // Online lobby/search/create/join/invite/async flows are spine-owned.
    let activeMatchmaking = null;

    bus.on(MM_INTENT.SEARCH, async (filters) => {
      try { await ensureAuthedUser(); }
      catch (e) { console.warn('[spine] MM_INTENT.SEARCH auth failed:', e?.message ?? e); }
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid) {
        console.warn('[spine] online requested but Firebase is not initialised');
        return;
      }
      if (activeMatchmaking) await activeMatchmaking.cancel();

      const profile = lastProfile ?? globalThis.currentUserProfile ?? {};
      const rating = (profile.rating != null) ? profile.rating : 1000;
      const displayName =
        filters?.name ?? fbUser.displayName ?? profile.displayName ?? 'שחקן';
      if (displayName) settingsCompat.mergeUiPreferences(globalThis.localStorage, { lastDisplayName: displayName });

      // Hide search form, show partner-search overlay with slot animation.
      globalThis.document?.getElementById?.('ov-matchmaking')?.classList?.add?.('hidden');
      bus.emit(PS_INTENT.SHOW, {
        name:   displayName,
        avatar: avatarEmoji(profile.equippedAvatar) || '👑',
      });

      activeMatchmaking = startMatchmaking({
        db: fbDb,
        uid: fbUser.uid,
        mode: filters.spineMode,
        profile: {
          displayName,
          avatar: fbUser.photoURL ?? profile.avatar ?? null,
          rating,
        },
        settings: {
          ...settingsCompat.settingsFromLegacyGlobals(globalThis),
          timelimit: filters.timelimit,
          botTime: filters.botTime ?? 40,
          strict: filters.strict,
          ratingRange: filters.ratingRange,
        },
      });
      activeMatchmaking.onMatched(async ({ room, mySlot }) => {
        const fullRoom = await roomService.readRoom(fbDb, room.roomId);
        if (!fullRoom) return;
        const opponentSlot = 1 - mySlot;
        const opponent = fullRoom.players?.[opponentSlot];
        bus.emit(PS_INTENT.MATCHED, {
          name:   opponent?.displayName ?? 'שחקן',
          avatar: avatarEmoji(opponent?.avatar) || '👑',
        });
        // Brief pause so the player sees the matched opponent before game starts.
        await new Promise(r => setTimeout(r, 1400));
        bus.emit(PS_INTENT.HIDE, {});
        startOnlineGameViaSpine({ db: fbDb, room: fullRoom, mySlot });
      });
      globalThis.__spine.activeMatchmaking = activeMatchmaking;
      console.info('[spine] online matchmaking started', {
        mode: filters.spineMode,
        timelimit: filters.timelimit,
        ratingRange: filters.ratingRange,
        strict: filters.strict,
      });
    });

    bus.on(MM_INTENT.CANCEL, async () => {
      if (activeMatchmaking) {
        try { await activeMatchmaking.cancel(); } catch (e) { console.error('[spine] mm cancel', e); }
        activeMatchmaking = null;
        globalThis.__spine.activeMatchmaking = null;
      }
      bus.emit(PS_INTENT.HIDE, {});
      globalThis.document?.getElementById?.('ov-matchmaking')?.classList?.add?.('hidden');
    });

    // ── Create-room (shareable code) flow ──────────────
    // Host clicks "create" → roomCodeService writes a /pendingRooms/{code}
    // entry → we open #ov-waiting-room with the code → watchPending tells
    // us when a guest claims (entry disappears + that guest's
    // /users/{uid}/activeRoom points at the new real room → host's
    // activeRoom listener mounts the game).
    let activePending = null; // { code, offWatch, offActiveRoom }

    async function teardownPending() {
      if (!activePending) return;
      try { activePending.offWatch?.(); }       catch {}
      try { activePending.offActiveRoom?.(); }  catch {}
      activePending = null;
      globalThis.__spine.activePending  = null;
      globalThis.__spine.teardownPending = teardownPending;
    }
    globalThis.__spine.teardownPending = teardownPending;

    bus.on(CR_INTENT.CONFIRM, async (filters) => {
      try { await ensureAuthedUser(); }
      catch (e) { console.warn('[spine] CR_INTENT.CONFIRM auth failed:', e?.message ?? e); }
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid) {
        console.warn('[spine] CR_INTENT.CONFIRM but Firebase not initialised');
        return;
      }
      await teardownPending();

      const profile = lastProfile ?? globalThis.currentUserProfile ?? {};
      const hostProfile = {
        displayName: filters?.name ?? fbUser.displayName ?? profile.displayName ?? 'שחקן 1',
        avatar:      fbUser.photoURL ?? profile.avatar ?? null,
        rating:     (profile.rating != null) ? profile.rating : 1000,
      };
      settingsCompat.mergeUiPreferences(globalThis.localStorage, { lastDisplayName: hostProfile.displayName });

      let result;
      try {
        result = await roomCodeService.createPending(fbDb, {
          hostUid: fbUser.uid,
          hostProfile,
          mode: filters.spineMode,
          settings: {
            ...settingsCompat.settingsFromLegacyGlobals(globalThis),
            timelimit: filters.timelimit,
            botTime: filters.botTime ?? 40,
          },
        });
      } catch (e) {
        console.error('[spine] createPending failed', e);
        return;
      }
      const { code } = result;

      // Open the waiting-room overlay. Capture friend target BEFORE emitting so
      // the overlay starts in friend-mode immediately (no flash of code UI).
      const friendNameForWr = pendingFriendTarget?.name ?? null;
      globalThis.document?.getElementById?.('ov-create-room')?.classList?.add?.('hidden');
      bus.emit(WR_OPEN, { code, mode: filters.spineMode, friendName: friendNameForWr });

      // If triggered from the friend detail overlay, auto-send invite to that friend.
      if (pendingFriendTarget) {
        const ft = pendingFriendTarget;
        pendingFriendTarget = null;
        try {
          const invMode  = filters.spineMode ?? 'friend-live';
          const settings = { ...settingsCompat.settingsFromLegacyGlobals(globalThis), timelimit: filters.timelimit, botTime: filters.botTime ?? 40 };
          const myName   = globalThis.__spine?.currentProfile?.displayName ?? fbUser.displayName ?? 'שחקן';
          const { inviteId, expiresAt } = await inviteService.sendInvite(fbDb, {
            fromUid:    fbUser.uid,
            fromName:   myName,
            fromAvatar: fbUser.photoURL ?? null,
            toUid:      ft.uid,
            mode:       invMode,
            settings,
            serverTimestamp: Date.now(),
          });
          notificationService?.pushInvite?.({
            inviteeUid:  ft.uid,
            inviterName: myName,
            roomId:      null,
          })?.catch(() => {});
          if (activePending) {
            activePending.inviteId    = inviteId;
            activePending.inviteToUid = ft.uid;
          }
          bus.emit(WR_LIVE_INVITE_SENT, { expiresAt, friendName: ft.name });
        } catch (e) {
          console.warn('[spine] friend auto-invite failed', e);
        }
      }

      // When a guest claims the code, claimByCode creates the real room
      // AND sets /users/{hostUid}/activeRoom to the new roomId. That
      // listener is our signal to mount the game.
      const activeRoomHandler = async (snap) => {
        const roomId = snap?.val ? snap.val() : null;
        if (!roomId || !activePending || activePending.code !== code) return;
        const room = await roomService.readRoom(fbDb, roomId);
        if (!room) return;
        const mySlot = room.players?.[0]?.uid === fbUser.uid ? 0 : 1;
        bus.emit(WR_CLOSE, {});
        hideOnlineStartOverlays();
        await teardownPending();
        startOnlineGameViaSpine({ db: fbDb, room, mySlot });
      };
      fbDb.ref(`users/${fbUser.uid}/activeRoom`).on('value', activeRoomHandler);

      activePending = {
        code,
        mode: filters.spineMode,
        offWatch: roomCodeService.watchPending(fbDb, code, () => {}),
        offActiveRoom: () => fbDb.ref(`users/${fbUser.uid}/activeRoom`).off('value', activeRoomHandler),
      };
      globalThis.__spine.activePending = activePending;
      console.info('[spine] create-room: pending code', code, 'mode', filters.spineMode);
    });

    bus.on(CR_INTENT.CANCEL, () => {
      // No pending entry yet (the user cancelled before pressing create);
      // nothing to undo.
      globalThis.document?.getElementById?.('ov-create-room')?.classList?.add?.('hidden');
    });

    bus.on(WR_INTENT.CANCEL, async () => {
      const fbDb    = activeFbDb;
      const code    = activePending?.code;
      const inviteId  = activePending?.inviteId;
      const invToUid  = activePending?.inviteToUid;
      await teardownPending();
      if (fbDb && code) {
        try { await roomCodeService.cancelPending(fbDb, code); }
        catch (e) { console.error('[spine] cancelPending', e); }
      }
      if (fbDb && inviteId && invToUid) {
        try { await inviteService.cancelInvite(fbDb, { toUid: invToUid, inviteId }); }
        catch (e) { console.warn('[spine] WR cancel: cancelInvite', e); }
      }
      bus.emit(WR_CLOSE, {});
    });

    bus.on(WR_INTENT.SHARE_WHATSAPP, () => {
      const code = activePending?.code;
      if (!code) return;
      const url = buildWhatsAppShareUrl(code);
      try { globalThis.window?.open?.(url, '_blank'); } catch (e) { console.error('[spine] wa share', e); }
    });

    // Live invite expired: cancel pending room + invite on Firebase, close overlay.
    bus.on(WR_INTENT.LIVE_INVITE_EXPIRED, async () => {
      const fbDb     = activeFbDb;
      const code     = activePending?.code;
      const inviteId = activePending?.inviteId;
      const invToUid = activePending?.inviteToUid;
      await teardownPending();
      if (fbDb && code) {
        try { await roomCodeService.cancelPending(fbDb, code); }
        catch (e) { console.warn('[spine] live invite expiry: cancelPending', e); }
      }
      if (fbDb && inviteId && invToUid) {
        try { await inviteService.cancelInvite(fbDb, { toUid: invToUid, inviteId }); }
        catch (e) { console.warn('[spine] live invite expiry: cancelInvite', e); }
      }
      bus.emit(WR_CLOSE, {});
    });

    // ── Join-by-code flow ──────────────────────────────
    bus.on(JC_INTENT.CONFIRM, async ({ code, name }) => {
      try { await ensureAuthedUser(); }
      catch (e) { console.warn('[spine] JC_INTENT.CONFIRM auth failed:', e?.message ?? e); }
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid) {
        console.warn('[spine] JC_INTENT.CONFIRM but Firebase not initialised');
        bus.emit(JC_INTENT.ERROR, { reason: 'connection', message: 'נדרשת התחברות — נסה שוב' });
        return;
      }
      const profile = lastProfile ?? globalThis.currentUserProfile ?? {};
      const guestProfile = {
        displayName: name ?? fbUser.displayName ?? profile.displayName ?? 'שחקן 2',
        avatar:      fbUser.photoURL ?? profile.avatar ?? null,
        rating:     (profile.rating != null) ? profile.rating : 1000,
      };
      settingsCompat.mergeUiPreferences(globalThis.localStorage, { lastDisplayName: guestProfile.displayName });

      let result;
      try {
        result = await roomCodeService.claimByCode(fbDb, {
          code, guestUid: fbUser.uid, guestProfile,
        });
      } catch (e) {
        console.error('[spine] claimByCode threw', e);
        bus.emit(JC_INTENT.ERROR, { reason: 'connection', message: 'שגיאת חיבור — נסה שוב' });
        return;
      }
      if (!result.ok) {
        bus.emit(JC_INTENT.ERROR, { reason: result.reason });
        return;
      }
      const room = await roomService.readRoom(fbDb, result.roomId);
      if (!room) {
        bus.emit(JC_INTENT.ERROR, { reason: 'connection' });
        return;
      }
      const mySlot = room.players?.[1]?.uid === fbUser.uid ? 1 : 0;
      // Hide the overlay if legacy didn't already
      hideOnlineStartOverlays();
      startOnlineGameViaSpine({ db: fbDb, room, mySlot });
    });

    bus.on(JC_INTENT.CANCEL, () => {
      globalThis.document?.getElementById?.('ov-join-code')?.classList?.add?.('hidden');
    });

    // ── Friend-targeted invite flow ────────────────────
    // Subscribe to incoming invites once Firebase auth is up. The legacy
    // path also writes invites under a different schema (window invites
    // path); the new spine path uses inviteService.listenForInvites which
    // reads `${PATH.invites}/{toUid}`.
    let activeInviteListener = null;
    let activeAckListener = null;
    let lastInviteCount = 0;
    let lastFriendRequestCount = 0;
    function refreshBadgeCount() {
      bus.emit(MENU_REFRESH, { unreadCount: lastInviteCount + lastFriendRequestCount });
    }
    function bootInviteListenersFor(uid) {
      if (!uid) return;
      activeInviteListener?.();
      activeAckListener?.();
      const fbDb = activeFbDb;
      if (!fbDb) return;

      // Track which invites have already triggered a banner so we never
      // show the banner for the same invite twice, and suppress it entirely
      // on the first Firebase snapshot (existing invites on app open).
      const seenIds = new Set();
      let isFirstFire = true;

      activeInviteListener = inviteService.listenForInvites(fbDb, uid, (invites) => {
        const now = Date.now();
        const pending = (invites ?? []).filter(
          i => i.status === 'pending' && (!i.expiresAt || i.expiresAt > now),
        );
        lastInviteCount = pending.length;
        bus.emit(NOTIF_RENDER, { invites: pending });
        refreshBadgeCount();

        if (!isFirstFire && pending.length) {
          // Find the first invite the user hasn't been notified about yet.
          const next = pending.find(i => !seenIds.has(i.inviteId));
          if (next) {
            bus.emit(NOTIF_BANNER_SHOW, {
              avatar: next.fromAvatar || '🎮',
              text:   `${next.fromName ?? 'שחקן'} מזמין אותך למשחק`,
              action: 'openNotifications',
            });
            // Browser-notification fallback for background tabs.
            browserNotificationFallback.showBrowserNotification({
              title: 'הזמנה למשחק',
              body:  `${next.fromName ?? 'שחקן'} מזמין אותך למשחק`,
              data:  { type: 'invite' },
              swRegistration: globalThis.navigator?.serviceWorker?.ready ?? null,
              onClick: handleBrowserNotificationClick,
            }).catch(() => { /* swallow */ });
          }
        }

        for (const inv of pending) seenIds.add(inv.inviteId);
        isFirstFire = false;
      });

      // Tracks acks already processed so stale data from a previous session
      // doesn't re-fire a banner every time the user signs in.
      const seenAckKeys  = new Set();
      let isFirstFireAck = true;

      activeAckListener = inviteService.listenForInviteAcks(fbDb, uid, async (acks) => {
        const allAcks = acks ?? [];
        const keys    = allAcks.map(a => `${a.toUid}:${a.inviteId ?? ''}`);

        // First snapshot: mark everything as seen, don't act.
        if (isFirstFireAck) {
          for (const k of keys) seenAckKeys.add(k);
          isFirstFireAck = false;
          return;
        }

        const freshAcks = allAcks.filter(a => !seenAckKeys.has(`${a.toUid}:${a.inviteId ?? ''}`));
        for (const k of keys) seenAckKeys.add(k);
        if (!freshAcks.length) return;

        const last = freshAcks.at(-1);
        if (last && last.accepted === true && last.roomId) {
          resumeOnlineRoomById(last.roomId, { skipCoin: false }).catch((e) => {
            console.warn('[spine] invite accepted resume', e);
          });
          return;
        }
        if (last && last.accepted === false) {
          // Close the waiting room if this rejection matches the invite we sent.
          const pendingInviteId = activePending?.inviteId;
          if (pendingInviteId && last.inviteId === pendingInviteId) {
            const localFbDb   = activeFbDb;
            const pendingCode = activePending?.code;
            teardownPending().catch(() => {});
            if (localFbDb && pendingCode) {
              roomCodeService.cancelPending(localFbDb, pendingCode)
                .catch(e => console.warn('[spine] reject: cancelPending', e));
            }
            bus.emit(WR_CLOSE, {});
          }
          bus.emit(NOTIF_BANNER_SHOW, {
            avatar: '✋',
            text:   last.fromName ? `${last.fromName} דחה את ההזמנה` : 'ההזמנה נדחתה',
            action: 'dismiss',
          });
        }
      });
    }
    // Expose so legacy/auth code can call it post-sign-in.
    globalThis.__spine.bootInviteListeners = bootInviteListenersFor;
    if (activeFbCurrentUser?.uid) bootInviteListenersFor(activeFbCurrentUser.uid);

    bus.on(II_INTENT.ACCEPT, async (invite) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !invite?.inviteId) {
        bus.emit(II_CLOSE, {});
        return;
      }
      const accepterProfile = {
        displayName: fbUser.displayName ?? globalThis.currentUserProfile?.displayName ?? 'שחקן 2',
        avatar: fbUser.photoURL ?? globalThis.currentUserProfile?.avatar ?? null,
      };
      try {
        const result = await inviteService.acceptInvite(fbDb, {
          toUid: fbUser.uid, inviteId: invite.inviteId, accepterProfile,
        });
        if (result?.ok && result.roomId) {
          try {
            await notificationService.pushInviteAccepted({
              inviterUid: invite.fromUid,
              accepterName: accepterProfile.displayName,
              roomId: result.roomId,
            });
          } catch (e) { console.warn('[spine] invite accepted push', e); }
          const room = await roomService.readRoom(fbDb, result.roomId);
          if (room) startOnlineGameViaSpine({ db: fbDb, room, mySlot: 1 });
        }
      } catch (e) { console.error('[spine] acceptInvite', e); }
      bus.emit(II_CLOSE, {});
    });

    bus.on(II_INTENT.REJECT, async (invite) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (fbDb && fbUser?.uid && invite?.inviteId && invite?.fromUid) {
        try {
          await inviteService.rejectInvite(fbDb, {
            fromUid: invite.fromUid,
            toUid: fbUser.uid,
            inviteId: invite.inviteId,
            fromName: globalThis.__spine?.currentProfile?.displayName ?? fbUser.displayName ?? 'שחקן',
            serverTimestamp: Date.now(),
          });
          await notificationService.pushInviteRejected({
            inviterUid: invite.fromUid,
            rejecterName: globalThis.__spine?.currentProfile?.displayName ?? fbUser.displayName ?? 'שחקן',
          });
        } catch (e) { console.error('[spine] rejectInvite', e); }
      }
      bus.emit(II_CLOSE, {});
    });

    // IR_INTENT.CLOSE and IR_CLOSE share the same string value, so the overlay's
    // own bus.on(IR_CLOSE) handler already fires when the close button emits
    // IR_INTENT.CLOSE — no forwarding needed here, and adding one would cause
    // infinite recursion.

    // ── Async session list + resume + reminder/expiry + turn banner ──
    // Watches the per-user async-room index. Re-paints `#online-sessions-wrap`
    // and fires the turn banner whenever the index changes.
    let activeSessionsWatch = null;
    let lastSessions = [];

    function bootAsyncSessionsFor(uid) {
      if (!uid || !activeFbDb) return;
      try { activeSessionsWatch?.(); } catch {}
      activeSessionsWatch = asyncSessionService.watchAsyncSessions(activeFbDb, uid, (sessions) => {
        lastSessions = sessions;
        bus.emit(AS_RENDER, { sessions });
        // Refresh menu's "you have N async games" badge.
        bus.emit(MENU_REFRESH, {
          hasOnlineUnread: sessions.some(s => s.isMyTurn),
          hasSavedGame: sessions.length > 0,
        });
        // In-app banner (deduped) for my-turn games.
        const bannerResult = asyncTurnBanner.maybeShow({ uid, sessions });
        // Browser-notification fallback. The banner already dedupes within
        // 60s by session signature; when it fires, we also try the legacy
        // hidden-tab browser notification. Tag-based dedup at the OS level
        // means re-firing for the same roomCode just replaces the prior
        // notification. We fire one per my-turn room so clicking jumps to
        // that specific game.
        if (bannerResult?.shown) {
          const sw = globalThis.navigator?.serviceWorker?.ready ?? null;
          for (const s of sessions.filter(x => x.isMyTurn)) {
            const opp = s.opponentName ?? 'יריב';
            browserNotificationFallback.showBrowserNotification({
              title: 'תורך בבוסט!',
              body: `${opp} סיים מהלך. עכשיו תורך.`,
              data: { type: 'turn', roomCode: s.roomId },
              swRegistration: sw,
              onClick: handleBrowserNotificationClick,
            }).catch(() => { /* swallow */ });
          }
        }
      });
      // Run the reminder/expiry sweep opportunistically.
      asyncReminderService.sweepForUser(activeFbDb, uid, {
        pushSender: async ({ kind, toUids, ctx }) => {
          if (kind === 'reminder' && toUids?.[0]) {
            try {
              await notificationService.pushReminder({
                recipientUid: toUids[0],
                opponentName: ctx?.opponentName ?? 'יריב',
                roomId: ctx?.roomId,
                hoursIdle: ctx?.hoursIdle,
              });
            }
            catch (e) { console.warn('[spine] reminder send', e); }
          }
          // KIND.EXPIRED / KIND.REMINDER are also exposed via the lower-level
          // pushPayloadBuilder; for now we just log expired since the user
          // sees the room disappear from the list anyway.
          if (kind === 'expired' && toUids?.[0]) {
            try { await notificationService.pushExpired({ recipientUid: toUids[0], roomId: ctx?.roomId }); }
            catch (e) { console.warn('[spine] expired send', e); }
          }
        },
      }).catch((e) => console.warn('[spine] async sweep failed', e));
    }
    globalThis.__spine.bootAsyncSessions = bootAsyncSessionsFor;
    if (activeFbCurrentUser?.uid) bootAsyncSessionsFor(activeFbCurrentUser.uid);

    // Resume from list / dismiss from list / resume from menu button.
    async function resumeRoomById(roomId) {
      return resumeOnlineRoomById(roomId, { skipCoin: false });
    }

    bus.on(AS_INTENT.RESUME,  ({ roomId }) => { resumeRoomById(roomId); });
    bus.on(AS_INTENT.DISMISS, async ({ roomId }) => {
      const uid = activeFbCurrentUser?.uid;
      if (!uid || !activeFbDb) return;
      try { await asyncSessionService.dismissForUid(activeFbDb, uid, roomId); }
      catch (e) { console.warn('[spine] dismiss', e); }
    });

    // Menu's "resume" button: prefer the most recent my-turn async game,
    // otherwise the user's single /users/{uid}/activeRoom.
    bus.on(MENU_INTENT.RESUME_SAVED, async () => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid) return;
      const myTurn = lastSessions.find(s => s.isMyTurn);
      if (myTurn) { resumeRoomById(myTurn.roomId); return; }
      if (lastSessions[0]) { resumeRoomById(lastSessions[0].roomId); return; }
      try {
        const snap = await fbDb.ref(`users/${fbUser.uid}/activeRoom`).get();
        const rid = snap?.val ? snap.val() : null;
        if (rid) resumeRoomById(rid);
      } catch (e) { console.warn('[spine] resume', e); }
    });

    // Async-mode home button: leave without resigning. Tear down the
    // active game UI and return to menu; the spine session is disposed,
    // but the room in Firebase stays put so the player can resume.
    bus.on(AH_INTENT.GO_HOME, () => {
      const ag = globalThis.__spine?.activeGame;
      if (ag) {
        try { ag.end?.(); } catch (e) { console.warn('[spine] async-home end', e); }
      }
      showLegacyScreen('sh');
      bus.emit(AH_HIDE, {});
    });

  console.info('[spine] online route active');

  // ── Account / profile / friends / rating ──────────────
  // Dictionary query / suggestions / admin review.
  let dictAdminAuthed = false;
  let dictAdminSuggestions = [];
  const dictRecentlyProcessedWords = new Set();

  bus.on(DICT_INTENT.CHECK_QUERY, async ({ word, target = 'main' } = {}) => {
    if (!word) {
      bus.emit(DICT_RENDER.QUERY_RESULT, { target, reason: 'empty' });
      return;
    }
    if (hebrewDictionary.DICT.size === 0) {
      try { await ensureDictionaryLoaded(); }
      catch {
        bus.emit(DICT_RENDER.QUERY_RESULT, { target, word, reason: 'loading' });
        return;
      }
    }
    bus.emit(DICT_RENDER.QUERY_RESULT, {
      target,
      word,
      valid: hebrewDictionary.isValid(word),
    });
  });

  bus.on(DICT_INTENT.SUBMIT_SUGGEST, async ({ words = [] } = {}) => {
    if (!words.length) {
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'נא להזין מילה להצעה', isError: true });
      return;
    }
    // Firebase rule on `dictionarySuggestions` requires auth != null. Catch
    // the unauthenticated case here so the player sees a clear Hebrew
    // message rather than a silent PERMISSION_DENIED in the console.
    if (!activeFbCurrentUser?.uid) {
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, {
        message: 'יש להתחבר כדי לשלוח הצעת מילה',
        isError: true,
      });
      return;
    }
    bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'שולח...', isError: false });
    try {
      const db = await getDictionaryDb();
      const result = await dictionaryService.submitDictionarySuggestions(db, {
        words,
        serverTimestamp: () => firebaseTimestamp(),
      });
      if (!result.ok) {
        const first = words[0] ?? '';
        bus.emit(DICT_RENDER.SUGGESTION_STATUS, {
          message: words.length === 1 ? `"${first}" נדחתה או אושרה בעבר` : 'כל המילים כבר טופלו בעבר',
          isError: true,
        });
        return;
      }
      const skipped = result.skipped?.length ?? 0;
      let message = result.submitted.length === 1
        ? `"${result.submitted[0]}" נשלחה לבדיקה ✓`
        : `נשלחו ${result.submitted.length} מילים לבדיקה ✓`;
      if (skipped > 0) message += ` (${skipped} דולגו)`;
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message, isError: false });
      const input = globalThis.document?.getElementById?.('dict-word-input');
      if (input) input.value = '';
    } catch (e) {
      console.warn('[spine] dictionary suggest', e);
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'שליחת ההצעה נכשלה', isError: true });
    }
  });

  bus.on(DICT_INTENT.ADMIN_SIGN_IN, async ({ password = '' } = {}) => {
    if (!password) {
      bus.emit(DICT_RENDER.ADMIN_LOGIN_ERROR, { message: 'נא להזין סיסמה' });
      return;
    }
    const ok = await verifyDictionaryAdminPassword(password);
    if (!ok) {
      bus.emit(DICT_RENDER.ADMIN_LOGIN_ERROR, { message: 'סיסמה שגויה' });
      return;
    }
    dictAdminAuthed = true;
    bus.emit(DICT_RENDER.ADMIN_OPEN, {});
    await refreshDictionaryAdminSuggestions();
  });

  bus.on(DICT_INTENT.ADMIN_SIGN_OUT, () => {
    dictAdminAuthed = false;
    dictAdminSuggestions = [];
    dictRecentlyProcessedWords.clear();
    bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'המנהל נותק', isError: false });
  });

  bus.on(DICT_INTENT.ADMIN_APPROVE, ({ ids = [] } = {}) => {
    if (ids.length) bus.emit(DICT_RENDER.ADMIN_CONFIRM, { action: 'approve', count: ids.length });
  });
  bus.on(DICT_INTENT.ADMIN_REJECT, ({ ids = [] } = {}) => {
    if (ids.length) bus.emit(DICT_RENDER.ADMIN_CONFIRM, { action: 'reject', count: ids.length });
  });
  bus.on(DICT_INTENT.ADMIN_CONFIRM, async ({ action, ids = [] } = {}) => {
    if (!dictAdminAuthed) {
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'אין הרשאת מנהל', isError: true });
      return;
    }
    try {
      const db = await getDictionaryDb();
      const result = await dictionaryService.applyDictionaryDecision(db, {
        action,
        ids,
        suggestions: dictAdminSuggestions,
        serverTimestamp: () => firebaseTimestamp(),
      });
      if (!result.ok) {
        bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'הפעולה נכשלה', isError: true });
        return;
      }
      for (const word of result.words) {
        dictRecentlyProcessedWords.add(word);
        if (action === 'approve') hebrewDictionary.DICT.add(word);
      }
      if (globalThis.HebrewValidator && action === 'approve') globalThis.HebrewValidator.init?.(hebrewDictionary.DICT);
      dictAdminSuggestions = dictAdminSuggestions.filter((s) => !result.words.includes(s.word));
      bus.emit(DICT_RENDER.ADMIN_RENDER, { suggestions: dictAdminSuggestions });
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, {
        message: action === 'approve' ? `אושרו ${result.changed} מילים ✓` : `נדחו ${result.changed} מילים`,
        isError: false,
      });
      await refreshDictionaryAdminSuggestions();
    } catch (e) {
      console.warn('[spine] dictionary decision', e);
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'הפעולה נכשלה', isError: true });
    }
  });

  async function refreshDictionaryAdminSuggestions() {
    if (!dictAdminAuthed) return;
    try {
      const db = await getDictionaryDb();
      dictAdminSuggestions = await dictionaryService.listPendingDictionarySuggestions(db, {
        recentlyProcessed: dictRecentlyProcessedWords,
      });
      bus.emit(DICT_RENDER.ADMIN_RENDER, { suggestions: dictAdminSuggestions });
    } catch (e) {
      console.warn('[spine] dictionary admin refresh', e);
      bus.emit(DICT_RENDER.SUGGESTION_STATUS, { message: 'טעינת הצעות נכשלה', isError: true });
    }
  }

  async function getDictionaryDb() {
    if (activeFbDb) return activeFbDb;
    await ensureFirebaseGlobals();
    return activeFbDb ?? await firebaseClient.getDb();
  }

  function firebaseTimestamp() {
    return activeFbServerTimestamp?.() ?? Date.now();
  }

  async function verifyDictionaryAdminPassword(password) {
    const adminHash = '67bee854bb6636e19557e79d9a160dbd60f794210c65f9d7647dd8d0e608c2ae';
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj?.subtle || typeof TextEncoder === 'undefined') return false;
    const msgBuffer = new TextEncoder().encode(String(password));
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('') === adminHash;
  }

  // Merge admin-approved words from Firebase into the local dictionary.
  // Must wait for BOTH Firebase init (otherwise activeFbDb is null) AND the
  // base-dictionary load (otherwise HebrewValidator re-init would race the
  // first 40k words in). The previous version used setTimeout(0) and gave
  // up when activeFbDb hadn't resolved yet, which left every admin-added
  // word stranded in /dictionaryApproved.
  (async () => {
    try {
      await firebaseReady;
      await ensureDictionaryLoaded();
      const db = activeFbDb;
      if (!db) return;
      const count = await dictionaryService.syncApprovedDictionaryWordsOnce(db, hebrewDictionary.DICT);
      if (count > 0) {
        console.info('[spine] approved dictionary merged:', count, 'new size:', hebrewDictionary.DICT.size);
        if (globalThis.HebrewValidator) globalThis.HebrewValidator.init?.(hebrewDictionary.DICT);
      }
    } catch (e) {
      console.warn('[spine] approved dictionary sync', e);
    }
  })();

  // Account/profile/friends/rating flows are spine-owned.
    let activeProfileWatch = null;
    let activeRequestsWatch = null;
    let activeFriendsWatch = null;
    let lastProfile = null;
    let lastFriends = [];
    let lastRequests = [];
    let pendingFriendTarget = null; // set by INVITE_FRIEND, consumed by CR_INTENT.CONFIRM

    function bootProfileFor(uid) {
      const fbDb = activeFbDb;
      if (!fbDb || !uid) return;
      try { activeProfileWatch?.();  } catch {}
      try { activeRequestsWatch?.(); } catch {}
      try { activeFriendsWatch?.();  } catch {}

      activeProfileWatch = profileService.watchProfile(fbDb, uid, (profile) => {
        const prev = lastProfile;
        // Detect new avatar unlocks before we overwrite lastProfile
        if (prev?.stats && profile?.stats) {
          const newly = diffNewlyUnlocked(prev.stats, profile.stats);
          for (const a of newly) bus.emit(AV_UNLOCK_OPEN, { avatar: a });
        }
        lastProfile = profile;
        globalThis.__spine.currentProfile = profile;
        const fbUser = activeFbCurrentUser;
        const _dn = profile?.displayName ?? fbUser?.displayName;
        if (_dn) settingsCompat.mergeUiPreferences(globalThis.localStorage, { lastDisplayName: _dn });
        bus.emit(PROFILE_RENDER, {
          profile,
          isAnonymous: !!fbUser?.isAnonymous,
          email: fbUser?.email ?? '',
        });
        bus.emit(MENU_REFRESH, {
          isAuthed: !!fbUser?.uid && !fbUser?.isAnonymous,
          displayName: profile?.displayName ?? fbUser?.displayName ?? '',
          rating: profile?.rating ?? null,
          avatar: avatarEmoji(profile?.equippedAvatar) || null,
        });
        bus.emit(AV_RENDER, {
          stats: profile?.stats ?? {},
          equippedAvatar: profile?.equippedAvatar ?? null,
        });
        bus.emit(FRIENDS_RENDER, {
          myUserId: profile?.userId ?? '------',
        });
        if (profile) {
          ratingService.upsertRatingLeaderboardEntry(fbDb, {
            uid,
            profile,
            rating: profile.rating,
            updatedAt: profile.lastRatedAt ?? Date.now(),
          }).catch((e) => console.warn('[spine] rating leaderboard sync', e));
        }
      });

      activeRequestsWatch = friendsService.watchIncomingRequests(fbDb, uid, (reqs) => {
        lastRequests = reqs;
        lastFriendRequestCount = reqs.length;
        bus.emit(FRIENDS_RENDER, { requests: reqs });
        bus.emit(NOTIF_RENDER, { friendRequests: reqs });
        refreshBadgeCount();
      });
      activeFriendsWatch = friendsService.watchFriends(fbDb, uid, async (friends) => {
        lastFriends = friends;
        try {
          const enriched = await Promise.all(friends.map(async (f) => {
            const [presence, profile] = await Promise.all([
              presenceService.readPresenceOnce(fbDb, f.uid).catch(() => null),
              profileService.readProfile(fbDb, f.uid).catch(() => null),
            ]);
            return {
              ...f,
              connected: !!presence?.connected,
              lastSeen: presence?.lastSeen ?? f.addedAt ?? 0,
              rating: profile?.rating ?? null,
            };
          }));
          enriched.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
          bus.emit(FRIENDS_RENDER, { friends: enriched });
        } catch {
          bus.emit(FRIENDS_RENDER, { friends });
        }
      });
    }
    globalThis.__spine.bootAccount = bootProfileFor;
    if (activeFbCurrentUser?.uid) bootProfileFor(activeFbCurrentUser.uid);

    // ── Profile intents ──
    bus.on(PROFILE_INTENT.OPEN_AVATARS, () => {
      showLegacyScreen('sav-gallery');
    });
    bus.on(PROFILE_INTENT.OPEN_FRIENDS, () => {
      showLegacyScreen('sfriends');
    });
    bus.on(PROFILE_INTENT.OPEN_STATS, () => {
      showLegacyScreen('sstats');
      statsScreen.refresh?.();
    });
    bus.on(STATS_INTENT.BACK, () => {
      showLegacyScreen('sprofile');
    });
    bus.on(STATS_INTENT.REFRESH, () => {
      if (lastProfile) {
        const fbUser = activeFbCurrentUser;
        bus.emit(PROFILE_RENDER, {
          profile: lastProfile,
          isAnonymous: !!fbUser?.isAnonymous,
          email: fbUser?.email ?? '',
        });
      }
    });
    bus.on(PROFILE_INTENT.BACK, () => {
      showLegacyScreen('sh');
    });
    bus.on(PROFILE_INTENT.UPGRADE_ACCOUNT, () => {
      showLegacyScreen('sauth-signup');
    });
    bus.on(PROFILE_INTENT.CANCEL_EDIT_NAME, () => {
      const edit = globalThis.document?.getElementById?.('profile-name-edit');
      if (edit) edit.style.display = 'none';
      profileScreen.showError('');
    });
    bus.on(PROFILE_INTENT.SAVE_NAME, async () => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      const newName = (globalThis.document?.getElementById?.('profile-name-input')?.value ?? '').trim();
      if (!newName) {
        profileScreen.showError('נא להזין שם');
        return;
      }
      if (!fbDb || !fbUser?.uid) return;
      const r = await profileService.claimUsername(fbDb, {
        uid: fbUser.uid,
        oldName: lastProfile?.displayName ?? null,
        newName,
      });
      if (!r.ok) profileScreen.showError(r.reason === 'taken' ? 'השם תפוס' : 'שגיאה');
      else {
        const edit = globalThis.document?.getElementById?.('profile-name-edit');
        if (edit) edit.style.display = 'none';
        profileScreen.showError('');
      }
    });

    // ── Avatar intents ──
    bus.on(AV_INTENT.EQUIP, async ({ id }) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !id) return;
      try { await profileService.updateProfile(fbDb, fbUser.uid, { equippedAvatar: id }); }
      catch (e) { console.warn('[spine] avatar equip', e); }
    });
    bus.on(AV_INTENT.CLOSE, () => {
      showLegacyScreen('sprofile');
    });

    // ── Friends intents ──
    bus.on(FRIENDS_INTENT.SEND_REQUEST, async ({ userId }) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !userId) return;
      const targetUid = await profileService.lookupUidByUserId(fbDb, userId);
      if (!targetUid) {
        bus.emit(FRIENDS_RENDER, { addStatus: 'מזהה לא נמצא' });
        return;
      }
      const r = await friendsService.sendFriendRequest(fbDb, {
        fromUid: fbUser.uid, toUid: targetUid,
        fromName: lastProfile?.displayName ?? '',
        fromAvatar: lastProfile?.equippedAvatar ?? null,
      });
      if (r.ok) bus.emit(FRIENDS_RENDER, { addStatus: 'בקשה נשלחה' });
      else if (r.reason === 'self') bus.emit(FRIENDS_RENDER, { addStatus: 'אי אפשר להוסיף את עצמך' });
      else if (r.reason === 'already-friends') bus.emit(FRIENDS_RENDER, { addStatus: 'כבר חברים' });
      else bus.emit(FRIENDS_RENDER, { addStatus: 'שגיאה' });
    });

    bus.on(FRIENDS_INTENT.ACCEPT_REQUEST, async ({ fromUid }) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !fromUid) return;
      // Read the requester's profile so we record their name/avatar.
      const fromProfile = await profileService.readProfile(fbDb, fromUid);
      await friendsService.acceptFriendRequest(fbDb, {
        fromUid, toUid: fbUser.uid, fromProfile, toProfile: lastProfile,
      });
    });

    bus.on(FRIENDS_INTENT.REJECT_REQUEST, async ({ fromUid }) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !fromUid) return;
      await friendsService.rejectFriendRequest(fbDb, { fromUid, toUid: fbUser.uid });
    });

    bus.on(FRIENDS_INTENT.REMOVE_FRIEND, async ({ friendUid }) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !friendUid) return;
      await friendsService.removeFriend(fbDb, { uid: fbUser.uid, friendUid });
    });

    bus.on(FRIENDS_INTENT.OPEN_DETAIL, async ({ friendUid } = {}) => {
      const fbDb  = activeFbDb;
      const myUid = activeFbCurrentUser?.uid;
      if (!fbDb || !myUid || !friendUid) return;

      const friend = lastFriends.find(f => f.uid === friendUid) ?? { uid: friendUid };

      // Rivalry and recent-game data from my local profile (no extra fetch needed)
      const rivalEntry = lastProfile?.stats?.rivalStats?.[friendUid] ?? null;
      const vsRecent   = (lastProfile?.stats?.recentGames ?? [])
        .filter(g => g.opponentUid === friendUid)
        .slice(0, 5);

      // Find shared active rooms
      const activeGames = [];
      try {
        const [myRoomId, friendRoomId] = await Promise.all([
          fbDb.ref(`users/${myUid}/activeRoom`).get().then(s => s?.val?.() ?? null),
          fbDb.ref(`users/${friendUid}/activeRoom`).get().then(s => s?.val?.() ?? null),
        ]);
        // Live game: both share the same active room
        if (myRoomId && myRoomId === friendRoomId) {
          const room = await roomService.readRoom(fbDb, myRoomId);
          if (room && room.status === 'playing') {
            activeGames.push({ roomId: myRoomId, room });
          }
        }
        // Async games: scan my async index for rooms containing this friend
        const asyncSnap = await fbDb.ref(`users/${myUid}/asyncRooms`).get();
        const asyncMap  = asyncSnap?.val?.() ?? {};
        for (const roomId of Object.keys(asyncMap)) {
          if (roomId === myRoomId) continue; // already counted
          const room = await roomService.readRoom(fbDb, roomId);
          if (!room || room.status !== 'playing') continue;
          const uids = Object.values(room.players ?? {}).map(p => p.uid);
          if (uids.includes(friendUid)) activeGames.push({ roomId, room });
        }
      } catch (e) {
        console.warn('[spine] OPEN_DETAIL: active rooms fetch failed', e);
      }

      bus.emit(FRIENDS_DETAIL_RENDER, { friend, rivalEntry, vsRecent, activeGames, myUid });
    });

    bus.on(FRIENDS_INTENT.ENTER_GAME, async ({ roomId, mySlot } = {}) => {
      const fbDb = activeFbDb;
      if (!fbDb || !roomId) return;
      try {
        const room = await roomService.readRoom(fbDb, roomId);
        if (!room) return;
        hideOnlineStartOverlays?.();
        startOnlineGameViaSpine({ db: fbDb, room, mySlot: Number(mySlot ?? 0) });
      } catch (e) {
        console.warn('[spine] ENTER_GAME failed', e);
      }
    });

    bus.on(FRIENDS_INTENT.INVITE_FRIEND, async ({ uid, name, avatar } = {}) => {
      const fbDb   = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !uid) return;
      pendingFriendTarget = { uid, name, avatar };
      // Pre-fill host name and open create-room overlay.
      const _crName = globalThis.document?.getElementById?.('cr-name');
      if (_crName) {
        const n = lastProfile?.displayName ?? activeFbCurrentUser?.displayName
               ?? settingsCompat.loadUiPreferences(globalThis.localStorage).lastDisplayName;
        if (n) _crName.value = n;
      }
      globalThis.document?.getElementById?.('ov-create-room')?.classList?.remove?.('hidden');
    });

    bus.on(FRIENDS_INTENT.COPY_MY_ID, async () => {
      const id = lastProfile?.userId;
      if (!id) return;
      try { await globalThis.navigator?.clipboard?.writeText?.(id); } catch {}
      bus.emit(FRIENDS_RENDER, { copyStatus: 'הועתק!' });
      setTimeout(() => bus.emit(FRIENDS_RENDER, { copyStatus: '' }), 1500);
    });
    bus.on(FRIENDS_INTENT.BACK, () => {
      showLegacyScreen('sprofile');
    });

    // ── Notifications inbox intents ──
    bus.on(NOTIF_INTENT.BACK, () => {
      showLegacyScreen('sh');
    });

    bus.on(NOTIF_INTENT.ACCEPT_INVITE, async (invite) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !invite?.inviteId) return;
      const accepterProfile = {
        displayName: fbUser.displayName ?? globalThis.currentUserProfile?.displayName ?? 'שחקן',
        avatar: fbUser.photoURL ?? globalThis.currentUserProfile?.avatar ?? null,
      };
      try {
        const result = await inviteService.acceptInvite(fbDb, {
          toUid: fbUser.uid, inviteId: invite.inviteId, accepterProfile,
        });
        if (result?.ok && result.roomId) {
          try {
            await notificationService.pushInviteAccepted({
              inviterUid: invite.fromUid,
              accepterName: accepterProfile.displayName,
              roomId: result.roomId,
            });
          } catch (e) { console.warn('[spine] notif inbox invite accepted push', e); }
          const room = await roomService.readRoom(fbDb, result.roomId);
          if (room) startOnlineGameViaSpine({ db: fbDb, room, mySlot: 1 });
        }
      } catch (e) { console.error('[spine] notif inbox acceptInvite', e); }
    });

    bus.on(NOTIF_INTENT.REJECT_INVITE, async (invite) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (fbDb && fbUser?.uid && invite?.inviteId && invite?.fromUid) {
        try {
          await inviteService.rejectInvite(fbDb, {
            fromUid: invite.fromUid,
            toUid: fbUser.uid,
            inviteId: invite.inviteId,
            fromName: globalThis.__spine?.currentProfile?.displayName ?? fbUser.displayName ?? 'שחקן',
            serverTimestamp: Date.now(),
          });
          await notificationService.pushInviteRejected({
            inviterUid: invite.fromUid,
            rejecterName: globalThis.__spine?.currentProfile?.displayName ?? fbUser.displayName ?? 'שחקן',
          });
        } catch (e) { console.error('[spine] notif inbox rejectInvite', e); }
      }
    });

    bus.on(NOTIF_INTENT.ACCEPT_FRIEND, async ({ fromUid }) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !fromUid) return;
      const fromProfile = await profileService.readProfile(fbDb, fromUid);
      await friendsService.acceptFriendRequest(fbDb, {
        fromUid, toUid: fbUser.uid, fromProfile, toProfile: lastProfile,
      });
    });

    bus.on(NOTIF_INTENT.REJECT_FRIEND, async ({ fromUid }) => {
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid || !fromUid) return;
      await friendsService.rejectFriendRequest(fbDb, { fromUid, toUid: fbUser.uid });
    });

    // ── Auth intents (Firebase compat SDK) ──
    bus.on(AUTH_INTENT.SIGN_UP, async ({ name, email, password }) => {
      try { await ensureFirebaseGlobals(); } catch {}
      const fbAuth = activeFbAuth;
      const fbDb   = activeFbDb;
      if (!fbAuth || !fbDb) {
        authScreens.showError('signup', 'אין חיבור לשרת. נסה שוב.');
        return;
      }
      try {
        const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
        const uid = cred?.user?.uid;
        if (!uid) return;
        // Claim username + write initial profile
        await profileService.claimUsername(fbDb, { uid, newName: name });
        const userId = profileService.generateUserId();
        const initial = profileService.buildInitialProfile({ displayName: name, userId });
        await profileService.updateProfile(fbDb, uid, initial);
        await ratingService.upsertRatingLeaderboardEntry(fbDb, { uid, profile: initial, rating: initial.rating });
        await fbDb.ref(`userIds/${userId}`).set(uid);
        showLegacyScreen('sh');
      } catch (e) {
        authScreens.showError('signup', e?.message ?? AUTH_ERROR_HE['bad-email']);
      }
    });

    bus.on(AUTH_INTENT.LOG_IN, async ({ email, password }) => {
      try { await ensureFirebaseGlobals(); } catch {}
      const fbAuth = activeFbAuth;
      if (!fbAuth) {
        authScreens.showError('login', 'אין חיבור לשרת. נסה שוב.');
        return;
      }
      try {
        await fbAuth.signInWithEmailAndPassword(email, password);
        showLegacyScreen('sh');
      }
      catch (e) { authScreens.showError('login', e?.message ?? 'שגיאה'); }
    });

    bus.on(AUTH_INTENT.RESET_PASSWORD, async ({ email }) => {
      try { await ensureFirebaseGlobals(); } catch {}
      const fbAuth = activeFbAuth;
      if (!fbAuth) {
        authScreens.showError('login', 'אין חיבור לשרת. נסה שוב.');
        return;
      }
      try {
        await fbAuth.sendPasswordResetEmail(email);
        authScreens.showInfo('login', 'נשלח אימייל לאיפוס הסיסמה');
      } catch (e) {
        authScreens.showError('login', e?.message ?? 'שגיאה בשליחת אימייל');
      }
    });

    bus.on(AUTH_INTENT.GO_LOGIN, () => {
      showLegacyScreen('sauth-login');
    });
    bus.on(AUTH_INTENT.GO_SIGNUP, () => {
      showLegacyScreen('sauth-signup');
    });
    bus.on(AUTH_INTENT.CONTINUE_GUEST, () => {
      showLegacyScreen('sh');
    });
    bus.on(AUTH_INTENT.UPGRADE, () => {
      showLegacyScreen('sauth-signup');
    });

    // ── Rating + stats on game-end (online games only) ──
    async function refreshChampions(target = 'all') {
      const fbDb = activeFbDb;
      if (!fbDb) {
        bus.emit(CHAMPS_ERROR, { target });
        return;
      }
      try {
        const entries = await ratingService.listTopRatings(fbDb);
        bus.emit(CHAMPS_RENDER, { entries, target });
      } catch (e) {
        console.warn('[spine] champions list', e);
        bus.emit(CHAMPS_ERROR, { target });
      }
    }

    bus.on(CHAMPS_INTENT.OPEN, () => {
      refreshChampions('home');
    });

    bus.on(EV.GAME_COMPLETED, async ({ winnerSlot, finalScores } = {}) => {
      const ag = globalThis.__spine?.activeGame;
      const fbDb = activeFbDb;
      const fbUser = activeFbCurrentUser;
      if (!fbDb || !fbUser?.uid) return;
      const session = ag.session;
      const players = session?.state?.players ?? {};
      const mySlot = players[0]?.uid === fbUser.uid ? 0 : players[1]?.uid === fbUser.uid ? 1 : 0;
      const oppUid = players[1 - mySlot]?.uid;
      const myScore = finalScores?.[mySlot] ?? session?.state?.scores?.[mySlot] ?? 0;

      if (!ag?.online) {
        refreshChampions('end');
        return;
      }
      const result = winnerSlot == null ? 'draw' : (winnerSlot === mySlot ? 'win' : 'loss');

      // Stats
      if (!ag.isAsync) {
        const statsDelta = profileService.computeLiveGameStatsDelta({
          state: session?.state,
          room: {
            mode: session?.mode,
            players,
          },
          mySlot,
          currentStats: lastProfile?.stats ?? {},
          botTime: session?.state?.settings?.botTime ?? null,
        });
        if (statsDelta) profileService.bumpStats(fbDb, fbUser.uid, statsDelta).catch(() => {});
      }

      // Rating (only when both players have profiles)
      if (oppUid && oppUid !== fbUser.uid) {
        await ratingService.applyEloForFinishedGame(fbDb, {
          myUid: fbUser.uid, oppUid, result,
        }).catch((e) => console.warn('[spine] elo', e));
        refreshChampions('end');
      }
    });

    bus.on(PROFILE_INTENT.LOGOUT, async () => {
      // Stop presence FIRST so the final connected:false write and the
      // heartbeat both run while auth is still valid. Otherwise the
      // presenceService stop() races onAuthStateChanged(null) and Firebase
      // logs permission_denied on /presence/$uid.
      try { await teardownCrossCuttingAuth(); } catch {}
      try { await activeFbAuth?.signOut?.(); } catch {}
      lastProfile = null; lastFriends = []; lastRequests = [];
      lastInviteCount = 0; lastFriendRequestCount = 0;
      try { activeProfileWatch?.();  activeProfileWatch  = null; } catch {}
      try { activeRequestsWatch?.(); activeRequestsWatch = null; } catch {}
      try { activeFriendsWatch?.();  activeFriendsWatch  = null; } catch {}
      bus.emit(MENU_REFRESH, { isAuthed: false, displayName: '' });
      // Route back to the main menu — leaving the player on the profile
      // overlay after they've signed out is confusing (the avatar / name
      // controls go stale and there's no obvious way back).
      showLegacyScreen('sh');
    });

  console.info('[spine] account route active');

  function showLegacyScreen(id) {
    const showSc = globalThis.showSc;
    if (typeof showSc === 'function') {
      try { showSc(id); return; } catch { /* swallow */ }
    }
    const screens = ['sh', 'ss', 'sg', 'so', 'scoin', 'sprofile', 'sfriends', 'snotif', 'schamps', 'sauth-signup', 'sauth-login', 'sav-gallery', 'sstats'];
    for (const s of screens) {
      const el = globalThis.document?.getElementById?.(s);
      if (!el) continue;
      if (s === id) el.classList?.remove('hidden');
      else el.classList?.add('hidden');
    }
  }

  async function resumeOnlineRoomById(roomId, { skipCoin = true } = {}) {
    const fbDb = activeFbDb;
    const fbUser = activeFbCurrentUser;
    if (!fbDb || !fbUser?.uid || !roomId) return null;
    const room = await roomService.readRoom(fbDb, roomId);
    if (!room) {
      sessionPersistence.clearActiveOnlineSession(globalThis.localStorage);
      return null;
    }
    const terminal = ['completed', 'abandoned', 'expired'].includes(room.status);
    if (terminal) {
      sessionPersistence.clearActiveOnlineSession(globalThis.localStorage);
      try { await roomService.leaveRoom(fbDb, roomId, fbUser.uid); } catch { /* swallow */ }
      return null;
    }
    const mySlot = room.players?.[0]?.uid === fbUser.uid ? 0
                 : room.players?.[1]?.uid === fbUser.uid ? 1 : null;
    if (mySlot == null) return null;
    // A room stuck in `waiting` after a reload is almost always a dead
    // handshake — the previous run was abandoned before both players clicked
    // through the coin-toss. Auto-recovering into it boots the user straight
    // back into a coin-toss they can't escape (no back button on #scoin).
    // Clear the activeRoom pointer + saved session so the menu loads instead;
    // a fresh game can be created normally.
    if (room.status === 'waiting') {
      sessionPersistence.clearActiveOnlineSession(globalThis.localStorage);
      try { await roomService.leaveRoom(fbDb, roomId, fbUser.uid); } catch { /* swallow */ }
      return null;
    }
    return startOnlineGameViaSpine({ db: fbDb, room, mySlot, skipCoin });
  }

  let pendingCoinStart = null;

  function enterPendingCoinGame() {
    const start = pendingCoinStart;
    pendingCoinStart = null;
    if (start) start();
  }

  function scheduleGameLayoutRefresh() {
    const legacyRefresh = globalThis.scheduleGameLayoutRefresh;
    if (typeof legacyRefresh === 'function') {
      try { legacyRefresh({ render: false }); } catch (e) { console.warn('[spine] scheduleGameLayoutRefresh', e); }
      return;
    }
    const compute = globalThis.computeSizes;
    if (typeof compute !== 'function') return;
    const run = () => {
      try { compute(); } catch (e) { console.warn('[spine] computeSizes', e); }
    };
    globalThis.requestAnimationFrame?.(() => {
      run();
      globalThis.requestAnimationFrame?.(run);
    });
    globalThis.setTimeout?.(run, 60);
    globalThis.setTimeout?.(run, 240);
  }

  // Mount an online game session into the legacy game screen. Used as the
  // common entry point for matchmaking results, future invite-accept flows,
  // and rejoin-from-saved-session.
  // Per-game bonus + boost-badges plumbing. Returns a disposer that cleans
  // up both the activation controller's bus subscriptions and the
  // BONUS_PENDING / BI_INTENT.START handlers we register here.
  //
  // `botSlot` (optional) — when set, BONUS_PENDING events whose `slot` matches
  // the bot are auto-resolved using the legacy fixed bot-bonus table instead
  // of opening the mini-game / wheel UI for the human player.
  function attachBonusFlow(session, { botSlot = null } = {}) {
    const ctl = createBonusActivationController({ bus, session });
    const badges = mountBoostBadges({ bus, sessionRef: () => session });
    const scoreFx = mountScoreBonusAnimation({ bus });
    const subs = [];

    // Legacy bot bonus table from execBot() at HEAD:index.html:7404 — the
    // bot never played mini-games / spun the wheel; it just got these fixed
    // amounts added to its score (and 0 for anything not listed).
    const LEGACY_BOT_BONUS = { B1: 50, B3: 15, B8: 20, B10: 20 };

    // BONUS_PENDING → open intro overlay (works for both minigame + wheel),
    // unless the bot triggered the square, in which case auto-resolve with
    // the legacy fixed amount and skip the UI.
    subs.push(bus.on(BONUS_PENDING, (payload) => {
      if (botSlot != null && payload?.slot === botSlot) {
        const amount = LEGACY_BOT_BONUS[payload.bonusType] ?? 0;
        ctl.skipPending({ earnedPts: amount });
        return;
      }
      bus.emit(BI_OPEN, payload);
    }));

    // Auto-category bonus (B2/B4/B9) triggered by the bot: the engine emits
    // BOOST_ACTIVATED for auto_extra_score and defers points until the human
    // clicks אישור on the award overlay. animationController skips the
    // overlay for the opponent slot, so we finalize the award ourselves and
    // emit BONUS_AWARD_ACK so the bot/turn-timer resume.
    if (botSlot != null) {
      subs.push(bus.on(EV.BOOST_ACTIVATED, ({ slot, boostId, payload, consumed, pending, bonusIdx }) => {
        if (consumed || pending) return;
        if (slot !== botSlot) return;
        const extra = boostId === 'auto_extra_score' ? (Number(payload?.extra) || 0) : 0;
        session.dispatch({
          type: CMD.FINALIZE_BOOST_AWARD,
          payload: { slot, extra, bonusIdx },
        });
        bus.emit(BONUS_AWARD_ACK, { slot, boostId, extra: payload?.extra ?? 0 });
      }));
    }

    // Lazy word-list selectors — building the filtered arrays is non-trivial
    // (DICT is potentially tens of thousands of entries) so we cache them
    // for the lifetime of the bonus flow.
    //
    // Hebrew final-form letters (ך ם ן ף ץ) only appear at the END of a word,
    // so leaving them in puzzle tiles gives the player a free clue about
    // letter position. Normalize each word with hebrewDictionary.norm() so
    // mini-games show only the regular forms — the validator (isValid uses
    // terminalFinalVariants) still recognises the normalized spelling.
    const wordCaches = new Map(); // length → string[]
    function wordsOfLength(len) {
      let cached = wordCaches.get(len);
      if (!cached) {
        const seen = new Set();
        cached = [];
        for (const w of hebrewDictionary.DICT) {
          if (w.length !== len) continue;
          const n = hebrewDictionary.norm(w);
          if (n.length !== len || seen.has(n)) continue;
          seen.add(n);
          cached.push(n);
        }
        wordCaches.set(len, cached);
      }
      return cached;
    }
    function wordsOfLengthRange(min, max) {
      const key = `${min}_${max}`;
      let cached = wordCaches.get(key);
      if (!cached) {
        const seen = new Set();
        cached = [];
        for (const w of hebrewDictionary.DICT) {
          if (w.length < min || w.length > max) continue;
          const n = hebrewDictionary.norm(w);
          if (n.length < min || n.length > max || seen.has(n)) continue;
          seen.add(n);
          cached.push(n);
        }
        wordCaches.set(key, cached);
      }
      return cached;
    }

    // Intro overlay's "let's play" → spawn the appropriate mini-game.
    subs.push(bus.on(BI_INTENT.START, (payload) => {
      const key = payload?.miniGameKey;
      switch (key) {
        case 'b13_wheel_of_fortune':
          playWheelForBonus({ bus, controller: ctl });
          return;
        case 'b1_unscramble_or_fillmiddle': {
          // Faithful B1 port: 50/50 between unscramble-long (6-letter word,
          // 40s, +100 pts) and fill-middle (6-7 letter word with distinct
          // first/last, 40s, +100 pts; player rearranges the middle letters
          // and any morphologically valid Hebrew word with the same outer
          // letters is accepted).
          if (Math.random() < 0.5) {
            playFillMiddleForBonus({
              bus,
              words: wordsOfLengthRange(6, 7),
              validator: (w) => hebrewDictionary.isValid?.(w) ?? hebrewDictionary.DICT.has(w),
              controller: ctl,
            });
          } else {
            playUnscrambleForBonus({
              bus,
              words: wordsOfLength(6),
              tier: 'long',
              controller: ctl,
              validator: (w) => hebrewDictionary.isValid?.(w) ?? hebrewDictionary.DICT.has(w),
            });
          }
          return;
        }
        case 'b3_unscramble_medium':
          playUnscrambleForBonus({
            bus,
            words: wordsOfLength(4),
            tier: 'medium',
            controller: ctl,
            validator: (w) => hebrewDictionary.isValid?.(w) ?? hebrewDictionary.DICT.has(w),
          });
          return;
        case 'b8_crossword_60s': {
          // Faithful B8 port: draws 20 letters from the active game's bag
          // (jokers excluded; common-letter padding if the bag is short),
          // lets the player freely place them on a 5×7 grid, scores every
          // horizontal+vertical run ≥2 letters against hebrewDictionary,
          // and zeros the whole bonus if any illegal run remains at submit.
          const ag = globalThis.__spine?.activeGame;
          const bag = ag?.session?.state?.bag ?? [];
          playCrosswordForBonus({
            bus,
            bag,
            validator: (w) => hebrewDictionary.isValid?.(w) ?? hebrewDictionary.DICT.has(w),
            hv: HV,
            controller: ctl,
          });
          return;
        }
        case 'b10_crossing_words':
          // Faithful B10 port: pick two dictionary words (3-6 letters, no
          // final-letter forms — wordsOfLengthRange returns norm'd words
          // from hebrewDictionary.DICT) that share a non-trivial letter,
          // build a mini crossword with one blank cell, and let the player
          // guess the intersection letter for +40 points.
          playCrossingWordsForBonus({
            bus,
            words: wordsOfLengthRange(3, 6),
            controller: ctl,
          });
          return;
        case 'b11_word_search':
          // Faithful B11 port: uses the legacy 30-word curated pool baked
          // into wordSearchMiniGame.js (HEBREW_WORD_POOL), not the runtime
          // dictionary. This keeps the puzzle hand-tuned to short common
          // Hebrew words with no final-letter forms.
          playWordSearchForBonus({
            bus,
            controller: ctl,
          });
          return;
        case 'b12_honeycomb':
          // Faithful B12 port: 12 hand-curated letter sets (center + 6
          // outer), random pick, type-any-Hebrew-word containing the
          // center letter, scored 2=3 | 3=5 | 4=8 | 5+=10, 40-second
          // timer. The legacy game allows any letter (not just the 7 in
          // the honeycomb) so we just gate on the morphological isValid.
          playHoneycombForBonus({
            bus,
            validator: (w) => hebrewDictionary.isValid?.(w) ?? hebrewDictionary.DICT.has(w),
            norm:       hebrewDictionary.norm ?? ((x) => x),
            controller: ctl,
          });
          return;
        default:
          console.info('[spine] miniGame UI not registered:', key, '— resolving as fail');
          ctl.resolveMiniGame({ success: false, earnedPts: 0 });
      }
    }));

    // Online live-bonus broadcast. Mirrors the legacy `liveBonus` path
    // (HEAD:index.html:8027-8070): when the active player enters a boost
    // flow (mini-game intro, wheel, or +N award overlay), broadcast a
    // `liveBonus` summary to the room so the opponent can (a) freeze their
    // turn timer and (b) show a spectator overlay. Cleared on the
    // definitive "boost done" events (MOVE_SCORE_COMMITTED for deferred
    // moves; TURN_CHANGED as a defensive sweep).
    const onlineRoomId = session?.roomId ?? null;
    const onlineMySlot = session?.mySlot;
    const isOnline = !!onlineRoomId && (onlineMySlot === 0 || onlineMySlot === 1);
    if (isOnline) {
      // Track the full liveBonus payload locally so progress updates can
      // always re-emit the COMPLETE shape (active + slot + title + ...).
      // We deliberately avoid partial `.update()` writes — Firebase RTDB
      // rule evaluation + local-cache merging produced cases where the
      // opponent's snapshot briefly showed liveBonus without the `active`
      // flag, which collapsed the spectator overlay mid-mini-game.
      let currentLiveBonus = null;
      const writeLiveBonus = (payload) => {
        currentLiveBonus = payload;
        const db = activeFbDb;
        if (!db) return;
        roomService.setLiveBonus(db, onlineRoomId, payload).catch((e) => {
          console.warn('[spine] setLiveBonus', e);
        });
      };
      const clearLiveBonus = () => writeLiveBonus(null);
      let bonusFlowActive = false;

      subs.push(bus.on(BONUS_PENDING, (pending) => {
        if (!pending || pending.slot !== onlineMySlot) return;
        bonusFlowActive = true;
        const info = describeBonus(pending.bonusType);
        writeLiveBonus({
          slot: onlineMySlot,
          kind: pending.kind ?? 'minigame',
          bonusType: pending.bonusType ?? null,
          title: info.title,
          desc: info.desc + (info.pts ? ` (${info.pts} נקודות)` : ''),
          icon: info.title?.split(' ')[0] ?? null,
        });
      }));

      subs.push(bus.on(EV.BOOST_ACTIVATED, ({ slot, boostId, payload, consumed, pending }) => {
        if (consumed || pending) return;
        if (slot !== onlineMySlot) return;
        // Mirror the same condition animationController uses to open the
        // modal #ov-bonus-award (any non-consumed, non-pending activation
        // for the local slot pops the award modal). The opponent's
        // spectator overlay opens for exactly that set.
        bonusFlowActive = true;
        const extra = Number(payload?.extra) || 0;
        writeLiveBonus({
          slot: onlineMySlot,
          kind: 'award',
          bonusType: null,
          title: boostId === 'auto_extra_score' ? '🎉 בונוס!' : '⚡ בוסט!',
          desc: extra ? `+${extra} נקודות` : null,
          icon: '🎁',
        });
      }));

      subs.push(bus.on(EV.MOVE_SCORE_COMMITTED, ({ slot }) => {
        if (slot !== onlineMySlot || !bonusFlowActive) return;
        bonusFlowActive = false;
        clearLiveBonus();
      }));

      // Defensive sweep: if the turn rotated for any reason (timeout,
      // pass) while a liveBonus was still active, make sure the opponent's
      // spectator overlay closes.
      subs.push(bus.on(EV.TURN_CHANGED, () => {
        if (!bonusFlowActive) return;
        bonusFlowActive = false;
        clearLiveBonus();
      }));

      // A mini-game / wheel that resolved with 0 points takes the
      // FINALIZE_BOOST_AWARD-direct path inside bonusActivationController
      // (no ACTIVATE_BOOST → no BOOST_ACTIVATED → no MOVE_SCORE_COMMITTED
      // delta). BONUS_RESOLVED is the terminal signal in that case.
      subs.push(bus.on(BONUS_RESOLVED, ({ slot, earnedPts, skipped }) => {
        if (slot !== onlineMySlot || !bonusFlowActive) return;
        // If the resolution will trigger a follow-up BOOST_ACTIVATED +
        // award overlay (earnedPts > 0 and not skipped), leave the
        // bonusFlowActive flag set — the upcoming BOOST_ACTIVATED will
        // overwrite liveBonus with the award payload, and MOVE_SCORE_COMMITTED
        // will clear it. Only clear here for the no-followup path.
        if (Number(earnedPts) > 0 && !skipped) return;
        bonusFlowActive = false;
        clearLiveBonus();
      }));

      // Ack-only path: auto bonus with extra > 0 ends at BONUS_AWARD_ACK
      // (the engine emits MOVE_SCORE_COMMITTED inside handleFinalizeBoostAward
      // which is dispatched from the ack handler — both fire and both
      // attempt the clear; clear is idempotent).
      subs.push(bus.on(BONUS_AWARD_ACK, ({ slot }) => {
        if (slot !== onlineMySlot || !bonusFlowActive) return;
        bonusFlowActive = false;
        clearLiveBonus();
      }));

      // Live mini-game progress (secsLeft / score / label) broadcast to the
      // opponent's spectator overlay. Mini-games emit 'liveBonus/progress'
      // at every tick (see e.g. unscrambleMiniGame.js); we throttle the
      // server write to once per change to avoid burning quota on identical
      // payloads. Always rewrite the FULL liveBonus payload (not a partial
      // `.update()` on the progress field alone) — partial writes briefly
      // surface as `liveBonus` snapshots without the `active` flag on the
      // opponent's side, which collapses the spectator overlay.
      let lastProgressSig = null;
      subs.push(bus.on('liveBonus/progress', (progress = {}) => {
        if (!bonusFlowActive || !currentLiveBonus) return;
        const sig = JSON.stringify({
          secsLeft: progress.secsLeft ?? null,
          score: progress.score ?? null,
          label: progress.label ?? null,
        });
        if (sig === lastProgressSig) return;
        lastProgressSig = sig;
        writeLiveBonus({ ...currentLiveBonus, progress });
      }));
    }

    // BB_INTENT.REDEEM_TILE_SWAP → open the exchange overlay in free-swap
    // mode. gameScreen subscribes to GAME_SCREEN_INTENT.OPEN_EXCHANGE and
    // forwards letters into CMD.EXCHANGE_TILE { freeSwap: true }, which the
    // engine consumes by removing the active free_tile_swap boost instead of
    // advancing the turn.
    subs.push(bus.on(BB_INTENT.REDEEM_TILE_SWAP, () => {
      const ag = globalThis.__spine?.activeGame;
      const session = ag?.session;
      const slot = session?.mySlot ?? session?.state?.currentTurnSlot;
      const hasSwap = (session?.state?.activeBoosts ?? []).some(
        b => b && b.boostId === 'free_tile_swap' && b.slot === slot,
      );
      if (!hasSwap) {
        console.info('[spine] tile-swap redeem ignored: no active free_tile_swap for slot', slot);
        return;
      }
      bus.emit(GAME_SCREEN_INTENT.OPEN_EXCHANGE, { freeSwap: true });
    }));

    return {
      dispose() {
        for (const off of subs) try { off(); } catch {}
        try { ctl.dispose(); }     catch {}
        try { badges.unmount(); }  catch {}
        try { scoreFx.unmount(); } catch {}
      },
    };
  }

  async function startOnlineGameViaSpine({ db, room, mySlot, skipCoin = false } = {}) {
    ensureDictionaryLoaded().catch((e) => console.warn('[spine] dictionary preload before online game failed:', e));
    for (const id of ['ov-create-room', 'ov-waiting-room', 'ov-join-code', 'ov-matchmaking', 'ov-partner-search']) {
      globalThis.document?.getElementById?.(id)?.classList?.add?.('hidden');
    }
    if (skipCoin && room?.status !== 'playing' && !(room?.mode ?? '').endsWith('-async')) {
      skipCoin = false;
    }

    if (!skipCoin) {
      pendingCoinStart = () => {
        const isAsync = (room.mode ?? '').endsWith('-async');
        if (isAsync) {
          startOnlineGameViaSpine({ db, room, mySlot, skipCoin: true }).catch((e) => {
            console.error('[spine] coin-enter online start failed', e);
          });
          return;
        }
        bus.emit(COIN_WAITING, {});
        let done = false;
        let unwatch = null;
        const maybeEnter = (latest) => {
          if (done || !latest) return;
          const ready0 = !!(latest.ready?.[0] ?? latest.ready?.['0']);
          const ready1 = !!(latest.ready?.[1] ?? latest.ready?.['1']);
          if (latest.status !== 'playing' || !ready0 || !ready1) return;
          done = true;
          try { unwatch?.(); } catch {}
          pendingCoinStart = null;
          startOnlineGameViaSpine({ db, room: latest, mySlot, skipCoin: true }).catch((e) => {
            console.error('[spine] coin-enter online start failed', e);
          });
        };
        unwatch = roomService.watchRoom(db, room.roomId, maybeEnter);
        roomService.markReadyAndMaybeStart(db, room.roomId, mySlot).then(maybeEnter).catch((e) => {
          console.error('[spine] online ready handshake failed', e);
        });
      };
      showLegacyScreen('scoin');
      bus.emit(COIN_OPEN, {
        startingSlot: room.currentTurnSlot ?? 0,
        p1Name: room.players?.[0]?.displayName,
        p2Name: room.players?.[1]?.displayName,
      });
      return null;
    }

    if (room.status !== 'playing') {
      console.warn('[spine] attempted to mount online room before both players were ready', {
        roomId: room.roomId,
        status: room.status,
      });
      return null;
    }

    const normalizedRoomSettings = settingsCompat.normalizeGameSettings(room.settings ?? {});
    room = { ...room, settings: normalizedRoomSettings };
    settingsCompat.applyGameSettingsToGlobals(globalThis, normalizedRoomSettings);
    settingsCompat.saveGameSettings(globalThis.localStorage, normalizedRoomSettings);

    showLegacyScreen('sg');
    if (typeof globalThis.buildUnifiedGrid === 'function') {
      try { globalThis.buildUnifiedGrid(); } catch { /* swallow */ }
    }
    const session = await createOnlineGameSession({ bus, db, room, mySlot });
    const controller = createGameController({ bus, session, mySlot });
    const animationController = createAnimationController({ bus, mySlot });
    animationController.setEnabled(settingsCompat.loadUiPreferences(globalThis.localStorage).animationsEnabled);
    const screen = mountGameScreen({
      controller,
      animationController,
      jokerPicker: globalThis.__spine?.jokerPicker ?? null,
      bus,
    });
    session.start();
    const bonusFlow = attachBonusFlow(session);
    // Async modes show the "home" button (back to menu without resigning);
    // live modes hide it (the pause button is shown by the game screen
    // instead). Both spine modes and friend-* modes follow the same rule.
    const isAsync = (room.mode ?? '').endsWith('-async');
    bus.emit(isAsync ? AH_SHOW : AH_HIDE, {});
    // Live timed modes: spin up the timeout watchdog so the opponent's client
    // claims a timeout transactionally when the active player goes absent.
    // Async modes have no per-turn deadline; offline modes have no opponent.
    let timeoutWatchdog = null;
    if (!isAsync && room.settings?.timelimit) {
      const seconds = Number(room.settings.botTime || room.settings.turnSeconds || 0);
      if (seconds > 0) {
        timeoutWatchdog = createTimeoutWatchdog({
          db,
          roomId: room.roomId,
          mySlot,
          limitMs: seconds * 1000,
        });
      }
    }
    globalThis.__spine.activeGame = {
      session, controller, animationController, screen, bonusFlow, timeoutWatchdog, online: true, isAsync, mySlot,
      end() {
        screen.unmount();
        animationController.dispose();
        controller.dispose();
        bonusFlow.dispose();
        timeoutWatchdog?.dispose?.();
        session.dispose();
        updatePresenceRoom(null);
        bus.emit(AH_HIDE, {});
        globalThis.__spine.activeGame = null;
      },
    };
    saveCurrentOnlineSession();
    updatePresenceRoom(room.roomId);
    syncRoomSubscriptionId(room.roomId, mySlot);
    globalThis.__spine.disconnectController?.resubscribe?.();
    globalThis.__spine.turnTimerController?.sync?.();
    scheduleGameLayoutRefresh();
    console.info('[spine] online game started', { roomId: room.roomId, mySlot, isAsync });
    return session;
  }

  function startGameViaSpine({
    mode,
    bot = false,
    difficulty = 1,
    p1Name = 'שחקן 1',
    p2Name = 'שחקן 2',
    settings = {},
    startingSlot = 0,
    tileBagSeed = 'spine-' + Date.now(),
    beforeStart = null,
  } = {}) {
    ensureDictionaryLoaded().catch((e) => console.warn('[spine] dictionary preload before local game failed:', e));

    settings = settingsCompat.applyGameSettingsToGlobals(globalThis, settingsCompat.settingsFromLegacyGlobals(globalThis, settings));
    settingsCompat.saveGameSettings(globalThis.localStorage, settings);
    // Hide the menu, show the game-board screen. Use legacy showSc if
    // available so screen-transition animation runs; fall back to manual
    // class flips.
    const showSc = globalThis.showSc;
    if (typeof showSc === 'function') {
      try { showSc('sg'); } catch { /* swallow */ }
    } else {
      globalThis.document?.getElementById?.('sh')?.classList?.add('hidden');
      globalThis.document?.getElementById?.('sg')?.classList?.remove('hidden');
    }
    // Build the board grid via the legacy helper if present (creates the
    // 144 cells the new gameScreen expects). The legacy fn also resets
    // bData / lockedCells / bonusSqUsed in legacy globals — harmless,
    // those globals aren't referenced by the new spine.
    if (typeof globalThis.buildUnifiedGrid === 'function') {
      try { globalThis.buildUnifiedGrid(); } catch { /* swallow */ }
    }

    const session = createLocalGameSession({
      bus,
      mode,
      tileBagSeed,
      players: {
        0: { uid: 'p0', displayName: p1Name },
        1: { uid: 'p1', displayName: bot ? 'המחשב' : p2Name, avatar: bot ? '🤖' : null },
      },
      startingSlot,
      settings,
    });

    if (typeof beforeStart === 'function') {
      beforeStart(session);
    }

    if (bot) {
      const wordList = [...hebrewDictionary.DICT].filter(w => w.length >= 2 && w.length <= 6);
      attachBotPlayer(session, {
        slot: 1, wordList,
        isWordValid: (w) => hebrewDictionary.isValid(w),
        difficulty, thinkingMs: 3000,
      });
    }

    // Bot games: the human is always slot 0, so pin mySlot so the rack and
    // turn-gating reflect the human's perspective (rack never swaps to bot,
    // buttons disable while the bot is thinking).
    const humanSlot = bot ? 0 : null;
    const controller = createGameController({ bus, session, mySlot: humanSlot });
    const animationController = createAnimationController({ bus, mySlot: humanSlot });
    animationController.setEnabled(settingsCompat.loadUiPreferences(globalThis.localStorage).animationsEnabled);
    const screen = mountGameScreen({
      controller,
      animationController,
      jokerPicker: globalThis.__spine?.jokerPicker ?? null,
      bus,
    });

    session.start();
    const bonusFlow = attachBonusFlow(session, { botSlot: bot ? 1 : null });

    // Tear-down hook — exposed so DevTools / future "back to menu" can clean up.
    globalThis.__spine.activeGame = {
      session, controller, animationController, screen, bonusFlow, tutorial: mode === 'tutorial', mySlot: humanSlot,
      end() {
        screen.unmount();
        animationController.dispose();
        controller.dispose();
        bonusFlow.dispose();
        session.dispose();
        globalThis.__spine.activeGame = null;
      },
    };
    globalThis.__spine.disconnectController?.resubscribe?.();
    globalThis.__spine.turnTimerController?.sync?.();
    scheduleGameLayoutRefresh();
    console.info('[spine] game session started; state:', session.state);
    return session;
  }

  function startTutorialViaSpine() {
    hebrewDictionary.addWordsFromText(TUTORIAL_WORDS.join('\n'));
    return startGameViaSpine({
      mode: 'tutorial',
      bot: false,
      p1Name: 'שחקן',
      p2Name: 'המחשב',
      settings: { timelimit: false, showMoveSummary: false },
      startingSlot: 0,
      tileBagSeed: 'tutorial-spine',
      beforeStart(session) {
        seedTutorialRack(session.state, 0);
        attachScriptedTutorialBot(session, { slot: 1, thinkingMs: 900 });
      },
    });
  }

  // Mount the menu screen on top of the legacy #sh DOM. Behaviour is
  // unchanged: every menu button still triggers the same legacy global,
  // but the wiring now goes through the bus so we can swap individual
  // intents to new-spine flows one at a time.
  const menu = mountMenuScreen({ bus });
  const setup = mountSetupScreen({
    bus,
    getDisplayName: () => {
      const fbUser = activeFbCurrentUser;
      if (!fbUser) return null;
      return lastProfile?.displayName ?? fbUser.displayName ?? null;
    },
  });
  const onlineLobby = mountOnlineLobbyScreen({ bus });
  const matchmakingOverlay = mountMatchmakingOverlayScreen({ bus });
  mountPartnerSearchOverlay({ bus });
  const createRoomScreen   = mountCreateRoomScreen({ bus });
  const waitingRoomScreen  = mountWaitingRoomScreen({ bus });
  const joinCodeScreen     = mountJoinCodeScreen({ bus });
  const incomingInvite     = mountIncomingInviteScreen({ bus });
  const asyncSessionList   = mountAsyncSessionListScreen({ bus });
  const asyncHomeBtn       = mountAsyncHomeButton({ bus });
  const bonusIntroScreen   = mountBonusIntroScreen({ bus });
  const bonusSpectatorScreen = mountBonusSpectatorScreen({
    bus,
    sessionRef: () => globalThis.__spine?.activeGame?.session ?? null,
  });
  const boostVetoScreen    = mountBoostVetoScreen({ bus });
  const profileScreen      = mountProfileScreen({ bus });
  const statsScreen        = mountStatsScreen({ bus });
  const avatarPicker       = mountAvatarPickerScreen({ bus });
  const avatarUnlocked     = mountAvatarUnlockedScreen({ bus });
  const authScreens        = mountAuthScreens({ bus });
  const friendsScreen      = mountFriendsScreen({ bus });
  const notificationsScreen = mountNotificationsScreen({ bus });
  mountNotifBanner({ bus });
  const championsScreen    = mountChampionsScreen({ bus });
  const dictionaryScreen   = mountDictionaryScreen({ bus });
  const tutorialScreen     = mountTutorialScreen({ bus });
  const jokerPicker = mountJokerPicker({ bus });
  // In-game overlays
  const endScreen     = mountEndGameScreen({ bus });
  const pauseScreen   = mountPauseScreen({ bus });
  const backConfirm   = mountBackConfirmScreen({ bus });
  const coinToss      = mountCoinTossScreen({ bus });
  const settings      = mountSettingsScreen({
    bus,
    getSettings: () => settingsCompat.settingsFromLegacyGlobals(globalThis, globalThis.__spine?.activeGame?.session?.state?.settings ?? {}),
  });
  const disconnect    = mountDisconnectScreen({ bus });
  const resignConfirm = mountResignConfirmScreen({ bus });
  const gameFlow      = createGameFlowController({
    bus,
    activeGameRef: () => globalThis.__spine?.activeGame ?? null,
    startGame: startGameViaSpine,
    showScreen: showLegacyScreen,
    enterCoin: enterPendingCoinGame,
  });
  const turnTimer     = createTurnTimerController({
    bus,
    sessionRef: () => globalThis.__spine?.activeGame?.session ?? null,
  });
  const disconnectCtl = createDisconnectController({
    bus,
    dbRef: () => activeFbDb,
    sessionRef: () => globalThis.__spine?.activeGame?.session ?? null,
  });
  const tutorialCtl = createTutorialController({
    bus,
    activeGameRef: () => globalThis.__spine?.activeGame ?? null,
    startTutorialGame: startTutorialViaSpine,
    showScreen: showLegacyScreen,
  });
  globalThis.__spine.menu = menu;
  globalThis.__spine.setup = setup;
  globalThis.__spine.onlineLobby = onlineLobby;
  globalThis.__spine.matchmakingOverlay = matchmakingOverlay;
  globalThis.__spine.createRoomScreen   = createRoomScreen;
  globalThis.__spine.waitingRoomScreen  = waitingRoomScreen;
  globalThis.__spine.joinCodeScreen     = joinCodeScreen;
  globalThis.__spine.incomingInvite     = incomingInvite;
  globalThis.__spine.asyncSessionList   = asyncSessionList;
  globalThis.__spine.asyncHomeBtn       = asyncHomeBtn;
  globalThis.__spine.bonusIntroScreen   = bonusIntroScreen;
  globalThis.__spine.bonusSpectatorScreen = bonusSpectatorScreen;
  globalThis.__spine.boostVetoScreen    = boostVetoScreen;
  globalThis.__spine.profileScreen      = profileScreen;
  globalThis.__spine.statsScreen        = statsScreen;
  globalThis.__spine.avatarPicker       = avatarPicker;
  globalThis.__spine.avatarUnlocked     = avatarUnlocked;
  globalThis.__spine.authScreens        = authScreens;
  globalThis.__spine.friendsScreen      = friendsScreen;
  globalThis.__spine.championsScreen    = championsScreen;
  globalThis.__spine.dictionaryScreen   = dictionaryScreen;
  globalThis.__spine.tutorialScreen     = tutorialScreen;
  globalThis.__spine.jokerPicker = jokerPicker;
  globalThis.__spine.endScreen     = endScreen;
  globalThis.__spine.pauseScreen   = pauseScreen;
  globalThis.__spine.backConfirm   = backConfirm;
  globalThis.__spine.coinToss      = coinToss;
  globalThis.__spine.settingsScreen = settings;
  globalThis.__spine.disconnectScreen = disconnect;
  globalThis.__spine.resignConfirmScreen = resignConfirm;
  globalThis.__spine.gameFlowController = gameFlow;
  globalThis.__spine.turnTimerController = turnTimer;
  globalThis.__spine.disconnectController = disconnectCtl;
  globalThis.__spine.tutorialController = tutorialCtl;

  console.info('[spine] ready. Try window.__spine.bootOffline2P() or .bootOfflineBot()');

  // Auto-boot a demo session if requested (?demo=...)
  const demo = params.get('demo');
  if (demo === 'offline2p') globalThis.__spine.bootOffline2P();
  else if (demo === 'bot') globalThis.__spine.bootOfflineBot();
  else {
    // First-paint entrance animation. The home screen partial starts visible
    // without `.menu-enter` / `.menu-logo-enter`, so the slide-in only fires
    // when something later calls showScreen('sh'). Trigger it once here so
    // the buttons cascade in on initial load too.
    spineShowScreen('sh', { doc: globalThis.document });
  }
}

function installCutoverGlobals() {
  // Recompute board cell size on viewport resize / orientation change. The
  // initial computeBasicSizes runs once after each screen mount; without a
  // resize listener the board kept the cell size from first paint and
  // looked wrong after rotating a tablet or resizing the window.
  if (globalThis.addEventListener && !globalThis.__spineResizeWired) {
    globalThis.__spineResizeWired = true;
    let raf = 0;
    const onResize = () => {
      if (raf) globalThis.cancelAnimationFrame?.(raf);
      raf = globalThis.requestAnimationFrame?.(() => { raf = 0; computeBasicSizes(); }) ?? 0;
    };
    globalThis.addEventListener('resize', onResize);
    globalThis.addEventListener('orientationchange', onResize);
  }

  globalThis.setS = globalThis.setS ?? function setS(msg, cls = '') {
    const e = globalThis.document?.getElementById?.('sbar');
    if (!e) return;
    e.textContent = msg;
    e.className = `sbar ${cls}`.trim();
  };
  globalThis.ovClose = globalThis.ovClose ?? function ovClose(id) {
    globalThis.document?.getElementById?.(id)?.classList?.add('hidden');
  };
  globalThis.ovOpen = globalThis.ovOpen ?? function ovOpen(id) {
    globalThis.document?.getElementById?.(id)?.classList?.remove('hidden');
  };
  // Legacy stub: the bonus-challenge overlay's #bok button ships with an
  // inline `onclick="bonusOk()"`. Mini-games strip it on mount and restore
  // it on finalize so the user's "continue ▶" click closes the overlay.
  // The new spine never defined bonusOk, so that restored onclick threw
  // `ReferenceError: bonusOk is not defined` and the overlay stayed open.
  // This stub matches the legacy behaviour: just hide #ov-bonus.
  globalThis.bonusOk = globalThis.bonusOk ?? function bonusOk() {
    globalThis.document?.getElementById?.('ov-bonus')?.classList?.add('hidden');
  };
  globalThis.showSc = globalThis.showSc ?? function showSc(id) {
    spineShowScreen(id, { doc: globalThis.document });
    scheduleBasicLayoutRefresh();
  };
  globalThis.goHome = globalThis.goHome ?? function goHome() {
    globalThis.showSc?.('sh');
  };
  globalThis.showProfileScreen = globalThis.showProfileScreen ?? function showProfileScreen() {
    globalThis.showSc?.('sprofile');
  };
  globalThis.openProfileOrAuth = globalThis.openProfileOrAuth ?? function openProfileOrAuth() {
    globalThis.showSc?.('sprofile');
  };
  globalThis.showAvatarGallery = globalThis.showAvatarGallery ?? function showAvatarGallery() {
    bus.emit(PROFILE_INTENT.OPEN_AVATARS, {});
  };
  globalThis.showFriendsScreen = globalThis.showFriendsScreen ?? function showFriendsScreen() {
    bus.emit(PROFILE_INTENT.OPEN_FRIENDS, {});
  };
  globalThis.showStatsScreen = globalThis.showStatsScreen ?? function showStatsScreen() {
    bus.emit(PROFILE_INTENT.OPEN_STATS, {});
  };
  globalThis.logoutUser = globalThis.logoutUser ?? function logoutUser() {
    bus.emit(PROFILE_INTENT.LOGOUT, {});
  };
  globalThis.startNameEdit = globalThis.startNameEdit ?? function startNameEdit() {
    const display = globalThis.document?.getElementById?.('profile-name-display');
    const edit = globalThis.document?.getElementById?.('profile-name-edit');
    const input = globalThis.document?.getElementById?.('profile-name-input');
    if (edit) edit.style.display = '';
    if (input) {
      input.value = display?.textContent ?? '';
      input.focus?.();
    }
  };
  globalThis.cancelNameEdit = globalThis.cancelNameEdit ?? function cancelNameEdit() {
    bus.emit(PROFILE_INTENT.CANCEL_EDIT_NAME, {});
  };
  globalThis.saveDisplayName = globalThis.saveDisplayName ?? function saveDisplayName() {
    bus.emit(PROFILE_INTENT.SAVE_NAME, {});
  };
  globalThis.copyUserId = globalThis.copyUserId ?? function copyUserId() {
    bus.emit(FRIENDS_INTENT.COPY_MY_ID, {});
  };
  globalThis.sendFriendRequest = globalThis.sendFriendRequest ?? function sendFriendRequest() {
    const userId = globalThis.document?.getElementById?.('add-friend-input')?.value ?? '';
    bus.emit(FRIENDS_INTENT.SEND_REQUEST, { userId });
  };
  globalThis._statsRefresh = globalThis._statsRefresh ?? function _statsRefresh() {};
  globalThis._statsTab = globalThis._statsTab ?? function _statsTab(tab, el) {
    for (const btn of globalThis.document?.querySelectorAll?.('.stats-tab') ?? []) btn.classList?.remove('active');
    for (const panel of globalThis.document?.querySelectorAll?.('.stats-panel') ?? []) panel.classList?.remove('active');
    el?.classList?.add('active');
    globalThis.document?.getElementById?.(`st-panel-${tab}`)?.classList?.add('active');
  };
  globalThis._statsShare = globalThis._statsShare ?? function _statsShare() {};
  globalThis.signUpUser = globalThis.signUpUser ?? function signUpUser() {
    bus.emit(AUTH_INTENT.SIGN_UP, {
      name: globalThis.document?.getElementById?.('su-name')?.value ?? '',
      email: globalThis.document?.getElementById?.('su-email')?.value ?? '',
      password: globalThis.document?.getElementById?.('su-pass')?.value ?? '',
    });
  };
  globalThis.loginUser = globalThis.loginUser ?? function loginUser() {
    bus.emit(AUTH_INTENT.LOG_IN, {
      email: globalThis.document?.getElementById?.('li-email')?.value ?? '',
      password: globalThis.document?.getElementById?.('li-pass')?.value ?? '',
    });
  };
  globalThis.continueAsGuest = globalThis.continueAsGuest ?? function continueAsGuest() {
    bus.emit(AUTH_INTENT.CONTINUE_GUEST, {});
  };
  globalThis.crSetMode = globalThis.crSetMode ?? function crSetMode(mode) {
    const live = globalThis.document?.getElementById?.('cr-mode-live');
    const async = globalThis.document?.getElementById?.('cr-mode-async');
    live?.classList?.[mode === 'live' ? 'add' : 'remove']('active');
    async?.classList?.[mode === 'async' ? 'add' : 'remove']('active');
    const row = globalThis.document?.getElementById?.('cr-speed-row');
    if (row) row.style.display = mode === 'async' ? 'none' : '';
  };
  globalThis.mmSetMode = globalThis.mmSetMode ?? function mmSetMode(mode) {
    const live = globalThis.document?.getElementById?.('mm-mode-live');
    const async = globalThis.document?.getElementById?.('mm-mode-async');
    live?.classList?.[mode === 'live' ? 'add' : 'remove']('active');
    async?.classList?.[mode === 'async' ? 'add' : 'remove']('active');
    const row = globalThis.document?.getElementById?.('mm-speed-row');
    if (row) row.style.display = mode === 'async' ? 'none' : '';
  };
  globalThis.mmSetRatingRange = globalThis.mmSetRatingRange ?? function mmSetRatingRange(value) {
    for (const id of ['any', '100', '200', '500']) {
      globalThis.document?.getElementById?.(`mm-rr-${id}`)?.classList?.remove('active');
    }
    globalThis.document?.getElementById?.(`mm-rr-${value ?? 'any'}`)?.classList?.add('active');
  };
  globalThis.computeSizes = globalThis.computeSizes ?? computeBasicSizes;
  globalThis.scheduleGameLayoutRefresh = globalThis.scheduleGameLayoutRefresh ?? scheduleBasicLayoutRefresh;
  globalThis.buildUnifiedGrid = globalThis.buildUnifiedGrid ?? buildSpineUnifiedGrid;

  // ── Waiting-room friend-invite search ──
  // Called from oninput/onfocus on #wr-invite-name. Fetches the friends list
  // directly (activeFbDb/activeFbCurrentUser are module-level) so this works
  // even though installCutoverGlobals is defined outside boot().
  globalThis.filterInviteList = globalThis.filterInviteList ?? function filterInviteList(query) {
    const dropdown = globalThis.document?.getElementById?.('wr-invite-dropdown');
    if (!dropdown) return;
    const fbDb   = activeFbDb;
    const fbUser = activeFbCurrentUser;
    if (!fbDb || !fbUser?.uid) return;

    friendsService.listFriends(fbDb, fbUser.uid).then(friends => {
      const filtered = friendsService.filterFriendsByName(friends, query);
      if (!filtered.length) {
        dropdown.innerHTML = '';
        dropdown.style.display = 'none';
        return;
      }
      dropdown.innerHTML = filtered.map(f => {
        const uid   = String(f.uid  ?? '');
        const name  = String(f.name ?? '?');
        const eName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const eUid  = uid.replace(/"/g, '&quot;');
        return `<div class="wr-invite-item" data-uid="${eUid}" ` +
          `onmousedown="event.preventDefault()" onclick="wrPickFriend(this)" ` +
          `style="padding:8px 12px;cursor:pointer;font-size:13px;` +
          `border-bottom:1px solid rgba(255,255,255,.08);">${eName}</div>`;
      }).join('');
      dropdown.style.display = 'block';
    }).catch(() => {});
  };

  // Called from onclick on each dropdown item.
  globalThis.wrPickFriend = globalThis.wrPickFriend ?? function wrPickFriend(el) {
    const uid      = el?.dataset?.uid ?? '';
    const name     = el?.textContent?.trim() ?? '';
    const input    = globalThis.document?.getElementById?.('wr-invite-name');
    const dropdown = globalThis.document?.getElementById?.('wr-invite-dropdown');
    if (input) { input.value = name; input.dataset.selectedUid = uid; }
    if (dropdown) dropdown.style.display = 'none';
  };

  // Called from onclick on the שלח button.
  globalThis.crSendInvite = globalThis.crSendInvite ?? async function crSendInvite() {
    const fbDb   = activeFbDb;
    const fbUser = activeFbCurrentUser;
    const input    = globalThis.document?.getElementById?.('wr-invite-name');
    const statusEl = globalThis.document?.getElementById?.('wr-invite-status');
    if (!fbDb || !fbUser?.uid) return;

    const toUid = input?.dataset?.selectedUid;
    if (!toUid) {
      if (statusEl) { statusEl.textContent = 'בחר חבר מהרשימה'; statusEl.style.color = '#f87'; }
      return;
    }

    // activePending is set on __spine when the room is created (inside boot).
    const mode     = globalThis.__spine?.activePending?.mode ?? 'friend-live';
    const settings = settingsCompat.settingsFromLegacyGlobals(globalThis);

    // For live invites: check whether the recipient is already in an active live
    // game. If so, notify the inviter and cancel — we don't interrupt someone
    // mid-game with a live-game invite.
    const availability = await inviteService.checkRecipientAvailability(fbDb, toUid, mode);
    if (!availability.available) {
      if (statusEl) { statusEl.textContent = 'השחקן נמצא כעת במשחק ולא ניתן להזמינו'; statusEl.style.color = '#f87'; }
      return;
    }

    if (statusEl) { statusEl.textContent = 'שולח...'; statusEl.style.color = ''; }

    try {
      const { inviteId, expiresAt: inviteExpiresAt } = await inviteService.sendInvite(fbDb, {
        fromUid:    fbUser.uid,
        fromName:   globalThis.__spine?.currentProfile?.displayName ?? fbUser.displayName ?? globalThis.pNames?.[0] ?? 'שחקן',
        fromAvatar: fbUser.photoURL ?? null,
        toUid,
        mode,
        settings,
        serverTimestamp: Date.now(),
      });

      if (statusEl) { statusEl.textContent = 'ההזמנה נשלחה! ✓'; statusEl.style.color = '#4f4'; }
      if (input) { input.value = ''; delete input.dataset.selectedUid; }

      // Push notification so the invite reaches the recipient even when their
      // app is closed.
      notificationService.pushInvite({
        inviteeUid:  toUid,
        inviterName: fbUser.displayName ?? 'שחקן',
        roomId:      null,
      }).catch((e) => console.warn('[spine] pushInvite', e));

      if (mode?.endsWith('-async')) {
        // Async: cancel the pending room code so no one can join via code while
        // the direct invite is outstanding, then close the waiting overlay.
        const code = globalThis.__spine?.activePending?.code;
        await globalThis.__spine?.teardownPending?.();
        if (code && activeFbDb) {
          roomCodeService.cancelPending(activeFbDb, code)
            .catch((e) => console.warn('[spine] crSendInvite cancelPending', e));
        }
        globalThis.setTimeout?.(() => bus.emit(WR_CLOSE, {}), 1500);
      } else {
        // Live: store invite details for cleanup on expiry, then start countdown.
        const ap = globalThis.__spine?.activePending;
        if (ap) {
          ap.inviteId    = inviteId;
          ap.inviteToUid = toUid;
        }
        bus.emit(WR_LIVE_INVITE_SENT, { expiresAt: inviteExpiresAt, friendName: input?.value?.trim() || null });
      }
    } catch (e) {
      console.error('[spine] crSendInvite', e);
      if (statusEl) { statusEl.textContent = 'שגיאה בשליחת ההזמנה'; statusEl.style.color = '#f87'; }
    }
  };
}

async function ensureFirebaseGlobals() {
  if (activeFbDb && activeFbAuth) return;
  // Skip Firebase boot when the browser already knows it's offline. Without
  // this guard the auth library's proactive token refresh fires immediately,
  // hits ERR_INTERNET_DISCONNECTED on securetoken.googleapis.com, and spams
  // the console on a backoff loop. We retry when the `online` event fires
  // (see boot()).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('offline — Firebase init deferred until network returns');
  }
  const impl = await firebaseClient.ensureApp();
  activeFbDb = impl.db;
  activeFbAuth = impl.auth;
  activeFbServerTimestamp = impl.serverTimestamp;
  if (activeFbAuth?.onAuthStateChanged) {
    activeFbAuth.onAuthStateChanged((user) => {
      activeFbCurrentUser = user ?? null;
    });
    activeFbCurrentUser = activeFbAuth.currentUser ?? activeFbCurrentUser ?? null;
  }
  // While we're connected, let the Realtime Database queue local writes;
  // if it's already initialised this is a no-op.
  try { activeFbDb?.goOnline?.(); } catch { /* swallow */ }
}

// Ensure there's a signed-in Firebase user AND that the Realtime Database
// websocket has acknowledged the auth handshake. Both are needed before any
// online action can write — without the latter, `auth` evaluates to `null`
// inside the security rules and every write comes back PERMISSION_DENIED.
//
// Flow:
//   1. Sign in anonymously if there's no user.
//   2. Probe-write to /users/{uid}/lastSeen with retries. The probe only
//      resolves once the server has authenticated our websocket.
//   3. If the probe never authorizes (likely a stale/invalidated cached
//      session), forcibly sign out, sign back in anonymously, and re-probe.
let _anonAuthInFlight = null;
let _authProbedForUid = null;

async function signInAnonymouslyOnce() {
  if (typeof activeFbAuth?.signInAnonymously !== 'function') {
    throw new Error('Firebase auth API not available');
  }
  if (!_anonAuthInFlight) {
    _anonAuthInFlight = (async () => {
      try {
        const cred = await activeFbAuth.signInAnonymously();
        activeFbCurrentUser = cred?.user ?? activeFbAuth.currentUser ?? activeFbCurrentUser ?? null;
        try { await cred?.user?.getIdToken?.(); } catch { /* best-effort */ }
        return activeFbCurrentUser;
      } finally {
        _anonAuthInFlight = null;
      }
    })();
  }
  return _anonAuthInFlight;
}

async function probeAuthHandshake(uid) {
  const probeRef = activeFbDb.ref(`users/${uid}/lastSeen`);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await probeRef.set(Date.now());
      return true;
    } catch (e) {
      // Wait progressively longer between retries: 200, 400, 600, 800, 1000 ms.
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  return false;
}

async function ensureAuthedUser() {
  await ensureFirebaseGlobals();
  if (!activeFbCurrentUser?.uid) {
    await signInAnonymouslyOnce();
  }
  if (!activeFbCurrentUser?.uid) {
    throw new Error('Firebase auth failed — no user after sign-in');
  }
  // Fast path: already probed this uid this session.
  if (_authProbedForUid === activeFbCurrentUser.uid) return activeFbCurrentUser;

  // First probe: confirms RTDB handshake completed for the current user.
  if (await probeAuthHandshake(activeFbCurrentUser.uid)) {
    _authProbedForUid = activeFbCurrentUser.uid;
    return activeFbCurrentUser;
  }

  // Probe failed — most likely cause is a stale cached session whose
  // server-side token has been invalidated. Sign out, sign back in fresh,
  // and probe again.
  console.warn('[spine] auth probe failed for uid', activeFbCurrentUser.uid, '— forcing fresh anonymous sign-in');
  try { await activeFbAuth.signOut(); } catch (e) { console.warn('[spine] signOut error', e?.message ?? e); }
  activeFbCurrentUser = null;
  _authProbedForUid = null;
  await signInAnonymouslyOnce();
  if (!activeFbCurrentUser?.uid) {
    throw new Error('Firebase auth failed — anonymous sign-in returned no user');
  }
  if (await probeAuthHandshake(activeFbCurrentUser.uid)) {
    _authProbedForUid = activeFbCurrentUser.uid;
    return activeFbCurrentUser;
  }
  throw new Error('Firebase auth probe failed even after fresh sign-in');
}

function ensureDictionaryLoaded() {
  if (hebrewDictionary.DICT.size > 0) {
    return Promise.resolve(hebrewDictionary.DICT.size);
  }
  if (!dictionaryLoadPromise) {
    dictionaryLoadPromise = hebrewDictionary.loadDict()
      .then((size) => {
        console.info('[spine] dictionary size:', size);
        return size;
      })
      .catch((e) => {
        dictionaryLoadPromise = null;
        throw e;
      });
  }
  return dictionaryLoadPromise;
}

function scheduleDictionaryPreload() {
  const preload = () => {
    ensureDictionaryLoaded().catch((e) => {
      console.warn('[spine] dictionary preload failed (will retry on demand):', e);
    });
  };
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(preload, { timeout: 1500 });
    return;
  }
  globalThis.setTimeout?.(preload, 0);
}

function computeBasicSizes() {
  const grid = globalThis.document?.getElementById?.('game-grid');
  if (!grid) return;
  // The .board-center-inner wrap derives its own width/height from --csz, so
  // we must read from the parent FLEX container (.board-center) to learn how
  // much space the board is actually allowed to consume. Reading from the
  // wrap itself would feed its current rendered size (driven by --csz) back
  // into the computation and never grow.
  const innerWrap = globalThis.document?.querySelector?.('.board-center-inner');
  const wrap = globalThis.document?.querySelector?.('.board-center')
    ?? globalThis.document?.querySelector?.('.game-area')
    ?? innerWrap?.parentElement
    ?? grid.parentElement;
  const rect = wrap?.getBoundingClientRect?.();
  const base = Math.min(rect?.width || 520, rect?.height || 520);
  const size = Math.max(14, Math.floor((base - 22) / 12));
  // Set --csz on BOTH the wrap and the grid so the wrap's width/height calc
  // and the grid's template-columns/rows agree. Setting only the grid (the
  // previous behavior) left the wrap sized by the CSS clamp() and the grid
  // sized by JS — the two routinely disagreed and the board overflowed or
  // sat in a much smaller box than its container.
  const value = `${size}px`;
  if (innerWrap) innerWrap.style?.setProperty?.('--csz', value);
  grid.style?.setProperty?.('--csz', value);
}

function scheduleBasicLayoutRefresh() {
  const run = () => computeBasicSizes();
  globalThis.requestAnimationFrame?.(() => {
    run();
    globalThis.requestAnimationFrame?.(run);
  });
  globalThis.setTimeout?.(run, 60);
  globalThis.setTimeout?.(run, 240);
}

function buildSpineUnifiedGrid() {
  const doc = globalThis.document;
  const grid = doc?.getElementById?.('game-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const map = new Map();
  BDEFS.forEach((b, idx) => {
    map.set(`${b.br + 2},${b.bc + 2}`, idx);
  });
  for (let gr = 1; gr <= 12; gr++) {
    for (let gc = 1; gc <= 12; gc++) {
      const bonusIdx = map.get(`${gr},${gc}`);
      if (bonusIdx != null) {
        const el = doc.createElement('div');
        el.className = 'bsq';
        el.id = `bsq-${bonusIdx}`;
        const ba = BONUS_TYPES[bonusIdx % BONUS_TYPES.length];
        el.innerHTML = `<div class="bsq-ic">${ba?.ic ?? '⚡'}</div>`;
        grid.appendChild(el);
        continue;
      }
      if (gr >= 2 && gr <= 11 && gc >= 2 && gc <= 11) {
        const r = gr - 2;
        const c = gc - 2;
        const el = doc.createElement('div');
        el.className = 'cell';
        el.id = `c${r}_${c}`;
        grid.appendChild(el);
        continue;
      }
      const empty = doc.createElement('div');
      empty.className = 'perim';
      grid.appendChild(empty);
    }
  }
  computeBasicSizes();
}

boot().catch(e => console.error('[spine] boot failed', e));
