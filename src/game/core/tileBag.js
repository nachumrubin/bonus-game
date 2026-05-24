// Tile bag (קופה).
//
// A bag is an ordered array of letter strings. Tiles are drawn off the end
// (LIFO) and racks fill up to a target size (default 8).
//
// The initial contents are deterministic from `seed`: same seed → same shuffle
// → both online clients hold the same bag, which means each player's draws
// can be reconstructed by replaying from history.

import { HD } from './letterDistribution.js';
import { createRng, shuffle } from '../../util/rng.js';

export const RACK_SIZE = 8;

export function createBag(seed) {
  const tiles = [];
  for (const [letter, count] of Object.entries(HD)) {
    for (let i = 0; i < count; i++) tiles.push(letter);
  }
  shuffle(tiles, createRng(seed));
  return tiles;
}

export function bagSize(bag) {
  return bag.length;
}

// Draw up to `target` tiles into `rack`, mutating both. Returns the number
// drawn (may be less than requested if the bag runs out).
export function drawInto(bag, rack, target = RACK_SIZE) {
  let drawn = 0;
  while (rack.length < target && bag.length > 0) {
    rack.push(bag.pop());
    drawn++;
  }
  return drawn;
}

// Return tiles to the bag and reshuffle. Used by EXCHANGE_TILE.
// Legacy index.html returned exchanged letters with unshift() and then ran
// Fisher-Yates with Math.random. A seeded string is still accepted for tests
// and deterministic setup helpers; a function means "use this RNG".
export function returnTilesAndShuffle(bag, tiles, seedOrRng = Math.random) {
  for (const t of tiles) bag.unshift(t);
  const rng = typeof seedOrRng === 'function' ? withInt(seedOrRng) : createRng(seedOrRng);
  shuffle(bag, rng);
  return bag;
}

function withInt(rng) {
  if (typeof rng.int === 'function') return rng;
  rng.int = (n) => Math.floor(rng() * n);
  return rng;
}
