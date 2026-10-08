import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  XP_PER_GAME, XP_WIN_BONUS, XP_DRAW_BONUS, LEVEL_XP, MAX_GAME_XP,
  xpForGame, clampXp, levelFromXp, progressToNext, xpFromPastStats,
  normalizeBoosties, applyGameXp, equippedBoostie, profileAvatarValue,
} from './boostieXp.js';
import {
  BOOSTIES, BOOSTIE_LEVELS, DEFAULT_BOOSTIE, CHAIN_ORDER, STARTER_BOOSTIES,
  isBoostieId, clampLevel, boostieStillSrc, boostieModelSrc, nextChainBoostie, boostieName,
  boostieAvatarValue, parseBoostieAvatar, parseStoreItem,
} from './boostieCatalog.js';

// ── XP per game ──────────────────────────────────────────────────────────────

test('xpForGame: every finished game gives XP, a win gives more, a draw in between', () => {
  assert.equal(xpForGame('loss'), XP_PER_GAME);
  assert.equal(xpForGame('win'), XP_PER_GAME + XP_WIN_BONUS);
  assert.equal(xpForGame('draw'), XP_PER_GAME + XP_DRAW_BONUS);
  assert.ok(xpForGame('win') > xpForGame('draw'));
  assert.ok(xpForGame('draw') > xpForGame('loss'));
  assert.equal(MAX_GAME_XP, xpForGame('win'));
});

test('xpForGame: unfinished or unknown results give nothing', () => {
  for (const r of ['abandoned', 'forfeit', '', undefined, null, 1200]) assert.equal(xpForGame(r), 0);
});

// ── levels ───────────────────────────────────────────────────────────────────

test('LEVEL_XP: 7 increasing thresholds starting at 0', () => {
  assert.equal(LEVEL_XP.length, BOOSTIE_LEVELS);
  assert.equal(LEVEL_XP[0], 0);
  for (let i = 1; i < LEVEL_XP.length; i++) assert.ok(LEVEL_XP[i] > LEVEL_XP[i - 1]);
});

test('levelFromXp: boundaries', () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(LEVEL_XP[1] - 1), 1);
  assert.equal(levelFromXp(LEVEL_XP[1]), 2);
  assert.equal(levelFromXp(LEVEL_XP[3]), 4);
  assert.equal(levelFromXp(LEVEL_XP[6]), 7);
  assert.equal(levelFromXp(1e9), 7);
  assert.equal(levelFromXp(-50), 1);
  assert.equal(levelFromXp('abc'), 1);
});

test('pace: ~3 games a day (half won) reaches level 4 in about a week', () => {
  const perGame = (xpForGame('win') + xpForGame('loss')) / 2;
  const week = 3 * 7 * perGame;
  assert.equal(levelFromXp(week), 3);                 // 21 games: just short
  assert.equal(levelFromXp(week + 3 * perGame), 4);   // 24 games, day 8
});

test('progressToNext: mid-level, exact threshold and top level', () => {
  const p = progressToNext(LEVEL_XP[1] + 25);
  assert.equal(p.level, 2);
  assert.equal(p.into, 25);
  assert.equal(p.span, LEVEL_XP[2] - LEVEL_XP[1]);
  assert.equal(p.nextAt, LEVEL_XP[2]);
  assert.equal(p.ratio, 25 / p.span);
  assert.equal(progressToNext(LEVEL_XP[2]).into, 0);
  const top = progressToNext(LEVEL_XP[6] + 500);
  assert.equal(top.level, 7);
  assert.equal(top.ratio, 1);
  assert.equal(top.nextAt, null);
});

test('clampXp: non-negative integers', () => {
  assert.equal(clampXp(12.9), 12);
  assert.equal(clampXp(-3), 0);
  assert.equal(clampXp(undefined), 0);
});

// ── migration from stats ─────────────────────────────────────────────────────

