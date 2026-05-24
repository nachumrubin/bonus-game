# Legacy Behavior Map

Source of truth: `git show HEAD:index.html`, 12,878 lines. The working-tree `index.html` is now the modular shell, so agents must read the legacy source from Git history until a separate archived legacy file is committed.

Companion generated inventory: `docs/legacy-behavior-inventory.md` contains the raw declaration-level scan from `scripts/engine-parity-inventory.js`. This map groups that inventory by product behavior and calls out dependency relationships, side effects, and parity risks.

## 1. Global State Inventory

### Engine Constants And Dictionaries

| Legacy symbol | Legacy line | Meaning | New equivalent | Status |
|---|---:|---|---|---|
| `BS` | 2782 | Board size, fixed at 10x10. | `src/game/core/board.js:BOARD_SIZE` | matched |
| `HV` | 2785 | Hebrew letter values. | `src/game/core/letterDistribution.js:HV` | matched |
| `HD` | 2789 | Hebrew tile distribution. | `src/game/core/letterDistribution.js:HD` | partial: present, distribution coverage should stay explicit |
| `ALL_LETTERS` | 2793 | Playable Hebrew letters excluding joker. | `src/game/core/letterDistribution.js:ALL_LETTERS` | matched |
| `DICT`, `dictReady` | 2797-2798 | Runtime dictionary word set and readiness flag. | `src/game/core/hebrewDictionary.js` | partial |
| `DEFECTIVE_ACCEPT`, `EXACT_REJECTS`, `CLASSIC_ALLOW`, `PREFIXES`, suffix sets | 2999-3007 | Hebrew validation exceptions and heuristics. | `src/game/core/hebrewDictionary.js` | partial: code present, branch coverage incomplete |

### Core Game State

| Legacy symbol | Legacy line | Meaning | New equivalent | Status |
|---|---:|---|---|---|
| `gMode` | 3298 | Mode flag: local-vs, bot, online variants. | `src/game/sessions/modes.js`, session adapters | partial |
| `bData` | 3299 | Committed 10x10 board tiles. | `state.board` in `src/game/core/gameEngine.js` | matched |
| `turn` | 3300 | Current player index, 0 or 1. | `state.currentTurnSlot` | matched |
| `placed` | 3304 | In-progress UI placements before submit. | UI/session command payload, not retained by engine | changed/partial |
| `bag`, `racks`, `scores`, `firstMove`, `passCount`, `moveCount` | scanned from legacy globals | Tile bag, rack, scoring, turn lifecycle. | `createInitialState()` and `turnManager.js` | mostly matched by engine parity tests |
| `replacedThisTurn` | 3316 | Pending tile replacement/swap. | `handleConfirmMove({ swappedTiles })` | partial |
| `lockedCells`, `lockInventory` | 3321, 3329 | Lock boost state and available durations `[3,3,5]`. | `turnManager.js`, `state.lockInventory` | matched by tests |
| `bonusSqUsed`, `bonusAssignment`, `bBoardData` | 3180, 3323-3324 | Bonus-square assignment, used flags, off-grid bonus board tiles. | `src/game/boosts/data.js`, `gameEngine.js`, `schema.js` | partial |

### Timers And Online State

| Legacy symbol | Legacy line | Meaning | New equivalent | Status |
|---|---:|---|---|---|
| `moveTimerInt` | 3306 | Local turn timer interval. | `src/ui/controllers/turnTimerController.js` | partial |
| `onlineTimerRenderInt`, `onlineTimeoutWatchdogInt` | 3307-3308 | Online timer render and timeout claim loops. | `roomService.computeExpiredOnlineTurnState()`, UI/session controllers | partial |
| `onlineMissedTurns`, `onlinePresenceByPlayer`, `fbServerTimeOffsetMs` | 3309-3314 | Online presence, clock offset, missed-turn state. | `presenceService.js`, `roomService.js` | partial |
| `onlineStateSeq`, `onlinePendingEffect`, `onlineResolvingEffectId` | 3311-3313 | Move conflict/version and pending remote effect state. | `roomService.commitTransaction()`, session adapters | changed/partial |

