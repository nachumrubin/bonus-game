// wordInfoService — what a dictionary word is and where it comes from, for the
// מילון overlay's "word origin" panel (toggle: uiPreferences.wordInfoEnabled).
//
// Data: data/word-info/ (built by scripts/sync-boost-dictionary.mjs from the
// boost-dictionary repo's word_info.tsv.gz). index.json holds the source texts
// and the shard list; each <hex code point of first letter>.tsv.gz shard holds
// rows of `word \t source \t more \t reading_1 [\t reading_2 [\t reading_3]]`.
//
// Nothing is fetched until the first lookup, and then only index.json plus the
// one shard the word needs. Lookups are read-only and never affect validation:
// isValid() stays the single source of truth for whether a word is playable.

import { terminalFinalVariants } from '../core/hebrewDictionary.js';

export const WORD_INFO_BASE_URL = './data/word-info/';

export function shardFileFor(word) {
  const cp = String(word ?? '').codePointAt(0);
  return cp == null ? '' : `${cp.toString(16).padStart(4, '0')}.tsv.gz`;
}

// Parse a decompressed shard into Map(word → { source, more, readings }).
export function parseShard(text) {
  const map = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line) continue;
    const [word, source = '', more = '0', ...readings] = line.split('\t');
    if (!word) continue;
    map.set(word, { source, more: Number(more) || 0, readings: readings.filter(Boolean) });
  }
  return map;
}

// Shards are gzip files. Some hosts send them with Content-Encoding: gzip, in
// which case the browser has already inflated the body — so only inflate when
// the gzip magic bytes are actually there.
export async function decodeShardBytes(buffer, { DecompressionStreamCtor = globalThis.DecompressionStream } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder('utf-8').decode(bytes);
  if (typeof DecompressionStreamCtor !== 'function') throw new Error('word-info: gzip not supported');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamCtor('gzip'));
  return await new Response(stream).text();
}

export function createWordInfoService({
  fetchFn = globalThis.fetch?.bind(globalThis),
  baseUrl = WORD_INFO_BASE_URL,
  DecompressionStreamCtor = globalThis.DecompressionStream,
} = {}) {
  let indexPromise = null;
  const shardPromises = new Map();

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = (async () => {
        const resp = await fetchFn(`${baseUrl}index.json`);
        if (!resp?.ok) throw new Error(`word-info: index ${resp?.status}`);
        return await resp.json();
      })();
      indexPromise.catch(() => { indexPromise = null; });   // retry on the next lookup
    }
    return indexPromise;
  }

  function loadShard(file) {
    if (!shardPromises.has(file)) {
      const p = (async () => {
        const resp = await fetchFn(`${baseUrl}${file}`);
        if (!resp?.ok) throw new Error(`word-info: ${file} ${resp?.status}`);
        return parseShard(await decodeShardBytes(await resp.arrayBuffer(), { DecompressionStreamCtor }));
      })();
      p.catch(() => shardPromises.delete(file));
      shardPromises.set(file, p);
    }
    return shardPromises.get(file);
  }

  // Resolves to { word, source, sourceText, readings, more } or null when the
  // word has no entry (e.g. it was added through the Firebase approved overlay).
  // Rejects only on network / decode failure.
  async function lookup(rawWord) {
    const word = String(rawWord ?? '').replace(/[^א-ת]/g, '');
    if (!word) return null;
    if (!fetchFn) throw new Error('word-info: fetch unavailable');
    const index = await loadIndex();
    const files = index?.files ?? {};
    for (const variant of terminalFinalVariants(word)) {
      const file = shardFileFor(variant);
      if (!files[file]) continue;
      const entry = (await loadShard(file)).get(variant);
      if (entry) {
        return {
          word: variant,
          source: entry.source,
          sourceText: index?.sources?.[entry.source] ?? '',
          readings: entry.readings,
          more: entry.more,
        };
      }
    }
    return null;
  }

  return { lookup };
}