test('xpFromPastStats: same rates as live games', () => {
  assert.equal(xpFromPastStats({ gamesPlayed: 10, gamesWon: 4, gamesDraw: 1 }),
    4 * xpForGame('win') + 1 * xpForGame('draw') + 5 * xpForGame('loss'));
  assert.equal(xpFromPastStats(null), 0);
  // corrupt stats can't give more than "every game won"
  assert.equal(xpFromPastStats({ gamesPlayed: 2, gamesWon: 9, gamesDraw: 9 }), 2 * xpForGame('win'));
});

// ── profile.boosties ─────────────────────────────────────────────────────────

test('normalizeBoosties: drops unknown ids, recomputes levels, adds every starter', () => {
  const n = normalizeBoosties({ bubo: { xp: LEVEL_XP[2], level: 7 }, rare_3: { xp: 999 } });
  assert.deepEqual(n.bubo, { xp: LEVEL_XP[2], level: 3 });
  assert.equal(n.rare_3, undefined);
  assert.deepEqual(n[DEFAULT_BOOSTIE], { xp: 0, level: 1 });
  assert.deepEqual(normalizeBoosties(null), { zapi: { xp: 0, level: 1 }, bubo: { xp: 0, level: 1 }, rocco: { xp: 0, level: 1 }, lumi: { xp: 0, level: 1 } });
});

test('applyGameXp: adds XP to the equipped Boostie only', () => {
  const r = applyGameXp({ zapi: { xp: 0 }, bubo: { xp: 30 } }, 'bubo', 'loss');
  assert.equal(r.gained, xpForGame('loss'));
  assert.equal(r.boosties.bubo.xp, 30 + xpForGame('loss'));
  assert.equal(r.boosties.zapi.xp, 0);
  assert.equal(r.levelUp, null);
  assert.equal(r.unlocked, null);
});

test('applyGameXp: reports a level-up', () => {
  const r = applyGameXp({ zapi: { xp: LEVEL_XP[1] - 5 } }, 'zapi', 'win');
  assert.deepEqual(r.levelUp, { id: 'zapi', from: 1, to: 2 });
  assert.equal(r.boosties.zapi.level, 2);
});

test('applyGameXp: an unknown equipped id falls back to the starter; a starter is always owned', () => {
  assert.equal(applyGameXp({}, 'common_17', 'loss').boosties.zapi.xp, xpForGame('loss'));
  // Bubo is a starter: equipping it works even before it has an entry.
  const r = applyGameXp({ zapi: { xp: 0 } }, 'bubo', 'win');
  assert.equal(r.boosties.bubo.xp, xpForGame('win'));
  assert.equal(r.boosties.zapi.xp, 0);
});

test('applyGameXp: reaching the top level reports the level-up; no locked Boosties to unlock yet', () => {
  const r = applyGameXp({ zapi: { xp: LEVEL_XP[6] - 1 } }, 'zapi', 'loss');
  assert.deepEqual(r.levelUp, { id: 'zapi', from: 6, to: 7 });
  assert.equal(r.unlocked, null);
});

test('applyGameXp: XP keeps counting at the top level, no second unlock', () => {
  const r = applyGameXp({ zapi: { xp: LEVEL_XP[6] + 10 }, bubo: { xp: 0 } }, 'zapi', 'win');
  assert.equal(r.boosties.zapi.xp, LEVEL_XP[6] + 10 + xpForGame('win'));
  assert.equal(r.levelUp, null);
  assert.equal(r.unlocked, null);
});

test('applyGameXp: nothing to unlock when the chain is complete', () => {
  const r = applyGameXp({ zapi: { xp: 0 }, bubo: { xp: LEVEL_XP[6] - 1 } }, 'bubo', 'win');
  assert.equal(r.levelUp.to, 7);
  assert.equal(r.unlocked, null);
});

test('applyGameXp: does not mutate its input', () => {
  const input = { zapi: { xp: 5, level: 1 } };
  applyGameXp(input, 'zapi', 'win');
  assert.deepEqual(input, { zapi: { xp: 5, level: 1 } });
});

// ── catalog ──────────────────────────────────────────────────────────────────

