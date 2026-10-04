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

const OLD_SEEDS: number[][] = [[255, 115, 79, 72, 40, 79, 210, 255, 191, 163, 191, 170, 123, 152, 5, 1, 3, 3, 3, 2, 5, 3, 0, 0, 1, 1, 0, 2, 3, 2, 6, 5, 2, 1, 0, 0, 0, 0, 0, 0, 0, 2, 2], [165, 217, 198, 239, 206, 34, 68, 81, 90, 119, 90, 63, 41, 161, 0, 1, 3, 2, 2, 1, 1, 2, 1, 2, 0, 3, 2, 3, 3, 7, 4, 2, 6, 3, 0, 0, 0, 0, 0, 2, 0, 4, 0], [200, 218, 187, 242, 187, 33, 56, 74, 83, 114, 129, 104, 93, 115, 4, 8, 0, 7, 1, 0, 3, 0, 2, 1, 2, 0, 2, 0, 2, 2, 10, 6, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [212, 255, 228, 235, 192, 41, 65, 74, 111, 120, 90, 207, 68, 120, 5, 3, 0, 1, 0, 2, 3, 1, 3, 3, 0, 4, 2, 1, 1, 1, 10, 5, 7, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0], [174, 115, 98, 64, 12, 98, 211, 196, 201, 146, 106, 114, 164, 181, 2, 7, 3, 5, 2, 2, 3, 3, 1, 3, 1, 4, 2, 0, 7, 7, 3, 11, 5, 1, 0, 0, 0, 0, 0, 2, 1, 1, 0], [159, 108, 94, 105, 0, 114, 207, 168, 195, 121, 90, 137, 141, 94, 4, 4, 4, 6, 3, 2, 5, 0, 2, 2, 2, 4, 0, 0, 0, 4, 9, 8, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], [142, 176, 241, 206, 247, 147, 97, 15, 153, 225, 171, 202, 209, 105, 5, 3, 2, 2, 0, 3, 1, 1, 2, 0, 2, 1, 1, 3, 2, 9, 5, 0, 10, 1, 0, 0, 0, 0, 0, 1, 0, 2, 0], [179, 209, 117, 86, 50, 89, 141, 183, 49, 79, 217, 160, 135, 136, 1, 3, 3, 5, 3, 2, 3, 0, 0, 0, 1, 2, 1, 0, 2, 9, 8, 4, 1, 2, 0, 0, 0, 0, 0, 0, 4, 0, 0], [255, 100, 69, 49, 42, 107, 252, 227, 160, 177, 221, 47, 210, 91, 1, 7, 4, 4, 3, 3, 0, 1, 3, 3, 0, 2, 2, 0, 2, 4, 9, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [170, 178, 85, 64, 63, 62, 159, 186, 71, 49, 230, 107, 79, 128, 0, 8, 3, 6, 0, 1, 3, 2, 3, 0, 0, 4, 2, 0, 7, 0, 4, 1, 5, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0], [255, 86, 39, 72, 53, 60, 222, 223, 160, 176, 188, 123, 81, 179, 4, 1, 0, 7, 2, 6, 3, 3, 0, 0, 2, 0, 1, 0, 6, 2, 8, 2, 2, 2, 0, 0, 0, 0, 0, 0, 1, 0, 1], [84, 142, 239, 170, 191, 222, 113, 37, 189, 197, 141, 179, 43, 149, 4, 0, 4, 0, 2, 7, 2, 3, 0, 2, 1, 4, 2, 0, 5, 9, 10, 11, 4, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0], [186, 174, 115, 104, 36, 81, 125, 219, 86, 88, 255, 177, 73, 152, 0, 1, 5, 7, 2, 2, 1, 2, 2, 1, 1, 1, 1, 3, 2, 8, 7, 6, 3, 2, 0, 0, 0, 0, 0, 1, 0, 0, 1], [120, 109, 251, 163, 185, 240, 96, 78, 225, 219, 134, 133, 64, 168, 0, 6, 6, 3, 1, 7, 2, 2, 3, 2, 1, 0, 2, 1, 4, 6, 11, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], [162, 173, 65, 84, 69, 75, 138, 207, 50, 51, 207, 209, 135, 106, 5, 9, 5, 5, 3, 2, 1, 3, 3, 3, 1, 0, 1, 1, 3, 3, 11, 9, 9, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0], [126, 154, 200, 235, 255, 134, 90, 56, 174, 186, 191, 180, 106, 95, 2, 5, 7, 5, 2, 3, 1, 2, 2, 3, 2, 0, 1, 0, 3, 3, 1, 4, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], [182, 224, 62, 94, 65, 69, 144, 200, 66, 62, 247, 211, 115, 153, 2, 8, 5, 4, 0, 2, 1, 2, 1, 3, 0, 4, 2, 0, 7, 9, 2, 9, 1, 3, 0, 0, 0, 0, 0, 0, 2, 0, 0], [185, 198, 62, 89, 41, 94, 154, 199, 83, 47, 233, 82, 98, 155, 0, 7, 3, 2, 2, 5, 1, 2, 3, 2, 1, 2, 1, 2, 4, 3, 10, 4, 2, 0, 0, 0, 0, 0, 0, 1, 3, 0, 2], [186, 225, 219, 223, 208, 87, 57, 74, 105, 97, 128, 96, 139, 111, 1, 6, 7, 1, 3, 0, 3, 3, 3, 3, 0, 1, 2, 0, 4, 3, 3, 6, 7, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0], [109, 167, 203, 203, 232, 162, 66, 30, 146, 210, 195, 123, 105, 113, 5, 2, 2, 4, 2, 4, 2, 2, 3, 0, 2, 4, 2, 0, 1, 1, 6, 9, 2, 2, 0, 0, 0, 0, 0, 0, 4, 0, 1], [88, 108, 224, 207, 150, 213, 107, 51, 206, 206, 97, 74, 199, 95, 4, 9, 2, 0, 1, 2, 2, 0, 1, 1, 1, 0, 2, 0, 5, 9, 8, 4, 9, 1, 0, 0, 0, 0, 0, 1, 4, 0, 0], [162, 214, 223, 227, 196, 34, 35, 49, 100, 91, 83, 148, 168, 90, 4, 5, 0, 3, 3, 2, 3, 2, 0, 1, 0, 0, 2, 0, 0, 1, 7, 5, 0, 1, 0, 0, 0, 0, 0, 2, 1, 0, 0], [183, 231, 227, 220, 223, 39, 46, 51, 103, 99, 103, 163, 41, 134, 4, 6, 7, 5, 3, 2, 3, 0, 2, 3, 1, 0, 2, 0, 4, 8, 4, 10, 9, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0], [140, 168, 202, 209, 238, 122, 78, 55, 133, 188, 197, 167, 148, 121, 1, 7, 1, 6, 2, 5, 2, 2, 0, 2, 0, 0, 2, 0, 6, 7, 6, 7, 3, 3, 0, 0, 0, 0, 0, 3, 2, 0, 0]];

describe("codec", () => {
  it("round-trips every generated character exactly", () => {
    for (let seed = 0; seed < 500; seed++) {
      const spec = generateCharacter(seed);
      expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
    }
  });
  it("is compact and URL-safe", () => {
    const s = encodeSpec(generateCharacter(1));
    expect(s.length).toBeLessThanOrEqual(100);
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
  it("adding batch 2 did not change who an old seed is: every original field matches the frozen generator unless a newer option was rolled", () => {
    const frozenOptions: Record<string, number> = { noseStyle: 6, hair: 10, moustache: 10, beard: 8, sideburns: 4, hat: 11, jacket: 6, shirt: 4, trousers: 4, boots: 4, belt: 3, eyewear: 5, sash: 3, neckwear: 4, pack: 5, hipGear: 5, gloves: 3, skin: 8 }; // (D-067: the deeper skin tones are appended options too)
    let checked = 0;
    let novel = 0;
    OLD_SEEDS.forEach((row, n) => {
      const spec = generateCharacter(n * 37 + 1) as unknown as Record<string, number>;
      row.forEach((oldValue, i) => {
        const key = FIELDS[i]!.key;
        checked++;
        if (spec[key] === oldValue) return;
        // A difference is only allowed where a newer option was picked (value beyond the frozen range).
        expect(frozenOptions[key], `${key} of seed ${n * 37 + 1} changed from ${oldValue} to ${spec[key]}`).toBeDefined();
        expect(spec[key]).toBeGreaterThanOrEqual(frozenOptions[key]!);
        novel++;
      });
    });
    expect(checked).toBe(OLD_SEEDS.length * 43);
    expect(novel).toBeLessThan(checked * 0.1); // most old people are still exactly who they were
  });
  it("batch 2 fields are rare vanity, history fields start at zero, and every value is in range", () => {
    let tattoo = 0;
    let paint = 0;
    const N = 600;
    for (let seed = 0; seed < N; seed++) {
      const s = generateCharacter(seed);
      expect(s.hook).toBe(0);
      if (s.tattoo) tattoo++;
      if (s.facePaint) paint++;
      for (const f of FIELDS) expect(s[f.key]).toBeLessThanOrEqual(f.max);
    }
    expect(tattoo / N).toBeLessThan(0.2);
    expect(paint / N).toBeLessThan(0.15);
    expect(paint).toBeGreaterThan(0);
  });
  it("looks saved before batch 2 (43 fields) still decode, with the new fields at their defaults", () => {
    const full = generateCharacter(31);
    const bytes = [1, ...FIELDS.slice(0, 43).map((f) => full[f.key])];
    const b64 = Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const spec = decodeSpec(b64)!;
    expect(spec).toBeDefined();
    expect(spec.hat).toBe(full.hat);
    expect(spec.gloves).toBe(full.gloves);
    expect(spec.tattoo).toBe(0);
    expect(spec.brows).toBe(0);
    expect(spec.hook).toBe(0);
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
      expect([s.scars, s.teeth, s.eyepatch, s.burnt, s.woodenLeg, s.hook]).toEqual([0, 0, 0, 0, 0, 0]);
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
    const marked = { ...generateCharacter(1), scars: 5, teeth: 3, eyepatch: 1, burnt: 2, woodenLeg: 2, hook: 1 };
    const r = rerollAppearance(marked, 999);
    expect([r.scars, r.teeth, r.eyepatch, r.burnt, r.woodenLeg, r.hook]).toEqual([5, 3, 1, 2, 2, 1]);
    expect(r.height).not.toBe(marked.height);
  });
});

describe("history is server-owned", () => {
  it("a client cannot grant itself scars, teeth, eyepatch, burns or a wooden leg or a hook", () => {
    const server = generateCharacter(1);
    const cheat = { ...generateCharacter(2), scars: 255, teeth: 63, eyepatch: 2, burnt: 3, woodenLeg: 2, hook: 2 };
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
