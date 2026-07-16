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
export const MULT_MERGE_DELAY_MS   = 300;  // gap before the ×N multiplier chip flies in from its banner
export const BOOST_MERGE_DELAY_MS  = 250;  // gap before the booster chip joins the sum
export const HOLD_AFTER_MERGE_MS   = 420;  // hold the summed chip before launching it
export const SUM_FLIGHT_MS         = 480;  // duration of the summed chip's flight to the score panel
export const COUNTUP_PEAK_MS       = 900;  // peak time for the score count-up animation
export const SUM_CHIP_HOLD_MS      = 500;  // how long the summed chip remains visible after landing

// Single source of truth for the score-merge sequence timeline. The chips fly
// in sequentially: word chips (staggered) → the ×N multiplier chip (if the turn
// had a score multiplier) → the bonus-extra chip (if a bonus square awarded
// extra) → the summed chip then holds and flies to the score panel.
//
// Returns the start offset (ms from sequence start) of each optional phase plus
// `mergeEnd` (when the last chip lands) and `totalToPanelLanding` (when the sum
// chip reaches the score box). Used by playScoreMergeSequence to schedule the
// chips AND by the count-up / glow timing so they stay aligned.
export function mergeSequenceTiming({ wordCount = 0, bonusExtra = 0, multiplier = 1 } = {}) {
  const lastWordStart = wordCount > 0 ? (wordCount - 1) * WORD_MERGE_STAGGER_MS : 0;
  const hasMult  = Number(multiplier) > 1;
  const hasExtra = Number(bonusExtra) > 0;
  let cursor = lastWordStart;
  let multStart = null;
  let boostStart = null;
  if (hasMult)  { multStart  = cursor + MULT_MERGE_DELAY_MS;  cursor = multStart; }
  if (hasExtra) { boostStart = cursor + BOOST_MERGE_DELAY_MS; cursor = boostStart; }
  const mergeEnd = cursor + WORD_MERGE_FLIGHT_MS;
  const totalToPanelLanding = mergeEnd + HOLD_AFTER_MERGE_MS + SUM_FLIGHT_MS;
  return { lastWordStart, multStart, boostStart, mergeEnd, totalToPanelLanding };
}