### Firebase, Profile, And Notification State

| Legacy symbol | Legacy line | Meaning | New equivalent | Status |
|---|---:|---|---|---|
| `FIREBASE_CONFIG`, `fbApp`, `fbAuth`, `fbCurrentUser` | 8336-8350 | Lazy Firebase setup and auth state. | `src/game/online/firebaseClient.js`, account modules | partial |
| `roomRef`, `onlineListeners`, presence timers | 8359-8363 | Active room path and listener cleanup state. | `roomService.watchRoom()`, session adapters | partial |
| `_inviteListenerRef`, `_pendingInviteData`, `_inviteResponseListenerRef` | 8539-8542 | Friend invite state/listeners. | `src/game/online/inviteService.js` | changed/partial |
| `_osSubscriptionId`, OneSignal init flags | 8710 onward | Push subscription and notification fallback state. | `src/notifications/*`, `roomService.setPlayerSubscriptionId()` | partial |

## 2. Function Inventory Grouped By Product Behavior

### App Shell And Navigation

Legacy functions: `showSc()` (3256), `goHome()` (4072), `ovOpen()` / `ovClose()` (4070-4071), `startSetup()` (4603), `showOnlineLobby()` (9140), `openSettings()`, `openChampions()` (4525), `showStatsScreen()` (12873), profile/auth functions near 11944+.

New locations: `src/ui/screenPartials.js`, `src/ui/screens/*`, `src/ui/controllers/gameFlowController.js`, `partials/screens/*.html`.

Behavior summary: legacy uses one DOM document with `.screen` sections and many overlays. Navigation toggles visibility, clears timers/bonus overlays on home, and sometimes preserves resumable game state in localStorage. New version splits screens into partials and controllers. This is mostly UI parity and is not fully covered by engine tests.

Status: partial/unknown. Important unresolved checks: returning home must clear bot/timer/online listeners; async-home must preserve online room; duplicate timers must not appear.

### Local 1v1 And Bot Game Start

Legacy functions: `startGame()` (4621), `pickStartingTurn()` (4652), `showCoinTossIntro()` (4664), `enterGameAfterCoinToss()` (4722), `initGame()` (4791), `scheduleBotMove()` (3925), `doBotSearch()` (3976), `botCommit()` (4048).

New locations: `src/game/core/gameEngine.js:createInitialState()`, `src/game/sessions/localGameSession.js`, `src/game/sessions/botGameSession.js`, `src/game/sessions/botSearch.js`.

Behavior summary: legacy initializes bag/racks/board, chooses a starting turn, enters the board, starts timer if configured, and in bot mode schedules bot search after the player turn. Bot uses dictionary/placement search helpers and commits via the same board/scoring state path.

Status: partial. Engine state initialization is covered; bot branch parity is still weak.

### Board, Rack, Bag, And Placement

Legacy functions: `initBag()` (3405), `sh()` (3406), `draw()` (3407), `renderBoard()` (3513), `updateBagDisplay()` (3626), `selT()` (4841), `setDir()` (4850), `cellClick()` (4860), `doRecall()` (5069), `openJokerPicker()` (5041), `confirmJoker()` (5050), `doExchange()` (5054).

New locations: `src/game/core/board.js`, `src/game/core/tileBag.js`, `src/game/core/turnManager.js`, `src/ui/controllers/gameController.js`.

Behavior summary: board coordinates are zero-based. On-grid cells are `0..9`; bonus strip cells can be off-grid at row `-1`/`10` or col `-1`/`10`. Racks hold 8 tiles. The legacy bag is a shuffled array and `draw(rack)` pops until rack length is 8 or bag is empty. Exchange returns selected letters with `bag.unshift(letter)`, shuffles, refills, and advances the turn.

Status: mostly matched in engine; UI pending-placement recovery remains partial.

### Move Legality

