// crashCollector.mjs
//
// One per simulator run. Sources of crashes flow through report():
//   - invariant violations from invariants.mjs
//   - engine throws (try/catch around session.dispatch)
//   - commitTransaction livelocks (caller passes pre-built records)
//   - hang detector (caller passes pre-built records)
//   - replay divergence (caller passes pre-built records)
//
// Dedup is fingerprint-based: each record's class + truncated detail + stack
// hash form a key. First occurrence is written to disk in full; subsequent
// occurrences increment a counter on the same crash file.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createCrashCollector({ runId, outDir, seed }) {
  const dir = path.join(outDir, 'crashes', runId);
  fs.mkdirSync(dir, { recursive: true });
  const byFingerprint = new Map(); // fingerprint -> { count, path, record }
  const counts = Object.create(null);

  function report(record) {
    if (!record) return;
    const klass = record.class ?? 'unknown';
    counts[klass] = (counts[klass] ?? 0) + 1;
    const fingerprint = makeFingerprint(record);
    const prior = byFingerprint.get(fingerprint);
    if (prior) {
      prior.count += 1;
      // Persist updated count.
      try {
        const file = prior.path;
        const current = JSON.parse(fs.readFileSync(file, 'utf8'));
        current.count = prior.count;
        fs.writeFileSync(file, JSON.stringify(current, null, 2));
      } catch { /* swallow: a corrupt file shouldn't kill the run */ }
      return prior;
    }
    const filename = `${klass}-${fingerprint.slice(0, 8)}.json`;
    const file = path.join(dir, filename);
    const payload = {
      crashId: fingerprint,
      class: klass,
      fingerprint,
      seed,
      gameId: record.gameId ?? null,
      gameSeed: record.gameSeed ?? null,
      tickCount: record.tickCount ?? null,
      roomSnapshot: record.roomSnapshot ?? null,
      lastCommand: record.lastCommand ?? null,
      detail: record.detail ?? null,
      stack: record.stack ?? null,
      message: record.message ?? null,
      reproCommand: record.gameSeed
        ? `npm run sim -- --seed ${record.gameSeed} --games 1`
        : `npm run sim -- --seed ${seed}`,
      firstSeenAt: new Date().toISOString(),
      count: 1,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    const entry = { count: 1, path: file, record: payload };
    byFingerprint.set(fingerprint, entry);
    return entry;
  }

  function summary() {
    const uniqueByClass = Object.create(null);
    for (const entry of byFingerprint.values()) {
      const k = entry.record.class;
      uniqueByClass[k] = (uniqueByClass[k] ?? 0) + 1;
    }
    return {
      totalCrashes: Object.values(counts).reduce((s, n) => s + n, 0),
      uniqueCrashes: byFingerprint.size,
      countsByClass: counts,
      uniqueByClass,
    };
  }

  function writeSummary(extras = {}) {
    const file = path.join(outDir, `summary-${runId}.json`);
    const payload = {
      runId,
      seed,
      finishedAt: new Date().toISOString(),
      ...extras,
      ...summary(),
    };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    return file;
  }

  return { report, summary, writeSummary, dir };
}

function makeFingerprint(record) {
  const parts = [
    record.class ?? '',
    truncate(record.detail ?? record.message ?? '', 200),
    firstStackFrame(record.stack ?? ''),
  ];
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) : s;
}

function firstStackFrame(stack) {
  if (typeof stack !== 'string' || !stack) return '';
  for (const line of stack.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('at ')) return trimmed;
  }
  return stack.split('\n')[0] ?? '';
}
