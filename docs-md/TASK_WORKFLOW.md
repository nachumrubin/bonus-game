# TASK_WORKFLOW.md — Per-Task Protocol for Agents

Every task — bug fix, new feature, refactor — follows this protocol.
Do not skip steps. The cost of a broken live game is high.

---

## Step 1: Understand the Task

Before writing a single line of code:

1. **Identify the task type** (use the table below)
2. **Read the relevant docs** listed for that type
3. **Search for existing coverage** — check if the area has unit tests, what they assert, and whether your change could break them
4. **Check `docs-md/GAP_REPORT.md`** — if the area is listed as fragile or risky, slow down and read carefully

| Task type | Required pre-reading |
|-----------|---------------------|
| Game engine (scoring, moves, turns, board) | `GAMEPLAY_RULES.md`, `CHARACTERIZATION.md`, `CLAUDE.md` |
| Boost / bonus system | `GAMEPLAY_RULES.md` (Bonus section), `API_REFERENCE.md` (bonusResolver), `GAP_REPORT.md` |
| Firebase / online / rooms | `docs/firebase-flow.md`, `docs/db-schema.md`, `GAP_REPORT.md` |
| Notifications (push, browser, toast) | `docs/notifications.md` |
| UI screen (new or modified) | `docs/ui-rules.md`, `CHARACTERIZATION.md` |
| Animation | `docs/ui-rules.md` (Animation section) |
| Dictionary / Hebrew validation | `GAMEPLAY_RULES.md` (Dictionary section), `CLAUDE.md` |
| Settings / local storage | `CHARACTERIZATION.md` (Settings section) |
| Test addition | `TEST_STRATEGY.md` |
| Firebase rules | `docs/firebase-flow.md`, `docs/db-schema.md` |
| Bot / AI player | `GAMEPLAY_RULES.md` (Bot section), `GAP_REPORT.md` |
| Account / profile / rating | `API_REFERENCE.md` (ratingService), `docs/db-schema.md` |

---

## Step 2: Locate the Code

Find the canonical implementation location before touching anything:

- Check `docs-md/FILE_INDEX.md` to find the right file
- Check `docs-md/API_REFERENCE.md` to understand the public API of the module you're touching
- Check `docs-md/DECISIONS.md` — if a decision is documented there, understand *why* before overriding it
- Run a search for existing handling: `grep -r "CMD.YOUR_COMMAND\|EV.YOUR_EVENT" src/` before adding new commands or events

---

## Step 3: Plan Before Implementing

For any non-trivial change (more than a one-line fix), write out your plan in the chat before coding:

- What files will change?
- What tests cover this area?
- Will this change any behavior visible in `GAMEPLAY_RULES.md` or `CHARACTERIZATION.md`?
- Does this require a Firebase rule change?
- Does this touch any constants listed as "never change" in `docs-md/CLAUDE.md`?

If the answer to the last two questions is yes, state it explicitly.

---

## Step 4: Implement

Follow these rules by task type:

### Engine Changes (`src/game/core/`)
- Keep all files free of DOM, Firebase, and timers
- Add/modify only via the `dispatch()` command pattern
- Every new command needs a handler + a test
- Run the engine in isolation (`node --test src/game/core/*.test.js`) before running the full suite

### Firebase / Online Changes
- All game-state writes go through `commitTransaction()` — no exceptions
- New Firebase paths: add to `schema.js` PATH, add rules to `firebase.database.rules.json`, add emulator tests
- Never write to `/presence/{uid}` from outside `presenceService.js`
- Test with mock Firebase first (`mockFirebase.js`), then with real emulator

### UI Changes
- Never hard-code a DOM ID that isn't in `docs-md/docs/ui-rules.md` — add it there if it's new and load-bearing
- New screens: add partial HTML → register in `screenPartialManifest.js` → create screen JS → wire via bus events
- Never call screen functions directly — emit intent events
- Changing a button's `onclick` attribute: update the corresponding selector in the JS controller

### Animation Changes
- Keep timing constants in sync between `animationController.js` and `gameScreen.js`
- Never gate gameplay on animation completion (only bonus overlays may gate the watchdog)
- New overlay that should pause score animation: must set `liveBonus.active` and be checked in the animation poller

### Boost / Bonus Changes
- New bonus type: add to `bonusTileDefs.js` → add handler in `bonusResolver.js` → add plugin in `futureEffects/` → register in `index.js` → add tests
- Never add mini-game score directly — always go through `CMD.FINALIZE_BOOST_AWARD` → `EV.MOVE_SCORE_COMMITTED` → second `commitTransaction()`
- Test the full deferred-score path end-to-end before closing

