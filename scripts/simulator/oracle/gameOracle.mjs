// gameOracle.mjs — judges one live game while two agents play it.
//
// Watches the room from a passive observer connection (rooms are
// world-readable) and checks, continuously and at the end:
//
//   per commit   existing invariants.mjs (schema, version monotonic, tile
//                conservation, turn bounds, liveBonus gate, missedTurns,
//                passCount, terminal shape) + move-entry checks below
//   agreement    at quiescence, agent A's state, agent B's state and the
//                server room must agree (hashState + exact field checks)
//   liveness     the room version must keep moving while 'playing'
//   end of game  both clients reach the server's terminal status and saw
//                GAME_COMPLETED; no agent/handler errors; no phantom
//                disconnect overlays
//
// Violations are { class, detail, at } — the soak runner turns them into
// deduplicated failure bundles.

import { checkInvariants } from '../invariants.mjs';
import { engineStateFromRoom } from '../../../src/game/online/roomService.js';
import { hashState, compactSnapshot, boardCellsString } from '../../../src/game/debug/stateHash.js';
import { RACK_SIZE } from '../../../src/game/core/tileBag.js';
import { BINGO_BONUS } from '../../../src/game/core/scoringEngine.js';

const SNAPSHOT_CAP = 400;
const AGREE_SETTLE_MS = 1500;
const AGREE_RETRIES = 8; // ≈7.5 s — tolerates simulated mobile-latency spikes (net/latency.mjs)
const AGREE_RETRY_MS = 750;
const MULTIPLIERS = [1, 2, 4, 8, 16];

function isTerminal(status) {
  return status === 'completed' || status === 'abandoned' || status === 'expired';
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map(k => v[k]);
  return [];
}

/**
 * Pure per-entry checks on a room's moveHistory. Exported for unit tests.
 * @param {object[]} history
 * @param {(w: string) => boolean} isWordValid
 */
export function checkMoveEntries(history, isWordValid, { fromIndex = 0 } = {}) {
  const out = [];
  history.forEach((m, i) => {
    if (i < fromIndex || !m || !Array.isArray(m.tiles) || m.tiles.length === 0) return;
    const words = asArray(m.words);
    for (const w of words) {
      if (!isWordValid(String(w))) out.push({ class: 'move-invalid-word', detail: `move#${i} slot=${m.slot} word=${w}` });
    }
    const wordTiles = asArray(m.wordTiles);
    if (wordTiles.length && !m.scoringDeferred) {
      let raw = 0;
      for (const wt of wordTiles) for (const t of asArray(wt)) raw += Number(t?.val) || 0;
      if (m.tiles.length === RACK_SIZE) raw += BINGO_BONUS;
      const base = Number(m.baseScore ?? m.score);
      if (!MULTIPLIERS.some(k => raw * k === base)) {
        out.push({ class: 'move-base-score-mismatch', detail: `move#${i} slot=${m.slot} words=${words.join(',')} recomputed=${raw} stored-base=${base}` });
      }
      if (m.bonusExtra != null && Number(m.score) !== base + Number(m.bonusExtra)) {
        out.push({ class: 'move-total-mismatch', detail: `move#${i} score=${m.score} base=${base} extra=${m.bonusExtra}` });
      }
    }
  });
  return out;
}

/**
 * Compare agent states with the server room. Returns a list of mismatching
 * field names (empty = agree). Exported for unit tests.
 */
export function diffAgainstServer(agentState, room, mySlot) {
  const server = engineStateFromRoom(room);
  const a = compactSnapshot(agentState);
  const s = compactSnapshot(server);
  const diffs = [];
  for (const f of ['status', 'currentTurnSlot', 'turnNumber', 'hostScore', 'guestScore', 'hostTilesCount', 'guestTilesCount', 'boardHash', 'tileBagCount']) {
    if (a[f] !== s[f]) diffs.push(`${f}: agent=${a[f]} server=${s[f]}`);
  }
  const myRack = [...(agentState.racks?.[mySlot] ?? [])].sort().join('');
  const srvRack = [...(server.racks?.[mySlot] ?? [])].sort().join('');
  if (myRack !== srvRack) diffs.push(`ownRack: agent=${myRack} server=${srvRack}`);
  const lockKey = (locks) => [...(locks ?? [])].map(l => `${l.r},${l.c}:${l.remainingTurns}`).sort().join('|');
  if (lockKey(agentState.lockedCells) !== lockKey(server.lockedCells)) diffs.push(`lockedCells: agent=${lockKey(agentState.lockedCells)} server=${lockKey(server.lockedCells)}`);
  const usedKey = (u) => Object.entries(u ?? {}).filter(([, v]) => v).map(([k]) => k).sort().join(',');
  if (usedKey(agentState.bonusSqUsed) !== usedKey(server.bonusSqUsed)) diffs.push(`bonusSqUsed: agent=${usedKey(agentState.bonusSqUsed)} server=${usedKey(server.bonusSqUsed)}`);
  return { diffs, hashAgent: hashState(a), hashServer: hashState(s) };
}

