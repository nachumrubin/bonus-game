// playerInsights — pure derivation of "smart" player analytics from the
// existing profile.stats shape produced by profileService.
//
// Inputs: a `profile` object (already loaded by profileService) and an
// optional `now` timestamp for deterministic time-based slicing in tests.
//
// Output is shaped per UI section so the renderer stays presentational:
//   {
//     insights:    [{icon, text}, ...]   // §1 Insights About You
//     archetype:   {icon, label, blurb}  // §2 Player Archetype
//     trends:      {winRate, avgScore, activity, rating}  // §3 Performance Trends
//     wordIntel:   {avgWordLength, longestWord, ...}      // §4 Word Intelligence
//     playStyle:   [{label, pct, hint}, ...]              // §5 Play Style Bars
//     weekSnapshot:{played, won, bestStreak, avgScore}    // §7 This Week
//     opponents:   {rival, favorite, competitive, bestRecord}  // §8 Opponent Insights
//     milestones:  [{icon, label, current, target, blurb}]      // §9 Next Milestone
//     didYouKnow:  {icon, text}                                // §10 Did You Know?
//   }
//
// Empty-state friendly: every section returns *something* sensible for
// a brand-new profile (placeholders that read like "התחל לשחק" rather
// than zeros / dashes), so the renderer never has to special-case "no
// data yet" per field.

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const ELO_TIERS = [
  { name: 'ארד',   floor: 0    },
  { name: 'כסף',   floor: 800  },
  { name: 'זהב',   floor: 950  },
  { name: 'יהלום', floor: 1200 },
];

export function deriveInsights(profile = {}, now = Date.now()) {
  const s = profile.stats ?? {};
  const recent = Array.isArray(s.recentGames) ? s.recentGames : [];
  const played = Number(s.gamesPlayed) || 0;
  return {
    insights:     buildInsightCards(s, recent, now),
    archetype:    pickArchetype(s, recent, played),
    trends:       buildTrends(s, recent, now, Number(profile.rating) || 0),
    wordIntel:    buildWordIntel(s),
    playStyle:    buildPlayStyle(s, recent),
    weekSnapshot: buildWeekSnapshot(recent, now),
    opponents:    buildOpponentInsights(s.rivalStats),
    milestones:   buildMilestones(s, Number(profile.rating) || 0),
    didYouKnow:   pickDidYouKnow(s, recent, played),
  };
}

// ─── §1 Insights About You ────────────────────────────────────────────

function buildInsightCards(stats, recent, now) {
  const out = [];

  // Recent form: how many of the last 5 did you win?
  if (recent.length >= 3) {
    const last5 = recent.slice(0, 5);
    const wins = last5.filter(g => g?.result === 'win').length;
    if (wins >= 3) {
      out.push({ icon: '🔥', text: `ניצחת ב-${wins} מ-${last5.length} המשחקים האחרונים` });
    } else if (wins === 0 && last5.length >= 3) {
      out.push({ icon: '💪', text: 'הניצחון הבא ממש קרוב — נסה משחק נוסף' });
    }
  }

  // Strongest weekday — only when one day clearly dominates.
  const bestDay = strongestWeekday(stats.weekdayStats);
  if (bestDay) {
    out.push({ icon: '📅', text: `יום ${bestDay} הוא היום החזק שלך` });
  }

  // Bonus correlation: avg score with bonuses vs without.
  const bonusEffect = avgScoreLift(recent);
  if (bonusEffect != null && bonusEffect >= 10) {
    out.push({ icon: '⚡', text: `הציון הממוצע שלך עולה ב-${bonusEffect} נקודות כשמשחקים עם בוסטים` });
  }

  // Close-win specialist.
  const won = Number(stats.gamesWon) || 0;
  const closeWins = Number(stats.closeWins) || 0;
  if (won >= 5 && closeWins / won >= 0.4) {
    out.push({ icon: '🎯', text: `${Math.round((closeWins / won) * 100)}% מהניצחונות שלך מגיעים במשחקים צמודים` });
  }

  // Comeback specialist.
  const comebacks = Number(stats.comebackWins) || 0;
  if (comebacks >= 2) {
    out.push({ icon: '🚀', text: `${comebacks} פעמים ניצחת אחרי שהיית מאחור — אופי של לוחם` });
  }

  // Score trending up: first half vs second half of recentGames.
  const trend = avgScoreTrend(recent);
  if (trend && trend.deltaAbs >= 12) {
    out.push({ icon: '📈', text: `הציון הממוצע שלך משתפר — +${trend.deltaAbs} לעומת ההתחלה של ה-${recent.length} האחרונים` });
  }

  // Empty-state nudge so the section is never blank.
  if (!out.length) {
    out.push({
      icon: '🆕',
      text: (Number(stats.gamesPlayed) || 0) === 0
        ? 'התחל לשחק כדי לפתוח תובנות אישיות'
        : 'תובנות יופיעו ככל שתשחק יותר משחקים',
    });
  }
  return out;
}

