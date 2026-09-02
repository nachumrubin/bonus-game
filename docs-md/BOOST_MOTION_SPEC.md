# BOOST_MOTION_SPEC.md — Approved Boost Motion Specification (Phase 2A)

> **Status:** Contract for future implementation agents. Supersedes the
> recommendation sections (H, I) of `docs-md/ANIMATION_AUDIT.md` where they
> conflict — the audit is treated as *evidence*, this document is the *decision*.
>
> **No production code was changed to produce this spec.** Every load-bearing
> claim below was re-verified by reading the actual source (not just trusting
> the audit): `animationController.js`, `turnTimerController.js`,
> `gameScreen.js` (interaction gate + score render path), `settingsCompat.js`.
> Claims that could not be settled by static reading are marked
> **NEEDS RUNTIME VERIFICATION** and collected in §11 — an implementation agent
> must run those before acting on the affected item.
>
> **Scope guard for the next phase:** this document defines *what* Boost's
> motion should be and *why*. It does not authorize any code change. Phase 2B
> (implementation) starts only after this contract is approved, and must proceed
> in the order of §12, gated by the §11 verifications.

---

## 1. Audit Challenge Results

Each recommendation from `ANIMATION_AUDIT.md` §H/§I is re-verified against code
and classified: **APPROVE** / **APPROVE WITH MODIFICATION** / **REJECT** /
**NEEDS RUNTIME VERIFICATION**.

### 1.1 "Create motion duration/easing tokens" — **APPROVE WITH MODIFICATION**
The vocabulary is right, but the audit's `MOTION_GAME` token is rejected: staged
gameplay sequences are *computed timelines* (`mergeSequenceTiming()`), not a
single duration, and giving them a token invites future agents to collapse a
choreography into one number. Keep a **4-token** duration set (§4) plus the
*existing* choreography-function pattern. Approve the easing tokens, reduced to
3 curves (§4).

### 1.2 "`turnTimerController.js` re-derives the timing constants and omits the multiplier phase" — **APPROVE WITH MODIFICATION** (reframed; not the bug the audit implied)
Verified at `turnTimerController.js:115-146`. The local constant copy and the
missing `MULT_MERGE_DELAY_MS` are real. **But the audit mis-framed the impact.**
The freeze (`freezeForScoreAnimation` → `bonusPauseCount++` → `setTimeout(resumeFromBonus, ms)`)
does three things: (a) displays the full per-turn allowance, (b) **suppresses the
auto-pass dispatch**, (c) on resume rebuilds the next player's deadline. Its
*purpose* is **clock fairness** — don't tick the incoming player's clock while
they watch the previous move's score animation. A 300ms under-count therefore
means the next player's clock becomes visible/tickable ~300ms before the
animation settles: a **fairness/polish imprecision, not a state-correctness bug**
(the engine already advanced the turn; nothing corrupts).

Modification to the audit's fix: yes, `turnTimerController` should consume the
shared timing — **but** the correct architecture is not "import the same
constants." It is to **decouple the freeze's *duration* (animation-derived) from
its *existence and minimum* (fairness-derived).** The freeze must survive with a
sensible floor even when animations are disabled (a reduced-motion player still
shouldn't lose 2s of the incoming clock to an instant commit — though the floor
can be much smaller). See §9.6 and the boundary rule in §9-boundary.

### 1.3 "`gameScreen.js` hardcodes `900` twice instead of importing `COUNTUP_PEAK_MS`" — **APPROVE**
Verified at `gameScreen.js:703` (`scoreAnimationLandingMs`), `:839`
(`maybeScheduleActiveSlotSwap`, `+ 900`), and `:238` (count-up cap). Pure
duplication of `COUNTUP_PEAK_MS`. Safe, mechanical, no behavior change. Approve.

### 1.4 "Two independent 100ms overlay pollers → one shared helper" — **APPROVE WITH MODIFICATION**
Verified: `animationController.js:129-157` (score-commit gate) and the count-up
gate in `gameScreen.js`. The audit's own instinct ("don't just centralize the
polling — it may centralize the wrong architecture") is correct and is adopted
here. The system **already has the events** to be event-driven: `bonus/pending`,
`bonus/resolved`, `bonus/award-acknowledged` already drive `overlayCount`, and
`flushScoreCommit()` is already called on the two decrement events. The 100ms
poll + DOM sniff (`bonusOverlayPresentDom`) is a *belt-and-suspenders fallback*,
not the primary mechanism. Target architecture in §5.4. Reject "one shared
polling helper" as the end state; approve a single event-driven overlay-state
source with a bounded safety timeout.

### 1.5 "Fix the broken `multiplierLabel` (bare `×`)" — **APPROVE (as REMOVE)**
Verified: `animationController.js:104-106` fires `multiplierLabel` when
`words.length > 1` — i.e. it means **"this move made multiple words,"** not
"a score multiplier is active." `gameScreen.js:1266` renders it as a literal
`'×'`. It is misnamed *and* the score choreography already flies one chip per
word, so a multi-word move is already communicated. Decision: **remove the
directive and its renderer**, do not repair it. Displaying a bare `×` is an
actively misleading fake multiplier (the real ×2/×4 boost is a separate,
correct `mult-merge` chip). See §7 product decision.

### 1.6 "Adopt `domHelpers.flashAnimation()` everywhere; it's unused" — **APPROVE**
Verified: `domHelpers.js:28-37` exists, zero call sites; `gameScreen.js` uses a
private `flashClass`, and ≥6 other files hand-roll `remove → void offsetWidth →
add`. Consolidating onto one primitive is low-risk and is a precondition for
consistent reduced-motion handling (one place to branch). Approve.

