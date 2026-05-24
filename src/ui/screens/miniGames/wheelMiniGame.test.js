import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../../events/bus.js';
import { WHEEL_OUTCOMES } from '../../../game/boosts/bonusTileDefs.js';
import {
  pickOutcome, labelFor, mountWheelMiniGame, listOutcomes, WHEEL_INTENT,
} from './wheelMiniGame.js';

test('listOutcomes returns the wheel outcomes table', () => {
  const out = listOutcomes();
  assert.equal(out.length, WHEEL_OUTCOMES.length);
});

test('pickOutcome: deterministic with seed', () => {
  let n = 0;
  const rng = () => [0.0, 0.4999, 0.999][n++ % 3];
  const a = pickOutcome(rng).id;
  const b = pickOutcome(rng).id;
  const c = pickOutcome(rng).id;
  // Across the [0,1) range we should hit different segments
  assert.ok(a !== b || b !== c);
});

test('pickOutcome: weighted picks respect weights', () => {
  // Weight only the FIRST outcome → always picks that one
  const weights = WHEEL_OUTCOMES.map((_, i) => i === 0 ? 1 : 0);
  for (let i = 0; i < 5; i++) {
    assert.equal(pickOutcome(() => Math.random(), weights).id, WHEEL_OUTCOMES[0].id);
  }
});

test('labelFor: known outcome ids', () => {
  assert.match(labelFor({ id: 'extra_turn'   }), /תור נוסף/);
  assert.match(labelFor({ id: 'tile_swap'    }), /החלפת אות/);
  assert.match(labelFor({ id: 'cancel_boost' }), /ביטול בוסט/);
  assert.match(labelFor({ id: 'pts_50',  label: '+50 נקודות' }), /50/);
});

test('mount (no-DOM): spin fires WHEEL_INTENT.RESULT with the chosen outcome', () => {
  bus._reset();
  const events = [];
  bus.on(WHEEL_INTENT.RESULT, (r) => events.push(r));
  const wheel = mountWheelMiniGame({ bus, rng: () => 0, doc: null });
  assert.equal(wheel._chosen, WHEEL_OUTCOMES[0]);
  wheel.spin();
  assert.equal(events.length, 1);
  assert.equal(events[0].outcomeId, WHEEL_OUTCOMES[0].id);
});

test('mount (no-DOM): unmount before spin still fires (graceful failure)', () => {
  bus._reset();
  const events = [];
  bus.on(WHEEL_INTENT.RESULT, (r) => events.push(r));
  const wheel = mountWheelMiniGame({ bus, rng: () => 0.5, doc: null });
  wheel.unmount();
  assert.equal(events.length, 1);
});

test('mount (no-DOM): result fires only once', () => {
  bus._reset();
  const events = [];
  bus.on(WHEEL_INTENT.RESULT, (r) => events.push(r));
  const wheel = mountWheelMiniGame({ bus, rng: () => 0, doc: null });
  wheel.spin();
  wheel.spin();
  wheel.unmount();
  assert.equal(events.length, 1);
});

test('throws if bus is missing', () => {
  assert.throws(() => mountWheelMiniGame({}), /bus required/);
});
