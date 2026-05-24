# Parity Test Plan

This plan is the runnable/semi-runnable plan for comparing legacy `HEAD:index.html` with the modular app. Existing first-batch tests live in `tests/unit/engine-parity.test.js` and `tests/unit/engine-parity-highrisk.test.js`; this file expands the required coverage beyond the pure engine.

## Harness Strategy

1. Load legacy source with `git show HEAD:index.html`.
2. Extract required legacy functions into a VM/browser-like sandbox. Existing helper: `extractFunction()` in `tests/unit/engine-parity.test.js`.
3. Seed legacy globals: `bData`, `bBoardData`, `placed`, `racks`, `scores`, `turn`, `firstMove`, `bag`, `bonusSqUsed`, `lockedCells`, `futBon`, `passCount`, `moveCount`.
4. Run the matching modular command or service call.
5. Normalize snapshots:

```json
{
  "board": "10x10 array",
  "bonusBoard": {},
  "currentPlayer": 0,
  "scores": [0, 0],
  "racks": [[], []],
  "bagCount": 0,
  "formedWords": [],
  "lastMessage": "",
  "gameOver": false,
  "mode": "local-1v1"
}
```

6. For online tests, use `src/game/online/mockFirebase.js` and mocked push sender/browser notifications.

## Mandatory Scenario Coverage

### Local 1v1

| Scenario | Legacy evidence | New target | Assertion |
|---|---|---|---|
| Fresh game | `initGame()` | `createInitialState()` / local session | empty 10x10 board, 8 tiles each, bag total minus 16 |
| Valid first move | `playWord()` -> `commitPlay()` | `CONFIRM_MOVE` | score/rack/bag/turn match |
| Invalid disconnected move | `isConnected()` | `validateMove()` | no score, no turn switch, tiles recoverable |
| Gap filled by existing tile | `hasGaps(pp)` | `hasGaps(state, placed)` | valid when committed tile fills gap |
| Multiple words | `getAllWords()` / `calcTotal()` | `getAllWords()` / `scoreMove()` | all cross words validated/scored |
| Game-end by passes | `passCount >= 6` | `turnManager.isGameOver()` | completion only after six pass/timeout events |

### Bot Game

| Scenario | Legacy evidence | New target | Assertion |
|---|---|---|---|
| Bot responds after player move | `scheduleBotMove()` | `botGameSession.js` | bot action scheduled only while game active |
| Bot move legal | `doBotSearch()` / `isBotCrossWordValid()` | `botSearch.js` | selected move passes same validator |
| Bot no-move fallback | `botCommit()` / pass branch | bot session | pass/exchange behavior matches legacy |
| Bot dictionary safety | `ensureBotWords()` | dictionary + bot search | no invalid word according to playable validator |

### Tile Exchange

| Scenario | Legacy evidence | New target | Assertion |
|---|---|---|---|
| Regular exchange one tile | `doExchange()` | `EXCHANGE_TILE` | rack size unchanged, bag count unchanged, turn switches |
| Exchange with too-small bag | `doExchange()` | `handleExchange()` | legacy-compatible rejection or documented intentional change |
| Free swap boost | future effect + `doExchange()` branch | `applyFreeExchange()` | boost consumed, turn does not switch |
| Recall after invalid exchange/placement | `doRecall()` | `gameController.js` | no tile loss |

### Online Friend Invite

| Scenario | Legacy evidence | New target | Assertion |
|---|---|---|---|
| Send invite | `_sendInviteNotification()`, `invites/{uid}` | `inviteService.sendInvite()` + notifications | invite record and push target match documented behavior |
| Reject invite | `handleInviteRejected()` / room cleanup | `inviteService.rejectInvite()` | sender ack, invite deleted, no orphan room |
| Accept invite | `_acceptIncomingInvite()` | `inviteService.acceptInvite()` | same initial board/racks/bag/turn for both users |
| Sender sees response | `listenForInviteResponse()` | `listenForInviteAcks()` | accepted/rejected UI route fires once |

### Async Online Move

