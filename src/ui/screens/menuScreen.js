// menuScreen — spine-owned wiring for the #sh menu.
//
// Mount semantics:
//   const menu = mountMenuScreen({ root, bus });
//   ...
//   menu.unmount();
//
import { $, on } from '../domHelpers.js';

export const MENU_INTENT = Object.freeze({
  OPEN_PROFILE:       'menu/openProfile',
  RESUME_SAVED:       'menu/resumeSaved',
  START_2P:           'menu/start2P',
  START_VS_BOT:       'menu/startVsBot',
  OPEN_ONLINE_LOBBY:  'menu/openOnlineLobby',
  OPEN_TUTORIAL:      'menu/openTutorial',
  OPEN_CHAMPIONS:     'menu/openChampions',
  OPEN_SETTINGS:      'menu/openSettings',
  SHARE_GAME:         'menu/shareGame',
  OPEN_STATS:         'menu/openStats',
  OPEN_FRIENDS:       'menu/openFriends',
  OPEN_NOTIFICATIONS: 'menu/openNotifications',
});

// The bus event the menu listens for to refresh its visible state. Other
// modules emit it to ask the menu to re-render.
export const MENU_REFRESH = 'menu/refresh';

// Map button selector → intent. The selector targets
// each menu button via its `onclick` attribute (the legacy DOM doesn't have
// per-button IDs, but the onclick string is unique).
const BUTTONS = [
  { sel: 'button[onclick="openProfileOrAuth()"]',  intent: MENU_INTENT.OPEN_PROFILE },
  { sel: 'button[onclick="resumeSavedGame()"]',    intent: MENU_INTENT.RESUME_SAVED },
  { sel: 'button[onclick="startSetup(\'vs\')"]',   intent: MENU_INTENT.START_2P, legacyArg: 'vs' },
  { sel: 'button[onclick="startSetup(\'bot\')"]',  intent: MENU_INTENT.START_VS_BOT, legacyArg: 'bot' },
  { sel: 'button[onclick="showOnlineLobby()"]',    intent: MENU_INTENT.OPEN_ONLINE_LOBBY },
  { sel: 'button[onclick="showTutorialIntro()"]',  intent: MENU_INTENT.OPEN_TUTORIAL },
  { sel: 'button[onclick="openChampions()"]',      intent: MENU_INTENT.OPEN_CHAMPIONS },
  { sel: 'button[onclick="openSettings()"]',       intent: MENU_INTENT.OPEN_SETTINGS },
  { sel: 'button[onclick="shareGame()"]',          intent: MENU_INTENT.SHARE_GAME },
  { sel: 'button[onclick="openStats()"]',          intent: MENU_INTENT.OPEN_STATS },
  { sel: 'button[onclick="openFriends()"]',        intent: MENU_INTENT.OPEN_FRIENDS },
  { sel: 'button[onclick="openNotifications()"]',  intent: MENU_INTENT.OPEN_NOTIFICATIONS },
];

export function mountMenuScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountMenuScreen: bus required');

  const menuRoot = $('#sh', root);
  if (!menuRoot) {
    console.warn('[menuScreen] #sh not found — menu not mounted');
    return { unmount() {} };
  }

  const cleanups = [];

  for (const def of BUTTONS) {
    const btn = $(def.sel, menuRoot);
    if (!btn) continue;
    btn.removeAttribute('onclick');

    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault();
      bus.emit(def.intent, { source: 'menu', legacyArg: def.legacyArg });
    }));
  }

  // Subscribe to MENU_REFRESH so external code can ask us to re-evaluate
  // the visibility of buttons that depend on app state (saved game,
  // share button, profile name).
  cleanups.push(bus.on(MENU_REFRESH, (payload = {}) => render(payload)));

  // Initial render — read current state from the spine/debug surface and
  // saved-session globals.
  function render({ hasSavedGame, isAuthed, displayName, hasOnlineUnread, rating, avatar } = {}) {
    const resumeBtn = $('#btn-resume-home', menuRoot);
    if (resumeBtn) resumeBtn.style.display = hasSavedGame ? '' : 'none';

    const shareBtn = $('#btn-share-game', menuRoot);
    if (shareBtn) {
      const wasHidden = shareBtn.style.display === 'none';
      shareBtn.style.display = isAuthed ? '' : 'none';
      // First reveal after auth resolves — fade/slide it in so it doesn't
      // snap into the menu seconds after the cascade finishes.
      //
      // Crucially we CLEAR the inline `animation` after it ends. The
      // shorthand resets `animation-delay` to 0, so a leftover inline value
      // would override the `.hbtns.menu-enter .bd:nth-child(9)
      // { animation-delay: 0.56s }` cascade rule on later menu visits —
      // making the share button animate in at 0s while the rest of the
      // cascade staggers normally.
      if (isAuthed && wasHidden) {
        shareBtn.style.animation = 'none';
        // Force a reflow so the animation restart applies.
        void shareBtn.offsetWidth;
        shareBtn.style.animation = 'menuBtnIn 0.4s cubic-bezier(0.22,1,0.36,1) both';
        const clearInlineAnim = () => {
          shareBtn.style.animation = '';
          shareBtn.removeEventListener?.('animationend', clearInlineAnim);
        };
        shareBtn.addEventListener?.('animationend', clearInlineAnim, { once: true });
      }
    }

    const nameLabel = $('#home-user-label', menuRoot);
    if (nameLabel) {
      if (displayName) {
        nameLabel.textContent = displayName;
      } else if (isAuthed === false) {
        nameLabel.textContent = 'כניסה / הרשמה';
      }
    }

    // Avatar
    const avatarEl = $('#home-avatar-ic', menuRoot);
    if (avatarEl && avatar) {
      avatarEl.textContent = avatar;
    }

    // ELO badge — show only when authenticated
    const eloLabel = $('#home-elo-label', menuRoot);
    if (eloLabel) {
      eloLabel.style.display = isAuthed ? '' : 'none';
    }
    const eloValue = $('#home-elo-value', menuRoot);
    if (eloValue && rating != null) {
      eloValue.textContent = Number(rating).toLocaleString('he');
    }

    const onlineBadge = $('#online-badge', menuRoot);
    if (onlineBadge) onlineBadge.style.display = hasOnlineUnread ? '' : 'none';
  }

  // Pull initial values opportunistically; legacy code mutates these
  // globals at boot, so by the time we mount we usually see the right
  // state. If we mount too early, the legacy code's later mutations will
  // re-apply directly to the DOM.
  render({
    hasSavedGame:    !!(globalThis.savedSession || globalThis._lastSavedSessionRef),
    isAuthed:        !!(globalThis.__spine?.currentUser && !globalThis.__spine.currentUser.isAnonymous),
    displayName:     globalThis.pNames?.[0] ?? null,
    hasOnlineUnread: false,
  });

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups.length = 0;
    },
  };
}
