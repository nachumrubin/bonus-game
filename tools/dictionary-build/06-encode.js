#!/usr/bin/env node
// Phase 3: encode the curated word list to a DAWG binary + metadata sidecar.
//
// Inputs:
//   output/dictionary.curated.txt   (from 05-merge-and-gate.js)
//   OR, with --from-legacy flag, data/dictionary.base.txt
//     — used to generate a "v2" binary that is functionally identical to the
//     legacy 40K list, so the runtime swap can be tested independently of the
//     lexicon work.
//
// Outputs:
//   data/dictionary.v2.bin
//   data/dictionary.v2.meta.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDawg, serializeDawg, parseDawg } from '../../src/game/core/dawg.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const OUTPUT_DIR = path.join(HERE, 'output');

function pickInput(args) {
  if (args.includes('--from-legacy')) {
    return {
      path: path.join(REPO_ROOT, 'data', 'dictionary.base.txt'),
      source: 'legacy-40k-placeholder',
    };
  }
  return {
    path: path.join(OUTPUT_DIR, 'dictionary.curated.txt'),
    source: 'curated-pipeline',
  };
}

function main() {
  const args = process.argv.slice(2);
  const input = pickInput(args);
  if (!fs.existsSync(input.path)) {
    throw new Error(`input not found: ${input.path}`);
  }
  console.log(`Reading ${input.path}…`);
  const txt = fs.readFileSync(input.path, 'utf8');
  const words = [...new Set(txt.split(/\r?\n/).map((w) => w.trim()).filter(Boolean))].sort();
  console.log(`Building DAWG from ${words.length} words…`);
  const dawg = buildDawg(words);
  const buf = serializeDawg(dawg);
  console.log(`DAWG: ${dawg.nodes.length} nodes, ${buf.byteLength} bytes binary.`);

  // Self-test: every input word must look up correctly.
  console.log('Running round-trip self-test…');
  const parsed = parseDawg(buf);
  let mismatches = 0;
  for (const w of words) {
    if (!parsed.has(w)) mismatches++;
  }
  if (mismatches > 0) {
    throw new Error(`Round-trip failure: ${mismatches} words missing from decoded DAWG`);
  }
  console.log(`Round-trip OK (${words.length}/${words.length}).`);

  const outBin = path.join(REPO_ROOT, 'data', 'dictionary.v2.bin');
  const outMeta = path.join(REPO_ROOT, 'data', 'dictionary.v2.meta.json');
  fs.writeFileSync(outBin, Buffer.from(buf));
  fs.writeFileSync(outMeta, JSON.stringify({
    format: 'dawg-v1',
    wordCount: words.length,
    nodeCount: dawg.nodes.length,
    byteSize: buf.byteLength,
    source: input.source,
    builtAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${outBin} and ${outMeta}.`);
}

main();
