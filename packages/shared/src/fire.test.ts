import { describe, expect, it } from "vitest";
import { FIRE, FireGrid, decodeBurning, decodeBurnt, fireRoll, type FireWeather } from "./fire.ts";
import { hash3 } from "./rng.ts";
import { createRegionWorld } from "./regions.ts";
import { highmarkRoadDistance, HIGHMARK } from "./highmark.ts";
import { windAt } from "./weather.ts";
import type { RegionId } from "./campaignTypes.ts";

/** D-103: fire that spreads. Fuel only where plants grow, a deterministic spread the wind drives and the rain chokes, each cell once, a bounded grid, a small wire codec. */

const STILL: FireWeather = { windX: 1, windZ: 0, wind: 0, rain: 0, wet: 0 };
const worlds = new Map<RegionId, ReturnType<typeof createRegionWorld>>();
const worldOf = (r: RegionId) => worlds.get(r) ?? (worlds.set(r, createRegionWorld(r, 7)), worlds.get(r)!);

/** A cell with plenty of fuel round it (deterministic search). */
function fuelledSpot(g: FireGrid, min = 0.5): number {
  let best = -1;
  let bestS = 0;
  for (let c = g.w * 3 + 3; c < g.cells - g.w * 3 - 3; c += 13) {
    if (g.fuelOf(c) < min) continue;
    let s = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) s += g.fuelOf(c + dj * g.w + di);
    if (s > bestS) {
      bestS = s;
      best = c;
    }
  }
  return best;
}

function burnOut(g: FireGrid, wx: FireWeather, maxSteps = 4000): number {
  let t = 0;
  while (g.burning > 0 && t < maxSteps) g.step(t++, wx);
  return t;
}

describe("D-103: fuel is where the plants are", () => {
  it("water, roads and solid obstacles do not burn; the open savannah does", () => {
    const world = worldOf("highmark");
    const g = new FireGrid(world, "highmark", 7);
    // the river
    expect(g.fuelOf(g.cellAt(0, HIGHMARK.river.z))).toBe(0);
    // every cell centred on the processional road
    let roadCells = 0;
    for (let c = 0; c < g.cells; c += 7) {
      if (highmarkRoadDistance(g.centreX(c), g.centreZ(c)) < HIGHMARK.roadHalf - 0.5) {
        roadCells++;
        expect(g.fuelOf(c), `road cell ${c}`).toBe(0);
      }
    }
    expect(roadCells).toBeGreaterThan(10);
    // inside a solid obstacle (a wall, a house, a rock)
    let solids = 0;
    for (const o of world.obstacles) {
      if (o.y1 - world.terrainHeight(o.x, o.z) < 1 || (o.kind === "circle" && o.r < FIRE.cell)) continue;
      if (++solids > 40) break;
      expect(g.fuelOf(g.cellAt(o.x, o.z)), `${o.tag} at ${o.x},${o.z}`).toBe(0);
    }
    expect(solids).toBeGreaterThan(5);
    // off the playable ground
    expect(g.fuelOf(g.cellAt(149.5, 149.5))).toBe(0);
    expect(fuelledSpot(g)).toBeGreaterThanOrEqual(0);
  });

  it("every region has something to burn, and the wet delta less than the dry grassland", () => {
    const share = (r: RegionId): number => {
      const g = new FireGrid(worldOf(r), r, 7);
      let s = 0;
      for (let c = 0; c < g.cells; c++) s += g.fuelOf(c);
      return s / g.cells;
    };
    const highmark = share("highmark");
    for (const r of ["hollowmere", "kessar", "highmark", "vesper", "saltmarket"] as RegionId[]) expect(share(r), r).toBeGreaterThan(0.02);
    expect(share("saltmarket")).toBeLessThan(highmark);
  });
});

