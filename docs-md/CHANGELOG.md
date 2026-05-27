# CHANGELOG.md — Change History

---

## Offline Save / Resume for 2P + vs-Bot (May 2026)

**Branch:** `fix-save-game`

**Summary:** Implements the pause-and-save / resume flow for offline games (offline-2p, offline-solo vs-Bot). Previously the "שמור וצא לתפריט" and "השהה ושמור" buttons silently discarded the game and the home Resume button never appeared. Now the active engine state is serialized to localStorage on save-and-exit and rehydrated on resume.

**What changed:**

1. **`src/game/sessions/localSaveService.js`** — new module. `saveLocalGame` / `loadLocalGame` / `clearLocalGame` / `hasLocalSavedGame` under the `spine.localSavedGame` key. Persists the full engine state (status === 'playing' only); converts the `state.bonusBoard` Map ↔ plain object across the JSON boundary; refuses payloads with the wrong version or mismatched schemaVersion.

2. **`createLocalGameSession`** ([src/game/sessions/localGameSession.js](src/game/sessions/localGameSession.js)) — accepts an optional `initialState` to bypass `createInitialState` and rebuild a session around a restored state.

3. **`gameFlowController.js`** — `PAUSE_INTENT.SAVE_AND_EXIT` for offline games now writes the state via `saveLocalGame` before tearing down. `EV.GAME_COMPLETED` clears the local save (a finished game is not resumable). `BACK_INTENT.LEAVE` and `PAUSE_INTENT.QUIT_NO_SAVE` clear the save only when the active game was resumed from it (`ag.resumedFromLocalSave === true`).

4. **`startGameViaSpine` + `resumeLocalGameViaSpine`** ([src/main.js](src/main.js)) — `startGameViaSpine` now accepts `restoredState` + `resumedFromLocalSave` flags. `resumeLocalGameViaSpine` reads the saved payload and replays the local-game lifecycle. `MENU_INTENT.RESUME_SAVED` falls back to it when no online async session is available.

5. **`menuScreen.js`** — the home Resume button (`#btn-resume-home`) is now also shown when `hasLocalSavedGame(localStorage)` returns true, so a paused offline game stays visible across reloads even if no online async sessions exist.

**Tests added:**
- `src/game/sessions/localSaveService.test.js` — 10 tests covering save/load round-trip (including the bonusBoard Map), bot/difficulty preservation, refusal of non-playing states / corrupt JSON / wrong version / mismatched schemaVersion, clear, null-storage no-op.
- `src/ui/controllers/gameFlowController.test.js` — 3 new tests: SAVE_AND_EXIT writes state for offline 2P, preserves bot/difficulty, and GAME_COMPLETED clears the save.

**What did NOT change:** Engine state shape, `EV.*` / `CMD.*` constants, Firebase paths, online-game save/restore (still handled by `sessionPersistence.js`), `schemaVersion` (still 2). Pending mini-game state survives in the saved payload but does not re-pop the modal on resume (accepted limitation — player loses that one bonus opportunity).

**Files modified:**
- `src/game/sessions/localSaveService.js` (new)
- `src/game/sessions/localSaveService.test.js` (new)
- `src/game/sessions/localGameSession.js`
- `src/main.js`
- `src/ui/controllers/gameFlowController.js`
- `src/ui/controllers/gameFlowController.test.js`
- `src/ui/screens/menuScreen.js`

---

## Achievements Section Redesign (May 2026)

**Branch:** `claude/achievements-redesign-plan-PgEtc`

**Summary:** Replaced the plain avatar emoji grid with a proper achievements hall — named cards with titles, descriptions, and progress bars. The "הישגים" nav button now leads to a screen that actually feels like achievements.

**What changed:**

1. **`ACHIEVEMENTS` table** (`src/ui/screens/avatarScreens.js`) — 8 named milestones that each map to a reward avatar. Each has a Hebrew title, description, unlock condition, and tier (bronze/silver/gold/legend).

2. **`progressPct(achievement, stats)`** — new pure helper (0–1 fraction toward completion).

3. **`findAchievementByRewardId(avatarId)`** — reverse lookup from avatar id to its achievement.

4. **Redesigned `paint()`** — renders a "starter" row (crown + star, always unlocked) followed by vertically stacked achievement cards. Each card shows emoji, title, description, progress bar with current/required count, and tier chip. Locked cards are semi-transparent and show a hint on click. Equipped avatar gets a checkmark.

5. **Screen title** — changed from "🎨 אוסף האווטארים" to "🏆 הישגים שלי" (`partials/screens/avatar-gallery-screen.html`).

6. **CSS** — added `.ach-card`, `.ach-progress`, `.ach-progress-fill`, `.ach-tier-chip`, `.ach-card-left`, `.ach-card-body`, `.ach-card-title`, `.ach-card-desc`, `.ach-card-meta`, `.ach-starter-row` to `styles.css`.

**What did NOT change:** `SPINE_AVATARS`, `isAvatarUnlocked()`, `diffNewlyUnlocked()`, unlock-popup system, all `AV_INTENT.*` / `AV_RENDER` event names. No Firebase, no game engine, no schema changes.

**Files modified:**
- `src/ui/screens/avatarScreens.js` — ACHIEVEMENTS table, progressPct, findAchievementByRewardId, rewritten paint()
- `src/ui/screens/avatarScreens.test.js` — new tests for ACHIEVEMENTS coverage, progressPct, findAchievementByRewardId
- `partials/screens/avatar-gallery-screen.html` — new title, flex-column grid
- `styles.css` — achievement card styles

---

## Speed Presets, Reject-name Fix, Favorite-Speed Stat (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** Three improvements to invite UX, game setup, and stats.

