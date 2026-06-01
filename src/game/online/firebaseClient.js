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
let _emulatorOpts = null;   // { dbHost, dbPort, authUrl } or null
let _sdkPromise = null;
let _appPromise = null;

// Detect emulator mode from APP_CONFIG.useEmulator, a `?emu=1` URL flag, or
// localhost on a non-prod port. Lets you point the running app at a local
// Firebase emulator without touching the real project.
function detectEmulatorOpts(cfg) {
  if (cfg?.useEmulator) {
    return {
      dbHost: cfg.emulatorDbHost ?? 'localhost',
      dbPort: Number(cfg.emulatorDbPort ?? 9000),
      authUrl: cfg.emulatorAuthUrl ?? 'http://localhost:9099',
    };
  }
  try {
    const loc = globalThis.location;
    if (!loc) return null;
    const url = new URL(loc.href);
    if (url.searchParams.get('emu') === '1') {
      return { dbHost: 'localhost', dbPort: 9000, authUrl: 'http://localhost:9099' };
    }
  } catch {}
  return null;
}

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
  _emulatorOpts = detectEmulatorOpts(globalThis.APP_CONFIG ?? null);
}

// True iff the next ensureApp() will wire to a local emulator.
export function isUsingEmulator() { return _emulatorOpts != null; }

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
    const db = fb.database();
    const auth = fb.auth ? fb.auth() : null;
    if (_emulatorOpts) {
      try { db.useEmulator(_emulatorOpts.dbHost, _emulatorOpts.dbPort); } catch (e) {
        console.warn('[firebaseClient] db.useEmulator failed', e);
      }
      if (auth) {
        try { auth.useEmulator(_emulatorOpts.authUrl, { disableWarnings: true }); } catch (e) {
          console.warn('[firebaseClient] auth.useEmulator failed', e);
        }
      }
      console.info(`[firebaseClient] using emulator db=${_emulatorOpts.dbHost}:${_emulatorOpts.dbPort} auth=${_emulatorOpts.authUrl}`);
    }
    return {
      app,
      db,
      auth,
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
  _emulatorOpts = null;
  _sdkPromise = null;
  _appPromise = null;
}
