import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { PROFILE_RENDER } from './profileScreen.js';
import { STATS_INTENT, deriveStatsView, mountStatsScreen } from './statsScreen.js';

function makeEl({ textContent = '' } = {}) {
  const listeners = [];
  const classes = new Set();
  return {
    textContent,
    innerHTML: '',
    style: { display: '', width: '' },
    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      contains: (name) => classes.has(name),
    },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    removeAttribute() {},
    getAttribute() { return null; },
    fireClick() {
      for (const l of listeners) {
        if (l.ev === 'click') l.fn({ preventDefault() {} });
      }
    },
  };
}

function makeDom() {
  const ids = {};
  for (const id of [
    'sstats', 'st-hero-av', 'st-hero-name', 'st-hero-tier', 'st-hero-wr', 'st-hero-streak', 'st-hero-rank', 'st-hero-insight',
    'st-highscore', 'st-avg', 'st-played', 'st-best-streak', 'st-bonuses', 'st-avgword', 'st-won', 'st-lost', 'st-draw',
    'st-wr-pct-lbl', 'st-streak-lbl', 'st-bar-w', 'st-bar-l', 'st-bar-d', 'st-rating', 'st-perf-tier-badge', 'st-tier-bar',
    'st-pts-move', 'st-pts-tile', 'st-move-time', 'st-comeback', 'st-lastmove', 'st-closewins', 'st-boost-total',
    'st-boost-avg', 'st-boost-winrate', 'st-boost-fav-icon', 'st-boost-fav-name', 'st-boost-fav-pct', 'st-boost-impact-wins',
    'st-boost-impact-best', 'st-boost-combo', 'st-rivals-content', 'st-vs-stronger-w', 'st-vs-weaker-w', 'st-fun-longest',
    'st-fun-repeated', 'st-fun-fastest', 'st-fun-comeback', 'st-fun-bestday', 'st-fun-luck', 'st-streak', 'st-words', 'stats-wr-pct',
  ]) ids[id] = makeEl();

  const topbar = [makeEl(), makeEl()];
  const tf = [makeEl({ textContent: 'שבוע' }), makeEl({ textContent: 'חודש' }), makeEl({ textContent: 'הכל' })];
  const tabs = [
    makeEl({ textContent: 'סקירה' }),
    makeEl({ textContent: 'ביצועים' }),
    makeEl({ textContent: 'בוסטים' }),
    makeEl({ textContent: 'יריבים' }),
    makeEl({ textContent: 'כיף' }),
  ];
  const panels = ['overview', 'performance', 'boosts', 'rivals', 'fun'].map(id => {
    const el = makeEl();
    ids[`st-panel-${id}`] = el;
    return el;
  });
  const share = makeEl();

  const root = {
    querySelector(sel) {
      if (sel.startsWith('#') && !sel.includes(' ')) return ids[sel.slice(1)] ?? null;
      if (sel === '#sstats .stats-topbar button') return topbar[0];
      if (sel === '.stats-share-btn') return share;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '#sstats .stats-topbar button') return topbar;
      if (sel === '.stats-tfseg') return tf;
      if (sel === '.stats-tab') return tabs;
      if (sel === '.stats-panel') return panels;
      return [];
    },
  };
  return { root, ids, topbar, tf, tabs, panels, share };
}

test('deriveStatsView: computes primary display fields', () => {
  const view = deriveStatsView({
    rating: 990,
    stats: {
      gamesPlayed: 10, gamesWon: 7, gamesLost: 2, gamesDraw: 1,
      highScore: 220, totalScore: 1000, totalMoves: 50, totalTilesPlayed: 250,
      bonusesTriggered: 5, wordsPlayed: 40, boostUsage: { B9: 3, B1: 2 },
      longestWord: 'שלום', wordCounts: { שלום: 4 }, recentGames: [{ result: 'win', bonusesTriggered: 1 }],
    },
  });
  assert.equal(view.winRate, 70);
  assert.equal(view.avgScore, 100);
  assert.equal(view.pointsPerMove, 20);
  assert.equal(view.pointsPerTile, 4);
  assert.equal(view.favoriteBoost.label, '25 נקודות');
  assert.equal(view.longestWord, 'שלום');
});

test('mountStatsScreen: paints profile stats and handles controls', () => {
  bus._reset();
  const { root, ids, topbar, tf, tabs, share } = makeDom();
  let backed = 0;
  let refreshed = 0;
  bus.on(STATS_INTENT.BACK, () => backed++);
  bus.on(STATS_INTENT.REFRESH, () => refreshed++);
  mountStatsScreen({ root, bus, win: { navigator: { clipboard: { writeText() {} } } } });

  bus.emit(PROFILE_RENDER, {
    profile: {
      displayName: 'Tester',
      equippedAvatar: 'star',
      rating: 1000,
      stats: {
        gamesPlayed: 8, gamesWon: 4, gamesLost: 3, gamesDraw: 1,
        highScore: 300, totalScore: 900, longestStreak: 3, currentStreak: 2,
        bonusesTriggered: 6, wordsPlayed: 12, totalMoves: 30, totalTilesPlayed: 60,
        comebackWins: 1, lastMoveWins: 2, closeWins: 3,
        boostUsage: { B13: 4 }, longestWord: 'מבחן', wordCounts: { מבחן: 2 },
        rivalStats: { u2: { uid: 'u2', name: 'Rival', played: 2, won: 1, lost: 1, draw: 0 } },
      },
    },
  });

  assert.equal(ids['st-hero-name'].textContent, 'Tester');
  assert.equal(ids['st-played'].textContent, '8');
  assert.equal(ids['st-won'].textContent, '4');
  assert.equal(ids['st-highscore'].textContent, '300');
  assert.equal(ids['st-boost-total'].textContent, '6');
  assert.equal(ids['st-fun-longest'].textContent, 'מבחן');

  topbar[1].fireClick();
  assert.equal(refreshed, 1);
  tabs[1].fireClick();
  assert.equal(ids['st-panel-performance'].classList.contains('active'), true);
  tf[0].fireClick();
  assert.equal(tf[0].classList.contains('active'), true);
  share.fireClick();
  topbar[0].fireClick();
  assert.equal(backed, 1);
});

test('mountStatsScreen: missing rich stats render intentionally empty', () => {
  bus._reset();
  const { root, ids } = makeDom();
  mountStatsScreen({ root, bus, win: {} });
  bus.emit(PROFILE_RENDER, { profile: { displayName: 'New', stats: {} } });
  assert.equal(ids['st-played'].textContent, '0');
  assert.equal(ids['st-fun-longest'].textContent, '—');
  assert.equal(ids['st-move-time'].textContent, '—');
});
