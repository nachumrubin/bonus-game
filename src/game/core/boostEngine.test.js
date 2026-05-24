import { test } from 'node:test';
import assert from 'node:assert/strict';

import { register, get, has, listIds, runHook, applyRemote, _resetRegistry, TRIGGERS } from './boostEngine.js';

test('register + get round-trip', () => {
  _resetRegistry();
  const def = { id: 'test_boost', trigger: TRIGGERS.BEFORE_SCORE_COMMIT, apply: ctx => ctx };
  register(def);
  assert.equal(has('test_boost'), true);
  assert.equal(get('test_boost'), def);
  assert.deepEqual(listIds(), ['test_boost']);
});

test('register rejects duplicate ids', () => {
  _resetRegistry();
  register({ id: 'x', trigger: TRIGGERS.BEFORE_SCORE_COMMIT, apply: ctx => ctx });
  assert.throws(() => register({ id: 'x', trigger: TRIGGERS.BEFORE_SCORE_COMMIT, apply: ctx => ctx }));
});

test('register rejects malformed boosts', () => {
  _resetRegistry();
  assert.throws(() => register(null));
  assert.throws(() => register({}));
  assert.throws(() => register({ id: 42 }));
});

test('runHook applies matching boost only', () => {
  _resetRegistry();
  register({
    id: 'doubler',
    trigger: TRIGGERS.BEFORE_SCORE_COMMIT,
    apply: (ctx) => ({ ...ctx, score: ctx.score * 2 }),
  });
  const ctx = {
    score: 10,
    activeBoosts: [{ boostId: 'doubler', slot: 0 }],
  };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 20);
});

test('runHook skips boosts whose trigger does not match', () => {
  _resetRegistry();
  register({
    id: 'turn_start_boost',
    trigger: TRIGGERS.ON_TURN_START,
    apply: (ctx) => ({ ...ctx, score: 999 }),
  });
  const ctx = { score: 10, activeBoosts: [{ boostId: 'turn_start_boost', slot: 0 }] };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 10);
});

test('runHook skips boosts whose canActivate returns false', () => {
  _resetRegistry();
  register({
    id: 'gated',
    trigger: TRIGGERS.BEFORE_SCORE_COMMIT,
    canActivate: () => false,
    apply: (ctx) => ({ ...ctx, score: ctx.score + 100 }),
  });
  const ctx = { score: 10, activeBoosts: [{ boostId: 'gated', slot: 0 }] };
  const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
  assert.equal(out.score, 10);
});

test('runHook isolates errors thrown by one boost from others', () => {
  _resetRegistry();
  register({
    id: 'broken',
    trigger: TRIGGERS.BEFORE_SCORE_COMMIT,
    apply: () => { throw new Error('boom'); },
  });
  register({
    id: 'good',
    trigger: TRIGGERS.BEFORE_SCORE_COMMIT,
    apply: (ctx) => ({ ...ctx, score: ctx.score + 1 }),
  });
  const _origErr = console.error;
  console.error = () => {};
  try {
    const ctx = {
      score: 10,
      activeBoosts: [{ boostId: 'broken', slot: 0 }, { boostId: 'good', slot: 0 }],
    };
    const out = runHook(TRIGGERS.BEFORE_SCORE_COMMIT, ctx);
    assert.equal(out.score, 11);
  } finally {
    console.error = _origErr;
  }
});

test('applyRemote replays an opponent boost via its applyRemote hook', () => {
  _resetRegistry();
  register({
    id: 'mirror',
    trigger: TRIGGERS.BEFORE_SCORE_COMMIT,
    apply: ctx => ctx,
    applyRemote: (payload, ctx) => ({ ...ctx, score: ctx.score + payload.add }),
  });
  const out = applyRemote('mirror', { add: 25 }, { score: 5 });
  assert.equal(out.score, 30);
});
