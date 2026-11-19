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
// Difficulty:
//   EASY   — words ≤ 4 letters, ranks by real score only, random placement
//   MEDIUM — words ≤ 7; score + ½ × (rack leave + queue plan + Boost threat);
//            Boost-targeted search; defensive placement with light noise
//   HARD   — words ≤ 8; the same terms at full weight; defensive placement
//            that also spreads Boosts apart; always the best-ranked move
//
// Strategy terms added to a candidate's real score (rankScore only — never
// the awarded score):
//   leave   — value of the tiles kept (rackLeaveValue)
//   plan    — keeping a letter that an active or VISIBLE upcoming Letter Hunt
//             / Word Edge card needs (queuePlanValue)
//   threat  — the expected points the opponent can take next turn from the
//             Boosts left on the board after the move, plus the cards the
//             move makes the bot place (the opponent plays first on those).
//             Covering a threatening Boost — even without completing it —
//             removes its threat: that is how the bot denies a Boost.

import {
  searchBotMove, resolveProfile, pickMove, tryPlaceWord, canFormWithBoard, DIFFICULTY,
} from '../sessions/botSearch.js';
import { getAllWords } from '../core/scoringEngine.js';
import { FAMILY } from './challengeCatalog.js';
import { preview } from './challengeQueue.js';
import { computeV2Draft } from './draftPreview.js';
import { legalOpeningSquares } from './engineV2.js';
import { PHASE } from './matchStateV2.js';

const VOWELISH = new Set(['א', 'ה', 'ו', 'י']);
export const LEAVE_WEIGHT = Object.freeze({ [DIFFICULTY.EASY]: 0, [DIFFICULTY.MEDIUM]: 0.5, [DIFFICULTY.HARD]: 1 });
// Weight of the plan + threat terms per difficulty.
export const STRATEGY_WEIGHT = Object.freeze({ [DIFFICULTY.EASY]: 0, [DIFFICULTY.MEDIUM]: 0.5, [DIFFICULTY.HARD]: 1 });
// Boost 2.0 search profile overrides. Longer words than the legacy bot so the
// 7–8-letter challenges are reachable; medium's soft score ceiling is lifted
// because Boost rewards push good moves past the legacy 25.
export const V2_PROFILE_OVERRIDES = Object.freeze({
  [DIFFICULTY.EASY]:   Object.freeze({ maxWordLen: 4 }),
  [DIFFICULTY.MEDIUM]: Object.freeze({ maxWordLen: 7, tries: 90, scoreCeiling: 45 }),
  [DIFFICULTY.HARD]:   Object.freeze({ maxWordLen: 8, tries: 160 }),
});
export function v2MaxWordLen(difficulty) {
  return (V2_PROFILE_OVERRIDES[difficulty] ?? V2_PROFILE_OVERRIDES[DIFFICULTY.MEDIUM]).maxWordLen;
}
// Chance the opponent completes a reachable Boost on their next turn, by the
// Boost's difficulty (a judgement call, tuned in Phase 8 simulations).
export const OPPONENT_COMPLETE_P = Object.freeze({ EASY: 0.5, MEDIUM: 0.3, HARD: 0.15 });
// Average reward of a card the bot cannot see yet (deck 0.3: 40 E / 35 M / 20 H).
export const UNSEEN_CARD_REWARD = Math.round((40 * 5 + 35 * 10 + 20 * 20) / 95);
// Boost-targeted search budget (tryPlaceWord calls per Boost line).
export const TARGETED_ATTEMPTS_PER_LINE = 400;
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
  return {
    ...resolveProfile(difficulty),
    includeBonusSquares: false, avoidBonusTiles: false, weighBonusSquares: false,
    ...(V2_PROFILE_OVERRIDES[difficulty] ?? {}),
  };
}

// Expected points the opponent takes from `boost` next turn, given the board
// (+ `placed` tiles) after the bot's move.
export function boostThreat(state, def, sq, placed = []) {
  if (!def) return 0;
  const access = accessScore(state.board, sq, placed);
  return def.reward * (OPPONENT_COMPLETE_P[def.difficulty] ?? 0.3) * Math.min(1, access / 6);
}

// Letters the bot should keep: targets of active and visible upcoming Letter
// Hunt / Word Edge cards (only public information).
export function plannedLetters(state) {
  const v2 = state.boostV2;
  const defs = [
    ...v2.activeBoosts.map(b => v2.definitions[b.effectiveDefinitionId]),
    ...preview(v2.queue, v2.rules.queuePreviewSize).map(e => v2.definitions[e.definitionId]),
  ];
  return defs
    .filter(d => d && (d.family === FAMILY.LETTER_HUNT || d.family === FAMILY.WORD_EDGE))
    .map(d => ({ letter: d.parameters.targetLetter, reward: d.reward }));
}

export function queuePlanValue(leave, planned) {
  const pool = [...leave];
  let v = 0;
  for (const { letter, reward } of planned) {
    const i = pool.indexOf(letter) >= 0 ? pool.indexOf(letter) : pool.indexOf('?');
    if (i < 0) continue;
    pool.splice(i, 1);
    v += reward * 0.25;
  }
  return v;
}

