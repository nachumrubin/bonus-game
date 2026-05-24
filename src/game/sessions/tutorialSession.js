import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { HV } from '../core/letterDistribution.js';

export const TUTORIAL_WORD = 'שלום';
export const TUTORIAL_LETTERS = Object.freeze(['ש', 'ל', 'ו', 'מ']);
export const TUTORIAL_CELLS = Object.freeze([
  { r: 5, c: 5 },
  { r: 5, c: 6 },
  { r: 5, c: 7 },
  { r: 5, c: 8 },
]);

export const TUTORIAL_WORDS = Object.freeze(['שלום', 'לב', 'אח', 'תמ', 'לבדו']);

export const TUTORIAL_BOT_MOVES = Object.freeze([
  [{ r: 6, c: 6, letter: 'ב', val: 2, isJoker: false }, 'לב'],
  [{ r: 4, c: 4, letter: 'א', val: 1, isJoker: false }, 'אח'],
  [{ r: 4, c: 8, letter: 'ת', val: 1, isJoker: false }, 'תמ'],
  [{ r: 8, c: 6, letter: 'ו', val: 1, isJoker: false }, 'לבדו'],
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
  for (const letter of TUTORIAL_LETTERS) {
    const inBag = state.bag.indexOf(letter);
    if (inBag >= 0) state.bag.splice(inBag, 1);
  }
  const rest = rack.filter(letter => !TUTORIAL_LETTERS.includes(letter));
  state.racks[slot] = [...TUTORIAL_LETTERS, ...rest].slice(0, 8);
  while (state.racks[slot].length < 8 && state.bag.length) {
    state.racks[slot].push(state.bag.pop());
  }
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
