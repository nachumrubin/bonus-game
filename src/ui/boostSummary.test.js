import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeBoostSummary } from './boostSummary.js';

const summary = (over) => describeBoostSummary({ bonusType: null, kind: null, extra: 0, effects: [], ...over });

test('describeBoostSummary: null / malformed input yields null', () => {
  assert.equal(describeBoostSummary(null), null);
  assert.equal(describeBoostSummary('x'), null);
});

test('describeBoostSummary: a mini-game is named by the game, with its points', () => {
  const s = summary({ bonusType: 'B3', kind: 'minigame', extra: 15,
    effects: [{ boostId: 'auto_extra_score', payload: { extra: 15 } }] });
  assert.equal(s.name, 'אנגרמה');
  assert.equal(s.icon, '⚡');
  assert.equal(s.showPoints, true);
  assert.equal(s.text, '⚡ אנגרמה +15');
});

test('describeBoostSummary: a failed mini-game still shows +0', () => {
  const s = summary({ bonusType: 'B8', kind: 'minigame', extra: 0 });
  assert.equal(s.text, '⚡ תשבץ +0');
});

test('describeBoostSummary: wheel points use the wheel icon', () => {
  const s = summary({ bonusType: 'B13', kind: 'wheel', extra: 30,
    effects: [{ boostId: 'auto_extra_score', payload: { extra: 30 } }] });
  assert.equal(s.text, '🎡 גלגל המזל +30');
});

test('describeBoostSummary: a flat points square', () => {
  const s = summary({ bonusType: 'B2', extra: 40, effects: [{ boostId: 'auto_extra_score', payload: { extra: 40 } }] });
  assert.equal(s.text, '⚡ בוסט ניקוד +40');
});

test('describeBoostSummary: every future effect is named, without points', () => {
  const cases = [
    ['extra_turn', {}, '🎯 תור נוסף'],
    ['multiply_next_turns', { multiplier: 2, turnsRemaining: 1 }, '✖️ הכפלת ניקוד ×2'],
    ['timer_bonus', { seconds: 15 }, '⏱️ בוסט זמן'],
    ['free_tile_swap', {}, '🔄 החלפת אות חינם'],
    ['skip_opponent_turn', {}, '⏭️ דילוג על תור היריב'],
    ['cancel_next_opponent_bonus', {}, '🛡️ ביטול בוסט יריב'],
  ];
  for (const [boostId, payload, text] of cases) {
    const s = summary({ bonusType: 'B13', kind: 'wheel', effects: [{ boostId, payload }] });
    assert.equal(s.text, text, boostId);
    assert.equal(s.showPoints, false, boostId);
  }
});
