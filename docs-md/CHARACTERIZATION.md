# CHARACTERIZATION.md — Bonus Game Behavioral Specification

> Documents observable behavior as derived from actual code, not user-facing specs.
> Source evidence: `src/game/core/`, `src/game/sessions/`, `src/game/online/`, `src/ui/controllers/`, unit tests
> Where behavior is uncertain, marked as "Unknown / needs verification"

---

## Startup Sequence

Source: `src/main.js`

1. `index.html` loads — legacy inline code runs, `HebrewValidator` class defined
2. `<script type="module" src="src/main.js">` executes
3. `hebrewDictionary.loadDict()` fires in background (non-blocking)
4. `notificationService.configure()` called with OneSignal credentials from `config.js`
5. Firebase SDK loaded lazily (`loadFirebaseSDK()`)
6. In-app toast renderer injected (`inAppNotificationService.setRenderer()`)
7. `firebase.auth().onAuthStateChanged()` fires:
   - **Signed in:** boot presence, invite listeners, async session watcher, account
   - **Signed out:** tear down cross-cutting concerns
8. `globalThis.__spine` exposed with full API surface
9. If saved online session found in localStorage (`spine.activeOnlineSession`): attempt reconnect

---

## Game Start

### Offline / Bot / Tutorial
Source: `localGameSession.js`, `botGameSession.js`, `tutorialSession.js`

1. `createLocalGameSession()` → `createInitialState()` with seeded bag
2. `engine.start()` emits `EV.GAME_STARTED`
3. For bot: `attachBotPlayer(session, opts)` registers listeners
4. For tutorial: `seedTutorialRack()` injects required letters, `attachScriptedTutorialBot()` registers listeners
5. UI mounts via `mountGameScreen()`

### Online Live
Source: `onlineGameSession.js`, `roomService.js`

1. Room created in Firebase (`/rooms/{roomId}`)
2. `createOnlineGameSession()` → reads room state → `watchRoom()` starts
3. Coin toss determines starting slot
4. `markReadyAndMaybeStart()` called by both players
5. When both ready: game moves to `PLAYING` status
6. `engine.start()` emits `EV.GAME_STARTED`

### Online Async
Source: `asyncSessionService.js`, `inviteService.js`

1. Room created on invite accept (or room-code claim for async modes)
2. Status set to `PLAYING` immediately (no coin toss wait)
3. Player loads game by navigating to async session list and tapping room

---

## Tile Placement Behavior

Source: `src/ui/screens/gameScreen.js`, `src/ui/controllers/gameController.js`

- Player clicks rack tile → tile "floats" (shown as pending placement)
- Player clicks board cell → tile placed tentatively
- Clicking a tentatively placed tile recalls it to rack
- Clicking a committed tile on the board (swap mechanic): swaps the committed tile with a rack tile
- A board tile displaced by an in-progress swap appears at the swap's rack slot and is playable as a placement in the same move (legacy parity: `racks[turn][rackSlot] = returnedLetter`). The engine's rack-defense in `handleConfirmMove` credits the rack copy with the displaced letter before validating placements.
- Clicking a cell that holds a tentative (pending) lock clears that lock — returns it to the bucket. Same effect as the בטל (undo) button. A 500 ms per-cell suppression window blocks the auto-quick-place branch immediately after a clear, so a fast double-tap on the lock still results in "cleared", not "cleared then re-placed".
- Home-screen bottom nav has a "🎮 המשחקים שלי" button that opens `#smygames` — a list of every game the user has open: the local saved offline game (if any), all active async online games, and expired async games. Order: local save first (💾 badge, "משחק שמור" label), then my-turn async rooms, then opponent-turn async rooms, then expired rooms. Each row offers "המשך" (resume) and "×" (remove). Resume routing branches on the sentinel `roomId === '__local__'` — local → `resumeLocalGameViaSpine`, otherwise `resumeOnlineRoomById`. Dismiss similarly branches — local → `clearLocalGame(localStorage)`, otherwise `asyncSessionService.dismissForUid`. The list is one-shot fetched on open and refetched after each dismiss with `{ includeExpired: true }` so expired games are visible too — unlike the in-lobby `#online-sessions-wrap` strip which omits expired rooms.
- The legacy floating "המשך משחק" play button on the top-right of the home screen was removed in June 2026; the resume entry point is now the "המשחקים שלי" list.
- Joker placement opens `jokerPicker.js` letter selection modal
- `CMD.CONFIRM_MOVE` dispatched on "Play" button press with `placed` array

