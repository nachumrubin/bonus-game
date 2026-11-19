// Boost 2.0 online — end to end on the RTDB emulator with production rules.
//
// The Worker's own handlers (createBoostMatch / runBoostTurn) run in-process
// against the emulator through a REST adapter that bypasses rules (as the
// Worker's service account does). Two app sessions (boostV2OnlineSession)
// subscribe with ordinary user credentials, so every read they make is
// checked by firebase.database.rules.json: a session that tried to read the
// opponent's rack or the secret would fail here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestEnv, makeUserApp, adminRead, assertFails } from './setup.mjs';
import { createBoostMatch, runBoostTurn } from '../../worker/src/boostTurn.js';
import { createBoostV2OnlineSession } from '../../src/game/online/boostV2OnlineSession.js';
import { legalOpeningSquares } from '../../src/game/boostV2/engineV2.js';
import { PHASE } from '../../src/game/boostV2/matchStateV2.js';
import { CMD } from '../../src/events/commands.js';
import { EV } from '../../src/events/eventTypes.js';
import { createRng } from '../../src/util/rng.js';

const A = 'v2o-alice';
const B = 'v2o-bob';
const ROOM = 'v2online01';
const PLAYERS = { 0: { uid: A, displayName: 'A' }, 1: { uid: B, displayName: 'B' } };

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const NS = 'demo-bonus-game'; // rules-unit-testing uses the project id as the namespace

// Rules-bypassing REST adapter with the Worker's db interface.
const url = (path) => `http://${HOST}/${path}.json?ns=${NS}`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const workerDb = {
  async get(_env, path) { return (await fetch(url(path), { headers: H })).json(); },
  async getWithEtag(_env, path) {
    const r = await fetch(url(path), { headers: { ...H, 'X-Firebase-ETag': 'true' } });
    return { value: await r.json(), etag: r.headers.get('ETag') };
  },
  async putIfMatch(_env, path, data, etag) {
    const r = await fetch(url(path), { method: 'PUT', headers: { ...H, 'if-match': etag }, body: JSON.stringify(data) });
    if (r.status === 412) return { ok: false, conflict: true };
    if (!r.ok) throw new Error(`PUT ${path} ${r.status}`);
    return { ok: true };
  },
  async put(_env, path, data) { return (await fetch(url(path), { method: 'PUT', headers: H, body: JSON.stringify(data) })).json(); },
  async patch(_env, path, data) { return (await fetch(url(path), { method: 'PATCH', headers: H, body: JSON.stringify(data) })).json(); },
};

let reqN = 0;
function clientFor(uid) {
  const run = (command) => runBoostTurn({}, uid, { roomId: ROOM, reqId: `emu-${uid}-${++reqN}`, command }, { db: workerDb, validator: () => true, rng: createRng(`r${reqN}`) });
  return { submit: (_roomId, command) => run(command), claimTimeout: () => run({ type: 'cmd/CLAIM_TIMEOUT' }) };
}

function makeBus() {
  const subs = new Map();
  const log = [];
  return {
    log,
    on(t, fn) { if (!subs.has(t)) subs.set(t, new Set()); subs.get(t).add(fn); return () => subs.get(t).delete(fn); },
    emit(t, p) { log.push({ type: t, p }); for (const fn of subs.get(t) ?? []) fn(p); },
  };
}

