// Avatar + achievement screens:
//   - avatar helpers (avatarIconSrc / avatarMarkup / setAvatarEl) — every avatar slot
//     in the app renders through these; avatars are Boosties (boostieCatalog.js).
//   - ACHIEVEMENTS + their pure evaluation (achievementMetric & co).
//   - mountAvatarPickerScreen — wires #sav-gallery (the trophy room).
//   - mountAvatarUnlockedScreen — wires #ov-avatar-unlocked overlay.

import { $, on, setText } from '../domHelpers.js';
import { COIN_ICON_HTML } from './coinIcon.js';
import { playOnImg, canPlayNow, preloadFor } from '../avatarMotion/spritePlayer.js';
import { confettiBurst } from './miniGames/bonusFx.js';
import { specialFor, playUnlockSpecial } from '../avatarMotion/unlockFx.js';
import { parseBoostieAvatar, boostieStillSrc, DEFAULT_BOOSTIE, BOOSTIES } from '../../game/account/boostieCatalog.js';
import { normalizeBoosties } from '../../game/account/boostieXp.js';

export const AV_INTENT = Object.freeze({
  SELECT:     'avatar/select',
  EQUIP:      'avatar/equip',
  CLOSE:      'avatar/close',
  UNLOCK_ACK: 'avatar/unlockAck',
});

export const AV_RENDER = 'avatar/render';
export const AV_UNLOCK_OPEN  = 'avatar/unlockOpen';
export const AV_UNLOCK_CLOSE = 'avatar/unlockClose';
// { bumps: [{ achievement, from, to, target }] } — progress moved on unfinished achievements.
export const AV_PROGRESS_BUMP = 'avatar/progressBump';

// Named achievements — collectible "trophies". Completing one awards COINS
// (by tier — see profileService.ACHIEVEMENT_COIN_REWARD). Each entry has a `condition`:
//   { stat, min }                       — numeric profile-stat threshold
//   { type:'boostieLevel', min }        — any owned Boostie reached this level
//   { type:'boostiesUnlocked', min }    — Boosties owned beyond the starters
//   { type:'reactionsOwned', min }      — reactions bought in the store
// `emoji` is the fallback when the trophy PNG is missing. `tier` drives the coin reward.
// Definitions and pure checks live in game/account/achievements.js (the coin worker
// checks them too); re-exported here for the screens.
export { ACHIEVEMENTS, achievementSnapshot, achievementMetric, isAchievementComplete } from '../../game/account/achievements.js';
import { ACHIEVEMENTS, achievementSnapshot, achievementMetric, isAchievementComplete } from '../../game/account/achievements.js';

// Trophy-room icon art lives in assets/achievements/, one PNG per
// achievement named exactly after its Hebrew title (`titleHe`). The path is
// derived from the title (URL-encoded at render time); if a file is missing
// the tile falls back to the reward avatar's emoji via the img onerror.
const ACH_ICON_DIR = 'assets/achievements/';
const ACH_LOCK_ICON = 'assets/ui/lock.png';

export function achievementIconSrc(achievement) {
  return achievement?.titleHe ? encodeURI(ACH_ICON_DIR + achievement.titleHe + '.png') : null;
}

export const BOT_AVATAR_SRC = 'assets/avatars/bot.png';

// Per-difficulty bot avatars: stills of the bots' 3D models (AVATAR_EVOLUTION §9), also
// on the setup screen's level cards. 'bot' (generic) stays valid for older saved games.
export const BOT_AVATAR_BY_LEVEL = Object.freeze(['bot_easy', 'bot_medium', 'bot_hard']);
const BOT_LEVEL_SRC = Object.freeze({
  bot: BOT_AVATAR_SRC,
  bot_easy: 'assets/avatars/bots/bot_easy_{kind}.webp',
  bot_medium: 'assets/avatars/bots/bot_medium_{kind}.webp',
  bot_hard: 'assets/avatars/bots/bot_hard_{kind}.webp',
});
export function botStillSrc(id, kind = 'bust') {
  return BOT_LEVEL_SRC[id].replace('{kind}', kind === 'full' ? 'full' : 'bust');
}
export function botModelSrc(id) {   // the 3D model (Phase 3); the generic 'bot' has none
  return id !== 'bot' && Object.hasOwn(BOT_LEVEL_SRC, id) ? `assets/boosties/${id}.glb` : null;
}
export function botAvatarForLevel(difficulty) {
  return BOT_AVATAR_BY_LEVEL[Number(difficulty)] ?? 'bot';
}
export function isBotAvatar(value) {
  return typeof value === 'string' && Object.hasOwn(BOT_LEVEL_SRC, value);
}

