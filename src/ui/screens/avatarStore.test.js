import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STORE_AVATARS, STORE_PRICES, STORE_CATEGORY_ORDER, DEFAULT_STORE_AVATAR_ID,
  findStoreAvatar, isStoreAvatarId, storeAvatarSrc, priceFor, isOwned,
  storeAvatarsByCategory,
} from './avatarStore.js';

test('STORE_AVATARS has 44 entries with the expected per-category counts', () => {
  assert.equal(STORE_AVATARS.length, 44);
  const byCat = storeAvatarsByCategory();
  assert.equal(byCat.common.length, 17);
  assert.equal(byCat.rare.length, 12);
  assert.equal(byCat.epic.length, 10);
  assert.equal(byCat.legendary.length, 5);
});

test('default avatar (common_17) is the anonymous-player art and is free/owned', () => {
  assert.equal(DEFAULT_STORE_AVATAR_ID, 'common_17');
  assert.equal(storeAvatarSrc(DEFAULT_STORE_AVATAR_ID), 'assets/avatars/anonymous%20player.png');
  assert.equal(findStoreAvatar(DEFAULT_STORE_AVATAR_ID)?.category, 'common');
  assert.equal(priceFor(DEFAULT_STORE_AVATAR_ID), 0);
  assert.equal(isOwned(DEFAULT_STORE_AVATAR_ID, []), true);
});

test('ids map to URL-encoded PNG paths under assets/avatars_v2/<category>/', () => {
  assert.equal(storeAvatarSrc('common_1'), 'assets/avatars_v2/common/basketball_player.png');
  assert.equal(storeAvatarSrc('rare_4'), 'assets/avatars_v2/rare/ilan_ramon.png');
  assert.equal(storeAvatarSrc('rare_12'), 'assets/avatars_v2/rare/rare_1_top_right.png');
  // filenames with spaces / Hebrew / mixed-case extension are URL-encoded
  assert.equal(storeAvatarSrc('epic_6'), 'assets/avatars_v2/epic/%D7%9E%D7%A8%D7%93%D7%9B%D7%99%20%D7%94%D7%99%D7%94%D7%95%D7%93%D7%99.PNG');
  assert.equal(storeAvatarSrc('legendary_4'), 'assets/avatars_v2/legendary/moses.png');
  assert.equal(storeAvatarSrc('nope'), null);
});

test('isStoreAvatarId / findStoreAvatar recognise catalog ids only', () => {
  assert.equal(isStoreAvatarId('epic_2'), true);
  assert.equal(isStoreAvatarId('crown'), false); // achievement avatar, not store
  assert.equal(isStoreAvatarId('legendary_6'), false); // out of range (5 legendaries)
  assert.equal(findStoreAvatar('epic_2')?.category, 'epic');
  assert.equal(findStoreAvatar('crown'), null);
});

test('priceFor reflects the flat per-tier prices', () => {
  assert.equal(priceFor('common_1'), 0);
  assert.equal(priceFor('rare_1'), STORE_PRICES.rare);
  assert.equal(priceFor('epic_1'), STORE_PRICES.epic);
  assert.equal(priceFor('legendary_1'), STORE_PRICES.legendary);
  assert.equal(priceFor('unknown'), 0);
  // grindy/prestige ordering: rare < epic < legendary
  assert.ok(STORE_PRICES.rare < STORE_PRICES.epic);
  assert.ok(STORE_PRICES.epic < STORE_PRICES.legendary);
});

test('isOwned: common always owned; others require the purchased list', () => {
  assert.equal(isOwned('common_5', []), true);
  assert.equal(isOwned('rare_1', []), false);
  assert.equal(isOwned('rare_1', ['rare_1']), true);
  assert.equal(isOwned('legendary_2', ['rare_1', 'legendary_2']), true);
  assert.equal(isOwned('unknown', ['unknown']), false);
});

test('STORE_CATEGORY_ORDER runs common → legendary', () => {
  assert.deepEqual(STORE_CATEGORY_ORDER, ['common', 'rare', 'epic', 'legendary']);
});