---

## Move Confirmation Flow

Source: `gameEngine.js` → `handleConfirmMove()`

1. Check placed tiles not on locked cells
2. Snapshot swap tiles for rollback
3. Apply swaps to board pre-validation
4. Run `BEFORE_MOVE_VALIDATE` boost hooks
5. `validateMove()` — geometry check
6. `getAllWords()` — word extraction
7. `isValid()` — dictionary check on each word
8. Run `BEFORE_SCORE_COMMIT` boost hooks (multipliers applied here)
9. If bonus activation pending AND mini-game needed: defer score, emit `MOVE_CONFIRMED{scoringDeferred:true}`
10. Otherwise: commit score, emit `MOVE_CONFIRMED{scoringDeferred:false}`
11. Run `ON_TURN_END` hooks (may set `repeatTurn:true`)
12. Apply turn-start effects (skip-opponent, free-tile-swap on next turn)
13. If not `repeatTurn`: advance turn
14. Check `isGameOver()` → if true: `finishGame()`

---

## Invalid Move Behavior

Source: `gameEngine.js`, `gameController.js`

- Engine emits `EV.INVALID_MOVE_REJECTED` with `reason`
- UI shows rejection animation (shake/pulse)
- For `reason === 'illegal-word'`:
  - `passCount` incremented (treated as pass)
  - UI auto-dispatches `CMD.PASS_TURN` after 1100ms
  - Online: pass is committed to Firebase with reason `'illegal-word'`
- For geometry errors: no pass, player tries again

---

## Rack Refill

Source: `turnManager.applyMove()`

- After each move, rack refilled from bag to `RACK_SIZE = 8`
- Refill occurs **after** board mutation but **before** turn advance
- If bag exhausted: rack may have fewer than 8 tiles
- Exchange also refills: `returnTilesAndShuffle()` → `drawInto()`

---

## Online Sync Behavior

Source: `onlineGameSession.js`

### Outgoing (local → Firebase)
- `EV.MOVE_CONFIRMED` → `commitTransaction()` with version check
- `EV.MOVE_SCORE_COMMITTED` → second `commitTransaction()` if scoring was deferred
- `EV.LOCK_PLACED` → `commitTransaction()`
- `EV.TURN_CHANGED` (pass/illegal/timeout) → `commitTransaction()`
- `EV.TILES_EXCHANGED` → `commitTransaction()`
- `EV.GAME_COMPLETED` → `setStatus()` (no version check)

### Incoming (Firebase → local)
`watchRoom()` snapshot triggers synthesis of local events:
- `EV.OPPONENT_MOVED`, `EV.SCORE_CHANGED`
- `EV.LOCK_PLACED`, `EV.LOCKS_CHANGED`
- `EV.TILES_EXCHANGED`
- `EV.TURN_CHANGED`
- `EV.GAME_COMPLETED`
- `EV.LIVE_PREVIEW_CHANGED`, `EV.ROOM_SETTINGS_CHANGED`, `EV.LIVE_BONUS_CHANGED`

### Echo Cancellation
Own moves are recognized by `lastMove.ts === lastSeenMoveTs` and ignored on the incoming path.

### Stale Write Detection
If local version doesn't match Firebase version: emits `'evt/SYNC_REJECTED'`, engine state overwritten from Firebase snapshot.

---

## Timeout / Watchdog Behavior

Source: `timeoutWatchdog.js`

- **Who watches:** The opponent (non-active player) runs the watchdog
- **Poll interval:** 350ms
- **Grace:** 1 second after deadline before claiming
- **Claim action:** Transaction that flips `currentTurnSlot`, increments `turnNumber`, tracks `missedTurns`
- **Forfeit:** 2 consecutive missed turns → `setStatus(ABANDONED)` + `abandonedBy` written
- **No-op conditions:** `liveBonus.active === true` (prevents timeout during mini-game), status ≠ 'playing', timelimit disabled

---

## Presence Behavior

Source: `presenceService.js`

- Written to `/presence/{uid}`: `{ connected, lastSeen, currentRoom, backgrounded }`
- Heartbeat every 10 seconds
- `onDisconnect` clears `connected` flag
- Background detection via `visibilitychange` event → sets `backgrounded: true`
- Grace period for disconnect overlay: `PRESENCE_GRACE_MS = 30_000` ms (30 seconds)

