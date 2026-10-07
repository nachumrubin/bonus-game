// profileScreen — wires #sprofile.
//
// Paints profile render events into displayName / avatar / stats. Click handlers emit intents:
//   - PROFILE_INTENT.EDIT_NAME      (player tapped the name)
//   - PROFILE_INTENT.SAVE_NAME      (after edit input → save button)
//   - PROFILE_INTENT.OPEN_AVATARS
//   - PROFILE_INTENT.OPEN_FRIENDS
//   - PROFILE_INTENT.OPEN_STATS
//   - CHAMPS_OPEN                 (טבלת דירוגים row → #ov-champs)
//   - PROFILE_INTENT.UPGRADE_ACCOUNT (anonymous → signup)
//   - PROFILE_INTENT.LOGOUT
//   - PROFILE_INTENT.BACK
//
// main.js subscribes to these to drive profileService / friendsService / auth flows.

import { $, on, setText } from '../domHelpers.js';
import { avatarIconSrc, ANON_AVATAR_SRC } from './avatarScreens.js';
import { profileAvatarValue } from '../../game/account/boostieXp.js';
import { startIdle } from '../avatarMotion/idleMotion.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';
import { CHAMPS_OPEN } from './championsScreen.js';

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
  bindClick('#btn-profile-champs',                   CHAMPS_OPEN);
  bindClick('button[onclick="showStatsScreen()"]',   PROFILE_INTENT.OPEN_STATS);
  bindClick('button[onclick="logoutUser()"]',        PROFILE_INTENT.LOGOUT);
  bindClick('button[onclick="goHome()"]',            PROFILE_INTENT.BACK);
  if (upgradeBtn) {
    upgradeBtn.removeAttribute?.('onclick');
    cleanups.push(on(upgradeBtn, 'click', () => bus.emit(PROFILE_INTENT.UPGRADE_ACCOUNT, {})));
  }

  let idle = null;
  function render({ profile, isAnonymous, email } = {}) {
    if (!profile) return;
    if (avatarEl) {
      // The equipped Boostie at its current level (old avatar ids → the starter).
      const iconSrc = avatarIconSrc(profileAvatarValue(profile));
      const cur = avatarEl.firstElementChild;
      if (!(cur?.tagName === 'IMG' && cur.getAttribute?.('src') === iconSrc)) {
        avatarEl.innerHTML = `<img class="pf-avatar-img" src="${iconSrc}" alt="">`;
        const img = avatarEl.firstElementChild;
        if (img) img.onerror = () => { img.onerror = null; img.src = ANON_AVATAR_SRC; };
      }
      // Calm screen → the avatar breathes (and glances now and then). Started
      // after the screen transition so the visibility check sees it shown.
      if (!idle?.running) setTimeout(() => { if (!idle?.running) idle = startIdle(avatarEl, { secondary: true }); }, 350);
    }
    if (nameEl)    setText(nameEl,   profile.displayName ?? '');
    if (emailEl) setText(emailEl, email ?? '');
    // Glass-skin pills under the name: ELO + coin balance (hidden when unknown).
    const rating = Number(profile.rating);
    const coins = Number(profile.coins);
    const eloPill = $('#profile-elo-pill', root);
    const coinsPill = $('#profile-coins-pill', root);
    if (eloPill) {
      eloPill.style.display = Number.isFinite(rating) && rating > 0 ? '' : 'none';
      setText($('#profile-elo-val', root), String(Math.round(rating) || 0));
    }
    if (coinsPill) {
      coinsPill.style.display = Number.isFinite(coins) ? '' : 'none';
      setText($('#profile-coins-val', root), String(Math.max(0, Math.floor(coins) || 0)));
    }
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
      idle?.stop();
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
