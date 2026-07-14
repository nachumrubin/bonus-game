// Tests for the spectator overlay's pure formatters.
//
// formatPlayedMove is what tells the waiting opponent WHAT was played. Their
// board does receive the tiles now (the deferred commit in onlineGameSession),
// but this full-screen overlay covers it for the whole mini-game — so if this
// string is wrong/empty the opponent is back to staring at nothing for up to 60s.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatPlayedMove, formatProgress } from './bonusSpectatorScreen.js';

test('formatPlayedMove: shows the word and its base (pre-bonus) score', () => {
  assert.equal(
    formatPlayedMove({ words: ['בא'], moveScore: 12 }),
    'שיחק: בא (+12)',
  );
});

test('formatPlayedMove: joins multiple words formed by the same move', () => {
  assert.equal(
    formatPlayedMove({ words: ['בא', 'אב'], moveScore: 20 }),
    'שיחק: בא · אב (+20)',
  );
});

test('formatPlayedMove: omits the score when it is zero or missing', () => {
  assert.equal(formatPlayedMove({ words: ['בא'], moveScore: 0 }), 'שיחק: בא');
  assert.equal(formatPlayedMove({ words: ['בא'] }), 'שיחק: בא');
});

test('formatPlayedMove: empty when no move is known (auto bonus / older client)', () => {
  assert.equal(formatPlayedMove({}), '');
  assert.equal(formatPlayedMove({ words: [] }), '');
  assert.equal(formatPlayedMove(null), '');
  assert.equal(formatPlayedMove({ words: [null, ''] }), '');
});

test('formatProgress: falls back to the waiting line when there is no progress', () => {
  assert.equal(formatProgress(null), '⏳ ממתין לתוצאה...');
  assert.equal(formatProgress({}), '⏳ ממתין לתוצאה...');
});

test('formatProgress: composes label, score and seconds left', () => {
  assert.equal(
    formatProgress({ label: 'אנגרמה', score: 30, secsLeft: 12 }),
    'אנגרמה • 30 נקודות • ⏱ 12s',
  );
});
