// Scoring animation + display timing parity vs. legacy runScoringAnimation.
//
// Legacy authority (HEAD:index.html):
//   - runScoringAnimation at line 6844: word-glow → per-word "+N" floats →
//     extras overlay (bingo "+50", "×4"/"×2" multiplier, bonus extra) →
//     fly-to-panel total → releaseScoreDisplayHold.
//   - Hard rule preserved in the spine plan: animations are visual only;
//     engine state mutates synchronously on MOVE_CONFIRMED regardless of
//     whether/how the animation runs.
//
// What the existing animationController.test.js already covers:
//   - Single-word MOVE_CONFIRMED triggers tilePlaceIn / validFlash /
//     scoringWordGlow / scoreFlyToPanel / scorePop.
//   - INVALID_MOVE_REJECTED triggers shakeWord + illegalPulse.
//
// What this test adds — the gap-report-specific scenarios:
//   • Multi-word move emits one scoringPointsFloat per scoring word,
//     staggered, plus a single scoreFlyToPanel total.
//   • multiplierLabel directive fires when ≥ 2 words form.
//   • bingoLabel directive fires when 8 tiles are placed (rack-out).
//   • Auto-extra-score boost emits a describable score-bonus event with
//     the right slot + extra.
//   • Engine state is independent of animation completion: with the
//     controller disabled, the player's score, rack, and turn still advance
//     correctly on MOVE_CONFIRMED.
//   • Word-tile payload payload preserved on every glow + per-word float
//     so the renderer can highlight exactly the tiles the engine scored.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import('../../src/events/bus.js'),
    import('../../src/events/eventTypes.js'),
    import('../../src/events/commands.js'),
    import('../../src/game/core/hebrewDictionary.js'),
    import('../../src/game/sessions/localGameSession.js'),
    import('../../src/ui/controllers/animationController.js'),
    import('../../src/ui/controllers/scoreBonusAnimation.js'),
  ]).then(([bus, events, commands, dict, session, anim, scoreBonus]) => ({
    bus, events, commands, dict, session, anim, scoreBonus,
  }));
  return modulesPromise;
}

const PLAYERS = { 0: { uid: 'a', displayName: 'A' }, 1: { uid: 'b', displayName: 'B' } };

