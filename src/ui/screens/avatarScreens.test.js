import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  SPINE_AVATARS, ACHIEVEMENTS,
  findAvatar, findAchievementByRewardId, isAvatarUnlocked, diffNewlyUnlocked, progressPct,
  achievementMetric, isAchievementComplete, achievementProgressPct, diffNewlyCompletedAchievements,
  avatarIconSrc, avatarText,
  mountAvatarPickerScreen, mountAvatarUnlockedScreen,
  AV_INTENT, AV_RENDER, AV_UNLOCK_OPEN, AV_UNLOCK_CLOSE,
} from './avatarScreens.js';

// Coin reward map (mirrors profileService.ACHIEVEMENT_COIN_REWARD) passed via AV_RENDER.
const TIER_REWARD = { bronze: 50, silver: 100, gold: 250, legend: 750 };

test('SPINE_AVATARS contains the expected ids', () => {
  const ids = SPINE_AVATARS.map(a => a.id);
  assert.ok(ids.includes('crown'));
  assert.ok(ids.includes('dragon'));
  assert.ok(ids.includes('alien'));
});

test('ACHIEVEMENTS includes the May 2026 expansion (fox, bulb, handshake, shield, bolt, trophy, books, hero, target)', () => {
  const ids = new Set(ACHIEVEMENTS.map(a => a.id));
  const required = ['clean_winner', 'word_genius', 'social', 'undefeated', 'lightning', 'untouchable', 'dictionary', 'superhuman', 'the_one'];
  for (const id of required) {
    assert.ok(ids.has(id), `missing achievement: ${id}`);
  }
  // word_genius unlocks against the existing highestMoveScore stat at 100.
  const wg = ACHIEVEMENTS.find(a => a.id === 'word_genius');
  assert.equal(wg.condition.stat, 'highestMoveScore');
  assert.equal(wg.condition.min, 100);
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
  const hint  = { textContent: '', innerHTML: '', style: { opacity: '0' } };
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

test('AvatarPicker: AV_RENDER paints a trophy tile per achievement + count + coin prize', () => {
  bus._reset();
  const { root, grid, count } = makePickerRoot();
  mountAvatarPickerScreen({ root, bus });
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 100, gamesWon: 50, highScore: 250, longestStreak: 5 }, ownedAvatars: [], coinRewardByTier: TIER_REWARD });
  // One tile per achievement (data-ach-id = achievement id, not an avatar id).
  for (const ach of ACHIEVEMENTS) {
    assert.match(grid.innerHTML, new RegExp(`data-ach-id="${ach.id}"`));
  }
  // No avatar-equip wiring leaks into the markup.
  assert.doesNotMatch(grid.innerHTML, /data-av-id=/);
  // Coin-prize chip is shown (e.g. a gold-tier 250) with the coin image.
  assert.match(grid.innerHTML, /ach-reward/);
  assert.match(grid.innerHTML, /gold coin\.png/);
  assert.match(grid.innerHTML, /250/);
  assert.match(count.textContent, new RegExp(`מתוך ${ACHIEVEMENTS.length} הושגו`));
});

test('AvatarPicker: clicking a trophy never equips an avatar (no EQUIP/SELECT)', () => {
  bus._reset();
  const { root, grid } = makePickerRoot();
  bus.on(AV_INTENT.EQUIP,  () => assert.fail('trophies must not equip'));
  bus.on(AV_INTENT.SELECT, () => assert.fail('trophies must not emit SELECT'));
  mountAvatarPickerScreen({ root, bus });
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 999, gamesWon: 999 }, ownedAvatars: [], coinRewardByTier: TIER_REWARD });
  grid.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => k === 'data-ach-id' ? 'veteran' : null,
    closest() { return this; },
  });
  // (no assertion failure means no equip/select fired)
});

