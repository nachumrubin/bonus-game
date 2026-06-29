# TASKS.md — TODOs, Risks, and Recommended Work

## Live pause + matchmaking + test gate — June 2026

- [x] Live games no longer offer "השהה ושמור" (it only resigned); pause/back
  overlays hide the save button when `online && !isAsync`, top-bar reads "סיום".
- [x] Reworked "חיפוש מדויק" semantics: exact-search makes ALL of a player's
  settings hard (speed + ratingRange); a flexible player imposes no hard
  constraint but gets the CLOSEST available opponent (`matchDistance` ranking:
  same speed → nearest rating → age). One strict + one flexible still pair, with
  the flexible side adopting the strict side's speed
  (`spineMatchmaking.resolveMatchSettings`). See DECISIONS.md
  (D-matchmaking-exact-search).
- [x] `npm run test:unit` now runs `src/**/*.test.js` too (was only `tests/unit/`);
  fixed the 16 pre-existing co-located test failures it surfaced. 1236 tests pass.
- [ ] Dead `MENU_INTENT.SHARE_GAME` intent + its `main.js` handler + `ui-rules.md`
  `#btn-share-game` notes remain after the home share button was removed — clean up.

## Game Debug Timeline — June 2026

- [x] Append-only debug timeline + snapshots + warnings in separate Firebase
  nodes (`src/game/debug/`), recorder wired in `main.js`, admin Debug tab,
  tri-panel replay, "report a problem" button, global error capture, rules +
  unit/emulator tests.
- [x] Fix: replay client panels rendered a blank board — client snapshots stored
  the engine's 2D board which round-trips through Firebase as a sparse object;
  `renderable()` now flattens to the canonical flat 100-cell shape (`flattenBoard`).
- [x] Fix: debug writes with an absent optional field (e.g. `TURN_CHANGED` with no
  `reason`) failed — RTDB `set()` rejects `undefined`; `debugLogger` now deep-prunes
  undefined on every write (`pruneUndefined`).
- [x] Fix: `/gameSnapshots` PERMISSION_DENIED — both clients raced the write-once
  node; server snapshots + validation are now host-only (`onServerRoom`).
- [x] Fix: `לא תואם` divergence fired every move — now judged on visible outcome
  (board tiles + scores) via `snapshotOutcomeKey`, not the full state hash.
- [x] Replay: render perimeter boost squares (`BDEFS`) on the 12×12 board with
  assignment, dropped tiles (`bonusBoard`) and used state (`bonusSqUsed`); recorder
  `renderable()` now captures those fields.
- [x] Replay transport simplified to step-back / play-pause / step-forward / draggable slider.
- [x] Replay: surface the bonus mini-game *outcome* per move — `buildReplayTimeline`
  merges `BOOST_ACTIVATED` events into each frame (`bonuses[]`), resolved against
  `bonusAssignment`; `replayScreen` shows a `#replay-bonus` pill strip (mini-game
  title via `describeBonus` + awarded effect/points).
- [x] Replay: scripted demo game fixture (`demoTimeline.js`) — runnable via
  `window.__spine.debug.openDemoReplay()`, pinned by `demoTimeline.test.js`, and
  captured frame-by-frame in `capture-replay-demo.spec.js`. Serves as the
  recorder/replayer regression guard for future versions.
- [x] Replay: time-aligned timeline grid (`buildTimeline`) — one row per second,
  a column per source showing what it saw then (`----` when nothing), multi-line
  cells for same-second events, current row highlighted, click-to-jump.
- [x] Replay: frames bucketed by second (`buildReplayTimeline`) too — one transport
  step advances all three boards together (a move is no longer 3 clicks); frame
  axis is 1:1 with the timeline rows.
- [x] Replay: `WORD_REJECTED` summary now includes the rejected word(s); placed
  tiles on used boost squares no longer dimmed. (Boost-square tiles only show for
  games recorded after the `bonusBoard` capture was added.)
- [x] Admin detail view slimmed to header + warnings; the per-event timeline and
  reports lists removed (replay grid covers the walkthrough).
- [ ] **Deploy the new rules**: `npm run test:emulator` then deploy (CI deploys
  on push to main). Until deployed, debug writes are denied in prod.
- [ ] Future: richer admin search (server-side index by date/appVersion), bot
  BOT_MOVE_* events, PLAYER_INVITED/JOINED at the invite layer, exchange-letter
  recording for byte-exact engine cross-checks.



## Default avatar — June 2026

- [x] New default avatar "anonymous player" (`common_17`), added to the common
  store tier; `DEFAULT_AVATAR` updated for new accounts.
- [ ] **Run the default-avatar migration** for existing users:
  `node scripts/migrate-default-avatar.mjs --dry-run` then without `--dry-run`
  (add `--include-unset` to also cover accounts with no avatar). Needs
  `npm i firebase-admin` + `GOOGLE_APPLICATION_CREDENTIALS`.

## Friends list — June 2026

- [x] Fix stale friend avatars (friends showed old achievement avatars instead
  of equipped v2 avatars): push-based snapshot refresh via
  `friendsService.syncSelfToFriends` + `syncMyProfileToFriends()` in `main.js`.
- [x] Removed the non-functional × close button from the back-confirm overlay.
- [ ] **Optional one-time force-heal** of existing stale edges (instead of
  waiting for users to come online):
  `node scripts/refresh-friend-avatars.mjs --dry-run` then without `--dry-run`
  (add `--names` to also refresh displayNames). Needs `npm i firebase-admin` +
  `GOOGLE_APPLICATION_CREDENTIALS`.

## Dictionary suggestions — June 2026

- [x] Fix "Permission denied" on user word-removal suggestions:
  `submitWordSuggestion()` no longer lists the admin-only
  `/dictionarySuggestions` collection; it reads/writes a deterministic
  per-user node (`suggestionKey(type, word, uid)`) instead.
- [ ] **Run the one-time key migration** so de-dup also catches suggestions
  written before this change (legacy `push()`-id rows):
  `node scripts/migrate-suggestion-keys.mjs --dry-run` then without `--dry-run`.
  Needs `npm i firebase-admin` + `GOOGLE_APPLICATION_CREDENTIALS`. Splits
  multi-user `suggestedBy` arrays into one node per uid and preserves
  approved/rejected status + earliest `createdAt`.

## Coin economy — June 2026

- [x] Hard cap on coin balances (`MAX_COIN_BALANCE = 100_000`) enforced on all
  read/write paths; self-heal on boot for over-cap accounts
- [x] Fix infinite-recursion coin payout (`RangeError: Maximum call stack size
  exceeded`): the `watchProfile` callback in `main.js` paid achievement rewards
  via `bumpCoins` before advancing `lastProfile`, so the transaction's optimistic
  re-fire re-detected the same achievement and paid forever. Now advances
  `lastProfile` before the payout loop → each reward pays once. **This is a likely
  source of the out-of-band coin inflation noted below.**
- [x] Defense-in-depth: `bumpCoins` carries a per-uid in-flight guard
  (`coinTxInFlight`) that suppresses synchronous re-entry for the same uid during
  the transaction's optimistic apply, without blocking legitimate sequential payouts.
- [x] `scripts/set-coins.mjs` admin reset helper
- [ ] **Run the reset for הודיה** (balance 1,185,490): either let the boot
  self-heal pull it to the cap on her next login, or run
  `node scripts/set-coins.mjs --name "הודיה" --coins <n>` with a service-account
  key for an exact value. (Needs `npm i firebase-admin` + GOOGLE_APPLICATION_CREDENTIALS.)
- [ ] **Investigate the source** of the out-of-band write (no code path can
  produce it) — likely a manual Firebase console edit or a one-off script.

## Avatar collection v2 — June 2026

- [x] Replace 36-avatar store set with 40 new avatars under `assets/avatars_v2/`
  (common 16, rare 8, epic 11, legendary 5)
- [x] Rewrite `avatarStore.js` catalog (id→file map, encoded src), fix store
  confirm-image path, delete old PNGs, update tests + SW + asset_inventory
- [ ] **Art polish:** some v2 filenames are batch-export artifacts
  (`common_1_1`, `rare_1_top_left`, `common_2_split`). Consider renaming to
  descriptive names for maintainability (ids are numeric so renames only touch
  the `STORE_TIERS.files` list).

## Statistics screen — June 2026

- [x] Fix: expanded collapsible "act" sections were clipped/unscrollable —
  added `min-height: 0` to `.stats-feed` so its `overflow-y: auto` engages
  inside the `overflow: hidden` `.stats-wrap` flex column
