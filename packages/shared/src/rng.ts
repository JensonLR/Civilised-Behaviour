/**
 * Seeded, allocation-free randomness. Everything that must be reproducible from a
 * campaign/world seed (vegetation, props, encounters, names) goes through here,
 * never through Math.random().
 */

/** 32-bit integer hash of up to three integers. Stable across platforms. */
export function hash3(seed: number, x: number, y: number, z = 0): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ (z | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Hash to float in [0, 1). */
export const hashFloat = (seed: number, x: number, y: number, z = 0): number =>
  hash3(seed, x, y, z) / 4294967296;

/** Hashes an arbitrary string to a 32-bit seed (FNV-1a). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** mulberry32 - small, fast, good enough for gameplay, fully deterministic. */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty array");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Independent child stream; does not disturb this stream's sequence beyond one draw. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}
