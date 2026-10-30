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

## Coin economy (`/economy/*`, October 2026)

Only this worker changes coins and owned store items (D-coin-economy in
`docs-md/DECISIONS.md`). Endpoints, all `POST` with `Authorization: Bearer <Firebase
ID token>` and a JSON body with a `reqId` (8–64 chars of `A-Za-z0-9_-`):

| Path | Body | Does |
|---|---|---|
| `/economy/claim-daily` | `{reqId}` | today's login reward (server date, Asia/Jerusalem) |
| `/economy/achievement` | `{reqId, achievementId}` | an achievement's coins, once |
| `/economy/buy` | `{reqId, item}` | a store item (`reaction:wink`, `boostie:<id>`) at the catalog price |
| `/economy/claim-chain` | `{reqId}` | the next Boostie after one reaches level 7 |
| `/economy/credit-play` | `{reqId, productId, purchaseToken}` | a Google Play coin pack (Phase 6b) |

Guests (anonymous accounts) get 403. Uses the same `FIREBASE_SERVICE_ACCOUNT_JSON`
secret as the cron sweep. The rules live in `../src/game/account/economy.js` and are
bundled in by wrangler: redeploy the worker whenever that file changes.

**Deploy the worker before the database rules reach `main`**, or the app's coin calls
fail.

### Play Billing (Phase 6b)

The Android app (`android/`, billing 1.2.0) buys through `src/game/account/
playBillingClient.js` and posts the purchase token to `/economy/credit-play`. One-time
Google setup:

1. **Play Console → Settings → Payments profile**: merchant profile (bank account, tax
   details). Paid products can't be created without it.
2. **Upload an app bundle with billing** (versionCode 16 or later) to the internal
   testing track. Play shows the products page only after a build with the
   `com.android.vending.BILLING` permission has been uploaded.
3. **Monetize → Products → One-time products**: create `coins_500`, `coins_1200`,
   `coins_3000` (`COIN_PACKS` in `economy.js`; the ids must match exactly), set prices,
   activate. Don't mark them as consumable anywhere: the worker consumes each purchase
   after crediting it.
4. **Service account**: in Google Cloud project `boost-8ef11`, enable the *Google Play
   Android Developer API*, create a service account and a JSON key. In the Play Console,
   go to Users and permissions → Invite new users and enter the service account's email.
   Under App permissions, add this app and give it "View financial data, orders, and
   cancellation survey responses" and "Manage orders and subscriptions". New access can
   take up to 24–48 h; until then the worker gets 401/403 from Google.
5. Paste the key and deploy:

   ```bash
   npx wrangler secret put PLAY_SERVICE_ACCOUNT_JSON
   npx wrangler deploy
   ```
6. **Settings → License testing**: add the testers' Gmail accounts so test purchases
   aren't charged.

`PLAY_PACKAGE_NAME` (`app.boost8ef11.twa`) is in `wrangler.toml`.

### AdMob rewarded videos (`/admob/ssv`)

The Android app plays rewarded videos natively (`RewardedAdActivity`) with the player's
uid as the SSV user id. AdMob then calls `GET /admob/ssv`, and `admobSsv.js` verifies the
signature against Google's keys and credits `AD_REWARD_COINS`, at most
`AD_REWARDS_PER_DAY` times a day. One-time setup:

1. **AdMob** (admob.google.com): add the Android app (link it to the Play listing), then
   create a **Rewarded** ad unit. Under the unit's *Server-side verification*, set the
   callback URL to `https://<this worker>/admob/ssv` and press *Verify URL*. The worker
   answers the signed test ping with 200.
2. Put the ids in `android/gradle.properties`: `admobAppId` (`ca-app-pub-…~…`) and
   `admobRewardedUnitId` (`ca-app-pub-…/…`). Optionally add `ADMOB_AD_UNIT_ID` (the
   numeric part after `/`) to `[vars]` in `wrangler.toml` so callbacks for other units
   are ignored.
3. Publish `https://boost-8ef11.web.app/app-ads.txt` with the line AdMob shows
   (*Apps → app-ads.txt*).
4. **Play Console**: *App content → Ads* = "Yes, contains ads". In *Data safety*, declare
   the advertising ID and the data the ads SDK collects.
5. `npx wrangler deploy`, then build and upload the new app bundle (versionCode 17).

Use a test device, or the test ids that debug builds use. Tapping your own live ads can
get the AdMob account suspended.

### Account deletion (`/account/delete`)

The profile screen's מחיקת חשבון posts here with the player's ID token.
`accountDelete.js` removes the player's data in one multi-path update, renames them in
rooms to "שחקן שנמחק", deletes their OneSignal user, then deletes the Firebase Auth user
through Identity Toolkit (`accounts:delete`). It uses the existing
`FIREBASE_SERVICE_ACCOUNT_JSON` secret, so no new secret is needed. The Firebase Admin
SDK service account may already delete users. If the worker logs `Auth delete failed:
403`, grant the service account the **Firebase Authentication Admin** role in Google
Cloud IAM.

Deploy the database rules too (`firebase deploy --only database`): the worker finds a
player's rooms through the `players/0/uid` and `players/1/uid` indexes on `rooms`.

### Tests

`worker/test/*.test.js` run with `npm run test:unit` from the repo root.

