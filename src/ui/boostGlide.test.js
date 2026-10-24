import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BOOST_GLIDE, REVEAL, MAX_TOTAL_ENTRANCE, REVEAL_PLANS, OVERLAY_MOTION, GAME_EXIT,
  resolveDirection, nextHistory, glideSign, revealSchedule, entranceTotal,
} from './boostGlide.js';

const here = dirname(fileURLToPath(import.meta.url));

test('glide config stays inside the approved envelope', () => {
  for (const d of [BOOST_GLIDE.forwardDuration, BOOST_GLIDE.backwardDuration]) {
    assert.ok(d >= 250 && d <= 300, `duration ${d}`);
  }
  assert.ok(BOOST_GLIDE.incomingOffset >= 32 && BOOST_GLIDE.incomingOffset <= 36);
  assert.ok(BOOST_GLIDE.outgoingOffset >= 20 && BOOST_GLIDE.outgoingOffset <= 24);
  assert.equal(BOOST_GLIDE.easing, 'cubic-bezier(0.2, 0, 0, 1)');
  assert.ok(REVEAL.verticalOffset >= 8 && REVEAL.verticalOffset <= 12);
  assert.ok(REVEAL.elementDuration >= 180 && REVEAL.elementDuration <= 240);
  assert.ok(REVEAL.staggerDelay >= 40 && REVEAL.staggerDelay <= 60);
});

test('easing never overshoots (all bezier control y-values within [0,1])', () => {
  const [, y1, , y2] = BOOST_GLIDE.easing.match(/[\d.]+/g).map(Number);
  assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1);
});

test('styles.css :root tokens mirror the JS config', () => {
  const css = readFileSync(join(here, '..', '..', 'styles.css'), 'utf8');
  const v = (name) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
  assert.equal(v('--glide-duration'), `${BOOST_GLIDE.forwardDuration}ms`);
  assert.equal(v('--glide-in-offset'), `${BOOST_GLIDE.incomingOffset}px`);
  assert.equal(v('--glide-out-offset'), `${BOOST_GLIDE.outgoingOffset}px`);
  assert.equal(v('--glide-ease'), BOOST_GLIDE.easing);
  assert.equal(v('--reveal-offset'), `${REVEAL.verticalOffset}px`);
  assert.equal(v('--reveal-duration'), `${REVEAL.elementDuration}ms`);
  assert.equal(v('--reveal-initial-opacity'), String(REVEAL.initialOpacity));
});

test('overlay motion: styles.css tokens mirror OVERLAY_MOTION; the exit ends before visibility:hidden', () => {
  const css = readFileSync(join(here, '..', '..', 'styles.css'), 'utf8');
  const v = (name) => css.match(new RegExp(`${name}:\s*([^;]+);`))?.[1].trim();
  const M = OVERLAY_MOTION;
  assert.equal(v('--ov-in'), `${M.inDuration}ms`);
  assert.equal(v('--ov-out'), `${M.outDuration}ms`);
  assert.equal(v('--ov-ease-in'), M.inEasing);
  assert.equal(v('--ov-ease-out'), M.outEasing);
  assert.equal(v('--ov-dialog-scale'), String(M.dialogScale));
  assert.equal(v('--ov-dialog-offset'), `${M.dialogOffset}px`);
  assert.equal(v('--ov-sheet-offset'), `${M.sheetOffset}px`);
  assert.equal(v('--ov-panel-offset'), `${M.panelOffset}px`);
  assert.ok(M.outDuration < M.inDuration && M.inDuration <= MAX_TOTAL_ENTRANCE);
  // The backdrop hides (visibility) exactly when the card's exit ends.
  assert.match(css, /\.ov\.hidden\{[^}]*visibility 0s linear var\(--ov-out\)/);
  // No overlay keeps a private keyframe entrance on its card any more.
  for (const f of ['styles.css', 'screens-glass.css', 'menu-electric.css']) {
    const src = readFileSync(join(here, '..', '..', f), 'utf8');
    assert.doesNotMatch(src, /:not\(\.hidden\)\s*>\s*\.ovc\s*\{[^}]*animation/, f);
  }
});

