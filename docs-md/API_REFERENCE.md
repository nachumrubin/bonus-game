# API_REFERENCE.md — Public Module API Reference

> Documents the public JS API of each major spine module.
> Source evidence: `src/game/core/`, `src/game/online/`, `src/game/sessions/`, `src/notifications/`, `src/main.js`

---

## Game Engine (`src/game/core/gameEngine.js`)

```typescript
createInitialState(options: {
  mode: string,
  tileBagSeed: string,
  players: { 0: SpinePlayer, 1: SpinePlayer },
  startingSlot?: 0 | 1,
  settings?: GameSettings,
  bonusAssignment?: BonusDef[]
}): GameState

createEngine(opts: {
  state: GameState,
  bus: EventBus
}): {
  state: GameState,
  dispatch(cmd: SpineCommand): void,
  start(): void
}
```

**Commands accepted by `dispatch()`:**

| Command (CMD.*) | Payload |
|----------------|---------|
| `CONFIRM_MOVE` | `{ placed: PlacedTile[], swappedTiles?: SwappedTile[] }` |
| `PASS_TURN` | `{ reason?: string }` (all reasons increment `passCount` as of May 2026) |
| `CLAIM_STALL_END` | `{ slot?: 0 \| 1 }` — ends the game with `slot` as winner if `canClaimStallEnd(state, slot)` |
| `EXCHANGE_TILE` | `{ letters: string[] }` |
| `PLACE_LOCK` | `{ r: number, c: number, duration: number }` |
| `RESIGN_GAME` | `{}` |
| `ACTIVATE_BOOST` | boost-specific payload |
| `FINALIZE_BOOST_AWARD` | `{ earnedPts?: number }` |
| `PLACE_TILES` | UI-only, not tracked by engine |
| `QUERY_DICT` | UI-only, answered by hebrewDictionary |

---

## Board (`src/game/core/board.js`)

```typescript
BOARD_SIZE: 10

createEmptyBoard(): Tile[][]           // 10×10 array of nulls
isOnGrid(r: number, c: number): boolean
isBonusPos(r: number, c: number): boolean
getCommittedTile(state: GameState, r: number, c: number): Tile | null
getTileAt(state: GameState, r: number, c: number, placed: PlacedTile[]): Tile | null
setCommittedTile(state: GameState, r: number, c: number, tile: Tile): void
```

---

## Tile Bag (`src/game/core/tileBag.js`)

```typescript
RACK_SIZE: 8

createBag(seed: string): Tile[]
bagSize(bag: Tile[]): number
drawInto(bag: Tile[], rack: Tile[], target?: number): number   // returns count drawn
returnTilesAndShuffle(bag: Tile[], tiles: Tile[], seedOrRng: string | Function): void
```

---

## Letter Distribution (`src/game/core/letterDistribution.js`)

```typescript
HV: Record<string, number>    // Hebrew letter point values
HD: Record<string, number>    // Hebrew letter bag counts
ALL_LETTERS: string[]         // playable letters (excludes '?')
```

---

## Move Validator (`src/game/core/moveValidator.js`)

```typescript
isCollinear(placed: PlacedTile[]): boolean
hasGaps(state: GameState, placed: PlacedTile[]): boolean
isConnected(state: GameState, placed: PlacedTile[]): boolean
placedOnBonusSquare(placed: PlacedTile[]): PlacedTile | null
validateMove(state: GameState, placed: PlacedTile[]): {
  ok: boolean,
  reason?: 'empty-move' | 'not-collinear' | 'has-gaps' | 'first-move-on-bonus' | 'not-connected'
}
```

---

## Scoring Engine (`src/game/core/scoringEngine.js`)

```typescript
BINGO_BONUS: 50

getMainWord(state: GameState, placed: PlacedTile[]): WordTile[]
getAllWords(state: GameState, placed: PlacedTile[]): WordTile[][]
scoreWord(word: WordTile[]): number
scoreMove(words: WordTile[][], placedCount: number): number
```

---

## Turn Manager (`src/game/core/turnManager.js`)

```typescript
LEGACY_LOCK_INVENTORY: [3, 3, 5]
LEGACY_PASS_GAME_OVER_THRESHOLD: 6
TURN_END_REASON: { MOVE, PASS, EXCHANGE, TIMEOUT, ILLEGAL, RESIGN }

isGameOver(state: GameState): boolean
winnerSlot(state: GameState): 0 | 1 | null
nextSlot(slot: 0 | 1): 0 | 1
applyPass(state: GameState): void
applyExchange(state: GameState, letters: string[]): void  // increments passCount
canClaimStallEnd(state: GameState, slot: 0 | 1): boolean
applyFreeExchange(state: GameState, letters: string[]): void
applyResign(state: GameState, slot: 0 | 1): void
applyMove(state: GameState, placed: PlacedTile[], score: number, opts: {
  commitScore: boolean,
  advance: boolean
}): void
applyLock(state: GameState, opts: {
  r: number, c: number, duration: number, slot: 0 | 1
}): void
isCellLocked(state: GameState, r: number, c: number): boolean
ensureLockState(state: GameState): void
tickLocks(state: GameState): void
advanceTurn(state: GameState, opts: { tickLocks?: boolean }): void
```

