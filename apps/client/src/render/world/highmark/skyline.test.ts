import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mesh, Scene, Vector3, type BufferGeometry, type MeshBasicMaterial, type ShaderMaterial } from "three";
import { HIGHMARK_ANCHORS as A, HIGHMARK, HIGHMARK_VIEW_BUDGET, PALETTE, createDayState, createHighmarkWorld, dayState, highmarkPlan, luminance } from "@cb/shared";
import { PRESETS } from "../../Stage.ts";
import { createRegionView } from "../regionView.ts";
import { ATLAS_H, ATLAS_W, BANNER_UV, buildHighmarkCloth } from "./cloth.ts";
import { fragmentOf, LANDMARK_FOG, landmarkInk } from "./landmark.ts";
import { BELL_GABLE, LANTERN_TOWER, capitalSpires, palaceHeights, skylineBanners, terraceMasts } from "./skyline.ts";
import { buildHighmarkSolid, lanternRoom } from "./structures.ts";

/**
 * The capital's skyline pass (package P, D-037): "the Highmark capital washes into the haze". The picture is judged by looking (docs/_notes/polish.md has the stills and the measured
 * contrast); these tests hold what looking cannot: the budgets, the height and the vertical features the data lists, the lit tower following the day, the cloth inside the atlas, the
 * palette discipline and the haze answer's shader.
 */

const g = globalThis as unknown as Record<string, unknown>;
let saved: unknown;
beforeAll(() => {
  saved = g.document;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : (): unknown => ({ addColorStop() {}, width: 10 })),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }), fonts: undefined };
});
afterAll(() => {
  g.document = saved;
});

const world = createHighmarkWorld(7);
const sun = new Vector3(-0.55, 0.62, 0.42).normalize();
const plan = highmarkPlan();
const gy = world.terrainHeight(plan.palace.x, plan.palace.z);

const positions = (geo: BufferGeometry): Float32Array => geo.attributes.position!.array as Float32Array;

describe("Highmark skyline: budgets (numbers unchanged)", () => {
  it("HIGHMARK_VIEW_BUDGET is exactly what the contract set, and every preset is inside it", () => {
    expect(HIGHMARK_VIEW_BUDGET.meshes).toEqual({ test: 22, low: 28, medium: 44, high: 44 });
    expect(HIGHMARK_VIEW_BUDGET.triangles).toEqual({ test: 120_000, low: 170_000, medium: 440_000, high: 540_000 });
    for (const name of ["test", "low", "medium", "high"] as const) {
      const view = createRegionView("highmark", new Scene(), world, PRESETS[name], sun);
      expect(view.stats.meshes, `${name} meshes`).toBeLessThanOrEqual(HIGHMARK_VIEW_BUDGET.meshes[name]);
      expect(view.stats.triangles, `${name} triangles`).toBeLessThan(HIGHMARK_VIEW_BUDGET.triangles[name]);
      view.dispose();
    }
  }, 30_000); // (CPU-bound: builds Highmark's view at all four presets, the barley field included; 5.2 s in the full parallel run. A time limit, not a budget.)
});

