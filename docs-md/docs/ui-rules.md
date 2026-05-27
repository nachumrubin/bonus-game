# ui-rules.md — UI Architecture and Rules

> Source evidence: `src/ui/controllers/gameController.js`, `gameFlowController.js`, `animationController.js`, `src/ui/screens/gameScreen.js`, `menuScreen.js`, `styles.css` (structure), `src/main.js`, `partials/screens/`, `manifest.json`

---

## Design System

Source: `memory/project_design_system.md`, `styles.css`

- **Theme:** Dark navy gradient (Boost Premium design, April 2026 overhaul)
- **Typography:** Hebrew text, RTL direction
- **Components:** Glossy buttons, icon badges
- **CSS variables** defined at `:root` level in `styles.css`
- **Single stylesheet:** All 90 KB in `styles.css` — no CSS modules, no bundler
- **No external CSS framework** — entirely custom

---

## Screen Architecture

### Partial Loading System

Source: `src/ui/screenPartials.js`, `screenPartialManifest.js`

HTML templates live in `/partials/screens/*.html`. They are loaded dynamically at runtime and injected into the DOM. Each screen is registered in `screenPartialManifest.js`.

```
partials/screens/home.html          → menuScreen.js
partials/screens/game.html          → gameScreen.js
partials/screens/setup.html         → setupScreen.js
partials/screens/online-lobby.html  → onlineLobbyScreen.js
...etc
```

### Screen Controller Pattern

Each screen JS module exports a `mount*Screen()` function:
- Receives `{ root, bus, ... }` injection
- Removes legacy `onclick` attributes from DOM buttons
- Wires bus intent events instead
- Returns `{ unmount }` for cleanup

Never call screen methods directly from other screens. All inter-screen communication goes through the event bus.

---

## DOM Conventions

### Element ID Naming
Critical element IDs referenced by game logic (must not be renamed):

```
#sg                    — game screen container
#sh                    — home/menu screen container
#game-grid             — 12×12 board grid
#c{r}_{c}              — board cells (e.g., #c5_3 = row 5, col 3)
#bsq-{idx}             — bonus squares (0-indexed)
#brack                 — rack container (children are .bt2 elements)
#btn-play              — confirm/play button
#btn-recall            — recall tiles button
#btn-exchange          — exchange overlay trigger
#ov-exch               — exchange overlay container
#exch-rack             — exchange rack inside overlay
#sv1, #sv2             — player score values (desktop)
#sn1, #sn2             — player name labels (desktop)
#is-sv1, #is-sv2       — player score values (mobile inline)
#is-sn1, #is-sn2       — player name labels (mobile inline)
#sbar                  — status bar text
#bag-count-text        — remaining tile count
#lcd                   — move counter display
#turn-name             — whose turn label
#sb1, #sb2             — score box containers (.act = active turn)
#is-sb1, #is-sb2       — mobile score boxes
#lock-inv-display      — lock inventory buttons
#bh, #bv               — placement direction buttons (horizontal/vertical)
#ov-bonus              — bonus mini-game overlay (checked by animation poller)
#ov-bonus-intro        — bonus intro overlay (checked by animation poller)
.bonus-award-positioner — bonus award container (checked by animation poller)
```

### Stats Screen (3-tab layout, May 2026 simplification)

Stats screen lives in `partials/screens/stats-screen.html`, painted by `src/ui/screens/statsScreen.js`.

Tabs (parsed from button text by `tabFromButton()`):
- `תקדמות` → `#st-panel-progress`
- `שיאים`  → `#st-panel-records`
- `יריבים ובוסטים` → `#st-panel-rivals`

Load-bearing IDs (do not rename without updating `statsScreen.js` paint code):

```
Hero:     #st-hero-av, #st-hero-name, #st-hero-tier, #st-hero-wr, #st-hero-streak, #st-hero-insight
Progress: #st-sparkline, #st-rating, #st-tier-bar, #st-highscore, #st-avg, #st-played,
          #st-won, #st-lost, #st-draw, #st-bar-w, #st-bar-l, #st-bar-d
Records:  #st-fun-bestmove, #st-fun-longest, #st-fun-streak, #st-fun-comeback, #st-fun-repeated, #st-fun-bestday
Rivals:   #st-rivals-content, #st-boost-total, #st-boost-avg, #st-boost-winrate,
          #st-boost-fav-icon, #st-boost-fav-name, #st-boost-fav-pct,
          #st-comeback, #st-lastmove, #st-closewins
Legacy hidden compat: #st-streak, #st-words, #stats-wr-pct, #stats-donut-arc
```

