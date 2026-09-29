import { describe, expect, it } from "vitest";
import { PALETTE, chroma, contrast, cssHex, hsl, luminance, paletteCssVars } from "./palette.ts";

/** Every colour that stands for a surface in the world (not UI chrome), by group, for the art-direction rules. */
const worldColours: Record<string, readonly number[]> = {
  world: Object.values(PALETTE.world),
  props: Object.values(PALETTE.props),
  material: Object.values(PALETTE.material),
  trim: Object.values(PALETTE.trim),
  metal: PALETTE.metal,
  skin: PALETTE.skin,
  hair: PALETTE.hair,
  cloth: PALETTE.cloth,
  iris: PALETTE.iris,
};

const dist = (a: number, b: number): number =>
  Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255));

describe("art direction: the palette", () => {
  it("ink is the darkest colour in the game, and nothing else is near-black or pure white", () => {
    const inkL = luminance(PALETTE.ink);
    for (const [group, colours] of Object.entries(worldColours)) {
      for (const c of colours) {
        expect(luminance(c), `${group} ${cssHex(c)}`).toBeGreaterThanOrEqual(inkL);
        expect(hsl(c)[2], `${group} ${cssHex(c)} too white`).toBeLessThan(0.95);
      }
    }
  });

  it("world surfaces are dusty, not neon: chroma is capped per group", () => {
    // Chroma caps by group: terrain, props and cloth are muted; metals, hair and irises may be a little richer.
    const caps: Record<string, number> = { world: 0.4, props: 0.4, material: 0.3, trim: 0.5, metal: 0.6, skin: 0.4, hair: 0.55, cloth: 0.5, iris: 0.4 };
    for (const [group, colours] of Object.entries(worldColours)) {
      for (const c of colours) expect(chroma(c), `${group} ${cssHex(c)}`).toBeLessThanOrEqual(caps[group]!);
    }
  });

  it("skin is one warm hue family, ordered light to deep, and never grey or orange-neon", () => {
    for (const c of PALETTE.skin) {
      const [h, s, l] = hsl(c);
      expect(h, cssHex(c)).toBeGreaterThan(14);
      expect(h, cssHex(c)).toBeLessThan(34);
      expect(s, cssHex(c)).toBeGreaterThan(0.3);
      expect(l, cssHex(c)).toBeGreaterThan(0.25);
      expect(l, cssHex(c)).toBeLessThan(0.85);
    }
    // the first six are an ordered scale from light to deep (the last two are in-between variants)
    const scale = PALETTE.skin.slice(0, 6).map((c) => hsl(c)[2]);
    for (let i = 1; i < scale.length; i++) expect(scale[i]!).toBeLessThan(scale[i - 1]!);
  });

  it("the twelve cloth dyes are all distinguishable from each other", () => {
    const cl = PALETTE.cloth;
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) expect(dist(cl[i]!, cl[j]!), `${cssHex(cl[i]!)} vs ${cssHex(cl[j]!)}`).toBeGreaterThan(28);
  });

  it("every world colour is unique within its group (no accidental duplicates)", () => {
    for (const [group, colours] of Object.entries(worldColours)) expect(new Set(colours).size, group).toBe(colours.length);
  });

  it("the outline reads on every surface: enough contrast against the lightest and the mid-tone materials", () => {
    for (const c of [...PALETTE.cloth, ...PALETTE.skin, ...Object.values(PALETTE.world)]) expect(contrast(PALETTE.ink, c), cssHex(c)).toBeGreaterThan(1.6);
  });

  it("gore Off contains no red at all; Full and Reduced stains are red-family", () => {
    const isRed = (c: number): boolean => {
      const [h, s] = hsl(c);
      return (h < 22 || h > 340) && s > 0.35;
    };
    for (const c of Object.values(PALETTE.gore.off)) expect(isRed(c), cssHex(c)).toBe(false);
    for (const c of PALETTE.hitFx.off) expect(isRed(c), cssHex(c)).toBe(false);
    for (const c of Object.values(PALETTE.gore.full)) expect(isRed(c), cssHex(c)).toBe(true);
    // Reduced is the same family, muted: strictly less saturated than Full.
    for (const k of ["fresh", "old", "drip"] as const) expect(hsl(PALETTE.gore.reduced[k])[1]).toBeLessThan(hsl(PALETTE.gore.full[k])[1]);
  });

  it("shadows are coloured, not grey: the bounce light has a warm hue and real saturation", () => {
    const [h, s] = hsl(PALETTE.light.bounce);
    expect(s).toBeGreaterThan(0.08);
    expect(h < 40 || h > 300).toBe(true);
  });

  it("the sky is a proper gradient from deeper to lighter, ending in a warm horizon", () => {
    expect(luminance(PALETTE.sky.top)).toBeLessThan(luminance(PALETTE.sky.mid));
    expect(luminance(PALETTE.sky.mid)).toBeLessThan(luminance(PALETTE.sky.horizon));
    const [h] = hsl(PALETTE.sky.horizon);
    expect(h).toBeLessThan(50);
  });

  it("UI text is readable on its surfaces (WCAG AA, most at AAA)", () => {
    const u = PALETTE.ui;
    expect(contrast(u.ink, u.paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(u.ink, u.paper2)).toBeGreaterThanOrEqual(7);
    expect(contrast(u.ink, u.field)).toBeGreaterThanOrEqual(7);
    expect(contrast(u.text, u.stamp)).toBeGreaterThanOrEqual(4.5); // primary buttons
    expect(contrast(u.text, u.backdrop)).toBeGreaterThanOrEqual(7);
    expect(contrast(u.stamp, u.paper)).toBeGreaterThanOrEqual(4.5); // stamp-coloured text on paper
    expect(contrast(u.brassDark, u.paper)).toBeGreaterThanOrEqual(3); // borders and non-text UI
  });

  it("publishes the interface colours as CSS variables, formatted #rrggbb", () => {
    const vars = paletteCssVars();
    expect(vars["--paper"]).toBe(cssHex(PALETTE.ui.paper));
    for (const v of Object.values(vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    expect(Object.keys(vars)).toEqual(expect.arrayContaining(["--ink", "--paper", "--brass", "--brass-dark", "--stamp"]));
  });

  it("hsl() and contrast() behave on known values", () => {
    expect(hsl(0xff0000)).toEqual([0, 1, 0.5]);
    expect(contrast(0x000000, 0xffffff)).toBeCloseTo(21, 0);
    expect(cssHex(0x0a0b0c)).toBe("#0a0b0c");
  });
});