| Scenario | Legacy evidence | New target | Assertion |
|---|---|---|---|
| Create async room | `onlineCreateRoom()` settings | `roomService.createRoom()` | async index exists for both players |
| Submit and leave | `pushMoveToFirebase()` | `onlineGameSession` + `roomService.commitTransaction()` | room stores exact board/score/rack/bag/turn |
| Opponent list update | `_syncOnlineSessionTurnWatchers()` | `asyncSessionService.watchAsyncSessions()` | session marked my turn for opponent |
| Push notification | `_notifyAsyncTurnIfNeeded()` | `notificationService`/`pushPayloadBuilder` | target is next player, active player skipped |
| Resume | `_loadSessions()` / `loadGameState()` | `engineStateFromRoom()` | normalized snapshot identical |

### Dictionary Query

| Scenario | Legacy evidence | New target | Assertion |
|---|---|---|---|
| Valid normal word | `checkShailta()` / `isValid()` | `dictionaryScreen.js`, `isValid()` | query and playable validator agree |
| Invalid word | same | same | clear invalid feedback, optional suggestion |
| Final-letter form | `terminalFinalVariants()` | same | final form accepted only under legacy rule |
| Two-letter allowed | `CLASSIC_ALLOW` | same | exact allow accepted |
| Two-letter rejected | `CLASSIC_ALLOW` plus heuristics | same | not accepted via prefixes/plene fallback |

## Engine Unit Matrix

| Area | Tests to add/keep |
|---|---|
| Geometry | empty move, not-collinear, first-move-on-bonus, disconnected, diagonal-only, no-gap, committed-gap |
| Word detection | single horizontal, single vertical, cross word, multiple cross words, duplicate prevention, one-letter rejection |
| Scoring | existing tile rescored, joker zero, bingo +50, score multipliers before bonus extras |
| Rack/bag | initial distribution, draw to 8, bag empty draw, exchange total conservation, replacement swap |
| Turn | legal move reset passCount, illegal word reset/forfeit semantics, pass threshold 6, resign winner |
| Locks | default `[3,3,5]`, unavailable duration reject, occupied/locked cell reject, countdown timing |
| Boosts | B1-B13 activation, skip/fail, wheel outcomes, future effects at turn start/end |

## Online Mock Matrix

| Flow | Mock requirements |
|---|---|
| Room create/join | Realtime DB mock with `ref().set/get/update/transaction/on/off` |
| Concurrent move | two clients with same `expectedVersion`; assert one commit aborts |
| Listener teardown | subscribe, navigate away, mutate db, assert callback no longer fires |
| Presence | fake clock, heartbeat updates, grace expiration |
| Notifications | fake OneSignal REST sender, fake browser Notification API |
| Async reminders | fake now, stale room timestamps, per-user async index |

## UI/E2E Matrix

Use Playwright for these because raw DOM matters:

| Screen | Checks |
|---|---|
| Home/menu | main buttons route, resume visibility, no handler references missing DOM ids |
| Setup/coin toss | difficulty, start, entering game creates board |
| Board mobile | 10x10 visible, rack and side panels fit, one timer/status row, bag count visible |
| Invalid move | status message visible, red word/cell highlight, no score/turn change |
| Move summary | each word appears, points total, score updates once |
| Settings | timer/music/notifications persist and affect behavior |
| Online lobby | create/join/matchmaking overlays open/close and clean listeners |
| Async sessions | list shows my turn/waiting and opens correct room |

## Current Evidence

Already implemented or partially implemented:

- `tests/unit/engine-parity.test.js`: golden-master VM harness and core legality/scoring/turn/exchange fixtures.
- `tests/unit/engine-parity-highrisk.test.js`: high-risk parity checks.
- `src/game/core/*.test.js`: module-level board, dictionary, scoring, tile bag, boost, turn tests.
- `src/game/online/*.test.js`: schema, room service, invite, matchmaking, presence, async session/reminder tests.
- `src/notifications/*.test.js`: push payload and notification service tests.

Still needed:

- End-to-end legacy-vs-new online state replay.
- Full B1-B13 branch parity.
- Dictionary admin approved/rejected runtime sync.
- UI pending placement recovery after invalid move/timeout.
- Bot search golden-master fixtures.
- Mobile visual checks for duplicated timer/status and clipped board.

