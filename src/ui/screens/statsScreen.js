import { $, $$, on, setText } from '../domHelpers.js';
import { PROFILE_RENDER, avatarEmoji } from './profileScreen.js';

export const STATS_INTENT = Object.freeze({
  BACK: 'stats/back',
  REFRESH: 'stats/refresh',
});

const PERIOD_MS = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: Infinity,
};

const BOOST_LABELS = {
  B1: 'בוסט 100',
  B2: 'בוסט 40',
  B3: 'בוסט מילים',
  B4: 'בוסט 1',
  B5: 'תור נוסף',
  B6: 'פי 4',
  B7: 'פי 2',
  B8: 'תשבץ',
  B9: '25 נקודות',
  B10: 'מילים מצטלבות',
  B11: 'חיפוש מילים',
  B12: 'כוורת',
  B13: 'גלגל מזל',
};

export function mountStatsScreen({ root = globalThis.document, bus, win = globalThis } = {}) {
  if (!bus) throw new Error('mountStatsScreen: bus required');

  const screenEl = $('#sstats', root);
  const cleanups = [];
  let lastPayload = {};
  let period = 'all';

  const backBtn = $('#sstats .stats-topbar button', root);
  if (backBtn) {
    backBtn.removeAttribute?.('onclick');
    cleanups.push(on(backBtn, 'click', (e) => {
      e?.preventDefault?.();
      bus.emit(STATS_INTENT.BACK, {});
    }));
  }

  const refreshBtn = $$('#sstats .stats-topbar button', root)[1];
  if (refreshBtn) {
    refreshBtn.removeAttribute?.('onclick');
    cleanups.push(on(refreshBtn, 'click', (e) => {
      e?.preventDefault?.();
      paint(lastPayload);
      bus.emit(STATS_INTENT.REFRESH, {});
    }));
  }

  for (const btn of $$('.stats-tfseg', root)) {
    btn.removeAttribute?.('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e?.preventDefault?.();
      period = btnTextPeriod(btn.textContent);
      setActive($$('.stats-tfseg', root), btn);
      paint(lastPayload);
    }));
  }

  for (const btn of $$('.stats-tab', root)) {
    btn.removeAttribute?.('onclick');
    cleanups.push(on(btn, 'click', (e) => {
      e?.preventDefault?.();
      const tab = tabFromButton(btn);
      switchTab(tab, btn, root);
    }));
  }

  const shareBtn = $('.stats-share-btn', root);
  if (shareBtn) {
    shareBtn.removeAttribute?.('onclick');
    cleanups.push(on(shareBtn, 'click', async (e) => {
      e?.preventDefault?.();
      await shareStats(win, lastPayload.profile);
    }));
  }

  win._statsRefresh = () => {
    paint(lastPayload);
    bus.emit(STATS_INTENT.REFRESH, {});
  };
  win._statsTimeFilter = (nextPeriod, el) => {
    period = PERIOD_MS[nextPeriod] ? nextPeriod : 'all';
    setActive($$('.stats-tfseg', root), el);
    paint(lastPayload);
  };
  win._statsTab = (tab, el) => switchTab(tab, el, root);
  win._statsShare = () => shareStats(win, lastPayload.profile);

  cleanups.push(bus.on(PROFILE_RENDER, (payload = {}) => {
    lastPayload = payload;
    paint(payload);
  }));

  function paint({ profile } = {}) {
    if (!screenEl || !profile) return;
    const stats = deriveStatsView(profile, { period });
    text('#st-hero-av', avatarEmoji(profile.equippedAvatar));
    text('#st-hero-name', profile.displayName ?? 'שחקן בוסט');
    text('#st-hero-tier', stats.tier.label);
    setTierClass($('#st-hero-tier', root), stats.tier.className);
    text('#st-hero-wr', `${stats.winRate}%`);
    text('#st-hero-streak', `${stats.currentStreak} 🔥`);
    text('#st-hero-rank', stats.rank);
    text('#st-hero-insight', stats.insight);

    text('#st-highscore', stats.highScore);
    text('#st-avg', stats.avgScore);
    text('#st-played', stats.gamesPlayed);
    text('#st-best-streak', stats.longestStreak);
    text('#st-bonuses', stats.bonusesTriggered);
    text('#st-avgword', stats.avgWordLength);
    text('#st-won', stats.gamesWon);
    text('#st-lost', stats.gamesLost);
    text('#st-draw', stats.gamesDraw);
    text('#st-wr-pct-lbl', `אחוז ניצחון ${stats.winRate}%`);
    text('#st-streak-lbl', `רצף נוכחי: ${stats.currentStreak}`);
    width('#st-bar-w', stats.winPct);
    width('#st-bar-l', stats.lossPct);
    width('#st-bar-d', stats.drawPct);

    text('#st-rating', stats.rating);
    text('#st-perf-tier-badge', stats.tier.label);
    setTierClass($('#st-perf-tier-badge', root), stats.tier.className);
    width('#st-tier-bar', stats.tierProgress);
    text('#st-pts-move', stats.pointsPerMove);
    text('#st-pts-tile', stats.pointsPerTile);
    text('#st-move-time', stats.avgMoveTime);
    text('#st-comeback', stats.comebackWins);
    text('#st-lastmove', stats.lastMoveWins);
    text('#st-closewins', stats.closeWins);
    paintSparkline(stats.filteredRecent, root);

    text('#st-boost-total', stats.bonusesTriggered);
    text('#st-boost-avg', stats.boostsPerGame);
    text('#st-boost-winrate', stats.boostWinRate);
    text('#st-boost-fav-icon', stats.favoriteBoost ? '⚡' : '💡');
    text('#st-boost-fav-name', stats.favoriteBoost?.label ?? '—');
    text('#st-boost-fav-pct', stats.favoriteBoost ? `${stats.favoriteBoost.pct}% מהבוסטים שלך` : '—');
    text('#st-boost-impact-wins', stats.boostImpactWins);
    text('#st-boost-impact-best', stats.favoriteBoost?.label ?? '—');
    html('#st-boost-combo', stats.boostComboHtml);

    html('#st-rivals-content', stats.rivalsHtml);
    text('#st-vs-stronger-w', 0);
    text('#st-vs-weaker-w', 0);

    text('#st-fun-longest', stats.longestWord);
    text('#st-fun-repeated', stats.repeatedWord);
    text('#st-fun-fastest', stats.fastestWin);
    text('#st-fun-comeback', stats.bestComeback);
    text('#st-fun-bestday', stats.bestDay);
    text('#st-fun-luck', stats.luck);

    text('#st-streak', stats.currentStreak);
    text('#st-words', stats.wordsPlayed);
    text('#stats-wr-pct', `${stats.winRate}%`);
  }

  function text(sel, value) { setText($(sel, root), String(value ?? '')); }
  function html(sel, value) { const el = $(sel, root); if (el) el.innerHTML = value ?? ''; }
  function width(sel, pct) { const el = $(sel, root); if (el) el.style.width = `${clamp(Number(pct) || 0, 0, 100)}%`; }

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
      if (win._statsRefresh) win._statsRefresh = function _statsRefresh() {};
      if (win._statsShare) win._statsShare = function _statsShare() {};
    },
    refresh: () => paint(lastPayload),
    _derive: deriveStatsView,
  };
}

