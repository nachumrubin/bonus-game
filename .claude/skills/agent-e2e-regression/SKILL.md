---
name: agent-e2e-regression
description: Run the bonus-game full regression with the agent E2E testers — the soak agents (many parallel online games on the Firebase emulators with simulated phone latency and chaos), the parallel bot-vs-bot browser suite, the Playwright suite, unit and emulator tests — then triage every failure bundle, fix real bugs with a regression test, and document them. Use when the user asks for "agent e2e testing", "run the agents / soak / testers", "full regression", "run multiple games in parallel", "find bugs before release", or to verify online sync after changes to onlineGameSession / timeoutWatchdog / rules.
---

# Agent E2E regression run

The user's standard request is: run the agent E2E testers, run many games in parallel,
then for every bug found **document it, fix it, and add a test that covers it**. Do the
whole loop and keep going until the run comes back clean. Don't stop at a report.

Read `CLAUDE.md`, `docs-md/CLAUDE.md` and `docs-md/TASK_WORKFLOW.md` first. The hard rules
apply throughout: never commit `config.js`, never bypass `commitTransaction()`, no
DOM/Firebase/timers in `src/game/core/`.

## 1. Baseline (fast, run first)

```bash
npm run test:unit        # must be all green before you start
npm run test:emulator    # rules tests; needs Java + Firebase CLI
```

## 2. Soak agents: parallel online games (the main bug finder)

The standard regression command. It takes about 40 minutes, so run it with
`run_in_background` and redirect output to a log in the scratchpad:

```bash
npm run soak -- --games 40 --parallel 8 --chaos 0.5 \
  --modes friend-live,random-live,friend-async,random-async \
  --minigame-time-scale 0.25 --seed regress-1022 > "<scratchpad>/soakN.log" 2>&1
```

- `npm run soak` starts the auth and database emulators itself (ports 9000, 9099 and 4400).
  If those ports are busy it connects to the emulators already running. An orphaned java
  process from a crashed run must be killed first.
- Keep the **same seed** across runs so you can compare before and after a fix. Use a new
  seed for extra coverage.
- Other flags: `--stop-on-first`, `--network mixed|off|wifi|4g|poor`, `--duration 30m`,
  `--personas`, `-v`. Run `npm run soak -- --help` for the full list.
- **Do not run other heavy work (unit suite, Playwright) while a soak is running.** CPU
  load causes timing violations that aren't real.
- The modules load once when the soak starts. Code you edit mid-run is NOT picked up, so
  re-run the soak to verify a fix.

**Outputs**
- The last line of the log: `**N clean, M with violations, K unique failure signatures**`.
- The summary: `.simulator-data/soak/<runId>/summary.md`.
- Failure bundles: `.simulator-data/failures/<runId>/<signature>/<runId>-g<N>.json`. Keys:
  - `violations` (class, detail, version)
  - `agents.{A,B}.events` (`{t, type, p}`) and `agents.{A,B}.stats` (`syncRejected`,
    `writeErrors`, …)
  - `roomSnapshots` (`{t, room}`), `finalRoom`
  - `personas`, `networks`, `setup`
- `grep -c permission_denied` on the log counts refused writes. Some are normal lost
  races; a rising count is a clue.

## 3. Triage each failure bundle

For each signature, dump the violation, the room snapshots around the violating version,
and both agents' events in that time window. Use a small `node -e` script and set
`PYTHONIOENCODING=utf-8` if you go through Python, because the data is Hebrew. Then:

1. Write the timeline: who wrote which version, and when each client saw it.
2. Decide which of these it is:
   - **App bug** in `src/`: fix it.
   - **Harness bug**: the agent (`scripts/simulator/agents/gameAgent.mjs`), the latency
     wrapper (`scripts/simulator/net/latency.mjs`) or the oracle. Fix it too, and say
     clearly that it wasn't an app bug.
   - **Load flake**: confirm by re-running that game's mode alone.
