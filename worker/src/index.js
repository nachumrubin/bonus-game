// Push broker for the bonus-game app.
//
// Flow:
//   1. Verify caller's Firebase ID token (Bearer header)
//   2. Accept the OneSignal body the client built, but extract only the
//      intent fields (kind, recipients, ctx) — discard client-supplied
//      headings/contents/app_id
//   3. Rebuild the OneSignal body server-side from a trusted template
//      so the client cannot inject arbitrary phishing text
//   4. Forward to https://onesignal.com/api/v1/notifications with the REST
//      key held only in worker secrets (env.ONESIGNAL_REST_KEY)

import { verifyFirebaseToken } from './verifyFirebaseToken.js';
import { buildPushBody, KIND } from './pushPayloadBuilder.js';
import { runCronSweep } from './cronSweep.js';

const ALLOWED_KINDS = new Set(Object.values(KIND));
const MAX_RECIPIENTS = 4;        // games have 2 players; small headroom
const MAX_CTX_STRING_LEN = 80;   // cap reflected strings to limit phishing-text room
const ALLOWED_CTX_KEYS = new Set([
  'roomId', 'inviterName', 'opponentName', 'fromName',
  'hoursIdle', 'didWin', 'isLive',
  // Game-over copy: winner perspective + final score.
  'isDraw', 'myScore', 'opponentScore',
]);

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(status, payload, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function sanitizeCtx(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_CTX_KEYS.has(k)) continue;
    if (typeof v === 'string') {
      out[k] = v.slice(0, MAX_CTX_STRING_LEN);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeIds(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(x => typeof x === 'string' && x.length > 0 && x.length <= 128)
    .slice(0, MAX_RECIPIENTS);
}

export default {
  // Cloudflare scheduled trigger (cron) — see `[triggers]` in wrangler.toml.
  // Runs the async-game reminder/expiry sweep server-side so it doesn't
  // depend on a player opening the app. Resolves GAP_REPORT item 4.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const summary = await runCronSweep(env);
        console.log('[cron] sweep complete', JSON.stringify(summary));
      } catch (e) {
        console.error('[cron] sweep failed', e?.message ?? e);
      }
    })());
  },

  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ─── Debug endpoint: manual sweep trigger ─────────────────────────
    // POST /cron-debug with a Firebase ID token in Authorization. Only
    // UIDs listed in CRON_ADMIN_UIDS (comma-separated env var) may invoke.
    // Useful for verifying the sweep works against real data without
    // waiting for the cron to fire.
    if (url.pathname === '/cron-debug' && request.method === 'POST') {
      return handleCronDebug(request, env, origin);
    }

    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' }, origin);
    }

    // 1. AuthN
    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'missing_bearer' }, origin);
    }

    if (!env.FIREBASE_PROJECT_ID) {
      return jsonResponse(500, { error: 'misconfigured_project_id' }, origin);
    }

    let claims;
    try {
      claims = await verifyFirebaseToken(authHeader.slice(7), env.FIREBASE_PROJECT_ID);
    } catch (e) {
      return jsonResponse(401, { error: 'invalid_token', detail: String(e?.message ?? e) }, origin);
    }
    // claims.sub is the Firebase UID; reserved for future per-uid rate-limit / authz

    // 2. Parse the OneSignal body shape the client built. We extract only
    //    intent fields and DISCARD client-supplied headings/contents/app_id.
    let incoming;
    try { incoming = await request.json(); } catch { return jsonResponse(400, { error: 'bad_json' }, origin); }
    if (!incoming || typeof incoming !== 'object') {
      return jsonResponse(400, { error: 'bad_body' }, origin);
    }

    const kind = incoming?.data?.type;
    if (!ALLOWED_KINDS.has(kind)) {
      return jsonResponse(400, { error: 'unknown_kind' }, origin);
    }

    const externalIds     = sanitizeIds(incoming?.include_aliases?.external_id);
    const subscriptionIds = sanitizeIds(incoming?.include_subscription_ids);
    if (externalIds.length === 0 && subscriptionIds.length === 0) {
      return jsonResponse(400, { error: 'no_recipients' }, origin);
    }

    // Strip 'type' from data; the rest becomes ctx (allow-listed + length-capped).
    const { type: _typeIgnored, ...rawCtx } = incoming?.data ?? {};
    const ctx = sanitizeCtx(rawCtx);

    // 3. Rebuild body server-side from trusted template
    if (!env.ONESIGNAL_APP_ID) {
      return jsonResponse(500, { error: 'misconfigured_app_id' }, origin);
    }
    if (!env.ONESIGNAL_REST_KEY) {
      return jsonResponse(500, { error: 'misconfigured_rest_key' }, origin);
    }

    const body = buildPushBody({
      appId: env.ONESIGNAL_APP_ID,
      kind,
      ctx,
      externalIds: externalIds.length ? externalIds : undefined,
      subscriptionIds: subscriptionIds.length ? subscriptionIds : undefined,
    });

    // 4. Forward
    let osRes;
    try {
      osRes = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + env.ONESIGNAL_REST_KEY,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return jsonResponse(502, { error: 'upstream_unreachable', detail: String(e?.message ?? e) }, origin);
    }

    const text = await osRes.text();
    return new Response(text, {
      status: osRes.status,
      headers: {
        'Content-Type': osRes.headers.get('Content-Type') ?? 'application/json',
        ...corsHeaders(origin),
      },
    });
  },
};

async function handleCronDebug(request, env, origin) {
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'missing_bearer' }, origin);
  }
  if (!env.FIREBASE_PROJECT_ID) {
    return jsonResponse(500, { error: 'misconfigured_project_id' }, origin);
  }
  let claims;
  try {
    claims = await verifyFirebaseToken(authHeader.slice(7), env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return jsonResponse(401, { error: 'invalid_token', detail: String(e?.message ?? e) }, origin);
  }
  const adminList = (env.CRON_ADMIN_UIDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!adminList.includes(claims.sub)) {
    return jsonResponse(403, { error: 'not_authorized', uid: claims.sub }, origin);
  }
  try {
    const summary = await runCronSweep(env);
    return jsonResponse(200, { ok: true, summary }, origin);
  } catch (e) {
    return jsonResponse(500, { error: 'sweep_failed', detail: String(e?.message ?? e) }, origin);
  }
}
