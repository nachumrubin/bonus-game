// Online matchmaking orchestrator.
//
// Wires together matchmakingService + roomService + onlineGameSession so a
// pair of clients can find each other, share a Firebase room, and play a
// game through the new spine — all triggered by the user clicking
// "Random match" in the lobby.
//
// Per-client lifecycle:
//   1. joinQueue                     ← writes /matchmakingQueue/{mode}/{uid}
//   2. watch /users/{uid}/activeRoom ← roomService.createRoom sets it for both
//                                       slots; this is how the WAITER learns
//                                       it has been paired
//   3. watch /matchmakingQueue/{mode} ← whenever a new entry appears, try to
//                                       pair (the WINNER of the race creates
//                                       the room; the loser's tryPair is a
//                                       no-op because their entry is already
//                                       gone)
//   4. when activeRoom appears        ← read it, derive mySlot from
//                                       players[].uid, mount game
//   5. cancel()                       ← unsubscribes + leaves queue

import * as matchmakingService from './matchmakingService.js';
import * as roomService from './roomService.js';
import { PATH, STATUS } from './schema.js';
import { createInitialState } from '../core/gameEngine.js';

function findMySlot(room, myUid) {
  if (room?.players?.[0]?.uid === myUid) return 0;
  if (room?.players?.[1]?.uid === myUid) return 1;
  return null;
}

function randomStartingSlot() {
  return Math.random() < 0.5 ? 0 : 1;
}

// Build the room from a matched pair. Used as the createRoomFromPair callback
// passed to tryPair; also exported so tests can drive it directly.
export async function createRoomForPair({
  db,
  mine,
  theirs,
  mode,
  settings = {},
  serverTimestamp = Date.now(),
  startingSlot = randomStartingSlot(),
}) {
  const roomId = `mm_${serverTimestamp}_${Math.random().toString(36).slice(2, 8)}`;
  const players = {
    0: { uid: mine.uid,   displayName: mine.displayName ?? '?',   avatar: mine.avatar ?? null,   joinedAt: mine.joinedAt },
    1: { uid: theirs.uid, displayName: theirs.displayName ?? '?', avatar: theirs.avatar ?? null, joinedAt: theirs.joinedAt },
  };
  const engineState = createInitialState({
    mode, tileBagSeed: roomId, players, startingSlot, settings,
  });
  await roomService.createRoom(db, {
    roomId, mode, players, settings, engineState, serverTimestamp,
  });
  // Async games can start immediately. Live games stay WAITING until both
  // matched clients click through the coin screen; that ready handshake
  // starts the shared turn timer.
  if (mode?.endsWith('-async')) {
    await db.ref(`${PATH.rooms}/${roomId}`).update({ status: STATUS.PLAYING });
  }
  return { roomId, room: { roomId, mode, players } };
}

// Start a matchmaking session. Returns a controller with:
//   onMatched(fn)   — fn(room, mySlot) called when paired and ready to mount
//   cancel()        — leave the queue, drop subscriptions
//
// `now` defaults to Date.now() but is injectable for tests.
export function startMatchmaking({
  db, uid, mode = 'random-live', profile, settings = {},
  now = () => Date.now(),
}) {
  if (!db || !uid) throw new Error('startMatchmaking: db + uid required');

  const matchedListeners = new Set();
  let cancelled = false;
  let offActive = null;
  let offQueue = null;
  let resolved = false;

  // Phase 1 — join the queue
  matchmakingService.joinQueue(db, {
    uid, mode,
    profile: profile ?? { displayName: '?', avatar: null, rating: 1000 },
    settings,
    serverTimestamp: now(),
  }).catch(err => console.error('[spineMatchmaking.joinQueue]', err));

  // Phase 2 — listen for activeRoom assignment (waiter path)
  offActive = db.ref(`${PATH.users}/${uid}/activeRoom`).on('value', async (snap) => {
    if (cancelled || resolved) return;
    const roomId = snap?.val ? snap.val() : null;
    if (!roomId) return;
    const room = await roomService.readRoom(db, roomId);
    if (!room) return;
    if (cancelled || resolved) return;
    const mySlot = findMySlot(room, uid);
    if (mySlot == null) return; // not our room
    resolved = true;
    teardown();
    notify(room, mySlot);
  });

  // Phase 3 — listen for queue changes; whenever a new entry appears, try to pair
  offQueue = db.ref(`${PATH.matchmakingQueue}/${mode}`).on('value', async () => {
    if (cancelled || resolved) return;
    try {
      const result = await matchmakingService.tryPair(db, {
        uid, mode,
        createRoomFromPair: (mine, theirs) => createRoomForPair({
          db, mine, theirs, mode, settings, serverTimestamp: now(),
        }),
      });
      // If we created the room, our activeRoom listener will fire next.
      // Either way, no need to do anything else here.
      void result;
    } catch (err) {
      console.error('[spineMatchmaking.tryPair]', err);
    }
  });

  function teardown() {
    if (offActive) { try { offActive(); } catch {} offActive = null; }
    if (offQueue)  { try { offQueue();  } catch {} offQueue = null; }
  }

  function notify(room, mySlot) {
    for (const fn of matchedListeners) {
      try { fn({ room, mySlot }); } catch (err) { console.error('[spineMatchmaking.notify]', err); }
    }
  }

  function onMatched(fn) {
    matchedListeners.add(fn);
    return () => matchedListeners.delete(fn);
  }

  async function cancel() {
    if (cancelled) return;
    cancelled = true;
    teardown();
    try {
      await matchmakingService.leaveQueue(db, { uid, mode });
    } catch (err) {
      console.error('[spineMatchmaking.cancel]', err);
    }
  }

  return { onMatched, cancel };
}
