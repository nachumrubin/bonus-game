---
name: debug-online-game
description: Identify and debug a specific online/async game in the bonus-game app when given a room/game id (e.g. fc_1783939961090_ukvp3f). Use when the user reports a bug in a real game ("in this game player X played Y but didn't get a boost / score is wrong / turn stuck / lock disappeared"), pastes a game id, or asks to inspect a room's move history, scoring, boosts, or bonus squares. Fetches the live production room doc, maps moves to bonus squares, and pinpoints scoring/boost/turn anomalies.
---

# Debugging an Online Game by ID

Use this when someone gives you a **game id** (a.k.a. room id, e.g. `fc_1783939961090_ukvp3f`)
and a symptom ("player didn't get a boost", "wrong score", "turn is stuck", "lock vanished").

The **production `/rooms` node is world-readable** (unauthenticated), so you can pull the
full server-authoritative game state directly from Node — no credentials, no emulator.
This is the single richest forensic source available to you.

## Step 1 — Pull and analyse the room

Run the ready-made forensics tool (reads prod `/rooms` read-only):

```bash
node scripts/debug-game.mjs <roomId>
```

It prints:
- header (status, mode, turnNumber, version, players, scores, `activeBoosts`)
- **bonus-square table**: each of the 12 `BDEFS` slots → its assigned type (B1–B14),
  category (auto/minigame/future/wheel), whether it's `USED`, and which move landed on it
- the full **move list**, each annotated with `[base=… bonus=…]` on bonus moves and which
  bonus square (if any) each move landed on
- a **"landed-on-bonus-but-earned-0"** section that pre-flags the moves most likely to be
  the complaint, with the "is this actually a bug?" guidance inline

Other forms:
```bash
node scripts/debug-game.mjs <roomId> --move 21     # full JSON of one move (0-indexed!)
node scripts/debug-game.mjs <roomId> --json        # everything, machine-readable
```

⚠️ **Move numbering:** users count moves 1-based ("move 22"); `moveHistory` is 0-indexed, so
their "move 22" is index **21**. Always confirm which one you're looking at.

For anything the tool doesn't surface, fetch a field directly with a tiny script using the
same pattern (`firebase/compat`, `databaseURL: https://boost-8ef11-default-rtdb.firebaseio.com`,
`db.ref('rooms/<id>').get()`), or copy `scripts/find-room.mjs` if you only have player names +
a rough time instead of an id (`node scripts/find-room.mjs --host "<name>" --at "<datetime>"`).

## Step 2 — Read the game-state model correctly

- **Board:** 10×10 grid (`board[r][c]`, 0–9). **Bonus squares are OFF-grid** at r/c ∈ {-1, 10},
  defined by `BDEFS` in `src/game/boosts/data.js`. A word "on a boost square" means a newly
  placed tile sits exactly on that off-grid cell; tiles there live in `bonusBoard` (keyed `"r,c"`).
- **`bonusAssignment[i]`** — the type (B1–B14) shuffled onto `BDEFS[i]` at game start.
  Categories in `src/game/boosts/bonusTileDefs.js`:
  - `auto` (B2/B4/B9) → points immediately (this is the ONLY category that pays just for landing)
  - `minigame` (B1/B3/B8/B10/B11/B12/B14) → points **only if the player wins** the mini-game
  - `future` (B5/B6/B7) → delayed effect (extra turn / multiplier); `bonusExtra` is always 0
  - `wheel` (B13) → spin → an auto reward OR a future effect
- **`bonusSqUsed[i]` = true** → that square already fired once (one-shot). Set by both a real
  award AND a veto.
- **A move that touched a bonus square has `baseScore` + `bonusExtra` fields** on its
  `moveHistory` entry — these are written **only** by `FINALIZE_BOOST_AWARD`
  ([gameEngine.js](../../../src/game/core/gameEngine.js) `handleFinalizeBoostAward`). Plain moves
  have neither. So: **fields present ⇒ the deferred bonus/mini-game flow ran to completion.**
  `bonusExtra: 0` ⇒ landed on the square but earned nothing (lost mini-game / future effect / veto).
- **Veto:** if the opponent holds a banked `cancel_next_opponent_bonus` (won only from a B13
  wheel) when you land on a bonus, your bonus is suppressed, the square is marked used, and
  `EV.BONUS_VETOED` fires. To check: was there a B13 square consumed by the opponent **before**
  the move in question? If the only B13 was played later, no veto was possible.
- **Async vs live:** `mode` starting `friend-async` (or any `*-async`) = correspondence game;
  deferred bonus moves commit tiles first (turn not rotated), then a second commit adds the
  score when the mini-game resolves (`onlineGameSession.js`). Live modes coin-toss + run a timer.

## Step 3 — Diagnose common symptoms

| Symptom | First things to check |
|---|---|
| "Landed on a boost square, no boost" | Is the square a `minigame`/`wheel`/`future` type? Those don't pay just for landing. `bonusExtra: 0` on a `minigame` almost always = the player lost the mini-game (expected). Rule out a veto (opponent B13 before this move). |
| "Score is wrong" | Compare `moveHistory[i].score` vs `baseScore + bonusExtra`; check `/gameSnapshots` warnings (`SCORE_MISMATCH`) via the admin tool; confirm multipliers (B6/B7) weren't active. |
| "Turn is stuck" | `currentTurnSlot`, `turnNumber`, `missedTurns`; a deferred move that never got its second commit leaves the turn un-rotated. |
| "Lock disappeared / phantom lock" | `lockInventory`, `lockedCells`; see the phantom-lock notes in `CHARACTERIZATION.md` and `onlineGameSession.js` rollback paths. |

**Before calling it a bug, distinguish "played and lost" from "never presented."** The room doc
proves the *engine flow* completed; it cannot prove the *UI* showed the overlay. If you need the
actual puzzle and the player's answer, use Step 4.

## Step 4 — The debug timeline (puzzle-level detail)

The room doc does **not** store what happened *inside* a mini-game. That lives in the admin-only
debug streams under `/gameEvents/{gameId}` (not readable from the unauthenticated script — open
the **in-app admin debug tool**). The recorder ([debugRecorder.js](../../../src/game/debug/debugRecorder.js))
now logs, per mini-game:
- `MINIGAME_STARTED` — which square/type/slot triggered it
- `MINIGAME_RESOLVED` — `success`, `earnedPts`, and a `detail` object with the **puzzle + the
  player's answer**. For **B10** that's `{ h, v, hpos, vpos, shared, attempt }` — i.e. the two
  crossing words, where they intersect, the correct letter, and what the player typed. Other
  mini-games carry their own detail (hidden word, honeycomb `foundWords`, crossword legal/illegal,
  unscramble `answer`/`attempt`, wheel `outcomeId`, …).

So "landed on B10, earned 0" becomes decidable: the timeline shows e.g.
`תפוח ✕ חגים, shared ח, player typed ק → lost`.

## Step 5 — Report

State plainly: **bug or working-as-designed**, the evidence (move index, square, category,
`base`/`bonus`, veto check), and — if a bug — the file/line at fault. If the room doc can't
settle it (UI-presentation questions), say so and point at the admin timeline / client logs.

## Guardrails

- These scripts are **read-only**. Never write to `/rooms` from a debug script.
- Firebase paths/config constants are locked (see `CLAUDE.md`); don't edit them to debug.
- Temp scripts go in the scratchpad, not the repo, unless they're reusable tools like
  `scripts/debug-game.mjs`.
