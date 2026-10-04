import { afterEach, describe, expect, it } from "vitest";
import { ShaderLib } from "three";
import { setToonLite, toonMaterial } from "./toon.ts";

/** Runs a material's shader patch on three's real toon shader source and returns the result. */
const TOON = ShaderLib.toon!;
const compile = (m: ReturnType<typeof toonMaterial>): { vs: string; fs: string; key: string } => {
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: TOON.vertexShader, fragmentShader: TOON.fragmentShader };
  (m.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
  return { vs: shader.vertexShader, fs: shader.fragmentShader, key: m.customProgramCacheKey() };
};

afterEach(() => setToonLite(false, 2));

describe("D-075: the scenery's surface grain", () => {
  it("at full grain every scenery material darkens and lightens its own colour in world space, then inks the hard shade", () => {
    setToonLite(false, 2);
    const { fs, key } = compile(toonMaterial());
    expect(fs).toContain("#define G_FULL");
    expect(fs).toContain("float grainFactor(vec3 wn, vec3 albedo)");
    // the grain multiplies the albedo after the vertex colour (and the wetness) is applied, before the light
    const colour = fs.indexOf("#include <color_fragment>");
    const grain = fs.indexOf("diffuseColor.rgb *= grainFactor(gWN, gAlbedo);");
    expect(colour).toBeGreaterThan(-1);
    expect(grain).toBeGreaterThan(colour);
    expect(grain).toBeLessThan(fs.indexOf("#include <lights_fragment_begin>"));
    // the hatch is worked out from the lit colour, so it sits after the light and before the output
    const hatch = fs.indexOf("hatchInk(gWN,");
    expect(hatch).toBeGreaterThan(fs.indexOf("#include <lights_fragment_end>"));
    expect(hatch).toBeLessThan(fs.indexOf("#include <opaque_fragment>"));
    // no shade ink without a hard sun (dusk, overcast)
    expect(fs).toMatch(/gSun = clamp\(dot\(uSunColW/);
    expect(key).toContain("|g2");
  });

  it("the low preset keeps one octave of each (no G_FULL), lite shading and the opt-out drop it, and each is its own program", () => {
    setToonLite(false, 1);
    const low = compile(toonMaterial());
    expect(low.fs).toContain("grainFactor(");
    expect(low.fs).not.toContain("#define G_FULL");
    expect(low.key).toContain("|g1");

    setToonLite(true, 2);
    const lite = compile(toonMaterial());
    expect(lite.fs).not.toContain("grainFactor");
    expect(lite.fs).not.toContain("hatchInk");

    setToonLite(false, 2);
    const clean = compile(toonMaterial({ grain: false }));
    expect(clean.fs).not.toContain("grainFactor");
    const keys = new Set([low.key, lite.key, clean.key, compile(toonMaterial()).key]);
    expect(keys.size).toBe(4);
  });

  it("a region view that only switches lite shading keeps the preset's grain level", () => {
    setToonLite(false, 1);
    setToonLite(false); // (what the region views call on build)
    expect(compile(toonMaterial()).key).toContain("|g1");
  });

  it("the grain sits beside the other patches: puddles, season and a colour patch all still run, and the grain comes after them", () => {
    setToonLite(false, 2);
    const { fs } = compile(toonMaterial({ puddles: true, season: true, colourPatch: { key: "x", uniforms: {}, head: "", body: "/*patch*/" } }));
    const patch = fs.indexOf("/*patch*/");
    expect(patch).toBeGreaterThan(-1);
    expect(fs.indexOf("diffuseColor.rgb *= grainFactor(gWN, gAlbedo);")).toBeGreaterThan(patch);
    expect(fs).toContain("puddle");
  });
});
