# DECISIONS.md — Architecture and Design Decisions

> Decisions visible from code and existing documentation.
> Source evidence: `docs/intentional-change-register.md`, `src/game/core/`, `src/game/online/`, `src/main.js`, `firebase.database.rules.json`

---

## D-boostie-xp: Boosties level up from games played, not from the rating — October 2026

**Decision:** Boosties replace every older avatar (store portraits, achievement emojis).
A Boostie's level comes from **XP, which counts finished games**: 10 XP per game, +10 for
a win, +5 for a draw; abandoned or forfeited games give nothing. XP is completely
separate from the ELO rating. Levels need 0/50/150/350/700/1200/2000 XP, so about three
games a day reaches level 4 in about a week and level 7 in 6–7 weeks. Constants live in
`src/game/account/boostieXp.js`.

- XP belongs to the **equipped** Boostie; each one keeps its own XP and level in
  `profile.boosties = { <id>: { xp, level } }`. Owning a Boostie = having an entry.
- New players own every **starter** Boostie (target: 4–5 starters plus 2–3 locked ones;
  today Zapi and Bubo are both starters). Reaching level 7 unlocks the next locked
  Boostie in `CHAIN_ORDER` for free; it can also be bought with coins.
- No migration of old profiles: the app wasn't in production when Boosties shipped.
- Avatar values that travel (rooms, invites, queue, friend lists) are `'<id>:<level>'`,
  so other players see your current form. Unknown or old values show the starter at
  level 1.
- Rendering is hybrid: stills everywhere, live 3D only on the in-game scoreboard.
- The store sells Boosties and extra reactions. Coins will also be sold for real money,
  which first needs the economy to move server-side (Phase 6a, see TASKS).

**Rules:** XP may only grow, by at most one win (20) per write; level stays 1–7 and
only grows. The client still writes coins and owned items until Phase 6a.

**Supersedes:** D-avatar-store (the 36-portrait coin store).

## D-avatar-evolution: 7-level Boosties, cyan chest core shows the level by shape — October 2026

**Decision:** evolving "Boostie" avatars have **7 levels** (not 10). Each level
advances along growth, maturity, personality and accessories, with each axis leading
in a different part of the range. Every character has a **cyan chest core** whose
**shape** (spark → dot → orb → ringed orb → star burst → spreading burst → crowned
core) is the level indicator, plus exactly one signature cyan feature. Full spec and
prompt template: `docs-md/AVATAR_EVOLUTION.md`.

**Why:** test sheets with 10 levels produced near-duplicate neighbours. 7 gives
every upgrade a visible headline change. The core keeps **one colour (cyan)**
because colour already means rarity (blue/purple/gold) and player side (cyan/gold),
cyan is the Boost brand, and a 7-colour ladder is hard to learn and unreadable for
colour-blind players. Shape survives all of that.

**Not chosen:** a per-level core colour, and a level-number badge on the
scoreboard portrait (declined for now).

---

## D-google-signin: Google by popup, guests linked, then a name step — October 2026

- **Popup, not redirect.** The app runs as a standalone PWA and an Android TWA, served
  from `boost-8ef11.web.app`, while `authDomain` is `boost-8ef11.firebaseapp.com`. With a
  redirect, storage partitioning loses the result in iOS standalone mode; a popup works
  in all of these.
- **Guests are linked** (`linkWithPopup`), so the uid and everything keyed by it survive:
  rooms, invites, friends, presence. If the Google account already belongs to a player,
  we switch to that account (`signInWithCredential(err.credential)`); the guest's
  session data is left behind, the same as email log-in.
- **A name step instead of the Google name.** The unique 15-character display name is
  claimed through the same `provisionNewProfile()` as email sign-up. It is pre-filled
  with the Google first name, but the player can stay pseudonymous. A Google user with
  no profile gets the step again on the next launch.
- In-app browsers (Facebook / Telegram) block Google OAuth, so we show "open in a
  browser" instead of failing silently.

---

## D-opponent-boost-pill: the opponent's boost is shown in the status pill — October 2026

**Decision:** the opponent's boost (bot or online) is reported in the status pill
above the board (`#sbar`), with no time limit, until the local player starts placing
tiles. It is not shown in a modal or a timed chip.
- Bot boosts no longer open the award card. `main.js` auto-finalizes and acks in its
  place.
- The engine records a serializable `boost` summary on the move-history entry, so it
  travels to the online opponent with the move.

**Why:** the bot's card demanded a tap for something the human didn't do. Online, the
opponent's bonus points arrived silently. A labelled chip inside the score animation
was tried first and rejected: it disappears after about a second. The pill is free
until the player places a tile, which is exactly when they need the information.