### 1.7 "Add a settings toggle for `animationsEnabled` + auto-default from OS" — **APPROVE WITH MODIFICATION**
Verified: `settingsCompat.js:17-24` (`animationsEnabled` default `true`),
`normalizeUiPreferences:87-102` (accepts `animationsEnabled` or inverse
`skipAnimations`), and `settingsScreen.js` `TOGGLES` (only music/soundFx/vibration —
no animation control). The toggle is warranted. **Modifications:** (a) product
language is **"Reduced motion"**, not "Animations enabled" (§7); (b) do **not**
persist the OS preference into storage — compute an *effective* preference at
runtime (§8); (c) this requires representing the explicit preference as a
**tri-state** (unset / on / off) so the OS default can win when unset — today
`animationsEnabled` collapses to `true` unconditionally, which would override the
OS setting.

### 1.8 "Reduced-motion works at the CSS layer" — **REJECT (as stated); the real defect is larger**
Verified: `styles.css:1699` blanket `@media (prefers-reduced-motion: reduce)`
kills CSS `animation`/`transition`. But the JS **choreography timers keep
running**: `activeSlotTimer` (interaction gate) and the turn-clock freeze are
plain `setTimeout`s with no reduced-motion branch. **Net effect under OS
reduced-motion today: the player sees nothing animate but still waits ~2-3s for
the interaction gate and clock freeze.** Reduced motion currently removes the
*visuals* but not the *waiting* — the opposite of the intent. This elevates the
reduced-motion work from "nice-to-have toggle" to "correctness-of-experience."
See §8, §10.

### 1.9 "Interaction gate blocks input for 3+ s; route it through the enabled flag" — **APPROVE WITH MODIFICATION + NEEDS RUNTIME VERIFICATION**
Verified: `gameScreen.js:677` — `enabled = v.isMyTurn !== false && !activeSlotTimer`.
The gate is driven by `activeSlotTimer`, set in `maybeScheduleActiveSlotSwap`
(`:840`) **independent of `animationController.setEnabled`**. So disabling
animations does not shorten the block — **confirmed by static read.** Static
analysis further indicates the gate is **visual-coherence + misclick-avoidance,
not correctness**: the comment states the cell grid stays live and handlers
"early-out on `canInteract()`," and the engine validates every command. Decision:
shorten the gate to a small floor under reduced motion. **But** because
collapsing a gameplay-input gate is safety-adjacent, require **RUNTIME
VERIFICATION** (§11-T1) that no `confirmMove`/action path relies on the gate
rather than on `canInteract()`/engine validation before any agent shortens it.

### 1.10 "End-game / Elo reveal should reuse `bonusFx.js` wholesale" — **APPROVE WITH MODIFICATION**
Approve stronger end-game/Elo motion (§7). Reject "wholesale reuse": victory,
draw, and defeat must not share one emotional treatment, and the mini-game
confetti is a *mini-game* idiom. Reuse the *primitives* (`countUp`, and confetti
**only** for victory), not the whole `showBonusResult` card. See §7.

### 1.11 "Unify 9+ `:active` press-scale values under `--press-scale`" — **APPROVE WITH MODIFICATION**
Approve consolidation; modify to **two** categories, not one (standard control vs
game piece) — §4, §6.

### 1.12 "Replace `max-height:0→2000px` accordion" — **APPROVE, deferred to Phase 5 + NEEDS RUNTIME VERIFICATION**
The layout-thrash concern is theoretically sound but was never profiled. Verify
measurable jank on a representative device (§11-T6) before rewriting; if
confirmed, replace with grid-rows/measured-height. Low priority.

### 1.13 "`scoreBonusAnimation.js` is likely dead code" — **NEEDS RUNTIME VERIFICATION**
No confirmed call site was found statically. Do not delete on suspicion. Verify
by grepping for `mountScoreBonusAnimation` at implementation time and checking
`main.js` boot; if truly unmounted, remove in Phase 5.

### 1.14 Boundary-critical re-verification summary
| Concern | Verified location | Crosses engine/UI boundary? |
|---|---|---|
| Score-commit overlay gate | `animationController.js:139-171` | **No** — score already committed in state; gate delays only the *visual* |
| Interaction gate (`activeSlotTimer`) | `gameScreen.js:677,840` | **Approaches** — animation timing disables gameplay *buttons*, but engine still validates; grid stays live |
| Turn-clock freeze | `turnTimerController.js:130-146` | **Approaches** — animation duration sets freeze length + suppresses auto-pass, but clock is fairness and deadline is rebuilt correctly on resume |
| `bonusActivationController` CMD dispatch | (game-flow, not animation) | **No** — legitimate command flow |

No current behavior *crosses* the boundary. Two *approach* it (gate, freeze) and
are governed by the boundary rule in §9.

---

## 2. Motion Philosophy — How Boost Should Feel

Boost is a fast, repeated-interaction word game. A player places tiles, confirms,
and passes the turn dozens of times per match. **The motion system exists to make
each of those interactions feel tactile and legible — and then to get out of the
way.**

Three sentences future agents should internalize:

1. **Feedback is instant; consequence is brief; celebration is rare.** The moment
   a finger touches a tile, something responds. The result of a move resolves
   quickly. Only genuinely rare, high-stakes moments (a big unlock, a victory)
   are allowed to be expressive.
2. **Motion explains cause and effect — it is never decoration for its own sake.**
   Every animation must answer "what did I just do?" or "what just changed?"
   If it answers neither, it should not exist.
3. **Animation visualizes game state; it never *is* game state.** The engine
   decides what is true. Motion is a lens on that truth, and a reduced-motion
   player must be able to play the exact same game with the lens turned down.