Removed in May 2026 simplification (do not re-add without product reason): `#st-avgword`, `#st-pts-tile`, `#st-move-time`, `#st-pts-move`, `#st-vs-stronger-w`, `#st-vs-weaker-w`, `#st-boost-impact-wins`, `#st-boost-impact-best`, `#st-boost-combo`, `#st-fun-luck`, `#st-fun-fastest`, `#st-perf-tier-badge`, `#st-hero-rank`, `#st-wr-pct-lbl`, `#st-streak-lbl`, `#st-best-streak`, `#st-bonuses`. The stats-screen topbar (`.stats-topbar`) and time filter (`.stats-tfseg`) are also removed — navigation lives on the persistent app top bar; cards reflect cumulative totals only.

### Button Selectors (legacy onclick removal)
Some buttons are targeted by their `onclick` attribute value:

```javascript
// In menuScreen.js:
button[onclick="openProfileOrAuth()"]
button[onclick="resumeSavedGame()"]
button[onclick="startSetup('vs')"]
button[onclick="startSetup('bot')"]
button[onclick="showOnlineLobby()"]
button[onclick="showTutorialIntro()"]
button[onclick="openChampions()"]
button[onclick="openSettings()"]
button[onclick="shareGame()"]
button[onclick="openStats()"]         // → MENU_INTENT.OPEN_STATS
button[onclick="openFriends()"]       // → MENU_INTENT.OPEN_FRIENDS
button[onclick="openNotifications()"] // → MENU_INTENT.OPEN_NOTIFICATIONS

// In gameFlowController.js:
#btn-pause
button[onclick="openSettings()"]
button[onclick="openEndMenu()"]
button[onclick="toggleMusic()"]
```

If you change an `onclick` value in an HTML partial, you **must** update the corresponding selector in the JS controller.

---

## RTL and Hebrew Layout

- `manifest.json`: `"dir": "rtl"` — browser applies RTL globally
- Hebrew text throughout the UI; all notification text is Hebrew
- Layout is RTL — right is the start of the row
- No explicit `direction: rtl` in CSS observed (relies on manifest + HTML `lang` / `dir`)
- Board grid is visual (row/col indices), not language-directional

---

## Mobile Layout

- `manifest.json`: `"orientation": "portrait"` — enforced by browser
- The Android TWA (`/android/`) wraps the PWA with native chrome
- Mobile scores and names are duplicated into `#is-sv*`, `#is-sn*`, `#is-sb*` elements
- Rack tiles use `.bt2` class for touch-friendly sizing
- Unknown / needs verification — specific media breakpoints in `styles.css` not analyzed

---

## Animation System

Source: `src/ui/controllers/animationController.js`, `gameScreen.js`

### Architecture
`animationController` is a pure event subscriber — it receives bus events and emits **animation directives** to an injected renderer. No state mutation, no direct DOM access inside the controller.

The renderer (in `gameScreen.js`) implements each directive as a DOM operation.

### Animation Directives

| Directive | When |
|-----------|------|
| `tilePlaceIn` | Tile placed on board |
| `validFlash` | Move accepted |
| `bingoLabel` | 8-tile bingo achieved |
| `multiplierLabel` | Score multiplier active |
| `tileCascadeIn` | Tiles refilled from bag |
| `scoreMergeSequence` | Score animates from board to scoreboard |
| `scoringWordGlow` | Words glow during score calculation |
| `scoringPointsFloat` | Points float up from words |
| `scoreFlyToPanel` | Score chips fly to player panel |
| `scorePop` | Score panel pop effect |
| `shakeWord` | Illegal word shake |
| `illegalPulse` | Rejection pulse |
| `bonusActivate` | Bonus square activated |
| `boostPulse` | Active boost pulse |
| `bonusAwardOverlay` | Bonus award modal |
| `playerGlowPulse` | Active player glow |
| `scorePanelArrive` | Score panel entrance animation |
| `overlayCardIn` | Overlay card entrance |
| `bagBounce` | Tile bag bounce |

### Timing Constants
Defined in both `animationController.js` and `gameScreen.js` (must match):

```javascript
WORD_MERGE_STAGGER_MS = 250    // delay between word merge steps
WORD_MERGE_FLIGHT_MS  = 380    // duration of word-to-score flight
BOOST_MERGE_DELAY_MS  = 250    // delay before boost merge
HOLD_AFTER_MERGE_MS   = 420    // hold after merge completes
SUM_FLIGHT_MS         = 480    // total score flight
COUNTUP_PEAK_MS       = 900    // score count-up peak
```

### Bonus Overlay Gating
The score-commit animation is **held** while bonus overlays are visible. `animationController` polls for overlay close every 100ms:

```javascript
// Checks these elements:
document.getElementById('ov-bonus')
document.getElementById('ov-bonus-intro')
document.querySelector('.bonus-award-positioner')
```

When all are absent: flush the pending score-commit animation. This is the known overlay-polling pattern — do not remove these checks.

### Score Count-Up Gating
- Active-slot glow holds until count-up finishes
- Last-move highlight expires after count-up finishes
- Count-up is held if bonus overlay is open

