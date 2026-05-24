import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { EV } from '../../events/eventTypes.js';
import { createAnimationController } from './animationController.js';

test('MOVE_CONFIRMED triggers the expected animation directives', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 4, c: 4, letter: 'א', val: 1 }],
    words: ['אב'],
    wordTiles: [[{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }]],
    score: 4,
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('tilePlaceIn'));
  assert.ok(kinds.includes('validFlash'));
  assert.ok(kinds.includes('scoringWordGlow'));
  // The score sequence is now a single merge directive — per-word chips
  // fly into a central sum chip, the sum grows, then the sum flies to the
  // player's score panel. See gameScreen.playScoreMergeSequence.
  assert.ok(kinds.includes('scoreMergeSequence'),
    'emitMoveAnimations should emit the merge directive for non-bonus moves');
  assert.ok(!kinds.includes('scoringPointsFloat'),
    'scoringPointsFloat is now handled inside the merge sequence renderer');
  assert.ok(!kinds.includes('scoreFlyToPanel'),
    'scoreFlyToPanel is now handled inside the merge sequence renderer');
  ac.dispose();
});

test('INVALID_MOVE_REJECTED triggers shakeWord + illegalPulse', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'has-gaps' });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('shakeWord'));
  assert.ok(kinds.includes('illegalPulse'));
  ac.dispose();
});

test('INVALID_MOVE_REJECTED forwards placed + invalidWords to renderer', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  const placed = [{ r: 4, c: 4, letter: 'א', val: 1 }];
  bus.emit(EV.INVALID_MOVE_REJECTED, { reason: 'word-not-in-dictionary', placed, invalidWords: ['אא'] });
  const shake = ac._directives.find(d => d.kind === 'shakeWord');
  const pulse = ac._directives.find(d => d.kind === 'illegalPulse');
  assert.deepEqual(shake.payload.placed, placed);
  assert.deepEqual(pulse.payload.placed, placed);
  assert.deepEqual(shake.payload.invalidWords, ['אא']);
  ac.dispose();
});

test('MOVE_CONFIRMED emits bingoLabel when all 8 tiles are placed', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });
  const placed = Array.from({ length: 8 }, (_, i) => ({ r: 4, c: i, letter: 'א', val: 1 }));
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed, words: ['אאאאאאאא'], wordTiles: [placed], score: 58 });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('bingoLabel'));
  ac.dispose();
});

test('MOVE_CONFIRMED skips bingoLabel for partial placements', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, {
    slot: 0, placed: [{ r: 4, c: 4, letter: 'א', val: 1 }], words: ['א'], score: 1,
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(!kinds.includes('bingoLabel'));
  ac.dispose();
});

test('MOVE_CONFIRMED emits multiplierLabel when more than one word is formed', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });
  bus.emit(EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 4, c: 4, letter: 'א', val: 1 }],
    words: ['אב', 'אג'],
    wordTiles: [[{ r: 4, c: 4 }], [{ r: 4, c: 4 }]],
    score: 6,
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('multiplierLabel'));
  ac.dispose();
});

test('BOOST_ACTIVATED triggers a bonusAwardOverlay directive', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  bus.emit(EV.BOOST_ACTIVATED, {
    slot: 1, boostId: 'auto_extra_score', bonusIdx: 4, payload: { extra: 25 },
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('bonusAwardOverlay'),
    'every fresh bonus-square activation opens the modal award overlay');
  ac.dispose();
});

test('BOOST_ACTIVATED with consumed=true skips the overlay', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'free_tile_swap', consumed: true });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(!kinds.includes('bonusAwardOverlay'),
    'consumption events reuse BOOST_ACTIVATED but should not re-open the modal');
  ac.dispose();
});

test('BOOST_ACTIVATED for a future effect (extra_turn) also opens the overlay', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'extra_turn', bonusIdx: 2, payload: {} });
  const directive = ac._directives.find(d => d.kind === 'bonusAwardOverlay');
  assert.ok(directive, 'future-effect boosts must show the same modal overlay');
  assert.equal(directive.payload.boostId, 'extra_turn');
  ac.dispose();
});

test('BOOST_ACTIVATED for the opponent slot does NOT open the overlay when mySlot is pinned', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });
  bus.emit(EV.BOOST_ACTIVATED, {
    slot: 1, boostId: 'auto_extra_score', bonusIdx: 4, payload: { extra: 25 },
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(!kinds.includes('bonusAwardOverlay'),
    "an opponent's bonus must not pop a modal on our screen");
  // The non-modal feedback (square flash, badge pulse) should still run.
  assert.ok(kinds.includes('bonusActivate'));
  assert.ok(kinds.includes('boostPulse'));
  ac.dispose();
});