// ─── §2 Player Archetype ──────────────────────────────────────────────

function pickArchetype(stats, recent, played) {
  if (played < 5) {
    return {
      icon: '🆕',
      label: 'חוקר',
      blurb: 'אתה רק מתחיל. כל משחק יוסיף לתובנות שלך כאן.',
    };
  }

  const won = Number(stats.gamesWon) || 0;
  const winRate = played > 0 ? won / played : 0;
  const moves = Number(stats.totalMoves) || 0;
  const bonuses = Number(stats.bonusesTriggered) || 0;
  const bonusRate = moves > 0 ? bonuses / moves : 0;
  const boostImpactWins = Number(stats.boostImpactWins) || 0;
  const closeRate = won > 0 ? (Number(stats.closeWins) || 0) / won : 0;
  const comebackRate = won > 0 ? (Number(stats.comebackWins) || 0) / won : 0;
  const longestWordLen = Number(stats.longestWordLength) || 0;
  const fastSpeed = stats.moveSpeedStats?.['20']?.played ?? 0;
  const slowSpeed = stats.moveSpeedStats?.['60']?.played ?? 0;

  // Order matters — the first match wins. Sort by "most distinctive
  // first" so a player who genuinely stands out gets the specific badge.
  if (longestWordLen >= 7) {
    return {
      icon: '📚',
      label: 'מומחה לאוצר מילים',
      blurb: `המילה הארוכה שלך (${longestWordLen} אותיות) מציבה אותך מעל הממוצע. אתה רואה את הלוח כמילון.`,
    };
  }
  if (comebackRate >= 0.3 && (Number(stats.comebackWins) || 0) >= 2) {
    return {
      icon: '🔥',
      label: 'לוקח סיכונים',
      blurb: `${Math.round(comebackRate * 100)}% מהניצחונות שלך מגיעים בקאמבק. אתה לא מוותר גם כשנראה אבוד.`,
    };
  }
  if (closeRate >= 0.5 && winRate >= 0.5) {
    return {
      icon: '🏹',
      label: 'שחקן מדויק',
      blurb: 'הניצחונות שלך מגיעים בהפרשים קטנים. אתה יודע איך לסחוט כל נקודה.',
    };
  }
  if (boostImpactWins / Math.max(won, 1) >= 0.6 && bonusRate >= 0.04) {
    return {
      icon: '🧠',
      label: 'שחקן אסטרטגי',
      blurb: 'הניצחונות שלך בדרך-כלל נשענים על שימוש חכם בבוסטים וניקוד עקבי.',
    };
  }
  if (fastSpeed >= 3 && fastSpeed > slowSpeed * 2) {
    return {
      icon: '⚡',
      label: 'חושב מהיר',
      blurb: 'אתה בוחר תחת לחץ זמן ומצליח. מהירות היא יתרון אצלך.',
    };
  }
  if (recent.length >= 5 && scoreConsistency(recent) >= 0.7 && winRate >= 0.45) {
    return {
      icon: '🎯',
      label: 'שחקן עקבי',
      blurb: 'הציונים שלך לא נופלים בקלות. עקביות היא הנשק שלך.',
    };
  }
  // Fallback for active players who don't fit any specialised mold.
  return {
    icon: '🃏',
    label: 'שחקן כל-תחומי',
    blurb: 'אתה מערבב סגנונות — קצת מכל דבר. הצורה שלך עוד תתגבש.',
  };
}

