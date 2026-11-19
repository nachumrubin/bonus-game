// Boost 2.0 — live preview of an unsubmitted draft (Phase 5 UI).
//
// Given the current state and the tiles the player has laid down (plus any
// pending tile swaps and replacement-Boost choices), answers the questions
// the game screen asks on every render:
//   - is the draft geometrically a move at all? (validateMove + words)
//   - what would it score? (the same evaluator + breakdown the engine uses)
//   - which Boosts does it use, and how many replacements must be placed,
//     on which squares, in which FIFO order?
//   - are the replacement choices so far still legal, and complete?
// Dictionary validity is NOT decided here — the play button already shows
// invalid words, and the engine decides on submit.
// Pure — no DOM, no timers. Uses the same modules as engineV2, so the
// preview can never disagree with the commit.

import { validateMove } from '../core/moveValidator.js';
import { getAllWords } from '../core/scoringEngine.js';
import { isOnGrid } from '../core/board.js';
import { evaluateMoveBoosts } from './challengeEvaluator.js';
import { buildScoreBreakdown } from './scoringV2.js';
import { planForMove, coversCenter, sanitizeTiles } from './engineV2.js';
import { PHASE } from './matchStateV2.js';

const key = (r, c) => `${r},${c}`;

/**
 * @returns {{
 *   ok: boolean,                  // a geometrically valid draft with words
 *   breakdown: object|null,
 *   consumed: string[],           // instance ids the draft covers
 *   required: number,             // replacement placements the move needs
 *   replacements: Array<{instanceId, definitionId, definition}>,  // FIFO, length = required
 *   legal: Array<{r,c}>,          // legal replacement squares
 *   choices: Array<{r,c,instanceId}>, // still-valid choices, FIFO, ≤ required
 *   complete: boolean,            // choices.length === required
 *   endsMatch: boolean,
 * }}
 */
// `withPlan: false` skips the replacement plan (score only) — used by the bot
// to rank hundreds of candidate words cheaply.
export function computeV2Draft(state, { placed = [], swappedTiles = [], boostPlacements = [], withPlan = true } = {}) {
  const empty = { ok: false, breakdown: null, consumed: [], required: 0, replacements: [], legal: [], choices: [], complete: true, endsMatch: false };
  const v2 = state?.boostV2;
  if (!v2 || v2.phase === PHASE.OPENING_SETUP) return empty;
  const p = sanitizeTiles(placed);
  const sw = sanitizeTiles(swappedTiles);
  if (!p || !sw || p.length === 0) return empty;
  const all = [...p, ...sw];
  if (all.some(t => !isOnGrid(t.r, t.c))) return empty;
  if (!validateMove(state, all).ok) return empty;
  if (state.firstMove && !coversCenter(p, v2.rules)) return empty;
  const words = getAllWords(state, all);
  if (!words.length || words[0].length < v2.rules.minimumWordLength) return empty;

  const active = v2.phase === PHASE.NORMAL ? v2.activeBoosts : [];
  const boostResults = evaluateMoveBoosts({ activeBoosts: active, definitions: v2.definitions, words, placed: all });
  const breakdown = buildScoreBreakdown({ words, placedCount: all.length, boostResults, rules: v2.rules });
  const consumed = breakdown.consumedBoostIds;

  // Rack after the move: placed tiles leave, swaps exchange one for one.
  const rackLeft = (state.racks?.[state.currentTurnSlot]?.length ?? 0) - p.length;
  const endsMatch = (state.bag?.length ?? 0) === 0 && rackLeft === 0;
  if (endsMatch) return { ...empty, ok: true, breakdown, consumed, endsMatch };
  if (!withPlan) return { ...empty, ok: true, breakdown, consumed, complete: false, required: null };

  const { legal, plan } = planForMove(state, p, consumed);
  const replacements = plan.effective.map(e => ({
    instanceId: e.instanceId, definitionId: e.effectiveDefinitionId, definition: v2.definitions[e.effectiveDefinitionId],
  }));
  const legalSet = new Set(legal.map(s => key(s.r, s.c)));
  const choices = [];
  const used = new Set();
  for (const ch of Array.isArray(boostPlacements) ? boostPlacements : []) {
    if (choices.length >= replacements.length) break;
    const k = key(Number(ch.r), Number(ch.c));
    if (!legalSet.has(k) || used.has(k)) continue;
    used.add(k);
    choices.push({ r: Number(ch.r), c: Number(ch.c), instanceId: replacements[choices.length].instanceId });
  }
  return {
    ok: true, breakdown, consumed, required: plan.placeable, replacements, legal, choices,
    complete: choices.length === plan.placeable, endsMatch: false,
  };
}
