# Image prompts: what to generate next

One file per image. Open a file, attach the images it lists in ChatGPT, copy the prompt from the
box, and paste the result back into Claude Code with the file's name. Claude reviews it, saves it
and carries on with the 3D build.

They're in priority order: Zapi first (levels 3 and 4 are already built), then Bubo, then the
three bots (no evolution sheet: attach the bot's current portrait instead).

| # | Image | Evolution sheet to attach | Done |
|---|---|---|---|
| 01 | [Zapi level 5](01_zapi_l5_turnaround.md) | `zapi_sheet_b_levels_5-7.png` | ✅ |
| 02 | [Zapi level 6](02_zapi_l6_turnaround.md) | `zapi_sheet_b_levels_5-7.png` | ✅ |
| 03 | [Zapi level 7](03_zapi_l7_turnaround.md) | `zapi_sheet_b_levels_5-7.png` | ✅ |
| 04 | [Zapi level 1](04_zapi_l1_turnaround.md) | `zapi_sheet_a_levels_1-4.png` | ✅ |
| 05 | [Zapi level 2](05_zapi_l2_turnaround.md) | `zapi_sheet_a_levels_1-4.png` | ✅ |
| 06 | [Bubo level 1](06_bubo_l1_turnaround.md) | `bubo_sheet_a_levels_1-4.png` | ✅ (after 06b) |
| 06b | [Bubo level 1: core fix (edit)](06b_bubo_l1_core_fix.md) | none (attach the candidate) | ✅ |
| 07 | [Bubo level 2](07_bubo_l2_turnaround.md) | `bubo_sheet_a_levels_1-4.png` | ✅ |
| 08 | [Bubo level 3](08_bubo_l3_turnaround.md) | `bubo_sheet_a_levels_1-4.png` | ✅ |
| 09 | [Bubo level 4](09_bubo_l4_turnaround.md) | `bubo_sheet_a_levels_1-4.png` | ✅ |
| 10 | [Bubo level 5](10_bubo_l5_turnaround.md) | `bubo_sheet_b_levels_5-7.png` | ✅ |
| 11 | [Bubo level 6](11_bubo_l6_turnaround.md) | `bubo_sheet_b_levels_5-7.png` | ✅ |
| 12 | [Bubo level 7](12_bubo_l7_turnaround.md) | `bubo_sheet_b_levels_5-7.png` | ✅ |
| 13 | [Bot Easy (green)](13_bot_easy_turnaround.md) | `assets/avatars/green bot.png` | ✅ |
| 14 | [Bot Medium (yellow)](14_bot_medium_turnaround.md) | `yellow bot.png` + the accepted 13 | ✅ |
| 15 | [Bot Hard (red)](15_bot_hard_turnaround.md) | `red bot.png` + the accepted 13 and 14 | ✅ |

Already done: the Zapi level 3 and level 4 turnarounds (`Blender designs/boosties/sources/`).

Claude adds a file here whenever the workflow needs another image (a fix, a new character's
evolution sheets) and ticks the row when the image is accepted. The rules behind these prompts are
in `docs-md/AVATAR_EVOLUTION.md` §7.
