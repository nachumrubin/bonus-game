// Boost 2.0 — authoritative (Worker) turn service tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMatch, applyCommand, planDraft, deserializeState, BOOST_CMD, TIMEOUT_GRACE_MS } from './authoritativeTurn.js';
import { CMD } from '../../events/commands.js';
import { createRng } from '../../util/rng.js';
import { checkBoostV2Invariants, PHASE } from './matchStateV2.js';
import { planForMove, legalOpeningSquares } from './engineV2.js';

const _log = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _log; });

const PLAYERS = { 0: { uid: 'alice', displayName: 'A' }, 1: { uid: 'bob', displayName: 'B' } };
const ANY_WORD = () => true;
const T0 = 1_800_000_000_000;

// Store the secret the way RTDB would (JSON round trip) between commands.
const store = (doc) => JSON.parse(JSON.stringify(doc));

function newMatch({ mode = 'friend-async', settings = {} } = {}) {
  const created = createMatch({ roomId: 'room1', mode, players: PLAYERS, settings, now: T0, rng: createRng('server') });
  return { ...created, secret: store(created.secret) };
}
const stateOf = (secret) => deserializeState(secret.stateJson);
let reqN = 0;
const req = () => `req-${String(++reqN).padStart(6, '0')}`;

function apply(m, uid, command, now = T0 + 1000, reqId = req()) {
  const r = applyCommand({ secret: m.secret, uid, reqId, command, now, isWordValid: ANY_WORD, rng: createRng(reqId) });
  if (r.secret) { m.secret = store(r.secret); m.room = r.room; m.racks = r.racks; }
  return r;
}

// Opening move for whoever is to play: two rack tiles across the centre.
function openingMove(m) {
  const st = stateOf(m.secret);
  const rack = st.racks[st.currentTurnSlot].filter(l => l !== '?');
  return { type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 4, c: 4, letter: rack[0] }, { r: 4, c: 5, letter: rack[1] }] } };
}
const uidOf = (m) => PLAYERS[stateOf(m.secret).currentTurnSlot].uid;

function assertNoLeak(room, secret) {
  const json = JSON.stringify(room);
  const st = stateOf(secret);
  for (const k of ['tileBagSeed', '"bag"', '"racks"', '"queue"', 'stateJson']) assert.ok(!json.includes(k), `room leaks ${k}`);
  const visible = new Set([
    ...st.boostV2.activeBoosts.map(b => b.instanceId),
    ...room.boostV2.upcoming.map(u => u.instanceId),
    ...(st.boostV2.openingSetup?.placements ?? []).map(p => p.instanceId),
    ...(room.boostV2.openingSetup?.current ? [room.boostV2.openingSetup.current.instanceId] : []),
    ...st.boostV2.consumedInstanceIds,
  ]);
  for (const e of st.boostV2.queue.entries) {
    if (!visible.has(e.instanceId)) assert.ok(!json.includes(`"${e.instanceId}"`), `hidden card ${e.instanceId} leaked`);
  }
}

test('createMatch: secret holds everything; the public room holds no bag, racks, seed or hidden queue', () => {
  const m = newMatch();
  const st = stateOf(m.secret);
  assert.equal(st.ruleset, 'BOOST_V2');
  assert.equal(st.boostV2.queue.entries.length, 95);
  assert.equal(m.room.ruleset, 'BOOST_V2');
  assert.equal(m.room.authority, 'worker');
  assert.equal(m.room.bagCount, st.bag.length);
  assert.deepEqual(m.room.rackCounts, { 0: 8, 1: 8 });
  assert.equal(m.room.boostV2.upcoming.length, 2);
  assert.deepEqual(m.racks[0].tiles, st.racks[0]);
  assert.equal(m.room.turnDeadlineMs, null, 'async: no shared timer');
  assertNoLeak(m.room, m.secret);
  const live = newMatch({ mode: 'friend-live', settings: { timelimit: true, turnSeconds: 60 } });
  assert.equal(live.room.turnDeadlineMs, T0 + 60_000);
});

test('identity and turn order come from the token, not the payload', () => {
  const m = newMatch();
  assert.equal(apply(m, 'mallory', openingMove(m)).reason, 'not-a-player');
  assert.equal(apply(m, 'bob', openingMove(m)).reason, 'not-your-turn');
  assert.equal(apply(m, 'alice', { type: 'cmd/SET_SCORE', payload: {} }).reason, 'unknown-command');
  assert.equal(apply(m, 'alice', { ...openingMove(m), expectedVersion: 99 }).reason, 'stale-version');
  const r = apply(m, 'alice', { ...openingMove(m), expectedVersion: 1 });
  assert.ok(r.ok, r.reason);
  assert.equal(r.version, 2);
  assert.equal(m.room.version, 2);
  assert.equal(m.room.currentTurnSlot, 1);
  assertNoLeak(m.room, m.secret);
});

