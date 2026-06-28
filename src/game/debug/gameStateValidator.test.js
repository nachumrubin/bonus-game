import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateTransition } from './gameStateValidator.js';
import { WARNING_TYPE } from './debugSchema.js';

// Compact-snapshot builder with tile counts that conserve the 99-tile set.
function snap(o = {}) {
  return {
    status: 'playing', currentTurnSlot: 1, currentTurnUserId: 'u1', turnNumber: 5,
    hostScore: 30, guestScore: 44, hostTilesCount: 8, guestTilesCount: 8,
    boardHash: 'aaa', boardTileCount: 3, tileBagCount: 80, lastMove: { slot: 0, score: 14, ts: 1 },
    ...o,
  };
}
const types = (ws) => ws.map(w => w.type);

test('clean slot-0 move produces no warnings', () => {
  const prev = snap({ currentTurnSlot: 0, currentTurnUserId: 'u0', turnNumber: 4, hostScore: 16, boardHash: 'aaa', boardTileCount: 1, tileBagCount: 82, lastMove: { slot: 1, ts: 0 } });
  const next = snap({ currentTurnSlot: 1, currentTurnUserId: 'u1', turnNumber: 5, hostScore: 30, boardHash: 'bbb', boardTileCount: 3, tileBagCount: 80, lastMove: { slot: 0, score: 14, ts: 1 } });
  assert.deepEqual(validateTransition(prev, next, { expectedDelta: 14 }), []);
});

test('SAME_PLAYER_TWICE when consecutive movers match', () => {
  const prev = snap({ lastMove: { slot: 0, ts: 0 } });
  const next = snap({ turnNumber: 6, boardHash: 'bbb', lastMove: { slot: 0, ts: 1 } });
  assert.ok(types(validateTransition(prev, next)).includes(WARNING_TYPE.SAME_PLAYER_TWICE));
});

test('TURN_NUMBER_SKIPPED on a jump > 1', () => {
  const prev = snap({ turnNumber: 4, lastMove: { slot: 1, ts: 0 } });
  const next = snap({ turnNumber: 7, boardHash: 'bbb', lastMove: { slot: 0, ts: 1 } });
  assert.ok(types(validateTransition(prev, next)).includes(WARNING_TYPE.TURN_NUMBER_SKIPPED));
});

test('TURN_DID_NOT_ADVANCE when a move keeps the same turn', () => {
  const prev = snap({ currentTurnSlot: 0, turnNumber: 4, lastMove: { slot: 1, ts: 0 } });
  const next = snap({ currentTurnSlot: 0, turnNumber: 4, boardHash: 'bbb', lastMove: { slot: 0, ts: 1 } });
  assert.ok(types(validateTransition(prev, next)).includes(WARNING_TYPE.TURN_DID_NOT_ADVANCE));
});

test('SCORE_MISMATCH when actual delta != expected', () => {
  const prev = snap({ currentTurnSlot: 0, turnNumber: 4, hostScore: 16, lastMove: { slot: 1, ts: 0 } });
  const next = snap({ currentTurnSlot: 1, turnNumber: 5, hostScore: 32, boardHash: 'bbb', lastMove: { slot: 0, ts: 1 } });
  const ws = validateTransition(prev, next, { expectedDelta: 14 }); // actual is 16
  const m = ws.find(w => w.type === WARNING_TYPE.SCORE_MISMATCH);
  assert.ok(m);
  assert.equal(m.debugData.actualDelta, 16);
});

test('NEGATIVE_SCORE', () => {
  assert.ok(types(validateTransition(null, snap({ hostScore: -1 }))).includes(WARNING_TYPE.NEGATIVE_SCORE));
});

test('CHANGED_AFTER_ENDED', () => {
  const prev = snap({ status: 'completed' });
  const next = snap({ status: 'completed', boardHash: 'zzz', turnNumber: 6, lastMove: { slot: 1, ts: 2 } });
  assert.ok(types(validateTransition(prev, next)).includes(WARNING_TYPE.CHANGED_AFTER_ENDED));
});

test('CURRENT_TURN_USER_MISSING when active turn has no user', () => {
  assert.ok(types(validateTransition(null, snap({ currentTurnUserId: null }))).includes(WARNING_TYPE.CURRENT_TURN_USER_MISSING));
});

test('PLAYER_HAS_NO_TILES while bag not empty', () => {
  // host 0 + guest 8 + bag 88 + board 3 = 99
  const ws = validateTransition(null, snap({ hostTilesCount: 0, guestTilesCount: 8, tileBagCount: 88, boardTileCount: 3 }));
  assert.ok(types(ws).includes(WARNING_TYPE.PLAYER_HAS_NO_TILES));
});

test('TILE_COUNT_MISMATCH when totals do not reach 99', () => {
  const ws = validateTransition(null, snap({ hostTilesCount: 8, guestTilesCount: 8, tileBagCount: 80, boardTileCount: 1 })); // 97
  assert.ok(types(ws).includes(WARNING_TYPE.TILE_COUNT_MISMATCH));
});

test('BOARD_CHANGED_NO_MOVE when board differs without a new move', () => {
  const prev = snap({ boardHash: 'aaa', lastMove: { slot: 0, ts: 1 } });
  const next = snap({ boardHash: 'ccc', lastMove: { slot: 0, ts: 1 } }); // identical lastMove
  assert.ok(types(validateTransition(prev, next)).includes(WARNING_TYPE.BOARD_CHANGED_NO_MOVE));
});

test('CLIENT_STATE_MISMATCH from differing hashes in context', () => {
  const ws = validateTransition(null, snap(), { serverHash: 'aaa', clientHash: 'bbb', slot: 1 });
  assert.ok(types(ws).includes(WARNING_TYPE.CLIENT_STATE_MISMATCH));
});

test('APP_VERSION_OLD when below the minimum', () => {
  const ws = validateTransition(null, snap(), { appVersion: '20260101000000', minAppVersion: '20260601000000' });
  assert.ok(types(ws).includes(WARNING_TYPE.APP_VERSION_OLD));
});

test('prev=null runs only next-only checks (no transition warnings)', () => {
  const ws = validateTransition(null, snap());
  assert.deepEqual(ws, []); // clean snapshot, no prev-dependent checks
});
