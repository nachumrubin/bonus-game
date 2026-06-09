// Async-session service.
//
// Reads the per-user index `users/{uid}/asyncRooms/{roomId}` (populated by
// roomService.createRoom for async-mode rooms), joins each entry with the
// real /rooms/{roomId} document, and returns an enriched view per session
// — including whose turn it is, lastUpdated, opponent name — for the
// lobby's online-sessions list and the menu's "you have N async games"
// badge.
//
// Stays out of the cutover plumbing: tests inject mockFirebase and the
// service has no DOM coupling.

import { PATH, STATUS } from './schema.js';
import * as roomService from './roomService.js';

function indexRef(db, uid) {
  return db.ref(`${PATH.users}/${uid}/${PATH.usersAsyncRooms}`);
}

// Active = waiting OR playing. Terminal statuses are filtered out.
function isActiveStatus(s) {
  return s === STATUS.WAITING || s === STATUS.PLAYING || s == null;
}

// Build a lobby-friendly view of one room from the perspective of `uid`.
// Returns null if the room doesn't exist, isn't ours, or is in a status the
// caller doesn't want to surface. By default only active (waiting/playing)
// statuses pass; pass `{ includeExpired: true }` to also surface expired
// rooms (used by the "my games" screen so users can see and dismiss them).
// Completed and abandoned rooms are always filtered out — those have their
// own end-game flow.
export function summarizeForUid(room, uid, opts = {}) {
  if (!room) return null;
  const status = room.status ?? STATUS.WAITING;
  const isActive = isActiveStatus(status);
  const isExpired = status === STATUS.EXPIRED;
  if (!isActive && !(opts.includeExpired && isExpired)) return null;
  const slot0 = room.players?.[0];
  const slot1 = room.players?.[1];
  let mySlot = null;
  if (slot0?.uid === uid) mySlot = 0;
  else if (slot1?.uid === uid) mySlot = 1;
  if (mySlot == null) return null; // not a participant
  const opponent = mySlot === 0 ? slot1 : slot0;
  const isMyTurn = isActive && (room.currentTurnSlot ?? 0) === mySlot;
  const myScore = Number(room.scores?.[mySlot] ?? 0);
  const opponentScore = Number(room.scores?.[1 - mySlot] ?? 0);
  return {
    roomId:       room.roomId,
    mode:         room.mode,
    status,
    isExpired,
    mySlot,
    opponentUid:  opponent?.uid ?? null,
    opponentName: opponent?.displayName ?? '?',
    opponentAvatar: opponent?.avatar ?? null,
    isMyTurn,
    myScore,
    opponentScore,
    turnNumber:   room.turnNumber ?? 1,
    lastUpdated:  room.updatedAt ?? room.createdAt ?? null,
    lastReminderAt: room.lastReminderAt ?? null,
    lastPokedAt:  room.lastPokedAt ?? null,
    createdAt:    room.createdAt ?? null,
  };
}

// List all active async sessions for `uid`. Sorted: my-turn first, then by
// lastUpdated descending. Pass `{ includeExpired: true }` to also include
// rooms with `status === expired` (placed at the end of the sort order so
// actionable games stay at the top).
export async function listAsyncSessions(db, uid, opts = {}) {
  if (!uid) return [];
  const snap = await indexRef(db, uid).get();
  const idx = snap?.val ? snap.val() : null;
  if (!idx) return [];
  const roomIds = Object.keys(idx);
  const rooms = await Promise.all(roomIds.map(rid => roomService.readRoom(db, rid)));
  const out = [];
  for (let i = 0; i < rooms.length; i++) {
    const summary = summarizeForUid(rooms[i], uid, opts);
    if (summary) out.push(summary);
  }
  out.sort((a, b) => {
    // Expired always last; my-turn before opponent-turn; newest first inside each bucket.
    if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;
    if (a.isMyTurn !== b.isMyTurn) return a.isMyTurn ? -1 : 1;
    return (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0);
  });
  return out;
}

// Subscribe to changes in the async-session list. Calls cb(sessions) on
// every index change. Returns an unsubscribe function.
//
// Note: this only re-fetches the room docs when the INDEX changes (room
// added/removed). Per-room turn changes don't trigger a refetch — callers
// who need that should also subscribe to roomService.watchRoom on each
// individual roomId.
export function watchAsyncSessions(db, uid, cb, opts = {}) {
  if (!uid) { cb([]); return () => {}; }
  const ref = indexRef(db, uid);
  let lastFire = 0;
  const handler = async () => {
    const fire = ++lastFire;
    const sessions = await listAsyncSessions(db, uid, opts);
    if (fire !== lastFire) return; // a newer fire is in flight
    cb(sessions);
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// Remove an async-session pointer from THIS user's index without touching
// the room or the other player's index. Used by the lobby ✗ button.
export async function dismissForUid(db, uid, roomId) {
  await db.ref(`${PATH.users}/${uid}/${PATH.usersAsyncRooms}/${roomId}`).remove();
}

// Hours-since-lastUpdated, for reminder/expiry decisions. Pure helper.
export function hoursSince(timestamp, now) {
  if (timestamp == null) return Infinity;
  return (now - timestamp) / (60 * 60 * 1000);
}
