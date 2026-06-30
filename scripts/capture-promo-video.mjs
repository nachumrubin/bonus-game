import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
const OUT_DIR = path.join(ROOT, 'videos');
const RAW_DIR = path.join(OUT_DIR, 'raw');
const VIEWPORT = { width: 390, height: 844 };
const SCREEN_HOLD_MS = 5200;
const BOARD_HOLD_MS = 2800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function canReach(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canReach(`${BASE_URL}/index.html`)) return true;
    await sleep(250);
  }
  return false;
}

async function startStaticServer() {
  if (await waitForServer(750)) return null;

  const candidates = [
    { cmd: 'python', args: ['-m', 'http.server', String(PORT), '--bind', HOST] },
    { cmd: 'py', args: ['-3', '-m', 'http.server', String(PORT), '--bind', HOST] },
    { cmd: 'python3', args: ['-m', 'http.server', String(PORT), '--bind', HOST] },
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const child = spawn(candidate.cmd, candidate.args, {
        cwd: ROOT,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', (err) => { lastError = err; });
      if (await waitForServer()) return child;
      child.kill();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not start static server on ${BASE_URL}: ${lastError?.message ?? 'unknown error'}`);
}

async function bootApp(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.__spine?.enabled === true &&
    typeof window.__spine.startGameViaSpine === 'function' &&
    !!window.__spine.bus &&
    !!document.querySelector('#sh')
  ), null, { timeout: 20000 });
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.body.classList.add('raw-capture');
    const dismissedScreens = ['sh', 'so', 'sg', 'sav-gallery', 'savatar-store', 'sprofile', 'sfriends', 'snotif', 'sstats', 'smygames'];
    localStorage.setItem('spine.onboarding.dismissed.guest', JSON.stringify(dismissedScreens));
    for (const sel of ['#ov-onboarding', '#app-loading']) {
      const el = document.querySelector(sel);
      if (el) el.classList.add('hidden');
    }
  });
}

async function installRawCaptureGuards(page) {
  await page.addStyleTag({
    content: `
      .raw-capture #app-loading,
      .raw-capture #ov-onboarding {
        display: none !important;
      }
    `,
  });
}

async function dismissCaptureOverlays(page) {
  await page.evaluate(() => {
    document.getElementById('app-loading')?.classList.add('hidden');
    document.getElementById('ov-onboarding')?.classList.add('hidden');
  });
}

async function showMainMenu(page) {
  await page.evaluate(() => {
    window.__spine.activeGame?.end?.();
    window.showSc?.('sh');
    const ui = window.__spine.ui;
    window.__spine.bus.emit(ui.MENU_REFRESH, {
      isAuthed: true,
      displayName: 'נחום רובין',
      avatar: 'legendary_4',
      rating: 886,
      coins: 3880,
      unreadCount: 2,
      myGamesCount: 3,
      myTurnInGame: true,
    });
  });
  await page.locator('#sh').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(6200);
}

async function quickMatch(page) {
  await page.evaluate(() => {
    window.showSc?.('so');
    document.getElementById('ov-matchmaking')?.classList.remove('hidden');
    const name = document.getElementById('mm-name');
    if (name) name.value = 'נחום';
    document.getElementById('mm-mode-live')?.classList.add('active');
    document.getElementById('mm-mode-async')?.classList.remove('active');
    const status = document.getElementById('mm-status');
    if (status) status.style.display = '';
    const statusText = document.getElementById('mm-status-text');
    if (statusText) statusText.textContent = 'מחפש יריב מתאים...';
    const btn = document.getElementById('mm-search-btn');
    if (btn) btn.textContent = 'מתחבר למשחק';
  });
  await page.locator('#ov-matchmaking').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(7200);
  await page.evaluate(() => document.getElementById('ov-matchmaking')?.classList.add('hidden'));
}

async function startDemoGame(page) {
  await page.evaluate(() => {
    document.getElementById('ov-matchmaking')?.classList.add('hidden');
    window.__spine.activeGame?.end?.();
    window.__spine.startGameViaSpine({
      mode: 'offline-2p',
      p1Name: 'נחום',
      p2Name: 'דנה',
      startingSlot: 0,
      tileBagSeed: 'promo-video-boost',
      settings: { timelimit: false, showMoveSummary: true },
      beforeStart(session) {
        session.state.racks[0] = ['ש', 'ל', 'ו', 'ם', 'ב', 'ו', 'ס', 'ט'];
        session.state.racks[1] = ['א', 'ר', 'ץ', 'ח', 'ב', 'ר', 'י', 'ם'];
        session.state.players[0].displayName = 'נחום';
        session.state.players[0].avatar = 'legendary_4';
        session.state.players[1].displayName = 'דנה';
        session.state.players[1].avatar = 'rare_7';
      },
    });
  });
  await page.locator('#sg').waitFor({ state: 'visible' });
  await page.waitForSelector('#brack [data-rack-letter]', { timeout: 10000 });
  await sleep(600);
}

async function forceWordVisual(page, committed = false) {
  await page.evaluate((isCommitted) => {
    const values = { 'ש': 3, 'ל': 2, 'ו': 1, 'ם': 2 };
    const cells = [
      ['c5_3', 'ש'],
      ['c5_4', 'ל'],
      ['c5_5', 'ו'],
      ['c5_6', 'ם'],
    ];
    for (const [id, letter] of cells) {
      const cell = document.getElementById(id);
      if (!cell) continue;
      cell.classList.add('ht', isCommitted ? 'lk' : 'np', 'last-move');
      cell.innerHTML = `<div class="btile${isCommitted ? '' : ' nw'}"><div class="bt-l">${letter}</div><div class="bt-v">${values[letter] ?? 1}</div></div>`;
    }
    for (const id of ['is-sv1', 'sv1']) {
      const el = document.getElementById(id);
      if (el) el.textContent = '48';
    }
    const sbar = document.getElementById('sbar');
    if (sbar) sbar.textContent = isCommitted ? 'שלום · 48 נקודות' : 'שבץ את המילה על הלוח';
  }, committed);
}

async function paintBoardMove(page, payload) {
  await page.evaluate(({ tiles, score0, score1, status, activeSlot }) => {
    const values = { א: 1, ב: 3, ג: 3, ד: 2, ה: 1, ו: 1, ז: 5, ח: 4, ט: 5, י: 1, כ: 4, ך: 4, ל: 2, מ: 2, ם: 2, נ: 2, ן: 2, ס: 2, ע: 1, פ: 4, ף: 4, צ: 5, ץ: 5, ק: 4, ר: 2, ש: 3, ת: 1 };
    document.querySelectorAll('#game-grid .last-move').forEach((el) => el.classList.remove('last-move'));
    for (const tile of tiles ?? []) {
      const cell = document.getElementById(`c${tile.r}_${tile.c}`);
      if (!cell) continue;
      const letter = tile.letter;
      const val = tile.val ?? values[letter] ?? 1;
      cell.classList.add('ht', 'lk', 'last-move');
      cell.innerHTML = `<div class="btile"><div class="bt-l">${letter}</div><div class="bt-v">${val}</div></div>`;
    }
    for (const id of ['is-sv1', 'sv1']) {
      const el = document.getElementById(id);
      if (el) el.textContent = String(score0 ?? 0);
    }
    for (const id of ['is-sv2', 'sv2']) {
      const el = document.getElementById(id);
      if (el) el.textContent = String(score1 ?? 0);
    }
    for (const [idx, id] of ['is-sb1', 'is-sb2'].entries()) {
      document.getElementById(id)?.classList?.toggle('act', idx === activeSlot);
    }
    for (const [idx, id] of ['sb1', 'sb2'].entries()) {
      document.getElementById(id)?.classList?.toggle('act', idx === activeSlot);
    }
    const sbar = document.getElementById('sbar');
    if (sbar) sbar.textContent = status ?? '';
  }, payload);
}

async function playWheelBoost(page) {
  await page.evaluate(() => {
    const ui = window.__spine.ui;
    window.__spine.bus.emit(ui.BI_OPEN, {
      bonusType: 'B13',
      miniGameKey: 'b13_wheel_of_fortune',
      kind: 'wheel',
      slot: 0,
      bonusIdx: 10,
    });
  });
  await page.locator('#ov-bonus-intro').waitFor({ state: 'visible', timeout: 5000 });
  await dismissCaptureOverlays(page);
  await sleep(2200);
  await page.locator('#ov-bonus-intro button').click({ timeout: 2000 }).catch(() => {});
  await page.locator('.spine-wheel-overlay').waitFor({ state: 'visible', timeout: 5000 });
  await sleep(1300);
  await page.locator('[data-wheel="spin"]').click({ timeout: 2000 }).catch(() => {});
  await sleep(7000);
}

async function playUnscrambleBoost(page) {
  await page.evaluate(() => {
    const ui = window.__spine.ui;
    window.__spine.bus.emit(ui.BI_OPEN, {
      bonusType: 'B3',
      miniGameKey: 'b3_unscramble_medium',
      kind: 'minigame',
      slot: 0,
      bonusIdx: 1,
    });
  });
  await page.locator('#ov-bonus-intro').waitFor({ state: 'visible', timeout: 5000 });
  await dismissCaptureOverlays(page);
  await sleep(1900);
  await page.locator('#ov-bonus-intro button').click({ timeout: 2000 }).catch(() => {});
  const appeared = await page.locator('.spine-mini-overlay').waitFor({ state: 'visible', timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await sleep(1600);
  for (let i = 0; i < 4; i += 1) {
    const bankButton = page.locator('[data-uns="bank"] button').first();
    if (await bankButton.count()) await bankButton.click({ timeout: 1200 }).catch(() => {});
    await sleep(500);
  }
  await sleep(1300);
  await page.locator('[data-uns="submit"]').click({ timeout: 2000 }).catch(() => {});
  await sleep(4600);
  await page.locator('[data-uns="continue"]').click({ timeout: 1500 }).catch(() => {});
  await sleep(1000);
}

async function wordPlacement(page) {
  await startDemoGame(page);
  await dismissCaptureOverlays(page);
  await sleep(3000);

  const placements = [
    ['ש', '#c5_3'],
    ['ל', '#c5_4'],
    ['ו', '#c5_5'],
    ['ם', '#c5_6'],
  ];
  for (const [letter, cell] of placements) {
    const tile = page.locator(`#brack [data-rack-letter="${letter}"]`).first();
    if (await tile.count()) {
      await tile.click({ timeout: 1500 }).catch(() => {});
      await sleep(180);
      await page.locator(cell).click({ timeout: 1500 }).catch(() => {});
      await sleep(360);
    }
  }
  await forceWordVisual(page, false);
  await sleep(850);
  await page.locator('#btn-play').click({ timeout: 1500 }).catch(() => {});
  await sleep(900);
  await forceWordVisual(page, true);
  await sleep(BOARD_HOLD_MS);

  await paintBoardMove(page, {
    tiles: [
      { r: 3, c: 5, letter: 'א' },
      { r: 4, c: 5, letter: 'ר' },
      { r: 5, c: 5, letter: 'ץ' },
    ],
    score0: 48,
    score1: 31,
    status: 'דנה שיבצה ארץ · 31 נקודות',
    activeSlot: 0,
  });
  await sleep(BOARD_HOLD_MS);

  await paintBoardMove(page, {
    tiles: [
      { r: 6, c: 3, letter: 'ב' },
      { r: 6, c: 4, letter: 'ו' },
      { r: 6, c: 5, letter: 'ס' },
      { r: 6, c: 6, letter: 'ט' },
    ],
    score0: 94,
    score1: 31,
    status: 'בוסט על משבצת מיוחדת · משחקון נפתח',
    activeSlot: 0,
  });
  await sleep(BOARD_HOLD_MS);
  await playWheelBoost(page);

  await paintBoardMove(page, {
    tiles: [
      { r: 2, c: 7, letter: 'ח' },
      { r: 3, c: 7, letter: 'ב' },
      { r: 4, c: 7, letter: 'ר' },
    ],
    score0: 94,
    score1: 64,
    status: 'דנה מצמצמת עם חבר · התור חוזר לנחום',
    activeSlot: 0,
  });
  await sleep(BOARD_HOLD_MS);

  await paintBoardMove(page, {
    tiles: [
      { r: 7, c: 2, letter: 'מ' },
      { r: 7, c: 3, letter: 'י' },
      { r: 7, c: 4, letter: 'ל' },
      { r: 7, c: 5, letter: 'ו' },
      { r: 7, c: 6, letter: 'ן' },
    ],
    score0: 138,
    score1: 64,
    status: 'מילה חדשה על הלוח · בוסט אנגרמה',
    activeSlot: 0,
  });
  await sleep(BOARD_HOLD_MS);
  await playUnscrambleBoost(page);

  await paintBoardMove(page, {
    tiles: [
      { r: 1, c: 3, letter: 'ש' },
      { r: 2, c: 3, letter: 'י' },
      { r: 3, c: 3, letter: 'א' },
    ],
    score0: 146,
    score1: 92,
    status: 'סיום חזק · הלוח מלא באפשרויות',
    activeSlot: 0,
  });
  await sleep(15000);
}

async function winMoment(page) {
  await page.evaluate(() => {
    window.__spine.bus.emit(window.__spine.ui.END_OPEN, {
      winnerSlot: 0,
      scores: { 0: 146, 1: 92 },
      players: {
        0: { displayName: 'נחום', avatar: 'legendary_4' },
        1: { displayName: 'דנה', avatar: 'rare_7' },
      },
    });
  });
  await page.locator('#ov-end').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(2600);
}

async function achievements(page) {
  await page.evaluate(() => {
    document.getElementById('ov-end')?.classList.add('hidden');
    window.showSc?.('sav-gallery');
    window.__spine.bus.emit(window.__spine.ui.AV_RENDER, {
      stats: {
        gamesPlayed: 120,
        gamesWon: 65,
        gamesLost: 38,
        gamesDraw: 4,
        highScore: 312,
        longestStreak: 28,
        currentStreak: 7,
        highestMoveScore: 118,
        cleanWins: 2,
        friendsCount: 24,
        fastGamePlayed: 1,
        uniqueWordsCount: 1200,
        noLossWeekStreaks: 1,
        beatNumberOne: 1,
        invitesSent: 8,
        wordsAccepted: 24,
      },
      ownedAvatars: ['rare_1', 'rare_7', 'epic_2', 'legendary_4'],
      coinRewardByTier: { bronze: 50, silver: 100, gold: 250, legend: 750 },
    });
  });
  await page.locator('#sav-gallery').waitFor({ state: 'visible' });
  await page.locator('#av-gallery-grid .ach-iccell').first().waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(5600);
  await page.evaluate(() => document.querySelector('#av-gallery-grid')?.scrollTo({ top: 420, behavior: 'smooth' }));
  await sleep(5200);
}

async function avatars(page) {
  await page.evaluate(() => {
    window.showSc?.('savatar-store');
    window.__spine.bus.emit(window.__spine.ui.STORE_RENDER ?? 'store/render', {
      coins: 3880,
      ownedAvatars: ['rare_1', 'rare_7', 'epic_2', 'legendary_4'],
      equippedAvatar: 'legendary_4',
    });
  });
  await page.locator('#savatar-store').waitFor({ state: 'visible' });
  await page.locator('#store-grid .store-tile').first().waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(5600);
  await page.evaluate(() => document.querySelector('#store-grid')?.scrollTo({ top: 680, behavior: 'smooth' }));
  await sleep(5400);
}

async function gameModes(page) {
  await page.evaluate(() => {
    window.showSc?.('ss');
    window.__spine.bus.emit(window.__spine.ui.SETUP_OPEN, { mode: 'bot', initialDifficulty: 1, initialBotTime: 40 });
  });
  await page.locator('#ss').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(SCREEN_HOLD_MS);

  await page.evaluate(() => {
    window.__spine.bus.emit(window.__spine.ui.SETUP_OPEN, { mode: 'vs', initialDifficulty: 1, initialBotTime: 40 });
  });
  await dismissCaptureOverlays(page);
  await sleep(4200);

  await page.evaluate(() => window.showSc?.('so'));
  await page.locator('#so').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(SCREEN_HOLD_MS);
}

async function profileAndStats(page) {
  const payload = {
    profile: {
      displayName: 'נחום רובין',
      equippedAvatar: 'legendary_4',
      rating: 886,
      coins: 3880,
      userId: 'BOOST886',
      stats: {
        gamesPlayed: 128,
        gamesWon: 71,
        gamesLost: 42,
        gamesDraw: 5,
        highScore: 312,
        highestMoveScore: 118,
        longestWord: 'מילון',
        longestStreak: 28,
        currentStreak: 7,
        comebackWins: 6,
        bestComeback: 42,
        lastMoveWins: 4,
        closeWins: 11,
        cleanWins: 2,
        friendsCount: 24,
        fastGamePlayed: 1,
        uniqueWordsCount: 1200,
        wordsPlayed: 932,
        wordsAccepted: 24,
        noLossWeekStreaks: 1,
        beatNumberOne: 1,
        invitesSent: 8,
        recentGames: ['W', 'W', 'L', 'W', 'D', 'W', 'W', 'L', 'W', 'W'],
        favoriteStartLetters: { מ: 47, ש: 38, ב: 31, א: 28 },
        boostUsage: { B1: 12, B8: 7, B13: 9 },
        rivalStats: {
          dana: { name: 'דנה', played: 14, won: 9, lost: 5, draw: 0 },
          ori: { name: 'אורי', played: 8, won: 5, lost: 2, draw: 1 },
        },
      },
      ownedAvatars: ['rare_1', 'rare_7', 'epic_2', 'legendary_4'],
    },
    isAnonymous: false,
    email: 'boost@example.test',
  };

  await page.evaluate((nextPayload) => {
    window.showSc?.('sprofile');
    window.__spine.bus.emit(window.__spine.ui.PROFILE_RENDER, nextPayload);
  }, payload);
  await page.locator('#sprofile').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(SCREEN_HOLD_MS);

  await page.evaluate((nextPayload) => {
    window.showSc?.('sstats');
    window.__spine.bus.emit(window.__spine.ui.PROFILE_RENDER, nextPayload);
  }, payload);
  await page.locator('#sstats').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(6200);
  await page.evaluate(() => document.querySelector('#sstats')?.scrollTo({ top: 540, behavior: 'smooth' }));
  await sleep(5200);
  await page.evaluate(() => document.querySelector('#sstats')?.scrollTo({ top: 1040, behavior: 'smooth' }));
  await sleep(5200);
}

async function friendsScreen(page) {
  await page.evaluate(() => {
    window.showSc?.('sfriends');
    window.__spine.bus.emit(window.__spine.ui.FRIENDS_RENDER, {
      myUserId: 'BOOST886',
      requests: [
        { fromUid: 'DANA777', fromName: 'דנה', fromAvatar: 'rare_7' },
        { fromUid: 'ORI555', fromName: 'אורי', fromAvatar: 'epic_2' },
      ],
      friends: [
        { uid: 'DANA777', name: 'דנה', avatar: 'rare_7', rating: 914, connected: true },
        { uid: 'ORI555', name: 'אורי', avatar: 'epic_2', rating: 801, connected: false, lastSeen: Date.now() - 3600000 },
        { uid: 'MAYA333', name: 'מאיה', avatar: 'rare_1', rating: 972, connected: true },
      ],
      invitesSent: 3,
      inviteStatus: '3 מתוך 5 הזמנות נשלחו',
    });
  });
  await page.locator('#sfriends').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(7600);
}

async function notificationsScreen(page) {
  await page.evaluate(() => {
    window.showSc?.('snotif');
    window.__spine.bus.emit(window.__spine.ui.NOTIF_RENDER, {
      invites: [
        { inviteId: 'inv-1', fromName: 'דנה', fromAvatar: 'rare_7', mode: 'friend-live' },
      ],
      friendRequests: [
        { fromUid: 'MAYA333', fromName: 'מאיה', fromAvatar: 'rare_1' },
      ],
      supportReplies: [
        {
          id: 'support-1',
          title: 'הפנייה שלך טופלה',
          message: 'בדקנו את הדיווח ותיקנו את הבעיה במשחק.',
          originalMessage: 'לא מצליח לשחק נגד חבר',
          reasonLabel: 'דווח על בעיה במשחק',
          outcomeLabel: 'טופל',
          createdAt: Date.now() - 1800000,
        },
      ],
    });
  });
  await page.locator('#snotif').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(7600);
}

async function dictionaryScreen(page) {
  await page.evaluate(() => {
    window.showSc?.('sh');
    window.__spine.bus.emit(window.__spine.ui.DICT_INTENT.OPEN_QUERY, {});
  });
  await page.locator('#ov-shailta').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await page.locator('#shin').fill('שלום').catch(() => {});
  await sleep(1300);
  await page.evaluate(() => {
    window.__spine.bus.emit(window.__spine.ui.DICT_RENDER.QUERY_RESULT, {
      target: 'main',
      word: 'שלום',
      valid: true,
    });
  });
  await sleep(5200);
  await page.evaluate(() => document.getElementById('ov-shailta')?.classList.add('hidden'));
}

async function myGamesScreen(page) {
  await page.evaluate(() => {
    window.showSc?.('smygames');
    window.__spine.bus.emit(window.__spine.ui.MG_RENDER, {
      sessions: [
        { roomId: 'room-1', opponentName: 'דנה', isMyTurn: true, myScore: 146, opponentScore: 92, mode: 'friend-async', updatedAt: Date.now() - 900000 },
        { roomId: 'room-2', opponentName: 'אורי', isMyTurn: false, myScore: 88, opponentScore: 104, mode: 'friend-async', updatedAt: Date.now() - 3600000 },
      ],
    });
  });
  await page.locator('#smygames').waitFor({ state: 'visible' });
  await dismissCaptureOverlays(page);
  await sleep(6200);
}

async function run() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  let server = null;
  let browser = null;
  let context = null;

  try {
    server = await startStaticServer();
    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'he-IL',
      timezoneId: 'Asia/Jerusalem',
      serviceWorkers: 'block',
      recordVideo: { dir: RAW_DIR, size: VIEWPORT },
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.warn('[promo] pageerror:', err.message));
    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) console.warn(`[promo] ${msg.type()}: ${msg.text()}`);
    });

    await bootApp(page);
    await installRawCaptureGuards(page);
    await showMainMenu(page);
    await gameModes(page);
    await quickMatch(page);
    await wordPlacement(page);
    await winMoment(page);
    await profileAndStats(page);
    await friendsScreen(page);
    await notificationsScreen(page);
    await dictionaryScreen(page);
    await myGamesScreen(page);
    await achievements(page);
    await avatars(page);
    await showMainMenu(page);
    await sleep(2200);

    const video = page.video();
    await context.close();
    const rawPath = await video.path();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const finalPath = path.join(OUT_DIR, `boost-raw-footage-${stamp}.webm`);
    await fs.rename(rawPath, finalPath);
    await browser.close();
    server?.kill();
    console.log(finalPath);
  } catch (err) {
    await context?.close?.().catch(() => {});
    await browser?.close?.().catch(() => {});
    server?.kill();
    throw err;
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
