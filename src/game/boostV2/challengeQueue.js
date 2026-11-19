// Boost 2.0 — predetermined shared challenge queue (spec §13, §15, §17).
//
// The complete queue is generated once, before the match starts, from the
// versioned deck manifest and an RNG. It never depends on players, scores,
// racks or bots. Consumption is strict FIFO via a monotonic cursor: entries
// [0, cursor) have been placed on the board, entries from `cursor` onward are
// still in the queue (the first ones may be "pending" — allocated but with no
// legal square yet, spec §21). Consumed cards are never recycled.
// Pure.

import { DIFFICULTY } from './rulesConfig.js';
import { FAMILY } from './challengeCatalog.js';
import { shuffle } from '../../util/rng.js';

function withInt(rng) {
  if (typeof rng.int === 'function') return rng;
  const f = () => rng();
  f.int = (n) => Math.floor(rng() * n);
  return f;
}

/**
 * Generate a queue (spec §15):
 *   one random EASY, one random MEDIUM, one random HARD (not Bridge Builder)
 *   → shuffled as the first three (reserved for initial placement);
 *   remaining 97 shuffled after them.
 * @param {{deckVersion:string, definitions:object, cards:Array<{instanceId,definitionId}>}} deck
 * @param {() => number} rng
 */
export function generateQueue(deck, rng) {
  const r = withInt(rng);
  const remaining = deck.cards.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
  const pick = (pred) => {
    const idxs = [];
    remaining.forEach((c, i) => { if (pred(deck.definitions[c.definitionId])) idxs.push(i); });
    if (idxs.length === 0) throw new Error('deck cannot supply the initial difficulty mix');
    const i = idxs[r.int(idxs.length)];
    return remaining.splice(i, 1)[0];
  };
  const head = [
    pick(d => d.difficulty === DIFFICULTY.EASY),
    pick(d => d.difficulty === DIFFICULTY.MEDIUM),
    pick(d => d.difficulty === DIFFICULTY.HARD && d.family !== FAMILY.BRIDGE_BUILDER),
  ];
  shuffle(head, r);
  shuffle(remaining, r);
  return { deckVersion: deck.deckVersion, entries: [...head, ...remaining], cursor: 0 };
}

export function remainingCount(queue) {
  return Math.max(0, queue.entries.length - queue.cursor);
}

// Entries allocated for the next `n` placements, in FIFO order. May return
// fewer than n when the deck runs out (spec §17 — never crash).
export function peek(queue, n) {
  return queue.entries.slice(queue.cursor, queue.cursor + Math.max(0, n));
}

// Next upcoming cards after `skip` entries that are about to be / being
// placed (spec §15, §32): with skip = 0 this is entries[cursor..cursor+size).
export function preview(queue, size = 2, skip = 0) {
  return queue.entries.slice(queue.cursor + skip, queue.cursor + skip + size);
}

// Advance after committed placements only. Never moves backward, never
// passes the end (spec §43).
export function advance(queue, n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`queue advance: invalid count ${n}`);
  if (queue.cursor + n > queue.entries.length) throw new Error('queue advance past end');
  queue.cursor += n;
  return queue;
}
