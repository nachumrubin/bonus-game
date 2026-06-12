# Intentional Change Register

Default rule: if a behavior is not listed here and approved, the expectation is full parity with legacy `HEAD:index.html`.

All entries below are currently `approved: false`. They are documented because the new modular code appears to differ from legacy architecture or behavior and needs product approval.

```json
[
  {
    "behavior": "Ending an async game from the in-game 'סיום' button",
    "legacyBehavior": "Leaving an async game via the back-confirm overlay was non-destructive: BACK_INTENT.LEAVE only resigned for live online games (online && !isAsync); async leave just disposed the session and went home, leaving the game open. This left no way to actually end/forfeit an async game from inside it.",
    "newBehavior": "BACK_INTENT.LEAVE now resigns for ALL online games (gameFlowController.js), so 'סיום' ends an async game (GAME_COMPLETED -> terminal Firebase status). The async-only home button (#btn-async-home / AH_INTENT.GO_HOME) remains the leave-and-resume path.",
    "reason": "User-reported bug: 'סיום' did nothing in async games. The two buttons (סיום vs home) are now distinct: end/forfeit vs leave-and-resume.",
    "approved": true
  },
  {
    "behavior": "Async friend invite confirmation UI",
    "legacyBehavior": "Sending a friend invite for an async game opened the live 'waiting for X…' hourglass overlay, which made no sense for turn-based async play (no both-players-present handshake).",
    "newBehavior": "main.js CR_INTENT.CONFIRM: async friend invites send the invite, show a one-shot toast ('ההזמנה נשלחה ל-X! נעדכן אותך כשהיא תתקבל.'), cancel the unused pending code room, and return to the menu. Live invites + code-share games keep the waiting room.",
    "reason": "User-reported bug: async invites should not block on a waiting overlay; the host is notified when the recipient accepts.",
    "approved": true
  },
  {
    "behavior": "Friend invite room creation",
    "legacyBehavior": "Friend invite flow used Firebase invite records and could create or reference a room before the invite was accepted, with rejection cleanup paths.",
    "newBehavior": "src/game/online/inviteService.js creates no room until acceptInvite(), then creates the room atomically and writes an invite ack.",
    "reason": "Avoids orphan rooms after rejected or ignored invites.",
    "approved": false
  },
  {
    "behavior": "Online move conflict model",
    "legacyBehavior": "pushMoveToFirebase() and listenForMoves() used push ids, stateSeq, moveCount, and client ids to deduplicate moves.",
    "newBehavior": "src/game/online/roomService.js centralizes writes in commitTransaction() guarded by room.version.",
    "reason": "Simplifies conflict handling and should prevent stale commits more directly, but must be proven against legacy scenarios.",
    "approved": false
  },
  {
    "behavior": "Pending tile placement ownership",
    "legacyBehavior": "Global placed[] held in-progress board placements until commit/recall/timeout.",
    "newBehavior": "The pure engine does not retain pending placements; UI/session controllers pass placed tiles in CONFIRM_MOVE and own recall/recovery.",
    "reason": "Keeps core engine pure and command-driven.",
    "approved": false
  },
  {
    "behavior": "Online session persistence key",
    "legacyBehavior": "Legacy stored online sessions under STORAGE_KEYS.onlineSession with a multi-session payload.",
    "newBehavior": "New code uses spine.activeOnlineSession plus Firebase users/{uid}/asyncRooms index.",
    "reason": "Separates local active-room cache from server-backed async session list.",
    "approved": false
  },
  {
    "behavior": "Room schema version",
    "legacyBehavior": "Legacy room state was a single serialized object under rooms/{code}/state with legacy field names.",
    "newBehavior": "New rooms are schemaVersion 2 documents with flat board serialization, bonusBoard, bonusAssignment, bonusSqUsed, pendingBonuses, locks, and version.",
    "reason": "Makes room documents easier to validate and transact.",
    "approved": false
  },
  {
    "behavior": "Notification abstraction",
    "legacyBehavior": "Legacy code directly initialized OneSignal, read/wrote room tokens, and called OneSignal REST endpoints from UI functions with browser-notification fallback.",
    "newBehavior": "New code splits payload construction, notification service, async banner, and room subscription-id storage across src/notifications and roomService.",
    "reason": "Improves testability and separates UI from push transport.",
    "approved": false
  },
  {
    "behavior": "Bonus effect plugin architecture",
    "legacyBehavior": "triggerBonus(), bonusOk(), bonusSkip(), and futBon globals dispatched all B1-B13 effects in one file.",
    "newBehavior": "New code uses bonusResolver, boostEngine hooks, and futureEffects plugins.",
    "reason": "Allows adding boosts without changing unrelated engine code.",
    "approved": false
  },
  {
    "behavior": "Working index.html is no longer the legacy monolith",
    "legacyBehavior": "The original index.html contained UI, engine, Firebase, notifications, dictionary, and utilities in one file.",
    "newBehavior": "The working-tree index.html is a small modular shell loading styles.css, config.js, screenPartials.js, and src/main.js.",
    "reason": "Modularization entrypoint. Legacy behavior must be read from git history or an archived source file.",
    "approved": false
  }
]
```

