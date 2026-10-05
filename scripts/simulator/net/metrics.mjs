// metrics.mjs — measure what one player's Firebase connection experiences.
//
// Wraps a compat `db` (like latency.mjs) and reports a sample per operation
// to `sink(sample)`:
//   { kind: 'tx',  ms, ok, code? }   room transaction: issue → server answer
//   { kind: 'write', ms, ok, code? } set / update / remove (previews, liveBonus,
//                                    reactions, presence, status, …)
// `code` is the Firebase error code on failure (permission_denied,
// disconnected, overloaded-…). Used by the staging load test; never changes
// behaviour, only observes.

export function withMetrics(db, sink) {
  // Path shape for error triage: ids collapsed (rooms/<id>/livePreview).
  const shape = (path) => String(path ?? '').split('/').filter(Boolean)
    .map((seg, i) => (i > 0 && /[A-Za-z0-9_-]{12,}|^\d+$|^(fc|fi|mm|inv)_/.test(seg) ? '<id>' : seg)).slice(0, 3).join('/');
  const codeOf = (err) => {
    const raw = String(err?.code ?? err?.message ?? 'error').toLowerCase();
    if (raw.includes('permission')) return 'permission_denied';
    if (raw.includes('disconnect')) return 'disconnected';
    if (raw.includes('overload') || raw.includes('max')) return 'overloaded';
    return raw.slice(0, 40);
  };
  const timeIt = async (kind, fn, path) => {
    const t0 = Date.now();
    try {
      const res = await fn();
      const ok = kind === 'tx' ? !!res?.committed : true;
      sink({ kind, ms: Date.now() - t0, ok, ...(ok ? {} : { code: 'aborted' }) });
      return res;
    } catch (err) {
      sink({ kind, ms: Date.now() - t0, ok: false, code: `${codeOf(err)} ${shape(path)}` });
      throw err;
    }
  };
  function wrapRef(ref, path) {
    return new Proxy(ref, {
      get(target, prop) {
        if (prop === 'transaction') return (fn, ...rest) => timeIt('tx', () => target.transaction(fn, ...rest), path);
        if (prop === 'set' || prop === 'update' || prop === 'remove') {
          return (...args) => timeIt('write', () => target[prop](...args), path);
        }
        if (prop === 'child') return (p) => wrapRef(target.child(p), `${path}/${p}`);
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'ref') return (path = '') => {
        const r = target.ref(path);
        return String(path).startsWith('.info') ? r : wrapRef(r, String(path));
      };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
