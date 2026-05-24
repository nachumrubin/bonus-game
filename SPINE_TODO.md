# Spine cutover ג€” remaining TODO

A complete list of what's left to wire the app fully to the new ES-module spine in `src/`. Items are grouped by area and roughly ordered by dependency / priority.

Symbols: **[BLOCKER]** = must complete before deleting the legacy inline `<script>`. **[GAP]** = works under takeover flag today but with rough edges. **[POLISH]** = quality-of-life or cleanup.

Status as of slice 13: **609 unit tests passing** across 71 spine test files, branch `spine-rewrite`.

---

## 1. Game-flow UI (in-game overlays + supporting screens)

These run during a game and currently fall back to legacy DOM/handlers. The new spine plays a working offline / live-online game without them, but the UX has gaps.

- [x] **[BLOCKER]** Coin-toss screen (`#scoin`) ג€” wire `enterGameAfterCoinToss()` through bus; the spine currently skips coin toss for matchmaking pairs (status flips straight to `playing`)
- [x] **[BLOCKER]** Game-end overlay (`#ov-end`) ג€” render winner / final scores / "play again" / "back to menu" buttons. Currently the spine only emits `GAME_COMPLETED`; nothing visible
- [x] **[BLOCKER]** Pause overlay (`#ov-pause`) ג€” pause / save / quit-without-save flow
- [x] **[BLOCKER]** Back-to-home confirm (`#ov-back-confirm`) ג€” keep-playing / pause-and-save / quit
- [x] **[BLOCKER]** Settings overlay (`#ov-settings`) ג€” timer toggle, move-limit toggle, music toggle, difficulty change mid-game
- [x] **[GAP]** Live-mode turn timer rendering ג€” `#turn-timer-value` is not currently updated by the spine
- [x] **[GAP]** Disconnect overlay (`#ov-disconnect`) ג€” opponent-offline grace countdown; spine has presence service but no UI wiring
- [x] **[DROPPED]** Move summary popup (`#ov-move-summary`) — legacy-only UI removed; spine continues to commit valid placements directly
- [x] **[DROPPED]** Move review / appeal overlay (`#ov-appeal`) — legacy-only appeal UI removed without replacement
- [x] **[GAP]** Resign confirmation ג€” the spine `resign()` is unconditional; no confirm overlay
- [x] **[GAP]** Direction toggle (`#bh` / `#bv`) ג€” H/V buttons; spine currently doesn't track placement direction (collinearity check happens at confirm time only)

---

## 2. Online lobby Phase 3 (create-room + join-by-code)

`onlineLobbyScreen.js` Phase 1 emits intents but falls back to legacy. Matchmaking is fully spine-driven (Phase 2). Still need:

- [x] **[BLOCKER]** Create-room flow (`#ov-create-room`) ג€” `createRoomScreen.js` reads `#cr-mode-*`/`#cr-tl-*`/`#cr-time-val`/`#cr-name`, emits `CR_INTENT.CONFIRM`. Under `?takeover=online` main.js calls new `roomCodeService.createPending` (writes `/pendingRooms/{code}`, no real room until claimed) and opens the waiting room.
- [x] **[BLOCKER]** Waiting-room screen (`#ov-waiting-room`) ג€” `waitingRoomScreen.js` paints code + mode label on `WR_OPEN`, exposes cancel + WhatsApp-share intents. Game launch is detected via `users/{hostUid}/activeRoom` becoming non-null (set by `claimByCode` ג†’ `roomService.createRoom`); host then mounts via `startOnlineGameViaSpine`.
- [x] **[BLOCKER]** Join-by-code flow (`#ov-join-code`) ג€” `joinCodeScreen.js` validates 6-digit code at click time, emits `JC_INTENT.CONFIRM`. main.js calls `roomCodeService.claimByCode`, mounts `onlineGameSession` with `mySlot=1`. Localized error reasons (`not-found` / `expired` / `self-claim` / `already-claimed`) painted to `#jc-error`.
- [x] **[BLOCKER]** Incoming-invite overlay (`#ov-incoming-invite`) ג€” `incomingInviteScreen.js` driven by `inviteService.listenForInvites`; `II_INTENT.ACCEPT/REJECT` call `inviteService.acceptInvite`/`rejectInvite`. Sender-side ack listener bootstraps post-Firebase-auth via `__spine.bootInviteListeners(uid)`.
- [x] **[BLOCKER]** Invite-rejected notice (`#ov-invite-rejected`) ג€” same module; `IR_OPEN` fires when `listenForInviteAcks` returns `accepted=false`. Localized "X dismissed your invite" message.
- [x] **[BLOCKER]** Async session list (`#online-sessions-wrap`) ג€” `asyncSessionListScreen.js` renders rows from `asyncSessionService.listAsyncSessions(db, uid)`; resume/dismiss buttons emit `AS_INTENT.RESUME/DISMISS`. main.js subscribes the index via `watchAsyncSessions` so the list re-paints automatically and `MENU_REFRESH` fires with `hasSavedGame`/`hasOnlineUnread` for the menu badges.
- [x] **[GAP]** Mode/timer/rating filters in matchmaking overlay ג€” `matchmakingOverlayScreen.js` reads `#mm-mode-*`, `#mm-tl-*`, `#mm-rr-*`, `#mm-strict-chk`, `#mm-name` at search-click time and forwards them to `startMatchmaking({ mode, profile, settings })`
- [x] **[GAP]** Matchmaking cancel button ג€” `MM_INTENT.CANCEL` calls `__spine.activeMatchmaking?.cancel()` (legacy `mmCancel()` still runs in parallel via the inline onclick)
- [x] **[GAP]** Strict-search checkbox in matchmaking ג€” `matchmakingService.tryPair` now filters via `isCompatible()` honoring both `settings.strict`+`timelimit` mismatch and per-side `settings.ratingRange`; partner pick is "oldest compatible," not "oldest overall."

