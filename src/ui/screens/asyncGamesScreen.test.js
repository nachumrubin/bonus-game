import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import {
  mountAsyncGamesScreen, buildListHtml, buildRowHtml, timeAgoLabel,
  canPoke, MG_INTENT, MG_RENDER,
} from './asyncGamesScreen.js';

const HOUR = 3_600_000;

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
  // `screen` doubles as the toast host. We give it a fake ownerDocument
  // that records the last-created toast div so tests can inspect it.
  const created = [];
  const ownerDocument = {
    createElement(tag) {
      const el = { tagName: tag.toUpperCase(), className: '', textContent: '', parentElement: null };
      created.push(el);
      return el;
    },
  };
  const screen = {
    ownerDocument,
    children: [],
    appendChild(el) { el.parentElement = this; this.children.push(el); },
    removeChild(el) {
      const i = this.children.indexOf(el);
      if (i >= 0) this.children.splice(i, 1);
      el.parentElement = null;
    },
  };
  return {
    list, empty, screen, created,
    root: {
      querySelector: (sel) => {
        if (sel === '#mg-list') return list;
        if (sel === '#mg-empty') return empty;
        if (sel === '#smygames') return screen;
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

test('buildRowHtml: my-turn card shows name, score, time, and an ENABLED שחק button (no dismiss)', () => {
  const html = buildRowHtml({
    roomId: 'r1', opponentName: 'דני',
    isMyTurn: true, isExpired: false,
    myScore: 42, opponentScore: 17, lastUpdated: 1000,
  }, { now: 1000 + 5 * 60_000 });
  assert.ok(html.includes('דני'));
  // Score numbers and colon are present (each wrapped in its own span for styling).
  assert.ok(html.includes('>42<'));
  assert.ok(html.includes('>17<'));
  assert.ok(html.includes('mg-score-mine'));
  assert.ok(html.includes('mg-score-theirs'));
  // שחק button targets the room and is enabled.
  assert.ok(html.includes('data-mg-resume="r1"'));
  assert.ok(html.includes('>שחק<'));
  assert.equal(html.includes('aria-disabled'), false, 'my-turn button must not be aria-disabled');
  assert.equal(html.includes('is-disabled'),    false, 'my-turn button must not carry the is-disabled class');
  // Non-expired cards have NO dismiss path on this screen — only expired do.
  assert.equal(html.includes('data-mg-dismiss'), false, 'live cards must not show the trash');
  // No avatar, no status pill — those were removed in the simplified design.
  assert.equal(html.includes('mg-avatar'),  false);
  assert.equal(html.includes('mg-status'),  false);
  // Time-ago is shown on every card.
  assert.ok(html.includes('mg-time'));
  assert.ok(html.includes('לפני'));
});

test('buildRowHtml: opponent-turn שחק button uses aria-disabled (no HTML `disabled`) so clicks fire and the tooltip can show', () => {
  const html = buildRowHtml({
    roomId: 'r-wait', opponentName: 'בודק12', opponentUid: 'opp',
    isMyTurn: false, isExpired: false,
    myScore: 208, opponentScore: 260, lastUpdated: 1000,
  }, { now: 1000 + 60 * 60_000 });
  assert.ok(html.includes('data-mg-resume="r-wait"'));
  assert.ok(html.includes('aria-disabled="true"'));
  assert.ok(html.includes('is-disabled'), 'class controls the dimmed look');
  // The HTML `disabled` attribute would swallow click events; we keep
  // ONLY aria-disabled so the click handler can show a tooltip.
  assert.equal(/\sdisabled(\s|>|$)/.test(html), false, 'no HTML disabled attribute');
  assert.equal(html.includes('data-mg-dismiss'), false);
  // Card carries the is-waiting class so styling can lean further into the
  // disabled look if we ever want a stronger visual treatment.
  assert.ok(html.includes('is-waiting'));
});

test('buildRowHtml: opponent-turn card shows the 👋 poke button when no MANUAL poke in the last 24 h', () => {
  const now = Date.now();
  const html = buildRowHtml({
    roomId: 'r-poke', opponentName: 'בודק12', opponentUid: 'opp',
    isMyTurn: false, isExpired: false,
    myScore: 0, opponentScore: 0,
    lastUpdated: now - 30 * HOUR,
    lastPokedAt: null,
  }, { now });
  assert.ok(html.includes('data-mg-poke="r-poke"'));
  assert.ok(html.includes('👋'));
});

test('buildRowHtml: poke button stays visible even when the auto-cron set lastReminderAt recently', () => {
  // Regression: the previous build gated `canPoke` on `lastReminderAt`,
  // which the auto-cron sweep also writes. The result was that opening
  // the app right after the cron pushed a reminder hid the manual poke
  // for a full day. Manual now uses its own field `lastPokedAt`.
  const now = Date.now();
  const html = buildRowHtml({
    roomId: 'r-cron', opponentName: 'בודק12', opponentUid: 'opp',
    isMyTurn: false, isExpired: false,
    myScore: 0, opponentScore: 0,
    lastUpdated: now - 30 * HOUR,
    lastReminderAt: now - 1 * HOUR, // cron just ran
    lastPokedAt: null,              // user never manually poked
  }, { now });
  assert.ok(html.includes('data-mg-poke="r-cron"'), 'auto-cron reminder must NOT hide the manual button');
});

test('buildRowHtml: poke button is hidden for 24 h after lastPokedAt is set (the manual stamp)', () => {
  const now = Date.now();
  const html = buildRowHtml({
    roomId: 'r-cool', opponentName: 'X', opponentUid: 'opp',
    isMyTurn: false, isExpired: false,
    myScore: 0, opponentScore: 0,
    lastUpdated: now - 30 * HOUR,
    lastPokedAt: now - 2 * HOUR, // user clicked recently
  }, { now });
  assert.equal(html.includes('data-mg-poke'), false);
});

test('buildRowHtml: my-turn / expired / local cards never show the poke button', () => {
  const now = Date.now();
  const mine = buildRowHtml({
    roomId: 'a', opponentName: 'A', opponentUid: 'opp',
    isMyTurn: true, isExpired: false, myScore: 0, opponentScore: 0,
    lastUpdated: now - 30 * HOUR, lastPokedAt: null,
  }, { now });
  assert.equal(mine.includes('data-mg-poke'), false, 'my-turn → no poke (would poke ourselves)');

  const expired = buildRowHtml({
    roomId: 'b', opponentName: 'B', opponentUid: 'opp',
    isMyTurn: false, isExpired: true, myScore: 0, opponentScore: 0,
    lastUpdated: now - 30 * HOUR, lastPokedAt: null,
  }, { now });
  assert.equal(expired.includes('data-mg-poke'), false, 'expired → no poke');

  const local = buildRowHtml({
    roomId: '__local__', opponentName: 'המחשב', isLocal: true,
    isMyTurn: true, isExpired: false, myScore: 0, opponentScore: 0,
    lastUpdated: now, lastPokedAt: null,
  }, { now });
  assert.equal(local.includes('data-mg-poke'), false, 'local saved game → no poke');
});

test('canPoke: 24-hour cooldown gate keyed on lastPokedAt (NOT lastReminderAt)', () => {
  const now = 100 * HOUR;
  const base = { isMyTurn: false, isExpired: false, isLocal: false, opponentUid: 'opp' };
  assert.equal(canPoke({ ...base, lastPokedAt: null }, now),                 true,  'no prior manual poke → allowed');
  assert.equal(canPoke({ ...base, lastPokedAt: now - 23 * HOUR }, now),      false, '<24 h since manual → blocked');
  assert.equal(canPoke({ ...base, lastPokedAt: now - 25 * HOUR }, now),      true,  '>24 h since manual → allowed again');
  // Cron's lastReminderAt is independent — must NOT gate the manual button.
  assert.equal(canPoke({ ...base, lastPokedAt: null, lastReminderAt: now - 1 * HOUR }, now), true,
    'recent auto-cron reminder must not hide the manual poke');
  assert.equal(canPoke({ ...base, isMyTurn: true,  lastPokedAt: null }, now), false);
  assert.equal(canPoke({ ...base, isExpired: true, lastPokedAt: null }, now), false);
  assert.equal(canPoke({ ...base, isLocal: true,   lastPokedAt: null }, now), false);
  assert.equal(canPoke({ ...base, opponentUid: null, lastPokedAt: null }, now), false);
});

test('buildRowHtml: local saved-game card uses the gold "is-local" frame and an enabled שחק button', () => {
  const html = buildRowHtml({
    roomId: '__local__', isLocal: true, isMyTurn: true, isExpired: false,
    opponentName: 'המחשב',
    myScore: 10, opponentScore: 5, lastUpdated: Date.now(),
  });
  assert.ok(html.includes('המחשב'));
  assert.ok(html.includes('is-local'));
  assert.ok(html.includes('data-mg-resume="__local__"'));
  assert.equal(html.includes('disabled'), false);
  assert.ok(html.includes('>10<'));
  assert.ok(html.includes('>5<'));
});

test('buildRowHtml: expired card replaces the שחק button with the 🗑 dismiss button', () => {
  const html = buildRowHtml({
    roomId: 'r2', opponentName: 'Bob',
    isMyTurn: false, isExpired: true,
    myScore: 0, opponentScore: 0, lastUpdated: Date.now(),
  });
  assert.equal(html.includes('data-mg-resume'), false, 'expired must not offer שחק');
  assert.ok(html.includes('data-mg-dismiss="r2"'));
  assert.ok(html.includes('🗑'));
  assert.equal(html.includes('>שחק<'), false);
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

test('mount: clicking the 👋 poke button emits MG_INTENT.POKE AND shows a success toast', () => {
  bus._reset();
  const fired = [];
  bus.on(MG_INTENT.POKE, (p) => fired.push(p));
  const { list, root, created } = makeRoot();
  const ui = mountAsyncGamesScreen({ root, bus, now: () => 0 });
  list.fireClick(makeButton({ 'data-mg-poke': 'r-poke-me' }));
  assert.deepEqual(fired, [{ roomId: 'r-poke-me' }]);
  // Toast was created and currently visible.
  const toast = created.find(el => el.className?.includes?.('mg-toast'));
  assert.ok(toast, 'a toast element must be created on poke');
  assert.ok(toast.className.includes('mg-toast--ok'));
  assert.ok(toast.className.includes('is-visible'));
  assert.match(toast.textContent, /דחיפה|נדחף/);
  ui.unmount();
});

test('mount: clicking the disabled שחק button does NOT emit RESUME and shows the "תור היריב" tooltip', () => {
  bus._reset();
  const fired = [];
  bus.on(MG_INTENT.RESUME, (p) => fired.push(p));
  const { list, root, created } = makeRoot();
  const ui = mountAsyncGamesScreen({ root, bus, now: () => 0 });
  list.fireClick(makeButton({ 'data-mg-resume': 'r-wait', 'aria-disabled': 'true' }));
  assert.deepEqual(fired, [], 'disabled שחק must not dispatch RESUME');
  const toast = created.find(el => el.className?.includes?.('mg-toast'));
  assert.ok(toast, 'a toast must appear');
  assert.ok(toast.className.includes('mg-toast--info'));
  assert.match(toast.textContent, /תור היריב|חכה/);
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