// The strategy terms (plan + threat) for a scored candidate.
function strategyValue(state, placed, breakdown, leave, planned) {
  const v2 = state.boostV2;
  const consumed = new Set(breakdown.consumedBoostIds);
  let threat = 0;
  for (const b of v2.activeBoosts) {
    if (consumed.has(b.instanceId)) continue;
    threat += boostThreat(state, v2.definitions[b.effectiveDefinitionId], b, placed);
  }
  // Cards the bot will place now: the opponent plays first on them. Placed
  // defensively, so only a fraction of a fully reachable threat. Uses the
  // real card only when it is visible in the preview.
  const k = Math.max(0, v2.rules.activeBoostTarget - (v2.activeBoosts.length - consumed.size));
  const visible = preview(v2.queue, v2.rules.queuePreviewSize);
  for (let i = 0; i < k; i++) {
    const def = visible[i] ? v2.definitions[visible[i].definitionId] : null;
    const reward = def?.reward ?? UNSEEN_CARD_REWARD;
    threat += reward * (OPPONENT_COMPLETE_P[def?.difficulty] ?? 0.3) * 0.25;
  }
  return queuePlanValue(leave, planned) - threat;
}

/**
 * Score one candidate the way the bot ranks it: the real V2 score plus the
 * difficulty's strategy terms. Returns null when the V2 rules refuse it.
 */
export function scoreV2Candidate(state, slot, placed, difficulty = DIFFICULTY.MEDIUM, planned = null) {
  const v2 = state.boostV2;
  const d = computeV2Draft(state, { placed, withPlan: false });
  if (!d.ok) return null;
  const score = d.breakdown.totalScore;
  const leave = leaveAfter(state.racks[slot] ?? [], placed);
  const leaveW = LEAVE_WEIGHT[difficulty] ?? 0.5;
  const stratW = STRATEGY_WEIGHT[difficulty] ?? 0.5;
  let rankScore = score;
  if (leaveW) rankScore += leaveW * rackLeaveValue(leave);
  if (stratW && v2.phase === PHASE.NORMAL) {
    rankScore += stratW * strategyValue(state, placed, d.breakdown, leave, planned ?? plannedLetters(state));
  }
  return { placed, score, rankScore, breakdown: d.breakdown };
}

/**
 * Words laid THROUGH each active Boost square, using board letters on that
 * line (the main search only spells words from the rack). This is what lets
 * the bot reach Long Word 8+ / Exact Target 8 by extending existing words.
 */
export function boostTargetedCandidates(state, slot, wordList, isWordValid, { maxLen, minLen = 3, attemptsPerLine = TARGETED_ATTEMPTS_PER_LINE } = {}) {
  const v2 = state.boostV2;
  const rack = state.racks[slot] ?? [];
  const out = [];
  const seen = new Set();
  for (const b of v2.activeBoosts) {
    for (const dir of ['H', 'V']) {
      const lineLetters = new Set();
      for (let i = 0; i < 10; i++) {
        const t = dir === 'H' ? state.board[b.r][i] : state.board[i][b.c];
        if (t) lineLetters.add(t.letter);
      }
      if (!lineLetters.size) continue; // nothing to build through on this line
      let attempts = 0;
      for (const w of wordList) {
        if (attempts >= attemptsPerLine) break;
        if (w.length < minLen || w.length > maxLen) continue;
        if (!canFormWithBoard(w, rack, lineLetters)) continue;
        for (let off = 0; off < w.length && attempts < attemptsPerLine; off++) {
          attempts++;
          const sr = dir === 'H' ? b.r : b.r - off;
          const sc = dir === 'H' ? b.c - off : b.c;
          const placed = tryPlaceWord(state, w, sr, sc, dir, slot);
          if (!placed || !placed.some(p => p.r === b.r && p.c === b.c)) continue;
          if (placed.length === w.length) continue; // no board letter used — the main search covers it
          const key = placed.map(p => `${p.r},${p.c},${p.letter}`).join('|');
          if (seen.has(key)) continue;
          const words = getAllWords(state, placed);
          if (!words.length || words.some(ww => !isWordValid(ww.map(t => t.letter).join('')))) continue;
          seen.add(key);
          out.push({ placed, word: w });
        }
      }
    }
  }
  return out;
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

  const profile = v2Profile(difficulty);
  const planned = (STRATEGY_WEIGHT[difficulty] ?? 0) && v2.phase === PHASE.NORMAL ? plannedLetters(state) : [];
  const pool = [];
  let scored = 0;
  const evaluate = (placed) => {
    if (scored >= MAX_SCORED_CANDIDATES) return null;
    scored++;
    const cand = scoreV2Candidate(state, slot, placed, difficulty, planned);
    if (cand) pool.push(cand);
    return cand;
  };

  // Look near active Boosts first (medium / hard): words through those anchors
  // can cover a Boost. Easy keeps the plain random anchor order.
  const boosts = v2.activeBoosts;
  const seek = difficulty !== DIFFICULTY.EASY && boosts.length > 0;
  const anchorPriority = !seek ? undefined
    : (a) => (boosts.some(b => b.r === a.r && b.c === a.c) ? 2
      : boosts.some(b => Math.abs(b.r - a.r) + Math.abs(b.c - a.c) <= 2) ? 1 : 0);
  const extraAnchors = seek ? boosts.map(b => ({ r: b.r, c: b.c })) : [];
  if (seek && !state.firstMove) {
    for (const c of boostTargetedCandidates(state, slot, wordList, isWordValid, { maxLen: profile.maxWordLen })) {
      evaluate(c.placed.map(p => ({ r: p.r, c: p.c, letter: p.letter, val: p.val, isJoker: !!p.isJoker })));
    }
  }
  const searched = searchBotMove(state, slot, wordList, isWordValid, {
    difficulty, rng, profile, evaluate, anchorPriority, extraAnchors,
  });
  // Easy keeps the legacy single pick; medium / hard choose from everything scored.
  const pick = difficulty === DIFFICULTY.EASY ? searched : (pool.length ? pickMove(pool, profile, rng) : searched);
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
  return { type: 'move', placed, boostPlacements, score: draft.breakdown.totalScore, rankScore: pick.rankScore ?? pick.score, breakdown: draft.breakdown };
}
