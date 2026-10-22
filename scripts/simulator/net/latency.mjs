// latency.mjs — make a localhost Firebase connection behave like a phone's.
//
// On the emulator every write lands in ~1 ms, so a player who taps "שבץ"
// 50 ms before the deadline is never actually late, and the commit-vs-
// watchdog race that real users hit on mobile networks never happens.
// This wraps a compat `db` so that:
//
//   uplink    set / update / remove / transaction / push are started only
//             after a sampled delay (the request "travelling" to the server)
//   downlink  'value' listener callbacks and once()/get() results are
//             delivered after a sampled delay
//
// Per-direction delivery is FIFO (a later event is never delivered before an
// earlier one), like a single TCP/WebSocket stream. `.info/*` paths
// (connection state, server time offset) are passed through untouched.
//
// The server's own clock still judges deadlines (rules use `now`), so a
// write delayed past the deadline really is late — exactly the race.

export const NETWORK_PROFILES = Object.freeze({
  wifi:  { base: [15, 60],   spikeP: 0.01, spike: [300, 900] },
  '4g':  { base: [50, 220],  spikeP: 0.03, spike: [600, 2000] },
  poor:  { base: [180, 700], spikeP: 0.08, spike: [1200, 3500] },
});

export function sampleDelay(profile, rng) {
  const p = NETWORK_PROFILES[profile] ?? NETWORK_PROFILES['4g'];
  const [lo, hi] = rng() < p.spikeP ? p.spike : p.base;
  return Math.round(lo + rng() * (hi - lo));
}

export function pickNetworkProfile(rng, mix = { wifi: 0.45, '4g': 0.4, poor: 0.15 }) {
  let x = rng();
  for (const [k, w] of Object.entries(mix)) { x -= w; if (x <= 0) return k; }
  return '4g';
}

/**
 * @param {object} db         compat database
 * @param {{ profile: string, rng: () => number, stats?: object }} opts
 */
export function withLatency(db, { profile, rng, stats = null }) {
  // FIFO channels: never deliver before the previous item in that direction.
  let upAt = 0;
  let downAt = 0;
  // Each item waits for the previous one in its direction before its own
  // timer resolves. Two timers due at the same instant are NOT guaranteed to
  // fire in scheduling order (Node keeps one list per duration), so a
  // timestamp-only FIFO let a later write overtake an earlier one — a
  // liveBonus clear landed before the progress write sent ahead of it (soak3
  // g24), and a newer room snapshot was delivered before an older one (g9).
  let upChain = Promise.resolve();
  let downChain = Promise.resolve();
  const inOrder = (chain, at) => chain.then(() => new Promise(r => setTimeout(r, Math.max(0, at - Date.now()))));
  const up = () => {
    const at = Math.max(Date.now() + sampleDelay(profile, rng), upAt);
    upAt = at;
    if (stats) { stats.upN = (stats.upN ?? 0) + 1; stats.upMs = (stats.upMs ?? 0) + (at - Date.now()); }
    upChain = inOrder(upChain, at);
    return upChain;
  };
  // Writes issued but not yet acknowledged (incl. the ack's trip back). The
  // oracle treats an agent with writes in flight as not yet quiescent.
  // Only TRANSACTIONS change compared game state (room commits); previews,
  // reactions and liveBonus writes don't, so they must not hold the oracle's
  // agreement check hostage on a slow network.
  const track = async (fn, counted = true, path = '', op = '') => {
    if (stats && counted) stats.inflight = (stats.inflight ?? 0) + 1;
    try {
      return await fn();
    } catch (err) {
      // Keep the cause of a refused write: the session only reports
      // 'stale-version', which can't tell a lost race from a rule denial.
      if (stats) {
        stats.writeErrors ??= [];
        if (stats.writeErrors.length < 50) {
          stats.writeErrors.push({ at: Date.now(), op, path, code: String(err?.code ?? err?.message ?? err) });
        }
      }
      throw err;
    } finally { if (stats && counted) stats.inflight -= 1; }
  };
  const down = () => {
    const at = Math.max(Date.now() + sampleDelay(profile, rng), downAt);
    downAt = at;
    downChain = inOrder(downChain, at);
    return downChain;
  };

  // original handler → wrapped, per path. Shared across ref objects because
  // callers often detach through a NEW db.ref(path) object.
  const handlerMap = new Map();
  const keyOf = (path, eventType) => `${path}|${eventType}`;

  function wrapRef(ref, path) {
    if (path.startsWith('.info')) return ref;
    const wrapped = {
      get key() { return ref.key; },
      get ref() { return wrapped; },
      child: (sub) => wrapRef(ref.child(sub), `${path}/${sub}`),
      push: (value) => {
        const child = ref.push();
        const w = wrapRef(child, `${path}/${child.key}`);
        if (value !== undefined) {
          const p = w.set(value);
          return Object.assign(w, { then: p.then.bind(p), catch: p.catch.bind(p) });
        }
        return w;
      },
      set: (v) => track(async () => { await up(); return ref.set(v); }, false, path, 'set'),
      update: (v) => track(async () => { await up(); return ref.update(v); }, false, path, 'update'),
      remove: () => track(async () => { await up(); return ref.remove(); }, false, path, 'remove'),
      transaction: (fn, onComplete, applyLocally) => track(async () => {
        await up();
        const res = await ref.transaction(fn, onComplete, applyLocally);
        await down(); // the ack travels back
        return res;
      }, true, path, 'transaction'),
      get: async () => {
        await up();
        const snap = await ref.get();
        await down();
        return snap;
      },
      once: async (eventType = 'value') => {
        await up();
        const snap = await ref.once(eventType);
        await down();
        return snap;
      },
      on: (eventType, handler, ...rest) => {
        const delayed = (snap, prev) => {
          down().then(() => { try { handler(snap, prev); } catch (e) { console.error('[latency] handler', e); } });
        };
        let m = handlerMap.get(keyOf(path, eventType));
        if (!m) { m = new Map(); handlerMap.set(keyOf(path, eventType), m); }
        m.set(handler, delayed);
        ref.on(eventType, delayed, ...rest);
        return handler;
      },
      off: (eventType, handler) => {
        if (!handler) { handlerMap.delete(keyOf(path, eventType)); return ref.off(eventType); }
        const m = handlerMap.get(keyOf(path, eventType));
        const delayed = m?.get(handler);
        m?.delete(handler);
        return ref.off(eventType, delayed ?? handler);
      },
      onDisconnect: () => ref.onDisconnect(),
      orderByChild: (...a) => ref.orderByChild(...a),
      orderByKey: (...a) => ref.orderByKey(...a),
      limitToLast: (...a) => ref.limitToLast(...a),
      equalTo: (...a) => ref.equalTo(...a),
      toString: () => ref.toString(),
    };
    return wrapped;
  }

  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'ref') return (path = '') => wrapRef(target.ref(path), String(path ?? ''));
      if (prop === '__latencyProfile') return profile;
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
