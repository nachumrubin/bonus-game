import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectSessionTips,
  recordShownTips,
  getGamesPlayed,
  cacheGamesPlayed,
  TIPS_HISTORY_KEY,
  TIPS_GAMES_KEY,
} from './loadingTipsService.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem:    (k) => data.has(k) ? data.get(k) : null,
    setItem:    (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _get: (k) => data.get(k),
    _has: (k) => data.has(k),
  };
}

function makeTips(overrides = []) {
  const defaults = [
    { id: 'a', title: 'T', text: 'A', category: 'beginner',    enabled: true, weight: 5 },
    { id: 'b', title: 'T', text: 'B', category: 'beginner',    enabled: true, weight: 5 },
    { id: 'c', title: 'T', text: 'C', category: 'intermediate',enabled: true, weight: 5 },
    { id: 'd', title: 'T', text: 'D', category: 'advanced',    enabled: true, weight: 5 },
    { id: 'e', title: 'T', text: 'E', category: 'didYouKnow',  enabled: true, weight: 5 },
    { id: 'f', title: 'T', text: 'F', category: 'beginner',    enabled: true, weight: 5 },
  ];
  return [...defaults, ...overrides];
}

// ── getGamesPlayed / cacheGamesPlayed ─────────────────────────────────────────

test('getGamesPlayed returns 0 when storage is empty', () => {
  const s = makeStorage();
  assert.equal(getGamesPlayed(s), 0);
});

test('getGamesPlayed returns cached value', () => {
  const s = makeStorage({ [TIPS_GAMES_KEY]: '42' });
  assert.equal(getGamesPlayed(s), 42);
});

test('cacheGamesPlayed writes correct value', () => {
  const s = makeStorage();
  cacheGamesPlayed(17, s);
  assert.equal(s._get(TIPS_GAMES_KEY), '17');
});

test('cacheGamesPlayed clamps negative values to 0', () => {
  const s = makeStorage();
  cacheGamesPlayed(-5, s);
  assert.equal(s._get(TIPS_GAMES_KEY), '0');
});

test('getGamesPlayed returns 0 for non-numeric stored value', () => {
  const s = makeStorage({ [TIPS_GAMES_KEY]: 'not-a-number' });
  assert.equal(getGamesPlayed(s), 0);
});

// ── recordShownTips ───────────────────────────────────────────────────────────

test('recordShownTips persists ids to storage', () => {
  const s = makeStorage();
  recordShownTips(['a', 'b'], s);
  assert.deepEqual(JSON.parse(s._get(TIPS_HISTORY_KEY)), ['a', 'b']);
});

test('recordShownTips appends to existing history', () => {
  const s = makeStorage({ [TIPS_HISTORY_KEY]: JSON.stringify(['x', 'y']) });
  recordShownTips(['a'], s);
  assert.deepEqual(JSON.parse(s._get(TIPS_HISTORY_KEY)), ['x', 'y', 'a']);
});

test('recordShownTips trims history to last 10 entries', () => {
  const existing = ['1','2','3','4','5','6','7','8','9','10'];
  const s = makeStorage({ [TIPS_HISTORY_KEY]: JSON.stringify(existing) });
  recordShownTips(['new1', 'new2'], s);
  const result = JSON.parse(s._get(TIPS_HISTORY_KEY));
  assert.equal(result.length, 10);
  assert.ok(result.includes('new1'));
  assert.ok(result.includes('new2'));
  assert.ok(!result.includes('1'));
  assert.ok(!result.includes('2'));
});

// ── selectSessionTips ────────────────────────────────────────────────────────

test('selectSessionTips returns up to count tips', () => {
  const tips = makeTips();
  const s = makeStorage();
  const result = selectSessionTips(tips, { storage: s, count: 3 });
  assert.equal(result.length, 3);
});

test('selectSessionTips returns all if fewer than count available', () => {
  const tips = [
    { id: 'a', title: 'T', text: 'A', category: 'beginner', enabled: true, weight: 5 },
    { id: 'b', title: 'T', text: 'B', category: 'beginner', enabled: true, weight: 5 },
  ];
  const s = makeStorage();
  const result = selectSessionTips(tips, { storage: s, count: 5 });
  assert.equal(result.length, 2);
});

