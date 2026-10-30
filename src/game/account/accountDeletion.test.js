import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAccountDeletion } from './accountDeletion.js';

test('deleteAccount: posts to the worker with the ID token and returns its answer', async () => {
  const calls = [];
  const del = createAccountDeletion({
    baseUrl: 'https://w.example/',
    getIdToken: async () => 'tok',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('{"ok":true}'); },
  });
  assert.deepEqual(await del.deleteAccount(), { ok: true });
  assert.equal(calls[0].url, 'https://w.example/account/delete');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('deleteAccount: not configured / signed out / offline after one retry', async () => {
  assert.equal((await createAccountDeletion({ getIdToken: async () => 't' }).deleteAccount()).reason, 'not-configured');
  assert.equal((await createAccountDeletion({ baseUrl: 'https://w', getIdToken: async () => null }).deleteAccount()).reason, 'signed-out');
  let n = 0;
  const off = createAccountDeletion({ baseUrl: 'https://w', getIdToken: async () => 't', fetchImpl: async () => { n++; throw new Error('net'); } });
  assert.equal((await off.deleteAccount()).reason, 'offline');
  assert.equal(n, 2);
  const bad = createAccountDeletion({ baseUrl: 'https://w', getIdToken: async () => 't', fetchImpl: async () => new Response('nope', { status: 502 }) });
  assert.equal((await bad.deleteAccount()).reason, 'http-502');
});
