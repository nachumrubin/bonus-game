# notifications.md — Notification System

> Source evidence: `src/notifications/notificationService.js`, `pushPayloadBuilder.js`, `asyncTurnBanner.js`, `browserNotificationFallback.js`, `inAppNotificationService.js`, `sw.js`, `src/main.js`

---

## Overview

The game has three notification channels:

1. **OneSignal Push** — primary channel for background notifications (requires user opt-in)
2. **Browser Notification API fallback** — secondary for push when OneSignal unavailable
3. **In-app toast** — for notifications while the app is open

---

## OneSignal Push Notifications

### Initialization

Source: `src/notifications/notificationService.js`, `src/main.js`

```javascript
// At app boot (main.js ~line 165):
notificationService.configure({
  appId: cfg.onesignalAppId,
  restKey: cfg.onesignalKey,
});

// On user sign-in (main.js ~line 292):
const pushReady = await notificationService.boot({ uid });
if (pushReady) await notificationService.loginUser(uid);
// → calls globalThis.OneSignal.init({ appId, serviceWorkerPath: 'sw.js' })
// → calls globalThis.OneSignal.login(uid)
```

### Subscription ID Sync

After joining/creating a room, the player's OneSignal subscription ID is written to Firebase:

```javascript
const subId = await notificationService.getSubscriptionId();
// → reads globalThis.OneSignal.User.PushSubscription.id
if (subId) await roomService.setPlayerSubscriptionId(db, roomId, slot, subId);
// → writes /rooms/{roomId}/players/{slot}/oneSignalSubId
```

This allows the server (opponent client) to target the correct OneSignal subscription.

### Push Trigger Logic

Source: `notificationService.attachBusSubscriptions()`

Triggered by bus events:
- `EV.TURN_CHANGED` — opponent's turn ended → send "your turn" push
- `EV.GAME_COMPLETED` — game ended → send "game over" push

Mode-based gating:
- `friend-async` / `random-async`: `pushOnMove: 'always'` — push unconditionally
- `friend-live` / `random-live`: `pushOnMove: 'ifBackgrounded'` — push only if recipient is backgrounded

Deduplication:
- `lastTurnNotified` Map prevents duplicate pushes per `turnNumber+roomId` combination

### Notification Types and Hebrew Text

Source: `src/notifications/pushPayloadBuilder.js`

| Kind | Hebrew Title | Trigger |
|------|-------------|---------|
| `INVITE` | "הוזמנת למשחק! 🎮" | Invite received |
| `INVITE_ACCEPTED` | Unknown / needs verification | Invite accepted |
| `INVITE_REJECTED` | Unknown / needs verification | Invite rejected |
| `TURN` | "תורך בבוסט!" | Opponent completed their move |
| `REMINDER` | "תזכורת — תורך מחכה" | 24h idle in async game |
| `COMPLETED` | "המשחק הסתיים" | Game ended |
| `EXPIRED` | "המשחק פג תוקף" | Async game expired (7 days) |
| `FRIEND_REQUEST` | Unknown / needs verification | Friend request sent |
| `FRIEND_ACCEPTED` | Unknown / needs verification | Friend request accepted |

### OneSignal REST Payload Shape

```javascript
{
  app_id: appId,
  headings: { en: "Hebrew title" },
  contents: { en: "Hebrew body" },
  data: { type: kind, roomId, ... },
  include_subscription_ids: [subId],  // OR
  include_aliases: { external_id: [uid] },
  target_channel: 'push'
}
```

Sent to `https://onesignal.com/api/v1/notifications` with `Authorization: Basic {restKey}`.

---

## Service Worker Notification Routing

Source: `sw.js`

On notification click, the service worker routes to the correct screen:

| Notification `data.type` | Action |
|--------------------------|--------|
| `TURN` | `postMessage({ type: 'OPEN_TURN', roomId })` |
| `INVITE` | `postMessage({ type: 'OPEN_JOIN', code? })` |
| `FRIEND_REQUEST` / `FRIEND_ACCEPTED` | `postMessage({ type: 'OPEN_FRIENDS' })` |
| `COMPLETED` / `EXPIRED` | `postMessage({ type: 'OPEN_GAME_SUMMARY', roomId })` |

