// Unit tests for the playerInsights derivation. The module is pure and
// platform-free, so all tests run in node without DOM/Firebase.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveInsights, _internals } from './playerInsights.js';

const T_NOW = Date.UTC(2026, 5, 7, 14, 0, 0); // 2026-06-07T14:00Z
const HOUR = 3_600_000;
const DAY  = 24 * HOUR;

function mkGame(overrides = {}) {
  return {
    ts: T_NOW - DAY,
    mode: 'random-async',
    result: 'win',
    score: 200,
    opponentScore: 150,
    bonusesTriggered: 0,
    opponentUid: 'opp',
    opponentName: 'Opp',
    ...overrides,
  };
}

function mkProfile(stats = {}) {
  return {
    displayName: 'Tester',
    rating: 820,
    stats: {
      gamesPlayed: 0, gamesWon: 0, gamesLost: 0, gamesDraw: 0,
      highScore: 0, totalScore: 0, currentStreak: 0, longestStreak: 0,
      highestMoveScore: 0, bonusesTriggered: 0, wordsPlayed: 0,
      totalMoves: 0, totalTilesPlayed: 0,
      comebackWins: 0, lastMoveWins: 0, closeWins: 0, boostImpactWins: 0,
      longestWord: '', longestWordLength: 0,
      recentGames: [], boostUsage: {}, rivalStats: {}, wordCounts: {},
      weekdayStats: {}, moveSpeedStats: {},
      ...stats,
    },
  };
}

// ─── §1 Insights About You ────────────────────────────────────────────

test('insights: empty profile returns a friendly "start playing" prompt', () => {
  const out = deriveInsights(mkProfile(), T_NOW);
  assert.equal(out.insights.length, 1);
  assert.match(out.insights[0].text, /התחל לשחק/);
});

test('insights: recent form fires when 3+ of last 5 are wins', () => {
  const recentGames = [
    mkGame({ result: 'win'  }), mkGame({ result: 'win'  }),
    mkGame({ result: 'win'  }), mkGame({ result: 'loss' }),
    mkGame({ result: 'loss' }),
  ];
  const out = deriveInsights(mkProfile({ gamesPlayed: 5, gamesWon: 3, recentGames }), T_NOW);
  assert.ok(out.insights.some(i => /3 מ-5/.test(i.text)), JSON.stringify(out.insights));
});

test('insights: bonus correlation fires only when the lift is clearly positive', () => {
  // Six games with bonuses averaging much higher than the six without.
  const withBonus    = Array.from({ length: 6 }, (_, i) => mkGame({ result: i < 4 ? 'win' : 'loss', score: 250, bonusesTriggered: 1 }));
  const withoutBonus = Array.from({ length: 6 }, (_, i) => mkGame({ result: i < 2 ? 'win' : 'loss', score: 180, bonusesTriggered: 0 }));
  const out = deriveInsights(
    mkProfile({ gamesPlayed: 12, gamesWon: 6, recentGames: [...withBonus, ...withoutBonus] }),
    T_NOW,
  );
  assert.ok(out.insights.some(i => /בוסטים/.test(i.text)), JSON.stringify(out.insights));
});

test('insights: comeback card appears when comebackWins >= 2', () => {
  const recentGames = Array.from({ length: 5 }, () => mkGame());
  const out = deriveInsights(mkProfile({ gamesPlayed: 5, gamesWon: 4, comebackWins: 3, recentGames }), T_NOW);
  assert.ok(out.insights.some(i => /קאמבק|לוחם|מאחור/.test(i.text)), JSON.stringify(out.insights));
});

test('insights: strongest-day fires when one day clearly leads', () => {
  // Tuesday (day 2 in JS Date.getDay) — 4/4 wins. Other day — 0/2 wins.
  const weekdayStats = {
    '2': { played: 4, won: 4, totalScore: 1000 },
    '4': { played: 2, won: 0, totalScore: 200  },
  };
  const out = deriveInsights(mkProfile({ gamesPlayed: 6, gamesWon: 4, weekdayStats }), T_NOW);
  assert.ok(out.insights.some(i => /יום שלישי/.test(i.text)), JSON.stringify(out.insights));
});

// ─── §2 Player Archetype ──────────────────────────────────────────────

test('archetype: brand-new player gets the "חוקר" identity', () => {
  const out = deriveInsights(mkProfile({ gamesPlayed: 2 }), T_NOW);
  assert.equal(out.archetype.label, 'חוקר');
});

test('archetype: a 7-letter longest word triggers Vocabulary Master', () => {
  const out = deriveInsights(mkProfile({
    gamesPlayed: 10, gamesWon: 5, longestWord: 'אסטרטג', longestWordLength: 7,
  }), T_NOW);
  assert.equal(out.archetype.label, 'מומחה לאוצר מילים');
});

test('archetype: high comeback ratio triggers Risk Taker', () => {
  const out = deriveInsights(mkProfile({
    gamesPlayed: 10, gamesWon: 6, comebackWins: 3,
    longestWord: 'אבא', longestWordLength: 3,
  }), T_NOW);
  assert.equal(out.archetype.label, 'לוקח סיכונים');
});

