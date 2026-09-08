# BOOST_MOTION_SPEC.md — Boost Motion Contract

> **Status:** Current source of truth for motion work in Boost.
>
> Read this file before changing animation behavior. Use `CHANGELOG.md` for implementation history and `ANIMATION_AUDIT.md` only when historical investigation is needed.
>
> This document defines **rules and current contracts**, not the history of how they were reached.

---

## 1. Motion philosophy

Boost is a fast, repeated-interaction word game. Motion should make actions tactile, state changes understandable, and important moments satisfying — then get out of the way.

Future agents must preserve these rules:

1. **Feedback is immediate; consequence is brief; celebration is rare.**
2. **Motion explains cause and effect.** Do not animate merely to make a screen busy.
3. **Animation visualizes game state; it never becomes game state.**
4. **Persistent state should not require persistent animation.** Use a one-shot transition, then static styling.
5. **Repeated gameplay actions stay restrained.** Rare events earn stronger motion.
6. **One semantic event should have one dominant feedback moment.** Avoid stacks of glow + pop + burst + bounce that communicate the same thing.
7. **Input must not wait for a purely decorative effect.**
8. **Reduced motion removes movement, never gameplay information or required UI.**

A professional result may contain fewer animations than a prototype, but the important moments should still be visibly intentional.

---

## 2. Motion hierarchy

Every animation belongs to one of three tiers.

### UI Motion

Purpose: responsiveness, navigation, hierarchy, spatial continuity.

Examples:
- button press
- modal entrance
- screen transition
- tab/list movement

Rules:
- fast and restrained
- never blocks input
- use short stagger only when it improves comprehension

### Gameplay Motion

Purpose: causality and state change.

Examples:
- tile pickup/placement
- accepted/rejected word
- score contribution
- turn change
- Boost activation

Rules:
- more tactile than UI motion
- repeated actions must remain fast
- stronger motion is justified only when it explains a more important gameplay event

### Reward Motion

Purpose: achievement, progression, emotional payoff.

Examples:
- achievement unlock
- Elo change
- victory

Rules:
- rare, therefore stronger
- bounce/celebratory motion is allowed here
- victory remains the visual ceiling

---

## 3. Intensity scale

Use this to stop every event from becoming equally flashy.

| Event | Intensity |
|---|---:|
| Button press | 1/5 |
| Tile selection | 1/5 |
| Tentative tile placement | 2/5 |
| Valid word | 2–3/5 |
| Multi-word scoring | 2–3/5 |
| Invalid word | 3/5 |
| Score increase | 2–3/5 |
| Your Turn transition | 2–3/5 |
| Boost activation | 3–4/5 |
| Elo change | 3/5 |
| Defeat | 2/5 |
| Draw | 3/5 |
| Achievement unlock | 4–5/5 |
| Victory | 5/5 |

**Rule:** if a common event visually competes with victory, it is too strong.

---

## 4. Canonical motion tokens

Canonical JS values live in `src/ui/motionTokens.js` and are mirrored by CSS custom properties. Do not duplicate these numbers locally.

### Duration

| Token | Value | Typical use |
|---|---:|---|
| `MOTION_MICRO` | 120ms | press feedback, selection transitions |
| `MOTION_FAST` | 220ms | tile/gameplay feedback |
| `MOTION_NORMAL` | 320ms | modal/card/screen entrances |
| `MOTION_REWARD` | 600ms | rare reward beats |

There is deliberately **no `MOTION_GAME` token**.

Multi-stage gameplay sequences use explicit choreography functions such as `mergeSequenceTiming()`.

### Easing

| Token | Value | Use |
|---|---|---|
| `EASE_STANDARD` | `cubic-bezier(0.22, 1, 0.36, 1)` | normal entrance/movement/settle |
| `EASE_EXIT` | `cubic-bezier(0.4, 0, 1, 1)` | departures |
| `EASE_BOUNCE` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Reward tier only |

`linear` is reserved for timers/progress.

### Press scale

| Token/property | Value | Use |
|---|---:|---|
| `--press-scale-control` | 0.96 | normal controls |
| `--press-scale-tile` | 0.92 | physical game pieces |

Do not invent a new duration/easing/press value unless the interaction genuinely needs behavior not represented here.

---

## 5. Architecture boundaries

### 5.1 Inviolable rule

> **Animation may visualize game state, but animation must not become game state.**

Animation code must not determine:
- whether a move is valid
- whose turn it is
- whether score is committed
- whether a Boost exists/is active
- whether an award exists
- whether the game can progress

