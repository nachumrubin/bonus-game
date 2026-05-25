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

### 1. OneSignal REST Key Exposed Client-Side *(Security Risk)*

**Status:** Confirmed architectural risk

The OneSignal REST API key (`onesignalKey`) is loaded from `config.js` into browser memory and used client-side to call the OneSignal REST endpoint directly (`https://onesignal.com/api/v1/notifications`). Any user who inspects network traffic or JavaScript memory can extract this key and send push notifications to any subscriber.

**Source:** `src/notifications/notificationService.js`, `src/main.js`

**Impact:** High. Unauthorized push sends possible.

**Mitigation available:** Move push sending to a Firebase Cloud Function or serverless endpoint. Currently there is no Cloud Function infra.

---

### 2. Turn Recovery with Unconfirmed Tiles *(Critical Parity Gap)*

**Status:** Confirmed gap (from `docs/legacy-gameplay-parity-gap-report.md`)

If a player places tiles but loses connectivity before confirming, the state of those tentative tiles is owned by the UI layer only. On reconnect, the engine state may not include those tiles. The recovery behavior for this case is not fully verified.

**Source:** `docs/legacy-gameplay-parity-gap-report.md` (Critical, item 1)

**Impact:** High. Player could lose placed tiles silently.

---

### 3. Two Consecutive Missed Turns Forfeit — Race Condition *(Suspected Risk)*

**Status:** Suspected risk

`timeoutWatchdog.js` performs a Firebase transaction to claim a timed-out turn. If network latency causes both players to attempt the claim simultaneously (e.g., reconnect race), the transaction may fail and be retried. The watchdog does not have explicit retry logic visible in the code. The `committed: false` path from the transaction is not traced to a retry.

**Source:** `src/game/online/timeoutWatchdog.js`

**Impact:** Medium. Rare race could leave game in perpetual stale state.

---

### 4. Async Reminder Sweep Runs Client-Side *(Architecture Concern)*

**Status:** Confirmed architectural risk

The 24-hour idle reminder and 7-day expiry sweep (`asyncReminderService.sweepForUser()`) runs in the player's browser. This means:
- If neither player opens the app for 7 days, no expiry fires
- The sweep is not guaranteed to run consistently
- Two simultaneous sweeps could double-send notifications (idempotency via `lastReminderAt` partially mitigates this but the window is not zero)

**Source:** `src/game/online/asyncReminderService.js`

**Impact:** Medium. Async games may not expire on schedule; reminder notifications may be missed.

---

## High-Risk Gaps

### 5. Bot Move Quality Not Tested *(Missing Test)*

**Status:** Confirmed missing test

`botSearch.js` is the bot's move selection algorithm. No unit test file found for this module. The bot's correctness (whether it finds valid Hebrew words, plays legally) is not verified by the test suite.

**Source:** `SPINE_TODO.md`, `docs/legacy-vs-new-gap-report.md`

**Impact:** High. A bug in bot search could produce illegal moves or crashes during offline-solo games.

---

### 6. B1–B13 Bonus Branch Coverage Incomplete *(Missing Test)*

**Status:** Confirmed gap (from `SPINE_TODO.md`)

Not all B1–B13 bonus type branches have assertion tests. The mini-game resolution paths (B1, B3, B8, B10, B11, B12) and the wheel outcome paths (B13) have limited test coverage compared to the auto-bonus paths (B2, B4, B9).

**Source:** `SPINE_TODO.md`, `src/game/boosts/futureEffects/plugins.test.js`

**Impact:** High. A broken mini-game bonus could corrupt scoring for all moves in that game.

---

### 7. Multiplier Forfeiture on Timeout *(Suspected Risk)*

**Status:** Suspected risk

`multiply_next_turns` effect is supposed to be lost if the active player times out. This is mentioned in game engine comments, but it's unclear if the watchdog's timeout-claim transaction correctly discards the active boost entry.

**Source:** `src/game/core/gameEngine.js` (boost handling comments), `timeoutWatchdog.js`

**Impact:** High. Could allow score multipliers to persist across undeserved turns.

---

### 8. Friend Invite Room Creation *(Intentional Change, Parity Risk)*

**Status:** Confirmed intentional change (registered in `docs/intentional-change-register.md`)

The legacy system created the room when the invite was sent. The spine creates the room only when the invite is accepted. This changes timing for room ID availability and potential orphan-room scenarios.

