// decide.mjs — WHAT a simulated player does on their turn. Pure (given rng).
//
// Returns a turn plan; gameAgent.mjs executes it through the real
// gameController / session at the time timing.mjs chose. The plan mirrors
// what real players do:
//   - play the word the bot search finds (strength from persona difficulty)
//   - sometimes attach a lock to the move, or place a lock alone
//   - swap tiles when the rack is genuinely poor (rack-quality heuristic)
//   - spend a free-swap boost when they own one
//   - submit a guessed, invalid word (→ reject → auto-pass)
//   - claim the stalling win when allowed and ahead
//   - resign, rarely
//   - walk away and let the timer run out (timed games only)

import { searchBotMove } from '../../../src/game/sessions/botSearch.js';
import { canClaimStallEnd } from '../../../src/game/core/turnManager.js';
import { BOARD_SIZE, getCommittedTile } from '../../../src/game/core/board.js';
import { findIllegalPlacement } from '../bots/randomBot.mjs';

export const LOCK_POINT_COST = 10;
// Hebrew letters that act as vowels (matres lectionis). A rack with none, or
// one that is mostly these, is hard to play — the classic "bad rack".
const VOWELISH = new Set(['א', 'ה', 'ו', 'י']);

export function rackQuality(rack = []) {
  const letters = rack.filter(l => l && l !== '?');
  const vowels = letters.filter(l => VOWELISH.has(l)).length;
  const counts = new Map();
  for (const l of letters) counts.set(l, (counts.get(l) ?? 0) + 1);
  const maxDup = Math.max(0, ...counts.values());
  const poor = letters.length >= 5 && (vowels === 0 || vowels >= letters.length - 1 || maxDup >= 3);
  return { vowels, maxDup, poor };
}

// Letters a player would throw back from a poor rack: surplus duplicates and
// (if vowel-starved) consonants; if vowel-flooded, surplus vowels.
export function chooseExchangeLetters(rack, rng, maxBag) {
  const letters = rack.filter(Boolean);
  const { vowels } = rackQuality(rack);
  const counts = new Map();
  const out = [];
  for (const l of letters) {
    const n = (counts.get(l) ?? 0) + 1;
    counts.set(l, n);
    if (n >= 2 && l !== '?') out.push(l); // duplicates beyond the first
  }
  for (const l of letters) {
    if (out.length >= 4) break;
    if (l === '?') continue; // nobody throws back a joker
    if (vowels === 0 && !VOWELISH.has(l) && rng() < 0.5) out.push(l);
    else if (vowels >= letters.length - 1 && VOWELISH.has(l) && rng() < 0.5) out.push(l);
  }
  const k = Math.max(1, Math.min(out.length || 1 + Math.floor(rng() * 3), 7, maxBag));
  const pool = out.length ? out : letters.filter(l => l !== '?');
  // Remove from a copy of the rack so we never ask for more copies than held.
  const remaining = [...letters];
  const chosen = [];
  for (const l of pool) {
    if (chosen.length >= k) break;
    const i = remaining.indexOf(l);
    if (i >= 0) { chosen.push(l); remaining.splice(i, 1); }
  }
  return chosen;
}

function emptyCellsNearTiles(state, placed = []) {
  const taken = new Set(placed.map(p => `${p.r},${p.c}`));
  const out = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (getCommittedTile(state, r, c) || taken.has(`${r},${c}`)) continue;
      if ((state.lockedCells ?? []).some(l => l.r === r && l.c === c && (l.remainingTurns ?? 0) > 0)) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) =>
        getCommittedTile(state, r + dr, c + dc) || taken.has(`${r + dr},${c + dc}`));
      if (near) out.push({ r, c });
    }
  }
  return out;
}

export function pickLock(state, slot, rng, placed = []) {
  if ((state.scores?.[slot] ?? 0) < LOCK_POINT_COST) return null;
  const inv = (state.lockInventory?.[slot] ?? []).map(Number).filter(n => n > 0);
  if (!inv.length) return null;
  const cells = emptyCellsNearTiles(state, placed);
  if (!cells.length) return null;
  const cell = cells[Math.floor(rng() * cells.length)];
  return { r: cell.r, c: cell.c, duration: inv[Math.floor(rng() * inv.length)] };
}

/**
 * @param {object} state  engine state (session.state)
 * @param {0|1} slot
 * @param {object} persona  (personas.mjs, after withChaos)
 * @param {() => number} rng
 * @param {{ wordList: string[], isWordValid: (w:string)=>boolean, timed: boolean, allow?: object }} ctx
 */
export function decideTurn(state, slot, persona, rng, ctx) {
  const allow = { resign: true, walkAway: true, illegal: true, lock: true, ...(ctx.allow ?? {}) };
  const rack = state.racks?.[slot] ?? [];
  const bagN = state.bag?.length ?? 0;

  if (allow.resign && rng() < persona.resignChance) return { kind: 'resign' };
  // Real leaders rarely end a game the moment two scoreless turns allow it;
  // claiming at 50% cut most bot games to a handful of turns.
  if (canClaimStallEnd(state, slot) && rng() < 0.15) return { kind: 'stallClaim' };
  if (allow.walkAway && ctx.timed && rng() < persona.walkAwayChance) return { kind: 'walkAway' };

  // Free swap first (doesn't end the turn), then keep planning the real move.
  let freeSwapLetters = null;
  const ownsFreeSwap = (state.activeBoosts ?? []).some(b => b?.boostId === 'free_tile_swap' && b.slot === slot && !b.consumed);
  const quality = rackQuality(rack);
  if (ownsFreeSwap && bagN > 0 && (quality.poor || rng() < 0.4)) {
    freeSwapLetters = chooseExchangeLetters(rack, rng, bagN);
  }

  if (!freeSwapLetters && quality.poor && bagN >= 1 && rng() < persona.exchangeWhenPoorRack) {
    return { kind: 'exchange', letters: chooseExchangeLetters(rack, rng, bagN), reason: 'poor-rack' };
  }

  if (allow.illegal && rng() < persona.illegalWordChance) {
    const bad = findIllegalPlacement(state, slot, rng);
    if (bad) return { kind: 'illegal', placed: bad, freeSwapLetters };
  }

  const best = searchBotMove(state, slot, ctx.wordList, ctx.isWordValid, { difficulty: persona.difficulty, rng });
  if (best?.placed?.length) {
    const placed = best.placed.map(p => ({ ...p }));
    const lock = allow.lock && rng() < persona.lockChance ? pickLock(state, slot, rng, placed) : null;
    return { kind: 'move', placed, word: best.word, expectedScore: best.score, lock, freeSwapLetters };
  }

  // Stuck: lock alone sometimes (it's a legal turn), else exchange, else pass.
  if (allow.lock && rng() < persona.lockChance * 2) {
    const lock = pickLock(state, slot, rng);
    if (lock) return { kind: 'lockOnly', lock };
  }
  if (bagN >= 1 && rack.length) {
    return { kind: 'exchange', letters: chooseExchangeLetters(rack, rng, bagN), reason: 'no-move' };
  }
  return { kind: 'pass' };
}