The engine is authoritative. Motion observes and renders.

Never make engine progression depend on:
- `animationend`
- `transitionend`
- a timeout whose only purpose is visual completion
- a CSS class being present

### 5.2 Keep four timing concepts distinct

Do not collapse these into one number:

1. **Visual duration** — one animation.
2. **Choreography duration** — a composed visual sequence.
3. **Interaction gate** — UI coherence / misclick protection.
4. **Clock grace** — fairness for the incoming player.

Current ownership:

- primitive motion → `motionTokens.js`
- score choreography → `scoreAnimationTimings.js` / `mergeSequenceTiming()`
- interaction gate → `scoreInteractionGateMs()`
- turn-clock grace → `scoreClockGraceMs()`

Do not reintroduce duplicated timing formulas.

### 5.3 No new animation gates

A new visual effect must not create a new gameplay/input gate unless there is a separately-proven correctness or fairness reason.

Presentation may continue while legal input is already available.

---

## 6. Reduced motion

Canonical preference resolution lives in `src/ui/motionPreference.js`.

Effective preference:

1. explicit user preference, if set
2. otherwise OS `prefers-reduced-motion`
3. otherwise normal motion

Stored user value is tri-state (`auto` / `on` / `off`). The OS value is read live and is **never persisted as an explicit user choice**.

Product wording is **Reduced motion / תנועה מופחתת**, not “Animations enabled”.

### Required rule

**Required presentation must execute even when motion is reduced.**

Do not use “animation disabled” as a reason to skip:
- required modals
- award/result content
- state badges
- accepted/rejected information
- arithmetic needed to understand scoring

Only the movement/flourish may be suppressed.

### Reduced-motion mapping

| Normal behavior | Reduced motion |
|---|---|
| travel / fly / slide | appear/update in place |
| bounce / overshoot | brightness/opacity/static emphasis |
| long choreography | shortened/direct presentation |
| decorative loop | static |
| persistent-state pulse | static state only |
| shake | static error emphasis |
| reward flourish | restrained brightness/opacity; no celebratory movement |
| choreography-derived wait | use the canonical reduced-motion gate/grace floors |

Sound and haptics are separate preferences and are not automatically disabled by reduced motion.

---

## 7. Current gameplay motion contracts

This section records only behavior future work must not accidentally regress. Detailed implementation history belongs in `CHANGELOG.md`.

### 7.1 Rack tile selection

- selection is applied to the live rack node
- selected tile lifts smoothly into its persistent selected state
- switching A → B settles A and lifts B
- no looping selection animation
- no full-rack rebuild merely to change selection state

### 7.2 Tentative tile placement

- tentative placement gets one short, restrained settle
- it must look weaker than committed/opponent arrival
- the effect fires only on the actual placement render, not every board rerender
- repositioning may reuse the same tentative entrance

### 7.3 Return / undo

- deliberate single-tile return gets brief feedback
- bulk rollback/reset must not become a slow one-by-one ceremony

### 7.4 Local confirmation vs opponent arrival

- local tentative tiles **do not pop again** when confirmed
- local confirmation is communicated by acceptance/scoring
- opponent tiles may use the stronger arrival pop because they were not previously visible

Preserve this semantic distinction.

### 7.5 Accepted word

Current baseline:
- brief accepted-word acknowledgement
- scoring contribution follows promptly
- do not restore the old long breathing glow

A future signature success effect may replace/subsume the baseline cue, but there must remain **one dominant acceptance signal**, not several redundant ones.

### 7.6 Invalid word

- short shake = rejection
- static red state = identification
- rollback follows
- do not restore an infinite red pulse
- the dictionary-miss auto-pass hold remains gameplay logic; motion code does not own it

### 7.7 Score resolution

Score arithmetic is a bespoke computed choreography:

`word contributions → real ×N if present → bonus extra if present → total → score panel`

Rules:
- preserve arithmetic clarity
- multi-word scoring may stagger contributions, but total duration stays bounded
- score landing has one dominant landing response
- do not restore redundant landing effects

Current count-up function:

`countUpDurationMs(delta) = min(800, 200 + abs(delta) * 12)`

Small deltas should feel almost immediate; large deltas remain capped.

### 7.8 Boost activation

Boost is stronger than ordinary scoring but weaker than top-tier rewards.

Target causal story:

`triggered square → activation → result/state → scoring consequence if applicable`

