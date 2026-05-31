# DECISIONS.md — Architecture and Design Decisions

> Decisions visible from code and existing documentation.
> Source evidence: `docs/intentional-change-register.md`, `src/game/core/`, `src/game/online/`, `src/main.js`, `firebase.database.rules.json`

---

## D1: ES6 Module Spine Architecture (No Bundler)

**Decision:** The new "spine" architecture uses native ES6 modules loaded directly by the browser. No bundler (Webpack, Vite, Rollup) is used.

**Evidence:** `src/main.js` is loaded as `<script type="module">`. `package.json` has no bundler in devDependencies.

**Rationale (inferred):** Simpler build pipeline, direct debugging without source maps, works with Firebase Hosting's static file serving.

**Tradeoff:** No tree shaking, no code splitting beyond what the browser does natively. All modules are fetched individually.

---

## D2: Pure Game Engine (No DOM/Firebase)

**Decision:** All files in `src/game/core/` must not touch DOM, Firebase, or timers.

**Evidence:** `gameEngine.js` comment states "Pure game logic (no DOM, Firebase, or setTimeout)". Unit tests run in Node.js without any browser globals.

**Rationale:** Full unit testability in Node.js. Engine can be used headlessly for bot search, test harness, and replay.

---

## D3: Event Bus as Primary Integration Layer

**Decision:** Cross-module communication goes through the pub/sub event bus (`src/events/bus.js`). Direct function calls between layers are avoided.

**Evidence:** UI screens emit intent events; engine emits state events; sessions bridge them.

**Rationale:** Decoupled modules can be tested independently. Online session (Firebase writes) and animation layer (DOM mutations) are both pure subscribers.

---

## D4: Version-Guarded Firebase Transactions

**Decision:** All game-state writes to Firebase use `commitTransaction()` with an `expectedVersion` check. Stale writes are aborted.

**Evidence:** `src/game/online/roomService.js` → `commitTransaction()`. Security rules enforce version increment of exactly 1.

**Rationale:** Prevents race conditions when both players attempt to write simultaneously (e.g., both claim a timed-out turn).

**Source in intentional-change-register:** "Online move conflict model — version-based transactions rather than append-only."

---

## D5: Seeded RNG for Tile Bag

**Decision:** The tile bag is shuffled using a seeded RNG. Both players use the same seed (`tileBagSeed`) to independently reproduce identical bag sequences locally.

**Evidence:** `src/game/core/tileBag.js` → `createBag(seed)`. `src/util/rng.js` → `createRng()`, `shuffle()`. `tileBagSeed` is stored in Firebase room doc.

**Rationale:** Avoids transmitting the full bag state on every draw. Reduces Firebase writes and bandwidth. Enables deterministic replay.

**Risk:** If any draw operation diverges between clients (e.g., different exchange order), bags become permanently inconsistent.

---

## D6: Room Created on Invite Accept (Not Send)

**Decision:** For friend invites, the Firebase room is created when the recipient accepts, not when the sender sends.

**Evidence:** `src/game/online/inviteService.js` → `acceptInvite()` calls `roomService.createRoom()`.

**Rationale (from intentional-change-register):** Prevents orphan rooms — rooms that were created but the game was never played (recipient rejected or ignored invite).

**Change from legacy:** Legacy created the room on send.

---

## D7: Client-Side Timeout Watchdog (No Cloud Functions)

**Decision:** The turn timer enforcement runs in the opponent's browser (not a Cloud Function).

**Evidence:** `src/game/online/timeoutWatchdog.js` runs in the browser. No Cloud Function infrastructure exists.

**Rationale (inferred):** Avoid Cloud Function complexity and cost. Firebase Realtime Database transactions can enforce the claim atomically.

**Risk:** If both players close their browsers, no timeout claim fires until one reopens the app. Async games naturally handle this; live games could stall.

---

## D8: Async Reminder Service Runs Client-Side

**Decision:** The 24-hour idle reminder and 7-day expiry sweep run in the user's browser.

**Evidence:** `src/game/online/asyncReminderService.js`, called from `src/main.js` on auth.

**Rationale (inferred):** Same as D7 — no Cloud Function infra.

**Risk:** If neither player opens the app, the sweep never runs. Timings are approximate.

---

## D9: Deferred Scoring for Bonus Mini-Games

**Decision:** When a bonus mini-game is triggered, the move score is deferred. The Firebase commit happens in two writes: one for the move geometry, one for the final score after the mini-game.

**Evidence:** `gameEngine.js` → `scoringDeferred: true` in `MOVE_CONFIRMED`. `onlineGameSession.js` listens for `MOVE_SCORE_COMMITTED` to do the second write.