test('client-supplied tile values and pass reasons are ignored', () => {
  const m = newMatch();
  const mv = openingMove(m);
  mv.payload.placed = mv.payload.placed.map(p => ({ ...p, val: 999 }));
  const r = apply(m, 'alice', mv);
  assert.ok(r.result.breakdown.baseScore < 30);
  // Bob tries to pass "as a timeout" — it is recorded as a plain pass.
  const p = apply(m, 'bob', { type: CMD.PASS_TURN, payload: { reason: 'timeout' } });
  assert.ok(p.ok);
  assert.equal(stateOf(m.secret).boostV2.phase, PHASE.OPENING_SETUP, 'round 1 over → setup');
  assert.equal(stateOf(m.secret).boostV2.openingSetup.placements.length, 0, 'not treated as a timeout auto-place');
});

test('duplicate request id: same answer, nothing written twice', () => {
  const m = newMatch();
  const mv = openingMove(m);
  const first = apply(m, 'alice', mv, T0 + 1000, 'dup-request-01');
  assert.ok(first.ok);
  const before = m.secret;
  const again = applyCommand({ secret: m.secret, uid: 'alice', reqId: 'dup-request-01', command: mv, now: T0 + 2000, isWordValid: ANY_WORD, rng: createRng('x') });
  assert.equal(again.replay, true);
  assert.deepEqual(again.result, first.result);
  assert.equal(again.secret, undefined);
  assert.equal(m.secret, before);
});

test('a rejected command writes nothing and reports the reason', () => {
  const m = newMatch();
  const r = apply(m, 'alice', { type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 0, c: 0, letter: 'א' }, { r: 0, c: 1, letter: 'ב' }] } });
  assert.equal(r.ok, false);
  assert.ok(['opening-not-center', 'placed-not-in-rack'].includes(r.reason));
  assert.equal(r.secret, undefined);
});

test('timeout claims: only the opponent, only after deadline + grace; two misses forfeit (with deductions)', () => {
  const m = newMatch({ mode: 'friend-live', settings: { timelimit: true, turnSeconds: 60 } });
  const deadline = m.room.turnDeadlineMs;
  assert.equal(apply(m, 'bob', { type: BOOST_CMD.CLAIM_TIMEOUT }, deadline).reason, 'turn-not-expired');
  assert.equal(apply(m, 'alice', { type: BOOST_CMD.CLAIM_TIMEOUT }, deadline + 5000).reason, 'not-opponent');
  const t1 = deadline + TIMEOUT_GRACE_MS;
  assert.ok(apply(m, 'bob', { type: BOOST_CMD.CLAIM_TIMEOUT }, t1).ok);
  assert.deepEqual(m.room.missedTurns, { 0: 1, 1: 0 });
  assert.equal(m.room.currentTurnSlot, 1);
  assert.equal(m.room.turnDeadlineMs, t1 + 60_000);
  // Bob's opening word ends round 1 → opening setup, Bob places first.
  assert.ok(apply(m, 'bob', openingMove(m), t1 + 1000).ok);
  assert.equal(m.room.boostV2.phase, PHASE.OPENING_SETUP);
  const legal = legalOpeningSquares(stateOf(m.secret));
  assert.ok(apply(m, 'bob', { type: CMD.PLACE_OPENING_BOOST, payload: legal[0] }, t1 + 2000).ok);
  assert.equal(m.room.currentTurnSlot, 0, "Alice's setup step");
  // Alice misses her setup step too → second consecutive miss → forfeit.
  const d2 = m.room.turnDeadlineMs;
  assert.equal(d2, t1 + 2000 + 60_000, 'every accepted step restarts the clock');
  const r = apply(m, 'bob', { type: BOOST_CMD.CLAIM_TIMEOUT }, d2 + TIMEOUT_GRACE_MS);
  assert.ok(r.ok, r.reason);
  assert.equal(m.room.status, 'abandoned');
  assert.equal(m.room.abandonedBy, 0);
  assert.equal(m.room.abandonReason, 'missed-turns');
  assert.equal(m.room.winnerSlot, 1);
  assert.ok(m.room.endgame, 'rack deductions recorded');
  assert.equal(m.room.turnDeadlineMs, 0);
  assert.equal(apply(m, 'bob', openingMove(m)).reason, 'game-over');
});

test('resign is allowed on either turn; the resigner loses', () => {
  const m = newMatch();
  const r = apply(m, 'bob', { type: CMD.RESIGN_GAME, payload: { slot: 0 } });
  assert.ok(r.ok);
  assert.equal(m.room.abandonedBy, 1, 'payload slot ignored — the caller resigns');
  assert.equal(m.room.winnerSlot, 0);
});

