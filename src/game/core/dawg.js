// DAWG (Directed Acyclic Word Graph) — minimal, browser-safe.
//
// Used by the v2 dictionary path: encode a sorted Hebrew word list into a
// compact binary that the runtime decodes once and queries via dawgHas().
// Hebrew is morphologically rich, so suffix sharing compresses well; a
// ~500K-form lexicon fits in roughly 1 MB binary (uncompressed) and ~300 KB
// over the wire after gzip.
//
// Two halves live here:
//   - buildDawg(sortedWords) + serializeDawg(dawg) → ArrayBuffer  (Node-side)
//   - parseDawg(arrayBuffer) → { has, prefixWalk, root }          (browser-side)
//
// The encoder uses Daciuk's incremental minimal-DFA construction (2000),
// which requires lexicographically sorted, deduped input.
//
// Binary format v1:
//   bytes  0..3   magic 'DAWG'
//   bytes  4..7   format version (u32 LE, current = 1)
//   bytes  8..11  node count (u32 LE)
//   bytes 12..15  root node index (u32 LE)
//   bytes 16..16+4N   node offset table (u32 LE × N), pointer into payload
//   bytes 16+4N..end  node payload, concatenated:
//                     [u8 flags] [u8 edgeCount] [u16 char, u32 target] × edgeCount
//   flags bit 0: isFinal (1 = word boundary)
//
// Edges within a node are sorted by char; lookup is linear (Hebrew alphabet
// is ~22 letters incl. finals, so binary search adds overhead without help).

const MAGIC = 0x47574144; // 'DAWG' little-endian
const FORMAT_VERSION = 1;
const FLAG_FINAL = 0x01;

// ---------- Encoder (Node-side) ----------

class DawgNode {
  constructor() {
    this.final = false;
    this.edges = new Map(); // charCode -> DawgNode
    this.id = -1;
  }
  equivStr() {
    // Children must already have IDs assigned (registered) before this is called.
    let s = this.final ? 'F' : '_';
    const keys = [...this.edges.keys()].sort((a, b) => a - b);
    for (const k of keys) s += '|' + k + '>' + this.edges.get(k).id;
    return s;
  }
}

export function buildDawg(sortedWords) {
  const root = new DawgNode();
  const register = new Map(); // equivStr -> canonical DawgNode
  const canonical = [];       // index = id, value = DawgNode
  const stack = [root];
  let prevWord = '';

  for (const word of sortedWords) {
    if (prevWord !== '' && word <= prevWord) {
      throw new Error(`buildDawg requires sorted unique input; ${JSON.stringify(prevWord)} >= ${JSON.stringify(word)}`);
    }
    let cp = 0;
    while (cp < prevWord.length && cp < word.length && prevWord.charCodeAt(cp) === word.charCodeAt(cp)) {
      cp++;
    }
    replaceOrRegister(stack, prevWord.length, cp, register, canonical);
    for (let i = cp; i < word.length; i++) {
      const next = new DawgNode();
      stack[stack.length - 1].edges.set(word.charCodeAt(i), next);
      stack.push(next);
    }
    stack[stack.length - 1].final = true;
    prevWord = word;
  }
  replaceOrRegister(stack, prevWord.length, 0, register, canonical);

  // Root is never minimized (it's the unique entry point) so it has no ID yet.
  root.id = canonical.length;
  canonical.push(root);

  return { root, nodes: canonical };
}

function replaceOrRegister(stack, prevLen, untilDepth, register, canonical) {
  for (let depth = prevLen; depth > untilDepth; depth--) {
    const node = stack[depth];
    const key = node.equivStr();
    const existing = register.get(key);
    if (existing && existing !== node) {
      // Re-point the parent's edge to the canonical node and discard `node`.
      const parent = stack[depth - 1];
      for (const [c, child] of parent.edges) {
        if (child === node) { parent.edges.set(c, existing); break; }
      }
    } else if (!existing) {
      // First time we've seen this equivalence class — register and assign ID.
      node.id = canonical.length;
      canonical.push(node);
      register.set(key, node);
    }
    stack.pop();
  }
}

