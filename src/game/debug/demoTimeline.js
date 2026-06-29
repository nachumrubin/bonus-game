// Game Debug Timeline — a hand-authored DEMO game (pure, deterministic).
//
// Produces a getGameDebugTimeline()-shaped object for a fully scripted 6-turn
// online game between נחום רובין (host, slot 0) and הודיה (guest, slot 1). It is
// NOT recorded from real play — it's a fixed fixture so you can:
//   1. SEE what the recorder/replayer looks like without a live Firebase game —
//      `window.__spine.debug.openDemoReplay()` (or the capture spec).
//   2. GUARD the replayer against regressions — demoTimeline.test.js asserts the
//      frames this builds (counts, the divergence frame, the bonus strip).
//
// The script deliberately exercises every replay feature:
//   • board growth across turns (crossing Hebrew words),
//   • two boost squares hit → BOOST_ACTIVATED mini-game events (anagram +100,
//     wheel → extra turn), with tiles dropped on the squares + used markers,
//   • a real divergence on turn 5 — the host advances but the guest's client
//     lags one move (server vs guest boards differ) before catching up,
//   • a duplicate boost event (both clients log it) to prove de-duping,
//   • per-player event attribution (`slot`) so the replay's three per-source
//     step lists each show what THAT side recorded.
//
// Pure: no DOM, no Firebase, no clocks. Identical output every call.

const HOST = { displayName: 'נחום רובין', uid: 'u-host' };
const GUEST = { displayName: 'הודיה', uid: 'u-guest' };
const PLAYERS = { 0: HOST, 1: GUEST };
const APP = '20260628';

// Fixed boost-square assignment (12 perimeter slots). Slot 0 (top) and slot 5
// (right) are the two squares hit during the game.
const ASSIGNMENT = [
  { type: 'B11', pts: 0,   ic: '⚡' }, // 0 — מילה נסתרת, hit on turn 3
  { type: 'B2',  pts: 40,  ic: '⚡' }, // 1
  { type: 'B1',  pts: 100, ic: '⚡' }, // 2
  { type: 'B9',  pts: 25,  ic: '⚡' }, // 3
  { type: 'B12', pts: 50,  ic: '⚡' }, // 4
  { type: 'B13', pts: 0,   ic: '🎡' }, // 5 — גלגל המזל, hit on turn 5
  { type: 'B3',  pts: 40,  ic: '⚡' }, // 6
  { type: 'B10', pts: 40,  ic: '⚡' }, // 7
  { type: 'B4',  pts: 1,   ic: '⚡' }, // 8
  { type: 'B14', pts: 50,  ic: '⚡' }, // 9
  { type: 'B8',  pts: 0,   ic: '⚡' }, // 10
  { type: 'B5',  pts: 0,   ic: '⚡' }, // 11
];

const flat = (occ) => {
  const f = new Array(100).fill(null);
  for (const [i, l] of Object.entries(occ)) f[i] = { letter: l, val: 1 };
  return f;
};

// Cumulative board after each turn (flat index = row*10 + col).
const B0 = {};
const B1 = { ...B0, 43: 'ש', 44: 'ל', 45: 'ו', 46: 'ם' };           // T1 host: שלום
const B2 = { ...B1, 54: 'פ', 64: 'י', 74: 'ד' };                    // T2 guest: crosses ל
const B3 = { ...B2, 65: 'ו', 66: 'ם' };                             // T3 host: יום + boost
const B4 = { ...B3, 84: 'ר', 94: 'ך' };                             // T4 guest: דרך
const B5 = { ...B4, 55: 'נ', 56: 'ה' };                             // T5 host: + boost
const B6 = { ...B5, 33: 'ב', 53: 'ג' };                             // T6 guest

const USED_T3 = { 0: true };
const USED_T5 = { 0: true, 5: true };
const DROP_T3 = { '-1,1': { letter: 'ק', val: 5 } };                 // tile on top boost square
const DROP_T5 = { '-1,1': { letter: 'ק', val: 5 }, '5,10': { letter: 'א', val: 1 } };

function snap(t, version, board, host, guest, turnNumber, extra = {}) {
  return {
    serverTimestamp: t, version, believedVersion: version, appVersion: APP,
    board: flat(board),
    compact: { hostScore: host, guestScore: guest, turnNumber, status: extra.status ?? 'playing' },
    players: PLAYERS,
    bonusAssignment: ASSIGNMENT,
    bonusBoard: extra.bonusBoard ?? null,
    bonusSqUsed: extra.bonusSqUsed ?? null,
  };
}

// Each event carries the `slot` of the client that recorded it (the recorder
// stamps ctx.mySlot), so the replay can split events into per-player timelines:
// a move appears under the player who made it, a turn change under both.
function evt(t, type, payload, summary, slot) {
  return { serverTimestamp: t, clientTimestamp: t, type, payload, summary, slot };
}

/**
 * @returns {{ events, snapshots, clientSnapshots: {0:any[],1:any[]}, warnings, reports, index }}
 */
