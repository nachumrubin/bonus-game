# ANIMATION_AUDIT.md — Boost Motion System Audit (Phase 1: Investigation Only)

> **No production code was changed to produce this report.** This is a read-only
> architecture audit of Boost's existing animation system, done in preparation
> for establishing a centralized, professional motion system. See
> `docs-md/CLAUDE.md` ("How to Handle Animations Without Breaking Gameplay")
> and `docs-md/docs/ui-rules.md` ("Animation System") for the pre-existing
> documented rules this audit builds on and cross-checks.
>
> Method: full reads of every animation-touching source file (`animationController.js`,
> `gameScreen.js`, `scoreAnimationTimings.js`, `scoreBonusAnimation.js`,
> `bonusActivationController.js`, `turnTimerController.js`, `disconnectController.js`,
> `screenTransitions.js`, `menuScreen.js`, `endGameScreen.js`, `avatarScreens.js`,
> `boostBadges.js`, `boostVetoScreen.js`, `coinTossScreen.js`, `tutorialController.js`,
> `tutorialScreen.js`, `feedbackService.js`, `audioService.js`, `domHelpers.js`,
> every file in `src/ui/screens/miniGames/`), a full line-by-line pass over
> `styles.css` (4540 lines) plus `menu-electric.css`, a repo-wide grep for animation
> libraries, and a trace of the `animationsEnabled`/`skipAnimations` settings pipeline.
> Findings below are static-analysis based — no runtime DevTools profiling was
> performed; that is called out explicitly wherever it matters (see §E).

---

## A. Executive Summary

