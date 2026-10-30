import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideBack, previousScreen, backSnapshot, clickOverlayClose,
  BACK_ACTION as A, EXIT_OVERLAY, GAME_MENU_OVERLAY, APP_EXIT_URL,
} from './backButton.js';

test('game screen: back opens the end menu, never leaves the game', () => {
  assert.deepEqual(decideBack({ screen: 'sg', stack: ['sh', 'ss', 'sg'] }), { action: A.OPEN_GAME_MENU });
});

test('game screen: a second back closes the end menu (back to the game)', () => {
  const snap = { screen: 'sg', overlays: [{ id: GAME_MENU_OVERLAY, closeable: false }] };
  assert.deepEqual(decideBack(snap), { action: A.CLOSE_GAME_MENU });
});

test('an open overlay with a ✕ is closed through it; one without a ✕ swallows the press', () => {
  assert.deepEqual(decideBack({ screen: 'sg', overlays: [{ id: 'ov-settings', closeable: true }] }),
    { action: A.CLOSE_OVERLAY, overlay: 'ov-settings' });
  assert.deepEqual(decideBack({ screen: 'sg', overlays: [{ id: 'ov-bonus', closeable: false }] }),
    { action: A.IGNORE }, 'a mini-game is never interrupted');
  assert.deepEqual(decideBack({ screen: 'sh', overlays: [{ id: 'ov-a', closeable: false }, { id: 'ov-guide', closeable: true }] }),
    { action: A.CLOSE_OVERLAY, overlay: 'ov-guide' }, 'the topmost overlay decides');
});

test('post-game board review goes back to the results', () => {
  assert.deepEqual(decideBack({ screen: 'sg', reviewing: true }), { action: A.END_REVIEW });
});

test('home: back asks whether to exit; again closes the question', () => {
  assert.deepEqual(decideBack({ screen: 'sh', stack: ['sh'] }), { action: A.ASK_EXIT });
  assert.deepEqual(decideBack({ screen: 'sh', overlays: [{ id: EXIT_OVERLAY, closeable: false }] }), { action: A.CLOSE_EXIT });
});

test('other screens step back to the previous one, home at the root', () => {
  assert.deepEqual(decideBack({ screen: 'so', stack: ['sh', 'so'] }), { action: A.NAVIGATE, screen: 'sh' });
  assert.deepEqual(decideBack({ screen: 'sstats', stack: ['sh', 'sprofile', 'sstats'] }), { action: A.NAVIGATE, screen: 'sprofile' });
  assert.deepEqual(decideBack({ screen: 'scoin' }), { action: A.IGNORE });
});

test('previousScreen: never steps back past a game, tolerates a drifted stack', () => {
  assert.equal(previousScreen(['sh', 'ss', 'scoin', 'sg', 'smygames'], 'smygames'), 'sh');
  assert.equal(previousScreen(['sh', 'smygames', 'sg', 'sstats', 'sprofile'], 'sprofile'), 'sstats');
  assert.equal(previousScreen(['sh', 'so', 'sstats'], 'sfriends'), 'sh', 'unknown current → home');
  assert.equal(previousScreen(['sh', 'so', 'sstats', 'so'], 'so'), 'sstats', 'the last visit counts');
  assert.equal(previousScreen([], 'so'), 'sh');
});

// ── DOM snapshot ──
function el({ id = '', classes = [], children = [], visible = true } = {}) {
  const cls = new Set(classes);
  return {
    id, children, clicked: 0,
    classList: { contains: c => cls.has(c) },
    offsetParent: visible ? {} : null,
    querySelectorAll: (sel) => (sel === '[aria-label="סגור"]' ? children : []),
    click() { this.clicked++; },
  };
}

test('backSnapshot reads the visible screen, open overlays and their ✕', () => {
  const x = el();
  const hiddenX = el({ visible: false });
  const screens = { sh: el({ id: 'sh', classes: ['hidden'] }), so: el({ id: 'so' }) };
  const ovs = [el({ id: 'ov-guide', children: [x] }), el({ id: 'ov-bonus', children: [hiddenX] })];
  const review = el({ id: 'board-review-back', classes: ['hidden'] });
  const doc = {
    getElementById: id => screens[id] ?? ovs.find(o => o.id === id) ?? (id === 'board-review-back' ? review : null),
    querySelectorAll: () => ovs,
  };
  const snap = backSnapshot(doc, { screenIds: ['sh', 'so'], stack: ['sh', 'so'] });
  assert.equal(snap.screen, 'so');
  assert.deepEqual(snap.overlays, [{ id: 'ov-guide', closeable: true }, { id: 'ov-bonus', closeable: false }]);
  assert.equal(snap.reviewing, false);
  assert.ok(clickOverlayClose(doc, 'ov-guide'));
  assert.equal(x.clicked, 1);
  assert.ok(!clickOverlayClose(doc, 'ov-bonus'));
});

test('APP_EXIT_URL: the app\'s boost-ad scheme, exit host, no package (debug builds too)', () => {
  assert.equal(APP_EXIT_URL, 'intent://exit#Intent;scheme=boost-ad;end');
  assert.doesNotMatch(APP_EXIT_URL, /package=/);
});
