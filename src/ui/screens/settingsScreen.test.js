import { test } from 'node:test';
import assert from 'node:assert/strict';

import { skinOptionsHtml } from './settingsScreen.js';

const btn = (html, id) => html.match(new RegExp(`<button[^>]*id="sett-skin-${id}"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? '';

test('skinOptionsHtml: Classic is always owned; an unowned skin is locked and points to the store', () => {
  const html = skinOptionsHtml({ chosen: 'classic', owned: [] });
  const classic = btn(html, 'classic');
  const stone = btn(html, 'stone');
  assert.match(classic, /class="sett-skin on"/);
  assert.match(classic, /aria-checked="true"/);
  assert.match(stone, /is-locked/);
  assert.match(stone, /aria-checked="false"/);
  assert.match(stone, /sett-skin-lock[\s\S]*בחנות/);
  assert.match(stone, /אבן ירושלים/);
});

test('skinOptionsHtml: an owned, chosen skin is on and unlocked', () => {
  const html = skinOptionsHtml({ chosen: 'stone', owned: ['stone'] });
  assert.match(btn(html, 'stone'), /class="sett-skin on"/);
  assert.doesNotMatch(btn(html, 'stone'), /is-locked|בחנות/);
  assert.match(btn(html, 'classic'), /class="sett-skin"/);
});

test('skinOptionsHtml: a chosen-but-unowned skin is never shown as on', () => {
  const html = skinOptionsHtml({ chosen: 'stone', owned: [] });
  assert.doesNotMatch(btn(html, 'stone'), / on/);
});
