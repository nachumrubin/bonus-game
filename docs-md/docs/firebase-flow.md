# firebase-flow.md — Firebase Architecture and Data Flow

> Source evidence: `src/game/online/firebaseClient.js`, `roomService.js`, `inviteService.js`, `matchmakingService.js`, `asyncSessionService.js`, `presenceService.js`, `roomCodeService.js`, `timeoutWatchdog.js`, `sessionPersistence.js`, `schema.js`, `firebase.json`, `firebase.database.rules.json`

---

## Firebase Services Used

- **Firebase Realtime Database** — game state, rooms, presence, invites, matchmaking, user data
- **Firebase Authentication** — anonymous + email/password + Google (Unknown / needs verification — auth providers not fully traced; only `firebase.auth()` usage confirmed)
- **Firebase Hosting** — static PWA hosting

Firebase SDK version: compat v10.13.0 (loaded from CDN at runtime).

---

## SDK Initialization

Source: `src/game/online/firebaseClient.js`

```
loadFirebaseSDK()  →  lazily loads 3 CDN scripts:
  firebase-app-compat.js
  firebase-database-compat.js
  firebase-auth-compat.js
  (all version 10.13.0 from gstatic.com)

ensureApp()  →  calls firebase.initializeApp(config)
             →  reuses firebase.apps[0] if legacy already initialized
             →  returns { app, db, auth, serverTimestamp }
```

Test injection: `setFirebaseImplForTests(impl)` allows mock Firebase.

---

## Database Path Map

Source: `src/game/online/schema.js` PATH constants

| Path | Description |
|------|-------------|
| `/rooms/{roomId}` | Active game room documents |
| `/pendingRooms/{code}` | Temporary room codes (6-digit, 30min TTL) |
| `/invites/{toUid}/{inviteId}` | Incoming game invites |
| `/inviteAcks/{fromUid}/{toUid}` | Invite response acknowledgments |
| `/users/{uid}` | Private user data |
| `/users/{uid}/activeRoom` | Current live game room pointer |
| `/users/{uid}/asyncRooms/{roomId}` | Async game index |
| `/presence/{uid}` | Real-time presence status |
| `/matchmakingQueue/{mode}/{uid}` | Random opponent queue |
| `/usernames/{username}` | Username → uid mapping |
| `/userIds/{uid}` | uid → username mapping |
| `/dictionarySuggestions` | User-submitted words |
| `/dictionaryApproved` | Admin-approved words |
| `/dictionaryRejected` | Admin-rejected words |
| `/admins/{uid}` | Admin flag |
| `/globalRatings/{uid}` | ELO leaderboard |
| `/friendRequests/{uid}/{senderUid}` | Incoming friend requests |
| `/friends/{uid}/{friendUid}` | Friend relationships |

---

## Room Lifecycle

### 1. Invite Flow (Friend Games)

```
Player A calls sendInvite(db, { fromUid, toUid, mode, settings })
  → writes /invites/{toUid}/{inviteId}
  → invite has TTL: live=5min, async=7days

Player B's listenForInvites() fires
  → B calls acceptInvite(db, { toUid, inviteId, ... })
      → transactional read + delete of invite (first-wins)
      → createRoom() writes /rooms/{roomId} with both players
      → writes ack: /inviteAcks/{fromUid}/{toUid} = { accepted: true, roomId }

Player A's listenForInviteAcks() fires
  → A navigates to roomId
```

For live modes: room starts as `status: 'waiting'`, transitions to `'playing'` when both players mark ready.
For async modes: room starts as `status: 'playing'` immediately.

### 2. Room Code Flow

```
Host calls createPending(db, { hostUid, mode, settings })
  → generates 6-digit code (up to 8 collision-retry attempts)
  → writes /pendingRooms/{code} with 30-minute TTL
  → returns { code, expiresAt }

Guest enters code → claimByCode(db, { code, guestUid, ... })
  → atomic: deletes /pendingRooms/{code}
  → creates /rooms/{roomId} with both players
  → first claimer wins; concurrent = { ok: false, reason: 'already-claimed' }
```

### 3. Random Matchmaking

```
Player calls joinQueue(db, { uid, mode, profile, settings })
  → writes /matchmakingQueue/{mode}/{uid}
  → sets onDisconnect to remove entry

Player calls tryPair(db, { uid, mode, createRoomFromPair })
  → reads full /matchmakingQueue/{mode}
  → finds oldest compatible partner (not self)
  → compatibility: strict-search timelimit match + rating range check
  → atomically removes both entries
  → calls createRoomFromPair(myEntry, partner)
  → returns { matched: true/false, roomId }
```

Caller is responsible for retrying `tryPair()` on `matched: false`.

### 4. Room Play Loop

```
Both players: createOnlineGameSession(db, room, mySlot)
  → watchRoom(db, roomId, cb) — subscribes to Firebase snapshots

Active player dispatches CMD.CONFIRM_MOVE
  → commitTransaction(db, roomId, expectedVersion, produceUpdate)
      → Firebase transaction:
          if room.version !== expectedVersion: abort (returns committed: false)
          else: merge patch, version++, return committed: true
      → on success: updates lastSeenMoveTs for echo cancellation

Opponent's watchRoom callback fires
  → synthesizes EV.OPPONENT_MOVED from version delta
  → applies to local engine state
```

