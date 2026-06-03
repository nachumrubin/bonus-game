// replayBot.mjs
//
// Walks a recorded moveHistory and re-emits each entry as a CMD.* the engine
// will accept. If the engine refuses a step (INVALID_MOVE_REJECTED), the
// caller treats it as a replay-divergence crash — useful for catching engine
// changes that break stored game histories.
//
// Replay JSON format (array of games):
//   [
//     {
//       gameId: 'optional',
//       tileBagSeed: 'string',
//       mode: 'friend-live' | ...,
//       settings: {...},
//       players: { 0: {uid,...}, 1: {uid,...} },
//       moveHistory: [ ...moveHistory entries as stored in /rooms/{id}/moveHistory ],
//     },
//     ...
//   ]
//
// A moveHistory entry looks like:
//   { slot, type?: 'pass'|'exchange'|'free-exchange'|'lock'|undefined, tiles?, count?, lock?, ... }
// (undefined type = regular placement)

import { CMD } from '../../../src/events/commands.js';

export function createReplayBot(moveHistory) {
  let cursor = 0;

  function pickCommand(state, mySlot) {
    if (state.status !== 'playing') return null;
    if (cursor >= moveHistory.length) return null;
    const next = moveHistory[cursor];
    if (!next) return null;
    if (next.slot !== mySlot) return null; // not our turn in the replay
    if (state.currentTurnSlot !== mySlot) return null; // engine disagrees — runner will handle

    cursor++;
    return translate(next);
  }

  function remaining() { return moveHistory.length - cursor; }
  function exhausted() { return cursor >= moveHistory.length; }
  // Index of the move that pickCommand JUST returned (cursor-1 after the
  // increment). Used by the runner to look up the prod move's expected score
  // when computing FINALIZE_BOOST_AWARD's `extra` for bonus-deferred moves.
  function lastReturnedIndex() { return cursor - 1; }
  return { pickCommand, remaining, exhausted, lastReturnedIndex };
}

function translate(entry) {
  const type = entry.type;
  if (type === 'pass') {
    return { type: CMD.PASS_TURN, payload: { reason: entry.passReason ?? 'pass' } };
  }
  if (type === 'exchange' || type === 'free-exchange') {
    // Production moveHistory only records `count` for exchanges, not the
    // specific letters. Without those we can't faithfully reproduce the
    // bag-shuffle / rack swap that the original exchange triggered.
    // Best-effort: if `letters` is recorded (older format / unit tests),
    // replay it as an exchange; otherwise convert to a PASS_TURN, which is
    // semantically equivalent for the game-over rule (both are scoreless
    // turns that advance the turn) but doesn't perturb bag state — which
    // means later placements have a better chance of finding their letters
    // still in the rack. The replay is still useful for catching engine
    // regressions on placement / dictionary / scoring; faithful exchange
    // replay would need prod to start storing the letters.
    const letters = Array.isArray(entry.letters) && entry.letters.length > 0
      ? [...entry.letters]
      : null;
    if (!letters) {
      return { type: CMD.PASS_TURN, payload: { reason: 'pass' } };
    }
    return {
      type: CMD.EXCHANGE_TILE,
      payload: { letters, freeSwap: type === 'free-exchange' },
    };
  }
  if (type === 'lock') {
    return {
      type: CMD.PLACE_LOCK,
      payload: { r: entry.lock?.r, c: entry.lock?.c, duration: entry.lock?.remainingTurns },
    };
  }
  // Default: a placement move.
  return {
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: (entry.tiles ?? []).map(t => ({
        r: t.r, c: t.c, letter: t.letter, val: t.val, isJoker: !!t.isJoker,
      })),
      swappedTiles: [],
    },
  };
}
