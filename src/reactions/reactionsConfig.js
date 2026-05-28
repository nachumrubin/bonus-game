// Central config for the in-game reaction system.
// Only predefined, child-safe reactions are allowed.
// Never add offensive, taunting, or user-generated content here.

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

/**
 * Validate a reaction payload received from Firebase or local send.
 * Returns true only for known safe type+id combinations.
 * @param {{ type: string, id: string, senderSlot: number, ts: number }} payload
 */
export function validateReactionPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.type === 'emoji')   return VALID_EMOJI_IDS.has(String(payload.id ?? ''));
  if (payload.type === 'message') return VALID_MESSAGE_IDS.has(String(payload.id ?? ''));
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
  return REACTIONS.messages.find(m => m.id === payload.id)?.text ?? null;
}
