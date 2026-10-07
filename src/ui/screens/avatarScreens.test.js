import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  ACHIEVEMENTS, progressPct, achievementSnapshot,
  achievementMetric, isAchievementComplete, achievementProgressPct, diffNewlyCompletedAchievements,
  avatarIconSrc, avatarMarkup, setAvatarEl, achievementIconSrc, avatarText, botModelSrc,
  mountAvatarPickerScreen, mountAvatarUnlockedScreen,
  AV_INTENT, AV_RENDER, AV_UNLOCK_OPEN, AV_UNLOCK_CLOSE,
} from './avatarScreens.js';

// Coin reward map (mirrors profileService.ACHIEVEMENT_COIN_REWARD) passed via AV_RENDER.
const TIER_REWARD = { bronze: 50, silver: 100, gold: 250, legend: 750 };

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

test('ACHIEVEMENTS: unique ids, every entry has an emoji fallback and a tier', () => {
  const ids = ACHIEVEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.emoji, `${a.id} needs an emoji fallback`);
    assert.ok(['bronze', 'silver', 'gold', 'legend'].includes(a.tier), a.id);
    assert.equal(a.rewardAvatarId, undefined, `${a.id} must not reward an old avatar`);
  }
});

test('progressPct: returns 0 at start, 1 when met or exceeded', () => {
  const ach = ACHIEVEMENTS.find(a => a.id === 'veteran'); // gamesPlayed >= 40
  assert.equal(progressPct(ach, {}), 0);
  assert.equal(progressPct(ach, { gamesPlayed: 20 }), 0.5);
  assert.equal(progressPct(ach, { gamesPlayed: 40 }), 1);
  assert.equal(progressPct(ach, { gamesPlayed: 99 }), 1);
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

function makeTextEl() {
  return {
    textContent: '',
    innerHTML: '',
    querySelector: () => null,
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
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 100, gamesWon: 50, highScore: 250, longestStreak: 5 }, coinRewardByTier: TIER_REWARD });
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
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 999, gamesWon: 999 }, coinRewardByTier: TIER_REWARD });
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
  bus.emit(AV_RENDER, { stats: { gamesPlayed: 0 }, coinRewardByTier: TIER_REWARD });
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

test('AvatarUnlocked: AV_UNLOCK_OPEN renders the achievement trophy icon', () => {
  bus._reset();
  const overlay = makeOverlay();
  const ic = makeTextEl();
  const root = { querySelector: (sel) => {
    if (sel === '#ov-avatar-unlocked') return overlay;
    if (sel === '#av-unlock-ic') return ic;
    return null;
  } };
  const achievement = ACHIEVEMENTS.find(a => a.id === 'streaker');
  mountAvatarUnlockedScreen({ root, bus });

  bus.emit(AV_UNLOCK_OPEN, { achievement, coins: 100 });

  assert.match(ic.innerHTML, /^<img class="ach-ic-img"/);
  assert.ok(ic.innerHTML.includes(achievementIconSrc(achievement)));
});

test('AvatarUnlocked: required state remains visible and duplicate render does not replay motion', () => {
  bus._reset();
  const overlay = makeOverlay();
  let motionStarts = 0;
  Object.defineProperty(overlay, 'offsetWidth', { get() { motionStarts++; return 1; } });
  const root = { querySelector: (sel) => sel === '#ov-avatar-unlocked' ? overlay : null };
  const screen = mountAvatarUnlockedScreen({ root, bus });
  const payload = { achievement: { id: 'veteran', titleHe: 'ותיק', tier: 'gold' }, coins: 250 };
  bus.emit(AV_UNLOCK_OPEN, payload);
  bus.emit(AV_UNLOCK_OPEN, payload);
  assert.equal(overlay.classList.contains('hidden'), false);
  assert.equal(overlay.classList.contains('achievement-unlock-state'), true);
  assert.equal(overlay.classList.contains('achievement-unlock-motion'), true);
  assert.equal(motionStarts, 1);
  screen.unmount();
});