// Avatars are Boosties (boostieCatalog.js). A value is 'zapi:4' / 'zapi' / { id, level }.
// Bots keep their own art. Any other id-like value (an old avatar id still on a dev
// profile or room) shows the starter Boostie at level 1. Non-id text (an emoji such as
// a banner's '🔔') and null / '' / '👤' → null; callers render the text or the
// anonymous portrait.
const AVATAR_ID_RE = /^[a-z][a-z0-9_]*(?::\d+)?$/;
export function avatarIconSrc(value, { kind = 'bust' } = {}) {
  if (value == null || value === '') return null;
  if (isBotAvatar(value)) return encodeURI(botStillSrc(value, kind));
  const b = parseBoostieAvatar(value);
  if (b) return boostieStillSrc(b.id, b.level, kind);
  return typeof value === 'string' && AVATAR_ID_RE.test(value) ? boostieStillSrc(DEFAULT_BOOSTIE, 1, kind) : null;
}

function escapeAvatar(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const ANON_AVATAR_SRC = 'assets/avatars/anonymous player.png';

// Text for an avatar value with no image (an emoji passed as the avatar), else the fallback.
export function avatarText(value, fallback = '👤') {
  return (typeof value === 'string' && value !== '') ? value : fallback;
}

// Avatar as an HTML string: the Boostie (or bot) still <img>; with no avatar,
// the anonymous portrait, or the escaped `fallback` text when one is given. `className` controls the img sizing
// (defaults to `.av-img`, which scales with the container font-size).
export function avatarMarkup(value, { fallback = '👤', className = 'av-img' } = {}) {
  const src = avatarIconSrc(value);
  if (src) return `<img class="${className}" src="${src}" alt="">`;
  const text = avatarText(value, fallback);
  if (text === '👤') return `<img class="${className}" src="${ANON_AVATAR_SRC}" alt="">`;
  return escapeAvatar(text);
}

// Same, but writes into an existing element (img via innerHTML, else emoji
// via textContent).
export function setAvatarEl(el, value, { fallback = '👤', className = 'av-img' } = {}) {
  if (!el) return;
  const src = avatarIconSrc(value)
    ?? (avatarText(value, fallback) === '👤' ? ANON_AVATAR_SRC : null);
  if (src) {
    // Callers re-render every frame of state (e.g. gameScreen.renderPlayerIdentity).
    // Leave an identical <img> alone so a running pose animation (avatarMotion,
    // which lays a canvas next to it) and the decoded image both survive.
    const cur = el.firstElementChild;
    if (cur?.tagName === 'IMG' && cur.getAttribute?.('src') === src && cur.classList?.contains?.(className)) return;
    el.innerHTML = `<img class="${className}" src="${src}" alt="">`;
    return;
  }
  el.textContent = avatarText(value, fallback);
}

// Returns 0–1 representing how close the player is to completing an achievement.
export function progressPct(achievement, stats = {}) {
  const val = stats[achievement.condition.stat] ?? 0;
  return Math.min(1, val / achievement.condition.min);
}

// 0–1 progress fraction toward an achievement (any condition type).
export function achievementProgressPct(ach, data = {}) {
  const { current, target } = achievementMetric(ach, data);
  return target > 0 ? Math.min(1, current / target) : 1;
}

// Pure: achievements newly completed between two profile-like snapshots
// (achievementSnapshot). Drives coin payout + the completion popup.
export function diffNewlyCompletedAchievements(prev = {}, next = {}) {
  const out = [];
  for (const ach of ACHIEVEMENTS) {
    if (!isAchievementComplete(ach, prev) && isAchievementComplete(ach, next)) out.push(ach);
  }
  return out;
}

// Pure: unfinished achievements whose progress moved between two snapshots,
// closest-to-done first (at most `limit`). Completed ones are excluded — they
// get the full unlock overlay instead. Drives the end-game progress strip.
export function progressBumps(prev = {}, next = {}, { limit = 2 } = {}) {
  const out = [];
  for (const ach of ACHIEVEMENTS) {
    const before = achievementMetric(ach, prev);
    const after = achievementMetric(ach, next);
    if (after.current <= before.current || after.current >= after.target || after.target <= 0) continue;
    out.push({ achievement: ach, from: before.current, to: after.current, target: after.target });
  }
  out.sort((a, b) => (b.to / b.target) - (a.to / a.target));
  return out.slice(0, limit);
}

// Pure: the unfinished achievement closest to completion (ties → catalogue
// order), as a bump-shaped row { achievement, from, to, target } with
// from === to. Drives the end screen's "next achievement" row when no
// progress moved this game. null when everything is done / no data.
export function nextAchievement(snapshot = {}) {
  if (!snapshot || (!snapshot.stats && !snapshot.boosties && !snapshot.ownedReactions)) return null;
  let best = null;
  let bestPct = -1;
  for (const ach of ACHIEVEMENTS) {
    const { current, target } = achievementMetric(ach, snapshot);
    if (target <= 0 || current >= target) continue;
    const pct = current / target;
    if (pct > bestPct) { bestPct = pct; best = { achievement: ach, from: current, to: current, target }; }
  }
  return best;
}

// ── Avatar picker screen ───────────────────────────────────

export function mountAvatarPickerScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAvatarPickerScreen: bus required');

  const grid    = $('#av-gallery-grid', root);
  const countEl = $('#av-gallery-count',root);
  const hintEl  = $('#av-locked-hint',  root);
  const backBtn = $('button[onclick="showProfileScreen()"]', root);

  const cleanups = [];

  if (backBtn) {
    backBtn.removeAttribute?.('onclick');
    cleanups.push(on(backBtn, 'click', (e) => {
      e?.preventDefault?.();
      bus.emit(AV_INTENT.CLOSE, {});
    }));
  }

  // Latest economy context from AV_RENDER (coin reward per tier comes from
  // profileService.ACHIEVEMENT_COIN_REWARD, passed in so this UI module stays
  // decoupled from the game/account layer).
  let coinRewardByTier = {};

  function rewardFor(ach) {
    return Number(coinRewardByTier?.[ach.tier]) || 0;
  }

  // One collectible TROPHY tile per achievement. Trophies are view-only — they
  // no longer equip an avatar; completing one pays out coins. Each tile shows
  // progress (cur/target) and the coin prize. (data-ach-id, not an avatar id.)
  function cellHtml(ach, data) {
    const complete = isAchievementComplete(ach, data);
    const { current, target } = achievementMetric(ach, data);
    const badge = `${Math.min(current, target)}/${target}`;
    const emoji = ach.emoji ?? '🏆';
    const icon = `<img class="ach-ic-img" src="${achievementIconSrc(ach)}" alt="">`
      + `<span class="ach-ic-emoji" style="display:none">${emoji}</span>`;
    const cls = ['ach-iccell'];
    if (!complete) cls.push('is-locked');
    return `<button class="${cls.join(' ')}" data-ach-id="${ach.id}"${complete ? '' : ' data-locked="1"'}>`
      + `<span class="ach-ic">${icon}`
      + (complete ? '' : `<img class="ach-lock" src="${ACH_LOCK_ICON}" alt="" aria-hidden="true">`)
      + `</span>`
      + `<span class="ach-lbl-title">${ach.titleHe}</span>`
      + `<span class="ach-badge ${complete ? 'is-gold' : 'is-gray'}">${badge}</span>`
      + `<span class="ach-reward">${COIN_ICON_HTML} ${rewardFor(ach)}</span>`
      + `</button>`;
  }

  let prevCompletedIds = null;
  let lastData = achievementSnapshot(null);

  // AV_RENDER { stats, boosties, ownedReactions, coinRewardByTier }
  function paint({ coinRewardByTier: rewards, ...profile } = {}) {
    if (rewards) coinRewardByTier = rewards;
    lastData = achievementSnapshot(profile);
    if (!grid) return;
    const completed = ACHIEVEMENTS.filter(a => isAchievementComplete(a, lastData));
    if (countEl) setText(countEl, `${completed.length} מתוך ${ACHIEVEMENTS.length} הושגו`);
    const barEl = $('#av-gallery-bar', root);
    if (barEl?.style) barEl.style.width = `${Math.round((completed.length / Math.max(1, ACHIEVEMENTS.length)) * 100)}%`;

    const cells = ACHIEVEMENTS.map(ach => cellHtml(ach, lastData));
    // Pad the final shelf to a full row of 3 so columns stay aligned.
    while (cells.length % 3 !== 0) {
      cells.push('<span class="ach-iccell ach-iccell--empty" aria-hidden="true"></span>');
    }

    let html = '';
    for (let i = 0; i < cells.length; i += 3) {
      html += '<div class="ach-shelf"><div class="ach-plank"></div>'
        + '<div class="ach-shelf-cells">' + cells.slice(i, i + 3).join('') + '</div></div>';
    }
    grid.innerHTML = html;

    // Completion animation: animate tiles that just completed since the
    // previous paint. Skip the first paint so we don't flash everything.
    const nowCompleted = new Set(completed.map(a => a.id));
    if (prevCompletedIds) {
      for (const id of nowCompleted) {
        if (!prevCompletedIds.has(id)) {
          grid.querySelector?.(`.ach-iccell[data-ach-id="${id}"]`)
            ?.classList?.add?.('ach-iccell--just-unlocked');
        }
      }
    }
    prevCompletedIds = nowCompleted;

    // Fall back to the emoji if an icon PNG is missing/not-yet-added.
    for (const img of grid.querySelectorAll?.('.ach-ic-img') ?? []) {
      img.onerror = () => {
        img.style.display = 'none';
        const em = img.parentElement?.querySelector?.('.ach-ic-emoji');
        if (em) em.style.display = 'flex';
      };
    }
  }

  // Tapping a trophy shows its description + coin prize (no equip).
  if (grid) {
    cleanups.push(on(grid, 'click', (e) => {
      const t = e.target;
      const btn = t?.tagName === 'BUTTON' ? t : t?.closest?.('button');
      if (!btn) return;
      const id = btn.getAttribute?.('data-ach-id');
      if (!id) return;
      const ach = ACHIEVEMENTS.find(a => a.id === id);
      if (!ach || !hintEl) return;
      const reward = rewardFor(ach);
      const complete = !btn.getAttribute('data-locked');
      // innerHTML (not setText) so the inline coin <img> renders; the text comes
      // from our own ACHIEVEMENTS data (no user input).
      hintEl.innerHTML = complete
        ? `${ach.titleHe} — הושלם! פרס: ${reward} ${COIN_ICON_HTML}`
        : `נעול — ${ach.descHe} · פרס: ${reward} ${COIN_ICON_HTML}`;
      hintEl.style.opacity = '1';
      setTimeout(() => { if (hintEl) hintEl.style.opacity = '0'; }, 2200);
    }));
  }

  cleanups.push(bus.on(AV_RENDER, paint));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}