---

## 3. Async-mode flows

The spine's `random-async` and `friend-async` modes work conceptually but lack supporting UI.

- [x] **[BLOCKER]** Resume button (`#btn-resume-home`) on menu ג€” `MENU_INTENT.RESUME_SAVED` handler picks the most-recent my-turn async session, falls back to any async session, then to `users/{uid}/activeRoom`. Mounts via `startOnlineGameViaSpine`.
- [x] **[BLOCKER]** Async-mode home button (`#btn-async-home`) inside game ג€” `asyncHomeButton.js` wires the existing button; visibility flipped via `AH_SHOW`/`AH_HIDE` based on `room.mode.endsWith('-async')` at game-start time. Click tears down the active spine session UI without dispatching `RESIGN_GAME`.
- [x] **[GAP]** 24h reminder push ג€” `asyncReminderService.classify`/`sweepForUser` runs opportunistically on auth via `bootAsyncSessionsFor(uid)`; idle ג‰¥ 24h with the opponent to move ג†’ push KIND.REMINDER (idempotent via `lastReminderAt` on the room).
- [x] **[GAP]** 7d expiry ג€” same sweep: idle ג‰¥ 7d ג†’ `roomService.setStatus(EXPIRED)` which clears the async index for both players + push KIND.EXPIRED to both. (Cloud-Function-based scheduler still TODO for the case where neither player opens the app, but opportunistic enforcement covers the common path.)
- [x] **[GAP]** Async turn-arrived in-app banner ג€” `asyncTurnBanner.maybeShow({uid, sessions})` fires on every `watchAsyncSessions` callback; per-uid signature dedup (60s window) prevents nagging when the same set of my-turn rooms re-fires. Uses `inAppNotificationService.show` whose renderer main.js wires to legacy `setS`.

---

## 4. Bonus mini-games (UI only ג€” rules already done in Stage 3)

The boost plugin framework, plugin objects, and resolver are all complete. What's missing is the per-mini-game UI.