export function buildDemoTimeline() {
  // Server-authoritative stream (one snapshot per committed version).
  const snapshots = [
    snap(1000, 1, B1, 18, 0, 1),
    snap(2000, 2, B2, 18, 16, 2),
    snap(3000, 3, B3, 130, 16, 3, { bonusBoard: DROP_T3, bonusSqUsed: USED_T3 }),
    snap(4000, 4, B4, 130, 40, 4, { bonusBoard: DROP_T3, bonusSqUsed: USED_T3 }),
    snap(5000, 5, B5, 152, 40, 5, { bonusBoard: DROP_T5, bonusSqUsed: USED_T5 }),
    snap(6000, 6, B6, 152, 58, 6, { bonusBoard: DROP_T5, bonusSqUsed: USED_T5 }),
  ];

  // Host's local view — keeps pace with the server.
  const p0 = [
    snap(1000, 1, B1, 18, 0, 1),
    snap(2000, 2, B2, 18, 16, 2),
    snap(3000, 3, B3, 130, 16, 3, { bonusBoard: DROP_T3, bonusSqUsed: USED_T3 }),
    snap(4000, 4, B4, 130, 40, 4, { bonusBoard: DROP_T3, bonusSqUsed: USED_T3 }),
    snap(5000, 5, B5, 152, 40, 5, { bonusBoard: DROP_T5, bonusSqUsed: USED_T5 }),
    snap(6000, 6, B6, 152, 58, 6, { bonusBoard: DROP_T5, bonusSqUsed: USED_T5 }),
  ];

  // Guest's local view — LAGS for ~1.5s: it never snapshots in second 5 (its
  // latest is still the turn-4 board), so seconds 5 AND 6 diverge from the
  // server. It catches up to v5 at 6.5s and v6 at 7s, clearing in second 7.
  const p1 = [
    snap(1000, 1, B1, 18, 0, 1),
    snap(2000, 2, B2, 18, 16, 2),
    snap(3000, 3, B3, 130, 16, 3, { bonusBoard: DROP_T3, bonusSqUsed: USED_T3 }),
    snap(4000, 4, B4, 130, 40, 4, { bonusBoard: DROP_T3, bonusSqUsed: USED_T3 }),
    snap(6500, 5, B5, 152, 40, 5, { bonusBoard: DROP_T5, bonusSqUsed: USED_T5 }),
    snap(7000, 6, B6, 152, 58, 6, { bonusBoard: DROP_T5, bonusSqUsed: USED_T5 }),
  ];

  // Append-only event log, as the recorder would write it. A move is logged by
  // the acting client (one slot); turn changes + game start are logged by both.
  const events = [];
  const push = (t, type, payload, summary, slots) => {
    for (const s of slots) events.push(evt(t, type, payload, summary, s));
  };
  push(500, 'GAME_STARTED', {}, 'Game started', [0, 1]);

  push(1000, 'WORD_ACCEPTED', { words: ['שלום'], score: 18 }, 'נחום רובין played שלום for 18 points', [0]);
  push(1001, 'TURN_CHANGED', { currentTurnSlot: 1, turnNumber: 2 }, 'Turn → הודיה (turn 2)', [0, 1]);

  push(2000, 'WORD_ACCEPTED', { words: ['לפיד'], score: 16 }, 'הודיה played לפיד for 16 points', [1]);
  push(2001, 'TURN_CHANGED', { currentTurnSlot: 0, turnNumber: 3 }, 'Turn → נחום רובין (turn 3)', [0, 1]);

  push(3000, 'WORD_ACCEPTED', { words: ['יום'], score: 12 }, 'נחום רובין played יום for 12 points', [0]);
  // Boost square hit → anagram mini-game, +100. Logged by both clients at the
  // same instant (deduped to one within the frame).
  push(3000, 'BOOST_ACTIVATED', { slot: 0, boostId: 'auto_extra_score', bonusIdx: 0, extra: 100 }, 'Boost auto_extra_score → +100', [0, 1]);
  push(3002, 'TURN_CHANGED', { currentTurnSlot: 1, turnNumber: 4 }, 'Turn → הודיה (turn 4)', [0, 1]);

  push(4000, 'WORD_ACCEPTED', { words: ['דרך'], score: 24 }, 'הודיה played דרך for 24 points', [1]);
  push(4001, 'TURN_CHANGED', { currentTurnSlot: 0, turnNumber: 5 }, 'Turn → נחום רובין (turn 5)', [0, 1]);

  push(5000, 'WORD_ACCEPTED', { words: ['נה'], score: 22 }, 'נחום רובין played נה for 22 points', [0]);
  // Boost square hit → wheel → extra turn (no points).
  push(5000, 'BOOST_ACTIVATED', { slot: 0, boostId: 'extra_turn', bonusIdx: 5, extra: 0 }, 'Boost extra_turn → תור נוסף', [0, 1]);
  push(5002, 'TURN_CHANGED', { currentTurnSlot: 1, turnNumber: 6 }, 'Turn → הודיה (turn 6)', [0, 1]);

  push(6000, 'WORD_ACCEPTED', { words: ['בג'], score: 18 }, 'הודיה played בג for 18 points', [1]);

  // One validator warning, to mirror a real timeline's shape (replay ignores it;
  // the admin Debug tab renders it).
  const warnings = [
    { warningId: 'w1', serverTimestamp: 3000, version: 3, type: 'SCORE_JUMP', severity: 'info',
      message: 'host +112 on turn 3 (word 12 + boost 100)' },
  ];

  return {
    events,
    snapshots,
    clientSnapshots: { 0: p0, 1: p1 },
    warnings,
    reports: [],
    index: {
      gameId: 'demo_game', hostName: HOST.displayName, guestName: GUEST.displayName,
      hostUid: HOST.uid, guestUid: GUEST.uid, status: 'playing', mode: 'friend-live',
      appVersion: APP, createdAt: 0,
    },
  };
}

export const DEMO_GAME_ID = 'demo_game';
