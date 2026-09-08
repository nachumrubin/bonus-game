# Accepted-Word Sweep Retrospective

This retrospective exists to prevent a repeat of the September 2026
accepted-word gold/electric sweep debugging loop. The central failure was not
CSS syntax. It was repeatedly treating indirect evidence as proof of a visual
experience.

## What Went Wrong

### 1. The first stagger changed every tile before its delay

The delayed keyframe used backwards fill and a non-neutral 0% state. Every tile
therefore changed when the event fired, even before its own delayed animation
started. A compressed effective cadence then made the whole word read as one
flash.

Prevention: the delayed 0% state must be visually identical to the real
pre-effect state. Inspect the frame during each tile’s delay, not only its peak.

### 2. The important motion was placed inside a clipped element

Lift, scale, and glow were applied to `.btile`, whose `.cell` ancestor used
`overflow:hidden`. The implementation technically animated, but the most
legible energy cues were clipped at the real board size.

Prevention: audit every ancestor’s overflow and stacking context before tuning
intensity. Validate at the actual mobile cell dimensions.

### 3. The recording was approved too optimistically

The first generated recording was described as clear even though it mainly
showed a thin rim or a state change. Frame inspection revealed activity, but
normal playback did not plainly communicate a traveling wave.

Prevention: never translate “I found animated pixels” into “the effect reads.”
The uninterrupted 1× question is the acceptance gate.

### 4. Cache was blamed without evidence

A timestamp/cache mismatch was proposed after the user’s localhost recording
contradicted the validation capture. The user correctly explained that their
localhost run was current. This hypothesis consumed a turn without explaining
the observed behavior.

Prevention: verify loaded build identifiers before mentioning cache. Prefer
differences in route, state, preference, and interaction path as testable
hypotheses.

### 5. Reduced-motion precedence was only part of the problem

JavaScript correctly resolved explicit `Reduced motion: No` over the OS
preference, but an unconditional CSS media rule still disabled animations with
`!important`. Fixing that made full motion execute, yet the user still could not
see the intended sweep.

Prevention: test JavaScript preference resolution and CSS cascade together, but
do not stop after finding the first valid defect if the visual acceptance test
still fails.

### 6. The synthetic/bot state did not match human play

The validation capture showed committed bot tiles transitioning into gold. In
real human play, the same tiles were already tentative yellow before
confirmation. Yellow-to-gold over a roughly 100–130ms strong phase provided too
little contrast, then immediately became the persistent green last-move state.

Prevention: reproduce the exact `placeTile → confirmMove` path and inspect the
actual pre-effect style. Do not assume two paths emitting the same semantic
event have the same visual starting state.

### 7. Completion was claimed before the requested repetition test

A short real-path clip of one four-letter word was useful, but the original
acceptance required several accepted words in a real bot game. Calling the work
finished at that point substituted a smaller proof for the requested one.

Prevention: convert every explicit acceptance item into an evidence checklist
before implementation, and audit the checklist again before the final claim.

### 8. Logical column order was mistaken for physical direction

The planner sorted columns descending and the test repeated that assumption.
The board inherits RTL direction, so live geometry showed column 0 on the
physical right and column 9 on the left. The supposedly RTL wave was therefore
traveling left-to-right.

Prevention: direction tests must compare `getBoundingClientRect()` positions.
An array-order test can consistently prove the wrong assumption.

### 9. Secondary opacity declarations did not weaken keyframe peaks

The secondary class declared a lower static opacity, but opacity values inside
the animation keyframes won during the animation. Secondary words could reach
the primary peak despite CSS that appeared to say otherwise.

Prevention: when a variant changes a property controlled by keyframes, give the
variant its own keyframes or parameterize the animated values.

### 10. A pseudo-element measurement counted an element that did not exist

After the base sweep class was removed, `getComputedStyle(..., '::before')`
returned default opacity even though the selector no longer created content.
The test intermittently reported three strong tiles while only two were
painted.

Prevention: predicate measurements on the active rendering selector or verify
`content` is not `none` before counting the pseudo-element.

## Final Evidence That Closed the Issue

- Human placement and confirmation used the real controller path.
- Explicit in-app `No` was tested against OS reduced motion.
- Live geometry proved horizontal right-to-left and vertical top-to-bottom.
- Primary tiles used a 420ms beat with 110ms starts; long words compressed to a
  750ms cap.
- Linear plate timing kept the white-hot peak to one or two rendered tiles.
- Secondary words used dedicated 260ms lower-opacity plate/front keyframes.
- A production offline bot session recorded four genuine local accepted moves:
  six-, five-, three-, and four-tile primary words, including multi-word moves
  and vertical cross-words.
- The final artifact was retained at
  `artifacts/accepted-word-gold-electric-sweep.webm`.

## Process Lesson

The largest mistake was premature certainty. Each rejected iteration contained
a real partial improvement, but the response treated that improvement as proof
of the user-visible outcome. Future work must keep diagnosis, implementation,
technical verification, and perceptual acceptance as separate stages. Only the
last stage justifies saying the motion is finished.