test('AvatarUnlocked: UNLOCK_ACK + AV_UNLOCK_CLOSE rehide', () => {
  bus._reset();
  const overlay = makeOverlay();
  const root = { querySelector: (sel) => sel === '#ov-avatar-unlocked' ? overlay : null };
  mountAvatarUnlockedScreen({ root, bus });
  bus.emit(AV_UNLOCK_OPEN, { achievement: { id: 'reaction_fan' }, coins: 50 });
  bus.emit(AV_INTENT.UNLOCK_ACK, {});
  assert.equal(overlay.classList.contains('hidden'), true);
  bus.emit(AV_UNLOCK_OPEN, { achievement: { id: 'reaction_fan' }, coins: 50 });
  bus.emit(AV_UNLOCK_CLOSE, {});
  assert.equal(overlay.classList.contains('hidden'), true);
});

test('throws if bus missing', () => {
  assert.throws(() => mountAvatarPickerScreen({}), /bus required/);
  assert.throws(() => mountAvatarUnlockedScreen({}), /bus required/);
});

test('avatarIconSrc: Boostie values resolve to their still at the right level', () => {
  assert.equal(avatarIconSrc('zapi:4'), 'assets/avatars/boosties/zapi/l4_bust.webp');
  assert.equal(avatarIconSrc('bubo'), 'assets/avatars/boosties/bubo/l1_bust.webp');
  assert.equal(avatarIconSrc({ id: 'bubo', level: 7 }, { kind: 'full' }), 'assets/avatars/boosties/bubo/l7_full.webp');
});

test('avatarIconSrc: old avatar values show the starter Boostie, bots keep their art, no player → null', () => {
  for (const old of ['rare_3', 'common_17', 'dragon', 'crown', 'zapi:9']) {
    assert.match(avatarIconSrc(old), /assets\/avatars\/boosties\/zapi\/l\d_bust\.webp/, old);
  }
  // Emoji (banner icons such as '🔔') aren't avatar ids: no image, the caller shows the text.
  for (const emoji of ['👑', '🔔', '🪙']) assert.equal(avatarIconSrc(emoji), null, emoji);
  assert.equal(avatarIconSrc('bot_hard'), 'assets/avatars/bots/bot_hard_bust.webp');
  assert.equal(avatarIconSrc('bot_easy', { kind: 'full' }), 'assets/avatars/bots/bot_easy_full.webp');
  assert.equal(avatarIconSrc('bot'), 'assets/avatars/bot.png');
  assert.equal(avatarIconSrc(null), null);
  assert.equal(avatarIconSrc(''), null);
  assert.equal(avatarIconSrc('👤'), null);
});

test('botModelSrc: each difficulty has a 3D model; the generic bot and other ids have none', () => {
  assert.equal(botModelSrc('bot_medium'), 'assets/boosties/bot_medium.glb');
  assert.equal(botModelSrc('bot'), null);
  assert.equal(botModelSrc('zapi'), null);
});

test('avatarMarkup / setAvatarEl: Boostie img, anonymous portrait with no player', () => {
  assert.match(avatarMarkup('zapi:3'), /src="assets\/avatars\/boosties\/zapi\/l3_bust\.webp"/);
  assert.match(avatarMarkup(null), /anonymous player\.png/);
  const el = { innerHTML: '', textContent: '', firstElementChild: null };
  setAvatarEl(el, 'bubo:2');
  assert.match(el.innerHTML, /bubo\/l2_bust\.webp/);
});

test('avatarText: an emoji value is its own text; nothing → the fallback', () => {
  assert.equal(avatarText('🔔'), '🔔');
  assert.equal(avatarText(null), '👤');
  assert.equal(avatarText('', '🎮'), '🎮');
});

test('setAvatarEl: an emoji banner avatar shows the emoji, not a Boostie', () => {
  const el = { innerHTML: '', textContent: '', firstElementChild: null };
  setAvatarEl(el, '🔔', { fallback: '🔔' });
  assert.doesNotMatch(el.innerHTML, /boosties/);
});

// ── Achievement evaluation ───────────

test('achievementMetric: stat condition reads profile.stats', () => {
  const veteran = ACHIEVEMENTS.find(a => a.id === 'veteran'); // gamesPlayed >= 40
  assert.deepEqual(achievementMetric(veteran, { stats: { gamesPlayed: 25 } }), { current: 25, target: 40 });
  assert.equal(isAchievementComplete(veteran, { stats: { gamesPlayed: 40 } }), true);
  assert.equal(achievementProgressPct(veteran, { stats: { gamesPlayed: 20 } }), 0.5);
});