describe("D-103: the spread", () => {
  it("is the same fire every time for the same seed and weather", () => {
    const run = (): string => {
      const g = new FireGrid(worldOf("highmark"), "highmark", 7);
      g.igniteCell(fuelledSpot(g));
      for (let t = 0; t < 160; t++) g.step(t, { windX: 0.6, windZ: 0.8, wind: 0.4, rain: 0, wet: 0 });
      return g.encodeBurning() + "|" + g.encodeBurnt();
    };
    expect(run()).toBe(run());
  });

  it("grows from one cell, then burns itself out, each cell once", () => {
    const g = new FireGrid(worldOf("highmark"), "highmark", 7);
    const c = fuelledSpot(g);
    expect(g.igniteCell(c)).toBe(true);
    expect(g.igniteCell(c)).toBe(false); // (already burning)
    let peak = 0;
    for (let t = 0; t < 4000 && g.burning > 0; t++) {
      g.step(t, STILL);
      peak = Math.max(peak, g.burning);
      expect(g.burning).toBeLessThanOrEqual(FIRE.maxBurning);
    }
    expect(g.burning).toBe(0);
    expect(g.burntCount).toBeGreaterThan(20);
    expect(peak).toBeGreaterThan(5);
    expect(g.isBurnt(c)).toBe(true);
    expect(g.igniteCell(c)).toBe(false); // (burnt ground does not catch again)
    expect(g.ignite(g.centreX(c), g.centreZ(c), 6)).toBe(0);
  });

  it("runs downwind: the same spark under opposite winds burns towards each wind", () => {
    const meanX = (windX: number): { x: number; n: number } => {
      const g = new FireGrid(worldOf("highmark"), "highmark", 7);
      const c = fuelledSpot(g);
      g.igniteCell(c);
      burnOut(g, { windX, windZ: 0, wind: 0.9, rain: 0, wet: 0 });
      let sx = 0;
      let n = 0;
      for (let k = 0; k < g.cells; k++) {
        if (!g.isBurnt(k)) continue;
        sx += g.centreX(k) - g.centreX(c);
        n++;
      }
      return { x: sx / Math.max(1, n), n };
    };
    const east = meanX(1);
    const west = meanX(-1);
    expect(east.n).toBeGreaterThan(10);
    expect(west.n).toBeGreaterThan(10);
    expect(east.x - west.x).toBeGreaterThan(4); // (metres: the burn leans the way the wind blows)
  });

  it("rain chokes it: a storm leaves a fraction of what a dry day burns", () => {
    const dry = new FireGrid(worldOf("highmark"), "highmark", 7);
    const wet = new FireGrid(worldOf("highmark"), "highmark", 7);
    const c = fuelledSpot(dry);
    dry.igniteCell(c);
    wet.igniteCell(c);
    burnOut(dry, { windX: 1, windZ: 0, wind: 0.3, rain: 0, wet: 0 });
    burnOut(wet, { windX: 1, windZ: 0, wind: 0.3, rain: 1, wet: 1 });
    expect(dry.burntCount).toBeGreaterThan(20);
    expect(wet.burntCount).toBeLessThan(dry.burntCount * 0.25);
  });

  it("a blast lights the fuel within its reach, and nothing without fuel", () => {
    const g = new FireGrid(worldOf("highmark"), "highmark", 7);
    const c = fuelledSpot(g);
    const lit = g.ignite(g.centreX(c), g.centreZ(c), 4);
    expect(lit).toBeGreaterThan(3);
    expect(g.burning).toBe(lit);
    const river = new FireGrid(worldOf("highmark"), "highmark", 7);
    expect(river.ignite(0, HIGHMARK.river.z, 3)).toBe(0);
  });

  it("douse puts a burning cell out for good", () => {
    const g = new FireGrid(worldOf("highmark"), "highmark", 7);
    const c = fuelledSpot(g);
    g.igniteCell(c);
    g.douse(c);
    expect(g.burning).toBe(0);
    expect(g.isBurnt(c)).toBe(true);
    expect(g.igniteCell(c)).toBe(false);
  });
});

