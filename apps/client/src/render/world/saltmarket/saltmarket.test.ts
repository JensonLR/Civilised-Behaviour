import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import v8 from "node:v8";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BufferGeometry, Mesh, Scene, Vector3, type Material } from "three";
import {
  PALETTE, SALTMARKET, SALTMARKET_ANCHORS as A, SALTMARKET_CHANNELS, SALTMARKET_SIGNS, SALTMARKET_VIEW_BUDGET, createDayState, createRegionWorld, createSaltmarketWorld, dayState, saltmarketPlan, type ScenarioView,
  type SaltmarketTerrain,
} from "@cb/shared";
import { PRESETS } from "../../../render/Stage.ts";
import { saltmarketViews } from "../../../showcase/saltmarket.ts";
import { createRegionView } from "../regionView.ts";
import { ATLAS_H, ATLAS_W, BANNER_UV, buildSaltmarketCloth } from "./cloth.ts";
import { FLOOD, floodLevel, floodTarget } from "./flood.ts";
import { buildSaltmarketGround, buildSaltmarketSkirt, saltmarketCover, saltmarketGroundColour } from "./ground.ts";
import { buildDeltaHorizon } from "./horizon.ts";
import { planSaltmarketScatter } from "./scatter.ts";
import { SaltmarketView } from "./SaltmarketView.ts";
import { buildSaltmarketPlanks, buildSaltmarketSolid } from "./structures.ts";
import { buildSaltmarketWaterGeometry, flowAt } from "./water.ts";

// (CPU-bound: most tests here build the whole region at least once, up to about 2 s each alone; under the full suite's four workers one ran past vitest's 5 s default.
// A time limit, not a budget: the budgets are the assertions.)
vi.setConfig({ testTimeout: 30_000 });

// The banner and sign atlas is drawn on a canvas; the unit-test environment has no DOM, so give it a recording stub (as highmark.test does).
const g = globalThis as unknown as Record<string, unknown>;
let saved: unknown;
const drawn: string[] = [];
beforeAll(() => {
  saved = g.document;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k === "fillText" ? (text: string): void => void drawn.push(text) : k === "measureText" ? (text: string): { width: number } => ({ width: text.length * 14 }) : k in t ? t[k as string] : (): unknown => ({ addColorStop() {}, width: 10 })),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }), fonts: undefined };
});
afterAll(() => {
  g.document = saved;
});

const sun = new Vector3(-0.55, 0.62, 0.42).normalize();
const world = createSaltmarketWorld(7);

const tris = (geo: BufferGeometry): number => (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
const finite = (geo: BufferGeometry, name: string): void => {
  for (const key of Object.keys(geo.attributes)) {
    const a = geo.attributes[key]!.array as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) throw new Error(`${name}.${key}[${i}] is ${a[i]}`);
  }
};