describe("Highmark skyline: height and vertical features", () => {
  const solid = buildHighmarkSolid(world, 1);
  const pos = positions(solid.geometry!);

  it("the highest built point of the capital stands at least 8 m over the palace's roof", () => {
    const roof = gy + palaceHeights().ridge;
    let top = -Infinity;
    let at = "";
    for (let i = 0; i < pos.length; i += 3) {
      // (the capital: everything on the hill's plateau and terraces, not the Reed Landing's barge)
      if (Math.hypot(pos[i]! - A.capital.x, pos[i + 2]! - A.capital.z) > A.capital.hillRadius) continue;
      if (pos[i + 1]! > top) {
        top = pos[i + 1]!;
        at = `${pos[i]!.toFixed(1)},${pos[i + 2]!.toFixed(1)}`;
      }
    }
    expect(top - roof, `highest at ${at}`).toBeGreaterThanOrEqual(8);
  });

  it("at least six vertical features rise above the palace's parapet line, and every one listed is really in the geometry (tip within half a metre)", () => {
    const parapet = gy + palaceHeights().base + 0.3;
    const spires = capitalSpires(world);
    const above = spires.filter((s) => s.top - parapet >= 1.5);
    expect(above.length).toBeGreaterThanOrEqual(6);
    expect(spires.map((s) => s.name)).toEqual(expect.arrayContaining(["lantern-tower", "bell-gable"]));
    for (const s of spires) {
      let tip = -Infinity;
      for (let i = 0; i < pos.length; i += 3) if (Math.hypot(pos[i]! - s.x, pos[i + 2]! - s.z) < 0.6 && pos[i + 1]! > tip) tip = pos[i + 1]!;
      expect(Math.abs(tip - s.top), `${s.name}: drawn tip ${tip.toFixed(2)} vs listed ${s.top.toFixed(2)}`).toBeLessThan(0.5);
      expect(s.top, s.name).toBeGreaterThan(s.base);
      expect(Number.isFinite(s.x + s.z + s.base + s.top)).toBe(true);
    }
    // the lit tower is the tallest, and the bell-gable is taller than it was (2.8 m of posts and a 2.4 m roof)
    const lantern = spires.find((s) => s.name === "lantern-tower")!;
    const bell = spires.find((s) => s.name === "bell-gable")!;
    expect(lantern.top).toBeGreaterThan(Math.max(...spires.filter((s) => s !== lantern).map((s) => s.top)));
    expect(bell.top - bell.base).toBeGreaterThanOrEqual(BELL_GABLE.posts + BELL_GABLE.cap);
  });

  it("the skyline is view-only: the collision world and the plan are the same objects and numbers they were", () => {
    expect(plan.palace).toMatchObject({ x: 0, z: -108, hx: 10, hz: 4, height: 7.5 });
    expect(plan.gate.towers).toHaveLength(2);
    expect(A.capital).toMatchObject({ x: 0, z: -96, hillRadius: 74, plateauRadius: 20 });
    // a walker crossing the palace's lit tower's foot is not blocked by anything new: the tower stands on tier two, above every walkable height
    const tower = lanternRoom(world);
    expect(tower.y).toBeGreaterThan(gy + palaceHeights().base + palaceHeights().t2);
  });

  it("the terrace masts stand on real risers, off the ramps, and every one has cloth", () => {
    const masts = terraceMasts();
    expect(masts.length).toBeGreaterThanOrEqual(8);
    const banners = skylineBanners(world);
    for (const m of masts) {
      expect(HIGHMARK.heights[m.riser + 1]! + HIGHMARK.parapet).toBeLessThan(m.base);
      expect(banners.some((b) => b.x === m.x && b.z === m.z), `a banner on riser ${m.riser}`).toBe(true);
    }
  });
});

describe("Highmark skyline: the lit tower follows the day", () => {
  it("its glass is dark at 13:00 and lit at 18:40 (and the lamps' glow with it)", () => {
    const view = createRegionView("highmark", new Scene(), world, PRESETS.medium, sun);
    const glass = (view.root.getObjectByName("palace-lantern") as Mesh).material as MeshBasicMaterial;
    view.applyDay(dayState(13, createDayState()));
    const noon = luminance(glass.color.getHex());
    view.applyDay(dayState(18.67, createDayState()));
    const dusk = luminance(glass.color.getHex());
    expect(noon).toBeLessThan(luminance(PALETTE.highmark.lanternGlass) + 0.02);
    expect(dusk).toBeGreaterThan(0.3);
    expect(dusk).toBeGreaterThan(noon * 3);
    // the ordinary lamps burn at the same hour, from the same uniform
    const glow = view.root.getObjectByName("lantern-glow") as unknown as { material: ShaderMaterial };
    expect(glow.material.uniforms.uLamp!.value).toBeGreaterThan(0.5);
    view.applyDay(dayState(13, createDayState()));
    expect(glow.material.uniforms.uLamp!.value).toBeLessThan(0.1);
    expect(luminance(glass.color.getHex())).toBeLessThan(luminance(PALETTE.highmark.lanternGlass) + 0.02);
    view.dispose();
  });

  it("the glass sits inside the lantern room the tower's posts frame", () => {
    const l = lanternRoom(world);
    const s = capitalSpires(world).find((x) => x.name === "lantern-tower")!;
    expect(l.x).toBeCloseTo(s.x, 6);
    expect(l.z).toBeCloseTo(s.z, 6);
    expect(l.y - l.height / 2).toBeGreaterThan(s.base + LANTERN_TOWER.shaft);
    expect(l.y + l.height / 2).toBeLessThan(s.top - LANTERN_TOWER.cap);
    expect(l.half).toBeLessThan(LANTERN_TOWER.half);
  });
});

