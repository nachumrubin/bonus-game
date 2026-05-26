# CLAUDE.md — Operating Instructions for AI Coding Agents

> These rules exist to prevent breaking a complex, active production codebase.
> Read this fully before making any code changes.

---

## Critical: What Must Never Change

### Game Engine Invariants
These values are baked into existing game states stored in Firebase. Changing them is a **breaking schema change** that corrupts live games:

- `RACK_SIZE = 8` (`src/game/core/tileBag.js`) — never change
- `BOARD_SIZE = 10` (`src/game/core/board.js`) — never change
- Letter values `HV` (`letterDistribution.js`) — never change; scores are stored in room docs
- Letter counts `HD` (`letterDistribution.js`) — never change; affects seeded bag reproducibility
- `BINGO_BONUS = 50` (`scoringEngine.js`) — never change
- `LEGACY_LOCK_INVENTORY = [3, 3, 5]` (`turnManager.js`) — never change
- `LEGACY_PASS_GAME_OVER_THRESHOLD = 6` (`turnManager.js`) — never change
- `schemaVersion: 2` in room documents — bump only with a migration plan
- Firebase database path constants in `schema.js` — never rename existing paths

### Dictionary
- `data/dictionary.base.txt` — do not delete or truncate. Used by 100+ live games at any time.
- `EXACT_REJECTS`, `CLASSIC_ALLOW`, `DEFECTIVE_ACCEPT` sets in `hebrewDictionary.js` — do not remove entries. Each entry was a deliberate decision.
- `isValid()` function contract: must return `boolean`, synchronously, after dict loads. Never make it async.

### Event/Command Names
- `EV.*` and `CMD.*` constants in `events/eventTypes.js` and `commands.js` — never rename or remove. Online session subscribers depend on exact string values.

### Service Worker Cache
- Never edit `sw.js` cache name or asset list manually. Use `node scripts/stamp-build.js` instead.

---

## What Requires Tests Before Merge

Any change to these areas must have a corresponding unit test:

1. **`turnManager.js`** — any change to `isGameOver()`, `applyMove()`, `advanceTurn()`
2. **`scoringEngine.js`** — any change to scoring formula or bingo detection
3. **`moveValidator.js`** — any change to validation rules or connectivity logic
4. **`hebrewDictionary.js`** — any change to lemmatization, prefix/suffix stripping, or the EXACT_REJECTS/CLASSIC_ALLOW sets
5. **`bonusResolver.js`** — any change to bonus type resolution or mini-game outcomes
6. **Firebase database rules** (`firebase.database.rules.json`) — all changes must pass `npm run test:emulator`
7. **`matchmakingService.js`** — compatibility rules (`isCompatible`) require tests before changes
8. **`asyncReminderService.js`** — timing logic (`classify`) must have unit test coverage

Run `npm run test:unit` before any PR. 609+ tests must remain passing.

---

## How to Modify UI Safely

### Partials and DOM IDs
- `gameScreen.js` hard-codes DOM element IDs (e.g., `#game-grid`, `#brack`, `#sg`, `#sv1`, `#sv2`). If you rename an ID in `partials/screens/game.html`, you must update **all** references in `gameScreen.js`, `gameController.js`, and `animationController.js`.
- `menuScreen.js` targets buttons by `onclick` attribute values (e.g., `button[onclick="openProfileOrAuth()"]`). If you change the `onclick` value in `home.html`, update the selector in `menuScreen.js`.
- Never add global `onclick` attributes to new elements — use bus events instead.

### Styles
- All styles are in `styles.css` (90 KB). There is no CSS bundler.
- CSS variables are defined at `:root` level. Use existing variables before adding new ones.
- The design system uses dark navy gradients. Do not introduce conflicting color schemes.
- Mobile layout is portrait-only (enforced by `manifest.json`). Never add landscape-specific rules without testing on mobile.

### Adding New Screens
1. Add HTML to `/partials/screens/`
2. Register in `screenPartialManifest.js`
3. Create a screen JS file in `src/ui/screens/`
4. Wire via bus events — never call screen functions directly
5. Add CSS to `styles.css` using existing variable conventions

### Animation Changes
- Animation timing constants live in [src/ui/scoreAnimationTimings.js](../src/ui/scoreAnimationTimings.js) (shared module). `animationController.js` and `gameScreen.js` both import from there — edit the shared module instead of duplicating values.
- Never add `setTimeout` inside game engine code. Timers belong in UI controllers.
- Bonus overlay polling (`animationController.js`) checks specific element IDs (`#ov-bonus`, `#ov-bonus-intro`). Don't rename these without updating the poll.
- Score-commit animations are held while bonus overlays are visible. Ensure any new overlay uses the existing `liveBonus.active` gate.

---

## How to Modify the Game Engine Safely

### Pure Function Rule
All files in `src/game/core/` must remain free of:
- DOM access
- Firebase calls
- `setTimeout`/`setInterval`
- Global state mutation (except the explicit `state` object passed in)

Violating this breaks unit testability.

### Adding a Command
1. Add constant to `commands.js`
2. Add handler `handle{CommandName}(state, payload, bus)` in `gameEngine.js`
3. Register in `dispatch()` switch
4. Add tests in the corresponding `.test.js` file

### Adding a Game-Over Condition
1. Modify `isGameOver(state)` in `turnManager.js`
2. Add corresponding test
3. Check if Firebase rules need updating (online games use server-side checks too)

### Modifying Pass/Exchange/Resign
These are well-tested and parity-critical. Any change must:
1. Re-run `npm run test:unit`
2. Update `DECISIONS.md` if semantics change
3. Consider impact on `passCount` accumulation and game-over threshold