**Rationale:** Lets the mini-game UI run between the move commit and the score commit. Both players see the mini-game state via `liveBonus` in the room doc.

---

## D10: Hook-Based Boost Plugin System

**Decision:** Boost effects are implemented as plugins that register handlers on a hook system (`BEFORE_MOVE_VALIDATE`, `BEFORE_SCORE_COMMIT`, `ON_TURN_END`).

**Evidence:** `src/game/boosts/boostEngine.js` → `runHook()`, `TRIGGERS`. `src/game/boosts/index.js` → `registerAllBoosts()`.

**Rationale:** Decoupled boost effects can be added/removed without modifying engine core. Each plugin is independently testable.

---

## D11: Firebase Compat SDK (v10.13.0)

**Decision:** Uses Firebase compat SDK (not modular v9+ `import` syntax), loaded from CDN at runtime.

**Evidence:** `src/game/online/firebaseClient.js` → `firebase.database()`, `firebase.auth()`. SDK loaded from `storage.googleapis.com/firebase-js-sdk/v10.13.0/firebase-*.js`.

**Rationale (inferred):** Compat syntax matches legacy code in `index.html` which was already using compat SDK. Migration to modular SDK was deferred.

**Tradeoff:** Larger bundle than tree-shaken modular SDK. CDN dependency for first load.

---

## D12: No Multiplier Board Squares

**Decision:** The game has no double/triple letter or word multiplier squares on the board (unlike standard Scrabble).

**Evidence:** `scoringEngine.js` → `scoreMove()` sums tile face values directly with no multiplier lookup. Board cells contain only `{ letter, val, isJoker }`.

**Rationale (inferred):** Game differentiator — bonus system replaces board multipliers with mini-game-based bonuses.

---

## D13: `schemaVersion: 2` in Room Documents

**Decision:** Room documents carry `schemaVersion: 2`. Security rules enforce this.

**Evidence:** `schema.js` → `buildRoomDoc()` sets `schemaVersion: 2`. `firebase.database.rules.json` requires `newData.child('schemaVersion').val() === 2`.

**Rationale:** Guards against legacy clients writing with old schema. Enables future migration detection.

---

## D14: Lock Inventory `[3, 3, 5]`

**Decision:** Each player starts with lock durations `[3, 3, 5]` turns.

**Evidence:** `turnManager.js` → `LEGACY_LOCK_INVENTORY = [3, 3, 5]`. Named "LEGACY" because this was extracted from legacy behavior, not newly designed.

**Implication:** Players have 3 possible lock durations to choose from (3-turn, 3-turn, 5-turn). Once used, that duration is gone.

---

## D15: Scoreless-Turn Threshold = 4, Exchanges Count, Leader May Claim Early

**Decision:** Game ends when `passCount >= 4`. All scoreless turns count — explicit pass, timeout, illegal-word forfeit, AND tile exchange. A leading player can fire `CMD.CLAIM_STALL_END` once `passCount >= 2` to end the game immediately and win.

**Evidence:** `turnManager.js` → `LEGACY_PASS_GAME_OVER_THRESHOLD = 4`, `STALL_CLAIM_THRESHOLD = 2`, `canClaimStallEnd()` helper. `gameEngine.handleClaimStallEnd()`. Topbar button `#btn-claim-stall-end` + overlay `#ov-claim-stall-end` + `claimStallEndController`.

**Rationale (May 2026 revision):** The original threshold was 6, exchanges reset `passCount`, and illegal-word forfeits also reset it. That combination let a trailing player drag a winning opponent forever by alternating exchanges and bad-word attempts — a real product hole especially in async games (potentially 7-day-per-turn delays). The new rules mirror official Scrabble (six successive *scoreless* turns) but lowered to four for faster resolution since the app skews casual / mobile / short sessions. The claim-end button gives the leader explicit agency rather than forcing them to wait out four scoreless turns.

**Pre-launch change:** App was not in production when this was made, so no live-game migration was needed. The "LEGACY" naming is retained for grep-ability; future tweaks should consider any stored `passCount` values in active rooms.

**Tradeoff:** Tighter rules can occasionally end a game one player thinks is "still going." The claim-end button mitigates by giving the leader an explicit action rather than auto-firing.

---

## D16: Presence Heartbeat 10 Seconds, Grace 30 Seconds

**Decision:** Presence updates every 10 seconds; disconnect overlay shows after 30-second grace.

**Evidence:** `presenceService.js` → `HEARTBEAT_MS = 10_000`, `PRESENCE_GRACE_MS = 30_000`.

**Rationale (inferred):** 10s heartbeat is frequent enough to detect disconnect within 30s window. 30s grace prevents false positives from brief connectivity hiccups.
