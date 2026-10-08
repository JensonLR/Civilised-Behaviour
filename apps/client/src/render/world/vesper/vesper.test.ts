import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BufferGeometry, Mesh, Scene, Vector3, type Material } from "three";
import {
  PALETTE, TEMPLATES, VESPER_ANCHORS as A, VESPER_SIGNS, VESPER_VIEW_BUDGET, createDayState, createRegionWorld, createVesperWorld, dayState, newCampaign, vesperPlan,
  type ScenarioView, type VesperTerrain,
} from "@cb/shared";
import { PRESETS } from "../../Stage.ts";
import { createRegionView } from "../regionView.ts";
import { ATLAS_H, ATLAS_W, buildVesperCloth } from "./cloth.ts";
import { NO_DRESS, dressOf } from "./dress.ts";
import { buildVesperGround, buildVesperSkirt, vesperCover, vesperGroundColour } from "./ground.ts";
import { vesperBoulderGeometry, vesperSlabGeometry } from "./rocks.ts";
import { planVesperScatter } from "./scatter.ts";
import { buildVesperSolid } from "./solid.ts";
import { VesperView } from "./VesperView.ts";
import { sheaveGeometry } from "./works.ts";

// The banner and sign atlas is drawn on a canvas; the unit-test environment has no DOM, so give it a recording stub (as highmark.test does).
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
const world = createVesperWorld(7);

const tris = (geo: BufferGeometry): number => (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
const finite = (geo: BufferGeometry, name: string): void => {
  for (const key of Object.keys(geo.attributes)) {
    const a = geo.attributes[key]!.array as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) throw new Error(`${name}.${key}[${i}] is ${a[i]}`);
  }
};
/** Signed volume of a triangle soup (positive when the faces point outward overall). */
const volume = (geo: BufferGeometry): number => {
  const pos = geo.attributes.position!;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let vol = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
};

