# Bonus Game — Project Documentation Hub

**בוסט — שבץ נא** is a Hebrew Scrabble-variant PWA with a Firebase backend, Android TWA wrapper, and a mini-game bonus system.

> **Documentation set generated from full source analysis. All claims are evidence-based.**

---

## Project Purpose

A two-player Hebrew word game playable in the browser (PWA) and as an Android app (Trusted Web Activity). Players take turns placing Hebrew tiles on a 10×10 board to form words. The game adds a bonus system: landing tiles adjacent to border bonus squares triggers mini-games (unscramble, word search, crossword, etc.) that award extra points or turn effects.

Game modes: offline 2-player, vs. AI bot, tutorial, online live (with turn timer), online async (turn-by-turn, 7-day expiry).

---

## How to Run

### Development (browser)

No build step required. Open `index.html` in a browser via a local HTTP server:

```bash
python3 -m http.server 4173
# then open http://localhost:4173
```

Or use any static file server. The app uses native ES6 modules — `file://` protocol will not work due to CORS restrictions on module imports.

### Configuration

1. Copy `config.example.js` to `config.js`
2. Fill in real values:
   - `onesignalAppId` — OneSignal app ID
   - `onesignalKey` — OneSignal REST API key (**keep secret, do not commit**)
   - Music URL (optional)
3. Firebase credentials are embedded in `src/main.js` (`DEFAULT_FIREBASE_CONFIG`) — this is intentional for a web app

### Android App

See `/android/` directory. Requires Android Studio and the Gradle build chain. The Android wrapper is a Trusted Web Activity (TWA) pointing to the hosted PWA URL.

---

## How to Test

```bash
# Install dev dependencies first
npm install

# Unit tests (fast, Node.js only, no browser/Firebase)
npm run test:unit

# Firebase Realtime Database rule tests (requires Firebase emulator)
npm run test:emulator

# E2E browser tests via Playwright (requires Python for http.server)
npm run test:e2e

# E2E with visible browser
npm run test:e2e:headed
```

**Current test count:** 609+ unit tests passing.

---

## Important Scripts

| Command | Description |
|---------|-------------|
| `npm run test:unit` | Run all unit + integration tests |
| `npm run test:emulator` | Run Firebase rule tests against emulator |
| `npm run test:e2e` | Run Playwright browser tests |
| `npm run dict:add` | Add words to dictionary |
| `npm run dict:export` | Export dictionary from legacy `index.html` to `data/dictionary.base.txt` |
| `node scripts/stamp-build.js` | Update build timestamp in `sw.js` and `index.html` |

---

## Deployment

1. **Stamp the build:** `node scripts/stamp-build.js` — updates cache name in service worker
2. **Deploy hosting:** `firebase deploy --only hosting`
3. **Deploy database rules:** Automatic via CI (`.github/workflows/firebase-rules.yml`) on push to `main` when `firebase.database.rules.json` changes
4. **Firebase project:** `boost-8ef11` (production)

---

## Project Structure

```
bonus-game/
├── index.html              Browser entry point (legacy code + module loader)
├── sw.js                   Service Worker (cache + push routing)
├── styles.css              All UI styles (90 KB, dark navy design system)
├── manifest.json           PWA manifest (RTL, portrait)
├── firebase.json           Firebase hosting + emulator config
├── firebase.database.rules.json  Realtime DB security rules
├── config.js               ⚠️  GITIGNORED — real credentials
├── config.example.js       Template for config.js
│
├── src/                    ES6 module source (spine architecture)
│   ├── main.js             Application entry point
│   ├── events/             Event bus + command/event constants
│   ├── game/
│   │   ├── core/           Pure game engine (board, bag, validator, scorer, dictionary)
│   │   ├── boosts/         Bonus/boost system (B1–B13)
│   │   ├── sessions/       Game mode sessions (local, bot, online, tutorial)
│   │   ├── online/         Firebase services (rooms, invites, matchmaking, presence)
│   │   ├── account/        User profile, friends, ratings, dictionary moderation
│   │   └── settings/       Settings compatibility layer
│   ├── ui/
│   │   ├── controllers/    View-model + animation controllers
│   │   └── screens/        Screen components + mini-games
│   ├── notifications/      Push, browser fallback, in-app toasts
│   └── util/               RNG utilities
│
├── partials/screens/       HTML templates for each screen
├── data/
│   └── dictionary.base.txt Hebrew word list (464 KB)
├── tests/
│   ├── unit/               Node.js unit tests (609+ tests)
│   ├── emulator/           Firebase emulator tests
│   └── e2e/                Playwright browser tests
├── docs/                   Parity analysis documents (legacy→spine migration)
├── scripts/                Build utilities
└── android/                Android TWA wrapper (Gradle project)
```

---

## Warning: Config and Secrets

- **`config.js` is gitignored.** Never commit it.
- It contains `onesignalKey` (OneSignal REST API key). If exposed, anyone can send push notifications to all subscribers.
- Firebase credentials in `src/main.js` are intentionally public (Firebase security relies on database rules, not key secrecy).
- The `config.js` file must exist for the app to function in production. Missing it causes silent failures in push notification initialization.

---

## Architecture Summary

The app is mid-migration from a legacy monolithic `index.html` to a modular ES6 "spine" architecture. Both coexist during the transition:

- `index.html` contains legacy inline scripts (still partially active)
- `src/` contains the new spine modules
- `window.__spine` is the integration bridge

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture overview.

---

## Documentation Index

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, layers, data flow |
| [GAMEPLAY_RULES.md](GAMEPLAY_RULES.md) | Board, tiles, scoring, validation, all game modes |
| [CHARACTERIZATION.md](CHARACTERIZATION.md) | Behavioral specification (evidence-based) |
| [CLAUDE.md](CLAUDE.md) | Rules for AI coding agents |
| [API_REFERENCE.md](API_REFERENCE.md) | Public module API reference |
| [TEST_STRATEGY.md](TEST_STRATEGY.md) | Test suites, coverage, gaps |
| [GAP_REPORT.md](GAP_REPORT.md) | Known gaps, risks, fragile modules |
| [DECISIONS.md](DECISIONS.md) | Architecture decisions visible in code |
| [TASKS.md](TASKS.md) | TODOs, risks, recommended work |
| [CHANGELOG.md](CHANGELOG.md) | Recent git history |
| [FILE_INDEX.md](FILE_INDEX.md) | Full repository file index |
| [docs/firebase-flow.md](docs/firebase-flow.md) | Firebase architecture and data flow |
| [docs/notifications.md](docs/notifications.md) | Notification system |
| [docs/db-schema.md](docs/db-schema.md) | Firebase Realtime Database schema |
| [docs/ui-rules.md](docs/ui-rules.md) | UI architecture and conventions |
