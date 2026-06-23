import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { PROFILE_RENDER } from './profileScreen.js';
import { deriveStatsView, mountStatsScreen } from './statsScreen.js';

function makeEl({ textContent = '' } = {}) {
  const listeners = [];
  const classes = new Set();
  const dataset = {};
  return {
    textContent,
    innerHTML: '',
    style: { display: '', width: '' },
    dataset,
    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      toggle: (name) => classes.has(name) ? classes.delete(name) : classes.add(name),
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
    'st-sparkline', 'st-rating',
    'st-highscore', 'st-fun-bestmove', 'st-fun-longest', 'st-fun-streak', 'st-fun-comeback',
    'st-won', 'st-lost', 'st-draw', 'st-bar-w', 'st-bar-l', 'st-bar-d',
    'st-rivals-content',
    'st-boost-fav-icon', 'st-boost-fav-name', 'st-boost-fav-pct',
    'st-comeback', 'st-lastmove', 'st-closewins',
    'st-streak', 'st-words', 'stats-wr-pct',
    'ins-arch-icon', 'ins-arch-label', 'ins-arch-blurb',
    'ins-week', 'ins-trends', 'ins-style', 'ins-words',
    'st-form-teaser', 'st-ach-teaser', 'st-style-teaser', 'st-rivals-teaser',
    'st-sec-form', 'st-sec-achievements', 'st-sec-style', 'st-sec-rivals',
  ]) ids[id] = makeEl();

  const sectionHeaders = ['form', 'achievements', 'style', 'rivals'].map(sec => {
    const el = makeEl();
    el.dataset.section = sec;
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
      if (sel === '.st-section-header') return sectionHeaders;
      if (sel === '.st-section-card') {
        return ['st-sec-form', 'st-sec-achievements', 'st-sec-style', 'st-sec-rivals'].map(id => ids[id]);
      }
      return [];
    },
  };
  return { root, ids, sectionHeaders, share };
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

test('deriveStatsView: favorite starting letter prefers startingLetterCounts', () => {
  const view = deriveStatsView({
    stats: { startingLetterCounts: { ש: 6, מ: 2, א: 2 } },
  });
  assert.equal(view.favoriteStartLetter.letter, 'ש');
  assert.equal(view.favoriteStartLetter.count, 6);
  assert.equal(view.favoriteStartLetter.pct, 60);
});

test('deriveStatsView: favorite starting letter falls back to wordCounts', () => {
  const view = deriveStatsView({
    stats: { wordCounts: { שלום: 3, שמש: 1, מים: 1 } },
  });
  // ש begins 4 of 5 word-instances → 80%.
  assert.equal(view.favoriteStartLetter.letter, 'ש');
  assert.equal(view.favoriteStartLetter.count, 4);
  assert.equal(view.favoriteStartLetter.pct, 80);
});

test('deriveStatsView: no words → no favorite starting letter', () => {
  const view = deriveStatsView({ stats: {} });
  assert.equal(view.favoriteStartLetter, null);
});

test('mountStatsScreen: paints profile stats and handles controls', () => {
  bus._reset();
  const { root, ids, sectionHeaders, share } = makeDom();
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
  assert.equal(ids['st-rating'].textContent, '1000');
  assert.equal(ids['st-won'].textContent, '4');
  assert.equal(ids['st-highscore'].textContent, '300');
  assert.equal(ids['st-fun-bestmove'].textContent, '92');
  assert.equal(ids['st-fun-longest'].textContent, 'מבחן');

  // Clicking a section header toggles the .open class on the section card
  sectionHeaders[1].fireClick(); // achievements header
  assert.equal(ids['st-sec-achievements'].classList.contains('open'), true);
  sectionHeaders[1].fireClick(); // toggle closed again
  assert.equal(ids['st-sec-achievements'].classList.contains('open'), false);

  // Accordion: opening one section closes any other open section
  sectionHeaders[1].fireClick(); // open achievements
  sectionHeaders[2].fireClick(); // open style → should close achievements
  assert.equal(ids['st-sec-style'].classList.contains('open'), true);
  assert.equal(ids['st-sec-achievements'].classList.contains('open'), false);

  share.fireClick();
});

test('mountStatsScreen: missing rich stats render intentionally empty', () => {
  bus._reset();
  const { root, ids } = makeDom();
  mountStatsScreen({ root, bus, win: {} });
  bus.emit(PROFILE_RENDER, { profile: { displayName: 'New', stats: {} } });
  assert.equal(ids['st-highscore'].textContent, '0');
  assert.equal(ids['st-fun-longest'].textContent, '—');
  assert.equal(ids['st-fun-comeback'].textContent, '—');
});