test('game exit: styles.css tokens mirror GAME_EXIT; short, accelerating, no overshoot', () => {
  const css = readFileSync(join(here, '..', '..', 'styles.css'), 'utf8');
  const v = (name) => css.match(new RegExp(`${name}:\s*([^;]+);`))?.[1].trim();
  assert.equal(v('--gx-dur'), `${GAME_EXIT.duration}ms`);
  assert.equal(v('--gx-ease'), GAME_EXIT.easing);
  assert.equal(v('--gx-lead'), `${GAME_EXIT.lead}ms`);
  assert.ok(GAME_EXIT.lead + BOOST_GLIDE.backwardDuration <= MAX_TOTAL_ENTRANCE, 'the next screen is still in on time');
  assert.equal(v('--gx-board-scale'), String(GAME_EXIT.boardScale));
  assert.equal(v('--gx-rack-drop'), `${GAME_EXIT.rackDrop}px`);
  assert.equal(v('--gx-header-lift'), `${GAME_EXIT.headerLift}px`);
  assert.ok(GAME_EXIT.duration < 400);
  const ys = GAME_EXIT.easing.match(/[\d.]+/g).map(Number).filter((_, i) => i % 2);
  assert.ok(ys.every(y => y >= 0 && y <= 1));
  // The fold goes into the corner the board build opens from.
  assert.match(css, /#sg\.game-exit \.board-center-inner\s*\{[^}]*transform-origin:\s*100% 0/);
});

test('every reveal plan finishes inside MAX_TOTAL_ENTRANCE (launch and forward)', () => {
  for (const id of Object.keys(REVEAL_PLANS)) {
    // Home is the root: it is entered on launch, and every later arrival is a
    // back glide (resolveDirection) — it never takes the forward lead.
    for (const dir of id === 'sh' ? ['launch'] : ['launch', 'forward']) {
      const total = entranceTotal(dir, revealSchedule(id, dir));
      assert.ok(total <= MAX_TOTAL_ENTRANCE, `${id}/${dir}: ${total}ms`);
    }
  }
});

test('main menu reveal follows the specified offsets', () => {
  const d = revealSchedule('sh', 'launch').map(g => g.delay);
  assert.deepEqual(d, [0, 50, 100, 150, 175, 200, 210]);
});

test('reveal plays only on launch / forward entries', () => {
  assert.ok(revealSchedule('sstats', 'forward').length > 0);
  assert.equal(revealSchedule('sstats', 'back').length, 0);
  assert.equal(revealSchedule('sstats', 'none').length, 0);
  assert.equal(revealSchedule('sg', 'forward').length, 0, 'gameplay never staggers');
});

test('resolveDirection: launch, re-render, home, history and depth rules', () => {
  assert.equal(resolveDirection({ current: null, target: 'sh' }), 'launch');
  assert.equal(resolveDirection({ current: 'sh', target: 'sh' }), 'none');
  assert.equal(resolveDirection({ current: 'sh', target: 'sstats', history: ['sh'] }), 'forward');
  assert.equal(resolveDirection({ current: 'sg', target: 'sh', history: ['sh', 'ss', 'sg'] }), 'back');
  assert.equal(resolveDirection({ current: 'sfriends', target: 'sprofile', history: ['sh', 'sprofile', 'sfriends'] }), 'back');
  // Friends opened from the home nav: its back chip goes to Profile (not visited).
  assert.equal(resolveDirection({ current: 'sfriends', target: 'sprofile', history: ['sh', 'sfriends'] }), 'back');
  assert.equal(resolveDirection({ current: 'ss', target: 'sg', history: ['sh', 'ss'] }), 'forward');
  assert.equal(resolveDirection({ current: 'sstats', target: 'sstats', requested: 'back' }), 'none');
  assert.equal(resolveDirection({ current: 'sh', target: 'sstats', requested: 'back' }), 'back');
});

test('nextHistory: home resets, back truncates, forward pushes', () => {
  assert.deepEqual(nextHistory(['sh', 'ss', 'sg'], 'sh', 'back'), ['sh']);
  assert.deepEqual(nextHistory(['sh', 'sprofile', 'sfriends'], 'sprofile', 'back'), ['sh', 'sprofile']);
  assert.deepEqual(nextHistory(['sh'], 'sstats', 'forward'), ['sh', 'sstats']);
  assert.deepEqual(nextHistory(['sh', 'sfriends'], 'sprofile', 'back'), ['sh', 'sprofile']);
});

test('glideSign mirrors in RTL and reverses for back', () => {
  assert.equal(glideSign('forward', { rtl: false }), 1);
  assert.equal(glideSign('back', { rtl: false }), -1);
  assert.equal(glideSign('forward', { rtl: true }), -1);
  assert.equal(glideSign('back', { rtl: true }), 1);
  assert.equal(glideSign('forward', { rtl: true, mirrorInRtl: false }), 1);
});
