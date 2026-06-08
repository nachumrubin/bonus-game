# CHANGELOG.md — Change History

---

## Stats screen: new "תובנות" tab — player insights, archetype, trends, milestones — June 2026

Feature request: turn the stats area from a data dashboard into a personalised analytics experience that helps users understand themselves and stay motivated.

**Tabs reordered** to `תובנות | התקדמות | שיאים | יריבים` — "תובנות" (Insights) is the first/default tab. The existing three quantitative tabs are unchanged.

**New pure module** [src/game/account/playerInsights.js](src/game/account/playerInsights.js): `deriveInsights(profile, now) → { insights, archetype, trends, wordIntel, playStyle, weekSnapshot, opponents, milestones, didYouKnow }`. All derivation comes from existing `profile.stats` — no schema changes, no Firebase writes. The module is platform-free and unit-tested.

Sections rendered into `#st-panel-insights`:

1. **🧠 תובנות עליך** — dynamic Hebrew sentences (recent form, strongest weekday, bonus-score correlation, close-win specialty, comeback record, improving trend). Generated from `recentGames` + `weekdayStats`. Cards are suppressed unless the signal is clearly above noise (e.g. close-win pill needs `closeWins/wins ≥ 0.4` with `≥5` wins).
2. **🎭 הסגנון שלך** — archetype identity card: 🆕 חוקר / 📚 מומחה לאוצר מילים / 🔥 לוקח סיכונים / 🏹 שחקן מדויק / 🧠 שחקן אסטרטגי / ⚡ חושב מהיר / 🎯 שחקן עקבי / 🃏 שחקן כל-תחומי. One-line explanation paragraph; selection order is "most distinctive first".
3. **📈 מגמות** — four trend chips: win-rate %, average score, weekly activity, ELO. Win-rate / avg-score deltas come from comparing first half vs second half of `recentGames` (copy says "ב-N המשחקים האחרונים", honest about the window). ELO has no historical snapshot, so it shows `current / nextTierFloor` plus a tier progress bar instead of a "+42 this week" delta.
4. **📅 השבוע שלך** — four-KPI grid (games / wins / streak / avg) filtered to `recentGames` whose `ts >= now - 7d`.
5. **📚 ניתוח מילים** — avg word length (weighted by `wordCounts`), longest word + length, best single-move score, avg points per move, most-used word length. Each row falls back to "טרם נמדד" / "טרם הושג" rather than `—` when missing — motivating empty states per the brief.
6. **⚙ סגנון משחק** — five horizontal progress bars: bonus usage, long words, consistency, speed, risk-taking. Each has a one-line hint explaining what the bar means.
7. **👥 היריבים שלך** — four picks from `rivalStats`: 👑 biggest rival (most played) / 🤝 favorite opponent (most wins) / 🔥 most competitive (closest to 50/50, ≥3 games) / 🏆 best record (highest winPct, ≥3 games). Missing categories show "טרם זמין" instead of an empty row.
8. **🎯 היעד הבא** — milestones with progress bars: next ELO tier, next 50-point high-score round, next streak level. Always shows at least one milestone so the section never feels blank.
9. **💡 ידעת?** — single rotating fact at the bottom, picked from a computed pool keyed by `gamesPlayed % pool.length` (stable between renders, advances naturally as the player plays more).

**Files**

- [src/game/account/playerInsights.js](src/game/account/playerInsights.js) — pure derivation module
- [src/game/account/playerInsights.test.js](src/game/account/playerInsights.test.js) — 23 unit tests covering every section
- [src/ui/screens/statsScreen.js](src/ui/screens/statsScreen.js) — new `paintInsightsPanel` + section renderers; `tabFromButton` now recognises "תובנות"
- [partials/screens/stats-screen.html](partials/screens/stats-screen.html) — new tab button + `#st-panel-insights` markup
- [styles.css](styles.css) — new `#st-panel-insights .ins-*` section (~250 lines) using the dark-navy gradient + gold accent language established for `#smygames`
- [tests/e2e/capture-stats-insights.spec.js](tests/e2e/capture-stats-insights.spec.js) + [images/guide/stats-insights.png](images/guide/stats-insights.png) — visual reference

**Honesty about data limits**

Three things the brief mentions need data we don't track yet:
- `ELO +42 this week` would require per-day rating snapshots → replaced with `X / nextTierFloor` and a tier progress bar.
- `Best word this week` would require per-word timestamps → not surfaced; `Longest word ever` is shown instead.
- `Win rate +8% this month` would require monthly aggregates → replaced with first-half vs second-half of `recentGames`, copy says "ב-N המשחקים האחרונים".

Adding the missing tracking is deferred to a follow-up task (would need schema additions in `profileService.computeLiveGameStatsDelta` + write-side changes in `mergeWordStats` for dated words).

**Tests**

- `playerInsights.test.js` — 23/23 pass: empty-profile fallback, recent form, bonus correlation, strongest day, comeback insight, every archetype branch, two-halves win-rate trend, 7-day activity window, ELO milestone, weighted avg word length, play-style range, week snapshot filter, opponent picks (rival/favorite/competitive/bestRecord), milestones, did-you-know stability.
- `statsScreen.test.js` — existing 3/3 still pass (the new paint path is additive).
- `npm run test:unit` — 178/178 still pass.

---

## "המשחקים שלי" v3: card layout, score-dominant typography, status pills — June 2026

Visual redesign of the saved-games screen. The previous list-row layout looked like a settings dialog; the new card layout is purpose-built for a casual mobile game.

- **One card per game** ([src/ui/screens/asyncGamesScreen.js](src/ui/screens/asyncGamesScreen.js)): each row is now `<div class="mg-card">` with rounded 18px corners, a navy gradient background slightly lighter than the page (`linear-gradient(160deg, rgba(40,68,118,.85), rgba(20,38,80,.85))`), a 1px brand-tinted border, and a soft outer shadow plus an inner highlight. Local-save cards get a faint gold border tint so the user can spot the offline-resume row at a glance.
- **Three-column grid** (identity / score / actions): avatar + opponent name + status pill on the start side, score block centred and visually dominant, Continue + dismiss on the end side. RTL is preserved by the natural flex direction (no `dir` overrides).
- **Score is the focus**: `<span class="mg-score-mine">42</span> : <span class="mg-score-theirs">17</span>` inside a gold-tinted radial-glow pill. Mine is 26px gold (`#ffe17a`), theirs is 22px white-85%, separator is muted. `font-variant-numeric: tabular-nums` keeps digits aligned across rows.
- **Status pill with emoji prefix**: replaces the plain grey metadata.
  - 🟢 תורך (`is-mine`, green tint)
  - 🕒 תור {opponent} (`is-theirs`, neutral) — time-ago line appears below
  - 💾 משחק שמור (`is-local`, gold tint)
  - 🔵 פג תוקף (`is-expired`, slate tint, card desaturated)
- **Continue button** ([styles.css](styles.css) `.mg-resume`): linear-gradient gold (`#ffd84a → #dcaf28`), 12px rounded, drop-shadow "lift" with inset top highlight, press-state transforms by 2px and shrinks the shadow.
- **Dismiss is now secondary**: the floating × at row end is replaced with a 🗑 trash icon at 30% opacity, brightens to red-tinted on hover. Same `data-mg-dismiss` attribute (no behaviour change).
- **Header replaces the giant footer button**: 36px back-arrow on the start side, centred "המשחקים שלי" title in brand gold, optional count badge (`<span id="mg-count">`) showing the total — populated by the JS render path, hidden via `:empty` selector when zero. The screen no longer has a full-width footer button; back navigation lives in the header.
- **Empty state** ([partials/screens/async-games-screen.html](partials/screens/async-games-screen.html)): 🎮 + bold Hebrew copy + small subtitle, replaces the single-line "no games" text.
- **Narrow-screen breakpoint** (`max-width:380px`): tightens card padding, shrinks avatar + score type one size, narrows the Continue button — keeps the three-column layout intact rather than wrapping.

CSS lives in a new section at the bottom of [styles.css](styles.css) (~150 lines, all `#smygames .mg-*` scoped). No global rules touched; the redesign cannot affect any other screen.

Screenshot: [images/guide/my-games-screen.png](images/guide/my-games-screen.png), captured by the new spec [tests/e2e/capture-my-games-screen.spec.js](tests/e2e/capture-my-games-screen.spec.js) which seeds all four row states (local / my-turn / opponent-turn / expired) at a 414×896 portrait viewport.

Tests:
- [src/ui/screens/asyncGamesScreen.test.js](src/ui/screens/asyncGamesScreen.test.js) — updated row-shape assertions for the new HTML (`mg-score-mine`/`theirs` spans, `mg-status is-mine`/`is-local`/`is-expired` classes, 🟢/💾/🔵 status icons, 🗑 dismiss icon). Added a coverage for the new header count badge (`#mg-count` shows `3` for three sessions and is cleared on the empty state). 12/12 pass.
- `npm run test:unit`: 178/178 pass. No functionality changed.

---

## "המשחקים שלי" v2: local saved game folded in, home-screen resume button removed, wider modal — June 2026

Follow-up on the new screen. Two changes from the user:

