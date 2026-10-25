// playBillingClient — coin packs for real money through Google Play (Phase 6b). Works
// only inside the Android app (the TWA with the billing library): there Chrome exposes
// the Digital Goods API for 'https://play.google.com/billing'. In a plain browser
// getService() resolves null and the store says the packs are an app feature.
//
// A purchase: PaymentRequest → Play's sheet → purchase token → `credit` (the worker's
// /economy/credit-play, which checks the token with Google, adds the coins once and
// consumes the purchase). If the app dies between payment and credit, the purchase
// stays unconsumed and recoverPending() credits it on the next store visit; Play
// refunds a pack nobody consumes within 3 days.

export const PLAY_BILLING_METHOD = 'https://play.google.com/billing';

// details.price = { currency: 'ILS', value: '9.90' } → '‏9.90 ₪'
export function formatPlayPrice(price, locale = 'he-IL') {
  const value = Number(price?.value);
  if (!price?.currency || !Number.isFinite(value)) return '';
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency }).format(value); }
  catch { return `${price.value} ${price.currency}`; }
}

// win: the window (injectable for tests). PaymentRequestImpl defaults to win.PaymentRequest.
export function createPlayBilling({ win = globalThis, PaymentRequestImpl = win?.PaymentRequest } = {}) {
  let servicePromise = null;

  // → the DigitalGoodsService, or null outside the Android app. Asked once.
  function getService() {
    servicePromise ??= (async () => {
      if (typeof win?.getDigitalGoodsService !== 'function' || !PaymentRequestImpl) return null;
      try { return (await win.getDigitalGoodsService(PLAY_BILLING_METHOD)) ?? null; }
      catch { return null; }
    })();
    return servicePromise;
  }

  // → { coins_500: '9.90 ₪', … } for the ids Play knows; {} when unavailable.
  async function getPrices(ids) {
    const service = await getService();
    if (!service) return {};
    try {
      const details = await service.getDetails(ids);
      const out = {};
      for (const d of details ?? []) {
        const label = formatPlayPrice(d?.price);
        if (d?.itemId && label) out[d.itemId] = label;
      }
      return out;
    } catch (e) {
      console.warn('[playBilling] getDetails', e);
      return {};
    }
  }

  // Buy one pack and credit it. credit: async ({ productId, purchaseToken }) → worker result.
  // → the worker result, or { ok:false, reason: 'unavailable' | 'cancelled' | 'play-error' }.
  async function buy(productId, credit) {
    if (!(await getService())) return { ok: false, reason: 'unavailable' };
    let response;
    try {
      const request = new PaymentRequestImpl(
        [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku: productId } }],
        // Play shows its own price; the total is required by PaymentRequest only.
        { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } },
      );
      response = await request.show();
    } catch (e) {
      // AbortError = the player closed Play's sheet.
      return { ok: false, reason: e?.name === 'AbortError' ? 'cancelled' : 'play-error', detail: String(e?.message ?? e) };
    }
    const purchaseToken = response?.details?.purchaseToken;
    if (!purchaseToken) {
      try { await response?.complete?.('fail'); } catch {}
      return { ok: false, reason: 'play-error', detail: 'no purchase token' };
    }
    const result = await credit({ productId, purchaseToken });
    try { await response.complete(result?.ok ? 'success' : 'fail'); } catch {}
    return result;
  }

  // Credits purchases that were paid but never consumed (the app closed mid-way, or
  // the worker was unreachable). → the number of packs credited now.
  async function recoverPending(credit, knownIds) {
    const service = await getService();
    if (!service?.listPurchases) return 0;
    let purchases;
    try { purchases = await service.listPurchases(); }
    catch (e) { console.warn('[playBilling] listPurchases', e); return 0; }
    let credited = 0;
    for (const p of purchases ?? []) {
      if (!p?.purchaseToken || (knownIds && !knownIds.includes(p.itemId))) continue;
      const r = await credit({ productId: p.itemId, purchaseToken: p.purchaseToken });
      if (r?.ok && r.credited) credited++;
    }
    return credited;
  }

  return { getService, getPrices, buy, recoverPending };
}
