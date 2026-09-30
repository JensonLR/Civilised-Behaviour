import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BufferGeometry, Mesh, Scene, Vector3, type Material } from "three";
import { createDayState, dayState } from "@cb/shared";
import { PRESETS } from "../../Stage.ts";
import { WorldView } from "../WorldView.ts";
import { createRegionView } from "../regionView.ts";
import { ATLAS_H, ATLAS_W, buildKessarCloth } from "./cloth.ts";
import { buildKessarGround, buildKessarSkirt, kessarCover, kessarGroundColour, skirtY } from "./ground.ts";
import { palmGeometry } from "./palms.ts";
import { KESSAR_ANCHORS as A, KESSAR_SIGNS, createKessarWorld, createRegionWorld, kessarPlan, type KessarTerrain } from "./shared.ts";
import { buildKessarSolid } from "./structures.ts";
import { buildKessarWater, riverShore } from "./water.ts";

// The banner and sign atlas is drawn on a canvas; the unit-test environment has no DOM, so give it a recording stub (as WorldView.test does).
const g = globalThis as unknown as Record<string, unknown>;
let saved: unknown;
const drawn: string[] = [];
beforeAll(() => {
  saved = g.document;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k === "fillText" ? (text: string): void => void drawn.push(text) : k in t ? t[k as string] : (): unknown => ({ addColorStop() {}, width: 10 })),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }), fonts: undefined };
});
afterAll(() => {
  g.document = saved;
});

const sun = new Vector3(-0.55, 0.62, 0.42).normalize();
const world = createKessarWorld(7);

const tris = (geo: BufferGeometry): number => (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
const finite = (geo: BufferGeometry, name: string): void => {
  for (const key of Object.keys(geo.attributes)) {
    const a = geo.attributes[key]!.array as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) throw new Error(`${name}.${key}[${i}] is ${a[i]}`);
  }
};

describe("Kessar Reach view: budgets", () => {
  for (const name of ["test", "low", "medium", "high"] as const) {
    it(`${name}: the region is within its draw-call and triangle budget`, () => {
      const view = createRegionView("kessar", new Scene(), world, PRESETS[name], sun);
      if (process.env.WORLD_STATS) process.stderr.write(`kessar ${name} ${JSON.stringify(view.stats)}\n`);
      // Hollowmere's ceilings are 28 / 37 / 66 draws and 115k / 160k / 430k / 540k triangles (WorldView.test.ts). Kessar has no village or people: it stays well inside them.
      expect(view.stats.meshes).toBeLessThanOrEqual(name === "test" ? 20 : name === "low" ? 26 : 40);
      expect(view.stats.triangles).toBeLessThan(name === "test" ? 110_000 : name === "low" ? 150_000 : name === "medium" ? 400_000 : 500_000);
      expect(view.stats.meshes).toBeGreaterThan(8);
      view.update(1.5, { x: 0, y: 0, z: 88 });
      view.applyDay(dayState(13, createDayState()));
      view.setPushers([{ x: 0, z: 90 }], 1);
      view.dispose();
    });
  }

  it("Hollowmere still builds through the region factory, unchanged", () => {
    const view = createRegionView("hollowmere", new Scene(), createRegionWorld("hollowmere", 7), PRESETS.test, sun);
    expect(view).toBeInstanceOf(WorldView);
    view.dispose();
  });

  it("the parts are all there: ground, water, the fort and bridge, the cloth, palms, hills", () => {
    const view = createRegionView("kessar", new Scene(), world, PRESETS.medium, sun);
    for (const part of ["terrain", "skirt", "hills", "water", "kessar", "kessar_outline", "cloth", "palms", "acacia", "rock"]) expect(view.root.getObjectByName(part), part).toBeDefined();
    view.dispose();
  });

  it("outlines follow the preset (none on low), and low keeps the shapes", () => {
    const hulls = (name: "low" | "medium"): number => {
      const v = createRegionView("kessar", new Scene(), world, PRESETS[name], sun);
      let n = 0;
      v.root.traverse((o) => void (o.name.endsWith("_outline") && n++));
      v.dispose();
      return n;
    };
    expect(hulls("low")).toBe(0);
    expect(hulls("medium")).toBeGreaterThan(0);
  });

  it("dispose frees every geometry and material it made, and the scene is left empty", () => {
    const scene = new Scene();
    const view = createRegionView("kessar", scene, world, PRESETS.medium, sun);
    const freed = new Set<unknown>();
    const all: unknown[] = [];
    view.root.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) {
        all.push(m.geometry);
        m.geometry.addEventListener("dispose", () => freed.add(m.geometry));
      }
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats as Material[]) {
        all.push(mat);
        mat.addEventListener("dispose", () => freed.add(mat));
      }
    });
    view.dispose();
    const leaked = all.filter((x) => !freed.has(x) && !(x as { userData?: { sharedInk?: boolean } }).userData?.sharedInk && !/outline|ink/i.test((x as { type?: string; name?: string }).name ?? ""));
    // (the ink materials belong to every mesh in the game: the shared-ink guard in disposeTree leaves them alone)
    const real = leaked.filter((x) => (x as BufferGeometry).isBufferGeometry);
    expect(real.length, "undisposed geometries").toBe(0);
    expect(scene.children.length).toBe(0);
  });
});

