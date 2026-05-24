// Seeded PRNG (mulberry32). Used by tileBag so both online clients can
// reproduce the same draws from a shared `tileBagSeed` stored in the room.
//
//   const rng = createRng('some-seed-string');
//   rng();        // 0..1
//   rng.int(n);   // 0..n-1 integer

export function hashStringToU32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = typeof seed === 'number' ? (seed >>> 0) : hashStringToU32(String(seed));
  function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  next.int = (n) => Math.floor(next() * n);
  return next;
}

// Fisher-Yates shuffle in place using a provided rng.
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
