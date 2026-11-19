// Boost 2.0 — randomized property test (spec §43): complete seeded matches
// through the real engine; every committed state must satisfy the invariants
// and every rejected command must leave state untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DICT, addWordsFromText, isValid } from '../core/hebrewDictionary.js';
import { playV2Match } from './simulateV2.js';
import { tryPlaceWord } from '../sessions/botSearch.js';
import { createInitialState } from '../core/gameEngine.js';
import { RULESET } from './rulesConfig.js';
import { createRng } from '../../util/rng.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// The most frequent common words — small enough for a fast unit test.
const WORDS = readFileSync(path.join(ROOT, 'data/bot-words.txt'), 'utf8')
  .split(/\r?\n/).filter(w => /^[א-ת]{2,6}$/.test(w)).slice(0, 4000);

test('randomized Boost 2.0 matches: invariants hold at every committed state', () => {
  DICT.clear();
  addWordsFromText(WORDS.join('\n'));
  let consumed = 0;
  for (const seed of ['p1', 'p2', 'p3', 'p4']) {
    const { state, violations, metrics, result } = playV2Match({ seed, wordList: WORDS, isWordValid: isValid, maxCommands: 400 });
    assert.deepEqual(violations, [], `seed ${seed}`);
    assert.equal(state.status, 'completed', `seed ${seed} finished`);
    assert.ok(result?.boostV2Endgame, 'endgame deductions recorded');
    assert.equal(metrics.rejectionReasons['off-grid'] ?? 0, 0, 'bot search never proposes off-grid tiles in V2');
    consumed += metrics.consumed;
  }
  assert.ok(consumed > 0, 'at least one Boost was consumed across the sample');
});

test('bot search: off-grid squares are not playable in a V2 match (legacy unchanged)', () => {
  const players = { 0: { uid: 'a' }, 1: { uid: 'b' } };
  const v2 = createInitialState({ mode: 'x', tileBagSeed: 's', players, ruleset: RULESET.BOOST_V2, boostQueueRng: createRng('q') });
  const legacy = createInitialState({ mode: 'x', tileBagSeed: 's', players });
  for (const st of [v2, legacy]) {
    st.racks[0] = ['א', 'ב'];
    st.firstMove = true;
  }
  // (-1,1) is a legacy bonus square (BDEFS) directly above (0,1).
  assert.equal(tryPlaceWord(v2, 'אב', -1, 1, 'V', 0), null);
  assert.ok(tryPlaceWord(legacy, 'אב', -1, 1, 'V', 0));
});
