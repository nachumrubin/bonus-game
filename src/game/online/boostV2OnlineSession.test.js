// Boost 2.0 online session — mirror state, Worker dispatch, room → events.
//
// The "Worker" here is the real authoritative turn service (applyCommand)
// writing into an in-memory RTDB fake, so these tests exercise the same
// projections the live app reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBoostV2OnlineSession, HIDDEN_DEFINITION_ID, boostV2FromPublic } from './boostV2OnlineSession.js';
import { createMatch, applyCommand, deserializeState, BOOST_CMD, TIMEOUT_GRACE_MS } from '../boostV2/authoritativeTurn.js';
import { computeV2Draft } from '../boostV2/draftPreview.js';
import { legalOpeningSquares } from '../boostV2/engineV2.js';
import { PHASE } from '../boostV2/matchStateV2.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { createRng } from '../../util/rng.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

const PLAYERS = { 0: { uid: 'alice', displayName: 'A' }, 1: { uid: 'bob', displayName: 'B' } };
const T0 = 1_800_000_000_000;
const json = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

// ── in-memory RTDB (compat API subset: ref().on/off/get) ───────────────────
function fakeDb() {
  const data = new Map();
  const listeners = new Map();
  const snap = (path) => ({ val: () => json(data.get(path) ?? null) });
  return {
    set(path, value) {
      data.set(path, json(value));
      for (const fn of listeners.get(path) ?? []) fn(snap(path));
    },
    peek: (path) => json(data.get(path) ?? null),
    ref(path) {
      return {
        on(_ev, fn) { if (!listeners.has(path)) listeners.set(path, new Set()); listeners.get(path).add(fn); fn(snap(path)); },
        off(_ev, fn) { listeners.get(path)?.delete(fn); },
        async get() { return snap(path); },
      };
    },
  };
}

// ── fake Worker: real applyCommand, writes rack(s) then room (configurable) ─
function fakeServer({ mode = 'friend-async', settings = {}, roomFirst = false } = {}) {
  const db = fakeDb();
  const created = createMatch({ roomId: 'r1', mode, players: PLAYERS, settings, now: T0, rng: createRng('server') });
  let secret = json(created.secret);
  let clock = T0 + 1000;
  let n = 0;
  const holdRacks = { on: false, queued: [] };
  function publish(room, racks) {
    const writeRacks = () => { for (const s of [0, 1]) db.set(`boostV2Racks/r1/${s}`, racks[s]); };
    if (roomFirst) { db.set('rooms/r1', room); if (holdRacks.on) holdRacks.queued.push(writeRacks); else writeRacks(); }
    else { writeRacks(); db.set('rooms/r1', room); }
  }
  publish(created.room, created.racks);
  const calls = [];
  function run(uid, command) {
    const reqId = `q${++n}`;
    const r = applyCommand({ secret, uid, reqId, command, now: clock, isWordValid: () => true, rng: createRng(reqId) });
    if (r.secret) { secret = json(r.secret); publish(r.room, r.racks); }
    return r.ok ? { ok: true, version: r.version } : { ok: false, reason: r.reason, detail: r.detail };
  }
  const clientFor = (uid) => ({
    submit: async (roomId, command, opts) => { calls.push({ uid, command, opts }); return run(uid, command); },
    claimTimeout: async () => { calls.push({ uid, command: { type: BOOST_CMD.CLAIM_TIMEOUT } }); return run(uid, { type: BOOST_CMD.CLAIM_TIMEOUT }); },
  });
  return {
    db, calls, holdRacks, clientFor,
    state: () => deserializeState(secret.stateJson),
    setClock: (t) => { clock = t; },
    releaseRacks: () => { holdRacks.on = false; for (const w of holdRacks.queued.splice(0)) w(); },
  };
}

function createBus() {
  const subs = new Map();
  return {
    on(t, fn) { if (!subs.has(t)) subs.set(t, new Set()); subs.get(t).add(fn); return () => subs.get(t).delete(fn); },
    emit(t, p) { for (const fn of subs.get(t) ?? []) fn(p); },
  };
}

function fakeTimers() {
  let id = 0;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => { pending.set(++id, { fn, ms }); return id; },
    clearTimer: (h) => pending.delete(h),
    pending,
    async fireAll() { const list = [...pending.entries()]; pending.clear(); for (const [, t] of list) await t.fn(); },
  };
}

