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

function buildContextWith(functionNames, extra = {}) {
  const ctx = vm.createContext({ ...extra });
  for (const fn of functionNames) {
    vm.runInContext(extractFunction(fn), ctx);
  }
  return ctx;
}

test('getSyncedNowMs applies Firebase server offset', () => {
  const ctx = buildContextWith(['getSyncedNowMs'], {
    Date: { now: () => 10_000 },
    fbServerTimeOffsetMs: 1_750
  });

  assert.equal(ctx.getSyncedNowMs(), 11_750);
});

test('computeTurnSecondsLeft uses ceiling and never returns negative values', () => {
  const ctx = buildContextWith(['computeTurnSecondsLeft'], {
    getSyncedNowMs: () => 5_000
  });

  assert.equal(ctx.computeTurnSecondsLeft(6_001), 2, '1001ms left should display 2 seconds');
  assert.equal(ctx.computeTurnSecondsLeft(4_999), 0, 'expired deadline should clamp to zero');
  assert.equal(ctx.computeTurnSecondsLeft(0), 0, 'missing deadline should be zero');
});

test('online turn handoff pushes state immediately without 200ms delay', () => {
  assert.doesNotMatch(
    source,
    /setTimeout\(pushMoveToFirebase,\s*200\)/,
    'pushMoveToFirebase should be immediate to avoid last-second desyncs'
  );
  assert.match(
    source,
    /if\(gMode==='online'\) pushMoveToFirebase\(\);/,
    'expected immediate Firebase push in online turn transitions'
  );
});

test('initFirebase subscribes to .info/serverTimeOffset', () => {
  assert.match(
    source,
    /\.info\/serverTimeOffset/,
    'expected Firebase server time offset listener for synced timers'
  );
});

test('online state sync uses revision independent of moveCount and turn', () => {
  assert.match(
    source,
    /stateSeq:\s*Number\(onlineStateSeq \|\| 0\)/,
    'serialized online state should include stateSeq'
  );
  assert.match(
    source,
    /incomingStateSeq[\s\S]*_lastSeenStateSeq[\s\S]*incomingStateSeq <= _lastSeenStateSeq/,
    'listenForMoves should reject stale snapshots by stateSeq'
  );
});

test('online timer pause uses revisioned state instead of direct child writes', () => {
  assert.doesNotMatch(
    source,
    /state\/turnDeadlineMs/,
    'deadline changes should not bypass stateSeq freshness checks'
  );
  assert.match(
    source,
    /syncOnlineDeadlineState\(0,\s*'boost-open'\)/,
    'boost overlay should pause the deadline through revisioned state'
  );
});

test('online tile swap is stored as a pending effect for active player resolution', () => {
  assert.match(
    source,
    /onlinePendingEffect\s*=\s*\{\s*type:'tileSwap',\s*player:turn/,
    'tile swap should be serialized as a pending online effect'
  );
  assert.match(
    source,
    /function handleOnlinePendingEffect\(\)[\s\S]*player !== window\._myPlayerIndex/,
    'only the active local player should resolve the pending tile swap'
  );
});

test('live preview includes replacement moves', () => {
  assert.match(
    source,
    /replacedThisTurn:\s*replacedThisTurn \?/,
    'live payload should include replacedThisTurn'
  );
  assert.match(
    source,
    /window\._opponentLiveReplacement/,
    'renderer should track opponent replacement preview separately'
  );
});
