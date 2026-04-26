const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

function getCompactLandscapeBlock(css) {
  const marker = '@media (max-height: 520px) and (orientation: landscape) {';
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, 'compact landscape media query must exist');

  let depth = 0;
  let end = -1;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  assert.notEqual(end, -1, 'compact landscape media query must have closing brace');
  return css.slice(start, end + 1);
}

test('compact landscape layout uses vertical flex flow with non-overlapping rack and board', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const block = getCompactLandscapeBlock(css);

  assert.match(block, /\.game-screen,[\s\S]*#sg\s*\{[\s\S]*height:\s*100vh;[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.top-hud\s*\{[\s\S]*height:\s*50px;[\s\S]*flex:\s*0 0 50px;/s);
  assert.match(block, /\.status-row,[\s\S]*\.sbar\s*\{[\s\S]*height:\s*22px;[\s\S]*flex:\s*0 0 22px;/s);

  assert.match(block, /\.rack-bar,[\s\S]*\.bot\s*\{[\s\S]*position:\s*relative\s*!important;[\s\S]*inset:\s*auto\s*!important;[\s\S]*height:\s*78px;[\s\S]*flex:\s*0 0 78px;/s);
  assert.doesNotMatch(block, /\.rack-bar[\s\S]*position:\s*(fixed|absolute)/s);

  assert.match(block, /\.game-main,[\s\S]*\.game-area\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*0;[\s\S]*height:\s*auto;[\s\S]*grid-template-columns:\s*118px auto 118px;[\s\S]*column-gap:\s*12px;[\s\S]*padding:\s*0 12px;/s);

  assert.match(block, /\.board-area,[\s\S]*\.board-center\s*\{[\s\S]*--board-size:\s*min\([\s\S]*calc\(100vh - 50px - 22px - 78px - 18px\),[\s\S]*calc\(100vw - 236px - 48px\),[\s\S]*360px[\s\S]*\);[\s\S]*width:\s*var\(--board-size\);[\s\S]*height:\s*var\(--board-size\);[\s\S]*transform:\s*none\s*!important;/s);
  assert.doesNotMatch(block, /\.board-area[\s\S]*transform:\s*scale\(/s);
});

test('compact landscape player panels and rack controls are constrained to avoid clipping', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const block = getCompactLandscapeBlock(css);

  assert.match(block, /\.player-panel,[\s\S]*\.player-card\s*\{[\s\S]*width:\s*100%;[\s\S]*max-height:\s*100%;[\s\S]*padding:\s*5px;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.player-avatar,[\s\S]*\.player-panel \.avatar,[\s\S]*\.player-card \.avatar\s*\{[\s\S]*width:\s*46px;[\s\S]*height:\s*46px;/s);
  assert.match(block, /\.score-value,[\s\S]*\.score-box \.scval\s*\{[\s\S]*font-size:\s*20px;[\s\S]*line-height:\s*1;/s);
  assert.match(block, /\.timer-value,[\s\S]*\.player-timer\s*\{[\s\S]*font-size:\s*18px;[\s\S]*line-height:\s*1;/s);
  assert.match(block, /\.submit,[\s\S]*\.rack-action,[\s\S]*\.bplay\s*\{[\s\S]*height:\s*58px;[\s\S]*min-width:\s*72px;/s);
});
