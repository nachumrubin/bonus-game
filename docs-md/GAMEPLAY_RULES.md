# GAMEPLAY_RULES.md — Bonus Game Gameplay Rules

> Evidence-based. All values extracted from source code.
> Source evidence: `src/game/core/gameEngine.js`, `board.js`, `tileBag.js`, `letterDistribution.js`, `moveValidator.js`, `scoringEngine.js`, `turnManager.js`, `hebrewDictionary.js`, `boosts/bonusTileDefs.js`, `boosts/data.js`, `sessions/modes.js`

---

## Board

- **Size:** 10×10 grid (`BOARD_SIZE = 10`, `src/game/core/board.js`)
- **Off-grid bonus squares:** 12 squares positioned at `r ∈ {-1, 10}` or `c ∈ {-1, 10}`, stored in `state.bonusBoard` (Map, keys `"r,c"`)
- **Effective board:** 10×10 main region + 12 bonus squares accessible transparently via `getCommittedTile()`
- Cell coordinates: row 0–9, col 0–9 for main grid

---

## Tile Bag

- **Total tiles:** 108 (`src/game/core/letterDistribution.js`, sum of `HD` values)
- **Jokers:** 2 tiles (letter `'?'`, value 0)
- **Rack size:** 8 (`RACK_SIZE = 8`, `src/game/core/tileBag.js`)
- **Draw order:** LIFO — tiles drawn from `.pop()` end of shuffled array
- **Shuffle:** Seeded RNG (`tileBagSeed` in state). Both online players use the same seed for deterministic local simulation

### Letter Distribution and Values

Source: `src/game/core/letterDistribution.js` — `HD` (count) and `HV` (value)

| Letter | Count | Value | Letter | Count | Value |
|--------|-------|-------|--------|-------|-------|
| א | 11 | 1 | ס | 2 | 5 |
| ב | 3 | 3 | ע | 3 | 4 |
| ג | 2 | 5 | פ | 3 | 5 |
| ד | 3 | 3 | צ | 2 | 9 |
| ה | 6 | 4 | ק | 3 | 5 |
| ו | 10 | 1 | ר | 6 | 2 |
| ז | 1 | 8 | ש | 4 | 3 |
| ח | 3 | 4 | ת | 4 | 4 |
| ט | 1 | 8 | **?** (joker) | **2** | **0** |
| י | 10 | 1 | | | |
| כ | 3 | 5 | | | |
| ל | 6 | 2 | | | |
| מ | 2 | 2 | | | |
| נ | 6 | 2 | | | |

---

## Move Validation

Source: `src/game/core/moveValidator.js` → `validateMove(state, placed)`

Rules applied in order:

1. **Non-empty:** At least one tile placed.
2. **Collinear:** All placed tiles in the same row OR same column.
3. **No gaps:** No empty cells between the leftmost and rightmost (or top-most and bottom-most) placed tile, considering both committed and placed tiles.
4. **First move restriction:** Cannot place on bonus squares on the very first move of the game.
5. **Connected:** At least one placed tile must be orthogonally adjacent to an already-committed tile on the board. Exception: first move always passes (no committed tiles yet).

**Rejection reasons returned:** `'empty-move'`, `'not-collinear'`, `'has-gaps'`, `'first-move-on-bonus'`, `'not-connected'`

**Connectivity note:** Adjacency to other *placed* tiles in the same move does not satisfy the connectivity requirement — only adjacency to *committed* tiles counts.

---

## Scoring

Source: `src/game/core/scoringEngine.js`

### Formula
```
Total = sum(scoreWord(w) for each word formed) + bingo_bonus
```

- `scoreWord(word)` = sum of `tile.val` for all tiles in that word
- There are **no board multiplier squares** (no double/triple word/letter bonus squares like classic Scrabble). Each tile scores its face value.
- **Bingo bonus:** +50 points if exactly 8 tiles placed in one move (`BINGO_BONUS = 50`, `scoringEngine.js`)
- All words formed by a move are scored: main word along placement axis + all cross-words

