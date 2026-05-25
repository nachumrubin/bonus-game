# ARCHITECTURE.md — Bonus Game System Architecture

> Evidence-based. All claims backed by source file reads.
> Source evidence: `src/main.js`, `src/game/core/gameEngine.js`, `src/game/sessions/`, `src/game/online/`, `src/ui/`, `src/events/`

---

## Overview

Bonus Game ("בוסט — שבץ נא") is a Hebrew Scrabble-variant PWA. The codebase is mid-migration from a legacy monolithic `index.html` (all inline scripts) to a modular **"spine"** architecture using ES6 modules.

The spine is live and feature-complete for all game modes. Legacy code in `index.html` still exists but is being phased out. The `window.__spine` global is the integration surface.

---

## Layer Diagram

```
Browser / Android TWA
        │
   index.html  (PWA shell, embedded HebrewValidator, legacy globals)
        │
   src/main.js  (boots everything, wires cross-cutting concerns)
        │
   ┌────┴──────────────────────────────────┐
   │ Event Bus (src/events/bus.js)          │
   │  CMD.* commands  ←→  EV.* events       │
   └────┬──────────────────────────────────┘
        │
   ┌────┴─────────────────────────────────────────────────────┐
   │  SESSIONS                                                │
   │  localGameSession  botGameSession  onlineGameSession      │
   │  tutorialSession                                          │
   │        │                                                  │
   │  ┌─────┴──────────────────────────────────────────────┐  │
   │  │  GAME ENGINE  (src/game/core/)                      │  │
   │  │  gameEngine.js → board, tileBag, moveValidator,     │  │
   │  │                   scoringEngine, turnManager,        │  │
   │  │                   hebrewDictionary, boostEngine      │  │
   │  └────────────────────────────────────────────────────┘  │
   └──────────────────────────────────────────────────────────┘
        │
   ┌────┴──────────────────────────────────────────────────────┐
   │  ONLINE LAYER  (src/game/online/)                         │
   │  roomService, inviteService, matchmakingService,           │
   │  asyncSessionService, asyncReminderService,                │
   │  presenceService, timeoutWatchdog, roomCodeService         │
   │        │                                                   │
   │  Firebase Realtime Database                                │
   └───────────────────────────────────────────────────────────┘
        │
   ┌────┴──────────────────────────────────────────────────────┐
   │  UI LAYER  (src/ui/)                                       │
   │  controllers/  screens/  partials/screens/ (HTML)          │
   │  styles.css (90 KB design system)                          │
   └───────────────────────────────────────────────────────────┘
        │
   ┌────┴──────────────────────────────────────────────────────┐
   │  NOTIFICATIONS  (src/notifications/)                       │
   │  OneSignal push + browser fallback + in-app toasts        │
   └───────────────────────────────────────────────────────────┘
```

---

## Core Principles

### 1. Pure Game Engine
`src/game/core/gameEngine.js` contains **zero** DOM, Firebase, or setTimeout calls. All game state lives in a plain JS object. Commands flow in via `dispatch()`, results flow out via the event bus. This makes it fully unit-testable in Node.js.

### 2. Command / Event Bus
`src/events/bus.js` is a simple pub/sub. `CMD.*` constants (from `commands.js`) drive the engine. `EV.*` constants (from `eventTypes.js`) announce what happened. UI and online layers subscribe to events; they never directly mutate game state.

### 3. Session Layer
Each game mode has a session object that wires the engine + bus + (optionally) Firebase:
- `localGameSession` — pure offline wrapper
- `botGameSession` — attaches a bot via `attachBotPlayer()`
- `tutorialSession` — scripted bot with preset moves
- `onlineGameSession` — Firebase-backed with version-guarded transactions

### 4. Deterministic Seeding
The tile bag is seeded (`tileBagSeed` in state). Both online players receive the same seed and produce identical bag sequences locally. This avoids transmitting the full bag state on every move.

### 5. Version-Guarded Transactions
Online moves use `commitTransaction(db, roomId, expectedVersion, produceUpdate)`. Firebase Realtime DB transactions abort if `room.version !== expectedVersion`, preventing race conditions between concurrent writers.

### 6. Hook-Based Boost System
`boostEngine.js` provides a hook system with triggers: `BEFORE_MOVE_VALIDATE`, `BEFORE_SCORE_COMMIT`, `ON_TURN_END`. Boost effect plugins (futureEffects/) register handlers. The engine calls `runHook(TRIGGER, state, payload)` at the right moment; plugins modify state or payload.

### 7. Deferred Scoring for Mini-Games
When a bonus mini-game is triggered on a move, scoring is deferred: the engine emits `MOVE_CONFIRMED` with `scoringDeferred: true` but does **not** commit the score yet. After the mini-game UI completes, `FINALIZE_BOOST_AWARD` is dispatched and `MOVE_SCORE_COMMITTED` is emitted. `onlineGameSession` listens for `MOVE_SCORE_COMMITTED` to perform the actual Firebase write.

---

## Game State Schema (v2)

