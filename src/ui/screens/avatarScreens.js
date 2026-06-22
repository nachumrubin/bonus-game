// Avatar-related screens, kept together because they share the avatar
// definition table:
//   - mountAvatarPickerScreen — wires #sav-gallery (achievements + avatar picker).
//   - mountAvatarUnlockedScreen — wires #ov-avatar-unlocked overlay.
//
// The legacy AVATAR_DEFS lives in the inline <script>; this module ships
// a parallel SPINE_AVATARS table with the same id/emoji set so the spine
// doesn't depend on the legacy global at module load. Stats-driven unlock
// is computed pure-ly via `isAvatarUnlocked(avatar, stats)`.

import { $, on, setText } from '../domHelpers.js';
import { isStoreAvatarId, storeAvatarSrc, findStoreAvatar, COIN_ICON_HTML } from './avatarStore.js';

export const AV_INTENT = Object.freeze({
  SELECT:     'avatar/select',
  EQUIP:      'avatar/equip',
  CLOSE:      'avatar/close',
  UNLOCK_ACK: 'avatar/unlockAck',
});

export const AV_RENDER = 'avatar/render';
export const AV_UNLOCK_OPEN  = 'avatar/unlockOpen';
export const AV_UNLOCK_CLOSE = 'avatar/unlockClose';

// Pared-down avatar table — id, emoji, Hebrew name, rarity, unlock rule.
// Mirrors the legacy AVATAR_DEFS contract. Used by diffNewlyUnlocked() and
// the unlock-popup system — do not remove or rename entries.
export const SPINE_AVATARS = [
  { id: 'crown',     emoji: '👑', nameHe: 'כתר',       rarity: 'free',   unlock: { stat: 'gamesPlayed',      min: 0    } },
  { id: 'star',      emoji: '⭐', nameHe: 'כוכב',      rarity: 'free',   unlock: { stat: 'gamesPlayed',      min: 0    } },
  { id: 'fire',      emoji: '🔥', nameHe: 'אש',        rarity: 'bronze', unlock: { stat: 'gamesPlayed',      min: 5    } },
  { id: 'shark',     emoji: '🦈', nameHe: 'כריש',      rarity: 'bronze', unlock: { stat: 'gamesWon',         min: 5    } },
  { id: 'diamond',   emoji: '💎', nameHe: 'יהלום',     rarity: 'silver', unlock: { stat: 'gamesPlayed',      min: 25   } },
  { id: 'tiger',     emoji: '🐯', nameHe: 'נמר',       rarity: 'silver', unlock: { stat: 'longestStreak',    min: 5    } },
  { id: 'fox',       emoji: '🦊', nameHe: 'שועל',      rarity: 'silver', unlock: { stat: 'cleanWins',        min: 1    } },
  { id: 'bulb',      emoji: '💡', nameHe: 'נורה',      rarity: 'silver', unlock: { stat: 'highestMoveScore', min: 100  } },
  { id: 'handshake', emoji: '🤝', nameHe: 'חברים',     rarity: 'silver', unlock: { stat: 'friendsCount',     min: 20   } },
  { id: 'dragon',    emoji: '🐉', nameHe: 'דרקון',     rarity: 'gold',   unlock: { stat: 'gamesPlayed',      min: 40   } },
  { id: 'wizard',    emoji: '🧙', nameHe: 'קוסם',      rarity: 'gold',   unlock: { stat: 'highScore',        min: 250  } },
  { id: 'shield',    emoji: '🛡️', nameHe: 'מגן',       rarity: 'gold',   unlock: { stat: 'longestStreak',    min: 15   } },
  { id: 'bolt',      emoji: '⚡', nameHe: 'ברק',       rarity: 'gold',   unlock: { stat: 'fastGamePlayed',   min: 1    } },
  { id: 'alien',     emoji: '👾', nameHe: 'חייזר',     rarity: 'legend', unlock: { stat: 'gamesPlayed',      min: 100  } },
  { id: 'robot',     emoji: '🤖', nameHe: 'רובוט',     rarity: 'legend', unlock: { stat: 'gamesWon',         min: 50   } },
  { id: 'trophy',    emoji: '🏆', nameHe: 'גביע',      rarity: 'legend', unlock: { stat: 'longestStreak',    min: 25   } },
  { id: 'books',     emoji: '📚', nameHe: 'ספרים',     rarity: 'legend', unlock: { stat: 'uniqueWordsCount', min: 1000 } },
  { id: 'hero',      emoji: '🦸', nameHe: 'גיבור-על',  rarity: 'legend', unlock: { stat: 'noLossWeekStreaks',min: 1    } },
  { id: 'target',    emoji: '🎯', nameHe: 'מטרה',      rarity: 'legend', unlock: { stat: 'beatNumberOne',    min: 1    } },
  { id: 'ambassador',emoji: '🤩', nameHe: 'שגריר',    rarity: 'gold',   unlock: { stat: 'invitesSent',      min: 5    } },
];

