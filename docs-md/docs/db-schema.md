# db-schema.md — Firebase Realtime Database Schema

> Source evidence: `src/game/online/schema.js`, `roomService.js`, `inviteService.js`, `matchmakingService.js`, `presenceService.js`, `firebase.database.rules.json`
> All field names and structures are extracted from code, not assumed.

---

## `/rooms/{roomId}`

The primary game document. Created by `roomService.createRoom()` / `inviteService.acceptInvite()` / `roomCodeService.claimByCode()`.

```
{
  roomId: string,
  mode: string,              // 'friend-live' | 'friend-async' | 'random-live' | 'random-async'
  status: string,            // 'waiting' | 'playing' | 'completed' | 'abandoned' | 'expired'
  schemaVersion: 2,          // always 2

  createdAt: ServerTimestamp,
  updatedAt: ServerTimestamp,

  version: number,           // incremented on every committed move (optimistic locking)
  tileBagSeed: string,       // deterministic shuffle seed

  currentTurnSlot: 0 | 1,
  turnNumber: number,
  turnDeadlineMs: number | null,   // epoch ms, null if no timer
  missedTurns: { "0": number, "1": number },

  scores: { "0": number, "1": number },
  racks: {
    "0": Tile[],
    "1": Tile[]
  },

  board: Tile[],             // flat 100-element array (10×10 serialized), null = empty
  bonusBoard: {              // object, keys = "r,c" strings
    [key: string]: Tile
  },

  lastMove: {                // most recent committed move
    ts: number,              // client timestamp for echo cancellation
    slot: 0 | 1,
    placed: PlacedTile[],
    words: string[],
    score: number,
    reason?: string          // 'pass' | 'timeout' | 'illegal-word' for pass-type moves
  },
  moveHistory: MoveRecord[], // full history (replay log)

  activeBoosts: ActiveBoost[],

  lockedCells: LockedCell[],
  lockInventory: { "0": number[], "1": number[] },  // default [3,3,5] each

  bonusAssignment: BonusDef[],
  bonusSqUsed: { [key: string]: boolean },
  pendingBonuses: PendingBonus[],

  ready: { "0": boolean, "1": boolean },   // for live-mode pre-start handshake
  settings: GameSettings,

  livePreview: {             // opponent's tentative tile placements (real-time)
    "0": PreviewTile[],
    "1": PreviewTile[]
  },
  liveBonus: {               // active bonus mini-game state (broadcast to both)
    active: boolean,
    slot: 0 | 1,
    kind: string,
    bonusType: string,
    title: string,
    desc: string,
    icon: string,
    progress: any,
    updatedAt: number
  },

  liveReaction: {            // emoji/message reaction (broadcast, no version bump)
    type: 'emoji' | 'message',
    id: string,              // whitelisted id from REACTIONS config
    senderSlot: 0 | 1,
    ts: number               // epoch ms — used for anti-replay on reconnect
  } | null,

  players: {
    "0": SpinePlayer,
    "1": SpinePlayer
  },

  abandonedBy?: 0 | 1,
  lastReminderAt?: number,   // epoch ms, for async reminder dedup
}
```

### Tile Object
```
{ letter: string, val: number, isJoker?: boolean }
```

### LockedCell Object
```
{ id: string, r: number, c: number, ownerSlot: 0|1, remainingTurns: number }
```
ID format: `"${turnNumber}:${slot}:${r}:${c}:${duration}"`

### SpinePlayer Object
```
{
  uid: string,
  displayName: string,
  avatar?: string,
  oneSignalSubId?: string,   // written after join
  rating?: number
}
```

### ActiveBoost Object
```
{
  slot: 0 | 1,
  boostId: string,           // 'extra_turn' | 'multiply_next_turns' | 'timer_bonus' | etc.
  payload: object,           // effect-specific data
  turnNumber: number
}
```

