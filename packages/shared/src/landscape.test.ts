import { describe, expect, it } from "vitest";
import { ARENA_RADIUS, createArena } from "./arena.ts";
import { CAMP } from "./camp.ts";
import { CHARACTER, STEP_DT } from "./constants.ts";
import {
  BANK,
  HILL,
  RIVER,
  TRAILS,
  edgeNoise,
  nearTrail,
  riverCentre,
  riverHalfWidth,
  trailSample,
  waterEdgeDistance,
  waterField,
  type LandscapeTerrain,
  type WaterField,
} from "./landscape.ts";
import { createCharState, stepCharacter, yawToWire } from "./movement.ts";
import { RUIN_YAW, ruinObstacles, ruinPlan } from "./ruins.ts";
import { classifyObstacle, flowerPatch, groundColour, reedDensity, type Rgb } from "./worldgen.ts";

const SEEDS = [1, 3, 7, 99, 12345];
const landscape = (seed: number): LandscapeTerrain => createArena(seed).terrain as LandscapeTerrain;

describe("the stream and its pond", () => {
  it("starts at the aqueduct's broken end and ends in the pond, and its centreline is continuous", () => {
    const c = { x: 0, z: 0 };
    riverCentre(0, c);
    expect(Math.hypot(c.x - RIVER.a.x, c.z - RIVER.a.z)).toBeLessThan(1e-6);
    riverCentre(RIVER.length, c);
    expect(Math.hypot(c.x - RIVER.b.x, c.z - RIVER.b.z)).toBeLessThan(1e-6);
    let prev: { x: number; z: number } = { x: RIVER.a.x, z: RIVER.a.z };
    for (let s = 0.5; s <= RIVER.length; s += 0.5) {
      riverCentre(s, c);
      expect(Math.hypot(c.x - prev.x, c.z - prev.z)).toBeLessThan(0.75);
      prev = { x: c.x, z: c.z };
    }
  });

  it("the channel coordinate is 0 on the centreline, about 1 at the wet edge, and edge distance is negative inside", () => {
    const c = { x: 0, z: 0 };
    const f: WaterField = { q: 0, s: 0, pond: false };
    for (let s = 2; s < RIVER.length - 8; s += 3) {
      riverCentre(s, c);
      expect(waterField(c.x, c.z, f).q).toBeLessThan(0.05);
      expect(waterEdgeDistance(c.x, c.z)).toBeLessThan(-riverHalfWidth(s) * 0.9);
    }
    expect(waterEdgeDistance(0, 0)).toBeGreaterThan(20); // the camp is nowhere near it
    expect(waterEdgeDistance(RIVER.b.x, RIVER.b.z)).toBeCloseTo(-RIVER.pondRadius, 3);
  });

  it("is the same on every client and the server: two arenas of one seed carve identical ground, other seeds differ only by noise", () => {
    for (const seed of SEEDS) {
      const a = landscape(seed);
      const b = landscape(seed);
      const c = { x: 0, z: 0 };
      for (let s = 0; s <= RIVER.length; s += 4) {
        riverCentre(s, c);
        expect(a.height(c.x, c.z)).toBe(b.height(c.x, c.z));
        expect(a.channelLevel(s)).toBe(b.channelLevel(s));
      }
    }
    // geometry is authored, not seeded: the same stream in every world
    const c1 = { x: 0, z: 0 };
    const c2 = { x: 0, z: 0 };
    riverCentre(20, c1);
    riverCentre(20, c2);
    expect(c1).toEqual(c2);
  });

  it("water never runs uphill, the ford is a shallow wade (well under waist height) and the banks are walkable", () => {
    for (const seed of SEEDS) {
      const t = landscape(seed);
      let last = Infinity;
      for (let s = 0; s <= RIVER.length; s += 1) {
        const lv = t.channelLevel(s);
        expect(lv, `seed ${seed} s ${s}`).toBeLessThanOrEqual(last + 1e-9);
        last = lv;
      }
      let deepest = 0;
      let steepest = 0;
      for (let x = RIVER.b.x - 12; x <= RIVER.a.x + 8; x += 0.75) {
        for (let z = RIVER.b.z - 12; z <= RIVER.a.z + 8; z += 0.75) {
          deepest = Math.max(deepest, t.waterDepth(x, z));
          steepest = Math.max(steepest, Math.hypot(t.height(x + 0.5, z) - t.height(x, z), t.height(x, z + 0.5) - t.height(x, z)) / 0.5);
        }
      }
      expect(deepest, `seed ${seed}`).toBeGreaterThan(0.1); // there is water
      expect(deepest, `seed ${seed}`).toBeLessThan(0.62); // and it is a ford
      expect(steepest, `seed ${seed}`).toBeLessThan(CHARACTER.stepHeight + 0.6); // no cliffs into the water (walkable slope limit is ~1.19)
    }
  });

  it("a walker can wade across the stream and out of the pond's far side with the shared movement step", () => {
    const w = createArena(7);
    const c = { x: 0, z: 0 };
    riverCentre(RIVER.length * 0.5, c);
    // start a few metres to one side of the channel and walk straight across it (toward the far bank)
    const dir = { x: -(RIVER.b.z - RIVER.a.z), z: RIVER.b.x - RIVER.a.x };
    const dl = Math.hypot(dir.x, dir.z);
    dir.x /= dl;
    dir.z /= dl;
    const start = { x: c.x - dir.x * 7, z: c.z - dir.z * 7 };
    const s = createCharState(start.x, start.z, w);
    const yaw = yawToWire(Math.atan2(-dir.x, -dir.z));
    for (let i = 0; i < 260; i++) stepCharacter(s, { moveF: 127, moveR: 0, yaw, buttons: 0 }, STEP_DT, w);
    const across = (s.x - c.x) * dir.x + (s.z - c.z) * dir.z;
    expect(across).toBeGreaterThan(4);
  });
});

