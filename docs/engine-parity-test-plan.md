# Modular Engine Parity Test Plan

This plan treats the committed legacy `HEAD:index.html` implementation as the golden master and the modular `src/game/**` engine as the candidate. For the same initial state and the same player action, normalized public behavior must match unless a rule change is explicitly approved.

## Golden-Master Harness

- Load the legacy source from `git show HEAD:index.html`.
- Extract only pure or mostly pure legacy functions needed for a behavior area, with browser APIs stubbed.
- Seed the legacy globals (`bData`, `bBoardData`, `placed`, `racks`, `scores`, `turn`, `firstMove`, `futBon`, `passCount`, `moveCount`) from each fixture.
- Run the same action through the legacy function set and through the modular engine.
- Normalize outputs before comparing:
  - legal/illegal result and reason
  - words created, in board order
  - score awarded
  - committed board and bonus-board tiles
  - rack contents and refill behavior
  - current player, turn number, pass count, status, winner
  - emitted engine events that represent legacy UI-observable effects
- Capture every difference as a parity failure with the fixture name and suspected engine area.

If a legacy behavior cannot be safely executed, the test should cite the source function and line family in `HEAD:index.html` and use a manually extracted expected value.

## Regression Catalog

### Legality And Geometry

- Empty move: `playWord()` rejects with "place at least one tile"; modular reason `empty-move`.
- Non-collinear placements: legacy `isCollinear()` vs modular `validateMove()`.
- Gaps between new tiles, including gaps filled by committed tiles: legacy `hasGaps(pp)` vs modular `hasGaps(state, placed)`.
- First move may be anywhere on the 10x10 board but not on a bonus square: legacy `firstMove && isBonusPos` vs modular `first-move-on-bonus`.
- Later moves must touch at least one committed tile, not only another new tile: legacy `isConnected()` vs modular `isConnected(state, placed)`.
- Single-tile moves choose horizontal word direction unless only vertical neighbors exist: legacy `getWT(pp)` vs modular `getMainWord()`.
- Bonus-square placements are legal after the first move and scan words through off-grid bonus positions.
- Out-of-grid non-bonus placements should be rejected or manually documented from legacy behavior before adding candidate expectations.

### Word Detection And Dictionary

- Main horizontal and vertical words.
- Cross-words created by each newly placed tile.
- Deduplication when a single tile is both main word and cross-word.
- Invalid word rejection cancels score and board commit.
- Invalid word payload includes every invalid word and the tile coordinates used for highlighting.
- Hebrew final-letter variants: board-safe non-final letter should validate against dictionary final-form entries.
- Defective/plene behavior should match the legacy `HebrewValidator` and `isValid()` fallback path.

### Scoring

- Score is sum of all created words.
- Existing committed tiles score again in each newly formed word.
- Joker tiles score `0`.
- Eight-tile bingo adds `50`.
- Score multipliers apply to word score only, and bonus points are added after the multiplier.
- Multiple words in one move include every word exactly once.

### Tile, Rack, And Board Updates

- Successful move commits every newly placed tile.
- Rack removes played letters, using `?` for joker source tiles.
- Rack refills to eight from the bag where possible.
- Tile replacement swaps a rack tile with an existing committed tile and returns the displaced tile to the rack.
- Swap-only moves are rejected.
- Swapping a locked, empty, or unavailable cell is rejected.
- Bonus-board committed tiles use off-grid coordinates and remain addressable by word scanning.

### Turns, Skip, Exchange, And Game End

- Successful move resets pass count, increments move count, and switches turns.
- Extra-turn boost keeps the same player and consumes the boost.
- Skip-opponent-turn boost forfeits the target player's next turn.
- Regular exchange validates rack membership, refills, and advances turn.
- Free exchange consumes only a matching active free-swap boost and does not advance turn.
- Pass advances turn and increments pass count.
- Legacy game-over threshold is six consecutive passes/timeouts in `nextTurn()` and `expireCurrentMove()`; the modular `turnManager.isGameOver()` currently uses two consecutive passes and must be treated as a discovered mismatch until approved.
- Empty rack plus empty bag and configured move limits end the game.
- Resign/abandon winner and status match legacy user-visible behavior.

### Timers

- `formatTimerSec()`, `computeTurnSecondsLeft()`, and deadline selection match exactly.
- Timer bonus is consumed once when a timed turn starts.
- Timeout recalls pending tiles, forfeits active multipliers, increments pass count, and advances turn.
- Online live deadlines use synced time and grace-period claim logic.

### Online And Async Serialization

- Board serializes as 100 cells and restores to a 10x10 board.
- Racks, bag, scores, turn, move count, pass count, bonus assignment, used bonus squares, locks, active boosts, deadlines, and last move survive room serialization.
- Opponent moves are applied without revalidating dictionary on the receiving client.
- Echo cancellation and stale-version rejection do not double-commit moves.
- Async turn notifications and reminders follow the same turn labels and ownership logic as the legacy online session list.

### Boosts

- Auto extra score awards only on finalize/acknowledge.
- Extra turn, timer bonus, score multiplier, free tile swap, skip opponent turn, and cancel-next-opponent-bonus fire at the same lifecycle point as legacy `futBon`.
- Bonus-square activation is blocked on the first move and not retriggered once used.
- Bonus mini-game success/failure commits base score and bonus score exactly once.

## First Batch Implemented

- Golden-master move geometry and scoring fixtures:
  - valid first move
  - first move on bonus square
  - disconnected second move
  - gap filled by committed tile
  - horizontal move with a vertical cross-word
  - eight-tile bingo scoring
  - final-letter dictionary validation through the legacy validator
- Turn/rack fixtures:
  - successful move board/rack/turn update
  - regular exchange
  - free exchange availability
  - pass threshold parity check, expected to expose the current two-pass vs six-pass rule mismatch
- Timer fixtures:
  - formatting and deadline second rounding
- Mutation/fuzz fixture:
  - deterministic random geometry cases covering isolated letters, disconnected words, edges, gaps, first move, and bonus positions.

## Missing-Functionality Report Format

Each mismatch should be reported with:

- Test name
- Legacy behavior
- Modular behavior
- Suspected missing engine rule
- Likely file/function
- Category: legality, scoring, UI-state, persistence, online, animation, dictionary, timer, boost, rack, or turn
