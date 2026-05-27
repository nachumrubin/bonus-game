import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { PROFILE_RENDER } from './profileScreen.js';
import { deriveStatsView, mountStatsScreen } from './statsScreen.js';

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
    'sstats', 'st-hero-av', 'st-hero-name', 'st-hero-tier', 'st-hero-wr', 'st-hero-streak', 'st-hero-insight',
    'st-sparkline', 'st-rating', 'st-tier-bar',
    'st-highscore', 'st-avg', 'st-played',
    'st-won', 'st-lost', 'st-draw', 'st-bar-w', 'st-bar-l', 'st-bar-d',
    'st-fun-bestmove', 'st-fun-longest', 'st-fun-streak', 'st-fun-comeback', 'st-fun-repeated', 'st-fun-bestday',
    'st-rivals-content', 'st-boost-total', 'st-boost-avg', 'st-boost-winrate',
    'st-boost-fav-icon', 'st-boost-fav-name', 'st-boost-fav-pct',
    'st-comeback', 'st-lastmove', 'st-closewins',
    'st-streak', 'st-words', 'stats-wr-pct',
  ]) ids[id] = makeEl();

  const tabs = [
    makeEl({ textContent: 'תקדמות' }),
    makeEl({ textContent: 'שיאים' }),
    makeEl({ textContent: 'יריבים ובוסטים' }),
  ];
  const panels = ['progress', 'records', 'rivals'].map(id => {
    const el = makeEl();
    ids[`st-panel-${id}`] = el;
    return el;
  });
  const share = makeEl();

  const root = {
    querySelector(sel) {
      if (sel.startsWith('#') && !sel.includes(' ')) return ids[sel.slice(1)] ?? null;
      if (sel === '.stats-share-btn') return share;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.stats-tab') return tabs;
      if (sel === '.stats-panel') return panels;
      return [];
    },
  };
  return { root, ids, tabs, panels, share };
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
  assert.equal(view.favoriteBoost.label, '25 נקודות');
  assert.equal(view.longestWord, 'שלום');
});

test('mountStatsScreen: paints profile stats and handles controls', () => {
  bus._reset();
  const { root, ids, tabs, share } = makeDom();
  mountStatsScreen({ root, bus, win: { navigator: { clipboard: { writeText() {} } } } });

  bus.emit(PROFILE_RENDER, {
    profile: {
      displayName: 'Tester',
      equippedAvatar: 'star',
      rating: 1000,
      stats: {
        gamesPlayed: 8, gamesWon: 4, gamesLost: 3, gamesDraw: 1,
        highScore: 300, highestMoveScore: 92, totalScore: 900, longestStreak: 3, currentStreak: 2,
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
  assert.equal(ids['st-fun-bestmove'].textContent, '92');
  assert.equal(ids['st-boost-total'].textContent, '6');
  assert.equal(ids['st-fun-longest'].textContent, 'מבחן');

  tabs[1].fireClick();
  assert.equal(ids['st-panel-records'].classList.contains('active'), true);
  share.fireClick();
});

test('mountStatsScreen: missing rich stats render intentionally empty', () => {
  bus._reset();
  const { root, ids } = makeDom();
  mountStatsScreen({ root, bus, win: {} });
  bus.emit(PROFILE_RENDER, { profile: { displayName: 'New', stats: {} } });
  assert.equal(ids['st-played'].textContent, '0');
  assert.equal(ids['st-fun-longest'].textContent, '—');
  assert.equal(ids['st-fun-comeback'].textContent, '—');
});