---

## Bus Intent Pattern

UI screens emit **intent events** rather than taking direct action. Example:

```javascript
// Menu button clicked:
bus.emit(MENU_INTENT.OPEN_PROFILE)
// → main.js or another controller handles navigation

// Game resign:
bus.emit(RESIGN_INTENT.CONFIRM)
// → gameFlowController handles resign command dispatch
```

Intent namespaces:
- `MENU_INTENT.*` — main menu actions
- `END_INTENT.*` — post-game actions (go home, rematch)
- `PAUSE_INTENT.*` — pause screen actions
- `BACK_INTENT.*` — back navigation actions
- `RESIGN_INTENT.*` — resign confirmation
- `COIN_INTENT.*` — coin toss screen
- `GAME_SCREEN_INTENT.*` — in-game actions (live preview, exchange)
- `SETTINGS_CHANGED` — settings updated

---

## Game Screen State Machine

Source: `src/ui/screens/gameScreen.js`

The game screen manages tile placement as a mini state machine:

1. **Idle** — waiting for player action
2. **Rack tile selected** — player clicked rack tile (tile highlighted)
3. **Tile placed** — player clicked board cell (tentative placement)
4. **Joker selection** — joker placed → picker modal open
5. **Swap mode** — player clicked committed board tile (swap flow)
6. **Confirm** — "Play" pressed → `CMD.CONFIRM_MOVE` dispatched

State transitions:
- Click rack tile → place on last clicked cell (or vice versa)
- Click placed tile on board → recall to rack
- Click committed tile on board → enter swap mode
- Click "Recall" → `controller.recallAll()` → all tentative tiles back to rack
- Click "Exchange" → open exchange overlay

---

## Screen Transitions

Source: `src/ui/screenTransitions.js`

Unknown / needs verification — specific transition CSS classes and timing not analyzed. File exists at `src/ui/screenTransitions.js`.

---

## Menu Screen Render Logic

Source: `src/ui/screens/menuScreen.js`

```javascript
render({ hasSavedGame, isAuthed, displayName, hasOnlineUnread, rating, avatar })
```

- `#btn-resume-home`: hidden if `!hasSavedGame`
- `#btn-share-game`: hidden if `!isAuthed`; on first reveal: plays `menuBtnIn` animation
- `#home-user-label`: shows `displayName`
- `#home-avatar-ic`: shows `avatar` emoji when provided
- `#home-elo-label`: hidden if `!isAuthed`
- `#home-elo-value`: shows `rating` formatted as locale number
- `#home-elo-bolt`: tier emoji (🪙/🥈/🥇/💎); set by `ratingTierEmoji()` in `menuScreen.js`
- `#online-badge`: shows count of pending game invites + friend requests; located inside `#btn-notifications-home`. Controlled by `MENU_REFRESH` `unreadCount` field.
- `#btn-notifications-home`: notification bell in top bar (Electric Menu redesign). Clicking emits `MENU_INTENT.OPEN_NOTIFICATIONS` → opens `#snotif`.

### Notifications Inbox Screen (`#snotif`)

Source: `partials/screens/notifications-inbox.html`, `src/ui/screens/notificationsScreen.js`

Load-bearing IDs (do not rename without updating `notificationsScreen.js`):

```
#snotif               — notifications inbox screen container
#notif-empty          — empty-state message (shown when no pending items)
#notif-invites-wrap   — game invites section wrapper (hidden when no invites)
#notif-invites-list   — rendered invite cards (event-delegated click handling)
#notif-friends-wrap   — friend requests section wrapper (hidden when no requests)
#notif-friends-list   — rendered friend request cards (event-delegated click handling)
#notif-back-btn       — back to home button
```

Button `data-*` attributes used for event delegation (do not rename):
- `data-notif-accept-invite` — accept game invite (value = inviteId)
- `data-notif-reject-invite` — reject game invite (value = inviteId)
- `data-notif-accept-friend` — accept friend request (value = fromUid)
- `data-notif-reject-friend` — reject friend request (value = fromUid)

---

## Joker Picker

Source: `src/ui/screens/jokerPicker.js`

When a joker tile is placed, a letter-selection modal opens. The player chooses a Hebrew letter. The joker then represents that letter for scoring and dictionary purposes (but is stored as `isJoker: true, letter: '?'` in state; the chosen letter is tracked by the UI layer).

Unknown / needs verification — exact joker representation in game state vs UI state not fully traced.

---

## Legacy Globals Used by UI

The spine UI still depends on some legacy global functions during migration:

```javascript
globalThis.setS(text, kind)     // legacy status bar display (used by toast renderer)
globalThis.settings             // legacy settings object (read by some screens)
globalThis.gameSettings         // legacy game settings
globalThis.__spine              // spine API (used by legacy code to call spine functions)
```

Do not remove these until the corresponding legacy code is removed.
