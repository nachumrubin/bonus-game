// debug-game.mjs — dump + analyse a single online game by room id.
//
// Reads the production Realtime Database room doc directly. No auth is needed
// because the prod rules allow unauthenticated reads on /rooms (same as
// find-room.mjs). Read-only — never writes.
//
// The /rooms doc is the server-authoritative game state and is the richest
// forensic source available without admin credentials: full moveHistory (with
// baseScore/bonusExtra on bonus moves), bonusAssignment, bonusBoard, bonusSqUsed,
// scores, players, activeBoosts. The admin-only debug streams (/gameEvents with
// the MINIGAME_STARTED / MINIGAME_RESOLVED timeline, /clientSnapshots, etc.) are
// NOT readable here — view those in the in-app admin debug tool.
//
// Usage:
//   node scripts/debug-game.mjs <roomId>
//   node scripts/debug-game.mjs fc_1783939961090_ukvp3f
//   node scripts/debug-game.mjs <roomId> --json      (machine-readable)
//   node scripts/debug-game.mjs <roomId> --move 21   (full JSON of one move)

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { BDEFS } from '../src/game/boosts/data.js';
import { BONUS_TILE_DEFS } from '../src/game/boosts/bonusTileDefs.js';

const PROD_CONFIG = {
  databaseURL: 'https://boost-8ef11-default-rtdb.firebaseio.com',
  projectId: 'boost-8ef11',
};

function parseArgs(argv) {
  const opts = { roomId: null, json: false, move: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--move') opts.move = Number(argv[++i]);
    else if (!a.startsWith('--')) opts.roomId = a;
  }
  return opts;
}

// Which BDEFS slot (if any) does an on-board tile at (r,c) sit on?
function bonusIdxAt(r, c) {
  return BDEFS.findIndex(b => b.br === r && b.bc === c);
}

function catOf(type) {
  return BONUS_TILE_DEFS[type]?.category ?? '?';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.roomId) {
    console.error('Usage: node scripts/debug-game.mjs <roomId> [--json] [--move N]');
    process.exit(2);
  }

  firebase.initializeApp(PROD_CONFIG);
  const db = firebase.database();
  const room = (await db.ref(`rooms/${opts.roomId}`).get()).val();
  await firebase.app().delete();

  if (!room) {
    console.error(`Room ${opts.roomId} not found.`);
    process.exit(1);
  }

  const mh = Array.isArray(room.moveHistory)
    ? room.moveHistory
    : Object.values(room.moveHistory ?? {});
  const asn = room.bonusAssignment ?? [];

  // Annotate each move with the bonus square(s) it landed on.
  const moves = mh.map((m, i) => {
    if (!m) return { i, empty: true };
    const landed = (m.tiles ?? [])
      .map(t => {
        const bi = bonusIdxAt(t.r, t.c);
        if (bi < 0) return null;
        const type = asn[bi]?.type ?? null;
        return { bonusIdx: bi, type, category: catOf(type), tile: t.letter };
      })
      .filter(Boolean);
    return {
      i,
      slot: m.slot,
      words: m.words ?? [],
      score: m.score,
      baseScore: m.baseScore,           // present only on bonus (deferred) moves
      bonusExtra: m.bonusExtra,         // 0 = landed on a bonus but earned nothing
      landed,
    };
  });

  if (opts.move != null) {
    console.log(JSON.stringify(mh[opts.move], null, 2));
    return;
  }
  if (opts.json) {
    console.log(JSON.stringify({ room: { ...room, moveHistory: undefined }, moves }, null, 2));
    return;
  }

  console.log(`\n=== ${opts.roomId} ===`);
  console.log(`status=${room.status} mode=${room.mode} turnNumber=${room.turnNumber} version=${room.version}`);
  console.log(`players: ${JSON.stringify((room.players ?? []).map(p => p?.displayName))}`);
  console.log(`scores:  ${JSON.stringify(room.scores)}`);
  console.log(`activeBoosts: ${JSON.stringify(room.activeBoosts ?? [])}`);

  console.log('\n--- bonus squares (BDEFS idx → assigned type → landed?) ---');
  const used = room.bonusSqUsed ?? {};
  BDEFS.forEach((b, i) => {
    const type = asn[i]?.type ?? '?';
    const landedMove = moves.find(m => m.landed?.some(l => l.bonusIdx === i));
    const where = `(${b.br},${b.bc})`;
    const usedFlag = used[i] ? 'USED' : 'free';
    const by = landedMove
      ? `move #${landedMove.i} slot${landedMove.slot} → +${landedMove.bonusExtra ?? '?'} (${catOf(type)})`
      : '—';
    console.log(`  idx${String(i).padStart(2)} ${where.padEnd(8)} ${String(type).padEnd(4)} ${catOf(type).padEnd(9)} ${usedFlag.padEnd(5)} ${by}`);
  });

  console.log('\n--- moves ---');
  for (const m of moves) {
    if (m.empty) { console.log(`#${m.i} (empty)`); continue; }
    const extra = m.bonusExtra !== undefined ? ` [base=${m.baseScore} bonus=${m.bonusExtra}]` : '';
    const bonus = m.landed.length
      ? ` BONUS{${m.landed.map(l => `idx${l.bonusIdx}=${l.type}/${l.category}(${l.tile})`).join(', ')}}`
      : '';
    console.log(`#${m.i} slot${m.slot} score=${m.score}${extra} [${(m.words ?? []).join(',')}]${bonus}`);
  }

  // Flag suspicious bonus moves: landed on a square but earned 0.
  const suspicious = moves.filter(m => m.landed?.length && m.bonusExtra === 0);
  if (suspicious.length) {
    console.log('\n--- landed-on-bonus-but-earned-0 (verify: mini-game lost? veto? auto-0?) ---');
    for (const m of suspicious) {
      const cats = m.landed.map(l => `${l.type}/${l.category}`).join(', ');
      console.log(`  move #${m.i} slot${m.slot} [${m.words.join(',')}] → ${cats}`);
    }
    console.log('  NOTE: mini-game (B1/B3/B8/B10/B11/B12/B14) and wheel (B13) squares');
    console.log('  award 0 when the player LOSES the mini-game — that is expected, not a bug.');
    console.log('  future squares (B5/B6/B7) always show bonusExtra=0 (delayed effect, no points).');
    console.log('  For the actual puzzle + player answer, open the in-app admin debug timeline');
    console.log('  (MINIGAME_RESOLVED events) — the room doc does not store it.');
  }
}

main().catch((err) => { console.error('[debug-game] fatal', err); process.exit(1); });
