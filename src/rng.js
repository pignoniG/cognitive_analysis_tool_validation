// Seeded random numbers: the same xmur3 + mulberry32 as the calibration presenter, so a participant ID gives
// the same sequence in both tools. Each generator draws from its own stream (`stream(seed, "load")`), so changing
// one part of the session never reshuffles another.

export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const rngFrom = (seed) => mulberry32(xmur3(String(seed))());

/** A named stream of a seed: `stream("P01", "nback", 3)` is independent of `stream("P01", "visual")`. */
export const stream = (seed, ...parts) => rngFrom([seed, ...parts].join("/"));

/** Indices 0..n-1 in a random order (Fisher–Yates). */
export function shuffled(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** `items` in a random order. */
export const shuffle = (items, rng) => shuffled(items.length, rng).map((i) => items[i]);

export const pick = (items, rng) => items[Math.floor(rng() * items.length)];

export const uniform = (lo, hi, rng) => lo + (hi - lo) * rng();

/** A seed for "new random seed each run": 10 hex digits, as in the calibration presenter. */
export const randomSeed = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