function join(server, slot, extra = {}) {
  const bus = createBus();
  const events = [];
  for (const k of Object.values(EV)) bus.on(k, (p) => events.push({ type: k, p }));
  const timers = fakeTimers();
  const session = createBoostV2OnlineSession({
    bus, db: server.db, room: server.db.peek('rooms/r1'), mySlot: slot, client: server.clientFor(PLAYERS[slot].uid),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, ...extra,
  });
  session.start();
  return { session, bus, events, timers, of: (type) => events.filter(e => e.type === type) };
}

const sessionOf = (a, b) => (a.session.state.currentTurnSlot === a.session.mySlot ? a : b);

async function playOpening(a, b) {
  const mover = sessionOf(a, b);
  const rack = mover.session.state.racks[mover.session.mySlot].filter(l => l !== '?');
  await mover.session.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 4, c: 4, letter: rack[0] }, { r: 4, c: 5, letter: rack[1] }] } });
  return mover;
}
// The first round is one turn each; the opening setup starts after it.
async function playFirstRound(a, b) {
  const mover = await playOpening(a, b);
  await sessionOf(a, b).session.dispatch({ type: CMD.PASS_TURN });
  return mover;
}
async function playSetup(a, b) {
  let guard = 0;
  while (a.session.state.boostV2.phase === PHASE.OPENING_SETUP && guard++ < 6) {
    const mover = sessionOf(a, b);
    const legal = legalOpeningSquares(mover.session.state);
    await mover.session.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: legal[0] });
  }
}

test('mirror state: my rack only, placeholder opponent rack and bag, hidden queue cards', () => {
  const server = fakeServer();
  const a = join(server, 0);
  const st = a.session.state;
  const truth = server.state();
  assert.equal(st.ruleset, 'BOOST_V2');
  assert.deepEqual(st.racks[0], truth.racks[0]);
  assert.equal(st.racks[1].length, truth.racks[1].length);
  assert.ok(st.racks[1].every(t => t === null), 'opponent rack is never known');
  assert.equal(st.bag.length, truth.bag.length);
  assert.ok(st.bag.every(t => t === null));
  const q = st.boostV2.queue.entries;
  assert.equal(q.length, truth.boostV2.queue.entries.length);
  assert.deepEqual(q.slice(0, 2).map(e => e.instanceId), truth.boostV2.queue.entries.slice(0, 2).map(e => e.instanceId));
  assert.ok(q.slice(2).every(e => e.definitionId === HIDDEN_DEFINITION_ID && e.instanceId === null));
  assert.ok(st.boostV2.definitions[HIDDEN_DEFINITION_ID].hidden);
  const text = JSON.stringify({ ...st, board: null });
  for (const e of truth.boostV2.queue.entries.slice(2)) assert.ok(!text.includes(e.instanceId), 'no hidden instance ids');
});

test('opening move: mover gets MOVE_CONFIRMED, the other OPPONENT_MOVED with breakdown; boards agree', async () => {
  const server = fakeServer();
  const a = join(server, 0);
  const b = join(server, 1);
  const mover = await playOpening(a, b);
  const other = mover === a ? b : a;
  assert.equal(mover.of(EV.MOVE_CONFIRMED).length, 1);
  assert.equal(other.of(EV.OPPONENT_MOVED).length, 1);
  const om = other.of(EV.OPPONENT_MOVED)[0].p;
  assert.ok(om.breakdown, 'breakdown travels with the opponent move');
  assert.equal(om.placed.length, 2);
  assert.equal(om.score, om.breakdown.totalScore);
  assert.ok(other.of(EV.TURN_CHANGED).length >= 1);
  assert.deepEqual(a.session.state.board, b.session.state.board);
  assert.deepEqual(a.session.state.scores, server.state().scores);
  assert.equal(a.session.state.boostV2.phase, PHASE.FIRST_ROUND);
  await sessionOf(a, b).session.dispatch({ type: CMD.PASS_TURN });
  assert.equal(a.session.state.boostV2.phase, PHASE.OPENING_SETUP);
  assert.equal(b.session.state.boostV2.openingSetup.effective.length, 3);
  assert.ok(!b.session.state.boostV2.definitions[b.session.state.boostV2.openingSetup.effective[0].definitionId].hidden, 'the card to place now is shown');
  assert.deepEqual(a.session.state.racks[0], server.state().racks[0], 'my rack refilled');
});

