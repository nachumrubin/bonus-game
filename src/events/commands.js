// Command type constants. Commands are intent — sent by UI / sessions /
// online sync. The gameEngine consumes them and (if accepted) produces
// events.

/**
 * Command names accepted by the spine engine/session layer.
 * @readonly
 * @enum {string}
 */
export const CMD = Object.freeze({
  PLACE_TILES:        'cmd/PLACE_TILES',
  CONFIRM_MOVE:       'cmd/CONFIRM_MOVE',
  PASS_TURN:          'cmd/PASS_TURN',
  EXCHANGE_TILE:      'cmd/EXCHANGE_TILE',
  PLACE_LOCK:         'cmd/PLACE_LOCK',
  QUERY_DICT:         'cmd/QUERY_DICT',
  ACTIVATE_BOOST:     'cmd/ACTIVATE_BOOST',
  FINALIZE_BOOST_AWARD: 'cmd/FINALIZE_BOOST_AWARD',
  RESIGN_GAME:        'cmd/RESIGN_GAME',
});
