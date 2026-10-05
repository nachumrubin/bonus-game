// failureCollector.mjs — dedupe soak failures by signature and keep a few
// full repro bundles per signature.
//
// signature = violation class + its detail with numbers, ids and agent names
// normalised away, so "desync-hostScore agent A v41: 120 vs 127" and the same
// failure in another game land in one bucket. The first `maxBundles` games
// per signature get a full bundle on disk; the rest only bump the counter.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function normalizeDetail(detail = '') {
  return String(detail)
    .replace(/\b(fc|fi|mm|room|soak)[_-][\w-]+/g, '<room>')
    .replace(/[A-Za-z0-9]{20,}/g, '<id>')
    .replace(/agent [AB]\b/g, 'agent ?')
    .replace(/slot [01]\b/g, 'slot ?')
    .replace(/-?\d+(\.\d+)?/g, '#')
    .replace(/[֐-׿]+/g, '<heb>')
    .slice(0, 160);
}

export function signatureOf(v) {
  const norm = `${v.class}|${normalizeDetail(v.detail).split(':')[0]}`;
  return { key: `${v.class}-${crypto.createHash('sha1').update(norm).digest('hex').slice(0, 8)}`, norm };
}

export function createFailureCollector({ outDir, runId, maxBundles = 3 }) {
  const dir = path.join(outDir, 'failures', runId);
  const bySig = new Map(); // key -> { class, norm, count, games:Set, bundles:[], example }

  /**
   * @param {object} game     { gameId, roomId, ... } summary
   * @param {object[]} violations
   * @param {() => object} buildBundle  lazily builds the full bundle
   */
  function report(game, violations, buildBundle) {
    if (!violations?.length) return;
    let bundle = null;
    const seenInGame = new Set();
    for (const v of violations) {
      const { key, norm } = signatureOf(v);
      let entry = bySig.get(key);
      if (!entry) {
        entry = { class: v.class, norm, count: 0, games: new Set(), bundles: [], example: v.detail };
        bySig.set(key, entry);
      }
      entry.count++;
      if (seenInGame.has(key)) continue;
      seenInGame.add(key);
      entry.games.add(game.gameId);
      if (entry.bundles.length < maxBundles) {
        bundle ??= buildBundle();
        const file = path.join(dir, key, `${game.gameId}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ signature: key, violation: v, ...bundle }, null, 1));
        entry.bundles.push(file);
      }
    }
  }

  function summary() {
    return [...bySig.entries()]
      .map(([key, e]) => ({ signature: key, class: e.class, count: e.count, games: e.games.size, example: e.example, bundles: e.bundles }))
      .sort((a, b) => b.games - a.games);
  }

  return { report, summary, dir, get uniqueCount() { return bySig.size; } };
}