- [x] Accordion sections — only one open at a time
- [x] Clearer play-style bar values (real numbers instead of scaled bar %)
- [x] Removed duplicate rows from ניתוח מילים (longest word / best move score)
- [x] Replaced הבוסט האהוב with האות המועדפת (favorite starting letter), backed by
  a new `startingLetterCounts` stat
- [x] **Art:** Boost-family icons for the stats screen — 4 section headers + 4
  weekly KPI chips created and wired into `stats-screen.html` / `statsScreen.js`
  (replaced the emoji), precached in `sw.js`. The favorite-letter card keeps its
  dynamic Hebrew-letter glyph, so no static icon was needed there.

## Admin monitoring dashboard — June 2026

- [x] `#topbar-admin-btn` in global topbar (visible only to admins)
- [x] `#sadmin` screen — 3-tab admin panel (Stats / Players / Words)
- [x] Stats tab: total players, active this week/month, tier distribution,
  dictionary health (approved/blocked counts), pending suggestions count
- [x] Players tab: full `/globalRatings` table sorted by rating descending
- [x] Words tab: pending suggestion approval (Approve ✓ / Reject ✕ per row)
  + direct add/remove inputs (moved from Settings overlay)
- [x] Removed `#dict-mgmt-panel` from Settings; `setDictMgmtVisible()` replaced
  by `setAdminBtnVisible()` in main.js
- [ ] **Polish:** consider adding pagination or virtual scrolling for large player
  tables (> 500 rows)
- [ ] **Polish:** add search/filter to the players tab

## Dictionary suggestions + word_contributor achievement — June 2026

- [x] Raise app loading intro time to ≥10 s (was 6 s)
- [x] Restore `/dictionarySuggestions` Firebase path + rules (user append-only, admin read)
- [x] `submitWordSuggestion` — any signed-in user can suggest a word for admin review
- [x] `findPendingSuggestionsForWords` + `markSuggestionsApproved` — give credit when admin approves
- [x] `setUserSuggestVisible` in main.js — shows suggestion panel for any non-anonymous user
- [x] Settings section "💡 הצע מילה למילון" (`#user-suggest-panel`) with input + status
- [x] `wordsAccepted` stat added to `EMPTY_STATS` in `profileService.js`
- [x] `word_contributor` achievement (20 accepted suggestions → 250 coins, gold tier)
- [x] Admin UI to list/review pending suggestions (now in the admin screen Words tab)
- [ ] **Hardening:** prevent a user from spamming suggestions to farm the achievement —
  consider rate-limiting per-session or a daily cap on submissions

## Avatar store + coin economy — June 2026

- [x] Achievements decoupled from avatars → coin trophies: tapping no longer equips; coin prize shown per tile +
  hint + completion overlay; trophy-centric eval (`diffNewlyCompletedAchievements`); `data-ach-id` tiles
- [x] 3 purchase achievements (`first_buy`, `collector`, `legend_owner`) with `ownedCount`/`ownedInCategory`/
  `ownedCategories` conditions
- [x] Pure catalog `src/ui/screens/avatarStore.js` — 36 avatars across common/rare/epic/legendary + helpers
- [x] Profile economy fields (`coins`, `ownedAvatars`, `lastLoginDate`, `loginStreak`) + `bumpCoins`,
  `purchaseAvatar`, `computeDailyReward`/`claimDailyReward`, `normalizeProfileEconomy` in `profileService.js`
- [x] Earning: starter grant (sign-up), daily login + streak (boot), achievement-completion coins (diff loop)
- [x] Store UI: `#savatar-store` screen + `#ov-store-confirm` + `#ov-daily-reward`; entry from profile screen
- [x] Render-helper integration so equipped store avatars show everywhere (incl. opponent cards) — `avatarEmoji`
  pass-through + `avatarIconSrc` store-id resolution
- [x] Anonymous users gated to the account-upgrade prompt; PNGs excluded from sw.js precache
- [ ] **Hardening (not v1):** make purchases server-authoritative (Cloudflare Worker / Cloud Function) so coins
  can't be self-granted client-side
- [ ] **Hardening (not v1):** record `claimedAchievements[]` checked inside the transaction so achievement coin
  rewards are fully idempotent across devices/tabs
- [ ] Optional: surface a coin badge in the bottom nav (coins already flow through `MENU_REFRESH`)

## In-game UI bug fixes — June 2026

- [x] Pause/exit overlay no longer shows twice — `BACK_INTENT.PAUSE_AND_SAVE` performs save-and-exit directly instead of re-opening the identical `#ov-pause` overlay (`gameFlowController.js` shared `saveAndExit` helper)
- [x] "תור נוסף!" reward shows `assets/rewards/extra turn.png` instead of a tinted 🎯 glyph (`describeBoost` + `showBonusAwardOverlay` in `gameScreen.js`)

## Bonus/challenge popups — premium redesign — June 2026

- [x] Phase 1: shared premium chrome (CSS) for `#ov-bonus-intro`, `#ov-bonus`, `.bonus-award-card` — container, lightning header, gold title, cyan glowing progress bar, System-C buttons, huge gold reward numbers, hidden-word grid, 250ms entrance
- [x] Reusable premium primitives in `menu-electric.css` (`.bz-overlay`, `.bz-card`, `.bz-bolt`, `.bz-title`, `.bz-sub`, `.bz-btn`/`-gold`/`-blue`/`-green`, `.bz-burst`) — adopt these in each game instead of inline cssText
- [x] Phase 3 (shared FX): `src/ui/screens/miniGames/bonusFx.js` — `confettiBurst`, `countUp`, `showBonusResult` (premium success/failure screens); CSS for confetti, `.bz-result*`, `.bz-chip`, premium `.ut`/`.lsbox`/`.ri`. 9 tests in `tests/unit/bonus-fx.test.js`
- [x] Phase 2: per-game premium passes (all complete — each keeps its mount contract + `*.test.js` green):
  - [x] Lucky Wheel (`wheelMiniGame.js`) — glossy wheel + gold rim, bigger slot icons, glowing pointer, premium hub, gold spin button, reward-explosion bloom
  - [x] Word Bee / honeycomb (`honeycombMiniGame.js`) — gold center + ceramic outer tiles, reward chips, celebration/encouragement end states
  - [x] Hidden Word (`hiddenWordMiniGame.js`) — premium self-host, gold button, `showBonusResult` (grid already premium)
  - [x] Personal Boost / crossword (`crosswordMiniGame.js`) — premium card + result header, confetti on clean win, friendly fail
  - [x] Crossing Words (`crossingWordsMiniGame.js`) — premium self-host, green check, `.bz-result` win/soft screens
  - [x] Fill-Middle (`fillMiddleMiniGame.js`) — ceramic `.ut` tiles, green check, `.bz-result` + confetti
  - [x] Unscramble (`unscrambleMiniGame.js`) — premium card, cyan timer bar, ceramic tiles, `.bz-result` win + confetti
  - [x] Letter Spinner (`letterSpinnerMiniGame.js`) — premium `.lsbox`, gold buttons, reward chips, `showBonusResult`
- [ ] Future polish: per-game combo indicators, live word-validation flourishes, and richer hint-reveal animations (functional gaps, not blockers)

## Invite-contacts referral flow — June 2026

- [x] `src/ui/inviteFriends.js` — Contacts Picker → SMS, with share-sheet / clipboard fallback (`runInviteFlow`)
- [x] "חבר מביא חבר" achievement re-keyed `friendsCount min:10` → `invitesSent min:5` (avatar + achievement)
- [x] `invitesSent` stat added to `EMPTY_STATS`; bumped on successful invite
- [x] Friends-screen referral card made clickable (`INVITE_CONTACTS`); progress bar tracks invites, shows `/5`
- [x] `#fr-invite-status` flash messages; `.fr-invite-status` CSS
- [x] 14 unit tests in `tests/unit/invite-friends.test.js`
- [ ] Replace `PLAY_STORE_URL` placeholder package id with the real listing URL at publish
- [ ] Fallback paths (share/clipboard) grant the achievement on a single completed action since recipients can't be counted — revisit if abuse becomes a concern

## Loading-screen Tips system — June 2026

- [x] `data/tips.json` — 23 tips across beginner / intermediate / advanced / didYouKnow
- [x] `src/ui/loadingTipsService.js` — weighted selection, history, games-played cache
- [x] `index.html` — tip card HTML (icon, title, text, nav arrows, dots) in `#app-loading`
- [x] `src/main.js` — carousel wired in `wireAppLoading()`; `cacheGamesPlayed` on profile load
- [x] `styles.css` — `.app-loading-tips` / `.app-loading-tip-*` glass-card design
- [x] 17 unit tests in `src/ui/loadingTipsService.test.js`
- [ ] Future: admin/dev tip management screen (`ניהול טיפים`) — view/enable/disable/edit tips without code changes
- [ ] Future: migrate `tips.json` to Firestore `/tips` collection for remote management

