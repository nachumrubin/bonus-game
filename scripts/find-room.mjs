// find-room.mjs — debugging helper: look up a game's room id by the two
// players' display names and (optionally) roughly when it was played.
//
// Reads the production Realtime Database directly. No auth / service-account
// key is needed because the prod rules allow unauthenticated reads on /rooms
// (see firebase.database.rules.json, and scripts/simulator/exportProdHistories.mjs
// which relies on the same thing). Read-only — this script never writes.
//
// Usage:
//   node scripts/find-room.mjs --host "נחום רובין" --guest "הודיה" --at "2026-06-13 18:43"
//   node scripts/find-room.mjs "נחום רובין" "הודיה" "2026-06-13 18:43"   (positional)
//   node scripts/find-room.mjs --host "הודיה"                            (guest optional)
//
// Options:
//   --host <name>     One player's display name (required).
//   --guest <name>    The other player's display name (optional).
//   --at <datetime>   Roughly when the game was played. Anything `new Date()`
//                     parses works, e.g. "2026-06-13 18:43" or "2026-06-13".
//                     Results are sorted by closeness to this time.
//   --window <min>    Only show games whose createdAt is within ±N minutes of
//                     --at. Default: no hard cut-off (sorted by proximity).
//   --strict          Require host == slot 0 AND guest == slot 1 (default:
//                     names may match in either slot).
//   --contains        Substring name match instead of exact (case-insensitive).
//   --limit <n>       Max rows to print (default 20).
//   --json            Print machine-readable JSON instead of the table.
//
// The display name comparison is case-insensitive and whitespace-trimmed.

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

const PROD_CONFIG = {
  databaseURL: 'https://boost-8ef11-default-rtdb.firebaseio.com',
  projectId: 'boost-8ef11',
};

function parseArgs(argv) {
  const opts = {
    host: null, guest: null, at: null, window: null,
    strict: false, contains: false, limit: 20, json: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--host':     opts.host = next(); break;
      case '--guest':    opts.guest = next(); break;
      case '--at':       opts.at = next(); break;
      case '--window':   opts.window = Number(next()); break;
      case '--strict':   opts.strict = true; break;
      case '--contains': opts.contains = true; break;
      case '--limit':    opts.limit = Number(next()); break;
      case '--json':     opts.json = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (a.startsWith('--')) { console.error(`Unknown option: ${a}`); process.exit(2); }
        positional.push(a);
    }
  }
  // Positional fallback: host, guest, at.
  if (!opts.host  && positional[0]) opts.host  = positional[0];
  if (!opts.guest && positional[1]) opts.guest = positional[1];
  if (!opts.at    && positional[2]) opts.at    = positional[2];
  return opts;
}

const HELP = `find-room — look up a game's room id by player names + datetime

  node scripts/find-room.mjs --host "<name>" [--guest "<name>"] [--at "<datetime>"]
  node scripts/find-room.mjs "<host>" "<guest>" "<datetime>"

Options:
  --host <name>    A player's display name (required)
  --guest <name>   The other player's display name (optional)
  --at <datetime>  Approx. game time, e.g. "2026-06-13 18:43"; sorts by closeness
  --window <min>   Only show games within ±N minutes of --at
  --strict         Require host=slot0 AND guest=slot1 (default: either order)
  --contains       Substring name match (default: exact, case-insensitive)
  --limit <n>      Max rows (default 20)
  --json           JSON output
`;

