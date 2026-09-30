# Boost square activation: electric border

Implemented the focused square effect and its result sequencing. Automated
runtime verification passes; **subjective continuous 1? perceptual acceptance
is still unproven** because no available tool presented continuous video to
the reviewer. The in-app browser bootstrap returned unavailable. No normal-speed
playback observation is claimed from extracted frames.

## Review recordings

All clips play at the original speed. Only leading setup is trimmed; nothing
between placement/confirmation, ignition, result and acknowledgement is cut.
The full captures and timestamped traces are retained in the runtime folders.

- [Human points award](human-points.mp4)
- [Human persistent multiplier result](human-badge.mp4)
- [Human mini-game intro](human-mini-game.mp4)
- [Hard bot activation and points award](bot-points.mp4)
- [Reduced motion, multiplier result](reduced-motion.mp4)

## Previous failure

The previous cue scaled/recolored the square and attempted cyan shadows.
The square's existing `!important` box-shadow declarations overrode those
keyframes, and the class disappeared at 460ms into a 600ms animation. Auto
awards already had a 420ms presentation delay, but mini-game/wheel intros
opened immediately on a different event with no ignition. New small badges
and the separate mobile multiplier banner could appear even earlier, during
the move render, since engine state is committed before the Boost event.

## Exact implementation and timing

Two absolutely positioned, pointer-transparent pseudo-elements sit above the
committed letter, at z-index 3; the active square is z-index 4, fully opaque,
with visible overflow and no scale/rotation. The real mobile square is 33?33px.

- Core: inset ?2px, 2px `#fff6d5` border. Inset white/amber shadows at 3/7px;
  outer glow: `0 0 3px 1px #fff4c2`, `0 0 8px 3px #ffb52e`,
  `0 0 15px 4px #ed791ab3`.
- Corona: inset ?4px, 2px `#ffda83` border, four static gradient edge segments
  with white highlights and a static irregular polygon clip. Brief stepped
  changes move it by no more than 0.65px horizontally / 0.6px vertically.
- Animation properties: opacity and corona transform only. The core remains
  at least 84% opaque throughout the board-focused beat.
- Total lifetime: **600ms**. Strong square beat: **420ms**. Fade tail: **180ms**.
- Required award/intro and new badge/banner reveal: **420ms scheduled delay**,
  reusing the existing award lead-in, now consistently applied to the Boost flow.
- Reduced motion: **0ms added delay**, same illuminated layers without any
  animation/jitter; static cue is held 600ms. Result, badge and banner still show.

No SVG, turbulence, CSS filter, canvas, global observer, animation framework,
or image asset was added. The reference MP4 was inspected; a separate electric
HTML/CSS demo was not available among the supplied files.

## State and lifecycle

The new UI-only `BOOST_RESULT_READY` signal coordinates the existing result
flow. It does not control validity, Boost state, score commitment, legal input,
turns, or clock deadlines. Engine resolution remains synchronous, including
bot mini-game auto-resolution. Required result acknowledgement keeps its
existing finalization behavior. A read-only pending-award slot is projected
into the view so the mobile banner obeys the same presentation ordering.

Consumption, reminders and duplicate square events do not replay ignition.
Pending presentation and square cleanup timers cancel on abort, restart,
completion and disposal. Disabling animation during the beat cannot drop a
required award. Restored/finalized badges do not depend on receiving an old
presentation event.

## Validation and limits

The test fixtures seed a legal late-board state, then use genuine rack clicks,
placement, confirmation, dictionary validation and engine events. The bot case
uses hard mode's actual search and move dispatch (best-choice policy avoids
medium mode's deliberate random selection of other legal moves).

Eight Boost Chromium scenarios cover points, badge/banner, mini-game, wheel,
reduced-motion badge, explicit reduced-motion intro, explicit full motion with
OS reduction, and bot points. Three existing signature-motion regressions cover
Your Turn, accepted-word motion and horizontal/vertical direction. Required
awards were clicked and scoring finalized; intro buttons started their games.
Full unit suite: **1441 passing**. Final Chromium run: **11 passing**.
Normal result-ready callbacks measured **421.6?434.0ms** after the activation
trace listener; the configured delay is 420ms, with event-loop/render scheduling
accounting for the difference. Reduced reveals are synchronous (no timer).

Runtime traces establish a visible committed letter and bright electric layers
throughout the pre-result interval, no badge/banner or result during that beat,
multiple corona transforms under normal motion, no transforms/animation under
reduced motion, and transient-class cleanup. Extracted frames show the amber
perimeter above the tile. These are objective observations, not subjective
normal-speed playback acceptance or a device-performance certification.

Recordings use a 430?932 viewport. The reference is a 4.59s, 432?614, 30fps
CodePen-style card demo; it provides visual direction rather than a gameplay
reproduction. No live-online room was exercised, and no deadline/protocol code
was changed. Only the Boost square/result sequence was edited; existing user
changes to other motion were preserved.

## Files changed

- `src/ui/boostPresentation.js`
- `src/ui/controllers/animationController.js`
- `src/ui/controllers/animationController.test.js`
- `src/ui/controllers/gameController.js`
- `src/ui/screens/gameScreen.js`
- `src/ui/screens/gameScreen.test.js`
- `src/ui/screens/boostBadges.js`
- `src/ui/screens/boostBadges.test.js`
- `src/main.js`
- `styles.css`
- `tests/e2e/boost-electric-border.spec.js`
- `tests/e2e/signature-gameplay-motion.spec.js`
- `docs-md/CHANGELOG.md`

Assets used/added: None. Missing assets for this effect: None.
Asset inventory updated: No (CSS-only effect).
