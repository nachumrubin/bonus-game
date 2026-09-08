---
name: boost-motion-verification
description: Implement, debug, and verify Boost gameplay motion when perceptibility in real play matters—especially reports that an effect is missing, simultaneous instead of traveling, clipped, directionally wrong, or inconsistent with reduced-motion settings. Use for motion acceptance recordings and regressions; not for static UI-only work.
---

# Boost Motion Verification

Treat perceived runtime behavior as the product contract. An animation is not
finished merely because its event fires, its class exists, or isolated frames
contain the intended colors.

For a visibility regression or a repeated correction, read
[references/accepted-word-sweep-retrospective.md](references/accepted-word-sweep-retrospective.md)
before editing. It records the failure modes that motivated this workflow.

## Establish the Real Reproduction First

Before changing code:

1. Read the user’s exact acceptance criteria and the relevant motion spec.
2. Inspect the latest user recording early. Record its viewport, playback
   speed, route/game mode, visible settings, and the exact interaction path.
3. Reproduce that path through production UI/controller behavior. Direct event
   injection is useful for unit isolation, but it is never the sole acceptance
   path for a perceptibility bug.
4. Match the state immediately before the effect. In particular, distinguish
   tentative human tiles from bot/opponent tiles and persistent highlights.
5. Resolve the effective motion preference from both the in-app tri-state and
   the OS media query. Test the same combination shown by the user.

Do not propose cache or stale-build causes without evidence such as mismatched
loaded asset hashes, build identifiers, or source maps. A localhost recording
is evidence of current runtime behavior unless inspection proves otherwise.

## Audit Geometry, Compositing, and CSS

Never infer physical direction from logical row/column values. Measure live
cell rectangles with `getBoundingClientRect()`:

- establish which column is physically rightmost under RTL layout;
- establish which row is physically topmost;
- assert the ordered animation targets move through those physical positions.

For every effect layer, inspect:

- ancestor `overflow`, transforms, stacking contexts, and `z-index`;
- whether glow, lift, and scale occur on a clipped child;
- pseudo-element size, travel distance, and actual painted area;
- `animation-fill-mode` during stagger delays;
- `!important`, media-query, and inline-style precedence;
- whether normal declarations intended to weaken a variant are overridden by
  keyframe values;
- the actual before/hit/after colors in the real gameplay state.

When sampling pseudo-elements, count them only while the selector that creates
their `content` is active. Computed style for a nonexistent pseudo-element can
return default values that look like a rendered peak.

## Implement the Smallest Semantic Effect

Keep the change attached to the existing semantic event and scoring
representation. Preserve input availability and gameplay state.

For a traveling word effect:

- generate explicit ordered targets from the authoritative word list;
- give every target a start time and bounded duration;
- use a spatially moving front, not only staggered brightness;
- keep the strong peak narrow enough that usually no more than two adjacent
  targets are energized;
- return hit tiles promptly to normal styling instead of accumulating a trail;
- treat the first scoring word as primary and overlap weaker secondary words;
- deduplicate shared tiles;
- provide a static informational alternative for reduced motion.

Do not modify unrelated motion to make the target effect pass. If a shared
preference or infrastructure defect must be corrected, state why it is required
and verify that no unrelated timing or visual hierarchy changed.

## Verification Ladder

Complete all applicable layers before claiming success:

1. **Semantic:** the correct production event triggers once; removed redundant
   effects do not also trigger.
2. **Ordering:** unit tests cover horizontal, vertical, long-word cap,
   multi-word priority, and shared-tile deduplication.
3. **Physical runtime:** browser tests prove screen-coordinate direction, not
   merely array order.
4. **Actual interaction:** exercise genuine human placement/confirmation when
   the user reported human play. Verify the pre-effect tentative styling.
5. **Preference matrix:** test Auto with OS normal/reduced and explicit Yes/No
   against the OS setting that conflicts with it.
6. **Compositing:** sample the visible layer at runtime and verify a strong
   peak, bounded overlap, cleanup, and correct pseudo-element travel axis.
7. **Repetition:** run several accepted moves in one production bot session,
   including ordinary and multi-word cases. Let stronger events such as Boost
   appear when useful for hierarchy comparison.
8. **Artifact:** record the uninterrupted gameplay at normal speed and the
   user’s approximate viewport. Trim loading/setup, not the pauses between
   repeated events.

Frame extraction and computed-style traces are diagnostic evidence, not the
final perceptual acceptance test. Review the uninterrupted artifact at 1× using
a video-capable surface. Ask, without relying on a known timestamp:

> Can I plainly watch the intended motion travel across the targets?

If the answer is only “the state changed,” “something flashed,” or “it is clear
frame-by-frame,” continue tuning. If no available tool can actually present
continuous playback, do not claim that a 1× subjective review occurred; report
the limitation and provide the completed artifact for review.

## Response to a Rejected Iteration

Treat the user’s new recording as authoritative contradictory evidence:

1. retract the prior acceptance claim;
2. inspect the new recording before proposing another cause;
3. compare it with the validation path and identify where the states diverge;
4. add a regression using the user’s real path;
5. retune and replace the artifact;
6. rerun the full verification ladder.

Do not defend an indirect test against what is visibly happening in gameplay.

## Completion Report

Report the root cause, exact timing/transform/glow values, physical direction,
multi-word behavior, reduced-motion behavior, uninterrupted recording contents,
repetition observation, tests, and changed files. State **YES, clearly** only
when continuous 1× playback supports it. Otherwise leave perceptual acceptance
explicitly unproven.
