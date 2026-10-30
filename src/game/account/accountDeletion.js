// accountDeletion — the app's side of the worker's POST /account/delete
// (worker/src/accountDelete.js). The worker removes the player's data and their
// Firebase Auth user; the app then signs out locally. The worker's steps are
// idempotent, so a retry after a network error is safe.

export function createAccountDeletion({ baseUrl, getIdToken, fetchImpl = (...a) => globalThis.fetch(...a), retries = 1 } = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');

  // → { ok: true } | { ok: false, reason: 'not-configured' | 'signed-out' | 'offline' | 'server-error' | … }
  async function deleteAccount() {
    if (!base) return { ok: false, reason: 'not-configured' };
    const token = await getIdToken?.();
    if (!token) return { ok: false, reason: 'signed-out' };
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(`${base}/account/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: '{}',
        });
        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') return data;
        return { ok: false, reason: `http-${res.status}` };
      } catch (e) {
        if (attempt >= retries) return { ok: false, reason: 'offline', detail: String(e?.message ?? e) };
      }
    }
  }

  return { deleteAccount };
}
