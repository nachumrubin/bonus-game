import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountAsyncSessionListScreen, buildListHtml, timeAgoLabel,
  AS_INTENT, AS_RENDER,
} from './asyncSessionListScreen.js';

function makeWrap() {
  const listeners = [];
  return {
    innerHTML: '',
    style: { display: '' },
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
  const wrap = makeWrap();
  return {
    wrap,
    root: { querySelector: (sel) => sel === '#online-sessions-wrap' ? wrap : null },
  };
}

test('timeAgoLabel: minutes/hours/days bucketing', () => {
  const now = 100 * 60 * 1000;
  assert.equal(timeAgoLabel(now - 5 * 60 * 1000, now),       '5 דק');
  assert.equal(timeAgoLabel(now - 90 * 60 * 1000, now),      '1 שע');
  assert.equal(timeAgoLabel(now - 3 * 24 * 60 * 60 * 1000, now), '3 ימים');
  assert.equal(timeAgoLabel(null, now), '');
});

test('buildListHtml: empty list returns empty string', () => {
  assert.equal(buildListHtml([]), '');
  assert.equal(buildListHtml(null), '');
});

test('buildListHtml: renders my-turn highlight + opponent name', () => {
  const html = buildListHtml([{
    roomId: 'r1', mode: 'random-async', opponentName: 'דני',
    isMyTurn: true, lastUpdated: Date.now() - 60_000,
  }]);
  assert.match(html, /תורך/);
  assert.match(html, /דני/);
  assert.match(html, /data-resume="r1"/);
  assert.match(html, /data-dismiss="r1"/);
});

test('buildListHtml: their-turn shows opponent label', () => {
  const html = buildListHtml([{
    roomId: 'r2', mode: 'friend-async', opponentName: 'רות',
    isMyTurn: false, lastUpdated: 1,
  }]);
  assert.match(html, /תור רות/);
});

test('buildListHtml: escapes opponent name', () => {
  const html = buildListHtml([{
    roomId: 'r3', mode: 'friend-async', opponentName: '<script>x</script>',
    isMyTurn: false, lastUpdated: 1,
  }]);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
});

test('mount: AS_RENDER paints the list and unhides the wrapper', () => {
  bus._reset();
  const { wrap, root } = makeRoot();
  mountAsyncSessionListScreen({ root, bus });

  bus.emit(AS_RENDER, { sessions: [
    { roomId: 'a', mode: 'random-async', opponentName: 'X', isMyTurn: true, lastUpdated: 1 },
  ]});
  assert.match(wrap.innerHTML, /data-resume="a"/);
  assert.equal(wrap.style.display, '');
});

test('mount: AS_RENDER with empty list hides + clears', () => {
  bus._reset();
  const { wrap, root } = makeRoot();
  mountAsyncSessionListScreen({ root, bus });
  // Paint then clear
  bus.emit(AS_RENDER, { sessions: [{ roomId: 'a', mode: 'random-async', opponentName: 'X', isMyTurn: true, lastUpdated: 1 }] });
  bus.emit(AS_RENDER, { sessions: [] });
  assert.equal(wrap.style.display, 'none');
  assert.equal(wrap.innerHTML, '');
});

test('mount: clicking a resume button emits AS_INTENT.RESUME with roomId', () => {
  bus._reset();
  const { wrap, root } = makeRoot();
  const events = [];
  bus.on(AS_INTENT.RESUME, (p) => events.push(p));
  mountAsyncSessionListScreen({ root, bus });
  wrap.fireClick(makeButton({ 'data-resume': 'r-7' }));
  assert.deepEqual(events, [{ roomId: 'r-7' }]);
});

test('mount: clicking a dismiss button emits AS_INTENT.DISMISS', () => {
  bus._reset();
  const { wrap, root } = makeRoot();
  const events = [];
  bus.on(AS_INTENT.DISMISS, (p) => events.push(p));
  mountAsyncSessionListScreen({ root, bus });
  wrap.fireClick(makeButton({ 'data-dismiss': 'r-9' }));
  assert.deepEqual(events, [{ roomId: 'r-9' }]);
});

test('unmount clears the wrap', () => {
  bus._reset();
  const { wrap, root } = makeRoot();
  const screen = mountAsyncSessionListScreen({ root, bus });
  bus.emit(AS_RENDER, { sessions: [{ roomId: 'a', mode: 'random-async', opponentName: 'X', isMyTurn: true, lastUpdated: 1 }] });
  screen.unmount();
  assert.equal(wrap.innerHTML, '');
  assert.equal(wrap.style.display, 'none');
});
