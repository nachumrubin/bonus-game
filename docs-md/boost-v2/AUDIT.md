# Boost 2.0 — Phase 0 Repository Audit

> Branch: `ccr-6539e67f-s95dhk` (the session's assigned development branch; used as the Boost 2.0 branch).
> Audit date: 2026-11-19. Baseline: `npm run test:unit` → **1870 / 1870 pass** (0 fail) before any Boost 2.0 change.

## 1. Existing architecture summary

Vanilla ES-module web app (no framework, no bundler), Capacitor Android wrapper, Firebase Realtime Database for online play, a Cloudflare Worker (`worker/`) for push, economy, billing and cron sweeps.

| Layer | Location | Notes |
|---|---|---|
| Pure engine | `src/game/core/` | No DOM / Firebase / timers. Command → `dispatch()` → events on a bus. |
| Board | `core/board.js` | 10×10 grid + 12 **off-grid** bonus squares (`bonusBoard` Map, r/c ∈ {−1, 10}). |
| Tiles | `core/letterDistribution.js`, `core/tileBag.js` | `HV` values, `HD` counts (**99** tiles, 2 jokers worth 0 — `GAMEPLAY_RULES.md` said 108; corrected). Seeded mulberry32 bag, LIFO draws, `RACK_SIZE = 8`. |
| Move validation | `core/moveValidator.js` | collinear, no gaps, connected to committed tile; **no centre-square rule**. |
| Word extraction + scoring | `core/scoringEngine.js` | `getAllWords()` (main + cross words, coordinate-deduplicated), `scoreMove()` = Σ tile values + `BINGO_BONUS = 50` at 8 tiles. **No letter/word multipliers exist.** |
| Dictionary | `core/hebrewDictionary.js` | `isValid()` sync; terminal final-form folding; `norm()` final→medial. |
| Turns / endgame | `core/turnManager.js` | pass, exchange (any count ≤ bag; returns then draws), locks, resign, `isGameOver` (4 scoreless turns, or bag empty + one rack empty), stall claim. **No rack-tile deduction at game end.** |
| Engine | `core/gameEngine.js` | CONFIRM_MOVE (with tile **swaps** and optional **lock**), bonus-square deferred scoring (FINALIZE_BOOST_AWARD), plugin boosts via `boostEngine.js`. |
| Legacy "boost" system | `src/game/boosts/` | 12 bonus squares × B1–B14 types → mini-games, wheel, future effects (extra turn, ×2/×4, skip, free swap, cancel, timer). |
| Sessions | `src/game/sessions/` | local, bot (`botSearch.js`, 3 difficulty profiles), tutorial, online (`onlineGameSession.js`). |
| Online | `src/game/online/` | `roomService.commitTransaction()` version-guarded writes of the **whole engine state** to `/rooms/{id}`; matchmaking, invites, async, watchdog. |
| UI | `src/ui/`, `partials/`, `styles.css`, `main.js` (6 130 lines) | `gameScreen.js` (2 698 lines) renders the 12×12 unified grid; RTL — column 0 is the rightmost cell. |
| Backend | `worker/` | Push, economy, billing, account delete, cron. **No game-move validation.** |

## 2. Specification → existing module mapping

| Spec area | Existing module | Boost 2.0 handling |
|---|---|---|
| §5.1 opening centre rule | `moveValidator.validateMove` (none today) | New V2-only check (`boostV2/moveRulesV2.js`) |
| §5.2 placement / words | `moveValidator`, `scoringEngine.getAllWords` | **Reused unchanged** |
| §5.3 normalisation | `hebrewDictionary.norm` | Reused via `boostV2/hebrew.js` |
| §6 additive scoring | `scoringEngine.scoreWord` | Reused per word; new `boostV2/scoringV2.js` builds the breakdown, +25 full rack |
| §6.3 endgame deductions | `turnManager.winnerSlot` | V2-only deduction applied once in `finishGame` |
| §7 exchange | `turnManager.applyExchange` | New V2 variant: draw-before-return |
| §8–12 challenges | — (new) | `boostV2/challengeCatalog.js`, `challengeEvaluator.js` |
| §13–17 queue | — (new) | `boostV2/deckManifest.js`, `challengeQueue.js` |
| §18–22 placement | — (new) | `boostV2/boostPlacement.js` |
| §23 turn transaction | `gameEngine.handleConfirmMove` | New `handleConfirmMoveV2` branch, one atomic engine step |
| §26–29 persistence | `schema.buildRoomDoc`, `onlineGameSession` | New `ruleset` + `boostV2` room fields (Phase 7) |
| §36–38 bot | `sessions/botSearch.js` | Phase 6 |
| §30–35 UI | `gameScreen.js`, partials | Phase 5 |

## 3. Legacy bonus dependency map (what Boost 2.0 must switch off — for V2 only)

| Legacy mechanic | Where | V2 |
|---|---|---|
| Off-grid bonus squares (BDEFS, `bonusBoard`, `bonusAssignment`, `bonusSqUsed`) | `board.js`, `boosts/data.js`, `gameEngine` | Off — placements must be on the 10×10 grid |
| Bonus mini-games / wheel / deferred score (`pendingScoreCommit`, `FINALIZE_BOOST_AWARD`, `liveBonus`) | `gameEngine`, `boosts/*`, UI controllers, watchdog | Off |
| Future-effect plugins (`activeBoosts`, `boostEngine.runHook`) | `boostEngine.js`, `boosts/futureEffects` | Off (array stays empty) |
| Bingo +50 | `scoringEngine.BINGO_BONUS` | V2 uses `rules.fullRackBonus = 25`. **`BINGO_BONUS` constant is not changed** (hard rule). |
| Locks (`PLACE_LOCK`, word+lock, `lockInventory`) | `turnManager`, `gameEngine` | Off (spec §4 "do not introduce board locks") — V2 inventory is empty |
| Tile swaps (`swappedTiles`) | `gameEngine` | Off (spec §5.2 "existing tiles cannot be moved, replaced or removed") |

Legacy matches keep every one of these: all V2 behaviour is gated on `state.ruleset === 'BOOST_V2'`; a state without `ruleset` is `LEGACY_V1`.

## 4. Extracted configuration (unchanged)

- Tiles: see `docs-md/boost-v2/ANALYSIS.md` (99 tiles = Σ`HD`, jokers 2 × value 0).
- Joker: stored in rack as `'?'`, placed with `isJoker: true`, a represented `letter`, `val: 0`.
- Endgame triggers: `passCount ≥ 4` (pass / exchange / timeout / illegal-word all count); bag empty and a rack empty; resign; stall claim (leader, `passCount ≥ 2`). Winner by higher score, tie = draw.
- Exchange today: 1..n letters if bag ≥ n; returned + reshuffled, then rack refills.

## 5. Reusable components

`getAllWords` / `scoreWord` (word extraction, dedup by coordinates), `validateMove` (collinear / gaps / connectivity), `isValid` + `norm`, `createBag` / `drawInto` / `returnTilesAndShuffle`, `createRng` / `shuffle`, `applyMove` / `applyPass` / `advanceTurn` / `isGameOver`, `commitTransaction` version guard, bot `searchBotMove` candidate generator (Phase 6), event bus + session adapters.

## 6. Architectural risks and blockers

1. **RESOLVED (Nov 2026, D-boost-v2-worker) — was: no authoritative server for moves; rooms are world-readable.** Implemented as proposed below (`worker/src/boostTurn.js`, `boostV2Secret`, `boostV2Racks`, BOOST_V2 room lock). Legacy rooms remain world-readable and client-written. `firebase.database.rules.json` has `rooms/.read: true`. Every room exposes the bag, `tileBagSeed`, and *both racks* to any client today. Moves are computed client-side and written whole. A hidden Boost queue therefore **cannot be secret** in the current architecture (spec §27). Minimum backend change proposed: move V2 turn submission to a Worker endpoint (Admin SDK, already present in `worker/src/firebaseRtdb.js`) that runs the same pure engine, keeps `boostV2Secret/{roomId}/queue` in a path with `.read: false`, and writes only the public projection; tighten `rooms/.read` to the two players. Until then V2 online must not be described as secure competitive play. *(Decision required.)*
2. Online state is written as one blob by the moving client; rules check version + turn ownership only, not scores. Clients can already write arbitrary scores (pre-existing; same root cause as 1).
3. `gameEngine.js` (1 054 lines) mixes legacy flows; V2 is a separate branch of handlers to avoid perturbing parity-critical legacy code.
4. `BINGO_BONUS` — **decided:** changed to 25 for every ruleset (legacy included); V2 reads it.
5. Firebase drops empty arrays — V2 state needs normalisation on resume (same pattern as `normalizeLockInventory`).
6. Live turn timer / watchdog assume `turnNumber + 1` on timeout writes; the opening-setup phase does not advance `turnNumber` (see §8 ambiguities).

## 7. Phased implementation checklist

- [x] Phase 0 — audit, analysis utility, candidate deck
- [x] Phase 1 — centre rule, on-grid rule, +25 full rack, multi-tile exchange (draw-before-return), endgame deductions, draw (V2 only)
- [x] Phase 2 — catalog, typed definitions, nine evaluators, normalisation, joker handling
- [x] Phase 3 — deck manifest, queue generation, FIFO, preview, persistence of rules/deck version
- [x] Phase 4 — placement validator, batch planning, Bridge fallback, opening setup, atomic V2 turn, idempotency, invariants
- [ ] Phase 5 — UI (rendering, tooltips, preview, placement mode, breakdown, setup)
- [ ] Phase 6 — bot
- [ ] Phase 7 — multiplayer (blocked on decision §6.1 for the *secure* variant)
- [ ] Phase 8 — simulation, telemetry sink, balance report (analysis utility + engine telemetry events done)
- [ ] Phase 9 — release preparation

## 8. Conflicts and ambiguities (documented, not silently resolved)

| # | Item | Prototype handling |
|---|---|---|
| A1 | Spec §4 lists "letter/word multipliers" to remove — none exist; the legacy static bonus is the 12 off-grid squares + mini-games. | Off-grid squares disabled in V2. |
| A2 | Locks and tile swaps are existing mechanics not mentioned as preserved. | **Decided:** locks removed in V2; tile swaps stay available (rules 0.2). |
| A3 | Stall claim compares accumulated scores; with V2 rack deductions the claimant can finish behind. | Eligibility unchanged (accumulated score); winner = higher *final* score per spec §6.3. **Review.** |
| A4 | Rack deductions on resign / abandonment. | **Decided:** both racks deducted; the resigning/abandoning player still loses. |
| A5 | Opening setup when initialisation was deferred (board still empty after round 1). | Setup triggers after the first valid word; order = [other(next), next, other(next)] where `next` is the player whose normal turn follows — reduces to second/first/second in the normal case. |
| A6 | Timeouts / passes / exchanges during opening setup (spec says review). | PASS/EXCHANGE/CONFIRM_MOVE rejected during setup; a PASS with `reason: 'timeout'` auto-places on the deterministic first legal square. **Review.** |
| A7 | Multiple Bridge Builders that cannot all be retained. | Fallback applied to the latest Bridge in FIFO order first, until an arrangement exists. |
| A8 | Move that ends the match with replacement placements attached. | Placements ignored (none required, spec §23). |
| A9 | Power Word Easy (≥ 8): 98 % of common words qualify at word level. | **Decided:** Easy level removed (deck 0.2, 95 cards). |
| A10 | Rack deduction for jokers. | Joker value 0 → deducts 0 (existing value). |
| A11 | Pending (unplaceable) queue entries retry "after subsequent valid word moves". | A move's replacement batch = consumed + previous deficit, allocated FIFO from the cursor; the longest placeable prefix is mandatory. |
| A12 | "First round" with an exchange/pass. | Any turn-ending action (move, pass, exchange, timeout) counts as a first-round turn opportunity. |

## 9. Testing strategy

- Pure-module unit tests per file in `src/game/boostV2/*.test.js` (node:test, picked up by `npm run test:unit`).
- Engine integration tests (`src/game/boostV2/engineV2.test.js`) drive `createEngine` with a tiny injected dictionary.
- Randomised property test: seeded random games over the V2 engine, checking `checkBoostV2Invariants` after every committed command.
- Legacy regression: the full existing suite must stay green (1870 baseline).
- Later phases: Playwright local match (Phase 5), bot-vs-bot soak (Phase 6), emulator + soak for online (Phase 7).