export function deriveStatsView(profile = {}, { period = 'all', now = Date.now() } = {}) {
  const s = profile.stats ?? {};
  const played = Number(s.gamesPlayed) || 0;
  const won = Number(s.gamesWon) || 0;
  const lost = Number(s.gamesLost) || Math.max(0, played - won - (Number(s.gamesDraw) || 0));
  const draw = Number(s.gamesDraw) || 0;
  const totalScore = Number(s.totalScore) || 0;
  const totalMoves = Number(s.totalMoves) || 0;
  const totalTiles = Number(s.totalTilesPlayed) || 0;
  const wordsPlayed = Number(s.wordsPlayed) || 0;
  const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
  const rating = Number(profile.rating) || 0;
  const recent = Array.isArray(s.recentGames) ? s.recentGames : [];
  const filteredRecent = filterRecent(recent, period, now);
  const favoriteBoost = favoriteBoostFor(s.boostUsage, Number(s.bonusesTriggered) || 0);
  const repeated = repeatedWordFor(s.wordCounts);
  const bestDay = bestDayFor(s.weekdayStats);
  const tier = tierFor(rating);
  const totalOutcomes = won + lost + draw;

  return {
    gamesPlayed: played,
    gamesWon: won,
    gamesLost: lost,
    gamesDraw: draw,
    highScore: Number(s.highScore) || 0,
    avgScore: played > 0 ? Math.round(totalScore / played) : 0,
    winRate,
    currentStreak: Number(s.currentStreak) || 0,
    longestStreak: Number(s.longestStreak) || 0,
    bonusesTriggered: Number(s.bonusesTriggered) || 0,
    wordsPlayed,
    avgWordLength: wordsPlayed > 0 ? format1(totalTiles / wordsPlayed) : 0,
    winPct: totalOutcomes ? (won / totalOutcomes) * 100 : 0,
    lossPct: totalOutcomes ? (lost / totalOutcomes) * 100 : 0,
    drawPct: totalOutcomes ? (draw / totalOutcomes) * 100 : 0,
    rating,
    tier,
    tierProgress: tierProgress(rating),
    rank: '#—',
    insight: played ? `${played} משחקים חיים נספרו` : '',
    pointsPerMove: totalMoves > 0 ? format1(totalScore / totalMoves) : 0,
    pointsPerTile: totalTiles > 0 ? format1(totalScore / totalTiles) : 0,
    avgMoveTime: formatDurationAverage(s.totalMoveTimeMs, totalMoves),
    comebackWins: Number(s.comebackWins) || 0,
    lastMoveWins: Number(s.lastMoveWins) || 0,
    closeWins: Number(s.closeWins) || 0,
    filteredRecent,
    boostsPerGame: played > 0 ? format1((Number(s.bonusesTriggered) || 0) / played) : 0,
    boostWinRate: boostedWinRate(recent),
    favoriteBoost,
    boostImpactWins: Number(s.boostImpactWins) || 0,
    boostComboHtml: boostComboHtml(s.boostUsage),
    rivalsHtml: rivalsHtml(s.rivalStats),
    longestWord: s.longestWord || '—',
    repeatedWord: repeated,
    fastestWin: formatDuration(s.fastestWinMs),
    bestComeback: s.biggestComeback != null ? String(s.biggestComeback) : '—',
    bestDay,
    luck: played ? `${Math.min(99, Math.max(1, winRate))}%` : '—',
  };
}