## Secondary Screens — premium Boost redesign — June 2026

- [x] My Games: System C back button (30 px, less dominant)
- [x] My Games: Poke button (👋) restyled as 44 px circular badge
- [x] My Games: Score pill visual weight reduced; name bumped to 15 px
- [x] My Games: Empty state → premium dark-glass card with icon, title, subtitle
- [x] My Games: Header icon + gradient divider
- [x] Coin Toss: Premium container with radial gradient background + ambient rays + star dots
- [x] Coin Toss: `.coin-float` gentle bob animation (3.2 s, independent of flip)
- [x] Coin Toss: Glow ring aura around coin (`.coin-glow-ring`)
- [x] Coin Toss: Gold gradient text for `.coin-msg`; premium disabled state for CTA
- [x] Notifications: `nf-shell` scrollable container replacing `.sbox`
- [x] Notifications: `nf-header` with bell icon + gradient divider
- [x] Notifications: Premium empty-state card with bell icon + "אתם מעודכנים ✔"
- [x] Notifications: `nf-section-hdr` gold sub-headers for game/friend sections

## Settings Screen — premium 4-section redesign — June 2026

- [x] Replace `.set-panel` grid with scrollable `.sett-section` column layout
- [x] Sticky `.sett-header` with icon + title + close × button
- [x] Section 1 (🎵 שמע): music + sound FX as `.sett-row` rows with gradient-line header
- [x] Section 2 (🎮 משחק): vibration, gender address, notifications as rows
- [x] Section 3 (🧠 כלי עזר): word checker as premium tool block
- [x] Section 4 (📚 ניהול מילון, admin-only, hidden): green add card + red remove card
- [x] Blue active state for `.set-yn.active-yes` (override of default gold `var(--by)`)
- [x] Footer CTA `.sett-confirm-btn` with enhanced glow
- [x] All IDs and onclick attributes preserved; `settingsScreen.js` wiring unchanged

## Victory Screen — premium celebration redesign — June 2026

- [x] Trophy hero section with radial glow and CSS sparkle dots
- [x] Gold gradient victory headline + subtitle
- [x] Premium player cards with winner (cyan/gold) / loser (pink) / draw states
- [x] Avatar rendering via `setAvatarEl` (bot.png for bot, achievement PNG or emoji for user)
- [x] Leaderboard header with gradient side lines + cyan node text
- [x] Medal emojis (🥇🥈🥉) for top-3 leaderboard rows
- [x] Current-user row highlight (`.champ-me`, gold tint) via `CHAMPS_RENDER` post-processing
- [x] Entry animations: trophy bounce-in, title/cards/lb staggered fade-up (total ~500 ms)

## Home Screen — premium action cards — June 2026

- [x] Replace circular floating-platform buttons with three stacked System C action cards
- [x] Card layout: PNG icon (left) + title/subtitle (center, RTL) + glowing circular chevron (right)
- [x] Color variants: online = cyan, bot = blue, 2p = purple
- [x] Staggered entrance animation per card (200–300 ms)
- [x] Short-display responsive tweak (subtitle hidden at ≤ 620 px height)

> Derived from: `SPINE_TODO.md`, `docs/legacy-vs-new-gap-report.md`, `docs/legacy-gameplay-parity-gap-report.md`, source code analysis
> All items are evidence-based — not invented.

---

## Match Flow System — premium redesign — June 2026

- [x] `mf-*` CSS system in `menu-electric.css`: hero icon, opt-cards (.active + .a), mf-cta, mf-cancel, mf-code-input, animated dots
- [x] Online Lobby: floating animated globe, ol-hero header, larger omode-btn icon badges
- [x] Create Room overlay: hero icon, card-based mode + speed selectors, green CTA
- [x] Join Code overlay: hero icon, large monospace code input, clear hierarchy
- [x] Matchmaking overlay: hero icon, card-based mode + speed + rating selectors, animated search dots
- [x] Partner Search overlay: pulsing dice icon, animated dots, glass player cards, my-card heartbeat glow
- [x] Setup screen: difficulty + speed + racks all converted to mf-opt-card; mf-setup-header title area

## Friend detail popup — premium visual redesign — June 2026

- [x] Avatar hero with 110 px glow ring + crown on top; name as large centered heading
- [x] 3-column stat widget (🎮 משחקים / 🏆 ניצחונות / 🛡 הפסדים) replacing plain text; win-rate removed
- [x] Recent games: colored win/loss indicator circle + ltr score display + time-ago string
- [x] Active games empty state: icon + friend's name in message; no conditional invite button
- [x] Permanent green CTA "✉ הזמן למשחק" at bottom of overlay
- [x] Overflow menu (⋮) with הסר חבר + future slots; removed large red remove button
- [x] Wider popup: min(360px, 94vw)

## UI modernization: secondary screens — June 2026

- [x] Replace 👤 emoji with `anonymous player.png` everywhere (centralized in `avatarMarkup`/`setAvatarEl`; menuScreen sign-out; index.html initial HTML)
- [x] Bot player avatar → `bot.png` via special `'bot'` avatar ID; matchmaking slot reel → achievement PNG icons via avatar IDs
- [x] Sliced 8 new icons from `more_navigation_buttons.png` (trophy, dice, key, logout, rematch, pause, play, search)
- [x] CSS: `.glass-panel`, `.ui-icon`, `.screen-hd-icon`, `.section-title-bar` utility classes; upgraded `.sbox`, `.stat-card`, `.fun-card`, `.fsc-c`, `.omode-btn`, `.set-panel`, `.set-yn`
- [x] Settings screen: PNG icons (settings, sound_on/off, bell, search), glass-panel sections
- [x] Statistics screen: statistics.png header, sopt-btn tabs, glass-panel hero, section-title-bar labels
- [x] Profile screen: title cleanup, glass-panel stats grid, PNG button icons, profileScreen.js onboarding icon
- [x] End game: trophy.png + rematch.png + home.png icons
- [x] Pause overlay: pause.png header, play.png resume button (gender-safe span wrapper)
- [x] Online lobby: home.png / key.png / dice.png in .omode-ic spans
- [x] Async games: my_games.png empty-state icon
- [x] Setup screen: remove 👤 text from rack toggle

## Redesign: Achievements screen → trophy room — June 2026

- [x] Rebuilt `#sav-gallery` as a collectible trophy room: gold title + side lines, scrollable shelves of 3 (glossy plank + cyan underglow), big icon + title + gold/gray progress pill. Removed cards/progress-bars/tier-chips/starter selector.
- [x] Locked = real icon desaturated/darkened + padlock (not hidden); unlock pop/glow/lock-break animation; tap-to-equip preserved.
- [x] 10 achievement icons mapped from `assets/achievements/`; rest fall back to emoji until added (`ACH_ICON_BY_AVATAR_ID`).
- [x] Dropped crown/star fillers (room shows the 17 achievements; header `<n> מתוך 17`).
- [x] All 17 icons now match their Hebrew title → icon path derived from `ach.titleHe` (no explicit map). `שחקן מנוסה` added; filename typos fixed. sw.js precache updated.
- [x] Locked overlay uses the gold padlock `assets/ui/lock.png` instead of the 🔒 emoji.
- [x] Icons normalized to one size (object-fit box) and bottom-aligned + plank overlap so they sit on the shelves.
- [x] Equipped avatar now displays the achievement trophy icon (topbar + profile) via `avatarIconSrc`, replacing the legacy emoji.
- [x] Extended to the rest of the app via shared `avatarMarkup`/`setAvatarEl` + `.av-img`: in-game player/opponent strip, friends list+detail, notification cards+banner, incoming-invite, matchmaking my/matched avatar, stats hero+rivals. Removed duplicated per-screen avatar→emoji tables. (Decorative slot-reel stays emoji; My-Games has no avatars.)

## UI: setup + online-lobby mode icons use the new PNGs — June 2026

- [x] Pre-game setup header icons (`#stitle-icon-vs` → 1v1.png, `#stitle-icon-bot` → bot.png) replace the old inline SVGs; span IDs kept so `setupScreen.js` toggling is unchanged.
- [x] Online lobby title globe: `<canvas id="ol-globe">` → `<img>` globe.png; removed the last `globeRenderer.startGlobe` use and **deleted `src/ui/globeRenderer.js`** (now unused).

## Fix: bottom nav overlapping mode circles on wide/short screens — June 2026

