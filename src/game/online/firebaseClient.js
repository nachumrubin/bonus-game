// Firebase SDK boot + helpers.
//
// We stay on the v8-compat SDK (firebase-{app,database,auth}-compat.js v10.13)
// during the rewrite — the legacy inline script and the new spine share the
// same SDK load, which means there's nothing extra to migrate at cutover.
//
// loadFirebaseSDK() injects three <script> tags on first use and resolves
// when they've all loaded. Subsequent calls reuse the cached promise.
//
// initFirebaseApp() is idempotent: it picks up firebase.apps[0] if the
// legacy script already initialised the app.
//
// Tests inject a mock via setFirebaseImplForTests({ db, auth, serverTimestamp }).
// Production code reads from getDb() / getAuth() / serverTimestamp() and
// doesn't care which path is in use.

let _testImpl = null;
let _appConfig = null;
let _sdkPromise = null;
let _appPromise = null;

const SDK_VERSION = '10.13.0';
const SDK_URLS = [
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`,
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-database-compat.js`,
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js`,
];

export function setFirebaseImplForTests(impl) {
  _testImpl = impl;
}

export function configure({ firebaseConfig }) {
  _appConfig = firebaseConfig;
}

function loadOneScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); }, { once: true });
    s.addEventListener('error', () => reject(new Error(`failed to load ${src}`)), { once: true });
    document.head.appendChild(s);
  });
}

export function loadFirebaseSDK() {
  if (_testImpl) return Promise.resolve();
  if (_sdkPromise) return _sdkPromise;
  if (typeof globalThis.firebase !== 'undefined' && globalThis.firebase.database) {
    _sdkPromise = Promise.resolve();
    return _sdkPromise;
  }
  _sdkPromise = (async () => {
    for (const url of SDK_URLS) await loadOneScript(url);
  })();
  return _sdkPromise;
}

export function ensureApp() {
  if (_testImpl) return Promise.resolve(_testImpl);
  if (_appPromise) return _appPromise;
  _appPromise = (async () => {
    await loadFirebaseSDK();
    const fb = globalThis.firebase;
    if (!fb) throw new Error('firebase SDK did not load');
    const app = (fb.apps && fb.apps.length > 0) ? fb.apps[0] : fb.initializeApp(_appConfig);
    return {
      app,
      db: fb.database(),
      auth: fb.auth ? fb.auth() : null,
      serverTimestamp: () => fb.database.ServerValue.TIMESTAMP,
    };
  })();
  return _appPromise;
}

export async function getDb() {
  const impl = await ensureApp();
  return impl.db;
}

export async function getAuth() {
  const impl = await ensureApp();
  return impl.auth;
}

export async function serverTimestamp() {
  const impl = await ensureApp();
  return impl.serverTimestamp();
}

// Convenience: get a ref. The Firebase compat API is `db.ref(path)`.
export async function ref(path) {
  const db = await getDb();
  return db.ref(path);
}

// Reset for tests. Wipes module-level caches so a fresh setFirebaseImplForTests
// takes effect.
export function _resetForTests() {
  _testImpl = null;
  _appConfig = null;
  _sdkPromise = null;
  _appPromise = null;
}
