// Screenshot capture for the new stats "תובנות" (insights) tab.
//
// Seeds a realistic profile and emits PROFILE_RENDER so the screen paints
// every section: archetype, insight cards, trends, this-week snapshot,
// word intelligence, play-style bars, opponent insights, milestones, did
// you know.
//
// Output → images/guide/stats-insights.png.

const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 414, height: 1200 } }); // Tall — insights panel is long.

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true
    && typeof window.__spine.ui?.mountStatsScreen === 'function');
}

test('stats insights tab — populated with realistic data', async ({ page }) => {
  await bootSpine(page);

  // Show the stats screen, hide the rest.
  await page.evaluate(() => {
    for (const id of ['sh', 'tut-intro', 'ov-champs', 'ov-settings', 'ov-guide', 'ov-faq']) {
      document.getElementById(id)?.classList.add('hidden');
    }
    window.showSc?.('sstats');
  });

  const now = Date.UTC(2026, 5, 7, 14, 0, 0); // 2026-06-07T14:00Z
  const HOUR = 3_600_000;
  const DAY  = 24 * HOUR;

  await page.evaluate(({ now }) => {
    const HOUR = 3_600_000;
    const DAY  = 24 * HOUR;
    // Build a 14-game history so trends/week snapshot/archetype have real
    // numbers to chew on.
    const recentGames = [];
    const make = (i, result, score, bonus = 0) => ({
      ts: now - i * DAY - 3 * HOUR,
      mode: 'random-async',
      result,
      score,
      opponentScore: score - (result === 'win' ? 22 : result === 'loss' ? -28 : 0),
      bonusesTriggered: bonus,
      opponentUid: i % 3 === 0 ? 'eden' : i % 3 === 1 ? 'noa' : 'tomer',
      opponentName: i % 3 === 0 ? 'עדן' : i % 3 === 1 ? 'נועה' : 'תומר',
    });
    // Newest at front (recentGames is newest-first per profileService.append).
    recentGames.push(make(0,  'win',  248, 1));
    recentGames.push(make(1,  'win',  221, 1));
    recentGames.push(make(2,  'loss', 184, 0));
    recentGames.push(make(3,  'win',  236, 1));
    recentGames.push(make(4,  'win',  208, 1));
    recentGames.push(make(5,  'loss', 192, 0));
    recentGames.push(make(7,  'win',  214, 0));
    recentGames.push(make(8,  'win',  201, 1));
    recentGames.push(make(9,  'loss', 178, 0));
    recentGames.push(make(10, 'win',  189, 0));
    recentGames.push(make(11, 'draw', 170, 0));
    recentGames.push(make(12, 'win',  196, 1));
    recentGames.push(make(13, 'loss', 162, 0));
    recentGames.push(make(14, 'win',  175, 0));

    const profile = {
      uid: 'demo',
      userId: '123456',
      displayName: 'אריאל כהן',
      equippedAvatar: 'crown',
      rating: 932, // silver, next floor 950
      createdAt: now - 60 * DAY,
      stats: {
        gamesPlayed:  46,
        gamesWon:     27,
        gamesLost:    16,
        gamesDraw:    3,
        highScore:    284,
        highestMoveScore: 67,
        totalScore:   9_250,
        currentStreak: 2,
        longestStreak: 6,
        bonusesTriggered: 18,
        wordsPlayed: 312,
        totalMoves:   320,
        totalTilesPlayed: 1_540,
        totalMoveTimeMs: 0,
        comebackWins: 4,
        lastMoveWins: 2,
        closeWins: 11,
        boostImpactWins: 17,
        fastestWinMs: 14 * 60_000,
        longestWord: 'אסטרטגיה', longestWordLength: 8,
        recentGames,
        boostUsage: { B3: 6, B7: 4, B5: 3, B12: 2 },
        wordCounts: {
          'אבא': 12, 'ים': 9, 'אור': 8, 'שמש': 7, 'יום': 6,
          'לילה': 5, 'מילים': 4, 'בית': 4, 'שלום': 3, 'אסטרטגיה': 1,
        },
        weekdayStats: {
          '0': { played: 2, won: 1, totalScore: 360 },   // ראשון
          '2': { played: 8, won: 6, totalScore: 1700 },  // שלישי
          '4': { played: 5, won: 3, totalScore: 1100 },  // חמישי
          '6': { played: 3, won: 1, totalScore: 580 },   // שבת
        },
        moveSpeedStats: {
          '20': { played: 6, won: 2 },
          '40': { played: 30, won: 19 },
          '60': { played: 10, won: 6 },
        },
        rivalStats: {
          eden:  { uid: 'eden',  name: 'עדן',   avatar: 'star',   played: 18, won: 11, lost: 6, draw: 1, pointsFor: 0, pointsAgainst: 0 },
          noa:   { uid: 'noa',   name: 'נועה',  avatar: 'dragon', played: 12, won: 4,  lost: 7, draw: 1, pointsFor: 0, pointsAgainst: 0 },
          tomer: { uid: 'tomer', name: 'תומר',  avatar: 'tiger',  played: 8,  won: 4,  lost: 4, draw: 0, pointsFor: 0, pointsAgainst: 0 },
          dan:   { uid: 'dan',   name: 'דן',    avatar: 'robot',  played: 5,  won: 5,  lost: 0, draw: 0, pointsFor: 0, pointsAgainst: 0 },
        },
      },
    };
    window.__spine?.bus?.emit?.(window.__spine.ui.PROFILE_RENDER, { profile });
  }, { now });

  // Let the render settle.
  await page.waitForTimeout(250);

  const out = path.join(OUT_DIR, 'stats-insights.png');
  await page.screenshot({ path: out, fullPage: true });
  console.log(`[capture] wrote ${out}`);
});
