# Spine Two-Window Smoke Checklist

Run before each cutover candidate with two browser windows signed in as different users.

Base URL: `/?spine=v2&takeover=games,online,account`

## Offline 2P

- Start two-player game.
- Place a valid word, confirm, verify score/rack/turn update.
- Open settings, change timer and music, close, verify values persist after reload.
- Resign or finish with pass-pass, verify end overlay.

## Offline Bot

- Start bot game at each difficulty at least once.
- Confirm a move, verify bot responds and rack refills.
- Toggle timer mid-game, verify timer controller reflects the change.

## Tutorial

- Open tutorial from menu.
- Verify intro, tips, spotlight, and scripted bot move sequence.
- Finish or exit without leaving overlays stuck open.

## Random Live

- Window A starts live matchmaking, Window B joins matching live queue.
- Complete coin-toss/start flow.
- A plays a word; B sees board, score, rack, turn, and live-preview clearing.
- Reload A during active game; A rejoins same room automatically.
- Toggle settings on A; B receives updated timer settings.
- Close B; A sees disconnect grace UI. Reopen B; game recovers.

## Random Async

- Match async game.
- A plays and returns home with async-home button.
- B sees async session row and turn banner, resumes, plays.
- Reload either window; most recent async room is resumable.
- Let dismiss remove only local async index entry.

## Friend Live / Async By Code

- A creates live room code; B joins by code.
- Repeat a valid move handoff and reload recovery.
- A creates async room code; B joins and confirms async-home/resume.
- Verify WhatsApp/share URL contains the code.

## Push Routing

- Trigger or simulate notifications for invite, invite accepted, turn, reminder, completed, expired, friend request, and friend accepted.
- Existing focused test coverage verifies SW message mapping; manually verify browser focus/open behavior with an installed service worker.

## Security Rules

- Deploy `firebase.database.rules.json` to a dev Firebase project.
- As user A/B, verify room writes succeed for their room.
- As user C, verify writing to A/B room fails.
- As anonymous/no auth, verify room writes fail.
- Verify dictionary suggestions require auth and approved/rejected writes require admin custom claim.
