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

describe("D-077: the camera fade", () => {
  it("scenery dithers near the lens and on the line to the player; the ground opts out; lite shading has none; each is its own program", () => {
    setToonLite(false, 2);
    const on = compile(toonMaterial());
    expect(on.fs).toContain("uniform vec4 uFocus");
    expect(on.fs).toContain("discard");
    // the fade runs first in main (a discarded fragment costs nothing more)
    expect(on.fs.indexOf("fadeBayer(gl_FragCoord.xy)")).toBeLessThan(on.fs.indexOf("#include <color_fragment>"));
    const ground = compile(toonMaterial({ fade: false, wetDark: 1 }));
    expect(ground.fs).not.toContain("uFocus");
    setToonLite(true, 2);
    expect(compile(toonMaterial()).fs).not.toContain("uFocus");
    setToonLite(false, 2);
    expect(on.key).not.toBe(compile(toonMaterial({ fade: false })).key);
  });
});

describe("D-079: planted, not set down", () => {
  it("scenery darkens where it meets the ground (from the baked heights); the ground itself and lite shading do not", async () => {
    setToonLite(false, 2);
    const wall = compile(toonMaterial());
    expect(wall.fs).toContain("uniform sampler2D uGround");
    expect(wall.fs).toContain("touch");
    expect(compile(toonMaterial({ fade: false, wetDark: 1 })).fs).not.toContain("uGround");
    setToonLite(true, 2);
    expect(compile(toonMaterial()).fs).not.toContain("uGround");
    setToonLite(false, 2);
    // the bake: heights land where the shader looks for them (texel (i, j) is x = i, z = j across the square)
    const { atmoUniforms, bakeGroundHeights } = await import("./atmosphere.ts");
    const tex = bakeGroundHeights({ terrainHeight: (x: number, z: number) => x * 0.01 + z * 0.001 }, 100, 64);
    expect(atmoUniforms.uGroundRect.value.toArray()).toEqual([-100, -100, 200, 1]);
    const { DataUtils } = await import("three");
    const data = tex.image.data as Uint16Array;
    const at = (i: number, j: number): number => DataUtils.fromHalfFloat(data[j * 64 + i]!);
    const x = (i: number): number => -100 + ((i + 0.5) / 64) * 200;
    expect(at(60, 3)).toBeCloseTo(x(60) * 0.01 + x(3) * 0.001, 2);
    expect(at(3, 60)).toBeCloseTo(x(3) * 0.01 + x(60) * 0.001, 2);
  });
});
