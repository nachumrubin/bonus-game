const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const startToken = `async function ${name}(`;
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

test('online room setup flows do not depend on anonymous auth', () => {
  const createRoom = extractFunction('crConfirm');
  const joinByCode = extractFunction('jcConfirm');
  const matchmaking = extractFunction('mmStartSearch');

  assert.doesNotMatch(createRoom, /signInAnonymously\(/, 'crConfirm should not block room creation on anonymous auth');
  assert.doesNotMatch(joinByCode, /signInAnonymously\(/, 'jcConfirm should not block room join on anonymous auth');
  assert.doesNotMatch(matchmaking, /signInAnonymously\(/, 'mmStartSearch should not block matchmaking on anonymous auth');
});

test('legacy auth-before-room warning is removed', () => {
  assert.doesNotMatch(source, /Auth before crConfirm failed:/, 'stale anonymous-auth warning should not remain');
});
