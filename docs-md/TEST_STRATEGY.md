# TEST_STRATEGY.md — Testing Strategy and Coverage

> Source evidence: `package.json`, `tests/unit/`, `tests/e2e/`, `tests/emulator/`, `SPINE_TODO.md`, `docs/engine-parity-*.md`, `playwright.config.js`

---

## Test Suites Overview

| Suite | Runner | Command | Count |
|-------|--------|---------|-------|
| Unit + Integration | Node.js `--test` | `npm run test:unit` | 609+ tests |
| Firebase Emulator | Firebase + Node.js | `npm run test:emulator` | ~30+ tests |
| E2E Browser | Playwright | `npm run test:e2e` | ~10+ tests |

---

## Unit Tests (`tests/unit/`)

Run with: `node --test tests/unit/*.test.js`

### Test Files

| File | Area | Description |
|------|------|-------------|
| `engine-parity.test.js` | Core engine | Primary parity suite: verifies spine engine matches legacy behavior |
| `engine-parity-highrisk.test.js` | Core engine | High-risk edge cases (timing, race conditions, illegal-word flow) |
| `engine-parity-low-gaps.test.js` | Core engine | Lower-risk behavioral gaps |
| `engine-parity-async-resume.test.js` | Online | Async game session resume flow |
| `engine-parity-pending-recovery.test.js` | Online | Recovery from unconfirmed pending moves |
| `engine-parity-live-watchdog.test.js` | Online | Live timer watchdog behavior |
| `engine-parity-end-game-progression.test.js` | Core engine | Game-over conditions and winner determination |
| `engine-parity-leave-game.test.js` | Online | Leave/disconnect flows |
| `engine-parity-invite-lifecycle.test.js` | Online | Invite send → accept → reject lifecycle |
| `engine-parity-scoring-animation.test.js` | UI | Score animation timing and sequencing |
| `engine-parity-browser-notification-fallback.test.js` | Notifications | Browser notification fallback behavior |
| `disconnect-leave-e2e.test.js` | Online | Full disconnect and leave E2E flows |
| `firebase-rules.test.js` | Firebase | Security rules validation (non-emulator) |
| `manifest.test.js` | PWA | PWA manifest field validation |
| `logo-markup.test.js` | UI | Logo rendering markup |
| `shailta-keyboard-removal.test.js` | UI | Hebrew keyboard cleanup |

### What's Well Covered

- Core engine state transitions (pass, move, exchange, resign)
- Turn advancement and game-over detection
- `passCount` accumulation → 6-pass threshold
- Lock mechanics (inventory, tick, expiry)
- Scoring with bingo bonus
- Move validation (collinearity, gaps, connectivity)
- Bonus resolver (B1–B13 resolution paths)
- Invite lifecycle (send, accept, reject, expiry)
- Matchmaking queue and pairing
- Async session summary and sorting
- Timeout watchdog claim logic
- Browser notification fallback routing
- Firebase security rules (both unit and emulator)
- PWA manifest fields
- Service worker routing

### Test Infrastructure

Source: `src/game/online/mockFirebase.js`

- In-memory Firebase mock for unit testing online services
- Avoids real Firebase connection in unit tests
- Supports: `db.ref().set()`, `.transaction()`, `.once()`, `.on()`, `.off()`

---

## Emulator Tests (`tests/emulator/`)

Run with: `npm run test:emulator`
Requires: Firebase CLI (`firebase-tools` in devDependencies)
Emulator: Database on port 9000

### Files

| File | Coverage |
|------|----------|
| `baseline.test.mjs` | Basic auth rules: deny unauthenticated writes, allow authenticated reads |
| `rules-audit.test.mjs` | Comprehensive coverage of all major rule paths |
| `async-reminder-rules.test.mjs` | Async reminder-specific auth (lastReminderAt writes) |
| `timer-rules.test.mjs` | Timed game rules: deadline enforcement, grace period claims |
| `setup.mjs` | Emulator initialization + test database setup |

### Key Rule Paths Tested