describe("footpaths", () => {
  it("every path is a smooth line inside the map, and each one starts at something in the camp or on another path", () => {
    expect(TRAILS.length).toBeGreaterThanOrEqual(8);
    const camp = [CAMP.fire, CAMP.sign, CAMP.cart, CAMP.flag, CAMP.luggage, CAMP.tents[0], CAMP.tents[1], CAMP.mapTable, CAMP.crates[0], { x: 0, z: 0 }];
    for (const t of TRAILS) {
      expect(t.line.length, t.name).toBeGreaterThan(8);
      let longest = 0;
      for (let i = 0; i + 3 < t.line.length; i += 2) longest = Math.max(longest, Math.hypot(t.line[i + 2]! - t.line[i]!, t.line[i + 3]! - t.line[i + 1]!));
      expect(longest, `${t.name} segment`).toBeLessThan(6);
      for (let i = 0; i < t.line.length; i++) expect(Number.isFinite(t.line[i]!)).toBe(true);
      const sx = t.line[0]!;
      const sz = t.line[1]!;
      const nearCamp = camp.some((c) => Math.hypot(c!.x - sx, c!.z - sz) < 6);
      const nearOther = TRAILS.some((o) => o !== t && nearTrail(sx, sz, 0.6));
      expect(nearCamp || nearOther, `${t.name} starts nowhere (${sx.toFixed(1)}, ${sz.toFixed(1)})`).toBe(true);
    }
  });

  it("the ways out run to the map edge and the way to the Observatory climbs to its plateau", () => {
    const end = (name: string): { x: number; z: number } => {
      const t = TRAILS.find((q) => q.name === name)!;
      return { x: t.line[t.line.length - 2]!, z: t.line[t.line.length - 1]! };
    };
    expect(Math.hypot(end("coast").x, end("coast").z)).toBeGreaterThan(ARENA_RADIUS);
    expect(Math.hypot(end("west").x, end("west").z)).toBeGreaterThan(ARENA_RADIUS);
    expect(Math.hypot(end("observatory").x - HILL.x, end("observatory").z - HILL.z)).toBeLessThan(HILL.plateau + 2);
  });

  it("trail wear is 0..1, strongest on the path, absent in open country and deterministic", () => {
    const out = { wear: 0, shoulder: 0, rut: 0 };
    const obs = TRAILS.find((t) => t.name === "observatory")!;
    for (let i = 0; i + 1 < obs.line.length; i += 6) {
      trailSample(obs.line[i]!, obs.line[i + 1]!, out);
      expect(out.wear, `at ${i}`).toBeGreaterThan(0.5);
      expect(out.wear).toBeLessThanOrEqual(1);
      expect(out.shoulder).toBeLessThanOrEqual(1);
    }
    trailSample(-60, 60, out);
    expect(out.wear).toBe(0);
    expect(out.rut).toBe(0);
    const a = trailSample(12.3, -4.4, { wear: 0, shoulder: 0, rut: 0 });
    const b = trailSample(12.3, -4.4, { wear: 0, shoulder: 0, rut: 0 });
    expect(a).toEqual(b);
    expect(Number.isFinite(edgeNoise(3, 4))).toBe(true);
  });

  it("the coast road has two continuous wheel ruts a cart-gauge apart", () => {
    const coast = TRAILS.find((t) => t.name === "coast")!;
    expect(coast.ruts).toBeDefined();
    const out = { wear: 0, shoulder: 0, rut: 0 };
    // walk across the road at a mid point: expect two rut peaks either side of the centreline
    const i = Math.floor(coast.line.length / 4) * 2;
    const x = coast.line[i]!;
    const z = coast.line[i + 1]!;
    const nx = coast.line[i + 3]! - coast.line[i + 1]!;
    const nz = -(coast.line[i + 2]! - coast.line[i]!);
    const nl = Math.hypot(nx, nz);
    let peaks = 0;
    let prev = 0;
    let rising = false;
    for (let d = -1.1; d <= 1.1; d += 0.02) {
      trailSample(x + (nx / nl) * d, z + (nz / nl) * d, out);
      if (out.rut > prev + 1e-6) rising = true;
      else if (out.rut < prev - 1e-6 && rising && prev > 0.5) {
        peaks++;
        rising = false;
      }
      prev = out.rut;
    }
    expect(peaks).toBeGreaterThanOrEqual(2);
  });

  it("wearing a path in never blocks it: nothing tall stands on a path or in the water, on any seed", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const o of w.obstacles) {
        const tag = classifyObstacle(o);
        if (!["tree", "rock", "snag", "stump", "log"].includes(tag)) continue;
        expect(waterEdgeDistance(o.x, o.z), `seed ${seed} ${tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)} is in the water`).toBeGreaterThan(0);
        expect(nearTrail(o.x, o.z, 0), `seed ${seed} ${tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)} is on a path`).toBe(false);
        expect(Math.hypot(o.x - HILL.x, o.z - HILL.z), `seed ${seed} ${tag} is on the Observatory's plateau`).toBeGreaterThan(12.5);
      }
    }
  });

  it("a walker follows the Observatory path from the camp to the plateau with the shared movement step", () => {
    const w = createArena(7);
    const t = TRAILS.find((q) => q.name === "observatory")!;
    const s = createCharState(3, 0, w);
    let target = 0;
    let steps = 0;
    for (; steps < 60 * 90; steps++) {
      // aim at the first path point at least 2 m ahead of us
      while (target < t.line.length / 2 - 1 && Math.hypot(t.line[target * 2]! - s.x, t.line[target * 2 + 1]! - s.z) < 2) target++;
      const dx = t.line[target * 2]! - s.x;
      const dz = t.line[target * 2 + 1]! - s.z;
      stepCharacter(s, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-dx, -dz)), buttons: 0 }, STEP_DT, w);
      if (Math.hypot(s.x - HILL.x, s.z - HILL.z) < HILL.plateau + 1) break;
    }
    expect(Math.hypot(s.x - HILL.x, s.z - HILL.z), "reached the hill").toBeLessThan(HILL.plateau + 1.5);
    expect(s.y).toBeGreaterThan(w.terrainHeight(HILL.x, HILL.z) - 1.5);
  });
});