1. **Reject name fix** — Banner text "X דחה את ההזמנה" now uses `globalThis.__spine?.currentProfile?.displayName` as the primary source (email/password users had `fbUser.displayName === null`). Applied to both the invite-overlay reject handler and the notifications-inbox reject handler in `src/main.js`.

2. **Speed presets replace time-limit setting** — The "זמן מוגבל למהלך" toggle + seconds counter was removed from the Settings screen. In its place, each game-mode configuration window now has a 3-button speed selector: ⚡ בזק (20s) / 🎯 רגיל (40s) / 🐢 איטי (60s). Applied to:
   - Setup screen (local vs + bot games) — `partials/screens/setup.html` + `src/ui/screens/setupScreen.js`
   - Create-room overlay (friend online) — `partials/screens/online-create-room.html` + `src/ui/screens/createRoomScreen.js`
   - Matchmaking overlay (random online) — `partials/screens/online-matchmaking.html` + `src/ui/screens/matchmakingOverlayScreen.js`
   - Settings overlay — `partials/screens/settings.html` + `src/ui/screens/settingsScreen.js` (panel removed)
   - Default `botTime` changed from 20 → 40 in `settingsCompat.js`
   - Legacy globals `crToggleTL`, `crAdjTime`, `mmSetTL` removed; `crSetMode`/`mmSetMode` updated for new row IDs

3. **Favorite move-speed statistic** — New `moveSpeedStats` field in `EMPTY_STATS` tracks `{ played, won }` per speed key (20/40/60). `computeLiveGameStatsDelta` accepts `botTime` and uses `mergeMoveSpeedStats()`. `deriveStatsView` derives `favoriteSpeed` (speed with highest win%). Displayed in the Records tab as "קצב המשחק האהוב".

**Files modified:**
- `src/main.js` — reject name fix; removed crToggleTL/crAdjTime/mmSetTL; updated crSetMode/mmSetMode; matchmaking botTime wired; botTime passed to computeLiveGameStatsDelta
- `partials/screens/settings.html` — removed timelimit panel
- `src/ui/screens/settingsScreen.js` — removed timelimit toggle + botTime counter
- `src/game/settings/settingsCompat.js` — default botTime 20 → 40
- `partials/screens/setup.html` — added speed selector row
- `src/ui/screens/setupScreen.js` — botTime state, speed button wiring, PLAY_CLICKED payload
- `partials/screens/online-create-room.html` — replaced timelimit row with speed buttons
- `src/ui/screens/createRoomScreen.js` — readBotTime from speed buttons; timelimit always true for live
- `partials/screens/online-matchmaking.html` — replaced timelimit row with speed buttons
- `src/ui/screens/matchmakingOverlayScreen.js` — readBotTime; botTime in readMatchmakingFilters; speed button wiring
- `src/ui/screens/matchmakingOverlayScreen.test.js` — updated mock DOM + assertions for botTime
- `src/game/account/profileService.js` — moveSpeedStats in EMPTY_STATS; botTime param; mergeMoveSpeedStats helper
- `src/ui/screens/statsScreen.js` — favoriteSpeedFor helper; deriveStatsView + paint wired
- `partials/screens/stats-screen.html` — #st-fun-speed card in Records tab

---

## Notification Banner + Cancel-clears-invite (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** Three UX improvements to the invite and waiting-room flows.

1. **Cancel in waiting room now also cancels a live direct invite** — `WR_INTENT.CANCEL` handler reads `activePending.inviteId`/`inviteToUid` before teardown and calls `inviteService.cancelInvite`.

2. **Slide-down banner replaces blocking popups** — A `#notif-banner` element sits just below the fixed topbar (`z-index:49`). On a new incoming invite or a rejected-invite ack, a `NOTIF_BANNER_SHOW` event causes it to slide down with a 0.38 s ease animation. Clicking opens the notifications inbox (`openNotifications` action) or dismisses (`dismiss` action). Auto-hides after 7 s. `#ov-incoming-invite` and `#ov-invite-rejected` overlays are no longer shown.

3. **No popup on app open** — `bootInviteListenersFor` now tracks a `seenIds` Set and an `isFirstFire` flag. The first Firebase snapshot (existing invites at login/load) only updates the badge and inbox; the banner is suppressed. Only genuinely new invites that arrive after load trigger the banner.

**New files / modified:**
- `index.html` — added `#notif-banner`, `#notif-banner-avatar`, `#notif-banner-text`
- `menu-electric.css` — `#notif-banner` CSS (slide transform, hover, RTL text)
- `src/ui/screens/notificationsScreen.js` — `NOTIF_BANNER_SHOW` export, `mountNotifBanner()`
- `src/main.js` — `WR_INTENT.CANCEL` cancel invite; `bootInviteListenersFor` banner/no-open logic; `IR_OPEN` → `NOTIF_BANNER_SHOW`; mount `mountNotifBanner`

---

## Waiting Room — Async Close + Live Countdown (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** Async direct invites now close the waiting room after 1.5 s (no need to wait for the other player). Live direct invites show a countdown in the waiting room; when it hits zero, both the pending room code and the invite are cancelled on Firebase and the overlay closes.

**Modified files:**
- `partials/screens/online-waiting-room.html` — added `#wr-countdown` element
- `src/ui/screens/waitingRoomScreen.js` — new events `WR_LIVE_INVITE_SENT`, `WR_INTENT.LIVE_INVITE_EXPIRED`; countdown timer logic
- `src/main.js`:
  - `crSendInvite()` splits on mode: async → cancel pending room + close overlay after 1.5 s; live → store `inviteId`/`inviteToUid` in `activePending`, emit `WR_LIVE_INVITE_SENT`
  - `WR_INTENT.LIVE_INVITE_EXPIRED` handler: calls `teardownPending()`, `roomCodeService.cancelPending()`, `inviteService.cancelInvite()`, then emits `WR_CLOSE`