// ───────────────────────────────────────────────────────────────────────
// 1. Multi-word move: one per-word float per scoring word + one total fly.
test('parity: multi-word move emits one scoringPointsFloat per scoring word, staggered', async () => {
  const m = await loadModules();
  m.bus._reset();
  const ac = m.anim.createAnimationController({ bus: m.bus, mySlot: 0 });

  // Three words on the move (main + 2 cross), staggered scores.
  const wordTiles = [
    [{ r: 5, c: 5, letter: 'א', val: 1 }, { r: 5, c: 6, letter: 'ב', val: 3 }, { r: 5, c: 7, letter: 'ג', val: 5 }], // main: 9
    [{ r: 4, c: 5, letter: 'ד', val: 3 }, { r: 5, c: 5, letter: 'א', val: 1 }],                                       // cross 1: 4
    [{ r: 4, c: 6, letter: 'ה', val: 4 }, { r: 5, c: 6, letter: 'ב', val: 3 }],                                       // cross 2: 7
  ];
  m.bus.emit(m.events.EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 5, c: 5, letter: 'א', val: 1 }, { r: 5, c: 6, letter: 'ב', val: 3 }, { r: 5, c: 7, letter: 'ג', val: 5 }],
    words: ['אבג', 'דא', 'הב'],
    wordTiles,
    score: 20,
  });

  const floats = ac._directives.filter(d => d.kind === 'scoringPointsFloat');
  assert.equal(floats.length, 3, 'one per-word float per scoring word');

  // Per-word scores match sum-of-tile-values.
  assert.deepEqual(floats.map(f => f.payload.score), [9, 4, 7]);
  // Staggered: 0ms, 300ms, 600ms (the WORD_STAGGER_MS spacing).
  assert.deepEqual(floats.map(f => f.payload.delayMs), [0, 300, 600]);
  // Each float carries the wordTiles for ITS word only.
  assert.equal(floats[0].payload.wordTiles[0], wordTiles[0]);
  assert.equal(floats[1].payload.wordTiles[0], wordTiles[1]);
  assert.equal(floats[2].payload.wordTiles[0], wordTiles[2]);

  // Single scoreFlyToPanel for the total score, with delay AFTER all
  // per-word floats have visibly resolved.
  const flies = ac._directives.filter(d => d.kind === 'scoreFlyToPanel');
  assert.equal(flies.length, 1);
  assert.equal(flies[0].payload.score, 20);
  assert.equal(flies[0].payload.isSum, true);
  // Delay must exceed last per-word float onset (600ms) so the sum fires
  // visibly after the per-word floats.
  assert.ok(flies[0].payload.delayMs > 600, 'sum fly delayed past last per-word float');

  ac.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 2. Single-word move skips the per-word float (legacy shows just the total
// to avoid showing the same number twice). Same as the existing test but
// we verify the count is exactly 0, not just "not in the list".
test('parity: single-word move emits zero per-word floats (no redundant display)', async () => {
  const m = await loadModules();
  m.bus._reset();
  const ac = m.anim.createAnimationController({ bus: m.bus, mySlot: 0 });

  m.bus.emit(m.events.EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }],
    words: ['אב'],
    wordTiles: [[{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }]],
    score: 4,
  });

  assert.equal(ac._directives.filter(d => d.kind === 'scoringPointsFloat').length, 0);
  // The total still flies to the panel — that's the only "+N" the player sees.
  const fly = ac._directives.find(d => d.kind === 'scoreFlyToPanel');
  assert.ok(fly);
  assert.equal(fly.payload.score, 4);
  // Sum fly fires with no per-word delay budget (the +80ms gap only).
  assert.equal(fly.payload.delayMs, 80);

  ac.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 3. Multiplier label fires only on multi-word moves (legacy showed
// "×2"/"×4" badges as part of extras on cross-word moves).
test('parity: multiplierLabel directive fires on multi-word moves, not single-word', async () => {
  const m = await loadModules();
  m.bus._reset();
  const ac = m.anim.createAnimationController({ bus: m.bus, mySlot: 0 });

  // Single-word: no multiplier label.
  m.bus.emit(m.events.EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 4, c: 4, letter: 'א', val: 1 }],
    words: ['אב'],
    wordTiles: [[{ r: 4, c: 4, letter: 'א', val: 1 }]],
    score: 1,
  });
  assert.equal(ac._directives.filter(d => d.kind === 'multiplierLabel').length, 0);

  // Multi-word: multiplier label fires.
  m.bus.emit(m.events.EV.MOVE_CONFIRMED, {
    slot: 0,
    placed: [{ r: 5, c: 5, letter: 'ג', val: 5 }],
    words: ['אבג', 'דג'],
    wordTiles: [
      [{ r: 5, c: 5, letter: 'ג', val: 5 }],
      [{ r: 5, c: 5, letter: 'ג', val: 5 }],
    ],
    score: 12,
  });
  assert.equal(ac._directives.filter(d => d.kind === 'multiplierLabel').length, 1);
  ac.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 4. Bingo label fires when the player empties their rack (8 tiles placed).
