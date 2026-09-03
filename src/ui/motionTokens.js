// motionTokens — the canonical Boost motion vocabulary (durations, easings,
// press scales). See docs-md/BOOST_MOTION_SPEC.md §4 for the rationale behind
// each value.
//
// These JS constants are the single source of truth for timings that JavaScript
// schedules (choreography helpers, gate/freeze floors). The SAME values are
// mirrored as CSS custom properties on `:root` in styles.css (--motion-*,
// --ease-*, --press-scale-*) for consumers that animate purely in CSS. When you
// change a value here, change its `:root` twin in styles.css — the two are kept
// in lockstep by convention (there is no bundler to derive one from the other).
//
// This module holds NO behavior — it is data only. Staged gameplay sequences
// (e.g. mergeSequenceTiming in scoreAnimationTimings.js) remain explicit
// computed timelines and must NOT be collapsed into a single token here.

// ── Duration tokens (ms) ────────────────────────────────────────────────
// MICRO  — press feedback, hover, toggles (reads as "instant")
// FAST   — per-element gameplay motion: tile pop-in, valid flash, small entrances
// NORMAL — screen transitions, modal/card entrances, overlays
// REWARD — celebratory beats: achievement pop, trophy entrance, victory
export const MOTION_MICRO = 120;
export const MOTION_FAST = 220;
export const MOTION_NORMAL = 320;
export const MOTION_REWARD = 600;

// ── Easing tokens ───────────────────────────────────────────────────────
// STANDARD — the dominant curve; entrances, moves, flashes (in and settle)
// EXIT     — departures (modal dismiss, chip fade-out): ease-in
// BOUNCE   — reward-tier overshoot ONLY (never on per-turn gameplay motion)
export const EASE_STANDARD = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EASE_EXIT = 'cubic-bezier(0.4, 0, 1, 1)';
export const EASE_BOUNCE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

// ── Press-feedback scales ───────────────────────────────────────────────
// Two semantic categories (spec §4.3): standard UI controls get a lighter,
// restrained confirm; game pieces (tiles, board pieces) get a deeper, more
// tactile press.
export const PRESS_SCALE_CONTROL = 0.96;
export const PRESS_SCALE_TILE = 0.92;
