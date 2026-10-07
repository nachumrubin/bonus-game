#!/usr/bin/env node
// Shrinks the built Boostie models for the app.
//
//   node scripts/optimize-boosties.mjs                 all of Blender designs/boosties/out/<char>_l<N>.glb
//   node scripts/optimize-boosties.mjs zapi_l3 bubo_l7 only these
//
// Reads  Blender designs/boosties/out/<key>.glb  (written by build_boostie.py)
// Writes assets/boosties/<key>.glb
//
// Dedup, quantize (KHR_mesh_quantization) and meshopt compression (EXT_meshopt_compression,
// level high). The textures are already WebP at 1024 px from the build. Node names are kept:
// the in-app player finds the bones, eyes, lids, jaw and the *_glow anchors by name.
// The app's GLTFLoader needs MeshoptDecoder (src/vendor/three/).

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const SRC = 'Blender designs/boosties/out';
const DST = 'assets/boosties';
const KEY = /^(zapi|bubo|bot_[a-z]+)(_l\d)?$/;   // shipped models only; test builds (e.g. *_trellis) are skipped

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const wanted = process.argv.slice(2);
const keys = (wanted.length ? wanted : fs.readdirSync(SRC).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)))
  .filter((k) => KEY.test(k));
if (!keys.length) { console.error('No models to optimize.'); process.exit(1); }

fs.mkdirSync(DST, { recursive: true });
for (const key of keys) {
  const src = path.join(SRC, `${key}.glb`);
  const doc = await io.read(src);
  await doc.transform(dedup(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const out = path.join(DST, `${key}.glb`);
  await io.write(out, doc);
  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  console.log(`${key}: ${kb(src)} KB -> ${kb(out)} KB`);
}