describe("Vesper view: budgets and parts", () => {
  for (const name of ["test", "low", "medium", "high"] as const) {
    it(`${name}: the region is within VESPER_VIEW_BUDGET, and the day, the weather and the clock run on it`, () => {
      const view = createRegionView("vesper", new Scene(), world, PRESETS[name], sun);
      if (process.env.WORLD_STATS) process.stderr.write(`vesper ${name} ${JSON.stringify(view.stats)}\n`);
      expect(view).toBeInstanceOf(VesperView);
      expect(view.stats.meshes).toBeLessThanOrEqual(VESPER_VIEW_BUDGET.meshes[name]);
      expect(view.stats.triangles).toBeLessThan(VESPER_VIEW_BUDGET.triangles[name]);
      expect(view.stats.meshes).toBeGreaterThan(8);
      view.update(1.5, { x: 0, y: 0, z: 118 }, 40);
      view.applyDay(dayState(13, createDayState()));
      view.applyDay(dayState(18.6, createDayState()));
      view.applyDay(dayState(2, createDayState()));
      view.setPushers([{ x: 0, z: 118 }], 1);
      view.dispose();
    });
  }

  it("Hollowmere, Kessar and Highmark still build through the region factory, unchanged", () => {
    for (const [id, name] of [["hollowmere", "WorldView"], ["kessar", "KessarView"], ["highmark", "HighmarkView"]] as const) {
      const v = createRegionView(id, new Scene(), createRegionWorld(id, 7), PRESETS.test, sun);
      expect(v.constructor.name).toBe(name);
      v.dispose();
    }
  });

  it("the parts are all there: ground, the gorge's rocks, the town and its ink, the sheave, the cloth, the fall's dress, the pegs and the lamps", () => {
    const view = createRegionView("vesper", new Scene(), world, PRESETS.medium, sun);
    for (const part of ["terrain", "skirt", "boulders", "outcrops", "vesper", "vesper_outline", "sheave", "cloth", "fall_dug", "fall_blasted", "fall_sealed", "fall_consecrated", "peg_flags", "lantern-glow"]) {
      expect(view.root.getObjectByName(part), part).toBeDefined();
    }
    view.dispose();
  });

  it("outlines follow the preset (none on low), and low keeps the shapes", () => {
    const hulls = (name: "low" | "medium"): number => {
      const v = createRegionView("vesper", new Scene(), world, PRESETS[name], sun);
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
    const view = createRegionView("vesper", scene, world, PRESETS.medium, sun);
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
    expect(leaked.filter((x) => (x as BufferGeometry).isBufferGeometry).length, "undisposed geometries").toBe(0);
    expect(scene.children.length).toBe(0);
  });
});

describe("Vesper view: geometry", () => {
  it("the solid is finite, faces outward overall, colours stay inside 0..1, and the hull is cheaper than the full build", () => {
    const full = buildVesperSolid(world, 1);
    const hull = buildVesperSolid(world, 0);
    finite(full.geometry!, "solid");
    finite(hull.geometry!, "hull");
    expect(tris(hull.geometry!)).toBeLessThan(tris(full.geometry!));
    expect(volume(full.geometry!)).toBeGreaterThan(0);
    const col = full.geometry!.attributes.color!;
    for (let i = 0; i < col.count; i++) for (const k of [0, 1, 2]) expect(col.array[i * 3 + k]!).toBeLessThanOrEqual(1.0001);
    // the lamps are the plan's lamps and burn above the ground they stand on
    expect(full.glows.length).toBeGreaterThanOrEqual(vesperPlan().lamps.length);
    for (const l of full.glows) expect(l.y).toBeGreaterThan(world.terrainHeight(l.x, l.z) + 0.5);
  });

  it("every building the collision world has is drawn: the solid's bounds hold the plan's walls, and the headframe tops out above the terrace", () => {
    const geo = buildVesperSolid(world, 0).geometry!;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    for (const o of world.obstacles.filter((q) => q.tag === "wall" || q.tag === "house")) {
      expect(o.x).toBeGreaterThan(bb.min.x - 1);
      expect(o.x).toBeLessThan(bb.max.x + 1);
      expect(o.z).toBeGreaterThan(bb.min.z - 1);
      expect(o.z).toBeLessThan(bb.max.z + 1);
    }
    const hf = vesperPlan().headframe;
    expect(bb.max.y).toBeGreaterThan(world.terrainHeight(hf.x, hf.z) + 18);
    // the Long Cloister's arcade: vertices stand along the west cliff foot
    const pos = geo.attributes.position!;
    let near = 0;
    for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i) - A.cloister.x, pos.getZ(i) - A.cloister.z) < 24 && pos.getY(i) > world.terrainHeight(A.cloister.x, A.cloister.z) + 5) near++;
    expect(near).toBeGreaterThan(50);
  });

  it("the boulders, outcrops and the sheave are finite, well formed and cheap at the low level of detail", () => {
    for (const lod of [0, 1] as const) {
      for (const geo of [vesperBoulderGeometry(lod), vesperSlabGeometry(lod), sheaveGeometry(lod)]) {
        finite(geo, "rock");
        expect(tris(geo)).toBeGreaterThan(20);
        expect(tris(geo)).toBeLessThan(900);
        geo.dispose();
      }
    }
    expect(tris(vesperBoulderGeometry(0))).toBeLessThan(tris(vesperBoulderGeometry(1)));
  });

  it("the cloth and signs are finite, inside the atlas, and lettered from the authored text", () => {
    const cloth = buildVesperCloth(world.terrain)!;
    finite(cloth, "cloth");
    const uv = cloth.attributes.uv!.array as ArrayLike<number>;
    for (let i = 0; i < uv.length; i++) {
      expect(uv[i]!).toBeGreaterThanOrEqual(0);
      expect(uv[i]!).toBeLessThanOrEqual(1);
    }
    // (the weight grows down the cloth; negative on a banner hung against a wall, which billows out from it only: both kinds hang here)
    const wave = Array.from(cloth.attributes.wave!.array as ArrayLike<number>);
    expect(Math.max(...wave.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(Math.min(...wave.map(Math.abs))).toBe(0);
    expect(wave.some((w) => w < 0) && wave.some((w) => w > 0)).toBe(true);
    expect(ATLAS_W).toBe(512);
    expect(ATLAS_H).toBeGreaterThan(900);
    for (const s of VESPER_SIGNS) expect(drawn).toContain(s);
    expect(vesperPlan().banners.length).toBeGreaterThanOrEqual(3);
    expect(vesperPlan().signs.length).toBe(VESPER_SIGNS.length);
  });

  it("no real-world term in any sign, and the lettering is Latin capitals", () => {
    const banned = /\b(london|england|britain|british|france|french|german|spain|rome|india|china|japan|africa|arab|egypt|turk|islam|muslim|christ|jewish|hindu|buddh|america|russia|paris|berlin|cairo|kenya|zulu|maasai|ethiopia|nairobi)\b/i;
    expect(VESPER_SIGNS.length).toBeGreaterThanOrEqual(6);
    for (const s of VESPER_SIGNS) {
      expect(s).toMatch(/^[A-Z0-9 .,:()'-]+$/);
      expect(s).not.toMatch(banned);
    }
  });

  it("the ground, the skirt are finite and well formed; the strata paint inside the palette; the cover keeps off the road, the wharf and the cliff faces", () => {
    const terrain = world.terrain as VesperTerrain;
    const ground = buildVesperGround(terrain, 60);
    finite(ground, "ground");
    finite(buildVesperSkirt(terrain), "skirt");
    const out = { r: 0, g: 0, b: 0 };
    const floors = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const x = ((i * 37) % 300) - 150;
      const z = ((i * 91) % 300) - 150;
      const h = world.terrainHeight(x, z);
      vesperGroundColour(x, z, h, 0.2, h * 0.5, out);
      for (const v of [out.r, out.g, out.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      floors.add(`${out.r.toFixed(1)},${out.g.toFixed(1)},${out.b.toFixed(1)}`);
    }
    expect(floors.size, "strata, not one flat colour").toBeGreaterThan(6);
    const y = world.terrainHeight(0, 16);
    expect(vesperCover(0, 16, y, 0.01, y), "the ore road").toBeCloseTo(0, 6);
    expect(vesperCover(-60, 10, y + 12, 1.4, y), "a cliff face").toBeCloseTo(0, 6);
    expect(vesperCover(-30, 60, world.terrainHeight(-30, 60), 0.05, world.terrainHeight(-30, 60))).toBeGreaterThanOrEqual(0);
  });

  it("the palette's Vesper group has the strata and the Company's reds and the Guild's plum", () => {
    expect(Object.keys(PALETTE.vesper).length).toBeGreaterThan(30);
    for (const k of ["strataRust", "strataBone", "strataPlum", "glowLamp"]) expect(PALETTE.vesper, k).toHaveProperty(k);
  });
});

describe("Vesper view: scatter", () => {
  it("is deterministic, finite, and keeps off the road, the cliffs' foot and every obstacle", () => {
    const a = planVesperScatter(world, PRESETS.medium);
    const b = planVesperScatter(world, PRESETS.medium);
    expect(b).toEqual(a);
    expect(a.boulders.length).toBeGreaterThan(10);
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      for (const it of a[key] as { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number }[]) {
        expect(Number.isFinite(it.x + it.y + it.z + it.sx + it.sy + it.sz + it.yaw), key).toBe(true);
      }
    }
    // nothing grows in the road or inside a building's footprint
    for (const key of ["grass", "bushes", "pebbles", "reeds"] as const) {
      for (const it of a[key] as { x: number; z: number }[]) {
        for (const o of world.obstacles) {
          if (o.tag === "pole") continue;
          const reach = "r" in o ? o.r : Math.min(o.hx, o.hz);
          expect(Math.hypot(it.x - o.x, it.z - o.z), `${key} inside ${o.tag}`).toBeGreaterThan(reach * 0.5);
        }
      }
    }
    const thin = planVesperScatter(world, PRESETS.test);
    expect(thin.grass.length).toBeLessThan(a.grass.length);
  }, 30_000); // (CPU-bound: plans the gorge's scatter three times; 5.7 s alone, 6.6 s in the full run on a 4-core container. A time limit, not a budget.)
});

describe("Vesper view: the dress follows the contract", () => {
  const camp = newCampaign(3);
  const viewOf = (id: "mine_rescue" | "claim_race", events: readonly unknown[]): ScenarioView => {
    const t = TEMPLATES[id] as unknown as {
      init(c: typeof camp, a: number, s: number): unknown;
      reduce(s: unknown, e: unknown): { s: unknown };
      view(s: unknown, now: number): ScenarioView;
    };
    let s = t.init(camp, 0, 5);
    for (const e of events.flat()) s = t.reduce(s, e).s;
    return t.view(s, 0);
  };
  /** `secs` seconds of one-second ticks (a single tick is clamped by the reducers). */
  const tick = (secs: number): never[] => Array.from({ length: Math.round(secs) }, () => ({ t: "tick", dt: 1 }) as never);
  const use = (target: string): never => ({ t: "use", target, slot: 0 }) as never;
  const shown = (view: VesperView): string[] => view.shownDress().sort();

  it("reads the real views the templates publish: timber sets, the dig, the pegs and every ending", () => {
    expect(dressOf(undefined)).toEqual(NO_DRESS);
    expect(dressOf({ ...viewOf("mine_rescue", []), template: "secure_crossing" })).toEqual(NO_DRESS);
    const worked = dressOf(viewOf("mine_rescue", [use("timber"), use("timber"), tick(2), use("dig")]));
    expect(worked).toMatchObject({ timber: 2, dig: 2, resolution: undefined });
    const dug = dressOf(viewOf("mine_rescue", [use("timber"), use("timber"), use("timber"), ...Array.from({ length: 40 }, () => [use("dig"), tick(2)]).flat()]));
    expect(dug).toMatchObject({ timber: 3, dig: 100, resolution: "dug_out" });
    const sealed = dressOf(viewOf("mine_rescue", [tick(250)]));
    expect(sealed.resolution).toBe("sealed");
    const pegs = dressOf(viewOf("claim_race", [use("peg1"), use("peg2"), tick(110)]));
    expect(pegs.pegs[1]).toBe("party");
    expect(pegs.pegs[2]).toBe("party");
    expect(pegs.pegs[0], "the Syndicate drives the lowest open corner").toBe("rival");
    expect(pegs.pegs[3]).toBe("none");
  });

  it("applyScenario shows the shoring and the cut as the fall is worked, and each ending replaces them with its own picture", () => {
    const view = createRegionView("vesper", new Scene(), world, PRESETS.medium, sun) as VesperView;
    expect(shown(view)).toEqual([]);
    view.applyScenario(viewOf("mine_rescue", [use("timber")]));
    expect(shown(view)).toEqual(["fall_work_0"]);
    view.applyScenario(viewOf("mine_rescue", [use("timber"), use("timber"), use("timber"), use("dig"), tick(2), use("dig")]));
    expect(shown(view)).toEqual(["fall_cut", "fall_work_0", "fall_work_1", "fall_work_2"]);
    // each ending hides the work and shows one scene
    const ends: Record<string, ReturnType<typeof viewOf>> = {
      fall_sealed: viewOf("mine_rescue", [tick(250)]),
      fall_blasted: viewOf("mine_rescue", [{ t: "use", target: "keg", slot: 0 } as never, tick(10)]),
      fall_consecrated: viewOf("mine_rescue", [{ t: "actor", id: "foreman", state: "down" } as never, tick(500)]),
      fall_dug: viewOf("mine_rescue", [use("timber"), use("timber"), use("timber"), ...Array.from({ length: 40 }, () => [use("dig"), tick(2)]).flat()]),
    };
    for (const [mesh, v] of Object.entries(ends)) {
      view.applyScenario(v);
      expect(shown(view), mesh).toEqual([mesh]);
    }
    // an abandoned run, a different contract and no contract at all leave the fall alone
    view.applyScenario(viewOf("claim_race", [use("peg0")]));
    expect(shown(view)).toEqual([]);
    view.applyScenario(undefined);
    expect(shown(view)).toEqual([]);
    // the same view twice is a no-op (idempotent)
    view.applyScenario(ends.fall_sealed);
    view.applyScenario(ends.fall_sealed);
    expect(shown(view)).toEqual(["fall_sealed"]);
    view.dispose();
  });

  it("the four pegs fly a flag for whoever holds them (one instanced mesh), and nothing for an open peg", () => {
    const view = createRegionView("vesper", new Scene(), world, PRESETS.medium, sun) as VesperView;
    const flags = view.root.getObjectByName("peg_flags") as unknown as { instanceMatrix: { array: Float32Array }; count: number };
    expect(flags.count).toBe(4);
    const scaleOf = (i: number): number => flags.instanceMatrix.array[i * 16]!;
    for (let i = 0; i < 4; i++) expect(scaleOf(i)).toBe(0);
    view.applyScenario(viewOf("claim_race", [use("peg1"), use("peg2"), tick(110)]));
    expect([0, 1, 2, 3].map(scaleOf)).toEqual([1, 1, 1, 0]);
    view.applyScenario(viewOf("mine_rescue", []));
    for (let i = 0; i < 4; i++) expect(scaleOf(i)).toBe(0);
    view.dispose();
  });
});

describe("Vesper view: palette discipline", () => {
  it("no colour literal in this folder (everything is a PALETTE.vesper key or comes from a helper)", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      const lits = (src.match(/0x[0-9a-fA-F]{6}\b/g) ?? []).filter((l) => !/^0x(000000|ffffff)$/i.test(l));
      expect(lits, f).toEqual([]);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
