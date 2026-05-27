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
  { id: 'crown',   emoji: '👑', nameHe: 'כתר',     rarity: 'free',   unlock: { stat: 'gamesPlayed',  min: 0   } },
  { id: 'star',    emoji: '⭐', nameHe: 'כוכב',    rarity: 'free',   unlock: { stat: 'gamesPlayed',  min: 0   } },
  { id: 'fire',    emoji: '🔥', nameHe: 'אש',      rarity: 'bronze', unlock: { stat: 'gamesPlayed',  min: 5   } },
  { id: 'shark',   emoji: '🦈', nameHe: 'כריש',    rarity: 'bronze', unlock: { stat: 'gamesWon',     min: 5   } },
  { id: 'diamond', emoji: '💎', nameHe: 'יהלום',   rarity: 'silver', unlock: { stat: 'gamesPlayed',  min: 25  } },
  { id: 'tiger',   emoji: '🐯', nameHe: 'נמר',     rarity: 'silver', unlock: { stat: 'longestStreak',min: 5   } },
  { id: 'dragon',  emoji: '🐉', nameHe: 'דרקון',   rarity: 'gold',   unlock: { stat: 'gamesPlayed',  min: 40  } },
  { id: 'wizard',  emoji: '🧙', nameHe: 'קוסם',    rarity: 'gold',   unlock: { stat: 'highScore',    min: 250 } },
  { id: 'alien',   emoji: '👾', nameHe: 'חייזר',   rarity: 'legend', unlock: { stat: 'gamesPlayed',  min: 100 } },
  { id: 'robot',   emoji: '🤖', nameHe: 'רובוט',   rarity: 'legend', unlock: { stat: 'gamesWon',     min: 50  } },
];

// Named achievements — each maps a milestone to a reward avatar.
// Free avatars (crown, star) are displayed in a separate starter row.
export const ACHIEVEMENTS = [
  { id: 'first_steps', titleHe: 'צעדים ראשונים', descHe: 'שחק 5 משחקים',             condition: { stat: 'gamesPlayed',   min: 5   }, rewardAvatarId: 'fire',    tier: 'bronze' },
  { id: 'winner',      titleHe: 'מנצח',           descHe: 'ניצח 5 משחקים',             condition: { stat: 'gamesWon',      min: 5   }, rewardAvatarId: 'shark',   tier: 'bronze' },
  { id: 'seasoned',    titleHe: 'שחקן מנוסה',     descHe: 'שחק 25 משחקים',             condition: { stat: 'gamesPlayed',   min: 25  }, rewardAvatarId: 'diamond', tier: 'silver' },
  { id: 'streaker',    titleHe: 'רצף מנצחים',     descHe: 'הגע לרצף של 5 ניצחונות',   condition: { stat: 'longestStreak', min: 5   }, rewardAvatarId: 'tiger',   tier: 'silver' },
  { id: 'veteran',     titleHe: 'ותיק',            descHe: 'שחק 40 משחקים',             condition: { stat: 'gamesPlayed',   min: 40  }, rewardAvatarId: 'dragon',  tier: 'gold'   },
  { id: 'wordsmith',   titleHe: 'אמן המילים',      descHe: 'הגע לשיא של 250 נקודות',   condition: { stat: 'highScore',     min: 250 }, rewardAvatarId: 'wizard',  tier: 'gold'   },
  { id: 'legend',      titleHe: 'אגדה',            descHe: 'שחק 100 משחקים',            condition: { stat: 'gamesPlayed',   min: 100 }, rewardAvatarId: 'alien',   tier: 'legend' },
  { id: 'champion',    titleHe: 'אלוף',            descHe: 'ניצח 50 משחקים',            condition: { stat: 'gamesWon',      min: 50  }, rewardAvatarId: 'robot',   tier: 'legend' },
];

const TIER_COLOR = {
  bronze: '#c87840', silver: '#9090a0', gold: '#d4a820', legend: '#9a50e8',
};
const TIER_LABEL_HE = { bronze: 'ארד', silver: 'כסף', gold: 'זהב', legend: 'אגדה' };

const FREE_AVATAR_BG = '#3a4cf9';

export function findAvatar(id) {
  return SPINE_AVATARS.find(a => a.id === id) ?? null;
}

