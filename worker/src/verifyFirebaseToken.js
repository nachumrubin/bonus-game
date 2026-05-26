// Verify a Firebase ID token (RS256-signed JWT) using Google's public JWKS.
// No Firebase Admin SDK — just Web Crypto, available in Cloudflare Workers.
//
// Issuer:  https://securetoken.google.com/<projectId>
// Audience: <projectId>
// Signing keys: https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

let _jwks = null;
let _jwksFetchedAt = 0;

async function getJwks() {
  if (_jwks && Date.now() - _jwksFetchedAt < JWKS_TTL_MS) return _jwks;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('JWKS fetch failed: ' + r.status);
  _jwks = await r.json();
  _jwksFetchedAt = Date.now();
  return _jwks;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

export async function verifyFirebaseToken(token, projectId) {
  if (typeof token !== 'string' || token.length < 20) throw new Error('malformed');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [hB64, pB64, sB64] = parts;

  const header = b64urlToJson(hB64);
  const payload = b64urlToJson(pB64);

  if (header.alg !== 'RS256') throw new Error('bad alg');
  if (!header.kid) throw new Error('missing kid');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new Error('iat in future');
  if (payload.aud !== projectId) throw new Error('bad audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('bad issuer');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('no subject');

  const jwks = await getJwks();
  const jwk = jwks?.keys?.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown kid');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signed = new TextEncoder().encode(`${hB64}.${pB64}`);
  const sig = b64urlToBytes(sB64);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
  if (!ok) throw new Error('bad signature');

  return payload; // payload.sub is the Firebase UID
}
