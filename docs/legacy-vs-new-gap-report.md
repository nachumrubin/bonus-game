# Legacy Vs New Gap Report

Source: `HEAD:index.html` is the legacy authority. New implementation references point at the modular `src/` tree. Status is conservative: code presence alone is not enough to mark parity unless a branch-level test or equivalent state comparison exists.

## Critical Gaps

| Gap | Legacy behavior | New behavior / location | User impact | Evidence | Suggested parity test |
|---|---|---|---|---|---|
| Dictionary admin approved words are not fully proven | `addApprovedDictionaryWords()` reads `DICT_APPROVED_DB_PATH` and merges approved Firebase words into `DICT`. | `src/game/core/hebrewDictionary.js` has core validation; `src/game/account/dictionaryService.js` has suggestion paths, but approved-word runtime sync is not clearly covered. | Legal words approved by admins may still be rejected in games. | Legacy lines 2928-2939; new `dictionaryService.js` | Mock Firebase `dictionaryApproved`, load dictionary, assert playable validation accepts approved word. |
| Two-letter policy needs explicit regression guard | Legacy has `CLASSIC_ALLOW` and must reject two-letter words unless exact/manual allowed. | `hebrewDictionary.js:isValid()` exists, but broad heuristic branches need coverage against two-letter false positives. | Illegal short words can become playable. | Legacy lines 3001, 3130; new `hebrewDictionary.js` | Add allowed and rejected two-letter fixtures; ensure heuristic fallback is bypassed for non-allowlisted 2-letter words. |
| Online stale/double move prevention differs | Legacy uses `pushMoveToFirebase()`, `listenForMoves()`, `onlineStateSeq`, push ids, and move count guards. | New `roomService.commitTransaction()` uses `room.version` transaction guard. | Critical if both clients submit or reconnect near the same time; can corrupt turn/board. | Legacy `onlineStateSeq` line 3311, `pushMoveToFirebase()`, `listenForMoves()`; new `roomService.commitTransaction()` | Mock two clients committing same expected version; assert one commit wins and loser does not mutate local state as confirmed. |
| Online bag/rack sync still partial | Legacy serializes and restores bag, racks, board, scores, turn, bonus state in `serializeGameState()` / `loadGameState()`. | New `schema.js` serializes board/bonus board and `roomService.engineStateFromRoom()` restores many fields, but parity for all fields is not complete. | Clients may see different racks/bag/turn after reconnect or async resume. | Legacy `serializeGameState()` line 10083; new `schema.js`, `roomService.js` | Golden snapshot with board, bonusBoard, bag, racks, activeBoosts, locks, pendingBonuses; round-trip through Firebase schema. |
| Pending placement recovery is UI-owned and not fully covered | Legacy `placed` remains visible/recoverable after invalid moves and timeout recall. | Engine intentionally does not retain pending UI placements; `gameController.js` owns recall. | Invalid move or timeout can lose tiles if UI controller drifts. | Legacy `placed` line 3304, `doRecall()` line 5069, `expireCurrentMove()` line 3797; new `gameController.js` | UI/controller test: place tiles, reject invalid move, assert rack/board can recall exactly those tiles. |

## High Gaps

| Gap | Legacy behavior | New behavior / location | User impact | Evidence | Suggested parity test |
|---|---|---|---|---|---|
| Bot search parity is weak | `doBotSearch()`, `isBotCrossWordValid()`, `botCommit()` choose and commit bot moves after delay. | `src/game/sessions/botSearch.js` and `botGameSession.js` exist. Branch-level legacy comparison is missing. | Bot may play illegal moves, miss legal moves, or score incorrectly. | Legacy lines 3970-4048 | Fixture with fixed board/rack/dictionary; compare selected bot move legality and score. |
| Bonus B1-B13 branch coverage incomplete | `triggerBonus()`, mini-game builders, `bonusOk()`, `bonusSkip()` handle auto, future, mini-game, wheel, skip/fail outcomes. | `bonusResolver.js`, `boostEngine.js`, mini-games, future effects exist. Several branches are plugin-tested but not end-to-end. | Wrong bonus points, missed extra turn, repeated bonus, or stuck pending bonus. | Legacy `triggerBonus()`, `bonusOk()` line 6800, `bonusSkip()` line 6839 | One test per B type: land on square, resolve success/fail/skip, assert score/turn/activeBoosts. |
| Friend invite lifecycle is changed | Legacy could create room/invite and uses `invites` plus `inviteResponses`; rejection can remove room. | New `inviteService.js` creates no room until accept; acks live under `inviteAcks`. | Better architecture, but not approved as intentional behavior change; UI copy/lifecycle may differ. | Legacy `_listenForInvites()` 8544, `_acceptIncomingInvite()` 8587; new `inviteService.js` comment | Mock invite send/accept/reject; assert sender and receiver screens match legacy expectations. |
| Async move notifications need target proof | Legacy `_notifyAsyncTurnIfNeeded()` watches async session turn changes and notifies when it becomes the user's turn. | `asyncSessionService.js`, `asyncReminderService.js`, `notificationService.js`, `pushPayloadBuilder.js` exist. | Opponent may not get notified after async move. | Legacy line 11332; new `src/notifications/*` | Commit async move; assert push payload target is next player's external id/subscription and active player is skipped. |
| Timer screen/listener cleanup not fully proven | `goHome()` clears timers/bonus overlays/bot timeout; online timers have render/watchdog intervals. | Split across `turnTimerController.js`, session/UI screens. | Bot/timer can fire after leaving game, causing stale state mutation. | Legacy `goHome()` 4072, timer symbols 3306-3308 | Start timed/bot/online game, leave to menu, advance fake timers, assert no turn mutation/listener update. |
| Online timeout claim parity partial | Legacy has server-time offset, grace handling, missed-turn counters, and turn deadline updates. | `roomService.computeExpiredOnlineTurnState()` and `shouldClaimExpiredOnlineTurn()` exist. | Both clients can claim timeout or wrong player can lose turn. | Legacy timeout functions 10242-10343 | Mock old room with deadline and grace; assert only opponent can claim and missed counters match legacy. |
| Profile/stats/avatar progression parity unknown | Legacy updates stats, rankings, achievements, avatar unlock overlays and profile cache. | `profileService.js`, `ratingService.js`, avatar screens exist. | Wins/losses/unlocks/leaderboard can drift. | Legacy stats/profile around 11937 and 12678-12925 | End-game fixtures for win/loss/high score/bonus count; compare profile delta and unlock ids. |

