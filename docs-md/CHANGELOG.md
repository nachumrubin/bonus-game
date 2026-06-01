# CHANGELOG.md — Change History

---

## Guide screenshots — June 2026

The in-app מדריך is text-only; new players have to map verbal descriptions ("the lock inventory in the right panel") onto the actual UI. Added inline screenshots to anchor each section to what it describes.

- **Capture spec** ([tests/e2e/capture-guide-screenshots.spec.js](../tests/e2e/capture-guide-screenshots.spec.js)) — Playwright spec that boots the spine, drives it through 6 canonical states (home, mid-game board, exchange overlay, שאילתה overlay, signup screen, stats screen) at a 412×820 viewport, and writes PNGs to `images/guide/`. Single worker so screens that share `localStorage` (settings, profile) don't race. The bootSpine wait condition was updated from the old `#sh .hbtns` selector to `#sh .em-circle-btn` to match the current home layout.
- **NPM script** — `npm run guide:screenshots` re-runs the capture (refresh after UI changes).
- **Guide HTML** ([partials/screens/guide-screen.html](../partials/screens/guide-screen.html)) — `<figure class="guide-shot">` blocks added under the rules, screens, and a new "פעולות מיוחדות בתור" section that covers exchange + שאילתה + lock + joker mechanics.
- **CSS** ([styles.css](../styles.css)) — `.guide-shot { max-width: 220px; ... } .guide-shot img { border-radius: 8px; border: 1px solid rgba(255,255,255,.18); box-shadow: 0 4px 14px rgba(0,0,0,.45); }` plus a small dim caption. The 220px cap keeps screenshots aligned with the body text instead of dominating the overlay.

---

## Pending lock + easy-bot vocab cap — June 2026

Two unrelated changes:

1. **Lock placement is now staged, not immediately committed** ([gameController.js](../src/ui/controllers/gameController.js), [gameScreen.js](../src/ui/screens/gameScreen.js), [styles.css](../styles.css)) — previously, clicking a cell to place a lock dispatched `CMD.PLACE_LOCK` directly, which atomically consumed the inventory item and advanced the turn. The player had no way to change their mind. The UI now stages the lock as `view.pendingLock = { r, c, duration }` (analogous to `view.placed` for tiles). The engine's `CMD.PLACE_LOCK` only fires when the player presses שבץ via `confirmMove()`. Cancellation paths: tap the same cell again → `recallLock()`; press בטל → `recallAll()` clears it; `TURN_CHANGED` from any external source → cleared. Pending locks and pending tiles are mutually exclusive in the UI (a turn can hold one OR the other, since both are turn-consuming) — `placeTile` rejects with `'pending-lock-active'` if a lock is staged, and `setPendingLock` rejects with `'pending-tiles-active'` if tiles are placed. `renderBoard` shows the staged lock with the same lock icon plus `.pending-lock` (60% opacity + dashed gold outline) so the visual reads "I'm here but not committed yet".
   - 6 new tests in [gameController.test.js](../src/ui/controllers/gameController.test.js) cover staging, recall, recallAll-includes-lock, confirmMove-with-lock, and both mutual-exclusion rejections. The existing direct `placeLock()` method is preserved for the engine-level test path that calls it.

2. **EASY bot uses a 7000-word vocabulary** ([main.js](../src/main.js)) — the dictionary file ([data/dictionary.base.txt](../data/dictionary.base.txt)) is sorted by Hebrew word frequency (most common first — את, של, לא, על, …). The bot's word list previously took every entry in the 2–6 letter range regardless of difficulty, so EASY's only real difference from MEDIUM was move-selection randomness — not vocabulary. The bot now slices `fullList.slice(0, 7000)` when `difficulty === 0`, restricting EASY to the most common ~7000 short words. MEDIUM/HARD see the full ~40k vocabulary as before. This is what makes the difficulty levels actually feel different.

---

## Tutorial polish — query-close advance, smart tip positioning, joker copy — June 2026

Three follow-up fixes to the extended tutorial:

1. **שאילתה step advances on overlay close, not button click** ([dictionaryScreen.js](../src/ui/screens/dictionaryScreen.js), [tutorialController.js](../src/ui/controllers/tutorialController.js)) — the step was wired to `DICT_INTENT.OPEN_QUERY`, so the moment the player tapped the שאילתה button the tutorial advanced even before they'd actually looked up a word. Added a new `DICT_INTENT.CLOSE_QUERY` emitted when the overlay's סגר button is clicked, and the tutorial now listens for that instead. The player has to actually use the feature and dismiss the overlay before the tutorial moves on.

2. **Tip box no longer covers what it's pointing at** ([tutorialScreen.js](../src/ui/screens/tutorialScreen.js), [styles.css](../styles.css)) — `showTip` now picks a viewport anchor (`top-right`, `top-left`, `bottom-right`, `bottom-left`) based on the bounding rect of the first highlighted target: target on the top third of the viewport → tip anchored to the bottom; on the bottom third → tip anchored to the top; on either side → tip anchored to the opposite side. CSS adds `.tut-anchor-*` classes with explicit top/right/bottom/left offsets and a 250ms transition so the tip slides into place. The repositioning runs again on resize and on every scheduled paint (because rack tiles render late). A tip can still force a specific anchor via `position: 'bottom-center'`-style override on the payload.

3. **Joker tip uses "ג׳וקר 🃏" instead of literal `"?"`** ([tutorialController.js](../src/ui/controllers/tutorialController.js)) — the on-rack joker glyph in this build is a 🃏 sprite, not the character `?`. Label and body now say "ג׳וקר 🃏" / "אריח ג׳וקר 🃏" so the prompt matches what the player actually sees on their rack.

**Tests:** updated [tutorialController.test.js](../src/ui/controllers/tutorialController.test.js) to assert that `OPEN_QUERY` does NOT advance and `CLOSE_QUERY` does. 8/8 tutorial-controller, 2/2 tutorial-screen, 16/16 dictionary-screen, and 135/135 main unit suite all green.

---

## Tutorial — extended advanced demos (linear & enforced) — June 2026

The tutorial used to end right after the bonus-square demo (P1, B1, P2, B2 → home). Player asked for six additional features to be taught: שאילתה, pre-finalization recall (single-tap move, double-tap return, בטל), החלפת אות, lock placement, joker, and replacing one already-committed tile alongside a new placement.

**Architecture:**
- Split the tutorial state machine into two **phases** in [tutorialController.js](../src/ui/controllers/tutorialController.js): `'core'` (the existing four-step bonus demo) and `'extras'` (the new linear flow). When the core's `botMoves === 2` lands, the controller transitions to `'extras'` and walks through `EXTRA_STEP_ORDER = ['shailta', 'recall', 'exchange', 'lock', 'joker', 'tileSwap']`. Each step is enforced — it waits for its specific action and won't advance until either the action fires or the player taps "דלג על שלב זה".
- Each step has an auto-detection hook:
  - `shailta` → `DICT_INTENT.OPEN_QUERY` from [dictionaryScreen.js](../src/ui/screens/dictionaryScreen.js)
  - `recall` → `GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED` transitioning from ≥1 pending tile back to 0 (covers both בטל and per-tile double-tap)
  - `exchange` → `EV.TILES_EXCHANGED`
  - `lock` → `EV.LOCK_PLACED`
  - `joker` → `EV.MOVE_CONFIRMED` where `placed.some(p => p.isJoker)`
  - `tileSwap` → `EV.MOVE_CONFIRMED` where `swappedTiles.length > 0`
- The bot needs to hand control straight back during the extras phase since exchange/lock/joker/tile-swap all consume a turn. [tutorialSession.js](../src/game/sessions/tutorialSession.js) `attachScriptedTutorialBot` was modified so that once `nextMove >= moves.length`, the bot dispatches `CMD.PASS_TURN` instead of stalling. This keeps the player's turns coming.
- The joker step needs a `'?'` in the rack and the tile-swap step is easier with a few extra spare letters, so `seedTutorialRack` now also seeds `TUTORIAL_EXTRA_LETTERS = ['?', 'א', 'ב']`.

**UI:**
- New `TUTORIAL_INTENT.SKIP_STEP` ([tutorialScreen.js](../src/ui/screens/tutorialScreen.js)). Each extra tip carries `showSkip: true` so [tutorial-overlay-elements.html](../partials/screens/tutorial-overlay-elements.html) reveals the "דלג על שלב זה" link; tapping it advances `extraIdx` and emits the next tip.
- After every extra step, the final tip ("סיימת את ההדרכה — חוזרים לתפריט הראשי…") auto-closes after 3s and calls `showScreen('sh')` — same exit pattern as before.

**Tests** ([tutorialController.test.js](../src/ui/controllers/tutorialController.test.js)) — added five new cases covering: transition from core into extras, full skip-all-the-way-through exit path, OPEN_QUERY auto-advance, TILES_EXCHANGED auto-advance, and joker placement only advancing when `isJoker` is set. 8/8 tutorial-controller tests pass; 135/135 main unit suite remains green.

---

## Tutorial end-of-flow fix — May 2026

**Bug:** After the bot's second scripted move in the tutorial, the user was stuck on a half-played board with no further guidance.