---

## Hebrew Dictionary (`src/game/core/hebrewDictionary.js`)

```typescript
DICT: Set<string>             // loaded words
dictReady: boolean            // true after loadDict() completes
DICT_BASE_URL: './data/dictionary.base.txt'

loadDict(): Promise<void>
addWordsFromText(text: string): void
isValid(word: string): boolean
setValidationLogger(fn: Function): void
norm(word: string): string    // normalize final forms → medial
```

---

## Sessions (`src/game/sessions/`)

### localGameSession.js
```typescript
createLocalGameSession(opts: {
  bus: EventBus,
  mode?: string,
  tileBagSeed: string,
  players: { 0: SpinePlayer, 1: SpinePlayer },
  startingSlot?: 0 | 1,
  settings?: GameSettings
}): LocalGameSession
// → { state, engine, bus, mode, descriptor, start(), dispatch(), dispose(), _subs }
```

### botGameSession.js
```typescript
attachBotPlayer(session: LocalGameSession, opts: {
  slot: 0 | 1,
  wordList: string[],
  isWordValid: (w: string) => boolean,
  difficulty?: string,
  thinkingMs?: number,
  rng?: Function,
  scheduler?: Function,
  cancelScheduler?: Function
}): { detach(): void }
```

### tutorialSession.js
```typescript
seedTutorialRack(state: GameState, slot?: 0 | 1): void
buildTutorialFirstMove(): PlacedTile[]
attachScriptedTutorialBot(session: LocalGameSession, opts: {
  slot?: 0 | 1,
  moves?: PlacedTile[][],
  thinkingMs?: number,
  scheduler?: Function
}): { detach(): void, get nextMove(): number }
```

### onlineGameSession.js
```typescript
createOnlineGameSession(opts: {
  bus: EventBus,
  db: FirebaseDatabase,
  room: RoomDoc,
  mySlot: 0 | 1
}): Promise<OnlineGameSession>
// → { state, engine, bus, mode, descriptor, roomId, mySlot,
//     start(), dispatch(), dispose(), markReady() }
```

### modes.js
```typescript
modeDescriptor(mode: string): ModeDescriptor
// → { online, hasTurnTimer, pushOnMove, presenceCritical, expiry }
MODES: Record<string, ModeDescriptor>
```

---

## Online Services (`src/game/online/`)

### roomService.js
```typescript
createRoom(db, opts: { roomId, mode, players, settings, engineState, serverTimestamp }): Promise<void>
readRoom(db, roomId: string): Promise<RoomDoc | null>
watchRoom(db, roomId: string, cb: (room: RoomDoc | null) => void): () => void
commitTransaction(db, roomId: string, expectedVersion: number, produceUpdate: (room) => Patch): Promise<{ committed: boolean, room: RoomDoc }>
setReady(db, roomId: string, slot: 0|1, ready?: boolean): Promise<void>
markReadyAndMaybeStart(db, roomId: string, slot: 0|1, nowMs?: number): Promise<void>
setStatus(db, roomId: string, status: string, extras?: object): Promise<void>
leaveRoom(db, roomId: string, uid: string): Promise<void>
setPlayerSubscriptionId(db, roomId: string, slot: 0|1, subId: string): Promise<void>
setSettings(db, roomId: string, settings?: GameSettings): Promise<void>
setLiveBonus(db, roomId: string, payload: object): Promise<void>
setLiveBonusProgress(db, roomId: string, progress: any): Promise<void>
setLivePreview(db, roomId: string, opts: { slot: 0|1, tiles?: Tile[] }): Promise<void>
clearAsyncIndex(db, roomId: string, uids?: string[]): Promise<void>
turnLimitMsFromSettings(settings?: GameSettings): number
shouldUseSharedTurnTimer(mode: string, settings?: GameSettings): boolean
initialTurnDeadlineMs(mode: string, settings?: GameSettings, nowMs?: number): number | null
computeExpiredOnlineTurnState(state, nowMs: number, limitMs: number): GameState
shouldClaimExpiredOnlineTurn(state, myIdx: 0|1, nowMs: number, graceMs: number): boolean
MISSED_TURNS_FORFEIT_THRESHOLD: 2
```