- [x] On aspect ≥ ~0.56 the circles are height-limited (23svh) and the cluster overflowed under the bottom nav (tablets + wide-short phones like 412×690/732). Fixed via `@media (min-aspect-ratio: 13/25)`: trim the logo + tighten gaps + center the cluster. Circles NOT shrunk. Tall phones (≤0.51) untouched. Verified positive nav clearance across a viewport matrix.

## UI: equal/level/tight game-mode cluster — June 2026

- [x] All three mode circles equal size (unified `--circle-mode`); online centered on top (removed left shift); bottom two on the same level (removed per-column offsets + `align-items: flex-start`); horizontal + vertical gaps tightened.
- [x] Icons enlarged to nearly fill each circle (container `0.58×`, `.home-circle-img` scale `1.62`; online globe `1.45` so its pedestal clears the title). Titles stay fully visible in the bottom band.

## UI: top-bar nav icons from navigation_buttons.png — June 2026

- [x] Sliced the `navigation_buttons.png` sheet into the six top-bar icons (home/help/settings/sound_on/sound_off/bell), overwriting the existing filenames so no markup change was needed. (Updated sheet was non-transparent 4+3 layout → circular alpha mask extraction; plain bell used over the red-dot variant.)
- [x] Simplified `.em-icon-btn--home-active` to a circular cyan glow (the new icons are their own round buttons, so the old square gradient background was redundant).
- [x] Scaled top-bar buttons ~1.4× (`--topbar-btn` + matching `--em-topbar-h` term).
- [x] Scaled bottom-nav icons 2× (`.em-nav-icon-img` × 1.15 → × 2.3); labels/padding left at base so icons dominate over text.

## UI: home-screen v1.1 polish (icon presence + cluster) — June 2026

- [x] Top-nav action icons enlarged ~17% (`.em-icon-img` 82%→96%), capsule height/spacing unchanged.
- [x] Bottom-nav icons enlarged 15% (`.em-nav-icon-img` × 1.15), labels/alignment unchanged.
- [x] Removed the three game-mode subtitles; titles only. Cluster pulled up toward the logo (`.em-platforms` flex-start), lower pair pulled toward centre (reduced row gap + 2P offset), and spread vertically into the freed space for breathing room.

## UI: main-screen icon swap to new PNG set — June 2026

- [x] Replaced home-screen + global-topbar emoji/SVG/canvas icons with the new 3D PNGs in `assets/` (`assets/navigation/`, `assets/icons/`, `assets/avatars/`). See CHANGELOG.
- [x] Precached the 13 used home/topbar asset PNGs in the `sw.js` `ASSETS` list so the home screen renders offline from install (rather than only after first runtime fetch). Cache-name bump left to `stamp-build` at deploy.
- [x] Toned down `.em-icon-btn` (`menu-electric.css`): the top-bar button is now a transparent tap target at rest (faint disk on hover only) so it no longer competes with the icons' own pedestal/glow. The `.em-icon-btn--home-active` "current page" indicator keeps its filled glow.

## UI: turn glow + My-Games turn colour + bell badge fix — June 2026

- [x] Active-player glow thickened (1px → 3px brighter border + stronger `playerGlowPulse`) for `.scbox.act` and `.is-pcard.act-cell` so whose-turn is obvious.
- [x] Bottom-nav 🎮 "המשחקים שלי" badge turns green (`.em-nav-badge--myturn`) when it's the player's turn in an active online game; red otherwise. New `myTurnInGame` field on `MENU_REFRESH`.
- [x] Notifications bell (`#online-badge`) no longer lights from the my-turn signal — it conflated `hasOnlineUnread` (your turn in a game, no inbox entry) with real inbox items, so the bell flashed over an empty window. Bell now reflects only `unreadCount` (invites + friend requests).

## Fix: bot passing repeatedly — alphabetical vocab bias — June 2026

- [x] Easy (and to a lesser extent medium) bot passed turn after turn. The bot vocab cap in `main.js` took a raw prefix of the now alphabetically sorted `dictionary.txt`, so the pool was ~all `א`-words; with no `א` available the bot had no legal move. Compounded by the cap being applied before `searchBotMove`'s `maxWordLen` filter (easy → only 87 usable ≤3-letter words).
- [x] Fix: pre-filter to `resolveProfile(difficulty).maxWordLen` before capping, and `shuffle` (seeded via `util/rng.js`) before `slice`. Hard cap is now `Infinity`. Easy usable vocab: 87 (all `א`) → 2,000 across 25 initial letters.

## Dictionary: plain text + remove DAWG + remove HSpell pipeline — June 2026

- [x] Switched dictionary from DAWG binary (`dictionary.v2.bin`) to plain sorted text (`dictionary.txt`, 73,173 words).
- [x] Deleted `src/game/core/dawg.js` and `src/game/core/dawg.test.js`.
- [x] Deleted `data/dictionary.v2.bin` and `data/dictionary.v2.meta.json`.
- [x] Deleted `tools/dictionary-build/` (HSpell AGPLv3 pipeline — no longer needed).
- [x] `hebrewDictionary.js` is now a pure text-based `Set` lookup; no DAWG code remains.
- [x] `absorb-firebase-dict.mjs` updated to merge words into `dictionary.txt`.
- [ ] Run `node scripts/absorb-firebase-dict.mjs --commit` locally to absorb any existing Firebase-approved words into `dictionary.txt` and clear the Firebase overlay.

## Dictionary: v1 removal + Firebase absorption script — June 2026

- [x] Removed v1 dictionary path (`loadDict`, v1 `isValid`, mode switching). `hebrewDictionary.js` is now v2-only.
- [x] Deleted `data/dictionary.base.txt`, `scripts/add-dictionary-words.js`, `scripts/export-dictionary-file.js`.
- [x] Bot now uses `DICT` instead of legacy frequency-sorted vocabulary.

## Dictionary additions from curated review list — June 2026

- [x] Added words from `words_sorted_for_review.txt`: 10,624 to `dictionary.base.txt` (40K→50K), 10,012 genuinely new words to `dictionary.v2.bin` (63K→73K). DAWG binary rebuilt and self-tested. Report at `added-words.txt`.

## Fix: forfeiting player not notified of game end — June 2026

- [x] `forceResync()` in `onlineGameSession.js` now emits `EV.GAME_COMPLETED` when the resynced room is in a terminal state (abandoned/completed/expired) and the session hadn't already transitioned. Closes the race where the opponent's watchdog-forfeit write races the forfeiting player's last-moment commit.

## Dictionary reject/accept lists → Firebase only — June 2026

- [x] Removed in-code `EXACT_REJECTS` / `CLASSIC_ALLOW` / `DEFECTIVE_ACCEPT` from `hebrewDictionary.js`; reject/accept now via Firebase overlays only (`BLOCKED_OVERLAY` / approved-overlay). Kept `COMMON_FALSE_POSSESSIVE` (morphology). Tests + docs updated.
- [ ] **Load `docs-md/dictionary-firebase-seed.txt` into Firebase** — REJECTED block → `/dictionaryRejected`, APPROVED block → `/dictionaryApproved`. Until then `נאצי` / `ירושלים` and the inflected prepositions are not blocked by the app. (Use the dictionary admin panel or Firebase console import.)
- [ ] (optional) Decide whether `tools/dictionary-build/*` should also stop applying its own `EXACT_REJECTS`/`CLASSIC_ALLOW` when the DAWG is next rebuilt.

## Fix: easy-bot default + Bubblewrap removal — June 2026

- [x] Easy bot played 5-letter words: the bot difficulty default was medium (1) while setup.html highlighted easy. Defaulted difficulty to 0 (easy) in `setupScreen.js` + `main.js` `START_VS_BOT`. Profiles unchanged (already correct).
- [x] Removed Bubblewrap: deleted root TWA/Gradle working copy + `twa-manifest.json`; build via the `android/` Android Studio project. Updated `firebase.json`, `FILE_INDEX.md`.
- [ ] (pre-existing, unrelated) 2 `setupScreen.test.js` title-text assertions + 2 `gameEngine.test.js` rack fixtures fail on HEAD; not in the `test:unit` gate. Fix when next touching those areas.

## Fix: timer_bonus (+10s wheel) — June 2026

- [x] Offline/optional modes: B13 `timer_bonus` now actually extends the turn clock. Engine records `state.turnTimerBonusMs` in `applyTurnStartEffects`; `turnTimerController.ensureDeadline` adds + consumes it. Plugin accumulates the delta. Tests in `turnTimerController.test.js` + `plugins.test.js`.
- [x] Online: `onlineGameSession.rawCommitCurrentState` adds `state.turnTimerBonusMs` to the next player's deadline (read once before the txn callback, cleared after the commit resolves → idempotent across retries). Test in `onlineGameSession.test.js` (mockFirebase). No rule change (no upper bound on `turnDeadlineMs`).