- [x] **[BLOCKER]** Bonus-square click ג†’ spine flow ג€” `bonusActivationController` (mounted per game in `attachBonusFlow`) subscribes to `EV.MOVE_CONFIRMED`, scans `state.bonusAssignment` against `BDEFS`, calls `resolveBonusActivation`, dispatches `CMD.ACTIVATE_BOOST` for immediate (auto/future) bonuses, and emits `BONUS_PENDING` for minigame/wheel bonuses.
- [x] **[BLOCKER]** Bonus intro overlay (`#ov-bonus-intro`) ג€” `bonusIntroScreen.js`. `BI_OPEN` paints title/desc per `BONUS_TILE_DEFS` (B1..B13); `BI_INTENT.START` routes to the mini-game spawner.
- [x] **[BLOCKER]** B1 mini-game UI — `unscrambleMiniGame.js` with `tier='long'` covers the 6-letter unscramble path, and `fillMiddleMiniGame.js` is a faithful port of the legacy buildFillMiddle (6-7 letter word with distinct first/last, slot+pool UI, ⌫ backspace, 40-second timer, +100 pts; submission accepts ANY Hebrew word that the validator approves, not just the original answer). main.js dispatches 50/50 between the two paths to match the legacy Math.random()<0.5 split.
- [x] **[BLOCKER]** B3 mini-game UI ג€” same `unscrambleMiniGame.js` with `tier='medium'` (4-letter word, 30 s, 40 pts).
- [x] **[BLOCKER]** B8 mini-game UI — `crosswordMiniGame.js` is a faithful port of the legacy buildCrossword: 5×7 grid, 20 letters drawn from the active game's bag (jokers excluded, padded with common letters if short), free placement (click pool → click cell, click filled cell to return, ↩ recall-all), live ✓/✗ status scan, 60-second timer. Finalize rule: any illegal run zeros the entire bonus; otherwise total = Σ tile-value of every legal horizontal/vertical run ≥2 letters. Pure helpers: `drawCrosswordPool`, `scanCrosswordWords`. Mounts into the legacy `#ov-bonus` / `#bchal` overlay when present.
- [x] **[BLOCKER]** B10 mini-game UI — `crossingWordsMiniGame.js` is a faithful port of the legacy buildCrossingWords + getDynamicCrossingPair: pick two 3-6 letter Hebrew words sharing a non-trivial letter (excludes א/ה/ו/י), display a mini crossword with one blank (?), 20-second single-letter input, +40 pts on match. Falls back to the legacy static pair {h:"תפוח", v:"חגים"} when no dynamic pair fits. Pure helpers: `findCrossingPair`, `gradeCrossingLetter`. Mounts into the legacy `#ov-bonus` / `#bchal` overlay when present.
- [x] **[BLOCKER]** B11 mini-game UI — `wordSearchMiniGame.js` is a faithful port of the legacy buildWordSearch: 10×10 grid, 8 directions (4 cardinal + 4 diagonal), curated 30-word `HEBREW_WORD_POOL` (no final-letter forms), 10 words per puzzle, 60-second timer, 10 pts/word, 10-colour palette per match. Mounts into the legacy `#ov-bonus` / `#bchal` overlay when present, with a self-contained fallback for tests. `extractWord` / `matchPlacement` accept diagonals.
- [x] **[BLOCKER]** B12 mini-game UI — `honeycombMiniGame.js` is a faithful port of the legacy buildHoneycomb ("דבורת המילים"): 12 hand-curated letter groups (center + 6 outer), random pick, type-any-Hebrew-word containing the centre letter, scored by length (2=3 | 3=5 | 4=8 | 5+=10), 40-second timer. Letters from outside the hex are allowed (legacy only gates on center+dictionary). Click hex tiles to append to the input. Pure helpers: `HONEYCOMB_GROUPS`, `pickHoneycombGroup`, `wordPoints`, `gradeHoneycombGuess`. Mounts into the legacy `#ov-bonus` / `#bchal` overlay when present.
- [x] **[BLOCKER]** B13 wheel-of-fortune UI ג€” `wheelMiniGame.js` with pure `pickOutcome(rng, weights?)`, `labelFor(outcome)`, and a CSS-conic-gradient spin animation that lands on the chosen segment. All 8 wheel outcomes from `WHEEL_OUTCOMES` are spun.
- [x] **[GAP]** Boost veto notice (`#ov-boost-veto`) ג€” `boostVetoScreen.js` driven by `BV_OPEN` with `{ boostId, opponentName }`. `describeVeto` localizes the message.
- [x] **[GAP]** ֳ—4 / ֳ—2 multiplier indicator ג€” `boostBadges.js` derives a per-slot badge list from `state.activeBoosts` and renders into the legacy `#scn1`/`#scn2` panels on every `BOOST_ACTIVATED`/`MOVE_CONFIRMED`/`TURN_CHANGED`.
- [x] **[GAP]** Cancel-boost indicator ג€” same module renders a נ›¡ badge for slots with `cancel_next_opponent_bonus`.
- [x] **[GAP]** Free-tile-swap UI — `boostBadges.js` renders a 🔄 clickable badge for `free_tile_swap`; click emits `BB_INTENT.REDEEM_TILE_SWAP`. main.js opens the exchange overlay with `freeSwap: true` via `GAME_SCREEN_INTENT.OPEN_EXCHANGE`; `gameController.exchangeTiles(letters, { freeSwap: true })` dispatches `CMD.EXCHANGE_TILE { freeSwap: true }`; engine's `handleExchange` consumes the active boost via `applyFreeExchange` and skips `advanceTurn`. `onlineGameSession` commits a `free-exchange` `lastMove` so the opponent's client resyncs racks / activeBoosts without firing TURN_CHANGED.
- [x] **[GAP]** Score-bonus animation ג€” `scoreBonusAnimation.js` subscribes to `EV.BOOST_ACTIVATED`, filters by `boostId === 'auto_extra_score'`, and floats a "+N" green badge near the appropriate score panel (`#scn1`/`#scn2`). Pure `describeScoreBonus` helper extracts slot/extra from the entry/payload variants. Mounted by `attachBonusFlow` per game.