### inviteService.js
```typescript
sendInvite(db, opts: { fromUid, fromName, fromAvatar, toUid, mode, settings, serverTimestamp }): Promise<void>
acceptInvite(db, opts: { toUid, inviteId, accepterProfile, now?, roomIdFn?, startingSlot? }): Promise<{ ok: boolean, reason?: string, roomId?: string, invite?: object }>
readInvite(db, opts: { toUid, inviteId }): Promise<InviteDoc | null>
rejectInvite(db, opts: { fromUid, toUid, inviteId, fromName, serverTimestamp }): Promise<void>
cancelInvite(db, opts: { toUid, inviteId }): Promise<void>
checkRecipientAvailability(db, toUid: string, mode: string): Promise<{ available: boolean, reason?: string }>
listenForInvites(db, uid: string, cb: (invites: InviteDoc[]) => void): () => void
listenForInviteAcks(db, senderUid: string, cb: (acks: AckDoc[]) => void): () => void
sweepExpired(db, uid: string, now: number): Promise<number>
```

### matchmakingService.js
```typescript
joinQueue(db, opts: { uid, mode, profile, settings, serverTimestamp }): Promise<{ ok: true }>
leaveQueue(db, opts: { uid, mode }): Promise<void>
isCompatible(a: QueueEntry, b: QueueEntry): boolean
tryPair(db, opts: { uid, mode, createRoomFromPair }): Promise<{ matched: false } | { matched: true, partnerUid, roomId, room }>
```

### asyncSessionService.js
```typescript
summarizeForUid(room: RoomDoc, uid: string): AsyncSessionSummary | null
listAsyncSessions(db, uid: string): Promise<AsyncSessionSummary[]>
watchAsyncSessions(db, uid: string, cb: (sessions: AsyncSessionSummary[]) => void): () => void
dismissForUid(db, uid: string, roomId: string): Promise<void>
hoursSince(timestamp: number | null, now?: number): number
```

### presenceService.js
```typescript
HEARTBEAT_MS: 10_000
PRESENCE_GRACE_MS: 30_000

startPresence(db, opts: { uid, currentRoom?, serverTimestamp, doc? }): { stop(): void }
watchPresence(db, partnerUid: string, cb: (presence: { connected, lastSeen }) => void): () => void
```

### roomCodeService.js
```typescript
DEFAULT_TTL_MS: 1_800_000   // 30 minutes
CODE_LENGTH: 6
MAX_GENERATE_ATTEMPTS: 8

createPending(db, opts: { hostUid, hostProfile, mode, settings, serverTimestamp, ttlMs? }): Promise<{ code, expiresAt }>
readPending(db, code: string): Promise<PendingRoomDoc | null>
watchPending(db, code: string, cb: (room: PendingRoomDoc | null) => void): () => void
cancelPending(db, code: string): Promise<void>
sweepExpired(db, now: number): Promise<void>
claimByCode(db, opts: { code, guestUid, guestProfile, now?, roomIdFn?, startingSlot? }): Promise<{ ok: boolean, roomId?: string, reason?: string }>
```

### timeoutWatchdog.js
```typescript
DEFAULT_WATCHDOG_TICK_MS: 350
DEFAULT_WATCHDOG_GRACE_MS: 1000

createTimeoutWatchdog(opts: {
  db, roomId, mySlot, limitMs, graceMs?, tickMs?, now?, setIntervalFn?, clearIntervalFn?
}): { tick(): void, dispose(): void, _lastTick(): number }
```

### sessionPersistence.js
```typescript
saveActiveOnlineSession(storage: Storage, opts: { roomId, userId }): void
readActiveOnlineSession(storage: Storage): { roomId, userId } | null
clearActiveOnlineSession(storage: Storage): void
```

### schema.js
```typescript
PATH: { rooms, invites, inviteAcks, users, presence, matchmakingQueue, usernames, usersAsyncRooms }
FIELD: { schemaVersion, version, status, mode, players, tileBagSeed, bag, ... }
STATUS: { WAITING, PLAYING, COMPLETED, ABANDONED, EXPIRED }
INVITE_STATUS: { PENDING, ACCEPTED, REJECTED, EXPIRED, CANCELLED }

buildRoomDoc(opts): RoomDoc
normalizeLockInventory(li): { 0: number[], 1: number[] }
normalizeBonusAssignment(ba): BonusDef[]
normalizeBonusSqUsed(bsu): Record<string, boolean>
normalizePendingBonuses(pb): PendingBonus[]
normalizeLockedCells(lc): LockedCell[]
serializeBoard(board2d: Tile[][]): (Tile | null)[]
deserializeBoard(flat: (Tile | null)[]): Tile[][]
serializeBonusBoard(bonusBoard: Map | object): object
deserializeBonusBoard(value: object): Map<string, Tile>
```

---

## Bonus System (`src/game/boosts/`)

