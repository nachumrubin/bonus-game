import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { PROFILE_RENDER } from './profileScreen.js';
import {
  deriveStatsView, mountStatsScreen, weekDays, recentBars, nemesisOf, archetypeLetter, radarSvg,
} from './statsScreen.js';

function makeEl({ textContent = '' } = {}) {
  const listeners = [];
  const classes = new Set();
  const dataset = {};
  return {
    textContent,
    innerHTML: '',
    style: {},
    dataset,
    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      toggle: (name, force) => {
        const want = force ?? !classes.has(name);
        if (want) classes.add(name); else classes.delete(name);
        return want;
      },
      contains: (name) => classes.has(name),
    },
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener() {},
    removeAttribute() {},
    getAttribute() { return null; },
    fire(ev, target) {
      for (const l of listeners) if (l.ev === ev) l.fn({ preventDefault() {}, target });
    },
  };
}

const TABS = ['overview', 'records', 'style', 'rivals'];

function makeDom() {
  const ids = {};
  for (const id of [
    'sstats', 'st-hero-av', 'st-hero-name', 'st-hero-tier', 'st-hero-tier-pill', 'st-ring-fill', 'st-rating',
    'st-hero-next', 'st-hero-wr', 'st-hero-streak', 'st-hero-played',
    'ins-week', 'st-recent', 'st-recent-pick', 'st-donut', 'st-won', 'st-lost', 'st-draw', 'st-balance-n', 'ins-trends',
    'st-bestmove', 'st-highscore', 'st-fun-streak', 'st-fun-comeback', 'st-fun-longest', 'st-fun-longest-len',
    'st-comeback', 'st-lastmove', 'st-closewins',
    'ins-arch-icon', 'ins-arch-label', 'ins-arch-blurb', 'st-radar', 'st-favs', 'ins-words',
    'st-rivals-content',
    ...TABS.map(t => `st-panel-${t}`),
  ]) ids[id] = makeEl();
  ids['st-panel-overview'].classList.add('on');

  const tabs = TABS.map(t => {
    const el = makeEl();
    el.dataset.tab = t;
    if (t === 'overview') el.classList.add('on');
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
      if (sel === '.sx-tab') return tabs;
      return [];
    },
  };
  return { root, ids, tabs, share };
}

const NOW = new Date(2026, 9, 25, 15, 0).getTime();
const DAY = 24 * 3_600_000;

const PROFILE = {
  displayName: 'Tester',
  equippedAvatar: 'star',
  rating: 1000,
  stats: {
    gamesPlayed: 8, gamesWon: 4, gamesLost: 3, gamesDraw: 1,
    highScore: 300, highestMoveScore: 92, totalScore: 900, longestStreak: 3, currentStreak: 2,
    bonusesTriggered: 6, wordsPlayed: 12, totalMoves: 30, totalTilesPlayed: 60,
    comebackWins: 1, lastMoveWins: 2, closeWins: 3, biggestComeback: 41,
    boostUsage: { B13: 4 }, longestWord: 'מבחן', wordCounts: { מבחן: 2 },
    bestMove: { word: 'שלום', tiles: [{ letter: 'ש', val: 3 }, { letter: 'ל', val: 2 }, { letter: 'ו', val: 1 }, { letter: 'ם', val: 2 }], score: 92, ts: NOW - 3 * DAY, opponentName: 'Rival' },
    recentGames: [
      { ts: NOW - 1000, result: 'win', score: 300, opponentScore: 250, opponentUid: 'u2', opponentName: 'Rival' },
      { ts: NOW - DAY, result: 'loss', score: 200, opponentScore: 230, opponentUid: 'u3', opponentName: 'Nem' },
    ],
    rivalStats: {
      u2: { uid: 'u2', name: 'Rival', played: 2, won: 1, lost: 1, draw: 0 },
      u3: { uid: 'u3', name: 'Nem', played: 4, won: 1, lost: 3, draw: 0 },
    },
  },
};

test('deriveStatsView: computes primary display fields', () => {
  const view = deriveStatsView({
    rating: 990,
    stats: {
      gamesPlayed: 10, gamesWon: 7, gamesLost: 2, gamesDraw: 1,
      highScore: 220, totalScore: 1000, bonusesTriggered: 5, wordsPlayed: 40, boostUsage: { B9: 3, B1: 2 },
      longestWord: 'שלום', wordCounts: { שלום: 4 }, biggestComeback: 33,
    },
  });
  assert.equal(view.winRate, 70);
  assert.equal(view.avgScore, 100);
  assert.equal(view.favoriteBoost.label, '25 נקודות');
  assert.equal(view.longestWord, 'שלום');
  assert.equal(view.tier.label, 'זהב');
  assert.deepEqual(view.repeatedWord, { word: 'שלום', count: 4 });
  assert.equal(view.bestComeback, '+33');
});

test('deriveStatsView: favorite starting letter prefers startingLetterCounts, falls back to wordCounts', () => {
  const a = deriveStatsView({ stats: { startingLetterCounts: { ש: 6, מ: 2, א: 2 } } });
  assert.deepEqual(a.favoriteStartLetter, { letter: 'ש', count: 6, pct: 60 });
  const b = deriveStatsView({ stats: { wordCounts: { שלום: 3, שמש: 1, מים: 1 } } });
  assert.deepEqual(b.favoriteStartLetter, { letter: 'ש', count: 4, pct: 80 });
  assert.equal(deriveStatsView({ stats: {} }).favoriteStartLetter, null);
});

