import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maybeShow, buildSignature, _resetForTests } from './asyncTurnBanner.js';

function captureShow() {
  const calls = [];
  return { fn: (opts) => calls.push(opts), calls };
}

test('buildSignature: stable across order', () => {
  const a = [
    { roomId: 'b', isMyTurn: true },
    { roomId: 'a', isMyTurn: true },
    { roomId: 'c', isMyTurn: false },
  ];
  const b = [
    { roomId: 'a', isMyTurn: true },
    { roomId: 'b', isMyTurn: true },
  ];
  assert.equal(buildSignature(a), buildSignature(b));
  assert.equal(buildSignature(a), 'a|b');
});

test('maybeShow: no-uid bails', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  const r = maybeShow({ sessions: [{ isMyTurn: true, roomId: 'x' }], show: fn });
  assert.equal(r.shown, false);
  assert.equal(r.reason, 'no-uid');
  assert.equal(calls.length, 0);
});

test('maybeShow: no-my-turn skips', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  const r = maybeShow({ uid: 'u', sessions: [{ isMyTurn: false }], show: fn });
  assert.equal(r.shown, false);
  assert.equal(r.reason, 'no-my-turn');
  assert.equal(calls.length, 0);
});

test('maybeShow: single my-turn shows opponent-named text', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  const r = maybeShow({
    uid: 'u',
    sessions: [{ roomId: 'r1', isMyTurn: true, opponentName: 'דני' }],
    now: 1000, show: fn,
  });
  assert.equal(r.shown, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /דני/);
  assert.match(calls[0].text, /תורך/);
});

test('maybeShow: multiple my-turn shows count', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  maybeShow({
    uid: 'u',
    sessions: [
      { roomId: 'a', isMyTurn: true, opponentName: 'X' },
      { roomId: 'b', isMyTurn: true, opponentName: 'Y' },
    ],
    show: fn,
  });
  assert.match(calls[0].text, /2 משחקים/);
});

test('maybeShow: dedups same signature within window', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  const sessions = [{ roomId: 'a', isMyTurn: true, opponentName: 'X' }];
  maybeShow({ uid: 'u', sessions, now: 1000, show: fn });
  const r2 = maybeShow({ uid: 'u', sessions, now: 30_000, show: fn });
  assert.equal(r2.shown, false);
  assert.equal(r2.reason, 'deduped');
  assert.equal(calls.length, 1);
});

test('maybeShow: signature change after dedup window re-shows', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  maybeShow({
    uid: 'u',
    sessions: [{ roomId: 'a', isMyTurn: true, opponentName: 'X' }],
    now: 1000, show: fn,
  });
  // Same signature past the window → re-shows
  maybeShow({
    uid: 'u',
    sessions: [{ roomId: 'a', isMyTurn: true, opponentName: 'X' }],
    now: 1000 + 90_000, show: fn,
  });
  assert.equal(calls.length, 2);
});

test('maybeShow: different signature within window re-shows', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  maybeShow({
    uid: 'u',
    sessions: [{ roomId: 'a', isMyTurn: true, opponentName: 'X' }],
    now: 1000, show: fn,
  });
  // Same window, but a NEW room arrived
  maybeShow({
    uid: 'u',
    sessions: [
      { roomId: 'a', isMyTurn: true, opponentName: 'X' },
      { roomId: 'b', isMyTurn: true, opponentName: 'Y' },
    ],
    now: 30_000, show: fn,
  });
  assert.equal(calls.length, 2);
});

test('maybeShow: per-uid dedup; different users do not interfere', () => {
  _resetForTests();
  const { fn, calls } = captureShow();
  const sessions = [{ roomId: 'a', isMyTurn: true, opponentName: 'X' }];
  maybeShow({ uid: 'u1', sessions, now: 1000, show: fn });
  maybeShow({ uid: 'u2', sessions, now: 1000, show: fn });
  assert.equal(calls.length, 2);
});