---

## 5. Profile / auth / account

The legacy auth + profile feature shipped April 2026. The new spine needs to plug in without rewriting it.

- [x] **[BLOCKER]** Profile screen ג€” `profileScreen.js` wires `#sprofile`. Reads from `currentUserProfile` via `PROFILE_RENDER`, paints avatar/name/stats; click intents (edit/save/avatars/friends/stats/logout/back/upgrade) emit `PROFILE_INTENT.*`. Legacy globals still run as fallback. Pure `deriveStats` helper computes win-rate.
- [x] **[BLOCKER]** Avatar picker ג€” `avatarScreens.js` wires `#sav-gallery`. Pure `SPINE_AVATARS` table + `isAvatarUnlocked(avatar, stats)` predicate; click on unlocked ג†’ `AV_INTENT.SELECT`+`EQUIP` ג†’ main.js calls `profileService.updateProfile({equippedAvatar})`. Locked tiles flash a hint, emit `SELECT(locked:true)` only.
- [x] **[BLOCKER]** Sign-in / sign-up overlays ג€” `authScreens.js` wires `#sauth-signup`/`#sauth-login`. Pure `validateSignupForm`/`validateLoginForm` with Hebrew error map; on submit emits `AUTH_INTENT.SIGN_UP`/`LOG_IN` which main.js routes through Firebase compat SDK (`createUserWithEmailAndPassword` / `signInWithEmailAndPassword`). Google/Facebook still on legacy.
- [x] **[GAP]** Guest-to-account upgrade ג€” same `authScreens.js` wires the `#ov-guest-upgrade` overlay buttons (accept ג†’ `AUTH_INTENT.UPGRADE`, dismiss ג†’ `DISMISS_UPGRADE`).
- [x] **[GAP]** Avatar unlock notice ג€” `mountAvatarUnlockedScreen` driven by `AV_UNLOCK_OPEN`/`AV_UNLOCK_CLOSE`. Pure `diffNewlyUnlocked(prevStats, nextStats)` computes which avatars just crossed their unlock threshold; main.js fires `AV_UNLOCK_OPEN` per newly-unlocked avatar inside the profile watcher.
- [x] **[BLOCKER]** Friend list ג€” `friendsScreen.js` wires `#sfriends`. `FRIENDS_RENDER` paints my-userId / pending-requests / accepted-friends / count / badge; pure `buildRequestsHtml`/`buildFriendsListHtml` (HTML-escaped). Click delegates dispatch `FRIENDS_INTENT.SEND_REQUEST`/`ACCEPT_REQUEST`/`REJECT_REQUEST`/`REMOVE_FRIEND`. main.js routes those through `friendsService` + `profileService.lookupUidByUserId` for the add-by-id flow.
- [x] **[BLOCKER]** Friend request inbox ג€” same module + `friendsService.watchIncomingRequests` (Firebase live subscription). main.js boots the watcher on `bootAccount(uid)` and re-emits `FRIENDS_RENDER({requests})` on every change. Badge auto-shows when length > 0.
- [x] **[GAP]** Stats display ג€” `profileScreen` paints win-rate, high-score, streaks via `deriveStats`; main.js's `profileService.bumpStats` fires on every `EV.GAME_COMPLETED` for online games (delta produced by pure `computeStatsDelta`).
- [x] **[GAP]** Username uniqueness check ג€” `profileService.checkUsernameAvailable(db, name, ownUid)` queries `usernames/{lcname}`; `claimUsername` uses a Firebase transaction so concurrent claims fail safely + frees the old name. `lookupUidByUsername` and `lookupUidByUserId` round out the index.
- [x] **[GAP]** Rating system ג€” `ratingService.js` with pure `expectedScore` / `applyDelta` / `scoreFromResult` + `applyEloForFinishedGame(db, {myUid, oppUid, result})` reads both profiles, writes new ratings + `lastRatedAt`, emits `RATING_EVT.CHANGED`. Hooked into `EV.GAME_COMPLETED` in main.js for online sessions only.

---

## 6. Champions / leaderboards

- [x] **[BLOCKER]** Ratings overlay (`#ov-champs`) ג€” fetch top-N from `globalRatings` Firebase path, render by Elo rating
- [x] **[GAP]** Rating leaderboard on game-end ג€” online `GAME_COMPLETED` applies Elo and upserts both players into `globalRatings`; legacy high-score submission was removed from runtime

---

## 7. Tutorial