// ─── §3 Performance Trends ────────────────────────────────────────────

function buildTrends(stats, recent, now, rating) {
  return {
    winRate:  winRateTrend(stats, recent),
    avgScore: avgScoreTrend(recent),
    activity: activityTrend(recent, now),
    rating:   ratingMilestone(rating),
  };
}

function winRateTrend(stats, recent) {
  const overallPlayed = Number(stats.gamesPlayed) || 0;
  const overallWon = Number(stats.gamesWon) || 0;
  const overallPct = overallPlayed > 0 ? Math.round((overallWon / overallPlayed) * 100) : 0;
  if (recent.length < 4) {
    return { valuePct: overallPct, deltaPct: 0, sample: 'lifetime' };
  }
  const halves = splitHalves(recent);
  const recentPct = winPct(halves.recent);
  const olderPct  = winPct(halves.older);
  return {
    valuePct: recentPct,
    deltaPct: recentPct - olderPct,
    sample: 'recent', // half of recentGames
  };
}

function avgScoreTrend(recent) {
  if (recent.length < 4) {
    return { value: avg(recent.map(g => Number(g?.score) || 0)), deltaAbs: 0 };
  }
  const halves = splitHalves(recent);
  const value  = Math.round(avg(halves.recent.map(g => Number(g?.score) || 0)));
  const older  = Math.round(avg(halves.older.map(g => Number(g?.score) || 0)));
  return { value, deltaAbs: value - older };
}

function activityTrend(recent, now) {
  const day = 24 * 3_600_000;
  const last7    = countGamesInWindow(recent, now - 7  * day, now);
  const prev7    = countGamesInWindow(recent, now - 14 * day, now - 7 * day);
  return { thisWeek: last7, prevWeek: prev7, deltaAbs: last7 - prev7 };
}

function ratingMilestone(rating) {
  // Find the next tier above the player's current rating.
  let next = null;
  for (const tier of ELO_TIERS) {
    if (rating < tier.floor) { next = tier; break; }
  }
  if (!next) {
    return { value: rating, progressPct: 100, nextTierLabel: null, nextTierFloor: null };
  }
  const prevFloor = [...ELO_TIERS].reverse().find(t => rating >= t.floor)?.floor ?? 0;
  const span = next.floor - prevFloor;
  const progressPct = span > 0
    ? Math.round(Math.max(0, (rating - prevFloor) / span) * 100)
    : 100;
  return { value: rating, progressPct, nextTierLabel: next.name, nextTierFloor: next.floor };
}

// ─── §4 Word Intelligence ─────────────────────────────────────────────

function buildWordIntel(stats) {
  const totalMoves = Number(stats.totalMoves) || 0;
  const totalScore = Number(stats.totalScore) || 0;
  const wordCounts = stats.wordCounts ?? {};
  const longestWord = String(stats.longestWord ?? '');
  const longestWordLen = Number(stats.longestWordLength) || longestWord.length;

  let letters = 0;
  let wordTokens = 0;
  const lenCounts = {};
  for (const [word, n] of Object.entries(wordCounts)) {
    const count = Number(n) || 0;
    if (!word || count <= 0) continue;
    letters    += word.length * count;
    wordTokens += count;
    lenCounts[word.length] = (lenCounts[word.length] ?? 0) + count;
  }

  const mostUsedLength = bestEntry(lenCounts);
  return {
    avgWordLength:    wordTokens > 0 ? round1(letters / wordTokens) : 0,
    longestWord:      longestWord || null,
    longestWordLen,
    bestMoveScore:    Number(stats.highestMoveScore) || 0,
    avgPointsPerMove: totalMoves > 0 ? Math.round(totalScore / totalMoves) : 0,
    mostUsedLength:   mostUsedLength ? Number(mostUsedLength) : null,
  };
}

// ─── §5 Play Style bars ───────────────────────────────────────────────

