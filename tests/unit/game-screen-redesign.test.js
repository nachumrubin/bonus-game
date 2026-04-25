const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('game screen keeps required ids and adds redesigned player/timer shells', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /id="game-grid"/);
  assert.match(html, /id="brack"/);
  assert.match(html, /id="btn-play"/);
  assert.match(html, /id="btn-recall"/);

  assert.match(html, /id="p1-timer-value"/);
  assert.match(html, /id="p2-timer-value"/);
  assert.match(html, /class="bag-badge"/);
  assert.match(html, /id="btn-shuffle"/);
  assert.match(html, /class="tb-icon-img"/);
  assert.match(html, /id="turn-timer" class="turn-timer hud-hidden"/);
});

test('css defines redesigned board shell and rack action styles', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(css, /\.board-center-inner\s*\{[^}]*border-radius:28px;/s);
  assert.match(css, /\.bag-display\s*\{[^}]*border-radius:18px;/s);
  assert.match(css, /\.player-card\s*\{[^}]*border-radius:28px;/s);
  assert.match(css, /\.bplay-submit\{[^}]*rgba\(249,245,75,.75\)/s);
  assert.match(css, /\.bt2\{[^}]*#fff3d0[^}]*#e7d5ad/s);
  assert.match(css, /\.board-center-inner::before\s*\{[^}]*radial-gradient/s);
  assert.match(css, /\.sbar:empty\{display:none;\}/);
});
