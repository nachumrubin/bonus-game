import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  SPINE_AVATARS, ACHIEVEMENTS,
  findAvatar, findAchievementByRewardId, isAvatarUnlocked, diffNewlyUnlocked, progressPct,
  mountAvatarPickerScreen, mountAvatarUnlockedScreen,
  AV_INTENT, AV_RENDER, AV_UNLOCK_OPEN, AV_UNLOCK_CLOSE,
} from './avatarScreens.js';

test('SPINE_AVATARS contains the expected ids', () => {
  const ids = SPINE_AVATARS.map(a => a.id);
  assert.ok(ids.includes('crown'));
  assert.ok(ids.includes('dragon'));
  assert.ok(ids.includes('alien'));
});

test('ACHIEVEMENTS covers all non-free avatars', () => {
  const rewardIds = new Set(ACHIEVEMENTS.map(a => a.rewardAvatarId));
  const nonFree = SPINE_AVATARS.filter(a => a.rarity !== 'free');
  for (const av of nonFree) {
    assert.ok(rewardIds.has(av.id), `no achievement for avatar '${av.id}'`);
  }
});

test('progressPct: returns 0 at start, 1 when met or exceeded', () => {
  const ach = ACHIEVEMENTS.find(a => a.rewardAvatarId === 'dragon'); // min 40
  assert.equal(progressPct(ach, {}), 0);
  assert.equal(progressPct(ach, { gamesPlayed: 20 }), 0.5);
  assert.equal(progressPct(ach, { gamesPlayed: 40 }), 1);
  assert.equal(progressPct(ach, { gamesPlayed: 99 }), 1);
});

test('findAchievementByRewardId: known + unknown', () => {
  assert.equal(findAchievementByRewardId('dragon').id, 'veteran');
  assert.equal(findAchievementByRewardId('xx'), null);
});

test('findAvatar: known + unknown', () => {
  assert.equal(findAvatar('crown').emoji, '👑');
  assert.equal(findAvatar('xx'), null);
});

test('isAvatarUnlocked: free avatars always unlocked', () => {
  assert.equal(isAvatarUnlocked(findAvatar('crown'), { gamesPlayed: 0 }), true);
});

test('isAvatarUnlocked: stat-gated avatars respect threshold', () => {
  const dragon = findAvatar('dragon'); // gamesPlayed >= 40
  assert.equal(isAvatarUnlocked(dragon, { gamesPlayed: 39 }), false);
  assert.equal(isAvatarUnlocked(dragon, { gamesPlayed: 40 }), true);
});

test('diffNewlyUnlocked: returns avatars that just crossed their threshold', () => {
  const before = { gamesPlayed: 4,  gamesWon: 4, highScore: 100 };
  const after  = { gamesPlayed: 5,  gamesWon: 5, highScore: 100 };
  const newly = diffNewlyUnlocked(before, after);
  // 'fire' (gamesPlayed >= 5) and 'shark' (gamesWon >= 5) should fire.
  const ids = newly.map(a => a.id);
  assert.ok(ids.includes('fire'));
  assert.ok(ids.includes('shark'));
});

function makeGrid() {
  const listeners = [];
  return {
    innerHTML: '',
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick(target) { for (const l of listeners) if (l.ev === 'click') l.fn({ target }); },
  };
}

function makeOverlay() {
  const cl = new Set(['hidden']);
  return {
    classList: { contains: c => cl.has(c), add: c => cl.add(c), remove: c => cl.delete(c) },
    dataset: {},
  };
}

function makeBtn() {
  const listeners = [];
  return {
    style: { display: '' },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    fireClick() { for (const l of listeners) if (l.ev === 'click') l.fn({ preventDefault() {} }); },
  };
}

function makePickerRoot() {
  const grid = makeGrid();
  const count = { textContent: '' };
  const hint  = { textContent: '', style: { opacity: '0' } };
  const back  = makeBtn();
  return {
    grid, count, hint, back,
    root: { querySelector: (sel) => {
      switch (sel) {
        case '#av-gallery-grid':   return grid;
        case '#av-gallery-count':  return count;
        case '#av-locked-hint':    return hint;
        case 'button[onclick="showProfileScreen()"]': return back;
        default: return null;
      }
    } },
  };
}