test('parity: bingoLabel directive fires on rack-out (8 placed tiles)', async () => {
  const m = await loadModules();
  m.bus._reset();
  const ac = m.anim.createAnimationController({ bus: m.bus, mySlot: 0 });

  const placed = Array.from({ length: 8 }, (_, i) => ({ r: 4, c: i, letter: 'א', val: 1 }));
  m.bus.emit(m.events.EV.MOVE_CONFIRMED, {
    slot: 0,
    placed,
    words: ['אאאאאאאא'],
    wordTiles: [placed],
    score: 58, // 8×1 + 50 bingo bonus
  });
  assert.equal(ac._directives.filter(d => d.kind === 'bingoLabel').length, 1);

  // Seven-tile move: no bingo.
  m.bus._reset();
  const ac2 = m.anim.createAnimationController({ bus: m.bus });
  const seven = placed.slice(0, 7);
  m.bus.emit(m.events.EV.MOVE_CONFIRMED, {
    slot: 0, placed: seven, words: ['אאאאאאא'], wordTiles: [seven], score: 7,
  });
  assert.equal(ac2._directives.filter(d => d.kind === 'bingoLabel').length, 0);
  ac.dispose();
  ac2.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 5. Auto-extra-score boost: scoreBonusAnimation can describe the payload.
test('parity: describeScoreBonus extracts slot + extra from BOOST_ACTIVATED', async () => {
  const m = await loadModules();
  // Engine emit shape:
  assert.deepEqual(
    m.scoreBonus.describeScoreBonus({
      slot: 1, boostId: 'auto_extra_score', payload: { extra: 25 }, turnNumber: 4,
    }),
    { slot: 1, extra: 25, label: '+25' },
  );
  // Plugin emit shape (nested entry):
  assert.deepEqual(
    m.scoreBonus.describeScoreBonus({
      entry: { slot: 0, boostId: 'auto_extra_score', payload: { extra: 10 } },
    }),
    { slot: 0, extra: 10, label: '+10' },
  );
  // Wrong boostId → null (no float).
  assert.equal(m.scoreBonus.describeScoreBonus({ slot: 0, boostId: 'free_tile_swap' }), null);
  // No extra → null.
  assert.equal(m.scoreBonus.describeScoreBonus({ slot: 0, boostId: 'auto_extra_score', payload: {} }), null);
});

// ───────────────────────────────────────────────────────────────────────
// 6. Engine state independent of animation completion.
// Legacy hard rule preserved in the spine: even with animations disabled
// (or no renderer attached), the score/rack/turn must mutate identically
// on MOVE_CONFIRMED.
test('parity: engine state mutates correctly even with animations disabled', async () => {
  const m = await loadModules();
  m.bus._reset();
  m.dict.DICT.clear();
  m.dict.addWordsFromText('אב\n');
  const session = m.session.createLocalGameSession({
    bus: m.bus, mode: 'offline-2p', tileBagSeed: 'anim-indep', players: PLAYERS,
  });
  session.state.racks[0] = ['א','ב','ג','ד','ה','ו','ז','ח'];

  const ac = m.anim.createAnimationController({ bus: m.bus, mySlot: 0 });
  ac.setEnabled(false); // disable visuals; engine should still work
  // Also attach NO renderer — the controller would no-op anyway.
  session.start();

  session.dispatch({
    type: m.commands.CMD.CONFIRM_MOVE,
    payload: { placed: [
      { r: 4, c: 4, letter: 'א', val: 1 },
      { r: 4, c: 5, letter: 'ב', val: 3 },
    ] },
  });

  // Engine state is correct REGARDLESS of animation.
  assert.equal(session.state.scores[0], 4, 'score advanced synchronously on MOVE_CONFIRMED');
  assert.equal(session.state.currentTurnSlot, 1, 'turn advanced synchronously');
  // The directive log still records what WOULD have animated (handy for
  // a renderer that wants to skip-to-end without losing analytics).
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('scoreFlyToPanel'), 'directives still recorded for inspection');
  ac.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 7. Animation directives carry the engine-emitted wordTiles unchanged, so
// the renderer highlights exactly the tiles the engine scored.
test('parity: scoringWordGlow and scoreFlyToPanel both receive the exact wordTiles payload', async () => {
  const m = await loadModules();
  m.bus._reset();
  const ac = m.anim.createAnimationController({ bus: m.bus, mySlot: 0 });
  const wordTiles = [
    [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }],
  ];
  m.bus.emit(m.events.EV.MOVE_CONFIRMED, {
    slot: 0, placed: [{ r: 4, c: 4, letter: 'א', val: 1 }, { r: 4, c: 5, letter: 'ב', val: 3 }],
    words: ['אב'], wordTiles, score: 4,
  });
  const glow = ac._directives.find(d => d.kind === 'scoringWordGlow');
  const fly  = ac._directives.find(d => d.kind === 'scoreFlyToPanel');
  // Same reference (renderer can read tile coords directly).
  assert.equal(glow.payload.wordTiles, wordTiles);
  assert.equal(fly.payload.wordTiles, wordTiles);
  ac.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 8. Opponent's move plays the animation in opponent mode (no validFlash —
// that's a same-player confirmation flash; spine: opponent moves skip it).
test('parity: opponent move emits scoringWordGlow but not validFlash', async () => {
  const m = await loadModules();
  m.bus._reset();
  const ac = m.anim.createAnimationController({ bus: m.bus, mySlot: 0 });
  m.bus.emit(m.events.EV.OPPONENT_MOVED, {
    slot: 1, placed: [{ r: 4, c: 4, letter: 'א', val: 1 }],
    words: ['אב'], wordTiles: [[{ r: 4, c: 4, letter: 'א', val: 1 }]], score: 4,
  });
  const kinds = ac._directives.map(d => d.kind);
  assert.ok(kinds.includes('scoringWordGlow'), 'opponent move still glows');
  assert.ok(kinds.includes('scoreFlyToPanel'), 'opponent score still flies to panel');
  assert.ok(!kinds.includes('validFlash'), 'no same-player flash on opponent moves');
  // And the directive payload is flagged opponent:true so the renderer can
  // colour the glow differently if it wants.
  const glow = ac._directives.find(d => d.kind === 'scoringWordGlow');
  assert.equal(glow.payload.opponent, true);
  ac.dispose();
});
