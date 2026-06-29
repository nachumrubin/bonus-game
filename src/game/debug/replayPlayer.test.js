import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildReplayTimeline, framesFromTimeline, snapshotOutcomeKey } from './replayPlayer.js';

// Helpers: a snapshot's divergence is judged on board tiles + scores only.
const flat = (occupied = {}) => {
  const f = new Array(100).fill(null);
  for (const [i, letter] of Object.entries(occupied)) f[i] = { letter };
  return f;
};
const snap = (t, { board = {}, host = 0, guest = 0 } = {}) =>
  ({ serverTimestamp: t, board: flat(board), compact: { hostScore: host, guestScore: guest } });

test('frames bucket by second and pick latest-at-or-before per source', () => {
  // One frame per second; a move's server/p0 snapshots in the same second
  // collapse to one frame. p1 lags a full second behind the server here.
  const frames = buildReplayTimeline({
    server: [snap(1000, { board: { 44: 'א' } }), snap(2000, { board: { 44: 'א', 45: 'ב' }, host: 5 })],
    p0:     [snap(1000, { board: { 44: 'א' } }), snap(3000, { board: { 44: 'א', 45: 'ב' }, host: 5 })],
    p1:     [snap(1000, { board: { 44: 'א' } })], // p1 never advances past v1
  });
  assert.deepEqual(frames.map(f => f.t), [1000, 2000, 3000]);

  // Second 2: server has the new tile but p0 + p1 are still on the old board.
  assert.equal(frames.find(f => f.t === 2000).diverged, true, 'lagging clients flagged');
  // Second 3: p0 caught up (matches server); p1 still behind → still diverged.
  assert.equal(frames.find(f => f.t === 3000).diverged, true);
});

test('no divergence when boards + scores agree (even if other fields differ)', () => {
  // Same board and scores, but turnNumber off by one between the two views —
  // this is the timing artifact that must NOT flag as "לא תואם".
  const a = { serverTimestamp: 5000, board: flat({ 44: 'ש' }), compact: { hostScore: 102, guestScore: 33, turnNumber: 14 } };
  const b = { serverTimestamp: 5000, board: flat({ 44: 'ש' }), compact: { hostScore: 102, guestScore: 33, turnNumber: 15 } };
  const frames = buildReplayTimeline({ server: [a], p0: [a], p1: [b] });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].diverged, false, 'identical outcome → no divergence despite turnNumber drift');
});

test('divergence flags a genuinely different board outcome', () => {
  const frames = framesFromTimeline({
    snapshots:       [snap(1000, { board: { 44: 'א' } })],
    clientSnapshots: { 0: [snap(1000, { board: { 44: 'א' } })], 1: [snap(1000, { board: { 44: 'ב' } })] },
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].diverged, true, 'different placed tile is a real divergence');
});

test('buildReplayTimeline attaches bonuses to the second they occurred in', () => {
  const assignment = Array.from({ length: 12 }, (_, i) => ({ type: `B${i + 1}` }));
  const srv = (t, tiles) => ({ serverTimestamp: t, board: flat(tiles), compact: {}, bonusAssignment: assignment });
  const ev = (t, payload) => ({ serverTimestamp: t, type: 'BOOST_ACTIVATED', payload });

  const frames = buildReplayTimeline({
    server: [srv(1000, { 44: 'א' }), srv(2000, { 44: 'א', 45: 'ב' })],
    events: [
      ev(2100, { slot: 0, boostId: 'extra_turn', bonusIdx: 2, extra: 0 }), // second 2
      ev(2100, { slot: 0, boostId: 'extra_turn', bonusIdx: 2, extra: 0 }), // duplicate (other client)
      ev(2200, { slot: 1, boostId: 'auto_extra_score', bonusIdx: 8, extra: 25 }),
      ev(2200, { slot: 0, boostId: 'free_tile_swap', bonusIdx: 3, consumed: true }), // skipped
    ],
  });

  const f1 = frames.find(f => f.t === 1000);
  const f2 = frames.find(f => f.t === 2000);
  assert.equal(f1.bonuses.length, 0, 'nothing in the first second');
  assert.equal(f2.bonuses.length, 2, 'deduped + consumed dropped');
  const extraTurn = f2.bonuses.find(b => b.boostId === 'extra_turn');
  assert.equal(extraTurn.bonusType, 'B3', 'bonusIdx 2 → bonusAssignment[2].type');
  const award = f2.bonuses.find(b => b.boostId === 'auto_extra_score');
  assert.equal(award.extra, 25);
  assert.equal(award.bonusType, 'B9');
});

test('snapshotOutcomeKey ignores turn/bag fields, keys on board + scores', () => {
  const base = { board: flat({ 22: 'ל' }), compact: { hostScore: 10, guestScore: 7, turnNumber: 3, tileBagCount: 40 } };
  const drift = { board: flat({ 22: 'ל' }), compact: { hostScore: 10, guestScore: 7, turnNumber: 4, tileBagCount: 38 } };
  assert.equal(snapshotOutcomeKey(base), snapshotOutcomeKey(drift));
  assert.equal(snapshotOutcomeKey(null), null);
});