function btnTextPeriod(text = '') {
  if (String(text).includes('שבוע')) return 'week';
  if (String(text).includes('חודש')) return 'month';
  return 'all';
}

function tabFromButton(btn) {
  const text = btn?.textContent ?? '';
  if (text.includes('ביצועים')) return 'performance';
  if (text.includes('בוסטים')) return 'boosts';
  if (text.includes('יריבים')) return 'rivals';
  if (text.includes('כיף')) return 'fun';
  return 'overview';
}

function switchTab(tab, el, root) {
  for (const btn of $$('.stats-tab', root)) btn.classList?.remove('active');
  for (const panel of $$('.stats-panel', root)) panel.classList?.remove('active');
  el?.classList?.add('active');
  $(`#st-panel-${tab}`, root)?.classList?.add('active');
}

function setActive(buttons, active) {
  for (const btn of buttons) btn.classList?.remove('active');
  active?.classList?.add('active');
}

function filterRecent(recent, period, now) {
  const span = PERIOD_MS[period] ?? Infinity;
  if (!Number.isFinite(span)) return recent;
  return recent.filter(g => (now - (Number(g?.ts) || 0)) <= span);
}

function paintSparkline(games, root = globalThis.document) {
  const el = root?.querySelector?.('#st-sparkline') ?? root?.getElementById?.('st-sparkline');
  if (!el) return;
  const last = games.slice(0, 6).reverse();
  if (!last.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = last.map((g) => {
    const isWin = g.result === 'win';
    const h = isWin ? 82 : g.result === 'draw' ? 48 : 24;
    return `<span style="display:inline-block;width:12%;height:${h}%;margin:0 2%;vertical-align:bottom;border-radius:5px 5px 0 0;background:${isWin ? '#5dfc8c' : g.result === 'draw' ? 'rgba(255,255,255,.35)' : '#ff6b6b'}"></span>`;
  }).join('');
}

function favoriteBoostFor(usage = {}, total) {
  const entries = Object.entries(usage ?? {}).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
  if (!entries.length) return null;
  const [type, count] = entries[0];
  return {
    type,
    count,
    label: BOOST_LABELS[type] ?? type,
    pct: total > 0 ? Math.round((count / total) * 100) : 0,
  };
}

function repeatedWordFor(wordCounts = {}) {
  const top = Object.entries(wordCounts ?? {}).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))[0];
  return top ? `${top[0]} (${top[1]})` : '—';
}