function buildPlayStyle(stats, recent) {
  const moves     = Number(stats.totalMoves) || 0;
  const won       = Number(stats.gamesWon) || 0;
  const played    = Number(stats.gamesPlayed) || 0;
  const bonuses   = Number(stats.bonusesTriggered) || 0;
  const longestWordLen = Number(stats.longestWordLength) || 0;
  const comebacks = Number(stats.comebackWins) || 0;
  const fast      = stats.moveSpeedStats?.['20']?.played ?? 0;
  const med       = stats.moveSpeedStats?.['40']?.played ?? 0;
  const slow      = stats.moveSpeedStats?.['60']?.played ?? 0;
  const speedTotal = fast + med + slow;

  return [
    {
      label: 'שימוש בבוסטים',
      pct: scaleBar(moves > 0 ? bonuses / moves : 0, 0, 0.10),
      hint: moves > 0 ? `${round1((bonuses / moves) * 100)}% מהמהלכים שלך כוללים בוסט` : '',
    },
    {
      label: 'מילים ארוכות',
      pct: scaleBar(longestWordLen, 3, 9),
      hint: longestWordLen ? `מילה ארוכה ביותר: ${longestWordLen} אותיות` : '',
    },
    {
      label: 'עקביות',
      pct: scaleBar(recent.length >= 4 ? scoreConsistency(recent) : 0.4, 0, 1),
      hint: 'יציבות הציונים ב-' + recent.length + ' המשחקים האחרונים',
    },
    {
      label: 'מהירות',
      pct: scaleBar(speedTotal > 0 ? fast / speedTotal : 0.33, 0, 1),
      hint: speedTotal > 0
        ? `${Math.round((fast / speedTotal) * 100)}% מהמשחקים שלך במצב מהיר`
        : 'משחק עיקרי במצב רגיל',
    },
    {
      label: 'נטיית סיכון',
      pct: scaleBar(won > 0 ? comebacks / won : 0, 0, 0.5),
      hint: comebacks > 0
        ? `${comebacks} ניצחונות בקאמבק מתוך ${won} ניצחונות`
        : 'מעט קאמבקים מתועדים',
    },
  ];
}

// ─── §7 This Week Snapshot ────────────────────────────────────────────

function buildWeekSnapshot(recent, now) {
  const cutoff = now - 7 * 24 * 3_600_000;
  const week = recent.filter(g => Number(g?.ts) >= cutoff);
  let bestStreak = 0;
  let cur = 0;
  for (const g of [...week].reverse()) {
    if (g?.result === 'win') { cur += 1; bestStreak = Math.max(bestStreak, cur); }
    else cur = 0;
  }
  return {
    played:      week.length,
    won:         week.filter(g => g?.result === 'win').length,
    bestStreak,
    avgScore:    week.length ? Math.round(avg(week.map(g => Number(g?.score) || 0))) : 0,
  };
}

// ─── §8 Opponent Insights ─────────────────────────────────────────────

function buildOpponentInsights(rivalStats = {}) {
  const entries = Object.values(rivalStats ?? {})
    .filter(r => Number(r?.played) >= 1)
    .map(r => ({
      uid:    r.uid,
      name:   r.name ?? r.uid ?? '?',
      avatar: r.avatar ?? null,
      played: Number(r.played) || 0,
      won:    Number(r.won) || 0,
      lost:   Number(r.lost) || 0,
      draw:   Number(r.draw) || 0,
      winPct: (Number(r.played) || 0) > 0 ? Math.round(((Number(r.won) || 0) / r.played) * 100) : 0,
      balance: Math.abs(((Number(r.won) || 0) / Math.max(Number(r.played) || 1, 1)) - 0.5),
    }));
  if (!entries.length) return { rival: null, favorite: null, competitive: null, bestRecord: null };

  // Biggest Rival = most-played overall.
  const rival = [...entries].sort((a, b) => b.played - a.played)[0];
  // Favorite = top win count (with at least 1 played); ties broken by win rate.
  const favorite = [...entries].sort((a, b) => b.won - a.won || b.winPct - a.winPct)[0];
  // Most Competitive = closest to 50/50, min 3 games played.
  const competitivePool = entries.filter(r => r.played >= 3);
  const competitive = competitivePool.length
    ? [...competitivePool].sort((a, b) => a.balance - b.balance)[0]
    : null;
  // Highest Win Rate Against = best winPct (min 3 played to avoid noise).
  const ratePool = entries.filter(r => r.played >= 3);
  const bestRecord = ratePool.length
    ? [...ratePool].sort((a, b) => b.winPct - a.winPct || b.played - a.played)[0]
    : null;

  return { rival, favorite, competitive, bestRecord };
}