### bonusResolver.js
```typescript
resolveBonusActivation(opts: {
  bonusType: string,    // 'B1'..'B13'
  slot: 0 | 1,
  turnNumber: number
}): {
  entries: ActiveBoost[],
  miniGamePending: boolean,
  miniGameKey?: string,
  wheelPending?: boolean
}

resolveMiniGameResult(opts: {
  slot: 0 | 1,
  turnNumber: number,
  success: boolean,
  earnedPts?: number
}): { entries: ActiveBoost[] }

resolveWheelResult(opts: {
  slot: 0 | 1,
  turnNumber: number,
  outcomeId: string
}): { entries: ActiveBoost[] }
```

### index.js
```typescript
registerAllBoosts(): void
_resetAndRegister(): void     // for tests only
BONUS_TILE_DEFS: BonusDef[]
WHEEL_OUTCOMES: WheelOutcome[]
BONUS_TYPES: string[]
BDEFS: BoardSlotDef[]
```

---

## Notifications (`src/notifications/`)

### notificationService.js
```typescript
configure(opts: { appId: string, restKey: string, sendPush?: Function }): void
boot(opts: { uid: string }): Promise<boolean>
loginUser(uid: string): Promise<void>
getSubscriptionId(): Promise<string | null>
attachBusSubscriptions(opts: { bus: EventBus, sessionRef: () => SessionContext }): void
pushInvite(opts: { inviteeUid, inviterName, roomId }): Promise<void>
pushInviteAccepted(opts: { inviterUid, accepterName, roomId }): Promise<void>
pushInviteRejected(opts: { inviterUid, rejecterName }): Promise<void>
pushFriendRequest(opts: { recipientUid, senderName }): Promise<void>
pushFriendAccepted(opts: { recipientUid, accepterName }): Promise<void>
pushReminder(opts: { recipientUid, opponentName, roomId, hoursIdle }): Promise<void>
pushExpired(opts: { recipientUid, roomId }): Promise<void>
_resetForTests(): void
```

### pushPayloadBuilder.js
```typescript
KIND: {
  INVITE, INVITE_ACCEPTED, INVITE_REJECTED, TURN, REMINDER,
  COMPLETED, EXPIRED, FRIEND_REQUEST, FRIEND_ACCEPTED
}

buildPushBody(opts: {
  appId: string,
  kind: string,
  ctx: object,
  subscriptionIds?: string[],
  externalIds?: string[],
  title?: string,
  body?: string,
  data?: object
}): OneSignalRestBody
```

### inAppNotificationService.js
```typescript
TOAST_KIND: { INFO, OK, ERROR, BONUS, WARNING }

setRenderer(fn: (opts: { kind, text, durationMs }) => void): void
show(opts: { kind: string, text: string, durationMs?: number }): void
_resetForTests(): void
```

### browserNotificationFallback.js
```typescript
NOTIF_KIND: { INVITE, TURN, FRIEND_REQUEST, FRIEND_ACCEPTED, EXPIRED, COMPLETED }

isBrowserNotificationSupported(win: Window): boolean
getPermission(win: Window): 'granted' | 'default' | 'denied' | 'unsupported'
shouldFire(opts: { win, doc, force? }): boolean
routeFor(data: object): RouteIntent
showBrowserNotification(opts: {
  title, body, data, icon?, badge?, win, doc, swRegistration?, onClick?, force?
}): Promise<{ shown: boolean, reason?: string, via?: 'sw' | 'constructor' }>
```

---

## Account Services (`src/game/account/`)

### ratingService.js
```typescript
// Constants
K: 24
SCALE: 400
RATINGS_LIMIT: 10

expectedScore(ratingA: number, ratingB: number): number
applyDelta(rating: number, delta: number): number
scoreFromResult(result: 'win' | 'loss' | 'draw'): number
rankRatings(ratings: RatingDoc[]): RatingDoc[]
applyEloForFinishedGame(db, opts: { roomId, players, winnerSlot }): Promise<void>
```

---

## Global Spine API (`globalThis.__spine`)

Source: `src/main.js`

Available in browser console for dev/test:

```javascript
window.__spine = {
  enabled: true,
  stage: 10,              // current migration stage
  bus,
  CMD,                    // command constants
  EV,                     // event type constants
  hebrewDictionary,
  sessions: {
    createLocalGameSession,
    attachBotPlayer,
    createOnlineGameSession,
    attachScriptedTutorialBot
  },
  online: {
    firebaseClient,
    roomService,
    inviteService,
    matchmakingService,
    asyncSessionService,
    presenceService,
    roomCodeService,
    timeoutWatchdog
  },
  ui: {
    mountGameScreen,
    createGameController,
    mountMenuScreen,
    // ... other screen mounts
  },
  notifications: {
    notificationService,
    inAppNotificationService
  },
  // Convenience boot helpers:
  bootOffline2P(): void,
  bootOfflineBot(): void,
  startGameViaSpine(opts): void,
  startOnlineGameViaSpine(opts): void
}
```
