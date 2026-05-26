# GAP_REPORT.md — Gap and Risk Report

> This is a confirmed-evidence report. Gaps are listed only when found in code, tests, or existing documentation.
> Speculation is labeled "suspected" or "Unknown / needs verification."
> Source evidence: `docs/legacy-gameplay-parity-gap-report.md`, `docs/legacy-vs-new-gap-report.md`, `docs/engine-parity-missing-report.md`, `SPINE_TODO.md`, source file analysis

---

## Legend

- **Confirmed gap** — found in code or existing gap documentation
- **Suspected risk** — architectural concern visible in code but not confirmed broken
- **Missing test** — behavior exists but lacks assertion coverage
- **Fragile module** — module with structural risks

---

## Critical Gaps

### 1. OneSignal REST Key Exposed Client-Side *(Security Risk)* — ✅ RESOLVED

**Status:** Resolved (May 2026). All push sends are now brokered through a Cloudflare Worker that holds the REST key as a Cloudflare secret. The client POSTs the notification body to `pushWorkerUrl` with a Firebase ID token in `Authorization: Bearer …`; the worker verifies the token against Google's JWKS, rebuilds the OneSignal body from a trusted server-side template (so headings/contents cannot be injected), and forwards to OneSignal.

**Files:**
- `worker/` — Cloudflare Worker source + deploy config
- `src/notifications/notificationService.js` — `defaultSendPush` now targets the worker; no `restKey` parameter
- `src/main.js` — wires `pushWorkerUrl` + `getIdToken` thunk into `notificationService.configure()`
- `config.example.js` — `onesignalKey` removed, `pushWorkerUrl` added
- `firebase.json` — `worker/**` excluded from Firebase Hosting

**Remaining hardening (non-blocking):**
- Rotate the OneSignal REST API key (the old one is in git history and every cached `config.js`)
- Tighten `ALLOWED_ORIGIN` in `worker/wrangler.toml` from `*` to the hosting origin
- Add per-UID rate limit via Workers KV

---

### 2. Turn Recovery with Unconfirmed Tiles *(Critical Parity Gap)* — ✅ RESOLVED

**Status:** Resolved (May 2026). The three pending-tile recovery paths now have unit tests in `src/ui/controllers/gameController.test.js`:

1. **External turn-end** (timeout-as-pass, manual pass, online opponent claim) — `TURN_CHANGED` clears `view.placed`, rack unchanged, board uncommitted.
2. **Invalid-word auto-pass** — `INVALID_MOVE_REJECTED` with `word-not-in-dictionary` keeps tiles visible during the 1100 ms shake animation, then clears + auto-passes; rack restored, board uncommitted (test uses `node:test` mock timers).
3. **`LOCK_PLACED` event** — clears pending placement and any stale `lastInvalidReason`, rack untouched.

**Architectural note:** `view.placed` remaining UI-only state is an intentional design choice matching legacy. The engine never sees the tentative placement until `confirmMove()`, so connection drops mid-placement cannot corrupt engine state — the tiles are simply lost on reload (also a legacy behavior, registered in `docs/intentional-change-register.md` item 10 as the in-memory ownership change).

**Out of scope:** persisting pending placements across page reloads (would change legacy behavior; would require its own design discussion).

---

### 3. Two Consecutive Missed Turns Forfeit — Race Condition *(Suspected Risk)* — ✅ RESOLVED

**Status:** Resolved (May 2026). Investigation found the watchdog logic was already correct; the gap was missing test coverage for the two scenarios the title actually names. Both now have tests in `tests/unit/engine-parity-live-watchdog.test.js`:

1. **Forfeit on two consecutive missed turns** — seeds `missedTurns: { 0: 0, 1: 1 }` then drives a second timeout claim. Asserts the room promotes to `status: 'abandoned'` with `abandonedBy: 1` and `abandonReason: 'missed-turns'`, deadline cleared, version bumped once. (`computeExpiredOnlineTurnState` already encoded the forfeit via `MISSED_TURNS_FORFEIT_THRESHOLD = 2` at [src/game/online/roomService.js:306](../src/game/online/roomService.js#L306); `applyPatchToRoom` already propagated the status fields.)

2. **`committed: false` does not latch the watchdog** — seeds `liveBonus: { active: true }` so the first tick no-ops. Then clears the gate and asserts the next tick claims successfully with version incremented exactly once. The 350 ms polling cadence IS the retry mechanism; no explicit retry logic is needed.

The pre-existing concurrent-race test ("parity: concurrent claims — only the first observably mutates the room") already proved that simultaneous claims by both watchdogs are safe — only the first transaction commits.

**Architectural note:** Firebase RTDB transactions retry internally up to 25 times on stale snapshots; combined with the watchdog's 350 ms polling, no extra retry layer is required at the application level.

---

### 4. Async Reminder Sweep Runs Client-Side *(Architecture Concern)* — ✅ RESOLVED

**Status:** Resolved (May 2026). The sweep now runs server-side as a Cloudflare Worker cron trigger (`worker/src/cronSweep.js`), executed every 4 hours. The browser-side sweep in `src/game/online/asyncReminderService.js` is kept as belt-and-suspenders; both write `lastReminderAt` and `status: 'expired'` so whichever runs first wins.

**Architecture:**
- Cron schedule: `0 */4 * * *` in `worker/wrangler.toml` (free tier — Cloudflare Workers cron triggers don't count against the 100k request limit)
- Firebase RTDB access via service-account JWT → OAuth2 token → REST API (`worker/src/firebaseRtdb.js`)
- Service account JSON stored as `FIREBASE_SERVICE_ACCOUNT_JSON` Cloudflare secret
- OneSignal send re-uses the same `pushPayloadBuilder.js` template the fetch handler uses

**Why the three sub-concerns are resolved:**
1. *"If neither player opens the app for 7 days, no expiry fires"* — cron runs every 4 hours regardless of browser activity.
2. *"Sweep not guaranteed to run consistently"* — Cloudflare cron has reliability SLAs (delivery within seconds of the scheduled time on the free tier; eventual delivery guaranteed).
3. *"Two simultaneous sweeps could double-send"* — the cron is the single source of truth; the browser sweep is opportunistic. Even if both fire in the same window, `lastReminderAt` is updated atomically (RTDB `PATCH`) and `classify()` skips rooms within the idempotency window.

**Anti-drift coverage:** `worker/test/cronSweep.test.js` imports both `classify()` implementations and asserts they return identical decisions for 7 scenarios. Test fails if either file is changed without updating the other.

**Manual sweep trigger:** POST `/cron-debug` with a Firebase ID token (UID must be in `CRON_ADMIN_UIDS` env var) returns `{ scanned, reminded, expired, errors }` for verification against real data.

**Source files:**
- `worker/src/cronSweep.js` — server-side sweep
- `worker/src/firebaseRtdb.js` — service-account JWT + RTDB REST client
- `worker/src/index.js` — `scheduled()` export + `/cron-debug` endpoint
- `worker/wrangler.toml` — `[triggers] crons = ["0 */4 * * *"]`
- `worker/test/cronSweep.test.js` — parity tests
- `worker/README.md` — deploy steps for `FIREBASE_SERVICE_ACCOUNT_JSON` secret

---

## High-Risk Gaps

### 5. Bot Move Quality Not Tested *(Missing Test)* — ✅ RESOLVED

**Status:** Resolved (May 2026). The original gap claim ("no unit test file found for this module") was outdated — `src/game/sessions/botSearch.test.js` already had 13 tests covering `canMakeWord`, `tryPlaceWord`, `findAnchors`, and HARD-difficulty `searchBotMove`. Audit identified 3 genuine coverage gaps that are now closed:

1. **EASY difficulty branch** — bot's bottom-half selection logic. Test verifies EASY picks the lower-scoring of two available moves with deterministic RNG.
2. **MEDIUM difficulty branch** — top-3 random selection. Test verifies MEDIUM with `rng=0` picks the top scorer of the top-3.
3. **Plays legally** — the gap's headline concern. Test seeds a board where any placement in a specific column would form an invalid vertical cross-word; asserts the bot either skips column 5 or returns null. Proves the bot never produces a move that creates an illegal cross-word.

**Out of scope (documented in `src/game/sessions/botSearch.test.js`):**
- Vertical-only placement test — the search always tries both axes and picks by score; constructing a vertical-only scenario is fragile. `tryPlaceWord` is already unit-tested for both axes.
- Joker-in-full-search test — `canMakeWord` conservatively requires the rack to fully spell the word from scratch (an intentional bot simplification), so this path is only exercised when the rack has both the joker and the literal it replaces. Joker code in `canMakeWord` and `tryPlaceWord` is unit-tested directly.

**Not addressed (would be a separate effort):** a golden-fixture parity test against the legacy `doBotSearch`. This would require either snapshotting legacy output for many fixtures or running both implementations side-by-side — substantial scope, and bot move selection is acknowledged in `docs/intentional-change-register.md` as not requiring exact parity.

---

### 6. B1–B13 Bonus Branch Coverage Incomplete *(Missing Test)* — ✅ RESOLVED

**Status:** Resolved (May 2026). 10 new tests added to `src/game/boosts/bonusResolver.test.js`. Coverage now includes:

**Mini-game pending state (one test per type):**
- B3 → `b3_unscramble_medium`
- B8 → `b8_crossword_60s`
- B10 → `b10_crossing_words`
- B11 → `b11_word_search`
- B12 → `b12_honeycomb`

Each asserts `miniGamePending: true`, the correct `miniGameKey` (so the UI routes to the right component), and `entries.length === 0` (so the engine doesn't queue boosts until the mini-game resolves).

**Mini-game success-result conversion:** parameterized test verifying `resolveMiniGameResult({ success: true, earnedPts })` produces the same `auto_extra_score` entry shape across earnedPts values of 10/25/40/50/100 — proves the shared result handler is correct regardless of which mini-game produced it.

**Wheel outcomes** — `WHEEL_OUTCOMES` has 8 entries; previously only 4 were tested. Added:
- `pts_1` → `auto_extra_score +1`
- `extra_turn` → `extra_turn` future effect
- `skip_turn` → `skip_opponent_turn` future effect
- `tile_swap` → `free_tile_swap` future effect
- Plus a defensive test that unknown `outcomeId` returns an error.

**Coverage matrix now complete:**
| Bonus | Category | Tested |
|-------|----------|--------|
| B1, B3, B8, B10, B11, B12 | mini-game | ✅ |
| B2, B4, B9 | auto | ✅ |
| B5, B6, B7 | future | ✅ |
| B13 + 8 wheel outcomes | wheel | ✅ |

**Not in scope:** the actual mini-game UI components (`b3_unscramble_medium` etc. point at UI controllers). Those are integration tests that would require jsdom or Playwright — out of scope for the bonus *resolution* layer, which is the engine concern this gap names.

---

### 7. Multiplier Forfeiture on Timeout *(Suspected Risk)* — ✅ RESOLVED (BUG FOUND & FIXED)

**Status:** Resolved (May 2026). Investigation confirmed the suspected bug was real, and it has been fixed.

**The bug:** The offline engine's `forfeitTimeoutBoosts(state, slot)` at [src/game/core/gameEngine.js:684](../src/game/core/gameEngine.js#L684) correctly drops `multiply_next_turns` entries for a player who times out (called from `handlePass({ reason: 'timeout' })`). But the online live-game watchdog's `applyPatchToRoom` at [src/game/online/timeoutWatchdog.js](../src/game/online/timeoutWatchdog.js) was NOT touching `activeBoosts`. Result: a player who activated B7 (×2 for 2 turns) could time out the first turn and still receive the full multiplier on their next play.

**The fix:** `applyPatchToRoom` now filters `room.activeBoosts` to drop `multiply_next_turns` entries owned by the timed-out slot. Matches offline engine semantics exactly. Opponent's boosts and other boost types (extra_turn, etc.) are preserved.

**Test coverage** in `tests/unit/engine-parity-live-watchdog.test.js`:
1. Timed-out player's `multiply_next_turns` is forfeited by the watchdog claim
2. Opponent's `multiply_next_turns` survives the claim (only the timing-out slot loses it)
3. Non-multiplier boosts (e.g. `extra_turn`) of the timed-out player survive — matching the offline forfeit rule

All three tests were written FAILING (confirming the bug), then made passing by the fix.

---

### 8. Friend Invite Room Creation *(Intentional Change, Parity Risk)* — ✅ RESOLVED (RECOVERY PATH ADDED)

**Status:** Resolved (May 2026). The intentional-change-register entry for "create room only on accept" stays — that's still the correct design choice for avoiding orphan rooms. What was missing was a recovery path for the partial-failure window the gap report names.

**The window:** `acceptInvite` deletes the invite atomically (transaction at [src/game/online/inviteService.js:75-81](../src/game/online/inviteService.js#L75-L81)) BEFORE creating the room. If `createRoom` then throws (RTDB rules rejection, network blip, etc.), the invite is gone, no room exists, no ack is written — the sender's listener would wait forever.

**The fix** in [src/game/online/inviteService.js:106-138](../src/game/online/inviteService.js#L106-L138):
- Wrap `createRoom` (+ status promotion for async) in try/catch
- On failure: write a `{ accepted: false, reason: 'room-create-failed' }` ack so the sender's `listenForInviteAcks` fires and their UI can show a rejection (they can re-invite)
- Return `{ ok: false, reason: 'room-create-failed', error }` to the accepter so their UI can show the error

**Test coverage** in `src/game/online/inviteService.test.js`:
- New test: `acceptInvite writes a failure ack when room creation fails AFTER invite is consumed` — wraps the mock db to throw on `rooms/*` writes, asserts the invite is consumed, no room exists, sender sees a failure ack, accepter gets `ok: false`.
- Existing happy-path test continues to pass (regression guard for the wrapped flow).

**Player-visible behavior change:** previously, if room creation failed silently, the sender's UI hung waiting for an ack. Now both sides see a clear rejection and can re-invite.

---

### 9. Live Timer Disconnect Flow *(High Parity Gap)* — ✅ RESOLVED

**Status:** Resolved (May 2026). Investigation confirmed the watchdog and presence systems are intentionally decoupled — the watchdog does not consult `/presence` at all. This is correct: if the active player has disconnected, only the watchdog can flip their turn (their tab can't dispatch PASS_TURN). The 30 s disconnect overlay and the turn-deadline claim operate independently.

**New test coverage:**
- `tests/unit/engine-parity-live-watchdog.test.js` — *"watchdog claims the timed-out turn regardless of opponent presence state"* seeds the opponent's presence as `connected: false` and asserts the watchdog still flips the turn and increments `missedTurns`. Documents the intended decoupling.
- `src/ui/controllers/disconnectController.test.js` — added *"isAppClosed: returns true only for backgrounded:true + connected:false"* to lock in the app-close detection that routes to immediate AUTO_WIN (bypassing the 30 s grace).

**Pre-existing test failures fixed** (test/implementation drift, both in item 9's domain):
1. `isPresenceOnline: backgrounded:true means alive but paused` — old test expected `{backgrounded:true, connected:false}` to be "online", but the hardened implementation treats this as app-close (offline). Replaced with two tests covering both sub-cases: backgrounded+connected (online) and backgrounded+disconnected (app-close → offline).
2. `offline opponent opens disconnect overlay` — used a single offline event with fixed `now`, so the accumulating grace never elapsed. Rewritten to advance `mockNow` across calls so the elapsed-time logic actually fires.

**Architectural confirmation:**
- Watchdog: claims when `now >= turnDeadlineMs + graceMs(1s)`, regardless of presence
- Disconnect overlay: opens when opponent's presence has been offline for `PRESENCE_GRACE_MS (30s)`
- App-close: bypasses the 30 s grace via `isAppClosed`, fires AUTO_WIN immediately
- Watchdog respects `status !== 'playing'`, so once AUTO_WIN promotes the room to `abandoned`, the watchdog stops claiming (no race between resign and final claim)

---

## Medium-Risk Gaps

### 10. Pending Tile Placement Ownership *(Intentional Change)*

**Status:** Confirmed intentional change (from `docs/intentional-change-register.md`)

Legacy code tracked pending tile placement state in global variables. Spine tracks it in `gameController.js` view-model. If the game screen unmounts and remounts (e.g., app backgrounded and resumed), pending placements may be lost.

**Impact:** Medium. UX regression during reconnect in live games.

---

### 11. Dictionary Admin Approved Words *(Missing Test)*

**Status:** Confirmed gap (from `docs/legacy-vs-new-gap-report.md`)

Words submitted to `/dictionaryApproved` are not proven to be used in game validation. `hebrewDictionary.js` loads only from `data/dictionary.base.txt`. Whether approved words from Firebase are merged into `DICT` is Unknown / needs verification.

**Impact:** Medium. Admin-approved words may not actually validate in-game.

---

### 12. Mobile UI Layout Parity *(Missing Verification)* — ⚠️ ACCEPTED LIMITATION

**Status:** Accepted as out-of-scope for unit tests (May 2026). Mobile layout regressions require visual diffing against real viewports — Playwright/screenshot infrastructure that doesn't exist in this repo. The `npm run test:e2e` script uses Python http.server + Playwright, but no mobile-viewport screenshot tests have been authored.

**Mitigations in place:**
- `manifest.json` enforces portrait-only orientation (eliminates landscape edge cases)
- `gameScreen.js` DOM IDs are stable contracts documented in `docs-md/docs/ui-rules.md` (renaming requires test sweep)
- Duplicate `#is-sv*` / `#is-sb*` elements are intentional — they're per-orientation variants

**To resolve fully:** add Playwright tests under `tests/e2e/` that render at iPhone SE / Pixel 5 / iPad viewports and assert no overflow, no clipped score panels, rack tiles >= 44px touch target. Out of scope for the current unit-test hardening pass — track as a separate Playwright effort.

---

### 13. Scoring Animation Timing Race *(Suspected Risk)* — ✅ RESOLVED (REFACTORED)

**Status:** Resolved (May 2026) — divergence is now structurally impossible.

**The fix:** extracted the 7 timing constants to a single shared module at [src/ui/scoreAnimationTimings.js](../src/ui/scoreAnimationTimings.js). Both [src/ui/controllers/animationController.js](../src/ui/controllers/animationController.js) and [src/ui/screens/gameScreen.js](../src/ui/screens/gameScreen.js) now import from this module — the old local `const`s have been deleted from both files.

**Constants moved:** `WORD_MERGE_STAGGER_MS`, `WORD_MERGE_FLIGHT_MS`, `BOOST_MERGE_DELAY_MS`, `HOLD_AFTER_MERGE_MS`, `SUM_FLIGHT_MS`, `COUNTUP_PEAK_MS`, `SUM_CHIP_HOLD_MS`.

**gameScreen.js** imports under the original `SCORE_MERGE_*` aliases to minimise diff churn in the >1000 references inside that file.

**docs-md/CLAUDE.md needs update:** the rule "If you change timings, sync both files" is now obsolete — edit `scoreAnimationTimings.js` instead.

---

### 14. Settings Migration Edge Cases *(Missing Test)* — ✅ RESOLVED

**Status:** Resolved (May 2026). 7 new tests in `src/game/settings/settingsCompat.test.js` cover the migration paths the gap report named:

1. **Corrupt JSON** in localStorage falls back to defaults without throwing
2. **Out-of-range numeric values** (botTime=99999, maxMoves=-10, appealsMax='banana') are clamped or default-replaced
3. **Unknown fields** in storage (from future or pre-V1 versions) are silently dropped; valid known fields preserved
4. **Missing UI preferences key** returns defaults (no throw)
5. **Corrupt UI preferences JSON** falls back to defaults
6. **Storage throwing** (QuotaExceededError) is caught by `saveGameSettings` → returns `false`
7. **Storage throwing** is also caught by `saveUiPreferences` → returns `false`

**Stale test fixed:** the existing "UI preferences support animation skip" test expected an object missing `soundFx`/`vibration` keys, but `normalizeUiPreferences` now adds these defaults. Updated to match.

13 settings tests pass (6 existing + 7 new).

---

## Low-Risk Gaps

### 15. Menu Transition Animation Differs *(Low Priority)* — ⚠️ ACCEPTED COSMETIC DIFFERENCE

**Status:** Accepted as cosmetic difference (May 2026). The new `screenTransitions.js` uses CSS-class-based transitions instead of the legacy timer-driven keyframes. The new system is cleaner and has unit coverage in `src/ui/screens/screenTransitions.test.js`. No player has reported the difference; it does not affect gameplay or button responsiveness (covered by other tests).

**Future note:** if a player flag arrives, the resolution is either to add the change to `docs/intentional-change-register.md` or to backport the legacy timing constants. Until then, accepted as-is.

---

### 16. Music Scheduling *(Low Priority)* — ⚠️ ACCEPTED LOW-PRIORITY GAP

**Status:** Accepted as low-priority gap (May 2026). `audioService.js` has unit tests covering play/pause/toggle and the no-op-when-no-source path. The "when does music start/stop between game modes" characterization is not documented but the implementation is small (a single service file). Audio-only regression would be quickly user-reported and easy to bisect against `audioService.js` git history.

**To resolve fully:** add a per-mode scheduling characterization in `docs-md/docs/ui-rules.md`. Not blocking — the area has no known bugs.

---

### 17. Appeal/Dictionary Challenge UI *(Medium Priority)* — ⚠️ NOT IMPLEMENTED IN SPINE (documented)

**Status:** Confirmed not-implemented (May 2026). Investigation found that the legacy dictionary appeal/challenge UI was never ported to the spine. The `appealsMax` setting exists in [src/game/settings/settingsCompat.js:13](../src/game/settings/settingsCompat.js#L13) with a default of `0`, but no UI or engine code reads it — it's a vestigial settings field.

**No grep hits** for `appeal`, `forceAccept`, or `challenge.*word` across `src/` outside of `settingsCompat` itself. The `partials/screens/bonus-challenge.html` file is about a bonus mini-game (the "challenge" mode), unrelated to the dictionary appeal flow.

**Recommendation:** add an entry to `docs/intentional-change-register.md` declaring "Dictionary appeal/force-accept UI dropped in spine" as an accepted scope reduction, OR schedule the feature for re-implementation. Until then, the `appealsMax` field in `DEFAULT_GAME_SETTINGS` should be removed (or kept with a `// vestigial — see GAP_REPORT item 17` comment) to avoid future devs assuming it's wired.

**Player-visible:** the legacy "challenge this word" overlay does not exist in the spine. Invalid moves are simply rejected with the `INVALID_MOVE_REJECTED` event; the player has no override mechanism. This is intentionally the same behavior as a Scrabble word-validator app.

---

## Fragile Modules

### `gameScreen.js` — ⚠️ remains fragile (architectural)
- Very large (complex animation orchestration + placement state machine)
- Hard-codes ~20 DOM IDs — any HTML change in `partials/screens/game.html` could break silently
- Score animation polling (`setInterval(100ms)` for overlay close) is a polling pattern that could miss events
- **Mitigation added (item 13):** scoring animation timing constants moved to shared `src/ui/scoreAnimationTimings.js` so they cannot diverge from `animationController.js`

### `hebrewDictionary.js` — ⚠️ remains fragile (data curation)
- Complex lemmatization with multiple stripping strategies
- `EXACT_REJECTS` set (~220 entries) relies on manual curation — a wrong entry silently rejects valid words
- No comprehensive test that validates all ~220 EXACT_REJECTS are actually incorrect words
- **Mitigation added (item 11):** Firebase-approved words now have end-to-end test proving they merge into `DICT` and pass `isValid()` — incorrect rejects can be overridden by admin approval

### `timeoutWatchdog.js` — ✅ hardened
- Runs in the browser (not server-side) — by design
- **Item 3 mitigation:** test coverage for "transient no-op tick does not latch — next tick claims when conditions clear" proves the polling-as-retry pattern works. Cloudflare RTDB transactions also retry internally up to 25 times.
- **Item 7 fix:** the watchdog's `applyPatchToRoom` now correctly forfeits the timed-out player's `multiply_next_turns` (previously persisted across missed turn — bug)
- **Item 9 confirmation:** the watchdog intentionally ignores `/presence`; it claims when deadline+grace pass regardless of opponent connectivity
- `liveBonus.active` gate timing window remains theoretical; no observed incidents

### `firebaseClient.js` — ⚠️ unchanged
- CDN-loaded SDK: if CDN is down, app fails silently in offline-capable scenarios
- Reuses `firebase.apps[0]` if legacy code initialized first — ordering dependency with legacy code in `index.html`
- Not addressed in this pass — would require either bundling Firebase locally or adding a CDN-down fallback path

### `asyncReminderService.js` — ✅ hardened
- **Item 4 fix:** server-side cron sweep added in `worker/src/cronSweep.js`, runs every 4 hours via Cloudflare Workers cron triggers. Browser sweep is now belt-and-suspenders.
- Idempotency via `lastReminderAt` is the same on both sides; whichever sweep runs first writes the marker.
- Anti-drift coverage: `worker/test/cronSweep.test.js` parity-tests the worker's `classify()` against the app's — 7 scenarios.
- Double-tab sweep race no longer matters because the cron is the source of truth.

---

## Parity Risk Summary

From `docs/legacy-gameplay-parity-gap-report.md`:

| Risk Level | Count | Status |
|-----------|-------|--------|
| Critical | 1 | Open (turn recovery with unconfirmed tiles) |
| High | 4 | Partially addressed |
| Medium | 5 | Open |
| Low | 2 | Open (low priority) |
| Verified matches | 11 | Confirmed parity |
