# Asset Inventory

## Missing (bespoke art — interim icons are in place, nothing is broken)

The three boosts below used bare emoji in the award overlay, which rendered as
meaningless gold discs. They now use **interim** icons; bespoke Boost-family art
is still wanted so they match `assets/rewards/extra turn.png`. Generation prompts
are in `docs-md/CHANGELOG.md`. Swapping in real art is a one-line `image:` change
each in `describeBoost` (`src/ui/screens/gameScreen.js`).

* assets/rewards/skip turn.png — `skip_opponent_turn`.
  Interim: `assets/ui/pause.png` (already Boost-family; reads as "turn halted").
* assets/rewards/tile swap.png — `free_tile_swap`.
  Interim: `assets/ui/rematch.png` (already Boost-family; circular swap arrows —
  a genuinely good fit, lowest priority to replace).
* assets/rewards/cancel boost.png — `cancel_next_opponent_bonus`.
  Interim: 🛡️ emoji (no usable shield asset exists — the achievements shield is a
  multi-object sheet with a baked-in background). **Highest priority**: it's the
  only boost still without an icon.

* assets/ui/lock_slot.png — small transparent lock icon for the scoreboard's three
  lock slots (`#is-locks-1/2`). Interim: 🔒 emoji, the same icon the board's lock
  badge uses. `assets/ui/lock.png` can't be used at 11px because its background
  is baked in. Optional: per-duration variants if lock tiers are ever introduced.

* (stats-letter-icon.png was proposed for the favorite-letter card, but that card
  renders the actual Hebrew letter dynamically — no static icon needed.)

## Existing

### Boostie models and stills (October 2026)

In-app Boostie assets (paths built by `src/game/account/boostieCatalog.js`):

* assets/boosties/<id>_l<N>.glb — rigged 3D model per level, meshopt-compressed by
  `scripts/optimize-boosties.mjs` from `Blender designs/boosties/out/`. 35 files
  (zapi, bubo, rocco, lumi, drako × L1–7), ~0.6–1.0 MB each. Used by the live scoreboard (Phase 3).
  Clips: idle, turn, good, boost, signature, laugh, wow, stare, yawn, wink.
* assets/boosties/bot_{easy,medium,hard}.glb — the bots' 3D models (~0.65 MB each,
  single level, screen face with 8 expressions; AVATAR_EVOLUTION §9).
* assets/avatars/bots/bot_{easy,medium,hard}_{bust,full}.webp — bot stills (opponent
  avatar, setup level cards). The old portraits (`assets/avatars/{green,yellow,red} bot.png`)
  are no longer used by the app; `bot.png` stays for the generic bot.
* **Missing:** achievement icons for `boostie_grown` (מתפתח), `new_boostie` (בוסטי חדש),
  `reaction_fan` (מלך התגובות); they show emoji. The old store portraits
  (`assets/avatars_v2`) were removed in October 2026.
* assets/avatars/boosties/<id>/l<N>_bust.webp — 256 px head-and-shoulders still (every
  avatar slot, lists, fallback for 3D).
* assets/avatars/boosties/<id>/l<N>_full.webp — 512 px full-body still (store cards,
  purchase confirm, level-up fallback).

Rendered by `Blender designs/boosties/render_stills.py` and `stills_to_webp.py`.

* src/vendor/three/ — three.js r169 (`three.module.min.js`, `GLTFLoader.js`,
  `BufferGeometryUtils.js`, `meshopt_decoder.module.js`), MIT (`LICENSE` alongside).
  Code, not art; loaded only by the live scoreboard (`src/ui/boostie3d/`).

### Boostie evolution sheets (October 2026)

Reference art for the 7-level evolving avatars (spec: `docs-md/AVATAR_EVOLUTION.md`,
workflow: the `boostie-evolution` skill). These are design sheets, not in-app assets:
nothing references them yet. Each level still has to be cut out as its own
transparent PNG before it can become an avatar or pose atlas.

* assets/avatars/evolution/zapi/zapi_sheet_a_levels_1-4.png — Zapi (fox), levels 1–4, final
* assets/avatars/evolution/zapi/zapi_sheet_b_levels_5-7.png — Zapi (fox), levels 5–7, final (inpainted)

* assets/avatars/evolution/bubo/bubo_sheet_a_levels_1-4.png — Bubo (owl), levels 1–4, final
* assets/avatars/evolution/bubo/bubo_sheet_b_levels_5-7.png — Bubo (owl), levels 5–7, final (inpainted)

* assets/avatars/evolution/rocco/rocco_sheet_a_levels_1-4.png — Rocco (ram), levels 1–4, final
* assets/avatars/evolution/rocco/rocco_sheet_b_levels_5-7.png — Rocco (ram), levels 5–7, final
* assets/avatars/evolution/lumi/lumi_sheet_a_levels_1-4.png — Lumi (axolotl), levels 1–4, final
* assets/avatars/evolution/lumi/lumi_sheet_b_levels_5-7.png — Lumi (axolotl), levels 5–7, final
* assets/avatars/evolution/drako/drako_sheet_a_levels_1-4.png — Drako (dragon), levels 1–4, final
* assets/avatars/evolution/drako/drako_sheet_b_levels_5-7.png — Drako (dragon), levels 5–7, final

