import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDailyClaim, applyAchievementClaim, applyPurchase, applyChainClaim, applyCoinCredit,
  rememberRequest, coinDelta, isRequestId, orderKey, ymdIn,
  DAILY_BASE, DAILY_STREAK_INCREMENT, ACHIEVEMENT_COIN_REWARD, MAX_COIN_BALANCE,
  COIN_PACKS, RECENT_REQUESTS_MAX,
} from './economy.js';
import { STARTER_BOOSTIES, BOOSTIE_LEVELS } from './boostieCatalog.js';

test('applyDailyClaim: grants once per day, the streak grows on consecutive days', () => {
  const first = applyDailyClaim({ coins: 0, rating: 800 }, '2026-06-22');
  assert.equal(first.result.coinsAwarded, DAILY_BASE);
  assert.deepEqual([first.next.coins, first.next.lastLoginDate, first.next.loginStreak, first.next.rating],
    [DAILY_BASE, '2026-06-22', 1, 800]);
  const again = applyDailyClaim(first.next, '2026-06-22');
  assert.equal(again.next, undefined, 'same day: nothing to write');
  assert.equal(again.result.alreadyClaimedToday, true);
  const day2 = applyDailyClaim(first.next, '2026-06-23');
  assert.equal(day2.result.coinsAwarded, DAILY_BASE + DAILY_STREAK_INCREMENT);
  assert.equal(day2.next.loginStreak, 2);
});

test('applyDailyClaim: the balance is capped', () => {
  const r = applyDailyClaim({ coins: MAX_COIN_BALANCE - 1 }, '2026-06-22');
  assert.equal(r.next.coins, MAX_COIN_BALANCE);
});

test('applyAchievementClaim: pays a complete achievement once, refuses the rest', () => {
  assert.equal(applyAchievementClaim({ coins: 0 }, 'nope').result.reason, 'unknown-achievement');
  assert.equal(applyAchievementClaim({ coins: 0, stats: { gamesPlayed: 4 } }, 'first_steps').result.reason, 'not-complete');
  const paid = applyAchievementClaim({ coins: 10, stats: { gamesPlayed: 5 } }, 'first_steps', 123);
  assert.equal(paid.result.reward, ACHIEVEMENT_COIN_REWARD.bronze);
  assert.equal(paid.next.coins, 10 + ACHIEVEMENT_COIN_REWARD.bronze);
  assert.equal(paid.next.achievementsPaid.first_steps, 123);
  assert.equal(applyAchievementClaim(paid.next, 'first_steps').result.reason, 'already-paid');
});

test('applyPurchase: price from the catalog, item granted in the same write', () => {
  const r = applyPurchase({ coins: 600, boosties: { zapi: { xp: 60, level: 2 } } }, 'reaction:wink');
  assert.equal(r.result.ok, true);
  assert.equal(r.next.coins, 350);
  assert.deepEqual(r.next.ownedReactions, ['wink']);
  assert.deepEqual(r.next.boosties.zapi, { xp: 60, level: 2 });
  const r2 = applyPurchase(r.next, 'reaction:yawn');
  assert.deepEqual([r2.next.coins, r2.next.ownedReactions], [100, ['wink', 'yawn']]);
});

test('applyPurchase: refuses owned, unaffordable, free and unknown items without a write', () => {
  const p = { coins: 100, ownedReactions: ['yawn'] };
  for (const [item, reason] of [
    ['reaction:yawn', 'already-owned'], ['reaction:wink', 'insufficient'],
    ['boostie:zapi', 'unknown-item'], ['boostie:bubo', 'unknown-item'],   // starters aren't sold
    ['reaction:laugh', 'unknown-item'], ['rare_3', 'unknown-item'],
  ]) {
    const r = applyPurchase(p, item);
    assert.equal(r.next, undefined, item);
    assert.equal(r.result.reason, reason, item);
  }
});

test('applyChainClaim: needs a top-level Boostie and something left to unlock', () => {
  assert.equal(applyChainClaim({ boosties: { zapi: { xp: 0, level: 3 } } }).result.reason, 'no-top-level');
  const all = Object.fromEntries(STARTER_BOOSTIES.map((id) => [id, { xp: 2000, level: BOOSTIE_LEVELS }]));
  assert.equal(applyChainClaim({ boosties: all }).result.reason, 'nothing-to-unlock'); // no locked Boosties yet
});

test('applyCoinCredit: credits a pack once per order', () => {
  const r = applyCoinCredit({ coins: 5 }, { orderId: 'GPA.1-2', productId: 'coins_500' }, 7);
  assert.equal(r.result.credited, COIN_PACKS.coins_500.coins);
  assert.equal(r.next.coins, 505);
  assert.deepEqual(r.next.coinOrders['GPA_1-2'], { productId: 'coins_500', coins: 500, ts: 7 });
  const again = applyCoinCredit(r.next, { orderId: 'GPA.1-2', productId: 'coins_500' });
  assert.deepEqual([again.next, again.result.already], [undefined, true]);
  assert.equal(applyCoinCredit({}, { orderId: 'x', productId: 'coins_free' }).result.reason, 'unknown-product');
  assert.equal(applyCoinCredit({}, { orderId: '', productId: 'coins_500' }).result.reason, 'no-order');
});

test('rememberRequest: keeps only the newest request ids', () => {
  let p = { coins: 0 };
  for (let i = 0; i < RECENT_REQUESTS_MAX + 5; i++) p = rememberRequest(p, `req-${String(i).padStart(6, '0')}`, { ok: true }, i);
  const ids = Object.keys(p.econRecent);
  assert.equal(ids.length, RECENT_REQUESTS_MAX);
  assert.ok(!ids.includes('req-000000'), 'the oldest is dropped');
  assert.ok(ids.includes(`req-${String(RECENT_REQUESTS_MAX + 4).padStart(6, '0')}`));
});

test('helpers: request ids, order keys, coin deltas, server day', () => {
  assert.equal(isRequestId('abcd1234'), true);
  assert.equal(isRequestId('short'), false);
  assert.equal(isRequestId('has/slash1'), false);
  assert.equal(orderKey('GPA.12.34'), 'GPA_12_34');
  assert.equal(coinDelta({ coins: 40 }, { coins: 15 }), -25);
  // 2026-10-06 22:30 UTC is already the 7th in Israel (UTC+3 in October).
  assert.equal(ymdIn('Asia/Jerusalem', new Date(Date.UTC(2026, 9, 6, 22, 30))), '2026-10-07');
});

test('rules sync: the starter ids hardcoded in the database rules match the catalog', async () => {
  const { readFile } = await import('node:fs/promises');
  const rules = await readFile(new URL('../../../firebase.database.rules.json', import.meta.url), 'utf8');
  const m = rules.match(/"\.validate": "data\.exists\(\) \|\| ([^"]+)"/);
  assert.ok(m, 'the boosties $boostieId rule exists');
  const ids = [...m[1].matchAll(/\$boostieId === '([a-z0-9_]+)'/g)].map((x) => x[1]);
  assert.deepEqual(ids.sort(), [...STARTER_BOOSTIES].sort());
});