describe("D-110: the nearest burning ground (horses shy from it)", () => {
  it("is the centre of the closest burning cell within the radius, nothing beyond it, nothing once it is out", () => {
    const g = new FireGrid(worldOf("highmark"), "highmark", 7);
    const c = fuelledSpot(g);
    const out = { x: 0, z: 0 };
    const x = g.centreX(c);
    const z = g.centreZ(c);
    expect(g.nearestBurning(x + 3, z, 7, out)).toBe(false);
    g.igniteCell(c);
    expect(g.nearestBurning(x + 3, z, 7, out)).toBe(true);
    expect(out).toEqual({ x, z });
    expect(g.nearestBurning(x + 8, z, 7, out)).toBe(false);
    // two fires: the nearer one
    const far = c + 4;
    g.igniteCell(far);
    expect(g.nearestBurning(g.centreX(far) + 1, g.centreZ(far), 30, out)).toBe(true);
    expect(out).toEqual({ x: g.centreX(far), z: g.centreZ(far) });
    g.douse(c);
    g.douse(far);
    expect(g.nearestBurning(x, z, 30, out)).toBe(false);
  });
});

describe("D-103: the wire", () => {
  it("round-trips the burning cells and the scorched ground", () => {
    const g = new FireGrid(worldOf("highmark"), "highmark", 7);
    g.igniteCell(fuelledSpot(g));
    for (let t = 0; t < 120; t++) g.step(t, { windX: 0, windZ: 1, wind: 0.5, rain: 0, wet: 0 });
    expect(g.burning).toBeGreaterThan(0);
    expect(g.burntCount).toBeGreaterThan(0);
    const burning = new Set<number>();
    decodeBurning(g.encodeBurning(), g.cells, (c) => burning.add(c));
    const want = new Set<number>();
    g.forEachBurning((c) => want.add(c));
    expect(burning).toEqual(want);
    const burnt = new Set<number>();
    decodeBurnt(g.encodeBurnt(), g.cells, (c) => burnt.add(c));
    expect(burnt.size).toBe(g.burntCount);
    for (const c of burnt) expect(g.isBurnt(c)).toBe(true);
    expect(g.encodeBurning().length).toBeLessThan(FIRE.maxBurning * 3);
  });

  it("garbage decodes to nothing harmful and never throws", () => {
    for (const s of ["", "!!!!", "€€", "_".repeat(50), "AAAA", null as unknown as string, 7 as unknown as string]) {
      const seen: number[] = [];
      expect(() => decodeBurning(s, 100, (c) => seen.push(c))).not.toThrow();
      expect(() => decodeBurnt(s, 100, (c) => seen.push(c))).not.toThrow();
      for (const c of seen) expect(c).toBeLessThan(100);
    }
  });
});

describe("D-103: the wind", () => {
  it("is a unit vector, the same for the same (seed, time), and veers between weather slots", () => {
    const a = windAt(7, 400_000);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(1, 6);
    expect(windAt(7, 400_000)).toEqual(a);
    const headings = new Set<number>();
    for (let s = 1; s < 12; s++) {
      const w = windAt(7, s * 150_000 + 100_000);
      headings.add(Math.round(Math.atan2(w.x, w.z) * 4));
    }
    expect(headings.size).toBeGreaterThan(3);
  });
});

describe("D-103: the step's rolls", () => {
  it("are hash3 in its top 30 bits, exactly (a small integer the engine never boxes; the fires burn as hash3 made them)", () => {
    for (let i = 0; i < 2000; i++) {
      const a = (i * 2654435761) | 0;
      const b = i * 7919;
      const c = i >> 2;
      const d = i % 13;
      expect(fireRoll(a, b, c, d)).toBe(hash3(a, b, c, d) >>> 2);
      expect(fireRoll(a, b, c, d)).toBeLessThan(2 ** 30);
    }
  });
});