test('opening setup: BOOST_PLACED per step, then three active Boosts with definitions', async () => {
  const server = fakeServer();
  const a = join(server, 0);
  const b = join(server, 1);
  await playFirstRound(a, b);
  await playSetup(a, b);
  assert.equal(a.session.state.boostV2.phase, PHASE.NORMAL);
  assert.equal(a.session.state.boostV2.activeBoosts.length, 3);
  for (const ab of a.session.state.boostV2.activeBoosts) assert.ok(a.session.state.boostV2.definitions[ab.definitionId], 'active Boosts are revealed');
  assert.equal(b.of(EV.BOOST_PLACED).length, 3);
  assert.ok(a.of(EV.BOOSTS_CHANGED).length >= 3);
});

test('client-side draft on the mirror: consuming a Boost asks for hidden replacements; server accepts placements without ids', async () => {
  const server = fakeServer();
  const a = join(server, 0);
  const b = join(server, 1);
  await playFirstRound(a, b);
  await playSetup(a, b);
  const mover = sessionOf(a, b);
  const st = mover.session.state;
  const rack = st.racks[mover.session.mySlot].filter(l => l !== '?');
  // A straight line from an existing tile to the nearest active Boost in its row or column.
  let placed = null;
  for (const bst of st.boostV2.activeBoosts) {
    for (let r = 0; r < 10 && !placed; r++) for (let c = 0; c < 10 && !placed; c++) {
      if (!st.board[r][c] || (r !== bst.r && c !== bst.c)) continue;
      const cells = [];
      const dr = Math.sign(bst.r - r), dc = Math.sign(bst.c - c);
      for (let rr = r + dr, cc = c + dc; ; rr += dr, cc += dc) {
        if (!st.board[rr][cc]) cells.push({ r: rr, c: cc });
        if (rr === bst.r && cc === bst.c) break;
      }
      if (cells.length <= rack.length) placed = cells.map((p, i) => ({ ...p, letter: rack[i] }));
    }
    if (placed) break;
  }
  assert.ok(placed, "fixed seeds: a straight line to an active Boost exists")
  const d = computeV2Draft(st, { placed });
  assert.ok(d.ok, d.reason);
  assert.ok(d.required >= 1);
  const visibleLeft = st.boostV2.queue.entries.filter(e => e.definitionId !== HIDDEN_DEFINITION_ID).length;
  if (d.required > visibleLeft) assert.ok(d.replacements.some(rp => rp.definition?.hidden), 'later replacements are hidden cards');
  const boostPlacements = d.legal.slice(0, d.required).map((sq, i) => ({ ...sq, instanceId: d.replacements[i]?.instanceId ?? null }));
  await mover.session.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed, boostPlacements } });
  const sent = server.calls.at(-1).command.payload.boostPlacements;
  assert.ok(sent.every(p => p.instanceId == null || typeof p.instanceId === 'string'));
  assert.equal(mover.of(EV.INVALID_MOVE_REJECTED).length, 0, JSON.stringify(mover.of(EV.INVALID_MOVE_REJECTED)));
  assert.equal(a.session.state.boostV2.activeBoosts.length, 3, 'replacements revealed on the board');
});

test('a rejected command emits INVALID_MOVE_REJECTED and changes nothing', async () => {
  const server = fakeServer();
  const a = join(server, 0);
  const b = join(server, 1);
  const waiting = sessionOf(a, b) === a ? b : a;
  const v = waiting.session.state.version;
  await waiting.session.dispatch({ type: CMD.PASS_TURN });
  assert.equal(waiting.of(EV.INVALID_MOVE_REJECTED)[0].p.reason, 'not-your-turn');
  assert.equal(waiting.session.state.version, v);
});

test('exchange: both sides see TILES_EXCHANGED with the count; the turn passes', async () => {
  const server = fakeServer();
  const a = join(server, 0);
  const b = join(server, 1);
  await playFirstRound(a, b);
  await playSetup(a, b);
  const mover = sessionOf(a, b);
  const other = mover === a ? b : a;
  const letters = mover.session.state.racks[mover.session.mySlot].slice(0, 2);
  await mover.session.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters } });
  assert.equal(other.of(EV.TILES_EXCHANGED).at(-1).p.count, 2);
  assert.equal(mover.of(EV.TILES_EXCHANGED).at(-1).p.slot, mover.session.mySlot);
  assert.equal(other.session.state.currentTurnSlot, other.session.mySlot);
});