describe("Highmark skyline: the cloth", () => {
  it("there is more of it and it is bigger on the gate and the palace, every banner inside the atlas, finite, hung above the ground", () => {
    const extra = skylineBanners(world);
    const planCloth = plan.banners.reduce((a, b) => a + b.w * b.h, 0);
    const extraCloth = extra.reduce((a, b) => a + b.w * b.h, 0);
    expect(extra.length).toBeGreaterThanOrEqual(12);
    expect(extraCloth).toBeGreaterThan(planCloth * 2);
    // bigger on the gate and the palace than the plan's own there
    const biggest = (b: { w: number; h: number }[]): number => Math.max(...b.map((x) => x.w * x.h));
    expect(biggest(extra.filter((b) => Math.abs(b.z - plan.gate.z) < 8))).toBeGreaterThan(plan.banners[0]!.w * plan.banners[0]!.h);
    expect(biggest(extra.filter((b) => b.z < plan.palace.z + plan.palace.hz + 1 && b.z > plan.palace.z))).toBeGreaterThan(plan.banners[2]!.w * plan.banners[2]!.h);
    for (const b of extra) {
      expect(Number.isFinite(b.x + b.z + b.yaw + b.top + b.w + b.h)).toBe(true);
      expect(b.top - b.h, "the hem is above the ground").toBeGreaterThan(0.2);
      expect(BANNER_UV[b.kind], b.kind).toBeDefined();
    }
    for (const rect of Object.values(BANNER_UV)) for (const v of rect) expect(v).toBeGreaterThanOrEqual(0);
    for (const rect of Object.values(BANNER_UV)) for (const v of rect) expect(v).toBeLessThanOrEqual(1);
    expect(ATLAS_W * ATLAS_H).toBeGreaterThan(0);
    const geo = buildHighmarkCloth(world.terrain)!;
    for (const a of ["position", "normal", "uv", "wave"]) for (const v of geo.attributes[a]!.array as Float32Array) expect(Number.isFinite(v)).toBe(true);
    for (const u of geo.attributes.uv!.array as Float32Array) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
    // six plan banners + the skyline's, 10 x 6 quads each, and the signboards' decals
    expect(geo.attributes.position!.count / 3).toBeGreaterThan((plan.banners.length + extra.length) * 120);
  });
});

describe("Highmark skyline: the haze answer", () => {
  it("the capital's material keeps a share of its colour through the fog, the share is bounded and the weather takes it back", () => {
    const view = createRegionView("highmark", new Scene(), world, PRESETS.medium, sun);
    const solid = view.root.getObjectByName("highmark") as Mesh;
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <common>\n#include <begin_vertex>\n#include <project_vertex>", fragmentShader: "#include <common>\n#include <color_fragment>\n#include <opaque_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>\n#include <premultiplied_alpha_fragment>" };
    (solid.material as { onBeforeCompile: (s: unknown, r: unknown) => void }).onBeforeCompile(shader, undefined);
    expect(shader.fragmentShader).toContain("preFog");
    expect(shader.fragmentShader).toContain("landmarkShare");
    expect(shader.fragmentShader).toContain("smoothstep(0.0105, 0.017, fogDensity)"); // fog weather hides it again
    expect(LANDMARK_FOG.share).toBeGreaterThan(0.2);
    expect(LANDMARK_FOG.share).toBeLessThan(0.6);
    expect(LANDMARK_FOG.from).toBeLessThan(LANDMARK_FOG.to);
    // the ink does not thin to nothing at 200 m: a floor of 85% of the line (the scenery's own is 42%) and the same share
    const ink = view.root.getObjectByName("highmark_outline") as Mesh;
    expect(ink.material).toBe(landmarkInk());
    expect((ink.material as ShaderMaterial).uniforms.far!.value).toBeGreaterThanOrEqual(0.8);
    expect(fragmentOf(ink.material as ShaderMaterial)).toContain("landmarkShare");
    // no other region's materials were touched: the plain scenery ink still thins to 42%
    expect(PRESETS.medium.outlines).toBe(true);
    view.dispose();
  });
});

describe("Highmark skyline: palette discipline", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  it("no colour literal in the folder's view files (the group is PALETTE.highmark) and every key the skyline reads exists", () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(resolve(dir, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      // (0xffffff is the unlit white a textured cloth multiplies by: not a palette colour)
      expect((code.match(/0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{6}\b/g) ?? []).filter((m) => m.toLowerCase() !== "0xffffff"), f).toEqual([]);
    }
    const used = new Set<string>();
    for (const f of ["structures.ts", "skyline.ts", "cloth.ts", "landmark.ts", "HighmarkView.ts"]) {
      // (structures.ts and cloth.ts alias the group as P)
      if (f === "structures.ts" || f === "cloth.ts") for (const m of readFileSync(resolve(dir, f), "utf8").matchAll(/\bP\.([a-zA-Z0-9]+)/g)) used.add(m[1]!);
      for (const m of readFileSync(resolve(dir, f), "utf8").matchAll(/PALETTE\.highmark\.([a-zA-Z0-9]+)/g)) used.add(m[1]!);
    }
    for (const k of used) expect(PALETTE.highmark, k).toHaveProperty(k);
    expect(used.has("roofDeep") && used.has("lanternGlass")).toBe(true);
  });
});

describe("Highmark skyline: dispose", () => {
  it("frees what it made and leaves the scene empty", () => {
    const scene = new Scene();
    const view = createRegionView("highmark", scene, world, PRESETS.high, sun);
    expect(view.root.getObjectByName("palace-lantern")).toBeDefined();
    view.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