// ── Avatar-unlocked overlay ────────────────────────────────

export function mountAvatarUnlockedScreen({ root = globalThis.document, bus } = {}) {
  if (!bus) throw new Error('mountAvatarUnlockedScreen: bus required');

  const overlay = $('#ov-avatar-unlocked', root);
  // Achievement-completion popup: shows the trophy, its title/description, and
  // the coin prize earned. Inner spans are optional (populated when present).
  const icEl    = $('#av-unlock-ic', root);
  const nameEl  = $('#av-unlock-name', root);
  const coinsEl = $('#av-unlock-coins', root);
  const condEl  = $('#av-unlock-cond', root);
  const cleanups = [];
  let lastAnimatedAchievementId = null;

  const acks = bus.on(AV_INTENT.UNLOCK_ACK, () => {
    overlay?.classList?.add?.('hidden');
  });
  cleanups.push(acks);

  cleanups.push(bus.on(AV_UNLOCK_OPEN, ({ achievement, coins } = {}) => {
    if (!overlay) return;
    overlay.classList?.remove?.('hidden');
    const achId = achievement?.id ?? '';
    if (overlay.dataset) overlay.dataset.achId = achId;
    else overlay.setAttribute?.('data-ach-id', achId);
    if (icEl) {
      const iconSrc = achievementIconSrc(achievement);
      const fallback = achievement?.emoji ?? '🏆';
      if (iconSrc) {
        icEl.innerHTML = `<img class="ach-ic-img" src="${iconSrc}" alt=""><span class="ach-ic-emoji" style="display:none">${fallback}</span>`;
        const img = icEl.querySelector?.('.ach-ic-img');
        if (img) img.onerror = () => {
          img.style.display = 'none';
          const em = icEl.querySelector?.('.ach-ic-emoji');
          if (em) em.style.display = 'flex';
        };
      } else {
        setText(icEl, fallback);
      }
    }
    if (nameEl)  setText(nameEl, achievement?.titleHe ?? '');
    if (coinsEl) coinsEl.innerHTML = coins ? `+${coins} ${COIN_ICON_HTML}` : '';
    if (condEl)  setText(condEl, achievement?.descHe ?? '');

    // Content is visible before motion starts. A duplicate render updates the
    // static state but cannot replay the rare-event choreography.
    overlay.classList?.add?.('achievement-unlock-state');
    if (achId && achId !== lastAnimatedAchievementId) {
      lastAnimatedAchievementId = achId;
      overlay.classList?.remove?.('achievement-unlock-motion', 'is-3d', 'is-pending');
      void overlay.offsetWidth;
      overlay.classList?.add?.('achievement-unlock-motion');
      playUnlockIcon(achievement);
    }
  }));

  // The trophy is awarded as a physical object when its pose atlas is ready:
  // it spins in small, comes toward the camera, a metallic light sweeps across
  // it, then the title and a particle burst land (poseClips 'unlockReveal').
  // Otherwise the existing CSS icon pop runs. The icon is held back (while the
  // card slides in) for at most UNLOCK_ATLAS_WAIT_MS to make that call.
  const UNLOCK_ATLAS_WAIT_MS = 450;
  async function playUnlockIcon(achievement) {
    const achId = achievement?.id;
    const img = icEl?.querySelector?.('.ach-ic-img');
    const src = img?.getAttribute?.('src');
    if (!img || !src || !overlay.classList?.add) return;
    const special = specialFor(achievement);
    const grand = special === 'grand';
    overlay.classList.toggle('is-grand', grand);
    overlay.classList.add('is-pending');
    await Promise.race([
      preloadFor(src).catch(() => false),
      new Promise(r => setTimeout(r, UNLOCK_ATLAS_WAIT_MS)),
    ]);
    if (overlay.dataset?.achId !== achId) return; // a newer unlock replaced this one
    const threeD = canPlayNow(img, 'unlockReveal');
    overlay.classList.toggle('is-3d', threeD);
    overlay.classList.remove('is-pending');
    // The flourish is CSS-only, so it also accompanies the 2D fallback pop.
    playUnlockSpecial(special, icEl);
    if (!threeD) return;
    playOnImg(img, grand ? 'unlockRevealGrand' : 'unlockReveal');
    const card = overlay.querySelector?.('.achievement-unlock-card');
    setTimeout(() => {
      if (overlay.dataset?.achId === achId) confettiBurst(card, { count: grand ? 44 : 22 });
    }, grand ? 950 : 700);
  }
  cleanups.push(bus.on(AV_UNLOCK_CLOSE, () => overlay?.classList?.add?.('hidden')));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
