// Central config for the in-game reaction system.
// Only predefined, child-safe reactions are allowed.
// Never add offensive, taunting, or user-generated content here.
//
// Three types travel through rooms/$roomId/liveReaction:
//   emoji    — a bubble with an emoji (REACTIONS.emojis)
//   message  — a bubble with a short Hebrew line (REACTIONS.messages)
//   boostie  — the sender's Boostie plays a clip (BOOSTIE_REACTIONS, Phase 5). Where the
//              Boostie is a still, the clip's emoji shows in a bubble instead.

import { BOOSTIE_REACTIONS } from '../game/account/boostieCatalog.js';

export const REACTIONS = Object.freeze({
  emojis: Object.freeze([
    { id: 'laugh',     value: '😂' },
    { id: 'shock',     value: '😱' },
    { id: 'cool',      value: '😎' },
    { id: 'mindBlown', value: '🤯' },
    { id: 'clap',      value: '👏' },
    { id: 'fire',      value: '🔥' },
    { id: 'cry',       value: '😭' },
    { id: 'brain',     value: '🧠' },
    { id: 'eyes',      value: '👀' },
    { id: 'sweat',     value: '😅' },
    { id: 'boost',     value: '⚡' },
    { id: 'trophy',    value: '🏆' },
  ]),
  messages: Object.freeze([
    { id: 'niceMove',      text: 'מהלך יפה!' },
    { id: 'strongWord',    text: 'מילה חזקה!' },
    { id: 'yourTurn',      text: 'תורך 👀' },
    { id: 'wow',           text: 'וואו!' },
    { id: 'lucky',         text: 'איזה מזל!' },
    { id: 'didntSeeThat',  text: 'לא ראיתי את זה בא' },
    { id: 'comeback',      text: 'אני עוד חוזר' },
    { id: 'needLetters',   text: 'אני צריך אותיות טובות' },
    { id: 'brainStuck',    text: 'המוח שלי נתקע' },
    { id: 'stoleSpot',     text: 'גנבת לי את המקום!' },
    { id: 'closeGame',     text: 'משחק צמוד!' },
    { id: 'wellDone',      text: 'כל הכבוד!' },
    { id: 'rematch',       text: 'יאללה משחק חוזר?' },
    { id: 'goodLuck',      text: 'בהצלחה!' },
    { id: 'veryNice',      text: 'יפה מאוד!' },
  ]),
});

// Pre-built lookup sets for O(1) validation
const VALID_EMOJI_IDS   = new Set(REACTIONS.emojis.map(e => e.id));
const VALID_MESSAGE_IDS = new Set(REACTIONS.messages.map(m => m.id));
const VALID_BOOSTIE_IDS = new Set(BOOSTIE_REACTIONS.map(r => r.id));

/**
 * Validate a reaction payload received from Firebase or local send.
 * Returns true only for known safe type+id combinations.
 * @param {{ type: string, id: string, senderSlot: number, ts: number }} payload
 */
export function validateReactionPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.type === 'emoji')   return VALID_EMOJI_IDS.has(String(payload.id ?? ''));
  if (payload.type === 'message') return VALID_MESSAGE_IDS.has(String(payload.id ?? ''));
  if (payload.type === 'boostie') return VALID_BOOSTIE_IDS.has(String(payload.id ?? ''));
  return false;
}

/**
 * Given a validated payload, return the display string (emoji or Hebrew text).
 * Returns null if the payload is not recognized.
 */
export function getReactionDisplay(payload) {
  if (!validateReactionPayload(payload)) return null;
  if (payload.type === 'emoji') {
    return REACTIONS.emojis.find(e => e.id === payload.id)?.value ?? null;
  }
  if (payload.type === 'boostie') {
    return BOOSTIE_REACTIONS.find(r => r.id === payload.id)?.emoji ?? null;
  }
  return REACTIONS.messages.find(m => m.id === payload.id)?.text ?? null;
}

/**
 * The animation clip a validated Boostie reaction plays, or null for any other payload.
 */
export function getBoostieClip(payload) {
  if (payload?.type !== 'boostie' || !validateReactionPayload(payload)) return null;
  return BOOSTIE_REACTIONS.find(r => r.id === payload.id)?.clip ?? null;
}
