import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEconomyClient, ECONOMY_ACTIONS } from './economyClient.js';

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { status: next.status ?? 200, json: async () => next.body };
  };
  return { calls, fetchImpl };
}

const base = { baseUrl: 'https://w.example/', getIdToken: async () => 'tok', newId: () => 'req-fixed-01' };

test('economyClient: posts the action with the token and a request id', async () => {
  const { calls, fetchImpl } = fakeFetch([{ body: { ok: true, coins: 350 } }]);
  const eco = createEconomyClient({ ...base, fetchImpl });
  assert.deepEqual(await eco.buy('reaction:wink'), { ok: true, coins: 350 });
  assert.equal(calls[0].url, 'https://w.example/economy/buy');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(calls[0].body, { item: 'reaction:wink', reqId: 'req-fixed-01' });
});

test('economyClient: a network error is retried once with the same request id', async () => {
  const { calls, fetchImpl } = fakeFetch([new Error('offline'), { body: { ok: true, coinsAwarded: 20 } }]);
  const eco = createEconomyClient({ ...base, fetchImpl });
  assert.equal((await eco.claimDaily()).coinsAwarded, 20);
  assert.deepEqual(calls.map((c) => c.body.reqId), ['req-fixed-01', 'req-fixed-01']);
});

test('economyClient: offline, signed out, not configured and non-JSON answers', async () => {
  const down = fakeFetch([new Error('x'), new Error('x')]);
  assert.equal((await createEconomyClient({ ...base, fetchImpl: down.fetchImpl }).claimChain()).reason, 'offline');
  assert.equal((await createEconomyClient({ ...base, getIdToken: async () => null }).claimDaily()).reason, 'signed-out');
  assert.equal((await createEconomyClient({ ...base, baseUrl: '' }).claimDaily()).reason, 'not-configured');
  const bad = fakeFetch([{ status: 502, body: null }]);
  assert.equal((await createEconomyClient({ ...base, fetchImpl: bad.fetchImpl }).claimAchievement('first_steps')).reason, 'http-502');
});

test('economyClient: every action maps to a worker path', async () => {
  const { calls, fetchImpl } = fakeFetch(Array.from({ length: 5 }, () => ({ body: { ok: true } })));
  const eco = createEconomyClient({ ...base, fetchImpl });
  await eco.claimDaily(); await eco.claimAchievement('a'); await eco.buy('b'); await eco.claimChain();
  await eco.creditPlay({ productId: 'coins_500', purchaseToken: 't' });
  assert.deepEqual(calls.map((c) => c.url.split('/economy/')[1]), Object.values(ECONOMY_ACTIONS));
});
