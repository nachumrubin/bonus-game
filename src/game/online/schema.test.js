import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeBoard, deserializeBoard, buildRoomDoc } from './schema.js';

test('serializeBoard / deserializeBoard round-trip preserves tile data', () => {
  const board = Array.from({ length: 10 }, () => Array(10).fill(null));
  board[4][4] = { letter: 'א', val: 1, isJoker: false };
  board[5][5] = { letter: 'ב', val: 3, isJoker: true };
  const flat = serializeBoard(board);
  const back = deserializeBoard(flat);
  assert.deepEqual(back[4][4], { letter: 'א', val: 1, isJoker: false });
  assert.deepEqual(back[5][5], { letter: 'ב', val: 3, isJoker: true });
  assert.equal(back[0][0], null);
});

test('buildRoomDoc produces a v2 room with schemaVersion 2 and version 1', () => {
  const engineState = {
    tileBagSeed: 'seed',
    currentTurnSlot: 0,
    turnNumber: 1,
    scores: { 0: 0, 1: 0 },
    bag: ['ג', 'ד'],
    racks: { 0: ['א'], 1: ['ב'] },
    board: Array.from({ length: 10 }, () => Array(10).fill(null)),
  };
  const doc = buildRoomDoc({
    roomId: 'r1', mode: 'friend-live',
    players: { 0: { uid: 'a' }, 1: { uid: 'b' } },
    settings: {}, engineState, createdAt: 1000,
  });
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.version, 1);
  assert.equal(doc.roomId, 'r1');
  assert.equal(doc.tileBagSeed, 'seed');
  assert.deepEqual(doc.bag, ['ג', 'ד']);
  assert.deepEqual(doc.scores, { 0: 0, 1: 0 });
});