**Behavior:**
- Async invite: waiting overlay closes after 1.5 s with no further action required
- Live invite: countdown shows remaining time (5 min TTL); on expiry both pending room and invite are deleted from Firebase and the overlay closes

---

## Notifications Bell Inbox (May 2026)

**Branch:** `claude/notifications-bell-invitations-13YM9`

**Summary:** The bell icon in the top bar now shows a live badge count of pending game invites + pending friend requests. Clicking the bell opens a new inbox screen (`#snotif`) that lists both categories with per-item accept/reject buttons.

**New files:**
- `partials/screens/notifications-inbox.html` — inbox screen with two sections: game invites and friend requests
- `src/ui/screens/notificationsScreen.js` — screen controller exporting `NOTIF_INTENT`, `NOTIF_RENDER`, `mountNotificationsScreen`

**Modified files:**
- `src/ui/screenPartialManifest.js` — registered `notifications-inbox.html`
- `src/ui/screens/menuScreen.js` — `render()` now accepts `unreadCount` (number); badge shows count text when > 0
- `src/main.js`:
  - `MENU_INTENT.OPEN_NOTIFICATIONS` now routes to `snotif` instead of `so`
  - `bootInviteListenersFor` filters pending+non-expired invites, emits `NOTIF_RENDER` and `MENU_REFRESH` (badge count)
  - `activeRequestsWatch` also emits `NOTIF_RENDER` and `MENU_REFRESH` on change
  - `NOTIF_INTENT.ACCEPT_INVITE / REJECT_INVITE` handlers (same Firebase logic as `II_INTENT`)
  - `NOTIF_INTENT.ACCEPT_FRIEND / REJECT_FRIEND` handlers (same Firebase logic as `FRIENDS_INTENT`)
  - `NOTIF_INTENT.BACK` navigates home
  - Badge count resets to 0 on sign-out
  - `snotif` added to `showLegacyScreen` screen list

**Behavior:**
- Badge = `pendingGameInvites + pendingFriendRequests` (live, updates via Firebase listeners)
- Inbox shows empty state when no pending items
- Accepting a game invite starts the game (same flow as the popup overlay)
- Rejecting sends a push notification to the inviter
- Accepting a friend request writes the friendship bidirectionally

---

> Based on `git log --oneline -30` (last 30 commits visible from repository).
> Older history is not available in this output. Full history available via `git log`.

---

## Stats Screen Simplification (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Audited the stats screen and removed low-value / duplicated / placeholder stats. Collapsed 5 tabs (סקירה / ביצועים / בוסטים / יריבים / כיף) into 3 (תקדמות / שיאים / יריבים ובוסטים). UI-only change — `EMPTY_STATS` and Firebase storage are unchanged so existing user data is preserved.

**Removed from UI:**
- Average word length (`#st-avgword`) — narrow range, undifferentiating
- Points per tile (`#st-pts-tile`) — redundant with points-per-move
- Average move time (`#st-move-time`) — `totalMoveTimeMs` is never written, so the card always rendered `—`
- Wins vs stronger / weaker (`#st-vs-stronger-w`, `#st-vs-weaker-w`) — not actionable without rating-delta context
- Boost impact wins / best (`#st-boost-impact-wins`, `#st-boost-impact-best`) — definition is too loose (any boost-triggered win)
- Winning combo (`#st-boost-combo`) — complex to compute, low payoff
- Luck index (`#st-fun-luck`) — just `clamp(winRate, 1, 99)` renamed
- Duplicated tier badge on performance tab (`#st-perf-tier-badge`) — hero card already shows tier
- Empty rank placeholder (`#st-hero-rank`) — never populated, no global leaderboard yet
- Win-rate / streak duplicates under W/L bar (`#st-wr-pct-lbl`, `#st-streak-lbl`)

**New tab structure:**
- **תקדמות (Progress)** — sparkline, ELO/tier bar, high score, avg score, games played, points/move, W/L/D bar
- **שיאים (Records)** — longest word, longest streak, fastest win, biggest comeback, most repeated word, best weekday, share button
- **יריבים ובוסטים (Rivals & Boosts)** — rival leaderboard, boost totals/avg/win-rate, favorite boost, clutch cluster (comeback / last-move / close wins)

**Changes:**

- `partials/screens/stats-screen.html`
  - Replaced 5-tab tabbar with 3 tabs.
  - Rebuilt panel HTML around the 3-tab grouping; dropped low-value cards.
  - Hero card dropped the rank KPI; shows 2 KPIs (win rate + current streak).
  - Share button moved to the Records tab.
  - New ID: `#st-fun-streak` for the longest-streak fun card.

- `src/ui/screens/statsScreen.js`
  - `paint()` no longer writes to removed DOM IDs.
  - `tabFromButton()` parses the new tab labels (תקדמות / שיאים / יריבים).
  - `deriveStatsView()` no longer returns the unused fields (`avgWordLength`, `pointsPerTile`, `avgMoveTime`, `boostImpactWins`, `boostComboHtml`, `luck`, `rank`).
  - Removed dead helpers `boostComboHtml()` and `formatDurationAverage()`.

- `src/ui/screens/statsScreen.test.js`
  - DOM mock IDs and tab labels updated to match the new layout.
  - Tab assertion now checks `#st-panel-records` instead of `#st-panel-performance`.
  - Empty-stats test now checks `#st-fun-fastest` (the kept card) instead of `#st-move-time`.

**Files changed:**
- `partials/screens/stats-screen.html`
- `src/ui/screens/statsScreen.js`
- `src/ui/screens/statsScreen.test.js`

**Notes:**
- `EMPTY_STATS` in `src/game/account/profileService.js` is unchanged. `boostImpactWins`, `totalMoveTimeMs`, etc. continue to be written to Firebase but are no longer surfaced in the UI. A future cleanup pass can remove the orphan fields once the new layout settles.
- `totalMoveTimeMs` is still hardcoded to `0` at `profileService.js:251` — this remains an open item if move-time tracking is ever wired up.
- The `ratingService.applyEloForFinishedGame()` flow is fully wired; the ELO/tier UI shows real values.

