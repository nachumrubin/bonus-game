import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { HV } from '../core/letterDistribution.js';

export const TUTORIAL_WORD = 'שלום';
export const TUTORIAL_LETTERS = Object.freeze(['ש', 'ל', 'ו', 'מ']);
// First move: place שלום at row 5, cols 6–9. Shifted one column "left" (RTL,
// = +1 col) from a centered layout so the second move's 'י' lands ON the
// right-edge bonus square at (5,10) — BDEFS[10] — and fires the bonus.
export const TUTORIAL_CELLS = Object.freeze([
  { r: 5, c: 6 },
  { r: 5, c: 7 },
  { r: 5, c: 8 },
  { r: 5, c: 9 },
]);

// Second player move: place 'י' AT the row-5 right-edge bonus square (5,10).
// findBonusActivationIdxs requires p.r === bonus.br && p.c === bonus.bc, so
// the tile has to be on the bonus square itself, not adjacent to it.
export const TUTORIAL_BONUS_LETTER = 'י';
export const TUTORIAL_BONUS_CELL = Object.freeze({ r: 5, c: 10 });

export const TUTORIAL_WORDS = Object.freeze(['שלום', 'שלומי', 'לב', 'תו', 'בת', 'תות']);

// Cell the player is guided to lock in the lock tutorial step.
export const TUTORIAL_LOCK_CELL = Object.freeze({ r: 4, c: 9 });

// Bot moves are scripted around the shifted player word.
//   Move 1: ב at (6,7) forms "לב" vertically with ל at (5,7).
//   Move 2: ת at (4,8) forms "תו" vertically with ו at (5,8).
//   Move 3: ת at (6,8) forms "בת" horizontally (with ב at 6,7) AND "תות"
//            vertically (ת-ו-ת in col 8). Demonstrates parallel words.
export const TUTORIAL_BOT_MOVES = Object.freeze([
  [{ r: 6, c: 7, letter: 'ב', val: 2, isJoker: false }, 'לב'],
  [{ r: 4, c: 8, letter: 'ת', val: 1, isJoker: false }, 'תו'],
  [{ r: 6, c: 8, letter: 'ת', val: 1, isJoker: false }, 'בת'],
]);

export function buildTutorialFirstMove() {
  return TUTORIAL_CELLS.map((cell, i) => {
    const letter = TUTORIAL_LETTERS[i];
    return { ...cell, letter, val: HV[letter] ?? 0, isJoker: false };
  });
}

export function seedTutorialRack(state, slot = 0) {
  if (!state?.racks?.[slot]) return;
  const rack = state.racks[slot];
  const seeded = [...TUTORIAL_LETTERS, TUTORIAL_BONUS_LETTER];
  for (const letter of seeded) {
    const inBag = state.bag.indexOf(letter);
    if (inBag >= 0) state.bag.splice(inBag, 1);
  }
  const rest = rack.filter(letter => !seeded.includes(letter));
  state.racks[slot] = [...seeded, ...rest].slice(0, 8);
  while (state.racks[slot].length < 8 && state.bag.length) {
    state.racks[slot].push(state.bag.pop());
  }
}

// The bonus square the tutorial routes the player onto is BDEFS[10] — the
// row-5 right-edge slot at (5,10). createInitialState shuffles BONUS_TYPES
// into bonusAssignment, so without this override the player would land on
// a random bonus (often a timed mini-game, which is a heavy first
// experience). Pin the tutorial slot to B3 (4-letter unscramble) so the
// demo is short and deterministic. Real games are unaffected.
export const TUTORIAL_BONUS_SLOT = 10;
export const TUTORIAL_BONUS_OVERRIDE = Object.freeze({ type: 'B3', pts: 40, ic: '⚡' });

export function seedTutorialBonusAssignment(state) {
  if (!Array.isArray(state?.bonusAssignment)) return;
  if (state.bonusAssignment.length <= TUTORIAL_BONUS_SLOT) return;
  state.bonusAssignment[TUTORIAL_BONUS_SLOT] = { ...TUTORIAL_BONUS_OVERRIDE };
}

export function attachScriptedTutorialBot(session, {
  slot = 1,
  moves = TUTORIAL_BOT_MOVES,
  thinkingMs = 700,
  scheduler = setTimeout,
} = {}) {
  if (!session) throw new Error('attachScriptedTutorialBot: session is required');
  if (slot !== 0 && slot !== 1) throw new Error('attachScriptedTutorialBot: slot must be 0 or 1');

  const { bus, state, engine } = session;
  let nextMove = 0;
  let pending = false;

  function maybeAct(currentSlot) {
    if (currentSlot !== slot || pending) return;
    if (state.status !== 'playing') return;
    if (nextMove >= moves.length) return;
    pending = true;
    scheduler(() => {
      pending = false;
      if (state.currentTurnSlot !== slot || state.status !== 'playing') return;
      const placed = normalizeScriptedMove(moves[nextMove]);
      ensureRackLetters(state, slot, placed);
      engine.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed } });
    }, thinkingMs);
  }

  const offStarted = bus.on(EV.GAME_STARTED, ({ currentTurnSlot }) => maybeAct(currentTurnSlot));
  const offTurn = bus.on(EV.TURN_CHANGED, ({ currentTurnSlot }) => maybeAct(currentTurnSlot));
  const offMove = bus.on(EV.MOVE_CONFIRMED, ({ slot: movedSlot }) => {
    if (movedSlot === slot) nextMove += 1;
  });
  session._subs?.push?.(offStarted, offTurn, offMove);

  return {
    get nextMove() { return nextMove; },
    detach() { offStarted(); offTurn(); offMove(); },
  };
}

function normalizeScriptedMove(entry) {
  const raw = Array.isArray(entry?.[0]) ? entry[0] : entry?.[0] ? [entry[0]] : [];
  return raw.map((p) => ({
    r: p.r,
    c: p.c,
    letter: p.letter,
    val: p.val ?? HV[p.letter] ?? 0,
    isJoker: !!p.isJoker,
  }));
}

function ensureRackLetters(state, slot, placed) {
  const rack = state.racks?.[slot];
  if (!rack) return;
  for (const p of placed) {
    const letter = p.isJoker ? '?' : p.letter;
    if (rack.includes(letter)) continue;
    const bagIdx = state.bag.indexOf(letter);
    if (bagIdx >= 0) state.bag.splice(bagIdx, 1);
    if (rack.length >= 8) rack[rack.length - 1] = letter;
    else rack.push(letter);
  }
}
