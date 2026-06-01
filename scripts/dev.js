#!/usr/bin/env node
//
// scripts/dev.js — interactive launcher.
//
// Asks whether to run against the local emulator or production Firebase,
// then starts the Firebase hosting emulator on :5000 (and, if emulator mode,
// the database/auth/UI emulators too) and opens the browser at the right URL.
//
// Usage:
//   npm run dev                     # prompts for mode + session count
//   npm run dev -- --emu            # skip mode prompt, force emulator
//   npm run dev -- --prod           # skip mode prompt, force production
//   npm run dev -- --two            # open 2 isolated browser sessions
//   npm run dev -- --sessions=3     # open N isolated sessions (1..8)
//   npm run dev -- --emu --two      # combine
//
// Each isolated session gets its own Chrome/Edge --user-data-dir under the
// OS temp folder, so they have independent localStorage + Firebase auth
// state — sign in as different users and play each other against the same
// emulator.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const HOSTING_PORT = 5000;
const EMU_FLAG = '?emu=1';

function parseFlags(argv) {
  const flags = { mode: null, sessions: 1 };
  for (const a of argv.slice(2)) {
    if (a === '--emu' || a === '--emulator') flags.mode = 'emu';
    else if (a === '--prod' || a === '--production') flags.mode = 'prod';
    else if (a === '--two') flags.sessions = 2;
    else if (a.startsWith('--sessions=')) flags.sessions = Math.max(1, Number(a.split('=')[1]) || 1);
  }
  return flags;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim().toLowerCase()); }));
}

function openUrl(url) {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  } else {
    spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  }
}

// Find a Chromium-family browser binary so we can launch with --user-data-dir
// and get a fully isolated session (separate localStorage, IndexedDB, Firebase
// auth state). Returns null if none are found.
function findChromium() {
  if (process.platform === 'win32') {
    const candidates = [
      process.env['ProgramFiles']      && path.join(process.env['ProgramFiles'],      'Google/Chrome/Application/chrome.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
      process.env.LOCALAPPDATA         && path.join(process.env.LOCALAPPDATA,         'Google/Chrome/Application/chrome.exe'),
      process.env['ProgramFiles']      && path.join(process.env['ProgramFiles'],      'Microsoft/Edge/Application/msedge.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    ].filter(Boolean);
    return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? null;
  }
  // Linux: rely on PATH
  for (const bin of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try {
      const which = require('node:child_process').execSync(`which ${bin}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (which) return which;
    } catch {}
  }
  return null;
}

// Open `count` isolated sessions of `url`. Each gets its own profile dir
// under the OS temp folder so they sign in as different users.
function openIsolatedSessions(url, count) {
  if (count <= 1) { openUrl(url); return; }
  const chrome = findChromium();
  if (!chrome) {
    console.warn('⚠ Chrome/Edge not found — falling back to a single default-browser window.');
    console.warn('  Open a second incognito/private window manually and visit:', url);
    openUrl(url);
    return;
  }
  for (let i = 1; i <= count; i++) {
    const profileDir = path.join(os.tmpdir(), `bonus-game-session-${i}`);
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch {}
    spawn(chrome, [
      `--user-data-dir=${profileDir}`,
      '--new-window',
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ], { stdio: 'ignore', detached: true }).unref();
    console.log(`  • Session ${i} → ${profileDir}`);
  }
}

async function main() {
  const { mode: forced, sessions: forcedSessions } = parseFlags(process.argv);

  let mode = forced;
  if (!mode) {
    const ans = await ask('Use the local Firebase emulator? (y = isolated test DB, n = real production DB) [Y/n] ');
    mode = (ans === 'n' || ans === 'no') ? 'prod' : 'emu';
  }
  const useEmulator = mode === 'emu';

  let sessions = forcedSessions;
  if (forcedSessions === 1 && !process.argv.slice(2).some(a => a === '--sessions=1')) {
    // Only prompt for sessions if not explicitly set on the CLI.
    const ans = await ask('How many isolated browser sessions? [1] ');
    const n = Number(ans);
    if (Number.isFinite(n) && n >= 1 && n <= 8) sessions = Math.floor(n);
  }

  const url = `http://localhost:${HOSTING_PORT}/${useEmulator ? EMU_FLAG : ''}`;

  console.log('─'.repeat(60));
  if (useEmulator) {
    console.log('Mode:        EMULATOR (isolated local DB + Auth)');
    console.log('Persistence: .emulator-data/ (auto-imported, exported on exit)');
    console.log('Emulator UI: http://localhost:4000');
  } else {
    console.log('Mode:        PRODUCTION (boost-8ef11 — real Firebase)');
    console.log('⚠ Anything you do in the app touches the live database.');
  }
  console.log(`Sessions:    ${sessions}${sessions > 1 ? ' (isolated browser profiles)' : ''}`);
  console.log(`URL:         ${url}`);
  console.log('─'.repeat(60));
  console.log('Press Ctrl+C to stop.\n');

  const isWindows = process.platform === 'win32';
  const firebaseCmd = isWindows ? 'firebase.cmd' : 'firebase';
  const args = useEmulator
    ? ['emulators:start',
       '--project', 'demo-bonus-game',
       '--only', 'database,auth,hosting,ui',
       '--import=.emulator-data',
       '--export-on-exit=.emulator-data']
    : ['emulators:start',
       '--project', 'demo-bonus-game',
       '--only', 'hosting'];

  // shell:true on Windows is required since Node 20.12 / 22 (CVE-2024-27980)
  // — spawning .cmd/.bat directly throws EINVAL.
  const child = spawn(firebaseCmd, args, { stdio: 'inherit', shell: isWindows });

  // Open the browser once the hosting server has had a moment to bind.
  // Emulator startup is slower; give it more breathing room.
  const openDelayMs = useEmulator ? 6000 : 3000;
  const openTimer = setTimeout(() => openIsolatedSessions(url, sessions), openDelayMs);

  const forwardSignal = (sig) => {
    if (!child.killed) child.kill(sig);
  };
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code) => {
    clearTimeout(openTimer);
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error('Could not find the `firebase` CLI. Run `npm install` first (firebase-tools is a devDependency).');
    } else {
      console.error('Failed to start firebase emulator:', err);
    }
    process.exit(1);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
