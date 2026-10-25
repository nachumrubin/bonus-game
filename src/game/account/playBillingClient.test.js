import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPlayBilling, formatPlayPrice, PLAY_BILLING_METHOD } from './playBillingClient.js';

function fakeWin({ service = {}, showResult, showError, noService = false } = {}) {
  const requests = [];
  const completes = [];
  class FakePaymentRequest {
    constructor(methods, details) { this.methods = methods; this.details = details; requests.push(this); }
    async show() {
      if (showError) throw showError;
      return { details: showResult, complete: async (s) => { completes.push(s); } };
    }
  }
  const asked = [];
  const win = {
    PaymentRequest: FakePaymentRequest,
    getDigitalGoodsService: async (m) => { asked.push(m); if (noService) throw new Error('not in TWA'); return service; },
  };
  return { win, requests, completes, asked };
}

const abort = Object.assign(new Error('closed'), { name: 'AbortError' });

test('formatPlayPrice: formats the Play price, empty when unknown', () => {
  assert.match(formatPlayPrice({ currency: 'ILS', value: '9.90' }), /9\.90/);
  assert.match(formatPlayPrice({ currency: 'ILS', value: '9.90' }), /₪/);
  assert.equal(formatPlayPrice(null), '');
  assert.equal(formatPlayPrice({ currency: 'ILS', value: 'x' }), '');
});

test('playBilling: no Digital Goods API → unavailable, no prices', async () => {
  const pb = createPlayBilling({ win: {} });
  assert.equal(await pb.getService(), null);
  assert.deepEqual(await pb.getPrices(['coins_500']), {});
  assert.deepEqual(await pb.buy('coins_500', async () => ({ ok: true })), { ok: false, reason: 'unavailable' });
  assert.equal(await pb.recoverPending(async () => ({ ok: true })), 0);
});

test('playBilling: getDigitalGoodsService rejecting (browser, not the app) → unavailable, asked once', async () => {
  const { win, asked } = fakeWin({ noService: true });
  const pb = createPlayBilling({ win });
  assert.equal(await pb.getService(), null);
  assert.equal(await pb.getService(), null);
  assert.deepEqual(asked, [PLAY_BILLING_METHOD]);
});

test('playBilling: getPrices maps item ids to formatted prices', async () => {
  const { win } = fakeWin({ service: { getDetails: async (ids) => ids.map((itemId) => ({ itemId, price: { currency: 'ILS', value: '4.90' } })) } });
  const prices = await createPlayBilling({ win }).getPrices(['coins_500', 'coins_1200']);
  assert.deepEqual(Object.keys(prices), ['coins_500', 'coins_1200']);
  assert.match(prices.coins_500, /4\.90/);
});

test('playBilling: buy sends the sku to Play, credits the token, completes success', async () => {
  const { win, requests, completes } = fakeWin({ showResult: { purchaseToken: 'ptok' } });
  const credits = [];
  const r = await createPlayBilling({ win }).buy('coins_1200', async (args) => { credits.push(args); return { ok: true, credited: 1200, coins: 1300 }; });
  assert.deepEqual(r, { ok: true, credited: 1200, coins: 1300 });
  assert.deepEqual(requests[0].methods, [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku: 'coins_1200' } }]);
  assert.deepEqual(credits, [{ productId: 'coins_1200', purchaseToken: 'ptok' }]);
  assert.deepEqual(completes, ['success']);
});

test('playBilling: a worker failure completes the sheet with fail and passes the reason on', async () => {
  const { win, completes } = fakeWin({ showResult: { purchaseToken: 'ptok' } });
  const r = await createPlayBilling({ win }).buy('coins_500', async () => ({ ok: false, reason: 'pending' }));
  assert.equal(r.reason, 'pending');
  assert.deepEqual(completes, ['fail']);
});

test('playBilling: closing the Play sheet is "cancelled" and credits nothing', async () => {
  const { win } = fakeWin({ showError: abort });
  let credited = false;
  const r = await createPlayBilling({ win }).buy('coins_500', async () => { credited = true; return { ok: true }; });
  assert.equal(r.reason, 'cancelled');
  assert.equal(credited, false);
});

test('playBilling: recoverPending credits unconsumed packs it knows, counts new credits only', async () => {
  const service = { listPurchases: async () => [
    { itemId: 'coins_500', purchaseToken: 'a' },
    { itemId: 'coins_3000', purchaseToken: 'b' },
    { itemId: 'other_sku', purchaseToken: 'c' },
  ] };
  const { win } = fakeWin({ service });
  const seen = [];
  const n = await createPlayBilling({ win }).recoverPending(async ({ purchaseToken }) => {
    seen.push(purchaseToken);
    return purchaseToken === 'a' ? { ok: true, credited: 500 } : { ok: true, already: true };
  }, ['coins_500', 'coins_1200', 'coins_3000']);
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(n, 1);
});
