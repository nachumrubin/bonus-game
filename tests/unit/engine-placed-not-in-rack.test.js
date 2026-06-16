// Regression test for the rack-defense gap surfaced by the simulator's fuzz bot.
//
// Before the fix, gameEngine.handleConfirmMove → applyMove would commit
// placed tiles to the board via setCommittedTile() but only remove the
// corresponding letter from the rack `if (idx >= 0)`. A malicious /
// buggy CONFIRM_MOVE with a letter not in the rack (which still passed
// geometric validation and the dictionary check by forming a valid word
// with adjacent tiles) added a tile to the board without removing one
// from the rack — net +1 tile, breaking the tile-bag conservation.
//
// The fix is an explicit precondition check in handleConfirmMove. These
// tests prove:
//   1. A legitimate placement (letter IS in rack) still works.
//   2. A bad placement (letter NOT in rack) is rejected with reason
//      'placed-not-in-rack' and produces zero state mutation.
//   3. A bad swap (swap-in letter NOT in rack) is also rejected.
//   4. Joker placement (isJoker=true, any visible letter) accepts when
//      '?' is in the rack — the lookup uses the rack-storage letter, not
//      the visible-assigned one.

const test = require('node:test');
const assert = require('node:assert/strict');

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const [bus, cmds, evts, engine, dict] = await Promise.all([
      import('../../src/events/bus.js'),
      import('../../src/events/commands.js'),
      import('../../src/events/eventTypes.js'),
      import('../../src/game/core/gameEngine.js'),
      import('../../src/game/core/hebrewDictionary.js'),
    ]);
    // Need the dictionary loaded so the "valid word with adjacent tile"
    // scenario can pass the dict check (we use 'אב' = 'father' which is
    // definitely in the base dictionary).
    if (!globalThis.__ENGINE_RACK_TEST_DICT_LOADED__) {
      const fs = require('node:fs');
      const path = require('node:path');
      const dictPath = path.join(__dirname, '..', '..', 'data', 'dictionary.txt');
      dict.addWordsFromText(fs.readFileSync(dictPath, 'utf8'));
      globalThis.__ENGINE_RACK_TEST_DICT_LOADED__ = true;
    }
    return {
      bus, CMD: cmds.CMD, EV: evts.EV,
      createInitialState: engine.createInitialState,
      createEngine: engine.createEngine,
    };
  })();
  return modulesPromise;
}

const PLAYERS = {
  0: { uid: 'alice', displayName: 'Alice', joinedAt: 1 },
  1: { uid: 'bob',   displayName: 'Bob',   joinedAt: 2 },
};

function totalTiles(state) {
  const onBoard = (() => {
    let n = 0;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (state.board[r][c]) n++;
    return n;
  })();
  return state.bag.length + state.racks[0].length + state.racks[1].length + onBoard;
}

function makeEngineWithSetup() {
  return loadModules().then(({ bus, CMD, EV, createInitialState, createEngine }) => {
    bus._reset();
    const events = [];
    bus.on(EV.INVALID_MOVE_REJECTED, (p) => events.push({ type: EV.INVALID_MOVE_REJECTED, payload: p }));
    bus.on(EV.MOVE_CONFIRMED, (p) => events.push({ type: EV.MOVE_CONFIRMED, payload: p }));

    const state = createInitialState({
      tileBagSeed: 'rack-defense', players: PLAYERS, startingSlot: 0,
    });
    // Deterministic racks so the test cases are reproducible.
    state.racks[0] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', '?'];
    state.racks[1] = ['ח', 'ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס'];
    // Top up bag size so it stays a known total.
    state.bag = state.bag.slice(0, 99 - 16); // 99 total tiles minus the 16 in racks
    const engine = createEngine({ state, bus });
    return { state, engine, events, bus, CMD, EV };
  });
}

test('rack defense: legitimate first-move placement using rack letters succeeds', async () => {
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  const totalBefore = totalTiles(state);
  // Place "אב" (father) horizontally at the center — both letters are in
  // alice's rack. Valid Hebrew word.
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1, isJoker: false },
        { r: 4, c: 5, letter: 'ב', val: 3, isJoker: false },
      ],
      swappedTiles: [],
    },
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rejected, undefined,
    `expected no rejection for legitimate move, got: ${rejected && JSON.stringify(rejected.payload)}`);
  const confirmed = events.find(e => e.type === EV.MOVE_CONFIRMED);
  assert.ok(confirmed, 'MOVE_CONFIRMED must fire for legitimate placement');
  // Tile conservation must hold: started with N tiles, still N after.
  assert.equal(totalTiles(state), totalBefore, 'tile count must be conserved');
});