test('AvatarPicker: AV_RENDER paints all avatars + count', () => {
  bus._reset();
  const { root, grid, count } = makePickerRoot();
  mountAvatarPickerScreen({ root, bus });
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 100, gamesWon: 50, highScore: 250, longestStreak: 5 }, equippedAvatar: 'crown' });
  for (const a of SPINE_AVATARS) {
    assert.match(grid.innerHTML, new RegExp(`data-av-id="${a.id}"`));
  }
  assert.match(count.textContent, /\/10/); // 10 avatars total
});

test('AvatarPicker: clicking unlocked emits SELECT + EQUIP', () => {
  bus._reset();
  const { root, grid } = makePickerRoot();
  const events = [];
  bus.on(AV_INTENT.SELECT, (p) => events.push(['select', p.id, p.locked]));
  bus.on(AV_INTENT.EQUIP,  (p) => events.push(['equip',  p.id]));
  mountAvatarPickerScreen({ root, bus });
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 999, gamesWon: 999, highScore: 999, longestStreak: 999 }, equippedAvatar: 'crown' });
  // Simulate clicking the dragon button
  grid.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => k === 'data-av-id' ? 'dragon' : null,
    closest() { return this; },
  });
  assert.deepEqual(events, [['select','dragon',false], ['equip','dragon']]);
});

test('AvatarPicker: clicking locked shows hint and emits SELECT(locked=true)', () => {
  bus._reset();
  const { root, grid, hint } = makePickerRoot();
  let lockedEvents = 0;
  bus.on(AV_INTENT.SELECT, (p) => { if (p.locked) lockedEvents++; });
  bus.on(AV_INTENT.EQUIP, () => assert.fail('should not equip locked'));
  mountAvatarPickerScreen({ root, bus });
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 0 }, equippedAvatar: 'crown' });
  grid.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => ({ 'data-av-id': 'dragon', 'data-locked': '1' }[k] ?? null),
    closest() { return this; },
  });
  assert.equal(lockedEvents, 1);
  assert.equal(hint.style.opacity, '1');
});

test('AvatarPicker: back button emits CLOSE', () => {
  bus._reset();
  const { root, back } = makePickerRoot();
  let n = 0;
  bus.on(AV_INTENT.CLOSE, () => { n++; });
  mountAvatarPickerScreen({ root, bus });
  back.fireClick();
  assert.equal(n, 1);
});

test('AvatarUnlocked: AV_UNLOCK_OPEN unhides + records the avatar id', () => {
  bus._reset();
  const overlay = makeOverlay();
  const root = { querySelector: (sel) => sel === '#ov-avatar-unlocked' ? overlay : null };
  mountAvatarUnlockedScreen({ root, bus });
  bus.emit(AV_UNLOCK_OPEN, { avatar: { id: 'dragon', emoji: '🐉' } });
  assert.equal(overlay.classList.contains('hidden'), false);
  assert.equal(overlay.dataset.avatarId, 'dragon');
});

test('AvatarUnlocked: UNLOCK_ACK + AV_UNLOCK_CLOSE rehide', () => {
  bus._reset();
  const overlay = makeOverlay();
  const root = { querySelector: () => overlay };
  mountAvatarUnlockedScreen({ root, bus });
  bus.emit(AV_UNLOCK_OPEN, { avatar: { id: 'fire' } });
  bus.emit(AV_INTENT.UNLOCK_ACK, {});
  assert.equal(overlay.classList.contains('hidden'), true);
  bus.emit(AV_UNLOCK_OPEN, { avatar: { id: 'fire' } });
  bus.emit(AV_UNLOCK_CLOSE, {});
  assert.equal(overlay.classList.contains('hidden'), true);
});

test('throws if bus missing', () => {
  assert.throws(() => mountAvatarPickerScreen({}), /bus required/);
  assert.throws(() => mountAvatarUnlockedScreen({}), /bus required/);
});