1. **Removed the floating "המשך משחק" play button** from the top-right of the home screen ([partials/screens/home.html](partials/screens/home.html)) — its job is now covered by the unified list. Cleaned up the visibility logic in [src/ui/screens/menuScreen.js](src/ui/screens/menuScreen.js) (the `#btn-resume-home` / `#resume-col` references, the `hasLocalSavedGame` import, the `'button[onclick="resumeSavedGame()"]'` `SCREEN_BUTTONS` selector, the `hasSavedGame` field in initial-render) and the test that exercised it.
2. **Local saved offline game now appears in the list**. [src/main.js](src/main.js) `refreshMyGamesList` synthesizes a row for the localStorage save (if any) via a new `buildLocalGameRow` helper using `loadLocalGame(localStorage)`; the row is prepended above online sessions and carries `isLocal: true` plus a sentinel `roomId: '__local__'`. The `MG_INTENT.RESUME` handler branches on the sentinel and calls `resumeLocalGameViaSpine()` instead of `resumeRoomById`; `MG_INTENT.DISMISS` branches to `clearLocalGame()` instead of `dismissForUid`.
3. **Wider modal**. [partials/screens/async-games-screen.html](partials/screens/async-games-screen.html) bumped from `max-width:340px` to `max-width:min(460px,94vw); width:100%` so the avatar + name + time-ago + score + two action buttons all fit comfortably on a single row. Screen-module score column widened slightly (`min-width:60px`, `white-space:nowrap`) to accommodate three-digit scores.
4. **Row UX for local games**: turn label is "משחק שמור" (rather than "תורך"), a 💾 badge sits in front of the opponent name to make the row visually distinct from online sessions.

`MENU_INTENT.RESUME_SAVED` and the `bus.on` handler stay — they're called by the existing offline → bot/2P flow as the fallback when no online sessions are found.

Tests: added `buildRowHtml: isLocal row shows the "saved game" label + 💾 badge but keeps Resume + ×` in [src/ui/screens/asyncGamesScreen.test.js](src/ui/screens/asyncGamesScreen.test.js). Removed `MENU_REFRESH event toggles the resume button visibility` from [src/ui/screens/menuScreen.test.js](src/ui/screens/menuScreen.test.js) along with the `buttons.resume` DOM stub. `npm run test:unit` — 178/178 pass.

---

## New screen: "המשחקים שלי" — async-online games list — June 2026

Feature request: a dedicated screen so users can easily return to any of their in-flight async online games. Reachable from the home screen's bottom nav.

- **New screen `#smygames`** ([partials/screens/async-games-screen.html](partials/screens/async-games-screen.html)): a scrollable list of every active async game the user is in, plus expired games (filtered out of the lobby strip) so users can see why a game ended and dismiss it. Each row shows: opponent avatar + name, score (you : them), whose turn + time since last move, "המשך" button to resume (active games), "×" button to remove from the per-user index (active and expired alike).
- **Bottom-nav button** on the home screen ([partials/screens/home.html](partials/screens/home.html)): "🎮 המשחקים שלי" — first item in the row.
- **New screen module** [src/ui/screens/asyncGamesScreen.js](src/ui/screens/asyncGamesScreen.js): exports `mountAsyncGamesScreen`, `MG_INTENT` ({ RESUME, DISMISS, BACK }), `MG_RENDER`. Purely presentational — emits intents on click; the screen module never touches Firebase directly.
- **Service extension** [src/game/online/asyncSessionService.js](src/game/online/asyncSessionService.js): `listAsyncSessions(db, uid, { includeExpired })` and `watchAsyncSessions(..., opts)` now accept an `includeExpired` flag. Expired rooms surface with `isExpired: true` and always sort to the end. Sessions also expose `myScore` / `opponentScore` from `room.scores`. Default behaviour unchanged for callers that don't pass the flag (lobby strip stays unaffected).
- **Wiring** [src/main.js](src/main.js): mounts the new screen, adds `globalThis.openMyGames`, routes `MENU_INTENT.OPEN_MY_GAMES → showLegacyScreen('smygames')`, fetches the list with `{ includeExpired: true }` on open, re-fetches after each dismiss. Resume reuses the existing `resumeOnlineRoomById` flow; back button calls `goHome()`.
- **Screen ID registration**: added `'smygames'` to [src/ui/screens/screenTransitions.js](src/ui/screens/screenTransitions.js) `SCREEN_IDS` and to the screens array in `showLegacyScreen`. Partial path registered in [src/ui/screenPartialManifest.js](src/ui/screenPartialManifest.js).
- **Menu intent**: added `MENU_INTENT.OPEN_MY_GAMES` and a `SCREEN_BUTTONS` selector in [src/ui/screens/menuScreen.js](src/ui/screens/menuScreen.js) so the new bottom-nav button is routed through the bus like the other home-screen buttons.

Tests:
- [src/ui/screens/asyncGamesScreen.test.js](src/ui/screens/asyncGamesScreen.test.js) — 10 cases covering time-ago bucketing, row HTML (active vs expired), HTML escaping, MG_RENDER paint + empty state, and click delegation for resume/dismiss.
- [src/game/online/asyncSessionService.test.js](src/game/online/asyncSessionService.test.js) — added `includeExpired` surfaces expired rooms at the end; verified `summarizeForUid` returns scores. Existing 14 cases still pass.

`npm run test:unit` — 178/178 pass.

---

## Async push: sender-side TURN push so the opponent actually gets notified — June 2026

User-reported: no push notification arrived when the opponent completed a move in an async online game.

Root cause in [src/notifications/notificationService.js attachBusSubscriptions](src/notifications/notificationService.js): the `EV.TURN_CHANGED` handler fired the push from the **recipient's** side, not the sender's. The condition `if (currentTurnSlot !== s.mySlot) return;` meant "only push when it's MY turn now, and push myself (`externalIds: [s.myUid]`)". For this to deliver, the recipient's browser had to be online and listening when `TURN_CHANGED` synced in — exactly NOT the case for async play (closed tab, screen off, app dismissed). The buggy assumption was even encoded in the existing tests.

Fix: split the `TURN_CHANGED` handler by `pushOnMove` mode.

- **Async (`pushOnMove: 'always'`)** now fires from the SENDER (active player who just moved). Trigger: `currentTurnSlot !== mySlot` (our move just left our slot). Target: opponent's `externalIds: [opponentUid]` plus `subscriptionIds: [opponentSubscriptionId]` when available. The push body's `opponentName` is set to `myName` because from the recipient's POV we are their opponent. The Cloudflare push worker ([worker/src/index.js](worker/src/index.js)) doesn't restrict `externalIds` to the caller's UID, so the sender-targets-opponent flow works end-to-end.
- **Live (`pushOnMove: 'ifBackgrounded'`)** keeps the existing receiver-side behavior: both players are typically online, only the receiver can detect its own foreground/background state, so it self-pushes when the tab is hidden. No change.