Legacy functions: `isCollinear()` (5144), `isBonusPos()` (5145), `isConnected()` (5148), `hasGaps()` (5156), `getMoveTiles()` (5177), `getTile()` (5180), `playWord()` (5559).

New locations: `src/game/core/moveValidator.js`, `src/game/core/gameEngine.js:handleConfirmMove()`.

Rules characterized:

| Rule | Legacy evidence | New evidence | Status |
|---|---|---|---|
| Must place/swap at least one tile. | `playWord()` | `handleConfirmMove()` validation path | matched |
| Swap-only move rejected. | `getMoveTiles()` / `playWord()` behavior | `swap-needs-placement` | matched |
| New tiles must be collinear. | `isCollinear()` | `isCollinear(placed)` | matched |
| No empty gaps unless filled by committed tiles. | `hasGaps(pp)` | `hasGaps(state, placed)` | matched |
| First move cannot land on bonus square. | `firstMove && isBonusPos(...)` in play path | `validateMove(): first-move-on-bonus` | matched |
| Later moves must be orthogonally connected. | `isConnected()` | `isConnected(state, placed)` | matched |
| One-letter main word rejected. | `getAllWords()` + `words[0].length < 2` | same check in `gameEngine.js` | matched |
| Invalid dictionary word rejects move and does not commit score/board. | `playWord()` review/appeal path | `INVALID_MOVE_REJECTED` with invalid word tiles | partial: appeal/force accept is UI/legacy-only |

### Word Detection And Scoring

Legacy functions: `getWT()` (5214), `getAllWords()` (5252), `scoreWord()` (5292), `calcTotal()` (5293), `commitPlay()` (after 5559), `highlightIllegalWords()` (5333).

New locations: `src/game/core/scoringEngine.js`, `src/game/core/gameEngine.js`.

Behavior summary: main word is found along the placement axis; cross words are detected for each newly placed tile; one-letter words do not count as formed words. Score is the sum of every formed word, including already committed letters in newly formed words, plus a 50-point all-rack bonus when 8 tiles are placed. Joker values are 0.

Status: matched for core engine cases covered by `tests/unit/engine-parity.test.js`; animation timing and review overlay parity remain UI partial.

### Dictionary And Hebrew Validation

Legacy functions/state: `addWordsFromText()` (2799), `_mkWordEntry()` (2843), `addApprovedDictionaryWords()` (2939), `norm()` (3010), `terminalFinalVariants()` (3013), `dictHas()` (3023), `candidateLemmas()` (3031), `dictHasPlene()` (3115), `analyze()` (3123), `isValid()` (3130), `checkShailta()` (5120), `validateHebrewWord()` (11769).

New locations: `src/game/core/hebrewDictionary.js`, `src/game/account/dictionaryService.js`, `src/ui/screens/dictionaryScreen.js`.

Behavior summary: final Hebrew letters normalize to base forms for lookup; final-form variants are generated for terminal letters; broad heuristics cover prefixes, possessives, verbs, and plene/defective spelling. Two-letter policy must stay exact-match/manual-allow only and must not be admitted by broad heuristics.

Status: partial. Core functions exist; approved-word Firebase sync, admin suggestion flow, query UI, and exact branch coverage remain incomplete.

### Turn Lifecycle

Legacy dependency graph:

```text
playWord()
  -> getMoveTiles()
  -> isCollinear()
  -> hasGaps()
  -> isConnected()
  -> getAllWords()
     -> getWT()
     -> getTile()
  -> isValid()
  -> calcTotal()
     -> scoreWord()
  -> getActivatedBonuses()
  -> triggerBonus() or commitPlay()

commitPlay()
  -> scores update
  -> bData/bBoardData commit
  -> rack removal and draw()
  -> bonus/lock bookkeeping
  -> nextTurn()
  -> pushMoveToFirebase() when online

nextTurn()
  -> pass/game-over checks
  -> lock countdown
  -> timer reset
  -> bot scheduling if bot mode
  -> online state/notification updates if online
```

New dependency graph:

```text
createEngine().dispatch(CONFIRM_MOVE)
  -> handleConfirmMove()
     -> validateMove()
     -> getAllWords()
     -> isWordValid()
     -> scoreMove()
     -> runHook(BEFORE_SCORE_COMMIT)
     -> applyMove()
     -> runHook(AFTER_SCORE_COMMIT)
     -> collectBonusActivations()
     -> runHook(ON_TURN_END)
     -> applyTurnStartEffects()
     -> emit MOVE_CONFIRMED / SCORE_CHANGED / TURN_CHANGED
```

Status: core lifecycle mostly matched; online, animation, appeal, and UI-pending placement lifecycle remain partial.

### Timer

Legacy functions: `getMoveTimeLimit()` (3662), `formatTimerSec()` (3664), `computeTurnSecondsLeft()` (3673), `setOnlineTurnDeadline()` (3696), `setLocalTurnDeadline()` (3704), `expireCurrentMove()` (3797), `startMoveTimer()` (3871), online timeout functions near 10242-10343.

New locations: `src/ui/controllers/turnTimerController.js`, `src/game/settings/settingsCompat.js`, `src/game/online/roomService.js`.

Status: partial. Formatting and some timeout semantics are covered. Full UI timer lifecycle, online grace claims, duplicate timer prevention, and leaving-screen cleanup need more parity tests.

### Boosts And Special Abilities

Legacy functions/state: `BDEFS` (3145), `BONUS_TYPES` (3161), `buildBonusStrips()` (3503), `triggerBonus()` (after 5559), bonus mini-game builders at 5933/6188/6448/6691, `bonusOk()` (6800), `bonusSkip()` (6839), `_doTurnStart()` (7285), `handleOnlinePendingEffect()` (7306).

New locations: `src/game/boosts/data.js`, `src/game/boosts/bonusResolver.js`, `src/game/core/boostEngine.js`, `src/game/boosts/futureEffects/*`, `src/ui/screens/miniGames/*`.

Status: partial. Bonus-square activation is now tested; several B1-B13 branches and skip/fail/online-effect resolution are still suspicious.

### Online, Firebase, Invitations, Async Sessions

Legacy functions: `initFirebase()` (9093), `onlineCreateRoom()` (9515), `onlineJoinByCode()` (9707), `onlineMatchmaking()` (9785), `serializeGameState()` (10083), `loadGameState()` (after 10083), `listenForMoves()` and `pushMoveToFirebase()`, `setupPresence()` (10343), `_listenForInvites()` (8544), `_acceptIncomingInvite()` (8587), `_notifyAsyncTurnIfNeeded()` (11332).

New locations: `src/game/online/firebaseClient.js`, `schema.js`, `roomService.js`, `roomCodeService.js`, `inviteService.js`, `spineMatchmaking.js`, `asyncSessionService.js`, `asyncReminderService.js`, `sessionPersistence.js`, `src/notifications/*`.

Firebase path inventory:

| Path | Legacy use | New equivalent | Status |
|---|---|---|---|
| `rooms/{code}` / `rooms/{code}/state` | Live game state, ready flags, tokens, moves, deadlines. | `PATH.rooms`, `roomService.createRoom/watchRoom/commitTransaction` | partial/changed |
| `pendingRooms/{code}` | Join-by-code pending room flow in new version. | `roomCodeService.js` | changed/new abstraction |
| `invites/{uid}/{fromUid or inviteId}` | In-app friend invite notification. | `inviteService.listenForInvites()` | changed/partial |
| `inviteResponses` / `inviteAcks` | Sender learns accept/reject. | `PATH.inviteAcks`, `listenForInviteAcks()` | changed/partial |
| `matchmakingQueue` | Random opponent queue. | `spineMatchmaking.js`, `matchmakingService.js` | partial |
| `users/{uid}/activeRoom` | Active room resume. | `roomService.createRoom/leaveRoom` | partial |
| `users/{uid}/asyncRooms` | Async session list. | `asyncSessionService.js` | partial |
| `dictionaryApproved`, `dictionarySuggestions`, `dictionaryRejected` | Dictionary admin/suggestion flow. | `dictionaryService.js` | partial |
| rankings/profile/friends paths | Profile, friends, ratings, leaderboards. | `src/game/account/*` | partial |