**Root cause** ([tutorialController.js](../src/ui/controllers/tutorialController.js)) — when `playerMoves === 2` the controller emitted a tip claiming "סיימת את ההדרכה" with a 4-second auto-close, but [tutorialSession.js:35-38](../src/game/sessions/tutorialSession.js#L35-L38) actually queues two bot moves, so a final bot move (`ת` → "תו") fires ~700ms later. The "tutorial finished" message therefore played mid-tutorial, auto-closed, and then the player was returned to a normal game state with no exit path — the bot had no more scripted moves but the game wasn't over.

**Fix:**
- Renamed the `playerMoves === 2` tip key from `completion` → `celebrate`, dropped the "סיימת את ההדרכה" line, and trimmed the auto-close to 3000ms — it now just celebrates the bonus.
- Added a `botMoves === 2` branch that emits a new `exit` tip ("סיימת את ההדרכה — חוזרים לתפריט הראשי…") and schedules `showScreen('sh')` after 3000ms so the player is automatically returned to the home menu.
- The scheduled exit timer is tracked in `exitTimer` and cancelled by `resetState()` / `dispose()` so a user who manually backs out (`TUTORIAL_INTENT.BACK`/`SKIP`) doesn't get a stale auto-navigation later.
- Test [tutorialController.test.js](../src/ui/controllers/tutorialController.test.js) added: drives the full P1→B1→P2→B2 sequence and asserts the exit tip fires and `showScreen('sh')` runs after the auto-close window.

---

## Auth screens + friend overlay polish — May 2026

Four fixes:

1. **Friend-detail avatar shows the icon, not the raw id** ([friendsScreen.js](../src/ui/screens/friendsScreen.js)) — `displayFriendDetail` was setting `#fd-avatar.textContent = friend.avatar`, which renders the literal string `"crown"` when the profile stores the id rather than the emoji. The friends *list* already calls `resolveAvatar(...)` to map ids → emojis (`crown` → 👑, `diamond` → 💎, etc.). The detail overlay now uses the same helper.

2. **Password confirmation on signup** ([sign-up-screen.html](../partials/screens/sign-up-screen.html), [authScreens.js](../src/ui/screens/authScreens.js)) — Added `#su-pass-confirm` with autocomplete `new-password`. `validateSignupForm` accepts an optional `passwordConfirm` and returns reason `pass-mismatch` (`'הסיסמאות אינן תואמות'`) when supplied and not equal. The confirm check is gated on the argument being defined so test fixtures and any other callers that don't collect a confirm keep working.

3. **Show/hide password toggle on login + signup** ([log-in-screen.html](../partials/screens/log-in-screen.html), [sign-up-screen.html](../partials/screens/sign-up-screen.html), [styles.css](../styles.css), [authScreens.js](../src/ui/screens/authScreens.js)) — Each password input is wrapped in `.pw-wrap` with an absolutely-positioned `.pw-toggle` 👁/🙈 button. The toggle uses `data-pw-target="<input id>"` so a single delegated handler in `mountAuthScreens` covers all three fields (login pass + signup pass + signup confirm). Clicking flips `input.type` between `password` and `text`, updates the icon, and swaps the `aria-label` between "הצג סיסמה"/"הסתר סיסמה". `.pw-input` gets `padding-right:36px` so the typed text never disappears under the icon.

4. **Notification opt-in checkbox on signup** ([sign-up-screen.html](../partials/screens/sign-up-screen.html), [authScreens.js](../src/ui/screens/authScreens.js), [main.js](../src/main.js)) — Added `#su-notify` (checked by default). The validator carries `wantsNotifications` through the `SIGN_UP` payload (defaults to `true`). `bus.on(AUTH_INTENT.SIGN_UP)` stamps it onto the initial profile as `profile.wantsNotifications`. `bootCrossCuttingFor` reads `users/{uid}/profile/wantsNotifications` before calling `notificationService.boot/loginUser` — a stored `false` skips push setup entirely; missing/legacy values default to opted-in so existing accounts behave as before.

---

## Local emulator path for the running app — May 2026

The app could already be tested against the Firebase emulator from the `test:emulator` script, but **the running app itself** had no way to point at a local DB — every run hit production at `boost-8ef11`. Added a self-contained emulator path so manual testing no longer touches the live project.

- **Client wiring** ([firebaseClient.js](../src/game/online/firebaseClient.js)) — `configure()` now detects emulator mode from `APP_CONFIG.useEmulator` or a `?emu=1` URL flag. When set, `ensureApp()` calls `db.useEmulator('localhost', 9000)` and `auth.useEmulator('http://localhost:9099', { disableWarnings: true })` after init. Exposed `isUsingEmulator()` for callers that want to skip side-effectful integrations (push, analytics) in emulator mode.
- **Emulator config** ([firebase.json](../firebase.json)) — Added `auth` (9099), `hosting` (5000), and `ui` (4000) emulators alongside the existing `database` (9000).
- **NPM scripts** ([package.json](../package.json)) — `npm run emu` starts database+auth+hosting+UI emulators with `--import=.emulator-data --export-on-exit=.emulator-data` so seeded users and games persist across restarts. `npm run emu:fresh` is the no-persistence variant.
- **`.emulator-data/`** is gitignored.

**Usage:**

```
npm run emu                         # starts emulators (data persists in .emulator-data/)
# then in another shell:
npx http-server -p 8080 .           # or any static server, OR use the emulator's hosting at http://localhost:5000
# Open the app with ?emu=1
http://localhost:8080/index.html?emu=1
```

Emulator UI: <http://localhost:4000>. Auth emulator accepts any email/password (signup creates the user instantly with no verification).

---

## Friend-detail score order + resume button overflow — May 2026

Two small UI fixes:

1. **Friend recent-games row reads "mine : theirs ✓" with the user's score in gold** ([friendsScreen.js](../src/ui/screens/friendsScreen.js)) — `buildDetailRecentHtml` previously relied on a bold-white vs. 60%-white opacity contrast at 11px to mark the user's score, which is easy to misread (especially when the user's actual score is the smaller number, e.g. after a forfeit/timeout win). The row now locks `direction:ltr` so the visual order is deterministic ("mine : theirs ✓" left-to-right) and paints the user's score in the gold accent (`var(--by, #f5c518)`) — unambiguous regardless of which number happens to be higher.

2. **Friend-detail "Permission denied" when opening a friend's profile** ([main.js](../src/main.js)) — `FRIENDS_INTENT.OPEN_DETAIL` was reading both `users/${myUid}/activeRoom` and `users/${friendUid}/activeRoom` in parallel to find shared live games. The rules file pins `users/$uid/.read` to `$uid === auth.uid`, so the friend-side read always failed and the whole `Promise.all` rejected (logging `[spine] OPEN_DETAIL: active rooms fetch failed Error: Permission denied`). Rewrote to read only **my** `activeRoom`, then load the room (rooms are world-readable) and check whether the friend appears in `room.players`. Same end result, no cross-user reads.

3. **"המשך משחק" resume button no longer overflows the circle** ([menu-electric.css](../menu-electric.css)) — `.em-circle-title` is `white-space: nowrap`, and the resume circle is half the size of the secondary circles. At smaller viewports the 9-character title couldn't fit. Added `white-space: normal` and `line-height: 1.05` for `.em-circle-btn--resume .em-circle-title` so it can wrap to two lines, plus bumped its `.em-circle-text` `max-width` from the default 78% to 86%.

---

## Game summary UI fixes — May 2026

**Branch:** `claude/game-summary-ui-fixes-qtv8c`

Five fixes to address post-launch issues:

1. **ELO delta inconsistency** (`ratingService.js`) — Both clients now read the pre-game rating from `globalRatings` (the publicly readable source) for *both* players, not just the opponent. Previously `myBefore` came from `users/$uid/profile` which could diverge from `globalRatings` (e.g. if a prior leaderboard upsert failed), causing each side to compute a different delta (e.g. ±1 vs ±13). Now both clients use the same source for both ratings, guaranteeing identical deltas.

2. **Removed "ללא הודעות" toggle** (`settings.html`, `settingsScreen.js`) — The no-messaging panel was removed from the settings overlay. The corresponding `disableMessages` entry was also removed from the `TOGGLES` array in `settingsScreen.js`.

3. **Round resume button on home screen** (`home.html`, `menu-electric.css`, `menuScreen.js`) — The rectangular gold "המשך משחק שמור" button was replaced with a round circle button matching the 2P and Bot style. It occupies the top-right slot of the secondary row (only shown when a saved game exists). CSS selectors were migrated from `:first-child`/`:last-child` to explicit `em-platform-col--2p` / `em-platform-col--bot` / `em-platform-col--resume` classes. `menuScreen.js` now hides the `#resume-col` container (not just the inner button) so the column appears/disappears cleanly.

4. **Blocked word נאצי** (`hebrewDictionary.js`) — Added `נאצי` to `EXACT_REJECTS` so it cannot be played even though it exists in the dictionary.

5. **ELO direction reversed and draw mis-classification on resignation** (`main.js`) — Two root causes fixed:
   - The `onlineGameSession` room-watcher path emits `GAME_COMPLETED` with `winnerSlot: null` (no local engine result) but *does* include `abandonedBy`. The handler was ignoring `abandonedBy` and falling back to `'draw'`, so the winning player had ELO deducted and their history entry recorded as a draw. Fix: derive `effectiveWinnerSlot` as `1 - abandonedBy` when `winnerSlot` is null.
   - Both `gameEngine` and the room watcher can fire `GAME_COMPLETED` for the same game in edge cases, causing stats and ELO to be applied twice. Fix: one-shot guard (`ag._eloApplied`) ignores any fire after the first.

---

## Test suite cleanup — 30 failures → 0 (May 2026)

**Branch:** `online-game-fixes`

The unit suite had 30 failing tests left over from the spine cutover. All were either obsolete or had stale fixtures — no production code was broken. Now 135/135 pass.

- **Deleted 3 legacy-parity test files** that extract functions from `index.html` via `git show HEAD:index.html` and compare against the spine. Every expected legacy function (`isCollinear`, `doRecall`, etc.) has been removed from `index.html` during the cutover, so the parity oracle no longer exists: [tests/unit/engine-parity.test.js](tests/unit/engine-parity.test.js), [engine-parity-pending-recovery.test.js](tests/unit/engine-parity-pending-recovery.test.js), [engine-parity-scoring-animation.test.js](tests/unit/engine-parity-scoring-animation.test.js). The spine has its own coverage in [src/game/core/*.test.js](src/game/core) and [src/ui/controllers/animationController.test.js](src/ui/controllers/animationController.test.js) which all pass; the scoring-animation file specifically asserted the pre-refactor `scoringPointsFloat` / `scoreFlyToPanel` directives that are now rolled into a single `scoreMergeSequence` directive.
- **Updated [firebase-rules.test.js](tests/unit/firebase-rules.test.js)** — admin check moved from JWT custom claim (`auth.token.admin === true`) to RTDB lookup (`root.child('admins').child(auth.uid).val() === true`). Test now matches the actual rule.
- **Updated [shailta-keyboard-removal.test.js](tests/unit/shailta-keyboard-removal.test.js)** — `#exch-rack .bt2` tile size bumped from 54×64 to 72×72 (and font 28→30). Test now matches the actual CSS.
- **Fixed [engine-parity-highrisk.test.js](tests/unit/engine-parity-highrisk.test.js)** — two test-fixture bugs:
  - `inboundNoRevalidate` test was missing `lastMove.ts` so `onlineGameSession` correctly de-duped it. Added `ts: Date.now()` to match what real session writes carry.
  - `computeExpiredOnlineTurnState` test used `missedTurns: { 0: 3, 1: 1 }` which triggers the forfeit branch (`MISSED_TURNS_FORFEIT_THRESHOLD = 2`), forcing `turnDeadlineMs` to 0. Changed to `{ 0: 3, 1: 0 }` so the test exercises the normal non-forfeit code path it documents.

---

## Dead `.lcd` CSS removed (May 2026)

Cleanup follow-up to the move-counter removal: dropped 3 `.lcd` rules and an unused `.is-val.lcd-style` rule from [styles.css](styles.css). The `--lcd` CSS variable stays — still used by `.set-num`, `.code-display`, and `#stat-streak` (profile screen).

---

## Pre-launch polish: tutorial refresh, privacy update, no-messages toggle, Elo deltas — May 2026

**Branch:** `online-game-fixes`

Four small UX/copy passes ahead of production:

- **Tutorial refresh** ([partials/screens/tutorial-intro-modal.html](partials/screens/tutorial-intro-modal.html), [src/game/sessions/tutorialSession.js](src/game/sessions/tutorialSession.js), [src/ui/controllers/tutorialController.js](src/ui/controllers/tutorialController.js)):
  - Removed mention of the retired ערעור (challenge) action from the intro modal; added a mention of משבצות בונוס.
  - New scripted step: after the bot's first reply, the tutorial prompts the player to extend "שלום" to "שלומי" by placing 'י' at (5, 9), which lands next to the row-5 right-edge bonus and fires its activation. Seeded the bonus letter into the starting rack.
  - `tutorialController` now tracks player/bot move counts so the tip flow runs first-move → bonus prompt → completion.
- **Move counter removed** — deleted the `#lcd "מהלכים"` block from [partials/screens/game.html](partials/screens/game.html) and the matching `setText('#lcd', …)` in [src/ui/screens/gameScreen.js](src/ui/screens/gameScreen.js); updated [src/ui/screens/gameScreen.test.js](src/ui/screens/gameScreen.test.js).
- **Privacy policy rewrite** ([privacy-policy.html](privacy-policy.html)) — added sections for the new auth providers (email/Google/Facebook), profile/rating/friends data, OneSignal push, Cloudflare worker, in-game messages/reactions, and a children section. Refreshed "user rights" with the new account-deletion flow.
- **Settings: "ללא הודעות" toggle** — new `disableMessages` setting in [src/game/settings/settingsCompat.js](src/game/settings/settingsCompat.js); HTML panel in [partials/screens/settings.html](partials/screens/settings.html); wired in [src/ui/screens/settingsScreen.js](src/ui/screens/settingsScreen.js). Gated in [src/reactions/reactionController.js](src/reactions/reactionController.js) — hides the local reaction button, ignores incoming bubbles, and force-closes the panel. `disableMessages` is **local-only** — [src/main.js](src/main.js) strips it from the room settings write so one player's mute can't clobber the other's preference; the room sync handler also preserves the local value across `ROOM_SETTINGS_CHANGED`.
- **Elo delta on end screen** ([partials/screens/end.html](partials/screens/end.html), [src/ui/screens/endGameScreen.js](src/ui/screens/endGameScreen.js), [styles.css](styles.css)) — each score card now shows the new rating + signed delta (`דירוג 1012 (+12)`), styled green for gain / red for loss. Driven by the existing `RATING_EVT.CHANGED` event emitted by [src/game/account/ratingService.js](src/game/account/ratingService.js) after `applyEloForFinishedGame`.

---

## Scoreless-turn rules tightened + stalling-win claim button — May 2026

**Branch:** `online-game-fixes`

Three coupled engine + UI changes to close the "trailing player drags out a lost game" loophole. The app is pre-launch, so no migration was needed.

- **`LEGACY_PASS_GAME_OVER_THRESHOLD` lowered 6 → 4** in [src/game/core/turnManager.js](src/game/core/turnManager.js) — two full scoreless rounds (one per side) now ends the game.
- **Exchanges count as scoreless turns.** `applyExchange()` was incrementing-then-resetting (effectively reset to 0); it now `passCount += 1`. Previously a trailing player could exchange forever to keep the game alive.
- **Illegal-word forfeits count too.** The `resetPassCount: true` knob was removed from `applyPass()` and `gameEngine.handlePass()`; all three reasons (`pass`, `timeout`, `illegal-word`) now share one threshold. Updated the engine-parity recovery test that asserted the old reset behavior.
- **New `CMD.CLAIM_STALL_END`** + `canClaimStallEnd()` helper + `handleClaimStallEnd()` engine handler. Once `passCount >= STALL_CLAIM_THRESHOLD` (=2) and the player is strictly leading, they can end the game immediately and win.
- **New UI:** `#btn-claim-stall-end` topbar button on the game screen (hidden until allowed) + `#ov-claim-stall-end` confirm overlay + `claimStallEndController` that watches `EV.TURN_CHANGED` / `EV.MOVE_CONFIRMED` / etc. and toggles visibility. Online sessions already forward `EV.GAME_COMPLETED` to `setStatus()`, so no online-session changes were needed.
- **Docs:** updated [docs-md/CLAUDE.md](docs-md/CLAUDE.md), [GAMEPLAY_RULES.md](docs-md/GAMEPLAY_RULES.md), [API_REFERENCE.md](docs-md/API_REFERENCE.md). The in-app Guide and FAQ overlays now describe the new rule and the claim button.

---

## In-app help dropdown (Tutorial / Guide / FAQ) — May 2026

**Branch:** `online-game-fixes`

The top-bar `?` button used to open the tutorial intro modal directly. It now opens a small anchored dropdown with three entries:

- **🎓 הדרכה** — re-emits the existing `MENU_INTENT.OPEN_TUTORIAL` (existing flow unchanged).
- **📖 מדריך** — opens `#ov-guide`, an overlay with a collapsible 6-section game guide (rules + scoring, accepted Hebrew inflections, screens, modes, ratings, bonuses).
- **❓ שאלות נפוצות** — opens `#ov-faq`, an overlay with ~12 Q&As (rejected words, disconnect handling, async expiry, ratings, push permissions, שאילתא, etc.).

**New files:** `partials/screens/{help-dropdown,guide-screen,faq-screen}.html`, `src/ui/screens/{helpDropdown,guideScreen,faqScreen}.js` + colocated `.test.js` for each.

**Modified:** `src/ui/screens/menuScreen.js` (added `OPEN_HELP_MENU`/`OPEN_GUIDE`/`OPEN_FAQ` intents; the `?` button now emits `OPEN_HELP_MENU` instead of `OPEN_TUTORIAL`), `src/ui/screenPartialManifest.js`, `src/main.js` (wires the three new controllers), `styles.css` (dropdown + guide/FAQ accordion styles, no new CSS variables).

**Does NOT change:** the existing tutorial flow (`tutorialController` still handles `OPEN_TUTORIAL` exactly as before — the dropdown's first item re-emits it).

---

## Gate `navigator.vibrate` on user-gesture flag (May 2026)

**Branch:** `online-game-fixes`

**Symptom:** Chrome console logged `[Intervention] Blocked call to navigator.vibrate because user hasn't tapped on the frame or any embedded frame yet` from `feedbackService.js:245` on every page load — typically from a pre-gesture timer-tick or boot-time event.

**Fix:** `src/ui/feedbackService.js` `buzz()` now bails out when `state.unlocked` is false. That flag is already used to gate audio for the same reason (pre-gesture `AudioContext.resume()` warnings); the vibration path now mirrors it. Once the user makes their first pointer/key/touch gesture, the flag flips true and vibrations work normally.

**Does NOT change:** the user-facing vibration setting, which events trigger a buzz, or any game logic.

---

## Online End-Game Fixes — ELO permission, no-move ELO skip, avatar field, undefined global (May 2026)

**Branch:** `online-game-fixes`

Four end-of-game / matchmaking bugs surfaced from the same online play session:

### 1. `FIREBASE WARNING: ... permission_denied` on ELO write
**Symptom:** Every finished online game logged `[spine] elo Error: Permission denied at ...applyEloForFinishedGame:116`. No rating ever updated.

**Root cause:** `ratingService.applyEloForFinishedGame` read BOTH players' `/users/{uid}/profile` nodes and wrote both. The production rules in `firebase.database.rules.json` only allow `/users/{uid}` read/write when `$uid === auth.uid`, so the opponent's profile read failed with `permission_denied` (and the opponent-profile write would have failed too).

**Fix:** Switched to a per-client write model. Each client now:
- Reads its OWN profile from `/users/{myUid}/profile`.
- Reads the OPPONENT's current rating from `/globalRatings/{oppUid}` (the publicly-readable leaderboard mirror).
- Writes ONLY its own profile + own leaderboard entry.
- Returns the opponent's projected new rating in the result object (for UI animation) but does NOT persist it — the opponent's client makes the symmetric write on its own side.

The two symmetric calls converge on the correct zero-sum delta because each side computes its own change against the OTHER's pre-game rating. Tests updated in `src/game/account/ratingService.test.js` and `tests/unit/engine-parity-end-game-progression.test.js` to reflect the new model + opponent-defaults-to-RATING_START when no leaderboard entry exists yet.

### 2. ELO change on 0-move games
**Symptom:** If a player resigned / abandoned before either player made a move, the 0-0 result still moved both players' ELO.

**Fix:** `src/main.js` `GAME_COMPLETED` handler now reads `session.state.moveHistory.length` and skips the `applyEloForFinishedGame` call when no moves were played.

### 3. `Uncaught ReferenceError: currentUserProfile is not defined`
**Symptom:** Clicking the "בחר אווטאר" button in the avatar-unlock toast crashed because the inline `onclick` referenced a legacy global that the spine no longer defines.

**Fix:** `partials/screens/avatar-unlock-overlay.html` — replaced `if(currentUserProfile)showAvatarGallery()` with a defensive `if(typeof showAvatarGallery==='function')showAvatarGallery()`. The legacy global isn't needed; the gallery function is the authoritative gate.

### 4. Wrong avatar in random-matchmaking / friend-invite modals
**Symptom:** The matchmaking modal's "VS" card always showed the opponent as 👑 (crown default) regardless of the opponent's actual avatar.

**Root cause:** Four producer sites in `src/main.js` (matchmaking queue, host friend invite, guest friend invite, accept-invite from inbox, accept-invite from notification) all read `profile.avatar` — a field that doesn't exist on current profiles. The canonical field is `profile.equippedAvatar` (an id like `'diamond'`). The producers wrote `null` to the room/queue, so all opponents rendered as the 👑 default.

**Fix:** All four sites now read `equippedAvatar` (with `avatar` as a legacy fallback) and translate to an emoji at the boundary via `avatarEmoji()`. Made `avatarEmoji()` in `src/ui/screens/profileScreen.js` tolerant of both ids ('diamond' → '💎') AND already-resolved emojis ('💎' → '💎') so the existing consumers — some translate, some use raw — all render correctly without further changes.

---

## Reaction Panel → Centered Modal Overlay (May 2026)

**Branch:** `online-game-fixes`

**Symptom:** The inline reaction panel, anchored above the player card's `rxn-btn`, clipped above the viewport edge — the emoji grid section was rendered above the visible area and effectively invisible. The message list below it also truncated each message with `text-overflow: ellipsis` on a single line, so most Hebrew preset messages were cut off mid-word against the right (RTL-start) edge.

**Fix:** Replaced the inline panel with a centered modal:
- `partials/screens/game.html` — wrapped `#rxn-panel` in a new full-screen `#rxn-overlay` backdrop.
- `styles.css` — `.rxn-overlay` is a fixed full-screen flex container with a dim+blur backdrop; `.rxn-panel` is now a centered modal (max-width 340px, max-height 80svh, scrollable). The emoji grid is a fixed 4-column CSS grid so all 12 emojis are always visible without horizontal overflow. `.rxn-msg-item` now wraps (`white-space: normal; word-break: break-word`) instead of clipping.
- `src/reactions/reactionController.js` — dropped the `positionPanel()` viewport-anchoring code. Open toggles the overlay's visibility class; the backdrop click (target === overlay element) and a new `×` close button both dismiss it. ESC also still closes.
- `docs-md/docs/ui-rules.md` — added `#rxn-overlay` to the DOM ID inventory.

**Bubble redesign (same pass):** The opponent's reaction bubble used to sit above the score card on a dark navy gradient — it overlapped the turn timer/status bar and blended into the screen. Now:
- Anchored to the avatar element (`#is-av1` / `#is-av2`), not the whole score card, so the bubble visually emerges from the avatar's "mouth."
- Positioned to the SIDE of the avatar (inward toward screen center) instead of above, vertically centered on the avatar. This keeps it clear of `#turn-timer` and `#sbar`.
- A two-element structure (`.rxn-bubble-anchor` for positioning, `.rxn-bubble` for visuals) so the JS-owned positioning transform and CSS-owned scale-in animation don't fight.
- New palette: cream-yellow body (`#fff8e0 → #ffe79c`) with a 2px navy border, dark navy text — high contrast against the navy game background instead of blending in.
- Tail-on-the-side variants (`.rxn-bubble-right` for P1, `.rxn-bubble-left` for P2) — two-layer borders (outer = border color, inner = fill) so the tail correctly continues the border.
- Content-sized width: dropped the fixed `width: ~200px` on the anchor and switched to `display: inline-block` + `max-width`, so short reactions (single emoji) render as a compact bubble while long messages stay readable. `max-width` is computed per render from the actual horizontal distance to the OTHER player's score card (`is-sb1` / `is-sb2` bounding rect), so the bubble can never overflow into the opposite card — long Hebrew sentences wrap to 2+ lines via the inner `.rxn-bubble`'s `word-break: break-word`.

**Does NOT change:** the reaction config (12 emojis + 15 messages), the Firebase `liveReaction` write path, the cooldown / mute state, or any game logic.

---

## Matchmaking Race Fix — Single-Winner Pair Claim (May 2026)

**Branch:** `online-game-fixes`

**Symptom:** In a random online game, the coin-toss screen showed a different starting player on each client (each player saw their own name as the starter). The two clients were actually in two different rooms, with desynced state from move zero.

**Root cause:** `matchmakingService.tryPair` claimed the queue pair via a multi-path `update({uid: null, partnerUid: null})` followed by a re-read "verify" step. When both clients ran `tryPair` simultaneously (the common case when two queue listeners fire at nearly the same instant), both updates succeeded (the second was a no-op), both verify reads found the queue empty, and both proceeded to `createRoomFromPair`. Each client built its own room with itself as `players[0]`, called `users/{me}/activeRoom.set(myRoomId)`, and its own activeRoom listener fired with its own room before the other client's overwrite could arrive — so each client mounted a different room.

**Fix:** Both racing clients now serialize on the same single-entry transaction at `/matchmakingQueue/{mode}/{min(uid, partnerUid)}`. Both clients deterministically pick the same path (lexicographically smaller of the pair), so their transactions queue up on the same Firebase node: only one commit sees the entry present and deletes it; the other reads `null` and aborts. The winner then best-effort removes the other entry and proceeds to `createRoomFromPair`. The loser returns `{ matched: false }` and stays in its `activeRoom` listener — which fires when the winner's `createRoom` writes `users/{me}/activeRoom`.

Why per-entry, not the queue parent: the database rules grant `.write` only at the `$uid` child of `matchmakingQueue/$mode`, never at the `$mode` parent itself. A transaction at the parent path is rejected with `permission_denied`. Each per-entry write is null (the claim deletes the entry), which satisfies the rule's `!newData.exists()` branch even when the writer is the partner, not the entry owner.

**Files:**
- `src/game/online/matchmakingService.js` — transactional claim, uses entries read INSIDE the transaction for the create-room callback (avoids reading stale entry snapshots)
- `src/game/online/matchmakingService.test.js` — regression test `tryPair: simultaneous race — only one client claims the pair` runs two `tryPair` calls under `Promise.all` and asserts exactly one winner and exactly one `createRoomFromPair` invocation

**Does NOT change:** queue compatibility rules, queue write/read paths, room schema, or any game engine invariant.

---

## Hebrew In-Game Reaction System (May 2026)

**Branch:** `claude/boost-hebrew-reactions-sUK6k`

**Summary:** Adds a child-safe emoji + preset Hebrew message reaction system for online games. Players can send predefined reactions that appear as animated speech bubbles near the opponent's score card. No free-text input — only whitelisted IDs are accepted.

**New files:**
- `src/reactions/reactionsConfig.js` — static REACTIONS config (12 emojis, 15 Hebrew messages) + `validateReactionPayload()` + `getReactionDisplay()`
- `src/reactions/reactionService.js` — Firebase write (`sendReaction`), cooldown tracking, mute preference (localStorage key `spine.muteReactions`)
- `src/reactions/reactionController.js` — UI controller: panel, bubbles, button wiring; `mountReactionController({ bus, db, roomId, mySlot, storage })`

**Modified files:**
- `src/events/eventTypes.js` — added `EV.REACTION_RECEIVED`
- `src/game/online/schema.js` — added `FIELD.liveReaction`
- `src/game/online/roomService.js` — added `setLiveReaction(db, roomId, payload)`
- `src/game/sessions/onlineGameSession.js` — watches `liveReaction` in room snapshot; emits `EV.REACTION_RECEIVED`; tracks `sessionStartTs` to suppress stale reactions on reconnect
- `firebase.database.rules.json` — added `liveReaction` write rule (same as `liveBonus`/`livePreview`)
- `partials/screens/game.html` — added reaction buttons (`#rxn-btn-slot0`, `#rxn-btn-slot1`) inside player cards and `#rxn-panel` container below info strip
- `styles.css` — added reaction UI styles (panel, buttons, bubbles, animations)
- `src/main.js` — mounts `reactionController` in `startOnlineGameViaSpine`; disposed on `end()`

**Architecture:**
- Reactions use the `liveReaction` field (not a versioned transaction) — same pattern as `livePreview`/`liveBonus`
- Firebase shape: `{ type, id, senderSlot, ts }` — no raw text
- Anti-replay: reactions with `ts <= sessionStartTs` are ignored on reconnect
- Cooldown: 5 s client-side; per-session state
- Mute: localStorage toggle; local-only; doesn't affect sender

**Does NOT change:** scoring, turns, timer, board state, dictionary, game logic, or any game engine invariant.

---

## Achievements Expansion: 9 New Cards (May 2026)

**Branch:** `fix-save-game`

**Summary:** Added 9 new achievement cards to the achievements screen, each backed by a new avatar reward.

| # | Title (HE) | Description | Stat | Min | Avatar | Tier |
|---|---|---|---|---|---|---|
| 1 | שועל ותיק | Win without using a single special tile | `cleanWins` | 1 | 🦊 שועל | silver |
| 2 | גאון מילים | Score 100+ in one move | `highestMoveScore` | 100 | 💡 נורה | silver |
| 3 | חבר של כולם | Reach 20 friends | `friendsCount` | 20 | 🤝 חברים | silver |
| 4 | בלתי מנוצח | Win streak of 15 | `longestStreak` | 15 | 🛡️ מגן | gold |
| 5 | ברק חי | Play a game under 3 sec avg per move | `fastGamePlayed` | 1 | ⚡ ברק | gold |
| 6 | בלתי נתפס | Win 25 games in a row | `longestStreak` | 25 | 🏆 גביע | legend |
| 7 | מילון מהלך | Use 1,000 unique words | `uniqueWordsCount` | 1,000 | 📚 ספרים | legend |
| 8 | על-אנושי | A full week without a loss | `noLossWeekStreaks` | 1 | 🦸 גיבור-על | legend |
| 9 | האחד | Beat the #1 player | `beatNumberOne` | 1 | 🎯 מטרה | legend |

**Stat wiring status:**
- `highestMoveScore` (#2) is already tracked by `profileService.computeStatsDelta` — this achievement starts unlocking immediately for any player who has ever scored ≥100 in a single move.
- `longestStreak` (#4, #6) is already tracked.
- `cleanWins`, `friendsCount`, `fastGamePlayed`, `uniqueWordsCount`, `noLossWeekStreaks`, `beatNumberOne` are new stat names that will display as 0/N progress until separate work wires them up.

**Tests added:**
- `src/ui/screens/avatarScreens.test.js` — new test pins all 9 new achievement ids and verifies `word_genius` is wired to `highestMoveScore` min 100. The existing "AV_RENDER paints all avatars + count" test was generalized from a hard-coded `/10` to `/${SPINE_AVATARS.length}` so it tracks future expansions.

**Files modified:**
- `src/ui/screens/avatarScreens.js` — `SPINE_AVATARS` (10 → 19) and `ACHIEVEMENTS` (8 → 17)
- `src/ui/screens/avatarScreens.test.js`

---

## Quick-Place Lock on Empty Cell (May 2026)

**Branch:** `fix-save-game`

**Summary:** Clicking an empty on-grid cell with no rack tile / lock duration selected now quick-places a lock at that cell using the smallest available lock duration from the player's inventory. Previously this click was a no-op; players had to tap the lock-inventory picker first.

**Behavior:**
- Empty cell (0..9 × 0..9), no rack-tile and no lock-duration selected, no committed tile, not already locked → dispatch `PLACE_LOCK` with `duration = min(player's lockInventory)`.
- Perimeter bonus squares (`r=-1`, `r=10`, `c=-1`, `c=10`) are skipped (engine rejects off-grid locks).
- No-op if the player has no locks remaining.
- Existing flows (lock-duration explicitly selected via inventory picker, rack-tile selected, placed-tile selected for move) are unchanged.

**Files modified:**
- `src/ui/screens/gameScreen.js` — `onCellClick` quick-place branch
- `src/ui/screens/gameScreen.test.js` — three new tests (places lock with smallest duration; no-op with empty inventory; rack selection still places tile)

---

## Online Bug Fixes: Display Name + Bonus-Square Live Preview (May 2026)

**Branch:** `fix-save-game`

**Summary:** Two online-play bugs reported by the user.

**Bug A — invited player shown as "שחקן" instead of their display name.** Two invite-accept handlers and two queue-join handlers fell back to a generic fallback when `fbUser.displayName` was empty (common for email/password signups whose Firebase auth profile carries no displayName; the canonical name lives in `/users/{uid}/profile/displayName`).

**Fix:** Added `resolveMyDisplayName()` helper in [src/main.js](src/main.js) that resolves the current user's display name in priority order: watched profile (`__spine.currentProfile.displayName`) → Firebase auth → legacy global → one-shot Firebase read of the profile node. Used in `II_INTENT.ACCEPT` (popup accept), `NOTIF_INTENT.ACCEPT_INVITE` (inbox accept), `MM_INTENT.SEARCH` (matchmaking queue), `CR_INTENT.CONFIRM` (create-room host), and `JC_INTENT.CONFIRM` (join-by-code guest). Avatar fallback was also extended to prefer the watched profile's avatar.

**Bug B — opponent's pending tile on a perimeter bonus square wasn't visible until commit.** `gameScreen.js` `renderBoard` renders the live preview inside the 0..9 grid via `isOpponentPreview`, but the perimeter bonus squares (`r=-1`, `r=10`, `c=-1`, `c=10`) are rendered by a separate loop over `BDEFS` that only checked the local user's `view.placed` and the committed `view._bonusBoard` — it ignored the opponent's `view._livePreview` tiles entirely.

**Fix:** Extended the BDEFS loop in [src/ui/screens/gameScreen.js](src/ui/screens/gameScreen.js) to also check `isOpponentPreview(view, br, bc)` when neither a local pending tile nor a committed tile occupies the square; the opponent's preview tile is rendered into the `.bsq-tile-wrap` with the same `.spine-live-preview` styling the in-grid path uses.

**Tests added:**
- `src/ui/screens/gameScreen.test.js` — new test `live preview renders opponent ghost tile on a perimeter bonus square` verifies an opponent's `livePreview` tile at `(r=-1, c=1)` appears on `#bsq-0` with the `.spine-live-preview` class and the letter visible in the tile wrap.

**Multiplier (×2/×4) report — confirmed as not a bug.** User asked whether B7 (×2) should multiply the opponent's score instead of the landing player's own next move. Confirmed in conversation that current "multiplies my own NEXT move" semantics is the intended behavior; no code change.

**Files modified:**
- `src/main.js`
- `src/ui/screens/gameScreen.js`
- `src/ui/screens/gameScreen.test.js`

---

## Offline Save / Resume for 2P + vs-Bot (May 2026)

**Branch:** `fix-save-game`

**Summary:** Implements the pause-and-save / resume flow for offline games (offline-2p, offline-solo vs-Bot). Previously the "שמור וצא לתפריט" and "השהה ושמור" buttons silently discarded the game and the home Resume button never appeared. Now the active engine state is serialized to localStorage on save-and-exit and rehydrated on resume.

**What changed:**

1. **`src/game/sessions/localSaveService.js`** — new module. `saveLocalGame` / `loadLocalGame` / `clearLocalGame` / `hasLocalSavedGame` under the `spine.localSavedGame` key. Persists the full engine state (status === 'playing' only); converts the `state.bonusBoard` Map ↔ plain object across the JSON boundary; refuses payloads with the wrong version or mismatched schemaVersion.

2. **`createLocalGameSession`** ([src/game/sessions/localGameSession.js](src/game/sessions/localGameSession.js)) — accepts an optional `initialState` to bypass `createInitialState` and rebuild a session around a restored state.

3. **`gameFlowController.js`** — `PAUSE_INTENT.SAVE_AND_EXIT` for offline games now writes the state via `saveLocalGame` before tearing down. `EV.GAME_COMPLETED` clears the local save (a finished game is not resumable). `BACK_INTENT.LEAVE` and `PAUSE_INTENT.QUIT_NO_SAVE` clear the save only when the active game was resumed from it (`ag.resumedFromLocalSave === true`).

4. **`startGameViaSpine` + `resumeLocalGameViaSpine`** ([src/main.js](src/main.js)) — `startGameViaSpine` now accepts `restoredState` + `resumedFromLocalSave` flags. `resumeLocalGameViaSpine` reads the saved payload and replays the local-game lifecycle. `MENU_INTENT.RESUME_SAVED` falls back to it when no online async session is available.

5. **`menuScreen.js`** — the home Resume button (`#btn-resume-home`) is now also shown when `hasLocalSavedGame(localStorage)` returns true, so a paused offline game stays visible across reloads even if no online async sessions exist.

**Tests added:**
- `src/game/sessions/localSaveService.test.js` — 10 tests covering save/load round-trip (including the bonusBoard Map), bot/difficulty preservation, refusal of non-playing states / corrupt JSON / wrong version / mismatched schemaVersion, clear, null-storage no-op.
- `src/ui/controllers/gameFlowController.test.js` — 3 new tests: SAVE_AND_EXIT writes state for offline 2P, preserves bot/difficulty, and GAME_COMPLETED clears the save.

**What did NOT change:** Engine state shape, `EV.*` / `CMD.*` constants, Firebase paths, online-game save/restore (still handled by `sessionPersistence.js`), `schemaVersion` (still 2). Pending mini-game state survives in the saved payload but does not re-pop the modal on resume (accepted limitation — player loses that one bonus opportunity).

**Files modified:**
- `src/game/sessions/localSaveService.js` (new)
- `src/game/sessions/localSaveService.test.js` (new)
- `src/game/sessions/localGameSession.js`
- `src/main.js`
- `src/ui/controllers/gameFlowController.js`
- `src/ui/controllers/gameFlowController.test.js`
- `src/ui/screens/menuScreen.js`

---

## Achievements Section Redesign (May 2026)

**Branch:** `claude/achievements-redesign-plan-PgEtc`

**Summary:** Replaced the plain avatar emoji grid with a proper achievements hall — named cards with titles, descriptions, and progress bars. The "הישגים" nav button now leads to a screen that actually feels like achievements.

**What changed:**

1. **`ACHIEVEMENTS` table** (`src/ui/screens/avatarScreens.js`) — 8 named milestones that each map to a reward avatar. Each has a Hebrew title, description, unlock condition, and tier (bronze/silver/gold/legend).

2. **`progressPct(achievement, stats)`** — new pure helper (0–1 fraction toward completion).

3. **`findAchievementByRewardId(avatarId)`** — reverse lookup from avatar id to its achievement.

4. **Redesigned `paint()`** — renders a "starter" row (crown + star, always unlocked) followed by vertically stacked achievement cards. Each card shows emoji, title, description, progress bar with current/required count, and tier chip. Locked cards are semi-transparent and show a hint on click. Equipped avatar gets a checkmark.

5. **Screen title** — changed from "🎨 אוסף האווטארים" to "🏆 הישגים שלי" (`partials/screens/avatar-gallery-screen.html`).

6. **CSS** — added `.ach-card`, `.ach-progress`, `.ach-progress-fill`, `.ach-tier-chip`, `.ach-card-left`, `.ach-card-body`, `.ach-card-title`, `.ach-card-desc`, `.ach-card-meta`, `.ach-starter-row` to `styles.css`.

**What did NOT change:** `SPINE_AVATARS`, `isAvatarUnlocked()`, `diffNewlyUnlocked()`, unlock-popup system, all `AV_INTENT.*` / `AV_RENDER` event names. No Firebase, no game engine, no schema changes.

**Files modified:**
- `src/ui/screens/avatarScreens.js` — ACHIEVEMENTS table, progressPct, findAchievementByRewardId, rewritten paint()
- `src/ui/screens/avatarScreens.test.js` — new tests for ACHIEVEMENTS coverage, progressPct, findAchievementByRewardId
- `partials/screens/avatar-gallery-screen.html` — new title, flex-column grid
- `styles.css` — achievement card styles

---

## Speed Presets, Reject-name Fix, Favorite-Speed Stat (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** Three improvements to invite UX, game setup, and stats.

1. **Reject name fix** — Banner text "X דחה את ההזמנה" now uses `globalThis.__spine?.currentProfile?.displayName` as the primary source (email/password users had `fbUser.displayName === null`). Applied to both the invite-overlay reject handler and the notifications-inbox reject handler in `src/main.js`.

2. **Speed presets replace time-limit setting** — The "זמן מוגבל למהלך" toggle + seconds counter was removed from the Settings screen. In its place, each game-mode configuration window now has a 3-button speed selector: ⚡ בזק (20s) / 🎯 רגיל (40s) / 🐢 איטי (60s). Applied to:
   - Setup screen (local vs + bot games) — `partials/screens/setup.html` + `src/ui/screens/setupScreen.js`
   - Create-room overlay (friend online) — `partials/screens/online-create-room.html` + `src/ui/screens/createRoomScreen.js`
   - Matchmaking overlay (random online) — `partials/screens/online-matchmaking.html` + `src/ui/screens/matchmakingOverlayScreen.js`
   - Settings overlay — `partials/screens/settings.html` + `src/ui/screens/settingsScreen.js` (panel removed)
   - Default `botTime` changed from 20 → 40 in `settingsCompat.js`
   - Legacy globals `crToggleTL`, `crAdjTime`, `mmSetTL` removed; `crSetMode`/`mmSetMode` updated for new row IDs

3. **Favorite move-speed statistic** — New `moveSpeedStats` field in `EMPTY_STATS` tracks `{ played, won }` per speed key (20/40/60). `computeLiveGameStatsDelta` accepts `botTime` and uses `mergeMoveSpeedStats()`. `deriveStatsView` derives `favoriteSpeed` (speed with highest win%). Displayed in the Records tab as "קצב המשחק האהוב".

**Files modified:**
- `src/main.js` — reject name fix; removed crToggleTL/crAdjTime/mmSetTL; updated crSetMode/mmSetMode; matchmaking botTime wired; botTime passed to computeLiveGameStatsDelta
- `partials/screens/settings.html` — removed timelimit panel
- `src/ui/screens/settingsScreen.js` — removed timelimit toggle + botTime counter
- `src/game/settings/settingsCompat.js` — default botTime 20 → 40
- `partials/screens/setup.html` — added speed selector row
- `src/ui/screens/setupScreen.js` — botTime state, speed button wiring, PLAY_CLICKED payload
- `partials/screens/online-create-room.html` — replaced timelimit row with speed buttons
- `src/ui/screens/createRoomScreen.js` — readBotTime from speed buttons; timelimit always true for live
- `partials/screens/online-matchmaking.html` — replaced timelimit row with speed buttons
- `src/ui/screens/matchmakingOverlayScreen.js` — readBotTime; botTime in readMatchmakingFilters; speed button wiring
- `src/ui/screens/matchmakingOverlayScreen.test.js` — updated mock DOM + assertions for botTime
- `src/game/account/profileService.js` — moveSpeedStats in EMPTY_STATS; botTime param; mergeMoveSpeedStats helper
- `src/ui/screens/statsScreen.js` — favoriteSpeedFor helper; deriveStatsView + paint wired
- `partials/screens/stats-screen.html` — #st-fun-speed card in Records tab

---

## Notification Banner + Cancel-clears-invite (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** Three UX improvements to the invite and waiting-room flows.

1. **Cancel in waiting room now also cancels a live direct invite** — `WR_INTENT.CANCEL` handler reads `activePending.inviteId`/`inviteToUid` before teardown and calls `inviteService.cancelInvite`.

2. **Slide-down banner replaces blocking popups** — A `#notif-banner` element sits just below the fixed topbar (`z-index:49`). On a new incoming invite or a rejected-invite ack, a `NOTIF_BANNER_SHOW` event causes it to slide down with a 0.38 s ease animation. Clicking opens the notifications inbox (`openNotifications` action) or dismisses (`dismiss` action). Auto-hides after 7 s. `#ov-incoming-invite` and `#ov-invite-rejected` overlays are no longer shown.

3. **No popup on app open** — `bootInviteListenersFor` now tracks a `seenIds` Set and an `isFirstFire` flag. The first Firebase snapshot (existing invites at login/load) only updates the badge and inbox; the banner is suppressed. Only genuinely new invites that arrive after load trigger the banner.

**New files / modified:**
- `index.html` — added `#notif-banner`, `#notif-banner-avatar`, `#notif-banner-text`
- `menu-electric.css` — `#notif-banner` CSS (slide transform, hover, RTL text)
- `src/ui/screens/notificationsScreen.js` — `NOTIF_BANNER_SHOW` export, `mountNotifBanner()`
- `src/main.js` — `WR_INTENT.CANCEL` cancel invite; `bootInviteListenersFor` banner/no-open logic; `IR_OPEN` → `NOTIF_BANNER_SHOW`; mount `mountNotifBanner`

---

## Waiting Room — Async Close + Live Countdown (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** Async direct invites now close the waiting room after 1.5 s (no need to wait for the other player). Live direct invites show a countdown in the waiting room; when it hits zero, both the pending room code and the invite are cancelled on Firebase and the overlay closes.

**Modified files:**
- `partials/screens/online-waiting-room.html` — added `#wr-countdown` element
- `src/ui/screens/waitingRoomScreen.js` — new events `WR_LIVE_INVITE_SENT`, `WR_INTENT.LIVE_INVITE_EXPIRED`; countdown timer logic
- `src/main.js`:
  - `crSendInvite()` splits on mode: async → cancel pending room + close overlay after 1.5 s; live → store `inviteId`/`inviteToUid` in `activePending`, emit `WR_LIVE_INVITE_SENT`
  - `WR_INTENT.LIVE_INVITE_EXPIRED` handler: calls `teardownPending()`, `roomCodeService.cancelPending()`, `inviteService.cancelInvite()`, then emits `WR_CLOSE`

**Behavior:**
- Async invite: waiting overlay closes after 1.5 s with no further action required
- Live invite: countdown shows remaining time (5 min TTL); on expiry both pending room and invite are deleted from Firebase and the overlay closes

---

## Notifications Bell Inbox (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** The bell icon in the top bar now shows a live badge count of pending game invites + pending friend requests. Clicking the bell opens a new inbox screen (`#snotif`) that lists both categories with per-item accept/reject buttons.

**New files:**
- `partials/screens/notifications-inbox.html` — inbox screen with two sections: game invites and friend requests
- `src/ui/screens/notificationsScreen.js` — screen controller exporting `NOTIF_INTENT`, `NOTIF_RENDER`, `mountNotificationsScreen`

**Modified files:**
- `src/ui/screenPartialManifest.js` — registered `notifications-inbox.html`
- `src/ui/screens/menuScreen.js` — `render()` now accepts `unreadCount` (number); badge shows count text when > 0
- `src/main.js`:
  - `MENU_INTENT.OPEN_NOTIFICATIONS` now routes to `snotif` instead of `so`
  - `bootInviteListenersFor` filters pending+non-expired invites, emits `NOTIF_RENDER` and `MENU_REFRESH` (badge count)
  - `activeRequestsWatch` also emits `NOTIF_RENDER` and `MENU_REFRESH` on change
  - `NOTIF_INTENT.ACCEPT_INVITE / REJECT_INVITE` handlers (same Firebase logic as `II_INTENT`)
  - `NOTIF_INTENT.ACCEPT_FRIEND / REJECT_FRIEND` handlers (same Firebase logic as `FRIENDS_INTENT`)
  - `NOTIF_INTENT.BACK` navigates home
  - Badge count resets to 0 on sign-out
  - `snotif` added to `showLegacyScreen` screen list

**Behavior:**
- Badge = `pendingGameInvites + pendingFriendRequests` (live, updates via Firebase listeners)
- Inbox shows empty state when no pending items
- Accepting a game invite starts the game (same flow as the popup overlay)
- Rejecting sends a push notification to the inviter
- Accepting a friend request writes the friendship bidirectionally

---

> Based on `git log --oneline -30` (last 30 commits visible from repository).
> Older history is not available in this output. Full history available via `git log`.

---

## Stats Screen Simplification (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Audited the stats screen and removed low-value / duplicated / placeholder stats. Collapsed 5 tabs (סקירה / ביצועים / בוסטים / יריבים / כיף) into 3 (תקדמות / שיאים / יריבים ובוסטים). UI-only change — `EMPTY_STATS` and Firebase storage are unchanged so existing user data is preserved.

**Removed from UI:**
- Average word length (`#st-avgword`) — narrow range, undifferentiating
- Points per tile (`#st-pts-tile`) — redundant with points-per-move
- Average move time (`#st-move-time`) — `totalMoveTimeMs` is never written, so the card always rendered `—`
- Wins vs stronger / weaker (`#st-vs-stronger-w`, `#st-vs-weaker-w`) — not actionable without rating-delta context
- Boost impact wins / best (`#st-boost-impact-wins`, `#st-boost-impact-best`) — definition is too loose (any boost-triggered win)
- Winning combo (`#st-boost-combo`) — complex to compute, low payoff
- Luck index (`#st-fun-luck`) — just `clamp(winRate, 1, 99)` renamed
- Duplicated tier badge on performance tab (`#st-perf-tier-badge`) — hero card already shows tier
- Empty rank placeholder (`#st-hero-rank`) — never populated, no global leaderboard yet
- Win-rate / streak duplicates under W/L bar (`#st-wr-pct-lbl`, `#st-streak-lbl`)

**New tab structure:**
- **תקדמות (Progress)** — sparkline, ELO/tier bar, high score, avg score, games played, points/move, W/L/D bar
- **שיאים (Records)** — longest word, longest streak, fastest win, biggest comeback, most repeated word, best weekday, share button
- **יריבים ובוסטים (Rivals & Boosts)** — rival leaderboard, boost totals/avg/win-rate, favorite boost, clutch cluster (comeback / last-move / close wins)

**Changes:**

- `partials/screens/stats-screen.html`
  - Replaced 5-tab tabbar with 3 tabs.
  - Rebuilt panel HTML around the 3-tab grouping; dropped low-value cards.
  - Hero card dropped the rank KPI; shows 2 KPIs (win rate + current streak).
  - Share button moved to the Records tab.
  - New ID: `#st-fun-streak` for the longest-streak fun card.

- `src/ui/screens/statsScreen.js`
  - `paint()` no longer writes to removed DOM IDs.
  - `tabFromButton()` parses the new tab labels (תקדמות / שיאים / יריבים).
  - `deriveStatsView()` no longer returns the unused fields (`avgWordLength`, `pointsPerTile`, `avgMoveTime`, `boostImpactWins`, `boostComboHtml`, `luck`, `rank`).
  - Removed dead helpers `boostComboHtml()` and `formatDurationAverage()`.

- `src/ui/screens/statsScreen.test.js`
  - DOM mock IDs and tab labels updated to match the new layout.
  - Tab assertion now checks `#st-panel-records` instead of `#st-panel-performance`.
  - Empty-stats test now checks `#st-fun-fastest` (the kept card) instead of `#st-move-time`.

**Files changed:**
- `partials/screens/stats-screen.html`
- `src/ui/screens/statsScreen.js`
- `src/ui/screens/statsScreen.test.js`

**Notes:**
- `EMPTY_STATS` in `src/game/account/profileService.js` is unchanged. `boostImpactWins`, `totalMoveTimeMs`, etc. continue to be written to Firebase but are no longer surfaced in the UI. A future cleanup pass can remove the orphan fields once the new layout settles.
- `totalMoveTimeMs` is still hardcoded to `0` at `profileService.js:251` — this remains an open item if move-time tracking is ever wired up.
- The `ratingService.applyEloForFinishedGame()` flow is fully wired; the ELO/tier UI shows real values.

**Follow-up tweak:** Removed the redundant stats-screen topbar (back arrow + refresh button) — the persistent app-wide top bar already provides navigation. Tightened the hero card layout: tier badge now sits inline next to the display name on the same row, and the avatar is sized down (48px → 36px) so the info column no longer gets squeezed with only 2 KPIs visible.

**Follow-up tweak 2 (2026-05-27):** User-reported issues:

- Removed **fastest-win** card (`#st-fun-fastest`) — abandoned games skewed the stat (a 16-second "win" really meant the opponent left).
- Removed **points-per-move** card (`#st-pts-move`) — `totalMoves` is under-tracked in `computeLiveGameStatsDelta`, producing impossible values (e.g. 83.2 pts/move). Until the tracking is fixed the metric is noise.
- Renamed `שיא ניקוד` → `שיא ניקוד למשחק` and `ממוצע ניקוד` → `ממוצע ניקוד למשחק` so the labels make clear these are per-game (not per-move) totals.
- Removed the **time filter** UI (`שבוע`/`חודש`/`הכל`) entirely. Only the sparkline ever respected the period; every other card used cumulative totals, so the filter was misleading. Restoring proper time-windowed stats requires per-game history beyond the current 20-game `recentGames` cap.
- Fixed the **W/L bar** colors: removed the inline `direction:ltr` so the bar follows the RTL flow of the card. Now green (wins) aligns under the ניצחונות label on the right, red under הפסדים, gray under תיקו.

**Files changed:**
- `partials/screens/stats-screen.html`
- `src/ui/screens/statsScreen.js` — dropped `period` parameter, `pointsPerMove`/`fastestWin`/`filteredRecent` fields, `setActive`/`filterRecent`/`btnTextPeriod`/`formatDuration` helpers, `PERIOD_MS` constant, `win._statsTimeFilter` global
- `src/ui/screens/statsScreen.test.js`
- `src/main.js` — dropped the `globalThis._statsTimeFilter` shim
- `tests/e2e/non-menu-buttons.spec.js` — updated to match the new 3-tab layout (no topbar, no time filter, no performance/fun tabs)

**Storage notes:** `fastestWinMs`, `totalMoves`, `totalScore` etc. are still written to Firebase — UI-only hide.

**Follow-up tweak 3 (2026-05-27):** Added **"הכי הרבה נקודות במהלך אחד"** (highest single-move score) to the Records tab.

- New stored field `highestMoveScore` in `EMPTY_STATS` ([src/game/account/profileService.js](src/game/account/profileService.js)).
- `computeLiveGameStatsDelta` walks the player's own `moveHistory` entries, takes the max `score`, and emits `highestMoveScore: { max: ... }` so the bump transaction keeps the running all-time best.
- Surfaced as `stats.highestMoveScore` in `deriveStatsView`, painted into `#st-fun-bestmove` on the Records tab.
- Tests: added assertions in [profileService.test.js](src/game/account/profileService.test.js) (`d.highestMoveScore === { max: 40 }` for the existing live-stats test) and [statsScreen.test.js](src/ui/screens/statsScreen.test.js) (rendered `92`).

---

## Profile Cleanup + Achievements Nav Repurpose (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** With the persistent topbar now providing the home button on every screen, redundant navigation in the profile screen could be removed. Also repurposed the bottom-nav "הישגים" (achievements) button to navigate to the avatar gallery instead of opening the champions/ratings overlay.

**Changes:**

- `partials/screens/profile-screen.html`
  - Removed the "← חזרה לתפריט" button (replaced by the topbar's home button).
  - Removed the "🎨 אוסף אווטארים" button (now reachable via the bottom-nav "הישגים" button; the avatar emoji at the top of the profile is still clickable too).

- `partials/screens/home.html`
  - Bottom-nav trophy button: `onclick="openChampions()"` → `onclick="showAvatarGallery()"`. Label "הישגים" and icon 🏆 kept. `showAvatarGallery()` is the existing global that emits `PROFILE_INTENT.OPEN_AVATARS` → navigates to `#sav-gallery`.

- `src/ui/screens/menuScreen.js`
  - Removed the `openChampions()` selector entry from `SCREEN_BUTTONS` (no button uses that onclick anymore).
  - Removed `MENU_INTENT.OPEN_CHAMPIONS` from the intent enum.

- `src/main.js`
  - Removed the `bus.on(MENU_INTENT.OPEN_CHAMPIONS, …)` handler (dead — no emitter remains). Champions screen can still be opened by the existing `CHAMPS_OPEN` flow from other call sites (e.g. end-of-game `bus.emit(CHAMPS_OPEN, {})` at main.js:460).

- `src/ui/screens/menuScreen.test.js`
  - Removed the `champions` mock button and its click + `OPEN_CHAMPIONS` assertion from the per-button intent test.

**Files changed:**
- `partials/screens/profile-screen.html`
- `partials/screens/home.html`
- `src/ui/screens/menuScreen.js`
- `src/ui/screens/menuScreen.test.js`
- `src/main.js`

---

## All-Screens Topbar Clearance Audit (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Audited every screen partial to confirm the persistent top bar doesn't cover content. The existing `.screen:not(#sh):not(#sg) { padding-top: var(--em-topbar-h) }` rule wins via specificity on every screen (verified `.screen:not(#sh):not(#sg)` = `(0,2,1,0)` beats `#ss { padding: 18px }` at `(0,1,0,0)`), but one screen used an inline `max-height: 92vh` that did not subtract the topbar height. Added a global belt-and-suspenders cap.

**Per-screen verification:**

| Screen | Container | Topbar-aware? |
|---|---|---|
| `#sh` home | `.em-home` `margin-top: var(--em-topbar-h)` | ✓ explicit |
| `#sg` game | topbar hidden by `screenTransitions.js` | ✓ N/A |
| `#ss` setup | `.sbox` centered; global padding-top wins over `#ss { padding: 18px }` (specificity) | ✓ |
| `#so` online lobby | `.online-wrap` centered | ✓ global rule |
| `#scoin` coin toss | `.coin-wrap` centered | ✓ global rule |
| `#sprofile` profile | `.sbox` centered | ✓ global + max-height cap |
| `#sfriends` friends | `.sbox` with **inline `max-height: 92vh`** | ✗ FIXED |
| `#sstats` stats | `.stats-wrap` `height: 100%` of content area | ✓ global rule |
| `#sauth-signup` sign-up | `.sbox` centered | ✓ global + max-height cap |
| `#sauth-login` log-in | `.sbox` centered | ✓ global + max-height cap |
| `#sav-gallery` avatar gallery | inner `height: 100%` fills content area | ✓ global rule |
| `#schamps` | stale ID, not in DOM (champions is `.ov` overlay) | ✓ N/A |

**Changes:**
- `partials/screens/friends-screen.html` — replaced inline `max-height: 92vh` with `calc(100svh - var(--em-topbar-h) - 16px)` so the box always fits between the topbar and the bottom edge.
- `menu-electric.css` — added a defensive rule capping any direct-child `.sbox` of a non-home, non-game `.screen` to `calc(100svh - var(--em-topbar-h) - 16px)` so future inline `max-height: NNvh` values can't overflow the topbar.

---

## Topbar + Bottom Nav Proportional Sizing (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** The top bar (`.em-topbar`) and bottom navigation (`.em-bottom-nav`) had hardcoded values and clamps capped at phone sizes (icon buttons at 33px max, avatar at 50px, nav icon at 28px, badge fully hardcoded at 13×13×7px). On tablets/desktop these elements stayed phone-sized while the rest of the home screen scaled up — visually inconsistent.

**Fix:** Same `clamp(min, min(vw, svh), max)` system as the platforms and logo. Each bar declares one base unit (icon-button size for the topbar, icon size for the nav) and derives everything else from it (label fonts, padding, gaps, badge, avatar emoji size, ELO badge, profile name max-width). Also fixed a stale duplicate `.em-home .hlogo img { max-width: 525px !important; }` rule that was overriding the proportional logo cap.

**Topbar custom properties on `#global-topbar`:**
```
--topbar-btn:    clamp(28px, min(7.5vw, 4.5svh), 60px)
--topbar-font:   --topbar-btn × 0.45
--topbar-gap:    --topbar-btn × 0.14
--topbar-avatar: clamp(42px, min(11vw, 6.6svh), 88px)
--topbar-avatar-em: --topbar-avatar × 0.50
--topbar-name:   clamp(12px, min(3.2vw, 2svh), 22px)
--topbar-name-max: --topbar-avatar × 2.4
--topbar-elo:    --topbar-btn × 0.32
--topbar-badge:  --topbar-btn × 0.40
```

**Bottom nav custom properties on `.em-bottom-nav`:**
```
--nav-icon:   clamp(22px, min(6vw, 3.6svh), 44px)
--nav-label:  --nav-icon × 0.40
--nav-pad-y:  --nav-icon × 0.42
--nav-gap:    --nav-icon × 0.12
```

**Resulting topbar button / nav icon sizes:**

| Viewport | Topbar btn | Avatar | Nav icon |
|---|---|---|---|
| iPhone SE 375×667 | 28px | 42px | 22.5px |
| iPhone XR 414×896 | 31px | 46px | 25px |
| iPad Air 820×1180 | 53px | 78px | 42.5px |
| Surface Pro 7 912×1368 | 60px (cap) | 88px (cap) | 44px (cap) |
| Nest Hub 1024×600 | 27→28px (min) | 40→42px (min) | 22px (min) |
| Desktop 1920×1080 | 49px | 71px | 39px |

**Also updated:**
- `:root --em-topbar-h` calc now uses the new button formula so screens still offset correctly below the fixed bar.
- Removed the `.em-nav-icon` and `.em-bottom-nav padding` overrides from `@media (max-height: 700px)` — the `svh` term in the new formula handles short heights inherently.
- Removed the stale `.em-home .hlogo img { max-width: 525px !important; }` rule (duplicate of the proportional rule declared earlier).

**Files changed:**
- `menu-electric.css` — topbar and bottom-nav refactored to use custom-property scale; stale logo duplicate removed; `:root` topbar-height calc updated.

---

## Home Screen Tablet Sizing — Raise Upper Caps (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** The proportional `min(vw, svh)` formulas on `.em-platforms` were correct, but the upper clamp values (`210px` online, `140px` secondary, `460px` logo) were tuned for phones and kicked in too early on tablets — iPad Air 820×1180 and Surface Pro 7 912×1368 hit the cap and stopped scaling, making the circles look small relative to the viewport.

**Fix:** Raised the upper bounds. The proportional formula now keeps scaling through tablet viewports and only clamps on 4K+ displays.

| | Lower bound | Upper bound (was → now) |
|---|---|---|
| `--circle-online` | 140px | 210 → **420** |
| `--circle-secondary` | 94px | 140 → **280** |
| Logo `max-width` | 200px | 460 → **720** |

**Resulting sizes:**

| Viewport | Online circle | Secondary | Logo |
|---|---|---|---|
| iPad Air 820×1180 | 330 (was 210) | 224 (was 140) | 531 (was 460) |
| Surface Pro 7 912×1368 | 383 (was 210) | 260 (was 140) | 615 (was 460) |
| Desktop 1920×1080 | 302 | 205 | 486 |
| 4K 3840×2160 | 420 (clamp cap) | 280 (clamp cap) | 720 (clamp cap) |
| iPhone XR 414×896 | 199 (unchanged) | 132 (unchanged) | 339 (unchanged) |
| Nest Hub 1024×600 | 168 (unchanged, svh-limited) | 114 (unchanged) | 270 (unchanged) |

**Files changed:**
- `menu-electric.css` — raised the `clamp()` upper bounds on `--circle-online`, `--circle-secondary`, and `.em-home .hlogo img max-width`.

---

## Home Logo Proportional Sizing (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Extended the home screen's proportional size system to cover the "בוסט" logo. Previously the logo width was set by three stacked breakpoint clamps in `styles.css` (`base`, `min-width:600`, `min-width:900`) plus a short-display override in `menu-electric.css` that caps it to `clamp(210px, 54vw, 278px)` at `max-height:700px` — leaving iPhone SE 375×667 with a noticeably smaller logo than iPhone XR 414×896.

**Fix:** Added a single proportional rule in `.em-home .hlogo img`:

```css
max-width: clamp(200px, min(82vw, 45svh), 460px) !important;
```

`min(82vw, 45svh)` lets the smaller viewport dimension constrain the size. Phones (width-limited) hit the `82vw` term and get a big logo (~80% viewport width). Short landscape displays (Nest Hub 1024×600) hit the `45svh` term and the logo stays at ~15% viewport height (3:1 aspect → width ≈ 45svh).

**Resulting widths:**
- iPhone SE 375×667: min(307, 300) = **300px** (was 210px capped)
- iPhone XR 414×896: min(339, 403) = **339px** (unchanged)
- Nest Hub 1024×600: min(839, 270) = **270px** (was 278px capped)
- iPad portrait 768×1024: min(630, 461) = **461px** clamped to 460
- Desktop 1440×900: min(1181, 405) = **405px**

**Files changed:**
- `menu-electric.css` — added `.em-home .hlogo img` rule; removed the now-redundant logo cap from the `@media (max-height: 700px)` block.

---

## Home Screen Proportional Size Scale (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Replaced the home screen's per-breakpoint hardcoded `clamp(NN, Xvw, NN)px` values for circles, icons, and fonts with a single proportional size system. Six CSS custom properties on `.em-platforms` derive every dimension from one base — `clamp(140px, min(48vw, 28svh), 210px)` for the online circle, `clamp(94px, min(32vw, 19svh), 140px)` for secondaries — so the three game-mode circles, their icons, and their text scale together across phones, tablets, and short displays.

**Why min(vw, svh):** On phones (width-limited) the `vw` term constrains size; on short landscape displays like Nest Hub (1024×600, height-limited) the `svh` term constrains size. Same proportions everywhere, no per-device tuning.

**Derived ratios (from a single circle base):**
- Icon = circle × 0.45 (online) / × 0.42 (secondary)
- Title font = circle × 0.082 (online) / × 0.102 (secondary)
- Subtitle font = circle × 0.052 (online) / × 0.078 (secondary)
- Internal flex gap = circle × 0.045
- Text container max-width = 70% (geometrically fits inside the narrowing bottom curve at the centered text-block's y-position for both online and secondary circles)

**Key changes (`menu-electric.css`):**
- Added six size custom properties (`--circle-online`, `--circle-secondary`, `--icon-*`, `--title-*`, `--sub-*`, `--gap-*`) on `.em-platforms`.
- Refactored `.em-circle-btn`, `.em-circle-btn--online`, `.em-circle-icon`, `#home-globe`, `.em-circle-title`, `.em-circle-sub`, `.em-platform-col` to read from these vars.
- Removed the hardcoded `@media (max-height: 700px)` circle/icon/font overrides (they are now redundant — `min(vw, svh)` handles the short-height case proportionally). Kept the chrome-only adjustments (logo size cap, nav spacing).
- Removed the `@media (min-width: 400px)` title font bump for the same reason.

**Files changed:**
- `menu-electric.css` — `.em-platforms` size vars added; circle/icon/font rules refactored; redundant media queries deleted.

---

## Short-Screen Home Layout Fix — Online Subtitle + Size Contrast (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** On devices with viewport height ≤ 700px (iPhone SE 375×667, Nest Hub 1024×600), the home screen's `@media (max-height: 700px)` rule hid all `.em-circle-sub` subtitles and left `.em-platform-col` at its base width (120-140px) while shrinking secondary buttons to 100-118px, leaving an empty halo that made the secondary row read as visually wider than the online circle. (Superseded by the proportional scale refactor above.)

---

## Home Icon + Two-Player SVG Update (May 2026)

**Branch:** `claude/icon-button-emoji-updates-UfFOM`

**Summary:** Two UI-only changes to `partials/screens/home.html`. No game logic, Firebase, or test files touched.

**Key changes:**
- **Home icon button**: Changed the top-bar "active page" icon from `⚡` to `🏠` — a house emoji more clearly communicates "you are on the home screen."
- **Two-player platform orb SVG**: Replaced the static two-person SVG with an updated version featuring explicit upper-body silhouettes (head circles + shoulder arcs) and an **animated bright encompassing line** — a double-layer ellipse trace (soft glow halo + crisp bright core) that continuously circles both figures using `stroke-dasharray`/`stroke-dashoffset` animation at 2.8 s per cycle.

**Files changed:**
- `partials/screens/home.html` — home icon emoji swap; two-player SVG replacement

---

## Main Menu Icon Upgrades — Spinning Globe + Custom SVGs (May 2026)

**Branch:** `claude/main-menu-emoji-updates-aGqo4`

**Summary:** Replaced the three emoji icons on the main menu platform cards with richer custom graphics. UI-only change — no game logic, Firebase, or test files touched.

**Key changes:**
- **Online platform orb**: Replaced `🌐` with a live canvas spinning globe (same orthographic renderer as the online-lobby title). The globe renderer was extracted into `src/ui/globeRenderer.js` to be shared between `onlineLobbyScreen.js` and `menuScreen.js`. `menuScreen.js` now starts/stops the globe on mount/unmount via `#home-globe` canvas.
- **Two-players platform orb**: Replaced `👥` with a custom inline SVG showing two layered person silhouettes in the game's blue palette (with subtle glow filter).
- **Bot platform orb**: Replaced `🤖` with a custom inline SVG robot featuring glowing square eyes, body indicator lights, and an **electrical pulse animation** — a glowing circle that travels from the antenna base up to the tip using SVG `<animate>` elements at 1.8 s per cycle.
- **CSS additions** in `menu-electric.css`: `#home-globe` (83% fill, border-radius 50%) and `.home-icon-svg` (1.15em square, `overflow: visible` for glow filters).

**Files changed:**
- `src/ui/globeRenderer.js` *(new)* — shared globe canvas renderer
- `src/ui/screens/onlineLobbyScreen.js` — imports shared renderer; removed duplicated LAND/startGlobe
- `src/ui/screens/menuScreen.js` — imports shared renderer; starts home globe on mount
- `partials/screens/home.html` — replaced emoji text with `<canvas>` and inline `<svg>`
- `menu-electric.css` — sizing rules for home globe and SVG icons

---

## Electric Floating Platforms Menu — Stage 5 Polish Fixes (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Three UI polish fixes reported via screenshot. CSS and SVG only — no JS or functionality changed.

**Key changes:**
- **Zigzag lightning**: Replaced smooth `Q` quadratic-bezier branches with multi-kink `L`-polyline zigzag paths (5 kink points per branch). Added a second overlapping strand per branch with slightly offset kink positions for a layered multi-filament lightning look. Branch endpoints pulled up from y=212 to y≈162 so they don't protrude below the secondary platform buttons. Removed stray terminal `<circle>` nodes.
- **Equal platform borders**: Primary platform border confirmed `2px` matching secondary (was `3px` in earlier stage).
- **Centered profile name**: `.em-profile-info` changed from `text-align: right` to `align-items: center` so the player name centers above the ELO badge.

---

## Electric Floating Platforms Menu — Stage 4 Gap-Report Pass (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Implements UI gap-report findings. CSS, manifest, index.html only — no JS or functionality changed.

**Key changes:**
- **PWA edge-to-edge**: `viewport-fit=cover` added to meta viewport (critical for iOS full-bleed). `theme_color`/`background_color` in `manifest.json` and `<meta name="theme-color">` updated to `#04081a`.
- **Near-black background**: `#sh.screen` background override removes the `#03759f` teal stop, replacing with `linear-gradient(165deg, #020614, #030818, #040b1e)`.
- **Safe-area top**: Topbar `padding-top` uses `max(clamp, env(safe-area-inset-top))` for notched phones.
- **3D slab bottom face**: Added `box-shadow: 0 9/12px 0 rgba(dark)` as crisp bottom edge — the CSS 3D slab trick. Combined with the large-offset lift shadow, platforms now visually stand on a ledge.
- **Border hierarchy**: Primary platform border `3px`, secondary `2px`.
- **Icon depth**: Secondary icons ≈ 70px; primary ≈ 80px. Both use `radial-gradient` with a specular highlight at top-left quadrant for a 3D sphere appearance. Deeper embed (−35/−46px).
- **Logo glow**: Multi-layer `drop-shadow` chain (7px → 22px → 52px bloom halo).
- **Bottom nav**: Taller (~80px via padding 10–14px). Nav icons 22–28px. Active item has a gold pill background. Top border replaced with CSS `mask` gradient fade.
- **Lightning pulse animation**: `emLightningPulse` fires a bright `drop-shadow` flash every 3.8s, staggered between main bolt and branches.
- **Particle drift**: `emParticleDrift` 14s slow translateY/X on the particle field layer.

---

## Electric Floating Platforms Menu — Stage 3 Depth Pass (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Stage 3 depth and floating-platform refinement. CSS and SVG only — no JS, IDs, or functionality changed.

**Key changes:**
- **Floating illusion**: Replaced ambient glow shadows with large Y-offset `box-shadow` (e.g. `0 26–34px 60–88px rgba(0,80,230,0.36)`) that mimics a shadow cast onto ground below a suspended object. Hover rises 4px, shadow stretches.
- **Metallic rim**: Taller (25–32px), wider (82–90%), stronger neon edge glow, specular highlight row at top.
- **Icon orbs**: Online icon 28% larger (68–84px), embedded 44px deep into primary rim. Secondary icons 50–62px, 30px embed. All orbs z:5, above rim z:2, so icon crowns the socket.
- **Lightning**: Center bolt adds extra zigzag kink; branch arms use quadratic bezier curves (`Q`) for organic energy-transfer feel. Larger halo stroke (9–11px), stronger blur.
- **Background depth**: `em-home::before` sparse particle field (12 tiny radial dots). Stronger radial glow behind primary platform. Diagonal light rays. Energy field opacity raised on `em-platforms::before`.
- **Vertical compression**: Platform row gap reduced ~35%. Bottom padding on platforms shifts cluster slightly upward. Logo margins tightened.
- **Top bar**: Avatar 12% smaller with inner glow ring. Icon buttons 8% smaller, tighter pill gap. ELO badge recolored from gold to electric blue.
- **Bottom nav**: ~15% shorter padding. Inactive items 50% opacity. Active home gold glow strengthened.

---

## Electric Floating Platforms Menu — Phase 2 Visual Polish (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Premium visual pass on the Phase 1 layout. CSS and SVG changes only — no JS, IDs, routing, or functionality changed.

**Changed files:**
- `menu-electric.css` — complete rewrite with premium platform architecture
- `partials/screens/home.html` — SVG lightning upgraded to double-path glow technique

**Key changes:**
- Platforms: icon orbs overlap button tops via `margin-bottom: -Npx`; metallic elliptical disk rim via `::before`; upper glossy highlight via `::after`; `overflow: visible` so rim protrudes; primary platform 1.5× wider with `emPrimaryPulse` glow animation
- Background: atmospheric radial glows + electric crack lines on `em-home::after`; energy field radials on `em-platforms::before`
- Lightning SVG: double-path technique (wide halo + sharp core per bolt); junction and terminal circle nodes; `em-lightning-main` / `em-lightning-branch` flicker animation in opposite phase; second filter `em-glow-sm` (2px blur)
- Top bar: icon buttons in glassmorphism pill container; circular buttons with neon border; ELO styled as glowing gold chip `⚡ ELO 1230`
- Bottom nav: 52% opacity on inactive items; gold active-home glow; tighter padding; `clamp()`-based sizing
- Animations: `emFloat` 3px / 4–6s alternate; `emPrimaryPulse` 4.5s; `emLightningFlicker` staggered; `prefers-reduced-motion` disables all movement

---

## Electric Floating Platforms Menu Redesign — Phase 1 (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Visual redesign of the main menu screen (`#sh`) into an "Electric Floating Platforms" premium hub. UI refactor only — no game logic, Firebase, or routing behavior changed.

**Changed files:**
- `partials/screens/home.html` — new layout: top bar (profile + ELO + icon buttons), BOOST logo, three floating platform cards, bottom navigation bar
- `menu-electric.css` (new) — all electric theme styles: dark navy, neon platform glow, floating animation, lightning SVG decoration, bottom nav, reduced-motion support
- `src/ui/screens/menuScreen.js` — added `OPEN_STATS`, `OPEN_FRIENDS`, `OPEN_NOTIFICATIONS` intents; ELO and avatar display in `render()`
- `src/main.js` — added handlers for new MENU_INTENTs; added `rating` and `avatar` fields to `MENU_REFRESH` payload
- `index.html` — added `<link>` for `menu-electric.css`

**New DOM IDs:**
- `#btn-notifications-home` — notification bell button in top bar
- `#home-elo-label` — ELO badge container (hidden when unauthenticated)
- `#home-elo-value` — numeric ELO text node
- `#online-badge` — moved from inside online button to inside notification bell

**New MENU_INTENT values:**
- `menu/openStats` — opens stats screen
- `menu/openFriends` — opens friends screen
- `menu/openNotifications` — opens online lobby (where async sessions are listed)

---

## Recent Changes (May 2026)

### Phase 1A Disconnect/Leave Flows (PR #203–206)

**Commits:**
- `dbd43192` Merge PR #206 — disconnect/leave E2E tests
- `75bd3d1b` Implement accumulating disconnect timer and app-close resign behavior
- `c1e801b5` feat: block live invite to mid-game recipient; push notification on invite send
- `15925e85` fix: detect closed tab even when Firebase WebSocket is unavailable
- `681fa025` fix: remove dangling onclick attributes on invite buttons; guard sw.js against chrome-extension:// URLs
- `500f66b0` fix: three phase-1A disconnect bugs + confirming tests
- `ef917f34` Add E2E tests for Phase 1A disconnect/leave flows; reveals PRESENCE_GRACE_MS regression

**Summary:** Phase 1A of disconnect/leave implementation complete. Covers: accumulating timer, app-close resign, tab-close detection without WebSocket, push on invite send, and blocking in-game recipient from receiving new invites.

---

### Online Mode Cleanup (PR #201)

**Commit:** `a6f35129` 1A complete

---

### Timer and Player Sync Bugs (PR #199–200)

**Commits:**
- `9667c6d3` Sync bottom row enable with timer/glow animation completion
- `3508719f` Fix rack visual lockout and timer/glow sync on opponent move

**Summary:** Fixed two visual sync bugs: rack buttons stayed locked during opponent's turn, and the score glow/timer didn't synchronize correctly.

---

### Random Opponent Matchmaking (PR #196–198)

**Commits:**
- `411b7af5` Fix friend invite dropdown: use module-level vars instead of boot() closure
- `d1d9249d` Implement friend invite dropdown in waiting-room screen
- `58b5e88a` Fix three bugs that prevented opponent disconnect/quit notifications
- `09baff3f` Fix matchmaking never pairing: null-coalesce empty queue snapshot

**Summary:** Implemented friend invite dropdown in waiting room. Fixed matchmaking pairing bug (null snapshot). Fixed three disconnect notification bugs.

---

### Search Partner Overlay / Globe Animation (PR #193–194)

**Commits:**
- `ac213b7b` Replace SVG globe with canvas globe with continents + proper 3D spin
- `beb7dd3a` / `9a7fed0d` Increase longitude offset increment in animation

**Summary:** Replaced SVG globe animation with canvas-rendered 3D globe with continent rendering and proper spin.

---

## Older History

Git log shows commits beyond PR #193 are not included in the last 30. To view full history:

```bash
git log --oneline
git log --since="2026-01-01" --oneline
```

The repository has been active through at least 206 pull requests based on visible PR numbers.

---

## Version Notes

- **Build version:** `boost-20260525044525` (cache name from `sw.js`, updated by `stamp-build.js`)
- **Firebase SDK:** v10.13.0
- **Playwright:** 1.60.0
- **Firebase Tools:** 15.18.0
- **`@firebase/rules-unit-testing`:** 5.0.1
- **Gradle:** 8.4 (Android wrapper)
