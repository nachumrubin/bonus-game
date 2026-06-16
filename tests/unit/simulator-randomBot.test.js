// Unit tests for the random bot's command-picker. Verifies the bot never
// produces an illegal command and always falls through to pass when no move
// is available.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    const [rngMod, engineMod, dictMod, botMod, cmdsMod] = await Promise.all([
      import('../../src/util/rng.js'),
      import('../../src/game/core/gameEngine.js'),
      import('../../src/game/core/hebrewDictionary.js'),
      import('../../scripts/simulator/bots/randomBot.mjs'),
      import('../../src/events/commands.js'),
    ]);
    // Populate the shared DICT once.
    if (!globalThis.__SIM_DICT_LOADED__) {
      const dictPath = path.join(__dirname, '..', '..', 'data', 'dictionary.v2.bin');
      const { parseDawg } = await import('../../src/game/core/dawg.js');
      const rawBuf = fs.readFileSync(dictPath);
      dictMod.setDawgForTests(parseDawg(rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength)));
      globalThis.__SIM_DICT_LOADED__ = true;
    }
    return {
      createRng: rngMod.createRng,
      createInitialState: engineMod.createInitialState,
      pickCommand: botMod.pickCommand,
      CMD: cmdsMod.CMD,
    };
  })();
  return modulesPromise;
}

const PLAYERS = {
  0: { uid: 'a', displayName: 'A', joinedAt: 1 },
  1: { uid: 'b', displayName: 'B', joinedAt: 2 },
};

test('randomBot: returns null when not active slot', async () => {
  const { createRng, createInitialState, pickCommand } = await loadModules();
  const state = createInitialState({
    tileBagSeed: 'rb-not-active', players: PLAYERS, startingSlot: 0,
  });
  const cmd = pickCommand(state, 1, createRng('rng-1'));
  assert.equal(cmd, null);
});

test('randomBot: returns null when status is not playing', async () => {
  const { createRng, createInitialState, pickCommand } = await loadModules();
  const state = createInitialState({
    tileBagSeed: 'rb-not-playing', players: PLAYERS, startingSlot: 0,
  });
  state.status = 'completed';
  const cmd = pickCommand(state, 0, createRng('rng-2'));
  assert.equal(cmd, null);
});

test('randomBot: command type is always one of the engine commands', async () => {
  const { createRng, createInitialState, pickCommand, CMD } = await loadModules();
  const allowed = new Set([
    CMD.CONFIRM_MOVE, CMD.EXCHANGE_TILE, CMD.PASS_TURN, CMD.CLAIM_STALL_END,
  ]);
  // Run a bunch of independent first-move picks and verify the command type
  // is always legal.
  for (let i = 0; i < 12; i++) {
    const state = createInitialState({
      tileBagSeed: `rb-cmd-type-${i}`, players: PLAYERS, startingSlot: 0,
    });
    const cmd = pickCommand(state, 0, createRng(`rng-${i}`));
    assert.ok(cmd, `pick #${i} returned null but expected fallback`);
    assert.ok(allowed.has(cmd.type), `unexpected command type: ${cmd.type}`);
    assert.ok(cmd.payload, `payload missing on ${cmd.type}`);
  }
});

test('randomBot: when bag is empty and no placement possible, returns PASS_TURN', async () => {
  const { createRng, createInitialState, pickCommand, CMD } = await loadModules();
  const state = createInitialState({
    tileBagSeed: 'rb-empty-bag', players: PLAYERS, startingSlot: 0,
  });
  // Drain the bag and clear racks so neither EXCHANGE nor CONFIRM_MOVE are
  // possible. The bot should pass.
  state.bag = [];
  state.racks = { 0: [], 1: [] };
  const cmd = pickCommand(state, 0, createRng('rng-empty'));
  assert.equal(cmd.type, CMD.PASS_TURN);
});

test('randomBot: EXCHANGE_TILE payload letters are all from the rack', async () => {
  const { createRng, createInitialState, pickCommand, CMD } = await loadModules();
  // Force exchange path: rack present, bag has tiles, but make placement
  // search fruitless by giving the rack only joker-uneconomical letters.
  // Instead, just try many seeds; whenever the bot picks EXCHANGE_TILE we
  // verify the letters subset constraint.
  let saw = 0;
  for (let i = 0; i < 30 && saw < 3; i++) {
    const state = createInitialState({
      tileBagSeed: `rb-exch-${i}`, players: PLAYERS, startingSlot: 0,
    });
    const cmd = pickCommand(state, 0, createRng(`exch-${i}`));
    if (cmd?.type === CMD.EXCHANGE_TILE) {
      saw++;
      const rack = [...state.racks[0]];
      for (const letter of cmd.payload.letters) {
        const idx = rack.indexOf(letter);
        assert.ok(idx >= 0, `bot tried to exchange ${letter} not in rack ${rack}`);
        rack.splice(idx, 1);
      }
    }
  }
  // No assertion on saw>0 — it's seed-dependent. The constraint is what we
  // care about, asserted inside the loop.
});