test('ACHIEVEMENTS includes the Boostie trophies (level 4, new Boostie, 2 reactions)', () => {
  const byId = new Map(ACHIEVEMENTS.map(a => [a.id, a]));
  assert.deepEqual(byId.get('boostie_grown').condition, { type: 'boostieLevel', min: 4 });
  assert.deepEqual(byId.get('new_boostie').condition, { type: 'boostiesUnlocked', min: 1 });
  assert.deepEqual(byId.get('reaction_fan').condition, { type: 'reactionsOwned', min: 2 });
  for (const gone of ['first_buy', 'collector', 'legend_owner']) assert.equal(byId.has(gone), false, gone);
});

test('achievementMetric: boostieLevel reads the highest Boostie level from XP', () => {
  const grown = ACHIEVEMENTS.find(a => a.id === 'boostie_grown');
  assert.deepEqual(achievementMetric(grown, achievementSnapshot(null)), { current: 1, target: 4 });
  const snap = achievementSnapshot({ boosties: { zapi: { xp: 60 }, bubo: { xp: 400 } } }); // L2, L4
  assert.deepEqual(achievementMetric(grown, snap), { current: 4, target: 4 });
  assert.equal(isAchievementComplete(grown, snap), true);
});

test('achievementMetric: boostiesUnlocked ignores the starters', () => {
  const nb = ACHIEVEMENTS.find(a => a.id === 'new_boostie');
  assert.deepEqual(achievementMetric(nb, achievementSnapshot({ boosties: { zapi: {}, bubo: {} } })), { current: 0, target: 1 });
});

test('achievementMetric: reactionsOwned counts bought reactions', () => {
  const fan = ACHIEVEMENTS.find(a => a.id === 'reaction_fan');
  assert.equal(isAchievementComplete(fan, achievementSnapshot({ ownedReactions: ['wink'] })), false);
  assert.equal(isAchievementComplete(fan, achievementSnapshot({ ownedReactions: ['wink', 'yawn'] })), true);
});

test('diffNewlyCompletedAchievements: fires when a Boostie reaches level 4 or a 2nd reaction is bought', () => {
  const prev = achievementSnapshot({ boosties: { zapi: { xp: 349 } }, ownedReactions: ['wink'] });
  const next = achievementSnapshot({ boosties: { zapi: { xp: 350 } }, ownedReactions: ['wink', 'yawn'] });
  const ids = diffNewlyCompletedAchievements(prev, next).map(a => a.id);
  assert.ok(ids.includes('boostie_grown'));
  assert.ok(ids.includes('reaction_fan'));
  assert.deepEqual(diffNewlyCompletedAchievements(next, next), []);
});

test('diffNewlyCompletedAchievements: stat-based achievements still fire', () => {
  const prev = { stats: { gamesPlayed: 4 } };
  const next = { stats: { gamesPlayed: 5 } };
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
  const prev = { stats: { wordsAccepted: 19 } };
  const next = { stats: { wordsAccepted: 20 } };
  const ids = diffNewlyCompletedAchievements(prev, next).map(a => a.id);
  assert.ok(ids.includes('word_contributor'));
});

test('word_contributor: does not fire below threshold', () => {
  const prev = { stats: { wordsAccepted: 0 } };
  const next = { stats: { wordsAccepted: 19 } };
  const ids = diffNewlyCompletedAchievements(prev, next).map(a => a.id);
  assert.ok(!ids.includes('word_contributor'));
});

test('nextAchievement: closest unfinished achievement, static (from === to); null without data', async () => {
  const { nextAchievement, ACHIEVEMENTS } = await import('./avatarScreens.js');
  assert.equal(nextAchievement(null), null);
  assert.equal(nextAchievement({}), null);
  const n = nextAchievement({ stats: {} });
  assert.ok(n && n.from === n.to && n.target > 0 && n.to < n.target);
  assert.ok(ACHIEVEMENTS.includes(n.achievement));
});
