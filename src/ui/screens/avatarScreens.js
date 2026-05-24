// Avatar-related screens, kept together because they share the avatar
// definition table:
//   - mountAvatarPickerScreen — wires #sav-gallery (avatar picker grid).
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
// Mirrors the legacy AVATAR_DEFS contract.
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

const RARITY_BG = {
  free:   '#3a4cf9', bronze: '#a06030',
  silver: '#9090a0', gold:   '#e8c840', legend: '#b06bff',
};

export function findAvatar(id) {
  return SPINE_AVATARS.find(a => a.id === id) ?? null;
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
    grid.innerHTML = SPINE_AVATARS.map(a => {
      const isEquipped = a.id === equippedAvatar;
      const lock = isAvatarUnlocked(a, stats);
      const bg = RARITY_BG[a.rarity] ?? '#444';
      return `<button data-av-id="${a.id}" ${!lock ? 'data-locked="1"' : ''} `
        + `style="background:${bg};border:${isEquipped ? '3px solid #fff' : 'none'};border-radius:8px;padding:8px;`
        + `font-family:Heebo,sans-serif;color:#000;font-weight:900;cursor:pointer;opacity:${lock ? 1 : 0.35};">`
        + `<div style="font-size:30px;line-height:1;">${a.emoji}</div>`
        + `<div style="font-size:10px;margin-top:4px;">${a.nameHe}</div>`
        + (lock ? '' : `<div style="font-size:9px;color:rgba(0,0,0,.65);margin-top:2px;">${a.unlock.min} ${labelFor(a.unlock.stat)}</div>`)
        + `</button>`;
    }).join('');
  }
  function labelFor(stat) {
    if (stat === 'gamesPlayed') return 'משחקים';
    if (stat === 'gamesWon')    return 'ניצחונות';
    if (stat === 'highScore')   return 'שיא';
    if (stat === 'longestStreak') return 'רצף';
    return stat;
  }

  if (grid) {
    cleanups.push(on(grid, 'click', (e) => {
      const t = e.target;
      const btn = t?.tagName === 'BUTTON' ? t : t?.closest?.('button');
      if (!btn) return;
      const id = btn.getAttribute?.('data-av-id');
      if (!id) return;
      if (btn.getAttribute('data-locked')) {
        const a = findAvatar(id);
        if (hintEl && a?.unlock) {
          setText(hintEl, `נעול: השג ${a.unlock.min} ${labelFor(a.unlock.stat)}`);
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
