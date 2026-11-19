import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeBoardView, legalSquares, findArrangement, planReplacements, validatePlacements, isAligned,
} from './boostPlacement.js';
import { bridgeBuilder, longWord, letterHunt } from './challengeCatalog.js';
import { createEmptyBoard } from '../core/board.js';
import { RULES } from './testHelpers.js';

const BR = bridgeBuilder(RULES);
const LW = longWord(RULES, 'EASY');
const FB = longWord(RULES, 'HARD', 8);
const LH = letterHunt(RULES, 'EASY', 'ל');
const DEFS = { [BR.definitionId]: BR, [LW.definitionId]: LW, [FB.definitionId]: FB, [LH.definitionId]: LH };
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

test('isAligned: same row or column with another Boost', () => {
  assert.ok(isAligned({ r: 2, c: 2 }, [{ r: 2, c: 8 }]));
  assert.ok(isAligned({ r: 2, c: 2 }, [{ r: 7, c: 2 }]));
  assert.ok(!isAligned({ r: 2, c: 2 }, [{ r: 3, c: 3 }]));
  assert.ok(!isAligned({ r: 2, c: 2 }, [{ r: 2, c: 2 }]), 'itself does not count');
});

test('plan: no Bridge → placeable = min(entries, legal squares)', () => {
  const entries = [{ instanceId: 'a', definitionId: LW.definitionId }, { instanceId: 'b', definitionId: LH.definitionId }];
  assert.equal(planReplacements({ entries, definitions: DEFS, legal: [{ r: 0, c: 0 }, { r: 9, c: 9 }] }).placeable, 2);
  assert.equal(planReplacements({ entries, definitions: DEFS, legal: [{ r: 0, c: 0 }] }).placeable, 1);
  const none = planReplacements({ entries, definitions: DEFS, legal: [] });
  assert.equal(none.placeable, 0);
  assert.deepEqual(none.effective, []);
});

test('Bridge: valid aligned placement accepted, unaligned rejected', () => {
  const entries = [{ instanceId: 'br', definitionId: BR.definitionId }];
  const legal = [{ r: 2, c: 2 }, { r: 3, c: 5 }];
  const fixed = [{ r: 2, c: 7 }];
  const plan = planReplacements({ entries, definitions: DEFS, legal, fixed });
  assert.equal(plan.effective[0].fallbackApplied, false);
  assert.ok(validatePlacements({ plan, placements: [{ r: 2, c: 2 }], legal, fixed, definitions: DEFS }).ok);
  assert.equal(validatePlacements({ plan, placements: [{ r: 3, c: 5 }], legal, fixed, definitions: DEFS }).reason, 'bridge-not-aligned');
});

test('Bridge: no legal aligned placement → automatic predetermined fallback', () => {
  const entries = [{ instanceId: 'br', definitionId: BR.definitionId }];
  const legal = [{ r: 3, c: 5 }];
  const plan = planReplacements({ entries, definitions: DEFS, legal, fixed: [{ r: 2, c: 7 }] });
  assert.equal(plan.placeable, 1);
  assert.equal(plan.effective[0].fallbackApplied, true);
  assert.equal(plan.effective[0].effectiveDefinitionId, BR.fallbackDefinitionId);
  assert.ok(validatePlacements({ plan, placements: [{ r: 3, c: 5 }], legal, fixed: [{ r: 2, c: 7 }], definitions: DEFS }).ok);
});

test('Bridge: multi-replacement alignment validated against the final proposed layout', () => {
  // No fixed Boosts at all — the Bridge can only align with its batch partner.
  const entries = [{ instanceId: 'br', definitionId: BR.definitionId }, { instanceId: 'x', definitionId: LW.definitionId }];
  const legal = [{ r: 1, c: 1 }, { r: 1, c: 6 }, { r: 5, c: 3 }];
  const plan = planReplacements({ entries, definitions: DEFS, legal, fixed: [] });
  assert.equal(plan.effective[0].fallbackApplied, false, 'kept: partner can be aligned in the same batch');
  assert.ok(validatePlacements({ plan, placements: [{ r: 1, c: 1 }, { r: 1, c: 6 }], legal, fixed: [], definitions: DEFS }).ok);
  assert.equal(validatePlacements({ plan, placements: [{ r: 1, c: 1 }, { r: 5, c: 3 }], legal, fixed: [], definitions: DEFS }).reason, 'bridge-not-aligned');
});

test('Bridge: with two Bridges that cannot both be kept, the later one falls back', () => {
  const entries = [{ instanceId: 'b1', definitionId: BR.definitionId }, { instanceId: 'b2', definitionId: BR.definitionId }];
  const legal = [{ r: 0, c: 0 }, { r: 5, c: 5 }];
  const fixed = [{ r: 0, c: 9 }];
  const plan = planReplacements({ entries, definitions: DEFS, legal, fixed });
  assert.deepEqual(plan.effective.map(e => e.fallbackApplied), [false, true]);
});

test('placement validation: count, duplicates, illegal squares, FIFO order', () => {
  const entries = [{ instanceId: 'a', definitionId: LW.definitionId }, { instanceId: 'b', definitionId: LH.definitionId }];
  const legal = [{ r: 0, c: 0 }, { r: 0, c: 1 }];
  const plan = planReplacements({ entries, definitions: DEFS, legal });
  const v = (placements) => validatePlacements({ plan, placements, legal, definitions: DEFS });
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
  const plan = planReplacements({ entries, definitions: DEFS, legal });
  assert.equal(plan.placeable, 3);
  assert.ok(validatePlacements({ plan, placements: plan.arrangement, legal, definitions: DEFS }).ok);
});

test('findArrangement terminates quickly on an impossible Bridge batch', () => {
  const legal = [];
  for (let i = 0; i < 10; i++) legal.push({ r: i, c: i }); // no two share a row/column
  const t0 = Date.now();
  assert.equal(findArrangement([true], legal, []), null);
  assert.equal(findArrangement([true, true, true], legal, []), null);
  assert.ok(Date.now() - t0 < 1000);
});
