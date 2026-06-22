// menuScreen — spine-owned wiring for the #sh menu.
//
// Mount semantics:
//   const menu = mountMenuScreen({ root, bus });
//   ...
//   menu.unmount();
//
import { $, on } from '../domHelpers.js';
import { avatarIconSrc, ANON_AVATAR_SRC } from './avatarScreens.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

export const MENU_INTENT = Object.freeze({
  OPEN_PROFILE:       'menu/openProfile',
  RESUME_SAVED:       'menu/resumeSaved',
  START_2P:           'menu/start2P',
  START_VS_BOT:       'menu/startVsBot',
  OPEN_ONLINE_LOBBY:  'menu/openOnlineLobby',
  OPEN_TUTORIAL:      'menu/openTutorial',
  OPEN_GUIDE:         'menu/openGuide',
  OPEN_FAQ:           'menu/openFaq',
  OPEN_HELP_MENU:     'menu/openHelpMenu',
  OPEN_SETTINGS:      'menu/openSettings',
  SHARE_GAME:         'menu/shareGame',
  OPEN_STATS:         'menu/openStats',
  OPEN_FRIENDS:       'menu/openFriends',
  OPEN_MY_GAMES:      'menu/openMyGames',
  OPEN_NOTIFICATIONS: 'menu/openNotifications',
  TOPBAR_MUSIC:       'menu/topbarMusic',
});

// The bus event the menu listens for to refresh its visible state. Other
// modules emit it to ask the menu to re-render.
export const MENU_REFRESH = 'menu/refresh';

// Topbar buttons live in #global-topbar (outside #sh) — available on all screens.
const TOPBAR_BUTTONS = [
  { sel: 'button[onclick="openProfileOrAuth()"]',  intent: MENU_INTENT.OPEN_PROFILE },
  { sel: 'button[onclick="openNotifications()"]',  intent: MENU_INTENT.OPEN_NOTIFICATIONS },
  { sel: '#topbar-music-btn',                      intent: MENU_INTENT.TOPBAR_MUSIC },
  { sel: 'button[onclick="openSettings()"]',       intent: MENU_INTENT.OPEN_SETTINGS },
  { sel: '#topbar-help-btn',                       intent: MENU_INTENT.OPEN_HELP_MENU },
];

// Screen buttons live inside #sh (home screen only).
// The home bottom-nav "הישגים" (trophy) button keeps its inline
// `onclick="showAvatarGallery()"` — that legacy global already emits
// PROFILE_INTENT.OPEN_AVATARS, so no dedicated bus intent is needed.
const SCREEN_BUTTONS = [
  { sel: 'button[onclick="startSetup(\'vs\')"]',   intent: MENU_INTENT.START_2P, legacyArg: 'vs' },
  { sel: 'button[onclick="startSetup(\'bot\')"]',  intent: MENU_INTENT.START_VS_BOT, legacyArg: 'bot' },
  { sel: 'button[onclick="showOnlineLobby()"]',    intent: MENU_INTENT.OPEN_ONLINE_LOBBY },
  { sel: 'button[onclick="openStats()"]',          intent: MENU_INTENT.OPEN_STATS },
  { sel: 'button[onclick="openFriends()"]',        intent: MENU_INTENT.OPEN_FRIENDS },
  { sel: 'button[onclick="openMyGames()"]',        intent: MENU_INTENT.OPEN_MY_GAMES },
];

function ratingTierEmoji(rating) {
  if (rating >= 1200) return '💎';
  if (rating >= 950)  return '🥇';
  if (rating >= 800)  return '🥈';
  return '🪙';
}

// Render the equipped avatar as its achievement trophy icon when one exists,
// otherwise the plain emoji/glyph. `value` may be an avatar id or an emoji.
function setAvatarDisplay(el, value) {
  const src = avatarIconSrc(value);
  if (src) el.innerHTML = `<img class="em-avatar-img" src="${src}" alt="">`;
  else el.textContent = value;
}

