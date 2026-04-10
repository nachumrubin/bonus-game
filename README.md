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

## Firebase Realtime Database index for champions

The global champions leaderboard queries `globalChampions` ordered by `score`.

To avoid Firebase's `Using an unspecified index` warning and improve performance, publish `firebase.database.rules.json` in your Firebase project:

```bash
firebase deploy --only database
```

This repo's rules include:
- `globalChampions` path
- `.indexOn: ["score"]` for efficient `orderByChild("score")` queries

## E2E multiplayer regression tests

A Playwright-based browser suite is available under `tests/online-turn-sync.spec.js`.

Run:

```bash
npm install
npm run test:e2e
```

What it currently validates:
- Online state publish happens after `nextTurn()` resolves a normal turn handoff.
- Online state publish also happens on the extra-turn early-return path.

> Note: this suite is designed to run fully in this environment against the local `index.html` runtime (served with `python3 -m http.server`) and does not require live Firebase connectivity.