**Follow-up tweak:** Removed the redundant stats-screen topbar (back arrow + refresh button) — the persistent app-wide top bar already provides navigation. Tightened the hero card layout: tier badge now sits inline next to the display name on the same row, and the avatar is sized down (48px → 36px) so the info column no longer gets squeezed with only 2 KPIs visible.

**Follow-up tweak 2 (2026-05-27):** User-reported issues:

- Removed **fastest-win** card (`#st-fun-fastest`) — abandoned games skewed the stat (a 16-second "win" really meant the opponent left).
- Removed **points-per-move** card (`#st-pts-move`) — `totalMoves` is under-tracked in `computeLiveGameStatsDelta`, producing impossible values (e.g. 83.2 pts/move). Until the tracking is fixed the metric is noise.
- Renamed `שיא ניקוד` → `שיא ניקוד למשחק` and `ממוצע ניקוד` → `ממוצע ניקוד למשחק` so the labels make clear these are per-game (not per-move) totals.
- Removed the **time filter** UI (`שבוע`/`חודש`/`הכל`) entirely. Only the sparkline ever respected the period; every other card used cumulative totals, so the filter was misleading. Restoring proper time-windowed stats requires per-game history beyond the current 20-game `recentGames` cap.
- Fixed the **W/L bar** colors: removed the inline `direction:ltr` so the bar follows the RTL flow of the card. Now green (wins) aligns under the ניצחונות label on the right, red under הפסדים, gray under תיקו.

**Files changed:**
- `partials/screens/stats-screen.html`
- `src/ui/screens/statsScreen.js` — dropped `period` parameter, `pointsPerMove`/`fastestWin`/`filteredRecent` fields, `setActive`/`filterRecent`/`btnTextPeriod`/`formatDuration` helpers, `PERIOD_MS` constant, `win._statsTimeFilter` global
- `src/ui/screens/statsScreen.test.js`
- `src/main.js` — dropped the `globalThis._statsTimeFilter` shim
- `tests/e2e/non-menu-buttons.spec.js` — updated to match the new 3-tab layout (no topbar, no time filter, no performance/fun tabs)

**Storage notes:** `fastestWinMs`, `totalMoves`, `totalScore` etc. are still written to Firebase — UI-only hide.

**Follow-up tweak 3 (2026-05-27):** Added **"הכי הרבה נקודות במהלך אחד"** (highest single-move score) to the Records tab.

- New stored field `highestMoveScore` in `EMPTY_STATS` ([src/game/account/profileService.js](src/game/account/profileService.js)).
- `computeLiveGameStatsDelta` walks the player's own `moveHistory` entries, takes the max `score`, and emits `highestMoveScore: { max: ... }` so the bump transaction keeps the running all-time best.
- Surfaced as `stats.highestMoveScore` in `deriveStatsView`, painted into `#st-fun-bestmove` on the Records tab.
- Tests: added assertions in [profileService.test.js](src/game/account/profileService.test.js) (`d.highestMoveScore === { max: 40 }` for the existing live-stats test) and [statsScreen.test.js](src/ui/screens/statsScreen.test.js) (rendered `92`).

---

## Profile Cleanup + Achievements Nav Repurpose (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** With the persistent topbar now providing the home button on every screen, redundant navigation in the profile screen could be removed. Also repurposed the bottom-nav "הישגים" (achievements) button to navigate to the avatar gallery instead of opening the champions/ratings overlay.

**Changes:**

