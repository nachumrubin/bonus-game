import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, DEFAULT_SKIN, isSkinId, ownsSkin, resolveActiveSkin } from './skinCatalog.js';
import { parseStoreItem } from './boostieCatalog.js';

test('skin catalog: classic is free, stone costs 1,500', () => {
  assert.equal(DEFAULT_SKIN, 'classic');
  assert.equal(SKINS.classic.price, 0);
  assert.equal(SKINS.stone.price, 1500);
  assert.ok(isSkinId('stone'));
  assert.ok(!isSkinId('toString'));
});

test('ownsSkin: free skins always, paid ones only from ownedSkins', () => {
  assert.ok(ownsSkin('classic', undefined));
  assert.ok(!ownsSkin('stone', []));
  assert.ok(!ownsSkin('stone', null));
  assert.ok(ownsSkin('stone', ['stone']));
  assert.ok(!ownsSkin('nope', ['nope']));
});

test('resolveActiveSkin: unowned or unknown choices fall back to classic', () => {
  assert.equal(resolveActiveSkin('stone', ['stone']), 'stone');
  assert.equal(resolveActiveSkin('stone', []), 'classic');
  assert.equal(resolveActiveSkin('stone', undefined), 'stone', 'profile not loaded yet: trust the saved choice');
  assert.equal(resolveActiveSkin('bogus', ['bogus']), 'classic');
  assert.equal(resolveActiveSkin(undefined, undefined), 'classic');
});

test('parseStoreItem: skin items', () => {
  assert.deepEqual(parseStoreItem('skin:stone'), { kind: 'skin', id: 'stone', price: 1500 });
  assert.equal(parseStoreItem('skin:classic'), null);
  assert.equal(parseStoreItem('skin:dusk'), null);
});

test('skin catalog: Midnight Marble is a dark paid skin at 1,500', () => {
  assert.equal(SKINS.marble.price, 1500);
  assert.equal(SKINS.marble.light, false);
  assert.deepEqual(parseStoreItem('skin:marble'), { kind: 'skin', id: 'marble', price: 1500 });
  assert.ok(ownsSkin('marble', ['stone', 'marble']));
  assert.ok(!ownsSkin('marble', ['stone']), 'owning one skin does not unlock another');
  assert.equal(resolveActiveSkin('marble', ['stone']), 'classic');
});

// Every paid skin needs its generated sheet, a <link data-skin-css> in index.html, a
// boot-script theme colour (no flash of Classic) and its logo art on disk.
test('every paid skin is wired up: stylesheet, link, boot colour, logo assets', async () => {
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const html = readFileSync(root + 'index.html', 'utf8');
  for (const s of Object.values(SKINS).filter((x) => x.price > 0)) {
    assert.ok(existsSync(root + `skin-${s.id}.css`), `skin-${s.id}.css (npm run build:skins)`);
    assert.ok(existsSync(root + `skins/${s.id}-overrides.css`), `skins/${s.id}-overrides.css`);
    assert.match(html, new RegExp(`href="skin-${s.id}\.css[^"]*" data-skin-css="${s.id}" media="not all"`));
    assert.match(html, new RegExp(`${s.id}:'${s.themeColor}'`), `boot script theme colour for ${s.id}`);
    assert.ok(existsSync(root + s.logo), s.logo);
    assert.equal(readdirSync(root + s.logoTiles).filter((f) => f.endsWith('.webp')).length, 14, s.logoTiles);
  }
});
