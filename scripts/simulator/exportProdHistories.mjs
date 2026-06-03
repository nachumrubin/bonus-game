// exportProdHistories.mjs
//
// Connects to the production Firebase Realtime Database (read-only — /rooms
// has `.read: true`), pulls completed live games, anonymizes them, and
// writes a JSON file the simulator's `--replay` mode can consume.
//
// Why connect from Node: prod is the source of truth for "real games" we
// want to replay-test against the current engine. No service-account key
// is needed because the production rules already permit unauthenticated
// reads on /rooms — see firebase.database.rules.json line 11. The
// databaseURL is the same one src/main.js wires the app to.
//
// What we capture per game:
//   - moveHistory (the entire array — drives the replay)
//   - tileBagSeed (so the simulator can reconstruct identical rack draws;
//     without this, the engine's `placed-not-in-rack` defense rejects
//     every placement)
//   - mode, settings (mode affects validation in subtle ways)
//   - originalRoomId (for traceability when a replay crashes)
//
// What we DON'T capture:
//   - players[*].uid, displayName — anonymized to synthetic 'replay-N-{a,b}'
//   - presence / livePreview / liveReaction / liveBonus — irrelevant to replay
//   - scores / board / racks — derivable from the move history
//
// Usage:
//   node scripts/simulator/exportProdHistories.mjs --count 20 --out histories.json
//   node scripts/simulator/exportProdHistories.mjs --count 50 --modes friend-live,random-live

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.simulator-data', 'prod-histories.json');

const PROD_CONFIG = {
  databaseURL: 'https://boost-8ef11-default-rtdb.firebaseio.com',
  projectId: 'boost-8ef11',
};

function parseArgs(argv) {
  const opts = {
    count: 20,
    modes: ['friend-live', 'random-live'],
    out: DEFAULT_OUT,
    minMoves: 1,
    includeAbandoned: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--count': opts.count = Number(next()); break;
      case '--modes': opts.modes = next().split(',').map(s => s.trim()); break;
      case '--out': opts.out = next(); break;
      case '--min-moves': opts.minMoves = Number(next()); break;
      case '--no-abandoned': opts.includeAbandoned = false; break;
      case '--help': case '-h':
        console.log(`Usage: node scripts/simulator/exportProdHistories.mjs [options]

Options:
  --count N         Number of games to export (default 20)
  --modes a,b,c     Comma-separated room modes (default friend-live,random-live)
  --min-moves N     Skip games with fewer than N moves in moveHistory (default 1)
  --no-abandoned    Skip abandoned games (default: include)
  --out PATH        Output JSON file (default .simulator-data/prod-histories.json)
`);
        process.exit(0);
    }
  }
  return opts;
}

function anonymizeGame(roomId, room, index) {
  // Strip everything the replay doesn't need; rename uids/displayNames to
  // synthetic stand-ins keyed by export index so the file is shareable.
  const players = {
    0: { uid: `replay-${index}-a`, displayName: 'BotA', joinedAt: 1 },
    1: { uid: `replay-${index}-b`, displayName: 'BotB', joinedAt: 2 },
  };
  // moveHistory entries reference `slot` but never the player uid, so the
  // synthetic players don't change replay semantics.
  // Capture prod's final state too — the replay test isn't just "no
  // crashes," it's "does the engine reproduce the same game the player
  // saw?" Final scores / status / board are the ground truth to compare
  // replay against, so divergences (score drift, word-formation drift,
  // dictionary drift) surface as bugs instead of being swallowed.
  return {
    originalRoomId: roomId,                  // traceable but not personally identifying
    mode: String(room.mode ?? 'friend-live'),
    settings: { ...(room.settings ?? {}) },
    tileBagSeed: String(room.tileBagSeed ?? ''),
    players,
    finalStatus: String(room.status ?? 'unknown'),
    abandonedBy: room.abandonedBy ?? null,
    createdAt: Number(room.createdAt ?? 0),
    moveCount: Array.isArray(room.moveHistory) ? room.moveHistory.length : 0,
    moveHistory: Array.isArray(room.moveHistory) ? room.moveHistory.map(stripMove) : [],
    // Ground-truth final state for divergence detection.
    expectedFinal: {
      scores: normalizeScores(room.scores),
      status: String(room.status ?? 'unknown'),
      // Board snapshot: just the {position: letter} map so we can compare
      // without worrying about val/isJoker (those follow from letter+HV).
      boardLetters: extractBoardLetters(room.board),
      bonusBoardLetters: extractBonusBoardLetters(room.bonusBoard),
      // Per-move scores + words for fine-grained replay comparison.
      moveScores: (room.moveHistory ?? []).map(m => Number(m.score ?? 0)),
      moveWords: (room.moveHistory ?? []).map(m => Array.isArray(m.words) ? [...m.words] : []),
    },
  };
}