- [x] **[GAP]** Tutorial intro screen ג€” `mountTutorialScreen` + `createTutorialController` open the legacy modal through spine and start a tutorial session
- [x] **[GAP]** Tutorial bot move sequence ג€” `tutorialSession` ports `TUT_BOT_MOVES` into a deterministic scripted bot
- [x] **[GAP]** Tutorial guided spotlight (`tutGlow` keyframe) ג€” `TUTORIAL_TIP` highlights the rack/board/score targets with `.tut-lit`
- [x] **[POLISH]** Replay tutorial from menu ג€” `MENU_INTENT.OPEN_TUTORIAL` opens the spine-owned intro and start button

---

## 8. Dictionary management

- [x] **[GAP]** ׳©׳׳™׳׳×׳” (query) feature (`#ov-shailta`) ג€” `dictionaryScreen.js` owns the toolbar + settings query buttons, cleans Hebrew input, emits `DICT_INTENT.CHECK_QUERY`, and main.js answers via `hebrewDictionary` (`DICT_RENDER.QUERY_RESULT` paints `#shres` / `#settings-shres`).
- [x] **[GAP]** Word suggestion flow ג€” `dictionaryService.submitDictionarySuggestions` writes pending entries to `dictionarySuggestions`, skipping already-rejected / approved words; `dictionaryScreen.js` routes `#dict-word-input` through `DICT_INTENT.SUBMIT_SUGGEST`.
- [x] **[GAP]** Admin dictionary approval (`#ov-dict-admin`) ג€” pending suggestions render through `DICT_RENDER.ADMIN_RENDER`; approve/reject uses the existing confirm overlay, updates duplicate pending entries, writes approved words to `dictionaryApproved` or rejected words to `dictionaryRejected`, and immediately adds approved words to the in-memory dictionary.
- [x] **[GAP]** Dictionary login (`#ov-dict-login`) ג€” spine-owned admin login uses the existing admin password gate, then opens the admin-review overlay and refreshes pending suggestions.
- [x] **[POLISH]** Approved-words sync (`syncApprovedDictionaryWordsOnce`) on app start ג€” `dictionaryService.syncApprovedDictionaryWordsOnce` syncs `dictionaryApproved` into `hebrewDictionary.DICT` when Firebase is available.

---

## 9. In-game features still on legacy globals

- [x] **[BLOCKER]** Exchange tiles overlay (`#ov-exch`) ג€” `gameScreen` owns the toolbar exchange button, renders selectable rack tiles into `#exch-rack`, and dispatches `EXCHANGE_TILE` through the spine controller.
- [x] **[GAP]** Lock-cell feature ג€” spine owns `lockedCells`, `lockInventory`, lock placement, countdown rendering, blocking rules, serialization, and online sync; legacy lock partial removed.
- [x] **[GAP]** Music toggle — `src/ui/audioService.js` wraps an HTMLAudioElement, persists state via `settingsCompat` (`spine.uiPreferences.music` + `bonusGameSettingsV1.music`), repaints the `#music-toggle` button (🎵 ↔ 🔇), pauses/resumes playback, and handles browser autoplay blocking. Source is optional via `globalThis.APP_CONFIG.musicUrl`; toggle works as a UI-state flip even without an asset. Wired by `gameFlowController` and the settings overlay via `SETTINGS_CHANGED`.

---

## 10. Animations not yet triggered by `animationController`

These keyframes exist in CSS and the legacy renderer triggers them. The new `gameScreen.js` triggers most, but some are stubbed.

Slice 10 status: **complete in spine**. `gameEngine` now emits `wordTiles`, bonus activations carry `bonusIdx`, `animationController` emits `scoreFlyToPanel` / rack cascade directives, and `gameScreen` renders word glow, floating score labels, score fly-to-panel, bonus-square flash, rack cascade-in, and boost pulse through existing CSS classes. `coinTossScreen.js` already restarts the `coinFlip` keyframe on `COIN_OPEN`.

- [x] **[GAP]** `scoringWordGlow` — `gameEngine` now emits `wordTiles`; `animationController` carries them through and `gameScreen` flashes the actual formed tile cells with `.scoring-word-glow`.
- [x] **[GAP]** `scoringPointsFloat` — `gameScreen` creates transient `.scoring-float-label` overlays anchored near the scored word.
- [x] **[GAP]** `bonusActivate` flash on bonus square trigger — bonus activation commands carry `bonusIdx`; `EV.BOOST_ACTIVATED` forwards it and `gameScreen` flashes `#bsq-{idx}` with `.bonus-activate`.
- [x] **[GAP]** Score-fly-to-panel — `animationController` emits `scoreFlyToPanel`; `gameScreen` animates a transient score chip from the board to the active score panel and lands with `.score-panel-arrive`.
- [x] **[GAP]** Coin flip animation (`coinFlip` keyframe) on starting-player decision — already owned by `coinTossScreen.js` (`COIN_OPEN` restarts `.flipping` on `#coin-disc`).
- [x] **[GAP]** Tile cascade-in / cascade-out (`anim-in` / `anim-out`) on rack refill — rack refill now marks the next rack render with `anim-in` plus staggered `tileDropIn` timing; exchange also triggers the cascade directive.
- [x] **[POLISH]** Boost icon pulse (`boostPulse`) — `gameScreen` now pulses active boost badges / the slot panel on `EV.BOOST_ACTIVATED`.

