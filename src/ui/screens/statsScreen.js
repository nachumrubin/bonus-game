import { $, $$, on, setText } from '../domHelpers.js';
import { PROFILE_RENDER } from './profileScreen.js';
import { avatarMarkup, setAvatarEl } from './avatarScreens.js';
import { deriveInsights } from '../../game/account/playerInsights.js';
import { HV } from '../../game/core/letterDistribution.js';
import { registerOnboardingContent } from '../controllers/onboardingController.js';

// Statistics screen (#sstats) — Oct 2026 redesign: a hero card (Boostie, tier,
// ELO ring toward the next tier, three pills) above sticky tabs, each tab one
// flat glass panel: סקירה (week, recent margins, balance, trends) · שיאים (best
// move in wooden tiles, record shelf, clutch) · סגנון (archetype + radar,
// favourites, word stats) · יריבים (head-to-head rows).

export const STATS_INTENT = Object.freeze({
  BACK: 'stats/back',
  REFRESH: 'stats/refresh',
});

export const STATS_TABS = Object.freeze(['overview', 'records', 'style', 'rivals']);

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

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const MONTHS = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני', 'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];
const DAY_MS = 24 * 3_600_000;
const RING_C = 2 * Math.PI * 50;
const RECENT_BARS = 10;

export function mountStatsScreen({ root = globalThis.document, bus, win = globalThis, now = () => Date.now() } = {}) {
  if (!bus) throw new Error('mountStatsScreen: bus required');

  const screenEl = $('#sstats', root);
  const cleanups = [];
  let lastPayload = {};
  let recent = [];
  let rivals = {};
  let picked = 0;

  for (const tab of $$('.sx-tab', root)) {
    cleanups.push(on(tab, 'click', (e) => {
      e?.preventDefault?.();
      selectTab(tab.dataset?.tab, root);
    }));
  }

  const recentEl = $('#st-recent', root);
  if (recentEl) {
    cleanups.push(on(recentEl, 'click', (e) => {
      const col = e?.target?.closest?.('[data-i]');
      if (!col) return;
      picked = Number(col.dataset.i) || 0;
      paintRecent();
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
  win._statsToggle = (id) => selectTab(id, root);
  win._statsShare = () => shareStats(win, lastPayload.profile);

  cleanups.push(bus.on(PROFILE_RENDER, (payload = {}) => {
    lastPayload = payload;
    paint(payload);
  }));

  function paint({ profile } = {}) {
    if (!screenEl || !profile) return;
    const t = now();
    const stats = deriveStatsView(profile);
    const ins = deriveInsights(profile, t);
    const s = profile.stats ?? {};

    // Hero
    setAvatarEl($('#st-hero-av', root), profile.equippedAvatar, { fallback: '👑' });
    text('#st-hero-name', profile.displayName ?? 'שחקן בוסט');
    text('#st-hero-tier', stats.tier.label);
    setTierClass($('#st-hero-tier-pill', root), stats.tier.className);
    text('#st-rating', stats.rating);
    const ring = ins.trends?.rating ?? {};
    const ringEl = $('#st-ring-fill', root);
    if (ringEl) ringEl.style.strokeDashoffset = String(RING_C * (1 - clamp(Number(ring.progressPct) || 0, 0, 100) / 100));
    html('#st-hero-next', ring.nextTierLabel
      ? `עוד <b>${ring.nextTierFloor - stats.rating}</b> נקודות לדרגת <b>${escapeHtml(ring.nextTierLabel)}</b>`
      : 'הגעת לדרגה הגבוהה ביותר');
    text('#st-hero-wr', `${stats.winRate}%`);
    text('#st-hero-streak', stats.currentStreak);
    text('#st-hero-played', stats.gamesPlayed);

    // סקירה
    html('#ins-week', renderWeek(ins.weekSnapshot, weekDays(stats.recentGames, t)));
    recent = recentBars(stats.recentGames);
    rivals = s.rivalStats ?? {};
    picked = 0;
    paintRecent();
    html('#st-donut', renderDonut(stats));
    text('#st-won', stats.gamesWon);
    text('#st-lost', stats.gamesLost);
    text('#st-draw', stats.gamesDraw);
    text('#st-balance-n', stats.gamesPlayed ? `${stats.gamesPlayed} משחקים` : '');
    html('#ins-trends', renderTrends(ins.trends, stats));

    // שיאים
    html('#st-bestmove', renderBestMove(s.bestMove, stats.highestMoveScore));
    text('#st-highscore', stats.highScore);
    text('#st-fun-streak', stats.longestStreak);
    text('#st-fun-comeback', stats.bestComeback);
    text('#st-fun-longest', stats.longestWord);
    text('#st-fun-longest-len', stats.longestWord === '—' ? '—' : [...stats.longestWord].length);
    text('#st-comeback', stats.comebackWins);
    text('#st-lastmove', stats.lastMoveWins);
    text('#st-closewins', stats.closeWins);

    // סגנון
    text('#ins-arch-icon', archetypeLetter(ins.archetype?.label));
    text('#ins-arch-label', ins.archetype?.label ?? '');
    text('#ins-arch-blurb', ins.archetype?.blurb ?? '');
    html('#st-radar', radarSvg(ins.playStyle));
    html('#st-favs', renderFavorites(stats, s));
    html('#ins-words', renderWordIntel(ins.wordIntel, stats));

    // יריבים
    html('#st-rivals-content', renderRivals(rivals, stats.recentGames));
  }

  function paintRecent() {
    html('#st-recent', renderRecentBars(recent, picked));
    html('#st-recent-pick', renderPick(recent[picked], rivals, now()));
  }

  function text(sel, value) { setText($(sel, root), String(value ?? '')); }
  function html(sel, value) { const el = $(sel, root); if (el) el.innerHTML = value ?? ''; }

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
      if (win._statsRefresh) win._statsRefresh = function _statsRefresh() {};
      if (win._statsToggle) win._statsToggle = function _statsToggle() {};
      if (win._statsShare) win._statsShare = function _statsShare() {};
    },
    refresh: () => paint(lastPayload),
    selectTab: (id) => selectTab(id, root),
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
    tier: tierFor(rating),
    comebackWins: Number(s.comebackWins) || 0,
    lastMoveWins: Number(s.lastMoveWins) || 0,
    closeWins: Number(s.closeWins) || 0,
    recentGames: recent,
    boostsPerGame: played > 0 ? format1((Number(s.bonusesTriggered) || 0) / played) : 0,
    favoriteBoost: favoriteBoostFor(s.boostUsage, Number(s.bonusesTriggered) || 0),
    favoriteStartLetter: favoriteStartLetterFor(s.startingLetterCounts, s.wordCounts),
    repeatedWord: repeatedWordFor(s.wordCounts),
    bestDay: bestDayFor(s.weekdayStats),
    longestWord: s.longestWord || '—',
    bestComeback: s.biggestComeback != null ? `+${s.biggestComeback}` : '—',
  };
}

// ─── Pure view helpers (exported for tests) ───────────────────────────

// The last 7 days ending today, oldest first: games played on each.
export function weekDays(recent = [], now = Date.now()) {
  const today = startOfDay(now);
  return Array.from({ length: 7 }, (_, i) => {
    const from = today - (6 - i) * DAY_MS;
    const count = recent.filter(g => Number(g?.ts) >= from && Number(g?.ts) < from + DAY_MS).length;
    return { day: new Date(from).getDay(), count, today: i === 6 };
  });
}

// recentGames (newest first) → the chart's bars, newest first.
export function recentBars(recent = []) {
  return recent.slice(0, RECENT_BARS).map(g => {
    const score = Number(g?.score) || 0;
    const opp = Number(g?.opponentScore) || 0;
    return {
      result: g?.result ?? (score > opp ? 'win' : score < opp ? 'loss' : 'draw'),
      margin: score - opp,
      score,
      opponentScore: opp,
      opponentName: g?.opponentName ?? null,
      opponentUid: g?.opponentUid ?? null,
      ts: Number(g?.ts) || 0,
    };
  });
}

// The rival who beats you most: more losses than wins, by the widest gap.
export function nemesisOf(rivalStats = {}) {
  let best = null;
  for (const r of Object.values(rivalStats ?? {})) {
    const gap = (Number(r?.lost) || 0) - (Number(r?.won) || 0);
    if (gap > 0 && (Number(r?.played) || 0) >= 2 && (!best || gap > best.gap)) best = { uid: r.uid, gap };
  }
  return best?.uid ?? null;
}

// The archetype's wooden tile: the first letter of its last word
// ('שחקן מדויק' → מ, 'לוקח סיכונים' → ס).
export function archetypeLetter(label = '') {
  const words = String(label ?? '').trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? '';
  return [...last].find(ch => /[א-ת]/.test(ch)) ?? '?';
}

export function selectTab(id, root = globalThis.document) {
  if (!STATS_TABS.includes(id)) return;
  for (const tab of $$('.sx-tab', root)) tab.classList?.toggle('on', tab.dataset?.tab === id);
  for (const tab of STATS_TABS) $(`#st-panel-${tab}`, root)?.classList?.toggle('on', tab === id);
}

// ─── Renderers ────────────────────────────────────────────────────────

function renderWeek(w = {}, days = []) {
  const kpi = (v, l, cls = '') => `<div><div class="v${cls}">${escapeHtml(String(v))}</div><div class="l">${l}</div></div>`;
  return ''
    + '<div class="sx-row4">'
    + kpi(w.played ?? 0, 'משחקים')
    + kpi(w.won ?? 0, 'ניצחונות', ' is-ok')
    + kpi(w.avgScore ?? 0, 'ממוצע')
    + kpi(w.bestStreak ?? 0, 'רצף', ' is-cy')
    + '</div>'
    + '<div class="sx-days">'
    + days.map(d => `<div class="sx-day"><div class="sx-dot${d.count ? ' on' : ''}${d.today ? ' today' : ''}">${d.count || ''}</div>${DAY_LETTERS[d.day]}</div>`).join('')
    + '</div>';
}

function renderRecentBars(bars = [], picked = 0) {
  if (!bars.length) return '<div class="sx-empty">עוד אין משחקים ברשת — המשחק הראשון יופיע כאן</div>';
  const max = Math.max(1, ...bars.map(b => Math.abs(b.margin)));
  return bars.map((b, i) => {
    const kind = b.margin > 0 ? 'w' : b.margin < 0 ? 'l' : 'd';
    const h = kind === 'd' ? '' : ` style="height:${Math.max(4, (Math.abs(b.margin) / max) * 48).toFixed(1)}%"`;
    return `<button class="sx-col${i === picked ? ' sel' : ''}" data-i="${i}" aria-label="${escapeHtml(b.opponentName ?? '')} ${b.score}–${b.opponentScore}"><span class="sx-bar is-${kind}"${h}></span></button>`;
  }).join('');
}

function renderPick(b, rivalStats = {}, now = Date.now()) {
  if (!b) return '';
  const rival = b.opponentUid ? rivalStats?.[b.opponentUid] : null;
  const kind = b.margin > 0 ? 'w' : b.margin < 0 ? 'l' : 'd';
  const margin = b.margin > 0 ? `+${b.margin}` : String(b.margin);
  return ''
    + `<div class="sx-pick-in is-${kind}">`
    + avatarMarkup(rival?.avatar, { className: 'sx-mini-av' })
    + `<span>נגד <b>${escapeHtml(b.opponentName ?? rival?.name ?? 'יריב')}</b> · ${daysAgo(b.ts, now)}</span>`
    + `<span class="sx-pk-s" dir="ltr">${b.score}–${b.opponentScore}</span>`
    + `<span class="sx-pk-d" dir="ltr">${margin}</span>`
    + '</div>';
}

function renderDonut(v) {
  const r = 48;
  const c = 2 * Math.PI * r;
  const seg = (pct, offset, cls) => pct > 0
    ? `<circle class="sx-seg ${cls}" cx="60" cy="60" r="${r}" stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-c * offset / 100).toFixed(1)}"/>`
    : '';
  return ''
    + '<svg viewBox="0 0 120 120" aria-hidden="true">'
    + `<circle class="sx-seg-track" cx="60" cy="60" r="${r}"/>`
    + seg(v.winPct, 0, 'is-w')
    + seg(v.lossPct, v.winPct, 'is-l')
    + seg(v.drawPct, v.winPct + v.lossPct, 'is-d')
    + '</svg>'
    + `<div class="sx-donut-ctr"><b>${v.winRate}%</b><small>ניצחונות</small></div>`;
}

function chip(label, value, delta = 0, suffix = '') {
  const d = Number(delta) || 0;
  const tag = d > 0 ? `<span class="up">▲ ${d}${suffix}</span>` : d < 0 ? `<span class="dn">▼ ${Math.abs(d)}${suffix}</span>` : '';
  return `<div class="sx-chip"><div class="l">${escapeHtml(label)}</div><div class="v">${escapeHtml(String(value))}${tag}</div></div>`;
}

function renderTrends(t = {}, v = {}) {
  return ''
    + chip('ניקוד ממוצע', t.avgScore?.value ?? 0, t.avgScore?.deltaAbs)
    + chip('אחוז ניצחון', `${t.winRate?.valuePct ?? 0}%`, t.winRate?.deltaPct, '%')
    + chip('משחקים השבוע', t.activity?.thisWeek ?? 0, t.activity?.deltaAbs)
    + chip('בוסטים למשחק', v.boostsPerGame ?? 0);
}

function wood(letter, val, cls = '') {
  const sub = val != null ? `<sub>${val}</sub>` : '';
  return `<span class="sx-wood${cls}">${escapeHtml(letter)}${sub}</span>`;
}

function renderBestMove(best, highestMoveScore = 0) {
  const kicker = '<div class="sx-best-k"><svg class="gi"><use href="#gi-star"/></svg>המהלך הטוב ביותר שלך</div>';
  if (best?.tiles?.length) {
    const tiles = best.tiles.map(t => wood(t.letter, Number(t.val) || HV[t.letter] || 0)).join('');
    const d = best.ts ? new Date(best.ts) : null;
    const meta = [best.opponentName ? `נגד ${escapeHtml(best.opponentName)}` : '', d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '']
      .filter(Boolean).join(' · ');
    return kicker
      + `<div class="sx-best-tiles" style="--n:${best.tiles.length}">${tiles}</div>`
      + `<div class="sx-best-pts">${best.score}<small>נק׳</small></div>`
      + (meta ? `<div class="sx-best-meta">${meta}</div>` : '');
  }
  if (highestMoveScore > 0) {
    return kicker
      + `<div class="sx-best-pts">${highestMoveScore}<small>נק׳</small></div>`
      + '<div class="sx-best-meta">שברו את השיא — והמילה תופיע כאן באותיות עץ</div>';
  }
  return kicker + '<div class="sx-best-meta">עוד אין שיאים. שחקו משחק ברשת כדי להתחיל</div>';
}

function renderFavorites(v, s = {}) {
  const fav = (tile, label, value) =>
    `<div class="sx-fav">${tile}<div><div class="l">${label}</div><div class="v">${escapeHtml(value)}</div></div></div>`;
  const letter = v.favoriteStartLetter;
  const boost = v.favoriteBoost;
  const word = v.repeatedWord;
  const day = v.bestDay;
  return ''
    + fav(letter ? wood(letter.letter, HV[letter.letter] ?? 0) : wood('?'), 'אות פתיחה', letter ? `${letter.letter}׳ · ${letter.pct}%` : '—')
    + fav('<span class="sx-wood is-ic"><svg class="gi"><use href="#gi-bolt"/></svg></span>', 'בוסט מועדף', boost ? boost.label : '—')
    + fav(word ? wood(word.word, null, ' is-word') : wood('?'), 'מילה חוזרת', word ? `${word.count} פעמים` : '—')
    + fav(day ? wood(DAY_LETTERS[day.day]) : wood('?'), 'היום הטוב', day ? `${DAY_NAMES[day.day]} · ${day.won} ניצחונות` : '—');
}

function renderWordIntel(w = {}, v = {}) {
  return ''
    + chip('מילים שהונחו', (v.wordsPlayed ?? 0).toLocaleString('en-US'))
    + chip('אורך ממוצע', w.avgWordLength || '—')
    + chip('נקודות למהלך', w.avgPointsPerMove || '—')
    + chip('אורך שכיח', w.mostUsedLength ? `${w.mostUsedLength} אותיות` : '—');
}

// Play-style bars → a radar polygon (one axis per bar, pct 0–100).
export function radarSvg(bars = []) {
  if (!bars.length) return '';
  const R = 78;
  const n = bars.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const poly = (rf) => bars.map((b, i) => pt(i, rf(b)).map(x => x.toFixed(1)).join(',')).join(' ');
  let out = '';
  for (const k of [1 / 3, 2 / 3, 1]) out += `<polygon class="sx-rd-grid" points="${poly(() => R * k)}"/>`;
  bars.forEach((b, i) => {
    const [x, y] = pt(i, R);
    const [lx, ly] = pt(i, R + 22);
    out += `<line class="sx-rd-grid" x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    out += `<text class="sx-rd-lbl" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}">${escapeHtml(b.label)}</text>`;
  });
  const r = (b) => R * Math.max(0.06, clamp(Number(b.pct) || 0, 0, 100) / 100);
  out += `<polygon class="sx-rd-shape" points="${poly(r)}"/>`;
  bars.forEach((b, i) => {
    const [x, y] = pt(i, r(b));
    out += `<circle class="sx-rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`;
  });
  return out;
}

function renderRivals(rivalStats = {}, recent = []) {
  const entries = Object.values(rivalStats ?? {})
    .sort((a, b) => (Number(b.played) || 0) - (Number(a.played) || 0))
    .slice(0, 8);
  if (!entries.length) return '<div class="sx-empty">אין עדיין יריבים. שחקו נגד חברים ברשת והם יופיעו כאן</div>';
  const nemesis = nemesisOf(rivalStats);
  return entries.map(r => {
    const won = Number(r.won) || 0;
    const lost = Number(r.lost) || 0;
    const played = Number(r.played) || won + lost;
    const decided = Math.max(1, won + lost);
    const last = recent.find(g => g?.opponentUid === r.uid)?.result;
    const lastTag = last === 'win' ? '<div class="sx-last is-w">נ</div>'
      : last === 'loss' ? '<div class="sx-last is-l">ה</div>'
        : last === 'draw' ? '<div class="sx-last is-d">ת</div>' : '';
    const tag = r.uid && r.uid === nemesis
      ? '<span class="sx-nemesis"><svg class="gi"><use href="#gi-flag"/></svg>נמסיס</span>' : '';
    return ''
      + '<div class="sx-rv">'
      + `<div class="sx-rv-av">${avatarMarkup(r.avatar, { fallback: '👤' })}</div>`
      + '<div class="sx-rv-mid">'
      +   `<div class="sx-rv-top"><div>${escapeHtml(r.name ?? r.uid ?? '?')}${tag}</div><span>${played} משחקים</span></div>`
      +   `<div class="sx-h2h"><i class="me" style="width:${((won / decided) * 100).toFixed(1)}%"></i><i class="op" style="width:${((lost / decided) * 100).toFixed(1)}%"></i></div>`
      +   `<div class="sx-rv-sc"><span class="a">אתה ${won}</span><span class="b">${lost}</span></div>`
      + '</div>'
      + lastTag
      + '</div>';
  }).join('');
}

// ─── Small derivations ────────────────────────────────────────────────

// Favorite starting letter: the letter you've built the most words from.
// Prefer the dedicated startingLetterCounts tally; fall back to deriving it
// from wordCounts for profiles saved before that tally existed.
function favoriteStartLetterFor(startingLetterCounts, wordCounts = {}) {
  let counts = startingLetterCounts;
  if (!counts || !Object.keys(counts).length) {
    counts = {};
    for (const [word, n] of Object.entries(wordCounts ?? {})) {
      const first = word?.[0];
      if (first) counts[first] = (Number(counts[first]) || 0) + (Number(n) || 0);
    }
  }
  const entries = Object.entries(counts).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
  if (!entries.length || !(Number(entries[0][1]) > 0)) return null;
  const total = entries.reduce((sum, [, n]) => sum + (Number(n) || 0), 0);
  const [letter, count] = entries[0];
  return {
    letter,
    count: Number(count) || 0,
    pct: total > 0 ? Math.round((Number(count) / total) * 100) : 0,
  };
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
  return top && Number(top[1]) > 1 ? { word: top[0], count: Number(top[1]) } : null;
}

function bestDayFor(days = {}) {
  const top = Object.entries(days ?? {}).sort((a, b) => (Number(b[1]?.won) || 0) - (Number(a[1]?.won) || 0))[0];
  return top && Number(top[1]?.won) > 0 ? { day: Number(top[0]), won: Number(top[1].won) } : null;
}

function tierFor(rating) {
  if (rating >= 1200) return { label: 'יהלום', className: 'legend' };
  if (rating >= 950) return { label: 'זהב', className: 'gold' };
  if (rating >= 800) return { label: 'כסף', className: 'silver' };
  return { label: 'ארד', className: 'bronze' };
}

function setTierClass(el, className) {
  if (!el) return;
  el.classList?.remove('gold', 'silver', 'bronze', 'legend');
  el.classList?.add(className);
}

function daysAgo(ts, now) {
  if (!ts) return '';
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days === 2) return 'שלשום';
  return `לפני ${days} ימים`;
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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

registerOnboardingContent('sstats', {
  icon: '📊',
  title: 'סטטיסטיקות',
  bullets: [
    '🆔 למעלה — דירוג ELO, הדרך לדרגה הבאה, אחוז ניצחון ורצף',
    '📈 סקירה — השבוע שלך, הפרש הנקודות במשחקים האחרונים ומגמות',
    '🏆 שיאים — המהלך הטוב ביותר באותיות עץ, מדף השיאים וקלאץ׳',
    '🤺 סגנון ויריבים — הסגנון שלך, המועדפים ומאזן ראש בראש',
  ],
});