### turnTimerBonusMs (transient, local)
`state.turnTimerBonusMs` (number, ms) holds timer-bonus seconds queued for the slot whose turn is starting. Set by the engine's `applyTurnStartEffects` (from a consumed `timer_bonus` boost) and consumed by `turnTimerController.ensureDeadline` (offline/optional modes) when it computes the turn's deadline. Local-only — not written to the Firebase room patch.

### GameSettings Object (subset)
```
{
  timelimit?: boolean,       // turn timer on/off
  botTime?: string,          // 'fast' | 'medium' | 'slow'
  movelimit?: boolean | number,
  moveLimitOn?: boolean,     // legacy field
  confirm?: boolean,
  music?: boolean,
  vibration?: boolean,
  ratingRange?: number,      // matchmaking rating delta
  strict?: boolean           // strict timelimit matching
}
```

---

## `/pendingRooms/{code}`

Temporary room codes for game invites. 6-digit numeric code, 30-minute TTL.

```
{
  code: string,              // 6-digit code (same as key)
  hostUid: string,
  hostProfile: {
    displayName: string,
    avatar?: string
  },
  mode: string,
  settings: GameSettings,
  createdAt: ServerTimestamp,
  expiresAt: number          // epoch ms
}
```

---

## `/invites/{toUid}/{inviteId}`

Incoming invite for a specific user.

```
{
  inviteId: string,
  fromUid: string,
  fromName: string,
  fromAvatar?: string,
  toUid: string,
  mode: string,
  settings: GameSettings,
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled',
  createdAt: ServerTimestamp,
  expiresAt: number          // live: +5min, async: +7days from creation
}
```

---

## `/inviteAcks/{fromUid}/{toUid}`

Acknowledgment of invite response, read by the original sender.

```
{
  inviteId: string,
  accepted: boolean,
  roomId?: string,           // present if accepted
  fromName: string,          // responder's name
  timestamp: ServerTimestamp
}
```

---

## `/users/{uid}`

Private per-user data. Only the owner can read/write (except `activeRoom` and `asyncRooms` which have room-player access).

```
{
  // The editable profile lives under /users/{uid}/profile (displayName,
  // equippedAvatar, rating, stats, createdAt, and the economy fields below).
  displayName?: string,
  avatar?: string,           // legacy; equippedAvatar is the current field
  equippedAvatar?: string,   // achievement avatar id, store avatar id, or emoji
  stats?: {
    gamesPlayed: number,
    gamesWon: number,
    // other stats fields: Unknown / needs verification
  },
  // Avatar-store economy (added June 2026; see profileService.js). Profile
  // ROOT fields, NOT under stats. Client-authoritative for v1.
  coins?: number,            // spendable balance (starter grant seeds 150)
  ownedAvatars?: string[],   // purchased store ids only (common are free/implicit)
  lastLoginDate?: string,    // 'YYYY-MM-DD' of last claimed daily reward
  loginStreak?: number,      // consecutive-day login streak
  activeRoom?: string,       // roomId of current live game (or null)
  asyncRooms?: {             // per-user index of async games
    [roomId: string]: {
      roomId: string,
      mode: string,
      createdAt: number
    }
  }
}
```

---

## `/presence/{uid}`

Real-time presence, updated by `presenceService.js`.

```
{
  connected: boolean,
  lastSeen: ServerTimestamp,
  currentRoom: string | null,
  backgrounded: boolean      // true when tab is hidden
}
```

`onDisconnect` clears `connected` to `false`.

---

## `/matchmakingQueue/{mode}/{uid}`

One entry per queued player per mode. Deleted on pair or disconnect.

```
{
  uid: string,
  mode: string,
  displayName: string,
  avatar?: string,
  rating?: number,
  settings: {
    ratingRange?: number,
    strict?: boolean,
    timelimit?: boolean
  },
  joinedAt: ServerTimestamp
}
```

---

## `/globalRatings/{uid}`

