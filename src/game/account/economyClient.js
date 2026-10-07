// economyClient — the app's side of the coin worker (worker/src/economy.js, Phase 6a).
// Coins and owned items are changed only by the worker; this posts the player's intent
// with their Firebase ID token and returns the worker's answer. The profile watcher
// then sees the new values like any other profile change.
//
// Every call carries a request id. A retry (here, after a network error) reuses it, so
// the worker answers the same request once: a coin is never paid or spent twice.

export const ECONOMY_ACTIONS = Object.freeze({
  DAILY: 'claim-daily',
  ACHIEVEMENT: 'achievement',
  BUY: 'buy',
  CHAIN: 'claim-chain',
  CREDIT_PLAY: 'credit-play',
});

function randomId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// baseUrl: the worker (APP_CONFIG.pushWorkerUrl). getIdToken: async () => token | null.
export function createEconomyClient({ baseUrl, getIdToken, fetchImpl = (...a) => globalThis.fetch(...a), newId = randomId, retries = 1 } = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');

  async function call(action, body = {}) {
    if (!base) return { ok: false, reason: 'not-configured' };
    const token = await getIdToken?.();
    if (!token) return { ok: false, reason: 'signed-out' };
    const reqId = newId();
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(`${base}/economy/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...body, reqId }),
        });
        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') return data;
        return { ok: false, reason: `http-${res.status}` };
      } catch (e) {
        if (attempt >= retries) return { ok: false, reason: 'offline', detail: String(e?.message ?? e) };
      }
    }
  }

  return {
    // { ok, coinsAwarded, newStreak, alreadyClaimedToday, coins }
    claimDaily: () => call(ECONOMY_ACTIONS.DAILY),
    // { ok, reward, coins } | { ok:false, reason: 'already-paid' | 'not-complete' | … }
    claimAchievement: (achievementId) => call(ECONOMY_ACTIONS.ACHIEVEMENT, { achievementId }),
    // { ok, coins } | { ok:false, reason: 'insufficient' | 'already-owned' | 'unknown-item' }
    buy: (item) => call(ECONOMY_ACTIONS.BUY, { item }),
    // { ok, unlocked } | { ok:false, reason: 'no-top-level' | 'nothing-to-unlock' }
    claimChain: () => call(ECONOMY_ACTIONS.CHAIN),
    // A Play Billing purchase (Phase 6b): { ok, credited, coins } once verified.
    creditPlay: ({ productId, purchaseToken }) => call(ECONOMY_ACTIONS.CREDIT_PLAY, { productId, purchaseToken }),
    _call: call,   // test hook
  };
}
