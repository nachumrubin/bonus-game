// Boost 2.0 — match state shape, public projection, resume normalisation and
// state invariants (spec §24, §26, §27, §43).
//
// Lives on the engine state as `state.boostV2`, next to `state.ruleset =
// 'BOOST_V2'`:
//   {
//     rulesVersion, deckVersion,
//     rules,                  // frozen-at-creation MatchRules snapshot
//     definitions,            // every definition this match can reference
//     phase,                  // FIRST_ROUND | OPENING_SETUP | NORMAL
//     startingSlot, firstRoundTurns,
//     activeBoosts: ActiveBoost[],
//     queue: { deckVersion, entries: ChallengeInstance[], cursor },
//     openingSetup: null | { order, effective, placements, returnSlot },
//     consumedInstanceIds: string[],
//     lastMoveId, revision,
//   }
// Pure.

import { getDeck } from './deckManifest.js';
import { snapshotRules } from './rulesConfig.js';
import { generateQueue, preview } from './challengeQueue.js';
import { isValidDefinition } from './challengeCatalog.js';
import { HD } from '../core/letterDistribution.js';

export const PHASE = Object.freeze({
  FIRST_ROUND: 'FIRST_ROUND',
  OPENING_SETUP: 'OPENING_SETUP',
  NORMAL: 'NORMAL',
});

export function createBoostV2State({ rulesVersion, startingSlot = 0, rng }) {
  if (typeof rng !== 'function') throw new Error('createBoostV2State: rng is required');
  const rules = snapshotRules(rulesVersion);
  const deck = getDeck(rules.deckVersion);
  const queue = generateQueue(deck, rng);
  return {
    rulesVersion: rules.rulesVersion,
    deckVersion: deck.deckVersion,
    rules,
    definitions: JSON.parse(JSON.stringify(deck.definitions)),
    phase: PHASE.FIRST_ROUND,
    startingSlot,
    firstRoundTurns: 0,
    activeBoosts: [],
    queue,
    openingSetup: null,
    consumedInstanceIds: [],
    lastMoveId: null,
    revision: 0,
  };
}

/**
 * What any player may see (spec §27): active Boosts, the next
 * `queuePreviewSize` cards, and the opening-setup progress. The full queue is
 * never part of this projection.
 */
export function publicView(v2) {
  if (!v2) return null;
  const size = v2.rules.queuePreviewSize;
  // Spec §15: before initial activation the preview is the first two queue
  // entries (the cursor is still 0); afterwards, the next two unplaced ones.
  const upcoming = preview(v2.queue, size).map(e => ({
    instanceId: e.instanceId,
    definition: v2.definitions[e.definitionId],
  }));
  return {
    rulesVersion: v2.rulesVersion,
    deckVersion: v2.deckVersion,
    phase: v2.phase,
    activeBoosts: v2.activeBoosts.map(b => ({ ...b, definition: v2.definitions[b.effectiveDefinitionId] })),
    upcoming,
    remainingInQueue: Math.max(0, v2.queue.entries.length - v2.queue.cursor),
    openingSetup: v2.openingSetup ? {
      order: [...v2.openingSetup.order],
      step: v2.openingSetup.placements.length,
      total: v2.openingSetup.effective.length,
      current: v2.openingSetup.effective[v2.openingSetup.placements.length] ?? null,
      placements: v2.openingSetup.placements.map(p => ({ ...p })),
    } : null,
    revision: v2.revision,
  };
}

