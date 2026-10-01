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
  const up = () => {
    const at = Math.max(Date.now() + sampleDelay(profile, rng), upAt);
    upAt = at;
    if (stats) { stats.upN = (stats.upN ?? 0) + 1; stats.upMs = (stats.upMs ?? 0) + (at - Date.now()); }
    return new Promise(r => setTimeout(r, at - Date.now()));
  };
  // Writes issued but not yet acknowledged (incl. the ack's trip back). The
  // oracle treats an agent with writes in flight as not yet quiescent.
  // Only TRANSACTIONS change compared game state (room commits); previews,
  // reactions and liveBonus writes don't, so they must not hold the oracle's
  // agreement check hostage on a slow network.
  const track = async (fn, counted = true) => {
    if (stats && counted) stats.inflight = (stats.inflight ?? 0) + 1;
    try { return await fn(); } finally { if (stats && counted) stats.inflight -= 1; }
  };
  const downDelayMs = () => {
    const at = Math.max(Date.now() + sampleDelay(profile, rng), downAt);
    downAt = at;
    return at - Date.now();
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
      set: (v) => track(async () => { await up(); return ref.set(v); }, false),
      update: (v) => track(async () => { await up(); return ref.update(v); }, false),
      remove: () => track(async () => { await up(); return ref.remove(); }, false),
      transaction: (fn, onComplete, applyLocally) => track(async () => {
        await up();
        const res = await ref.transaction(fn, onComplete, applyLocally);
        await new Promise(r => setTimeout(r, downDelayMs())); // the ack travels back
        return res;
      }),
      get: async () => {
        await up();
        const snap = await ref.get();
        await new Promise(r => setTimeout(r, downDelayMs()));
        return snap;
      },
      once: async (eventType = 'value') => {
        await up();
        const snap = await ref.once(eventType);
        await new Promise(r => setTimeout(r, downDelayMs()));
        return snap;
      },
      on: (eventType, handler, ...rest) => {
        const delayed = (snap, prev) => {
          setTimeout(() => { try { handler(snap, prev); } catch (e) { console.error('[latency] handler', e); } }, downDelayMs());
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