---

## D-natural-sfx: realistic CC0 recordings for every physical sound — October 2026

**Decision:** sound effects are recorded samples (`assets/sfx/`, `.ogg` + `.m4a`).
- Anything physical is a realistic recording: real Scrabble tiles on wood, a cloth
  bag, coins, a clock tick, electricity for boosts, a wheel ratchet, a doorbell.
- Designed UI sounds and jingles (Kenney) only for abstract moments.
- The old WebAudio tones stay as the per-cue fallback.
- Everything is CC0, and its source is recorded in `docs/sound_inventory.md`.

**Why:** the user rejected arcade-style zaps and planks in a listening review. Sounds
should "add to the game instead of distracting". CC0 keeps us free of attribution and
licence obligations. A CC0 upload derived from a CC-BY sound is treated as CC-BY and
avoided.

**How it is wired:**
- `sfxCatalog` (data) → `sfxEngine` (WebAudio, gesture unlock, preload, throttle,
  6-voice cap, master volume, music ducking) → `feedbackService` (bus routing,
  `cue()` for screens).
- `animationController` takes an injected `cue` so animation sounds stay in sync.

---

## D-live-word-points: the status pill previews the move's score — October 2026

The mockup's `✓ האור +8` pill was held back as a game decision (it tells players the
score and dictionary validity before they commit). Decided: ship it. The dictionary was
already one tap away (מילון), and the preview only reports what the engine would do —
it reuses `validateMove` / `getAllWords` / `scoreMove`, never its own formula. It shows
the **base** score; boosts are applied on commit and advertised by the multiplier banner.
Per-screen onboarding pop-ups were switched off in the same pass (players found them
annoying); re-enable by mounting `mountOnboardingController` in `main.js`.

---

## D-web-images: PNG masters stay, the service worker serves web-sized WebP — September 2026

**Decision:** art PNGs under `assets/` stay as 1024px masters. `scripts/build-web-images.py`
writes a sibling `<name>.webp` (≤512px); `sw.js` serves it for any `assets/**.png`
request (not `assets/anim/`), falling back to the PNG. Images live in `boost-assets-v1`,
a cache that is not deleted on deploy and is refreshed stale-while-revalidate.

**Why:** avatar paths are stored in Firebase as ids, the atlas manifest is keyed by PNG
path, and the Blender pipeline reads the masters, so renaming references or shrinking
the masters was not an option. Mapping in the SW needs zero reference changes.

**Rules:** never set `visibility: visible` inside a hidden screen/overlay (it would
paint again). Rebuild WebPs after art changes.

---

## D-glass-skin-override: app-wide redesign = late-loaded sheet + g-* primitives — September 2026

**Decision:** the app-wide "glass + wood" skin lives in `screens-glass.css`, loaded after
`styles.css` and `menu-electric.css`. Screens are rebuilt on a small set of `g-*`
primitives that mirror `tools/screens-mockup` one-to-one, with a line-icon SVG sprite
(`#gi-*`) in `index.html`. Legacy classes and all JS-bound ids / onclick attributes stay
in the markup, so screen modules and tests keep working; old rules are neutralised by
selector specificity, not deleted. The chip top bar is shown on home only; every other
screen owns a header with a back chip.

**Why:** the old sheets are large and `!important`-heavy. Rewriting them would put every
screen at risk at once, while an override layer can be reviewed screen by screen against
the mockup. Primitives keep new screens consistent without copying CSS.

**Rules:** cyan = me / primary action, gold = opponent / reward, red = destructive.
Choices go in bottom sheets; notices go in centred dialogs led by a medallion. No new
artwork: icons are the mockup's line set, and all art is existing assets.

---

## D-avatar-pose-atlas: 2.5D motion ships as pre-rendered pose atlases — September 2026

**Decision:** avatar/achievement animation is rendered in Blender and shipped as
one WebP sprite sheet of *poses* per asset (not per animation), played on a
`<canvas>` over the existing `<img>`. States are choreography (`poseClips.js`)
= atlas frames + CSS transforms; glow, sparkles, rays, strikes are shared DOM/CSS.

**Why:** no 3D runtime in a TWA on low-end Android; transparent VP9 WebM does not
play on iOS Safari; per-state renders would be ~100 MB (45 avatars × 8 states),
a pose atlas is ~130–400 KB per asset. Frame `rest` equals the source PNG, so
every screen keeps the static PNG as its fallback (reduced motion, atlas not
loaded) and swaps seamlessly.