A professional result will mean **fewer** animations than exist today, each used
more deliberately.

---

## 3. Motion Hierarchy

Three semantic tiers. Every animation in Boost belongs to exactly one. The tier
sets the expected duration band, easing, and how loudly it may play.

### 3.1 UI Motion
**Purpose:** responsiveness, navigation, hierarchy, spatial continuity.
**Examples:** button press, dialog entrance, screen transition, tab switch, list
stagger.
**Rule:** fast and restrained. Duration band `MOTION_MICRO`–`MOTION_NORMAL`.
Never blocks input. Stagger only when it aids comprehension, and kept short.

### 3.2 Gameplay Motion
**Purpose:** causality — tile movement, placement, validation/error, score
consequence, turn change, boost effects.
**Examples:** tile pop-in, valid/invalid feedback, score-merge choreography,
bonus-square activation, turn-glow swap.
**Rule:** may be more tactile than UI motion, but **must not slow repeated play**.
Because it recurs every turn, per-element motion stays in the `MOTION_FAST` band;
only the *composed* score choreography runs longer, and even that must never gate
input longer than it visibly plays.

### 3.3 Reward Motion
**Purpose:** achievement, progression, emotional payoff, victory, significant
unlock.
**Examples:** achievement unlock, victory sequence, Elo increase emphasis.
**Rule:** allowed to be expressive (`MOTION_REWARD` band, `EASE_BOUNCE`
permitted). **Rare, therefore strong.** If a "reward" animation fires on a common
event, it has been miscategorized — move it to Gameplay Motion and tone it down.

---

## 4. Motion Tokens (Proposed Values — Not Yet Implemented)

Smallest useful set. Values are chosen from Boost's existing *dominant* timings
and from interaction frequency, not for mathematical neatness.

### 4.1 Duration
| Token | Value | Band | Used for | Rationale (from existing code) |
|---|---|---|---|---|
| `MOTION_MICRO` | **120ms** | UI | press feedback, hover, toggle | Sits between today's `.07s`–`.18s` press transitions; fast enough to read as "instant," slow enough to perceive. |
| `MOTION_FAST` | **220ms** | Gameplay (per element) | tile pop-in, valid flash, bonus-square flash, small entrances | Anchored to today's `tilePlaceIn` = `.22s`, already the most-tuned gameplay motion. |
| `MOTION_NORMAL` | **320ms** | UI / entrance | screen transitions, modal/card entrance, overlay | Median of today's entrance cluster (`overlayCardIn` .3, `screenIn` .35, `pauseIn` .28). |
| `MOTION_REWARD` | **600ms** | Reward | achievement pop, victory beats, trophy entrance | Anchored to today's `achPop` = `.6s`; the ceiling for a single expressive beat. |

**No `MOTION_GAME` token.** Staged gameplay sequences use a **choreography
function** (the existing `mergeSequenceTiming()` pattern) that composes the tokens
above plus explicit stagger/hold values into a returned timeline. This keeps the
sequence readable and testable and prevents "one magic number" drift.

### 4.2 Easing
| Token | cubic-bezier | Used for | Rationale |
|---|---|---|---|
| `EASE_STANDARD` | **`cubic-bezier(0.22, 1, 0.36, 1)`** | ~all entrances, moves, flashes (in *and* settle) | Formalizes the curve already used ~12× (often hand-copied with inconsistent `0.22` vs `.22`). One canonical spelling. |
| `EASE_EXIT` | **`cubic-bezier(0.4, 0, 1, 1)`** | elements leaving (modal dismiss, chip fade-out, toast out) | Boost has no standard exit curve today; exits are ad hoc. Ease-*in* is correct for departures. |
| `EASE_BOUNCE` | **`cubic-bezier(0.34, 1.56, 0.64, 1)`** | reward pops only (achievement, victory, wheel land) | Consolidates today's near-duplicate overshoot curves (`endTrophyIn`, `achPop`, app-loading). **Reward tier only** — never on a per-turn gameplay motion. |

Curves that are visually indistinguishable from these (e.g. `.2,.9,.2,1` vs
`.2,.9,.3,1`) collapse into `EASE_STANDARD`. `linear` remains reserved for
progress bars/timers (not a named token — it is the literal keyword).

### 4.3 Press feedback (two categories — justified)
Two semantic press behaviors, expressed as CSS custom properties:
| Property | Value | Applies to |
|---|---|---|
| `--press-scale-control` | **0.96** | Standard interactive controls: buttons, chips, nav, list rows |
| `--press-scale-tile` | **0.92** | Game pieces: rack tiles, board tiles, lock chips |

Two are justified because a game piece is a *physical-feeling object* the player
manipulates directly and benefits from a deeper, more tactile press, whereas a UI
button wants a lighter, more restrained confirm. Both use `MOTION_MICRO` +
`EASE_STANDARD`. Everything else (the 9+ ad-hoc scale values) collapses into one
of these two.

---

## 5. Interaction Primitives (What Becomes Reusable)

### 5.1 `flashAnimation(el, className, removeAfterMs)` — promote the existing helper
Already in `domHelpers.js`. Make it *the* implementation for "add an animation
class, force reflow so it replays, auto-remove." `gameScreen.js`'s private
`flashClass` and the ≥6 hand-rolled `void offsetWidth` sites converge onto it.
Give it one reduced-motion branch (skip the class, or apply an instant end-state)
so reduced motion is handled in exactly one place.

### 5.2 Token constants module
A small `motionTokens` surface (JS constants mirroring the CSS custom properties)
so JS-scheduled timings (choreography functions, gate/freeze floors) read the
same numbers the CSS uses. This is the generalization of the *pattern* that
`scoreAnimationTimings.js` already proves works.

