# TASKS.md — TODOs, Risks, and Recommended Work

> Derived from: `SPINE_TODO.md`, `docs/legacy-vs-new-gap-report.md`, `docs/legacy-gameplay-parity-gap-report.md`, source code analysis
> All items are evidence-based — not invented.

---

## UI: turn glow + My-Games turn colour + bell badge fix — June 2026

- [x] Active-player glow thickened (1px → 3px brighter border + stronger `playerGlowPulse`) for `.scbox.act` and `.is-pcard.act-cell` so whose-turn is obvious.
- [x] Bottom-nav 🎮 "המשחקים שלי" badge turns green (`.em-nav-badge--myturn`) when it's the player's turn in an active online game; red otherwise. New `myTurnInGame` field on `MENU_REFRESH`.
- [x] Notifications bell (`#online-badge`) no longer lights from the my-turn signal — it conflated `hasOnlineUnread` (your turn in a game, no inbox entry) with real inbox items, so the bell flashed over an empty window. Bell now reflects only `unreadCount` (invites + friend requests).

## Fix: bot passing repeatedly — alphabetical vocab bias — June 2026

- [x] Easy (and to a lesser extent medium) bot passed turn after turn. The bot vocab cap in `main.js` took a raw prefix of the now alphabetically sorted `dictionary.txt`, so the pool was ~all `א`-words; with no `א` available the bot had no legal move. Compounded by the cap being applied before `searchBotMove`'s `maxWordLen` filter (easy → only 87 usable ≤3-letter words).
- [x] Fix: pre-filter to `resolveProfile(difficulty).maxWordLen` before capping, and `shuffle` (seeded via `util/rng.js`) before `slice`. Hard cap is now `Infinity`. Easy usable vocab: 87 (all `א`) → 2,000 across 25 initial letters.

## Dictionary: plain text + remove DAWG + remove HSpell pipeline — June 2026

- [x] Switched dictionary from DAWG binary (`dictionary.v2.bin`) to plain sorted text (`dictionary.txt`, 73,173 words).
- [x] Deleted `src/game/core/dawg.js` and `src/game/core/dawg.test.js`.
- [x] Deleted `data/dictionary.v2.bin` and `data/dictionary.v2.meta.json`.
- [x] Deleted `tools/dictionary-build/` (HSpell AGPLv3 pipeline — no longer needed).
- [x] `hebrewDictionary.js` is now a pure text-based `Set` lookup; no DAWG code remains.
- [x] `absorb-firebase-dict.mjs` updated to merge words into `dictionary.txt`.
- [ ] Run `node scripts/absorb-firebase-dict.mjs --commit` locally to absorb any existing Firebase-approved words into `dictionary.txt` and clear the Firebase overlay.

## Dictionary: v1 removal + Firebase absorption script — June 2026

- [x] Removed v1 dictionary path (`loadDict`, v1 `isValid`, mode switching). `hebrewDictionary.js` is now v2-only.
- [x] Deleted `data/dictionary.base.txt`, `scripts/add-dictionary-words.js`, `scripts/export-dictionary-file.js`.
- [x] Bot now uses `DICT` instead of legacy frequency-sorted vocabulary.

## Dictionary additions from curated review list — June 2026

- [x] Added words from `words_sorted_for_review.txt`: 10,624 to `dictionary.base.txt` (40K→50K), 10,012 genuinely new words to `dictionary.v2.bin` (63K→73K). DAWG binary rebuilt and self-tested. Report at `added-words.txt`.

## Fix: forfeiting player not notified of game end — June 2026

- [x] `forceResync()` in `onlineGameSession.js` now emits `EV.GAME_COMPLETED` when the resynced room is in a terminal state (abandoned/completed/expired) and the session hadn't already transitioned. Closes the race where the opponent's watchdog-forfeit write races the forfeiting player's last-moment commit.

## Dictionary reject/accept lists → Firebase only — June 2026

- [x] Removed in-code `EXACT_REJECTS` / `CLASSIC_ALLOW` / `DEFECTIVE_ACCEPT` from `hebrewDictionary.js`; reject/accept now via Firebase overlays only (`BLOCKED_OVERLAY` / approved-overlay). Kept `COMMON_FALSE_POSSESSIVE` (morphology). Tests + docs updated.
- [ ] **Load `docs-md/dictionary-firebase-seed.txt` into Firebase** — REJECTED block → `/dictionaryRejected`, APPROVED block → `/dictionaryApproved`. Until then `נאצי` / `ירושלים` and the inflected prepositions are not blocked by the app. (Use the dictionary admin panel or Firebase console import.)
- [ ] (optional) Decide whether `tools/dictionary-build/*` should also stop applying its own `EXACT_REJECTS`/`CLASSIC_ALLOW` when the DAWG is next rebuilt.

## Fix: easy-bot default + Bubblewrap removal — June 2026