1. **100% hand-rolled, no library — and that's the right call at this scale.** Every animation in Boost is CSS `@keyframes` + `classList` toggling + `setTimeout`/`setInterval`, with exactly one deliberate, well-guarded exception: a native Web Animations API `.animate()` call for the anagram mini-game's shake effect (`unscrambleMiniGame.js:250`). No GSAP/anime.js/Framer Motion/Lottie is imported anywhere in the app runtime. `package.json` has zero animation dependencies.
2. **The score-merge sequence is a genuine architecture win.** `src/ui/scoreAnimationTimings.js` is a real single-source-of-truth for the multi-stage score-chip choreography, and `animationController.js` is a clean, state-safe, subscriber-only directive dispatcher (`bus.on → trigger(kind, payload) → renderer[kind](payload)`) that never mutates game state. This is the one part of the system that already does timing composition correctly.
3. **That discipline has already partially eroded.** `turnTimerController.js` re-declares its own local copy of the shared timing constants instead of importing `scoreAnimationTimings.js`, and its hand-rolled formula silently omits the multiplier-chip phase (`MULT_MERGE_DELAY_MS`) entirely. `gameScreen.js` hardcodes the literal `900` (== `COUNTUP_PEAK_MS`) twice instead of importing the constant. This is exactly the class of divergence bug `scoreAnimationTimings.js`'s own header comment says it was created to prevent (see `GAP_REPORT.md` item 13) — and it has partially recurred in a third and fourth location.
4. **Outside the score-merge sequence, there is no shared timing/easing vocabulary at all.** Button press feedback alone uses **9+ distinct `:active` scale values** (`.975`/`.98`/`.97`/`.96`/`.95`/`.94`/`.92`/`.88`, plus `translateY`-only and zero-transform variants), several declared 2–3 times on the same selector and resolved only by `!important` + source order. "Fade-up" entrance animations use 3 different easing families for the same visual intent.
5. **Reduced-motion support is real at the CSS layer, only partially real at the JS layer.** `@media (prefers-reduced-motion: reduce)` automatically kills ambient/decorative CSS animation (`styles.css:1699`). The JS-level `animationsEnabled` setting is fully wired end-to-end and unit-tested (`settingsCompat.js` → `gameFlowController.js` → `animationController.setEnabled` → `trigger()` no-op) — **but no settings-screen control exists to let a player actually set it.** It is currently vestigial in practice. Worse, the mechanism only appears to gate *directive-triggered* visual flourishes, not the interaction-blocking delay that rides alongside the score animation (see #7).
6. **Reward-tier animation is inverted relative to its emotional stakes.** A single mid-game word score gets an elaborate, multi-second, multi-stage chip-flight choreography (`playScoreMergeSequence`). The end-of-game victory/defeat screen and the Elo rating change — the two most consequential moments in a match — are revealed with a static, instant `classList` swap and **no** count-up, confetti, or build-up at all.
7. **Two structural race-condition surfaces stand out.** (a) Score-commit animation gating relies on **two independent, non-communicating 100ms `setInterval` pollers** (one in `animationController.js`, one in `gameScreen.js`) doing near-duplicate overlay-presence detection with no shared source of truth and no timeout/escape hatch. (b) The turn timer's incomplete local timing formula (#3) means it can resume the countdown clock **~300ms before** a multiplier+multi-word move's on-screen animation actually finishes.
8. **A reusable animation primitive already exists and is completely unused.** `domHelpers.js` exports `flashAnimation(el, className, removeAfterMs)` — the exact "remove class → force reflow → re-add class → auto-remove" idiom the whole codebase needs — but it has **zero call sites**. At least 7 other files (`gameScreen.js`, `coinTossScreen.js`, `screenTransitions.js`, `matchmakingOverlayScreen.js`, `bonusTimer.js`) independently hand-roll the identical pattern.
9. **Tile interaction feedback is uneven.** Rack-tile selection has no pickup/lift animation at all. Tentative (pre-"Play") tile placement has **no pop-in animation** — the satisfying tile-drop pop (`tilePlaceIn`) only fires after `EV.MOVE_CONFIRMED`/`EV.OPPONENT_MOVED`, i.e. after the whole move is committed, not when a tile is actually placed on the board.
10. **Decorative/ambient animation is cheap; the real performance risk is elsewhere.** None of the ~56 `@keyframes` blocks animate a layout property (all use `transform`/`opacity`/`filter`/`box-shadow`/`background`). The actual layout-thrashing candidates are a handful of `transition:`-based `width`/`max-height` rules (progress bars, accordions) — most notably a `max-height: 0 → 2000px` accordion pattern used for stats/guide sections.

---

## B. Animation Inventory

Grouped by feature area. "Implementation" abbreviations: **CSS-kf** = CSS `@keyframes` + `animation:`; **CSS-tr** = CSS `transition:`; **JS-flash** = `flashClass`/`flashAnimation`-style classList toggle + `setTimeout`; **JS-style** = direct `el.style.*` mutation; **JS-WAAPI** = `Element.animate()`.

### B1. Tile & board interaction

| Screen/feature | Component | Trigger | Animation | Properties | Duration | Delay | Easing | Implementation | Purpose | Reusable? | Hard-coded? | Perf concern | Consistency concern |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rack tile selection | `gameScreen.js selectRack()` | Tap rack tile | **None** — `.sel` class instantly present on re-render | n/a | 0 (instant) | — | — | full `innerHTML` rewrite, no transition | Show selection state | No (no animation exists) | n/a | None | **Missing feedback** — no lift/scale |
| Tentative tile placement (pre-confirm) | `gameScreen.js onCellClick()` | Tap board cell w/ rack tile selected | **None** — tile appears via `innerHTML` rewrite | n/a | 0 (instant) | — | — | direct DOM write | Show placement | No | n/a | None | **Missing feedback** — no pop-in until move confirmed |
| Committed tile placement | `tilePlaceIn` directive → `gameScreen.js:1184-1190` | `EV.MOVE_CONFIRMED` / `EV.OPPONENT_MOVED` | Tile pops in (scale+opacity) | `transform:scale`, `opacity` | 260ms (JS) / kf `.22s` | 0 | `cubic-bezier(0.22,1,0.36,1)` | JS-flash + CSS-kf `tilePlaceIn` | Confirm the move landed | Partial (via `flashClass`) | Yes (260 in JS, .22s in CSS — 2 numbers for 1 concept) | Low | Fires late (only on confirm, not on tap) |
| Word accepted | `validFlash` → `flashWordTiles(..., 'is-valid', 520)` | `EV.MOVE_CONFIRMED` (local only) | Gold brightness flash | `filter: brightness+drop-shadow` | 520ms | 0 | `ease-out` (kf `.5s ease-out both`) | JS-flash + CSS-kf | Confirm legality | Yes | Yes | Low | — |
| Word rejected — tile shake | `shakeWord` → `flashClass(..., 'is-invalid', 300)` | `EV.INVALID_MOVE_REJECTED` | Horizontal shake | `transform: translateX` (8-step) | 300ms (JS) / .28s (kf) | 0 | `ease-out` | JS-flash + CSS-kf | Signal rejection | Yes | Yes (300 vs .28s mismatch) | Low | Duration/CSS drift |
| Word rejected — illegal pulse | `illegalPulse` → `gameScreen.js:1205-1240` | same | Red pulse on whole invalid word (incl. pre-existing tiles) + `rollback-pop` on just-placed tiles as they're about to be recalled | `transform:scale`, `box-shadow` | 700ms hold, then 260ms rollback-pop | 0 | `ease-in-out infinite alternate` | JS classList add/remove w/ fixed `setTimeout(700)` | Signal + prepare for recall | Partial | Yes | Low | — |
| Auto-pass after illegal word | `gameController.js:181-203` | `INVALID_MOVE_REJECTED` w/ `reason:'word-not-in-dictionary'` | (Not visual itself — the 1100ms *hold* before tiles clear + auto-pass) | n/a | **1100ms** | 0 | n/a | `setTimeout` + turn-key guard vs. timer's own auto-pass | Let shake finish before board resets | n/a | Yes | Low | Confirmed matches `GAP_REPORT.md` item 2 |
| Tile bag refill / exchange cascade | `tileCascadeIn` → rack re-render w/ `anim-in` | `EV.TILES_EXCHANGED`, joker resolve, etc. | Staggered tile drop-in per rack slot | `opacity`, `transform:translateY+scale` | 350ms per tile | 35ms × index stagger | `cubic-bezier(.22,.68,0,1.2)` (overshoot) | CSS-kf `tileDropIn`, inline `animation-delay` | Draw feedback | Yes | Yes | Low | — |
| Freshly-exchanged tile highlight | `.bt2-just-arrived` | `EV.TILES_EXCHANGED` | Glow + settle | `box-shadow`, `transform:translateY+scale` | 2000ms (JS clear timer) / kf `2s ease-out` | 0 | `ease-out` | CSS-kf `rackTileArrived` + JS 2000ms clear-and-rerender timer | "These are new" | Partial | Yes | Low | — |
| Board cell selected (placed tile) | `.selected-placed` | Tap a placed-but-uncommitted tile | Persistent pulse while selected | `transform:translateY+scale`, `box-shadow` | infinite (`.9s ease-in-out infinite alternate`) | 0 | `ease-in-out` | CSS-kf `selectedPlacedPulse`, state-driven class | Show what's selected | Yes | n/a | Low | — |

### B2. Score & scoring sequence

| Screen/feature | Component | Trigger | Animation | Properties | Duration | Delay | Easing | Implementation | Purpose | Reusable? | Hard-coded? | Perf concern | Consistency concern |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Word glow during scoring | `scoringWordGlow` | Part of `emitScoreSequence` | Per-word brightness/drop-shadow pulse | `filter` | 420ms default (computed: `max(280, glowEnd-start)`) | `i × 250ms` per word (`WORD_MERGE_STAGGER_MS`) | `ease-in-out infinite` (kf), JS-flash removal | CSS-kf `scoringWordGlow` + JS registry (`glowingTiles` map) for re-render survival | Show which words are scoring | Partial | Yes, plus a local `280` floor not in shared constants file | Low | `.8s ease-in-out infinite` on the *keyframe* vs. a *finite* JS removal — the class is meant to be transient but its own keyframe declares `infinite` |
| Per-word score chip flight | `scoreMergeSequence` → `flyChipIntoSum` | same | Chip flies from word to running-sum chip | `transform` (translate via measured `getBoundingClientRect` deltas), `opacity` | 380ms (`WORD_MERGE_FLIGHT_MS`) | `i × 250ms` stagger | `cubic-bezier(.22,1,.36,1)` | JS-style (hand-rolled FLIP-adjacent: measure both endpoints, set `transition`, mutate `transform`) | Show each word's contribution | No (bespoke) | No — imports shared constants | Low | — |
| ×N multiplier chip flight | same, `mult-merge` chip | when `multiplier > 1` | Chip flies in, correctly shows `×${mult}` | `transform`, inline `background/color/boxShadow/textShadow` | 380ms | `+300ms` after last word (`MULT_MERGE_DELAY_MS`) | same | JS-style, inline styles (not a CSS class) for red/purple branching | Show active multiplier | No | No | Low | Inline-style branching instead of 2 CSS classes |
| Bonus-extra chip flight | same | when `bonusExtra > 0` | Chip flies in | `transform`, `top` offset (`-56px`) | 380ms | `+250ms` after mult/last-word (`BOOST_MERGE_DELAY_MS`) | same | JS-style | Show bonus contribution | No | Yes (`56px` local) | Low | — |
| Sum chip → score panel flight | `flyScoreToPanel` / merge-sequence tail | after merge completes | Sum chip flies to score box, grows (`scale` up to 1.55) | `transform`, `opacity` | 480ms (`SUM_FLIGHT_MS`) | `mergeEnd + 420ms` (`HOLD_AFTER_MERGE_MS`) | `cubic-bezier(.22,1,.36,1)` | JS-style | Land the score | No | No | Low | — |
| Score panel arrival flash | `score-panel-arrive` | chip lands | Panel scale+glow | `transform:scale`, `filter:drop-shadow` | **540ms** (directive path) vs **620ms** (merge-sequence/fly path) | 0 | `cubic-bezier(0.22,1,0.36,1)` | CSS-kf + JS-flash, 2 call sites | Confirm arrival | Partial | Yes — **2 different durations for the same class** | Low | **Confirmed inconsistency** |
| Score panel pop | `score-pop` | chip lands | Number pops + color flash | `transform:scale`, `color` | 500ms | 0 | `cubic-bezier(0.22,1,0.36,1)` | CSS-kf + JS-flash | Emphasize new score | Yes | Yes | Low | — |
| Score hit burst | `spawnScoreHitBurst` | chip lands | Radial burst effect | `opacity`, `transform:translate+scale` | 700ms (kf) / 720ms (JS removal) | 0 | `cubic-bezier(0.22,1,0.36,1)` | CSS-kf `scoreHitBurst` + JS node create/remove | Emphasize landing | No (bespoke node) | Yes (mismatched 700/720) | Low | Minor duration drift |
| Score count-up | `animateScore()` | score value changes | Number ticks up | text content (rAF-driven) | `min(900, 350 + Δ×12)` | 0 | custom cubic ease-out (`1-(1-t)^3`) | JS rAF loop | Show magnitude of change | Yes (self-contained) | Yes — `900`, `350`, `12` all local, `900` duplicates `COUNTUP_PEAK_MS` | Low (rAF, compositor-safe: text only) | Duplicated `900` (2×) instead of importing `COUNTUP_PEAK_MS` |
| Turn-clock freeze during scoring | `turnTimerController.freezeForScoreAnimation` | `MOVE_CONFIRMED`/`OPPONENT_MOVED` | (Not visual — timer pause) | n/a | Locally-recomputed, **omits multiplier phase** | — | — | `setTimeout` from a hand-rolled, incomplete re-derivation of `mergeSequenceTiming()` | Keep clock paused during animation | No | Yes — full duplicate constant set | Low | **Confirmed bug**: clock can resume ~300ms early on multiplier+multi-word moves |
| Interaction gate during scoring | `activeSlotTimer` / `renderInteractionGate` | any scored move | Rack/buttons disabled | `pointer-events`/disabled attr | `scoreAnimationLandingMs(...) + 900ms` (can exceed 3.2s) | — | — | `setTimeout` + boolean gate | Prevent input during animation | n/a | Yes (the `+900`) | **Medium — UX** | Not shortened by `animationsEnabled:false` (see §D, §I) |
| "+N" bonus float (bingo/mult label) | `bingoLabel` / `multiplierLabel` → `floatBonusLabel` | bingo / `words.length>1` | Floating text label | `opacity`, `transform` | 720ms | 0 | `ease-out` | JS node create/remove, `getBoundingClientRect`-anchored | Celebrate bingo / flag multi-word move | Yes (shared helper) | Yes | Low | **`multiplierLabel` renders literal `'×'` with no number** — see §D |

### B3. Boosts / bonus squares

| Screen/feature | Component | Trigger | Animation | Properties | Duration | Delay | Easing | Implementation | Purpose | Reusable? | Hard-coded? | Perf concern | Consistency concern |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bonus square activation | `bonusActivate` → `flashBonusSquare` | `EV.BOOST_ACTIVATED` | Square brightness+scale flash | `filter`, `transform:scale` | 460ms | 0 | `cubic-bezier(0.22,1,0.36,1)` | JS-flash + CSS-kf | Confirm which square fired | Yes | Yes | Low | — |
| Boost badge pulse | `boostPulse` → `flashBoostBadges` | same | Badge glow pulse | `filter:drop-shadow` | **2200ms** | 0 | `ease-in-out` | JS-flash + CSS-kf | Draw attention to active boost | Yes | Yes | Low | **Outlier duration** — 4–8× every other flash |
| Bonus award modal | `bonusAwardOverlay` → `showBonusAwardOverlay` | same, gated on non-consumed/pending | Backdrop fade + card scale-bounce in; reverse on close | `opacity`, `transform:scale` | in: 250ms backdrop / 350ms card; out: fade then 320ms removal | 0 (double-rAF kick-off) | `ease` (backdrop), `cubic-bezier(.22,1.4,.36,1)` (card, overshoot) | JS-style (inline `cssText`, double-rAF) | Announce boost reward | No (bespoke modal) | Yes | Low | Gated behind dual 100ms pollers (see §D) |
| Bonus timer bar (mini-game countdown) | `bonusTimer.js` | mini-game start | Width shrink 100%→0%, color shift at 70% | `width`, `background` | matches mini-game duration, `linear` | 0 | `linear` | CSS-tr on inline `width` | Countdown pressure | Yes (shared across mini-games) | n/a (parameterized) | **Medium — layout property** | — |
| Wheel spin (B13) | `wheelMiniGame.js doSpin()` | player taps spin | Dial rotates to predetermined segment | `transform:rotate` | 3500ms default | 0 | `cubic-bezier(0.18,0.89,0.32,1.27)` (overshoot) | JS-style (`el.style.transition`+`transform`) | Suspense before reveal | No (bespoke) | Yes | Low | Only "true" spin-physics-style animation in the app |
| Wheel win flash | `.bz-burst.is-on` | spin lands | Gold radial explosion | `box-shadow`, `transform:scale` | 650ms | 0 | `ease-out` | CSS-kf `bzFlash` | Celebrate win | Yes (`bonusFx.js` family) | Yes | Low | — |
| Mini-game result card | `showBonusResult` (`bonusFx.js`) | any mini-game ends | Card entrance + emoji bounce (win only) + confetti (win only) + count-up | `opacity`, `transform:translateY/scale` | card 350ms, emoji-bounce 500ms, confetti particles 800-1400ms randomized | confetti particles randomized 0-120ms | `cubic-bezier(.22,1,.36,1)` / `.22,1.5,.36,1` (bounce) | CSS-kf (`bzResultIn`,`bzPopBounce`,`bzConfetti`) + JS `countUp()` rAF | Reward mini-game outcome | **Yes — the most reused animation in the app** (used by 6+ mini-games) | Yes | Low | This is the one genuinely centralized "reward primitive" already in the codebase |
| Letter-spinner "flip" (B14) | `letterSpinnerMiniGame.js` | spin phase | Discrete text swap through alphabet | text content | 80ms per tick (`setInterval`) | 0 | none (linear discrete ticks, no easing) | JS `setInterval` text swap | Slot-machine feel | No | Yes | Low | No deceleration curve — visually abrupt stop vs. wheel's eased landing |
| Anagram (unscramble) fail-reveal | `unscrambleMiniGame.js revealCorrectWord` | wrong answer | Tiles FLIP-slide into correct order, staggered | `transform:translate` | 450ms per tile | 70ms × index stagger | `cubic-bezier(.2,.9,.3,1.35)` (overshoot) | JS hand-rolled FLIP (measure→reorder→invert→play) | Show the correct answer | No (bespoke) | Yes | Low | Most sophisticated hand-rolled animation in the app |
| Anagram wrong-answer shake | `unscrambleMiniGame.js failReveal` | wrong answer | Tile shake | `transform:translateX` | 400ms | 0 | `ease-in-out` | **JS-WAAPI** (`Element.animate()`) | Signal wrong guess | No | Yes | Low | Only WAAPI usage in the app; has `setTimeout` fallback |
| Honeycomb letter flash (B12) | `honeycombMiniGame.js flashHexForLetter` | tap/type letter | Background color flash | `background-color` | 120ms (JS) | 0 | `ease-out .08s` (inline CSS) | JS class/style toggle + `setTimeout` | Confirm input registered | No | Yes | Low | — |

### B4. Screens, overlays, navigation

| Screen/feature | Component | Trigger | Animation | Properties | Duration | Delay | Easing | Implementation | Purpose | Reusable? | Hard-coded? | Perf concern | Consistency concern |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Screen navigation | `screenTransitions.js showScreen()` | any screen change | Fade + slide-up | `opacity`, `transform:translateY` | 350ms | 0 | `cubic-bezier(0.22,1,0.36,1)` | CSS-kf `screenIn` | Orient the player | Yes (one function for all screens) | No | Low | — |
| Home logo entrance | same, `id==='sh'` only | opening home | Fade + drop-in | `opacity`, `transform:translateY` | 500ms | 0 | `cubic-bezier(0.22,1,0.36,1)` | CSS-kf `menuLogoIn` | Brand moment | No (home-only) | No | Low | — |
| Home button stagger | same | opening home | Buttons fade+slide in, staggered | `opacity`, `transform:translateY` | 400ms | `.08s→.56s` per button (9 steps) | `cubic-bezier(0.22,1,0.36,1)` | CSS-kf `menuBtnIn`, nth-child delays; 1200ms JS timer lifts `pointer-events:none` | Polished entrance | No | Yes (`1200` margin hand-computed) | Low | — |
| Generic modal/overlay open | `.ov:not(.hidden) > .ovc` | any `ov*` overlay shown | Scale+fade in | `opacity`, `transform:scale` | 300ms | 0 | `cubic-bezier(0.22,1,0.36,1)` | CSS-kf `overlayCardIn`, auto-fires on class match (no JS orchestration) | Generic modal entrance | **Yes — used implicitly by every `.ov`/`.ovc` overlay in the app** | No | Low | This is the closest thing to a real "shared primitive" for modals |
| Pause overlay | `.pause-ovc`, `.pause-hg`, `.pause-title` etc. | pause opened | Scale-in card + staggered fade-ups (hero/title/sub/3 actions) | `opacity`, `transform` | card 280ms; fade-ups 340-400ms | staggered `.08s→.40s` | `cubic-bezier(.25,.8,.25,1)` (card) / plain `ease` (fade-ups) | CSS-kf `pauseIn` + `pauseFadeUp` | Contextual pause | No (bespoke) | No | Low | Fade-up family uses plain `ease` while most of the app uses the cubic-bezier standard |
| End-game trophy entrance | `#ov-end .end-trophy-hero` | `EV.GAME_COMPLETED` → overlay shown | Bounce scale-in | `transform:scale`, `opacity` | 500ms | 0 | `cubic-bezier(.34,1.56,.64,1)` (strong overshoot) | CSS-kf `endTrophyIn`, pure-CSS auto-trigger on `.hidden` removal | Celebrate outcome | No (bespoke) | No | Low | Fires automatically; no JS choreography |
| End-game content stagger | `.end-victory-title/sub/.end-cards/.end-lb/.ovbtns` | same | Fade-up, 5-element stagger | `opacity`, `transform:translateY` | 350-380ms | `.08s→.34s` | plain `ease` | CSS-kf `endFadeUp` | Reveal result details | No | No | Low | 2 different durations (.35/.38s) inside the same stagger family |
| Win/loss card state | `.is-winner/.is-loser/.is-draw` | same | **None — instant color/border/shadow swap** | n/a | 0 | — | — | plain CSS class, no transition | Show outcome | n/a | n/a | None | **Missing feedback** — see §F |
| Elo delta reveal | `.up`/`.down` on `#elo-delta-*` | `RATING_EVT.CHANGED` (arrives *after* `GAME_COMPLETED`, decoupled) | **None — instant color swap, no count-up** | `color` | 0 | — | — | plain CSS class | Show rating change | n/a | n/a | None | **Missing feedback** — see §F |
| Coin toss flip | `coinTossScreen.js show()` | game start (coin-toss mode) | 4-spin flip reveal | `transform:rotateY+translateY` | 1600ms | 0 | `ease-in-out forwards` | CSS-kf `coinFlip` + JS `setTimeout(1700)` reveal (100ms buffer, explicitly commented) | Decide who goes first | No | Yes (1600 CSS / 1700 JS, intentionally offset) | Low | — |
| Coin toss ambient glow/float | `.coin-glow-ring`, `.coin-float` | always, while screen open | Continuous pulse/bob | `transform:scale`, `opacity` / `transform:translateY` | 2400ms / 3200ms, infinite | 0 | `ease-in-out` | CSS-kf, static classes baked into `coin-toss.html` | Ambient polish | Yes (ambient, reusable pattern) | No | Low (small, isolated elements) | **Decorative** — flag per §7 |
| Achievement unlock (grid tile) | `.ach-iccell--just-unlocked` | diff of prev/next completed-achievement snapshot on `AV_RENDER` | Icon pop + cyan glow + lock shatter | `transform:scale`, `filter:drop-shadow`, `transform:scale+rotate`+`opacity` | 600ms / 1200ms (100ms delay) / 500ms | 0 / 100ms / 0 | `cubic-bezier(.22,1.4,.5,1)` / `ease-out` / `ease-in` | CSS-kf `achPop`+`achGlow`+`achLockBreak`, driven by a **persisted snapshot-diff flag**, not a one-shot attribute | Celebrate unlock | No (bespoke) | No | Low | Has its own (redundant) `prefers-reduced-motion` override in addition to the global one |
| Achievement unlock modal | `#ov-avatar-unlocked` | `AV_UNLOCK_OPEN` | Inherits generic `overlayCardIn` (no bespoke JS animation) | — | 300ms | 0 | `cubic-bezier(0.22,1,0.36,1)` | CSS auto-trigger | Announce unlock | Yes (shared `.ovc` pattern) | No | Low | — |
| Boost badge appear/disappear | `boostBadges.js` | `BOOST_ACTIVATED`, `MOVE_CONFIRMED`, `TURN_CHANGED`, `GAME_STARTED` | **None — static innerHTML re-paint** | n/a | 0 | — | — | direct DOM write | Show active boosts | n/a | n/a | None | **Missing feedback** — see §F |
| Boost veto notice | `boostVetoScreen.js` | `BV_OPEN` | **None — instant show/hide** | n/a | 0 | — | — | `classList.remove/add('hidden')` | Confirm veto choice | n/a | n/a | None | **Missing feedback** |
| Tutorial highlight (in-place) | `.tut-pulse` | tutorial step targets a rack tile/play button | Lift + scale pulse | `transform:translateY+scale` | 1050ms, infinite | 0 | `ease-in-out` | CSS-kf `tutPulse`, JS applies class to real element | Point at next required action | Yes | No | Low | **Gameplay-instructional, not decorative** |
| Tutorial highlight (spotlight clone) | `.tut-lit`/`.tut-spotlight` | tutorial step targets board/buttons in clipped containers | Gold glow pulse | `box-shadow` | 1100ms, infinite | 0 | `ease-in-out` | CSS-kf `tutGlow`, JS clones a positioned overlay div (`getBoundingClientRect`) | Same, for clipped targets | Yes | No | Low | Same |
| App boot loading splash | `.app-loading-tile`, `.app-loading-bolt` | app boot | Tile cycle + lightning strike | `transform`, `opacity`, `filter` | 2800ms, infinite | staggered 0/180/360/540ms | `cubic-bezier(0.34,1.45,0.64,1)` / `linear` | CSS-kf, ambient | Loading personality | No (bespoke) | No | Low | **Decorative** |
| Onboarding tooltip bullets | `.onb-bullets li` | onboarding overlay shown | Slide-in stagger | `transform:translateX`, `opacity` | 350ms | `.05s→.35s`, 4 steps | `ease-out` | CSS-kf `onb-slide-in` | Guided reveal | No | No | Low | Uses `ease-out`, not the app's dominant cubic-bezier |
| Profile screen sections | `.pf-*` (avatar/name/stats/email/buttons) | profile opened | Fade-up stagger, 8 elements | `opacity`, `transform:translateY` | 320ms (sections) / 300ms (buttons) | `.04s→.40s` | plain `ease` | CSS-kf `pf-enter` | Polished entrance | No | No | Low | 2 different durations in one stagger group |
| Stats cards entrance | `.stat-card` | stats screen opened | Fade-up stagger, 6 cards | `opacity`, `transform:translateY` | 400ms | `.04s→.24s`, 6 steps | `cubic-bezier(.22,1,.36,1)` | CSS-kf `statCardIn` | Polished entrance | No | No | Low | — |
| Progress bars (turn timer, disconnect countdown, stats bars) | `.tbar2`, `.dc-bar-inner`, `.stats-spark-bar`, `.stats-tier-bar-fill`, `#sstats .ins-*-bar-fill` | countdown tick / stats render | Width or height fill | `width` / `height` | `1s linear` (timers) / `.4s`–`.6s ease` (stats bars) — **5 different durations across visually-equivalent bars** | 0 | `linear` / `ease` | CSS-tr on JS-set inline style | Show progress/magnitude | Partial | n/a | **Medium — layout property** | 3 of these (`ins-*-bar-fill`) live inside a CSS-marked `display:none` "legacy dead code" panel |
| Stats/guide accordion sections | `.st-section-body` | expand/collapse tap | Height reveal | `max-height` (0 → hardcoded 2000px) | 280ms open / 350ms close | 0 | `ease-out` / `ease-in` | CSS-tr | Progressive disclosure | Yes (one pattern, reused) | Yes (`2000px` magic ceiling) | **High — layout property, worst offender** | See §E |

### B5. Non-visual feedback (for completeness — audio/haptic)

| Trigger | Sound | Haptic | Purpose |
|---|---|---|---|
| `EV.INVALID_MOVE_REJECTED` | 180Hz square → 120Hz, 140ms | `[60]` | Rejection |
| `EV.BOOST_ACTIVATED` (unless consumed/pending) | 660→990Hz sine, 180ms | `[40,30,40]` | Boost fired |
| Turn-timer tick, last 1-3s | 880Hz sine, 60ms | `[20]` | Urgency |
| Incoming invite | 2-note 784→1175Hz, staggered 130ms | `[80,60,80]` | Attention |
| `EV.GAME_COMPLETED` | 3-note arpeggio 523/659/784Hz | `[120,80,120,80,200]` | Celebration |
| `EV.TURN_CHANGED` (only when it becomes local player's turn; suppressed on game's first turn) | 523Hz triangle, 90ms | `[30]` | "Your turn" — **has no matching visual pulse** (see §F) |

---

## C. Architecture Map

```
                    ┌─────────────────────────────────────────────┐
                    │   Game engine (src/game/core/, boosts/)      │
                    │   Pure, event-emitting only. Never touches   │
                    │   animation code (enforced hard rule).       │
                    └───────────────────┬───────────────────────────┘
                                         │ bus.emit(EV.*)
                                         ▼
        ┌────────────────────────────────────────────────────────────┐
        │                     src/events/bus.js                      │
        │             Central pub/sub — the only coupling point       │
        └───────┬───────────────────┬────────────────────┬───────────┘
                │                   │                    │
                ▼                   ▼                    ▼
  ┌─────────────────────┐ ┌──────────────────────┐ ┌────────────────────────┐
  │ animationController │ │ bonusActivationCtrl   │ │ turnTimerController    │
  │  (pure subscriber)   │ │ (dispatches CMD.*,    │ │  freezes clock during  │
  │  bus.on → trigger()  │ │  NOT an animation      │ │  scoring animation —   │
  │  → renderer[kind]()  │ │  module; emits         │ │  RE-DERIVES its own    │
  │                       │ │  bonus/pending,        │ │  (incomplete) copy of  │
  │  Directives listed    │ │  bonus/resolved that   │ │  scoreAnimationTimings │
  │  in §B.               │ │  gate both animation   │ │  instead of importing  │
  │                       │ │  controllers below)    │ │  it (FINDING)          │
  │  Owns: 100ms overlay  │ └──────────┬─────────────┘ └────────────────────────┘
  │  poll #1 (score-      │            │
  │  commit gate)         │            │ bonus/pending, bonus/resolved,
  └──────────┬────────────┘            │ bonus/award-acknowledged
             │ setRenderer({...})      │
             ▼                         │
  ┌───────────────────────────────────────────────────────────────┐
  │                      gameScreen.js (2093 lines)                │
  │  The renderer. Implements every directive as real DOM ops.      │
  │  Owns: hand-rolled FLIP-style score-chip flight, count-up rAF   │
  │  loop, interaction gate (activeSlotTimer), and a SECOND,        │
  │  independent 100ms overlay poll #2 (count-up gate) that         │
  │  duplicates poll #1's detection logic almost verbatim.          │
  └───────────────────────────────────────────────────────────────┘

  ┌────────────────────────────┐   ┌──────────────────────────────┐
  │ scoreAnimationTimings.js    │   │ scoreBonusAnimation.js        │
  │ Single-source-of-truth      │   │ A SECOND, independent "+N"    │
  │ constants + mergeSequenceTiming()│ float implementation for      │
  │ Imported correctly by:      │   │ auto_extra_score boosts.       │
  │  - gameScreen.js            │   │ NOT imported anywhere found   │
  │ NOT imported by:            │   │ in src/ — likely orphaned/     │
  │  - turnTimerController.js   │   │ dead code superseding the      │
  │    (re-derives its own copy,│   │ retired legacy float this same │
  │    missing the mult phase)  │   │ file re-implements.            │
  └────────────────────────────┘   └──────────────────────────────┘

  ┌───────────────────────────────────────────────────────────┐
  │ Screen-level controllers (independent of animationController) │
  │  screenTransitions.js  — CSS-class screen nav, own 380ms/1200ms │
  │                          setTimeout pointer-block/stagger timers│
  │  endGameScreen.js      — no JS animation; relies on CSS         │
  │                          auto-trigger (.ov>.ovc, endTrophyIn)   │
  │  avatarScreens.js      — achievement pop via snapshot-diff class│
  │  coinTossScreen.js     — own setTimeout(1700) reveal timer      │
  │  tutorialScreen.js     — gameplay-instructional highlight,      │
  │                          MutationObserver-driven re-paint       │
  │  miniGames/*.js        — bonusFx.js shared confetti/countUp/    │
  │                          result-card helpers (most-reused        │
  │                          primitive in the app); wheelMiniGame.js │
  │                          + unscrambleMiniGame.js have bespoke    │
  │                          physics-style JS-style animation        │
  └───────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────┐
  │ styles.css (4540 lines) + menu-electric.css                 │
  │ ~56 @keyframes blocks, 60+ transition: declarations.         │
  │ NOT listed as a source in docs-md/docs/ui-rules.md's         │
  │ "Animation System" section header, but menu-electric.css     │
  │ independently defines its own confetti keyframe (bzConfetti)  │
  │ and its own prefers-reduced-motion overrides — a second,      │
  │ undocumented CSS animation surface.                            │
  └───────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────┐
  │ domHelpers.js — flashAnimation() reusable primitive exists   │
  │ but has ZERO call sites. gameScreen.js, coinTossScreen.js,    │
  │ screenTransitions.js, matchmakingOverlayScreen.js,             │
  │ bonusTimer.js each hand-roll the identical                     │
  │ remove→reflow→add→setTimeout-remove idiom independently.       │
  └───────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────┐
  │ Settings pipeline (reduced motion)                            │
  │ settingsCompat.js (animationsEnabled, default true)            │
  │   → SETTINGS_CHANGED bus event                                 │
  │   → gameFlowController.js (uiPreferencePatchFromSettings)      │
  │   → activeGameRef().animationController.setEnabled(bool)       │
  │   → animationController.trigger() becomes a no-op              │
  │ Fully wired and unit-tested end to end.                        │
  │ NO settings-screen UI control exists to actually set it.       │
  │ Does NOT appear to gate gameScreen.js's own interaction-gate    │
  │ timer (activeSlotTimer), which is computed independently in     │
  │ the render path, not routed through the enabled flag.           │
  └───────────────────────────────────────────────────────────┘
```

**Confirmed architectural claims:**
- "Subscriber only, never mutates game state" — **true** for `animationController.js` and `scoreBonusAnimation.js`. `bonusActivationController.js` (despite living in `controllers/`) is explicitly *not* an animation module — it dispatches `CMD.ACTIVATE_BOOST`/`CMD.FINALIZE_BOOST_AWARD` and produces the events the two real animation controllers react to.
- "Animation timing never gates gameplay" — **mostly true**, with one caveat: the interaction gate (`activeSlotTimer` in `gameScreen.js`) does block player input for the duration of the scoring animation. This is a UI-layer decision (not an engine-layer one — the engine itself never waits), but it is a real, measurable input-availability delay tied directly to animation-timing math.

---

## D. Inconsistency Report

| # | Inconsistency | Where | Evidence |
|---|---|---|---|
| 1 | **Two `@keyframes bonusPulse` blocks, same name** | `styles.css:357-360` and `styles.css:1463-1476` | Per CSS cascade rules the later declaration wins; the first is silently dead. A future edit to the "first" (semantically-adjacent) block does nothing — a real footgun. |
| 2 | **Dead keyframe `multPulse`** | `styles.css:1023` | Defined, zero references anywhere in the file. |
| 3 | **9+ distinct `:active` press-scale values** for the same interaction (tap feedback) | `.975`/`.98`/`.97`/`.96`/`.95`/`.94`/`.92`/`.88`, plus `translateY`-only and zero-transform variants across `.bd`, `.pause-action`, `.ovb`, `.bsq`, `.tb`, `.bplay`, `.set-btn`, `.db`, `.jt`, `.lsbox`, `.store-tile`, `.rxn-btn`, `.rxn-emoji-item`, `#smygames .mg-*`, `.pf-btn`, `.adm-*` | No shared CSS variable/token drives any of it. |
| 4 | **Duplicate/conflicting `:active` rules on the same selector**, resolved only by `!important` + source order | `.tb:active` declared 3×, `.ovb:active` 2×, `.bplay:active` 2×, `.set-btn:active` 2× | e.g. `styles.css:767` (`.97`, dead) vs `:1949` (`.96 !important`, wins) |
| 5 | **`score-panel-arrive` fired with 2 different durations** for the identical class | 540ms (`gameScreen.js:1285-1286`, the directive path) vs 620ms (`gameScreen.js:1589,1811`, the merge-sequence/fly path) | Same visual concept, unexplained drift |
| 6 | **`turnTimerController.js` duplicates `scoreAnimationTimings.js`'s constants and omits the multiplier phase** | `turnTimerController.js:115-129` | Missing `MULT_MERGE_DELAY_MS` entirely; clock can resume ~300ms early on multiplier+multi-word moves |
| 7 | **`gameScreen.js` hardcodes `900` twice instead of importing `COUNTUP_PEAK_MS`** | `gameScreen.js:238`, `:839` | The file imports 5 other constants from the shared module but not this one |
| 8 | **Two independent 100ms overlay-presence pollers with duplicated detection logic** | `animationController.js:129-157` vs `gameScreen.js:166-191` | Not synchronized with each other; each independently `setInterval`'d |
| 9 | **`multiplierLabel` directive renders a literal `'×'` with no number** | `gameScreen.js:1266`, `floatBonusLabel(root, payload, '×', ...)` | Payload's actual multiplier value is never read here; real ×N display lives in the separate merge-sequence `mult-merge` chip. Also, this directive's *trigger condition* is `words.length > 1` (multi-word), not "an active score multiplier" — the name is misleading regardless of the missing number. |
| 10 | **`boost-pulse` runs 2200ms** vs. every other flash's 260–720ms range | `gameScreen.js:2052,2055` | 4–8× outlier with no stated rationale |
| 11 | **3 distinct easing families for the same "fade up" entrance pattern** | dominant `cubic-bezier(0.22,1,0.36,1)` (~12 uses) vs. plain `ease` (`pauseFadeUp`, `endFadeUp`, `pf-enter`) vs. `ease-out` (`onb-slide-in`) | No shared token |
| 12 | **Near-identical bezier curves drifted by one digit** | `.bd` buttons: `cubic-bezier(.2,.9,.2,1)` (`styles.css:56`) vs. `.rxn-panel`/`.rxn-bubble`: `cubic-bezier(.2,.9,.3,1)` (`:2652,2796`) | Almost certainly meant to be the same curve |
| 13 | **4 different "quick hover/press" transition speeds** with no semantic pattern | `.1s`/`.12s`/`.15s`/`.18s` clusters, e.g. `.rxn-btn` uses `.12s` while sibling `.rxn-msg-item`/`.rxn-mute-btn` in the same panel use `.1s` | Same component family, different speeds |
| 14 | **5 different durations for visually-equivalent progress bars** | `1s linear` (turn timer, disconnect bar) vs `.4s`/`.5s`/`.55s`×2/`.6s ease` (various stats bars) | No shared token |
| 15 | **Reward-tier mismatch**: mid-game word score gets a multi-second choreographed chip-flight sequence; end-of-game victory/Elo change gets a static instant swap | `playScoreMergeSequence` vs. `endGameScreen.js applyCardStates`/`paintDelta` | See §A.6, §F |
| 16 | **A reusable primitive exists and is unused** | `domHelpers.js:flashAnimation` (0 call sites) vs. 7+ hand-rolled reimplementations | See §A.8 |
| 17 | **`animationsEnabled` toggle likely does not shorten the interaction-gate delay** | `gameScreen.js` `activeSlotTimer`/`maybeScheduleActiveSlotSwap` computed unconditionally in the render path, not routed through `animationController`'s `enabled` flag | Flagged with appropriate caution — no agent could find a code path where `setEnabled(false)` affects this timer; needs runtime verification before treating as confirmed (see §I) |
| 18 | **`menu-electric.css` is a second, undocumented CSS animation surface** | not listed in `docs-md/docs/ui-rules.md`'s "Animation System" source list | Defines its own `bzConfetti` keyframe and its own `prefers-reduced-motion` overrides, independent of `styles.css` |

---

## E. Performance Concerns

No runtime DevTools/profiling pass was performed for this audit — all findings below are static-analysis conclusions from reading the CSS/JS. Recommend a real profiling pass before treating "High" items as confirmed regressions (see §H Phase 5).

**Critical:** None found. No confirmed frame-drop, memory leak, or hang.

**High:**
1. **Dual, uncoordinated 100ms overlay pollers with no timeout/escape hatch** (`animationController.js` + `gameScreen.js`). If `overlayCount` (an event-driven counter) ever leaks positive — e.g. a mismatched `bonus/pending`/`bonus/resolved` pair, or the modal-award path's `bonus/award-acknowledged` event never fires — the pending score-commit animation and/or count-up could silently never render, even though engine state has already updated. This is a real race/deadlock surface, not cosmetic.
2. **`turnTimerController.js`'s incomplete timing re-derivation** (Inconsistency #6) can let the next player begin acting up to ~300ms before the previous player's scoring animation has visually finished, on multiplier+multi-word moves specifically.
3. **`max-height: 0 → 2000px` accordion transition** (`styles.css:3486,3492`, stats/guide sections). This is a well-known reflow-heavy CSS pattern — animating to a large fixed value to fake `height:auto` forces layout of the entire subtree on every frame of the transition, on every open/close. Worse on longer content and low-end devices; this is the single highest-impact layout-thrashing candidate found.

**Medium:**
1. **Interaction-gate delay** (`activeSlotTimer`) can block all input for 3+ seconds on a large multi-word, multiplied, bonus-square move, with no user-facing way to skip and (per Inconsistency #17) possibly no reduction when animations are disabled.
2. **`boost-pulse`'s 2200ms duration** applied to potentially several `[data-badge]` elements simultaneously — not expensive per-element (it's a `filter:drop-shadow` animation, compositor-eligible), but an unusually long-running animation relative to the rest of the system.
3. **3 `width`-transition rules living inside a CSS-marked `display:none` "legacy dead code" panel** (`#st-panel-insights`, `styles.css:3495-3739`). Zero runtime cost today (`display:none` skips layout entirely), but if that panel is ever un-hidden without review, 3 unreviewed layout-affecting transitions activate unexpectedly.

**Low:**
1. **`gameScreen.js`'s `unmount()` doesn't clear `activeSlotTimer` or `recentlyArrivedClearTimer`** (it does clear `scoreTweens`, joker subs, and the generic `cleanups` array, and the count-up poller self-heals on its next 100ms tick since `scoreTweens` is emptied). If the screen unmounts mid-scoring-animation or mid-exchange-highlight, these two timers will still fire `_renderAll()`/`renderRack()` against a torn-down screen. Low real-world impact (optional-chained DOM lookups no-op safely) but a genuine resource-leak smell.
2. **`glowingTiles` registry cleanup gap**: the `.scoring-word-glow` keyframe itself is declared `infinite` (`.8s ease-in-out infinite`), with removal relying on a `setTimeout` racing against `renderBoard`'s `innerHTML` rewrites. In a rare sequencing edge case (no further `renderBoard` call after the registry entry expires), a tile could theoretically retain an infinitely-looping CSS animation with nothing left to clear it.
3. **Duplicate/shadowed CSS declarations** (`bonusPulse` ×2, `multPulse` dead, several `:active` rules ×2-3) — negligible parse-time cost at this file size, but adds unreviewed specificity-fight risk for future edits.

---

## F. Missing Feedback

Interactions where the current visual response is thin, absent, or arrives later/less than an equivalent interaction elsewhere in the app:

1. **Rack tile selection (pickup)** — no lift/scale/highlight transition at all; the `.sel` state class just appears on re-render.
2. **Tentative tile placement (before "Play")** — no pop-in. The satisfying `tilePlaceIn` pop only fires once the whole move is confirmed (`EV.MOVE_CONFIRMED`), so placing 3 tiles before pressing Play produces zero placement animation, then all 3 pop simultaneously on confirm.
3. **End-of-game score/outcome reveal** — no count-up, no confetti, no build-up. Contrast with the elaborate treatment a single mid-game word gets.
4. **Elo rating delta** — instant, unannounced color swap that arrives *asynchronously after* the end-game screen is already open (a separate `RATING_EVT.CHANGED` event, described in code comments as arriving "a moment after" `GAME_COMPLETED`). A player who doesn't happen to glance at that line again could miss their rating change entirely.
5. **"Your turn now" visual cue** — `feedbackService.js` has a dedicated audio+haptic cue exactly for the moment it becomes the local player's turn (`EV.TURN_CHANGED`, suppressed on the game's first turn), but there is no matching visual pulse/flourish for that specific moment — the active-slot glow is a *held state*, not a *"starting now"* animation.
6. **Boost badge appear/disappear** — static re-paint, no entrance flourish, despite the app having a rich flourish vocabulary everywhere else for state changes of similar significance.
7. **Boost veto notice** — instant show/hide, no transition.
8. **Multiplier label** — technically "present" but effectively broken: renders a bare `×` with no number (Inconsistency #9), so in practice this delivers no usable feedback.

---

## G. Classification by Purpose

**UI Motion** (navigation, dialogs, menus, buttons, interface state): screen transitions, home logo/button stagger, generic `overlayCardIn` modal entrance, pause overlay, settings/profile/stats screen entrances, accordion expand/collapse, all button/tile `:active` press feedback, notifications spinner, tip-carousel dots.

**Gameplay Motion** (tiles, moves, boost mechanics, turn events, score changes): tile pop-in/cascade-in, valid/invalid flash, illegal pulse + rollback, entire score-merge sequence (word/mult/bonus chips + sum flight + count-up + panel arrive/pop/burst), bonus-square activation flash, boost badge pulse, bonus award modal, turn-clock freeze, active-slot glow, wheel spin, mini-game timer bar, honeycomb letter flash, anagram FLIP-reveal + shake.

**Reward Motion** (achievements, unlocks, victories, progression): achievement pop/glow/lock-shatter, achievement-unlock modal, mini-game result card (`bonusFx.js` — confetti + count-up + bounce), wheel win-flash, end-game trophy entrance + content fade-up stagger.

**Decorative Motion** (communicates nothing about interaction, state, cause, or reward):
- Coin-toss ambient glow ring (`coinGlowPulse`, 2.4s infinite) and float bob (`coinFloat`, 3.2s infinite) — purely atmospheric while the coin-toss screen is open.
- Home background drift (`bDrift`, 14s, `#sh::before`).
- App-loading tile cycle + lightning bolt strike — loading-screen personality, no information content beyond "still loading."
- Rotate-hint icon (`rotateHint`).
- Online-lobby pulsing dot (`onpulse`) — arguably borderline-informational (signals "live"), kept here since it's continuous ambient rather than event-triggered.

**Flagged for challenge**: none of the decorative animations found are expensive or actively harmful, and all are small, isolated, screen-scoped elements (a coin, a background gradient, a loading tile) rather than something competing for attention during actual gameplay. Per the task's "every animation should justify itself" standard, the closest candidate for removal/reduction would be the coin-toss dual ambient loops (glow ring *and* float bob running simultaneously is arguably one flourish more than needed for a screen whose whole job is a single 1.6s flip reveal) — but this is a minor, low-priority call, not a correctness or performance issue.

---

## H. Proposed Boost Motion System (Architecture Only — Not Implemented)

Boost's existing stack is a single hand-rolled CSS file + vanilla JS controllers, no bundler, no framework. The right-sized motion system for this codebase is **a small set of named constants and one or two shared helper functions** — not a new animation engine, not a component library, not a physics simulator. The existing `scoreAnimationTimings.js` is the correct template to generalize from; it already proves the pattern works when its consumers actually use it.

### Motion duration tokens
Derived from the durations that already dominate the codebase (not invented from scratch):
- `MOTION_MICRO` ≈ 150ms — button/tile press feedback, hover states. Consolidates the 9+ divergent `:active` scale durations and the 4 hover-speed clusters (§D #3, #13).
- `MOTION_FAST` ≈ 260–300ms — small entrance flashes: tile pop-in, valid/invalid flash, bonus-square flash.
- `MOTION_NORMAL` ≈ 400–500ms — screen transitions, modal/card entrances, word-glow.
- `MOTION_GAME` — not a fixed duration; the existing `mergeSequenceTiming()` computed-timeline pattern, generalized as the template for any future multi-stage gameplay sequence.
- `MOTION_CELEBRATION` ≈ 500–700ms — achievement pop, trophy entrance, confetti-adjacent reward moments.

### Easing tokens
- `EASE_STANDARD` = `cubic-bezier(0.22,1,0.36,1)` — formalize the curve that's already used ~12 times; stop hand-copying it with inconsistent leading-zero formatting.
- `EASE_ENTER` (overshoot/bounce family) = `cubic-bezier(.34,1.56,.64,1)`-style — consolidate `endTrophyIn`, `achPop`, and the near-duplicate `app-loading-tile-cycle` curve into one named token.
- `EASE_EXIT` — standardize a single exit curve (currently ad hoc/unspecified for most fade-outs).
- `EASE_LINEAR` — reserved for progress bars only (turn timer, disconnect countdown, mini-game timer).

### Spring/overshoot presets
Since this is CSS-only (no physics engine, and per the task's explicit non-goal, none should be introduced): name 2 curated bezier presets rather than simulating real springs —
- `SPRING_POP` — the `EASE_STANDARD` family, for tile/score pop-ins.
- `SPRING_BOUNCE` — the `EASE_ENTER` overshoot family, for celebratory entrances only (trophy, achievement, wheel landing).

### Reusable interaction primitives
- **Promote `domHelpers.js`'s `flashAnimation()` to the actual shared implementation.** `gameScreen.js` should import and use it instead of its own bespoke `flashClass()` — this alone collapses the "reflow-restart" idiom currently reimplemented 7+ times into one place.
- **One shared `isOverlayActive()` / overlay-gate utility**, used by both `animationController.js` and `gameScreen.js`, replacing the two independent 100ms pollers (§D #8, §E High-1).
- **One CSS custom property, e.g. `--press-scale`**, applied uniformly to every `:active` button/tile rule, replacing the 9+ hardcoded scale values (§D #3).

### Gameplay animation primitives
- Keep `mergeSequenceTiming()`'s computed-timeline pattern as the one and only template for staged sequences. Its actual bug today isn't its design — it's that `turnTimerController.js` doesn't *use* it (§D #6). Fixing that import is higher priority than any new abstraction.

### Reward/celebration primitives
- `bonusFx.js`'s `confettiBurst`/`countUp`/`showBonusResult` trio is already the closest thing Boost has to a designed, reused reward primitive (used by 6+ mini-games). The right move is to **extend its use to the end-game victory screen and the Elo-delta reveal**, not invent a parallel system — this directly closes the reward-tier mismatch in §A.6 and §F using infrastructure that already exists and is already trusted.

### Accessibility
- Make `animationsEnabled` reachable: add the missing settings-screen toggle, and auto-default it from `matchMedia('(prefers-reduced-motion: reduce)')` on first load.
- Route the interaction-gate delay (`activeSlotTimer`) through the same `enabled` flag so disabling animations also removes the artificial input-block, not just the visual flourishes (pending confirmation of Inconsistency #17).

---

## I. Recommended Implementation Order

**Phase 1 — Motion tokens & infrastructure (cleanup, not new visuals).**
Create the token/constants vocabulary (§H). Fix the confirmed, low-risk bugs found in this audit: dedupe the two `bonusPulse` keyframes, remove the dead `multPulse` keyframe, decide-and-fix the broken `multiplierLabel` (either show the real number or retire the directive), unify the two 100ms overlay pollers into one shared utility, make `turnTimerController.js` import `mergeSequenceTiming()` instead of re-deriving it, replace `gameScreen.js`'s two hardcoded `900`s with the imported `COUNTUP_PEAK_MS`, and clear the two leaked timers in `gameScreen.js`'s `unmount()`.

**Phase 2 — Core interaction primitives.**
Unify `:active` press-scale via `--press-scale`. Adopt `domHelpers.js`'s `flashAnimation()` everywhere instead of the hand-rolled duplicates. Wire the settings-screen toggle for `animationsEnabled` + `prefers-reduced-motion` auto-detection. Route `activeSlotTimer`'s interaction gate through that same flag (pending the Phase 0 verification noted in §I "Open Questions" below).

**Phase 3 — Gameplay animations.**
Re-express tile pickup/placement/valid/invalid feedback using the new tokens — no new visual language, just consolidating existing durations/easings onto the tokens from Phase 1. Consider closing the "missing tentative-placement pop-in" gap (§F #2) if product confirms it's wanted (see Open Questions).

**Phase 4 — Reward animations.**
Build the end-game victory/Elo-delta reveal using the already-existing `bonusFx.js` primitives (confetti/count-up), closing the reward-hierarchy gap (§A.6, §F).

**Phase 5 — Polish & performance.**
Replace the `max-height:0→2000px` accordion pattern with a measured-height or CSS grid-rows technique. Confirm and remove genuinely-dead CSS (the 3 `display:none`-panel width-transitions, if that panel is permanently retired). Run an actual DevTools performance pass (this audit was static-analysis only) on the highest-frequency animations — tile placement and score-merge — on a representative low-end device, to confirm or rule out the theoretical concerns in §E.

---

## J. Open Questions (Product/Design Decisions Needed)

1. Should tentative (pre-"Play") tile placement get its own pop-in animation, or is "instant appear, animate only on confirm" intentional — e.g., to keep the tentative/uncommitted visual state deliberately distinct from a committed one?
2. Is the `multiplierLabel` floating bare `'×'` intentional legacy/vestigial, or should it be fixed? And should "scored 2+ words in one move" get its own celebratory label at all, separate from the real ×N score-multiplier boost (which already has its own correct chip inside the merge sequence)?
3. Should the end-of-game victory/defeat screen get a build-up (count-up score, confetti, delayed reveal) matching the weight already invested in mid-game word-scoring animation, or is the current static/instant treatment a deliberate "don't overdo the ending" choice?
4. Should the Elo rating delta get its own dedicated reveal animation/timing, given it can currently arrive silently after the screen is already open?
5. Is `boost-pulse`'s 2200ms duration (4–8× every other flash) intentional emphasis, or an unreviewed outlier that should be brought in line?
6. Should `animationsEnabled` be exposed as a real settings toggle, and should it auto-default from the OS's `prefers-reduced-motion`?
7. Should disabling animations also shorten/remove the `activeSlotTimer` interaction-gate delay, or is blocking input during scoring intentional regardless of animation preference (e.g., to prevent input races with the engine)? This needs a runtime trace to confirm before any fix is scoped — flagged as unverified in §D #17.
8. Is `scoreBonusAnimation.js` (the parallel "+N" float implementation, no confirmed call site found) still intentionally mounted anywhere, or is it dead code safe to delete?
9. What's the product intent behind the 3 stats "Insights" bar-fill transitions living inside a CSS-marked `display:none` "legacy dead code" panel — permanently retired, or planned to return?

---

## Appendix: Source coverage

Files read in full: `animationController.js`, `scoreBonusAnimation.js`, `bonusActivationController.js`, `scoreAnimationTimings.js`, `gameScreen.js` (2093 lines), `gameController.js`, `turnTimerController.js`, `disconnectController.js`, `screenTransitions.js`, `menuScreen.js`, `endGameScreen.js`, `avatarScreens.js`, `boostBadges.js`, `boostVetoScreen.js`, `coinTossScreen.js`, `tutorialController.js`, `tutorialScreen.js`, `feedbackService.js`, `audioService.js`, `domHelpers.js`, `index.html`, `package.json`, `settingsCompat.js`, `settingsScreen.js`, all 8 files in `src/ui/screens/miniGames/` (`bonusFx.js`, `bonusTimer.js`, `wheelMiniGame.js`, `fillMiddleMiniGame.js`, `crosswordMiniGame.js`, `crossingWordsMiniGame.js`, `hiddenWordMiniGame.js`, `honeycombMiniGame.js`, `letterSpinnerMiniGame.js`, `unscrambleMiniGame.js`), `styles.css` (4540 lines, full pass), `menu-electric.css` (targeted), all 49 files in `partials/screens/` (grepped), `docs-md/CHANGELOG.md` and `docs-md/DECISIONS.md` (grepped for animation history).

No code changes were made. This document is the sole deliverable of this phase.