test('BOOST_ACTIVATED opens the overlay for any slot when mySlot is null (2P offline)', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  bus.emit(EV.BOOST_ACTIVATED, {
    slot: 1, boostId: 'auto_extra_score', bonusIdx: 4, payload: { extra: 25 },
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('bonusAwardOverlay'),
    'shared-screen 2P needs the overlay for both players');
  ac.dispose();
});

test('OPPONENT_MOVED triggers tile placement and score animations', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });
  bus.emit(EV.OPPONENT_MOVED, {
    slot: 1, placed: [{ r: 5, c: 5, letter: 'ב', val: 3 }], words: ['ב'],
    wordTiles: [[{ r: 5, c: 5, letter: 'ב', val: 3 }]],
    score: 3,
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('tilePlaceIn'));
  assert.ok(kinds.includes('scoringWordGlow'));
  assert.ok(kinds.includes('scoreMergeSequence'),
    'opponent moves also use the merge sequence');
  assert.ok(!kinds.includes('scoringPointsFloat'));
  assert.ok(!kinds.includes('scoreFlyToPanel'));
  ac.dispose();
});

test('MOVE_CONFIRMED carries wordTiles through scoring directives', () => {
  bus._reset();
  const ac = createAnimationController({ bus, mySlot: 0 });
  const wordTiles = [[{ r: 4, c: 4, letter: 'א', val: 1 }]];
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [], words: ['א'], wordTiles, score: 1 });
  // The per-word glow still carries each word's tiles individually; the
  // merge sequence carries the per-word breakdown for rendering.
  const glow = ac._directives.find(d => d.kind === 'scoringWordGlow');
  assert.deepEqual(glow.payload.wordTiles, [wordTiles[0]]);
  const merge = ac._directives.find(d => d.kind === 'scoreMergeSequence');
  assert.ok(merge, 'scoreMergeSequence directive should be emitted');
  assert.equal(merge.payload.words.length, 1);
  assert.deepEqual(merge.payload.words[0].wordTiles, wordTiles[0]);
  ac.dispose();
});

test('GAME_COMPLETED triggers panel arrive + overlay card', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  bus.emit(EV.GAME_COMPLETED, { winnerSlot: 0 });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('scorePanelArrive'));
  assert.ok(kinds.includes('overlayCardIn'));
  ac.dispose();
});

test('BOOST_ACTIVATED triggers bonusActivate + boostPulse', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'double_score', bonusIdx: 2 });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('bonusActivate'));
  assert.ok(kinds.includes('boostPulse'));
  assert.equal(ac._directives.find(d => d.kind === 'bonusActivate').payload.bonusIdx, 2);
  ac.dispose();
});

test('setEnabled(false) makes all triggers no-ops at the renderer level', () => {
  bus._reset();
  let rendererCalls = 0;
  const ac = createAnimationController({ bus });
  ac.setRenderer({
    tilePlaceIn:        () => { rendererCalls++; },
    validFlash:         () => { rendererCalls++; },
    scoringWordGlow:    () => { rendererCalls++; },
    scoringPointsFloat: () => { rendererCalls++; },
    scorePop:           () => { rendererCalls++; },
  });
  ac.setEnabled(false);
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [], words: [], score: 0 });
  // Directives still recorded internally (so we can replay them later)
  // but renderer was not invoked
  assert.equal(rendererCalls, 0);
  // Re-enable: subsequent events trigger the renderer
  ac.setEnabled(true);
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [], words: [], score: 0 });
  assert.ok(rendererCalls > 0);
  ac.dispose();
});

test('renderer errors do not break the controller', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  ac.setRenderer({
    tilePlaceIn: () => { throw new Error('boom'); },
    validFlash: () => {},
  });
  const _origWarn = console.warn;
  console.warn = () => {};
  try {
    bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [], words: [], score: 0 });
    // Should still have triggered subsequent directives despite tilePlaceIn throw
    const kinds = ac._directives.map(d => d.kind);
    assert.ok(kinds.includes('validFlash'));
  } finally {
    console.warn = _origWarn;
  }
  ac.dispose();
});

test('dispose stops directive logging', () => {
  bus._reset();
  const ac = createAnimationController({ bus });
  ac.dispose();
  bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: [], words: [], score: 0 });
  assert.equal(ac._directives.length, 0);
});