Indexed ELO leaderboard. Indexed on `["rating"]` in security rules.

```
{
  uid: string,
  name: string,
  rating: number,
  updatedAt: number          // epoch ms
}
```

---

## `/usernames/{username}`

Maps username string → uid.

```
string   // value is just the uid
```

---

## `/userIds/{uid}`

Maps uid → username.

```
string   // value is just the username
```

---

## `/dictionarySuggestions`

Restored June 2026 (was removed earlier in June 2026). Any authenticated non-anonymous user can
append a suggestion entry. Admins have read access over all entries. When an admin adds a word via
the direct-add flow, `findPendingSuggestionsForWords` scans this path and `wordsAccepted` is bumped
for every suggester whose suggestion matches, then the entry is marked `approved`.

```
{
  [pushKey: string]: {
    word: string,
    normalizedWord: string,
    type: 'add' | 'remove',   // 'add' = suggest adding; 'remove' = suggest removing
    status: 'pending' | 'approved',
    suggestedBy: string[],    // array of uid strings; multiple users can suggest the same word
    createdAt: ServerTimestamp
  }
}
```

Firebase rules: `.read` requires `admins/{uid} === true`; `$id { .read: auth != null, .write: auth != null && !data.exists() }` (append-only for any auth user).

---

## `/dictionaryApproved`

```
{
  [word: string]: {
    word: string,
    approvedAt: ServerTimestamp
  }
}
```

Words approved by an admin. Merged into the runtime `DICT` Set at boot by `syncApprovedDictionaryWordsOnce` so they're valid in gameplay.

## `/dictionaryRejected`

```
{
  [pushKey: string]: {
    word: string,
    rejectedAt: ServerTimestamp,
    source?: 'add-rejected' | 'remove-approved'  // missing on legacy entries
  }
}
```

Words explicitly excluded from gameplay. Two kinds of entries (distinguished by `source`):

- **`'add-rejected'`** — an add-suggestion was rejected by an admin. The word was never valid; this entry only prevents re-submission.
- **`'remove-approved'`** — a remove-suggestion was approved by an admin. The word was valid; this entry blocks it at runtime.

Both kinds are merged into `hebrewDictionary.BLOCKED_OVERLAY` at boot by `syncBlockedDictionaryWordsOnce`. `isValid()` consults this set before any positive lookup, so a blocked word always rejects regardless of its presence in DICT, the DAWG, or `/dictionaryApproved`.

---

## `/admins/{uid}`

```
boolean   // true if uid is admin
```

---

## `/friendRequests/{uid}/{senderUid}`

Incoming friend request for a user.

Structure: Unknown / needs verification — `friendsService.js` not fully read.

---

## `/friends/{uid}/{friendUid}`

Mutual friendship records.

Structure: Unknown / needs verification — `friendsService.js` not fully read.

---

## Board Serialization

Source: `src/game/online/schema.js`

The 10×10 board is serialized as a **flat 100-element array** for Firebase storage:

```javascript
serializeBoard(board2d)   // 2D[10][10] → flat[100], null for empty cells
deserializeBoard(flat)    // flat[100] → 2D[10][10]
```

The `bonusBoard` (12 off-grid squares) is serialized as a plain object:

```javascript
serializeBonusBoard(bonusBoard)   // Map("r,c" → Tile) → { "r,c": Tile }
deserializeBonusBoard(value)      // { "r,c": Tile } → Map
```

---

## Security Rule Highlights

Source: `firebase.database.rules.json`

- Rooms allow write only when: auth exists + `schemaVersion === 2` + player is in room + version increments by exactly 1
- Turn logic enforced: can write only when `currentTurnSlot` matches writer's slot, OR when opponent's `turnDeadlineMs` has passed (with grace period)
- Presence strictly self-write only
- Global ratings require `uid` field to match the `$uid` node key
- Admin paths require custom claim `admin: true`