### Word Formation
- **Move axis:** horizontal if tiles share a row; vertical if tiles share a column; single-tile move defaults to horizontal unless only vertical neighbors exist
- **Main word:** extends from the minimum to maximum coordinate along the axis
- **Cross-words:** for each placed tile, the perpendicular word it creates (if ≥ 2 letters)
- Words shorter than 2 letters are ignored
- Deduplication by coordinate hash prevents double-counting

### Deferred Scoring (Bonus Mini-Games)
When a bonus mini-game is triggered, scoring is deferred: the score is not committed until `CMD.FINALIZE_BOOST_AWARD` is dispatched after the mini-game completes. The `EV.MOVE_SCORE_COMMITTED` event marks the actual commit.

---

## Dictionary Validation

Source: `src/game/core/hebrewDictionary.js`

Two paths exist; the active one is selected by `setDictionaryMode('v1' | 'v2')`, called from `main.js` based on the `?dict=v2` URL parameter. `v1` is the default.

### v1 (legacy, default)

- Dictionary: `data/dictionary.base.txt` (464 KB Hebrew word list)
- Loaded at boot via `loadDict()` → `DICT` Set
- Validation: `isValid(word)` → `analyze()` with morphological analysis
- **Normalization:** Final forms (ך,ם,ן,ף,ץ) → medial forms before lookup
- **Lemmatization chain:**
  1. Word as-is + terminal final variants
  2. Strip plural suffixes (ים, ות)
  3. Strip verb conjugation suffixes
  4. Strip ה (feminine marker, with heuristics)
  5. All candidates tested with spelling variants (כתיב-חסר and כתיב-מלא)
- **Explicit rejects:** ~220 possessive pronouns in `EXACT_REJECTS` Set are always invalid
- **Explicit allows:** `CLASSIC_ALLOW` (~20 short particles) and `DEFECTIVE_ACCEPT` (10 defective spellings) always valid
- **External validator:** If `globalThis.HebrewValidator` is loaded and ready, `hv.validate(w)` is called as the primary check; `analyze()` is fallback

### v2 (DAWG-encoded curated lexicon, behind `?dict=v2`)

- Dictionary: `data/dictionary.v2.bin` (DAWG-encoded; currently the legacy 40K re-encoded as a placeholder, ~235 KB binary)
- Loaded at boot via `loadDictV2()` → parses DAWG into a queryable structure, also mirrors words into `DICT` Set so existing iteration callers (mini-game word search, bot) work unchanged
- Validation: `isValid(word)` → `isValidV2()`, which uses the DAWG directly. **No morphological fallback** — the curated lexicon is responsible for shipping every legal inflection (הטיה) as its own surface form.
- **Policy order (first match wins):**
  1. Clean input to Hebrew letters only; empty → invalid
  2. `EXACT_REJECTS` hit → invalid
  3. `CLASSIC_ALLOW` hit → valid (also `DEFECTIVE_ACCEPT`)
  4. DAWG lookup (with terminal-final variants) → valid
  5. DICT approved-overlay hit (Firebase-approved words added after load) → valid
  6. Otherwise → invalid
- **Build pipeline:** `tools/dictionary-build/` — lemma-first, multi-source corroboration (HSpell + Wiktionary + Wikipedia frequency + legacy 40K + Academy), paradigm-gated inflection generation, native-speaker review queue for single-source lemmas, hard quality gates (≥ 99% gold-positive, ≤ 2% gold-negative leak, ≤ 0.5% legacy loss) before the binary ships.

---

## Illegal Words

Source: `src/game/core/gameEngine.js` → `handleConfirmMove()`