Missing: per-level transparent cut-outs of Zapi and Bubo (7 PNGs each); sheets
for Pipo (dragon).

### Sound effects (October 2026)

Audio lives under `assets/sfx/` and is tracked separately in `docs/sound_inventory.md`
(cue id, file, CC0 source, edits). Until files are added every cue plays its synth fallback.

### Home / login logo (October 2026)

* assets/ui/boost-logo.webp — 1100px transparent render of the wood-tile wordmark
  (split ס), the final frame of `Blender designs/boost_reveal_v9_H.blend` (same shot
  as the end of the 40s promo). Rebuilt by `Blender designs/promo/render_app_logo.py`.
  Deliberately **WebP-only** (no PNG sibling) so `build-web-images.py` never replaces
  it with a 512px copy. Replaces the CSS-built `.hl-tile` logo.

### Web-sized WebP derivatives (September 2026)

* Every `assets/**/*.png` (except `assets/anim/`) has a generated sibling `*.webp`
  (≤512px) from `scripts/build-web-images.py`; the service worker serves it in place of
  the PNG. The PNGs remain the masters. Regenerate after adding or replacing art.

### UI line icons (code, not art — September 2026 glass skin)

* `#gi-*` SVG symbol sprite inlined at the top of `index.html` — the 24px line-icon set
  from `tools/screens-mockup/index.html` (stroke paths, `currentColor`). Replaces emoji and
  3D PNG icons in chips, sockets, the home nav, dialogs and sheets. No image files.
* Now unreferenced by any partial / JS / CSS (kept on disk, safe to prune later):
  `assets/ui/play.png`, `assets/ui/key.png`, `assets/ui/+.png`, `assets/ui/hourglass.png`.
  The other nav/top-bar PNGs (`assets/navigation/*.png`, `assets/icons/{friends,acheivments,statistics}.png`,
  `assets/ui/{pause,logout,store}.png`) are still referenced elsewhere (game menu, admin,
  onboarding icons, sw precache) and stay.

### Generated motion assets (not bespoke art — rebuilt from the PNGs below)

* assets/anim/manifest.json — pose-atlas index keyed by source PNG path
* assets/anim/achievements/*.webp — 20 achievement atlases (turn + light sweep)
* assets/anim/avatars/*.webp — 5 bot/anonymous atlases (bust poses)
* Rebuild: `Blender designs/icons3d/` → `build_relief.py --atlas` then `pack_atlas.py` (see its README)

### Source art


* assets/achievements/crown and dimond shield.png
* assets/achievements/אגדה.png
* assets/achievements/אלוף.png
* assets/achievements/אמן המילים.png
* assets/achievements/בלתי מנוצח.png
* assets/achievements/בלתי נתפס.png
* assets/achievements/ברק חי.png
* assets/achievements/גאון מילים.png
* assets/achievements/האחד.png
* assets/achievements/ותיק.png
* assets/achievements/חבר מביא חבר.png
* assets/achievements/חבר של כולם.png
* assets/achievements/מילון מהלך.png
* assets/achievements/מנצח.png
* assets/achievements/על-אנושי.png
* assets/achievements/צעדים ראשונים.png
* assets/achievements/רצף מנצחים.png
* assets/achievements/שועל ותיק.png
* assets/achievements/שחקן מנוסה.png
* assets/achievements/תורם מילים.png
* assets/avatars/anonymous player.png
* assets/avatars/bot.png
* assets/avatars/green bot.png
* assets/avatars/red bot.png
* assets/avatars/yellow bot.png
* assets/icons/1v1.png
* assets/icons/5_references.png
* assets/icons/acheivments.png
* assets/icons/dice.png
* assets/icons/friends.png
* assets/icons/globe.png
* assets/icons/statistics.png
* assets/icons/stats-average-icon.png
* assets/icons/stats-games-icon.png
* assets/icons/stats-performance-icon.png
* assets/icons/stats-records-icon.png
* assets/icons/stats-rivals-icon.png
* assets/icons/stats-streak-icon.png
* assets/icons/stats-style-icon.png
* assets/icons/stats-wins-icon.png
* assets/navigation/bell.png
* assets/navigation/friends_nav.png
* assets/navigation/help.png
* assets/navigation/home.png
* assets/navigation/more_navigation_buttons.png
* assets/navigation/my_games.png
* assets/navigation/navigation_buttons.png
* assets/navigation/search.png
* assets/navigation/serach.png
* assets/navigation/settings.png
* assets/navigation/sound_off.png
* assets/navigation/sound_on.png
* assets/navigation/statistics_nav.png
* assets/rewards/bronze medal.png
* assets/rewards/extra turn.png
* assets/rewards/gold coin.png
* assets/rewards/gold medal.png
* assets/rewards/silver medal.png
* assets/rewards/trophy.png
* assets/ui/+.png — add-friend and online-lobby create-room (P0-03; no separate create-room.png)
* assets/ui/hourglass.png
* assets/ui/key.png
* assets/ui/lock.png
* assets/ui/logout.png
* assets/ui/pause.png
* assets/ui/play.png
* assets/ui/rematch.png
* assets/ui/remote.png
* assets/ui/store.png