- [x] Easy bot played 5-letter words: the bot difficulty default was medium (1) while setup.html highlighted easy. Defaulted difficulty to 0 (easy) in `setupScreen.js` + `main.js` `START_VS_BOT`. Profiles unchanged (already correct).
- [x] Removed Bubblewrap: deleted root TWA/Gradle working copy + `twa-manifest.json`; build via the `android/` Android Studio project. Updated `firebase.json`, `FILE_INDEX.md`.
- [ ] (pre-existing, unrelated) 2 `setupScreen.test.js` title-text assertions + 2 `gameEngine.test.js` rack fixtures fail on HEAD; not in the `test:unit` gate. Fix when next touching those areas.

## Fix: timer_bonus (+10s wheel) — June 2026

- [x] Offline/optional modes: B13 `timer_bonus` now actually extends the turn clock. Engine records `state.turnTimerBonusMs` in `applyTurnStartEffects`; `turnTimerController.ensureDeadline` adds + consumes it. Plugin accumulates the delta. Tests in `turnTimerController.test.js` + `plugins.test.js`.
- [x] Online: `onlineGameSession.rawCommitCurrentState` adds `state.turnTimerBonusMs` to the next player's deadline (read once before the txn callback, cleared after the commit resolves → idempotent across retries). Test in `onlineGameSession.test.js` (mockFirebase). No rule change (no upper bound on `turnDeadlineMs`).

## B11 retune + new B14 mini-game — June 2026

- [x] B11 מילה נסתרת: timer 20s→10s, reward 100→30 (defs, data, gender/desc, guide, capture spec, tests).
- [x] New B14 **אות פותחת** (letter spinner): spin alphabet → stop on a letter → make words starting with it in 20s, scored by length like כוורת (reuses `wordPoints`). New `letterSpinnerMiniGame.js` + 9 tests; wired into `BONUS_TYPES`/defs/main.js/intro/gender; CSS `.lsbox`; guide figure + `letterspinner.png`.
- [ ] (pre-existing, unrelated) `src/game/core/gameEngine.test.js` has 2 failing CONFIRM_MOVE rack/dictionary fixture tests (`placed-not-in-rack`) — not in the `test:unit` gate; fix the rack setup when touching that area.

## B11 bonus redesign — June 2026

- [x] Replace תפזורת (word search) with **מילה נסתרת** (hidden word): 4×4 grid, one hidden 3-letter dictionary word, 20s timer; selections validated against the dictionary (not the hidden word) so any real word wins. New `hiddenWordMiniGame.js` + tests; removed `wordSearchMiniGame.js`; rewired B11 (`b11_hidden_word`), intro/gender copy, CSS, docs.
- [x] Regenerate the guide screenshot `images/guide/minigames/hiddenword.png` (e2e `hiddenword` shot); guide figure now points at it. Also fixed `showBonusOverlay` to hide the `#app-loading` splash that was clipping mini-game captures. Old `wordsearch.png` is now unreferenced (can be deleted).

## Bot difficulty distinguishability — June 2026

- [x] Make easy/medium/hard clearly distinct — `DIFFICULTY_PROFILES` + `pickMove` in `botSearch.js`; easy is now beginner-level (short words, low picks, weak opener, score ceiling, blunder chance). `main.js` vocab cap 5000→2000 for easy + per-level think time. Calibrated easy≈8 / med≈30 / hard≈34. Tunable constants flagged in GAP_REPORT.

## QA bug-fix batch — June 2026 (`Some-bugs-found` branch)

- [x] Async friend invite shows a toast instead of the waiting-room hourglass (`main.js` `CR_INTENT.CONFIRM`).
- [x] Settings overlay top-corner "×" close button (`#sett-close-x`).
- [x] Friend-detail avatar resolves id → emoji (no literal "crown") (`friendsScreen.js`) + test.
- [x] Cold-start push routing: `?resume=`/`?summary=`/`?open=` handled at boot (`main.js` `handleLaunchParams`).
- [x] "סיום" ends an async game (resign) — `gameFlowController.js`; home button stays leave-and-resume.
- [x] Coin toss only at game start — `startOnlineGameViaSpine` skips it once a room has moves.
- [x] My-Games screen live-updates on an opponent move — `main.js` watches each listed async room (`watchRoom`) while `#smygames` is open, tears down on navigate-away. Previously the card only refreshed on (re)open because the async index doesn't change on a move.
- [x] Game-over push is informative — names the winner from each player's perspective + final score (`notificationService` + `pushPayloadBuilder`, client + worker). Needs `cd worker && npm run deploy`.
- [x] Matchmaking 3-player race no longer double-books a partner — `tryPair` single-driver (lower uid) claims both queue nodes. See `DECISIONS.md` D-matchmaking-claim. ⚠️ Re-run the simulator matchmaking scenario (`npm run sim -- --scenario matchmaking`) against the emulator before relying on it under heavy concurrency.
- [x] "×2 boost triples score": **could not reproduce** — engine verified ×2/×4 correct, regression tests added (`gameEngine.test.js`). Confirmed by reporter as not an issue.
- [x] "Skipping a תפזורת still grants bonus points": **verified correct, no bug** — a 0-find skip commits only the base word score (resolveBonusActivation/resolveMiniGameResult/FINALIZE all award 0). Reporter confirmed the score came from the placed word, not the bonus. Regression test added (`engine-parity-highrisk.test.js`: "skipping an interactive mini-game … commits only the base word score").