test('AvatarPicker: clicking a locked trophy shows a hint with description + coin prize', () => {
  bus._reset();
  const { root, grid, hint } = makePickerRoot();
  mountAvatarPickerScreen({ root, bus });
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 0 }, ownedAvatars: [], coinRewardByTier: TIER_REWARD });
  grid.fireClick({
    tagName: 'BUTTON',
    getAttribute: (k) => ({ 'data-ach-id': 'veteran', 'data-locked': '1' }[k] ?? null),
    closest() { return this; },
  });
  assert.equal(hint.style.opacity, '1');
  assert.match(hint.innerHTML, /נעול/);
  assert.match(hint.innerHTML, /gold coin\.png/); // coin image, not emoji
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

test('AvatarUnlocked: AV_UNLOCK_OPEN unhides + records the achievement id', () => {
  bus._reset();
  const overlay = makeOverlay();
  const root = { querySelector: (sel) => sel === '#ov-avatar-unlocked' ? overlay : null };
  mountAvatarUnlockedScreen({ root, bus });
  bus.emit(AV_UNLOCK_OPEN, { achievement: { id: 'veteran', titleHe: 'ותיק', tier: 'gold' }, coins: 250 });
  assert.equal(overlay.classList.contains('hidden'), false);
  assert.equal(overlay.dataset.achId, 'veteran');
});

test('AvatarUnlocked: UNLOCK_ACK + AV_UNLOCK_CLOSE rehide', () => {
  bus._reset();
  const overlay = makeOverlay();
  const root = { querySelector: (sel) => sel === '#ov-avatar-unlocked' ? overlay : null };
  mountAvatarUnlockedScreen({ root, bus });
  bus.emit(AV_UNLOCK_OPEN, { achievement: { id: 'first_buy' }, coins: 50 });
  bus.emit(AV_INTENT.UNLOCK_ACK, {});
  assert.equal(overlay.classList.contains('hidden'), true);
  bus.emit(AV_UNLOCK_OPEN, { achievement: { id: 'first_buy' }, coins: 50 });
  bus.emit(AV_UNLOCK_CLOSE, {});
  assert.equal(overlay.classList.contains('hidden'), true);
});

test('throws if bus missing', () => {
  assert.throws(() => mountAvatarPickerScreen({}), /bus required/);
  assert.throws(() => mountAvatarUnlockedScreen({}), /bus required/);
});

test('avatarIconSrc: resolves store-avatar ids to their PNG, achievement/emoji unchanged', () => {
  assert.equal(avatarIconSrc('rare_3'), 'assets/avatars/rare_3.png');
  assert.equal(avatarIconSrc('legendary_2'), 'assets/avatars/legendary_2.png');
  assert.equal(avatarIconSrc('common_1'), 'assets/avatars/common_1.png');
  // Achievement avatar still maps to the trophy art (not the store dir).
  assert.ok(avatarIconSrc('dragon')?.includes('assets/achievements/'));
  // Free avatar with no achievement → null (emoji fallback handled by caller).
  assert.equal(avatarIconSrc('crown'), null);
});

test('avatarText: store ids degrade to the generic fallback, not the raw id', () => {
  assert.equal(avatarText('rare_3'), '👤');
  assert.equal(avatarText('legendary_1', '🎮'), '🎮');
  // Achievement id still returns its emoji.
  assert.equal(avatarText('dragon'), '🐉');
});

// ── Purchase achievements + achievement evaluation ───────────

test('ACHIEVEMENTS includes the purchase trophies (first_buy, collector, legend_owner)', () => {
  const byId = new Map(ACHIEVEMENTS.map(a => [a.id, a]));
  for (const id of ['first_buy', 'collector', 'legend_owner']) {
    assert.ok(byId.has(id), `missing achievement: ${id}`);
    assert.ok(byId.get(id).emoji, `purchase achievement ${id} needs an emoji fallback`);
    assert.equal(byId.get(id).rewardAvatarId, undefined, `${id} must not reward an avatar`);
  }
});

test('achievementMetric: stat condition reads profile.stats', () => {
  const veteran = ACHIEVEMENTS.find(a => a.id === 'veteran'); // gamesPlayed >= 40
  assert.deepEqual(achievementMetric(veteran, { stats: { gamesPlayed: 25 } }), { current: 25, target: 40 });
  assert.equal(isAchievementComplete(veteran, { stats: { gamesPlayed: 40 } }), true);
  assert.equal(achievementProgressPct(veteran, { stats: { gamesPlayed: 20 } }), 0.5);
});