### 5.3 Press-scale CSS custom properties
`--press-scale-control` / `--press-scale-tile` applied via a shared `:active`
rule set, replacing per-selector scale values.

### 5.4 A single overlay-state source (replaces both 100ms pollers)
**Target architecture (option 3 + 5 from the task):** one small overlay-state
module that owns "is a blocking bonus overlay open?" as **event-driven state**,
not two polls.
- It maintains the count from the events that already exist (`bonus/pending`
  +1; `bonus/resolved`, `bonus/award-acknowledged` −1) — this is already what
  `overlayCount` does.
- It exposes `isOverlayActive()` and emits `overlay/allClosed` when the count
  returns to zero.
- Both consumers (score-commit gate, count-up gate) subscribe to `overlay/allClosed`
  instead of each running their own `setInterval`.
- **Reset on `GAME_COMPLETED` and on game-screen unmount** so a leaked count
  can't persist across games.
- **One bounded safety timeout** (not a steady 100ms poll): if the count is
  still positive N ms after the score commit was requested, force-flush and log.
  This is the *only* residual timer, and it exists purely to guarantee the
  *visual* never deadlocks — it can never affect game state (the score is already
  committed).

Rejected: keeping two polls with a shared predicate (centralizes the wrong thing).
Rejected: promises/callbacks threaded through the renderer (tighter coupling than
the bus already provides). **Gated by §11-T3** (prove the current polls *can*
deadlock before investing in the rewrite; if they cannot, the change is a
simplification, not a fix).

---

## 6. Core Interaction Choreography (The Ten Sequences)

Format: **Trigger → immediate response → primary motion → secondary response →
settled state.** Durations are targets; easing is a category from §4.2. "Align"
notes when sound/haptic (via `feedbackService`) should land. Every sequence
lists its reduced-motion form (full policy in §10).

### 6.1 Rack tile selection
- **Trigger:** tap a rack tile.
- **Immediate (0ms):** the tapped tile scales to `--press-scale-tile`.
- **Primary (`MOTION_MICRO`, `EASE_STANDARD`):** on release it settles to a
  *selected* state — a subtle lift (small `translateY` up) + persistent glow ring
  so it is unmistakably the chosen tile.
- **Secondary:** any previously-selected tile drops its selected state in the same
  frame.
- **Settled:** selected tile holds the lifted/glow state statically (no looping
  animation) until placed or deselected.
- **Sound/haptic:** none required (selection is low-stakes and high-frequency).
- **Reduced motion:** no lift/scale; selection shown by static glow/outline only.
- *Fixes audit §F #1 (no pickup feedback today).*

### 6.2 Tentative tile placement (before "Play")
- **Trigger:** tap a board cell with a tile selected.
- **Immediate (0ms):** tile appears in the cell.
- **Primary (`MOTION_FAST` × ~0.7 ≈ 150ms, `EASE_STANDARD`):** a **small, quick**
  placement response — a light scale-in from ~0.9, no overshoot. Deliberately
  *lighter* than the committed-tile pop so tentative never reads as final.
- **Secondary:** the source rack slot collapses/clears.
- **Settled:** tile rests in a clearly *tentative* visual state (the existing
  `np`/uncommitted styling).