3. Check that the bug is new. Use a temporary worktree at the base commit:
   `git worktree add <scratch>/base <sha>`, then join `node_modules` with PowerShell
   `cmd /c mklink /J`. Run the failing test there, then remove the worktree.

Signatures and what caused them in past runs:

| Signature | Typical cause |
|---|---|
| `desync-currentTurnSlot` | The version cursor or `lastSeenMoveTs` drifted, or a stale snapshot or read was applied over newer state. |
| `stuck-turn` | A refused write with no re-plan, a lost finalize of a deferred bonus move, or a pending bonus dropped by a stale resync. |
| `end-status-mismatch` / `end-desync-status` | A stale read revived `playing`, or two terminal statuses flip-flopped. |
| `end-desync-ownRack` | The game-ending move or exchange was refused because the status write landed first. |
| `invariant-live-bonus-gate-violation` | `liveBonus.active` was left set after the finalize, for example by reordered writes. |

## 4. Fix + regression test (mandatory for every bug)

- Online-session bugs: add `tests/unit/online-<topic>.test.js`. Follow the existing ones,
  which use `makeMockDb()` plus a `Proxy` around `db.ref('rooms/room')` to:
  - hold or replay snapshots,
  - make reads stale,
  - refuse writes like the RTDB rules.

  Good templates:
  - `online-stale-snapshot-after-ack.test.js` (late or stale downlink)
  - `online-game-ending-exchange.test.js` (write order, terminal guard)
  - `online-resync-terminal-status.test.js` (reads held in flight)
- Harness bugs: add a test to `tests/unit/soak-agents.test.js`.
- **Prove the test fails without the fix.** Use `git stash push <file>`, run the test, then
  `git stash pop`. A test that passes on the old code doesn't cover the bug.
- Comment the fix in the surrounding code style and cite the soak run and signature, for
  example "soak agents, Oct 2026: end-desync-ownRack g25".
- Then re-run the soak on the same seed, and repeat until it is **40/40 clean**.

## 5. Browser suites

```bash
npx playwright test tests/e2e/bot-vs-bot-regression.spec.js   # 4 seeded bot-vs-bot games in parallel, real app, 3D on
npm run test:e2e                                               # full Playwright suite
```

- Run the failing specs again on their own before you call them bugs. These are
  load-sensitive in a fully parallel run and pass alone: `boost-electric-border`,
  `capture-guide-screenshots`, `capture-replay-demo`.
- Before treating a spec as a regression, check whether it also fails at the base commit.
  Stale specs get updated for the current design, and the change is documented. Never
  weaken a spec just to hide a real bug.
- The service worker serves `/assets/sfx/*`. To make `page.route` see those requests, use
  `test.use({ serviceWorkers: 'block' })`.
- The capture specs rewrite `images/guide/*.png`. Don't commit those changes.

## 6. Document

Add these in the same commit:

- **`docs-md/CHANGELOG.md`**: one entry for the regression run. For each bug give the
  symptom, the soak signature and game, the root cause, the fix and the test name. Add a
  results line with soak N/40, unit and emulator counts.
- **`docs-md/GAP_REPORT.md`**: the online-drift section (currently -6). Give the evidence
  (run ids, signatures) and the root causes, and list what is still open.
- **`docs-md/TASKS.md`**: tick what's done and add open items, such as unexplained
  `permission_denied` refusals or flaky specs.
- **`docs-md/DECISIONS.md`**: only if a behaviour or semantics decision was made.

## 7. Finish

- Run `npm run test:unit` and confirm it's all green. If the rules changed, also run
  `npm run test:emulator`.
- Commit on a branch, not main, and stage paths explicitly. Exclude:
  - `config.js`
  - `images/guide/*`
  - `*.log` (`database-debug.log`, `firebase-debug.log`)
  - `test-results/`, `.simulator-data/`
  - your own probe specs and screenshots
- End the commit message with the Co-Authored-By line. Don't push unless asked.
- Report to the user:
  - the clean/total count of the final soak,
  - each bug with its test,
  - which failures were harness bugs or flakes,
  - what is still open.
