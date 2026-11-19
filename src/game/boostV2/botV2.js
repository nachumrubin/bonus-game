// Boost 2.0 — bot decisions (spec §36–38, Phase 6).
//
// Pure: no DOM, no timers, no Firebase. Given the engine state, returns the
// bot's next action for a BOOST_V2 match:
//   { type: 'setup', r, c }                         an opening-setup placement
//   { type: 'move', placed, boostPlacements, ... }  a word (+ replacements)
//   null                                            no move found (caller
//                                                   exchanges or passes)
//
// Word search reuses the existing bot search (sessions/botSearch.js) with an
// `evaluate` hook, so every candidate is scored by the SAME engine functions
// a human move is (word points + completed Boost rewards + full-rack bonus);
// a candidate the V2 rules refuse (e.g. an opener off the centre) is dropped.
//
// Information discipline (spec §36): the bot reads only its own rack, the
// board, the active Boosts and their public definitions, the bag COUNT, and
// — at the moment it places them — the replacement cards it is placing
// (which a human sees at that moment too). It never reads the opponent's
// rack, the bag contents, or queue cards beyond what is placed or previewed.
//
// Difficulty (keeps the legacy profiles' word lengths / breadth / selection):
//   EASY   — ranks by real score only; places replacements at random
//   MEDIUM — score + ½ rack-leave value; defensive placement, light noise
//   HARD   — score + full rack-leave value; defensive placement that also
//            spreads Boosts apart; picks the best move

import { searchBotMove, resolveProfile, DIFFICULTY } from '../sessions/botSearch.js';
import { computeV2Draft } from './draftPreview.js';
import { legalOpeningSquares } from './engineV2.js';
import { PHASE } from './matchStateV2.js';

const VOWELISH = new Set(['א', 'ה', 'ו', 'י']);
export const LEAVE_WEIGHT = Object.freeze({ [DIFFICULTY.EASY]: 0, [DIFFICULTY.MEDIUM]: 0.5, [DIFFICULTY.HARD]: 1 });
// Upper bound on candidates scored per turn (time budget, spec §38).
export const MAX_SCORED_CANDIDATES = 600;

// Value of the tiles the bot keeps (higher = better rack for next turn).
// Simple, explainable heuristic — not a trained model.
export function rackLeaveValue(leave) {
  if (!leave.length) return 0;
  let v = 0;
  const counts = new Map();
  for (const l of leave) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const [l, n] of counts) {
    if (l === '?') v += 3 * n;                // jokers are flexible
    else if (n > 1) v -= 2 * (n - 1);         // duplicates clog the rack
  }
  const vowels = leave.filter(l => VOWELISH.has(l)).length;
  const others = leave.filter(l => l !== '?' && !VOWELISH.has(l)).length;
  if (leave.length >= 3 && vowels === 0) v -= 3;
  if (leave.length >= 3 && others === 0) v -= 3;
  return v;
}

export function leaveAfter(rack, placed) {
  const left = [...rack];
  for (const p of placed) {
    const i = left.indexOf(p.isJoker ? '?' : p.letter);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

// How easily the NEXT player can reach a square: tiles right next to it make
// it a one-tile play; tiles two steps away make it a short-word play.
// `extra` = tiles about to be placed (the post-move board).
export function accessScore(board, sq, extra = []) {
  const extraSet = new Set(extra.map(p => `${p.r},${p.c}`));
  const occupied = (r, c) => !!board[r]?.[c] || extraSet.has(`${r},${c}`);
  let adj = 0, near = 0;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const d = Math.abs(dr) + Math.abs(dc);
      if (d === 0 || d > 2) continue;
      if (!occupied(sq.r + dr, sq.c + dc)) continue;
      if (d === 1) adj++; else near++;
    }
  }
  return adj * 4 + near;
}

/**
 * Choose `count` distinct squares from `legal`.
 * favourMover = true → the bot moves next (prefer accessible squares);
 * false → the opponent moves next (prefer the least accessible squares).
 */