test('archetype: precision (mostly close wins + winRate≥50%) triggers שחקן מדויק', () => {
  const out = deriveInsights(mkProfile({
    gamesPlayed: 10, gamesWon: 6, closeWins: 4,
    longestWord: 'בא', longestWordLength: 2,
    comebackWins: 0,
  }), T_NOW);
  assert.equal(out.archetype.label, 'שחקן מדויק');
});

// ─── §3 Performance Trends ────────────────────────────────────────────

test('trends: win-rate trend reports lifetime when recent sample is thin', () => {
  const out = deriveInsights(mkProfile({
    gamesPlayed: 20, gamesWon: 12,
    recentGames: [mkGame({ result: 'win' }), mkGame({ result: 'win' })],
  }), T_NOW);
  assert.equal(out.trends.winRate.sample, 'lifetime');
  assert.equal(out.trends.winRate.valuePct, 60);
});

test('trends: win-rate deltaPct comes from comparing the two halves of recentGames', () => {
  // Recent half (newest 5) = 4 wins. Older half = 1 win.
  const recentGames = [
    ...Array.from({ length: 5 }, (_, i) => mkGame({ result: i < 4 ? 'win' : 'loss' })),
    ...Array.from({ length: 5 }, (_, i) => mkGame({ result: i < 1 ? 'win' : 'loss' })),
  ];
  const out = deriveInsights(mkProfile({ gamesPlayed: 30, gamesWon: 18, recentGames }), T_NOW);
  assert.equal(out.trends.winRate.valuePct, 80);
  assert.equal(out.trends.winRate.deltaPct, 60);
});

test('trends: activity counts games in last 7 days vs the previous 7', () => {
  const recentGames = [
    mkGame({ ts: T_NOW - 1 * DAY }),
    mkGame({ ts: T_NOW - 3 * DAY }),
    mkGame({ ts: T_NOW - 5 * DAY }),
    mkGame({ ts: T_NOW - 9 * DAY }),
    mkGame({ ts: T_NOW - 12 * DAY }),
  ];
  const out = deriveInsights(mkProfile({ recentGames }), T_NOW);
  assert.equal(out.trends.activity.thisWeek, 3);
  assert.equal(out.trends.activity.prevWeek, 2);
  assert.equal(out.trends.activity.deltaAbs, 1);
});

test('trends: ELO milestone surfaces the next tier name + floor', () => {
  // 825 sits inside the silver bracket (≥800), so the next floor is gold @950.
  const out = deriveInsights({ stats: mkProfile().stats, rating: 825 }, T_NOW);
  assert.equal(out.trends.rating.nextTierLabel, 'זהב');
  assert.equal(out.trends.rating.nextTierFloor, 950);
});

// ─── §4 Word Intelligence ─────────────────────────────────────────────

test('wordIntel: avgWordLength weighted by word counts', () => {
  const out = deriveInsights(mkProfile({
    totalMoves: 10, totalScore: 200,
    longestWord: 'מילים', longestWordLength: 5,
    highestMoveScore: 60,
    wordCounts: {
      'אב': 4,    // 2 letters × 4 = 8
      'מילה': 2,  // 4 letters × 2 = 8
      'מילים': 1, // 5 letters × 1 = 5
    },
  }), T_NOW);
  // (8+8+5) / (4+2+1) = 21/7 = 3
  assert.equal(out.wordIntel.avgWordLength, 3);
  assert.equal(out.wordIntel.longestWord, 'מילים');
  assert.equal(out.wordIntel.bestMoveScore, 60);
  assert.equal(out.wordIntel.avgPointsPerMove, 20);
  // Most used length: 2 (4 hits) beats 4 (2 hits) beats 5 (1 hit).
  assert.equal(out.wordIntel.mostUsedLength, 2);
});

// ─── §5 Play Style bars ───────────────────────────────────────────────

test('playStyle: returns the five expected bars with pct in [0..100]', () => {
  const out = deriveInsights(mkProfile({
    gamesPlayed: 10, gamesWon: 5, totalMoves: 50, bonusesTriggered: 3,
    longestWordLength: 5, comebackWins: 1,
    moveSpeedStats: { '20': { played: 5, won: 2 }, '40': { played: 5, won: 3 }, '60': { played: 0, won: 0 } },
    recentGames: Array.from({ length: 5 }, (_, i) => mkGame({ score: 200 + i * 5 })),
  }), T_NOW);
  assert.equal(out.playStyle.length, 5);
  for (const bar of out.playStyle) {
    assert.ok(bar.pct >= 0 && bar.pct <= 100, `${bar.label} pct out of range: ${bar.pct}`);
    assert.ok(typeof bar.label === 'string' && bar.label.length > 0);
  }
});

// ─── §7 This Week Snapshot ────────────────────────────────────────────