**Impact:** Medium. If invite is accepted but room creation fails, the game never starts (no orphan room problem, but also no fallback).

---

### 9. Live Timer Disconnect Flow *(High Parity Gap)*

**Status:** Confirmed gap (from `docs/legacy-gameplay-parity-gap-report.md`)

The interaction between the live turn timer and player disconnect is not fully verified. Specifically: when the opponent disconnects mid-turn, does the watchdog still claim the turn after the deadline? Does the presence grace period (30s) interact correctly with the turn deadline?

**Source:** `presenceService.js` (`PRESENCE_GRACE_MS = 30_000`), `timeoutWatchdog.js`

**Impact:** High in live games. Could result in incorrect turn forfeiture.

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

### 12. Mobile UI Layout Parity *(Missing Verification)*

**Status:** Confirmed missing verification (from `docs/legacy-gameplay-parity-gap-report.md`)

Mobile layout behavior (score visibility on small screens, rack touch targets, bonus overlays on small viewport) is not covered by automated tests. The duplicate `#is-sv*` / `#is-sb*` elements suggest a known mobile layout complexity.

**Impact:** Medium. Could have regressions in UX on mobile without E2E visual tests.

---

### 13. Scoring Animation Timing Race *(Suspected Risk)*

**Status:** Suspected risk

Scoring animation timing constants are duplicated in both `animationController.js` and `gameScreen.js`. If they diverge, the animation sequence will be visually incorrect but gameplay will continue normally.

**Source:** `src/ui/controllers/animationController.js`, `src/ui/screens/gameScreen.js`

**Impact:** Low-medium. Visual only; no gameplay impact.

---

### 14. Settings Migration Edge Cases *(Missing Test)*

**Status:** Suspected risk

`settingsCompat.js` migrates from legacy `bonusGameSettingsV1` localStorage format. The migration path for users upgrading from very old versions (before V1 settings schema) is not traced. If `localStorage` contains unexpected keys, behavior is Unknown / needs verification.

**Source:** `src/game/settings/settingsCompat.js`

**Impact:** Medium. First-launch settings could silently revert to defaults.

---

## Low-Risk Gaps

### 15. Menu Transition Animation Differs *(Low Priority)*

**Status:** Confirmed gap (from `docs/legacy-gameplay-parity-gap-report.md`)

The menu transition animation sequence differs from legacy. Intentional or not is Unknown / needs verification — not in the intentional change register.

**Impact:** Low. Visual only.

---

### 16. Music Scheduling *(Low Priority)*

**Status:** Confirmed missing characterization (from `docs/legacy-gameplay-parity-gap-report.md`)

Background music scheduling behavior (when it starts, when it stops, between game modes) is not characterized in parity documentation.

**Source:** `src/ui/audioService.js`

**Impact:** Low. Audio regression risk only.

---

### 17. Appeal/Dictionary Challenge UI *(Medium Priority)*

**Status:** Partially covered (from `docs/legacy-vs-new-gap-report.md`)

The dictionary challenge UI flow (player challenges a word, `appealsMax` limit) is not fully mapped from legacy to spine.

**Source:** `settingsCompat.js` (`appealsMax: 3` default)

**Impact:** Medium. Feature may silently not work in spine.

---

## Fragile Modules

### `gameScreen.js`
- Very large (complex animation orchestration + placement state machine)
- Hard-codes ~20 DOM IDs — any HTML change in `partials/screens/game.html` could break silently
- Score animation polling (`setInterval(100ms)` for overlay close) is a polling pattern that could miss events

### `hebrewDictionary.js`
- Complex lemmatization with multiple stripping strategies
- `EXACT_REJECTS` set (~220 entries) relies on manual curation — a wrong entry silently rejects valid words
- No comprehensive test that validates all ~220 EXACT_REJECTS are actually incorrect words

### `timeoutWatchdog.js`
- Runs in the browser (not server-side)
- No retry logic visible for failed transaction claims
- Guard condition `liveBonus.active` requires `liveBonus` to be written to Firebase before watchdog polls — timing window exists

### `firebaseClient.js`
- CDN-loaded SDK: if CDN is down, app fails silently in offline-capable scenarios
- Reuses `firebase.apps[0]` if legacy code initialized first — ordering dependency with legacy code in `index.html`

### `asyncReminderService.js`
- Client-side sweep with idempotency via `lastReminderAt`
- No test for double-sweep scenario (two browser tabs both sweeping simultaneously)

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
