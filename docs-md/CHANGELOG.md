# CHANGELOG.md — Change History

> Based on `git log --oneline -30` (last 30 commits visible from repository).
> Older history is not available in this output. Full history available via `git log`.

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