// ─── §9 Milestones / Goals ────────────────────────────────────────────

function buildMilestones(stats, rating) {
  const out = [];
  // ELO tier ladder
  const eloNext = ratingMilestone(rating);
  if (eloNext.nextTierFloor != null) {
    out.push({
      icon: '🏆',
      label: `הגע לדירוג ${eloNext.nextTierLabel}`,
      current: rating,
      target: eloNext.nextTierFloor,
      blurb: `עוד ${Math.max(0, eloNext.nextTierFloor - rating)} נקודות ELO`,
    });
  }
  // High score next round 100.
  const high = Number(stats.highScore) || 0;
  if (high > 0) {
    const target = Math.max(100, Math.ceil((high + 1) / 50) * 50);
    out.push({
      icon: '📚',
      label: `קבע שיא של ${target} נקודות במשחק`,
      current: high,
      target,
      blurb: `השיא הנוכחי: ${high}`,
    });
  }
  // Streak milestone — next 5/10/25 above current longest.
  const longest = Number(stats.longestStreak) || 0;
  const streakLevels = [3, 5, 10, 25, 50];
  const nextStreak = streakLevels.find(t => t > longest) ?? longest + 5;
  out.push({
    icon: '🔥',
    label: `הגע לרצף של ${nextStreak} ניצחונות`,
    current: Math.min(longest, nextStreak),
    target: nextStreak,
    blurb: longest > 0 ? `הרצף הארוך שלך עד היום: ${longest}` : 'התחל את הרצף הראשון שלך',
  });
  return out;
}

// ─── §10 Did You Know? ────────────────────────────────────────────────

