import { describe, expect, it } from "vitest";
import { PALETTE, Rng } from "@cb/shared";
import { BLANKET_DYES, HORSE_COATS, HORSE_FIELDS, HORSE_MANE, HORSE_SPEC_BYTES, decodeHorse, encodeHorse, horseFromSeed, sanitizeHorse, type HorseSpec } from "./horse.ts";

const palette = new Set<number>();
const walk = (o: unknown): void => {
  if (typeof o === "number") palette.add(o);
  else if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") Object.values(o).forEach(walk);
};
walk(PALETTE);

describe("HorseSpec", () => {
  it("horseFromSeed is deterministic, valid, and varies with the seed", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const a = horseFromSeed(seed);
      expect(a).toEqual(horseFromSeed(seed));
      expect(sanitizeHorse(a)).toEqual(a);
      for (const f of HORSE_FIELDS) expect(a[f.key]).toBeLessThanOrEqual(f.max);
      seen.add(encodeHorse(a));
    }
    expect(seen.size).toBeGreaterThan(295);
    // all twelve coats and all five patterns turn up
    const coats = new Set<number>();
    const patterns = new Set<number>();
    for (let seed = 0; seed < 400; seed++) {
      const h = horseFromSeed(seed);
      coats.add(h.coat);
      patterns.add(h.pattern);
    }
    expect(coats.size).toBe(12);
    expect(patterns.size).toBe(5);
  });

  it("harness horses wear harness and no saddle, riding horses the reverse", () => {
    for (let s = 0; s < 60; s++) {
      const h = horseFromSeed(s, { harness: true });
      expect([h.harness, h.saddle, h.packs, h.blanket]).toEqual([1, 0, 0, 0]);
      expect(horseFromSeed(s).harness).toBe(0);
    }
  });

  it("round-trips, and decodeHorse never throws on hostile input (2000 strings)", () => {
    for (let s = 0; s < 200; s++) {
      const h = horseFromSeed(s * 977);
      expect(decodeHorse(encodeHorse(h))).toEqual(h);
    }
    const rng = new Rng(7);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/ \n\u0000☃";
    for (let i = 0; i < 2000; i++) {
      const len = rng.int(0, 90);
      let str = "";
      for (let k = 0; k < len; k++) str += alphabet[rng.int(0, alphabet.length - 1)];
      const out = decodeHorse(str);
      if (out) for (const f of HORSE_FIELDS) expect(out[f.key]).toBeLessThanOrEqual(f.max);
    }
    for (const bad of [undefined, null, 3, {}, [], "", "A", "A".repeat(200), "!!!!"]) expect(decodeHorse(bad)).toBeUndefined();
    expect(encodeHorse(horseFromSeed(1)).length).toBeLessThan(40);
    expect(HORSE_SPEC_BYTES).toBe(1 + HORSE_FIELDS.length);
  });

  it("sanitizeHorse forces anything into range", () => {
    const wild = sanitizeHorse({ coat: 99, pattern: -4, height: NaN, bulk: "x", packs: 1e9, nonsense: 1 }) as Record<string, number>;
    expect(wild.coat).toBe(11);
    expect(wild.pattern).toBe(0);
    expect(wild.height).toBe(0);
    expect(wild.bulk).toBe(0);
    expect(wild.packs).toBe(3);
    expect(wild.nonsense).toBeUndefined();
    expect(sanitizeHorse(null)).toEqual(sanitizeHorse({}));
  });

  it("every colour a horse can wear is a palette entry", () => {
    for (const c of [...HORSE_COATS, ...BLANKET_DYES, ...HORSE_MANE.filter((m) => m >= 0)]) expect(palette.has(c), `0x${c.toString(16)}`).toBe(true);
    expect(HORSE_COATS).toHaveLength(12);
  });
});

export type { HorseSpec };
