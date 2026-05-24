# boost-game
A Hebrew scrabble mobile game.

## Dictionary loading

The game loads its base dictionary from `data/dictionary.base.txt` at startup.

For resilience, `index.html` still contains an embedded base64 fallback payload that is used only if the static file cannot be fetched.

Export/update the static dictionary file from the embedded payload with:

```bash
npm run dict:export
```

## Hebrew validator source of truth

The Hebrew validator remains maintained inline inside `index.html` as part of the single-file runtime.

## Build timestamp automation

You no longer need to manually edit timestamp values in `sw.js` and `index.html`.

Run this before each deploy/build:

```bash
node scripts/stamp-build.js
```

What it updates automatically:
- `sw.js` cache name: `boost-<timestamp>`
- `index.html` meta version
- `index.html` visible build label
- `index.html` `sw.js?v=<timestamp>` registration query param

### Optional: use a fixed timestamp

```bash
node scripts/stamp-build.js 20260329150000
```

The script expects a 14-digit format: `YYYYMMDDHHmmss` (UTC).

## Firebase Realtime Database index for ratings

The ratings leaderboard queries `globalRatings` ordered by `rating`.

To avoid Firebase's `Using an unspecified index` warning and improve performance, publish `firebase.database.rules.json` in your Firebase project:

```bash
firebase deploy --only database
```

This repo's rules include:
- `globalRatings` path
- `.indexOn: ["rating"]` for efficient rating leaderboard queries

## Dictionary admin authentication

Dictionary approve/reject actions are protected by Firebase Auth custom claims:

- Realtime DB rules require: `auth.token.admin === true`
- Admins should sign in with email/password accounts that have the `admin` custom claim

Regular users can still suggest words (authenticated), but only admin-claimed accounts can approve/reject.

In-app settings now expose:
- A main dictionary section for suggestions (`שלח הצעה`) that supports one word or comma-separated word lists.
- An `הגדרות מתקדמות` button for admin login (email/password).
- An advanced admin moderation window with checkbox-based multi-select suggestions and `קבל` / `דחה` actions.

Admin moderation requires an explicit confirmation step before applying irreversible decisions.
The moderation list filters out suggestions whose words already exist in `dictionaryRejected`.

## E2E spine smoke tests

A Playwright-based browser suite is available under `tests/e2e/`.

Run:

```bash
npm install
npm run test:e2e
```

What it currently validates:
- The spine module boots in the browser.
- An offline 2-player spine session can be started from `window.__spine`.

> Note: this suite runs against the local `index.html` runtime (served with `python3 -m http.server`) and does not require live Firebase connectivity.