export function mountMenuScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountMenuScreen: bus required');

  const menuRoot = $('#sh', root);
  if (!menuRoot) {
    console.warn('[menuScreen] #sh not found — menu not mounted');
    return { unmount() {} };
  }

  // Topbar lives in #global-topbar (static HTML in index.html, outside #app-shell).
  const topbarRoot = $('#global-topbar', root) ?? menuRoot;

  const cleanups = [];

  for (const def of TOPBAR_BUTTONS) {
    const btn = $(def.sel, topbarRoot);
    if (!btn) continue;
    btn.removeAttribute('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault();
      bus.emit(def.intent, { source: 'menu' });
    }));
  }

  for (const def of SCREEN_BUTTONS) {
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
  function render({ isAuthed, displayName, unreadCount, rating, avatar, myGamesCount, myTurnInGame } = {}) {
    // The legacy "Resume game" button was removed in favour of the
    // "המשחקים שלי" list, which surfaces both async-online sessions and
    // the local saved game in one place.

    // Display elements are in the global topbar
    const nameLabel = $('#home-user-label', topbarRoot);
    if (nameLabel) {
      if (displayName) {
        nameLabel.textContent = displayName;
      } else if (isAuthed === false) {
        nameLabel.textContent = 'כניסה / הרשמה';
      }
    }

    // Avatar — reset to the default 👤 on sign-out so the previous user's
    // avatar doesn't linger in the topbar. Only overwrite with the saved
    // avatar when explicitly provided.
    const avatarEl = $('#home-avatar-ic', topbarRoot);
    if (avatarEl) {
      if (avatar) setAvatarDisplay(avatarEl, avatar);
      else if (isAuthed === false) avatarEl.innerHTML = `<img class="em-avatar-img" src="${ANON_AVATAR_SRC}" alt="">`;
    }

    // Bell — show only when authenticated (guests have no invites to receive)
    const bellBtn = $('#btn-notifications-home', topbarRoot);
    if (bellBtn && isAuthed !== undefined) {
      bellBtn.style.display = isAuthed ? '' : 'none';
    }

    // ELO badge — show only when authenticated
    const eloLabel = $('#home-elo-label', topbarRoot);
    if (eloLabel && isAuthed !== undefined) {
      eloLabel.style.display = isAuthed ? '' : 'none';
    }
    const eloValue = $('#home-elo-value', topbarRoot);
    if (eloValue && rating != null) {
      eloValue.textContent = Number(rating).toLocaleString('he');
    }
    const eloBolt = $('#home-elo-bolt', topbarRoot);
    if (eloBolt && rating != null) {
      eloBolt.textContent = ratingTierEmoji(Number(rating));
    }

    // Bottom nav — only visible when signed in
    const bottomNav = $('#home-bottom-nav', menuRoot);
    if (bottomNav && isAuthed !== undefined) {
      bottomNav.style.display = isAuthed ? '' : 'none';
    }

    // Bell badge (#online-badge) reflects ONLY notification-inbox items:
    // game invites + friend requests (the `unreadCount`). It must NOT light
    // up for "it's your turn" async games — those have no entry in the inbox,
    // so a lit bell over an empty inbox looked like a bug. The my-turn signal
    // drives the My-Games badge colour instead (myTurnInGame, below).
    const onlineBadge = $('#online-badge', topbarRoot);
    if (onlineBadge && unreadCount != null) {
      const count = Number(unreadCount);
      onlineBadge.style.display = count > 0 ? '' : 'none';
      onlineBadge.textContent   = count > 0 ? String(count) : '';
    }

    // Bottom-nav "My Games" bubble — the count of open games (active async
    // rooms + the local saved offline game, expired rooms excluded). null
    // means "no update this render"; we leave the badge alone in that case.
    const mgBadge = $('#mg-nav-badge', menuRoot);
    if (mgBadge) {
      if (myGamesCount != null) {
        const n = Number(myGamesCount);
        mgBadge.style.display = n > 0 ? '' : 'none';
        mgBadge.textContent   = n > 0 ? String(n) : '';
      }
      // Green when it's the player's turn in at least one game; red otherwise.
      // null/undefined means "no update this render" — leave the colour as-is.
      if (myTurnInGame != null) {
        mgBadge.classList?.toggle('em-nav-badge--myturn', !!myTurnInGame);
      }
    }
  }

  // Pull initial values opportunistically; legacy code mutates these
  // globals at boot, so by the time we mount we usually see the right
  // state. If we mount too early, the legacy code's later mutations will
  // re-apply directly to the DOM.
  render({
    isAuthed:        !!(globalThis.__spine?.currentUser && !globalThis.__spine.currentUser.isAnonymous),
    displayName:     globalThis.pNames?.[0] ?? null,
  });

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch { /* swallow */ }
      cleanups.length = 0;
    },
  };
}

// Keep this in sync with the home screen layout (home.html).
registerOnboardingContent('sh', {
  icon: '🎉',
  title: 'ברוך הבא לבוסט!',
  intro: 'בוסט הוא משחק מילים בעברית, עם טוויסט: לאורך המשחק תפתחו מיני-משחקים שמעניקים נקודות בוסט.',
  bullets: [
    '🔤 מילים בעברית — סדרו אותיות למילים על הלוח וצברו נקודות',
    '⚡ בוסטים — מיני-משחקים שמזכים אתכם בנקודות בוסט',
    '📊 סטטיסטיקות ותובנות — עקבו אחרי ההתקדמות והשתפרו',
    '🎮 מצבי משחק — ברשת, מול חבר על אותו מכשיר, או נגד המחשב',
  ],
  note: 'למידע נוסף וחוקי המשחק — לחצו על ❓ בראש המסך',
});
