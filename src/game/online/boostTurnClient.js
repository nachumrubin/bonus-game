// Client for the Boost 2.0 authoritative turn endpoints (worker/src/boostTurn.js).
//
// Online Boost 2.0 matches are never written by the app: every action is
// sent here and the Worker updates rooms/{roomId} (public projection) and
// boostV2Racks/{roomId}/{mySlot} (my rack). The app renders from those two
// subscriptions.
//
// Retries are safe: a request id is created once per action and reused on
// every retry, so the Worker returns the first answer instead of applying the
// action twice (network drop after commit, double tap, app resume).
//
//   const client = createBoostTurnClient({ baseUrl: config.pushWorkerUrl, getIdToken });
//   await client.createMatch({ roomId, mode, players, settings });
//   await client.submit(roomId, { type: CMD.CONFIRM_MOVE, payload: { placed, boostPlacements } }, { expectedVersion: room.version });
//   await client.plan(roomId, { placed });            // breakdown + replacement cards for a draft

export const BOOST_TURN_RETRYABLE = new Set(['busy', 'network', 'server-error']);

export function newRequestId(rand = Math.random) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += abc[Math.floor(rand() * abc.length)];
  return s;
}

export function createBoostTurnClient({
  baseUrl, getIdToken, fetchImpl = (...a) => fetch(...a), maxAttempts = 4,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)), makeRequestId = newRequestId,
} = {}) {
  if (!baseUrl) throw new Error('boostTurnClient: baseUrl is required');
  if (typeof getIdToken !== 'function') throw new Error('boostTurnClient: getIdToken is required');
  const root = String(baseUrl).replace(/\/+$/, '');

  async function post(path, body) {
    let last = { ok: false, reason: 'network' };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(250 * 2 ** (attempt - 1));
      let res;
      try {
        const token = await getIdToken();
        res = await fetchImpl(`${root}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      } catch {
        last = { ok: false, reason: 'network' };
        continue;
      }
      let data;
      try { data = await res.json(); } catch { data = { ok: false, reason: res.ok ? 'bad-response' : 'server-error' }; }
      if (res.status >= 500 || BOOST_TURN_RETRYABLE.has(data?.reason)) { last = data; continue; }
      return data;
    }
    return last;
  }

  return {
    createMatch({ roomId, mode, players, settings = {}, startingSlot = 0, leadInMs = 0, reqId = makeRequestId() }) {
      return post('/boost/create', { reqId, roomId, mode, players, settings, startingSlot, leadInMs });
    },
    // `expectedVersion` = the room.version the player was looking at; the
    // Worker refuses ('stale-version') if the match moved on meanwhile.
    submit(roomId, command, { expectedVersion, reqId = makeRequestId() } = {}) {
      return post('/boost/turn', { reqId, roomId, command: { ...command, ...(expectedVersion != null ? { expectedVersion } : {}) } });
    },
    claimTimeout(roomId, { expectedVersion, reqId = makeRequestId() } = {}) {
      return post('/boost/turn', { reqId, roomId, command: { type: 'cmd/CLAIM_TIMEOUT', ...(expectedVersion != null ? { expectedVersion } : {}) } });
    },
    plan(roomId, draft) {
      return post('/boost/plan', { roomId, draft });
    },
  };
}

// Firebase drops empty arrays / nulls. Normalise a Boost 2.0 public room for
// rendering. Returns null for any room that is not a worker-run BOOST_V2 room.
export function readBoostV2Room(room) {
  if (!room || room.ruleset !== 'BOOST_V2') return null;
  const arr = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
  const b = room.boostV2 ?? {};
  return {
    ...room,
    moveHistory: arr(room.moveHistory),
    boostV2: {
      ...b,
      activeBoosts: arr(b.activeBoosts),
      upcoming: arr(b.upcoming),
      openingSetup: b.openingSetup ? { ...b.openingSetup, order: arr(b.openingSetup.order), placements: arr(b.openingSetup.placements) } : null,
    },
  };
}

export function readMyRack(rackNode) {
  const t = rackNode?.tiles;
  return Array.isArray(t) ? t : (t && typeof t === 'object' ? Object.values(t) : []);
}