- **Sound/haptic:** optional soft tick on placement; keep subtle.
- **Reduced motion:** instant appear, no scale.
- *Implements the product decision in §7; must NOT duplicate the committed
  `tilePlaceIn` (audit §F #2).*

### 6.3 Tile returned to rack
- **Trigger:** tap a placed tentative tile (or Recall).
- **Immediate (0ms):** tile leaves the cell.
- **Primary (`MOTION_FAST`, `EASE_EXIT`):** tile animates back toward its rack
  slot (or a quick fade+scale-down if a full fly-back is too costly).
- **Secondary:** rack slot re-fills.
- **Settled:** rack in resting state; board cell empty.
- **Sound/haptic:** none.
- **Reduced motion:** instant return.

### 6.4 Word accepted
- **Trigger:** `EV.MOVE_CONFIRMED` (valid).
- **Immediate (0ms):** committed tiles pop (`tilePlaceIn`, `MOTION_FAST`).
- **Primary (`MOTION_FAST`, `EASE_STANDARD`):** the word's tiles flash valid
  (brightness/gold). Shorten today's `validFlash` from `.5s` toward `MOTION_FAST`.
- **Secondary:** flows directly into Score resolution (§6.6).
- **Settled:** tiles committed; last-move highlight persists until next move.
- **Sound/haptic:** confirm tone on acceptance (align with the valid flash).
- **Reduced motion:** tiles appear committed instantly; a single brief
  brightness step instead of a flash; proceed to score.

### 6.5 Word rejected
- **Trigger:** `EV.INVALID_MOVE_REJECTED`.
- **Immediate (0ms):** the offending word's tiles register the error.
- **Primary (`MOTION_FAST`, `EASE_STANDARD`):** a firm, short horizontal shake +
  red pulse. Error feedback is allowed to be *noticeable* (intensity 3) but not
  long — tighten today's values so the shake reads as "no" without dragging.
- **Secondary:** just-placed tiles get the rollback cue as they prepare to return.
- **Settled:** for `word-not-in-dictionary`, tiles clear and the turn auto-passes
  after the existing **1100ms** hold — **this hold is gameplay logic
  (`gameController.js`), not a motion token, and must remain owned there.** The
  motion system does not shorten it; reduced motion may shorten the *shake*, not
  the *hold*.
- **Sound/haptic:** error tone + short vibration, aligned with the shake onset.
- **Reduced motion:** replace shake with a static red emphasis (border/brightness)
  held briefly; the 1100ms gameplay hold is unchanged.

### 6.6 Score resolution
- **Trigger:** `EV.MOVE_SCORE_COMMITTED` (or the non-deferred path).
- **Immediate:** per-word glow begins as each word's chip launches.
- **Primary (choreography, `mergeSequenceTiming()`):** per-word chips fly to a
  running sum → (if a real ×2/×4 boost is active) the ×N chip merges → bonus
  extra merges → sum holds → flies to the score panel → count-up. This is a
  **bespoke computed timeline**, not tokenized (§12-bespoke).
- **Secondary:** score panel arrival flash + pop; active-turn glow swap aligned to
  count-up completion.
- **Settled:** new score displayed; interaction gate re-opens (see boundary rule).
- **Sound/haptic:** optional soft tick on panel landing; do not over-sound a
  per-turn event.
- **Reduced motion:** **skip the chip flight entirely.** Update the score with a
  short direct `countUp` (≤ `MOTION_NORMAL`) or instant set; the interaction gate
  and clock freeze collapse to their floors (§9-boundary). This is the single most
  important reduced-motion behavior for play speed.
- *Remove `multiplierLabel` (§1.5). The multi-word case is already shown by
  multiple flying chips.*

### 6.7 Boost activation
- **Trigger:** `EV.BOOST_ACTIVATED` (fresh, non-consumed, non-pending).
- **Immediate (0ms):** the bonus square flashes (`bonusActivate`, `MOTION_FAST`).
- **Primary (`MOTION_NORMAL`, `EASE_STANDARD` in / `EASE_EXIT` out):** the award
  modal scales/fades in (keep the existing backdrop+card, retimed to tokens).
- **Secondary:** the boost badge appears with a **single short pulse**
  (`MOTION_FAST`), **not** the current 2200ms loop (§7). Persistent "boost active"
  is then shown by **static badge styling**, not a running animation.
- **Settled:** modal dismissed on ack; badge remains statically active until
  consumed.
- **Sound/haptic:** boost chirp on activation (already exists), aligned to the
  square flash.
- **Reduced motion:** modal fades (opacity only, no scale); badge appears
  instantly in its active static state; square shows a brightness step, no scale.
- *Modal open/close remains the overlay-gate signal for §5.4 — its lifecycle
  events must keep firing.*

### 6.8 Turn becomes yours
- **Trigger:** `EV.TURN_CHANGED` to the local slot, after any incoming animation
  settles.
- **Immediate:** the active-slot glow swaps to your panel (the existing
  remove→reflow→add restart).
- **Primary (`MOTION_FAST`, `EASE_STANDARD`):** a **one-shot** "it's your turn"
  emphasis on your panel/rack (a brief pulse or lift) — distinct from the *held*
  glow state. This fills audit §F #5 (there is an audio/haptic "your turn" cue but
  no matching visual beat).
- **Secondary:** rack/action buttons enable (gate opens — see boundary rule).
- **Settled:** your panel holds the static active glow; controls interactive.
- **Sound/haptic:** the existing "your turn" tone + light vibration, aligned to
  the one-shot emphasis.
- **Reduced motion:** no pulse; the static active-glow state + control enable is
  the entire cue. Sound/haptic still fire (they are not motion).

### 6.9 Achievement unlock
- **Trigger:** achievement newly completed (snapshot diff on `AV_RENDER`).
- **Immediate:** the tile registers as unlocked.
- **Primary (`MOTION_REWARD`, `EASE_BOUNCE`):** icon pop + glow; lock icon
  shatters/spins away (the existing `achPop`/`achGlow`/`achLockBreak`, kept — this
  is legitimately Reward tier).
- **Secondary:** completion modal (if shown) enters via the standard overlay
  entrance.
- **Settled:** tile in unlocked static state; the just-unlocked flag clears on
  next paint so it doesn't re-fire.
- **Sound/haptic:** reward flourish permitted (rare event).
- **Reduced motion:** replace pop/shatter with a brightness/opacity emphasis;
  lock simply disappears; no bounce.
- *Reward tier — allowed to be strong because it is rare.*

### 6.10 Game completion
- **Trigger:** `EV.GAME_COMPLETED`, then `RATING_EVT.CHANGED` (arrives after).
- **Immediate:** **the end screen appears promptly** — no mandatory cinematic
  gate in front of the result. Content is legible within `MOTION_NORMAL`.
- **Primary — outcome-dependent (see §7 hierarchy):**
  - **Victory:** strong reward beat (`MOTION_REWARD`, `EASE_BOUNCE`) — trophy
    entrance + a single confetti burst (reuse `bonusFx.confettiBurst`) + score
    `countUp`.
  - **Draw:** moderate acknowledgement — trophy/emblem entrance + score `countUp`,
    **no confetti**, `EASE_STANDARD`.
  - **Defeat:** polished but restrained — content fade-up + score `countUp`, **no
    celebratory motion, no confetti, no bounce**.
- **Secondary — Elo delta (arrives later, §6-elo):** when `RATING_EVT.CHANGED`
  lands (possibly after the screen is up), the delta line does a **short
  count/reveal** with directional color emphasis (up green / down red), so a
  late-arriving change is still noticed. No oversized celebration.
- **Settled:** static end screen; rating shown in its final state.
- **Sound/haptic:** the existing game-complete arpeggio; strongest for victory.
- **Reduced motion:** all outcomes → prompt static end screen; score set directly
  or a very short count; Elo delta appears with a color state change and no
  movement; no confetti/bounce for any outcome.