---

## How to Handle Online Logic

### Version Guard Pattern
All state-changing Firebase writes must go through `commitTransaction()`:
```javascript
await commitTransaction(db, roomId, expectedVersion, (room) => ({
  ...patch,
  version: room.version + 1,
}));
```
Never write to a room document without a version check. Bypassing this causes race conditions.

### Deferred Score Pattern
If adding a new mini-game or bonus that needs UI interaction before scoring:
1. Set `scoringDeferred: true` in `MOVE_CONFIRMED` event
2. Wait for `CMD.FINALIZE_BOOST_AWARD`
3. Emit `EV.MOVE_SCORE_COMMITTED`
4. `onlineGameSession` listens to `MOVE_SCORE_COMMITTED` to do the second Firebase write
Never write score + bonus separately in non-transactional way.

### Adding Firebase Paths
1. Add path constant to `schema.js` PATH object
2. Add read/write rules to `firebase.database.rules.json`
3. Write emulator tests in `tests/emulator/`
4. Run `npm run test:emulator`

### Presence and Connection
- Never write to `/presence/{uid}` from any code other than `presenceService.js`
- Presence heartbeat is 10 seconds. Don't increase frequency (Firebase cost/rate-limit concern).
- The `onDisconnect` cleanup is set by `startPresence()`. Never set an additional `onDisconnect` on presence without coordinating.

### Timeout Watchdog
- Only the opponent-side runs the watchdog
- Do not trigger watchdog actions from the active player's side
- `liveBonus.active` gate must be respected — never claim a timeout while a mini-game is in progress

---

## How to Handle Firebase Rules

- The rules file is `firebase.database.rules.json`
- All rule changes must pass `npm run test:emulator`
- The CI workflow (`.github/workflows/firebase-rules.yml`) deploys rules to the `boost-8ef11` project on push to main
- Never deploy rules manually without running emulator tests first
- The `rooms` path rules encode complex game-state invariants (version increment, turn logic, timeout grace). Do not simplify them without understanding the full auth model.

---

## How to Handle Animations Without Breaking Gameplay

The animation system is a **subscriber only** — it never mutates game state. Keep it that way.

Rules:
1. `animationController.js` and `gameScreen.js` may only *read* from the event bus, never write commands
2. Animation timing must never gate gameplay. If an animation is still running, gameplay must continue (the game does not pause for animation — only bonus overlays pause the watchdog)
3. Score-merge timing constants (`WORD_MERGE_STAGGER_MS`, etc.) live in [src/ui/scoreAnimationTimings.js](../src/ui/scoreAnimationTimings.js). Both `animationController.js` and `gameScreen.js` import from there — edit the shared module to change a value
4. Polling for overlay close (`setInterval(check, 100)`) is a known pattern. Keep the interval at 100ms or slower

---

## How to Avoid Duplicate Logic

This codebase has legacy code in `index.html` and new code in `src/`. Do not duplicate:

| Logic | Canonical Location |
|-------|-------------------|
| Dictionary validation | `hebrewDictionary.js` → `isValid()` |
| Score calculation | `scoringEngine.js` → `scoreMove()` |
| Move validation | `moveValidator.js` → `validateMove()` |
| Turn advancement | `turnManager.js` → `advanceTurn()` |
| Game-over check | `turnManager.js` → `isGameOver()` |
| Tile bag operations | `tileBag.js` → `drawInto()`, `returnTilesAndShuffle()` |
| Push notifications | `notificationService.js` (OneSignal) or `browserNotificationFallback.js` |
| Firebase auth | `firebaseClient.js` → `ensureApp()` |
| Settings | `settingsCompat.js` → `loadSettings()`, `saveSettings()` |

If you find logic duplicated between `index.html` and `src/`, do not create a third copy. Remove it from the legacy location after verifying the spine version works.

---

## How to Preserve Legacy Parity

The `docs/` folder contains extensive parity documentation:
- `docs/intentional-change-register.md` — 8 deliberate behavior changes (do not revert these)
- `docs/legacy-gameplay-parity-gap-report.md` — risk-rated gap list (medium/high gaps are open issues)
- `docs/legacy-behavior-inventory.md` — 272+ legacy functions mapped to spine equivalents

Before changing any behavior that is marked "verified match" in the parity docs, you must either:
1. Update the parity documentation to explain the intentional change, OR
2. Add it to `intentional-change-register.md`

Never change behavior silently.

---

## Secrets and Config

- `config.js` is gitignored. Never commit it.
- `config.example.js` shows required fields: `onesignalAppId`, `onesignalKey`, music URL
- Firebase credentials are embedded in `src/main.js` (`DEFAULT_FIREBASE_CONFIG`) — this is intentional for a web app (Firebase security model relies on rules, not secret keys)
- OneSignal REST key (`onesignalKey`) is sensitive — it should never appear in client-side code that is publicly readable. Verify this is loaded from `config.js` only.

---

## Running Tests

```bash
# Unit tests (fast, no Firebase)
npm run test:unit

# Firebase emulator tests (requires Firebase CLI)
npm run test:emulator

# E2E browser tests (requires Python http.server)
npm run test:e2e

# Dictionary tools
npm run dict:add    # add words to dictionary
npm run dict:export # export dictionary from legacy index.html
```

Before pushing:
1. `npm run test:unit` — all 609+ tests must pass
2. If Firebase rules changed: `npm run test:emulator`
3. If UI changed significantly: `npm run test:e2e`