function pickDidYouKnow(stats, recent, played) {
  const pool = [];

  if (played >= 5) {
    const wr = Math.round(((Number(stats.gamesWon) || 0) / played) * 100);
    pool.push(`אחוז הניצחונות שלך עומד על ${wr}% — מתוך ${played} משחקים`);
  }
  const won = Number(stats.gamesWon) || 0;
  if (won >= 3 && (Number(stats.boostImpactWins) || 0) > 0) {
    const pct = Math.round(((Number(stats.boostImpactWins) || 0) / won) * 100);
    pool.push(`${pct}% מהניצחונות שלך כוללים שימוש בבוסטים`);
  }
  if (stats.longestWord && (Number(stats.longestWordLength) || 0) >= 5) {
    pool.push(`המילה הארוכה שלך, "${stats.longestWord}", היא ${stats.longestWordLength} אותיות`);
  }
  const bestDay = strongestWeekday(stats.weekdayStats);
  if (bestDay) {
    pool.push(`ביום ${bestDay} ההישגים שלך הכי טובים`);
  }
  if (recent.length >= 5) {
    const avgRecent = Math.round(avg(recent.map(g => Number(g?.score) || 0)));
    pool.push(`הציון הממוצע שלך ב-${recent.length} המשחקים האחרונים: ${avgRecent}`);
  }
  const wordIntel = buildWordIntel(stats);
  if (wordIntel.avgWordLength > 0) {
    pool.push(`אורך מילה ממוצע שלך: ${wordIntel.avgWordLength} אותיות`);
  }
  const opponents = buildOpponentInsights(stats.rivalStats);
  if (opponents.bestRecord && opponents.bestRecord.winPct >= 60) {
    pool.push(`הביצוע הטוב ביותר שלך הוא מול ${opponents.bestRecord.name} (${opponents.bestRecord.winPct}%)`);
  }
  if (!pool.length) {
    return { icon: '💡', text: 'שחק עוד כמה משחקים כדי שנוכל לאתר עובדה מעניינת עליך' };
  }
  // Stable rotation: same gamesPlayed → same fact. New facts surface as the
  // counter advances, but the screen doesn't flicker between visits.
  const idx = Math.abs(played) % pool.length;
  return { icon: '💡', text: pool[idx] };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function avg(arr) {
  if (!arr?.length) return 0;
  const sum = arr.reduce((a, b) => a + (Number(b) || 0), 0);
  return sum / arr.length;
}

function round1(n) {
  const v = Number(n) || 0;
  return Math.round(v * 10) / 10;
}

function splitHalves(arr) {
  // recentGames is newest-first. Recent half = the front; older half = back.
  const mid = Math.floor(arr.length / 2);
  return { recent: arr.slice(0, mid), older: arr.slice(mid) };
}

function winPct(games) {
  if (!games?.length) return 0;
  const w = games.filter(g => g?.result === 'win').length;
  return Math.round((w / games.length) * 100);
}

function countGamesInWindow(recent, fromMs, toMs) {
  return recent.filter(g => {
    const ts = Number(g?.ts);
    return Number.isFinite(ts) && ts >= fromMs && ts < toMs;
  }).length;
}

function avgScoreLift(recent) {
  // Mean score in games where bonuses were triggered, minus mean score in
  // games where they weren't. Returns null if either bucket is too small
  // to draw a conclusion from.
  const withBonus    = recent.filter(g => Number(g?.bonusesTriggered) > 0);
  const withoutBonus = recent.filter(g => !(Number(g?.bonusesTriggered) > 0));
  if (withBonus.length < 3 || withoutBonus.length < 3) return null;
  const a = avg(withBonus.map(g => Number(g?.score) || 0));
  const b = avg(withoutBonus.map(g => Number(g?.score) || 0));
  return Math.round(a - b);
}

function strongestWeekday(weekdayStats = {}) {
  const entries = Object.entries(weekdayStats ?? {})
    .map(([d, v]) => ({
      day: Number(d),
      played: Number(v?.played) || 0,
      won: Number(v?.won) || 0,
      avg: Number(v?.played) > 0 ? (Number(v?.totalScore) || 0) / Number(v.played) : 0,
    }))
    .filter(e => e.played >= 2);
  if (entries.length < 2) return null;
  const top = [...entries].sort((a, b) => {
    const wrA = a.played > 0 ? a.won / a.played : 0;
    const wrB = b.played > 0 ? b.won / b.played : 0;
    if (wrB !== wrA) return wrB - wrA;
    return b.avg - a.avg;
  })[0];
  // Require at least 1 win and a meaningful sample.
  if (!top || top.won < 1) return null;
  return DAY_NAMES_HE[top.day] ?? null;
}

function scoreConsistency(recent) {
  // Higher = more consistent. Normalised so a stddev of 0 → 1 and a stddev
  // of half the mean → 0. Caller clamps to [0,1].
  const scores = recent.map(g => Number(g?.score) || 0).filter(n => n > 0);
  if (scores.length < 3) return 0.5;
  const m = avg(scores);
  if (m <= 0) return 0;
  const v = avg(scores.map(s => (s - m) ** 2));
  const sd = Math.sqrt(v);
  return Math.max(0, Math.min(1, 1 - (sd / (m * 0.5))));
}

function scaleBar(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return Math.round(Math.max(0, Math.min(1, (value - min) / (max - min))) * 100);
}

function bestEntry(obj) {
  let bestKey = null;
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(v) || 0;
    if (n > bestVal) { bestVal = n; bestKey = k; }
  }
  return bestKey;
}

// Exposed for unit tests so we can pin behaviour of individual helpers.
export const _internals = {
  avgScoreLift,
  avgScoreTrend,
  strongestWeekday,
  scoreConsistency,
  splitHalves,
  ratingMilestone,
  buildWordIntel,
  buildWeekSnapshot,
  buildOpponentInsights,
  buildMilestones,
  pickArchetype,
};
