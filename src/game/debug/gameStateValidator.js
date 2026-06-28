// Game Debug Timeline — pure state validator.
//
// `validateTransition(prev, next, context)` compares two compact snapshots (see
// stateHash.compactSnapshot) and returns an array of Warning objects describing
// any suspicious or impossible transition. Pure: no DOM, no Firebase, no clocks.
//
// `prev` may be null (the first snapshot of a game); next-only checks still run.

import { HD } from '../core/letterDistribution.js';
import { WARNING_TYPE, SEVERITY } from './debugSchema.js';

const TOTAL_TILES = Object.values(HD).reduce((a, b) => a + b, 0); // 99
const TERMINAL = new Set(['completed', 'abandoned', 'expired']);

function warn(type, severity, message, debugData = {}) {
  return { type, severity, message, debugData };
}

function sameMove(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function scoreFor(snap, slot) {
  return slot === 0 ? Number(snap?.hostScore ?? 0) : Number(snap?.guestScore ?? 0);
}

/**
 * @param {object|null} prev   compact snapshot before the change (or null)
 * @param {object} next        compact snapshot after the change
 * @param {object} [context]   { eventType, expectedDelta, expectTurnAdvance,
 *   appVersion, minAppVersion, rulesVersion, expectedRulesVersion, dictVersion,
 *   expectedDictVersion, serverHash, clientHash, slot }
 * @returns {Array<{type,severity,message,debugData}>}
 */
export function validateTransition(prev, next, context = {}) {
  const out = [];
  if (!next || typeof next !== 'object') return out;

  const nextTerminal = TERMINAL.has(next.status);
  const moverSlot = next.lastMove?.slot ?? null;
  const newMove = !!next.lastMove && !sameMove(next.lastMove, prev?.lastMove);

  // ── Next-only checks ──────────────────────────────────────────────
  if (next.hostScore < 0 || next.guestScore < 0) {
    out.push(warn(WARNING_TYPE.NEGATIVE_SCORE, SEVERITY.HIGH,
      `Negative score (host=${next.hostScore}, guest=${next.guestScore})`,
      { hostScore: next.hostScore, guestScore: next.guestScore }));
  }

  if (next.status === 'playing' && next.currentTurnUserId == null) {
    out.push(warn(WARNING_TYPE.CURRENT_TURN_USER_MISSING, SEVERITY.MEDIUM,
      `Active game but currentTurnSlot=${next.currentTurnSlot} has no user`,
      { currentTurnSlot: next.currentTurnSlot }));
  }

  if (next.status === 'playing' && Number(next.tileBagCount) > 0) {
    if (next.hostTilesCount === 0 || next.guestTilesCount === 0) {
      out.push(warn(WARNING_TYPE.PLAYER_HAS_NO_TILES, SEVERITY.MEDIUM,
        `A player has 0 tiles while ${next.tileBagCount} remain in the bag`,
        { hostTilesCount: next.hostTilesCount, guestTilesCount: next.guestTilesCount, tileBagCount: next.tileBagCount }));
    }
  }

  // Tile conservation: rack + rack + bag + board should equal the full set.
  const tilesAccounted = Number(next.hostTilesCount) + Number(next.guestTilesCount)
    + Number(next.tileBagCount ?? 0) + Number(next.boardTileCount ?? 0);
  if (Number.isFinite(tilesAccounted) && next.tileBagCount != null
      && tilesAccounted !== TOTAL_TILES) {
    out.push(warn(WARNING_TYPE.TILE_COUNT_MISMATCH, SEVERITY.HIGH,
      `Tile count ${tilesAccounted} != ${TOTAL_TILES} (host=${next.hostTilesCount}, guest=${next.guestTilesCount}, bag=${next.tileBagCount}, board=${next.boardTileCount})`,
      { tilesAccounted, expected: TOTAL_TILES }));
  }

  // ── Client/server divergence (hashes computed by the recorder) ────
  if (context.serverHash != null && context.clientHash != null
      && context.serverHash !== context.clientHash) {
    out.push(warn(WARNING_TYPE.CLIENT_STATE_MISMATCH, SEVERITY.HIGH,
      `Client state hash ${context.clientHash} != server ${context.serverHash}`,
      { serverHash: context.serverHash, clientHash: context.clientHash, slot: context.slot ?? null }));
  }

  // ── Version checks ────────────────────────────────────────────────
  if (context.appVersion && context.minAppVersion
      && String(context.appVersion) < String(context.minAppVersion)) {
    out.push(warn(WARNING_TYPE.APP_VERSION_OLD, SEVERITY.LOW,
      `App version ${context.appVersion} is older than minimum ${context.minAppVersion}`,
      { appVersion: context.appVersion, minAppVersion: context.minAppVersion }));
  }
  if (context.rulesVersion != null && context.expectedRulesVersion != null
      && context.rulesVersion !== context.expectedRulesVersion) {
    out.push(warn(WARNING_TYPE.RULES_VERSION_MISMATCH, SEVERITY.MEDIUM,
      `Rules version ${context.rulesVersion} != expected ${context.expectedRulesVersion}`,
      { rulesVersion: context.rulesVersion, expected: context.expectedRulesVersion }));
  }
  if (context.dictVersion != null && context.expectedDictVersion != null
      && context.dictVersion !== context.expectedDictVersion) {
    out.push(warn(WARNING_TYPE.DICT_VERSION_MISMATCH, SEVERITY.MEDIUM,
      `Dictionary version ${context.dictVersion} != expected ${context.expectedDictVersion}`,
      { dictVersion: context.dictVersion, expected: context.expectedDictVersion }));
  }

  // ── Transition checks (need prev) ─────────────────────────────────
  if (!prev || typeof prev !== 'object') return out;

  const prevTerminal = TERMINAL.has(prev.status);
  const substantiveChange = prev.boardHash !== next.boardHash
    || prev.hostScore !== next.hostScore || prev.guestScore !== next.guestScore
    || prev.turnNumber !== next.turnNumber || prev.status !== next.status;

  if (prevTerminal && substantiveChange) {
    out.push(warn(WARNING_TYPE.CHANGED_AFTER_ENDED, SEVERITY.HIGH,
      `State changed after the game ended (was '${prev.status}')`,
      { prevStatus: prev.status, nextStatus: next.status }));
  }

  if (newMove && prev.lastMove && prev.lastMove.slot === moverSlot) {
    out.push(warn(WARNING_TYPE.SAME_PLAYER_TWICE, SEVERITY.HIGH,
      `Slot ${moverSlot} appears to have moved twice in a row`,
      { moverSlot, prevMove: prev.lastMove, nextMove: next.lastMove }));
  }

  if (Number.isInteger(prev.turnNumber) && Number.isInteger(next.turnNumber)) {
    if (next.turnNumber > prev.turnNumber + 1) {
      out.push(warn(WARNING_TYPE.TURN_NUMBER_SKIPPED, SEVERITY.MEDIUM,
        `Turn number jumped ${prev.turnNumber} → ${next.turnNumber}`,
        { from: prev.turnNumber, to: next.turnNumber }));
    }
  }

  // A scoring move happened but neither the active slot nor the turn number
  // advanced. (expectTurnAdvance defaults true; pass false for free-swap/lock.)
  const expectTurnAdvance = context.expectTurnAdvance !== false;
  if (newMove && expectTurnAdvance
      && next.currentTurnSlot === prev.currentTurnSlot
      && next.turnNumber === prev.turnNumber) {
    out.push(warn(WARNING_TYPE.TURN_DID_NOT_ADVANCE, SEVERITY.MEDIUM,
      `A move was recorded but the turn did not advance (slot ${next.currentTurnSlot}, turn ${next.turnNumber})`,
      { currentTurnSlot: next.currentTurnSlot, turnNumber: next.turnNumber }));
  }

  // Board changed but no new move was recorded for it.
  if (prev.boardHash !== next.boardHash && !newMove) {
    out.push(warn(WARNING_TYPE.BOARD_CHANGED_NO_MOVE, SEVERITY.MEDIUM,
      'Board changed without an accompanying move record',
      { prevBoardHash: prev.boardHash, nextBoardHash: next.boardHash }));
  }

  // Score moved by a different amount than the move claimed.
  if (newMove && moverSlot != null && Number.isFinite(context.expectedDelta)) {
    const actualDelta = scoreFor(next, moverSlot) - scoreFor(prev, moverSlot);
    if (actualDelta !== Number(context.expectedDelta)) {
      out.push(warn(WARNING_TYPE.SCORE_MISMATCH, SEVERITY.HIGH,
        `Expected score delta ${context.expectedDelta} but slot ${moverSlot} changed by ${actualDelta}`,
        { moverSlot, expectedDelta: context.expectedDelta, actualDelta }));
    }
  }

  return out;
}
