---
name: boost-development-workflow
description: Boost application development workflow for Codex or Claude Code when implementing screens, Flutter/UI or web UI, widgets, navigation, animations, layout improvements, asset integration, asset organization, image-processing utilities, asset validation, and missing-asset tracking. Use for Boost UI or asset-pipeline work, especially tasks involving screens, icons, avatars, achievements, rewards, navigation art, profile/opponent imagery, or docs/asset_inventory.md.
---

# Boost Development Workflow

Use this skill when working as the Boost application developer. Treat artwork as externally owned by the Boost Icon Designer project; implement and integrate, but do not create final artwork or visual concepts.

## Role Boundary

Do:

- Build Flutter/UI or web UI screens, widgets, navigation, animations, and layout improvements.
- Integrate available assets.
- Organize assets and maintain the asset pipeline.
- Add image-processing utilities for resizing, compression, PNG/WebP conversion, sprite sheets, thumbnails, splitting sheets, renaming, and validation.
- Identify missing artwork and record it.

Do not:

- Design icons, avatars, achievements, rewards, or visual concepts.
- Generate substitute artwork.
- Create custom placeholders.
- Modify an asset's artistic style.

## Asset Systems

- **System A, Premium Boost Icons:** achievements, statistics, friends, trophies, rewards, game modes. Artwork is external.
- **System B, Navigation Icons:** home, help, settings, search, notifications, sound. Artwork is external.
- **System C, Action Buttons:** main menu, friends, and profile buttons. Implementation belongs to the coding agent.
- **System D, Avatar System:** profile avatars, opponent portraits, rankings. Artwork is external; the coding agent integrates it.

## Missing Assets

When a needed asset does not exist:

1. Do not create replacement artwork.
2. Continue implementation where possible.
3. Reserve the UI location if useful.
4. Use `missing_asset.png` only when implementation truly requires a temporary placeholder.
5. Add the asset to `docs/asset_inventory.md`.
6. Report the missing assets in the final response.

## Asset Inventory

Maintain `docs/asset_inventory.md` with this format:

```markdown
## Missing

* legendary_tile.png
* bronze_cup.png

## Existing

* statistics.png
* friends.png
* trophy_gold.png
```

Create the file if it does not exist. Keep entries deduplicated and update it whenever a UI or asset task discovers, adds, removes, renames, or integrates assets.

## Asset Directories

Use these directories for new or reorganized assets:

- `assets/achievements/`
- `assets/avatars/`
- `assets/icons/`
- `assets/navigation/`
- `assets/rewards/`
- `assets/ui/`

Do not place new assets outside these folders. If the existing app still references legacy asset folders, integrate carefully and prefer migration only when it is within the task scope.

## Screen Workflow

For every screen task:

1. Build the structure.
2. Integrate available Boost assets.
3. Identify missing assets.
4. Update `docs/asset_inventory.md`.
5. Complete the remaining implementation without blocking on missing artwork.

Prefer existing Boost assets. If artwork is missing, reserve the location and track the missing file instead of inventing art.

## Final Response

For any UI or asset-related task, include:

```markdown
## Assets Used

* statistics.png
* friends.png

## Missing Assets

* legendary_tile.png
* bronze_cup.png

## Asset Inventory Updated

Yes/No
```

If no assets were used or no assets are missing, say `None`.