function norm(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function nameMatches(playerName, query, contains) {
  const p = norm(playerName);
  const q = norm(query);
  if (!q) return false;
  return contains ? p.includes(q) : p === q;
}

// Does a room match the requested host/guest names?
// Returns null if no match, otherwise { hostSlot, guestSlot }.
function roomNameMatch(room, opts) {
  const p0 = room.players?.[0]?.displayName ?? room.players?.['0']?.displayName ?? '';
  const p1 = room.players?.[1]?.displayName ?? room.players?.['1']?.displayName ?? '';
  const { host, guest, strict, contains } = opts;

  if (strict) {
    if (nameMatches(p0, host, contains) && (!guest || nameMatches(p1, guest, contains))) {
      return { hostSlot: 0, guestSlot: 1 };
    }
    return null;
  }

  // Host must appear in some slot.
  const hostIn0 = nameMatches(p0, host, contains);
  const hostIn1 = nameMatches(p1, host, contains);
  if (!hostIn0 && !hostIn1) return null;

  if (!guest) {
    return { hostSlot: hostIn0 ? 0 : 1, guestSlot: hostIn0 ? 1 : 0 };
  }
  // Guest must be in the OTHER slot.
  if (hostIn0 && nameMatches(p1, guest, contains)) return { hostSlot: 0, guestSlot: 1 };
  if (hostIn1 && nameMatches(p0, guest, contains)) return { hostSlot: 1, guestSlot: 0 };
  return null;
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return String(ms);
  return `${d.toISOString()} (${d.toString().replace(/\s*\(.*\)$/, '')})`;
}

function fmtDelta(ms) {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 60) return `${ms < 0 ? '-' : '+'}${m}m`;
  const h = (abs / 3600000);
  return `${ms < 0 ? '-' : '+'}${h.toFixed(1)}h`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); process.exit(0); }
  if (!opts.host) {
    console.error('Error: --host (a player display name) is required.\n');
    console.error(HELP);
    process.exit(2);
  }

  let targetMs = null;
  if (opts.at) {
    const d = new Date(opts.at);
    if (Number.isNaN(d.getTime())) {
      console.error(`Error: could not parse --at "${opts.at}". Try "2026-06-13 18:43".`);
      process.exit(2);
    }
    targetMs = d.getTime();
  }

  if (!opts.json) console.error(`[find-room] connecting to ${PROD_CONFIG.databaseURL}`);
  firebase.initializeApp(PROD_CONFIG);
  const db = firebase.database();
  if (!opts.json) console.error('[find-room] reading /rooms …');
  const snap = await db.ref('rooms').get();
  const all = snap.val() || {};

  let matches = Object.entries(all)
    .filter(([, r]) => r && typeof r === 'object')
    .map(([roomId, r]) => {
      const m = roomNameMatch(r, opts);
      if (!m) return null;
      const createdAt = Number(r.createdAt ?? 0);
      return {
        roomId,
        createdAt,
        deltaMs: targetMs != null ? createdAt - targetMs : null,
        status: r.status ?? '?',
        mode: r.mode ?? '?',
        host: r.players?.[m.hostSlot]?.displayName ?? '?',
        guest: r.players?.[m.guestSlot]?.displayName ?? '?',
        hostSlot: m.hostSlot,
        guestSlot: m.guestSlot,
        scores: {
          host: Number(r.scores?.[m.hostSlot] ?? r.scores?.[String(m.hostSlot)] ?? 0),
          guest: Number(r.scores?.[m.guestSlot] ?? r.scores?.[String(m.guestSlot)] ?? 0),
        },
        moves: Array.isArray(r.moveHistory) ? r.moveHistory.length : 0,
      };
    })
    .filter(Boolean);

  // Optional hard time window.
  if (targetMs != null && Number.isFinite(opts.window)) {
    const w = opts.window * 60000;
    matches = matches.filter((x) => Math.abs(x.deltaMs) <= w);
  }

  // Sort: by closeness to --at if given, else newest first.
  matches.sort((a, b) => targetMs != null
    ? Math.abs(a.deltaMs) - Math.abs(b.deltaMs)
    : b.createdAt - a.createdAt);

  const shown = matches.slice(0, opts.limit);

  if (opts.json) {
    console.log(JSON.stringify(shown, null, 2));
    await firebase.app().delete();
    return;
  }

  console.error(`[find-room] ${matches.length} match(es)${matches.length > opts.limit ? `, showing ${opts.limit}` : ''}\n`);
  if (shown.length === 0) {
    console.log('No games found for those names. Check spelling (names are exact unless --contains), or widen with --contains.');
  } else {
    for (const x of shown) {
      const delta = x.deltaMs != null ? `  Δ${fmtDelta(x.deltaMs)}` : '';
      console.log(`roomId: ${x.roomId}${delta}`);
      console.log(`  when:   ${fmtTime(x.createdAt)}`);
      console.log(`  mode:   ${x.mode}    status: ${x.status}    moves: ${x.moves}`);
      console.log(`  host:   ${x.host} (slot ${x.hostSlot}) — ${x.scores.host}`);
      console.log(`  guest:  ${x.guest} (slot ${x.guestSlot}) — ${x.scores.guest}`);
      console.log('');
    }
    console.log(`Best match → ${shown[0].roomId}`);
  }

  await firebase.app().delete();
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[find-room] fatal', err);
  process.exit(1);
});
