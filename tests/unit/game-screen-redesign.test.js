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

  assert.match(css, /--cyan-light:\s*#8BF5FA;/);
  assert.match(css, /--panel-bg:\s*rgba\(255,255,255,0\.12\);/);
  assert.match(css, /--tile-bg-top:\s*#fff3cf;/);
  assert.match(css, /\.game-area(?:,\s*\.game-main)?\s*\{[^}]*grid-template-columns:\s*170px minmax\(520px, 1fr\) 170px;/s);
  assert.match(css, /\.board-center-inner\s*\{[^}]*border-radius:28px;/s);
  assert.match(css, /\.bag-display\s*\{[^}]*border-radius:var\(--radius-md\);/s);
  assert.match(css, /\.player-card\s*\{[^}]*border-radius:28px;/s);
  assert.match(css, /\.bplay-submit\{[^}]*rgba\(249,245,75,.75\)/s);
  assert.match(css, /\.bt2\{[^}]*var\(--tile-bg-top\)[^}]*var\(--tile-bg-bottom\)/s);
  assert.match(css, /\.board-center-inner::before\s*\{[^}]*radial-gradient/s);
  assert.match(css, /\.sbar:empty\{display:none;\}/);
  assert.match(css, /@keyframes lowTimerPulse/);
});

test('timer refresh toggles low-time pulse class on active player timer only', () => {
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

  assert.match(js, /p1Timer\.classList\.toggle\('low-time', turn===0 && secLeft <= 5\)/);
  assert.match(js, /p2Timer\.classList\.toggle\('low-time', turn===1 && secLeft <= 5\)/);
  assert.match(js, /if\(p1Timer\) p1Timer\.classList\.remove\('low-time'\);/);
  assert.match(js, /if\(p2Timer\) p2Timer\.classList\.remove\('low-time'\);/);
});


test('player panel mode uses player avatars for 1v1 and bot avatar only in computer mode', () => {
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(js, /function syncPlayerPanelMode\(\)/);
  assert.match(js, /const isVsComputer = currentMode === 'computer' \|\| gameMode === 'bot' \|\| gMode === 'bot';/);
  assert.match(js, /p1Avatar\.src = 'jocker\.PNG';/);
  assert.match(js, /p2Avatar\.src = isVsComputer \? '1vBot\.png' : 'jocker\.PNG';/);
  assert.match(js, /p2Name\) p2Name\.textContent = isVsComputer \? 'המחשב' : 'שחקן 2';/);

  assert.match(html, /id="player1-avatar"/);
  assert.match(html, /id="player2-avatar"/);
});
