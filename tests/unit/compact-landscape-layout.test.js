const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('compact landscape media query defines compact board and spacing vars', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(css, /@media \(max-height:\s*520px\) and \(orientation:\s*landscape\)\s*\{[\s\S]*--top-hud-h:\s*54px;[\s\S]*--status-h:\s*24px;[\s\S]*--rack-h:\s*86px;[\s\S]*--safe-gap:\s*8px;[\s\S]*--side-panel-w:\s*92px;[\s\S]*--side-gap:\s*8px;[\s\S]*430px/s);
  assert.match(css, /@media \(max-height:\s*520px\) and \(orientation:\s*landscape\)\s*\{[\s\S]*\.game-main,[\s\S]*\.game-area\s*\{[\s\S]*grid-template-columns:\s*var\(--side-panel-w\) var\(--board-size\) var\(--side-panel-w\);[\s\S]*column-gap:\s*var\(--side-gap\);[\s\S]*padding:\s*0;[\s\S]*margin:\s*0;/s);
});

test('compact landscape mode shrinks HUD status rack and side cards', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(css, /@media \(max-height:\s*520px\) and \(orientation:\s*landscape\)\s*\{[\s\S]*\.top-hud\s*\{[\s\S]*margin:\s*4px 8px;/s);
  assert.match(css, /@media \(max-height:\s*520px\) and \(orientation:\s*landscape\)\s*\{[\s\S]*\.status-row,[\s\S]*\.sbar\s*\{[\s\S]*margin:\s*2px 0;/s);
  assert.match(css, /@media \(max-height:\s*520px\) and \(orientation:\s*landscape\)\s*\{[\s\S]*\.player-panel,[\s\S]*\.player-card\s*\{[\s\S]*width:\s*var\(--side-panel-w\);[\s\S]*padding:\s*5px;/s);
  assert.match(css, /@media \(max-height:\s*520px\) and \(orientation:\s*landscape\)\s*\{[\s\S]*\.rack-bar,[\s\S]*\.bot\s*\{[\s\S]*height:\s*var\(--rack-h\);[\s\S]*padding:\s*6px 10px;/s);
});