- If any word formed is not in the dictionary, the move is rejected as `INVALID_MOVE_REJECTED`
- After rejection, the UI auto-passes after ~1100ms (handled in `gameController.js`)
- That auto-pass increments `passCount` (May 2026: previously reset; unified with regular passes so a stalling player can't reset the scoreless-turn counter by attempting bad words)
- The pass from an illegal-word rejection is transmitted to Firebase for online games (reason: `'illegal-word'`)

---

## Turn Progression

Source: `src/game/core/turnManager.js`

1. Active player places tiles → dispatches `CMD.CONFIRM_MOVE`
2. Engine validates → if valid: `applyMove()` → emit `EV.MOVE_CONFIRMED`
3. Rack refilled from bag to 8 tiles
4. `passCount` reset to 0
5. `firstMove = false`
6. `moveCount` incremented
7. Boost hooks run (`ON_TURN_END` — can set `repeatTurn: true` for extra turn)
8. Unless `repeatTurn`: `advanceTurn()` → increment `turnNumber`, toggle `currentTurnSlot`
9. Locks ticked: `tickLocks()` decrements all `remainingTurns`, prunes expired

---

## Pass

Source: `turnManager.applyPass()`

- Increments `passCount`
- Advances turn
- If `passCount >= 4` (`LEGACY_PASS_GAME_OVER_THRESHOLD`): game over
- Reasons tracked: `'pass'` (voluntary), `'timeout'` (turn timer), `'illegal-word'` (bad word auto-pass) — all three count toward the threshold (May 2026 unification)

---

## Exchange

Source: `turnManager.applyExchange()`, `applyFreeExchange()`

- Player selects tiles from rack to return to bag
- Tiles returned via `.unshift()` + reshuffle
- New tiles drawn from bag (up to `RACK_SIZE`)
- `passCount` **incremented by 1** (May 2026: previously reset; exchanges now count as scoreless turns so a trailing player can't stall a winning opponent indefinitely)
- Turn advances
- `applyFreeExchange()` (triggered by B13 wheel `tile_swap` outcome): same mechanics but **no turn advance**, `passCount` left untouched

---

## Claim Stalling Win

Source: `turnManager.canClaimStallEnd()`, `gameEngine.handleClaimStallEnd()`

- Once `passCount >= STALL_CLAIM_THRESHOLD` (=2), the **strictly leading** player may dispatch `CMD.CLAIM_STALL_END` to finish the game immediately with themselves as winner
- The trailing player and tied scores are both rejected (`INVALID_MOVE_REJECTED`, reason `'claim-stall-end-not-allowed'`)
- Sets `state.endReason = 'stall-claim'` and `state.claimedBy = slot`, then runs the normal `finishGame()` path so `EV.GAME_COMPLETED` fires and online sessions write terminal status
- UI: `#btn-claim-stall-end` (game topbar) shown by `claimStallEndController` only when allowed; click opens `#ov-claim-stall-end` confirm overlay

---

## Resign

Source: `turnManager.applyResign()`

- Sets `state.status = 'abandoned'`, `state.abandonedBy = slot`
- Opponent wins immediately
- Online: `setStatus()` called with terminal status

---

## Game Over Conditions

Source: `turnManager.isGameOver(state)`

1. `passCount >= 4` (`LEGACY_PASS_GAME_OVER_THRESHOLD`) — any combination of pass, exchange, or illegal-word forfeit counts (May 2026: lowered from 6; exchanges and illegal-word forfeits now count)
2. Bag empty AND at least one player has an empty rack
3. Move count hits configured limit (`settings.moveLimitOn` or `settings.movelimit`)
4. `state.status` already `'completed'`, `'abandoned'`, or `'expired'`
5. Leading player fires `CMD.CLAIM_STALL_END` after `passCount >= 2` (sets `state.status = 'completed'`, `state.endReason = 'stall-claim'`)

### Winner Determination

Source: `turnManager.winnerSlot(state)`

- If `abandonedBy` set: winner is the other player
- Otherwise: player with higher score wins
- Equal scores: tie (`winnerSlot` returns `null`)

---

## Lock Mechanic

Source: `turnManager.js`, `gameEngine.js`

- Each player starts with a lock inventory: `[3, 3, 5]` (three durations, from `LEGACY_LOCK_INVENTORY`)
- Player can lock an empty cell by dispatching `CMD.PLACE_LOCK` with a duration from their inventory
- Locked cell cannot be played on while `remainingTurns > 0`
- Lock duration decrements each turn (`tickLocks` on `advanceTurn`)
- Lock ID: `"${turnNumber}:${slot}:${r}:${c}:${duration}"`

---

## Turn Timer (Live Modes)

Source: `src/game/online/roomService.js`, `timeoutWatchdog.js`, `sessions/modes.js`

- Active in `friend-live` and `random-live` modes only
- `shouldUseSharedTurnTimer(mode, settings)` returns `false` for async modes or if `settings.timelimit` is falsy
- Timer duration: `turnLimitMsFromSettings(settings)` — configurable per game
- Opponent-side watchdog polls every 350ms (`DEFAULT_WATCHDOG_TICK_MS`)
- 1-second grace period after deadline (`DEFAULT_WATCHDOG_GRACE_MS`)
- **Missed turns:** 2 consecutive missed turns = forfeit (`MISSED_TURNS_FORFEIT_THRESHOLD = 2`)
- Watchdog no-ops if: `liveBonus.active` (player in mini-game), status ≠ 'playing', timelimit disabled

---

## Bonus (Boost) System

Source: `src/game/boosts/bonusTileDefs.js`, `data.js`, `bonusResolver.js`

### Bonus Square Layout
12 bonus squares on the board border (off-grid). Positions defined in `BDEFS` (data.js):
- Top edge: 3 squares at columns 1, 5, 8
- Bottom edge: 3 squares at columns 2, 5, 7
- Left edge: 3 squares at rows 1, 4, 7
- Right edge: 3 squares at rows 2, 5, 8

### Bonus Types (B1–B13)

| Type | Points | Kind | Effect |
|------|--------|------|--------|
| B1 | 100 | mini-game | Unscramble or fill-middle challenge |
| B2 | 40 | auto | +20 points immediately |
| B3 | 40 | mini-game | Unscramble (medium difficulty) |
| B4 | 1 | auto | +1 point immediately |
| B5 | 0 | future | Extra turn |
| B6 | 0 | future | 4× score multiplier for 1 turn |
| B7 | 0 | future | 2× score multiplier for 2 turns |
| B8 | 0 | mini-game | Crossword puzzle (60-second timer) |
| B9 | 25 | auto | +25 points immediately |
| B10 | 40 | mini-game | Crossing words challenge |
| B11 | 30 | mini-game | Hidden word (4×4 grid, find a hidden 3-letter word in 10s) |
| B12 | 50 | mini-game | Honeycomb word challenge |
| B13 | 0 | wheel | Spin for random outcome |
| B14 | 50 | mini-game | Letter spinner (אות פותחת) — stop on a letter, make words starting with it in 20s; scored by word length like B12 |

### Bonus Assignment
`BONUS_TYPES` array has 16 entries (can have duplicates): `2×B1, 2×B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14`. Shuffled at game start and assigned to the 12 (or fewer) bonus slots. `createInitialState` de-duplicates by type, shuffles, takes 12, and pads with B9 — so with 14 distinct types most games surface a different subset of the rarer mini-games (B11–B14).

### B13 Wheel Outcomes
- `pts_50`: +50 points
- `pts_1`: +1 point
- `extra_turn`: Free turn
- `double_2`: 2× multiplier for 2 turns
- `timer_bonus`: +10 seconds to deadline
- `skip_turn`: Skip opponent's next turn
- `tile_swap`: Free tile exchange
- `cancel_boost`: Cancel opponent's next bonus

### Bonus Trigger
A bonus is triggered when a player's tile connects to (or is adjacent to) a bonus square during a valid move. `collectBonusActivations()` in `gameEngine.js` checks this via `resolveBonusActivation()`.

### Multiplier Forfeiture
`multiply_next_turns` effect is lost if the benefitting player times out or forfeits an illegal-word pass. (Source: `gameEngine.js` boost handling)

---

## Game Modes

Source: `src/game/sessions/modes.js`

### Offline Modes
- **`offline-solo`** and **`offline-2p`**: No network, no timer (optional), no push, no presence
- **`tutorial`**: Scripted opponent (`TUTORIAL_WORD = 'שלום'`), 4 preset bot moves, no timer

### Online Live Modes (`friend-live`, `random-live`)
- Firebase-backed real-time sync
- Shared turn timer active
- Presence monitoring (`presenceCritical: true`)
- Push notifications sent when player is backgrounded
- No expiry (game persists until completed or abandoned)

### Online Async Modes (`friend-async`, `random-async`)
- Firebase-backed, turn-by-turn (not real-time)
- No turn timer
- Push notifications always sent on move
- **7-day expiry**: game auto-expires if idle (`asyncReminderService.js`)
- **24-hour reminder**: push sent after 24h idle

### Room Creation
- **Friend invite:** `inviteService.sendInvite()` → recipient accepts → room created
  - Live invite TTL: 5 minutes
  - Async invite TTL: 7 days
- **Room code:** `roomCodeService.createPending()` → 6-digit code, 30-minute TTL → `claimByCode()`
- **Random matchmaking:** `matchmakingService.joinQueue()` → `tryPair()` → room created

---

## Bot Mode

Source: `src/game/sessions/botGameSession.js`, `botSearch.js`

- Bot plays against player in offline-solo mode; dispatches `CMD.CONFIRM_MOVE` or `CMD.PASS_TURN`
- Bot pauses during bonus flows (mini-game/wheel UI)
- Three difficulty levels (קל / בינוני / קשה = easy/medium/hard, 0/1/2), driven by the **`DIFFICULTY_PROFILES`** table in `botSearch.js` so levels are clearly distinguishable and tunable. `searchBotMove(state, slot, wordList, isWordValid, { difficulty, rng })` resolves a profile (override with `opts.profile` in tests). Profile levers:

  | lever | easy | medium | hard |
  |---|---|---|---|
  | `maxWordLen` (longest word considered) | 3 | 5 | 6 |
  | `tries` / `anchLimit` (search breadth) | 14 / 6 | 60 / 14 | 120 / 20 |
  | bonus squares as anchors | no | yes | yes |
  | reject placements on bonus tiles | yes | no | no |
  | move selection | lowest 25th-percentile (+20% chance of its single worst move) | random of top-3 | highest |
  | `scoreCeiling` (soft max points) | 12 | ∞ | ∞ |
  | weakened opening move | yes | no | no |

  Easy is intentionally a **beginner**: only 2–3 letter words, low-value plays, weak opener, never uses bonus squares. (Measured spread on a representative board: easy mean ≈ 8, medium ≈ 30, hard ≈ 34.)
- **Vocabulary** (`main.js`): the bot draws from the legacy ~40K frequency-sorted corpus (kept stable for calibration), capped per level — `VOCAB_CAPS = [2000, 20000, 40000]` (easy/medium/hard). Combined with `maxWordLen`, easy effectively uses only the most common short words.
- **Think time** (`main.js`, cosmetic — no strength effect): `THINK_MS = [1000, 3000, 5000]` ms (easy snappy, hard lingers), passed to `attachBotPlayer` as `thinkingMs`.

---

## Tutorial Mode

Source: `src/game/sessions/tutorialSession.js`

- First move: player places `'שלום'` at cells `[{r:5,c:5},{r:5,c:6},{r:5,c:7},{r:5,c:8}]`
- Bot has 4 scripted moves using words from `TUTORIAL_WORDS = ['שלום','לב','אח','תמ','לבדו']`
- Bot advances `nextMove` counter on each `EV.MOVE_CONFIRMED`
- `ensureRackLetters()` injects required letters into player rack at game start