## B11 retune + new B14 mini-game — June 2026

- [x] B11 מילה נסתרת: timer 20s→10s, reward 100→30 (defs, data, gender/desc, guide, capture spec, tests).
- [x] New B14 **אות פותחת** (letter spinner): spin alphabet → stop on a letter → make words starting with it in 20s, scored by length like כוורת (reuses `wordPoints`). New `letterSpinnerMiniGame.js` + 9 tests; wired into `BONUS_TYPES`/defs/main.js/intro/gender; CSS `.lsbox`; guide figure + `letterspinner.png`.
- [ ] (pre-existing, unrelated) `src/game/core/gameEngine.test.js` has 2 failing CONFIRM_MOVE rack/dictionary fixture tests (`placed-not-in-rack`) — not in the `test:unit` gate; fix the rack setup when touching that area.

## B11 bonus redesign — June 2026

- [x] Replace תפזורת (word search) with **מילה נסתרת** (hidden word): 4×4 grid, one hidden 3-letter dictionary word, 20s timer; selections validated against the dictionary (not the hidden word) so any real word wins. New `hiddenWordMiniGame.js` + tests; removed `wordSearchMiniGame.js`; rewired B11 (`b11_hidden_word`), intro/gender copy, CSS, docs.
- [x] Regenerate the guide screenshot `images/guide/minigames/hiddenword.png` (e2e `hiddenword` shot); guide figure now points at it. Also fixed `showBonusOverlay` to hide the `#app-loading` splash that was clipping mini-game captures. Old `wordsearch.png` is now unreferenced (can be deleted).

## Bot difficulty distinguishability — June 2026

- [x] Make easy/medium/hard clearly distinct — `DIFFICULTY_PROFILES` + `pickMove` in `botSearch.js`; easy is now beginner-level (short words, low picks, weak opener, score ceiling, blunder chance). `main.js` vocab cap 5000→2000 for easy + per-level think time. Calibrated easy≈8 / med≈30 / hard≈34. Tunable constants flagged in GAP_REPORT.

## QA bug-fix batch — June 2026 (`Some-bugs-found` branch)

- [x] Async friend invite shows a toast instead of the waiting-room hourglass (`main.js` `CR_INTENT.CONFIRM`).
- [x] Settings overlay top-corner "×" close button (`#sett-close-x`).
- [x] Friend-detail avatar resolves id → emoji (no literal "crown") (`friendsScreen.js`) + test.
- [x] Cold-start push routing: `?resume=`/`?summary=`/`?open=` handled at boot (`main.js` `handleLaunchParams`).
- [x] "סיום" ends an async game (resign) — `gameFlowController.js`; home button stays leave-and-resume.
- [x] Coin toss only at game start — `startOnlineGameViaSpine` skips it once a room has moves.
- [x] My-Games screen live-updates on an opponent move — `main.js` watches each listed async room (`watchRoom`) while `#smygames` is open, tears down on navigate-away. Previously the card only refreshed on (re)open because the async index doesn't change on a move.
- [x] Game-over push is informative — names the winner from each player's perspective + final score (`notificationService` + `pushPayloadBuilder`, client + worker). Needs `cd worker && npm run deploy`.
- [x] Matchmaking 3-player race no longer double-books a partner — `tryPair` single-driver (lower uid) claims both queue nodes. See `DECISIONS.md` D-matchmaking-claim. ⚠️ Re-run the simulator matchmaking scenario (`npm run sim -- --scenario matchmaking`) against the emulator before relying on it under heavy concurrency.
- [x] "×2 boost triples score": **could not reproduce** — engine verified ×2/×4 correct, regression tests added (`gameEngine.test.js`). Confirmed by reporter as not an issue.
- [x] "Skipping a תפזורת still grants bonus points": **verified correct, no bug** — a 0-find skip commits only the base word score (resolveBonusActivation/resolveMiniGameResult/FINALIZE all award 0). Reporter confirmed the score came from the placed word, not the bonus. Regression test added (`engine-parity-highrisk.test.js`: "skipping an interactive mini-game … commits only the base word score").

---

## TODOs — Dictionary v2 rollout

The runtime swap + build-pipeline scaffolding landed in June 2026 (see CHANGELOG). What's left before flipping the default and removing the v1 path:

- [ ] **Run the build pipeline end-to-end.** Needs WSL/Linux for HSpell (perl + autotools). Steps: `bash 01-fetch-hspell.sh` → `node 02-enumerate.js` → `03a-extract-lemmas.js` → `03b-corroborate-lemmas.js` → `03c-filter-lemmas.js` → `03d-inflect.js`. Produces `output/lemmas-review.tsv` for the next step.
- [ ] **Acquire corroboration sources.** Hebrew Wiktionary lemma dump and Hebrew Wikipedia frequency list. Currently the pipeline runs without them (single-source HSpell) — every lemma falls to the review queue. With Wiktionary alone, expect ~70% of lemmas to auto-accept.
- [ ] **Native-speaker review of `pending-review.csv`.** Budget: 20–40 hours for the initial pass. Decisions go into `tools/dictionary-build/review/manual-decisions.tsv` and persist across rebuilds.
- [ ] **Seed `tools/dictionary-build/config/gold-positive.txt` from real player-rejection logs.** Every "this word should have been valid" complaint becomes a held-out test the build can't regress.
- [ ] **Legal sign-off on HSpell GPLv2.** See [tools/dictionary-build/LICENSE.md](../tools/dictionary-build/LICENSE.md) — if the project can't accept GPLv2 implications, switch to Hunspell `he_IL` or commission a permissive list.
- [ ] **Canary the `?dict=v2` flag.** Open the app with `?dict=v2` and exercise the formerly-rejected-real-words list. Watch the console for `[isValidV2]` logs.
- [ ] **Flip default.** Change `dictionaryModeFromUrl()` in `main.js` to default `'v2'`. Keep `?dict=v1` as a rollback switch for one release.
- [ ] **Cleanup commit (separate PR):** delete `data/dictionary.base.txt`, the v1 morphology chain in `hebrewDictionary.js` (`candidateLemmas`, `spellingVariants`, `POSSESSIVE_SUFFIXES`, `VERB_SUFFIXES`, `looksLikePrefixedParticle`, `looksLikePossessive`, `analyze`'s lemma branch), the v1 loader, and the mode switch. Update tests accordingly.

---

## TODOs — Online Simulator (Phase 5)

- [ ] Deferred-score split-write scenario: dispose the active session AFTER `MOVE_CONFIRMED(scoringDeferred=true)` but BEFORE `FINALIZE_BOOST_AWARD`. Verify the room state stays consistent (no half-committed move), the opponent's view isn't corrupted, and the reconnected session correctly sees the move as never-committed. Needs bonus-square placement to be driven deterministically (bonuses sit at off-grid edges; random bot rarely hits them) — either inject a scripted-move bot or seed the engine state with `state.pendingScoreCommit` directly.
- [ ] Admin-SDK exporter that pulls `moveHistory` arrays from prod rooms into the JSON shape `replayBot` expects, for `--replay` mode (needs prod creds).
- [ ] Presence/heartbeat stress: multiple concurrent `presenceService` writes from the same uid (multi-tab), verify `onDisconnect` cleanup doesn't fight presence heartbeat.

---

## Completed (June 2026)

- ✅ **ROOT CAUSE** of push not working: service worker never registered. `sw.js` precached with atomic `cache.addAll()` while the `ASSETS` list still referenced 3 deleted admin partials → every `install` 404'd → `SW registrations: 0` → no push token, no offline cache. Removed dead entries and switched to per-asset `cache.add().catch()` so a stale list entry degrades gracefully instead of killing the whole SW. Also added independent `sw.js` registration in `main.js` (app previously relied on OneSignal.init to register it).
- ⚠️ Follow-up: `sw.js` `ASSETS` list is hand-maintained and drifts when partials are added/removed; `scripts/stamp-build.js` only stamps the cache name. Consider generating the precache list from `screenPartialManifest.js` + a glob so it can't go stale again.
- ✅ Removed the temporary 🩺 "אבחון התראות" diagnostic panel (settings.html + `diagnoseNotifications` in main.js + `getLastBootError` in notificationService.js) now that push works end-to-end. Kept `isOneSignalReady()` — the duplicate-notification fix depends on it.
- ✅ Invite notifications now distinguish live (⚡ "למשחק עכשיו") vs async (📩 "למשחק תורות") via an `isLive` ctx flag through both payload-builder copies.
- ✅ Notification "הפעל" button no longer gets stuck on its spinner — `requestNotifPermission()` (`src/main.js`) now pre-checks push support (shows "לא נתמך בדפדפן זה" in unsupported/in-app webviews), wraps `boot()`/`optIn()` in timeouts, and always re-syncs the button state in a `finally`, so a hung OneSignal SDK leaves the control retryable instead of permanently disabled.
- ✅ Live-invite waiting room now closes on rejection (friend auto-invite path) — fixed an ordering bug in `CR_INTENT.CONFIRM` (`src/main.js`) where `activePending.inviteId` was assigned before `activePending` existed, so the invite-ack listener couldn't match a rejection to the open waiting room. Now captured into locals and folded into `activePending` at construction; also repairs WR-cancel invite revocation for the same path.
- ✅ Welcoming home-screen onboarding popup — the first-visit popup on `#sh` now opens with a short intro on what Boost is, four feature bullets (שבץ-נא, בוסטים/mini-games, statistics & insights, game modes), and a closing note pointing to the `?` button for full rules. Added optional `intro` / `note` fields to the onboarding content model (rendered by `onboardingController.js` into new `#onb-intro` / `#onb-note` elements; both `hidden` when omitted, so other screens are unaffected). See `partials/screens/onboarding-overlay.html`, `src/ui/controllers/onboardingController.js`, `src/ui/screens/menuScreen.js`, `styles.css`.
- ✅ Bot boost visibility — the human player now sees a modal overlay when the bot receives an auto-boost (B2/B4/B9) or a future-effect boost (B5/B6/B7), matching the 2P offline experience. Overlay is labelled "הבוט". Clicking אישור finalises the award. Mini-game and wheel bot bonuses (B1/B3/B8/B10/B11/B12/B13) are still auto-resolved silently — that's a separate follow-up.

- ✅ Stats "תובנות" tab — turned the stats area into a personalised analytics experience (archetype, dynamic insight cards, trend chips, week snapshot, word intelligence, play-style bars, opponent picks, milestones, did-you-know). Tabs reordered to `תובנות | התקדמות | שיאים | יריבים`. All derivation in pure module `src/game/account/playerInsights.js` with 23 unit tests; no schema changes. See CHANGELOG entry for "Stats screen: new תובנות tab" for the full breakdown of what's derived vs deferred (rating history, dated words, monthly windows still need new tracking infra).
- ✅ "המשחקים שלי" v3 — visual redesign: cards instead of a list (rounded 18px, navy gradient + soft shadow), score-dominant typography (gold mine + white theirs in a glowing pill), emoji-prefixed status pills (🟢/🕒/💾/🔵), compact gold-gradient Continue button, 🗑 dismiss icon (replaces the floating ×), header back-arrow + count badge (replaces the big footer button). All scoped to `#smygames` CSS; no functionality changes. Screenshot at `images/guide/my-games-screen.png`, capture spec at `tests/e2e/capture-my-games-screen.spec.js`.
- ✅ "המשחקים שלי" v2 — removed the floating "המשך משחק" home-screen play button; folded the localStorage-saved offline game into the same list (rendered with a 💾 badge + "משחק שמור" label, sentinel `roomId: '__local__'`, MG_INTENT.RESUME/DISMISS branch on the sentinel to call `resumeLocalGameViaSpine` / `clearLocalGame`); widened the modal to `min(460px, 94vw)`. See `partials/screens/home.html`, `partials/screens/async-games-screen.html`, `src/main.js refreshMyGamesList`, `src/ui/screens/asyncGamesScreen.js`.
- ✅ New "המשחקים שלי" screen — standalone list of all of the user's async online games, reachable from the home screen's bottom nav. Each row shows opponent avatar + name, current score, whose turn + time since last move, "המשך" to resume, "×" to remove from the per-user index. Expired games are surfaced too (sorted to the end) so users can see + clear them. Extended `asyncSessionService.listAsyncSessions(db, uid, { includeExpired })` and added `myScore` / `opponentScore` / `isExpired` to the summary shape. See `partials/screens/async-games-screen.html`, `src/ui/screens/asyncGamesScreen.js`, `src/main.js`.
- ✅ Async push bug fix — `TURN_CHANGED` push was fired from the recipient's side (`externalIds: [s.myUid]` when `currentTurnSlot === mySlot`), so async opponents who weren't online when the move synced never got notified. Flipped the async path to sender-side: when our move leaves our slot, push the opponent (`externalIds: [opponentUid]`, optional `subscriptionIds: [opponentSubscriptionId]`) with the body labelled by `myName`. Live mode (`ifBackgrounded`) keeps the existing receiver-side self-push. Sessions now expose `myName` via `sessionRef`. See `notificationService.js`, `main.js`.
- ✅ UI bug fix — clicking a pending lock now reliably returns it to the bucket. Previously, the single-click toggle inside `setPendingLock` cleared the lock, but a fast double-tap fell through to the auto-quick-place branch and re-placed the lock at the same cell, so the user saw no change. Added an explicit early-return for pending-lock cells in `onCellClick` + a short (500 ms) per-cell suppression window for the quick-place branch. See `gameScreen.js`.
- ✅ Engine bug fix — `handleConfirmMove` rack-defense incorrectly rejected `placed-not-in-rack` when a player reused a swap-displaced board letter in the same move. The UI was already designed to surface the displaced letter at the swap's rack slot for same-turn play (legacy `racks[turn][rackSlot] = returnedLetter` parity), so the engine was out of sync. Split the single-pass rack check into a swap-first pass that credits the rack copy with each swap-displaced letter, then validates `placed` against that effective rack. New regression test in [tests/unit/engine-placed-not-in-rack.test.js](../tests/unit/engine-placed-not-in-rack.test.js).
- ✅ Boost mini-game screenshots in the guide — six new PNGs under `images/guide/minigames/` captured by a new Playwright spec ([tests/e2e/capture-minigame-screenshots.spec.js](../tests/e2e/capture-minigame-screenshots.spec.js)) that mounts each mini-game with a seeded RNG and snaps the overlay. Each image embedded under "בונוסים ומיני-משחקים" with a matching caption. Side fix: exposed the previously-internal `mountFillMiddleMiniGame` on `window.__spine.ui`.
- ✅ Cherry-pick from `online-game-fixes` — surgical port of additive fixes that never reached `main`: guide-screen screenshots + the new "פעולות מיוחדות בתור" section, signup password-confirm + notify opt-in + 👁 show/hide on login+signup, friends `activeRoom` permission fix, easy-bot vocabulary cap (first 7000 dict entries), dict CLOSE_QUERY event, `btn-shailta` id, friends recent-games LTR layout. Explicitly skipped the rollback half of that commit (would have wiped portrait lock, rotate-block, connectivity indicator, gender propagation, back-button handler). The ם/מ sofit fix the user remembered turned out to already be on the current branch via PRs #276/277/278 + `f64be250`. See `docs-md/CHANGELOG.md` for the full file-level breakdown.
- ✅ Portrait-orientation enforcement — installed PWA already locked via `manifest.json`. For in-browser use, added `screen.orientation.lock('portrait')` in [src/main.js](../src/main.js) (works in fullscreen/PWA contexts, no-ops in plain tabs) plus a CSS landscape-block overlay (`#rotate-block`) that covers phone-shaped viewports in landscape (`@media (orientation: landscape) and (max-height: 500px)`). Tablets/desktops in landscape stay interactive since the layout caps at 480px and centers.
- ✅ Layout unification — collapsed the game screen's two CSS layouts (info-strip ≤500px vs. side-panels >500px) into one phone-shaped layout that applies at every viewport. `.gr` capped at `max-width:480px`, `.left-panel`/`.right-panel` always `display:none`, `.info-strip` always shown. Removed the `@media(min-width:600px)` and `@media(min-width:900px)` width-scaling blocks for the game/home/setup/overlay containers. Real phones already rendered the info-strip layout (≤414 CSS-px in portrait); the desktop branch was dev-tool-only and looked unrelated to the actual product. See `docs-md/CHANGELOG.md` for the full file-level breakdown.
- ✅ Firebase emulator wired for browser playtesting — restored `?emu=1` flag in `firebaseClient.js` (calls `db.useEmulator` + `auth.useEmulator`), added auth/hosting/UI ports to `firebase.json`, added `npm run emu` script. Open `http://localhost:5000/?emu=1` in two browser profiles to play offline-vs-offline against the local DB without touching prod.
- ✅ Bug #2 real root cause — `presenceService` now restores `connected:true` on every WebSocket reconnect (`.info/connected` watcher) AND every heartbeat tick. Without this, a single transient WebSocket drop (auth-refresh blip, mobile network switch, etc.) caused the server's `onDisconnect` handler to write `connected:false`, after which the heartbeat kept updating only `lastSeen` — so `/presence/{uid}.connected` stayed false for the rest of the session and the opponent's `disconnectController` correctly read it as offline, firing the disconnect overlay. The earlier "strict continuous-offline semantics" fix in `disconnectController` is still correct as a separate guard against real flickers; together they cover both classes of bug #2.
- ✅ Phase 5 — fixed both prod bugs the user reported: (1) ghost-move-after-failed-commit in `onlineGameSession` (added `forceResync()` on every SYNC_REJECTED + try/catch around `commitTransaction` so permission_denied becomes `{committed:false}` instead of bubbling); (2) false-positive disconnect overlay in `disconnectController` (strict continuous-offline semantics — reset `totalDisconnectedMs` on every online transition that happens before the overlay opens). Headless full-stack E2E scenario reproduces both bugs deterministically and the fixes make all 5 sub-scenarios pass.
- ✅ Live connectivity indicator — wifi icon in the game top bar that goes red+blinking when the local Firebase WebSocket drops. New `connectivityService` subscribes to `.info/connected`; new `connectivityIndicator` controller toggles classes on `#net-status` in the game partial; only visible during online games.
- ✅ Online game simulator (Phase 4) — Adds `--scenario reconnect` covering reconnect-during-opponent-turn, reconnect-on-own-turn, and no-ghost-events-after-dispose. Verifies version-cursor anchoring, cache pre-warm on the new session, and watcher teardown via `dispose()`. 45 sub-scenario runs at scale: 0 crashes. No new engine bugs found this round — the session reconnect machinery holds up under stress.
- ✅ Watchdog forfeit production bug closed — relaxed `/rooms/$roomId` rule's opponent-watchdog branch to permit `turnDeadlineMs=0` when `status=abandoned`, so two consecutive missed turns can now actually transition the room to terminal. Two new emulator tests in `tests/emulator/timer-rules.test.mjs` cover both the positive case and the safety check (opponent cannot zero the deadline without flipping status). The simulator's `runForfeitAfterTwo` scenario is now re-enabled and passes.
- ✅ `handleConfirmMove` occupied-cell defense — rejects `CONFIRM_MOVE` whose placed tiles overlap an already-committed board cell. Without this check, `setCommittedTile` silently overwrote the existing tile (vanishing it), breaking bag-parity. Placed in `handleConfirmMove` (not `validateMove`) because the swap path correctly expects target cells to be occupied. Surfaced by the fuzz bot.
- ✅ `applyExchange` atomicity — pre-validates all letters against a rack copy before mutating, so a mixed-valid-and-bogus exchange (e.g. one letter not in rack) no longer leaves tiles partially removed. Same family as the Phase 3 `handleConfirmMove` fix but in the exchange path. Surfaced by fuzz sweep after the watchdog rule fix landed.
- ✅ Online game simulator (Phase 3) — Adds `--scenario watchdog` mode covering single-timeout, liveBonus gate, and double-claim race using injected clock (`timeoutWatchdog`'s `now`/`setIntervalFn` seams). Two more engine fixes shipped from simulator findings: `handleConfirmMove` now rejects placements whose letters aren't in the rack (closes the bag-parity gap surfaced by `--bot fuzz`); `timeoutWatchdog.applyPatchToRoom` defaults `activeBoosts` to `[]` instead of `undefined` (Firebase rejects undefined).
- ✅ Online game simulator (Phase 2) — Adds `--bot fuzz` adversarial bot and `--scenario matchmaking` concurrent-claim race scenario on top of Phase 1. CLI: `--bot random|fuzz`, `--fuzz-rate F`, `--scenario normal|matchmaking`, `--mm-players N`, `--mm-batches N`. The fuzz mode surfaced a real engine-defense gap (see Phase 3 TODO). See `docs-md/CHANGELOG.md` for the entry.
- ✅ passCount sync between online clients — fixed two real engine bugs caught by the simulator: (1) `onlineGameSession.commitCurrentState` now persists `_passCount` to the room and the watcher resync copies it back, so the global "4 consecutive scoreless turns" game-over rule actually works across clients; (2) `handleExchange` now calls `isGameOver()` after `passCount` bump, mirroring `handlePass` / `handleConfirmMove` (without this, four consecutive exchanges did not end the game).
- ✅ Online game simulator (Phase 1) — New `npm run sim` tool spins up the local Firebase emulator, runs N concurrent online games using random-move Hebrew bots, and writes structured crash reports for invariant violations, engine throws, transaction livelocks, or hangs. Lives under `scripts/simulator/`; no production code touched. See `docs-md/CHANGELOG.md` for the entry and `scripts/simulator/runSimulator.mjs --help` for flags.
- ✅ Gender address toggle Phase 2 — All Hebrew imperative strings (game controls, mini-game instructions, overlay buttons, friends/share text) now render in the correct gender form. Central utility `src/ui/genderText.js` with `g()`, `applyGenderToRoot()`. Live updates via `SETTINGS_CHANGED` bus event propagate to all mounted screens in one call.
- ✅ Gender address toggle Phase 1 — "באיזה לשון לפנות אליך?" (זכר/נקבה) added to settings screen. Stored in `uiPreferences` (localStorage only, never pushed to Firebase). The reminder push notification body (`"אתה לא משחק"` / `"את לא משחקת"`) now uses the correct gender form. Infrastructure in place (`VALUE_SELECTS` in `settingsScreen.js`).

---

## Completed (May 2026)

- ✅ Game summary UI fixes — ELO delta inconsistency fixed (both clients now read pre-game ratings from `globalRatings` for both players); "ללא הודעות" settings panel removed; rectangular gold resume button replaced with round circle button in the home screen secondary row; `נאצי` added to `EXACT_REJECTS`.


- ✅ Pre-launch polish — tutorial intro refreshed (drop ערעור, add bonus-square mention) + new scripted player step that lands 'י' on the row-5 right-edge bonus to demo bonus activation; `#lcd "מהלכים"` move counter removed from game.html + gameScreen.js; privacy policy rewritten for auth/push/friends/ratings/in-game messages; new "ללא הודעות" setting (local-only, gated in reactionController to hide button + ignore incoming bubbles); end-game screen now shows Elo new-rating + signed delta per player via `RATING_EVT.CHANGED`.

- ✅ Scoreless-turn game-over rule unified — threshold 6→4, exchanges and illegal-word forfeits now count toward `passCount`, and a leading player can fire `CMD.CLAIM_STALL_END` (new "🏆 סיים וזכה" topbar button) once `passCount >= 2` to close out a stalled lost-game-drag-out scenario. Pre-launch change, no migration.

- ✅ In-app help dropdown with Tutorial / Guide / FAQ — top-bar `?` now opens an anchored dropdown; "מדריך" opens a 6-section accordion guide (rules, inflections, screens, modes, ratings, bonuses); "שאלות נפוצות" opens a ~12-item Q&A overlay. Existing tutorial flow preserved (dropdown re-emits `OPEN_TUTORIAL`).

- ✅ Online end-game suite — ELO `permission_denied` fixed by per-client write model (each side writes only its own profile + leaderboard entry; opponent's rating read from publicly-readable `globalRatings`); ELO now skipped for 0-move games; `currentUserProfile` undefined-global ReferenceError fixed in avatar-unlock overlay; matchmaking/friend-invite avatar field corrected (`profile.avatar` → `profile.equippedAvatar`) so opponents render with their actual emoji instead of the 👑 default.

- ✅ Matchmaking pair-claim race fix — `tryPair` now claims the queue pair via a single RTDB transaction on `/matchmakingQueue/{mode}` instead of multi-path update + verify. Eliminates the bug where two simultaneous matchmakers each created their own room and the coin-toss showed each player as the starting one.

- ✅ In-game reaction system — child-safe emoji + Hebrew preset message reactions for online games. Reaction panel opens from player card, sends to Firebase `liveReaction` field, shows animated speech bubbles. 5-second cooldown, local mute toggle. No free-text, no gameplay impact.

- ✅ Offline save/resume for 2P + vs-Bot — `pause → שמור וצא לתפריט` and back-button `השהה ושמור` now persist the full engine state to localStorage via `localSaveService`; home `המשך משחק` falls back to the local save when no online async session exists. Cleared on game completion.
- ✅ Notifications bell inbox — bell badge shows live count of pending game invites + friend requests; clicking opens `#snotif` inbox with accept/reject per item.
- ✅ Waiting room async/live invite behavior — async direct invite closes waiting overlay after 1.5 s; live direct invite shows 5-min countdown, cancels pending room + invite on Firebase on expiry.
- ✅ Notification banner + invite UX — blocking invite popups replaced with slide-down banner from topbar; banner suppressed on app open; cancel in waiting room cancels live invite too.
- ✅ Reject-name fix — banner now shows real player display name (not "שחקן") when rejecting an invite.
- ✅ Speed presets — "זמן מוגבל למהלך" removed from settings; 3 presets (בזק/רגיל/איטי) added to setup, create-room, and matchmaking screens.
- ✅ Favorite move-speed statistic — moveSpeedStats tracked per game; displayed in Records tab.

- ✅ Electric Floating Platforms main menu redesign — `menu-electric.css` + updated `home.html`, `menuScreen.js`, `main.js`
- ✅ Electric Floating Platforms Phase 2 visual polish — premium platform architecture, double-path SVG lightning, atmospheric background, animations
- ✅ Electric Floating Platforms Stage 3 depth pass — floating illusion via offset shadow, curved organic lightning, particle field, compressed layout, blue ELO badge, enlarged online icon
- ✅ Electric Floating Platforms Stage 4 gap-report pass — viewport-fit=cover, near-black background, 3D slab bottom face, icon depth with specular highlight, logo glow, nav 28px icons + active pill, lightning pulse + particle drift animations
- ✅ Stats screen simplification — cut ~10 low-value stats, collapsed 5 tabs to 3 (תקדמות / שיאים / יריבים ובוסטים). UI-only; storage unchanged.
- ✅ Stats screen modernization — replaced 4-tab layout with a 5-act narrative story feed (Identity · Form · Achievements · Style · Rivalries). ELO rating moved to hero band. Archetype card always visible. Collapsible section cards with teaser text. Removed "Did You Know?", milestone ladder, opponent insights grid, accumulation counters. Clutch stats promoted to Achievements. Rivals trimmed to top 3.

---

## Stats screen — follow-up opportunities

Surfaced during the May 2026 stats simplification audit. Each is a UI-visible add that requires backing data work.

- [ ] **Bingo count** — biggest gap. Tally `BINGO_BONUS` triggers per game and surface in Records tab.
- [ ] **Highest single-word score** — derive from move history, store on profile, surface in Records.
- [x] **Unique words discovered (vocabulary size / מילון מהלך)** — `uniqueWordsCount` is now tracked in `computeLiveGameStatsDelta` as a numeric increment of new words per game (June 2026).
- [ ] **Win rate by first/second to move** — already trackable from move metadata.
- [ ] **Hour-of-day stats / power hour** — extend the existing `weekdayStats` model.
- [~] **Earned titles** ("Comeback King", "Bingo Hunter", etc.) — named achievements with Hebrew titles now exist in `ACHIEVEMENTS` table (`avatarScreens.js`). The stat-based conditions are wired; purely narrative titles (Comeback King etc.) require additional stats (comeback tracking, bingo count) not yet collected. See TASKS.md bingo-count and highest-single-word items above.
- [x] **חבר של כולם (friendsCount)** — synced from Firebase friends list via `activeFriendsWatch` (June 2026).
- [x] **האחד (beatNumberOne)** — tracked at game end when result=win, opponent was pre-game #1, and ≥1000 total players (June 2026).
- [ ] **Move timing** — `totalMoveTimeMs` is hardcoded to 0 in `profileService.js:251`. Either wire it up (per-move timestamps in the event stream) or remove the field entirely.
- [ ] **Storage cleanup** — once the new layout settles, remove orphan fields (`boostImpactWins`, `totalMoveTimeMs`, etc.) from `EMPTY_STATS` and add a one-time cleanup migration.

---

## Active Cutover Checklist (from `SPINE_TODO.md`)

The `SPINE_TODO.md` file is the authoritative tracking document for the legacy→spine migration. Key outstanding areas as of documentation date:

### High Priority (Cutover Blockers)

- [ ] Verify all B1–B13 bonus mini-game branches work end-to-end in live game
- [ ] Verify deferred scoring (two-phase commit) works correctly in online mode under latency
- [ ] Verify multiplier forfeiture on timeout/resign (boost effect cleanup)
- [ ] Disconnect/leave flow Phase 1B+ (Phase 1A complete per recent commits)
- [ ] UI state reset/preservation between game start and end (screen cleanup)
- [ ] Tutorial flow full verification with scripted bot
- [ ] Dictionary admin flow (approval/rejection UI + validation)

### Medium Priority

- [ ] Profile/stats/avatar progression parity with legacy
- [ ] Champion leaderboard display correctness (`RATINGS_LIMIT = 10`)
- [ ] `settingsCompat.js` migration from very old localStorage formats
- [ ] Music/sound scheduling behavior characterization
- [ ] Mobile layout verification on small screens (320px width)
- [ ] Menu transition animation parity
- [ ] Appeal/dictionary challenge flow (`appealsMax` setting)

### Low Priority (Cleanup)

- [ ] Remove legacy `onclick` attributes from all remaining partials
- [ ] Remove legacy global functions from `index.html` once spine covers all paths
- [ ] Add `src/testing/` tests to main test runner (currently separate)
- [ ] Document `botSearch.js` algorithm

---

## Security Tasks

### Critical
- [ ] **Move OneSignal REST key server-side** — The `onesignalKey` is currently used from the browser. Move push sending to a Cloud Function or edge worker to prevent key exposure.

### Medium
- [ ] Verify admin custom claim flow end-to-end (claim set → token refresh → admin UI unlocks)
- [ ] Audit who can trigger `asyncReminderService.sweepForUser()` — currently any authenticated client can call it for any `uid`

---

## Missing Tests to Write

Based on GAP_REPORT.md findings:

1. **`botSearch.js` unit tests** — Verify bot produces valid Hebrew words, legal placements
2. **B8 crossword mini-game** — End-to-end test with mock mini-game completion
3. **B11 word search** — Result resolution and score commit
4. **B13 wheel all outcomes** — One test per wheel outcome (8 outcomes)
5. **Multiplier forfeiture** — Test that `multiply_next_turns` is removed on timeout
6. **`asyncReminderService.sweepForUser()`** — Full sweep execution test (not just `classify()`)
7. **Double-sweep idempotency** — Two sweeps in the same window should not double-notify
8. **`settingsCompat.js` migration** — From V0 → V1 → spine format
9. **Dictionary approved words → validation** — Prove approved Firebase words are used in `isValid()`
10. **Watchdog transaction failure** — Simulate `committed: false` and verify retry/fallback
11. **`EXACT_REJECTS` completeness** — Verify all ~220 entries are genuinely invalid words
12. **Friend request lifecycle** — `friendsService.js` send → accept → appear in friends list

---

## Architecture Recommendations

### Near-Term

1. **Consolidate timing constants** — `animationController.js` and `gameScreen.js` both define identical timing constants. Extract to a shared `animationConstants.js` file.

2. **Add Cloud Function for push** — Move `onesignalKey` usage to a server-side function. OneSignal supports Cloud Functions as a backend.

3. **Add explicit watchdog retry** — `timeoutWatchdog.js` should log and handle `committed: false` returns explicitly, even if it just means "do nothing and wait for next poll."

4. **`isValid()` cache warm-up** — `hebrewDictionary.loadDict()` is async. Any call to `isValid()` before the dict is ready falls back to `analyze()`. Consider a "dict ready" event on the bus so UI can gate validation properly.

### Long-Term

1. **Cloud Function for reminders** — Move `asyncReminderService` to a Cloud Function triggered on Firebase write. This ensures reminders fire even when no player has the app open.

2. **Bundler / Code Splitting** — As the codebase grows past 50 modules, consider a minimal bundler pass for production to reduce HTTP round trips for module loading.

3. **Visual Regression Tests** — Add Playwright screenshot comparison tests for the game board to catch CSS regressions.

---

## From Existing FIXME/TODO Comments

No explicit TODO/FIXME comments were found in the source files analyzed. The `SPINE_TODO.md` file serves as the project's official TODO list.

---

## Recently Fixed (from git log)

Based on recent commits (last 30 visible):

- Disconnect/leave Phase 1A: accumulating disconnect timer, app-close resign behavior ✅
- Opponent disconnect/quit notifications: three bugs fixed ✅
- Matchmaking pairing bug (null queue snapshot) ✅
- Friend invite dropdown: module-level var scoping ✅
- Live invite to mid-game recipient: blocked + push notification ✅
- Rack visual lockout and timer/glow sync on opponent move ✅
- Tab-close detection when Firebase WebSocket unavailable ✅
- Chrome-extension URL guard in `sw.js` ✅