**Rules:** gameplay animation is event-driven only (no loops on the board);
each event has one dominant moment — when the avatar carries a cue, the older
CSS cue is toned down, never stacked; nothing awaits an animation on a gameplay
path.

---

## D-boostie-live-3d: Boosties are live 3D (three.js), with blinks allowed on the board — October 2026

**Decision:** the evolving Boostie avatars are real-time 3D models (.glb, three.js),
not pose atlases. That includes the game scoreboard. The 3D only draws while
something moves. On the board, a Boostie may **blink, glance and flick an ear**
every few seconds between reactions. Nothing else idles there.

**Why:** a phone test (`tools/3d-spike/`) ran two live avatars at 95% of frames under
8 ms. Without blinks the characters read as dead. A blink every few seconds wakes
the 3D for about 0.2 s, so the cost stays negligible.

**Amends** D-avatar-motion's "no loops on the board" for Boosties only: no breathing
loop or idle sway on the board. The old 2D avatars keep the old rule.

---

## D-boostie-reactions: expressive reactions are player-chosen, and extra ones are sold — October 2026

**Decision:** the game triggers only reactions that report game state: turn, good move
and boost, plus idle life (blinks, glances, the signature movement, a small mouth
"heh"). Expressive reactions (laugh, wow, wide eyes, …) never play on their own:

- A player taps **their own** Boostie, picks a reaction, and **both** players see it
  on that Boostie, with a short label.
- A cooldown (4 s in the prototype) stops spamming.
- A free starter set (Laugh, Wow, Wide eyes) is always available. More reactions
  (Wink, Yawn, …) are **shop items**. Before buying, a player can preview one on
  their own avatar only.

**Why:** a reaction the player chose means something to the rival, while automatic
ones turn into background noise. Reactions are also a natural thing to sell.

**Exception (Oct 2026, user request):** the home top-bar avatar plays expressive clips
(yawn, wow, wink, …) on its own, as idle gestures. It's the player's own avatar on their
own screen and nothing is sent to anyone, so the rule above still holds for games.

**Settled in Phase 5 (Oct 2026):**
- Transport: the existing `liveReaction` path and `EV.REACTION_RECEIVED`, with a new
  reaction type `boostie`. No new `EV.*`.
- The receiver plays the clip even without owning it (the sender paid). Where a Boostie
  is a still, the reaction's emoji shows in the bubble.
- The cooldown is the reaction system's 5 s; the existing mute and "disable messages"
  settings apply.
- Prices: wink and yawn 250 coins (tunable in `boostieCatalog.js`).
- The store preview plays on the player's own equipped Boostie.

**Not decided yet:** per-game limits beyond the cooldown.

Prototype: `tools/3d-spike/` (tap "You").

---

## D-matchmaking-exact-search: "חיפוש מדויק" makes settings hard; flexible = closest-from-pool — June 2026

**Decision:** "חיפוש מדויק" (exact search) is a per-player switch that turns **all**
of that player's settings into **hard constraints**. Flexible (unchecked) does
**not** mean "I'll play anyone with no preference" — it means *"pair me with the
closest available player in the pool, but I'll accept a farther one rather than
wait forever."* Two distinct layers:

*Hard compatibility* (`isCompatible` — a yes/no gate):
- **timelimit** (live vs async): must match whenever **either** side is strict.
  (Never blocks in practice — `random-live` / `random-async` are separate queues —
  but kept defensively.)
- **botTime** (turn speed בזק 20 / רגיל 40 / איטי 60): must match only when **both**
  sides are strict. If exactly one side is strict they still pair and the flexible
  side adopts the strict side's speed.
- **ratingRange**: a hard filter **only for a strict** side. A flexible player's
  range never blocks a pairing — it is only a ranking preference.

*Soft preference* (`matchDistance` + `tryPair` selection): among all
hard-compatible candidates, pick the **closest** — same turn speed first (the
largest experience gap), then smallest rating gap, tie-broken by queue age. This
gives every searcher the nearest available opponent rather than just the oldest.

**Why:** A real-time room has one turn clock and one opponent, so the sides can't
each keep their own speed/opponent-rating. A strict player asked for exact settings
and must get them; a flexible player wants the best available match but shouldn't be
left unmatched over a preference. Running the game at the strict side's speed,
hard-filtering only on the strict side's range, and ranking everyone by closeness
satisfies both intents.

