const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.resolve(__dirname, '../../images/guide/debug');
fs.mkdirSync(OUT_DIR, { recursive: true });

test.use({ viewport: { width: 412, height: 820 } });

async function bootSpine(page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    window.__spine?.enabled === true && !!window.__spine.bus);
  // The static test server never finishes Firebase connect, so the boot splash
  // (#app-loading) stays up. Hide it + wait for the injected partials.
  await page.waitForFunction(() => !!document.getElementById('sadmin') && !!document.getElementById('ov-replay'));
  await page.evaluate(() => {
    document.getElementById('app-loading')?.classList.add('hidden');
    document.getElementById('app-loading')?.style.setProperty('display', 'none', 'important');
  });
}

test('admin debug tab', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => {
    document.getElementById('sh')?.classList.add('hidden');
    document.getElementById('sadmin')?.classList.remove('hidden');
    // switch to the debug tab
    document.querySelector('[data-adm-tab="debug"]')?.click();
    const bus = window.__spine.bus;
    bus.emit('admin/render/debugIndex', { games: [
      { gameId: 'room-abc123', hostName: 'נחום', guestName: 'הודיה', status: 'playing', appVersion: '20260627', createdAt: Date.now() - 120000 },
      { gameId: 'room-def456', hostName: 'דני', guestName: 'מרים', status: 'completed', appVersion: '20260627', createdAt: Date.now() - 800000 },
      { gameId: 'room-ghi789', hostName: 'יוסי', guestName: 'ענת', status: 'abandoned', appVersion: '20260601', createdAt: Date.now() - 9000000 },
    ] });
    bus.emit('admin/render/debugTimeline', { gameId: 'room-abc123', timeline: {
      index: { hostName: 'נחום', guestName: 'הודיה', status: 'playing', mode: 'friend-live', appVersion: '20260627', createdAt: Date.now() - 120000 },
      events: [
        { type: 'GAME_CREATED', summary: 'Room created (friend-live) — נחום vs הודיה', serverTimestamp: Date.now() - 120000 },
        { type: 'GAME_STARTED', summary: 'Game started', serverTimestamp: Date.now() - 119000 },
        { type: 'WORD_ACCEPTED', summary: 'נחום played שלום for 14 points', serverTimestamp: Date.now() - 90000 },
        { type: 'TURN_CHANGED', summary: 'Turn → הודיה (turn 2)', serverTimestamp: Date.now() - 89000 },
        { type: 'WORD_REJECTED', summary: 'Move rejected: word-not-in-dictionary', serverTimestamp: Date.now() - 60000 },
      ],
      snapshots: [{}, {}],
      clientSnapshots: { 0: [{}], 1: [{}] },
      warnings: [
        { type: 'SCORE_MISMATCH', severity: 'high', message: 'Expected score delta 14 but slot 0 changed by 16', version: 3 },
        { type: 'CLIENT_STATE_MISMATCH', severity: 'high', message: 'Client state hash a1b2 != server c3d4', version: 4 },
        { type: 'APP_VERSION_OLD', severity: 'low', message: 'App version 20260601 is older than minimum 20260620', version: 4 },
      ],
      reports: [
        { kind: 'manual', userMessage: 'המילה נעלמה מהלוח', playerName: 'נחום', lastEventId: 'k_abc' },
      ],
    } });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'admin-debug-tab.png') });
});

test('tri-panel replay overlay', async ({ page }) => {
  await bootSpine(page);
  await page.evaluate(() => {
    const flat = (occ) => { const f = new Array(100).fill(null); for (const [i, l] of Object.entries(occ)) f[i] = { letter: l, val: 1 }; return f; };
    const players = { 0: { displayName: 'נחום' }, 1: { displayName: 'הודיה' } };
    const serverBoard = flat({ 44: 'ש', 45: 'ל', 46: 'ו', 47: 'ם' });
    const laggyBoard = flat({ 44: 'ש', 45: 'ל' }); // p1 hasn't seen the full word
    const mk = (board, hash, version, appVersion) => ({
      board, players, hash, version, believedVersion: version, appVersion,
      compact: { hostScore: 14, guestScore: 0, turnNumber: 2 },
    });
    const frames = [{
      t: Date.now(), diverged: true,
      server: mk(serverBoard, 'srv', 4, '20260627'),
      p0: mk(serverBoard, 'srv', 4, '20260627'),
      p1: mk(laggyBoard, 'old', 3, '20260601'),
    }];
    document.getElementById('sh')?.classList.add('hidden');
    window.__spine.bus.emit('replay/open', { gameId: 'room-abc123', frames });
  });
  await page.waitForTimeout(300);
  const ov = page.locator('#ov-replay');
  await ov.screenshot({ path: path.join(OUT_DIR, 'replay-tripanel.png') });
});
