import { $, $$, on, setText } from '../domHelpers.js';
import { PROFILE_RENDER } from './profileScreen.js';
import { avatarMarkup, setAvatarEl } from './avatarScreens.js';
import { deriveInsights } from '../../game/account/playerInsights.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

export const STATS_INTENT = Object.freeze({
  BACK: 'stats/back',
  REFRESH: 'stats/refresh',
});

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

  for (const header of $$('.st-section-header', root)) {
    cleanups.push(on(header, 'click', (e) => {
      e?.preventDefault?.();
      const id = header.dataset?.section;
      if (id) toggleSection(id, root);
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
  win._statsToggle = (id) => toggleSection(id, root);
  win._statsShare = () => shareStats(win, lastPayload.profile);

  cleanups.push(bus.on(PROFILE_RENDER, (payload = {}) => {
    lastPayload = payload;
    paint(payload);
  }));

  function paint({ profile } = {}) {
    if (!screenEl || !profile) return;
    const stats = deriveStatsView(profile);
    paintInsightsPanel(profile, root);

    // Act 1 — Identity
    setAvatarEl($('#st-hero-av', root), profile.equippedAvatar, { fallback: '👑' });
    text('#st-hero-name', profile.displayName ?? 'שחקן בוסט');
    text('#st-hero-tier', stats.tier.label);
    setTierClass($('#st-hero-tier', root), stats.tier.className);
    text('#st-rating', stats.rating);
    text('#st-hero-wr', `${stats.winRate}%`);
    text('#st-hero-streak', `${stats.currentStreak} 🔥`);
    text('#st-hero-insight', stats.insight);

    // Act 2 — Form
    paintSparkline(stats.recentGames, root);
    text('#st-won', stats.gamesWon);
    text('#st-lost', stats.gamesLost);
    text('#st-draw', stats.gamesDraw);
    width('#st-bar-w', stats.winPct);
    width('#st-bar-l', stats.lossPct);
    width('#st-bar-d', stats.drawPct);

    // Act 3 — Achievements
    text('#st-highscore', stats.highScore);
    text('#st-fun-bestmove', stats.highestMoveScore);
    text('#st-fun-longest', stats.longestWord);
    text('#st-fun-streak', stats.longestStreak);
    text('#st-fun-comeback', stats.bestComeback);
    text('#st-comeback', stats.comebackWins);
    text('#st-lastmove', stats.lastMoveWins);
    text('#st-closewins', stats.closeWins);

    // Act 4 — Style
    text('#st-boost-fav-icon', stats.favoriteBoost ? '⚡' : '💡');
    text('#st-boost-fav-name', stats.favoriteBoost?.label ?? '—');
    text('#st-boost-fav-pct', stats.favoriteBoost ? `${stats.favoriteBoost.pct}% מהבוסטים שלך` : '—');

    // Act 5 — Rivals
    html('#st-rivals-content', stats.rivalsHtml);

    // Section header teaser text (shown when collapsed)
    const ins = deriveInsights(profile, Date.now());
    text('#st-form-teaser', ins.weekSnapshot?.played ? `${ins.weekSnapshot.played} משחקים השבוע` : '');
    text('#st-ach-teaser', stats.highScore ? `שיא: ${stats.highScore}` : '');
    text('#st-style-teaser', ins.archetype?.label ?? '');
    text('#st-rivals-teaser', rivalsTeaser(profile.stats?.rivalStats));

    // Legacy compat hidden nodes
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
      if (win._statsToggle) win._statsToggle = function _statsToggle() {};
      if (win._statsShare) win._statsShare = function _statsShare() {};
    },
    refresh: () => paint(lastPayload),
    _derive: deriveStatsView,
  };
}

export function deriveStatsView(profile = {}) {
  const s = profile.stats ?? {};
  const played = Number(s.gamesPlayed) || 0;
  const won = Number(s.gamesWon) || 0;
  const lost = Number(s.gamesLost) || Math.max(0, played - won - (Number(s.gamesDraw) || 0));
  const draw = Number(s.gamesDraw) || 0;
  const totalScore = Number(s.totalScore) || 0;
  const wordsPlayed = Number(s.wordsPlayed) || 0;
  const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
  const rating = Number(profile.rating) || 0;
  const recent = Array.isArray(s.recentGames) ? s.recentGames : [];
  const favoriteBoost = favoriteBoostFor(s.boostUsage, Number(s.bonusesTriggered) || 0);
  const repeated = repeatedWordFor(s.wordCounts);
  const bestDay = bestDayFor(s.weekdayStats);
  const favoriteSpeed = favoriteSpeedFor(s.moveSpeedStats);
  const tier = tierFor(rating);
  const totalOutcomes = won + lost + draw;

  return {
    gamesPlayed: played,
    gamesWon: won,
    gamesLost: lost,
    gamesDraw: draw,
    highScore: Number(s.highScore) || 0,
    highestMoveScore: Number(s.highestMoveScore) || 0,
    avgScore: played > 0 ? Math.round(totalScore / played) : 0,
    winRate,
    currentStreak: Number(s.currentStreak) || 0,
    longestStreak: Number(s.longestStreak) || 0,
    bonusesTriggered: Number(s.bonusesTriggered) || 0,
    wordsPlayed,
    winPct: totalOutcomes ? (won / totalOutcomes) * 100 : 0,
    lossPct: totalOutcomes ? (lost / totalOutcomes) * 100 : 0,
    drawPct: totalOutcomes ? (draw / totalOutcomes) * 100 : 0,
    rating,
    tier,
    tierProgress: tierProgress(rating),
    insight: played ? `${played} משחקים חיים נספרו` : '',
    comebackWins: Number(s.comebackWins) || 0,
    lastMoveWins: Number(s.lastMoveWins) || 0,
    closeWins: Number(s.closeWins) || 0,
    recentGames: recent,
    boostsPerGame: played > 0 ? format1((Number(s.bonusesTriggered) || 0) / played) : 0,
    boostWinRate: boostedWinRate(recent),
    favoriteBoost,
    rivalsHtml: rivalsHtml(s.rivalStats),
    longestWord: s.longestWord || '—',
    repeatedWord: repeated,
    bestComeback: s.biggestComeback != null ? String(s.biggestComeback) : '—',
    bestDay,
    favoriteSpeed,
  };
}

function toggleSection(id, root) {
  $(`#st-sec-${id}`, root)?.classList?.toggle('open');
}

function rivalsTeaser(rivalStats = {}) {
  const entries = Object.values(rivalStats ?? {}).sort((a, b) => (Number(b.played) || 0) - (Number(a.played) || 0));
  if (!entries.length) return '';
  const top = entries[0];
  return `${top.name ?? '?'} · ${top.won ?? 0}-${top.lost ?? 0}`;
}

function paintSparkline(games, root = globalThis.document) {
  const el = root?.querySelector?.('#st-sparkline') ?? root?.getElementById?.('st-sparkline');
  if (!el) return;
  const last = games.slice(0, 10).reverse();
  if (!last.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = last.map((g) => {
    const isWin = g.result === 'win';
    const h = isWin ? 82 : g.result === 'draw' ? 48 : 24;
    return `<span style="display:inline-block;width:7%;height:${h}%;margin:0 1.5%;vertical-align:bottom;border-radius:5px 5px 0 0;background:${isWin ? '#5dfc8c' : g.result === 'draw' ? 'rgba(255,255,255,.35)' : '#ff6b6b'}"></span>`;
  }).join('');
}

const SPEED_LABELS = { '20': '⚡ בזק (20 שנ\')', '40': '🎯 רגיל (40 שנ\')', '60': '🐢 איטי (60 שנ\')' };

function favoriteSpeedFor(moveSpeedStats = {}) {
  const entries = Object.entries(moveSpeedStats ?? {}).filter(([, v]) => v?.played > 0);
  if (!entries.length) return '—';
  const best = entries.reduce((a, b) => {
    const wr = (v) => v[1].played > 0 ? v[1].won / v[1].played : 0;
    return wr(a) >= wr(b) ? a : b;
  });
  const [key, val] = best;
  const wr = val.played > 0 ? Math.round((val.won / val.played) * 100) : 0;
  return `${SPEED_LABELS[key] ?? key} · ${wr}%`;
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

function rivalsHtml(rivals = {}) {
  const entries = Object.values(rivals ?? {}).sort((a, b) => (Number(b.played) || 0) - (Number(a.played) || 0)).slice(0, 3);
  if (!entries.length) return '<div class="champs-empty">אין עדיין יריבים חיים</div>';
  return entries.map(r => {
    const wr = r.played ? Math.round(((Number(r.won) || 0) / r.played) * 100) : 0;
    return `<div class="fun-card"><div class="fun-card-icon">${avatarMarkup(r.avatar, { fallback: '👤' })}</div><div class="fun-card-info"><div class="fun-card-lbl">${escapeHtml(r.name ?? r.uid ?? '?')}</div><div class="fun-card-val">${r.won ?? 0}-${r.lost ?? 0}-${r.draw ?? 0} · ${wr}%</div></div></div>`;
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

function format1(n) {
  const value = Number(n) || 0;
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// ─── Insights panel painting ──────────────────────────────────────────
// Pure-render helpers that consume the playerInsights output and project
// it onto the #st-panel-insights DOM. Exported only for tests via
// `mountStatsScreen()._derive` and the module's exports below.

export function paintInsightsPanel(profile, root) {
  if (!profile) return;
  const ins = deriveInsights(profile, Date.now());
  // §2 Archetype
  setEl('#ins-arch-icon',  root, t => t.textContent = ins.archetype.icon);
  setEl('#ins-arch-label', root, t => t.textContent = ins.archetype.label);
  setEl('#ins-arch-blurb', root, t => t.textContent = ins.archetype.blurb);
  // §1 Insights cards
  setEl('#ins-cards',      root, t => t.innerHTML = renderInsightCards(ins.insights));
  // §3 Trends
  setEl('#ins-trends',     root, t => t.innerHTML = renderTrends(ins.trends));
  // §7 This-week snapshot
  setEl('#ins-week',       root, t => t.innerHTML = renderWeekSnapshot(ins.weekSnapshot));
  // §4 Word Intelligence
  setEl('#ins-words',      root, t => t.innerHTML = renderWordIntel(ins.wordIntel));
  // §5 Play style
  setEl('#ins-style',      root, t => t.innerHTML = renderPlayStyle(ins.playStyle));
  // §8 Opponent insights
  setEl('#ins-opps',       root, t => t.innerHTML = renderOpponents(ins.opponents));
  // §9 Milestones
  setEl('#ins-milestones', root, t => t.innerHTML = renderMilestones(ins.milestones));
  // §10 Did You Know
  setEl('#ins-dyk-icon',   root, t => t.textContent = ins.didYouKnow.icon);
  setEl('#ins-dyk-text',   root, t => t.textContent = ins.didYouKnow.text);
}

function setEl(sel, root, fn) {
  const el = $(sel, root);
  if (el) fn(el);
}

function renderInsightCards(items = []) {
  if (!items.length) return '';
  return items.map(i =>
    `<div class="ins-card">`
    + `<span class="ins-card-icon" aria-hidden="true">${escapeHtml(i.icon)}</span>`
    + `<span class="ins-card-text">${escapeHtml(i.text)}</span>`
    + '</div>',
  ).join('');
}

function trendChip(label, valueText, delta, deltaSuffix = '') {
  let arrow = '·';
  let cls = 'trend-flat';
  if (delta > 0)      { arrow = '▲'; cls = 'trend-up';   }
  else if (delta < 0) { arrow = '▼'; cls = 'trend-down'; }
  const deltaStr = (delta === 0 || delta == null) ? '' :
    `<span class="ins-trend-delta ${cls}">${arrow} ${Math.abs(delta)}${deltaSuffix}</span>`;
  return ''
    + '<div class="ins-trend">'
    + `<div class="ins-trend-lbl">${escapeHtml(label)}</div>`
    + `<div class="ins-trend-val">${escapeHtml(valueText)}</div>`
    + deltaStr
    + '</div>';
}

function renderTrends(t = {}) {
  const out = [];
  out.push(trendChip('אחוז ניצחון', `${t.winRate?.valuePct ?? 0}%`, t.winRate?.deltaPct ?? 0, '%'));
  out.push(trendChip('ציון ממוצע', `${t.avgScore?.value ?? 0}`, t.avgScore?.deltaAbs ?? 0));
  out.push(trendChip('פעילות שבועית', `${t.activity?.thisWeek ?? 0} משחקים`, t.activity?.deltaAbs ?? 0));
  // ELO: no historical snapshot, so show "X / next-tier-floor".
  const r = t.rating ?? {};
  const ratingVal = r.nextTierFloor != null
    ? `${r.value ?? 0} / ${r.nextTierFloor}`
    : `${r.value ?? 0}`;
  const ratingLabel = r.nextTierLabel ? `דירוג (${r.nextTierLabel})` : 'דירוג';
  out.push(''
    + '<div class="ins-trend">'
    + `<div class="ins-trend-lbl">${escapeHtml(ratingLabel)}</div>`
    + `<div class="ins-trend-val">${escapeHtml(ratingVal)}</div>`
    + `<div class="ins-trend-bar"><div class="ins-trend-bar-fill" style="width:${Number(r.progressPct) || 0}%"></div></div>`
    + '</div>');
  return out.join('');
}

function renderWeekSnapshot(w = {}) {
  return ''
    + '<div class="ins-week-grid">'
    +   weekKpi('🎮', 'משחקים', w.played ?? 0)
    +   weekKpi('🏆', 'ניצחונות', w.won ?? 0)
    +   weekKpi('🔥', 'רצף', w.bestStreak ?? 0)
    +   weekKpi('📊', 'ממוצע', w.avgScore ?? 0)
    + '</div>';
}
function weekKpi(icon, label, value) {
  return ''
    + '<div class="ins-week-kpi">'
    + `<div class="ins-week-kpi-icon" aria-hidden="true">${escapeHtml(icon)}</div>`
    + `<div class="ins-week-kpi-val">${escapeHtml(String(value))}</div>`
    + `<div class="ins-week-kpi-lbl">${escapeHtml(label)}</div>`
    + '</div>';
}

function renderWordIntel(w = {}) {
  const rows = [
    { icon: '📚', label: 'אורך מילה ממוצע',   val: w.avgWordLength ? String(w.avgWordLength) : 'טרם נמדד' },
    { icon: '🔤', label: 'המילה הארוכה ביותר', val: w.longestWord ? `${w.longestWord} (${w.longestWordLen})` : 'טרם הושג' },
    { icon: '💯', label: 'המהלך הטוב ביותר',  val: w.bestMoveScore ? `${w.bestMoveScore} נקודות` : 'טרם הושג' },
    { icon: '⚡', label: 'נקודות למהלך (ממוצע)', val: w.avgPointsPerMove ? `${w.avgPointsPerMove}` : 'טרם נמדד' },
    { icon: '🎯', label: 'אורך המילה השכיח',  val: w.mostUsedLength ? `${w.mostUsedLength} אותיות` : 'טרם נמדד' },
  ];
  return rows.map(r => ''
    + '<div class="ins-word-row">'
    + `<span class="ins-word-icon" aria-hidden="true">${escapeHtml(r.icon)}</span>`
    + `<span class="ins-word-lbl">${escapeHtml(r.label)}</span>`
    + `<span class="ins-word-val">${escapeHtml(r.val)}</span>`
    + '</div>',
  ).join('');
}

function renderPlayStyle(bars = []) {
  if (!bars.length) return '';
  return bars.map(b => ''
    + '<div class="ins-style-row">'
    +   '<div class="ins-style-meta">'
    +     `<span class="ins-style-lbl">${escapeHtml(b.label)}</span>`
    +     `<span class="ins-style-pct">${escapeHtml(String(b.pct))}%</span>`
    +   '</div>'
    +   '<div class="ins-style-bar">'
    +     `<div class="ins-style-bar-fill" style="width:${Number(b.pct) || 0}%"></div>`
    +   '</div>'
    +   (b.hint ? `<div class="ins-style-hint">${escapeHtml(b.hint)}</div>` : '')
    + '</div>',
  ).join('');
}

function renderOpponents(o = {}) {
  const rows = [
    { icon: '👑', label: 'היריב הגדול',           opp: o.rival },
    { icon: '🤝', label: 'היריב האהוב',           opp: o.favorite },
    { icon: '🔥', label: 'הצמיתות הכי תחרותית',   opp: o.competitive },
    { icon: '🏆', label: 'הביצוע הכי טוב מולו',   opp: o.bestRecord },
  ];
  if (rows.every(r => !r.opp)) {
    return '<div class="ins-empty">אין עדיין יריבים מתועדים. שחק כמה משחקים ברשת.</div>';
  }
  return rows.map(r => {
    if (!r.opp) {
      return ''
        + '<div class="ins-opp-row ins-opp-row--empty">'
        + `<span class="ins-opp-icon" aria-hidden="true">${escapeHtml(r.icon)}</span>`
        + `<span class="ins-opp-lbl">${escapeHtml(r.label)}</span>`
        + '<span class="ins-opp-val">טרם זמין</span>'
        + '</div>';
    }
    const wlt = `${r.opp.won}-${r.opp.lost}-${r.opp.draw}`;
    return ''
      + '<div class="ins-opp-row">'
      + `<span class="ins-opp-icon" aria-hidden="true">${escapeHtml(r.icon)}</span>`
      + '<div class="ins-opp-body">'
      +   `<div class="ins-opp-lbl">${escapeHtml(r.label)}</div>`
      +   `<div class="ins-opp-name">${escapeHtml(r.opp.name)}</div>`
      + '</div>'
      + `<div class="ins-opp-val">${escapeHtml(wlt)}<div class="ins-opp-wr">${escapeHtml(String(r.opp.winPct))}%</div></div>`
      + '</div>';
  }).join('');
}

function renderMilestones(items = []) {
  if (!items.length) return '';
  return items.map(m => {
    const pct = m.target > 0 ? Math.max(0, Math.min(100, Math.round((m.current / m.target) * 100))) : 0;
    return ''
      + '<div class="ins-ms">'
      +   '<div class="ins-ms-head">'
      +     `<span class="ins-ms-icon" aria-hidden="true">${escapeHtml(m.icon)}</span>`
      +     `<span class="ins-ms-lbl">${escapeHtml(m.label)}</span>`
      +     `<span class="ins-ms-prog">${escapeHtml(String(m.current))} / ${escapeHtml(String(m.target))}</span>`
      +   '</div>'
      +   `<div class="ins-ms-bar"><div class="ins-ms-bar-fill" style="width:${pct}%"></div></div>`
      +   (m.blurb ? `<div class="ins-ms-blurb">${escapeHtml(m.blurb)}</div>` : '')
      + '</div>';
  }).join('');
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

registerOnboardingContent('sstats', {
  icon: '📊',
  title: 'סטטיסטיקות',
  bullets: [
    '🆔 זהות — דירוג ELO, אחוז ניצחון, רצף ואבטיפוס שחקן',
    '📈 ביצועים — סנפשוט שבועי, ספרקליין ומגמות',
    '🏆 שיאים — שיא ניקוד, המילה הארוכה, קאמבקים וניצחונות קלאץ׳',
    '🤺 יריבים — מי מנצח אתכם ומי מפסיד',
  ],
});
