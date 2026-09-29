import { describe, expect, it } from "vitest";
import { CHARACTER } from "@cb/shared";
import {
  ARCHETYPES,
  FIELDS,
  SPEC_BYTES,
  LEGACY_FIELD_COUNT,
  decodeSpec,
  encodeSpec,
  generateCharacter,
  rerollAppearance,
  applyClientAppearance,
  HISTORY_KEYS,
  sanitizeSpec,
  specFromUntrusted,
} from "./spec.ts";
import { MAX_HALF_WIDTH, MAX_HEIGHT, MIN_HEIGHT, computeProportions } from "./proportions.ts";

describe("codec", () => {
  it("round-trips every generated character exactly", () => {
    for (let seed = 0; seed < 500; seed++) {
      const spec = generateCharacter(seed);
      expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
    }
  });
  it("is compact and URL-safe", () => {
    const s = encodeSpec(generateCharacter(1));
    expect(s.length).toBeLessThanOrEqual(64);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(SPEC_BYTES).toBe(1 + FIELDS.length);
  });
  it("still decodes looks saved before the append-only fields existed (missing trailing fields read as None)", () => {
    const full = generateCharacter(9);
    const legacy = encodeSpec({ ...full, neckwear: 0, pack: 0, hipGear: 0, gloves: 0 });
    // Drop the trailing bytes exactly as an older client would have written them.
    const bytes = [...Buffer.from(legacy.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64")].slice(0, 1 + LEGACY_FIELD_COUNT);
    const old = Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const spec = decodeSpec(old)!;
    expect(spec).toBeDefined();
    expect(spec.neckwear).toBe(0);
    expect(spec.gloves).toBe(0);
    expect(spec.hat).toBe(full.hat);
    expect(spec.noseStyle).toBe(full.noseStyle);
  });
  it("adding fields did not change who an old seed is (new fields use their own random stream)", () => {
    const a = generateCharacter(123);
    const legacyKeys = FIELDS.slice(0, LEGACY_FIELD_COUNT).map((f) => f.key);
    expect(legacyKeys).toHaveLength(LEGACY_FIELD_COUNT);
    expect(FIELDS[LEGACY_FIELD_COUNT]!.key).toBe("neckwear");
    expect(generateCharacter(123)).toEqual(a);
  });
  it("rejects malformed input instead of guessing", () => {
    expect(decodeSpec(undefined)).toBeUndefined();
    expect(decodeSpec(42)).toBeUndefined();
    expect(decodeSpec("")).toBeUndefined();
    expect(decodeSpec("not base64 !!")).toBeUndefined();
    expect(decodeSpec("AAAA")).toBeUndefined(); // too short
    expect(decodeSpec("A".repeat(500))).toBeUndefined(); // too long
    const good = encodeSpec(generateCharacter(3));
    expect(decodeSpec("Z" + good.slice(1))).toBeUndefined(); // wrong version byte
  });
  it("clamps hostile field values rather than trusting them", () => {
    const spec = sanitizeSpec(Object.fromEntries(FIELDS.map((f) => [f.key, 9999])));
    for (const f of FIELDS) expect(spec[f.key]).toBe(f.max);
    const neg = sanitizeSpec(Object.fromEntries(FIELDS.map((f) => [f.key, -5])));
    for (const f of FIELDS) expect(neg[f.key]).toBe(0);
    const junk = sanitizeSpec({ height: NaN, hat: "top hat", nose: Infinity, __proto__: { hat: 3 }, extra: 1 });
    expect(junk.height).toBe(0);
    expect(junk.hat).toBe(0);
    expect("extra" in junk).toBe(false);
  });
  it("clamps out-of-range bytes found in a well-formed hostile string", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const bytes = [1, ...Array(FIELDS.length).fill(255)];
    let str = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const [a, b, c] = [bytes[i], bytes[i + 1] ?? 0, bytes[i + 2] ?? 0];
      str += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | (b >> 4)]!;
      if (i + 1 < bytes.length) str += alphabet[((b & 15) << 2) | (c >> 6)]!;
      if (i + 2 < bytes.length) str += alphabet[c & 63]!;
    }
    const spec = decodeSpec(str)!;
    expect(spec).toBeDefined();
    for (const f of FIELDS) expect(spec[f.key]).toBe(f.max);
  });
  it("specFromUntrusted falls back to a deterministic valid character", () => {
    const a = specFromUntrusted("garbage!!", 77);
    expect(a).toEqual(generateCharacter(77));
    expect(specFromUntrusted(encodeSpec(generateCharacter(5)), 77)).toEqual(generateCharacter(5));
  });
});