**Implementation:** `matchmakingService.isCompatible` (hard gate) +
`matchmakingService.matchDistance` (ranking, used in `tryPair`'s candidate sort).
Because the room is created from the *driver's* (lower-uid) settings,
`spineMatchmaking.resolveMatchSettings` overrides the room's `botTime`/`timelimit`
to the strict side's values when exactly one side is strict — so the strict player
gets their pace even when the flexible player is the room creator.

**Speed-over-rating ranking is a deliberate, adjustable choice:** a different turn
pace is treated as a bigger mismatch than a rating gap. If product wants rating
proximity to dominate, swap the axis order in `matchDistance`.

**Evidence:** `src/game/online/matchmakingService.js` (`isCompatible`,
`matchDistance`, `tryPair`), `src/game/online/spineMatchmaking.js`
(`resolveMatchSettings`, `createRoomForPair`). Tests: `matchmakingService.test.js`,
`spineMatchmaking.test.js`.

---

## D-avatar-store: separate coin-bought avatar collection, client-authoritative economy — June 2026

> **Superseded by D-boostie-xp (October 2026).** The store now sells Boosties and reactions.

**Decision:** The avatar **store** is a NEW collection of 36 avatars (`assets/avatars/`,
common/rare/epic/legendary) bought with a coin currency. It **coexists** with — does not replace — the existing
achievement-unlock avatars (`SPINE_AVATARS`); both share the single `equippedAvatar`. Coins are earned three ways
(NOT win/loss): a one-time starter grant, daily login + streak, and achievement completions. Pricing is flat per
tier (`rare 250 / epic 700 / legendary 2500`), "grindy/prestige" tuned so a legendary is a long-haul goal.

**Persistence:** four new profile-ROOT fields (`coins`, `ownedAvatars`, `lastLoginDate`, `loginStreak`) under
`/users/{uid}/profile`, siblings of `rating`/`stats`. No Firebase rule change — `/users/$uid` already grants the
owner write with no child `.validate`. Purchases use a single whole-profile transaction (`purchaseAvatar`) so the
coins-check and `ownedAvatars` append can't race; daily reward is idempotent per day via a same-day guard inside
the transaction.

**Client-authoritative tradeoff (accepted for v1):** because the client writes its own profile, coins and owned
avatars are fully client-trusted — a determined user could self-grant. Cheat-proof purchases would require a
server holding authority (Cloudflare Worker / Cloud Function, like the existing `worker/` push pattern). Deferred;
the store is cosmetic-only, so the abuse ceiling is low. A second deferred hardening is a `claimedAchievements[]`
list checked inside the transaction to make achievement coin rewards idempotent across devices/tabs.

**Render boundary:** `avatarEmoji()` (profileScreen.js) passes store ids through unchanged instead of collapsing
unknown values to 👑, so an equipped store avatar survives into online `player.avatar`; `avatarIconSrc()` resolves
store ids → PNG so it renders on profile, game screen, and opponent cards.

**Evidence:** `src/ui/screens/avatarStore.js`, `avatarStoreScreen.js`; `profileService.js`
(`purchaseAvatar`/`bumpCoins`/`claimDailyReward`); `main.js` (`bootProfileFor` daily claim + `diffNewlyUnlocked`
coin loop). Tests: `avatarStore.test.js`, `avatarStoreScreen.test.js`, extended `profileService.test.js`.

---

## D-matchmaking-claim: pair has one driver (lower uid) that claims both queue nodes — June 2026

**Decision:** In `matchmakingService.tryPair`, a matched pair has exactly one **driver** — the **lower-uid** side. The driver claims **both** queue nodes (its own first, then the partner's) via per-node transactions; the higher-uid side returns `matched:false` and waits for its `activeRoom` to flip.

**Supersedes:** the single-shared-node claim on `min(me, partner)`. That serialized two clients who picked *each other*, but not two clients who both picked the **same higher-uid partner**: each claimed its OWN node, both committed, and both created a room with the shared partner — double-booking it. With 3 simultaneous searchers this left the odd player in a coin toss against a phantom opponent (reported June 2026).

**Why own-node-first:** the RTDB rule for `/matchmakingQueue/{mode}/{uid}` allows deleting any node (`!newData.exists()`) but writing only your own (`auth.uid === $uid`). Claiming our own node first means a rollback (when the partner was already taken) only ever **re-adds our own** entry, staying within the write rule. No rules change was needed.

**Liveness:** `spineMatchmaking` re-runs `tryPair` on every queue change, so the lower side always re-drives; the lowest active searcher always makes progress, pairs off, and the set shrinks.

**Evidence:** `src/game/online/matchmakingService.js` (`tryPair`); tests in `matchmakingService.test.js` ("two searchers who both pick the same higher-uid partner do not double-book it", "the higher-uid side waits").

---

## D-bot-boost-ranking: bot values boost squares by expected remaining value, never the hidden real one — July 2026

**Problem:** the bot rarely played onto boost squares. `scoreMove()` only sums letter face values, so `botSearch.js`'s "pick the highest score" ranking always preferred a plain word worth a few more raw points over a boost-square placement, even though the boost square usually pays out more overall.

**Rejected: flat `+30`.** The user's first proposal — add a constant 30 points to any move touching a boost square — was rejected as too coarse. Boost values genuinely range from +1 (B4) to +100 (B1), plus persistent effects (extra turn, 2×/4× multiplier) and a wheel spin with 8 outcomes; a single flat number either overvalues the cheap types or undervalues the rich ones.

**Rejected: reading the real assigned type.** `state.bonusAssignment[idx]` holds the true type for all 12 board slots from turn 1 — technically readable at any time. Using it directly (e.g. "this exact unplayed square is a B1, weight it 100") would be more *accurate*, but it's an unfair information advantage: the UI renders every unplayed boost square with the same generic ⚡ icon (`docs/ui-rules.md`), so a human player has no way to know which type sits where until a tile actually lands on it.

**Decision:** the bot only uses what a human could also, in principle, work out — which types have already been **revealed** (`state.bonusSqUsed`) — and estimates any unplayed square as the average expected value over whichever of the 14 types haven't shown up yet (`remainingBonusEstimate` in `botSearch.js`, using `BONUS_ESTIMATED_VALUE` from `bonusTileDefs.js`). This is the same "cross it off the list" reasoning an attentive human opponent could do: the estimate is identical regardless of the hidden assignment when nothing has been revealed, and it narrows automatically as more squares get played. Gated behind a new `weighBonusSquares` profile lever — on for medium/hard, off for easy (which already avoids boost tiles entirely via `avoidBonusTiles`).

**Why this can't leak into the real score:** `searchBotMove`'s returned `score` was already internal-only — `botGameSession.js` forwards just `.placed` to `CMD.CONFIRM_MOVE`; the actual awarded points are always computed by the standard commit path. The new `rankScore` field is used only inside `pickMove` for move selection and never reaches gameplay state.

**Evidence:** `src/game/sessions/botSearch.js` (`remainingBonusEstimate`, `rankScoreFor`, `rankKey`), `src/game/boosts/bonusTileDefs.js` (`BONUS_ESTIMATED_VALUE`); tests in `botSearch.test.js` (fairness — identical estimate under two different hidden assignments when nothing is revealed; narrows once a type is crossed off).

---

## D-async-end: "סיום" ends an async game (resign); the home button leaves-and-resumes — June 2026

**Decision:** The in-game top-bar **סיום** (🏁) button — which opens the back-confirm overlay → "leave" → `BACK_INTENT.LEAVE` — now **resigns** for *all* online games, async included. The separate async-only **home** button (`#btn-async-home` → `AH_INTENT.GO_HOME`) is the leave-and-resume path.

**Supersedes:** the earlier decision that "leaving an async game is non-destructive" (the old `BACK_INTENT.LEAVE` branch only resigned `online && !isAsync`). Under that design both buttons did the same leave-and-keep, so the player had **no way to actually end an async game** — the reported bug.

**Evidence:** `src/ui/controllers/gameFlowController.js` `BACK_INTENT.LEAVE` now branches on `ag?.online` (was `ag?.online && !ag?.isAsync`). Resign fires `EV.GAME_COMPLETED`; `onlineGameSession` writes the terminal status via `setStatus` (clearing the async index). Test: `tests/unit/disconnect-leave-e2e.test.js` ("BACK_INTENT.LEAVE for async online dispatches RESIGN_GAME to end the game").

**Tradeoff:** resigning an async game counts as a forfeit (opponent wins). The non-destructive "I'll finish later" intent is still served by the home button.

---

## D1: ES6 Module Spine Architecture (No Bundler)

**Decision:** The new "spine" architecture uses native ES6 modules loaded directly by the browser. No bundler (Webpack, Vite, Rollup) is used.

**Evidence:** `src/main.js` is loaded as `<script type="module">`. `package.json` has no bundler in devDependencies.

**Rationale (inferred):** Simpler build pipeline, direct debugging without source maps, works with Firebase Hosting's static file serving.

**Tradeoff:** No tree shaking, no code splitting beyond what the browser does natively. All modules are fetched individually.

---

## D2: Pure Game Engine (No DOM/Firebase)

**Decision:** All files in `src/game/core/` must not touch DOM, Firebase, or timers.

**Evidence:** `gameEngine.js` comment states "Pure game logic (no DOM, Firebase, or setTimeout)". Unit tests run in Node.js without any browser globals.

**Rationale:** Full unit testability in Node.js. Engine can be used headlessly for bot search, test harness, and replay.

---

## D3: Event Bus as Primary Integration Layer

**Decision:** Cross-module communication goes through the pub/sub event bus (`src/events/bus.js`). Direct function calls between layers are avoided.

**Evidence:** UI screens emit intent events; engine emits state events; sessions bridge them.

**Rationale:** Decoupled modules can be tested independently. Online session (Firebase writes) and animation layer (DOM mutations) are both pure subscribers.

---

## D4: Version-Guarded Firebase Transactions

**Decision:** All game-state writes to Firebase use `commitTransaction()` with an `expectedVersion` check. Stale writes are aborted.

**Evidence:** `src/game/online/roomService.js` → `commitTransaction()`. Security rules enforce version increment of exactly 1.

**Rationale:** Prevents race conditions when both players attempt to write simultaneously (e.g., both claim a timed-out turn).

**Source in intentional-change-register:** "Online move conflict model — version-based transactions rather than append-only."

---

## D5: Seeded RNG for Tile Bag

**Decision:** The tile bag is shuffled using a seeded RNG. Both players use the same seed (`tileBagSeed`) to independently reproduce identical bag sequences locally.

**Evidence:** `src/game/core/tileBag.js` → `createBag(seed)`. `src/util/rng.js` → `createRng()`, `shuffle()`. `tileBagSeed` is stored in Firebase room doc.

**Rationale:** Avoids transmitting the full bag state on every draw. Reduces Firebase writes and bandwidth. Enables deterministic replay.

**Risk:** If any draw operation diverges between clients (e.g., different exchange order), bags become permanently inconsistent.

---

## D6: Room Created on Invite Accept (Not Send)

**Decision:** For friend invites, the Firebase room is created when the recipient accepts, not when the sender sends.

**Evidence:** `src/game/online/inviteService.js` → `acceptInvite()` calls `roomService.createRoom()`.

**Rationale (from intentional-change-register):** Prevents orphan rooms — rooms that were created but the game was never played (recipient rejected or ignored invite).

**Change from legacy:** Legacy created the room on send.

---

## D7: Client-Side Timeout Watchdog (No Cloud Functions)

**Decision:** The turn timer enforcement runs in the opponent's browser (not a Cloud Function).

**Evidence:** `src/game/online/timeoutWatchdog.js` runs in the browser. No Cloud Function infrastructure exists.

**Rationale (inferred):** Avoid Cloud Function complexity and cost. Firebase Realtime Database transactions can enforce the claim atomically.

**Risk:** If both players close their browsers, no timeout claim fires until one reopens the app. Async games naturally handle this; live games could stall.

---

## D8: Async Reminder Service Runs Client-Side

**Decision:** The 24-hour idle reminder and 7-day expiry sweep run in the user's browser.

**Evidence:** `src/game/online/asyncReminderService.js`, called from `src/main.js` on auth.

**Rationale (inferred):** Same as D7 — no Cloud Function infra.

**Risk:** If neither player opens the app, the sweep never runs. Timings are approximate.

---

## D9: Deferred Scoring for Bonus Mini-Games

**Decision:** When a bonus mini-game is triggered, the move score is deferred. The Firebase commit happens in two writes: one for the move geometry, one for the final score after the mini-game.

**Evidence:** `gameEngine.js` → `scoringDeferred: true` in `MOVE_CONFIRMED`. `onlineGameSession.js` listens for `MOVE_SCORE_COMMITTED` to do the second write.

**Rationale:** Lets the mini-game UI run between the move commit and the score commit. Both players see the mini-game state via `liveBonus` in the room doc.

---

## D10: Hook-Based Boost Plugin System

**Decision:** Boost effects are implemented as plugins that register handlers on a hook system (`BEFORE_MOVE_VALIDATE`, `BEFORE_SCORE_COMMIT`, `ON_TURN_END`).

**Evidence:** `src/game/boosts/boostEngine.js` → `runHook()`, `TRIGGERS`. `src/game/boosts/index.js` → `registerAllBoosts()`.

**Rationale:** Decoupled boost effects can be added/removed without modifying engine core. Each plugin is independently testable.

---

## D11: Firebase Compat SDK (v10.13.0)

**Decision:** Uses Firebase compat SDK (not modular v9+ `import` syntax), loaded from CDN at runtime.

**Evidence:** `src/game/online/firebaseClient.js` → `firebase.database()`, `firebase.auth()`. SDK loaded from `storage.googleapis.com/firebase-js-sdk/v10.13.0/firebase-*.js`.

**Rationale (inferred):** Compat syntax matches legacy code in `index.html` which was already using compat SDK. Migration to modular SDK was deferred.

**Tradeoff:** Larger bundle than tree-shaken modular SDK. CDN dependency for first load.

---

## D12: No Multiplier Board Squares

**Decision:** The game has no double/triple letter or word multiplier squares on the board (unlike standard Scrabble).

**Evidence:** `scoringEngine.js` → `scoreMove()` sums tile face values directly with no multiplier lookup. Board cells contain only `{ letter, val, isJoker }`.

**Rationale (inferred):** Game differentiator — bonus system replaces board multipliers with mini-game-based bonuses.

---

## D13: `schemaVersion: 2` in Room Documents

**Decision:** Room documents carry `schemaVersion: 2`. Security rules enforce this.

**Evidence:** `schema.js` → `buildRoomDoc()` sets `schemaVersion: 2`. `firebase.database.rules.json` requires `newData.child('schemaVersion').val() === 2`.

**Rationale:** Guards against legacy clients writing with old schema. Enables future migration detection.

---

## D14: Lock Inventory `[3, 3, 5]`

**Decision:** Each player starts with lock durations `[3, 3, 5]` turns.

**Evidence:** `turnManager.js` → `LEGACY_LOCK_INVENTORY = [3, 3, 5]`. Named "LEGACY" because this was extracted from legacy behavior, not newly designed.

**Implication:** Players have 3 possible lock durations to choose from (3-turn, 3-turn, 5-turn). Once used, that duration is gone.

---

## D15: Scoreless-Turn Threshold = 4, Exchanges Count, Leader May Claim Early

**Decision:** Game ends when `passCount >= 4`. All scoreless turns count — explicit pass, timeout, illegal-word forfeit, AND tile exchange. A leading player can fire `CMD.CLAIM_STALL_END` once `passCount >= 2` to end the game immediately and win.

**Evidence:** `turnManager.js` → `LEGACY_PASS_GAME_OVER_THRESHOLD = 4`, `STALL_CLAIM_THRESHOLD = 2`, `canClaimStallEnd()` helper. `gameEngine.handleClaimStallEnd()`. Topbar button `#btn-claim-stall-end` + overlay `#ov-claim-stall-end` + `claimStallEndController`.

**Rationale (May 2026 revision):** The original threshold was 6, exchanges reset `passCount`, and illegal-word forfeits also reset it. That combination let a trailing player drag a winning opponent forever by alternating exchanges and bad-word attempts — a real product hole especially in async games (potentially 7-day-per-turn delays). The new rules mirror official Scrabble (six successive *scoreless* turns) but lowered to four for faster resolution since the app skews casual / mobile / short sessions. The claim-end button gives the leader explicit agency rather than forcing them to wait out four scoreless turns.

**Pre-launch change:** App was not in production when this was made, so no live-game migration was needed. The "LEGACY" naming is retained for grep-ability; future tweaks should consider any stored `passCount` values in active rooms.

**Tradeoff:** Tighter rules can occasionally end a game one player thinks is "still going." The claim-end button mitigates by giving the leader an explicit action rather than auto-firing.

---

## D16: Presence Heartbeat 10 Seconds, Grace 30 Seconds

**Decision:** Presence updates every 10 seconds; disconnect overlay shows after 30-second grace.

**Evidence:** `presenceService.js` → `HEARTBEAT_MS = 10_000`, `PRESENCE_GRACE_MS = 30_000`.

**Rationale (inferred):** 10s heartbeat is frequent enough to detect disconnect within 30s window. 30s grace prevents false positives from brief connectivity hiccups.

---

## D-soak-agents: Live soak agents use real compat clients, real meeting flows, real controllers (October 2026)

**Decision:** The soak agents (`scripts/simulator/agents/`, `npm run soak`) are full headless clients. Each one signs in anonymously through the firebase compat SDK, not through rules-unit-testing contexts. Each one has its own connection and creates rooms through the real invite and room-code services. Each one plays through `gameController` + `turnTimerController` + `timeoutWatchdog` instead of dispatching engine commands directly.

**Why:** The bugs we are hunting live in the seams between these pieces. Examples: the local timer auto-pass racing a last-second confirm and the opponent's watchdog claim, the controller's `turn-already-passed` guard, liveBonus freezing the opponent, and invite and room-code handshakes. Driving the engine directly (as `gameRunner.mjs` does) skips all of them. Real auth and one connection per player are also what a staging load test must measure.

**Consequences:**
- Games run on the wall clock with the real 20/40/60 s speeds. Throughput comes from `--parallel`, not from shortening the timers.
- Timing is deliberate: about 15% of timed turns commit within ±1.5 s of the deadline.
- The older `npm run sim` scenarios stay for fast, deterministic, injected-clock checks.
- Prod is never a soak target. Staging (a separate Firebase project) is the only remote target.

---

## D-boostie-meshy: Boostie 3D models are generated with Meshy, not TRELLIS — October 2026

**Decision:** Boostie level meshes are generated with Meshy image-to-3D on a paid plan,
through `Blender designs/boosties/meshy_generate.py` (API, `MESHY_API_KEY`). TRELLIS
(`trellis_generate.py`) stays as the free fallback. Everything after generation stays
the same: `build_boostie.py` and the upgrades.

**Test (Zapi L3, same single front image):**
- Meshy's best model kept the concept's face: the lightning mark, the brows and the
  eye shape. It had a crisp painted-fur texture and a believable back and tail. The
  free Meshy 6 Lite mesh was one clean piece.
- TRELLIS gave a soft, generic face (the mark became a tuft), a blurry texture and a
  lumpy, flat tail. The free quota is also only about 1–2 runs a day.
- Tripo couldn't be judged: the web generation hung for 20+ minutes with no result.

**Why paid:** the free plan can't download Meshy 6/7 models. Pro (about $20, 1000
credits, about 30 per model) also gives API access and commercial rights. Free-plan
output must not ship.

---

## D-commit-patch: Room commits write changed fields only; the rules provide compare-and-set (October 2026)

**Decision:** `onlineGameSession` commits through `roomService.commitPatch`: one atomic multi-path `update()` with only the changed fields plus `version + 1`. It no longer uses a full-room `transaction()`.

**Why:** the staging load test showed full-room transactions were the main bandwidth cost. Every commit re-sent the whole room, including the growing `moveHistory`, and both clients re-downloaded it. Spark's 10 GB/month and Blaze's per-GB pricing both scale with this.

**Safety:** compare-and-set no longer needs the client-side transaction loop. The `rooms/$roomId` rule already rejects any write whose `version` isn't `data.version + 1`, and a multi-path update is all-or-nothing. A stale base is therefore rejected server-side exactly like a transaction abort, and the session's existing failure path (rollback, `SYNC_REJECTED`, `forceResync`) handles it. When the session's latest server copy doesn't match the expected version, the commit falls back to the full transaction.

**Consequences:**
- Any new path in the room that must stay version-guarded must keep relying on the `$roomId` rule.
- The timeout watchdog still uses a transaction, because claims are rare.
- Unit tests rely on the mock mirroring the version check for `rooms/<id>` updates.

---

## D-coin-economy: Coins are changed only by the Cloudflare Worker (October 2026)

**Decision:** every coin change (daily reward, achievement reward, store purchase, the
L7 chain unlock, and Play coin packs) is a POST to the existing worker
(`/economy/*`, `worker/src/economy.js`). The worker verifies the Firebase ID token and
writes `users/<uid>/profile` with the service account. The database rules refuse
client writes to `coins`, `loginStreak`, `lastLoginDate`, `ownedReactions`,
`achievementsPaid`, `econRecent`, `coinOrders` and to new non-starter Boosties, except
creating the starter values on a new profile.

**Why:** coins are about to be sold for real money (Phase 6b). With client-written
coins anyone could grant themselves coins or items.

**How:**
- The rules are pure functions in `src/game/account/economy.js`, imported by both the
  app and the worker (wrangler bundles `../src`), so they can't drift.
- Compare-and-set over RTDB REST: read with `X-Firebase-ETag`, write with `if-match`,
  retry on 412. Concurrent client writes to other profile fields (rating, stats) are
  never overwritten.
- Each request carries a `reqId`; the answer is remembered in `profile.econRecent`, so
  a retry never pays twice. Achievements are paid once (`achievementsPaid`). A Play order
  is claimed globally in `coinOrders/<orderKey>` before it is credited, so a purchase
  token can't pay two accounts.
- Every change is logged to `coinLedger/<uid>/<reqId>`.
- The daily reward uses the server's date in Asia/Jerusalem, not the device's clock.
- Guests (anonymous sign-in) get 403: no coins without an account.

**Consequences:**
- The worker must be deployed before the rules (which deploy on push to `main`).
- Achievement completion still reads client-written stats: bounded, not cheat-proof.
- 6b (Play Billing) needs only the client purchase flow; the worker side
  (`credit-play`, `playBilling.js`) is in place and tested.