describe("the Observatory and its hill", () => {
  it("the plateau is flat and level, and the hill is a real rise above the surroundings", () => {
    for (const seed of SEEDS) {
      const t = landscape(seed);
      const top = t.height(HILL.x, HILL.z);
      for (let a = 0; a < 6.3; a += 0.5) expect(Math.abs(t.height(HILL.x + Math.cos(a) * 8, HILL.z + Math.sin(a) * 8) - top), `seed ${seed}`).toBeLessThan(0.25);
      // well beyond the foot the ground is the base noise (small), so the plateau stands above it
      expect(top - t.height(HILL.x + HILL.base + 12, HILL.z), `seed ${seed}`).toBeGreaterThan(HILL.rise - 4);
    }
  });

  it("the ruin is one plan for collision and looks: columns on the plateau, a tower, and piers that march to the stream's source", () => {
    const w = createArena(7);
    const plan = ruinPlan(w.terrain);
    expect(plan.yaw).toBeCloseTo(RUIN_YAW, 8);
    expect(plan.columns.length).toBeGreaterThanOrEqual(8);
    expect(plan.columns.some((c) => c.broken)).toBe(true);
    expect(plan.columns.some((c) => !c.broken)).toBe(true);
    for (const c of plan.columns) expect(Math.hypot(c.x - HILL.x, c.z - HILL.z)).toBeLessThan(HILL.plateau);
    expect(plan.piers.length).toBeGreaterThanOrEqual(4);
    const last = plan.piers[plan.piers.length - 1]!;
    expect(Math.hypot(last.x - RIVER.a.x, last.z - RIVER.a.z)).toBeLessThan(6); // the last arch spills the stream
    for (let i = 1; i < plan.piers.length; i++) expect(plan.piers[i]!.top).toBeLessThan(plan.piers[i - 1]!.top + 1e-9);
    const obs = ruinObstacles(w.terrain);
    expect(obs.length).toBe(1 + plan.columns.length + plan.piers.length);
    for (const o of obs) {
      expect(o.tag).toBe("ruin");
      expect(Math.hypot(o.x, o.z)).toBeLessThan(ARENA_RADIUS);
      expect(o.y1).toBeGreaterThan(o.y0 + 1);
    }
    // every ruin obstacle is in the arena's world too, and identical on a second build
    expect(w.obstacles.filter((o) => o.tag === "ruin").length).toBe(obs.length);
    expect(ruinObstacles(createArena(7).terrain)).toEqual(obs);
  });

  it("felled timber is collidable and sized to its rule: stumps can be stepped onto, fallen logs must be jumped", () => {
    let stumps = 0;
    let logs = 0;
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const o of w.obstacles) {
        const g = w.terrainHeight(o.x, o.z);
        if (o.tag === "stump") {
          stumps++;
          expect(o.y1 - g).toBeLessThanOrEqual(CHARACTER.stepHeight);
          expect(o.kind).toBe("circle");
        } else if (o.tag === "log") {
          logs++;
          expect(o.y1 - g).toBeGreaterThan(CHARACTER.stepHeight);
          expect(o.kind).toBe("box");
        }
      }
    }
    expect(stumps).toBeGreaterThan(10);
    expect(logs).toBeGreaterThan(5);
  });
});

