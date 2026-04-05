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
      if (depth === 0) {
        return source.slice(start, j + 1);
      }
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

function buildContextWith(functionNames, extra = {}) {
  const ctx = vm.createContext({ ...extra });
  for (const fn of functionNames) {
    vm.runInContext(extractFunction(fn), ctx);
  }
  return ctx;
}

test('isConnected requires attaching to committed tiles (not only newly placed tiles)', () => {
  const ctx = buildContextWith(
    ['isBonusPos', 'getCommittedTile', 'getMoveTiles', 'isConnected'],
    {
      BS: 10,
      BDEFS: [],
      bBoardData: {},
      bData: Array.from({ length: 10 }, () => Array(10).fill(null)),
      placed: [],
      replacedThisTurn: null,
      firstMove: false
    }
  );

  // New tiles adjacent only to each other, disconnected from board.
  ctx.placed = [
    { r: 5, c: 5, letter: 'א', val: 1 },
    { r: 5, c: 6, letter: 'ב', val: 1 }
  ];
  assert.equal(ctx.isConnected(), false);

  // Connect one new tile to an existing committed tile.
  ctx.bData[5][4] = { r: 5, c: 4, letter: 'ג', val: 1 };
  assert.equal(ctx.isConnected(), true);
});

test('isConnected still allows first move', () => {
  const ctx = buildContextWith(
    ['isBonusPos', 'getCommittedTile', 'getMoveTiles', 'isConnected'],
    {
      BS: 10,
      BDEFS: [],
      bBoardData: {},
      bData: Array.from({ length: 10 }, () => Array(10).fill(null)),
      placed: [{ r: 8, c: 8, letter: 'א', val: 1 }],
      replacedThisTurn: null,
      firstMove: true
    }
  );
  assert.equal(ctx.isConnected(), true);
});

test('triggerBonus B2 grants +20 and auto resolution', () => {
  const ui = new Map();
  const getEl = (id) => {
    if (!ui.has(id)) ui.set(id, { id, textContent: '', innerHTML: '' });
    return ui.get(id);
  };

  const ctx = buildContextWith(['triggerBonus'], {
    bonusPend: { extra: 0, ct: '', player: 0 },
    resetBonusOverlay: () => {},
    runBonusBuilder: () => {},
    buildCrossword: () => {},
    buildCrossingWords: () => {},
    getMediumBonusWord: () => 'שלום',
    getFillableBonusWord: () => 'חברים',
    getLongBonusWord: () => 'בדיקה',
    norm: (s) => s,
    buildUnscramble: () => {},
    buildFillMiddle: () => {},
    commitPlay: () => {},
    ovOpen: (id) => { ctx._lastOpen = id; },
    document: { getElementById: getEl }
  });

  ctx.triggerBonus('B2', 'אבא', 12);
  assert.equal(ctx.bonusPend.extra, 20);
  assert.equal(ctx.bonusPend.ct, 'auto');
  assert.equal(ctx._lastOpen, 'ov-bonus');
  assert.match(getEl('bovt').textContent, /20/);
});

test('crossword bonus finalize commits base score + bonus once', () => {
  assert.match(
    source,
    /commitPlay\(bonusPend\.sc,bonusPend\.ws,extra,bonusPend\.player\)/,
    'expected crossword finalize to pass base score and bonus separately'
  );
  assert.doesNotMatch(
    source,
    /commitPlay\(bonusPend\.sc\+extra,bonusPend\.ws,extra,bonusPend\.player\)/,
    'should not add bonus into base score before commit'
  );
});


test('runBotSearchSafely returns null result instead of throwing when search crashes', () => {
  const errors = [];
  const ctx = buildContextWith(['runBotSearchSafely'], {
    doBotSearch: () => { throw new Error('boom'); },
    console: { error: (...args) => errors.push(args.join(' ')) }
  });

  const out = ctx.runBotSearchSafely();
  assert.equal(out.ok, false);
  assert.equal(out.result, null);
  assert.match(String(out.error), /boom/);
  assert.equal(errors.length, 1);
});
