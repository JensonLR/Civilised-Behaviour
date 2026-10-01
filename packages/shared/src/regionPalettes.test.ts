import { describe, expect, it } from "vitest";
import { HIGHMARK_SWATCH, KESSAR_SWATCH, PALETTE, chroma, contrast, cssHex, hsl, luminance } from "./palette.ts";
import { SALTMARKET_SWATCH } from "./paletteSaltmarket.ts";
import { VESPER_SWATCH } from "./paletteVesper.ts";
import { regionIsLive } from "./regionStatus.ts";

/**
 * D-037: the regions' colour discipline and IDENTITY. Every region group obeys the palette rules (ink is the darkest thing, nothing is pure white, no neon except light sources named flame / ember /
 * glow, every colour unique inside its group, the ink outline reads on it) and the four regions read as four places: the five identity swatches (ground, wall, roof, accent, cloth) of any two regions
 * differ enough in CIE Lab. A package may re-point its swatch keys; it may not drop one. Identity is judged for a pair once BOTH regions are live (regionStatus.ts), so a contract stub is never blamed.
 */
const GROUPS = { kessar: PALETTE.kessar, highmark: PALETTE.highmark, vesper: PALETTE.vesper, saltmarket: PALETTE.saltmarket } as const;
const SWATCH = { kessar: KESSAR_SWATCH, highmark: HIGHMARK_SWATCH, vesper: VESPER_SWATCH, saltmarket: SALTMARKET_SWATCH } as const;
type Id = keyof typeof SWATCH;
const isLight = (key: string): boolean => /^(flame|ember|glow|lamp|sun)/.test(key);   // light sources may be properly saturated (the Ward's lamps, the Crown's sun)

function lab(n: number): [number, number, number] {
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const dE = (a: number, b: number): number => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
/** Identity distance of two regions: the mean Lab distance of the same slot, and how many of the five slots differ by at least 12. */
const identity = (a: Id, b: Id): { mean: number; apart: number } => {
  const slots = Object.keys(SWATCH[a]) as (keyof typeof KESSAR_SWATCH)[];
  const d = slots.map((s) => dE(SWATCH[a][s], SWATCH[b][s]));
  return { mean: d.reduce((x, y) => x + y, 0) / d.length, apart: d.filter((x) => x >= 12).length };
};

describe("region palettes: discipline", () => {
  for (const [id, group] of Object.entries(GROUPS)) {
    it(`${id}: ink is the darkest, nothing is near-white, chroma is capped (lights excepted), colours are unique and the ink outline reads`, () => {
      const entries = Object.entries(group) as [string, number][];
      const inkL = luminance(PALETTE.ink);
      for (const [k, c] of entries) {
        expect(luminance(c), `${id}.${k} ${cssHex(c)} darker than ink`).toBeGreaterThanOrEqual(inkL);
        expect(hsl(c)[2], `${id}.${k} ${cssHex(c)} too white`).toBeLessThan(0.95);
        expect(chroma(c), `${id}.${k} ${cssHex(c)} too saturated`).toBeLessThanOrEqual(isLight(k) ? 0.7 : 0.4);
        if (!isLight(k)) expect(contrast(PALETTE.ink, c), `${id}.${k} ${cssHex(c)} the ink outline must read`).toBeGreaterThan(1.6);
      }
      expect(new Set(entries.map(([, v]) => v)).size, `${id} has a duplicate colour`).toBe(entries.length);
    });
    it(`${id}: the identity swatch is made of the group's own colours`, () => {
      const own = new Set(Object.values(group));
      for (const [slot, c] of Object.entries(SWATCH[id as Id])) expect(own.has(c), `${id} swatch ${slot} ${cssHex(c)}`).toBe(true);
    });
  }
});

describe("region palettes: identity", () => {
  it("Kessar and Highmark (the baseline) differ in at least three of five slots and by a mean Lab distance above 20", () => {
    const d = identity("kessar", "highmark");
    expect(d.apart).toBeGreaterThanOrEqual(3);
    expect(d.mean).toBeGreaterThan(20);
  });
  it("every pair of live regions is at least as distinct as that baseline allows: >= 3 slots >= 12 apart and a mean above 18", () => {
    const ids = Object.keys(SWATCH) as Id[];
    let judged = 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (!regionIsLive(ids[i]!) || !regionIsLive(ids[j]!)) continue;
      judged++;
      const d = identity(ids[i]!, ids[j]!);
      expect(d.apart, `${ids[i]} vs ${ids[j]}`).toBeGreaterThanOrEqual(3);
      expect(d.mean, `${ids[i]} vs ${ids[j]}`).toBeGreaterThan(18);
    }
    expect(judged).toBeGreaterThanOrEqual(1);
  });
  it("the starter palettes already clear the bar against both older regions (so a package starts from a distinct place)", () => {
    for (const id of ["vesper", "saltmarket"] as const) for (const other of ["kessar", "highmark"] as const) {
      const d = identity(id, other);
      expect(d.apart, `${id} vs ${other}`).toBeGreaterThanOrEqual(3);
      expect(d.mean, `${id} vs ${other}`).toBeGreaterThan(18);
    }
    const d = identity("vesper", "saltmarket");
    expect(d.apart).toBeGreaterThanOrEqual(3);
    expect(d.mean).toBeGreaterThan(18);
  });
});