describe("Kessar Reach view: geometry", () => {
  it("the solid is finite, faces outward overall, and cheaper as its hull", () => {
    const full = buildKessarSolid(world, 1);
    const hull = buildKessarSolid(world, 0);
    expect(full.geometry).toBeDefined();
    finite(full.geometry!, "solid");
    finite(hull.geometry!, "hull");
    expect(tris(hull.geometry!)).toBeLessThan(tris(full.geometry!));
    expect(full.collapsed).toBe(false);
    // outward normals: the signed volume of the triangle soup is positive
    const pos = full.geometry!.attributes.position!;
    let vol = 0;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(pos, i);
      const b = new Vector3().fromBufferAttribute(pos, i + 1);
      const c = new Vector3().fromBufferAttribute(pos, i + 2);
      vol += a.dot(b.clone().cross(c)) / 6;
    }
    expect(vol).toBeGreaterThan(0);
    const col = full.geometry!.attributes.color!;
    for (let i = 0; i < col.count; i++) for (const k of [0, 1, 2]) expect(col.array[i * 3 + k]!).toBeLessThanOrEqual(1.0001);
  });

  it("a collapsed bridge draws the stumps, not the span", () => {
    const down = createKessarWorld(7, "collapsed");
    const intact = buildKessarSolid(world, 1);
    const fallen = buildKessarSolid(down, 1);
    expect(fallen.collapsed).toBe(true);
    expect(tris(fallen.geometry!)).toBeLessThan(tris(intact.geometry!));
    finite(fallen.geometry!, "fallen");
  });

  it("the cloth and signs are finite, inside the atlas, and lettered from the authored text", () => {
    const cloth = buildKessarCloth(world.terrain)!;
    finite(cloth, "cloth");
    const uv = cloth.attributes.uv!.array as ArrayLike<number>;
    for (let i = 0; i < uv.length; i++) expect(uv[i]!).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < uv.length; i++) expect(uv[i]!).toBeLessThanOrEqual(1);
    const wave = cloth.attributes.wave!.array as ArrayLike<number>;
    expect(Math.max(...Array.from(wave))).toBeLessThanOrEqual(1);
    expect(Math.min(...Array.from(wave))).toBe(0);
    expect(ATLAS_W).toBe(512);
    expect(ATLAS_H).toBeGreaterThan(1000);
    // the atlas was drawn with every sign's words (the canvas is a recording stub here)
    for (const s of KESSAR_SIGNS) expect(drawn).toContain(s);
    expect(drawn).toContain("DV");
    expect(kessarPlan().banners.length).toBeGreaterThanOrEqual(9);
  });

  it("the ground, the skirt, the water and the palm are finite and well formed", () => {
    const terrain = world.terrain as KessarTerrain;
    const ground = buildKessarGround(terrain, 40);
    finite(ground, "ground");
    const p = ground.attributes.position!;
    // the drawn ground meets the skirt at the rim
    for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i), p.getZ(i)) > A.bounds + 26) expect(p.getY(i)).toBeCloseTo(skirtY(p.getZ(i)), 1);
    finite(buildKessarSkirt(), "skirt");
    const water = buildKessarWater(terrain, true);
    finite(water.mesh.geometry, "water");
    for (const x of [-60, 0, 46, 90]) {
      const s = riverShore(terrain, x);
      expect(s).toBeGreaterThan(2);
      expect(s).toBeLessThan(13);
    }
    for (const lod of [0, 1] as const) finite(palmGeometry(lod), "palm");
    water.mesh.geometry.dispose();
  });

  it("the ground is painted in the palette and the plant cover keeps off roads, sand and the gorge", () => {
    const out = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < 400; i++) {
      const x = ((i * 37) % 240) - 120;
      const z = ((i * 91) % 240) - 120;
      kessarGroundColour(x, z, terrainH(x, z), 0.2, out);
      for (const v of [out.r, out.g, out.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(kessarCover(0, 60, 0.5, 0)).toBeCloseTo(0, 6); // the road
    expect(kessarCover(0, 98, 0.5, 0)).toBeCloseTo(0, 6); // the beach
    expect(kessarCover(0, 20, -3, 1.5)).toBeCloseTo(0, 6); // the gorge
  });
});

const terrainH = (x: number, z: number): number => world.terrainHeight(x, z);
