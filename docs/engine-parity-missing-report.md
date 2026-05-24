# Engine Parity Missing-Functionality Report

Generated from the first parity batch in `tests/unit/engine-parity.test.js`.

## Resolved: Two Consecutive Passes End The Modular Game

- Test name: `turn parity: legacy does not end the game after only two consecutive passes`
- Old behavior: legacy `nextTurn()` and `expireCurrentMove()` end only when `passCount >= 6`.
  - Source: `HEAD:index.html`, `nextTurn()` / timeout pass handling around the `passCount>=6` checks.
- Fix: modular `turnManager.isGameOver()` now uses the legacy six-pass threshold.
- Regression tests: `turn parity: legacy does not end the game after only two consecutive passes` and `turn parity: legacy completes only after six consecutive passes or timeouts`.
- Category: turn / game-end.

## Resolved: Regular Exchange Draw Order Differs

- Test name: `scenario replay parity: complete sequence with restore checkpoint`
- Old behavior: legacy `doExchange()` returns the exchanged letter with `bag.unshift(letter)`, calls `sh(bag)` using `Math.random`, then refills via `draw(rack)`.
  - Source: `HEAD:index.html`, `doExchange()`.
- Fix: modular exchange now returns exchanged tiles with `unshift`, shuffles with a `Math.random`-compatible RNG, then refills. Tests inject deterministic RNG only to make the legacy replay comparable.
- Regression tests: `exchange parity: regular exchange advances turn and keeps rack size` and `scenario replay parity: complete sequence with restore checkpoint`.
- Category: rack / bag / exchange.

## Resolved: Lock Inventory Defaults Differ

- Old behavior: legacy `lockInventory` initializes as `[[3,3,5],[3,3,5]]`.
- Fix: modular `createInitialState()` and lock normalization now default to `{0:[3,3,5],1:[3,3,5]}`.
- Regression test: `lock parity: new games start with the legacy [3,3,5] lock inventory`.
- Category: turn / board lock.

## Resolved: Automatic Bonus-Square Activation

- Old behavior: legacy `getActivatedBonuses()` and `finalizeReviewedMove()` detect newly placed tiles on unused bonus squares, set `bonusPend`, run `triggerBonus()`, and mark `bonusSqUsed` when resolved/skipped.
- Fix: `gameEngine.handleConfirmMove()` now detects unused bonus-square placements, marks `bonusSqUsed`, queues future boosts, emits auto boost awards, and records/emits pending mini-game or wheel bonuses.
- Regression tests: `bonus parity: valid move on unused auto bonus square activates and marks used once` and `bonus parity: future and minigame bonus squares are represented in engine state`.
- Category: boost / scoring / turn flow.

## Partially Resolved: Timeout Command Semantics

- Old behavior: legacy `expireCurrentMove()` recalls pending placements/replacements, forfeits pending score multipliers, increments pass count, may increment online missed-turn counters, and advances/end-games using the legacy pass threshold.
- Fix: `PASS_TURN` with `reason: "timeout"` now forfeits active score multipliers and uses the corrected six-pass threshold.
- Remaining scope: pending placement recall is still UI-owned because the engine does not retain in-progress placements.
- Regression test: `timeout parity: timeout forfeits active score multiplier and advances as a pass`.
- Category: timer / rack / turn / online.

## Other Current Suite Failure

- Test name: `home logo uses local image asset markup`
- Category: unrelated UI markup test.
- Current failure: `partials/screens/home.html` contains `<div class="hlogo menu-logo-enter">`, while the existing test expects the exact string `<div class="hlogo">`.
- This was pre-existing relative to the parity work and is not part of the modular engine comparison.
