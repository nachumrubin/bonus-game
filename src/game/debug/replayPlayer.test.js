import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildReplayTimeline, framesFromTimeline } from './replayPlayer.js';

test('frames are ordered by time and pick latest-at-or-before per source', () => {
  const frames = buildReplayTimeline({
    server: [{ serverTimestamp: 10, hash: 'a', version: 1 }, { serverTimestamp: 20, hash: 'b', version: 2 }],
    p0:     [{ serverTimestamp: 10, hash: 'a' }, { serverTimestamp: 21, hash: 'b' }],
    p1:     [{ serverTimestamp: 10, hash: 'a' }], // p1 never advances past v1
  });
  // union of times: 10, 20, 21
  assert.deepEqual(frames.map(f => f.t), [10, 20, 21]);

  // At t=20 the server moved to hash 'b' but p1 is still on 'a' (lagging).
  const f20 = frames.find(f => f.t === 20);
  assert.equal(f20.server.hash, 'b');
  assert.equal(f20.p1.hash, 'a', 'p1 lags one move behind');
  assert.equal(f20.diverged, true, 'server vs p1 divergence flagged');

  // By t=21 p0 has caught up to 'b' (matches server); p1 still 'a' → still diverged.
  const f21 = frames.find(f => f.t === 21);
  assert.equal(f21.p0.hash, 'b');
  assert.equal(f21.diverged, true);
});

test('no divergence when all present sources agree', () => {
  const frames = buildReplayTimeline({
    server: [{ serverTimestamp: 5, hash: 'x' }],
    p0:     [{ serverTimestamp: 5, hash: 'x' }],
    p1:     [{ serverTimestamp: 5, hash: 'x' }],
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].diverged, false);
});

test('framesFromTimeline reads the getGameDebugTimeline shape', () => {
  const frames = framesFromTimeline({
    snapshots: [{ serverTimestamp: 1, hash: 'a' }],
    clientSnapshots: { 0: [{ serverTimestamp: 1, hash: 'a' }], 1: [{ serverTimestamp: 1, hash: 'b' }] },
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].diverged, true);
});