test('weekSnapshot: filters recentGames to the last 7 days', () => {
  const recentGames = [
    mkGame({ ts: T_NOW - 1 * DAY, result: 'win',  score: 200 }),
    mkGame({ ts: T_NOW - 2 * DAY, result: 'win',  score: 180 }),
    mkGame({ ts: T_NOW - 3 * DAY, result: 'loss', score: 140 }),
    mkGame({ ts: T_NOW - 8 * DAY, result: 'win',  score: 220 }), // outside window
  ];
  const out = deriveInsights(mkProfile({ recentGames }), T_NOW);
  assert.equal(out.weekSnapshot.played, 3);
  assert.equal(out.weekSnapshot.won, 2);
  assert.equal(out.weekSnapshot.avgScore, Math.round((200 + 180 + 140) / 3));
  // Streak inside the window: 2 → 1 (loss interrupts) — bestStreak should be 2.
  assert.equal(out.weekSnapshot.bestStreak, 2);
});

// ─── §8 Opponent Insights ─────────────────────────────────────────────

test('opponents: identifies rival / favorite / competitive / bestRecord from rivalStats', () => {
  // Picks have to be unambiguous given the categories:
  //   rival       = most played overall
  //   favorite    = highest total wins (your top scalp)
  //   competitive = closest to 50/50 with min 3 games
  //   bestRecord  = highest winPct with min 3 games
  const rivalStats = {
    rival:    { uid: 'rival',    name: 'Rival',  played: 18, won: 7,  lost: 10, draw: 1, pointsFor: 0, pointsAgainst: 0 },
    favorite: { uid: 'favorite', name: 'Fav',    played: 12, won: 11, lost: 1,  draw: 0, pointsFor: 0, pointsAgainst: 0 },
    even:     { uid: 'even',     name: 'Even',   played: 8,  won: 4,  lost: 4,  draw: 0, pointsFor: 0, pointsAgainst: 0 },
    perfect:  { uid: 'perfect',  name: 'Perf',   played: 4,  won: 4,  lost: 0,  draw: 0, pointsFor: 0, pointsAgainst: 0 },
  };
  const out = deriveInsights(mkProfile({ rivalStats }), T_NOW);
  assert.equal(out.opponents.rival.uid,       'rival',    'rival = most played');
  assert.equal(out.opponents.favorite.uid,    'favorite', 'favorite = most wins');
  assert.equal(out.opponents.competitive.uid, 'even',     'competitive = closest to 50/50');
  assert.equal(out.opponents.bestRecord.uid,  'perfect',  'bestRecord = highest winPct (≥3 games)');
});

test('opponents: empty rivalStats returns all-nulls (renderer handles the empty state)', () => {
  const out = deriveInsights(mkProfile(), T_NOW);
  assert.equal(out.opponents.rival, null);
  assert.equal(out.opponents.favorite, null);
  assert.equal(out.opponents.competitive, null);
  assert.equal(out.opponents.bestRecord, null);
});

// ─── §9 Milestones ────────────────────────────────────────────────────

test('milestones: includes the next ELO tier, next high-score round, and next streak level', () => {
  const out = deriveInsights({
    rating: 825,
    stats: {
      ...mkProfile().stats,
      gamesPlayed: 5, gamesWon: 3,
      highScore: 218, longestStreak: 2,
    },
  }, T_NOW);
  const labels = out.milestones.map(m => m.label);
  // 825 sits in silver — next tier is gold (זהב).
  assert.ok(labels.some(l => /זהב/.test(l)),    labels.join(' | '));
  assert.ok(labels.some(l => /250 נקודות/.test(l)), labels.join(' | ')); // 218 → next 50 = 250
  assert.ok(labels.some(l => /רצף של 3 ניצחונות/.test(l)), labels.join(' | '));
});

// ─── §10 Did You Know? ────────────────────────────────────────────────

test('didYouKnow: surfaces a stable fact tied to gamesPlayed', () => {
  const profile = mkProfile({
    gamesPlayed: 10, gamesWon: 7, boostImpactWins: 4,
    longestWord: 'אסטרטגי', longestWordLength: 7,
  });
  const a = deriveInsights(profile, T_NOW);
  const b = deriveInsights(profile, T_NOW);
  assert.equal(a.didYouKnow.text, b.didYouKnow.text, 'same profile → same fact');
  // A new game produces a different (or possibly the same) fact, but never throws.
  profile.stats.gamesPlayed = 11;
  const c = deriveInsights(profile, T_NOW);
  assert.equal(typeof c.didYouKnow.text, 'string');
  assert.ok(c.didYouKnow.text.length > 0);
});

test('didYouKnow: fully empty profile still gets a friendly fallback', () => {
  const out = deriveInsights(mkProfile(), T_NOW);
  assert.match(out.didYouKnow.text, /שחק עוד/);
});

// ─── Helper coverage ─────────────────────────────────────────────────

test('helpers: ratingMilestone returns null tier for already-top players', () => {
  const r = _internals.ratingMilestone(1500);
  assert.equal(r.nextTierLabel, null);
  assert.equal(r.progressPct, 100);
});

test('helpers: scoreConsistency = 1 for identical scores', () => {
  const games = [
    mkGame({ score: 200 }), mkGame({ score: 200 }),
    mkGame({ score: 200 }), mkGame({ score: 200 }),
  ];
  assert.equal(_internals.scoreConsistency(games), 1);
});
