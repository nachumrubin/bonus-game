import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeBoardView, legalSquares, planReplacements, validatePlacements } from './boostPlacement.js';
import { bridgeBuilder, longWord, letterHunt } from './challengeCatalog.js';
import { createEmptyBoard } from '../core/board.js';
import { RULES } from './testHelpers.js';

const BR = bridgeBuilder(RULES);
const LW = longWord(RULES, 'EASY');
const LH = letterHunt(RULES, 'EASY', 'ל');
const DEFS = { [BR.definitionId]: BR, [LW.definitionId]: LW, [LH.definitionId]: LH };
const T = { letter: 'א', val: 1 };

function boardWith(cells) {
  const b = createEmptyBoard();
  for (const [r, c] of cells) b[r][c] = { ...T };
  return b;
}

test('legal squares: empty, not a Boost, within Manhattan distance 2 of a tile (post-move board)', () => {
  const view = makeBoardView(boardWith([[4, 4]]), [{ r: 4, c: 5 }]);
  const legal = legalSquares({ view, blocked: [{ r: 4, c: 3 }], rules: RULES });
  const has = (r, c) => legal.some(s => s.r === r && s.c === c);
  assert.ok(!has(4, 4), 'occupied');
  assert.ok(!has(4, 5), 'newly occupied by this move');
  assert.ok(!has(4, 3), 'already a Boost');
  assert.ok(has(4, 2), 'distance 2');
  assert.ok(has(4, 7), 'distance 2 from the newly placed tile');
  assert.ok(!has(4, 8), 'distance 3');
  assert.ok(has(3, 6), 'diagonal = distance 2');
  assert.ok(!has(2, 6), 'distance 3');
  for (const s of legal) assert.ok(s.r >= 0 && s.r < 10 && s.c >= 0 && s.c < 10);
});

test('plan: placeable = min(entries, legal squares), FIFO prefix', () => {
  const entries = [{ instanceId: 'a', definitionId: LW.definitionId }, { instanceId: 'b', definitionId: LH.definitionId }];
  assert.equal(planReplacements({ entries, legal: [{ r: 0, c: 0 }, { r: 9, c: 9 }] }).placeable, 2);
  const one = planReplacements({ entries, legal: [{ r: 0, c: 0 }] });
  assert.equal(one.placeable, 1);
  assert.deepEqual(one.effective.map(e => e.instanceId), ['a'], 'the first entry in FIFO order is placed');
  const none = planReplacements({ entries, legal: [] });
  assert.equal(none.placeable, 0);
  assert.deepEqual(none.effective, []);
});

test('Bridge Builder has no placement rule: it goes on any legal square, no fallback (rules 0.3)', () => {
  assert.equal(BR.fallbackDefinitionId, undefined);
  const entries = [{ instanceId: 'br', definitionId: BR.definitionId }];
  const legal = [{ r: 3, c: 5 }];
  const plan = planReplacements({ entries, legal });
  assert.equal(plan.placeable, 1);
  assert.equal(plan.effective[0].effectiveDefinitionId, BR.definitionId);
  // Not in line with any other Boost — still accepted.
  assert.ok(validatePlacements({ plan, placements: [{ r: 3, c: 5 }], legal }).ok);
});

test('placement validation: count, duplicates, illegal squares, FIFO order', () => {
  const entries = [{ instanceId: 'a', definitionId: LW.definitionId }, { instanceId: 'b', definitionId: LH.definitionId }];
  const legal = [{ r: 0, c: 0 }, { r: 0, c: 1 }];
  const plan = planReplacements({ entries, legal });
  const v = (placements) => validatePlacements({ plan, placements, legal });
  assert.equal(v([{ r: 0, c: 0 }]).reason, 'boost-placement-count');
  assert.equal(v([{ r: 0, c: 0 }, { r: 0, c: 0 }]).reason, 'boost-placement-duplicate');
  assert.equal(v([{ r: 0, c: 0 }, { r: 9, c: 9 }]).reason, 'boost-placement-illegal');
  assert.equal(v([{ r: 0, c: 0, instanceId: 'b' }, { r: 0, c: 1, instanceId: 'a' }]).reason, 'boost-placement-order');
  assert.ok(v([{ r: 0, c: 0, instanceId: 'a' }, { r: 0, c: 1, instanceId: 'b' }]).ok);
});

test('plan.arrangement is itself a valid submission (auto placement never deadlocks)', () => {
  const entries = [
    { instanceId: 'b1', definitionId: BR.definitionId },
    { instanceId: 'x', definitionId: LW.definitionId },
    { instanceId: 'b2', definitionId: BR.definitionId },
  ];
  const view = makeBoardView(boardWith([[4, 4], [4, 5]]), []);
  const legal = legalSquares({ view, rules: RULES });
  const plan = planReplacements({ entries, legal });
  assert.equal(plan.placeable, 3);
  assert.ok(validatePlacements({ plan, placements: plan.arrangement, legal }).ok);
});