describe("ground dressing fields", () => {
  it("flower patches, reed beds and ground colour are finite, in range and deterministic", () => {
    const p = { density: 0, hue: 0 };
    const rgb: Rgb = { r: 0, g: 0, b: 0 };
    let dense = 0;
    let bare = 0;
    for (let x = -90; x <= 90; x += 3) {
      for (let z = -90; z <= 90; z += 3) {
        flowerPatch(x, z, p);
        expect(p.density).toBeGreaterThanOrEqual(0);
        expect(p.density).toBeLessThanOrEqual(1);
        expect([0, 1, 2, 3, 4]).toContain(p.hue);
        if (p.density > 0.5) dense++;
        else bare++;
        const r = reedDensity(x, z);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1.3);
        groundColour(x, z, 0, 0.1, rgb);
        for (const v of [rgb.r, rgb.g, rgb.b]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
    // meadows are patches: some dense, most bare
    expect(dense).toBeGreaterThan(20);
    expect(bare).toBeGreaterThan(dense * 2);
    // reeds crowd the bank, not the middle of the map
    expect(reedDensity(0, 0)).toBe(0);
    const c = { x: 0, z: 0 };
    riverCentre(RIVER.length * 0.4, c);
    let bank = 0;
    for (let d = 0; d < 6; d += 0.25) bank = Math.max(bank, reedDensity(c.x + d, c.z));
    expect(BANK).toBeGreaterThan(1);
    expect(bank).toBeGreaterThan(0.1);
  });

  it("the paved plateau reads as stone, the worn paths as earth, the meadow as green", () => {
    const stone: Rgb = { r: 0, g: 0, b: 0 };
    const earth: Rgb = { r: 0, g: 0, b: 0 };
    const green: Rgb = { r: 0, g: 0, b: 0 };
    groundColour(HILL.x + 2, HILL.z + 2, 10, 0, stone);
    groundColour(11.6, 0.2, 0, 0, earth); // on the Observatory path by the sign
    groundColour(-55, 45, 0, 0, green);
    expect(stone.r).toBeGreaterThan(stone.g * 0.95); // warm pale stone, not grass
    expect(earth.r).toBeGreaterThan(earth.g);
    expect(green.g).toBeGreaterThan(green.r);
  });
});
