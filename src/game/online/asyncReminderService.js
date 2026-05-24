// Async reminder + expiry service.
//
// The TODO calls for a Cloud Function to fire the 24h reminder push and
// the 7d expiry sweep. We don't have a Cloud Function project — instead
// this service does an opportunistic sweep whenever the app boots:
//   - Any room idle ≥ 24h with the OPPONENT to move → push KIND.REMINDER
//     to the opponent (idempotent via /rooms/{id}/lastReminderAt).
//   - Any room idle ≥ 7d with EITHER side to move → status=EXPIRED, push
//     KIND.EXPIRED to both, clear async index.
//
// "Idle" = `now - room.updatedAt`. If updatedAt is missing (older entries),
// we fall back to createdAt.
//
// `pushSender` is injected so tests can capture sends without a network.
// In production, main.js wires it to notificationService directly.

import { PATH, STATUS } from './schema.js';
import { hoursSince } from './asyncSessionService.js';
import * as roomService from './roomService.js';

const REMINDER_HOURS = 24;
const EXPIRY_HOURS   = 24 * 7;

function isAsyncMode(mode) {
  return mode?.endsWith('-async');
}

function isActiveStatus(s) {
  return s === STATUS.WAITING || s === STATUS.PLAYING || s == null;
}

// Inspect a single room and decide what action to take.
// Returns one of: { action: 'none' }, { action: 'remind', toUid }, { action: 'expire' }.
//
// Pure-ish: doesn't touch the db. Caller applies the action.
export function classify(room, { now = Date.now(), reminderHours = REMINDER_HOURS, expiryHours = EXPIRY_HOURS } = {}) {
  if (!room || !isAsyncMode(room.mode))     return { action: 'none' };
  if (!isActiveStatus(room.status))         return { action: 'none' };
  const last = room.updatedAt ?? room.createdAt;
  const hours = hoursSince(last, now);
  if (hours >= expiryHours) return { action: 'expire' };
  if (hours < reminderHours) return { action: 'none' };
  // It's been ≥ reminderHours but < expiryHours — remind the player whose
  // turn it currently is, but only once per idle window.
  const lastReminder = room.lastReminderAt;
  if (lastReminder && hoursSince(lastReminder, now) < reminderHours) {
    return { action: 'none' }; // already reminded this idle window
  }
  const slot = room.currentTurnSlot ?? 0;
  const toUid = room.players?.[slot]?.uid;
  if (!toUid) return { action: 'none' };
  return { action: 'remind', toUid, hoursIdle: Math.floor(hours) };
}

// Mark a room as reminded so we don't spam. Best-effort; failures don't
// block.
async function markReminded(db, roomId, now) {
  try { await db.ref(`${PATH.rooms}/${roomId}`).update({ lastReminderAt: now }); }
  catch (e) { console.warn('[asyncReminder.markReminded]', e); }
}

// Run the sweep for a single user. Reads their async index, classifies
// each room, and applies the action.
//
// `pushSender({ kind, toUids, ctx })` is the injected dispatcher. Pass
// notificationService.sendCustom or a thin wrapper that fans out to
// notification external ids.
//
// `now` and `roomReader` are injectable for tests.
export async function sweepForUser(db, uid, {
  now = Date.now(),
  pushSender = async () => {},
  reminderHours = REMINDER_HOURS,
  expiryHours = EXPIRY_HOURS,
} = {}) {
  if (!uid) return { reminded: 0, expired: 0 };

  const idxSnap = await db.ref(`${PATH.users}/${uid}/${PATH.usersAsyncRooms}`).get();
  const idx = idxSnap?.val ? idxSnap.val() : null;
  if (!idx) return { reminded: 0, expired: 0 };

  const roomIds = Object.keys(idx);
  const rooms = await Promise.all(roomIds.map(rid => roomService.readRoom(db, rid)));

  let reminded = 0, expired = 0;

  for (const room of rooms) {
    if (!room) continue;
    const decision = classify(room, { now, reminderHours, expiryHours });
    if (decision.action === 'remind') {
      try {
        await pushSender({
          kind: 'reminder',
          toUids: [decision.toUid],
          ctx: { roomId: room.roomId, hoursIdle: decision.hoursIdle },
        });
        await markReminded(db, room.roomId, now);
        reminded++;
      } catch (e) {
        console.warn('[asyncReminder.remind]', room.roomId, e);
      }
    } else if (decision.action === 'expire') {
      try {
        const uids = [room.players?.[0]?.uid, room.players?.[1]?.uid].filter(Boolean);
        await roomService.setStatus(db, room.roomId, STATUS.EXPIRED);
        await pushSender({
          kind: 'expired',
          toUids: uids,
          ctx: { roomId: room.roomId },
        });
        expired++;
      } catch (e) {
        console.warn('[asyncReminder.expire]', room.roomId, e);
      }
    }
  }

  return { reminded, expired };
}