test('room update waits for the matching rack (no new board with a stale rack); falls back after a timeout', async () => {
  const server = fakeServer({ roomFirst: true });
  const a = join(server, 0);
  const b = join(server, 1);
  server.holdRacks.on = true;
  const mover = await playOpening(a, b);
  assert.equal(mover.of(EV.MOVE_CONFIRMED).length, 0, 'room held until the rack arrives');
  server.releaseRacks();
  assert.equal(mover.of(EV.MOVE_CONFIRMED).length, 1);
  assert.deepEqual(mover.session.state.racks[mover.session.mySlot], server.state().racks[mover.session.mySlot]);
  // Fallback: rack never arrives → applied after the wait timer.
  server.holdRacks.on = true;
  const passer = sessionOf(a, b);
  const before = a.of(EV.TURN_CHANGED).length;
  await passer.session.dispatch({ type: CMD.PASS_TURN });
  assert.equal(a.of(EV.TURN_CHANGED).length, before, 'held while the rack is missing');
  await a.timers.fireAll();
  assert.equal(a.of(EV.TURN_CHANGED).length, before + 1, 'applied after the wait');
  assert.equal(a.session.state.boostV2.phase, PHASE.OPENING_SETUP);
  server.releaseRacks();
});

test('live game: READY via the Worker; the waiting player claims an expired turn after deadline + grace', async () => {
  const server = fakeServer({ mode: 'friend-live', settings: { timelimit: true, turnSeconds: 60 } });
  let now = T0 + 1000;
  const a = join(server, 0, { now: () => now });
  const b = join(server, 1, { now: () => now });
  await a.session.markReady();
  await b.session.markReady();
  const deadline = a.session.state.turnDeadlineMs;
  assert.equal(deadline, T0 + 1000 + 60_000);
  const waiting = sessionOf(a, b) === a ? b : a;
  const timer = [...waiting.timers.pending.values()].find(t => t.ms > 0);
  assert.ok(timer, 'claim scheduled');
  assert.equal(timer.ms, deadline + TIMEOUT_GRACE_MS - now);
  assert.equal([...sessionOf(a, b).timers.pending.values()].filter(t => t.ms > 1500).length, 0, 'the player to move never claims');
  now = deadline + TIMEOUT_GRACE_MS + 1;
  server.setClock(now);
  await waiting.timers.fireAll();
  assert.equal(server.calls.at(-1).command.type, BOOST_CMD.CLAIM_TIMEOUT);
  assert.equal(waiting.session.state.currentTurnSlot, waiting.session.mySlot, 'turn passed to the claimer');
  assert.equal(waiting.of(EV.TURN_CHANGED).at(-1).p.reason, 'timeout');
});

test('resign: GAME_COMPLETED on both sides; the resigner loses; listeners detach on dispose', async () => {
  const server = fakeServer();
  const a = join(server, 0);
  const b = join(server, 1);
  await a.session.dispatch({ type: CMD.RESIGN_GAME });
  for (const s of [a, b]) {
    const done = s.of(EV.GAME_COMPLETED);
    assert.equal(done.length, 1);
    assert.equal(done[0].p.winnerSlot, 1);
  }
  b.session.dispose();
  const count = b.events.length;
  server.db.set('rooms/r1', { ...server.db.peek('rooms/r1'), version: 999 });
  assert.equal(b.events.length, count, 'no events after dispose');
});

test('boostV2FromPublic tolerates RTDB object-shaped arrays and an empty view', () => {
  const v = boostV2FromPublic({});
  assert.deepEqual(v.activeBoosts, []);
  assert.deepEqual(v.queue.entries, []);
  const w = boostV2FromPublic({ activeBoosts: { 0: { r: '1', c: '2', instanceId: 'i', definitionId: 'd', definition: { definitionId: 'd' } } }, remainingInQueue: 3, upcoming: {} });
  assert.equal(w.activeBoosts[0].r, 1);
  assert.equal(w.queue.entries.length, 3);
  assert.ok(w.definitions.d);
});
