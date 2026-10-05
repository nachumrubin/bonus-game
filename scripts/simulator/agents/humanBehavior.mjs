// humanBehavior.mjs — the "in-between" actions a real player does during a
// turn, before the final commit. Pure (given rng).
//
//   • drag previews  — tiles dragged onto the board one by one (sometimes to
//                      a wrong spot and back). Each change is written to the
//                      room's livePreview, exactly like the browser does on
//                      GAME_SCREEN_INTENT.LIVE_PREVIEW_CHANGED, so the
//                      opponent sees the ghost tiles. Highest-frequency write
//                      in a real game — matters for load.
//   • dictionary     — "is this a word?" lookups in the מילון screen
//                      (hebrewDictionary.isValid — the same check main.js
//                      runs on DICT_INTENT.CHECK_QUERY). Mix of the word they
//                      end up playing and rack scrambles that usually aren't.
//   • reactions      — predefined emojis / messages (reactionsConfig.js),
//                      chosen from context, sent through reactionService.

import { REACTIONS, validateReactionPayload } from '../../../src/reactions/reactionsConfig.js';
import { BOARD_SIZE, getCommittedTile } from '../../../src/game/core/board.js';

export const REACTION_COOLDOWN_MS = 5000; // reactionService COOLDOWN_MS

function int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/**
 * Build the sequence of preview states the player passes through before the
 * final placement. Each entry is the full list of tiles on the board at that
 * moment (what livePreview would show). The last entry is NOT the final
 * placement — the commit itself does that.
 */
export function buildPreviewDrafts(state, finalPlaced, rng, [minN, maxN] = [0, 3]) {
  const n = int(rng, minN, maxN);
  if (!n) return [];
  const drafts = [];
  const order = [...(finalPlaced ?? [])].sort(() => rng() - 0.5);
  for (let i = 0; i < n; i++) {
    if (order.length && rng() < 0.7) {
      // Progressive build-up toward the real word.
      const k = Math.max(1, Math.min(order.length, Math.ceil(((i + 1) / n) * order.length)));
      drafts.push(order.slice(0, k));
    } else {
      // Misplaced tile: dropped on a random empty cell, then pulled back.
      const cell = randomEmptyCell(state, rng);
      const letter = (state.racks?.[state.currentTurnSlot] ?? [])[0];
      if (cell && letter && letter !== '?') drafts.push([{ r: cell.r, c: cell.c, letter, val: 0, isJoker: false }]);
    }
  }
  return drafts;
}

function randomEmptyCell(state, rng) {
  for (let i = 0; i < 40; i++) {
    const r = int(rng, 0, BOARD_SIZE - 1);
    const c = int(rng, 0, BOARD_SIZE - 1);
    if (!getCommittedTile(state, r, c)) return { r, c };
  }
  return null;
}

/** Words the player types into the dictionary screen this turn. */
export function buildLookups(rack, finalWord, rng, [minN, maxN] = [0, 2]) {
  const n = int(rng, minN, maxN);
  const out = [];
  const letters = (rack ?? []).filter(l => l && l !== '?');
  for (let i = 0; i < n; i++) {
    if (finalWord && rng() < 0.5) { out.push(finalWord); continue; }
    if (letters.length < 2) continue;
    const len = int(rng, 2, Math.min(5, letters.length));
    const shuffled = [...letters].sort(() => rng() - 0.5);
    out.push(shuffled.slice(0, len).join(''));
  }
  return out;
}

const MSG = (id) => ({ type: 'message', id });
const EMO = (id) => ({ type: 'emoji', id });

// Context → candidate reactions. Contexts are emitted by gameAgent.
const BY_CONTEXT = {
  gameStart:      [MSG('goodLuck'), EMO('cool'), EMO('boost')],
  opponentBig:    [MSG('niceMove'), MSG('strongWord'), MSG('wow'), EMO('shock'), EMO('mindBlown'), EMO('clap')],
  opponentBonus:  [MSG('lucky'), EMO('fire'), EMO('eyes'), MSG('didntSeeThat')],
  opponentSmall:  [EMO('eyes'), EMO('sweat')],
  myBig:          [EMO('fire'), EMO('trophy'), EMO('brain'), EMO('cool')],
  stuck:          [MSG('brainStuck'), MSG('needLetters'), EMO('cry'), EMO('sweat')],
  behind:         [MSG('comeback'), EMO('sweat')],
  close:          [MSG('closeGame'), EMO('eyes')],
  waiting:        [MSG('yourTurn'), EMO('eyes')],
  opponentStole:  [MSG('stoleSpot'), EMO('shock')],
  gameEnd:        [MSG('wellDone'), MSG('rematch'), MSG('veryNice'), EMO('clap'), EMO('trophy')],
};

export const REACTION_CONTEXTS = Object.freeze(Object.keys(BY_CONTEXT));

/** @returns {{ type: 'emoji'|'message', id: string } | null} */
export function chooseReaction(context, rng) {
  const options = BY_CONTEXT[context];
  if (!options) return null;
  const r = pick(rng, options);
  return validateReactionPayload({ ...r, senderSlot: 0 }) ? r : null;
}

// Sanity: every id above must exist in the shipped config.
export function _allReactionIdsValid() {
  return Object.values(BY_CONTEXT).flat().every(r => validateReactionPayload({ ...r, senderSlot: 0 }))
    && REACTIONS.messages.length > 0;
}