function bestDayFor(days = {}) {
  const names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const top = Object.entries(days ?? {}).sort((a, b) => (Number(b[1]?.won) || 0) - (Number(a[1]?.won) || 0))[0];
  return top ? names[Number(top[0])] ?? '—' : '—';
}

function boostedWinRate(recent = []) {
  const boosted = recent.filter(g => Number(g?.bonusesTriggered) > 0);
  if (!boosted.length) return '0%';
  return `${Math.round((boosted.filter(g => g.result === 'win').length / boosted.length) * 100)}%`;
}

function boostComboHtml(usage = {}) {
  const entries = Object.entries(usage ?? {}).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0)).slice(0, 3);
  if (!entries.length) return '<span style="color:rgba(255,255,255,.45)">—</span>';
  return entries.map(([type]) => `<span>${escapeHtml(BOOST_LABELS[type] ?? type)}</span>`).join('');
}

function rivalsHtml(rivals = {}) {
  const entries = Object.values(rivals ?? {}).sort((a, b) => (Number(b.played) || 0) - (Number(a.played) || 0)).slice(0, 5);
  if (!entries.length) return '<div class="champs-empty">אין עדיין יריבים חיים</div>';
  return entries.map(r => {
    const wr = r.played ? Math.round(((Number(r.won) || 0) / r.played) * 100) : 0;
    return `<div class="fun-card"><div class="fun-card-icon">${escapeHtml(r.avatar ?? '👤')}</div><div class="fun-card-info"><div class="fun-card-lbl">${escapeHtml(r.name ?? r.uid ?? '?')}</div><div class="fun-card-val">${r.won ?? 0}-${r.lost ?? 0}-${r.draw ?? 0} · ${wr}%</div></div></div>`;
  }).join('');
}

function tierFor(rating) {
  if (rating >= 1200) return { label: '💎 יהלום', className: 'legend' };
  if (rating >= 950) return { label: '⚡ זהב', className: 'gold' };
  if (rating >= 800) return { label: '🥈 כסף', className: 'silver' };
  return { label: '🥉 ארד', className: 'bronze' };
}

function setTierClass(el, className) {
  if (!el) return;
  el.classList?.remove('gold', 'silver', 'bronze', 'legend');
  el.classList?.add(className);
}

function tierProgress(rating) {
  if (!rating) return 0;
  return clamp(((rating - 650) / 700) * 100, 0, 100);
}

function formatDurationAverage(totalMs, count) {
  const n = Number(totalMs) || 0;
  return n > 0 && count > 0 ? formatDuration(n / count) : '—';
}

function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '—';
  const seconds = Math.round(n / 1000);
  if (seconds < 60) return `${seconds} שנ׳`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function format1(n) {
  const value = Number(n) || 0;
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

async function shareStats(win, profile) {
  const stats = deriveStatsView(profile ?? {});
  const text = `Boost: ${profile?.displayName ?? ''} ${stats.gamesWon}/${stats.gamesPlayed} wins, ${stats.winRate}%`;
  try {
    if (win.navigator?.share) await win.navigator.share({ text });
    else await win.navigator?.clipboard?.writeText?.(text);
  } catch { /* ignore */ }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}