Rules:
- connect the triggered board location to the resulting UI/state
- persistent badge gets a short entrance, then static active styling
- no long breathing/pulsing badge loop
- required award/result UI must still appear under reduced motion
- avoid square flash + badge pulse + modal bounce + score burst all competing at once

### 7.9 Your Turn

When control transitions to the local human player:
- provide one clear transient visual cue
- then settle into the persistent active-player state
- align with the existing Your Turn sound/haptic
- do not replay on unrelated rerenders
- do not make it a modal or block input

### 7.10 Game completion

Outcome hierarchy:

- **Victory:** strongest reward treatment; confetti allowed
- **Draw:** moderate acknowledgement; no victory-level celebration
- **Defeat:** polished and restrained; no confetti/bounce celebration
- **Elo:** noticeable late-arriving reveal, but not a separate party

End screen must appear promptly; never put a mandatory cinematic in front of the result.

---

## 8. Do not reintroduce removed redundancy

The following were deliberately removed/simplified and should stay gone unless a future design decision explicitly replaces them:

- radial score hit burst
- separate number `score-pop` on the score landing frame
- long/infinite scoring-word breathing glow
- infinite invalid-word red pulse
- misleading multi-word bare `×` / `multiplierLabel`

The real score multiplier remains the correct `×N` contribution in score choreography.

---

## 9. Reusable primitives vs bespoke choreography

### Centralize

Centralize only repeated vocabulary/mechanics:

- motion tokens
- reduced-motion preference resolution
- shared flash/restart helper
- repeated press behavior
- canonical score timing helpers
- reusable reward primitives when they genuinely fit

Avoid helpers that require many booleans or hide the interaction's semantics.

### Keep bespoke

Do **not** force unique mechanics through generic animation abstractions:

- score-chip choreography (`mergeSequenceTiming()` / `playScoreMergeSequence`)
- coin toss flip
- wheel spin
- anagram FLIP reorder / WAAPI shake
- tutorial spotlight positioning
- app-loading choreography

These may consume shared tokens when appropriate, but their sequencing remains local and named.

---

## 10. Rendering/performance rules

1. Prefer `transform` and `opacity`.
2. Avoid animating layout properties when a transform can communicate the same thing.
3. Do not redesign a renderer solely to preserve a low-value animation.
4. Prefer semantic state classes and short transient animation classes.
5. Do not add global MutationObservers, generic animation queues, or a new animation framework for ordinary gameplay motion.
6. Clean up timers/transient state on unmount.
7. Do not assume an effect is performant or polished from code inspection alone.

---

## 11. Visual validation standard

Automated tests prove semantics, not animation quality.

For visible motion work:

1. Test the real event path.
2. Observe motion over time when practical:
   - video
   - frame sequence
   - timestamped DOM/computed-style trace
3. Repeat high-frequency effects several times.
4. Validate normal and reduced-motion behavior.
5. Ask:

> **Would a player notice the intended change, and would it still feel good on the fiftieth repetition?**

For work whose goal is a signature visual improvement, “technically smoother” is not enough.

Semantic automated tests should cover:
- correct event triggering
- no replay on unrelated rerender
- local/opponent distinctions where relevant
- reduced-motion information preservation
- teardown safety
- no new gameplay-state dependency on animation

Do not make tests brittle by asserting every keyframe percentage.

---

## 12. Sound and haptics

Motion passes may **synchronize** existing sound/haptic feedback with the correct semantic moment.

Do not opportunistically add a large set of new sounds while polishing animations.

A dedicated feedback-system pass should eventually align:
- motion intensity
- sound intensity
- haptic intensity

Routine interactions should remain subtle or silent; rare rewards may be stronger.

---

## 13. Agent workflow

For a new motion task:

1. Read this file.
2. Read only the relevant latest entries in `CHANGELOG.md`.
3. Trace only the event/render path needed for the task.
4. Do **not** repeat a full animation audit unless explicitly requested.
5. Keep the diff scoped.
6. Preserve the architecture boundaries above.
7. Add semantic tests.
8. Runtime-check visible motion.
9. Record implementation history in `CHANGELOG.md`, **not in this spec**.

If a new product/design decision changes the permanent motion contract, update this file succinctly. Otherwise leave it alone.

---

## 14. Historical material

Historical investigation, rejected alternatives, completed runtime verification, phased implementation plans, and detailed before/after timing reports belong in:

- `CHANGELOG.md`
- `ANIMATION_AUDIT.md`
- tests
- commit history

Do not copy them back into this contract.
