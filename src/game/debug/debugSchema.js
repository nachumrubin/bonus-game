// Game Debug Timeline — schema constants.
//
// Single source of truth for the debug system's Firebase paths and the
// enumerations of event types, warning types, and severities. Everything else
// in src/game/debug/ imports from here so adding a new event/warning type is a
// one-line change (and never a scattered string literal).
//
// All debug data lives in SEPARATE top-level nodes from /rooms so the normal
// game object stays clean. Admin-only reads are enforced by the Firebase rules
// (see firebase.database.rules.json); this module is pure constants.

// Top-level Firebase paths (gameId === roomId).
export const DEBUG_PATH = Object.freeze({
  gameEvents:     'gameEvents',      // /gameEvents/{gameId}/{pushId}
  gameSnapshots:  'gameSnapshots',   // /gameSnapshots/{gameId}/{version}    (server truth)
  clientSnapshots:'clientSnapshots', // /clientSnapshots/{gameId}/{slot}/{pushId}
  debugWarnings:  'debugWarnings',   // /debugWarnings/{gameId}/{pushId}
  debugReports:   'debugReports',    // /debugReports/{pushId}
  debugGameIndex: 'debugGameIndex',  // /debugGameIndex/{gameId}             (searchable summary)
});

// Event types recorded on the timeline. Add a new one here, then emit it from
// debugRecorder — nothing else needs to change.
export const DEBUG_EVENT = Object.freeze({
  GAME_CREATED:         'GAME_CREATED',
  PLAYER_INVITED:       'PLAYER_INVITED',
  PLAYER_JOINED:        'PLAYER_JOINED',
  GAME_STARTED:         'GAME_STARTED',
  WORD_SUBMITTED:       'WORD_SUBMITTED',
  WORD_ACCEPTED:        'WORD_ACCEPTED',
  WORD_REJECTED:        'WORD_REJECTED',
  TURN_CHANGED:         'TURN_CHANGED',
  SCORE_CHANGED:        'SCORE_CHANGED',
  TILES_DRAWN:          'TILES_DRAWN',
  TILES_SWAPPED:        'TILES_SWAPPED',
  LOCK_PLACED:          'LOCK_PLACED',
  BOOST_ACTIVATED:      'BOOST_ACTIVATED',
  MINIGAME_STARTED:     'MINIGAME_STARTED',   // player landed on a mini-game / wheel bonus square
  MINIGAME_RESOLVED:    'MINIGAME_RESOLVED',  // mini-game / wheel finished — carries puzzle + outcome
  PLAYER_RESIGNED:      'PLAYER_RESIGNED',
  GAME_PAUSED:          'GAME_PAUSED',
  GAME_RESUMED:         'GAME_RESUMED',
  GAME_ENDED:           'GAME_ENDED',
  BOT_MOVE_STARTED:     'BOT_MOVE_STARTED',
  BOT_MOVE_COMPLETED:   'BOT_MOVE_COMPLETED',
  ERROR_OCCURRED:       'ERROR_OCCURRED',
  CLIENT_STATE_MISMATCH:'CLIENT_STATE_MISMATCH',
});

// Mini-game / wheel result bus events → the default boost/mini-game key they
// belong to. These are the `*_INTENT.RESULT` strings emitted by each mini-game
// in src/ui/screens/miniGames/*. The debug recorder subscribes to every one of
// them to capture the puzzle detail (e.g. B10's two crossing words) and the
// win/lose outcome that plain engine events (BOOST_ACTIVATED) don't carry.
//
// KEEP IN SYNC: if a mini-game renames its RESULT intent, update it here too.
// The recorder prefers the live `miniGameKey` from the BONUS_PENDING event; the
// value below is only a fallback label when no pending was captured.
export const MINIGAME_RESULT_EVENTS = Object.freeze({
  'crossingWords/result': 'b10_crossing_words',
  'crossword/result':     'b8_crossword_60s',
  'fillMiddle/result':    'b1_unscramble_or_fillmiddle',
  'hiddenWord/result':    'b11_hidden_word',
  'honeycomb/result':     'b12_honeycomb',
  'letterSpinner/result': 'b14_letter_spinner',
  'unscramble/result':    'b3_unscramble_medium',
  'wheel/result':         'b13_wheel_of_fortune',
});

// Warning types raised by gameStateValidator.
export const WARNING_TYPE = Object.freeze({
  SAME_PLAYER_TWICE:        'SAME_PLAYER_TWICE',
  TURN_NUMBER_SKIPPED:      'TURN_NUMBER_SKIPPED',
  TURN_DID_NOT_ADVANCE:     'TURN_DID_NOT_ADVANCE',
  SCORE_MISMATCH:           'SCORE_MISMATCH',
  NEGATIVE_SCORE:           'NEGATIVE_SCORE',
  CHANGED_AFTER_ENDED:      'CHANGED_AFTER_ENDED',
  CURRENT_TURN_USER_MISSING:'CURRENT_TURN_USER_MISSING',
  PLAYER_HAS_NO_TILES:      'PLAYER_HAS_NO_TILES',
  TILE_COUNT_MISMATCH:      'TILE_COUNT_MISMATCH',
  BOARD_CHANGED_NO_MOVE:    'BOARD_CHANGED_NO_MOVE',
  CLIENT_STATE_MISMATCH:    'CLIENT_STATE_MISMATCH',
  APP_VERSION_OLD:          'APP_VERSION_OLD',
  RULES_VERSION_MISMATCH:   'RULES_VERSION_MISMATCH',
  DICT_VERSION_MISMATCH:    'DICT_VERSION_MISMATCH',
});

export const SEVERITY = Object.freeze({
  LOW:    'low',
  MEDIUM: 'medium',
  HIGH:   'high',
});