test('catalog: ids, starter and chain', () => {
  assert.ok(isBoostieId('zapi'));
  assert.ok(isBoostieId('bubo'));
  assert.ok(!isBoostieId('common_17'));
  assert.ok(!isBoostieId('toString'));
  assert.equal(BOOSTIES[DEFAULT_BOOSTIE].unlock, 'starter');
  assert.deepEqual([...STARTER_BOOSTIES], ['zapi', 'bubo', 'rocco', 'lumi']);
  for (const id of CHAIN_ORDER) assert.equal(BOOSTIES[id].unlock, 'chain');
  assert.equal(nextChainBoostie(['zapi']), null); // nothing locked yet
  // With a chain: the first id not owned, from an array or a { id: … } map.
  assert.equal(nextChainBoostie(['zapi', 'nova'], ['nova', 'rex']), 'rex');
  assert.equal(nextChainBoostie({ nova: {}, rex: {} }, ['nova', 'rex']), null);
  assert.equal(boostieName('nope'), BOOSTIES[DEFAULT_BOOSTIE].name);
});

test('catalog: Drako is sold in the store only, the other new Boosties are starters', () => {
  assert.equal(BOOSTIES.drako.unlock, 'store');
  assert.ok(!STARTER_BOOSTIES.includes('drako'));
  assert.ok(!CHAIN_ORDER.includes('drako'));
  assert.deepEqual(parseStoreItem('boostie:drako'), { kind: 'boostie', id: 'drako', price: BOOSTIES.drako.price });
  assert.ok(BOOSTIES.drako.price > 0);
  assert.equal(parseStoreItem('boostie:rocco'), null); // starters aren't for sale
  assert.equal(boostieModelSrc('lumi', 3), 'assets/boosties/lumi_l3.glb');
});

test('catalog: asset paths clamp the level and fall back to the starter', () => {
  assert.equal(boostieStillSrc('bubo', 3), 'assets/avatars/boosties/bubo/l3_bust.webp');
  assert.equal(boostieStillSrc('bubo', 9, 'full'), 'assets/avatars/boosties/bubo/l7_full.webp');
  assert.equal(boostieStillSrc('x', 0), 'assets/avatars/boosties/zapi/l1_bust.webp');
  assert.equal(boostieModelSrc('zapi', 4), 'assets/boosties/zapi_l4.glb');
  assert.equal(clampLevel('5'), 5);
});

// ── avatar values ('zapi:4') ─────────────────────────────────────────────────

test('boostieAvatarValue / parseBoostieAvatar round-trip', () => {
  assert.equal(boostieAvatarValue('bubo', 4), 'bubo:4');
  assert.equal(boostieAvatarValue('nope', 99), 'zapi:7');
  assert.deepEqual(parseBoostieAvatar('bubo:4'), { id: 'bubo', level: 4 });
  assert.deepEqual(parseBoostieAvatar('zapi'), { id: 'zapi', level: 1 });
  assert.deepEqual(parseBoostieAvatar('zapi:12'), { id: 'zapi', level: 7 });
  assert.deepEqual(parseBoostieAvatar({ char: 'bubo', level: 2 }), { id: 'bubo', level: 2 });
  for (const v of ['common_17', 'rare_3', '👑', 'bot_easy', '', null, 'toString', 'zapi:x', { id: 'x' }]) {
    assert.equal(parseBoostieAvatar(v), null, String(v));
  }
});

test('equippedBoostie / profileAvatarValue: level from XP, unowned or old ids show the starter', () => {
  const p = { equippedAvatar: 'bubo', boosties: { zapi: { xp: 0 }, bubo: { xp: LEVEL_XP[3] } } };
  assert.deepEqual(equippedBoostie(p), { id: 'bubo', xp: LEVEL_XP[3], level: 4 });
  assert.equal(profileAvatarValue(p), 'bubo:4');
  assert.equal(profileAvatarValue({ equippedAvatar: 'bubo', boosties: { zapi: { xp: LEVEL_XP[1] } } }), 'bubo:1'); // starter, owned implicitly
  assert.equal(profileAvatarValue({ equippedAvatar: 'common_17' }), 'zapi:1');
  assert.equal(profileAvatarValue(null), 'zapi:1');
});
