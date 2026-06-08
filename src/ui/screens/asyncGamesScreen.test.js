import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountAsyncGamesScreen, buildListHtml, buildRowHtml, timeAgoLabel,
  MG_INTENT, MG_RENDER,
} from './asyncGamesScreen.js';

function makeList() {
  const listeners = [];
  return {
    innerHTML: '',
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex(l => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fireClick(target) {
      for (const l of listeners) if (l.ev === 'click') l.fn({ target });
    },
  };
}

function makeButton(attrs = {}) {
  return {
    tagName: 'BUTTON',
    getAttribute(n) { return attrs[n] ?? null; },
    closest() { return this; },
  };
}

function makeRoot() {
  const list   = makeList();
  const empty  = { style: { display: 'none' } };
  const screen = {};
  const count  = { textContent: '' };
  return {
    list, empty, screen, count,
    root: {
      querySelector: (sel) => {
        if (sel === '#mg-list') return list;
        if (sel === '#mg-empty') return empty;
        if (sel === '#smygames') return screen;
        if (sel === '#mg-count') return count;
        return null;
      },
    },
  };
}

test('timeAgoLabel: bucketing', () => {
  const now = 100 * 60 * 1000;
  assert.equal(timeAgoLabel(null, now), '');
  assert.equal(timeAgoLabel(now - 30_000, now), 'עכשיו');
  assert.equal(timeAgoLabel(now - 5 * 60 * 1000, now), "לפני 5 דק'");
  assert.equal(timeAgoLabel(now - 90 * 60 * 1000, now), "לפני 1 שע'");
  assert.equal(timeAgoLabel(now - 3 * 24 * 60 * 60 * 1000, now), 'לפני 3 ימים');
});

test('buildRowHtml: my-turn card shows the green status, opponent name, score, and Resume button', () => {
  const html = buildRowHtml({
    roomId: 'r1', opponentName: 'דני', opponentAvatar: 'dragon',
    isMyTurn: true, isExpired: false,
    myScore: 42, opponentScore: 17, lastUpdated: Date.now(),
  });
  assert.ok(html.includes('דני'));
  // Score numbers and colon are present (each wrapped in its own span for styling).
  assert.ok(html.includes('>42<'));
  assert.ok(html.includes('>17<'));
  assert.ok(html.includes('mg-score-mine'));
  assert.ok(html.includes('mg-score-theirs'));
  assert.ok(html.includes('data-mg-resume="r1"'));
  assert.ok(html.includes('data-mg-dismiss="r1"'));
  assert.ok(html.includes('🐉'));
  // Green dot indicator for my-turn, plus the Hebrew label.
  assert.ok(html.includes('🟢'));
  assert.ok(html.includes('תורך'));
  assert.ok(html.includes('mg-status is-mine'));
});

test('buildRowHtml: local saved-game card uses the gold "is-local" pill', () => {
  const html = buildRowHtml({
    roomId: '__local__', isLocal: true, isMyTurn: true, isExpired: false,
    opponentName: 'המחשב', opponentAvatar: '🤖',
    myScore: 10, opponentScore: 5, lastUpdated: Date.now(),
  });
  assert.ok(html.includes('משחק שמור'));
  assert.ok(html.includes('💾'));
  assert.ok(html.includes('mg-status is-local'));
  assert.ok(html.includes('data-mg-resume="__local__"'));
  assert.ok(html.includes('data-mg-dismiss="__local__"'));
  assert.ok(html.includes('>10<'));
  assert.ok(html.includes('>5<'));
  assert.ok(html.includes('🤖'));
});

test('buildRowHtml: expired card hides Resume and shows the expired status', () => {
  const html = buildRowHtml({
    roomId: 'r2', opponentName: 'Bob',
    isMyTurn: false, isExpired: true,
    myScore: 0, opponentScore: 0, lastUpdated: Date.now(),
  });
  assert.equal(html.includes('data-mg-resume'), false);
  assert.ok(html.includes('data-mg-dismiss="r2"'));
  assert.ok(html.includes('פג תוקף'));
  assert.ok(html.includes('mg-status is-expired'));
  // Trash dismiss icon, not the old floating ×.
  assert.ok(html.includes('🗑'));
});

test('buildRowHtml: opponent-turn card includes the time-ago line (suppressed only on my-turn)', () => {
  const html = buildRowHtml({
    roomId: 'r3', opponentName: 'דני',
    isMyTurn: false, isExpired: false,
    myScore: 0, opponentScore: 0, lastUpdated: 1000,
  }, { now: 1000 + 5 * 60_000 });
  assert.ok(html.includes('mg-time'));
  assert.ok(html.includes('לפני'));
});

test('buildListHtml: produces one row per session', () => {
  const html = buildListHtml([
    { roomId: 'a', opponentName: 'X', isMyTurn: true,  isExpired: false, myScore: 1, opponentScore: 2, lastUpdated: 0 },
    { roomId: 'b', opponentName: 'Y', isMyTurn: false, isExpired: false, myScore: 3, opponentScore: 4, lastUpdated: 0 },
  ]);
  assert.ok(html.includes('data-mg-row="a"'));
  assert.ok(html.includes('data-mg-row="b"'));
});

test('buildRowHtml: escapes HTML in user-controlled fields', () => {
  const html = buildRowHtml({
    roomId: 'evil"<script>', opponentName: '<x>', opponentAvatar: null,
    isMyTurn: true, isExpired: false, myScore: 0, opponentScore: 0, lastUpdated: 0,
  });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<x>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('mount: MG_RENDER with sessions paints the list + hides the empty state', () => {
  bus._reset();
  const { list, empty, root } = makeRoot();
  const ui = mountAsyncGamesScreen({ root, bus, now: () => 0 });
  bus.emit(MG_RENDER, {
    sessions: [
      { roomId: 'a', opponentName: 'X', isMyTurn: true, isExpired: false, myScore: 0, opponentScore: 0, lastUpdated: 0 },
    ],
  });
  assert.ok(list.innerHTML.includes('data-mg-row="a"'));
  assert.equal(empty.style.display, 'none');
  ui.unmount();
});

test('mount: MG_RENDER with empty list shows the empty state', () => {
  bus._reset();
  const { list, empty, root } = makeRoot();
  const ui = mountAsyncGamesScreen({ root, bus, now: () => 0 });
  bus.emit(MG_RENDER, { sessions: [] });
  assert.equal(list.innerHTML, '');
  assert.equal(empty.style.display, '');
  ui.unmount();
});

test('mount: clicking Resume emits MG_INTENT.RESUME with roomId', () => {
  bus._reset();
  const fired = [];
  bus.on(MG_INTENT.RESUME,  (p) => fired.push({ kind: 'resume', ...p }));
  bus.on(MG_INTENT.DISMISS, (p) => fired.push({ kind: 'dismiss', ...p }));
  const { list, root } = makeRoot();
  const ui = mountAsyncGamesScreen({ root, bus, now: () => 0 });
  list.fireClick(makeButton({ 'data-mg-resume': 'room-42' }));
  assert.deepEqual(fired, [{ kind: 'resume', roomId: 'room-42' }]);
  ui.unmount();
});

test('mount: clicking the dismiss (🗑) button emits MG_INTENT.DISMISS', () => {
  bus._reset();
  const fired = [];
  bus.on(MG_INTENT.DISMISS, (p) => fired.push(p));
  const { list, root } = makeRoot();
  const ui = mountAsyncGamesScreen({ root, bus, now: () => 0 });
  list.fireClick(makeButton({ 'data-mg-dismiss': 'gone' }));
  assert.deepEqual(fired, [{ roomId: 'gone' }]);
  ui.unmount();
});

test('mount: header count badge reflects the number of sessions', () => {
  bus._reset();
  const { root, count } = makeRoot();
  const ui = mountAsyncGamesScreen({ root, bus, now: () => 0 });
  // Empty list — count badge is cleared (CSS hides empty :empty).
  bus.emit(MG_RENDER, { sessions: [] });
  assert.equal(count.textContent, '');
  // Three sessions — count shows '3'.
  bus.emit(MG_RENDER, {
    sessions: [
      { roomId: 'a', opponentName: 'A', isMyTurn: true,  isExpired: false, myScore: 0, opponentScore: 0, lastUpdated: 0 },
      { roomId: 'b', opponentName: 'B', isMyTurn: false, isExpired: false, myScore: 0, opponentScore: 0, lastUpdated: 0 },
      { roomId: 'c', opponentName: 'C', isMyTurn: false, isExpired: true,  myScore: 0, opponentScore: 0, lastUpdated: 0 },
    ],
  });
  assert.equal(count.textContent, '3');
  ui.unmount();
});