// ---------- Serialization ----------

export function serializeDawg(dawg) {
  const { nodes, root } = dawg;
  const N = nodes.length;
  // First pass: compute payload size and per-node offsets
  const offsets = new Uint32Array(N);
  let payloadSize = 0;
  for (let i = 0; i < N; i++) {
    offsets[i] = payloadSize;
    const n = nodes[i];
    payloadSize += 2 + n.edges.size * 6;
  }
  const headerSize = 16;
  const tableSize = N * 4;
  const total = headerSize + tableSize + payloadSize;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, N, true);
  view.setUint32(12, root.id, true);
  for (let i = 0; i < N; i++) {
    view.setUint32(16 + i * 4, headerSize + tableSize + offsets[i], true);
  }
  // Payload
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    let off = headerSize + tableSize + offsets[i];
    view.setUint8(off, n.final ? FLAG_FINAL : 0); off += 1;
    view.setUint8(off, n.edges.size); off += 1;
    const codes = [...n.edges.keys()].sort((a, b) => a - b);
    for (const c of codes) {
      view.setUint16(off, c, true); off += 2;
      view.setUint32(off, n.edges.get(c).id, true); off += 4;
    }
  }
  return buf;
}

// ---------- Decoder (browser-safe) ----------

export function parseDawg(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`bad DAWG magic: 0x${magic.toString(16)}`);
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) throw new Error(`unsupported DAWG version: ${version}`);
  const nodeCount = view.getUint32(8, true);
  const root = view.getUint32(12, true);
  const offsetTableStart = 16;

  function nodeOffset(id) {
    return view.getUint32(offsetTableStart + id * 4, true);
  }

  function isFinal(id) {
    return (view.getUint8(nodeOffset(id)) & FLAG_FINAL) !== 0;
  }

  function edgeTarget(nodeId, charCode) {
    const off = nodeOffset(nodeId);
    const count = view.getUint8(off + 1);
    let edgeStart = off + 2;
    for (let i = 0; i < count; i++) {
      const c = view.getUint16(edgeStart, true);
      if (c === charCode) return view.getUint32(edgeStart + 2, true);
      if (c > charCode) return -1; // edges are sorted, can short-circuit
      edgeStart += 6;
    }
    return -1;
  }

  function has(word) {
    let node = root;
    for (let i = 0; i < word.length; i++) {
      node = edgeTarget(node, word.charCodeAt(i));
      if (node < 0) return false;
    }
    return isFinal(node);
  }

  // Walk a prefix and return the node id reached, or -1 if no such prefix
  function prefixWalk(prefix) {
    let node = root;
    for (let i = 0; i < prefix.length; i++) {
      node = edgeTarget(node, prefix.charCodeAt(i));
      if (node < 0) return -1;
    }
    return node;
  }

  // Yield each edge from a node as { char: number, target: number }
  function* edgesFrom(nodeId) {
    const off = nodeOffset(nodeId);
    const count = view.getUint8(off + 1);
    let p = off + 2;
    for (let i = 0; i < count; i++) {
      yield { char: view.getUint16(p, true), target: view.getUint32(p + 2, true) };
      p += 6;
    }
  }

  // Yield every word stored in the DAWG, in lexicographic order.
  // Used at load time to populate the legacy DICT Set so iteration callers
  // (mini-game word search, bot, etc.) keep working unchanged.
  function* words() {
    const stack = [{ node: root, prefix: '', edgeIter: edgesFrom(root) }];
    if (isFinal(root)) yield '';
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = top.edgeIter.next();
      if (next.done) { stack.pop(); continue; }
      const { char, target } = next.value;
      const newPrefix = top.prefix + String.fromCharCode(char);
      if (isFinal(target)) yield newPrefix;
      stack.push({ node: target, prefix: newPrefix, edgeIter: edgesFrom(target) });
    }
  }

  return { has, prefixWalk, edgesFrom, isFinal, words, root, nodeCount, version };
}