From `rules-audit.test.mjs`:
- `/rooms` write with valid vs. invalid version increment
- `/rooms` write on opponent's turn (should be rejected)
- `/rooms/livePreview` (either player can write)
- `/rooms/settings` (either player can write)
- `/invites/{toUid}` (only recipient can read, sender can write)
- `/inviteAcks/{fromUid}` (only sender can read)
- `/globalRatings` (valid fields required, uid must match)
- `/presence` (only self can write)
- `/matchmakingQueue` (only self can write own entry)
- `/users/{uid}` (only self can read/write except activeRoom)

### CI Integration

Source: `.github/workflows/firebase-rules.yml`

- Triggers on push to `main` when `firebase.database.rules.json` changes
- Deploys rules to `boost-8ef11` Firebase project using stored token

---

## E2E Tests (`tests/e2e/`)

Run with: `npm run test:e2e`
Runner: Playwright 1.60.0
Base URL: `http://127.0.0.1:4173`
Server: Python `http.server` (configured in `playwright.config.js`)

### Files

| File | Coverage |
|------|----------|
| `spine-boot.spec.js` | Verifies `window.__spine` is available after page load |
| `menu-routing.spec.js` | Menu button clicks navigate to correct screens |
| `non-menu-buttons.spec.js` | Non-menu button interactions |

### Limitations
- E2E tests run against local HTTP server (no Firebase)
- Online game flows not covered by E2E
- Visual regression not covered

---

## Test Execution

```bash
# All unit tests (fastest, no external deps)
npm run test:unit

# Firebase emulator tests (requires firebase-tools installed)
npm run test:emulator

# E2E (requires Python available for http.server)
npm run test:e2e

# E2E with visible browser
npm run test:e2e:headed
```

---

## Coverage Gaps

Based on `docs/engine-parity-missing-report.md`, `docs/legacy-vs-new-gap-report.md`, and `SPINE_TODO.md`:

### Confirmed Missing Test Coverage

1. **Bot move selection** — `botSearch.js` algorithm correctness not tested
2. **B1–B13 branch coverage** — not all mini-game branches have assertion tests
3. **Profile/stats/avatar progression** — parity with legacy not verified
4. **Scoring animation timing** — sequence tested but pixel-level rendering not
5. **Mobile UI layout** — responsive behavior not tested (no visual regression)
6. **Music/sound scheduling** — `audioService.js` behavior not tested
7. **UI screen state reset** — what state is preserved vs. cleared across game start/end not characterized
8. **Dictionary admin flow** — admin claim-gated UI flows not tested
9. **`settingsCompat.js` migration** — legacy format → spine format migration path only partially covered
10. **Friend request UI** — `friendsService.js` not tested in available suite

### Partially Covered (Needs More)

1. **Online timeout claim** — basic case covered; edge cases (concurrent claims, stale room) less covered
2. **Disconnect recovery** — Phase 1A flows tested by `disconnect-leave-e2e.test.js`; Phase 1B+ not started
3. **Async game expiry** — `asyncReminderService.classify()` tested; actual sweep execution less covered
4. **Dictionary two-letter policy** — coverage exists but explicit regression guard not found

### Test Anti-Patterns to Avoid

- Do not mock the event bus in tests that test bus-dependent behavior — use real bus
- Do not test animation frames (Playwright headless does not guarantee RAF timing)
- Do not rely on `Date.now()` without injecting a clock — use injectable `now` parameters

---

## Writing New Tests

### Unit Test Pattern

```javascript
// tests/unit/my-feature.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createInitialState, createEngine } from '../../src/game/core/gameEngine.js';
import { createBus } from '../../src/events/bus.js';

describe('my feature', () => {
  it('does the thing', () => {
    const bus = createBus();
    const state = createInitialState({ mode: 'offline-2p', tileBagSeed: 'test', players: {...} });
    const engine = createEngine({ state, bus });
    engine.start();
    // ... assert
  });
});
```

### Emulator Test Pattern

```javascript
// tests/emulator/my-rules.test.mjs
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
// see tests/emulator/setup.mjs for environment setup
```

### Firebase Mock in Unit Tests

```javascript
import { createMockFirebase } from '../../src/game/online/mockFirebase.js';
const { db } = createMockFirebase();
// use db with roomService functions
```
