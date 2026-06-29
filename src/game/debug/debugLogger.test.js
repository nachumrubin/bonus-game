import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMockDb } from '../online/mockFirebase.js';
import {
  configureDebugLogger, logGameEvent, createGameSnapshot, putClientSnapshot,
  createDebugWarning, createDebugReport, upsertGameIndex, getGameDebugTimeline,
  pruneUndefined,
} from './debugLogger.js';
import { DEBUG_EVENT } from './debugSchema.js';

configureDebugLogger({ serverTimestamp: () => 1000 }); // deterministic for assertions

test('logGameEvent appends with a push-key eventId, gameId and timestamps', async () => {
  const db = makeMockDb();
  const id = await logGameEvent(db, 'room1', { type: DEBUG_EVENT.WORD_ACCEPTED, summary: 'Nachum played שלום', userId: 'u0' });
  assert.ok(id, 'returns an eventId');
  const stored = db._data.gameEvents.room1[id];
  assert.equal(stored.eventId, id);
  assert.equal(stored.gameId, 'room1');
  assert.equal(stored.type, DEBUG_EVENT.WORD_ACCEPTED);
  assert.equal(stored.serverTimestamp, 1000);
  assert.ok(stored.clientTimestamp > 0);
});

test('pruneUndefined deep-strips undefined so Firebase set() never rejects', () => {
  const cleaned = pruneUndefined({ a: 1, b: undefined, payload: { reason: undefined, score: 0 }, list: [1, undefined, { x: undefined, y: 2 }] });
  assert.deepEqual(cleaned, { a: 1, payload: { score: 0 }, list: [1, null, { y: 2 }] });
});

test('logGameEvent stores no undefined fields (an absent reason must not break the write)', async () => {
  const db = makeMockDb();
  const id = await logGameEvent(db, 'room1', { type: DEBUG_EVENT.TURN_CHANGED, payload: { reason: undefined, turnNumber: 3 } });
  assert.ok(id, 'write succeeds despite undefined reason');
  const stored = db._data.gameEvents.room1[id];
  assert.ok(!('reason' in stored.payload), 'undefined reason pruned');
  assert.equal(stored.payload.turnNumber, 3);
});

test('createGameSnapshot keys server snapshots by version', async () => {
  const db = makeMockDb();
  await createGameSnapshot(db, 'room1', 7, { boardHash: 'abc', hostScore: 30 });
  assert.equal(db._data.gameSnapshots.room1['7'].boardHash, 'abc');
  assert.equal(db._data.gameSnapshots.room1['7'].key, 7);
});

test('putClientSnapshot writes under the slot and only accepts 0/1', async () => {
  const db = makeMockDb();
  const id = await putClientSnapshot(db, 'room1', 1, { boardHash: 'xyz', believedVersion: 7 });
  assert.ok(id);
  assert.equal(db._data.clientSnapshots.room1['1'][id].boardHash, 'xyz');
  assert.equal(await putClientSnapshot(db, 'room1', 2, {}), null, 'rejects invalid slot');
});

test('createDebugWarning and createDebugReport append', async () => {
  const db = makeMockDb();
  const wId = await createDebugWarning(db, 'room1', { type: 'SCORE_MISMATCH', severity: 'high' });
  assert.equal(db._data.debugWarnings.room1[wId].type, 'SCORE_MISMATCH');
  const rId = await createDebugReport(db, { gameId: 'room1', userMessage: 'word disappeared', userId: 'u0' });
  assert.equal(db._data.debugReports[rId].userMessage, 'word disappeared');
});

test('getGameDebugTimeline aggregates and filters reports by gameId', async () => {
  const db = makeMockDb();
  await upsertGameIndex(db, 'room1', { hostName: 'Nachum', guestName: 'Hodaya', status: 'playing' });
  await logGameEvent(db, 'room1', { type: DEBUG_EVENT.GAME_STARTED });
  await createGameSnapshot(db, 'room1', 1, { boardHash: 'a' });
  await putClientSnapshot(db, 'room1', 0, { boardHash: 'a' });
  await createDebugWarning(db, 'room1', { type: 'NEGATIVE_SCORE' });
  await createDebugReport(db, { gameId: 'room1', userMessage: 'mine' });
  await createDebugReport(db, { gameId: 'other', userMessage: 'not mine' });

  const t = await getGameDebugTimeline(db, 'room1');
  assert.equal(t.events.length, 1);
  assert.equal(t.snapshots.length, 1);
  assert.equal(t.clientSnapshots[0].length, 1);
  assert.equal(t.warnings.length, 1);
  assert.equal(t.reports.length, 1, 'only room1 reports');
  assert.equal(t.reports[0].userMessage, 'mine');
  assert.equal(t.index.hostName, 'Nachum');
});

test('writers are best-effort: a throwing db never rejects', async () => {
  const throwingDb = { ref() { throw new Error('boom'); } };
  assert.equal(await logGameEvent(throwingDb, 'room1', {}), null);
  assert.equal(await createDebugReport(throwingDb, {}), null);
});
