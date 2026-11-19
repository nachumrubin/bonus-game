import test from 'node:test';
import assert from 'node:assert/strict';
import { familyIconSVG, familyIconHTML, iconParam, hasFamilyIcon } from './boostV2Icons.js';
import { ALL_FAMILIES, letterHunt, longWord, tileMaster, doubleLetter, uniqueLetters, wordEdge, bridgeBuilder, powerWord, exactTarget } from '../game/boostV2/challengeCatalog.js';
import { getRules } from '../game/boostV2/rulesConfig.js';

const R = getRules();

test('every family has its own icon', () => {
  for (const f of ALL_FAMILIES) assert.ok(hasFamilyIcon(f), f);
  const defs = [letterHunt(R, 'EASY', 'מ'), longWord(R, 'EASY'), tileMaster(R, 'EASY'), doubleLetter(R, 'EASY'), uniqueLetters(R, 'EASY'),
    wordEdge(R, 'EASY', 'ש', 'START'), bridgeBuilder(R), powerWord(R, 'MEDIUM'), exactTarget(R, 'EASY')];
  const shapes = new Set(defs.map(d => familyIconSVG({ ...d, parameters: {} })));
  assert.equal(shapes.size, defs.length, 'drawings differ per family');
  assert.equal(familyIconSVG({ family: 'NOPE' }), '');
  assert.equal(familyIconHTML({ family: 'NOPE' }), '');
});

test('the parameter is drawn inside the icon', () => {
  assert.equal(iconParam(letterHunt(R, 'EASY', 'מ')), 'מ');
  assert.equal(iconParam(longWord(R, 'MEDIUM')), '6+');
  assert.equal(iconParam(tileMaster(R, 'MEDIUM')), '5+');
  assert.equal(iconParam(powerWord(R, 'MEDIUM')), '12+');
  assert.equal(iconParam(bridgeBuilder(R)), '');
  assert.match(familyIconSVG(letterHunt(R, 'EASY', 'מ')), />מ<\/text>/);
  assert.match(familyIconSVG(powerWord(R, 'MEDIUM')), />12\+<\/text>/);
});

test('word edge: the tile sits at the start (right) or the end (left) of the word', () => {
  const start = familyIconSVG(wordEdge(R, 'EASY', 'ש', 'START'));
  const end = familyIconSVG(wordEdge(R, 'EASY', 'ש', 'END'));
  assert.notEqual(start, end);
  assert.match(start, /<rect x="12.5"/);
  assert.match(end, /<rect x="1.5"/);
});

test('html escapes the parameter and tags the family', () => {
  const html = familyIconHTML({ family: 'LETTER_HUNT', parameters: { targetLetter: '<' } }, 'x');
  assert.match(html, /class="v2-ic v2-ic--letter_hunt x"/);
  assert.match(html, /&lt;/);
});
