// Firebase Realtime Database REST client for the cron sweep.
//
// Auth: signs a JWT with a Google service account private key, exchanges
// it at oauth2.googleapis.com/token for an OAuth2 access token, and uses
// the token as a Bearer credential against `https://<dbName>.firebaseio.com`.
//
// The access token is cached per-isolate; it has a 1h TTL.
//
// Required env:
//   FIREBASE_PROJECT_ID            (vars, public)
//   FIREBASE_DATABASE_NAME         (vars, public — usually same as project id)
//   FIREBASE_SERVICE_ACCOUNT_JSON  (secret — full service account JSON)

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RTDB_SCOPES = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database';
const TOKEN_TTL_BUFFER_MS = 60_000;

let _cachedToken = null;
let _cachedTokenExpiresAt = 0;

function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlEncodeString(s) {
  return btoa(s).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToBinary(pem) {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// Exported for other Google APIs (playBilling.js signs with its own scope).
export async function signJwt(serviceAccount, scope = RTDB_SCOPES) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: serviceAccount.private_key_id };
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const headerB64 = b64urlEncodeString(JSON.stringify(header));
  const payloadB64 = b64urlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyBuf = pemToBinary(serviceAccount.private_key);
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBuf,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

export async function getAccessToken(env) {
  if (_cachedToken && Date.now() < _cachedTokenExpiresAt - TOKEN_TTL_BUFFER_MS) {
    return _cachedToken;
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON secret not set');
  }
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); }
  catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  if (!sa.private_key || !sa.client_email) {
    throw new Error('Service account JSON missing private_key or client_email');
  }

  const jwt = await signJwt(sa);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`OAuth token exchange failed: ${r.status} ${body}`);
  }
  const data = await r.json();
  _cachedToken = data.access_token;
  _cachedTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return _cachedToken;
}

function dbBase(env) {
  const name = env.FIREBASE_DATABASE_NAME || env.FIREBASE_PROJECT_ID;
  if (!name) throw new Error('FIREBASE_DATABASE_NAME / FIREBASE_PROJECT_ID not set');
  return `https://${name}-default-rtdb.firebaseio.com`;
}

export async function rtdbGet(env, path, { shallow = false } = {}) {
  const token = await getAccessToken(env);
  const url = new URL(`${dbBase(env)}/${path}.json`);
  if (shallow) url.searchParams.set('shallow', 'true');
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`RTDB GET ${path} failed: ${r.status}`);
  return r.json();
}

export async function rtdbPatch(env, path, data) {
  const token = await getAccessToken(env);
  const r = await fetch(`${dbBase(env)}/${path}.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`RTDB PATCH ${path} failed: ${r.status}`);
  return r.json();
}

// Compare-and-set (the coin worker, economy.js): read a node with its ETag, then write
// it back only if nobody changed it in between (HTTP 412 otherwise).
export async function rtdbGetWithEtag(env, path) {
  const token = await getAccessToken(env);
  const r = await fetch(`${dbBase(env)}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' },
  });
  if (!r.ok) throw new Error(`RTDB GET ${path} failed: ${r.status}`);
  return { value: await r.json(), etag: r.headers.get('ETag') };
}

// → { ok: true } or { ok: false, conflict: true } when the ETag no longer matches.
export async function rtdbPutIfMatch(env, path, data, etag) {
  const token = await getAccessToken(env);
  const r = await fetch(`${dbBase(env)}/${path}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'if-match': etag },
    body: JSON.stringify(data),
  });
  if (r.status === 412) return { ok: false, conflict: true };
  if (!r.ok) throw new Error(`RTDB PUT ${path} failed: ${r.status}`);
  return { ok: true };
}

export async function rtdbPut(env, path, data) {
  const token = await getAccessToken(env);
  const r = await fetch(`${dbBase(env)}/${path}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`RTDB PUT ${path} failed: ${r.status}`);
  return r.json();
}

// Test-only — reset the access-token cache. Production code never calls this.
export function _resetTokenCache() {
  _cachedToken = null;
  _cachedTokenExpiresAt = 0;
}
