// profileScreen — wires #sprofile.
//
// Paints profile render events into displayName / avatar / stats. Click handlers emit intents:
//   - PROFILE_INTENT.EDIT_NAME      (player tapped the name)
//   - PROFILE_INTENT.SAVE_NAME      (after edit input → save button)
//   - PROFILE_INTENT.OPEN_AVATARS
//   - PROFILE_INTENT.OPEN_FRIENDS
//   - PROFILE_INTENT.OPEN_STATS
//   - PROFILE_INTENT.UPGRADE_ACCOUNT (anonymous → signup)
//   - PROFILE_INTENT.LOGOUT
//   - PROFILE_INTENT.BACK
//
// main.js subscribes to these to drive profileService / friendsService / auth flows.

import { $, on, setText } from '../domHelpers.js';
import { SPINE_AVATARS, avatarIconSrc, ANON_AVATAR_SRC } from './avatarScreens.js';
import { isStoreAvatarId } from './avatarStore.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

export const PROFILE_INTENT = Object.freeze({
  EDIT_NAME:        'profile/editName',
  CANCEL_EDIT_NAME: 'profile/cancelEditName',
  SAVE_NAME:        'profile/saveName',
  OPEN_AVATARS:     'profile/openAvatars',
  OPEN_STORE:       'profile/openStore',
  OPEN_FRIENDS:     'profile/openFriends',
  OPEN_STATS:       'profile/openStats',
  UPGRADE_ACCOUNT:  'profile/upgradeAccount',
  LOGOUT:           'profile/logout',
  BACK:             'profile/back',
});

export const PROFILE_RENDER = 'profile/render';

// Avatar id → emoji table. Derived from SPINE_AVATARS so additions there are
// automatically reflected here. Falls back to 👑 (the legacy DEFAULT_AVATAR).
const AVATAR_EMOJI = Object.fromEntries(SPINE_AVATARS.map(a => [a.id, a.emoji]));
const KNOWN_AVATAR_EMOJIS = new Set(Object.values(AVATAR_EMOJI));

// Resolve an avatar value to its emoji character.
// Accepts an id ('diamond' → '💎'), an already-resolved emoji ('💎' → '💎'),
// or null/undefined/unknown (→ '👑'). The pass-through case matters because
// some legacy code paths (queue entries, invites, room players) store the
// raw emoji string directly while others store the id — both should render.
export function avatarEmoji(value) {
  if (value == null) return AVATAR_EMOJI.crown;
  if (typeof value !== 'string') return AVATAR_EMOJI.crown;
  if (AVATAR_EMOJI[value]) return AVATAR_EMOJI[value];
  if (KNOWN_AVATAR_EMOJIS.has(value)) return value;
  // Store avatars are image-only and have no emoji. Pass the id through
  // unchanged so it survives into room/queue player objects (player.avatar);
  // consumers resolve it to its PNG via avatarIconSrc. Without this the id
  // would collapse to 👑 at the room boundary and never show on opponents.
  if (isStoreAvatarId(value)) return value;
  return AVATAR_EMOJI.crown;
}

// Pure: derive a derived stats object including winRate.
export function deriveStats(profile) {
  const s = profile?.stats ?? {};
  const played = s.gamesPlayed ?? 0;
  const won    = s.gamesWon    ?? 0;
  const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
  return {
    gamesPlayed:    played,
    gamesWon:       won,
    winRate,
    highScore:      s.highScore     ?? 0,
    longestStreak:  s.longestStreak ?? 0,
    currentStreak:  s.currentStreak ?? 0,
  };
}

