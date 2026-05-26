// Server-side async-game reminder + expiry sweep.
//
// Mirrors `src/game/online/asyncReminderService.js` from the app, but runs
// inside a Cloudflare Worker scheduled handler so the sweep doesn't depend
// on a player opening the browser. Resolves GAP_REPORT item 4.
//
// The browser sweep is left in place as belt-and-suspenders. Both write
// `lastReminderAt` after reminding and `status: 'expired'` after expiring,
// so whichever runs first wins and the other becomes a no-op.

import { rtdbGet, rtdbPatch } from './firebaseRtdb.js';
import { buildPushBody, KIND } from './pushPayloadBuilder.js';

// ── Constants must match src/game/online/asyncReminderService.js ──────
const REMINDER_HOURS = 24;
const EXPIRY_HOURS   = 24 * 7;
const ACTIVE_STATUSES = new Set(['waiting', 'playing']);

function isAsyncMode(mode) {
  return typeof mode === 'string' && mode.endsWith('-async');
}

function hoursSince(ts, now) {
  if (ts == null) return Infinity;
  return (now - ts) / (60 * 60 * 1000);
}

// Pure decision function — kept identical in shape to asyncReminderService.classify
// so the server-side and client-side sweeps cannot diverge silently.
export function classify(room, { now = Date.now(), reminderHours = REMINDER_HOURS, expiryHours = EXPIRY_HOURS } = {}) {
  if (!room || !isAsyncMode(room.mode))                  return { action: 'none' };
  if (!(ACTIVE_STATUSES.has(room.status) || room.status == null)) return { action: 'none' };
  const last = room.updatedAt ?? room.createdAt;
  const hours = hoursSince(last, now);
  if (hours >= expiryHours) return { action: 'expire' };
  if (hours < reminderHours) return { action: 'none' };
  const lastReminder = room.lastReminderAt;
  if (lastReminder && hoursSince(lastReminder, now) < reminderHours) {
    return { action: 'none' };
  }
  const slot = room.currentTurnSlot ?? 0;
  const toUid = room.players?.[slot]?.uid;
  if (!toUid) return { action: 'none' };
  return { action: 'remind', toUid, hoursIdle: Math.floor(hours) };
}

async function sendPushDirect(env, body) {
  const r = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + env.ONESIGNAL_REST_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`OneSignal send failed: ${r.status} ${txt}`);
  }
}

// Pull every active async room and run the sweep. Returns a summary.
//
// Scanning approach: GET /rooms (full read). For a free-tier-sized app this
// is fine. If room count grows past ~10k, swap to a maintained index at
// `/asyncActiveRooms/{roomId}: true` updated on room create/complete.
export async function runCronSweep(env, { now = Date.now() } = {}) {
  if (!env.ONESIGNAL_APP_ID) throw new Error('ONESIGNAL_APP_ID not set');
  if (!env.ONESIGNAL_REST_KEY) throw new Error('ONESIGNAL_REST_KEY not set');

  const rooms = await rtdbGet(env, 'rooms');
  if (!rooms || typeof rooms !== 'object') {
    return { scanned: 0, reminded: 0, expired: 0, errors: 0 };
  }

  let scanned = 0, reminded = 0, expired = 0, errors = 0;

  for (const [roomId, room] of Object.entries(rooms)) {
    if (!room || typeof room !== 'object') continue;
    if (!isAsyncMode(room.mode)) continue; // cheap skip before scanned++
    scanned++;
    const decision = classify(room, { now });

    if (decision.action === 'remind') {
      try {
        await sendPushDirect(env, buildPushBody({
          appId: env.ONESIGNAL_APP_ID,
          kind: KIND.REMINDER,
          externalIds: [decision.toUid],
          ctx: { roomId, hoursIdle: decision.hoursIdle },
        }));
        await rtdbPatch(env, `rooms/${roomId}`, { lastReminderAt: now });
        reminded++;
      } catch (e) {
        console.warn('[cronSweep.remind]', roomId, e?.message ?? e);
        errors++;
      }
    } else if (decision.action === 'expire') {
      try {
        const uids = [room.players?.[0]?.uid, room.players?.[1]?.uid].filter(Boolean);
        await rtdbPatch(env, `rooms/${roomId}`, { status: 'expired', updatedAt: now });
        if (uids.length) {
          await sendPushDirect(env, buildPushBody({
            appId: env.ONESIGNAL_APP_ID,
            kind: KIND.EXPIRED,
            externalIds: uids,
            ctx: { roomId },
          }));
        }
        expired++;
      } catch (e) {
        console.warn('[cronSweep.expire]', roomId, e?.message ?? e);
        errors++;
      }
    }
  }

  return { scanned, reminded, expired, errors };
}