function normalizeScores(scores) {
  return {
    0: Number(scores?.[0] ?? scores?.['0'] ?? 0),
    1: Number(scores?.[1] ?? scores?.['1'] ?? 0),
  };
}

function extractBoardLetters(board) {
  if (!board) return {};
  const out = {};
  const cells = Array.isArray(board) ? board : Object.entries(board);
  if (Array.isArray(board)) {
    board.forEach((cell, i) => {
      if (cell && cell.letter) out[i] = cell.letter;
    });
  } else {
    for (const [k, v] of Object.entries(board)) {
      if (v && v.letter) out[k] = v.letter;
    }
  }
  return out;
}

function extractBonusBoardLetters(bonusBoard) {
  if (!bonusBoard || typeof bonusBoard !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(bonusBoard)) {
    if (v && v.letter) out[k] = v.letter;
  }
  return out;
}

function stripMove(m) {
  // Keep fields the replayBot translates PLUS the scoring outcome (score +
  // words) so the divergence tracker can compare replay-vs-prod per move.
  // Drop ts (no PII but useless), wordTiles (derivable from words+positions),
  // and swappedTiles (engine recomputes).
  const out = { slot: m.slot };
  if (m.type) out.type = m.type;
  if (Array.isArray(m.tiles)) out.tiles = m.tiles.map(t => ({
    r: Number(t.r), c: Number(t.c),
    letter: String(t.letter),
    val: Number(t.val ?? 0),
    isJoker: !!t.isJoker,
  }));
  if (m.count != null) out.count = Number(m.count);
  if (m.passReason) out.passReason = String(m.passReason);
  if (m.lock) {
    out.lock = {
      r: Number(m.lock.r), c: Number(m.lock.c),
      remainingTurns: Number(m.lock.remainingTurns ?? m.lock.duration ?? 0),
    };
  }
  if (Array.isArray(m.letters)) out.letters = m.letters.map(String);
  // Scoring outcome — needed for replay-divergence comparison.
  if (m.score != null) out.score = Number(m.score);
  if (Array.isArray(m.words)) out.words = m.words.map(String);
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[export] connecting to', PROD_CONFIG.databaseURL);
  firebase.initializeApp(PROD_CONFIG);
  const db = firebase.database();

  console.log('[export] reading /rooms (this can be slow on a large prod tree)');
  const snap = await db.ref('rooms').get();
  const all = snap.val() || {};
  const totalRooms = Object.keys(all).length;
  console.log(`[export] read ${totalRooms} rooms`);

  const terminalStatuses = new Set(opts.includeAbandoned
    ? ['completed', 'abandoned']
    : ['completed']);
  const modesSet = new Set(opts.modes);

  const candidates = Object.entries(all)
    .filter(([_, r]) => r && typeof r === 'object')
    .filter(([_, r]) => terminalStatuses.has(r.status))
    .filter(([_, r]) => modesSet.has(r.mode))
    .filter(([_, r]) => Array.isArray(r.moveHistory) && r.moveHistory.length >= opts.minMoves)
    .filter(([_, r]) => r.tileBagSeed); // need seed to reconstruct racks

  console.log(`[export] ${candidates.length} candidates match filters`);

  // Sort by createdAt DESC (most recent first), take N.
  candidates.sort((a, b) => Number(b[1].createdAt ?? 0) - Number(a[1].createdAt ?? 0));
  const picked = candidates.slice(0, opts.count);
  console.log(`[export] picking ${picked.length} most-recent games`);

  const games = picked.map(([id, r], i) => anonymizeGame(id, r, i));

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(games, null, 2));
  console.log(`[export] wrote ${games.length} games to ${opts.out}`);

  // Summary printout — helps you eyeball what got picked.
  const byMode = {};
  const byStatus = {};
  let totalMoves = 0;
  for (const g of games) {
    byMode[g.mode] = (byMode[g.mode] || 0) + 1;
    byStatus[g.finalStatus] = (byStatus[g.finalStatus] || 0) + 1;
    totalMoves += g.moveCount;
  }
  console.log('[export] summary:');
  console.log('  by mode:    ', byMode);
  console.log('  by status:  ', byStatus);
  console.log('  total moves:', totalMoves);
  console.log('  avg moves:  ', Math.round(totalMoves / Math.max(games.length, 1)));
  console.log('  date range: ',
    games.length ? new Date(games[games.length - 1].createdAt).toISOString() : '—',
    '→',
    games.length ? new Date(games[0].createdAt).toISOString() : '—');

  await firebase.app().delete();
  process.exit(0);
}

main().catch((err) => {
  console.error('[export] fatal', err);
  process.exit(1);
});