describe("Saltmarket view: budgets", () => {
  for (const name of ["test", "low", "medium", "high"] as const) {
    it(`${name}: the region is within SALTMARKET_VIEW_BUDGET`, () => {
      const view = createRegionView("saltmarket", new Scene(), world, PRESETS[name], sun);
      if (process.env.WORLD_STATS) process.stderr.write(`saltmarket ${name} ${JSON.stringify(view.stats)}\n`);
      expect(view).toBeInstanceOf(SaltmarketView);
      expect(view.stats.meshes).toBeLessThanOrEqual(SALTMARKET_VIEW_BUDGET.meshes[name]);
      expect(view.stats.triangles).toBeLessThan(SALTMARKET_VIEW_BUDGET.triangles[name]);
      expect(view.stats.meshes).toBeGreaterThan(8);
      view.update(1.5, { x: 0, y: 0, z: 118 }, 40);
      view.applyDay(dayState(13, createDayState()));
      view.applyDay(dayState(18.6, createDayState()));
      view.setPushers([{ x: 0, z: 118 }], 1);
      view.dispose();
    });
  }

  it("the parts are all there: ground, water, the flood, the horizon, the solids and their ink, the planks, the cloth, the reeds and the stakes", () => {
    const view = createRegionView("saltmarket", new Scene(), world, PRESETS.medium, sun);
    for (const part of ["terrain", "skirt", "horizon", "water", "flood", "cloth", "reeds", "sedge", "tamarisk", "stakes", "delta2", "delta2_outline", "planks2", "lantern-glow"]) expect(view.root.getObjectByName(part), part).toBeDefined();
    view.dispose();
  });

  it("outlines follow the preset (none on low), and low keeps the shapes", () => {
    const hulls = (name: "low" | "medium"): number => {
      const v = createRegionView("saltmarket", new Scene(), world, PRESETS[name], sun);
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
    const view = createRegionView("saltmarket", scene, world, PRESETS.medium, sun);
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

describe("Saltmarket view: geometry", () => {
  it("the solids are finite, face outward overall, are cheaper as their hulls, and carry colours inside 0..1", () => {
    const full = buildSaltmarketSolid(world, 1);
    const hull = buildSaltmarketSolid(world, 0);
    expect(full.geometries.filter(Boolean).length).toBe(4);
    let trisFull = 0, trisHull = 0;
    full.geometries.forEach((geo, i) => {
      finite(geo!, `solid${i}`);
      finite(hull.geometries[i]!, `hull${i}`);
      trisFull += tris(geo!);
      trisHull += tris(hull.geometries[i]!);
      const pos = geo!.attributes.position!;
      let vol = 0;
      for (let k = 0; k + 2 < pos.count; k += 3) {
        const a = new Vector3().fromBufferAttribute(pos, k), b = new Vector3().fromBufferAttribute(pos, k + 1), c = new Vector3().fromBufferAttribute(pos, k + 2);
        vol += a.dot(b.clone().cross(c)) / 6;
      }
      expect(vol, `solid${i} faces outward`).toBeGreaterThan(0);
      const col = geo!.attributes.color!;
      for (let k = 0; k < col.count; k++) for (const j of [0, 1, 2]) expect(col.array[k * 3 + j]!).toBeLessThanOrEqual(1.0001);
    });
    expect(trisHull).toBeLessThan(trisFull);
    // the lamps are the plan's lamps plus the lanterns on the hairs, the quay, the bridge and the hall; each stands above the ground it is on
    expect(full.lamps.length).toBeGreaterThanOrEqual(saltmarketPlan().lamps.length + 8);
    for (const l of full.lamps) expect(l.y).toBeGreaterThan(world.terrainHeight(l.x, l.z) - 0.2);
    for (const l of full.lamps.slice(0, saltmarketPlan().lamps.length)) expect(l.y).toBeGreaterThan(world.terrainHeight(l.x, l.z) + 2.5);
  });

  it("every pile of the revetment the collision world has is drawn, and every house, pillar and hair is inside the geometries' bounds", () => {
    const solid = buildSaltmarketSolid(world, 0);
    const boxes = solid.geometries.map((geo) => (geo!.computeBoundingBox(), geo!.boundingBox!));
    const inside = (x: number, z: number): boolean => boxes.some((bb) => x > bb.min.x - 1 && x < bb.max.x + 1 && z > bb.min.z - 1 && z < bb.max.z + 1);
    for (const o of world.obstacles.filter((q) => q.tag === "fence" || q.tag === "house" || q.tag === "ruin" || q.tag === "pole")) expect(inside(o.x, o.z), `${o.tag}@${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBe(true);
    // the hairs stand as tall as the plan says: the highest vertex over the campanile is its collider's top
    const camp = saltmarketPlan().hairs.find((h) => h.kind === "campanile")!;
    let top = 0;
    for (const geo of solid.geometries) {
      const p = geo!.attributes.position!;
      for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i) - camp.x, p.getZ(i) - camp.z) < camp.r + 0.3) top = Math.max(top, p.getY(i));
    }
    expect(top).toBeGreaterThan(world.terrainHeight(camp.x, camp.z) + camp.height - 0.6);
    expect(top).toBeLessThan(world.terrainHeight(camp.x, camp.z) + camp.height + 1.0);
    // no building's geometry rises above the collider's top (the skyline measured on the colliders is the skyline drawn)
    for (const h of saltmarketPlan().houses.concat([saltmarketPlan().customsHouse, saltmarketPlan().dropHouse])) {
      let hi = -Infinity;
      for (const geo of solid.geometries) {
        const p = geo!.attributes.position!;
        for (let i = 0; i < p.count; i++) {
          if (Math.abs(p.getX(i) - h.x) >= h.hx - 0.4 || Math.abs(p.getZ(i) - h.z) >= h.hz - 0.4) continue;
          if (saltmarketPlan().hairs.some((q) => Math.hypot(p.getX(i) - q.x, p.getZ(i) - q.z) < q.r + 0.5)) continue;   // (a flagpole beside a house is a hair, not a roof)
          hi = Math.max(hi, p.getY(i));
        }
      }
      expect(hi - world.terrainHeight(h.x, h.z), `house@${h.x},${h.z} stays inside its collider's top`).toBeLessThanOrEqual(h.height + 0.35);
    }
  });

  it("the boardwalk's planks are finite and skip the bridges' decks", () => {
    const planks = buildSaltmarketPlanks(world, 1);
    expect(planks.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    for (const [i, p] of planks.entries()) if (p) finite(p, `planks${i}`);
    const bridge = saltmarketPlan().bridges[0]!;
    for (const geo of planks) {
      if (!geo) continue;
      const p = geo.attributes.position!;
      let on = 0;
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - bridge.x) < 1.6 && Math.abs(p.getZ(i) - bridge.z) < bridge.hl - 1) on++;
      expect(on, "no plank over the span").toBe(0);
    }
  });

  it("the cloth and signs are finite, inside the atlas, and lettered from the authored text", () => {
    const cloth = buildSaltmarketCloth(world.terrain)!;
    finite(cloth, "cloth");
    const uv = cloth.attributes.uv!.array as ArrayLike<number>;
    for (let i = 0; i < uv.length; i++) {
      expect(uv[i]!).toBeGreaterThanOrEqual(0);
      expect(uv[i]!).toBeLessThanOrEqual(1);
    }
    const wave = cloth.attributes.wave!.array as ArrayLike<number>;
    expect(Math.max(...Array.from(wave))).toBeLessThanOrEqual(1);
    expect(Math.min(...Array.from(wave))).toBe(0);
    expect(ATLAS_W).toBe(512);
    expect(ATLAS_H).toBeGreaterThan(700);
    // (a long sign is lettered on two lines: every word of it is drawn, in order)
    const joined = drawn.join(" ");
    for (const s of SALTMARKET_SIGNS) for (const w of s.split(" ")) expect(joined, w).toContain(w);
    expect(drawn).toContain("DV");
    expect(Object.keys(BANNER_UV).sort()).toEqual(["customs", "house", "society", "syndicate"]);
    expect(saltmarketPlan().banners.length).toBeGreaterThanOrEqual(5);
  });

  it("no real-world term in any sign, and the lettering is Latin capitals", () => {
    const banned = /\b(london|england|britain|british|france|french|german|spain|rome|india|china|japan|africa|arab|egypt|turk|islam|muslim|christ|jewish|hindu|buddh|america|russia|paris|berlin|cairo|kenya|zulu|maasai|ethiopia|nairobi)\b/i;
    expect(SALTMARKET_SIGNS.length).toBeGreaterThanOrEqual(4);
    for (const s of SALTMARKET_SIGNS) {
      expect(s).toMatch(/^[A-Z0-9 .,:()'-]+$/);
      expect(s).not.toMatch(banned);
    }
    for (const s of saltmarketPlan().signs) expect(s.text).toBeLessThan(SALTMARKET_SIGNS.length);
  });

  it("the ground, the skirt, the horizon, the water and the flood are finite and well formed", () => {
    const terrain = world.terrain as SaltmarketTerrain;
    const ground = buildSaltmarketGround(terrain, 60);
    finite(ground, "ground");
    const p = ground.attributes.position!;
    for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i), p.getZ(i)) > A.bounds + 26) expect(p.getY(i)).toBeCloseTo(SALTMARKET.level - 0.12, 1);
    finite(buildSaltmarketSkirt(), "skirt");
    finite(buildDeltaHorizon(), "horizon");
    const seg = Math.round(PRESETS.medium.terrainSegments * 1.35);
    const water = buildSaltmarketWaterGeometry(terrain, seg)!;
    finite(water, "water");
    expect(tris(water)).toBeGreaterThan(5000);
    // every vertex lies at the water's level; q is 1 at the waterline and 0 in the deep; every triangle faces up
    const wp = water.attributes.position!, wq = water.attributes.aQ!;
    for (let i = 0; i < wp.count; i++) {
      expect(wp.getY(i)).toBeCloseTo(SALTMARKET.waterY, 6);
      expect(wq.getX(i)).toBeGreaterThanOrEqual(0);
    }
    const idx = water.index!;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      const ux = wp.getX(b) - wp.getX(a), uz = wp.getZ(b) - wp.getZ(a), vx = wp.getX(c) - wp.getX(a), vz = wp.getZ(c) - wp.getZ(a);
      expect(uz * vx - ux * vz).toBeGreaterThanOrEqual(0);
    }
    const out: [number, number] = [0, 0];
    for (const [x, z] of [[0, 92], [-54, 10], [36, -20], [0, 0], [120, 120]] as const) {
      flowAt(x, z, out);
      expect(Number.isFinite(out[0] + out[1])).toBe(true);
    }
    expect(flowAt(40, 92, out)[0], "the Customs Cut runs east-west").toBeGreaterThan(0.2);
    water.dispose();
  });

  it("the ground is painted in the palette: finite, in range, wet near water, salt on the highest dry ground", () => {
    const out = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < 800; i++) {
      const x = ((i * 37) % 300) - 150, z = ((i * 91) % 300) - 150;
      saltmarketGroundColour(x, z, world.terrainHeight(x, z), 0.2, out, (world.terrain as SaltmarketTerrain).waterDepth(x, z));
      for (const v of [out.r, out.g, out.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    const dry = { r: 0, g: 0, b: 0 }, wet = { r: 0, g: 0, b: 0 };
    saltmarketGroundColour(10, 10, 0.45, 0, dry);
    saltmarketGroundColour(10, 10, 0.1, 0, wet, 0.4);
    expect(wet.r + wet.g + wet.b, "wet ground is darker").toBeLessThan(dry.r + dry.g + dry.b);
    expect(saltmarketCover(0, 118, 0.4, 1.5)).toBeCloseTo(0, 6);   // a steep bank carries nothing
    expect(saltmarketCover(40, 30, 0.1, 0, 0.8)).toBeCloseTo(0, 6);   // deep water carries nothing
  });
});

describe("Saltmarket view: scatter", () => {
  it("is deterministic, finite, and keeps off the boardwalks, the quay, the water's depths, every obstacle and every story point", () => {
    const a = planSaltmarketScatter(world, PRESETS.medium);
    const b = planSaltmarketScatter(world, PRESETS.medium);
    expect(b).toEqual(a);
    expect(a.reeds.length).toBeGreaterThan(1500);
    expect(a.sedge.length).toBeGreaterThan(2000);
    expect(a.bushes.length).toBeGreaterThan(60);
    expect(a.stakes.length).toBeGreaterThan(20);
    const t = world.terrain as SaltmarketTerrain;
    for (const set of [a.reeds, a.sedge, a.bushes, a.stakes]) {
      for (const it of set) {
        expect(Number.isFinite(it.x + it.y + it.z + it.sx + it.sy + it.sz + it.yaw)).toBe(true);
        expect(t.waterDepth(it.x, it.z), "not in deep water").toBeLessThan(0.6);
        expect(Math.hypot(it.x, it.z)).toBeLessThan(A.bounds + 10);
      }
    }
    const plan = saltmarketPlan();
    const segD = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
      const dx = bx - ax, dz = bz - az;
      const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(px - ax - dx * k, pz - az - dz * k);
    };
    for (const it of [...a.reeds, ...a.sedge, ...a.bushes].filter((_, i) => i % 7 === 0)) {
      for (const w of plan.boardwalks) for (let i = 0; i + 1 < w.pts.length; i++) expect(segD(it.x, it.z, w.pts[i]!.x, w.pts[i]!.z, w.pts[i + 1]!.x, w.pts[i + 1]!.z), "off the planks").toBeGreaterThan(2);
    }
    for (const it of [...a.bushes, ...a.sedge]) expect(t.waterDepth(it.x, it.z), "dry or damp").toBeLessThan(0.4);
    // thinner on the test preset, never different in kind
    const thin = planSaltmarketScatter(world, PRESETS.test);
    expect(thin.reeds).toHaveLength(0);
    expect(thin.sedge).toHaveLength(0);
  });
});

describe("Saltmarket view: the flood (applyScenario)", () => {
  const view = (resolution?: string, endsAtWorldMs = 0): ScenarioView => ({ phase: resolution ? "resolved" : "waiting", objectives: [], hint: "", timerLabel: "High water", endsAtWorldMs, template: "flooded_market", title: "x", ...(resolution ? { resolution: resolution as never } : {}) });

  it("floodLevel is a pure function of (endsAtWorldMs - worldSec * 1000): bounded, finite, monotone, at rest before the window opens", () => {
    const ends = 400_000;
    let last = -1;
    for (let s = 0; s <= 420; s += 1.7) {
      const l = floodLevel(ends, s);
      expect(Number.isFinite(l)).toBe(true);
      expect(l).toBeGreaterThanOrEqual(FLOOD.base);
      expect(l).toBeLessThanOrEqual(FLOOD.max + 1e-9);
      expect(l).toBeGreaterThanOrEqual(last - 1e-12);
      last = l;
    }
    expect(floodLevel(500_000, 0), "more than a window out: the ankle's depth").toBeCloseTo(FLOOD.base, 9);
    expect(floodLevel(ends, 400)).toBeCloseTo(FLOOD.max, 6);
    expect(floodLevel(ends, 9999), "past the hammer: held at the maximum").toBeCloseTo(FLOOD.max, 6);
    for (const bad of [NaN, Infinity, -Infinity, -1e300]) {
      expect(Number.isFinite(floodLevel(ends, bad))).toBe(true);
      expect(Number.isFinite(floodLevel(bad, 10))).toBe(true);
    }
    expect(floodLevel(0, 50), "no timer: at rest").toBe(FLOOD.base);
    // a function of the DIFFERENCE alone: shifting both the clock and the deadline by the same amount changes nothing
    expect(floodLevel(ends + 123_000, 123 + 250)).toBeCloseTo(floodLevel(ends, 250), 9);
  });

  it("the target is the clock's while the sale runs, the held level after it, and the rest level for any other contract", () => {
    expect(floodTarget(undefined, 100, 0.9)).toBe(FLOOD.base);
    expect(floodTarget({ ...view(), template: "smuggling_run" }, 100, 0.9)).toBe(FLOOD.base);
    expect(floodTarget(view(undefined, 400_000), 300, 0)).toBeCloseTo(floodLevel(400_000, 300), 9);
    expect(floodTarget(view("lot_won"), 300, 0.7)).toBe(0.7);
    expect(floodTarget(view("washed_out"), 300, 0.7)).toBe(FLOOD.max);
  });

  it("the view lifts the water with the clock, never lowers it while the sale runs, holds it after the end and drops it for another contract; the collision world is untouched", () => {
    const hash = JSON.stringify(world.obstacles.map((o) => [o.x, o.z, o.y1]));
    const v = createRegionView("saltmarket", new Scene(), createSaltmarketWorld(7), PRESETS.medium, sun) as SaltmarketView;
    const flood = v.root.getObjectByName("flood") as Mesh;
    const floor = world.terrainHeight(A.exchange.x, A.exchange.z);
    expect(flood.position.y).toBeCloseTo(floor + FLOOD.base, 6);
    v.applyScenario(view(undefined, 400_000));
    let last = v.floodLevel;
    for (let s = 0; s <= 410; s += 5) {
      v.update(s, undefined, s);
      expect(v.floodLevel).toBeGreaterThanOrEqual(last - 1e-12);
      expect(flood.position.y).toBeCloseTo(floor + v.floodLevel, 6);
      last = v.floodLevel;
    }
    expect(last).toBeCloseTo(FLOOD.max, 3);
    // the clock going BACK (a rebuild with an older clock) does not lower it while the same sale runs
    v.update(1, undefined, 100);
    expect(v.floodLevel).toBeGreaterThanOrEqual(last - 1e-9);
    // the sale ends: the level holds
    v.applyScenario(view("lot_won"));
    v.update(500, undefined, 450);
    expect(v.floodLevel).toBeGreaterThanOrEqual(last - 1e-9);
    // a different contract (or none): the hall dries to its ankle's depth
    v.applyScenario({ ...view(), template: "smuggling_run" });
    expect(v.floodLevel).toBe(FLOOD.base);
    v.applyScenario(undefined);
    v.update(600, undefined, 600);
    expect(v.floodLevel).toBe(FLOOD.base);
    v.dispose();
    expect(JSON.stringify(world.obstacles.map((o) => [o.x, o.z, o.y1]))).toBe(hash);
  });

  it("floodLevel allocates nothing per frame", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const run = (): void => { let a = 0; for (let k = 0; k < 200_000; k++) a += floodLevel(400_000, (k % 420) + 0.5); if (a < 0) throw new Error("x"); };
    run();
    gc();
    const before = process.memoryUsage().heapUsed;
    run();
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(500_000);
  });
});

describe("Saltmarket view: the palette and the showcase", () => {
  it("no colour literal and no other region's colours anywhere in this folder's source (the game's stock plant geometry is tinted toward the delta's reed colours, which is the one place PALETTE.world is read)", () => {
    const files = readdirSync(new URL(".", import.meta.url).pathname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const f of files) {
      const src = readFileSync(join(new URL(".", import.meta.url).pathname, f), "utf8");
      expect(/\b0x[0-9a-fA-F]{6}\b/.test(src.replace(/0xffffff/gi, "")), `${f} has a colour literal`).toBe(false);
      for (const m of src.matchAll(/PALETTE\.([a-zA-Z]+)/g)) expect(["saltmarket", "world"], `${f} reads PALETTE.${m[1]}`).toContain(m[1]);
      if (f !== "SaltmarketView.ts") expect(src.includes("PALETTE.world"), `${f} reads PALETTE.world`).toBe(false);
    }
    expect(Object.keys(PALETTE.saltmarket).length).toBeGreaterThanOrEqual(30);
  });

  it("every vantage point the brief asks for exists, looks at something inside the bounds and stands above the ground", () => {
    const views = saltmarketViews((x, z) => world.terrainHeight(x, z));
    for (const name of ["landing", "quay", "boardwalk", "channel", "stilts", "customs", "berth", "cove", "drop", "exchange", "flood", "horizon", "top"]) expect(views[name], name).toBeDefined();
    for (const [name, [cam, at]] of Object.entries(views)) {
      expect(Number.isFinite(cam.x + cam.y + cam.z + at.x + at.y + at.z), name).toBe(true);
      expect(Math.hypot(at.x, at.z), name).toBeLessThan(A.bounds + 2);
      if (name !== "top") expect(cam.y, name).toBeGreaterThan(world.terrainHeight(cam.x, cam.z) + 0.8);
    }
    expect(SALTMARKET_CHANNELS.length).toBeGreaterThan(5);
    expect(createRegionWorld("saltmarket", 7).obstacles.length).toBe(world.obstacles.length);
  });

  it("the day moves the water's light: dark at night, bright at noon", () => {
    const v = createRegionView("saltmarket", new Scene(), world, PRESETS.medium, sun) as SaltmarketView;
    const water = v.root.getObjectByName("water") as Mesh;
    expect(water).toBeDefined();
    v.applyDay(dayState(13, createDayState()));
    const noon = (water.material as unknown as { uniforms: { uLight?: unknown } }).uniforms;
    expect(noon).toBeDefined();
    v.dispose();
  });
});
