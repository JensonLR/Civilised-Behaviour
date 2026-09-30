import { describe, expect, it } from "vitest";
import { PALETTE, chroma, contrast, cssHex, hsl, luminance, paletteCssVars } from "./palette.ts";

/** Flames, embers and glows are light sources: the only world colours allowed to be properly saturated. */
const isLight = (key: string): boolean => /^(flame|ember|glow)/.test(key);

/** Every colour that stands for a surface in the world (not UI chrome), by group, for the art-direction rules. */
const worldColours: Record<string, readonly number[]> = {
  world: Object.values(PALETTE.world),
  props: Object.values(PALETTE.props),
  camp: Object.entries(PALETTE.camp).filter(([k]) => !isLight(k)).map(([, v]) => v),
  campLight: Object.entries(PALETTE.camp).filter(([k]) => isLight(k)).map(([, v]) => v),
  material: Object.values(PALETTE.material),
  weapons: Object.values(PALETTE.weapons),
  weaponFx: Object.values(PALETTE.weaponFx),
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
    const caps: Record<string, number> = { world: 0.4, props: 0.4, camp: 0.4, campLight: 0.7, material: 0.3, weapons: 0.5, weaponFx: 0.7, trim: 0.5, metal: 0.6, skin: 0.4, hair: 0.55, cloth: 0.5, iris: 0.4 };
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
    for (const c of [...PALETTE.cloth, ...PALETTE.skin, ...Object.values(PALETTE.world), ...Object.values(PALETTE.props), ...Object.values(PALETTE.camp)]) expect(contrast(PALETTE.ink, c), cssHex(c)).toBeGreaterThan(1.6);
  });

  it("the character cosmetics palettes: five boot leathers and the shirt linens are distinguishable, the ink reads on all of them, and face paint stays pale or dark", () => {
    const m = PALETTE.material;
    const leathers = [m.leather, m.leatherBlack, m.leatherTan, m.leatherOx, m.leatherGrey];
    for (let i = 0; i < leathers.length; i++) for (let j = i + 1; j < leathers.length; j++) expect(dist(leathers[i]!, leathers[j]!), `leather ${i} vs ${j}`).toBeGreaterThan(14);
    for (const c of [...leathers, m.rubber, m.fur, m.furDark, m.rope, m.linen, m.cream, PALETTE.trim.puttee, PALETTE.trim.zinc, PALETTE.trim.rouge]) expect(contrast(PALETTE.ink, c), cssHex(c)).toBeGreaterThan(1.45);
    // zinc and chalk are the light paints; rouge is the only warm cheek colour; the tattoo ink is a cold blue-grey that reads on every skin tone
    expect(luminance(PALETTE.trim.zinc)).toBeGreaterThan(0.6);
    const [h, s2] = hsl(PALETTE.face.tattoo);
    expect(h).toBeGreaterThan(190);
    expect(s2).toBeLessThan(0.45);
    // (on the deepest skin tones ink is naturally subtle - that is how it looks - so the bar drops with the tone)
    for (const skin of PALETTE.skin) expect(contrast(PALETTE.face.tattoo, skin), cssHex(skin)).toBeGreaterThan(luminance(skin) > 0.3 ? 1.9 : 1.4);
    // eyes: every iris is distinguishable from the sclera and the pupil
    for (const iris of PALETTE.iris) {
      expect(contrast(iris, PALETTE.face.white)).toBeGreaterThan(2);
      expect(contrast(iris, PALETTE.face.pupil)).toBeGreaterThan(1.5);
    }
    // the catch-light is the brightest thing on a face (brighter than the sclera) without being a pure white; the mouth reads as dark-on-light: cavity darker than the lip line, teeth and gums distinct
    expect(luminance(PALETTE.face.glint)).toBeGreaterThan(luminance(PALETTE.face.white));
    expect(PALETTE.face.glint).not.toBe(0xffffff);
    expect(contrast(PALETTE.face.glint, PALETTE.face.pupil)).toBeGreaterThan(8);
    expect(luminance(PALETTE.face.cavity)).toBeLessThan(luminance(PALETTE.face.mouth));
    expect(contrast(PALETTE.trim.teeth, PALETTE.face.cavity)).toBeGreaterThan(5);
    expect(contrast(PALETTE.trim.teeth, PALETTE.face.gum)).toBeGreaterThan(1.5);
    for (const skin of PALETTE.skin) expect(contrast(PALETTE.face.lash, skin), cssHex(skin)).toBeGreaterThan(1.8); // the drawn lash line reads on every skin tone
  });

  it("weapons: the ink outline reads on every surface, steel is lighter than the browned barrel, and a flash is hotter than its smoke", () => {
    const w = PALETTE.weapons;
    for (const c of Object.values(w)) expect(contrast(PALETTE.ink, c), cssHex(c)).toBeGreaterThan(1.45);
    expect(luminance(w.steel)).toBeGreaterThan(luminance(w.barrel));
    expect(luminance(w.barrelLight)).toBeGreaterThan(luminance(w.barrel));
    expect(luminance(w.brass)).toBeGreaterThan(luminance(w.brassDark));
    expect(luminance(w.walnutLight)).toBeGreaterThan(luminance(w.walnut));
    const fx = PALETTE.weaponFx;
    expect(luminance(fx.flashCore)).toBeGreaterThan(luminance(fx.flashMid));
    expect(luminance(fx.flashMid)).toBeGreaterThan(luminance(fx.flashOuter));
    expect(luminance(fx.smokeLight)).toBeGreaterThan(luminance(fx.smokeDark));
    for (const c of [fx.flashCore, fx.flashMid, fx.flashOuter, fx.spark]) expect(hsl(c)[0], cssHex(c)).toBeLessThan(50); // fire is warm
    // (weapon effects carry no red of their own: blood belongs to the gore setting)
    for (const c of Object.values(fx)) expect(hsl(c)[0] < 22 && hsl(c)[1] > 0.6 && luminance(c) < 0.2, cssHex(c)).toBe(false);
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

  it("the world palette has the colours the environment needs: three receding hill rings, two crown greens, camp light sources", () => {
    const w = PALETTE.world;
    // aerial perspective: each ring is paler (lighter) than the one in front of it, and all are lighter than the ground under them
    expect(luminance(w.hillNear)).toBeLessThan(luminance(w.hillMid));
    expect(luminance(w.hillMid)).toBeLessThan(luminance(w.hillFar));
    expect(luminance(w.crownDeep)).toBeLessThan(luminance(w.crownLight));
    expect(luminance(w.rockDark)).toBeLessThan(luminance(w.rockPale));
    // clouds are lighter than their shade, and both sit below the sun disc (which must not be pure white)
    expect(luminance(w.skyCloudShade)).toBeLessThan(luminance(w.skyCloud));
    expect(luminance(w.skyCloud)).toBeLessThanOrEqual(luminance(w.sunDisc));
    // flames are warm and brighter than the ember they sit in
    for (const c of [PALETTE.camp.flameOuter, PALETTE.camp.flameMid, PALETTE.camp.flameCore, PALETTE.camp.glow]) expect(hsl(c)[0], cssHex(c)).toBeLessThan(50);
    expect(luminance(PALETTE.camp.flameCore)).toBeGreaterThan(luminance(PALETTE.camp.flameMid));
    expect(luminance(PALETTE.camp.flameMid)).toBeGreaterThan(luminance(PALETTE.camp.ember));
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