// Firebase drops empty arrays / null fields. Restore the full shape on resume
// without regenerating anything (spec §26: never regenerate the queue).
export function normalizeBoostV2State(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const arr = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
  const q = raw.queue ?? {};
  const setup = raw.openingSetup ?? null;
  return {
    ...raw,
    activeBoosts: arr(raw.activeBoosts).map(b => ({ ...b, r: Number(b.r), c: Number(b.c) })),
    queue: { deckVersion: q.deckVersion ?? raw.deckVersion, entries: arr(q.entries).map(e => ({ ...e })), cursor: Number(q.cursor) || 0 },
    openingSetup: setup ? {
      order: arr(setup.order).map(Number),
      effective: arr(setup.effective).map(e => ({ ...e, fallbackApplied: !!e.fallbackApplied })),
      placements: arr(setup.placements).map(p => ({ ...p, r: Number(p.r), c: Number(p.c) })),
      returnSlot: Number(setup.returnSlot),
    } : null,
    consumedInstanceIds: arr(raw.consumedInstanceIds),
    lastMoveId: raw.lastMoveId ?? null,
    revision: Number(raw.revision) || 0,
    firstRoundTurns: Number(raw.firstRoundTurns) || 0,
  };
}

// Derived from the bag distribution — never hard-coded (it is 99 today).
const TOTAL_TILES = Object.values(HD).reduce((a, b) => a + b, 0);

/**
 * Check the committed-state invariants (spec §43). Returns an array of
 * violation strings ([] when healthy). `prev` (optional) is the previous
 * committed snapshot of state.boostV2 for monotonicity checks.
 */
export function checkBoostV2Invariants(state, prev = null) {
  const out = [];
  const v2 = state.boostV2;
  if (!v2) return ['missing boostV2 state'];
  const seen = new Set();
  if (v2.activeBoosts.length > v2.rules.activeBoostTarget) out.push('too many active boosts');
  for (const b of v2.activeBoosts) {
    const k = `${b.r},${b.c}`;
    if (state.board[b.r]?.[b.c]) out.push(`boost ${b.instanceId} on a letter tile`);
    if (seen.has(k)) out.push(`two boosts on ${k}`);
    seen.add(k);
    if (!isValidDefinition(v2.definitions[b.effectiveDefinitionId])) out.push(`boost ${b.instanceId} has invalid definition`);
    if (v2.consumedInstanceIds.includes(b.instanceId)) out.push(`boost ${b.instanceId} active after consumption`);
  }
  if (new Set(v2.consumedInstanceIds).size !== v2.consumedInstanceIds.length) out.push('instance consumed twice');
  if (v2.queue.cursor < 0 || v2.queue.cursor > v2.queue.entries.length) out.push('queue cursor out of range');
  const ids = v2.queue.entries.map(e => e.instanceId);
  if (new Set(ids).size !== ids.length) out.push('duplicate queue instance ids');
  // Every placed entry is either active or consumed; nothing unplaced is either.
  const placed = new Set(v2.queue.entries.slice(0, v2.queue.cursor).map(e => e.instanceId));
  for (const b of v2.activeBoosts) if (!placed.has(b.instanceId)) out.push(`active boost ${b.instanceId} not drawn from queue`);
  for (const id of v2.consumedInstanceIds) if (!placed.has(id)) out.push(`consumed ${id} not drawn from queue`);
  if (placed.size !== v2.activeBoosts.length + v2.consumedInstanceIds.length) out.push('queue/active/consumed accounting mismatch');
  // Tile conservation.
  let onBoard = 0;
  for (const row of state.board) for (const t of row) if (t) onBoard++;
  const total = state.bag.length + state.racks[0].length + state.racks[1].length + onBoard;
  if (total !== TOTAL_TILES) out.push(`tile conservation broken: ${total}`);
  if (state.bonusBoard?.size) out.push('legacy off-grid tile in a V2 match');
  if (prev) {
    if (v2.queue.cursor < prev.queue.cursor) out.push('queue cursor moved backward');
    if (v2.rulesVersion !== prev.rulesVersion || v2.deckVersion !== prev.deckVersion) out.push('rules/deck version changed');
    if (JSON.stringify(v2.rules) !== JSON.stringify(prev.rules)) out.push('rules snapshot changed');
    if (v2.revision < prev.revision) out.push('revision moved backward');
  }
  return out;
}
