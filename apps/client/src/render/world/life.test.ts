import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createArena, type LandscapeTerrain } from "@cb/shared";
import { buildBirds, buildButterflies, buildLanternGlow, buildMotes, buildSmoke, createAmbientUniforms } from "./ambient.ts";
import { fireLight, outlineDisplace, pushers, toonMaterial, worldTime } from "./toon.ts";
import { buildWater, waterMaterial } from "./water.ts";
import { bakeTrailMask, MASK_EXTENT, MASK_SIZE } from "./terrain.ts";
import { TRAILS, trailSample } from "@cb/shared";

describe("shared uniforms stay shared (UniformsUtils.merge would clone them and freeze the clock, the day or the wind)", () => {
  it("the water, birds and every ambient material read the one world clock and the day's numbers by reference", () => {
    const u = createAmbientUniforms();
    const { material, uniforms } = waterMaterial(true);
    expect(material.uniforms.uTime).toBe(worldTime);
    expect(material.uniforms.uLight).toBe(uniforms.uLight);
    expect(material.uniforms.uSun).toBe(uniforms.uSun);
    const birds = buildBirds(3, u)!;
    expect((birds.material as unknown as { uniforms: Record<string, unknown> }).uniforms.uDay).toBe(u.uDay);
    expect((birds.material as unknown as { uniforms: Record<string, unknown> }).uniforms.uTime).toBe(worldTime);
    for (const m of [buildMotes(50, u)!, buildButterflies([new Vector3(1, 0, 1), new Vector3(9, 0, 9)], 2, u)!, buildSmoke([{ at: new Vector3(), kind: 0, puffs: 4 }], u)!, buildLanternGlow([new Vector3()], u)!]) {
      expect((m.material as unknown as { uniforms: Record<string, unknown> }).uniforms.uTime).toBe(worldTime);
    }
  });

  it("the tree's ink hull and the scenery materials share the wind's clock and the pushers", () => {
    const d = outlineDisplace("tree")!;
    expect(d.uniforms.uTime).toBe(worldTime);
    expect(d.uniforms.uPush).toBe(pushers);
    expect(outlineDisplace("grass")).toBeUndefined();
    expect(Object.keys(fireLight)).toEqual(["uFirePos", "uFireI", "uFireCol"]);
    const m = toonMaterial({ wind: "grass", doubleSided: true });
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <common>\n#include <project_vertex>", fragmentShader: "#include <common>\n#include <opaque_fragment>" };
    (m.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    expect(shader.uniforms.uTime).toBe(worldTime);
    expect(shader.uniforms.uPush).toBe(pushers);
    expect(shader.uniforms.uFireI).toBe(fireLight.uFireI);
    expect(shader.vertexShader).toContain("windBlade(");
    expect(shader.vertexShader).toContain("instanceMatrix[3].xyz");
  });
});

describe("the water mesh", () => {
  it("is one finite mesh whose surface follows the shared channel level, faces up and stays inside the stream's corridor", () => {
    const terrain = createArena(7).terrain as LandscapeTerrain;
    const g = buildWater(terrain);
    const p = g.attributes.position!;
    const q = g.attributes.aQ!;
    for (let i = 0; i < p.count; i++) {
      for (const v of [p.getX(i), p.getY(i), p.getZ(i), q.getX(i)]) expect(Number.isFinite(v)).toBe(true);
      expect(q.getX(i)).toBeGreaterThanOrEqual(0);
      expect(q.getX(i)).toBeLessThanOrEqual(1.03);
      // the surface never sits above the ground beside it by more than the bank's freeboard (it would float) ...
      expect(p.getY(i)).toBeLessThan(terrain.height(p.getX(i), p.getZ(i)) + 0.9);
    }
    const idx = g.index!;
    let up = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const cross = (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) - (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
      if (cross > 0) up++;
    }
    expect(up).toBe(idx.count / 3);
  });
});

describe("the baked footpath overlay", () => {
  it("is the same wear function as the painted vertices: texels on the paths are bare earth, open ground is empty, ruts show on the cart road", () => {
    const data = bakeTrailMask(256);
    const size = 256;
    const at = (x: number, z: number): [number, number, number] => {
      const i = Math.min(size - 1, Math.max(0, Math.floor(((x + MASK_EXTENT) / (MASK_EXTENT * 2)) * size)));
      const j = Math.min(size - 1, Math.max(0, Math.floor(((z + MASK_EXTENT) / (MASK_EXTENT * 2)) * size)));
      const o = (j * size + i) * 4;
      return [data[o]!, data[o + 1]!, data[o + 2]!];
    };
    const obs = TRAILS.find((t) => t.name === "observatory")!;
    let bare = 0;
    for (let i = 4; i + 1 < obs.line.length; i += 8) if (at(obs.line[i]!, obs.line[i + 1]!)[0] > 128) bare++;
    expect(bare).toBeGreaterThan(obs.line.length / 8 / 2);
    expect(at(-60, 60)).toEqual([0, 0, 0]);
    let ruts = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 1]! > 128) ruts++;
    expect(ruts).toBeGreaterThan(20);
    expect(MASK_SIZE).toBeGreaterThanOrEqual(1024);
    const s = trailSample(0, 0, { wear: 0, shoulder: 0, rut: 0 });
    expect(at(0, 0)[0]).toBeGreaterThan(s.wear * 255 - 60); // the spawn's meeting place is worn in both
  });
});