export function findAchievementByRewardId(avatarId) {
  return ACHIEVEMENTS.find(a => a.rewardAvatarId === avatarId) ?? null;
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

  function paint({ stats, equippedAvatar } = {}) {
    if (!grid) return;
    const unlocked = SPINE_AVATARS.filter(a => isAvatarUnlocked(a, stats));
    if (countEl) setText(countEl, `${unlocked.length}/${SPINE_AVATARS.length}`);

    const FREE_AVATARS = SPINE_AVATARS.filter(a => a.rarity === 'free');
    const starterRow = FREE_AVATARS.map(a => {
      const isEquipped = a.id === equippedAvatar;
      return `<button class="ach-starter-btn" data-av-id="${a.id}" `
        + `style="background:${FREE_AVATAR_BG};border:${isEquipped ? '3px solid #fff' : '2px solid rgba(255,255,255,.2)'};`
        + `border-radius:10px;padding:6px 10px;cursor:pointer;display:inline-flex;flex-direction:column;align-items:center;gap:2px;">`
        + `<span style="font-size:26px;line-height:1;">${a.emoji}</span>`
        + `<span style="font-size:10px;color:#fff;font-weight:700;">${a.nameHe}</span>`
        + `</button>`;
    }).join('');

    const achCards = ACHIEVEMENTS.map(ach => {
      const av = findAvatar(ach.rewardAvatarId);
      const isUnlocked = av ? isAvatarUnlocked(av, stats) : false;
      const isEquipped = ach.rewardAvatarId === equippedAvatar;
      const pct = isUnlocked ? 1 : progressPct(ach, stats);
      const curVal = Math.min(stats[ach.condition.stat] ?? 0, ach.condition.min);
      const tierColor = TIER_COLOR[ach.tier] ?? '#888';
      const cardBorder = isEquipped ? '2px solid #fff' : isUnlocked ? `2px solid ${tierColor}` : '2px solid rgba(255,255,255,.1)';
      return `<button class="ach-card" data-av-id="${ach.rewardAvatarId}" ${!isUnlocked ? 'data-locked="1"' : ''} `
        + `style="opacity:${isUnlocked ? 1 : 0.6};border:${cardBorder};">`
        + `<div class="ach-card-left"><span class="ach-card-emoji">${av?.emoji ?? '?'}</span></div>`
        + `<div class="ach-card-body">`
        + `  <div class="ach-card-title">${ach.titleHe}${isEquipped ? ' ✓' : ''}</div>`
        + `  <div class="ach-card-desc">${ach.descHe}</div>`
        + `  <div class="ach-progress"><div class="ach-progress-fill" style="width:${Math.round(pct * 100)}%;background:${tierColor};"></div></div>`
        + `  <div class="ach-card-meta"><span style="color:${tierColor};">${curVal}/${ach.condition.min}</span>`
        + `    <span class="ach-tier-chip" style="background:${tierColor};">${TIER_LABEL_HE[ach.tier] ?? ach.tier}</span>`
        + (isUnlocked ? `    <span style="font-size:10px;color:rgba(255,255,255,.6);">הצטייד</span>` : '')
        + `  </div>`
        + `</div>`
        + `</button>`;
    }).join('');

    grid.innerHTML = `<div class="ach-starter-row">${starterRow}</div>${achCards}`;
  }

  if (grid) {
    cleanups.push(on(grid, 'click', (e) => {
      const t = e.target;
      const btn = t?.tagName === 'BUTTON' ? t : t?.closest?.('button');
      if (!btn) return;
      const id = btn.getAttribute?.('data-av-id');
      if (!id) return;
      if (btn.getAttribute('data-locked')) {
        const ach = findAchievementByRewardId(id);
        if (hintEl && ach) {
          setText(hintEl, `נעול — ${ach.descHe}`);
          hintEl.style.opacity = '1';
          setTimeout(() => { if (hintEl) hintEl.style.opacity = '0'; }, 1800);
        }
        bus.emit(AV_INTENT.SELECT, { id, locked: true });
        return;
      }
      bus.emit(AV_INTENT.SELECT, { id, locked: false });
      bus.emit(AV_INTENT.EQUIP,  { id });
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
  // The legacy markup contains its own emoji/title spans. We don't depend
  // on specific child IDs — we just toggle visibility and let the legacy
  // updateBody fn (if available) populate, but if we get a full payload
  // we'll write to an inner span we can rely on existing.
  const cleanups = [];

  const acks = bus.on(AV_INTENT.UNLOCK_ACK, () => {
    overlay?.classList?.add?.('hidden');
  });
  cleanups.push(acks);

  cleanups.push(bus.on(AV_UNLOCK_OPEN, ({ avatar } = {}) => {
    if (!overlay) return;
    overlay.classList?.remove?.('hidden');
    if (overlay.dataset) overlay.dataset.avatarId = avatar?.id ?? '';
    else overlay.setAttribute?.('data-avatar-id', avatar?.id ?? '');
  }));
  cleanups.push(bus.on(AV_UNLOCK_CLOSE, () => overlay?.classList?.add?.('hidden')));

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
    },
  };
}