// Named achievements — collectible "trophies". Completing one awards COINS
// (by tier — see profileService.ACHIEVEMENT_COIN_REWARD), NOT an avatar; avatars
// come exclusively from the store now. Each entry has a `condition`:
//   { stat, min }                              — numeric profile-stat threshold
//   { type:'ownedCount', min }                 — total purchased store avatars
//   { type:'ownedCategories', categories:[…] } — owns ≥1 from each listed category
//   { type:'ownedInCategory', category, min }  — owns ≥min from one category
// `rewardAvatarId` (legacy) only drives the trophy-icon emoji fallback; ownership
// achievements use `emoji` instead. `tier` drives the coin reward.
export const ACHIEVEMENTS = [
  { id: 'first_steps',  titleHe: 'צעדים ראשונים', descHe: 'שחק 5 משחקים',                                       condition: { stat: 'gamesPlayed',      min: 5    }, rewardAvatarId: 'fire',      tier: 'bronze' },
  { id: 'winner',       titleHe: 'מנצח',           descHe: 'ניצח 5 משחקים',                                       condition: { stat: 'gamesWon',         min: 5    }, rewardAvatarId: 'shark',     tier: 'bronze' },
  { id: 'seasoned',     titleHe: 'שחקן מנוסה',     descHe: 'שחק 25 משחקים',                                       condition: { stat: 'gamesPlayed',      min: 25   }, rewardAvatarId: 'diamond',   tier: 'silver' },
  { id: 'streaker',     titleHe: 'רצף מנצחים',     descHe: 'הגע לרצף של 5 ניצחונות',                             condition: { stat: 'longestStreak',    min: 5    }, rewardAvatarId: 'tiger',     tier: 'silver' },
  { id: 'clean_winner', titleHe: 'שועל ותיק',      descHe: 'צא לניצחון בלי להשתמש בריבוע מיוחד',                 condition: { stat: 'cleanWins',        min: 1    }, rewardAvatarId: 'fox',       tier: 'silver' },
  { id: 'word_genius',  titleHe: 'גאון מילים',     descHe: 'צבור 100 נקודות במהלך אחד',                          condition: { stat: 'highestMoveScore', min: 100  }, rewardAvatarId: 'bulb',      tier: 'silver' },
  { id: 'social',       titleHe: 'חבר של כולם',    descHe: 'הגע ל-20 חברים',                                      condition: { stat: 'friendsCount',     min: 20   }, rewardAvatarId: 'handshake', tier: 'silver' },
  { id: 'veteran',      titleHe: 'ותיק',            descHe: 'שחק 40 משחקים',                                       condition: { stat: 'gamesPlayed',      min: 40   }, rewardAvatarId: 'dragon',    tier: 'gold'   },
  { id: 'wordsmith',    titleHe: 'אמן המילים',      descHe: 'הגע לשיא של 250 נקודות',                              condition: { stat: 'highScore',        min: 250  }, rewardAvatarId: 'wizard',    tier: 'gold'   },
  { id: 'undefeated',   titleHe: 'בלתי מנוצח',     descHe: 'רצף של 15 ניצחונות',                                  condition: { stat: 'longestStreak',    min: 15   }, rewardAvatarId: 'shield',    tier: 'gold'   },
  { id: 'lightning',    titleHe: 'ברק חי',         descHe: 'שחק משחק במהירות ממוצעת מתחת ל-3 שניות למהלך',     condition: { stat: 'fastGamePlayed',   min: 1    }, rewardAvatarId: 'bolt',      tier: 'gold'   },
  { id: 'legend',       titleHe: 'אגדה',            descHe: 'שחק 100 משחקים',                                      condition: { stat: 'gamesPlayed',      min: 100  }, rewardAvatarId: 'alien',     tier: 'legend' },
  { id: 'champion',     titleHe: 'אלוף',            descHe: 'ניצח 50 משחקים',                                      condition: { stat: 'gamesWon',         min: 50   }, rewardAvatarId: 'robot',     tier: 'legend' },
  { id: 'untouchable',  titleHe: 'בלתי נתפס',      descHe: 'נצח 25 משחקים ברצף',                                  condition: { stat: 'longestStreak',    min: 25   }, rewardAvatarId: 'trophy',    tier: 'legend' },
  { id: 'dictionary',   titleHe: 'מילון מהלך',      descHe: 'השתמש ב-1000 מילים שונות',                            condition: { stat: 'uniqueWordsCount', min: 1000 }, rewardAvatarId: 'books',     tier: 'legend' },
  { id: 'superhuman',   titleHe: 'על-אנושי',        descHe: 'שבוע שלם בלי הפסד',                                   condition: { stat: 'noLossWeekStreaks',min: 1    }, rewardAvatarId: 'hero',      tier: 'legend' },
  { id: 'the_one',      titleHe: 'האחד',            descHe: 'נצח את שחקן המקום הראשון',                            condition: { stat: 'beatNumberOne',    min: 1    }, rewardAvatarId: 'target',     tier: 'legend' },
  { id: 'recruiter',   titleHe: 'חבר מביא חבר',  descHe: 'הזמן 5 חברים לבוסט',                                  condition: { stat: 'invitesSent',      min: 5    }, rewardAvatarId: 'ambassador', tier: 'gold'   },
  // Avatar-store / purchasing achievements (June 2026). No reward avatar — these
  // are pure trophies that pay out coins; condition reads profile.ownedAvatars.
  { id: 'first_buy',   titleHe: 'קנייה ראשונה',  descHe: 'רכוש את האווטאר הראשון שלך בחנות',                    condition: { type: 'ownedCount', min: 1 },                              emoji: '🛍️', tier: 'bronze' },
  { id: 'collector',   titleHe: 'אספן',           descHe: 'החזק לפחות אווטאר אחד מכל קטגוריה (נדיר, אפי, אגדי)', condition: { type: 'ownedCategories', categories: ['rare','epic','legendary'] }, emoji: '🗂️', tier: 'gold'   },
  { id: 'legend_owner',titleHe: 'בעל אגדה',       descHe: 'רכוש אווטאר אגדי מהחנות',                             condition: { type: 'ownedInCategory', category: 'legendary', min: 1 },  emoji: '💫', tier: 'legend' },
];