export function mountProfileScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountProfileScreen: bus required');

  const screenEl = $('#sprofile', root);
  const avatarEl = $('#profile-avatar-display', root);
  const nameEl   = $('#profile-name-display',  root);
  const editWrap = $('#profile-name-edit',     root);
  const nameInput = $('#profile-name-input',   root);
  const nameError = $('#profile-name-error',   root);
  const upgradeBtn = $('#btn-upgrade-account', root);
  const emailEl  = $('#profile-email-display', root);

  const stPlayed     = $('#stat-played',        root);
  const stWins       = $('#stat-wins',          root);
  const stWinrate    = $('#stat-winrate',       root);
  const stHighScore  = $('#stat-highscore',     root);
  const stLongStreak = $('#stat-longeststreak', root);
  const stStreak     = $('#stat-streak',        root);

  const cleanups = [];

  function bindClick(sel, intent) {
    let btns = [];
    if (screenEl?.querySelectorAll) {
      btns = Array.from(screenEl.querySelectorAll(sel));
    } else {
      const fallback = $(sel, root) ?? (sel.startsWith('[onclick=') ? $(`button${sel}`, root) : null);
      if (fallback) btns = [fallback];
    }
    for (const btn of btns) {
      btn.removeAttribute?.('onclick');
      cleanups.push(on(btn, 'click', (e) => {
        e?.preventDefault?.();
        bus.emit(intent, {});
      }));
    }
  }

  // Name display click → enter edit mode.
  if (nameEl) {
    nameEl.removeAttribute?.('onclick');
    cleanups.push(on(nameEl, 'click', () => {
      bus.emit(PROFILE_INTENT.EDIT_NAME, { current: nameEl.textContent });
      if (editWrap) editWrap.style.display = '';
      if (nameInput) {
        nameInput.value = nameEl.textContent ?? '';
        nameInput.focus?.();
      }
    }));
  }

  bindClick('button[onclick="saveDisplayName()"]', PROFILE_INTENT.SAVE_NAME);
  bindClick('button[onclick="cancelNameEdit()"]',  PROFILE_INTENT.CANCEL_EDIT_NAME);
  // The avatar ring (div) and the labeled store button both open the store.
  bindClick('[onclick="showAvatarStore()"]', PROFILE_INTENT.OPEN_STORE);
  bindClick('button[onclick="showFriendsScreen()"]', PROFILE_INTENT.OPEN_FRIENDS);
  bindClick('button[onclick="showStatsScreen()"]',   PROFILE_INTENT.OPEN_STATS);
  bindClick('button[onclick="logoutUser()"]',        PROFILE_INTENT.LOGOUT);
  bindClick('button[onclick="goHome()"]',            PROFILE_INTENT.BACK);
  if (upgradeBtn) {
    upgradeBtn.removeAttribute?.('onclick');
    cleanups.push(on(upgradeBtn, 'click', () => bus.emit(PROFILE_INTENT.UPGRADE_ACCOUNT, {})));
  }

  function render({ profile, isAnonymous, email } = {}) {
    if (!profile) return;
    if (avatarEl) {
      const iconSrc = avatarIconSrc(profile.equippedAvatar);
      if (iconSrc) {
        avatarEl.innerHTML = `<img class="pf-avatar-img" src="${iconSrc}" alt="">`;
        const img = avatarEl.firstElementChild;
        if (img) img.onerror = () => { avatarEl.innerHTML = `<img class="pf-avatar-img" src="${ANON_AVATAR_SRC}" alt="">`; };
      } else {
        const emoji = avatarEmoji(profile.equippedAvatar);
        if (emoji && emoji !== AVATAR_EMOJI.crown) {
          setText(avatarEl, emoji);
        } else {
          avatarEl.innerHTML = `<img class="pf-avatar-img" src="${ANON_AVATAR_SRC}" alt="">`;
        }
      }
    }
    if (nameEl)    setText(nameEl,   profile.displayName ?? '');
    if (emailEl) setText(emailEl, email ?? '');
    if (upgradeBtn) upgradeBtn.style.display = isAnonymous ? '' : 'none';
    const s = deriveStats(profile);
    if (stPlayed)     setText(stPlayed,     String(s.gamesPlayed));
    if (stWins)       setText(stWins,       String(s.gamesWon));
    if (stWinrate)    setText(stWinrate,    `${s.winRate}%`);
    if (stHighScore)  setText(stHighScore,  String(s.highScore));
    if (stLongStreak) setText(stLongStreak, String(s.longestStreak));
    if (stStreak)     setText(stStreak,     String(s.currentStreak));
  }
  cleanups.push(bus.on(PROFILE_RENDER, render));

  function showError(msg) { if (nameError) setText(nameError, msg ?? ''); }

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
    showError,
    _isMounted: () => !!screenEl,
  };
}

// Keep this in sync with profile-screen.html.
registerOnboardingContent('sprofile', {
  iconHtml: '<img class="screen-hd-icon" src="assets/avatars/anonymous player.png" alt="">',
  title: 'הפרופיל שלי',
  bullets: [
    '✏️ לחץ על השם לעריכה',
    '🖼 לחץ על האווטאר לשינוי מהגלריה',
    '⭐ דירוג ELO — עולה עם ניצחון, יורד עם הפסד',
    '📊 סטטיסטיקות מלאות — לחץ לצפייה בכל הנתונים',
  ],
});
