// boostieLoader — downloads a Boostie .glb once and parses a fresh copy per use (each
// scoreboard slot needs its own scene graph). The models are meshopt-compressed
// (scripts/optimize-boosties.mjs), so the loader gets the meshopt decoder.

import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';
import { MeshoptDecoder } from '../../vendor/three/meshopt_decoder.module.js';

const buffers = new Map();   // src -> Promise<ArrayBuffer>
let loader = null;

function gltfLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

export function fetchModel(src) {
  if (!buffers.has(src)) {
    const p = fetch(src).then((resp) => {
      if (!resp.ok) throw new Error(`Boostie model ${src}: HTTP ${resp.status}`);
      return resp.arrayBuffer();
    });
    p.catch(() => buffers.delete(src));   // a failed download may be retried later
    buffers.set(src, p);
  }
  return buffers.get(src);
}

export async function loadModel(src) {
  const buf = await fetchModel(src);
  await MeshoptDecoder.ready;
  return new Promise((resolve, reject) => gltfLoader().parse(buf.slice(0), '', resolve, reject));
}
