import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STORE_AVATARS, STORE_PRICES, STORE_CATEGORY_ORDER,
  findStoreAvatar, isStoreAvatarId, storeAvatarSrc, priceFor, isOwned,
  storeAvatarsByCategory,
} from './avatarStore.js';

test('STORE_AVATARS has 36 entries with the expected per-category counts', () => {
  assert.equal(STORE_AVATARS.length, 36);
  const byCat = storeAvatarsByCategory();
  assert.equal(byCat.common.length, 16);
  assert.equal(byCat.rare.length, 8);
  assert.equal(byCat.epic.length, 8);
  assert.equal(byCat.legendary.length, 4);
});

test('ids round-trip to lowercase PNG paths under images/icons/avatars/', () => {
  assert.equal(storeAvatarSrc('common_1'), 'images/icons/avatars/common_1.png');
  assert.equal(storeAvatarSrc('rare_8'), 'images/icons/avatars/rare_8.png');
  // legendary filenames are lowercase
  assert.equal(storeAvatarSrc('legendary_3'), 'images/icons/avatars/legendary_3.png');
  assert.equal(storeAvatarSrc('legendary_4'), 'images/icons/avatars/legendary_4.png');
  assert.equal(storeAvatarSrc('nope'), null);
});

test('isStoreAvatarId / findStoreAvatar recognise catalog ids only', () => {
  assert.equal(isStoreAvatarId('epic_2'), true);
  assert.equal(isStoreAvatarId('crown'), false); // achievement avatar, not store
  assert.equal(isStoreAvatarId('legendary_5'), false); // out of range
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