```javascript
{
  schemaVersion: 2,
  mode: string,                  // 'offline-solo' | 'offline-2p' | 'friend-live' | etc.
  status: 'playing' | 'completed' | 'abandoned',
  players: { 0: SpinePlayer, 1: SpinePlayer },
  settings: Record<string, any>,
  tileBagSeed: string,
  bag: Tile[],                   // LIFO, draw from .pop()
  racks: { 0: Tile[], 1: Tile[] },
  scores: { 0: number, 1: number },
  board: Tile[][]                // 10×10, null = empty
  bonusBoard: Map<'r,c', Tile>,  // 12 off-grid bonus squares
  bonusAssignment: BonusDef[],   // shuffled at game start
  bonusSqUsed: Record<string, boolean>,
  pendingBonuses: PendingBonus[],
  lockedCells: LockedCell[],
  lockInventory: { 0: number[], 1: number[] },  // default [3,3,5]
  moveHistory: MoveRecord[],
  activeBoosts: ActiveBoost[],
  currentTurnSlot: 0 | 1,
  turnNumber: number,
  moveCount: number,
  passCount: number,
  firstMove: boolean,
  abandonedBy: 0 | 1 | null
}
```

Source: `src/game/core/gameEngine.js` → `createInitialState()`.

---

## Session Mode Descriptors

Source: `src/game/sessions/modes.js`

| Mode | Online | Turn Timer | Push on Move | Presence | Expiry |
|------|--------|------------|-------------|----------|--------|
| `offline-solo` | false | optional | false | false | null |
| `offline-2p` | false | optional | false | false | null |
| `tutorial` | false | false | false | false | null |
| `friend-live` | true | true | ifBackgrounded | true | null |
| `friend-async` | true | false | always | false | 7d |
| `random-live` | true | true | ifBackgrounded | true | null |
| `random-async` | true | false | always | false | 7d |

---

## Module Dependency Graph

```
gameEngine.js
  ├── board.js
  ├── tileBag.js          ← letterDistribution.js, rng.js
  ├── moveValidator.js    ← board.js
  ├── scoringEngine.js    ← board.js, tileBag.js (RACK_SIZE)
  ├── turnManager.js      ← tileBag.js, board.js
  ├── hebrewDictionary.js (standalone)
  ├── boostEngine.js      ← boost plugins
  └── bonusResolver.js    ← bonusTileDefs.js, data.js

onlineGameSession.js
  ├── gameEngine.js
  ├── modes.js
  ├── board.js
  └── roomService.js      ← schema.js, board.js, gameEngine.js

inviteService.js
  ├── schema.js
  ├── roomService.js
  └── gameEngine.js

matchmakingService.js
  └── schema.js

asyncSessionService.js
  ├── schema.js
  └── roomService.js

main.js  (wires everything)
  ├── all sessions
  ├── all online services
  ├── all ui controllers/screens
  ├── notificationService
  └── firebaseClient
```

No circular dependencies detected.

---

## Firebase SDK Initialization

Source: `src/game/online/firebaseClient.js`

- SDK version: Firebase compat v10.13.0 (loaded from CDN)
- Scripts loaded lazily via `loadFirebaseSDK()` (cached promise)
- Reuses `firebase.apps[0]` if legacy `index.html` already initialized it
- Test injection via `setFirebaseImplForTests(impl)`

---

## Service Worker

Source: `sw.js`

- OneSignal SDK integration (graceful fallback if unavailable)
- Notification click routing: `OPEN_TURN`, `OPEN_JOIN`, `OPEN_PROFILE`, `OPEN_GAME_SUMMARY`
- Offline cache with cache name `boost-{YYYYMMDDHHmmss}` (auto-invalidated on `stamp-build.js` run)
- Precaches 71 specific assets on install

---

## Event Bus Communication Pattern

```
UI click
  → CMD.CONFIRM_MOVE dispatched to engine
      → engine validates + scores
      → emits EV.MOVE_CONFIRMED
          → animationController subscribes: triggers tile animations
          → gameController subscribes: updates view-model
          → onlineGameSession subscribes: commits to Firebase
              → Firebase emits room update to opponent
                  → onlineGameSession synthesizes EV.OPPONENT_MOVED
                      → UI receives opponent's move
```

---

## Bot Architecture

Source: `src/game/sessions/botGameSession.js`, `botSearch.js`

- `attachBotPlayer(session, opts)` registers event subscriptions on the session
- Bot listens for `EV.TURN_CHANGED` and `EV.GAME_STARTED`
- Pauses during bonus flows (`bonus/pending` → wait → `bonus/resolved`)
- Uses configurable `thinkingMs` delay before dispatching
- Dispatches `CMD.CONFIRM_MOVE` or `CMD.PASS_TURN`
- Returns `{ detach() }` for cleanup

---

## Legacy / Spine Coexistence

The `index.html` file contains the legacy monolithic game (embedded functions like `openProfileOrAuth()`, `toggleMusic()`, etc.). The spine modules take over incrementally:

1. `src/main.js` boots and replaces legacy handlers (removes `onclick` attributes, mounts screen controllers)
2. `window.__spine` exposes the new API for legacy code to call
3. Legacy global functions (`globalThis.setS`, etc.) remain as fallback during migration
4. `settingsCompat.js` bridges legacy `bonusGameSettingsV1` localStorage with spine settings

This dual-mode operation means both systems can be partially active simultaneously during the cutover phase.

---

## Build Process

No bundler. The app loads ES6 modules directly from the browser via `<script type="module">`. The build process is minimal:

1. `node scripts/stamp-build.js` — Updates cache timestamp in `sw.js` and `index.html`
2. `firebase deploy --only hosting` — Deploys to Firebase Hosting
3. Database rules deployed by CI (`firebase-rules.yml`) on push to main