---

## 7. Reward Hierarchy (Intensity Ranking)

Motion intensity 1 (barely-there) → 5 (full expressive). The ranking's job is to
**stop future agents from making every event equally flashy.** High-frequency
events are pinned low so repeated play stays fast; rarity earns intensity.

| Event | Intensity | Tier | Notes |
|---|---|---|---|
| Button press | **1** | UI | Micro confirm only. Happens constantly. |
| Tile selection | **1** | Gameplay | Lift/glow, no more. Constant. |
| Tentative placement | **2** | Gameplay | Light, quick — must read as *not* committed. |
| Valid word | **2** | Gameplay | Short brightness flash; leads into score. |
| Multi-word move | **2** | Gameplay | **Communicated by the score chips, not a label.** No separate flourish (remove `multiplierLabel`). |
| Defeat | **2** | Reward(-) | Deliberately restrained — polish without celebration. |
| Score increase | **3** | Gameplay | The choreography is a sequence, but each element stays modest; overall must not gate play longer than it plays. |
| Invalid word | **3** | Gameplay | Error must be *noticed* — firm short shake. Intensity ≠ celebration. |
| Boost activation | **3** | Gameplay | Modal is significant, but boost fires fairly often; badge pulse is one-shot, not a 2.2s loop. |
| Elo increase | **3** | Reward | Noticeable count + directional emphasis, not a party. |
| Draw | **3** | Reward | Moderate acknowledgement. |
| Achievement unlock | **5** | Reward | Rare, celebratory — pop + glow + lock shatter earned. |
| Victory | **5** | Reward | The peak — trophy + confetti + count-up. |

Non-obvious calls explained:
- **Invalid word at 3, above valid word at 2:** errors must interrupt attention
  more than confirmations; a "no" the player misses causes a wasted turn. But 3,
  not higher — it is frequent and must not feel punishing or slow.
- **Boost activation at 3, not 4-5:** it opens a modal (feels big) but recurs
  often enough that a top-tier treatment every time would grate. The 2200ms badge
  pulse is explicitly demoted (§1, §6.7).
- **Defeat at 2, below draw at 3:** a loss should feel clean and quick, never
  celebrated; lingering, expressive motion on a loss reads as rubbing it in.
- **Score increase capped at 3:** it is the most-repeated "reward" in the game;
  its *choreography* can be a couple of seconds but its *intensity per element*
  and its input-gating must stay modest.

---

## 8. Reduced-Motion Behavior — Effective-Preference Policy

### 8.1 The effective preference (runtime, not persisted)
```
effectiveReducedMotion =
   explicitUserPreference   (if the user has ever toggled it)
   else osPrefersReducedMotion   (matchMedia('(prefers-reduced-motion: reduce)'))
   else false   (normal motion)
```
- **Do not persist the OS value.** Only the *explicit* user choice is stored. The
  OS preference is read live each session and used only when no explicit choice
  exists.
- **Requires a tri-state.** Today `animationsEnabled` collapses to `true`
  unconditionally (`settingsCompat.js:89-93`), which would override the OS
  setting. The stored preference must distinguish **unset** from **on** from
  **off** (e.g. store `reducedMotion: 'auto' | 'on' | 'off'`, default `'auto'`;
  `normalizeUiPreferences` maps `'auto'` to "follow OS at runtime"). The existing
  `animationsEnabled`/`skipAnimations` acceptance can remain as the on/off
  expression to avoid a storage migration, but "unset" must become representable.

### 8.2 Product language
Expose **"תנועה מופחתת" / "Reduced motion"** in settings, not "Animations
enabled." It matches the OS concept players already understand and the platform
convention. Internally it may still resolve to `animationsEnabled=false`.

### 8.3 What reduced motion means per category (it is NOT "everything vanishes")
Gameplay information must remain fully understandable.

| Category | Normal | Reduced motion |
|---|---|---|
| Movement (fly/slide/translate) | full path | **opacity/step change** — element appears/updates in place |
| Scale bounce / overshoot pop | `EASE_BOUNCE` | **small brightness/opacity emphasis**, no scale |
| Long choreography (score merge) | full sequence | **shortened, direct** — score `countUp` ≤ `MOTION_NORMAL` or instant; no chip flight |
| Persistent decorative loops (coin glow, bg drift, loading tiles) | looping | **static** |
| Persistent state pulses (boost badge, active glow) | one-shot pulse + static | **static only** (drop the pulse; keep the static state styling) |
| Error feedback (shake) | shake + pulse | **static red emphasis**, held briefly |
| Reward (achievement, victory) | full expressive | **brightness/opacity emphasis + confetti suppressed** |
| Choreography-derived *timers* (interaction gate, clock freeze) | animation-length | **collapse to their correctness/fairness floors** (§9), not zero |

### 8.4 The critical fix
Reduced motion must reach the **JS choreography timers**, not just the CSS. Today
the CSS `@media` rule hides visuals but `activeSlotTimer` and the clock freeze
keep running (§1.8). Under reduced motion, those must collapse to their floors so
the player *actually* interacts sooner — reduced motion removes the wait, not just
the picture.

---

## 9. Architecture Boundaries — Gameplay Timing vs Animation Timing

### 9.1 The inviolable rule
> **Animation may visualize game state, but animation must not become game state.**

No animation controller, timer, or directive may determine: whether a move is
valid, whose turn it is, whether a score is committed, whether a boost is active,
whether an award exists, or whether the game can progress. The engine owns all of
these; animation is a subscriber/renderer. This is verified true today for
`animationController.js` and must stay true.

### 9.2 The three concepts, kept separate
Future agents must not conflate these into one number:

- **A. Visual duration** — how long the player *sees* one animation (e.g. tile pop
  = `MOTION_FAST`). Pure presentation. Freely tuned; zero under reduced motion.
- **B. Choreography duration** — how long a composed sequence takes
  (`mergeSequenceTiming()`). Presentation. Shortened/skipped under reduced motion.
- **C. Gameplay-safe interaction timing** — when the player may interact again, or
  when the clock may resume, *without* causing state races, duplicate commands,
  wrong turns, overlay collisions, or score-sequencing errors.

**A and B are presentation. C is correctness/fairness.** They currently share
numbers (the gate and freeze are computed from B). They must be *decoupled*: C's
*duration* may track B for polish, but C's *existence and minimum floor* are
independent of B and of the reduced-motion setting.

### 9.3 What is actually load-bearing in Boost (verified)
Static verification (§1.9, §1.2, §1.14) indicates Boost has **little or no
interaction timing that exists purely for engine correctness** — the engine
validates every command and Firebase writes are version-guarded. The interaction
gate and the clock freeze are **visual coherence** and **clock fairness**
respectively. Therefore, under reduced motion they *can* collapse toward small
floors without creating state races.

**This is a strong claim, so it is gated, not assumed.** No implementation agent
may collapse the gate or freeze to their floors until §11-T1 and §11-T2 confirm
the engine rejects early/out-of-turn commands and that nothing downstream relies
on the gate as a correctness barrier. Until then, treat C as if it *might* be
load-bearing.

### 9.4 Floors (once §11 confirms they are safe)
- **Interaction gate floor:** a small non-zero value (≈ `MOTION_MICRO`) even under
  reduced motion — enough to prevent an accidental double-tap from the previous
  action bleeding into the new turn (misclick avoidance), but not a perceptible
  wait.
- **Clock-freeze floor:** a small grace (≈ 150-250ms) even under reduced motion,
  so an instant commit does not shave a visible slice off the incoming player's
  first tick. The freeze must also keep suppressing auto-pass for exactly its
  (possibly floored) duration.

### 9.5 The boundary directive for implementers
When you touch the gate or the freeze:
1. Compute its *duration* from the choreography (or the floor under reduced motion).
2. Keep its *purpose* (fairness/coherence/misclick) explicit and independent of
   whether animations play.
3. Never let its expiry be the thing that makes a move valid or a turn advance —
   the engine already did that.

---

## 10. Reduced-Motion Behavior — Complete Policy

(Consolidated; see §8.3 for the per-category table.) The policy in one paragraph:
**Reduced motion keeps every piece of gameplay information and removes the
travel.** Things that move, appear; things that bounce, brighten; long sequences
become short or instant; decorative and persistent-state loops become static; and
crucially the *waiting* tied to choreography (gate, freeze) shrinks to its
correctness/fairness floor so play is genuinely faster, not just quieter. Sound
and haptic feedback are **not** motion and continue under reduced motion unless
the player has separately muted them.

---

## 11. Runtime Verification Plan

Only tests that cannot be settled by static reading. Each: scenario →
instrumentation → expected observation → decision implied by each outcome. **No
implementation in this phase.**

### T1 — Is the interaction gate a correctness barrier or only visual? *(gates §1.9, §9.3)*
- **Scenario:** after an opponent/bot move, during the `activeSlotTimer` window,
  programmatically attempt `CMD.CONFIRM_MOVE` / Play / Recall.
- **Instrumentation:** log `canInteract()`, `v.isMyTurn`, `activeSlotTimer` state,
  and the engine's dispatch result (accepted/rejected + reason).
- **Expected:** engine rejects early/out-of-turn commands; `canInteract()` already
  false.
- **Decision:** if rejected everywhere → gate is visual → **safe to floor under
  reduced motion.** If any command is accepted and mutates state → gate is
  load-bearing → **keep it; do not floor.**

### T2 — Does the clock freeze / its duration affect correctness? *(gates §1.2, §9.4)*
- **Scenario:** offline timed game and a live online game; make a
  multiplier+multi-word move; also make a move with the freeze artificially set to
  0.
- **Instrumentation:** log `bonusPauseCount`, `turnDeadlineMs` before/after
  resume, any auto-pass dispatch, and whether the next player ever auto-passes
  spuriously.
- **Expected:** with freeze=0, next player's clock simply starts earlier; no
  spurious auto-pass; online deadline unchanged (server-authoritative).
- **Decision:** if no spurious pass and deadlines stay correct → freeze is fairness
  → **floor it under reduced motion.** If a shorter freeze causes a wrong/early
  auto-pass → **freeze has a correctness role; keep a real minimum.**

### T3 — Can the overlay gate deadlock the score animation? *(gates §5.4)*
- **Scenario:** force `overlayCount` to leak positive — dispose the controller
  mid-bonus, or drop a `bonus/resolved`/`award-acknowledged` event — then commit a
  score.
- **Instrumentation:** log `overlayCount`, `pendingCommitPayload`, whether
  `flushScoreCommit` ever runs.
- **Expected:** the DOM-fallback poll eventually flushes, OR it never does.
- **Decision:** if it can hang → **the event-driven source + bounded timeout (§5.4)
  is a real fix.** If it always self-heals → the rewrite is a *simplification*
  only; schedule it lower priority.

### T4 — Do score animation and timer resume actually overlap by ~300ms? *(gates §1.2)*
- **Scenario:** multiplier + multi-word move.
- **Instrumentation:** timestamp `resumeFromBonus` firing vs the visual completion
  of `playScoreMergeSequence` (last chip landed / count-up done).