Status: partial/changed. New transaction model is cleaner but must be registered as intentional until approved.

### Local Storage And Session Storage

Legacy keys observed from `HEAD:index.html`:

| Key | Purpose | New equivalent/status |
|---|---|---|
| `bonusGameTutSeen` | Suppress tutorial prompt. | UI tutorial modules; partial |
| `bonusGameSettingsV1` via `STORAGE_KEYS.settings` | Game settings. | `settingsCompat.LEGACY_SETTINGS_KEY`; matched/partial |
| `bonusUserProfile` or `STORAGE_KEYS.userProfile` | Cached profile. | `profileService` plus local cache; partial |
| `bonusGuestChosen`, `bonusGuestUpgradeSeen` | Guest onboarding flags. | Auth/profile screens; partial |
| `notifEnabled` | Notification toggle. | `notificationService`/settings; partial |
| paused game key via `STORAGE_KEYS.pausedGame` | Pause/resume local game. | UI/session persistence; partial |
| online session key via `STORAGE_KEYS.onlineSession` | Async/live session cache. | `spine.activeOnlineSession` and async room index; changed/partial |
| `profileWriteQueue` via `STORAGE_KEYS.profileWriteQueue` | Offline profile write queue. | profile service unknown | unknown |
| `ios-hint-shown` in sessionStorage | iOS install hint. | UI-only | unknown |

## 3. DOM And Event Handler Inventory

Legacy uses inline `onclick` handlers plus dynamic listeners. Important entry points:

| DOM/control area | Legacy IDs/classes | Legacy handlers | New location | Status |
|---|---|---|---|---|
| Home/menu | `btn-profile-home`, `btn-resume-home`, `btn-online-lobby`, `.hbtns`, `.screen` | `openProfileOrAuth`, `resumeSavedGame`, `startSetup`, `showOnlineLobby`, `showTutorialIntro`, `openSettings` | `partials/screens/home.html`, `menuScreen.js` | partial |
| Online lobby | `ov-create-room`, `ov-join-code`, `ov-matchmaking`, invite overlays | `onlineCreateRoom`, `onlineJoinByCode`, `onlineMatchmaking`, `_acceptIncomingInvite` | online screen modules | partial |
| Setup/coin toss | difficulty buttons, `coin-enter` | `setDiff`, `startGame`, `enterGameAfterCoinToss` | setup/coin toss screens | partial |
| Board | `game-grid`, `c{r}_{c}`, `bsq-{i}`, `brack`, `btn-play`, `btn-recall`, `sbar`, `turn-timer` | dynamic `addEventListener('click', cellClick)`, `playWord`, `doRecall`, `doExchange`, `openShailta` | `gameScreen.js`, `gameController.js` | partial |
| Settings | `sett-*`, `sett-notif-button` | `settToggle`, `settAdj`, `requestNotifPermission`, dictionary query/admin handlers | settings/dictionary screens | partial |
| Review/bonus overlays | `ov-move-summary`, `review-confirm`, `review-appeal-btn`, `ov-bonus`, `bok` | `reviewConfirm`, `reviewAppeal`, `bonusOk`, `bonusSkip` | animation/bonus controllers | partial |
| End/champions/stats/profile | `ov-end`, `ov-champs`, stats/profile screens | `endGame`, `openChampions`, profile auth/avatar handlers | account/UI modules | partial |

## 4. Firebase And Notification Inventory

Legacy online is Firebase Realtime Database plus optional OneSignal push:

- Firebase SDK is loaded lazily. `initFirebase()` initializes app/auth/database and anonymous or named auth.
- Room state is written under `rooms/{roomCode}` and/or `rooms/{roomCode}/state`, with ready flags, tokens, timers, presence, board, racks, bag, scores, and move metadata.
- Move sync uses `pushMoveToFirebase(reason)` and `listenForMoves()`. Legacy has multiple dedup guards: push id, `stateSeq`, `moveCount`, and local client id.
- Invite sync uses `invites/{uid}` and `inviteResponses/{senderUid}/{inviteeUid}`.
- Push notifications use OneSignal REST calls for room tokens and `include_aliases.external_id` for user-targeted invites/friend events.
- New version centralizes room writes in `roomService.commitTransaction()` and notifications in `src/notifications/*`. This must be treated as a behavior change until approved.

## 5. Game Engine Dependency Graph

```text
initGame()
  -> initBag()
  -> draw(rack0), draw(rack1)
  -> renderBoard()
  -> updateUI()
  -> startMoveTimer()
  -> scheduleBotMove() when bot turn

cellClick()
  -> selected rack/joker/lock state
  -> placed[]
  -> renderBoard()
  -> updateUI()

playWord()
  -> getMoveTiles()
  -> legality checks
  -> word detection
  -> dictionary validation
  -> move review / appeal / forced accept
  -> bonus activation
  -> commitPlay()

commitPlay()
  -> board/rack/bag/score mutation
  -> animation/review summary
  -> online push if needed
  -> nextTurn()

nextTurn()
  -> pass/game-end/move-limit checks
  -> boost turn-start effects
  -> lock countdown
  -> timer reset
  -> bot/online/presence/notification side effects
```

## 6. Top 20 High-Risk Behaviors Likely To Regress

1. First move cannot be on an off-grid bonus square.
2. No-gap rule must treat committed tiles as filling gaps.
3. Cross-word detection and validation must include every newly placed tile.
4. Cross-word scoring must count committed letters again in each formed word.
5. Two-letter words must be exact/manual allow only.
6. Final-letter normalization must validate dictionary words without allowing illegal board letters.
7. Invalid moves must not commit board, score, rack, bag, or turn changes.
8. Timeout must recall pending UI placements and forfeit active multipliers.
9. Regular exchange must keep total tile count and advance turn.
10. Free exchange must consume the boost and not advance turn.
11. Six consecutive passes/timeouts end the game, not two.
12. Lock inventory starts `[3,3,5]` for both players and decrements like legacy.
13. Bonus squares activate once and only after a valid committed move.
14. `bonusSkip()` and failed mini-games must still commit base move exactly once.
15. Bot search must use the same legality/dictionary assumptions as human moves.
16. Online clients must not independently shuffle divergent bags.
17. Online transaction/version logic must prevent double moves and stale commits.
18. Friend invite accept/reject must notify the sender and clean stale invite records.
19. Async move notification must target the next player, not the active client.
20. Leaving screens must stop timers, bot timeouts, and Firebase listeners.

## 7. Proposed Parity Test Matrix

| Area | Minimal tests | Evidence target |
|---|---|---|
| Board/rack/bag | new game, exchange, recall, joker, replacement, bag empty | normalized board/racks/bag count |
| Legality | first move, disconnected, diagonal only, gaps, gap-filled, locked cells | legacy `playWord()` vs `handleConfirmMove()` |
| Word detection | main word, cross words, duplicate avoidance, one-letter rejection | `getAllWords()` snapshots |
| Dictionary | final letters, exact rejects, allowed 2-letter, rejected 2-letter, plene/defective | `isValid()` parity |
| Scoring | single word, multiple words, existing tiles, joker, bingo, multipliers | `calcTotal()` vs `scoreMove()` |
| Turn lifecycle | valid move, invalid move, pass, six-pass game over, exchange, timeout | state snapshots and events |
| Boosts | every B1-B13 branch, skip, fail, wheel outcomes, future effects | score/activeBoosts/pendingBonuses |
| Bot | legal response, no-move fallback, dictionary safety | bot move validated by same engine |
| Online | create room, join code, invite accept/reject, random match, async resume | mock Firebase writes/listeners |
| Notifications | invite, async turn, friend request/accepted, fallback browser notification | push payload and target identity |
| UI | 10x10 board, bag count, single timer, illegal message, mobile fit | Playwright visual/state checks |