async function waitFor(cond, what, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

test('boost v2 online: two rule-checked sessions play the opening, setup and an exchange through the Worker', async () => {
  await withTestEnv(async (env) => {
    const created = await createBoostMatch({}, A, { roomId: ROOM, mode: 'friend-async', players: PLAYERS, startingSlot: 0 }, { db: workerDb, rng: createRng('emu-server') });
    assert.ok(created.ok, created.reason);

    const alice = makeUserApp(env, A);
    const bob = makeUserApp(env, B);
    // Rules: the session reads only what its user may read.
    await assertFails(alice.ref(`boostV2Racks/${ROOM}/1`).get());
    await assertFails(alice.ref(`boostV2Secret/${ROOM}`).get());

    const room0 = (await alice.ref(`rooms/${ROOM}`).get()).val();
    const sides = [[alice, 0, A], [bob, 1, B]].map(([app, slot, uid]) => {
      const bus = makeBus();
      const session = createBoostV2OnlineSession({ bus, db: app.db, room: room0, mySlot: slot, client: clientFor(uid) });
      session.start();
      return { bus, session, slot };
    });
    const [sa, sb] = sides;
    try {
      await waitFor(() => sa.session.state.racks[0].length === 8 && sb.session.state.racks[1].length === 8, 'racks');
      assert.ok(sa.session.state.racks[1].every(t => t === null), 'alice never sees bob\'s tiles');

      // Opening move (alice), then bob passes → opening setup.
      const rack = sa.session.state.racks[0].filter(l => l !== '?');
      await sa.session.dispatch({ type: CMD.CONFIRM_MOVE, payload: { placed: [{ r: 4, c: 4, letter: rack[0] }, { r: 4, c: 5, letter: rack[1] }] } });
      await waitFor(() => sb.bus.log.some(e => e.type === EV.OPPONENT_MOVED), 'bob sees the move');
      const om = sb.bus.log.find(e => e.type === EV.OPPONENT_MOVED).p;
      assert.ok(om.breakdown);
      assert.equal(sb.session.state.board[4][4]?.letter ?? sb.session.state.board[4][4], sa.session.state.board[4][4]?.letter ?? sa.session.state.board[4][4]);
      await waitFor(() => sb.session.state.currentTurnSlot === 1, 'bob\'s turn');
      await sb.session.dispatch({ type: CMD.PASS_TURN });
      await waitFor(() => sa.session.state.boostV2.phase === PHASE.OPENING_SETUP && sb.session.state.boostV2.phase === PHASE.OPENING_SETUP, 'setup on both');

      for (let i = 0; i < 6 && sa.session.state.boostV2.phase === PHASE.OPENING_SETUP; i++) {
        const mover = sides.find(s => s.session.state.currentTurnSlot === s.slot);
        const v = mover.session.state.version;
        await mover.session.dispatch({ type: CMD.PLACE_OPENING_BOOST, payload: legalOpeningSquares(mover.session.state)[0] });
        await waitFor(() => sa.session.state.version > v && sb.session.state.version > v, 'setup step');
      }
      assert.equal(sa.session.state.boostV2.phase, PHASE.NORMAL);
      assert.equal(sb.session.state.boostV2.activeBoosts.length, 3);
      assert.deepEqual(sa.session.state.boostV2.activeBoosts, sb.session.state.boostV2.activeBoosts);

      // Exchange two tiles: both see TILES_EXCHANGED; the bag size is unchanged.
      const mover = sides.find(s => s.session.state.currentTurnSlot === s.slot);
      const other = mover === sa ? sb : sa;
      const bag = other.session.state.bag.length;
      await mover.session.dispatch({ type: CMD.EXCHANGE_TILE, payload: { letters: mover.session.state.racks[mover.slot].slice(0, 2) } });
      await waitFor(() => other.bus.log.some(e => e.type === EV.TILES_EXCHANGED), 'exchange seen');
      assert.equal(other.session.state.bag.length, bag);

      // Racks the sessions show match the authoritative secret.
      const secret = await adminRead(env, `boostV2Secret/${ROOM}`);
      const truth = JSON.parse(secret.stateJson);
      await waitFor(() => JSON.stringify(sa.session.state.racks[0]) === JSON.stringify(truth.racks[0]), 'alice rack in sync');
      assert.deepEqual(sb.session.state.racks[1], truth.racks[1]);
      assert.deepEqual(sa.session.state.scores, truth.scores);

      // Bob resigns: both complete, alice wins.
      await sb.session.dispatch({ type: CMD.RESIGN_GAME });
      await waitFor(() => sides.every(s => s.bus.log.some(e => e.type === EV.GAME_COMPLETED)), 'game completed');
      for (const s of sides) assert.equal(s.bus.log.find(e => e.type === EV.GAME_COMPLETED).p.winnerSlot, 0);
      assert.equal(sides.flatMap(s => s.bus.log).filter(e => e.type === EV.INVALID_MOVE_REJECTED).length, 0);
    } finally {
      for (const s of sides) s.session.dispose();
    }
  });
});
