// Tiny in-memory Firebase Realtime Database stand-in for unit tests.
//
// Implements just enough of the compat API surface that our services use:
//   db.ref(path) → { get, set, update, remove, on, off, transaction, child, push, onDisconnect }
//   db.ref().update(multiPath) for top-level multi-path writes.
//
// Not for production. Single-threaded, no real timing semantics.

function getPath(data, path) {
  if (path === '' || path === '/') return data;
  const parts = path.split('/').filter(Boolean);
  let cur = data;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(data, path, value) {
  if (path === '' || path === '/') {
    for (const k of Object.keys(data)) delete data[k];
    if (value && typeof value === 'object') Object.assign(data, value);
    return;
  }
  const parts = path.split('/').filter(Boolean);
  let cur = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete cur[last];
  else cur[last] = value;
}

export function makeMockDb() {
  const data = {};
  const watchers = new Map(); // path → Set<handler>

  function notify(path) {
    // Fire watchers at this path AND any ancestor path (Firebase semantics).
    for (const [wpath, handlers] of watchers.entries()) {
      if (wpath === path || path.startsWith(wpath + '/') || wpath === '' || path === wpath) {
        const v = getPath(data, wpath);
        const snap = makeSnap(v);
        for (const h of handlers) h(snap);
      }
    }
  }

  function makeSnap(v) {
    return {
      val: () => v == null ? null : (typeof v === 'object' ? deepClone(v) : v),
      exists: () => v !== undefined && v !== null,
      forEach: (fn) => {
        if (!v || typeof v !== 'object') return false;
        for (const [k, child] of Object.entries(v)) {
          fn({ key: k, val: () => deepClone(child) });
        }
        return false;
      },
    };
  }

  function makeRef(path) {
    return {
      _path: path,
      child: (sub) => makeRef(path ? `${path}/${sub}` : sub),
      push: () => {
        const k = `k_${Math.random().toString(36).slice(2, 10)}`;
        return makeRef(path ? `${path}/${k}` : k);
      },
      get: async () => makeSnap(getPath(data, path)),
      set: async (v) => { setPath(data, path, v == null ? null : deepClone(v)); notify(path); },
      update: async (patch) => {
        if (path === '' || path === '/') {
          // Multi-path top-level update
          for (const [p, v] of Object.entries(patch)) setPath(data, p, v == null ? null : deepClone(v));
          for (const p of Object.keys(patch)) notify(p);
        } else {
          const cur = getPath(data, path);
          const merged = { ...(cur && typeof cur === 'object' ? cur : {}), ...deepClone(patch) };
          // Strip nulls (Firebase semantics: null deletes)
          for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
          setPath(data, path, merged);
          notify(path);
        }
      },
      remove: async () => { setPath(data, path, null); notify(path); },
      on: (eventType, handler) => {
        if (eventType !== 'value') return;
        const set = watchers.get(path) ?? new Set();
        set.add(handler);
        watchers.set(path, set);
        // Fire immediately with current value (Firebase semantics)
        handler(makeSnap(getPath(data, path)));
      },
      off: (eventType, handler) => {
        const set = watchers.get(path);
        if (!set) return;
        if (handler) set.delete(handler);
        else set.clear();
      },
      transaction: async (fn) => {
        const cur = getPath(data, path);
        const next = fn(cur == null ? null : deepClone(cur));
        if (next === undefined) {
          return { committed: false, snapshot: makeSnap(cur) };
        }
        setPath(data, path, next);
        notify(path);
        return { committed: true, snapshot: makeSnap(next) };
      },
      onDisconnect: () => ({
        update: async () => {},
        remove: async () => {},
        set: async () => {},
      }),
    };
  }

  return {
    ref: (path = '') => makeRef(path),
    _data: data,
    _watchers: watchers,
  };
}

function deepClone(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = deepClone(val);
  return out;
}
