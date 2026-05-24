# Emulator tests

Rule-aware tests that run against a local Firebase Realtime Database emulator
with the production rules from [../../firebase.database.rules.json](../../firebase.database.rules.json).

These tests catch the class of bug that `tests/unit/` + the in-memory mock
cannot: cross-user writes, turn-check violations, missing rules, version-
mismatch behaviour, etc.

## Run

```
npm run test:emulator
```

That command spins up the database emulator on port 9000, runs every
`tests/emulator/*.test.mjs` against it, and tears it down on exit.

## Add a test

```js
import test from 'node:test';
import { withTestEnv, makeUserApp, assertSucceeds, assertFails } from './setup.mjs';

test('host can create their own pending room', async () => {
  await withTestEnv(async (env) => {
    const host = makeUserApp(env, 'host-uid');
    await assertSucceeds(host.ref('pendingRooms/123456').set({
      hostUid: 'host-uid',
      mode: 'friend-live',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }));
  });
});
```

## Helpers in [setup.mjs](./setup.mjs)

- `withTestEnv(fn)` — fresh env per test; rules are reloaded from the JSON file.
- `makeUserApp(env, uid)` — authed client for `uid`.
- `makeAnonApp(env)` — unauthenticated client.
- `seedWithoutRules(env, fn)` — bypass rules to seed state for a test.
- `adminRead(env, path)` — read a path bypassing rules (verify writes landed).
- `assertSucceeds`, `assertFails` — re-exported from `@firebase/rules-unit-testing`.