export function chooseBoostSquares(state, legal, count, { difficulty = DIFFICULTY.MEDIUM, rng = Math.random, favourMover = false, avoid = [], placed = [] } = {}) {
  const picks = [];
  const pool = [...legal];
  const taken = [...avoid];
  for (let k = 0; k < count && pool.length; k++) {
    let idx;
    if (difficulty === DIFFICULTY.EASY) {
      idx = Math.floor(rng() * pool.length);
    } else {
      const scored = pool.map((sq, i) => {
        let s = accessScore(state.board, sq, placed);
        if (!favourMover) s = -s;
        if (difficulty === DIFFICULTY.HARD) {
          // Spread Boosts out: two Boosts close together let one word take both.
          const crowd = taken.filter(b => Math.abs(b.r - sq.r) + Math.abs(b.c - sq.c) <= 2).length;
          s += favourMover ? 2 * crowd : -2 * crowd;
        }
        return { i, s: s + rng() * 0.01 };
      }).sort((a, b) => b.s - a.s);
      const top = difficulty === DIFFICULTY.MEDIUM ? Math.min(3, scored.length) : 1;
      idx = scored[Math.floor(rng() * top)].i;
    }
    const [sq] = pool.splice(idx, 1);
    picks.push({ r: sq.r, c: sq.c });
    taken.push(sq);
  }
  return picks;
}

function v2Profile(difficulty) {
  // The legacy profiles steer toward/away from off-grid bonus squares, which
  // do not exist in Boost 2.0 — switch those levers off.
  return { ...resolveProfile(difficulty), includeBonusSquares: false, avoidBonusTiles: false, weighBonusSquares: false };
}

/**
 * The bot's next action in a Boost 2.0 match (or null when it has no move).
 */
export function chooseV2Turn(state, slot, wordList, isWordValid, { difficulty = DIFFICULTY.MEDIUM, rng = Math.random } = {}) {
  const v2 = state.boostV2;
  if (!v2 || state.status !== 'playing' || state.currentTurnSlot !== slot) return null;

  if (v2.phase === PHASE.OPENING_SETUP) {
    const legal = legalOpeningSquares(state);
    if (!legal.length) return null;
    const setup = v2.openingSetup;
    // After the last setup step the `returnSlot` player moves first.
    const favourMover = setup.returnSlot === slot;
    const [sq] = chooseBoostSquares(state, legal, 1, { difficulty, rng, favourMover, avoid: setup.placements });
    return { type: 'setup', r: sq.r, c: sq.c };
  }

  const rack = state.racks[slot] ?? [];
  const leaveW = LEAVE_WEIGHT[difficulty] ?? 0.5;
  let scored = 0;
  const evaluate = (placed) => {
    if (scored >= MAX_SCORED_CANDIDATES) return null;
    scored++;
    const d = computeV2Draft(state, { placed, withPlan: false });
    if (!d.ok) return null;
    const score = d.breakdown.totalScore;
    const leave = leaveW ? rackLeaveValue(leaveAfter(rack, placed)) : 0;
    return { score, rankScore: score + leaveW * leave, breakdown: d.breakdown };
  };
  // Look near active Boosts first (medium / hard): words through those anchors
  // can cover a Boost. Easy keeps the plain random anchor order.
  const boosts = v2.activeBoosts;
  const seek = difficulty !== DIFFICULTY.EASY && boosts.length > 0;
  const anchorPriority = !seek ? undefined
    : (a) => (boosts.some(b => b.r === a.r && b.c === a.c) ? 2
      : boosts.some(b => Math.abs(b.r - a.r) + Math.abs(b.c - a.c) <= 2) ? 1 : 0);
  const extraAnchors = seek ? boosts.map(b => ({ r: b.r, c: b.c })) : [];
  const pick = searchBotMove(state, slot, wordList, isWordValid, {
    difficulty, rng, profile: v2Profile(difficulty), evaluate, anchorPriority, extraAnchors,
  });
  if (!pick) return null;

  const placed = pick.placed.map(p => ({ r: p.r, c: p.c, letter: p.letter, val: p.val, isJoker: !!p.isJoker }));
  const draft = computeV2Draft(state, { placed });
  if (!draft.ok) return null;
  let boostPlacements = [];
  if (draft.required > 0) {
    const remaining = v2.activeBoosts.filter(b => !draft.consumed.includes(b.instanceId));
    const squares = chooseBoostSquares(state, draft.legal, draft.required, { difficulty, rng, favourMover: false, avoid: remaining, placed });
    boostPlacements = squares.map((sq, i) => ({ ...sq, instanceId: draft.replacements[i].instanceId }));
  }
  return { type: 'move', placed, boostPlacements, score: draft.breakdown.totalScore, breakdown: draft.breakdown };
}