---

## Async Mode Behavior

Source: `asyncSessionService.js`, `asyncReminderService.js`

- Games indexed at `/users/{uid}/asyncRooms/{roomId}`
- Sessions listed in `asyncSessionListScreen.js`
- Sort order: my-turn games first, then by `lastUpdated` descending
- **24-hour reminder:** Push sent after 24h idle (to the player whose turn it is)
- **7-day expiry:** Room status set to `'expired'`, push sent to both players
- **Dismiss:** Removes from only that user's index (other player's index unaffected)

---

## Notification Behavior

Source: `notificationService.js`, `pushPayloadBuilder.js`

### Push Trigger Conditions
- **Live modes:** Push sent only if player is backgrounded (`pushOnMove: 'ifBackgrounded'`)
- **Async modes:** Push always sent (`pushOnMove: 'always'`)
- Deduplication: `lastTurnNotified` Map prevents duplicate pushes for same turn/room

### Notification Types
- Invite received (Hebrew: "הוזמנת למשחק! 🎮")
- Invite accepted/rejected
- Your turn (Hebrew: "תורך בבוסט!")
- Reminder after 24h idle (Hebrew: "תזכורת — תורך מחכה")
- Game completed (Hebrew: "המשחק הסתיים")
- Game expired (Hebrew: "המשחק פג תוקף")
- Friend request, friend accepted

### Browser Fallback
Source: `browserNotificationFallback.js`

If OneSignal unavailable and page is hidden:
- Tries `ServiceWorkerRegistration.showNotification()` first
- Falls back to `new Notification()` constructor
- Only fires when `document.hidden === true` (or `force: true`)

---

## Boost / Bonus Activation Sequence

Source: `gameEngine.js`, `bonusResolver.js`, `bonusActivationController.js`

1. Valid move placed adjacent to bonus square
2. `collectBonusActivations()` → `resolveBonusActivation({ bonusType, slot, turnNumber })`
3. Result type:
   - **auto**: Boost added to `activeBoosts` immediately (e.g., B2 +20pts)
   - **mini-game**: `miniGamePending: true` → score deferred, UI loads mini-game screen
   - **wheel**: `wheelPending: true` → wheel mini-game loads (B13)
4. Mini-game completes → `resolveMiniGameResult()` → score points
5. `CMD.FINALIZE_BOOST_AWARD` dispatched → `EV.MOVE_SCORE_COMMITTED` emitted
6. Online: second `commitTransaction()` with final score

---

## End Game

Source: `turnManager.js`, `gameEngine.js`

- `isGameOver()` checked after every turn advance
- `finishGame()` sets `state.status = 'completed'`, emits `EV.GAME_COMPLETED`
- Online: `setStatus(db, roomId, 'completed')` called (no version check needed for terminal)
- Winner displayed in `endGameScreen.js`
- Rematch option available from end-game screen (wired in `gameFlowController.js`)

---

## Settings

Source: `settingsCompat.js`

Defaults:
- `confirm: true` — show confirm button before playing
- `timelimit: false` — turn timer off by default
- `botTime: 'medium'` — bot thinking speed
- `movelimit: false` — no move count limit
- `music: true`
- `soundFx: true` (Unknown / needs verification — field defined but playback impl not traced)
- `vibration: true`
- `appealsMax: 3` — Unknown / needs verification — legacy field, not verified in spine
- `showBothRacks: false` — Unknown / needs verification
- `showMoveSummary: true` — Unknown / needs verification
- `animationsEnabled: true`

Settings stored in localStorage key `bonusGameSettingsV1` (legacy compat key).

---

## Rating System

Source: `src/game/account/ratingService.js`

- ELO-based with K=24, SCALE=400
- `RATINGS_LIMIT = 10` — leaderboard shows top 10 entries
- Written to `/globalRatings/{uid}` with fields: `uid`, `name`, `rating`, `updatedAt`
- Only applies to online games (Unknown / needs verification — condition not confirmed in code)

---

## Dictionary Admin

Source: `src/game/account/dictionaryService.js`

- Users can submit word suggestions → `/dictionarySuggestions`
- Admin users (Firebase custom claim `admin: true`) can approve/reject
- Approved words → `/dictionaryApproved`
- Rejected words → `/dictionaryRejected`
- Rejection requires `admin` custom claim on Firebase Auth token