test('achievementMetric: ownedCount (first_buy) counts purchased avatars', () => {
  const firstBuy = ACHIEVEMENTS.find(a => a.id === 'first_buy');
  assert.equal(isAchievementComplete(firstBuy, { ownedAvatars: [] }), false);
  assert.equal(isAchievementComplete(firstBuy, { ownedAvatars: ['rare_1'] }), true);
});

test('achievementMetric: ownedInCategory (legend_owner) needs a legendary', () => {
  const legend = ACHIEVEMENTS.find(a => a.id === 'legend_owner');
  assert.equal(isAchievementComplete(legend, { ownedAvatars: ['rare_1', 'epic_2'] }), false);
  assert.equal(isAchievementComplete(legend, { ownedAvatars: ['legendary_3'] }), true);
});

test('achievementMetric: ownedCategories (collector) needs one of each tier', () => {
  const collector = ACHIEVEMENTS.find(a => a.id === 'collector');
  assert.deepEqual(achievementMetric(collector, { ownedAvatars: ['rare_1', 'epic_2'] }), { current: 2, target: 3 });
  assert.equal(isAchievementComplete(collector, { ownedAvatars: ['rare_1', 'epic_2'] }), false);
  assert.equal(isAchievementComplete(collector, { ownedAvatars: ['rare_1', 'epic_2', 'legendary_1'] }), true);
  // common avatars don't count toward the purchasable-tier requirement
  assert.equal(isAchievementComplete(collector, { ownedAvatars: ['common_1', 'common_2'] }), false);
});

test('diffNewlyCompletedAchievements: fires on a purchase that crosses a threshold', () => {
  const prev = { stats: {}, ownedAvatars: ['rare_1', 'epic_2'] };
  const next = { stats: {}, ownedAvatars: ['rare_1', 'epic_2', 'legendary_1'] };
  const ids = diffNewlyCompletedAchievements(prev, next).map(a => a.id);
  assert.ok(ids.includes('collector'));     // now owns all three tiers
  assert.ok(ids.includes('legend_owner'));  // now owns a legendary
  assert.ok(!ids.includes('first_buy'));    // already owned avatars before
});

test('diffNewlyCompletedAchievements: stat-based achievements still fire', () => {
  const prev = { stats: { gamesPlayed: 4 }, ownedAvatars: [] };
  const next = { stats: { gamesPlayed: 5 }, ownedAvatars: [] };
  const ids = diffNewlyCompletedAchievements(prev, next).map(a => a.id);
  assert.ok(ids.includes('first_steps')); // gamesPlayed >= 5
});

test('ACHIEVEMENTS includes word_contributor (wordsAccepted >= 20, gold tier)', () => {
  const byId = new Map(ACHIEVEMENTS.map(a => [a.id, a]));
  assert.ok(byId.has('word_contributor'), 'missing word_contributor achievement');
  const wc = byId.get('word_contributor');
  assert.equal(wc.condition.stat, 'wordsAccepted');
  assert.equal(wc.condition.min, 20);
  assert.equal(wc.tier, 'gold');
  assert.ok(wc.emoji, 'word_contributor needs an emoji fallback');
  assert.equal(wc.rewardAvatarId, undefined, 'word_contributor must not reward an avatar');
});

test('word_contributor: fires at 20 wordsAccepted', () => {
  const prev = { stats: { wordsAccepted: 19 }, ownedAvatars: [] };
  const next = { stats: { wordsAccepted: 20 }, ownedAvatars: [] };
  const ids = diffNewlyCompletedAchievements(prev, next).map(a => a.id);
  assert.ok(ids.includes('word_contributor'));
});

test('word_contributor: does not fire below threshold', () => {
  const prev = { stats: { wordsAccepted: 0 }, ownedAvatars: [] };
  const next = { stats: { wordsAccepted: 19 }, ownedAvatars: [] };
  const ids = diffNewlyCompletedAchievements(prev, next).map(a => a.id);
  assert.ok(!ids.includes('word_contributor'));
});
