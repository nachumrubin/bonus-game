// Event type constants. Events are facts — emitted by the gameEngine after
// state transitions. Subscribed to by UI, sessions (which sync to Firebase),
// notifications, animation controller.

/**
 * Event names emitted by the spine engine/session layer.
 * @readonly
 * @enum {string}
 */
export const EV = Object.freeze({
  GAME_STARTED:           'evt/GAME_STARTED',
  MOVE_CONFIRMED:         'evt/MOVE_CONFIRMED',
  MOVE_SCORE_COMMITTED:   'evt/MOVE_SCORE_COMMITTED',
  TURN_CHANGED:           'evt/TURN_CHANGED',
  SCORE_CHANGED:          'evt/SCORE_CHANGED',
  BOOST_ACTIVATED:        'evt/BOOST_ACTIVATED',
  // Turn-flow effects that change WHOSE turn is next (extra_turn repeating a
  // turn, skip_opponent_turn eating one). Emitted separately from
  // BOOST_ACTIVATED so the "you lost your turn" notice can fire on the
  // VICTIM's client — including online, where the effect resolves entirely on
  // the mover's device and the victim only ever sees a resynced snapshot.
  TURN_EFFECTS_APPLIED:   'evt/TURN_EFFECTS_APPLIED',
  BONUS_PENDING:          'bonus/pending',
  BONUS_VETOED:           'evt/BONUS_VETOED',
  OPPONENT_MOVED:         'evt/OPPONENT_MOVED',
  GAME_COMPLETED:         'evt/GAME_COMPLETED',
  INVALID_MOVE_REJECTED:  'evt/INVALID_MOVE_REJECTED',
  TILES_EXCHANGED:        'evt/TILES_EXCHANGED',
  LOCK_PLACED:            'evt/LOCK_PLACED',
  LOCKS_CHANGED:          'evt/LOCKS_CHANGED',
  LIVE_PREVIEW_CHANGED:   'evt/LIVE_PREVIEW_CHANGED',
  LIVE_BONUS_CHANGED:     'evt/LIVE_BONUS_CHANGED',
  ROOM_SETTINGS_CHANGED:  'evt/ROOM_SETTINGS_CHANGED',
  REACTION_RECEIVED:      'evt/REACTION_RECEIVED',
});