test('weekDays: the last 7 days ending today, with games per day', () => {
  const days = weekDays([{ ts: NOW }, { ts: NOW - 1000 }, { ts: NOW - 2 * DAY }, { ts: NOW - 9 * DAY }], NOW);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map(d => d.count), [0, 0, 0, 0, 1, 0, 2]);
  assert.equal(days[6].today, true);
  assert.equal(days[6].day, new Date(NOW).getDay());
});

test('recentBars: margins newest first, capped at 10', () => {
  const games = Array.from({ length: 14 }, (_, i) => ({ score: 100 + i, opponentScore: 100 }));
  const bars = recentBars(games);
  assert.equal(bars.length, 10);
  assert.equal(bars[0].margin, 0);
  assert.equal(bars[0].result, 'draw');
  assert.equal(bars[3].margin, 3);
});

test('nemesisOf: the rival with the widest losing gap (2+ games)', () => {
  assert.equal(nemesisOf(PROFILE.stats.rivalStats), 'u3');
  assert.equal(nemesisOf({ a: { uid: 'a', played: 1, won: 0, lost: 1 } }), null);
  assert.equal(nemesisOf({}), null);
});

test('archetypeLetter: first Hebrew letter of the last word', () => {
  assert.equal(archetypeLetter('שחקן מדויק'), 'מ');
  assert.equal(archetypeLetter('לוקח סיכונים'), 'ס');
  assert.equal(archetypeLetter('שחקן כל-תחומי'), 'כ');
  assert.equal(archetypeLetter(''), '?');
});

test('radarSvg: one label and one dot per axis', () => {
  const svg = radarSvg([{ label: 'א', pct: 50 }, { label: 'ב', pct: 100 }, { label: 'ג', pct: 0 }]);
  assert.equal((svg.match(/sx-rd-lbl/g) ?? []).length, 3);
  assert.equal((svg.match(/sx-rd-dot/g) ?? []).length, 3);
  assert.equal(radarSvg([]), '');
});

test('mountStatsScreen: paints hero, panels and rivals', () => {
  bus._reset();
  const { root, ids } = makeDom();
  mountStatsScreen({ root, bus, win: { navigator: { clipboard: { writeText() {} } } }, now: () => NOW });
  bus.emit(PROFILE_RENDER, { profile: PROFILE });

  assert.equal(ids['st-hero-name'].textContent, 'Tester');
  assert.equal(ids['st-rating'].textContent, '1000');
  assert.equal(ids['st-hero-tier'].textContent, 'זהב');
  assert.ok(ids['st-hero-tier-pill'].classList.contains('gold'));
  assert.match(ids['st-hero-next'].innerHTML, /<b>200<\/b>.*יהלום/);
  assert.equal(ids['st-hero-played'].textContent, '8');
  assert.ok(Number(ids['st-ring-fill'].style.strokeDashoffset) > 0);

  assert.equal((ids['st-recent'].innerHTML.match(/sx-col/g) ?? []).length, 2);
  assert.match(ids['st-recent-pick'].innerHTML, /Rival.*היום.*300–250.*\+50/);
  assert.equal(ids['st-won'].textContent, '4');

  assert.match(ids['st-bestmove'].innerHTML, /sx-wood">ש<sub>3<\/sub>/);
  assert.match(ids['st-bestmove'].innerHTML, /נגד Rival · 22 באוקטובר/);
  assert.equal(ids['st-highscore'].textContent, '300');
  assert.equal(ids['st-fun-comeback'].textContent, '+41');
  assert.equal(ids['st-fun-longest'].textContent, 'מבחן');
  assert.equal(ids['st-fun-longest-len'].textContent, '4');

  assert.match(ids['st-rivals-content'].innerHTML, /Nem<span class="sx-nemesis">/);
  assert.match(ids['st-rivals-content'].innerHTML, /sx-last is-l/);
});

test('mountStatsScreen: tabs switch panels; tapping a bar picks that game', () => {
  bus._reset();
  const { root, ids, tabs, share } = makeDom();
  mountStatsScreen({ root, bus, win: { navigator: { clipboard: { writeText() {} } } }, now: () => NOW });
  bus.emit(PROFILE_RENDER, { profile: PROFILE });

  tabs[1].fire('click');
  assert.ok(tabs[1].classList.contains('on'));
  assert.ok(!tabs[0].classList.contains('on'));
  assert.ok(ids['st-panel-records'].classList.contains('on'));
  assert.ok(!ids['st-panel-overview'].classList.contains('on'));

  ids['st-recent'].fire('click', { closest: () => ({ dataset: { i: '1' } }) });
  assert.match(ids['st-recent-pick'].innerHTML, /Nem.*אתמול.*200–230.*-30/);
  assert.match(ids['st-recent-pick'].innerHTML, /is-l/);

  share.fire('click');
});

test('mountStatsScreen: a new player gets empty states, not broken numbers', () => {
  bus._reset();
  const { root, ids } = makeDom();
  mountStatsScreen({ root, bus, win: {}, now: () => NOW });
  bus.emit(PROFILE_RENDER, { profile: { displayName: 'New', stats: {} } });
  assert.equal(ids['st-highscore'].textContent, '0');
  assert.equal(ids['st-fun-longest'].textContent, '—');
  assert.equal(ids['st-fun-comeback'].textContent, '—');
  assert.match(ids['st-recent'].innerHTML, /sx-empty/);
  assert.equal(ids['st-recent-pick'].innerHTML, '');
  assert.match(ids['st-bestmove'].innerHTML, /עוד אין שיאים/);
  assert.match(ids['st-rivals-content'].innerHTML, /sx-empty/);
});
