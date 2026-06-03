// fuzzBot.mjs
//
// Adversarial bot. Most of the time, plays a legal random move (so games
// actually progress and we get coverage of normal paths). Some of the time,
// produces an intentionally malformed / out-of-turn / nonsense command to
// stress the engine's defensive code, the session's turn guards, and the
// Firebase rules.
//
// The simulator's runner already wraps session.dispatch() in try/catch and
// runs invariants after each tick, so any throw / corruption / rule rejection
// surfaces as a crash report. We aren't asserting anything here — we're just
// generating inputs.

import { pickCommand as randomPick } from './randomBot.mjs';
import { CMD } from '../../../src/events/commands.js';
import { BOARD_SIZE } from '../../../src/game/core/board.js';

const DEFAULT_FUZZ_RATE = 0.3;

/**
 * Build a fuzz bot. `fuzzRate` is the probability that any given turn yields
 * an adversarial command instead of a random-legal one (0..1).
 */
export function createFuzzBot({ fuzzRate = DEFAULT_FUZZ_RATE } = {}) {
  return {
    pickCommand(state, mySlot, rng) {
      if (state.status !== 'playing') return null;
      // The random bot already short-circuits to null when it's not our turn.
      // For adversarial behavior we sometimes WANT to send commands then.
      const shouldFuzz = rng() < fuzzRate;
      if (!shouldFuzz) {
        // Only return a legitimate command if it's actually our turn — the
        // randomBot enforces that. If not our turn, fall through to fuzz so
        // the runner has something to dispatch and we still cover the
        // defensive-rejection paths.
        if (state.currentTurnSlot === mySlot) {
          return randomPick(state, mySlot, rng);
        }
      }
      return pickAdversarialCommand(state, mySlot, rng);
    },
  };
}

const ADVERSARIAL_KINDS = [
  'out-of-turn-pass',
  'out-of-turn-confirm',
  'malformed-confirm-empty',
  'malformed-confirm-off-grid',
  'malformed-confirm-non-collinear',
  'malformed-confirm-bad-tile',
  'exchange-not-in-rack',
  'exchange-too-many',
  'lock-off-grid',
  'lock-bad-duration',
  'lock-occupied-cell',
  'free-swap-no-boost',
  'finalize-without-pending',
  'claim-stall-when-not-leading',
];

function pickAdversarialCommand(state, mySlot, rng) {
  const kind = ADVERSARIAL_KINDS[Math.floor(rng() * ADVERSARIAL_KINDS.length)];
  switch (kind) {
    case 'out-of-turn-pass':
      return { type: CMD.PASS_TURN, payload: { reason: 'pass' } };
    case 'out-of-turn-confirm':
      // Single tile in the middle — should be rejected for not-our-turn OR
      // not-connected depending on state.
      return {
        type: CMD.CONFIRM_MOVE,
        payload: { placed: [{ r: 4, c: 4, letter: 'א', val: 1, isJoker: false }] },
      };
    case 'malformed-confirm-empty':
      return { type: CMD.CONFIRM_MOVE, payload: { placed: [] } };
    case 'malformed-confirm-off-grid':
      return {
        type: CMD.CONFIRM_MOVE,
        payload: {
          placed: [{ r: 99, c: -1, letter: 'ב', val: 3, isJoker: false }],
        },
      };
    case 'malformed-confirm-non-collinear':
      return {
        type: CMD.CONFIRM_MOVE,
        payload: {
          placed: [
            { r: 2, c: 3, letter: 'א', val: 1, isJoker: false },
            { r: 4, c: 5, letter: 'ב', val: 3, isJoker: false },
          ],
        },
      };
    case 'malformed-confirm-bad-tile':
      return {
        type: CMD.CONFIRM_MOVE,
        payload: {
          placed: [{ r: 5, c: 5, letter: '🚀', val: 0, isJoker: false }],
        },
      };
    case 'exchange-not-in-rack':
      return { type: CMD.EXCHANGE_TILE, payload: { letters: ['🚀'] } };
    case 'exchange-too-many':
      // Try to exchange more tiles than the bag has — engine guards on this.
      return {
        type: CMD.EXCHANGE_TILE,
        payload: { letters: new Array((state.bag?.length ?? 0) + 5).fill('א') },
      };
    case 'lock-off-grid':
      return { type: CMD.PLACE_LOCK, payload: { r: 99, c: 99, duration: 3 } };
    case 'lock-bad-duration':
      return { type: CMD.PLACE_LOCK, payload: { r: 5, c: 5, duration: 0 } };
    case 'lock-occupied-cell': {
      // Find any committed cell and try to lock it.
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (state.board?.[r]?.[c]) {
            return { type: CMD.PLACE_LOCK, payload: { r, c, duration: 3 } };
          }
        }
      }
      // No committed tile yet; pick a fresh empty cell with bad duration.
      return { type: CMD.PLACE_LOCK, payload: { r: 5, c: 5, duration: -1 } };
    }
    case 'free-swap-no-boost':
      // Engine guards on `free_tile_swap` boost being active.
      return {
        type: CMD.EXCHANGE_TILE,
        payload: { letters: [state.racks?.[mySlot]?.[0] ?? 'א'], freeSwap: true },
      };
    case 'finalize-without-pending':
      return {
        type: CMD.FINALIZE_BOOST_AWARD,
        payload: { slot: mySlot, extra: 999, bonusIdx: null },
      };
    case 'claim-stall-when-not-leading':
      return { type: CMD.CLAIM_STALL_END, payload: { slot: mySlot } };
    default:
      return { type: CMD.PASS_TURN, payload: { reason: 'pass' } };
  }
}