/**
 * @param {object} o
 * @param {object} o.observerDb   compat db (unauthenticated is fine)
 * @param {string} o.roomId
 * @param {object[]} o.agents     gameAgent instances
 * @param {(w:string)=>boolean} o.isWordValid
 * @param {() => number} o.now
 * @param {number} o.turnLimitMs  0 for untimed
 * @param {number} [o.maxGameMs]
 */
export function createGameOracle({ observerDb, roomId, agents, isWordValid, now, turnLimitMs, maxGameMs = 40 * 60_000 }) {
  const violations = [];
  const snapshots = [];
  let prev = null;
  let latest = null;
  let lastVersionChangeAt = now();
  let checkedHistoryLen = 0;
  let agreeTimer = null;
  let livenessTimer = null;
  let stopped = false;
  const startedAt = now();
  const stuckThresholdMs = turnLimitMs > 0 ? turnLimitMs + 80_000 : 150_000;
  const counters = { commits: 0, agreeChecks: 0, agreeOk: 0 };

  let resolveTerminal;
  const terminal = new Promise((r) => { resolveTerminal = r; });

  function flag(klass, detail, extra = {}) {
    violations.push({ class: klass, detail, at: now(), version: latest?.version ?? null, ...extra });
  }

  const ref = observerDb.ref(`rooms/${roomId}`);
  const handler = (snap) => {
    const room = snap?.val ? snap.val() : null;
    if (!room || stopped) return;
    const versionChanged = !latest || Number(room.version) !== Number(latest.version);
    latest = room;
    if (versionChanged) {
      counters.commits++;
      lastVersionChangeAt = now();
      snapshots.push({ t: now(), room });
      if (snapshots.length > SNAPSHOT_CAP) snapshots.splice(1, 1); // keep the first
      for (const v of checkInvariants(prev, room, {})) flag(`invariant-${v.class}`, v.detail);
      const hist = asArray(room.moveHistory);
      // Re-check the last entry too: a deferred move is finalized in place.
      const from = Math.max(0, checkedHistoryLen - 1);
      for (const v of checkMoveEntries(hist, isWordValid, { fromIndex: from })) {
        if (!violations.some(x => x.class === v.class && x.detail === v.detail)) flag(v.class, v.detail);
      }
      checkedHistoryLen = hist.length;
      prev = room;
      scheduleAgreement();
    }
    if (isTerminal(room.status)) resolveTerminal(room);
  };
  ref.on('value', handler);

  function scheduleAgreement() {
    if (agreeTimer) clearTimeout(agreeTimer);
    agreeTimer = setTimeout(() => checkAgreement(0, 0), AGREE_SETTLE_MS);
  }

  // `attempt` counts mismatch retries; `waited` counts busy waits. They are
  // separate budgets so a long think (with previews in flight) cannot burn
  // the mismatch retries. Busy waits are capped at ~90 s (a mini-game).
  function checkAgreement(attempt, waited) {
    agreeTimer = null;
    if (stopped || !latest) return;
    const ready = agents.every(a => a.session);
    if (!ready) return;
    // Not quiescent: a commit is in flight or a bonus flow is open. Wait.
    if (agents.some(a => a.busy) && waited < 120) {
      agreeTimer = setTimeout(() => checkAgreement(attempt, waited + 1), AGREE_RETRY_MS);
      return;
    }
    const versionAtCheck = latest.version;
    counters.agreeChecks++;
    const results = agents.map(a => ({ a, ...diffAgainstServer(a.session.state, latest, a.mySlot) }));
    const bad = results.filter(r => r.diffs.length);
    if (!bad.length) { counters.agreeOk++; return; }
    if (attempt < AGREE_RETRIES || latest.version !== versionAtCheck) {
      agreeTimer = setTimeout(() => checkAgreement(attempt + 1, waited), AGREE_RETRY_MS);
      return;
    }
    for (const r of bad) {
      const field = r.diffs[0].split(':')[0];
      flag(`desync-${field}`, `agent ${r.a.name} (slot ${r.a.mySlot}) v${versionAtCheck}: ${r.diffs.join('; ')}`, {
        agentBoard: boardCellsString(r.a.session.state.board, r.a.session.state.bonusBoard),
      });
    }
  }

  livenessTimer = setInterval(() => {
    if (stopped || !latest) return;
    if (latest.status === 'playing' && now() - lastVersionChangeAt > stuckThresholdMs) {
      flag('stuck-turn', `no version change for ${Math.round((now() - lastVersionChangeAt) / 1000)}s (v${latest.version}, turn slot ${latest.currentTurnSlot}, liveBonus=${!!latest.liveBonus?.active})`);
      lastVersionChangeAt = now(); // report once per stall window
      resolveTerminal(null);
    }
    if (now() - startedAt > maxGameMs) {
      flag('game-too-long', `game exceeded ${Math.round(maxGameMs / 60000)} min (status=${latest.status}, v${latest.version})`);
      resolveTerminal(null);
    }
  }, 2000);

  /** Wait for the server to reach a terminal status (or liveness failure). */
  function waitForEnd() { return terminal; }

  /** End-of-game checks; call after both agents report done (or timeout). */
  async function finalize() {
    const room = latest;
    if (room && isTerminal(room.status)) {
      for (const a of agents) {
        const st = a.session?.state?.status;
        if (st !== room.status) flag('end-status-mismatch', `agent ${a.name} status=${st} server=${room.status}`);
        if (!a.bus.log.some(e => e.type === 'evt/GAME_COMPLETED')) flag('end-no-game-completed', `agent ${a.name} never saw GAME_COMPLETED (server=${room.status})`);
      }
      // A final agreement pass on the terminal position.
      for (const a of agents) {
        if (!a.session) continue;
        const { diffs } = diffAgainstServer(a.session.state, room, a.mySlot);
        // A game-ending pass/exchange is never committed (finishGame writes
        // status only), so post-game turn counters and lock timers can differ
        // by that last turn. Known + accepted (see online-passcount-sync
        // test); scores, board, racks and bag must still agree.
        const meaningful = diffs.filter(d => !/^(currentTurnSlot|turnNumber|lockedCells)/.test(d));
        if (meaningful.length) flag(`end-desync-${meaningful[0].split(':')[0]}`, `agent ${a.name}: ${meaningful.join('; ')}`);
      }
    }
    for (const a of agents) {
      const errs = a.bus.log.filter(e => e.type === 'agent/error' || e.type === 'sim/handler-error');
      for (const e of errs.slice(0, 3)) flag('agent-error', `agent ${a.name}: ${e.p?.message ?? ''}`, { stack: e.p?.stack ?? null });
      if (a.stats.disconnectOpens > 0 && !a.stats.socketDrops) {
        flag('phantom-disconnect-overlay', `agent ${a.name} saw ${a.stats.disconnectOpens} DISCONNECT_OPEN with no simulated drop`);
      }
    }
    // Bonus cross-check: every bonus the server CREDITED must match an outcome
    // the player actually earned (mini-game result, award card, wheel points).
    // Earned-but-never-credited is fine: the move may have legitimately lost a
    // commit race and been rolled back. Credited-but-never-earned (or a wrong
    // amount) is a bug. Skipped when the opponent's banked veto fired.
    if (room) {
      const hist = asArray(room.moveHistory);
      for (const a of agents) {
        if (a.stats.bonus.vetoed) continue;
        const earned = [];
        for (const x of a.chosenExtras) {
          if (x.kind === 'wheel') { if (/^pts_/.test(x.outcomeId ?? '')) earned.push(Number(x.outcomeId.slice(4))); }
          else if (Number(x.extra) > 0) earned.push(Number(x.extra));
        }
        const credited = hist.filter(m => m?.slot === a.mySlot && Number(m.bonusExtra) > 0);
        for (const m of credited) {
          const i = earned.indexOf(Number(m.bonusExtra));
          if (i >= 0) { earned.splice(i, 1); continue; }
          flag('bonus-credited-not-earned', `agent ${a.name} slot ${a.mySlot}: server credited bonusExtra=${m.bonusExtra} (${m.boost?.bonusType ?? '?'}) with no matching earned outcome; earned left=[${earned.join(',')}]`);
        }
      }
    }
    return { violations, counters, finalRoom: room };
  }

  function stop() {
    stopped = true;
    try { ref.off('value', handler); } catch { /* swallow */ }
    if (agreeTimer) clearTimeout(agreeTimer);
    if (livenessTimer) clearInterval(livenessTimer);
  }

  return { violations, snapshots, counters, waitForEnd, finalize, stop, get latest() { return latest; } };
}