test('rack defense: placement of letter NOT in rack is rejected with no state mutation', async () => {
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  const totalBefore = totalTiles(state);
  const racksBefore = JSON.stringify(state.racks);
  const boardBefore = JSON.stringify(state.board);
  // Try to place 'ת' (taw) — NOT in alice's rack. Single tile so word-too-short
  // would also reject, but our defense should fire FIRST.
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [{ r: 4, c: 4, letter: 'ת', val: 4, isJoker: false }],
      swappedTiles: [],
    },
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(rejected, 'must emit INVALID_MOVE_REJECTED');
  assert.equal(rejected.payload.reason, 'placed-not-in-rack',
    `expected reason=placed-not-in-rack, got ${rejected.payload.reason}`);
  assert.equal(rejected.payload.missing, 'ת');
  // No state mutation: bag, racks, board all untouched.
  assert.equal(totalTiles(state), totalBefore, 'tile total must be unchanged');
  assert.equal(JSON.stringify(state.racks), racksBefore, 'racks must be unchanged');
  assert.equal(JSON.stringify(state.board), boardBefore, 'board must be unchanged');
});

test('rack defense: swap-in letter NOT in rack is rejected with no state mutation', async () => {
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  // First put a tile on the board so the swap has a target. Use alice's
  // placement of 'אב' at row 4 (proven valid above).
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1, isJoker: false },
        { r: 4, c: 5, letter: 'ב', val: 3, isJoker: false },
      ],
      swappedTiles: [],
    },
  });
  // Now it's bob's turn. Bob's rack: ['ח', 'ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס']
  // Force currentTurnSlot=0 again so alice can attempt a swap.
  state.currentTurnSlot = 0;
  const totalBefore = totalTiles(state);
  const racksBefore = JSON.stringify(state.racks);
  events.length = 0;
  // Try to swap-in 'ת' (not in alice's rack) at the position of an existing tile.
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [{ r: 5, c: 4, letter: 'ג', val: 5, isJoker: false }], // legit placement
      swappedTiles: [{ r: 4, c: 4, letter: 'ת', val: 4, isJoker: false }], // bad swap
    },
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(rejected, 'must reject');
  assert.equal(rejected.payload.reason, 'placed-not-in-rack');
  assert.equal(rejected.payload.missing, 'ת');
  assert.equal(totalTiles(state), totalBefore, 'tile total unchanged');
  assert.equal(JSON.stringify(state.racks), racksBefore, 'racks unchanged');
});

test('rack defense: EXCHANGE_TILE with a letter not in the rack rejects atomically (no partial mutation)', async () => {
  // Bug: applyExchange spliced letters out one-by-one and threw mid-loop
  // if a letter was missing → tiles before it were already gone → net -1
  // total tiles. Fix pre-validates all letters before mutating.
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  const totalBefore = totalTiles(state);
  const racksBefore = JSON.stringify(state.racks);
  const bagBefore = state.bag.length;
  // Mix one valid letter from alice's rack with one bogus.
  engine.dispatch({
    type: CMD.EXCHANGE_TILE,
    payload: { letters: ['א', 'ת'], freeSwap: false }, // alice's rack: ['א','ב','ג','ד','ה','ו','ז','?']
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(rejected, 'must emit INVALID_MOVE_REJECTED');
  assert.equal(rejected.payload.reason, 'exchange-invalid');
  // Most important: state is UNCHANGED.
  assert.equal(totalTiles(state), totalBefore, 'tile total must be unchanged');
  assert.equal(JSON.stringify(state.racks), racksBefore, 'racks unchanged (no partial splice)');
  assert.equal(state.bag.length, bagBefore, 'bag unchanged');
});

test('rack defense: legitimate multi-letter EXCHANGE still works', async () => {
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  const totalBefore = totalTiles(state);
  engine.dispatch({
    type: CMD.EXCHANGE_TILE,
    payload: { letters: ['א', 'ב'], freeSwap: false },
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rejected, undefined,
    `legitimate exchange must succeed; got rejection: ${rejected && JSON.stringify(rejected.payload)}`);
  // Tile total still conserved (exchange returns to bag and refills rack).
  assert.equal(totalTiles(state), totalBefore, 'tile total conserved through exchange');
});

test('cell defense: CONFIRM_MOVE on an already-occupied cell is rejected with no state mutation', async () => {
  // Bug: setCommittedTile in applyMove silently overwrote any tile already
  // at the target cell — the displaced tile vanished, breaking bag-parity.
  // Fix rejects with reason 'placed-on-occupied-cell' BEFORE any mutation.
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  // Alice plays first: two-letter word at (4,4)-(4,5).
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1, isJoker: false },
        { r: 4, c: 5, letter: 'ב', val: 3, isJoker: false },
      ],
      swappedTiles: [],
    },
  });
  const totalBefore = totalTiles(state);
  const boardBefore = JSON.stringify(state.board);
  events.length = 0;
  // Force currentTurnSlot=0 so alice can attempt — and try to PLACE on (4,4)
  // which is now occupied by 'א'.
  state.currentTurnSlot = 0;
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [{ r: 4, c: 4, letter: 'ד', val: 3, isJoker: false }],
      swappedTiles: [],
    },
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.ok(rejected, 'must reject placement on occupied cell');
  assert.equal(rejected.payload.reason, 'placed-on-occupied-cell');
  assert.deepEqual(rejected.payload.occupiedCell, { r: 4, c: 4 });
  assert.equal(totalTiles(state), totalBefore, 'tile total unchanged');
  assert.equal(JSON.stringify(state.board), boardBefore, 'board unchanged');
});

