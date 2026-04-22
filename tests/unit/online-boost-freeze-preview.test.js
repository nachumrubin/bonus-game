const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const startToken = `function ${name}(`;
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Could not find ${name}`);
  let i = source.indexOf('{', start);
  if (i === -1) throw new Error(`Could not find body for ${name}`);
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

test('playWord pushes pending board to Firebase before opening move review', () => {
  assert.match(
    source,
    /createPendingMoveSnapshot\(\);\s*pushPendingBoardToFirebase\(\);\s*openMoveReview\(review\);/,
    'expected Firebase board preview push between snapshot and review modal'
  );
});

test('freezeOnlineTurnTimerForBoost clears online deadline for interactive boosts', () => {
  assert.match(source, /freezeOnlineTurnTimerForBoost\(type\);/);
  assert.match(source, /function freezeOnlineTurnTimerForBoost\(bonusType\)[\s\S]*setOnlineTurnDeadline\(0\);/);
});

test('pushPendingBoardToFirebase clears live ghost tiles after preview push', () => {
  assert.match(
    source,
    /function pushPendingBoardToFirebase\(\)[\s\S]*pushStateToFirebase\(serializeStateWithPendingBoard\(\)\);[\s\S]*\/live'\)\.set\(\[\]\)/,
    'expected pending-board push to also clear /live ghost tiles'
  );
});

test('serializeStateWithPendingBoard overlays pending placed tiles onto serialized board', () => {
  const ctx = vm.createContext({
    serializeGameState: () => ({
      bData: Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => null)),
      bBoardData: {}
    }),
    placed: [{ r: 0, c: 1, letter: 'א', val: 1, isJoker: false }],
    replacedThisTurn: null,
    isBonusPos: () => false
  });

  vm.runInContext(extractFunction('serializeStateWithPendingBoard'), ctx);
  const state = ctx.serializeStateWithPendingBoard();
  assert.equal(state.bData[0][1].letter, 'א');
  assert.equal(state.bData[0][1].val, 1);
  assert.equal(state.bData[0][1].isJoker, false);
});
