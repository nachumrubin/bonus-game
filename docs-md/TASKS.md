# TASKS.md — TODOs, Risks, and Recommended Work

> Derived from: `SPINE_TODO.md`, `docs/legacy-vs-new-gap-report.md`, `docs/legacy-gameplay-parity-gap-report.md`, source code analysis
> All items are evidence-based — not invented.

---

## Completed (May 2026)

- ✅ Electric Floating Platforms main menu redesign — `menu-electric.css` + updated `home.html`, `menuScreen.js`, `main.js`

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