test('planDraft: breakdown + replacement cards for a valid draft, nothing for an invalid one', () => {
  const m = newMatch();
  apply(m, 'alice', openingMove(m));
  apply(m, 'bob', { type: CMD.PASS_TURN });
  // Opening setup: bob, alice, bob place next to the opening word.
  for (const [uid, r, c] of [['bob', 3, 4], ['alice', 5, 4], ['bob', 3, 5]]) {
    assert.ok(apply(m, uid, { type: CMD.PLACE_OPENING_BOOST, payload: { r, c } }).ok);
  }
  assert.equal(m.room.boostV2.phase, PHASE.NORMAL);
  assert.equal(m.room.boostV2.activeBoosts.length, 3);
  const st = stateOf(m.secret);
  const letter = st.racks[0].find(l => l !== '?');
  // Draft covering the Boost at (5,4) (under the opening word's first tile).
  const draft = { placed: [{ r: 5, c: 4, letter }] };
  const plan = planDraft({ secret: m.secret, uid: 'alice', draft, isWordValid: ANY_WORD, rng: createRng('p') });
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.breakdown.consumedBoostIds.length, 1);
  assert.equal(plan.replacements.length, 1);
  assert.equal(plan.replacements[0].instanceId, st.boostV2.queue.entries[3].instanceId);
  assert.ok(plan.replacements[0].definition.family);
  assert.ok(plan.legalSquares.length > 0);
  assert.equal(stateOf(m.secret).boostV2.revision, st.boostV2.revision, 'planning never changes the match');
  assert.equal(planDraft({ secret: m.secret, uid: 'bob', draft, isWordValid: ANY_WORD, rng: createRng('p') }).reason, 'not-your-turn');
  const bad = planDraft({ secret: m.secret, uid: 'alice', draft: { placed: [{ r: 9, c: 9, letter }] }, isWordValid: ANY_WORD, rng: createRng('p') });
  assert.equal(bad.ok, false);
  assert.equal(bad.replacements, undefined);
  // Submitting the planned move with a legal replacement square commits it.
  const sq = plan.legalSquares[0];
  const done = apply(m, 'alice', { type: CMD.CONFIRM_MOVE, payload: { ...draft, boostPlacements: [sq] } });
  assert.ok(done.ok, done.reason);
  assert.equal(done.result.boostPlacements.length, 1);
  assertNoLeak(m.room, m.secret);
});

test('a full match driven only through applyCommand keeps every invariant and never leaks', () => {
  const m = newMatch();
  const rng = createRng('driver');
  let guard = 0;
  while (m.room.status === 'playing' && guard++ < 400) {
    const st = stateOf(m.secret);
    const uid = PLAYERS[st.currentTurnSlot].uid;
    const v2 = st.boostV2;
    let r;
    if (v2.phase === PHASE.OPENING_SETUP) {
      const legal = legalOpeningSquares(st);
      r = apply(m, uid, { type: CMD.PLACE_OPENING_BOOST, payload: legal[Math.floor(rng() * legal.length)] });
    } else if (st.firstMove) {
      r = apply(m, uid, openingMove(m));
    } else {
      // Extend right/below an existing tile with one rack letter.
      const rack = st.racks[st.currentTurnSlot].filter(l => l !== '?');
      let cmd = null;
      for (let rr = 0; rr < 10 && !cmd; rr++) for (let cc = 0; cc < 10 && !cmd; cc++) {
        if (st.board[rr][cc] || !rack.length) continue;
        const adj = [[rr - 1, cc], [rr + 1, cc], [rr, cc - 1], [rr, cc + 1]].some(([a, b]) => st.board[a]?.[b]);
        if (!adj) continue;
        const placed = [{ r: rr, c: cc, letter: rack[0] }];
        const consumed = v2.activeBoosts.filter(b => b.r === rr && b.c === cc).map(b => b.instanceId);
        const { plan } = planForMove(st, placed, consumed);
        cmd = { type: CMD.CONFIRM_MOVE, payload: { placed, boostPlacements: plan.arrangement } };
      }
      r = cmd ? apply(m, uid, cmd) : null;
      if (!r?.ok) r = st.bag.length ? apply(m, uid, { type: CMD.EXCHANGE_TILE, payload: { letters: [st.racks[st.currentTurnSlot][0]] } }) : apply(m, uid, { type: CMD.PASS_TURN });
    }
    assert.ok(r.ok, `${r.reason} at step ${guard}`);
    const after = stateOf(m.secret);
    assert.deepEqual(checkBoostV2Invariants(after, v2), []);
    assertNoLeak(m.room, m.secret);
    assert.deepEqual(m.racks[0].tiles, after.racks[0]);
  }
  assert.notEqual(m.room.status, 'playing', 'match finished');
  assert.ok(m.room.endgame);
});
