import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_FACES, EXPRESSIONS, faceParts, faceSvg, screenBox, createBotFaces } from './botFace.js';
import { botStillSrc } from '../screens/avatarScreens.js';

test('every bot has a face for every expression, inside the still', () => {
  for (const level of Object.keys(BOT_FACES)) {
    for (const expr of EXPRESSIONS) assert.match(faceSvg(level, expr), /^<svg[\s\S]*<\/svg>$/, `${level}/${expr}`);
    const b = screenBox(level);
    assert.ok(b.left > 0 && b.top > 0 && b.left + b.width < 1 && b.top + b.height < 1);
  }
  assert.equal(faceSvg('bot', 'rest'), '');   // the generic bot has no face
});

test('each bot keeps its personality at rest; boost is wow for all', () => {
  assert.deepEqual(faceParts('bot_easy', 'rest'), ['arc', 'grin']);
  assert.deepEqual(faceParts('bot_medium', 'rest'), ['round', 'smallsmile']);
  assert.deepEqual(faceParts('bot_hard', 'rest'), ['angry', 'frown']);
  for (const l of Object.keys(BOT_FACES)) assert.deepEqual(faceParts(l, 'wow'), ['wide', 'o']);
  assert.equal(faceParts('bot_hard', 'happy')[0], 'angry');   // the hard bot never goes soft
});

test('the blank still path exists for the bot levels', () => {
  assert.equal(botStillSrc('bot_easy', 'blank'), 'assets/avatars/bots/bot_easy_blank.webp');
  assert.equal(botStillSrc('bot_hard', 'full'), 'assets/avatars/bots/bot_hard_full.webp');
  assert.equal(botStillSrc('bot_hard'), 'assets/avatars/bots/bot_hard_bust.webp');
});

function fakeHost() {
  const kids = [];
  const mk = () => ({
    className: '', style: {}, children: [], innerHTML: '',
    setAttribute() {}, append(c) { this.children.push(c); c.parent = this; },
    get firstElementChild() { return this.children[0] ?? this; },
    remove() { const i = kids.indexOf(this); if (i >= 0) kids.splice(i, 1); this.parent = null; },
  });
  const host = { ownerDocument: { createElement: mk }, append(c) { kids.push(c); c.parent = host; }, contains: (c) => kids.includes(c) && c.parent === host };
  host.kids = kids;
  return host;
}

test('createBotFaces: bots get a face that reacts and rests, others get none', () => {
  const host = fakeHost();
  const t = []; const timers = { setTimeout: (fn, ms) => { t.push({ fn, ms }); return t.length; }, clearTimeout() {} };
  const faces = createBotFaces({ hostOf: (i) => (i === 0 ? host : null), timers });
  faces.sync(['bot_easy', 'bot_hard']);
  assert.equal(faces.has(0), true);
  assert.equal(faces.has(1), false);          // no host for slot 1
  assert.equal(faces.react(0, 'good'), true);
  assert.equal(faces.react(1, 'good'), false);
  assert.equal(faces.react(0, 'nonsense'), false);
  faces.sync(['👑', null]);                    // a human now: the face goes away
  assert.equal(faces.has(0), false);
  faces.dispose();
});
