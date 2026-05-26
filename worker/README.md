# bonus-game push worker

Cloudflare Worker that brokers OneSignal push sends. Keeps the OneSignal REST
API key off the client.

## Why

Previously the client called `https://onesignal.com/api/v1/notifications`
directly with the REST key in browser memory (loaded from `config.js`). Anyone
who inspected network traffic could exfiltrate the key and spam every
subscriber. See `docs-md/GAP_REPORT.md` item 1.

## How it works

1. Client gets a Firebase ID token via `firebase.auth().currentUser.getIdToken()`
2. Client `POST`s `{ kind, externalIds | subscriptionIds, ctx }` to this worker
   with the token in `Authorization: Bearer <id-token>`
3. Worker verifies the token against Google's JWKS for the
   `securetoken@system.gserviceaccount.com` issuer
4. Worker rebuilds the OneSignal body from a trusted server-side template
   (`pushPayloadBuilder.js`) — the client never controls the heading/body text
5. Worker forwards to OneSignal REST with the secret key

## Deploy

```bash
cd worker
npm install
npx wrangler login
# one-time: paste the OneSignal REST API key
npx wrangler secret put ONESIGNAL_REST_KEY
# fill in ONESIGNAL_APP_ID in wrangler.toml (public, fine to commit)
npx wrangler deploy
# → prints https://bonus-game-push.<account>.workers.dev
```

Copy that URL into `config.js` as `pushWorkerUrl`.

## Rotate the OneSignal REST key

The old key is in your git history and every cached `config.js` ever served.
After deploying, **rotate the key in the OneSignal dashboard** (Settings →
Keys & IDs → regenerate) so the leaked key stops working.

## Local dev

```bash
npx wrangler dev   # serves on http://localhost:8787
```

For local testing you'll need a real Firebase ID token. The worker verifies
issuer/audience against `FIREBASE_PROJECT_ID` in `wrangler.toml`.

## Limits

Cloudflare Workers free tier: 100k requests/day. See `docs-md/GAP_REPORT.md`
for traffic estimates. If you outgrow it, Workers Paid is $5/month for 10M
requests/month.

## Keeping pushPayloadBuilder.js in sync

`src/pushPayloadBuilder.js` is a copy of
`../src/notifications/pushPayloadBuilder.js`. If you edit one, edit both.
A pre-deploy script could copy it automatically — for now it's a manual step.

---

## Scheduled async-game sweep (GAP_REPORT item 4)

The worker also runs a server-side cron sweep that fires the 24-hour
reminder push and the 7-day expiry sweep for async games. Without this,
the sweep only runs when a player opens the app — so a room where neither
player opens the app for 7 days would never expire. The browser-side sweep
in `asyncReminderService.js` is kept as belt-and-suspenders (both write
`lastReminderAt` / `status: 'expired'` so whichever runs first wins).

### Additional setup (one-time)

You need a Firebase service account so the worker can read/write `/rooms`
via the RTDB REST API.

1. Firebase Console → Project Settings → Service Accounts → "Generate new
   private key". Save the downloaded `<project>-firebase-adminsdk-*.json`.
2. Paste the **entire JSON contents** into Wrangler as a secret:
   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
   # paste full JSON, press Ctrl+D (mac/linux) or Ctrl+Z then Enter (win)
   ```
3. Verify `FIREBASE_DATABASE_NAME` in `wrangler.toml` matches your RTDB
   instance name (defaults to `<project-id>`).
4. Deploy: `npx wrangler deploy`. The cron schedule in
   `[triggers]` activates automatically — by default every 4 hours.

### Manual sweep trigger (testing)

To run the sweep on demand without waiting for the cron, set
`CRON_ADMIN_UIDS` in `wrangler.toml` (comma-separated Firebase UIDs of
admins) and POST to `/cron-debug` with a Firebase ID token:

```bash
curl -X POST https://bonus-game-push.<account>.workers.dev/cron-debug \
  -H "Authorization: Bearer <your-firebase-id-token>" \
  -H "Content-Type: application/json"
# → { "ok": true, "summary": { "scanned": N, "reminded": N, "expired": N, "errors": 0 } }
```

Get your ID token from the browser console while signed in:
```js
firebase.auth().currentUser.getIdToken().then(console.log)
```

### Keeping cronSweep.js in sync

`src/cronSweep.js` re-implements `classify()` from
`../src/game/online/asyncReminderService.js`. If you change the
classification rules (reminder/expiry hours, status checks, idempotency
window), update **both**. The constants at the top of each file should
stay identical.