The app (`src/main.js`) listens for these `postMessage` events and navigates accordingly.

---

## Browser Notification API Fallback

Source: `src/notifications/browserNotificationFallback.js`

Used when OneSignal is unavailable (e.g., browser extension blocked it, or permission denied to OneSignal but granted to browser directly).

### Capability Check
```javascript
isBrowserNotificationSupported(win) // checks 'Notification' in win
getPermission(win) // returns 'granted' | 'default' | 'denied' | 'unsupported'
```

### Fire Condition
`shouldFire({ win, doc, force })` returns true if:
1. Notification API is supported
2. Permission is `'granted'`
3. Page is hidden (`doc.hidden === true`) OR `force: true`

### Delivery Method
1. Tries `ServiceWorkerRegistration.showNotification()` (preferred — respects OS notification rules)
2. Falls back to `new Notification(title, options)` constructor

### Return Value
```javascript
{ shown: boolean, reason?: 'precondition-failed' | 'construct-failed', via?: 'sw' | 'constructor' }
```

### Route Targets
| Kind | Route Intent |
|------|-------------|
| `TURN` | `OPEN_TURN` — resume game |
| `INVITE` | `OPEN_JOIN` — join code overlay |
| `FRIEND_REQUEST` / `FRIEND_ACCEPTED` | `OPEN_FRIENDS` — friends screen |
| `EXPIRED` / `COMPLETED` | `OPEN_GAME_SUMMARY` — game results |

---

## In-App Toast Notifications

Source: `src/notifications/inAppNotificationService.js`

A lightweight interface with injected renderer (no DOM knowledge in service):

```javascript
TOAST_KIND = { INFO, OK, ERROR, BONUS, WARNING }

// Usage:
inAppNotificationService.show({ kind: TOAST_KIND.OK, text: "...", durationMs: 3000 })
```

Renderer is injected at boot by `src/main.js`:
```javascript
inAppNotificationService.setRenderer(({ kind, text, durationMs }) => {
  // calls legacy globalThis.setS(text, ...) if available
  // otherwise console.info
});
```

Toast is currently rendered via the legacy status bar function `setS()`. A dedicated toast DOM implementation is Unknown / needs verification.

---

## Async Turn Banner

Source: `src/notifications/asyncTurnBanner.js`

Shows a banner when the player opens the app and has async games awaiting their move.

### Trigger
- App boot
- `MENU_REFRESH` event

### Behavior
```javascript
maybeShow({ uid, sessions, now, dedupWindowMs, show })
// sessions = list of async session summaries from asyncSessionService
// Filters: only sessions where isMyTurn === true
// Deduplication: same signature within dedupWindowMs (default 60s) → skip
// Shows:
//   1 game: "תורך נגד [opponent name]!"
//   N games: "יש N משחקים שמחכים לך!"
```

Returns `{ shown: boolean, reason?: 'no-uid' | 'no-my-turn' | 'deduped' }`.

---

## Notification Permission Flow

Unknown / needs verification — the UI flow for requesting notification permission (the prompt shown to the user) was not traced in code. The `notificationService.boot()` wraps OneSignal's own permission request flow.

The OneSignal SDK is initialized with `serviceWorkerPath: 'sw.js'`, so the service worker must be registered (which happens automatically as part of PWA boot) before push subscriptions work.

---

## Push Notification Security Considerations

- `onesignalKey` (REST API key) is loaded from `config.js` (gitignored) and never committed to source
- Pushes are sent client-side (the active player's browser calls the OneSignal REST API directly)
- This means the `restKey` is exposed in the browser — this is a known architectural tradeoff for client-only apps without Cloud Functions
- Firebase rules prevent unauthorized writes to `players/{slot}/oneSignalSubId` (only the slot owner can write their own subscription ID)