- **Expected:** resume precedes visual completion by ≈`MULT_MERGE_DELAY_MS`.
- **Decision:** if overlap confirmed → adopt shared choreography timing in the
  freeze (§1.2). If not measurable → the constant duplication is cosmetic; fix for
  hygiene, not urgency.

### T5 — Do unmount-surviving timers cause stale renders? *(gates audit §E-Low)*
- **Scenario:** navigate away from the game screen mid-score-animation and
  mid-exchange-highlight.
- **Instrumentation:** log any `_renderAll`/`renderRack` call or thrown error
  after `unmount()`; watch for `activeSlotTimer`/`recentlyArrivedClearTimer`
  firing post-unmount.
- **Expected:** timers fire against a torn-down screen (harmless due to optional
  chaining) or throw.
- **Decision:** if post-unmount fires observed → **clear those timers in
  `unmount()`.** If never observed → leave as-is.

### T6 — Does the accordion `max-height` transition cause measurable jank? *(gates §1.12)*
- **Scenario:** expand/collapse a long stats/guide section, throttled to a
  low-end mobile CPU profile.
- **Instrumentation:** performance trace; count dropped frames / long layout tasks
  during the transition.
- **Expected:** either smooth or visibly dropped frames on long content.
- **Decision:** if dropped frames → **replace with grid-rows/measured-height.** If
  smooth → leave as-is (dead-CSS cleanup only).

---

## 12. Implementation Roadmap (Conservative — After This Spec Is Approved)

Each phase is independently shippable and unit-test-guarded. **Nothing here is
authorized yet.**

**Phase 0 — Runtime verification (§11).** Run T1-T6. Record results back into this
spec. Phases that depend on a verification cannot start until it passes. In
particular T1/T2 gate any change to the gate or freeze.

**Phase 1 — Tokens & mechanical hygiene (no visible change).** Introduce the
duration/easing tokens (§4) and a JS `motionTokens` mirror (§5.2) *without*
rewiring anything to them yet. Land the safe, behavior-neutral fixes: replace the
two hardcoded `900`s with `COUNTUP_PEAK_MS` (§1.3); dedupe the shadowed
`bonusPulse` keyframe and drop the dead `multPulse` (audit §D); clear the
unmount-surviving timers **if** T5 flags them.

**Phase 2 — Core interaction primitives & reduced-motion model.** Promote
`flashAnimation` and migrate call sites onto it (§5.1). Introduce
`--press-scale-control` / `--press-scale-tile` and collapse the ad-hoc `:active`
scales (§4.3). Build the effective-preference model + tri-state (§8) and the
"Reduced motion" settings control. Route the interaction gate and clock freeze
through the reduced-motion floors (§9.4) — **only if T1/T2 passed.**

**Phase 3 — Gameplay motion.** Re-express sequences 6.1-6.8 on the tokens.
Implement the two approved new feedbacks (rack pickup §6.1, tentative placement
§6.2). Remove `multiplierLabel` (§1.5). Retime `validFlash`, the shake, and the
boost-badge pulse (drop the 2200ms loop → one-shot + static state, §6.7).

**Phase 4 — Reward motion.** Implement the outcome-differentiated game-completion
choreography (§6.10) and the Elo-delta reveal (§6-elo) reusing `bonusFx`
primitives selectively (confetti = victory only). Keep the achievement unlock as
is (already Reward-tier correct).

**Phase 5 — Overlay architecture & performance.** Land the single event-driven
overlay-state source (§5.4) **if T3 showed a real deadlock**; otherwise schedule
as a simplification. Replace the accordion `max-height` **if T6 showed jank**.
Remove `scoreBonusAnimation.js` **if** confirmed unmounted (§1.13). Final profiling
pass on the two highest-frequency motions (tile placement, score merge).

---

## What Remains Bespoke (Do NOT Centralize)

Centralize **shared vocabulary and repeated mechanics** (tokens, easing, press,
`flashAnimation`, overlay-state, reduced-motion policy, `bonusFx` reward
primitives). Keep the following **bespoke** — forcing them through a generic
abstraction makes them *harder* to understand, not easier:

- **Score-chip choreography** (`mergeSequenceTiming()` + `playScoreMergeSequence`)
  — a computed timeline; keep it a dedicated function, not tokens.
- **Coin-toss flip** (`coinFlip` + the 1700ms reveal handoff) — a one-off staged
  reveal with its own timing contract.
- **Wheel spin** (`wheelMiniGame` deterministic-landing easing) — bespoke physics
  feel; the overshoot bezier is intrinsic to it.
- **Anagram FLIP reorder** (`unscrambleMiniGame` measure→reorder→invert→play +
  its lone WAAPI shake) — a genuine FLIP; abstraction would obscure it.
- **App-loading splash** and **tutorial spotlight positioning**
  (`getBoundingClientRect` clone) — layout-bound, screen-specific.

These may *consume* the easing tokens where it doesn't distort their feel, but
their sequencing stays local and named.

---

## Appendix: Verification Log (this phase)

Files re-read in full for this spec (not via the audit): `animationController.js`,
`turnTimerController.js`, `settingsCompat.js`, and the interaction-gate + score
render path of `gameScreen.js` (`:660-859`). Corrections made to the audit as a
result: the turn-timer freeze reframed from "confirmed bug" to
"fairness-imprecision + a legitimately-coupled timer" (§1.2, §9); the
reduced-motion defect widened from "no UI toggle" to "the JS choreography timers
ignore reduced motion entirely" (§1.8, §8.4); the interaction-gate/animationsEnabled
independence **confirmed** by code (§1.9); `multiplierLabel` confirmed to mean
multi-word, not multiplier (§1.5). No production code was modified.
