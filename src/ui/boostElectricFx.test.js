import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perimeterPoint, envelope, crawlBolt, arcBolt, playBoostElectric } from './boostElectricFx.js';

const R = { x: 10, y: 20, w: 40, h: 40 };

test('perimeterPoint walks the tile outline clockwise with outward normals', () => {
  assert.deepEqual(perimeterPoint(0, R), { x: 10, y: 20, nx: 0, ny: -1 });
  assert.deepEqual(perimeterPoint(0.25, R), { x: 50, y: 20, nx: 1, ny: 0 });
  assert.deepEqual(perimeterPoint(0.5, R), { x: 50, y: 60, nx: 0, ny: 1 });
  assert.deepEqual(perimeterPoint(0.75, R), { x: 10, y: 60, nx: -1, ny: 0 });
  assert.deepEqual(perimeterPoint(1.25, R), perimeterPoint(0.25, R));
});

test('envelope strikes fast, sustains, and fades to zero at the end', () => {
  assert.equal(envelope(0), 0);
  assert.equal(envelope(0.3), 1);
  assert.ok(envelope(0.9) < 0.5 && envelope(0.9) > 0);
  assert.equal(envelope(1), 0);
});

test('bolts are deterministic for a seeded rand and stay near their path', () => {
  let s = 1; const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const crawl = crawlBolt(R, 0, 0.25, rand);
  assert.ok(crawl.length > 5);
  assert.ok(crawl.every(p => p.y >= 20 - 4 && p.y <= 20 + 2)); // top edge ± jitter
  const arc = arcBolt(0, 0, 100, 0, rand, 4);
  assert.equal(arc.length, 17);
  assert.deepEqual(arc[0], { x: 0, y: 0 });
  assert.deepEqual(arc.at(-1), { x: 100, y: 0 });
});

test('playBoostElectric is a safe no-op without a DOM', () => {
  const stop = playBoostElectric(null);
  assert.equal(typeof stop, 'function');
  stop();
});
