import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoTimeline } from './demoTimeline.js';
import { framesFromTimeline, buildTimeline } from './replayPlayer.js';

// These assertions pin the demo game's REPLAY behaviour. If a future change to
// the timeline builder, divergence rule, or bonus merge breaks the replayer,
// one of these fails — that's the point: the demo is the regression guard.

test('demo timeline builds one frame per second (so one step moves all 3 boards)', () => {
  const frames = framesFromTimeline(buildDemoTimeline());
  // Seconds 0..7 (game start, six moves, guest catch-up) — NOT three frames per
  // move. Each frame's t is the second boundary.
  assert.deepEqual(frames.map(f => f.t), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
});

test('demo timeline diverges across the multi-second lag, then recovers', () => {
  const frames = framesFromTimeline(buildDemoTimeline());
  const at = (t) => frames.find(f => f.t === t);
  assert.equal(at(5000).diverged, true, 'guest has no second-5 snapshot (lags turn 4)');
  assert.equal(at(6000).diverged, true, 'guest still one move behind in second 6');
  assert.equal(at(7000).diverged, false, 'guest caught up by second 7');
  for (const t of [0, 1000, 2000, 3000, 4000]) {
    assert.equal(at(t).diverged, false, `frame ${t} should agree`);
  }
});

test('demo timeline surfaces both boost mini-games (deduped)', () => {
  const frames = framesFromTimeline(buildDemoTimeline());
  const at = (t) => frames.find(f => f.t === t);

  const t3 = at(3000).bonuses;
  assert.equal(t3.length, 1, 'the duplicate boost log is collapsed');
  assert.equal(t3[0].bonusType, 'B11', 'bonusIdx 0 → bonusAssignment[0].type');
  assert.equal(t3[0].boostId, 'auto_extra_score');
  assert.equal(t3[0].extra, 100);

  const t5 = at(5000).bonuses;
  assert.equal(t5.length, 1);
  assert.equal(t5[0].bonusType, 'B13', 'wheel square');
  assert.equal(t5[0].boostId, 'extra_turn');

  // No bonuses on the quiet seconds.
  for (const t of [0, 1000, 2000, 4000, 6000, 7000]) {
    assert.equal(at(t).bonuses.length, 0, `frame ${t} has no bonus`);
  }
});

test('demo timeline collapses each second to ONE row (cells are per-second arrays)', () => {
  const rows = buildTimeline(buildDemoTimeline());
  // One row per second; rows are time-ordered and unique.
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k].t > rows[k - 1].t);
  const at = (t) => rows.find(r => r.t === t);
  const has = (cell, re) => cell.some(x => re.test(x));

  // Second 0 (the 500ms GAME_STARTED): both players, no server version → blank.
  assert.deepEqual(at(0).srv, [], 'server blank when no version that second');
  assert.ok(has(at(0).p0, /Game started/));
  assert.ok(has(at(0).p1, /Game started/));

  // Second 1 (host move @1000 + turn change @1001 share one row): host has both,
  // server has v1, guest has only the shared turn change (it did not move).
  assert.ok(at(1000).srv[0].startsWith('v1'));
  assert.ok(has(at(1000).p0, /played שלום/));
  assert.ok(has(at(1000).p0, /turn 2/));
  assert.ok(has(at(1000).p1, /turn 2/));
  assert.ok(!has(at(1000).p1, /played/), 'guest did not move this second');

  // Second 2: guest moved; host saw only the turn change.
  assert.ok(has(at(2000).p1, /played לפיד/));
  assert.ok(!has(at(2000).p0, /played/));

  // Second 3: host move + boost collapse into the host cell.
  assert.ok(has(at(3000).p0, /played יום/));
  assert.ok(has(at(3000).p0, /Boost auto_extra_score/));
});

test('demo timeline carries boost-square render data + final score', () => {
  const frames = framesFromTimeline(buildDemoTimeline());
  const last = frames[frames.length - 1];
  assert.equal(last.server.compact.hostScore, 152);
  assert.equal(last.server.compact.guestScore, 58);
  assert.equal(last.server.bonusSqUsed['0'], true, 'top boost square consumed');
  assert.equal(last.server.bonusSqUsed['5'], true, 'wheel boost square consumed');
  assert.equal(last.server.bonusBoard['-1,1'].letter, 'ק', 'tile dropped on the top boost square');
});