### Notification Changes
- Push text is Hebrew — coordinate wording carefully
- New push kind: add to `KIND` enum in `pushPayloadBuilder.js` → add to service worker routing in `sw.js` → add to `browserNotificationFallback.js` route map → add to `notificationService.js`

---

## Step 5: Test

**Mandatory for every task:**
```bash
npm run test:unit
```
All 609+ tests must pass. If count drops, you broke something — fix it before continuing.

**Also required if:**

| Condition | Additional test |
|-----------|----------------|
| `firebase.database.rules.json` changed | `npm run test:emulator` |
| UI screen or routing changed | `npm run test:e2e` |
| New feature with no test | Write the test first, then implement |

**Test writing rules:**
- New game engine behavior → test in the corresponding `src/game/core/*.test.js` file
- New online service behavior → test with `mockFirebase.js`
- New Firebase rule → test in `tests/emulator/`
- Never test animation frame timing directly — test the event/directive that triggers it
- Use injectable clocks (`now` parameter) for any time-dependent logic, never raw `Date.now()`

---

## Step 6: Update Documentation

After every task, update the docs that were affected. This is not optional — stale docs are worse than no docs.

### Always update (every task):
- [ ] `docs-md/CHANGELOG.md` — add an entry: what changed, what PR/commit, why
- [ ] `docs-md/TASKS.md` — mark completed items ✅, add newly discovered TODOs

### Update if the behavior changed:
- [ ] `docs-md/GAMEPLAY_RULES.md` — if any rule, value, or mechanic changed
- [ ] `docs-md/CHARACTERIZATION.md` — if any observable behavior changed
- [ ] `docs-md/API_REFERENCE.md` — if any public function signature or return shape changed
- [ ] `docs-md/docs/db-schema.md` — if any Firebase document field was added/removed/renamed
- [ ] `docs-md/docs/firebase-flow.md` — if any Firebase path, flow, or lifecycle changed
- [ ] `docs-md/docs/notifications.md` — if notification behavior or kinds changed
- [ ] `docs-md/docs/ui-rules.md` — if DOM IDs, screen structure, or animation timings changed

### Update if a new risk was found or resolved:
- [ ] `docs-md/GAP_REPORT.md` — add newly discovered gaps; mark resolved ones

### Update if a new architectural decision was made:
- [ ] `docs-md/DECISIONS.md` — document the decision and why

### Update if file structure changed:
- [ ] `docs-md/FILE_INDEX.md` — add new files, mark deleted ones

---

## Step 7: Commit

Commit message format:
```
<type>: <short description>

<optional body: what changed and why>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Commit docs updates **in the same commit** as the code change — not separately. This keeps the changelog honest.

---

## Quick Reference: Forbidden Actions

| Never do this | Because |
|---------------|---------|
| Change `RACK_SIZE`, `BOARD_SIZE`, `BINGO_BONUS` | Corrupts live Firebase game state |
| Change `EV.*` or `CMD.*` string values | Breaks online session event matching |
| Rename Firebase path constants in `schema.js` | Breaks all active online games |
| Write to a Firebase room without `commitTransaction()` | Race condition — two moves can corrupt state |
| Add DOM/Firebase/setTimeout inside `src/game/core/` | Breaks Node.js unit testability |
| Rename load-bearing DOM IDs without updating JS selectors | Silent breakage — no error thrown |
| Commit `config.js` | Exposes live credentials |
| Push without running `npm run test:unit` | May ship broken gameplay |
| Update only code without updating docs | Docs go stale; next agent works with wrong context |
| Duplicate logic that already exists in a canonical module | Creates drift; next bug only gets fixed in one place |

---

## Quick Reference: Safe Patterns

| Do this | When |
|---------|------|
| `commitTransaction(db, roomId, expectedVersion, fn)` | Any online game-state write |
| `bus.emit(INTENT.*)` | Any UI cross-screen communication |
| `CMD.FINALIZE_BOOST_AWARD` → `MOVE_SCORE_COMMITTED` | Any deferred mini-game score |
| Injectable `now` parameter | Any time-dependent logic |
| `mockFirebase.js` | Unit-testing online services |
| `setFirebaseImplForTests()` | Injecting mock in integration tests |
| Check `docs-md/GAP_REPORT.md` | Before touching a "fragile module" |