Wired `myName` (the active player's display name) into the `sessionRef` getter in [src/main.js](src/main.js) so the push body is correctly labelled.

Tests in [src/notifications/notificationService.test.js](src/notifications/notificationService.test.js): flipped the original async test (now asserts the sender pushes the opponent, that `include_aliases.external_id` and `include_subscription_ids` target the opponent, and that the body contains `myName`); added an externalIds-only fallback test for opponents without a subscriptionId. All 178 unit tests pass.

---

## UI: clicking a pending lock now reliably returns it to the bucket — June 2026

User-reported: double-clicking a pending lock that was placed by mistake left the lock visually unchanged; only the בטל (undo) button could remove it.

Root cause in [src/ui/screens/gameScreen.js onCellClick](src/ui/screens/gameScreen.js): a single click on a pending-lock cell DID clear it (via the toggle hidden inside `setPendingLock`), but the cell then fell through to the "quick-place a lock" branch which has no awareness of the previous click. On a fast double-tap the second click re-placed the lock at the same cell — so the user saw the lock blink and reappear.

Fix:
- Added an explicit early-return for pending-lock cells in `onCellClick`, mirroring the existing `pendingSwap` handling (clear and return immediately, no fallthrough to quick-place).
- Armed a brief (500ms) per-cell suppression window after a pending lock is cleared via cell click. The quick-place branch checks `suppressQuickPlaceAt` at the same `(r, c)` and skips placement during that window — so the second tap of a double-tap is absorbed instead of re-placing the lock.

The window is per-cell, short, and only active immediately after the user-driven clear. Single-click behavior is unchanged for everyone (the cell click still removes the lock). 178 unit tests still pass.

---

## Engine: swap-displaced board letter usable in the same move — June 2026

User-reported bug: a player swapped the on-board ש with their rack ו (via "החלפת אות" tile-swap), then placed the displaced ש in a new word (שוקל) in the same move — the engine rejected the move with `placed-not-in-rack`.

Root cause in [src/game/core/gameEngine.js handleConfirmMove](src/game/core/gameEngine.js): the rack-defense loop validated every `placed` and swap-in letter against the *original* rack, but never credited the rack with the letter that the swap *released* from the board. The UI (see [gameController.js displayRackTile](src/ui/controllers/gameController.js)) intentionally surfaces the displaced letter at the swap's rack slot exactly so it can be played the same turn — legacy parity (`racks[turn][rackSlot] = returnedLetter`) — so the engine was the one out of sync.

Fix: split the single rack-validation loop into two passes. First process swaps (consume swap-in from rack copy, push the displaced board letter onto the rack copy); then validate `placed` against that effective rack. Net rack delta and bag-parity invariants are unchanged; only the rejection condition relaxes.

Regression test in [tests/unit/engine-placed-not-in-rack.test.js](tests/unit/engine-placed-not-in-rack.test.js): swap board-`ב` ⇄ rack-`ו` and reuse the displaced `ב` to form `באו` — pre-fix this rejected with `placed-not-in-rack`; post-fix it commits cleanly and conserves tile total. All 178 unit tests pass.

---

## Online ghost-tile race: synchronous rollback + late-commit gate — June 2026

A "last-second" CONFIRM_MOVE could leave the active player staring at tiles that the server never accepted. Reported flow: P1 confirms right as the deadline hits, P2's watchdog wins the version race, P1's commit aborts, but P1 keeps seeing their tiles on screen until P2's *next* move arrives and overwrites the cells. Score reverted correctly (forceResync replaced `state.scores`), tiles did not — because the rollback was async and depended on a successful `readRoom`, and in some real-world conditions that round-trip is slow or silently fails.

Two-layer fix in [src/game/sessions/onlineGameSession.js](src/game/sessions/onlineGameSession.js):

1. **Synchronous rollback snapshot.** `dispatch()` now captures board / scores / racks / moveHistory / bag / activeBoosts / bonusBoard / bonusSqUsed / pendingBonuses / locks / currentTurnSlot / turnNumber / passCount / firstMove / turnDeadlineMs *before* `engine.dispatch(CONFIRM_MOVE)` mutates them. The `MOVE_CONFIRMED` handler claims the snapshot and, on `committed: false`, restores in-place and emits `TURN_CHANGED { reason: 'commit-rollback' }`. `forceResync` still runs afterward as belt-and-suspenders, but the visible-flash window is gone even if `readRoom` hangs.
2. **Late-commit gate.** `dispatch()` refuses `CONFIRM_MOVE` outright when `Date.now() > state.turnDeadlineMs + DEFAULT_WATCHDOG_GRACE_MS`. The watchdog has (or imminently will) claim — our commit cannot win, and running the engine would just produce a tile-drop animation we'd have to reverse. Emits `INVALID_MOVE_REJECTED { reason: 'turn-expired' }` so the player gets feedback.

Surfacing in the UI: [src/ui/screens/gameScreen.js](src/ui/screens/gameScreen.js) gains a new `turn-expired` mapping in `invalidReasonText` → "הזמן שלך נגמר — התור עובר ליריב" (status-bar text the active player sees on the disallowed click).

**Test coverage** in [tests/unit/online-ghost-move-rollback.test.js](tests/unit/online-ghost-move-rollback.test.js):
- *synchronous rollback*: stubs `transaction` to return `committed: false` AND `.get()` to hang forever, then asserts `state.board[4][4]` and the active rack are restored after a few microtask ticks — proves the rollback runs without any network help.
- *late-commit gate*: seeds `turnDeadlineMs = now - 5s` and asserts `dispatch({ type: CMD.CONFIRM_MOVE, ... })` emits `INVALID_MOVE_REJECTED { reason: 'turn-expired' }` and leaves the board untouched.

177 unit tests pass (175 prior + 2 new).

**Note for the deferred-score / bonus-mini-game path:** the snapshot is intentionally NOT used when `MOVE_CONFIRMED` fires with `scoringDeferred: true`. Rolling back across a played mini-game (wheel spin, word-search etc.) would require undoing bonus-flow state and isn't viable as a safety net. That path keeps the existing `forceResync` recovery only.

---

## Crossing-words mini-game: in-tile input + word-revealing result — June 2026

The B10 "שתי מילים חוצות" boost previously asked the player to type the missing letter into a separate `<input>` underneath the crossing grid, and the result overlay only said "correct/incorrect" plus the shared letter in isolation. Two small UX fixes:

- [src/ui/screens/miniGames/crossingWordsMiniGame.js](src/ui/screens/miniGames/crossingWordsMiniGame.js): `buildMiniGrid` now accepts `{ withInput: true }` and embeds the single-letter `<input>` directly inside the `?` crossing cell (transparent background, gold caret/color, RTL, `maxLength=1`). The separate input below the grid in both `attachLegacy` and `attachSelf` is gone. Enter-key submission was added so the player doesn't have to mouse to "בדוק".
- `renderResult` now spells out the completed pair on every outcome:
  - Success → shows the two words the player's letter built (green).
  - Wrong letter → shows the (invalid) pair the player typed, then the correct pair below.
  - Timeout → shows the correct pair only.
- All 13 mini-game unit tests still pass; the no-DOM test path is unchanged because the rewrite is confined to `buildMiniGrid`, `attachLegacy`, `attachSelf`, and `renderResult`.

---

## Boost mini-game screenshots in the guide — June 2026

The guide section "בונוסים ומיני-משחקים" only described the mini-games in prose. Captured six screenshots — one per mini-game — and embedded them with bilingual captions.

### What was added
- New Playwright spec [tests/e2e/capture-minigame-screenshots.spec.js](tests/e2e/capture-minigame-screenshots.spec.js) — boots the app, calls each `window.__spine.ui.mount*MiniGame` with a seeded mulberry32 RNG (so re-runs produce visually identical captures), and snaps the `#ov-bonus` overlay (or the wheel's self-host).
- Six new PNGs under [images/guide/minigames/](images/guide/minigames/): `wordsearch.png`, `honeycomb.png`, `unscramble.png`, `crossing.png`, `fill-middle.png`, `wheel.png`.
- [partials/screens/guide-screen.html](partials/screens/guide-screen.html): each `<figure class="guide-shot">` block under the bonuses section, prefixed with the matching emoji from the mini-game's overlay icon.

### Tiny supporting change
- [src/main.js](src/main.js): `mountFillMiddleMiniGame` was imported but not exposed on `window.__spine.ui`. Added it to the registration block so the capture spec (and any future external harness) can drive that mini-game like the others. Pure addition — no production code path changes.

### Re-running the captures
```
npx playwright test tests/e2e/capture-minigame-screenshots.spec.js
```
Spec finishes in ~12s. RNG seeds are fixed per-test so the diffs against committed PNGs only show real layout changes.

**Verification:** 175/175 unit tests pass; all 6 capture tests pass.

---

## Cherry-pick from `online-game-fixes` branch — June 2026

The `online-game-fixes` branch (commit `29d6ef03 מדריך הדרכה fixes and othe bug fixes`) carried genuine additive bug fixes that never landed on `main` because it had also rolled back a stack of features the current branch has since gained (portrait orientation lock, rotate-block overlay, connectivity indicator, gender propagation, native back-button handler). A naive merge would have wiped those.

Surgical port of only the additive bits:

### Guide screen — embedded screenshots
- Six PNGs under [images/guide/](images/guide/) — `home.png`, `signup.png`, `stats.png`, `game-screen.png`, `exchange-overlay.png`, `shailta-overlay.png`.
- [partials/screens/guide-screen.html](partials/screens/guide-screen.html): `<figure class="guide-shot">` blocks inserted into the rules/screens sections, plus a brand-new "פעולות מיוחדות בתור" section covering exchange / שאילתה / lock / joker / recall.
- [styles.css](styles.css): new `.guide-shot` rule (caps width to 220px, adds border + shadow + caption).

### Signup form — confirm password + notify opt-in + show/hide
- [partials/screens/sign-up-screen.html](partials/screens/sign-up-screen.html): new אימות סיסמה field, "אני רוצה לקבל התראות" checkbox (checked by default), and a 👁 show/hide button next to both password fields.
- [partials/screens/log-in-screen.html](partials/screens/log-in-screen.html): same show/hide toggle on the login password.
- [styles.css](styles.css): `.pw-wrap`, `.pw-input`, `.pw-toggle`, `.su-checkbox-row` rules.
- [src/ui/screens/authScreens.js](src/ui/screens/authScreens.js): `validateSignupForm` now reads `passwordConfirm` + `wantsNotifications`, emits `pass-mismatch` if the confirm doesn't match. New `pwToggleBtns` loop wires every `.pw-toggle` to flip its target input between `type=password` and `type=text`.
- [src/main.js](src/main.js): the legacy `globalThis.signUpUser` shim and the `AUTH_INTENT.SIGN_UP` handler both pass the new fields through. The handler writes `wantsNotifications` onto the initial profile, and `bootCrossCuttingFor(uid)` reads it back before calling `notificationService.boot` — opted-out users skip the OneSignal prompt.

### Friends screen — `activeRoom` permission fix
- [src/main.js](src/main.js): the friend-detail panel was reading `users/{friendUid}/activeRoom`, which fails with `permission_denied` (other users' profile data isn't world-readable). Now reads only MY `activeRoom`, then checks whether the friend appears in that room's `players` list. Same approach the async-rooms scan already uses below.
- [src/ui/screens/friendsScreen.js](src/ui/screens/friendsScreen.js): recent-games row now renders with `direction:ltr` and gold-colored "mine" score so the layout reads `score : opponentScore icon` consistently regardless of RTL parent and regardless of which side has the higher number.

### Misc small fixes
- [partials/screens/game.html](partials/screens/game.html): שאילתה button got `id="btn-shailta"` for stable JS targeting.
- [src/ui/screens/dictionaryScreen.js](src/ui/screens/dictionaryScreen.js): new `DICT_INTENT.CLOSE_QUERY` event, fired when the שאילתה overlay closes — gives subscribers a clean hook.
- [src/main.js](src/main.js): easy bot (`difficulty === 0`) now uses only the first 7,000 dictionary entries (sorted by Hebrew word frequency, so common words first). Medium/Hard still see the full vocabulary.

### Explicitly NOT ported (would have rolled back current features)
- Removal of `applyGenderToRoot`, `data-gm`/`data-gf` attributes, `g('inviteToGame')` calls — current branch keeps the gender system.
- Removal of `screen.orientation.lock('portrait')` and `#rotate-block` overlay — current keeps them.
- Removal of `connectivityIndicator` + `startConnectivityMonitor` — current keeps the live wifi-icon indicator.
- Removal of the native back-button history-stack handler — current keeps the quit-overlay flow.
- The "pending lock" + `.cell.pending-lock` class — current branch already has the equivalent feature under `.spine-pending-lock-cell`.
- The "ם vs מ" / sofit-letter fixes — already on the current branch via the three `claude/final-form-letter-placement-nAfaC` merge commits (PRs #276/277/278) plus `f64be250 Fix: bot joker and תפזורת placing sofit letters on board tiles`.

**Verification:** 175/175 unit tests pass.

---

## Breathing gap below the global topbar — June 2026

Non-home, non-game screens (stats, settings, profile, friends, avatar gallery, etc.) had their first content element sitting flush against the bottom edge of the fixed `#global-topbar`. The padding-top offset was exactly `var(--em-topbar-h)`, which pushes content below the topbar but leaves zero visible gap.

Bumped the offset to `calc(var(--em-topbar-h) + 16px)` in [menu-electric.css](menu-electric.css). Single global rule that affects every secondary screen — no per-screen tweaks needed.

---

## Portrait-orientation enforcement (phones) — June 2026

`manifest.json` already pins `"orientation": "portrait"` for installed-PWA contexts, but that does nothing inside a normal browser tab. Added two layered defenses for the in-browser case:

1. **JS Screen Orientation API** ([src/main.js](src/main.js)): right after `[spine] booting…`, call `screen.orientation.lock('portrait')` inside a try/catch + `.catch(() => {})`. Succeeds inside fullscreen / installed-PWA windows on Android Chrome; silently rejects in plain tabs (browser security policy — no page can force orientation in a tab).

2. **CSS landscape-block overlay** ([styles.css](styles.css)): new `#rotate-block` element in [index.html](index.html) that fills the viewport with a "סובב את המכשיר למצב לאורך" message + rotating phone icon. Shown only when `(orientation: landscape) and (max-height: 500px)` — the `max-height:500px` clause restricts the block to phone-shaped viewports so tablets and desktop browsers in landscape stay interactive. The game keeps running underneath, so rotating back immediately resumes play.

### Why not block landscape unconditionally

The new layout caps `.gr` at `max-width:480px` and centers it. A tablet or desktop browser in landscape still shows the app correctly — just with empty margins. Blocking those viewports would punish users for no benefit. Phones in landscape, by contrast, lose the vertical space needed for the board + rack and end up unplayable, which is the case worth blocking.

---

## Layout unification follow-up: proportional scaling (no hard caps) — June 2026

The pixel caps on `.gr` (`max-width:480px` / `max-height:860px`) were the wrong model — they made the game a tiny fixed box on large displays. Replaced with proportional scaling: the container always fills 100% of the viewport height, and its width is `min(100%, calc(100svh * 9 / 16))`. This produces the largest phone-shaped rectangle that fits:

| Viewport | `.gr` size | Notes |
|---|---|---|
| 414×896 (phone) | 414×896 | Width is the limit → fills edge-to-edge, no dead margins |
| 600×1024 (dev-tools) | 576×1024 | Width derived from height → 9:16 portrait |
| 1920×1200 (desktop) | 675×1200 | Width derived from height → centered with side margins |
| 1024×600 (landscape tablet) | 337×600 | Width derived from height → narrow centered strip |

`#sg` uses `align-items:center; justify-content:center` so the container sits centered on both axes whenever it doesn't fill the viewport. The board's `--csz` is recomputed at mount/resize by `computeBasicSizes()` from the actual container size, so the board grows along with the container.

**Verification:** 175/175 unit tests pass.

---

## Layout unification: single phone-shaped layout at every viewport — June 2026

The game screen previously rendered two completely different layouts:

- **≤500 CSS-px**: info-strip with player score cards above the board, no side panels, text-only top bar (the WhatsApp-screenshot look).
- **>500 CSS-px**: tiny side panels with scores left/right of a smaller board, no info-strip, larger board cells, wider container.

Real phones in portrait reported ≤414 CSS-px (thanks to high DPR), so the info-strip layout was what users actually saw. The desktop branch was effectively dead code that only appeared in dev-tool resizing. Result: dev-tool screenshots at 539/600 CSS-px looked nothing like production.

### Change

`styles.css` — collapsed the two layouts into one:

- `.gr` outer container capped at `max-width:480px` always (was 480px on mobile, 680px base, 1200px on tablet, 580px on widescreen via `@media(min-width:600px)` / `@media(min-width:900px)`).
- `.left-panel` and `.right-panel` get `display:none !important` at the base rule. Selectors retained so existing DOM references in `gameScreen.js` (`#sb1`, `#sb2`, `#sv1`, `#sv2`, `#sn1`, `#sn2`, etc.) still resolve harmlessly.
- `.info-strip` defaults to `display:flex` with full background/min-height/padding styling (was `display:none` + a `@media (max-width:500px)` override).
- `.tbar`, `.tb`, `.sbar`, `.bot`, `.board-center`, `.ss-tiles`, `#bag-char svg`: the mobile rules were lifted out of the `@media (max-width: 500px)` wrapper and applied unconditionally.
- `.board-center-inner --csz`: single `clamp(22px, 6vmin, 42px)` rule. The `@media (min-width:501px)` bump to `clamp(30px, 5vmin, 54px)` was removed.
- `--row-h`: single `34px` value (was 46px base, 34px mobile, 54px tablet).
- `.bt2-l .jok-img`: single `26px × 26px` size (was 36px base, 26px mobile).
- The full `@media(min-width:600px)` block (40+ rules scaling `.gr`, `.hc`, `.sbox`, `.ovc`, top-bar icons, online-lobby, champions table) and the `@media(min-width:900px)` block (side-panel widening, home/setup/overlay/online wider variants, top-bar icon/text bumps) were removed wholesale.
- `.turn-timer .tt-value` / `.tt-label`: removed the `@media (min-width: 600px)` font-size bump.

### Why

The app's `manifest.json` enforces portrait, and `docs-md/CLAUDE.md` notes "Mobile layout is portrait-only … Never add landscape-specific rules without testing on mobile." The desktop side-panel layout was a dev-tool-only artifact that diverged visually from the real product. Removing it means every viewport — phone, tablet, desktop browser — renders the same phone-shaped layout, centered with empty margins on wider screens.

### What was not touched

- `@media (max-height: 700px)` / `(max-height: 580px)` on `.hbtns`/`.hlogo` — these are *height*-based, not width-based, and shrink the home button stack on landscape phones. Still useful.
- `@media (max-width: 380px)` / `(max-width: 360px)` on the stats screen — these shrink fonts on genuinely tiny phones to prevent overflow. Still useful, doesn't affect game layout.
- `@media (prefers-reduced-motion: reduce)` and `(hover:hover)` — orthogonal to layout, untouched.
- Engine, schema, dictionary, Firebase rules — all CSS-only change.

**Verification:** 175/175 unit tests pass.

---

## Bug fix: profile avatar icon + stall-end button label — June 2026

### Profile avatar icon showing crown instead of unlocked avatar

`profileScreen.js` had a hardcoded `AVATAR_EMOJI` map that was missing several avatar IDs introduced later in `avatarScreens.js` (`bulb`, `fox`, `handshake`, `shield`, `bolt`, `trophy`, `books`, `hero`, `target`). When any of these IDs was equipped, `avatarEmoji()` couldn't find the key and fell back to the default `'👑'` (crown).

Fix: replaced the hardcoded constant with `Object.fromEntries(SPINE_AVATARS.map(a => [a.id, a.emoji]))` so the two tables can never drift apart.

### "סיים וזכה" showing wrong label when bot is leading

In a 1vBot game `session.mySlot` is undefined (the pinned human slot lives on `ag.mySlot`, not `ag.session.mySlot`). `localSlot()` therefore fell through to its offline fallback which returns whichever slot is currently *leading*. When the bot led, this returned slot 1 (bot), `canClaimStallEnd(state, 1)` passed, and the button appeared — but with "וזכה" even though the human would lose.

Fix (`claimStallEndController.js`):
- Added `isHumanLeading()` — reads `ag.mySlot` (the pinned human slot) and compares to `localSlot()`.
- Added `refreshLabel()` — updates the topbar button text/icon and all four text nodes in the confirm overlay (icon, title, description, confirm button) to either the win variant ("🏆 … וזכה") or the lose variant ("😞 … והפסד").
- `refreshLabel()` is called from `refreshVisibility()` (when button becomes visible), from `openConfirm()`, and from the gender-change handler.
- Added `id="claim-stall-icon"`, `id="claim-stall-title"`, `id="claim-stall-desc"` to the overlay HTML so `refreshLabel()` has stable hooks.

**Verification:** 175/175 unit tests pass.

---

## Feature: native back-button support — June 2026

The Android/browser "back" (`<`) button is now intercepted and handled inside the app rather than navigating in browser history.

**Behaviour:**
- **In the game screen**: back opens the quit overlay (identical to tapping "סיום").
- **Any other screen**: back navigates to the previously shown screen (uses an in-memory navigation stack that is maintained across all `showLegacyScreen` calls; going home resets the stack).

**Implementation (src/main.js):**
- `showLegacyScreen` now maintains `_scStack` — a running array of screen IDs visited in order. Calling `showLegacyScreen('sh')` resets the stack to `['sh']` so stale game-session depth is cleared after each game ends.
- A `popstate` listener is registered once (guarded by `__spineBackWired`) by parking a `{ spineBack: true }` sentinel entry in the browser History API. On every back-press the sentinel is re-pushed so subsequent presses are also caught, then:
  - screen is `'sg'` → `bus.emit(BACK_OPEN)` (opens quit overlay).
  - any other screen → pop the stack, call `showLegacyScreen(prev)` with `_scBack = true` so the pop-navigation doesn't itself push onto the stack.

**Verification:** 175/175 unit tests pass.

---

## Bug fix: sofit (final-form) letters on board tiles and תפזורת grid — June 2026

### Problem

Hebrew final-form letters (ם ן ף ך ץ) were appearing on board tiles and word-search grid cells in two separate code paths:

1. **Bot joker placement** — the bot's word list was built directly from `hebrewDictionary.DICT` without normalising final forms. Words like `שלום` (ending in ם, mem sofit) couldn't be matched against the rack tiles (which use regular מ), so the bot would needlessly consume a joker and assign it `letter: 'ם'`. The joker tile then appeared on the board with the final-form character.

2. **תפזורת word search** — `HEBREW_WORD_POOL` contained `'לחם'` with a real mem sofit (U+05DD) at the end — a copy-paste error that slipped past the "no final forms" comment. Additionally, `placeWords()` placed word letters verbatim without normalising, meaning any caller passing words with sofit chars would produce grid tiles that display the final form.

### Fix

- **`src/main.js`** — normalise and deduplicate the bot word list with `hebrewDictionary.norm()` before passing it to `attachBotPlayer`. The bot now only tries to place words in base-letter form, so rack matching is always correct and jokers are never assigned sofit letters.

- **`src/ui/screens/miniGames/wordSearchMiniGame.js`** — added `SOFIT_TO_BASE` map and `normWord()` helper. `placeWords()` now maps every incoming word through `normWord()` before placing it, so grid tiles and `p.word` (used for chip display and matching) are always in base-letter form. Also corrected `'לחם'` in `HEBREW_WORD_POOL` from ם (U+05DD) to מ (U+05DE).

- **`src/ui/screens/miniGames/wordSearchMiniGame.test.js`** — added regression test: passes words with sofit letters (`'שלום'`, `'מלך'`) and asserts no final-form character appears in the grid or `p.word` of any placement.

### Verification

- 175/175 unit tests pass; 20/20 word-search tests pass (including new regression test).

---

## UX: reversible lock placement + new-tile glow after exchange — June 2026

### Reversible lock placement

Previously, clicking an empty cell with no rack tile selected immediately dispatched `CMD.PLACE_LOCK` — the lock was final, no way to undo a misclick (you'd burn a lock from inventory). Now lock placement matches the placed-tile UX: clicking a cell shows a **pending lock preview** that only commits when the player taps שבץ.

- **[src/ui/controllers/gameController.js](src/ui/controllers/gameController.js)** — new `view.pendingLock` field plus `setPendingLock({r,c,duration})` / `clearPendingLock()` methods. `confirmMove()` routes through `CMD.PLACE_LOCK` when there's a pending lock (mutex with `placed` tiles — locking and tile-placement remain alternative move types per turn). `recallAll()` and the engine-event subscribers (LOCK_PLACED / TURN_CHANGED / MOVE_CONFIRMED) clear `pendingLock` alongside `placed`. Tapping the same cell again toggles the pending lock off, so misclicks are reversible without going to the בטל button. `placeLock()` is kept exported for back-compat (legacy direct dispatch).
- **[src/ui/screens/gameScreen.js](src/ui/screens/gameScreen.js)** — both cell-click branches that previously called `controller.placeLock` now call `controller.setPendingLock`. The `renderBoard` cell loop has a new branch for `view.pendingLock` cells that renders the lock icon with a `spine-pending-lock-cell` class.
- **[styles.css](styles.css)** — `.cell.spine-pending-lock-cell` style: dimmer background, brighter accent border, pulsing animation (`@keyframes pendingLockPulse`) so the player can see it's not yet committed.

### New-tile glow on exchange

After tapping החלפת אות → confirm, the player saw a refreshed rack with no clear indication which tiles were new. Now the freshly-drawn tiles glow green for 2 seconds.

- **[src/ui/screens/gameScreen.js](src/ui/screens/gameScreen.js)** — new bus subscription to `EV.TILES_EXCHANGED`. When it fires for the local player's slot, the last `count` rack indices are marked as recently-arrived (this matches `tileBag.drawInto`'s append-to-end behavior). The renderer adds `.bt2-just-arrived` to those tile elements; a 2-second `setTimeout` clears the set and re-renders.
- **[styles.css](styles.css)** — `.bt2.bt2-just-arrived` style + `@keyframes rackTileArrived`: 2-second fading green glow + brighter border.

### Verification

- 175/175 unit tests pass (no regressions).
- Build re-stamped (`20260603020830`) so SW cache busts on next reload.

---

## Bug #2 real root cause — presenceService restore-on-reconnect — June 2026

The earlier "strict continuous-offline semantics" fix in `disconnectController` was correct but insufficient — the user reproduced bug #2 live in the browser with both clients running on the local emulator, no actual flickers visible. Adding diagnostic logging to `disconnectController` revealed: P2's `/presence/{uid}.connected` was stuck at **false the entire session** while `lastSeen` was being updated every ~10s. P1 wasn't misreading anything — the server actually had P2 at `connected:false`.

### Root cause

Classic Firebase-presence pattern bug in [src/game/online/presenceService.js](src/game/online/presenceService.js):

1. `startPresence()` writes `{connected:true, lastSeen, ...}` AND arms `onDisconnect().update({connected:false,...})`
2. Any transient WebSocket drop (auth-token refresh failure, mobile network switch, brief connectivity hiccup) causes the **server** to fire the armed `onDisconnect` handler → `/presence/{uid}.connected` becomes `false`
3. The SDK reconnects; the session has no awareness
4. The heartbeat at +10s writes only `r.update({lastSeen: ...})` — it **never re-affirms `connected:true`**
5. Server-side `connected` stays false forever (or until session.stop)
6. From the opponent's view, `isPresenceOnline` returns `false` authoritatively → grace timer → overlay → AUTO_WIN

The live trigger in the user's emulator setup was a `securetoken 400` from the auth emulator dropping the SDK's WebSocket. In production any transient connectivity blip would do it.

### Fix

Two-part, both in `startPresence()`:

1. **`.info/connected` watcher** — subscribe to Firebase's special connection-status path. On every transition to `true`, re-set the full presence record (`{connected:true, lastSeen, currentRoom, backgrounded}`) AND re-arm `onDisconnect`. Heals immediately on every reconnect.
2. **Heartbeat reaffirms `connected:true`** — `r.update({lastSeen, connected:true})` every 10s instead of just `lastSeen`. Belt-and-braces: even if (1) misses a reconnect, the next heartbeat self-heals within `HEARTBEAT_MS`. Same applies to the `visibilitychange` handler.

`stop()` correctly unsubscribes the `.info/connected` watcher.

### Verification

- 3 new tests in [tests/unit/presence-restore-on-reconnect.test.js](tests/unit/presence-restore-on-reconnect.test.js) — startup affirms, reconnect after simulated `onDisconnect`-induced false restores, stop unsubscribes watcher.
- 175/175 unit tests pass total (up from 172).
- User to verify in their live two-browser emulator setup; diagnostic logging removed from `disconnectController.js` once root cause was confirmed.

### Note on the earlier "strict continuous-offline" fix

The `disconnectController` change from the next entry is still correct and shipped — it's a separate, independent guard against the *different* flicker mechanism (rapid actual presence flickers). The two fixes are complementary: `presenceService` prevents the stuck-false state in the first place; `disconnectController` handles the case where presence does briefly flicker for real reasons.

---

## Firebase emulator wired for browser playtesting — June 2026

Restored emulator support that lived only on the unmerged `online-game-fixes` branch (commit 29d6ef03) so two browser sessions can play each other locally without touching production Firebase.

- [src/game/online/firebaseClient.js](src/game/online/firebaseClient.js): `?emu=1` (or `APP_CONFIG.useEmulator`) → calls `db.useEmulator('localhost', 9000)` and `auth.useEmulator('http://localhost:9099')` right after `initializeApp`. New `isUsingEmulator()` helper exported for diagnostics.
- [firebase.json](firebase.json): added `auth` (9099), `hosting` (5000), and emulator UI (4000) alongside the existing `database` (9000).
- [package.json](package.json): new `npm run emu` script — `firebase emulators:start --project demo-bonus-game --only auth,database,hosting`.

**Usage:** `npm run emu`, then open `http://localhost:5000/?emu=1` in two different browser profiles (or normal + incognito). Each gets its own anonymous UID, lobby / matchmaking / create-room / join-by-code all work against the local DB. Emulator UI is at `http://localhost:4000` for inspecting RTDB state.

---

## Phase 5 — two production bug fixes + live connectivity indicator — June 2026

The headless full-stack E2E scenario ([scripts/simulator/scenarios/e2eFullStack.mjs](scripts/simulator/scenarios/e2eFullStack.mjs)) caught both production bugs the user knew existed.

### Bug #1 — ghost move after failed commit (FIXED)

**Symptom:** Player 1 places a word at the last second; from P1's screen the word appears on the board, but P2 never sees it and the server doesn't have it. Reproduced deterministically by `runDeadlineRaceForcedLoss` — `5/5 runs surfaced "ghost-move-on-loser-A"`.

**Root cause:** in [src/game/sessions/onlineGameSession.js](src/game/sessions/onlineGameSession.js), when `commitTransaction` returned `{committed: false}` (stale version, watchdog claimed first) OR threw `permission_denied` (rule rejected after the watchdog had already flipped `currentTurnSlot`), the SYNC_REJECTED handler only emitted an event. The local engine had already optimistically mutated `state.board` / `state.scores` / `state.racks` via `applyMove`, but nothing rolled them back. The watcher's resync block also didn't touch `state.board` for non-placement room updates (a watchdog claim has no `lastMove.type === 'place'`).

**Fix:** added `forceResync()` in `createOnlineGameSession` — re-reads the authoritative room and rebuilds engine state via `engineStateFromRoom`. Wired into every SYNC_REJECTED site. Also wrapped `commitCurrentState` in a try/catch so Firebase rejections (permission_denied) become `{committed: false}` instead of leaking out as unhandled rejections from the bus subscriber.

Tests: [tests/unit/online-ghost-move-rollback.test.js](tests/unit/online-ghost-move-rollback.test.js) — stubs the next .transaction() to fail and verifies session.state.board has no ghost tiles after settling.

### Bug #2 — false-positive disconnect overlay (FIXED)

**Symptom:** Regular game. P1 sees the disconnect-countdown overlay for P2 even though P2 is actively connected from their own perspective. When countdown hits 0, P1 sees game-end; P2 sees it only at the end of their turn. Reproduced by `runPresenceFlicker` — 8 brief 500ms presence blips of P2 produced 3 false-positive DISCONNECT_OPEN events on P1.

**Root cause:** [src/ui/controllers/disconnectController.js](src/ui/controllers/disconnectController.js) `totalDisconnectedMs` accumulated across reconnect/disconnect cycles without resetting on reconnect. Brief WebSocket blips (extremely common: mobile network switch, background-tab throttle, slow Wi-Fi, brief Firebase WebSocket drop) summed up over a long game and crossed `graceMs` even with the opponent continuously online.

**Fix:** strict continuous-offline semantics. On every online transition that happens BEFORE the overlay has opened, reset `totalDisconnectedMs = 0`. If the overlay is already open, keep accumulating (so a flicker right at the deadline can't grant a free extra grace period). Tests in [tests/unit/disconnect-flicker.test.js](tests/unit/disconnect-flicker.test.js) cover the flicker case, the continuous-offline sanity case, and the overlay-already-open accumulation case.

### New feature — live connectivity indicator (wifi icon)

User noted that the player WITH the connectivity issue had no way to know in real time. Added a wifi icon in the game-screen top bar that goes red+blinking when the local Firebase WebSocket drops:

- **[src/game/online/connectivityService.js](src/game/online/connectivityService.js)** — `startConnectivityMonitor({db, bus})` subscribes to Firebase's special `.info/connected` path. Emits `NET_STATUS_CHANGED` on transitions, dedupes same-state events.
- **[src/ui/controllers/connectivityIndicator.js](src/ui/controllers/connectivityIndicator.js)** — UI controller. Shows the icon only during online-mode games (gated on `modeDescriptor(...).online`). Toggles `.is-online` (green) / `.is-offline` (red + 0.6s blink) on the DOM element.
- **DOM:** `#net-status` element added to the game `.tbar` in [partials/screens/game.html](partials/screens/game.html). Inline SVG wifi-arcs icon; `currentColor` makes the CSS control the fill.
- **CSS:** `.net-status`, `.net-status.is-online`, `.net-status.is-offline`, `@keyframes netBlink` added to [styles.css](styles.css) near `.music-btn`.
- **Wiring:** in [src/main.js](src/main.js), `startConnectivityMonitor` and `createConnectivityIndicator` are mounted next to the other controllers. Exposed on `globalThis.__spine.connectivityMonitor` / `.connectivityIndicator` for debugging.

Tests: [tests/unit/connectivity-indicator.test.js](tests/unit/connectivity-indicator.test.js) — 6 cases covering service dedup, indicator visibility gating by mode, online/offline class transitions, and the pre-GAME_STARTED no-op case.

### Verification

- `npm run test:unit`: 172/172 pass (was 163)
- `npm run test:emulator`: 46/46 pass
- `npm run sim -- --scenario e2e --mm-batches 3`: 15/15 sub-scenario runs clean (5 sub-scenarios × 3 batches), including the previously-failing forced-deadline-loss and flicker scenarios
- `node scripts/stamp-build.js` run (game.html partial changed)

---

## Phase 4 simulator: reconnect scenario — June 2026

Adds `--scenario reconnect` mode in [scripts/simulator/scenarios/reconnect.mjs](scripts/simulator/scenarios/reconnect.mjs). Stresses the dispose / re-create lifecycle of `onlineGameSession` against real Firebase rules + transactions. Three sub-scenarios per batch:

1. **reconnect-during-opponent-turn** — slot 0 disposes while it's NOT their turn, opponent makes a move in their absence, slot 0 reconnects, plays. Verifies the reconnected session reads the LATEST authoritative state and the first post-reconnect commit lands cleanly (cache pre-warm + version cursor advance).
2. **reconnect-on-own-turn** — slot 0 disposes mid-think on their own turn (production analogue: tab refresh while you have the move), reconnects, plays. Verifies `currentTurnSlot=mySlot` is preserved across the cycle and the new session can commit.
3. **no-ghost-events-after-dispose** — slot 0 disposes, then bob plays. Asserts the disposed session emits ZERO bus events afterward (proves `dispose()` actually tears down the watcher; if it didn't, the still-mounted watchRoom callback would re-emit OPPONENT_MOVED/TURN_CHANGED on the dead bus, leaking subscribers in production).

All three apply the standard bag-parity / version-monotonic / liveBonus-gate invariants after each round-trip.

### Verification

- Smoke (3 batches × 3 sub-scenarios = 9 runs): 0 crashes
- Stress (15 batches × 3 = 45 runs): 0 crashes
- Full Phase 4 regression sweep: 162 unit tests pass, 46 emulator tests pass, all 5 sim modes pass 0 crashes

### Scope notes

Two follow-ups deferred to Phase 5 (logged in TASKS.md):
- **Deferred-score split-write scenario** — needs deterministic bonus-square triggering (bonuses sit at off-grid edges; the random bot doesn't reliably hit them). Either inject a scripted-move bot or seed `state.pendingScoreCommit` directly.
- **Admin-SDK prod-history exporter** for `--replay` mode — needs prod creds.

No engine bugs surfaced by reconnect this round — the session's existing watcher-teardown, version cursor anchoring (line 109 of onlineGameSession.js), and `sessionStartTs` reaction anti-replay all hold up under stress.

---

## Engine fix 6: handleConfirmMove rejects placement on occupied cells — June 2026

While verifying the exchange-atomic fix, the fuzz bot kept finding bag-parity violations of `-1` tiles per game. Root cause was a separate engine-defense gap: `setCommittedTile()` (called by `applyMove`) **silently overwrote any tile already at the target position**, and `validateMove()` never checked whether the target cell was occupied. So a `CONFIRM_MOVE` that placed a tile on an already-committed cell would: overwrite the existing tile, remove the new letter from the rack, and refill the rack from the bag — the overwritten tile vanished (not on board, not in any rack, not in the bag), net **-1 tile per overwrite**.

Fix in [src/game/core/gameEngine.js handleConfirmMove](src/game/core/gameEngine.js): pre-check via `getCommittedTile` and reject with reason `placed-on-occupied-cell` before swap pre-mutation, applyMove, or any other state change. Placed in `handleConfirmMove` (not `validateMove`) because the swap path expects target cells to be occupied — that path has its own separate `swap-no-tile` / `swap-on-locked` checks that handle the swap case. Test: [tests/unit/engine-placed-not-in-rack.test.js](tests/unit/engine-placed-not-in-rack.test.js) — "cell defense" case proves the check fires and produces zero state mutation.

This closes the LAST class of bag-parity violation the fuzz bot was finding. 30-game fuzz sweep at 40% adversarial rate now completes 30/30 with zero crashes.

### Simulator detector refinement (same PR)

Made the runner's `commit-livelock` and `hang` detectors smarter: they subscribe to `INVALID_MOVE_REJECTED` on the per-game buses and reset their counters when the engine correctly rejects a bad command. Previously the detectors fired on ANY no-version-bump tick, mis-classifying healthy engine-defense rejections as livelocks/hangs. Now both detectors fire only when the engine ACCEPTED the command but progress still stalled — which would indicate a real Firebase / rule / commit-path bug.

---

## Engine fix 5: applyExchange now validates rack atomically — June 2026

While running the full-mode regression after the watchdog rule fix, the fuzz bot surfaced another partial-mutation bug in the SAME family as Phase 3's `handleConfirmMove` fix — but in the EXCHANGE path:

`turnManager.exchangeTilesInPlace` removed letters from the rack one-by-one and threw mid-loop if a letter wasn't in the rack. The `handleExchange` caller caught the throw and emitted `INVALID_MOVE_REJECTED` — but the rack mutation that already happened was NOT rolled back. A multi-letter exchange where letter[N] is missing left letters[0..N-1] gone from the rack, never returned to the bag → net **-1 tile per missing letter**, breaking bag-parity conservation.

Fix in [src/game/core/turnManager.js exchangeTilesInPlace](src/game/core/turnManager.js): pre-validate every letter against a rack *copy* before performing any mutation. If all letters are present, only then splice them out of the real rack. Tests in [tests/unit/engine-placed-not-in-rack.test.js](tests/unit/engine-placed-not-in-rack.test.js): mixed-valid-and-bogus exchange must reject atomically (no partial state change); legitimate multi-letter exchange still works.

Production impact in theory: a UI bug or a stale rack state on submit could lose tiles. The simulator's fuzz bot was the first thing to actually exercise this edge.

---

## Watchdog forfeit rule fix (production bug closed) — June 2026

Closes the production bug surfaced (but not fixed) in Phase 3: the watchdog could detect two consecutive missed turns by the same player but its forfeit write was **silently rejected by Firebase rules**, so rooms stayed in `status='playing'` forever instead of transitioning to `abandoned`.

### What changed

[firebase.database.rules.json](firebase.database.rules.json) — the `/rooms/$roomId` opponent-watchdog branch previously required `newData.turnDeadlineMs > now`. That blocked the forfeit write since `computeExpiredOnlineTurnState` sets `turnDeadlineMs=0` when promoting to `abandoned`. Relaxed to:

```
newData.turnDeadlineMs > now ||
(newData.status === 'abandoned' && newData.turnDeadlineMs === 0)
```

All other watchdog constraints unchanged (auth = opponent, version+1, data was playing with timelimit=true and expired deadline, slot flip). The relaxation only permits the exact shape produced by the forfeit code path. Two new emulator tests in [tests/emulator/timer-rules.test.mjs](tests/emulator/timer-rules.test.mjs):

1. **opponent watchdog CAN forfeit** — proves the rule now accepts the forfeit transaction; room ends with `status='abandoned'`, `abandonedBy=<slot>`, `turnDeadlineMs=0`, `missedTurns[slot]=2`.
2. **opponent CANNOT write turnDeadlineMs=0 without flipping status to abandoned** — defensive: confirms the relaxation is gated on the abandoned transition. An opponent trying to zero the deadline mid-game (to bypass the watchdog forever) is still rejected.

### Verification

- `npm run test:emulator`: 46/46 pass (44 existing + 2 new)
- `npm run sim -- --scenario watchdog`: 12/12 sub-scenarios pass (was 9/12 with forfeit disabled)
- Full all-modes sweep: zero crashes

---

## Phase 3 simulator (watchdog scenario) + 2 more engine fixes — June 2026

### Engine fix 3: `handleConfirmMove` defends against placements not in the rack

`turnManager.applyMove` calls `setCommittedTile()` for every placed tile but only does `rack.splice()` *if the letter is found in the rack* — silently no-ops otherwise. A `CONFIRM_MOVE` payload with a letter not in the active player's rack that still passed geometric validation and formed a valid Hebrew word with adjacent tiles would add a tile to the board without removing one from the rack — net +1 tile, breaking bag-parity conservation. Production UI never sends such payloads, but the engine should defend regardless (security rules don't catch it either).

Fix in [src/game/core/gameEngine.js handleConfirmMove](src/game/core/gameEngine.js): added an explicit precondition that simulates the rack mutations for both `placed` and `swappedTiles` against a copy of the rack; rejects with reason `placed-not-in-rack` if any letter isn't present, BEFORE any state mutation. Joker tiles correctly look up `'?'` regardless of the assigned visible letter. Test: [tests/unit/engine-placed-not-in-rack.test.js](tests/unit/engine-placed-not-in-rack.test.js) — 4 cases covering legit play, bad placement, bad swap, joker.

### Engine fix 4: `timeoutWatchdog.applyPatchToRoom` defaults activeBoosts to `[]`

When a room has no boosts, `activeBoosts: []` is written at creation but Firebase serializes empty arrays as missing on roundtrip. The watchdog's `applyPatchToRoom` did `Array.isArray(room.activeBoosts) ? filter(...) : room.activeBoosts` — falling back to `undefined`, which Firebase then rejects ("Data returned contains undefined in property activeBoosts"). Fixed by falling back to `[]` instead. Surfaced by the new watchdog simulator scenario.

### New scenario: `--scenario watchdog`

[scripts/simulator/scenarios/watchdog.mjs](scripts/simulator/scenarios/watchdog.mjs) — exercises the live-online timeout watchdog using injected clock (no wall-clock waits). Three sub-scenarios run per batch:

1. **single-timeout** — active player idles, opponent's watchdog ticks once, verifies turn flipped, `missedTurns[active]=1`, status stays `playing`, version bumped.
2. **gated-by-livebonus** — same setup but `liveBonus.active=true`; watchdog must no-op and leave version unchanged.
3. **double-claim-race** — both opponents (split-brain) tick simultaneously; verifies only one claim commits, and a watchdog on the ACTIVE slot never self-claims.

Took advantage of `timeoutWatchdog`'s well-designed seams: `now`, `setIntervalFn`/`clearIntervalFn`, exposed `tick()`. Single-process tests can drive the watchdog deterministically without waiting for real timeouts.

### Real bug found, NOT fixed in this PR: watchdog forfeit blocked by Firebase rules

The simulator's planned `forfeit-after-two` sub-scenario surfaced a production bug worth its own task: when the watchdog claims a second consecutive missed turn for a slot, `computeExpiredOnlineTurnState` (in [roomService.js](src/game/online/roomService.js)) sets `base.turnDeadlineMs = 0`. But the `/rooms/$roomId` security rule's opponent-watchdog branch requires `newData.turnDeadlineMs > now` — so the forfeit transaction is **rejected by rules**, and the room never transitions to `status='abandoned'`. The mock-Firebase unit test ([engine-parity-live-watchdog.test.js](tests/unit/engine-parity-live-watchdog.test.js)) misses this because mocks don't enforce rules. The sub-scenario is currently disabled in the simulator with a pointer to the TASKS.md entry; re-enable once fixed (either relax the rule or have the watchdog write the forfeit via a separate non-version-bumping path).

### Sweep results

- `npm run test:unit`: 159/159 pass
- `npm run sim` (normal, 40 games): 0 crashes
- `npm run sim -- --bot fuzz` (20 games): 0 crashes (the fuzz bot was finding the rack-defense gap that's now fixed)
- `npm run sim -- --scenario matchmaking --mm-batches 10 --mm-players 8`: 0 crashes
- `npm run sim -- --scenario watchdog --mm-batches 3`: 0 crashes

---

## Engine fixes surfaced by simulator (passCount sync + exchange game-over) — June 2026

Two real engine bugs caught by the simulator and fixed:

### Fix 1: passCount now syncs between online clients

`onlineGameSession.commitCurrentState()` did not include `_passCount` in the patch, and the watcher's resync did not copy it back. Each client tracked only its OWN consecutive scoreless turns, so:
- `isGameOver(state)` (threshold 4 consecutive scoreless turns) gated on stale per-client info — games could run indefinitely as long as each side occasionally placed a word.
- `canClaimStallEnd()` (threshold 2) only let a player claim once THEY personally skipped 2 turns — bizarre UX.

The schema already exposed `_passCount`: `engineStateFromRoom` reads it on reconnect and the timeout watchdog writes it on forfeit. The main commit path and the watcher resync were the two missing sites. Two-line fix in [src/game/sessions/onlineGameSession.js](src/game/sessions/onlineGameSession.js): add `_passCount: state.passCount ?? 0` to the patch and `state.passCount = incoming._passCount ?? state.passCount ?? 0` to the resync. Backwards-compatible: existing rooms with no `_passCount` field treat it as 0 on first observation. Test: [tests/unit/online-passcount-sync.test.js](tests/unit/online-passcount-sync.test.js).

### Fix 2: handleExchange now checks isGameOver

`handleExchange` increments `state.passCount` (per May 2026 rule: "exchanges count as scoreless turns toward game-over") but never called `isGameOver()` afterward. Only `handlePass` and `handleConfirmMove` had the check. So four consecutive exchanges could push `passCount` past the threshold without ending the game. Fix in [src/game/core/gameEngine.js handleExchange](src/game/core/gameEngine.js): add `if (isGameOver(state)) { finishGame(); return; }` after `applyTurnStartEffects`, mirroring `handlePass`. Test in the same file.

After both fixes: 60-game sim sweep completes 60/60, avg 37.6 ticks/game (down from 65 — games end when they should).

---

## Online simulator — Phase 2 (matchmaking scenario + adversarial fuzz bot) — June 2026

Adds two new scenarios on top of the Phase 1 normal-play simulator.

### `--bot fuzz` — adversarial bot wrapper

[scripts/simulator/bots/fuzzBot.mjs](scripts/simulator/bots/fuzzBot.mjs) — wraps `randomBot` and, with probability `--fuzz-rate` (default 0.3), substitutes an adversarial command from 14 categories: malformed `CONFIRM_MOVE` (empty/off-grid/non-collinear/bad letter), `EXCHANGE_TILE` with letters not in rack or oversized count, `PLACE_LOCK` with off-grid coords / bad duration / occupied cell, `FINALIZE_BOOST_AWARD` without pending bonus, `CLAIM_STALL_END` when not leading. The runner's existing try/catch + invariants catch any throw / corruption / rule rejection. Smoke run found a real engine-defense gap: `applyMove` in [turnManager.js:138-154](src/game/core/turnManager.js#L138-L154) commits placed tiles to the board unconditionally but only removes from rack *if found* — so a placement of a letter not in the rack adds a tile out of nowhere (bag-parity violation). Logged for follow-up.

### `--scenario matchmaking` — concurrent-claim race scenario

[scripts/simulator/scenarios/matchmaking.mjs](scripts/simulator/scenarios/matchmaking.mjs) — spins up N authed "players" per batch (default 10), all join `/matchmakingQueue/{mode}` simultaneously, then all call `tryPair()` concurrently. Verifies topology invariants: no self-pair, no double-booked player, no missing rooms, no queue residue after pairing. 20-batch × 8-player stress test runs clean (the matchmaking pair-claim race fix from May 2026 holds). Each batch uses its own sub-mode key (`{baseMode}-{batchSeed}`) so concurrent batches don't cross-contaminate queues.

### Build notes (matchmaking)

Hit another Firebase compat-SDK quirk: `.get()` and `.once('value')` do **not** warm the cache that `.transaction()` consults. Only an *active* `.on('value')` subscription does. In production the browser tab subscribes for matchmaking-queue updates so this is implicit; in the simulator we subscribe explicitly per-db before the race and detach after. This is the third cache-related trap solved (after Phase 1's `commitTransaction` cache pre-warm and the per-session-bus topology fix).

### CLI flags added

- `--scenario normal | matchmaking` (default normal)
- `--bot random | fuzz` (default random)
- `--fuzz-rate F` (0..1, default 0.3)
- `--mm-players N` (default 10)
- `--mm-batches N` (default 5)

See `node scripts/simulator/runSimulator.mjs --help` for the full reference.

---

## Online game simulator — June 2026

### What changed

New developer tool (`npm run sim`) that runs N concurrent online games against the local Firebase Realtime Database emulator using random-move bots, then writes structured JSON crash reports for any invariant violations, engine throws, transaction livelocks, or hangs detected.

- **`scripts/simulator/runSimulator.mjs`** — CLI entry. Accepts `--games N --concurrency M --seed STR --replay PATH --mode MODE --verbose`.
- **`scripts/simulator/launch.mjs`** — wrapper that invokes `firebase emulators:exec --only database` so `npm run sim -- --games N` forwards args correctly.
- **`scripts/simulator/emulatorClient.mjs`** — boots `@firebase/rules-unit-testing` env against the local emulator. Refuses to run unless `FIREBASE_DATABASE_EMULATOR_HOST` points at localhost.
- **`scripts/simulator/gameRunner.mjs`** — single-game lifecycle: creates room via host's authed context, wires two `createOnlineGameSession` instances on a per-game bus, ticks bot → dispatch → await commit → invariants until terminal status.
- **`scripts/simulator/bots/randomBot.mjs`** — picks random legal placements (validated through canonical `validateMove` + `isValid`), falls back to exchange/pass.
- **`scripts/simulator/bots/replayBot.mjs`** — replays a recorded `moveHistory` JSON; engine refusal becomes a `replay-divergence` crash class.
- **`scripts/simulator/invariants.mjs`** — per-tick checks on the Firebase room snapshot: schemaVersion, version monotonicity, bag parity, turn-slot bounds, liveBonus gate, missed-turns ceiling, pass-count ceiling, terminal-shape sanity.
- **`scripts/simulator/crashCollector.mjs`** — dedup by stack/detail fingerprint, writes one JSON per unique crash class to `.simulator-data/crashes/{runId}/`.
- **`tests/unit/simulator-invariants.test.js`** — invariant unit tests.
- **`tests/unit/simulator-randomBot.test.js`** — bot fallback / payload-shape unit tests.
- **`package.json`** — adds `"sim"` script.
- **`.gitignore`** — adds `.simulator-data/` and `.emulator-data/`.

### Why

`docs-md/GAP_REPORT.md` lists ~9 fragile areas in the online flow (transaction races, watchdog vs `liveBonus` gating, deferred-score split writes, invite-accept races, bag divergence on exchanges, double-timeout forfeit, etc.) but there was no headless tool to exercise them at scale. The simulator gives us a repeatable way to drive concurrent rooms through the real `commitTransaction`, `onlineGameSession`, and Firebase-rule paths and surface anomalies as reproducible JSON.

### Out of scope (Phase 2 follow-ups)

- Matchmaking flow stress (v1 creates rooms directly).
- Watchdog stress with injected clock (`settings.timelimit=false` by default).
- Adversarial fuzzing (malformed payloads, out-of-turn commands).
- Auto-fixing — explicit non-goal; the simulator logs, humans fix.
- Production-history exporter for `--replay`; users supply JSON manually for now.

### Build notes (worth knowing)

Two simulator-construction issues had to be solved to make games run cleanly; future bots/scenarios will hit the same edges:

1. **Transaction cache pre-warm** — Firebase RTDB's `.transaction()` calls the update function with `current=null` if the local cache is cold, and `commitTransaction` in `roomService.js` treats null as "abort" (committed=false). The simulator now does `dbAlice.ref(...).once('value')` and the same for Bob's db before any dispatch, so the cache is warm and the first commit lands.
2. **Per-session bus** — production has ONE module-level bus per browser tab, with ONE session on it. The simulator initially put both sessions on a single bus; that mismodels the topology because `onlineGameSession`'s watcher re-emits events like `TILES_EXCHANGED` and `LOCK_PLACED` for opponent UI updates, and those re-emits would trigger the *originating* session's handler to commit a SECOND time (which then failed `permission_denied` since the turn had flipped). Each session now gets its own bus, matching production.

After both fixes: 5-game smoke runs to completion (20–71 ticks each), zero crashes, exit 0.

---

## Gender address toggle — Phase 2 extended — June 2026

### What changed (Phase 2 extension — additional screens)

- **`src/ui/genderText.js`** — `applyGenderToRoot` now also handles `data-gm-placeholder` / `data-gf-placeholder` attributes, updating `input.placeholder`.
- **`partials/screens/setup.html`** — play button "▶ שחק!" tagged with `data-gm`/`data-gf` ("▶ שחקי!").
- **`partials/screens/settings.html`** — "בדוק ✓" button, "📨 שלח הצעה" button, `#settings-shin` and `#dict-word-input` inputs tagged for gender.
- **`partials/screens/online-lobby.html`** — subtitle and all three option-card descriptions tagged with `data-gm`/`data-gf`.

---

## Gender address toggle ("באיזה לשון לפנות אליך?") — Phase 2 — June 2026

**Branch:** `claude/gender-toggle-feature-iNBBE`

Phase 2 extends the gender preference system to all visible Hebrew imperative strings across the game UI.

### What changed (Phase 2)

1. **`src/ui/genderText.js`** (new) — Central utility: `GS` lookup table of M/F pairs, `getGender()`, `isFem()`, `g(key, gender)`, `applyGenderToRoot(root, gender)`. Handles `data-gm`/`data-gf` (textContent) and `data-gm-html`/`data-gf-html` (innerHTML).

2. **HTML partials** — Added `data-gm`/`data-gf` attributes to all HTML elements with gendered imperative text:
   - `game.html`: sbar hint, btn-recall, btn-play
   - `bonus-intro-shown-before-every-interactive-boost-mini-game.html`: start button
   - `joker-picker.html`: overlay title
   - `exchange.html`: overlay description
   - `pause-overlay.html`: resume button
   - `back-confirm-overlay.html`: stay / continue-play buttons
   - `claim-stall-end-confirm-overlay.html`: description, continue-play button
   - `avatar-unlock-overlay.html`: continue button
   - `stats-screen.html`: favorite-boost description

3. **`src/ui/screens/pauseScreen.js`** / **`backConfirmScreen.js`** — Import `applyGenderToRoot, getGender`; call on mount, on open event, and on `SETTINGS_CHANGED`.

4. **`src/ui/controllers/claimStallEndController.js`** — `openConfirm()` calls `applyGenderToRoot` on the overlay; SETTINGS_CHANGED listener applies gender live.

5. **`src/ui/screens/bonusIntroScreen.js`** — `DESC_BY_TYPE` static object replaced by `descByType()` function that calls `g()` at render time.

6. **`src/ui/screens/gameScreen.js`** — Imports `g`; all four `#sbar` status strings now use `g('key')`; four `invalidReasonText` cases use `g()`; SETTINGS_CHANGED listener calls `renderStatus` on gender change.

7. **Mini-game screens** — All seven mini-games import `g, getGender` and use `g()` for their imperative text (status lines, finish/continue buttons, titles):
   - `crosswordMiniGame.js`, `fillMiddleMiniGame.js`, `wheelMiniGame.js`, `unscrambleMiniGame.js`, `crossingWordsMiniGame.js`, `honeycombMiniGame.js`, `wordSearchMiniGame.js`

8. **`src/ui/screens/friendsScreen.js`** — Invite button text uses `g('inviteToGame', getGender())`.

9. **`src/ui/screens/waitingRoomScreen.js`** — `buildWhatsAppShareUrl(code, gender)` now accepts an optional gender param; message uses `g('shareGameMsg', gender)`.

10. **`src/main.js`** — Imports `applyGenderToRoot`; the `SETTINGS_CHANGED` gender handler now calls `applyGenderToRoot(globalThis.document, changes.gender)` to update all live `data-gm`/`data-gf` elements in one pass.

---

## Gender address toggle ("באיזה לשון לפנות אליך?") — Phase 1 — June 2026

**Branch:** `claude/gender-toggle-feature-iNBBE`

Adds a persistent gender preference so all address to the user uses the correct Hebrew gender form.

### What changed (Phase 1)

1. **`src/game/settings/settingsCompat.js`** — Added `gender: 'זכר'` to `DEFAULT_UI_PREFERENCES`. `normalizeUiPreferences` now normalises the field: `'נקבה'` persists; any other value (including missing) falls back to `'זכר'`.

2. **`partials/screens/settings.html`** — New panel "באיזה לשון לפנות אליך?" with זכר / נקבה pills, placed below the vibration panel. Uses the same `.set-panel` / `.set-yesno` / `.set-yn` structure; wired entirely through `settingsScreen.js` (no `onclick` attributes).

3. **`src/ui/screens/settingsScreen.js`** — Added a `VALUE_SELECTS` array for value-based (non-boolean) option groups; initial entry is the gender selector. `mountSettingsScreen` now accepts an optional `getUiPrefs` getter so the overlay can reflect the current gender when it opens. `refreshControls` and the `SETTINGS_CHANGED` listener both handle `VALUE_SELECTS`. Clicking a gender option emits `SETTINGS_CHANGED: { gender: 'זכר' | 'נקבה' }`.

4. **`src/notifications/pushPayloadBuilder.js`** — `defaultBody` for `KIND.REMINDER` now checks `ctx.gender`: `'נקבה'` → `"את לא משחקת כבר X שעות"`, default → `"אתה לא משחק כבר X שעות"`.

5. **`src/notifications/notificationService.js`** — `pushReminder` accepts an optional `gender` field and forwards it through `ctx`.

6. **`src/main.js`** — (a) passes `getUiPrefs` to `mountSettingsScreen`; (b) the `SETTINGS_CHANGED` handler saves gender to `uiPreferences` via `mergeUiPreferences` and excludes it from Firebase room-settings syncs; (c) `pushReminder` calls now include `gender` read from `loadUiPreferences`.

7. **`src/game/settings/settingsCompat.test.js`** — Updated UI preferences snapshot test to include `gender: 'זכר'`; added dedicated gender normalisation test.

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
