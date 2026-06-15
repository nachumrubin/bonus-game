// Definitions for the 12 bonus-square tile types that exist on the board.
//
// Landing on a bonus square triggers a reaction. There are four categories:
//
//   'auto'      — score is added immediately, no mini-game (B2, B4, B9)
//   'minigame'  — UI plays a mini-game; the reward depends on the outcome
//                 (B1, B3, B8, B10, B11, B12)
//   'future'    — queues a persistent effect on activeBoosts that fires on a
//                 later turn (B5 extraTurn, B6 quadruple, B7 double2)
//   'wheel'     — UI spins a wheel and dispatches one of several future
//                 effects or auto rewards (B13)
//
// `miniGameKey` is the symbolic name the UI controller binds to. The pure
// engine never touches the DOM; it just reads this string off the def and
// emits a BONUS_PENDING event so UI can render the right mini-game.
//
// `tilePts` mirrors the legacy `pts` field in BONUS_TYPES — primarily for
// display ("⚡ +100 נקודות"). The actual award comes from autoExtra (auto
// category) or the mini-game payload (minigame category).

export const BONUS_TILE_DEFS = {
  B1: {
    type: 'B1', tilePts: 100, category: 'minigame',
    miniGameKey: 'b1_unscramble_or_fillmiddle',
    autoExtra: 0,
  },
  B2: {
    type: 'B2', tilePts: 40, category: 'auto',
    autoExtra: 20, // legacy bonusPend.extra=20 (despite tilePts:40)
  },
  B3: {
    type: 'B3', tilePts: 40, category: 'minigame',
    miniGameKey: 'b3_unscramble_medium',
    autoExtra: 0,
  },
  B4: {
    type: 'B4', tilePts: 1, category: 'auto',
    autoExtra: 1,
  },
  B5: {
    type: 'B5', tilePts: 0, category: 'future',
    futureEffectId: 'extra_turn',
    futurePayload: () => ({}),
    autoExtra: 0,
  },
  B6: {
    type: 'B6', tilePts: 0, category: 'future',
    futureEffectId: 'multiply_next_turns',
    futurePayload: () => ({ multiplier: 4, turnsRemaining: 1 }),
    autoExtra: 0,
  },
  B7: {
    type: 'B7', tilePts: 0, category: 'future',
    futureEffectId: 'multiply_next_turns',
    futurePayload: () => ({ multiplier: 2, turnsRemaining: 2 }),
    autoExtra: 0,
  },
  B8: {
    type: 'B8', tilePts: 0, category: 'minigame',
    miniGameKey: 'b8_crossword_60s',
    autoExtra: 0,
  },
  B9: {
    type: 'B9', tilePts: 25, category: 'auto',
    autoExtra: 25,
  },
  B10: {
    type: 'B10', tilePts: 40, category: 'minigame',
    miniGameKey: 'b10_crossing_words',
    autoExtra: 0,
  },
  B11: {
    type: 'B11', tilePts: 30, category: 'minigame',
    miniGameKey: 'b11_hidden_word',
    autoExtra: 0,
  },
  B12: {
    type: 'B12', tilePts: 50, category: 'minigame',
    miniGameKey: 'b12_honeycomb',
    autoExtra: 0,
  },
  B13: {
    type: 'B13', tilePts: 0, category: 'wheel',
    miniGameKey: 'b13_wheel_of_fortune',
    autoExtra: 0,
  },
  B14: {
    type: 'B14', tilePts: 50, category: 'minigame',
    miniGameKey: 'b14_letter_spinner',
    autoExtra: 0,
  },
};

// Wheel-of-fortune outcomes that B13 can roll into. The UI spins the wheel
// locally and dispatches a single ACTIVATE_BOOST with one of these as the
// boostId/payload.
export const WHEEL_OUTCOMES = [
  { id: 'pts_50',          kind: 'auto',   extra: 50, label: '+50 נקודות' },
  { id: 'pts_1',           kind: 'auto',   extra: 1,  label: '+1 נקודה' },
  { id: 'extra_turn',      kind: 'future', futureEffectId: 'extra_turn',          payload: () => ({}) },
  { id: 'double_2',        kind: 'future', futureEffectId: 'multiply_next_turns', payload: () => ({ multiplier: 2, turnsRemaining: 2 }) },
  { id: 'timer_bonus',     kind: 'future', futureEffectId: 'timer_bonus',         payload: () => ({ seconds: 10 }) },
  { id: 'skip_turn',       kind: 'future', futureEffectId: 'skip_opponent_turn',  payload: () => ({}) },
  { id: 'tile_swap',       kind: 'future', futureEffectId: 'free_tile_swap',      payload: () => ({}) },
  { id: 'cancel_boost',    kind: 'future', futureEffectId: 'cancel_next_opponent_bonus', payload: () => ({}) },
];
