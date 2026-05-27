// Shared timing constants for the score-commit animation.
//
// Previously these values were duplicated between
// `controllers/animationController.js` (under one set of names) and
// `screens/gameScreen.js` (under a parallel set of names). If they
// diverged the merge sequence would have desynced — words landing in the
// panel before the booster animation finished, etc. (GAP_REPORT item 13).
//
// Single source of truth so divergence is impossible.

export const WORD_MERGE_STAGGER_MS = 250;  // delay between successive word-tile flights
export const WORD_MERGE_FLIGHT_MS  = 380;  // duration of each word-tile's flight to the chip
export const BOOST_MERGE_DELAY_MS  = 250;  // gap before the booster chip joins the sum
export const HOLD_AFTER_MERGE_MS   = 420;  // hold the summed chip before launching it
export const SUM_FLIGHT_MS         = 480;  // duration of the summed chip's flight to the score panel
export const COUNTUP_PEAK_MS       = 900;  // peak time for the score count-up animation
export const SUM_CHIP_HOLD_MS      = 500;  // how long the summed chip remains visible after landing