// Trophy-room icon art lives in images/icons/acheivements/, one PNG per
// achievement named exactly after its Hebrew title (`titleHe`). The path is
// derived from the title (URL-encoded at render time); if a file is missing
// the tile falls back to the reward avatar's emoji via the img onerror.
const ACH_ICON_DIR = 'images/icons/acheivements/';
const ACH_LOCK_ICON = 'images/icons/lock.png';

export function findAvatar(id) {
  return SPINE_AVATARS.find(a => a.id === id) ?? null;
}

export function findAchievementByRewardId(avatarId) {
  return ACHIEVEMENTS.find(a => a.rewardAvatarId === avatarId) ?? null;
}

// Resolve an avatar (id like 'robot' OR its emoji '🤖') to the achievement
// trophy-icon PNG that represents it, so the equipped avatar displays as the
// collected achievement art instead of the legacy emoji. Returns null for
// avatars with no achievement (the free crown/star) or unknown values — caller
// then falls back to the emoji.
export const BOT_AVATAR_SRC = 'images/icons/bot.png';

export function avatarIconSrc(value) {
  if (value == null) return null;
  if (value === 'bot') return BOT_AVATAR_SRC;
  // Store avatars (common_/rare_/epic_/legendary_) are image-only — resolve
  // their PNG here so an equipped store avatar shows everywhere avatars render
  // (profile, game screen, opponent cards) via setAvatarEl/avatarMarkup.
  const storeSrc = storeAvatarSrc(value);
  if (storeSrc) return storeSrc;
  const av = SPINE_AVATARS.find(a => a.id === value)
    ?? SPINE_AVATARS.find(a => a.emoji === value);
  if (!av) return null;
  const ach = findAchievementByRewardId(av.id);
  if (!ach) return null;
  return encodeURI(ACH_ICON_DIR + ach.titleHe + '.png');
}

function escapeAvatar(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const ANON_AVATAR_SRC = 'images/icons/anonymous player.png';

// Emoji/text fallback for an avatar value (id → emoji, else the raw value, else
// the fallback). Mirrors the per-screen resolveAvatar() helpers.
export function avatarText(value, fallback = '👤') {
  const av = SPINE_AVATARS.find(a => a.id === value);
  if (av) return av.emoji;
  // Store ids have no emoji; if the PNG is unavailable, degrade to the generic
  // person icon rather than printing the raw id (e.g. 'rare_3').
  if (isStoreAvatarId(value)) return fallback;
  return (value != null && value !== '') ? value : fallback;
}

// Avatar as an HTML string: the achievement trophy <img> when the avatar maps
// to one, else the escaped emoji/text. `className` controls the img sizing
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
  const src = avatarIconSrc(value);
  if (src) { el.innerHTML = `<img class="${className}" src="${src}" alt="">`; return; }
  const text = avatarText(value, fallback);
  if (text === '👤') el.innerHTML = `<img class="${className}" src="${ANON_AVATAR_SRC}" alt="">`;
  else el.textContent = text;
}