- `partials/screens/profile-screen.html`
  - Removed the "← חזרה לתפריט" button (replaced by the topbar's home button).
  - Removed the "🎨 אוסף אווטארים" button (now reachable via the bottom-nav "הישגים" button; the avatar emoji at the top of the profile is still clickable too).

- `partials/screens/home.html`
  - Bottom-nav trophy button: `onclick="openChampions()"` → `onclick="showAvatarGallery()"`. Label "הישגים" and icon 🏆 kept. `showAvatarGallery()` is the existing global that emits `PROFILE_INTENT.OPEN_AVATARS` → navigates to `#sav-gallery`.

- `src/ui/screens/menuScreen.js`
  - Removed the `openChampions()` selector entry from `SCREEN_BUTTONS` (no button uses that onclick anymore).
  - Removed `MENU_INTENT.OPEN_CHAMPIONS` from the intent enum.

- `src/main.js`
  - Removed the `bus.on(MENU_INTENT.OPEN_CHAMPIONS, …)` handler (dead — no emitter remains). Champions screen can still be opened by the existing `CHAMPS_OPEN` flow from other call sites (e.g. end-of-game `bus.emit(CHAMPS_OPEN, {})` at main.js:460).

- `src/ui/screens/menuScreen.test.js`
  - Removed the `champions` mock button and its click + `OPEN_CHAMPIONS` assertion from the per-button intent test.

**Files changed:**
- `partials/screens/profile-screen.html`
- `partials/screens/home.html`
- `src/ui/screens/menuScreen.js`
- `src/ui/screens/menuScreen.test.js`
- `src/main.js`

---

## All-Screens Topbar Clearance Audit (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Audited every screen partial to confirm the persistent top bar doesn't cover content. The existing `.screen:not(#sh):not(#sg) { padding-top: var(--em-topbar-h) }` rule wins via specificity on every screen (verified `.screen:not(#sh):not(#sg)` = `(0,2,1,0)` beats `#ss { padding: 18px }` at `(0,1,0,0)`), but one screen used an inline `max-height: 92vh` that did not subtract the topbar height. Added a global belt-and-suspenders cap.

**Per-screen verification:**

| Screen | Container | Topbar-aware? |
|---|---|---|
| `#sh` home | `.em-home` `margin-top: var(--em-topbar-h)` | ✓ explicit |
| `#sg` game | topbar hidden by `screenTransitions.js` | ✓ N/A |
| `#ss` setup | `.sbox` centered; global padding-top wins over `#ss { padding: 18px }` (specificity) | ✓ |
| `#so` online lobby | `.online-wrap` centered | ✓ global rule |
| `#scoin` coin toss | `.coin-wrap` centered | ✓ global rule |
| `#sprofile` profile | `.sbox` centered | ✓ global + max-height cap |
| `#sfriends` friends | `.sbox` with **inline `max-height: 92vh`** | ✗ FIXED |
| `#sstats` stats | `.stats-wrap` `height: 100%` of content area | ✓ global rule |
| `#sauth-signup` sign-up | `.sbox` centered | ✓ global + max-height cap |
| `#sauth-login` log-in | `.sbox` centered | ✓ global + max-height cap |
| `#sav-gallery` avatar gallery | inner `height: 100%` fills content area | ✓ global rule |
| `#schamps` | stale ID, not in DOM (champions is `.ov` overlay) | ✓ N/A |

**Changes:**
- `partials/screens/friends-screen.html` — replaced inline `max-height: 92vh` with `calc(100svh - var(--em-topbar-h) - 16px)` so the box always fits between the topbar and the bottom edge.
- `menu-electric.css` — added a defensive rule capping any direct-child `.sbox` of a non-home, non-game `.screen` to `calc(100svh - var(--em-topbar-h) - 16px)` so future inline `max-height: NNvh` values can't overflow the topbar.

---

## Topbar + Bottom Nav Proportional Sizing (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** The top bar (`.em-topbar`) and bottom navigation (`.em-bottom-nav`) had hardcoded values and clamps capped at phone sizes (icon buttons at 33px max, avatar at 50px, nav icon at 28px, badge fully hardcoded at 13×13×7px). On tablets/desktop these elements stayed phone-sized while the rest of the home screen scaled up — visually inconsistent.

**Fix:** Same `clamp(min, min(vw, svh), max)` system as the platforms and logo. Each bar declares one base unit (icon-button size for the topbar, icon size for the nav) and derives everything else from it (label fonts, padding, gaps, badge, avatar emoji size, ELO badge, profile name max-width). Also fixed a stale duplicate `.em-home .hlogo img { max-width: 525px !important; }` rule that was overriding the proportional logo cap.

**Topbar custom properties on `#global-topbar`:**
```
--topbar-btn:    clamp(28px, min(7.5vw, 4.5svh), 60px)
--topbar-font:   --topbar-btn × 0.45
--topbar-gap:    --topbar-btn × 0.14
--topbar-avatar: clamp(42px, min(11vw, 6.6svh), 88px)
--topbar-avatar-em: --topbar-avatar × 0.50
--topbar-name:   clamp(12px, min(3.2vw, 2svh), 22px)
--topbar-name-max: --topbar-avatar × 2.4
--topbar-elo:    --topbar-btn × 0.32
--topbar-badge:  --topbar-btn × 0.40
```

**Bottom nav custom properties on `.em-bottom-nav`:**
```
--nav-icon:   clamp(22px, min(6vw, 3.6svh), 44px)
--nav-label:  --nav-icon × 0.40
--nav-pad-y:  --nav-icon × 0.42
--nav-gap:    --nav-icon × 0.12
```

**Resulting topbar button / nav icon sizes:**

| Viewport | Topbar btn | Avatar | Nav icon |
|---|---|---|---|
| iPhone SE 375×667 | 28px | 42px | 22.5px |
| iPhone XR 414×896 | 31px | 46px | 25px |
| iPad Air 820×1180 | 53px | 78px | 42.5px |
| Surface Pro 7 912×1368 | 60px (cap) | 88px (cap) | 44px (cap) |
| Nest Hub 1024×600 | 27→28px (min) | 40→42px (min) | 22px (min) |
| Desktop 1920×1080 | 49px | 71px | 39px |

**Also updated:**
- `:root --em-topbar-h` calc now uses the new button formula so screens still offset correctly below the fixed bar.
- Removed the `.em-nav-icon` and `.em-bottom-nav padding` overrides from `@media (max-height: 700px)` — the `svh` term in the new formula handles short heights inherently.
- Removed the stale `.em-home .hlogo img { max-width: 525px !important; }` rule (duplicate of the proportional rule declared earlier).

**Files changed:**
- `menu-electric.css` — topbar and bottom-nav refactored to use custom-property scale; stale logo duplicate removed; `:root` topbar-height calc updated.

---

## Home Screen Tablet Sizing — Raise Upper Caps (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** The proportional `min(vw, svh)` formulas on `.em-platforms` were correct, but the upper clamp values (`210px` online, `140px` secondary, `460px` logo) were tuned for phones and kicked in too early on tablets — iPad Air 820×1180 and Surface Pro 7 912×1368 hit the cap and stopped scaling, making the circles look small relative to the viewport.

**Fix:** Raised the upper bounds. The proportional formula now keeps scaling through tablet viewports and only clamps on 4K+ displays.

| | Lower bound | Upper bound (was → now) |
|---|---|---|
| `--circle-online` | 140px | 210 → **420** |
| `--circle-secondary` | 94px | 140 → **280** |
| Logo `max-width` | 200px | 460 → **720** |

**Resulting sizes:**

| Viewport | Online circle | Secondary | Logo |
|---|---|---|---|
| iPad Air 820×1180 | 330 (was 210) | 224 (was 140) | 531 (was 460) |
| Surface Pro 7 912×1368 | 383 (was 210) | 260 (was 140) | 615 (was 460) |
| Desktop 1920×1080 | 302 | 205 | 486 |
| 4K 3840×2160 | 420 (clamp cap) | 280 (clamp cap) | 720 (clamp cap) |
| iPhone XR 414×896 | 199 (unchanged) | 132 (unchanged) | 339 (unchanged) |
| Nest Hub 1024×600 | 168 (unchanged, svh-limited) | 114 (unchanged) | 270 (unchanged) |

**Files changed:**
- `menu-electric.css` — raised the `clamp()` upper bounds on `--circle-online`, `--circle-secondary`, and `.em-home .hlogo img max-width`.

---

## Home Logo Proportional Sizing (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Extended the home screen's proportional size system to cover the "בוסט" logo. Previously the logo width was set by three stacked breakpoint clamps in `styles.css` (`base`, `min-width:600`, `min-width:900`) plus a short-display override in `menu-electric.css` that caps it to `clamp(210px, 54vw, 278px)` at `max-height:700px` — leaving iPhone SE 375×667 with a noticeably smaller logo than iPhone XR 414×896.

**Fix:** Added a single proportional rule in `.em-home .hlogo img`:

```css
max-width: clamp(200px, min(82vw, 45svh), 460px) !important;
```

`min(82vw, 45svh)` lets the smaller viewport dimension constrain the size. Phones (width-limited) hit the `82vw` term and get a big logo (~80% viewport width). Short landscape displays (Nest Hub 1024×600) hit the `45svh` term and the logo stays at ~15% viewport height (3:1 aspect → width ≈ 45svh).

**Resulting widths:**
- iPhone SE 375×667: min(307, 300) = **300px** (was 210px capped)
- iPhone XR 414×896: min(339, 403) = **339px** (unchanged)
- Nest Hub 1024×600: min(839, 270) = **270px** (was 278px capped)
- iPad portrait 768×1024: min(630, 461) = **461px** clamped to 460
- Desktop 1440×900: min(1181, 405) = **405px**

**Files changed:**
- `menu-electric.css` — added `.em-home .hlogo img` rule; removed the now-redundant logo cap from the `@media (max-height: 700px)` block.

---

## Home Screen Proportional Size Scale (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** Replaced the home screen's per-breakpoint hardcoded `clamp(NN, Xvw, NN)px` values for circles, icons, and fonts with a single proportional size system. Six CSS custom properties on `.em-platforms` derive every dimension from one base — `clamp(140px, min(48vw, 28svh), 210px)` for the online circle, `clamp(94px, min(32vw, 19svh), 140px)` for secondaries — so the three game-mode circles, their icons, and their text scale together across phones, tablets, and short displays.

**Why min(vw, svh):** On phones (width-limited) the `vw` term constrains size; on short landscape displays like Nest Hub (1024×600, height-limited) the `svh` term constrains size. Same proportions everywhere, no per-device tuning.

**Derived ratios (from a single circle base):**
- Icon = circle × 0.45 (online) / × 0.42 (secondary)
- Title font = circle × 0.082 (online) / × 0.102 (secondary)
- Subtitle font = circle × 0.052 (online) / × 0.078 (secondary)
- Internal flex gap = circle × 0.045
- Text container max-width = 70% (geometrically fits inside the narrowing bottom curve at the centered text-block's y-position for both online and secondary circles)

**Key changes (`menu-electric.css`):**
- Added six size custom properties (`--circle-online`, `--circle-secondary`, `--icon-*`, `--title-*`, `--sub-*`, `--gap-*`) on `.em-platforms`.
- Refactored `.em-circle-btn`, `.em-circle-btn--online`, `.em-circle-icon`, `#home-globe`, `.em-circle-title`, `.em-circle-sub`, `.em-platform-col` to read from these vars.
- Removed the hardcoded `@media (max-height: 700px)` circle/icon/font overrides (they are now redundant — `min(vw, svh)` handles the short-height case proportionally). Kept the chrome-only adjustments (logo size cap, nav spacing).
- Removed the `@media (min-width: 400px)` title font bump for the same reason.

**Files changed:**
- `menu-electric.css` — `.em-platforms` size vars added; circle/icon/font rules refactored; redundant media queries deleted.

---

## Short-Screen Home Layout Fix — Online Subtitle + Size Contrast (May 2026)

**Branch:** `setup-md-files-and-update`

**Summary:** On devices with viewport height ≤ 700px (iPhone SE 375×667, Nest Hub 1024×600), the home screen's `@media (max-height: 700px)` rule hid all `.em-circle-sub` subtitles and left `.em-platform-col` at its base width (120-140px) while shrinking secondary buttons to 100-118px, leaving an empty halo that made the secondary row read as visually wider than the online circle. (Superseded by the proportional scale refactor above.)

---

## Home Icon + Two-Player SVG Update (May 2026)

**Branch:** `claude/icon-button-emoji-updates-UfFOM`

**Summary:** Two UI-only changes to `partials/screens/home.html`. No game logic, Firebase, or test files touched.

**Key changes:**
- **Home icon button**: Changed the top-bar "active page" icon from `⚡` to `🏠` — a house emoji more clearly communicates "you are on the home screen."
- **Two-player platform orb SVG**: Replaced the static two-person SVG with an updated version featuring explicit upper-body silhouettes (head circles + shoulder arcs) and an **animated bright encompassing line** — a double-layer ellipse trace (soft glow halo + crisp bright core) that continuously circles both figures using `stroke-dasharray`/`stroke-dashoffset` animation at 2.8 s per cycle.

**Files changed:**
- `partials/screens/home.html` — home icon emoji swap; two-player SVG replacement

---

## Main Menu Icon Upgrades — Spinning Globe + Custom SVGs (May 2026)

**Branch:** `claude/main-menu-emoji-updates-aGqo4`

**Summary:** Replaced the three emoji icons on the main menu platform cards with richer custom graphics. UI-only change — no game logic, Firebase, or test files touched.

**Key changes:**
- **Online platform orb**: Replaced `🌐` with a live canvas spinning globe (same orthographic renderer as the online-lobby title). The globe renderer was extracted into `src/ui/globeRenderer.js` to be shared between `onlineLobbyScreen.js` and `menuScreen.js`. `menuScreen.js` now starts/stops the globe on mount/unmount via `#home-globe` canvas.
- **Two-players platform orb**: Replaced `👥` with a custom inline SVG showing two layered person silhouettes in the game's blue palette (with subtle glow filter).
- **Bot platform orb**: Replaced `🤖` with a custom inline SVG robot featuring glowing square eyes, body indicator lights, and an **electrical pulse animation** — a glowing circle that travels from the antenna base up to the tip using SVG `<animate>` elements at 1.8 s per cycle.
- **CSS additions** in `menu-electric.css`: `#home-globe` (83% fill, border-radius 50%) and `.home-icon-svg` (1.15em square, `overflow: visible` for glow filters).

**Files changed:**
- `src/ui/globeRenderer.js` *(new)* — shared globe canvas renderer
- `src/ui/screens/onlineLobbyScreen.js` — imports shared renderer; removed duplicated LAND/startGlobe
- `src/ui/screens/menuScreen.js` — imports shared renderer; starts home globe on mount
- `partials/screens/home.html` — replaced emoji text with `<canvas>` and inline `<svg>`
- `menu-electric.css` — sizing rules for home globe and SVG icons

---

## Electric Floating Platforms Menu — Stage 5 Polish Fixes (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Three UI polish fixes reported via screenshot. CSS and SVG only — no JS or functionality changed.

**Key changes:**
- **Zigzag lightning**: Replaced smooth `Q` quadratic-bezier branches with multi-kink `L`-polyline zigzag paths (5 kink points per branch). Added a second overlapping strand per branch with slightly offset kink positions for a layered multi-filament lightning look. Branch endpoints pulled up from y=212 to y≈162 so they don't protrude below the secondary platform buttons. Removed stray terminal `<circle>` nodes.
- **Equal platform borders**: Primary platform border confirmed `2px` matching secondary (was `3px` in earlier stage).
- **Centered profile name**: `.em-profile-info` changed from `text-align: right` to `align-items: center` so the player name centers above the ELO badge.

---

## Electric Floating Platforms Menu — Stage 4 Gap-Report Pass (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Implements UI gap-report findings. CSS, manifest, index.html only — no JS or functionality changed.

**Key changes:**
- **PWA edge-to-edge**: `viewport-fit=cover` added to meta viewport (critical for iOS full-bleed). `theme_color`/`background_color` in `manifest.json` and `<meta name="theme-color">` updated to `#04081a`.
- **Near-black background**: `#sh.screen` background override removes the `#03759f` teal stop, replacing with `linear-gradient(165deg, #020614, #030818, #040b1e)`.
- **Safe-area top**: Topbar `padding-top` uses `max(clamp, env(safe-area-inset-top))` for notched phones.
- **3D slab bottom face**: Added `box-shadow: 0 9/12px 0 rgba(dark)` as crisp bottom edge — the CSS 3D slab trick. Combined with the large-offset lift shadow, platforms now visually stand on a ledge.
- **Border hierarchy**: Primary platform border `3px`, secondary `2px`.
- **Icon depth**: Secondary icons ≈ 70px; primary ≈ 80px. Both use `radial-gradient` with a specular highlight at top-left quadrant for a 3D sphere appearance. Deeper embed (−35/−46px).
- **Logo glow**: Multi-layer `drop-shadow` chain (7px → 22px → 52px bloom halo).
- **Bottom nav**: Taller (~80px via padding 10–14px). Nav icons 22–28px. Active item has a gold pill background. Top border replaced with CSS `mask` gradient fade.
- **Lightning pulse animation**: `emLightningPulse` fires a bright `drop-shadow` flash every 3.8s, staggered between main bolt and branches.
- **Particle drift**: `emParticleDrift` 14s slow translateY/X on the particle field layer.

---

## Electric Floating Platforms Menu — Stage 3 Depth Pass (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Stage 3 depth and floating-platform refinement. CSS and SVG only — no JS, IDs, or functionality changed.

**Key changes:**
- **Floating illusion**: Replaced ambient glow shadows with large Y-offset `box-shadow` (e.g. `0 26–34px 60–88px rgba(0,80,230,0.36)`) that mimics a shadow cast onto ground below a suspended object. Hover rises 4px, shadow stretches.
- **Metallic rim**: Taller (25–32px), wider (82–90%), stronger neon edge glow, specular highlight row at top.
- **Icon orbs**: Online icon 28% larger (68–84px), embedded 44px deep into primary rim. Secondary icons 50–62px, 30px embed. All orbs z:5, above rim z:2, so icon crowns the socket.
- **Lightning**: Center bolt adds extra zigzag kink; branch arms use quadratic bezier curves (`Q`) for organic energy-transfer feel. Larger halo stroke (9–11px), stronger blur.
- **Background depth**: `em-home::before` sparse particle field (12 tiny radial dots). Stronger radial glow behind primary platform. Diagonal light rays. Energy field opacity raised on `em-platforms::before`.
- **Vertical compression**: Platform row gap reduced ~35%. Bottom padding on platforms shifts cluster slightly upward. Logo margins tightened.
- **Top bar**: Avatar 12% smaller with inner glow ring. Icon buttons 8% smaller, tighter pill gap. ELO badge recolored from gold to electric blue.
- **Bottom nav**: ~15% shorter padding. Inactive items 50% opacity. Active home gold glow strengthened.

---

## Electric Floating Platforms Menu — Phase 2 Visual Polish (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Premium visual pass on the Phase 1 layout. CSS and SVG changes only — no JS, IDs, routing, or functionality changed.

**Changed files:**
- `menu-electric.css` — complete rewrite with premium platform architecture
- `partials/screens/home.html` — SVG lightning upgraded to double-path glow technique

**Key changes:**
- Platforms: icon orbs overlap button tops via `margin-bottom: -Npx`; metallic elliptical disk rim via `::before`; upper glossy highlight via `::after`; `overflow: visible` so rim protrudes; primary platform 1.5× wider with `emPrimaryPulse` glow animation
- Background: atmospheric radial glows + electric crack lines on `em-home::after`; energy field radials on `em-platforms::before`
- Lightning SVG: double-path technique (wide halo + sharp core per bolt); junction and terminal circle nodes; `em-lightning-main` / `em-lightning-branch` flicker animation in opposite phase; second filter `em-glow-sm` (2px blur)
- Top bar: icon buttons in glassmorphism pill container; circular buttons with neon border; ELO styled as glowing gold chip `⚡ ELO 1230`
- Bottom nav: 52% opacity on inactive items; gold active-home glow; tighter padding; `clamp()`-based sizing
- Animations: `emFloat` 3px / 4–6s alternate; `emPrimaryPulse` 4.5s; `emLightningFlicker` staggered; `prefers-reduced-motion` disables all movement

---

## Electric Floating Platforms Menu Redesign — Phase 1 (May 2026)

**Branch:** `claude/boost-electric-menu-redesign-3LWAt`

**Summary:** Visual redesign of the main menu screen (`#sh`) into an "Electric Floating Platforms" premium hub. UI refactor only — no game logic, Firebase, or routing behavior changed.

**Changed files:**
- `partials/screens/home.html` — new layout: top bar (profile + ELO + icon buttons), BOOST logo, three floating platform cards, bottom navigation bar
- `menu-electric.css` (new) — all electric theme styles: dark navy, neon platform glow, floating animation, lightning SVG decoration, bottom nav, reduced-motion support
- `src/ui/screens/menuScreen.js` — added `OPEN_STATS`, `OPEN_FRIENDS`, `OPEN_NOTIFICATIONS` intents; ELO and avatar display in `render()`
- `src/main.js` — added handlers for new MENU_INTENTs; added `rating` and `avatar` fields to `MENU_REFRESH` payload
- `index.html` — added `<link>` for `menu-electric.css`

**New DOM IDs:**
- `#btn-notifications-home` — notification bell button in top bar
- `#home-elo-label` — ELO badge container (hidden when unauthenticated)
- `#home-elo-value` — numeric ELO text node
- `#online-badge` — moved from inside online button to inside notification bell

**New MENU_INTENT values:**
- `menu/openStats` — opens stats screen
- `menu/openFriends` — opens friends screen
- `menu/openNotifications` — opens online lobby (where async sessions are listed)

---

## Recent Changes (May 2026)

### Phase 1A Disconnect/Leave Flows (PR #203–206)

**Commits:**
- `dbd43192` Merge PR #206 — disconnect/leave E2E tests
- `75bd3d1b` Implement accumulating disconnect timer and app-close resign behavior
- `c1e801b5` feat: block live invite to mid-game recipient; push notification on invite send
- `15925e85` fix: detect closed tab even when Firebase WebSocket is unavailable
- `681fa025` fix: remove dangling onclick attributes on invite buttons; guard sw.js against chrome-extension:// URLs
- `500f66b0` fix: three phase-1A disconnect bugs + confirming tests
- `ef917f34` Add E2E tests for Phase 1A disconnect/leave flows; reveals PRESENCE_GRACE_MS regression

**Summary:** Phase 1A of disconnect/leave implementation complete. Covers: accumulating timer, app-close resign, tab-close detection without WebSocket, push on invite send, and blocking in-game recipient from receiving new invites.

---

### Online Mode Cleanup (PR #201)

**Commit:** `a6f35129` 1A complete

---

### Timer and Player Sync Bugs (PR #199–200)

**Commits:**
- `9667c6d3` Sync bottom row enable with timer/glow animation completion
- `3508719f` Fix rack visual lockout and timer/glow sync on opponent move

**Summary:** Fixed two visual sync bugs: rack buttons stayed locked during opponent's turn, and the score glow/timer didn't synchronize correctly.

---

### Random Opponent Matchmaking (PR #196–198)

**Commits:**
- `411b7af5` Fix friend invite dropdown: use module-level vars instead of boot() closure
- `d1d9249d` Implement friend invite dropdown in waiting-room screen
- `58b5e88a` Fix three bugs that prevented opponent disconnect/quit notifications
- `09baff3f` Fix matchmaking never pairing: null-coalesce empty queue snapshot

**Summary:** Implemented friend invite dropdown in waiting room. Fixed matchmaking pairing bug (null snapshot). Fixed three disconnect notification bugs.

---

### Search Partner Overlay / Globe Animation (PR #193–194)

**Commits:**
- `ac213b7b` Replace SVG globe with canvas globe with continents + proper 3D spin
- `beb7dd3a` / `9a7fed0d` Increase longitude offset increment in animation

**Summary:** Replaced SVG globe animation with canvas-rendered 3D globe with continent rendering and proper spin.

---

## Older History

Git log shows commits beyond PR #193 are not included in the last 30. To view full history:

```bash
git log --oneline
git log --since="2026-01-01" --oneline
```

The repository has been active through at least 206 pull requests based on visible PR numbers.

---

## Version Notes

- **Build version:** `boost-20260525044525` (cache name from `sw.js`, updated by `stamp-build.js`)
- **Firebase SDK:** v10.13.0
- **Playwright:** 1.60.0
- **Firebase Tools:** 15.18.0
- **`@firebase/rules-unit-testing`:** 5.0.1
- **Gradle:** 8.4 (Android wrapper)