test('rack defense: a swap-displaced board letter is usable as a placement in the same move', async () => {
  // Regression: previously the rack defense validated every placed letter
  // against the ORIGINAL rack and rejected when a player tried to use a
  // letter that had just been released from the board by a swap in the
  // same move. The UI surfaces the displaced letter at the swap's rack
  // slot exactly so it CAN be played that turn (mirrors legacy
  // `racks[turn][rackSlot] = returnedLetter`), so the engine must
  // credit the rack copy with the displaced letter before validating
  // placements.
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  // Alice plays 'אב' at (4,4)-(4,5) so there is something on the board to
  // swap with.
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 1, isJoker: false },
        { r: 4, c: 5, letter: 'ב', val: 3, isJoker: false },
      ],
      swappedTiles: [],
    },
  });
  // Force Alice's turn and override her rack to contain 'ו' but NOT 'ב'.
  // This means the ONLY way the placed 'ב' below can be valid is via the
  // swap-displaced letter.
  state.currentTurnSlot = 0;
  state.racks[0] = ['ו', 'ג', 'ה', 'ז', '?', 'מ', 'ת', 'ל'];
  const totalBefore = totalTiles(state);
  events.length = 0;
  // Move: swap board-'ב' at (4,5) with rack-'ו'  →  'או' at (4,4)-(4,5);
  // place displaced 'ב' at (4,3)  →  forms 'באו' at (4,3)-(4,5). Both
  // 'או' and 'באו' are in the Hebrew dictionary.
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [{ r: 4, c: 3, letter: 'ב', val: 3, isJoker: false }],
      swappedTiles: [{ r: 4, c: 5, letter: 'ו', val: 1, isJoker: false }],
    },
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rejected, undefined,
    `swap+reuse must not be rejected; got: ${rejected && JSON.stringify(rejected.payload)}`);
  const confirmed = events.find(e => e.type === EV.MOVE_CONFIRMED);
  assert.ok(confirmed, 'MOVE_CONFIRMED must fire for swap-then-reuse-displaced');
  // Tile-bag conservation must hold across the swap+placement+refill.
  assert.equal(totalTiles(state), totalBefore, 'tile total conserved');
});

test('rack defense: joker placement (isJoker=true) consumes the rack ? regardless of assigned letter', async () => {
  const { state, engine, events, CMD, EV } = await makeEngineWithSetup();
  const totalBefore = totalTiles(state);
  // Alice has '?' in her rack. Play it as 'א' next to existing... actually
  // first move, so play a 2-letter word with joker. ?+ב = 'אב' (joker
  // visually assigned to 'א').
  engine.dispatch({
    type: CMD.CONFIRM_MOVE,
    payload: {
      placed: [
        { r: 4, c: 4, letter: 'א', val: 0, isJoker: true }, // joker tile, visible as 'א'
        { r: 4, c: 5, letter: 'ב', val: 3, isJoker: false },
      ],
      swappedTiles: [],
    },
  });
  const rejected = events.find(e => e.type === EV.INVALID_MOVE_REJECTED);
  assert.equal(rejected, undefined,
    `joker placement should not be rejected, got: ${rejected && JSON.stringify(rejected.payload)}`);
  const confirmed = events.find(e => e.type === EV.MOVE_CONFIRMED);
  assert.ok(confirmed, 'joker placement must succeed');
  assert.equal(totalTiles(state), totalBefore, 'tile total conserved through joker play');
});
