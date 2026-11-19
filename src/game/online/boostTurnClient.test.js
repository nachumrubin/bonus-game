import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoostTurnClient, readBoostV2Room, readMyRack, newRequestId } from './boostTurnClient.js';

function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === 'throw') throw new Error('offline');
    return new Response(JSON.stringify(step.body), { status: step.status ?? 200 });
  };
  return { impl, calls };
}
const mk = (f, extra = {}) => createBoostTurnClient({
  baseUrl: 'https://w.example/', getIdToken: async () => 'tok', fetchImpl: f.impl, sleep: async () => {}, ...extra,
});

test('submit: posts the command with the token, request id and expected version', async () => {
  const f = fakeFetch([{ body: { ok: true, version: 3 } }]);
  const r = await mk(f).submit('room-1', { type: 'cmd/PASS_TURN' }, { expectedVersion: 2, reqId: 'fixed-request-1' });
  assert.deepEqual(r, { ok: true, version: 3 });
  assert.equal(f.calls[0].url, 'https://w.example/boost/turn');
  assert.equal(f.calls[0].auth, 'Bearer tok');
  assert.deepEqual(f.calls[0].body, { reqId: 'fixed-request-1', roomId: 'room-1', command: { type: 'cmd/PASS_TURN', expectedVersion: 2 } });
});

test('retries network errors, 5xx and busy with the SAME request id', async () => {
  const f = fakeFetch(['throw', { status: 503, body: { ok: false, reason: 'busy' } }, { status: 500, body: {} }, { body: { ok: true } }]);
  const r = await mk(f).submit('room-1', { type: 'cmd/PASS_TURN' });
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 4);
  assert.equal(new Set(f.calls.map(c => c.body.reqId)).size, 1, 'one id across retries → idempotent');
});

test('game-rule rejections are returned immediately, not retried', async () => {
  const f = fakeFetch([{ body: { ok: false, reason: 'not-your-turn' } }]);
  const r = await mk(f).submit('room-1', { type: 'cmd/PASS_TURN' });
  assert.equal(r.reason, 'not-your-turn');
  assert.equal(f.calls.length, 1);
});

test('gives up after maxAttempts with the last failure', async () => {
  const f = fakeFetch(['throw']);
  const r = await mk(f, { maxAttempts: 3 }).submit('room-1', { type: 'cmd/PASS_TURN' });
  assert.deepEqual(r, { ok: false, reason: 'network' });
  assert.equal(f.calls.length, 3);
});

test('createMatch / claimTimeout / plan hit their endpoints', async () => {
  const f = fakeFetch([{ body: { ok: true } }]);
  const c = mk(f);
  await c.createMatch({ roomId: 'room-1', mode: 'friend-async', players: { 0: { uid: 'a' }, 1: { uid: 'b' } } });
  await c.claimTimeout('room-1', { expectedVersion: 5 });
  await c.plan('room-1', { placed: [] });
  assert.deepEqual(f.calls.map(x => x.url.split('/boost/')[1]), ['create', 'turn', 'plan']);
  assert.deepEqual(f.calls[1].body.command, { type: 'cmd/CLAIM_TIMEOUT', expectedVersion: 5 });
  assert.equal(f.calls[2].body.reqId, undefined, 'plan is read-only — no request id');
});

test('readBoostV2Room normalises Firebase-dropped arrays; ignores legacy rooms', () => {
  assert.equal(readBoostV2Room({ schemaVersion: 2 }), null);
  const v = readBoostV2Room({ ruleset: 'BOOST_V2', boostV2: { phase: 'NORMAL', activeBoosts: { 0: { instanceId: 'c001' } } } });
  assert.deepEqual(v.moveHistory, []);
  assert.deepEqual(v.boostV2.upcoming, []);
  assert.equal(v.boostV2.activeBoosts[0].instanceId, 'c001');
  assert.deepEqual(readMyRack({ tiles: { 0: 'א', 1: 'ב' } }), ['א', 'ב']);
  assert.deepEqual(readMyRack(null), []);
});

test('request ids satisfy the worker format', () => {
  assert.match(newRequestId(), /^[A-Za-z0-9_-]{8,64}$/);
});