test('selectSessionTips filters out disabled tips', () => {
  const tips = [
    { id: 'a', title: 'T', text: 'A', category: 'beginner', enabled: false, weight: 5 },
    { id: 'b', title: 'T', text: 'B', category: 'beginner', enabled: true,  weight: 5 },
  ];
  const s = makeStorage();
  const result = selectSessionTips(tips, { storage: s, count: 5 });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'b');
});

test('selectSessionTips respects minGamesPlayed', () => {
  const tips = [
    { id: 'a', title: 'T', text: 'A', category: 'beginner', enabled: true, weight: 5, minGamesPlayed: 10 },
    { id: 'b', title: 'T', text: 'B', category: 'beginner', enabled: true, weight: 5 },
  ];
  const s = makeStorage({ [TIPS_GAMES_KEY]: '5' });
  const result = selectSessionTips(tips, { storage: s, count: 5 });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'b');
});

test('selectSessionTips respects maxGamesPlayed', () => {
  const tips = [
    { id: 'a', title: 'T', text: 'A', category: 'beginner', enabled: true, weight: 5, maxGamesPlayed: 5 },
    { id: 'b', title: 'T', text: 'B', category: 'beginner', enabled: true, weight: 5 },
  ];
  const s = makeStorage({ [TIPS_GAMES_KEY]: '10' });
  const result = selectSessionTips(tips, { storage: s, count: 5 });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'b');
});

test('selectSessionTips returns no duplicates', () => {
  const tips = makeTips();
  const s = makeStorage();
  const result = selectSessionTips(tips, { storage: s, count: 5 });
  const ids = result.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('selectSessionTips does not expose internal _w field', () => {
  const tips = makeTips();
  const s = makeStorage();
  const result = selectSessionTips(tips, { storage: s, count: 3 });
  for (const tip of result) {
    assert.ok(!('_w' in tip), 'tip should not have _w field');
  }
});

test('selectSessionTips prefers fresh tips over recently shown ones', () => {
  // 4 tips shown recently, 2 fresh — should prefer the 2 fresh when count=2
  const tips = [
    { id: 'a', title: 'T', text: 'A', category: 'beginner', enabled: true, weight: 5 },
    { id: 'b', title: 'T', text: 'B', category: 'beginner', enabled: true, weight: 5 },
    { id: 'fresh1', title: 'T', text: 'C', category: 'beginner', enabled: true, weight: 5 },
    { id: 'fresh2', title: 'T', text: 'D', category: 'beginner', enabled: true, weight: 5 },
  ];
  const history = JSON.stringify(['a', 'b']);
  const s = makeStorage({ [TIPS_HISTORY_KEY]: history });
  const result = selectSessionTips(tips, { storage: s, count: 2 });
  const ids = result.map(t => t.id);
  assert.ok(ids.includes('fresh1'));
  assert.ok(ids.includes('fresh2'));
});

test('selectSessionTips falls back to all eligible if not enough fresh', () => {
  // Only 2 eligible tips, both in history — must still return them
  const tips = [
    { id: 'a', title: 'T', text: 'A', category: 'beginner', enabled: true, weight: 5 },
    { id: 'b', title: 'T', text: 'B', category: 'beginner', enabled: true, weight: 5 },
  ];
  const history = JSON.stringify(['a', 'b', 'c', 'd', 'e']); // both in history
  const s = makeStorage({ [TIPS_HISTORY_KEY]: history });
  const result = selectSessionTips(tips, { storage: s, count: 2 });
  assert.equal(result.length, 2);
});

test('selectSessionTips returns empty array when no tips provided', () => {
  const s = makeStorage();
  const result = selectSessionTips([], { storage: s });
  assert.equal(result.length, 0);
});

test('selectSessionTips handles null/undefined storage gracefully', () => {
  const tips = makeTips();
  assert.doesNotThrow(() => selectSessionTips(tips, { storage: null, count: 3 }));
});
