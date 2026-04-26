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

test('compact landscape enforces strict vertical flow with in-flow rack', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const block = getCompactLandscapeBlock(css);

  assert.match(block, /\.game-screen,[\s\S]*#sg\s*\{[\s\S]*height:\s*100vh;[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.top-hud\s*\{[\s\S]*height:\s*50px;[\s\S]*flex:\s*0 0 50px;/s);
  assert.match(block, /\.status-row,[\s\S]*\.sbar\s*\{[\s\S]*height:\s*22px;[\s\S]*flex:\s*0 0 22px;/s);
  assert.match(block, /\.rack-bar,[\s\S]*\.bot\s*\{[\s\S]*position:\s*relative\s*!important;[\s\S]*bottom:\s*auto\s*!important;[\s\S]*inset:\s*auto\s*!important;[\s\S]*height:\s*80px;[\s\S]*flex:\s*0 0 80px;/s);
  assert.doesNotMatch(block, /\.rack-bar[\s\S]*position:\s*(fixed|absolute)/s);

  assert.match(block, /\.game-main,[\s\S]*\.game-area\s*\{[\s\S]*flex:\s*1;[\s\S]*min-height:\s*0;[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*110px 1fr 110px;[\s\S]*gap:\s*10px;[\s\S]*overflow:\s*hidden;/s);
});

test('compact landscape constrains board and panels without transform hacks', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const block = getCompactLandscapeBlock(css);

  assert.match(block, /\.board-area,[\s\S]*\.board-center\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*display:\s*flex;[\s\S]*justify-content:\s*center;[\s\S]*align-items:\s*center;[\s\S]*transform:\s*none\s*!important;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.board-grid,[\s\S]*#game-grid\s*\{[\s\S]*aspect-ratio:\s*1 \/ 1;[\s\S]*max-width:\s*100%;[\s\S]*max-height:\s*100%;[\s\S]*overflow:\s*hidden;/s);
  assert.doesNotMatch(block, /\.board-area[\s\S]*transform:\s*scale\(/s);

  assert.match(block, /\.player-panel,[\s\S]*\.player-card\s*\{[\s\S]*padding:\s*4px;[\s\S]*overflow:\s*hidden;/s);
  assert.match(block, /\.player-avatar,[\s\S]*\.player-panel \.avatar,[\s\S]*\.player-card \.avatar\s*\{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;/s);
});
