// Reaction service — Firebase writes and local state (cooldown, mute).
// Does NOT touch DOM. Does NOT affect game state.

import { validateReactionPayload } from './reactionsConfig.js';
import { PATH } from '../game/online/schema.js';

const COOLDOWN_MS = 5000;
const MUTE_KEY    = 'spine.muteReactions';

/**
 * Send a reaction to Firebase.
 * Writes to rooms/{roomId}/liveReaction — a non-version-guarded path,
 * same pattern as livePreview / liveBonus.
 *
 * @param {object} db       Firebase database instance
 * @param {string} roomId
 * @param {{ type: string, id: string, senderSlot: 0|1 }} opts
 * @returns {Promise<void>}
 */
export async function sendReaction(db, roomId, { type, id, senderSlot }) {
  const payload = {
    type:       String(type),
    id:         String(id),
    senderSlot: senderSlot === 1 ? 1 : 0,
    ts:         Date.now(),
  };
  if (!validateReactionPayload(payload)) throw new Error('sendReaction: invalid payload');
  await db.ref(`${PATH.rooms}/${roomId}/liveReaction`).set(payload);
}

/**
 * Clear liveReaction (called on dispose to avoid ghost reactions for next session).
 */
export async function clearReaction(db, roomId) {
  try {
    await db.ref(`${PATH.rooms}/${roomId}/liveReaction`).set(null);
  } catch { /* swallow — best effort */ }
}

// ── Cooldown ─────────────────────────────────────────────────────────────────

let lastSentTs = 0;

/**
 * Can this client send a new reaction right now?
 * @param {number} [now] - injectable clock for tests
 */
export function canSendReaction(now = Date.now()) {
  return (now - lastSentTs) >= COOLDOWN_MS;
}

/** Record that a reaction was just sent. */
export function recordReactionSent(now = Date.now()) {
  lastSentTs = now;
}

/** Reset cooldown state (e.g. on new session). */
export function resetCooldown() {
  lastSentTs = 0;
}

/** Remaining cooldown in ms, or 0 if ready. */
export function cooldownRemaining(now = Date.now()) {
  const elapsed = now - lastSentTs;
  return elapsed >= COOLDOWN_MS ? 0 : COOLDOWN_MS - elapsed;
}

// ── Mute ────────────────────────────────────────────────────────────────────

/**
 * Whether the local player has muted opponent reactions.
 * @param {Storage} storage
 */
export function isReactionMuted(storage) {
  return storage?.getItem?.(MUTE_KEY) === 'true';
}

/**
 * Set the local mute preference.
 * @param {Storage} storage
 * @param {boolean} muted
 */
export function setReactionMuted(storage, muted) {
  try { storage?.setItem?.(MUTE_KEY, String(!!muted)); } catch { /* swallow */ }
}