---

## TODOs — Dictionary v2 rollout

The runtime swap + build-pipeline scaffolding landed in June 2026 (see CHANGELOG). What's left before flipping the default and removing the v1 path:

- [ ] **Run the build pipeline end-to-end.** Needs WSL/Linux for HSpell (perl + autotools). Steps: `bash 01-fetch-hspell.sh` → `node 02-enumerate.js` → `03a-extract-lemmas.js` → `03b-corroborate-lemmas.js` → `03c-filter-lemmas.js` → `03d-inflect.js`. Produces `output/lemmas-review.tsv` for the next step.
- [ ] **Acquire corroboration sources.** Hebrew Wiktionary lemma dump and Hebrew Wikipedia frequency list. Currently the pipeline runs without them (single-source HSpell) — every lemma falls to the review queue. With Wiktionary alone, expect ~70% of lemmas to auto-accept.
- [ ] **Native-speaker review of `pending-review.csv`.** Budget: 20–40 hours for the initial pass. Decisions go into `tools/dictionary-build/review/manual-decisions.tsv` and persist across rebuilds.
- [ ] **Seed `tools/dictionary-build/config/gold-positive.txt` from real player-rejection logs.** Every "this word should have been valid" complaint becomes a held-out test the build can't regress.
- [ ] **Legal sign-off on HSpell GPLv2.** See [tools/dictionary-build/LICENSE.md](../tools/dictionary-build/LICENSE.md) — if the project can't accept GPLv2 implications, switch to Hunspell `he_IL` or commission a permissive list.
- [ ] **Canary the `?dict=v2` flag.** Open the app with `?dict=v2` and exercise the formerly-rejected-real-words list. Watch the console for `[isValidV2]` logs.
- [ ] **Flip default.** Change `dictionaryModeFromUrl()` in `main.js` to default `'v2'`. Keep `?dict=v1` as a rollback switch for one release.
- [ ] **Cleanup commit (separate PR):** delete `data/dictionary.base.txt`, the v1 morphology chain in `hebrewDictionary.js` (`candidateLemmas`, `spellingVariants`, `POSSESSIVE_SUFFIXES`, `VERB_SUFFIXES`, `looksLikePrefixedParticle`, `looksLikePossessive`, `analyze`'s lemma branch), the v1 loader, and the mode switch. Update tests accordingly.

---

## TODOs — Online Simulator (Phase 5)

- [ ] Deferred-score split-write scenario: dispose the active session AFTER `MOVE_CONFIRMED(scoringDeferred=true)` but BEFORE `FINALIZE_BOOST_AWARD`. Verify the room state stays consistent (no half-committed move), the opponent's view isn't corrupted, and the reconnected session correctly sees the move as never-committed. Needs bonus-square placement to be driven deterministically (bonuses sit at off-grid edges; random bot rarely hits them) — either inject a scripted-move bot or seed the engine state with `state.pendingScoreCommit` directly.
- [ ] Admin-SDK exporter that pulls `moveHistory` arrays from prod rooms into the JSON shape `replayBot` expects, for `--replay` mode (needs prod creds).
- [ ] Presence/heartbeat stress: multiple concurrent `presenceService` writes from the same uid (multi-tab), verify `onDisconnect` cleanup doesn't fight presence heartbeat.

---

## Completed (June 2026)

- ✅ **ROOT CAUSE** of push not working: service worker never registered. `sw.js` precached with atomic `cache.addAll()` while the `ASSETS` list still referenced 3 deleted admin partials → every `install` 404'd → `SW registrations: 0` → no push token, no offline cache. Removed dead entries and switched to per-asset `cache.add().catch()` so a stale list entry degrades gracefully instead of killing the whole SW. Also added independent `sw.js` registration in `main.js` (app previously relied on OneSignal.init to register it).
- ⚠️ Follow-up: `sw.js` `ASSETS` list is hand-maintained and drifts when partials are added/removed; `scripts/stamp-build.js` only stamps the cache name. Consider generating the precache list from `screenPartialManifest.js` + a glob so it can't go stale again.
- ✅ Removed the temporary 🩺 "אבחון התראות" diagnostic panel (settings.html + `diagnoseNotifications` in main.js + `getLastBootError` in notificationService.js) now that push works end-to-end. Kept `isOneSignalReady()` — the duplicate-notification fix depends on it.
- ✅ Invite notifications now distinguish live (⚡ "למשחק עכשיו") vs async (📩 "למשחק תורות") via an `isLive` ctx flag through both payload-builder copies.
- ✅ Notification "הפעל" button no longer gets stuck on its spinner — `requestNotifPermission()` (`src/main.js`) now pre-checks push support (shows "לא נתמך בדפדפן זה" in unsupported/in-app webviews), wraps `boot()`/`optIn()` in timeouts, and always re-syncs the button state in a `finally`, so a hung OneSignal SDK leaves the control retryable instead of permanently disabled.
- ✅ Live-invite waiting room now closes on rejection (friend auto-invite path) — fixed an ordering bug in `CR_INTENT.CONFIRM` (`src/main.js`) where `activePending.inviteId` was assigned before `activePending` existed, so the invite-ack listener couldn't match a rejection to the open waiting room. Now captured into locals and folded into `activePending` at construction; also repairs WR-cancel invite revocation for the same path.
- ✅ Welcoming home-screen onboarding popup — the first-visit popup on `#sh` now opens with a short intro on what Boost is, four feature bullets (שבץ-נא, בוסטים/mini-games, statistics & insights, game modes), and a closing note pointing to the `?` button for full rules. Added optional `intro` / `note` fields to the onboarding content model (rendered by `onboardingController.js` into new `#onb-intro` / `#onb-note` elements; both `hidden` when omitted, so other screens are unaffected). See `partials/screens/onboarding-overlay.html`, `src/ui/controllers/onboardingController.js`, `src/ui/screens/menuScreen.js`, `styles.css`.
- ✅ Bot boost visibility — the human player now sees a modal overlay when the bot receives an auto-boost (B2/B4/B9) or a future-effect boost (B5/B6/B7), matching the 2P offline experience. Overlay is labelled "הבוט". Clicking אישור finalises the award. Mini-game and wheel bot bonuses (B1/B3/B8/B10/B11/B12/B13) are still auto-resolved silently — that's a separate follow-up.

- ✅ Stats "תובנות" tab — turned the stats area into a personalised analytics experience (archetype, dynamic insight cards, trend chips, week snapshot, word intelligence, play-style bars, opponent picks, milestones, did-you-know). Tabs reordered to `תובנות | התקדמות | שיאים | יריבים`. All derivation in pure module `src/game/account/playerInsights.js` with 23 unit tests; no schema changes. See CHANGELOG entry for "Stats screen: new תובנות tab" for the full breakdown of what's derived vs deferred (rating history, dated words, monthly windows still need new tracking infra).
- ✅ "המשחקים שלי" v3 — visual redesign: cards instead of a list (rounded 18px, navy gradient + soft shadow), score-dominant typography (gold mine + white theirs in a glowing pill), emoji-prefixed status pills (🟢/🕒/💾/🔵), compact gold-gradient Continue button, 🗑 dismiss icon (replaces the floating ×), header back-arrow + count badge (replaces the big footer button). All scoped to `#smygames` CSS; no functionality changes. Screenshot at `images/guide/my-games-screen.png`, capture spec at `tests/e2e/capture-my-games-screen.spec.js`.
- ✅ "המשחקים שלי" v2 — removed the floating "המשך משחק" home-screen play button; folded the localStorage-saved offline game into the same list (rendered with a 💾 badge + "משחק שמור" label, sentinel `roomId: '__local__'`, MG_INTENT.RESUME/DISMISS branch on the sentinel to call `resumeLocalGameViaSpine` / `clearLocalGame`); widened the modal to `min(460px, 94vw)`. See `partials/screens/home.html`, `partials/screens/async-games-screen.html`, `src/main.js refreshMyGamesList`, `src/ui/screens/asyncGamesScreen.js`.
- ✅ New "המשחקים שלי" screen — standalone list of all of the user's async online games, reachable from the home screen's bottom nav. Each row shows opponent avatar + name, current score, whose turn + time since last move, "המשך" to resume, "×" to remove from the per-user index. Expired games are surfaced too (sorted to the end) so users can see + clear them. Extended `asyncSessionService.listAsyncSessions(db, uid, { includeExpired })` and added `myScore` / `opponentScore` / `isExpired` to the summary shape. See `partials/screens/async-games-screen.html`, `src/ui/screens/asyncGamesScreen.js`, `src/main.js`.
- ✅ Async push bug fix — `TURN_CHANGED` push was fired from the recipient's side (`externalIds: [s.myUid]` when `currentTurnSlot === mySlot`), so async opponents who weren't online when the move synced never got notified. Flipped the async path to sender-side: when our move leaves our slot, push the opponent (`externalIds: [opponentUid]`, optional `subscriptionIds: [opponentSubscriptionId]`) with the body labelled by `myName`. Live mode (`ifBackgrounded`) keeps the existing receiver-side self-push. Sessions now expose `myName` via `sessionRef`. See `notificationService.js`, `main.js`.
- ✅ UI bug fix — clicking a pending lock now reliably returns it to the bucket. Previously, the single-click toggle inside `setPendingLock` cleared the lock, but a fast double-tap fell through to the auto-quick-place branch and re-placed the lock at the same cell, so the user saw no change. Added an explicit early-return for pending-lock cells in `onCellClick` + a short (500 ms) per-cell suppression window for the quick-place branch. See `gameScreen.js`.
- ✅ Engine bug fix — `handleConfirmMove` rack-defense incorrectly rejected `placed-not-in-rack` when a player reused a swap-displaced board letter in the same move. The UI was already designed to surface the displaced letter at the swap's rack slot for same-turn play (legacy `racks[turn][rackSlot] = returnedLetter` parity), so the engine was out of sync. Split the single-pass rack check into a swap-first pass that credits the rack copy with each swap-displaced letter, then validates `placed` against that effective rack. New regression test in [tests/unit/engine-placed-not-in-rack.test.js](../tests/unit/engine-placed-not-in-rack.test.js).
- ✅ Boost mini-game screenshots in the guide — six new PNGs under `images/guide/minigames/` captured by a new Playwright spec ([tests/e2e/capture-minigame-screenshots.spec.js](../tests/e2e/capture-minigame-screenshots.spec.js)) that mounts each mini-game with a seeded RNG and snaps the overlay. Each image embedded under "בונוסים ומיני-משחקים" with a matching caption. Side fix: exposed the previously-internal `mountFillMiddleMiniGame` on `window.__spine.ui`.
- ✅ Cherry-pick from `online-game-fixes` — surgical port of additive fixes that never reached `main`: guide-screen screenshots + the new "פעולות מיוחדות בתור" section, signup password-confirm + notify opt-in + 👁 show/hide on login+signup, friends `activeRoom` permission fix, easy-bot vocabulary cap (first 7000 dict entries), dict CLOSE_QUERY event, `btn-shailta` id, friends recent-games LTR layout. Explicitly skipped the rollback half of that commit (would have wiped portrait lock, rotate-block, connectivity indicator, gender propagation, back-button handler). The ם/מ sofit fix the user remembered turned out to already be on the current branch via PRs #276/277/278 + `f64be250`. See `docs-md/CHANGELOG.md` for the full file-level breakdown.
- ✅ Portrait-orientation enforcement — installed PWA already locked via `manifest.json`. For in-browser use, added `screen.orientation.lock('portrait')` in [src/main.js](../src/main.js) (works in fullscreen/PWA contexts, no-ops in plain tabs) plus a CSS landscape-block overlay (`#rotate-block`) that covers phone-shaped viewports in landscape (`@media (orientation: landscape) and (max-height: 500px)`). Tablets/desktops in landscape stay interactive since the layout caps at 480px and centers.
- ✅ Layout unification — collapsed the game screen's two CSS layouts (info-strip ≤500px vs. side-panels >500px) into one phone-shaped layout that applies at every viewport. `.gr` capped at `max-width:480px`, `.left-panel`/`.right-panel` always `display:none`, `.info-strip` always shown. Removed the `@media(min-width:600px)` and `@media(min-width:900px)` width-scaling blocks for the game/home/setup/overlay containers. Real phones already rendered the info-strip layout (≤414 CSS-px in portrait); the desktop branch was dev-tool-only and looked unrelated to the actual product. See `docs-md/CHANGELOG.md` for the full file-level breakdown.
- ✅ Firebase emulator wired for browser playtesting — restored `?emu=1` flag in `firebaseClient.js` (calls `db.useEmulator` + `auth.useEmulator`), added auth/hosting/UI ports to `firebase.json`, added `npm run emu` script. Open `http://localhost:5000/?emu=1` in two browser profiles to play offline-vs-offline against the local DB without touching prod.
- ✅ Bug #2 real root cause — `presenceService` now restores `connected:true` on every WebSocket reconnect (`.info/connected` watcher) AND every heartbeat tick. Without this, a single transient WebSocket drop (auth-refresh blip, mobile network switch, etc.) caused the server's `onDisconnect` handler to write `connected:false`, after which the heartbeat kept updating only `lastSeen` — so `/presence/{uid}.connected` stayed false for the rest of the session and the opponent's `disconnectController` correctly read it as offline, firing the disconnect overlay. The earlier "strict continuous-offline semantics" fix in `disconnectController` is still correct as a separate guard against real flickers; together they cover both classes of bug #2.
- ✅ Phase 5 — fixed both prod bugs the user reported: (1) ghost-move-after-failed-commit in `onlineGameSession` (added `forceResync()` on every SYNC_REJECTED + try/catch around `commitTransaction` so permission_denied becomes `{committed:false}` instead of bubbling); (2) false-positive disconnect overlay in `disconnectController` (strict continuous-offline semantics — reset `totalDisconnectedMs` on every online transition that happens before the overlay opens). Headless full-stack E2E scenario reproduces both bugs deterministically and the fixes make all 5 sub-scenarios pass.
- ✅ Live connectivity indicator — wifi icon in the game top bar that goes red+blinking when the local Firebase WebSocket drops. New `connectivityService` subscribes to `.info/connected`; new `connectivityIndicator` controller toggles classes on `#net-status` in the game partial; only visible during online games.
- ✅ Online game simulator (Phase 4) — Adds `--scenario reconnect` covering reconnect-during-opponent-turn, reconnect-on-own-turn, and no-ghost-events-after-dispose. Verifies version-cursor anchoring, cache pre-warm on the new session, and watcher teardown via `dispose()`. 45 sub-scenario runs at scale: 0 crashes. No new engine bugs found this round — the session reconnect machinery holds up under stress.
- ✅ Watchdog forfeit production bug closed — relaxed `/rooms/$roomId` rule's opponent-watchdog branch to permit `turnDeadlineMs=0` when `status=abandoned`, so two consecutive missed turns can now actually transition the room to terminal. Two new emulator tests in `tests/emulator/timer-rules.test.mjs` cover both the positive case and the safety check (opponent cannot zero the deadline without flipping status). The simulator's `runForfeitAfterTwo` scenario is now re-enabled and passes.
- ✅ `handleConfirmMove` occupied-cell defense — rejects `CONFIRM_MOVE` whose placed tiles overlap an already-committed board cell. Without this check, `setCommittedTile` silently overwrote the existing tile (vanishing it), breaking bag-parity. Placed in `handleConfirmMove` (not `validateMove`) because the swap path correctly expects target cells to be occupied. Surfaced by the fuzz bot.
- ✅ `applyExchange` atomicity — pre-validates all letters against a rack copy before mutating, so a mixed-valid-and-bogus exchange (e.g. one letter not in rack) no longer leaves tiles partially removed. Same family as the Phase 3 `handleConfirmMove` fix but in the exchange path. Surfaced by fuzz sweep after the watchdog rule fix landed.
- ✅ Online game simulator (Phase 3) — Adds `--scenario watchdog` mode covering single-timeout, liveBonus gate, and double-claim race using injected clock (`timeoutWatchdog`'s `now`/`setIntervalFn` seams). Two more engine fixes shipped from simulator findings: `handleConfirmMove` now rejects placements whose letters aren't in the rack (closes the bag-parity gap surfaced by `--bot fuzz`); `timeoutWatchdog.applyPatchToRoom` defaults `activeBoosts` to `[]` instead of `undefined` (Firebase rejects undefined).
- ✅ Online game simulator (Phase 2) — Adds `--bot fuzz` adversarial bot and `--scenario matchmaking` concurrent-claim race scenario on top of Phase 1. CLI: `--bot random|fuzz`, `--fuzz-rate F`, `--scenario normal|matchmaking`, `--mm-players N`, `--mm-batches N`. The fuzz mode surfaced a real engine-defense gap (see Phase 3 TODO). See `docs-md/CHANGELOG.md` for the entry.
- ✅ passCount sync between online clients — fixed two real engine bugs caught by the simulator: (1) `onlineGameSession.commitCurrentState` now persists `_passCount` to the room and the watcher resync copies it back, so the global "4 consecutive scoreless turns" game-over rule actually works across clients; (2) `handleExchange` now calls `isGameOver()` after `passCount` bump, mirroring `handlePass` / `handleConfirmMove` (without this, four consecutive exchanges did not end the game).
- ✅ Online game simulator (Phase 1) — New `npm run sim` tool spins up the local Firebase emulator, runs N concurrent online games using random-move Hebrew bots, and writes structured crash reports for invariant violations, engine throws, transaction livelocks, or hangs. Lives under `scripts/simulator/`; no production code touched. See `docs-md/CHANGELOG.md` for the entry and `scripts/simulator/runSimulator.mjs --help` for flags.
- ✅ Gender address toggle Phase 2 — All Hebrew imperative strings (game controls, mini-game instructions, overlay buttons, friends/share text) now render in the correct gender form. Central utility `src/ui/genderText.js` with `g()`, `applyGenderToRoot()`. Live updates via `SETTINGS_CHANGED` bus event propagate to all mounted screens in one call.
- ✅ Gender address toggle Phase 1 — "באיזה לשון לפנות אליך?" (זכר/נקבה) added to settings screen. Stored in `uiPreferences` (localStorage only, never pushed to Firebase). The reminder push notification body (`"אתה לא משחק"` / `"את לא משחקת"`) now uses the correct gender form. Infrastructure in place (`VALUE_SELECTS` in `settingsScreen.js`).

---

## Completed (May 2026)

- ✅ Game summary UI fixes — ELO delta inconsistency fixed (both clients now read pre-game ratings from `globalRatings` for both players); "ללא הודעות" settings panel removed; rectangular gold resume button replaced with round circle button in the home screen secondary row; `נאצי` added to `EXACT_REJECTS`.


- ✅ Pre-launch polish — tutorial intro refreshed (drop ערעור, add bonus-square mention) + new scripted player step that lands 'י' on the row-5 right-edge bonus to demo bonus activation; `#lcd "מהלכים"` move counter removed from game.html + gameScreen.js; privacy policy rewritten for auth/push/friends/ratings/in-game messages; new "ללא הודעות" setting (local-only, gated in reactionController to hide button + ignore incoming bubbles); end-game screen now shows Elo new-rating + signed delta per player via `RATING_EVT.CHANGED`.

- ✅ Scoreless-turn game-over rule unified — threshold 6→4, exchanges and illegal-word forfeits now count toward `passCount`, and a leading player can fire `CMD.CLAIM_STALL_END` (new "🏆 סיים וזכה" topbar button) once `passCount >= 2` to close out a stalled lost-game-drag-out scenario. Pre-launch change, no migration.

- ✅ In-app help dropdown with Tutorial / Guide / FAQ — top-bar `?` now opens an anchored dropdown; "מדריך" opens a 6-section accordion guide (rules, inflections, screens, modes, ratings, bonuses); "שאלות נפוצות" opens a ~12-item Q&A overlay. Existing tutorial flow preserved (dropdown re-emits `OPEN_TUTORIAL`).

- ✅ Online end-game suite — ELO `permission_denied` fixed by per-client write model (each side writes only its own profile + leaderboard entry; opponent's rating read from publicly-readable `globalRatings`); ELO now skipped for 0-move games; `currentUserProfile` undefined-global ReferenceError fixed in avatar-unlock overlay; matchmaking/friend-invite avatar field corrected (`profile.avatar` → `profile.equippedAvatar`) so opponents render with their actual emoji instead of the 👑 default.

- ✅ Matchmaking pair-claim race fix — `tryPair` now claims the queue pair via a single RTDB transaction on `/matchmakingQueue/{mode}` instead of multi-path update + verify. Eliminates the bug where two simultaneous matchmakers each created their own room and the coin-toss showed each player as the starting one.

- ✅ In-game reaction system — child-safe emoji + Hebrew preset message reactions for online games. Reaction panel opens from player card, sends to Firebase `liveReaction` field, shows animated speech bubbles. 5-second cooldown, local mute toggle. No free-text, no gameplay impact.

- ✅ Offline save/resume for 2P + vs-Bot — `pause → שמור וצא לתפריט` and back-button `השהה ושמור` now persist the full engine state to localStorage via `localSaveService`; home `המשך משחק` falls back to the local save when no online async session exists. Cleared on game completion.
- ✅ Notifications bell inbox — bell badge shows live count of pending game invites + friend requests; clicking opens `#snotif` inbox with accept/reject per item.
- ✅ Waiting room async/live invite behavior — async direct invite closes waiting overlay after 1.5 s; live direct invite shows 5-min countdown, cancels pending room + invite on Firebase on expiry.
- ✅ Notification banner + invite UX — blocking invite popups replaced with slide-down banner from topbar; banner suppressed on app open; cancel in waiting room cancels live invite too.
- ✅ Reject-name fix — banner now shows real player display name (not "שחקן") when rejecting an invite.
- ✅ Speed presets — "זמן מוגבל למהלך" removed from settings; 3 presets (בזק/רגיל/איטי) added to setup, create-room, and matchmaking screens.
- ✅ Favorite move-speed statistic — moveSpeedStats tracked per game; displayed in Records tab.

- ✅ Electric Floating Platforms main menu redesign — `menu-electric.css` + updated `home.html`, `menuScreen.js`, `main.js`
- ✅ Electric Floating Platforms Phase 2 visual polish — premium platform architecture, double-path SVG lightning, atmospheric background, animations
- ✅ Electric Floating Platforms Stage 3 depth pass — floating illusion via offset shadow, curved organic lightning, particle field, compressed layout, blue ELO badge, enlarged online icon
- ✅ Electric Floating Platforms Stage 4 gap-report pass — viewport-fit=cover, near-black background, 3D slab bottom face, icon depth with specular highlight, logo glow, nav 28px icons + active pill, lightning pulse + particle drift animations
- ✅ Stats screen simplification — cut ~10 low-value stats, collapsed 5 tabs to 3 (תקדמות / שיאים / יריבים ובוסטים). UI-only; storage unchanged.

---

## Stats screen — follow-up opportunities

Surfaced during the May 2026 stats simplification audit. Each is a UI-visible add that requires backing data work.

- [ ] **Bingo count** — biggest gap. Tally `BINGO_BONUS` triggers per game and surface in Records tab.
- [ ] **Highest single-word score** — derive from move history, store on profile, surface in Records.
- [x] **Unique words discovered (vocabulary size / מילון מהלך)** — `uniqueWordsCount` is now tracked in `computeLiveGameStatsDelta` as a numeric increment of new words per game (June 2026).
- [ ] **Win rate by first/second to move** — already trackable from move metadata.
- [ ] **Hour-of-day stats / power hour** — extend the existing `weekdayStats` model.
- [~] **Earned titles** ("Comeback King", "Bingo Hunter", etc.) — named achievements with Hebrew titles now exist in `ACHIEVEMENTS` table (`avatarScreens.js`). The stat-based conditions are wired; purely narrative titles (Comeback King etc.) require additional stats (comeback tracking, bingo count) not yet collected. See TASKS.md bingo-count and highest-single-word items above.
- [x] **חבר של כולם (friendsCount)** — synced from Firebase friends list via `activeFriendsWatch` (June 2026).
- [x] **האחד (beatNumberOne)** — tracked at game end when result=win, opponent was pre-game #1, and ≥1000 total players (June 2026).
- [ ] **Move timing** — `totalMoveTimeMs` is hardcoded to 0 in `profileService.js:251`. Either wire it up (per-move timestamps in the event stream) or remove the field entirely.
- [ ] **Storage cleanup** — once the new layout settles, remove orphan fields (`boostImpactWins`, `totalMoveTimeMs`, etc.) from `EMPTY_STATS` and add a one-time cleanup migration.

---

## Active Cutover Checklist (from `SPINE_TODO.md`)

The `SPINE_TODO.md` file is the authoritative tracking document for the legacy→spine migration. Key outstanding areas as of documentation date:

### High Priority (Cutover Blockers)

- [ ] Verify all B1–B13 bonus mini-game branches work end-to-end in live game
- [ ] Verify deferred scoring (two-phase commit) works correctly in online mode under latency
- [ ] Verify multiplier forfeiture on timeout/resign (boost effect cleanup)
- [ ] Disconnect/leave flow Phase 1B+ (Phase 1A complete per recent commits)
- [ ] UI state reset/preservation between game start and end (screen cleanup)
- [ ] Tutorial flow full verification with scripted bot
- [ ] Dictionary admin flow (approval/rejection UI + validation)

### Medium Priority

- [ ] Profile/stats/avatar progression parity with legacy
- [ ] Champion leaderboard display correctness (`RATINGS_LIMIT = 10`)
- [ ] `settingsCompat.js` migration from very old localStorage formats
- [ ] Music/sound scheduling behavior characterization
- [ ] Mobile layout verification on small screens (320px width)
- [ ] Menu transition animation parity
- [ ] Appeal/dictionary challenge flow (`appealsMax` setting)

### Low Priority (Cleanup)

- [ ] Remove legacy `onclick` attributes from all remaining partials
- [ ] Remove legacy global functions from `index.html` once spine covers all paths
- [ ] Add `src/testing/` tests to main test runner (currently separate)
- [ ] Document `botSearch.js` algorithm

---

## Security Tasks

### Critical
- [ ] **Move OneSignal REST key server-side** — The `onesignalKey` is currently used from the browser. Move push sending to a Cloud Function or edge worker to prevent key exposure.

### Medium
- [ ] Verify admin custom claim flow end-to-end (claim set → token refresh → admin UI unlocks)
- [ ] Audit who can trigger `asyncReminderService.sweepForUser()` — currently any authenticated client can call it for any `uid`

---

## Missing Tests to Write

Based on GAP_REPORT.md findings:

1. **`botSearch.js` unit tests** — Verify bot produces valid Hebrew words, legal placements
2. **B8 crossword mini-game** — End-to-end test with mock mini-game completion
3. **B11 word search** — Result resolution and score commit
4. **B13 wheel all outcomes** — One test per wheel outcome (8 outcomes)
5. **Multiplier forfeiture** — Test that `multiply_next_turns` is removed on timeout
6. **`asyncReminderService.sweepForUser()`** — Full sweep execution test (not just `classify()`)
7. **Double-sweep idempotency** — Two sweeps in the same window should not double-notify
8. **`settingsCompat.js` migration** — From V0 → V1 → spine format
9. **Dictionary approved words → validation** — Prove approved Firebase words are used in `isValid()`
10. **Watchdog transaction failure** — Simulate `committed: false` and verify retry/fallback
11. **`EXACT_REJECTS` completeness** — Verify all ~220 entries are genuinely invalid words
12. **Friend request lifecycle** — `friendsService.js` send → accept → appear in friends list

---

## Architecture Recommendations

### Near-Term

1. **Consolidate timing constants** — `animationController.js` and `gameScreen.js` both define identical timing constants. Extract to a shared `animationConstants.js` file.

2. **Add Cloud Function for push** — Move `onesignalKey` usage to a server-side function. OneSignal supports Cloud Functions as a backend.

3. **Add explicit watchdog retry** — `timeoutWatchdog.js` should log and handle `committed: false` returns explicitly, even if it just means "do nothing and wait for next poll."

4. **`isValid()` cache warm-up** — `hebrewDictionary.loadDict()` is async. Any call to `isValid()` before the dict is ready falls back to `analyze()`. Consider a "dict ready" event on the bus so UI can gate validation properly.

### Long-Term

1. **Cloud Function for reminders** — Move `asyncReminderService` to a Cloud Function triggered on Firebase write. This ensures reminders fire even when no player has the app open.

2. **Bundler / Code Splitting** — As the codebase grows past 50 modules, consider a minimal bundler pass for production to reduce HTTP round trips for module loading.

3. **Visual Regression Tests** — Add Playwright screenshot comparison tests for the game board to catch CSS regressions.

---

## From Existing FIXME/TODO Comments

No explicit TODO/FIXME comments were found in the source files analyzed. The `SPINE_TODO.md` file serves as the project's official TODO list.

---

## Recently Fixed (from git log)

Based on recent commits (last 30 visible):

- Disconnect/leave Phase 1A: accumulating disconnect timer, app-close resign behavior ✅
- Opponent disconnect/quit notifications: three bugs fixed ✅
- Matchmaking pairing bug (null queue snapshot) ✅
- Friend invite dropdown: module-level var scoping ✅
- Live invite to mid-game recipient: blocked + push notification ✅
- Rack visual lockout and timer/glow sync on opponent move ✅
- Tab-close detection when Firebase WebSocket unavailable ✅
- Chrome-extension URL guard in `sw.js` ✅