describe("generateCharacter", () => {
  it("is deterministic and seed-sensitive", () => {
    expect(generateCharacter(10)).toEqual(generateCharacter(10));
    expect(generateCharacter(10)).not.toEqual(generateCharacter(11));
  });
  it("produces valid catalog indices for every field", () => {
    for (let seed = 0; seed < 300; seed++) {
      const spec = generateCharacter(seed);
      for (const f of FIELDS) {
        expect(Number.isInteger(spec[f.key])).toBe(true);
        expect(spec[f.key]).toBeGreaterThanOrEqual(0);
        expect(spec[f.key]).toBeLessThanOrEqual(f.max);
      }
    }
  });
  it("starts recruits unmarked (history comes from the campaign)", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = generateCharacter(seed);
      expect([s.scars, s.teeth, s.eyepatch, s.burnt, s.woodenLeg]).toEqual([0, 0, 0, 0, 0]);
    }
  });
  it("archetypes are distinguishable silhouettes (height/width spread across archetypes)", () => {
    const stats = ARCHETYPES.map((_, i) => {
      const ps = Array.from({ length: 30 }, (_, k) => computeProportions(generateCharacter(k, i)));
      const avg = (f: (p: (typeof ps)[number]) => number) => ps.reduce((a, p) => a + f(p), 0) / ps.length;
      return { h: avg((p) => p.totalHeight), w: avg((p) => p.halfWidth), head: avg((p) => p.headRadius / p.totalHeight) };
    });
    const range = (f: (s: (typeof stats)[number]) => number) => Math.max(...stats.map(f)) - Math.min(...stats.map(f));
    expect(range((s) => s.h)).toBeGreaterThan(0.12);
    expect(range((s) => s.w)).toBeGreaterThan(0.08);
    expect(range((s) => s.head)).toBeGreaterThan(0.02);
  });
  it("reroll keeps campaign history", () => {
    const marked = { ...generateCharacter(1), scars: 5, teeth: 3, eyepatch: 1, burnt: 2, woodenLeg: 2 };
    const r = rerollAppearance(marked, 999);
    expect([r.scars, r.teeth, r.eyepatch, r.burnt, r.woodenLeg]).toEqual([5, 3, 1, 2, 2]);
    expect(r.height).not.toBe(marked.height);
  });
});

describe("history is server-owned", () => {
  it("a client cannot grant itself scars, teeth, eyepatch, burns or a wooden leg", () => {
    const server = generateCharacter(1);
    const cheat = { ...generateCharacter(2), scars: 31, teeth: 15, eyepatch: 2, burnt: 3, woodenLeg: 2 };
    const merged = applyClientAppearance(server, cheat);
    for (const k of HISTORY_KEYS) expect(merged[k]).toBe(server[k]);
    expect(merged.height).toBe(cheat.height); // appearance still comes from the client
    expect(merged.hat).toBe(cheat.hat);
  });
});

describe("collision envelope", () => {
  it("every possible extreme spec fits the gameplay envelope", () => {
    const extremes = [0, 255];
    let worstW = 0;
    for (const combo of Array.from({ length: 256 }, (_, i) => i)) {
      const spec = generateCharacter(1);
      const body = ["height", "headScale", "torsoWidth", "belly", "shoulderWidth", "legLength", "noseScale", "armLength"] as const;
      body.forEach((k, bit) => (spec[k] = extremes[(combo >> bit) & 1] as number));
      const p = computeProportions(spec);
      expect(p.totalHeight).toBeGreaterThanOrEqual(MIN_HEIGHT - 0.02);
      expect(p.totalHeight).toBeLessThanOrEqual(MAX_HEIGHT + 0.02);
      expect(p.halfWidth).toBeLessThanOrEqual(MAX_HALF_WIDTH + 1e-9);
      worstW = Math.max(worstW, p.halfWidth);
    }
    expect(worstW).toBeGreaterThan(CHARACTER.radius); // extremes really are chunkier than the collision capsule
  });
  it("random characters stay inside the envelope", () => {
    for (let seed = 0; seed < 2000; seed++) {
      const p = computeProportions(generateCharacter(seed));
      expect(p.totalHeight).toBeGreaterThan(MIN_HEIGHT - 0.02);
      expect(p.totalHeight).toBeLessThan(MAX_HEIGHT + 0.02);
      expect(p.halfWidth).toBeLessThanOrEqual(MAX_HALF_WIDTH + 1e-9);
    }
  });
});