## Medium Gaps

| Gap | Legacy behavior | New behavior / location | User impact | Evidence | Suggested parity test |
|---|---|---|---|---|---|
| Dictionary query UI is not fully mapped | `checkShailta()`, settings query, suggestions/admin flow report valid/invalid words and allow suggestions. | `dictionaryScreen.js`, `dictionaryService.js` | Query screen may disagree with playable validation or lose suggestions. | Legacy 5082-5125, 9200-9429 | Query valid/final/two-letter/rejected word and assert message/status/suggestion payload. |
| Move review/appeal behavior partial | Legacy can show review overlay, highlight illegal words, appeal/force accept. | Engine emits invalid words; UI review exists but appeal parity unclear. | Players may lose legacy appeal/force accept path. | Legacy `highlightIllegalWords()` 5333, `doAppeal()` 5130, `forceAccept()` 5131 | Invalid word fixture; assert overlay, highlighted cells, appeal count, forced commit behavior. |
| Scoring animation sequence not proven | Legacy highlights created words, shows points, then applies total to player. | `animationController.js`, `scoreBonusAnimation.js` | Cosmetic/state timing bugs, especially if state waits on animation. | Legacy score/melody functions near 5292, 7503 | UI test with multiple words; assert final state independent of animation completion. |
| UI screen state reset/preservation unknown | Some legacy screens reset game, some preserve paused/online sessions. | Split screens/controllers. | Returning to menu may lose/resume wrong game. | Legacy `goHome()`, pause/save functions, session storage functions | Start local/online game, navigate away/back, assert expected preservation/cleanup. |
| Mobile layout parity not characterized by tests | Legacy contains dynamic sizing (`computeSizes()`) and side rack rendering. | CSS/partials in modular app. | Board/timer/rack may clip or duplicate on mobile. | Legacy `computeSizes()` 3337, `renderBoard()` 3513 | Playwright mobile screenshots: 10x10 board, bag count, one timer, no clipped side panels. |
| Notification fallback behavior partial | Legacy falls back to browser notification if OneSignal is unavailable/timed out. | `notificationService.js`, `pushPayloadBuilder.js` | Users with unsupported OneSignal setup may miss in-browser notices. | Legacy notification block 8710+ | Mock missing OneSignal and granted Notification; assert browser notification displayed and click routing works. |

## Low Gaps

| Gap | Legacy behavior | New behavior / location | User impact | Evidence | Suggested parity test |
|---|---|---|---|---|---|
| Menu transition animation differs | Legacy `showSc()` applies transition classes and menu enter timer. | `screenTransitions.js` | Visual polish only unless classes block clicks. | Legacy 3256 | Smoke test menu buttons remain clickable after transition. |
| Music/melody scheduling unknown | Legacy has `scheduleMelody()` and `musicTimeout`. | `audioService.js` | Audio polish difference. | Legacy 7503-7561 | Unit/UI test for music setting and stop-on-home behavior. |

## Already Matched Or Recently Resolved By Evidence

| Behavior | Evidence |
|---|---|
| Board is 10x10 | Legacy `BS` line 2782; new `BOARD_SIZE = 10`; tests in board/schema/parity. |
| First move on bonus rejected | Legacy `playWord()` path; parity tests in `tests/unit/engine-parity.test.js`. |
| Collinearity/connectivity/gap rules | Legacy functions 5144-5156; new `moveValidator.js`; parity tests exist. |
| Cross-word scoring | Legacy `getAllWords()`/`calcTotal()`; new `scoringEngine.js`; parity test includes horizontal move with vertical cross-word. |
| Six-pass game over | Legacy `passCount >= 6`; new `turnManager.LEGACY_PASS_GAME_OVER_THRESHOLD`; parity tests exist. |
| Exchange semantics | Legacy `doExchange()` unshift/shuffle/draw; new `applyExchange()`/`returnTilesAndShuffle()`; parity tests exist. |
| Lock inventory default | Legacy `[3,3,5]`; new `LEGACY_LOCK_INVENTORY`; parity tests exist. |
| Bonus-square activation once | Legacy `getActivatedBonuses()`/`bonusSqUsed`; new `collectBonusActivations()`; tests cover representative branches. |