// Returns 0–1 representing how close the player is to completing an achievement.
export function progressPct(achievement, stats = {}) {
  const val = stats[achievement.condition.stat] ?? 0;
  return Math.min(1, val / achievement.condition.min);
}

export function isAvatarUnlocked(avatar, stats = {}) {
  if (!avatar?.unlock) return true;
  const min = avatar.unlock.min ?? 0;
  if (min === 0) return true;
  const value = stats[avatar.unlock.stat] ?? 0;
  return value >= min;
}

// Pure: given a profile's stats and the prior known unlocks, return the
// new unlocks that should fire achievement popups.
export function diffNewlyUnlocked(prevStats = {}, nextStats = {}) {
  const out = [];
  for (const a of SPINE_AVATARS) {
    const before = isAvatarUnlocked(a, prevStats);
    const after  = isAvatarUnlocked(a, nextStats);
    if (!before && after) out.push(a);
  }
  return out;
}

// ── Achievement evaluation (trophy-centric, decoupled from avatars) ─────────
// `data` is a profile-like { stats, ownedAvatars }. Returns { current, target }
// for the achievement's condition (stat threshold or store-ownership rule).
export function achievementMetric(ach, data = {}) {
  const c = ach?.condition ?? {};
  const owned = Array.isArray(data.ownedAvatars) ? data.ownedAvatars : [];
  if (c.stat) {
    return { current: data.stats?.[c.stat] ?? 0, target: c.min ?? 0 };
  }
  if (c.type === 'ownedCount') {
    return { current: owned.length, target: c.min ?? 1 };
  }
  if (c.type === 'ownedInCategory') {
    const n = owned.filter(id => findStoreAvatar(id)?.category === c.category).length;
    return { current: n, target: c.min ?? 1 };
  }
  if (c.type === 'ownedCategories') {
    const cats = new Set(owned.map(id => findStoreAvatar(id)?.category).filter(Boolean));
    const have = (c.categories ?? []).filter(cat => cats.has(cat)).length;
    return { current: have, target: (c.categories ?? []).length };
  }
  return { current: 0, target: 1 };
}

export function isAchievementComplete(ach, data = {}) {
  const { current, target } = achievementMetric(ach, data);
  return current >= target;
}

// 0–1 progress fraction toward an achievement (any condition type).
export function achievementProgressPct(ach, data = {}) {
  const { current, target } = achievementMetric(ach, data);
  return target > 0 ? Math.min(1, current / target) : 1;
}

// Pure: achievements newly completed between two profile-like snapshots
// ({ stats, ownedAvatars }). Drives coin payout + the completion popup.
export function diffNewlyCompletedAchievements(prev = {}, next = {}) {
  const out = [];
  for (const ach of ACHIEVEMENTS) {
    if (!isAchievementComplete(ach, prev) && isAchievementComplete(ach, next)) out.push(ach);
  }
  return out;
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
    const emoji = ach.emoji ?? findAvatar(ach.rewardAvatarId)?.emoji ?? '🏆';
    const icon = `<img class="ach-ic-img" src="${encodeURI(ACH_ICON_DIR + ach.titleHe + '.png')}" alt="">`
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
  let lastData = { stats: {}, ownedAvatars: [] };

  function paint({ stats = {}, ownedAvatars = [], coinRewardByTier: rewards } = {}) {
    if (rewards) coinRewardByTier = rewards;
    lastData = { stats: stats ?? {}, ownedAvatars: Array.isArray(ownedAvatars) ? ownedAvatars : [] };
    if (!grid) return;
    const completed = ACHIEVEMENTS.filter(a => isAchievementComplete(a, lastData));
    if (countEl) setText(countEl, `${completed.length} מתוך ${ACHIEVEMENTS.length} הושגו`);

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
    if (icEl)    setText(icEl, achievement?.emoji ?? findAvatar(achievement?.rewardAvatarId)?.emoji ?? '🏆');
    if (nameEl)  setText(nameEl, achievement?.titleHe ?? '');
    if (coinsEl) coinsEl.innerHTML = coins ? `+${coins} ${COIN_ICON_HTML}` : '';
    if (condEl)  setText(condEl, achievement?.descHe ?? '');
  }));
  cleanups.push(bus.on(AV_UNLOCK_CLOSE, () => overlay?.classList?.add?.('hidden')));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
