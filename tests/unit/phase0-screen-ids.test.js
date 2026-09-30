import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCREEN_IDS } from '../../src/ui/screens/screenTransitions.js';

test('dead schamps route is not a screen id', () => {
  const dead = 'sc' + 'hamps';
  assert.equal(SCREEN_IDS.includes(dead), false);
  const transitions = readFileSync(new URL('../../src/ui/screens/screenTransitions.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.equal(transitions.includes(dead), false);
  assert.equal(main.includes(dead), false);
});