---

## 11. Cross-cutting infrastructure

Slice 11 status: **complete in spine**. `sessionPersistence.js` stores only `{roomId,userId}`, main.js writes it for online moves/game starts and auto-recovers from saved room or `users/{uid}/activeRoom` after auth. Auth boot now starts OneSignal, presence, invite/account/async watchers, and saved-session recovery; service-worker messages are routed into join/turn/profile/summary flows. Online rooms now store `/rooms/{roomId}/players/{slot}/oneSignalSubId`, and `livePreview` updates render as opponent ghost tiles.

- [x] **[BLOCKER]** Save/restore session — localStorage writes on online game start and every `MOVE_CONFIRMED`; stored payload is only `roomId` + `userId`.
- [x] **[BLOCKER]** Refresh-mid-game recovery — auth boot checks saved session first, then `users/{uid}/activeRoom`, and rejoins the `onlineGameSession` with `skipCoin`.
- [x] **[BLOCKER]** Service-worker `postMessage` handler in `main.js` — receives `OPEN_JOIN`, `OPEN_TURN`, `OPEN_PROFILE`, `OPEN_GAME_SUMMARY` and routes to join overlay / room resume / profile / summary fallback.
- [x] **[BLOCKER]** OneSignal subscription registration — `notificationService.boot({uid})` and `loginUser(uid)` now fire after Firebase auth completes.
- [x] **[BLOCKER]** OneSignal subscription ID stored on room — `roomService.setPlayerSubscriptionId` writes `/rooms/{roomId}/players/{slot}/oneSignalSubId` after an online game mounts.
- [x] **[GAP]** Online presence start/stop on auth events — `presenceService.startPresence` starts on sign-in, updates `currentRoom` on online game start/end, and stops on sign-out.
- [x] **[GAP]** Live preview tiles (opponent's `livePreview`) — `onlineGameSession` emits version-independent preview updates, `gameController` syncs them into the view, and `gameScreen.renderBoard` paints `.spine-live-preview` ghost tiles.

---

## 12. Settings + persistence

Slice 12 status: **complete in spine**. `settingsCompat.js` normalizes the legacy `gameSettings` shape, mirrors it into `globalThis.gameSettings` / legacy `settings`, loads and saves the existing `bonusGameSettingsV1` key, and persists spine UI preferences under `spine.uiPreferences`. Settings changes update active session state, online room `settings`, animation enablement, and the settings overlay refreshes from the current normalized state on open.

- [x] **[BLOCKER]** `gameSettings` global compatibility — legacy `gameSettings` is exposed on `window`, spine normalizes the same keys (`timelimit`, `botTime`, `appealsMax`, `showMoveSummary`, etc.), syncs them into active session state, and applies remote online room settings without a version bump.
- [x] **[GAP]** Persist UI preferences across reloads — spine persists animation enablement / skip state, music on/off, and last-used display name; setup/create-room/matchmaking flows reuse the saved display name when no explicit name is entered.

---

## 13. Testing

Slice 13 status: **repo-side testing complete**. Added the two-window smoke checklist at `docs/spine-smoke-checklist.md`, persisted room bags for reconnect determinism, tightened Firebase rules for v2 room participant writes and dictionary moderation, added static rules tests, added service-worker push-route tests, and added a Playwright spine boot smoke under `tests/e2e/`. Manual browser/device execution and dev-project Firebase deployment remain checklist steps before an actual cutover candidate.

- [x] **[BLOCKER]** Manual two-window smoke checklist (plan §6.2) for all 6 modes — codified in `docs/spine-smoke-checklist.md`; run it before each cutover candidate.
- [x] **[GAP]** Tile-bag determinism across reconnects — v2 rooms now persist `bag`; `engineStateFromRoom` restores it, and tests assert reconnect restores persisted bag/racks exactly.
- [x] **[GAP]** Firebase security rules verification — rules now reject non-participant v2 room writes and static tests assert room/dictionary/presence/matchmaking rule expressions. Dev-project deploy/manual permission probes are listed in the smoke checklist.
- [x] **[GAP]** Service-worker push-routing tests — `src/testing/serviceWorkerRouting.test.js` verifies invite, invite accepted, turn, reminder, completed, expired, friend request, and friend accepted route to the expected spine messages.
- [x] **[POLISH]** End-to-end Playwright tests under `tests/e2e/` — added `tests/e2e/spine-boot.spec.js` for module-spine boot + offline 2P smoke. Local run currently needs Playwright CLI dependencies installed.

---

## 14. Cutover commit + cleanup (Stages 9-final and 10)

Once all **[BLOCKER]** items above are done:

- [x] Delete the inline `<script>` in `index.html` (around line 2783ג€“13842)
- [x] Remove the `?spine=v2` URL gate from `src/main.js` ג€” boot unconditionally
- [x] Remove the `?takeover=games,online` URL gates ג€” always-on
- [x] Bump `CACHE_NAME` in `sw.js` so old SW cache invalidates
- [x] Deploy `firebase.database.rules.json` to Firebase Console
- [x] Delete unused legacy globals exposed only for cohabitation: `gMode`, `fbDb`, `fbCurrentUser`, `mmStartSearch`, `playWord`, `doRecall`, etc.
- [x] Delete `migrateLegacyRoom` pass-through stub (and the call sites in `roomService.readRoom` / `watchRoom`)
- [x] Delete the schema migration test file or replace with a no-op assertion
- [x] Remove all `restore: original onclick` paths in screen-mount modules ג€” once legacy globals are gone, the restore branch is dead code
- [x] Run final invariants (`grep -r "onlineMode ===" src/` ג†’ 0 hits, `grep -r "OneSignal" src/` ג†’ only in `notifications/`, `grep -r "firebase\." src/` ג†’ only in `online/`)

---

## 14b. Gameplay parity bugs found during play-testing

Bugs surfaced by manual play after the cutover. Keep this list as the running log — check items off as they're fixed.

### Fixed

- [x] **Bot plays human's mini-game / wheel** — when the bot landed on a B1/B3/B8/B10/B11/B12/B13 square, `BONUS_PENDING` opened the bonus-intro overlay for the human player, who then played the mini-game and chose the outcome. Fix: `attachBonusFlow` now intercepts `BONUS_PENDING` for the bot slot and auto-resolves via `ctl.skipPending({ earnedPts })` with the legacy fixed bot table (`B1:50 / B3:15 / B8:20 / B10:20`; everything else 0). Added `skipPending()` to `bonusActivationController` (dispatches `FINALIZE_BOOST_AWARD` + emits `BONUS_RESOLVED`).
- [x] **Human gets +N modal for bot's auto bonus (B2/B4/B9)** — `BOOST_ACTIVATED` for `auto_extra_score` on the bot's slot popped the modal award overlay on the human's screen. Fix: `animationController` skips the `bonusAwardOverlay` trigger when `mySlot != null && slot !== mySlot`; `attachBonusFlow` dispatches `FINALIZE_BOOST_AWARD` for the bot and emits `BONUS_AWARD_ACK` so the bot/turn-timer resume.

### Open

- [] **Bonus points credited on the following turn** — when the player completes a bonus mini-game (or auto bonus), the `+N` only lands in the score panel after the turn has already passed to the bot. The score animation / count-up should resolve **before** the turn advances, so the player sees their full move total credited before the bot starts thinking. Reported screenshot: "המחשב: ברכה — 23 נקודות. תורך!" with the player's bonus still floating.
- [] **All move scoring should commit only on אישור** — generalisation of the bug above. The move's base score + bingo + multiplier + bonus extra should be finalised together when the player clicks אישור on the award overlay. Today the base score commits inside `applyMove` and the bonus extra is deferred to `FINALIZE_BOOST_AWARD`, which produces visible split-credit if the player is slow on the overlay.
- [x] **Total move-score float doesn't fly to the player panel** — the red total-score float animation that should travel from the played word to the player's score box no longer arrives. Likely a wiring gap between `scoreFlyToPanel` directive and the score-panel target (`#sv1`/`#sv2` or `#is-sv1`/`#is-sv2`). Verify the directive fires and lands.
- [x] **×2 / ×4 multiplier not forfeited on timeout / illegal move** — if the player has a `multiply_next_turns` boost active and the turn ends by timeout or by an illegal-word forfeit, the multiplier should be consumed by that forfeited turn (legacy `expireCurrentMove` and illegal-word path consume the boost). Today the boost survives and applies to the player's next legitimate move. Check `handlePass({ reason: 'timeout' })` and `handlePass({ reason: 'illegal-word' })` in `gameEngine.js` — `forfeitTimeoutBoosts` only triggers on `timeout`, and `multiply_next_turns` may not be on its forfeit list.
- [] **Missing ×2 / ×4 on-board banner during the multiplied turn** — legacy showed a red banner ("🔥 הניקוד הבא יוכפל פי 4!" for ×4, purple variant for ×2) while a multiplier boost was queued. Add a spine banner driven by `state.activeBoosts` containing `multiply_next_turns`, coloured per multiplier (red for ×4, purple for ×2). See screenshot 1.
- [] **Joker rack tile can pick final-letter forms (ך ם ן ף ץ)** — screenshot 2 shows a joker assigned to a Hebrew final-letter form on the rack. Final letters must only appear at the end of a word; allowing the joker to materialise as one breaks placement rules and lets the player conceal an out-of-position final letter. Joker letter picker should restrict choices to the 22 non-final forms (legacy `terminalFinalVariants` handles validation; the picker UI is the offender).
- [x] **Admin login: `dictionaryAdminSignIn is not defined` on Enter** — pressing Enter inside `#dict-admin-password` fired the inline `onkeydown="if(event.key==='Enter')dictionaryAdminSignIn()"`, a legacy global that no longer exists. Fix: stripped the inline `onkeydown` from [partials/screens/admin-login-overlay.html:6](partials/screens/admin-login-overlay.html#L6). The spine [dictionaryScreen.js:98-104](src/ui/screens/dictionaryScreen.js#L98-L104) already has a proper Enter listener that calls `signIn()`, which now runs alone.
- [x] **Admin "approve word" hits Firebase `PERMISSION_DENIED` on `/dictionaryApproved/<word>`** — the rule required `auth.token.admin === true` (a custom claim) but the spine sign-in only verifies a SHA-256 password client-side. Fix: switched [firebase.database.rules.json:43-58](firebase.database.rules.json#L43-L58) to gate `/dictionaryApproved/$word` and `/dictionaryRejected/$id` writes on `root.child('admins').child(auth.uid).val() === true`, plus a self-gated `/admins/{uid}` node. **Bootstrap step (one-time, manual):** in the Firebase Console, set `/admins/{YOUR_UID}: true` for the account you want to use for moderation. Then deploy the new rules. Without the `/admins/{uid}` entry, the password screen will still accept input but writes will reject.

---

## 15. Polish / nice-to-have

- [x] **[POLISH]** Remove dropped legacy-only partials: move review/appeal, legend, photo crop, and empty removed-feature placeholders. Lock-cell partial intentionally remains until the spine feature exists.
- [x] **[POLISH]** Move CSS from inline `<style>` block in `index.html` into a separate `styles.css` file (independent of cutover)
- [x] **[POLISH]** Move HTML structure into per-screen partials and inject (currently 13k lines in one file)
- [x] **[POLISH]** Add e2e Playwright suite for the spine
- [x] **[POLISH]** Add JSDoc types to the public API of each spine module so editor IntelliSense works without TypeScript
- [x] **[POLISH]** Replace `console.log` in `hebrewDictionary.isValid` with a configurable logger (currently fires on every word check)
- [x] **[POLISH]** Move dictionary loading off the main render path ג€” currently blocking-ish; could `defer` until first move

---

## Cutover dependency graph (high-level)

```
[Stage 9 cutover commit]   ג† deletes inline <script>
        ג†‘
        depends on:  every [BLOCKER] item above
        ג†‘
[BLOCKER] items group into 6 critical-path slices:
  1. Game-end overlay + pause + settings + back-confirm  (ֲ§1)
  2. Coin-toss + waiting-room                            (ֲ§1, ֲ§2)
  3. Create-room + join-by-code + invite flow           (ֲ§2)
  4. Save/restore + refresh recovery + SW postMessage   (ֲ§11)
  5. Bonus mini-games (B1, B3, B8, B10, B11, B12, B13)  (ֲ§4) ג€” DONE
  6. Profile + sign-in + friend list + champions        (ֲ§5, ֲ§6) ג€” ֲ§5 DONE; ֲ§6 pending
```

Each slice can be migrated independently; the spine is structured so that any slice's screens can be moved without touching the others.

---

## Quick reference

- **Branch:** `spine-rewrite`
- **Test command:** `shopt -s globstar && node --test src/**/*.test.js`
- **Smoke-test URLs:**
  - Legacy: `?spine=v1` or no flag
  - Spine boot only: `?spine=v2`
  - Offline takeover: `?spine=v2&takeover=games`
  - Online matchmaking takeover: `?spine=v2&takeover=online`
  - Account/profile takeover: `?spine=v2&takeover=account`
  - Everything: `?spine=v2&takeover=games,online,account`
- **Plan file:** `C:\Users\Admin\.claude\plans\you-are-a-senior-refactored-teacup.md`
