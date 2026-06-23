# CLAUDE.md — Agent Operating Instructions

This file is auto-loaded by Claude Code at session start. Read it fully before writing any code.

---

## Before You Start Any Task

**Always read these first, in order:**

1. `docs-md/CLAUDE.md` — what must never change, safety rules per module
2. `docs-md/TASK_WORKFLOW.md` — the mandatory per-task protocol

**Then read the docs relevant to your task area:**

| Task area | Read this |
|-----------|-----------|
| Game rules, scoring, tiles, dictionary | `docs-md/GAMEPLAY_RULES.md` |
| Board, engine, turns, boosts | `docs-md/CHARACTERIZATION.md` |
| Firebase, rooms, invites, matchmaking | `docs-md/docs/firebase-flow.md` |
| Database paths, document shapes | `docs-md/docs/db-schema.md` |
| Push notifications, OneSignal | `docs-md/docs/notifications.md` |
| UI screens, DOM IDs, animations | `docs-md/docs/ui-rules.md` |
| Public module APIs | `docs-md/API_REFERENCE.md` |
| Known risks and fragile modules | `docs-md/GAP_REPORT.md` |
| Recent architectural decisions | `docs-md/DECISIONS.md` |

**For UI or asset-pipeline work:** use the project skill
`.claude/skills/boost-development-workflow/SKILL.md`. It defines the Boost
developer/art-director split, missing-asset workflow, and required
`docs/asset_inventory.md` updates.

---

## Hard Rules (Non-Negotiable)

These apply to every task, no exceptions:

- **Never change** `RACK_SIZE`, `BOARD_SIZE`, `BINGO_BONUS`, `HV`, `HD`, `LEGACY_LOCK_INVENTORY`, `LEGACY_PASS_GAME_OVER_THRESHOLD`, `schemaVersion`, or Firebase path constants in `schema.js`
- **Never commit** `config.js` — it contains live credentials
- **Never bypass** `commitTransaction()` for Firebase game-state writes
- **Never add** DOM access, Firebase calls, or `setTimeout` inside `src/game/core/`
- **Never rename** DOM element IDs listed in `docs-md/docs/ui-rules.md` without updating all JS references
- **Never rename** `EV.*` or `CMD.*` constants — online sessions depend on exact string values
- **Always run** `npm run test:unit` before finishing — 609+ tests must pass
- **If Firebase rules changed:** also run `npm run test:emulator`

---

## After Every Task

Update the docs that were affected. See `docs-md/TASK_WORKFLOW.md` for the full update checklist.

At minimum, always update:
- `docs-md/CHANGELOG.md` — what changed and why
- `docs-md/TASKS.md` — mark completed items, add newly discovered work