### 5. Room Termination

Terminal statuses: `'completed'`, `'abandoned'`, `'expired'`

- **Normal end:** `setStatus(db, roomId, 'completed')`
- **Resign/forfeit:** `setStatus(db, roomId, 'abandoned', { abandonedBy: slot })`
- **Async expiry:** `asyncReminderService.sweepForUser()` after 7 days idle
- On terminal: `clearAsyncIndex()` removes from `/users/{uid}/asyncRooms/`

---

## Transaction Pattern

Source: `src/game/online/roomService.js` → `commitTransaction()`

All game-state writes use Firebase Realtime Database transactions:

```javascript
db.ref(`/rooms/${roomId}`).transaction((room) => {
  if (!room || room.version !== expectedVersion) return; // abort
  const patch = produceUpdate(room);
  return { ...room, ...patch, version: room.version + 1 };
});
```

- Returns `{ committed: boolean, room }` after settlement
- Caller receives `committed: false` on version mismatch (stale write)
- `onlineGameSession` tracks `lastAppliedVersion` and `expectedVersion` cursor

---

## Presence Flow

Source: `src/game/online/presenceService.js`

```
startPresence(db, { uid, currentRoom })
  → writes /presence/{uid} = { connected: true, lastSeen: now, currentRoom, backgrounded: false }
  → sets onDisconnect: /presence/{uid}/connected = false
  → starts heartbeat: every 10s writes lastSeen

watchPresence(db, partnerUid, cb)
  → subscribes to /presence/{partnerUid}
  → fires cb({ connected, lastSeen }) on each change
```

Constants:
- `HEARTBEAT_MS = 10_000`
- `PRESENCE_GRACE_MS = 30_000`

---

## Timeout Watchdog Flow

Source: `src/game/online/timeoutWatchdog.js`

The **non-active player** runs this after each turn start:

```
createTimeoutWatchdog({ db, roomId, mySlot, limitMs, graceMs=1000, tickMs=350 })
  → polls room state every 350ms
  → if active player's deadline passed + grace:
      → commitTransaction with:
          currentTurnSlot flipped
          turnNumber++
          missedTurns[slot]++
          if missedTurns[slot] >= 2:
            status = 'abandoned', abandonedBy = slot
      → clears livePreview
```

Guard conditions (no-op if any true):
- `room.status !== 'playing'`
- `!settings.timelimit`
- `room.liveBonus?.active === true`
- `room.turnDeadlineMs > now + graceMs`

---

## Async Session Flow

Source: `src/game/online/asyncSessionService.js`

```
listAsyncSessions(db, uid)
  → reads /users/{uid}/asyncRooms (index)
  → for each roomId: readRoom(db, roomId)
  → filters: skip terminal status, skip non-participant
  → maps to summaries: { roomId, mode, isMyTurn, opponentName, ... }
  → sorts: my-turn first, then by lastUpdated desc

watchAsyncSessions(db, uid, cb)
  → subscribes to /users/{uid}/asyncRooms
  → on index change: re-fetches all rooms
  → race guard: ignores stale concurrent fetches via lastFire
```

---

## Reminder and Expiry

Source: `src/game/online/asyncReminderService.js`

```
classify(room, uid, now)
  → returns 'expired' | 'needs_reminder' | 'ok'

sweepForUser(db, uid, now)
  → lists user's async rooms
  → for each: classify → if expired: setStatus('expired') + push
                         if needs_reminder: write lastReminderAt + push
```

Timing:
- Reminder: 24 hours idle (room `updatedAt` delta)
- Expiry: 7 days idle

---

## Firebase Security Rules Summary

Source: `firebase.database.rules.json`

| Path | Read | Write |
|------|------|-------|
| `/rooms` | public | auth + schema v2 + version increment + turn logic |
| `/pendingRooms` | public | auth + new entry with matching hostUid |
| `/invites/{toUid}` | recipient only | auth + from/to match |
| `/inviteAcks/{fromUid}` | sender only | auth + inviter or invitee |
| `/users/{uid}` | self only | self only |
| `/users/{uid}/activeRoom` | self or room players | self or room players |
| `/presence` | auth required | self only |
| `/matchmakingQueue` | auth required | self only (join/leave) |
| `/globalRatings` | public | auth + valid fields + uid match |
| `/usernames` | public | auth + new or own-uid overwrite |
| `/friends/{uid}` | self only | auth + self or friend |
| `/dictionarySuggestions` | public | auth required |
| `/dictionaryApproved` | public | auth + admin claim |
| `/dictionaryRejected` | public | auth + admin claim |
| `/admins` | auth required | admin only |

Index defined: `/globalRatings` indexed on `["rating"]` for leaderboard queries.

---

## Known Firebase Constraints

1. **No Firestore** — only Realtime Database is used
2. **No Cloud Functions** — all logic runs client-side; watchdog and reminder service run in the browser
3. **Transaction limitations** — Realtime DB transactions on large subtrees can fail under high contention; room transactions are limited to the `/rooms/{roomId}` subtree
4. **SDK CDN dependency** — Firebase SDK is loaded from `storage.googleapis.com/firebase-js-sdk/` at runtime; offline first-load fails without this
5. **Auth token expiry** — Firebase ID tokens expire after 1 hour; auth library auto-refreshes, but `admin` custom claims require token refresh to propagate
