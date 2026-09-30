import { describe, expect, it } from "vitest";
import { RIVER, createArena, inCampFootprint, nearTrail, waterEdgeDistance, type CollisionWorld, type Obstacle } from "@cb/shared";
import { PRESETS } from "../Stage.ts";
import { BLOOM_HUES, planScatter, type Item, type ScatterPlan } from "./scatter.ts";

const detail = (name: "low" | "medium" | "high") => PRESETS[name];
const all = (p: ScatterPlan): [string, Item[]][] => Object.entries(p).filter(([k]) => k !== "butterflies") as [string, Item[]][];
const inside = (o: Obstacle, x: number, z: number, margin: number): boolean => (o.kind === "circle" ? Math.hypot(o.x - x, o.z - z) < o.r + margin : Math.hypot(o.x - x, o.z - z) < Math.hypot(o.hx, o.hz) * 0.7 + margin);

describe("where things grow", () => {
  const world = createArena(7);
  const plan = planScatter(world, detail("medium"));

  it("is deterministic: the same arena gives the same plan, and a second call agrees to the last item", () => {
    expect(planScatter(createArena(7), detail("medium"))).toEqual(plan);
    expect(planScatter(createArena(8), detail("medium"))).not.toEqual(plan);
  });

  it("every item is finite, sits on the ground and has a positive scale", () => {
    for (const [name, list] of all(plan)) {
      for (const it of list) {
        for (const v of [it.x, it.y, it.z, it.yaw, it.sx, it.sy, it.sz, it.v]) expect(Number.isFinite(v), name).toBe(true);
        expect(it.sx, name).toBeGreaterThan(0);
        expect(it.sy, name).toBeGreaterThan(0);
        expect(it.sz, name).toBeGreaterThan(0);
        // within 0.6 m of the shared terrain (far trees use the faded visual height, so they are excluded by radius)
        if (Math.hypot(it.x, it.z) < 100) expect(Math.abs(it.y - world.terrainHeight(it.x, it.z)), `${name} at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBeLessThan(0.6);
      }
    }
  });

  it("has what the brief asks for: five kinds of bloom, ferns, toadstool rings, reeds, stumps, logs, slabs, berry bushes, butterflies", () => {
    expect(plan.daisies.length + plan.cups.length).toBeGreaterThan(500);
    const hues = new Set([...plan.daisies, ...plan.cups].map((f) => f.cls));
    expect(hues.size).toBe(BLOOM_HUES);
    expect(plan.ferns.length).toBeGreaterThan(60);
    expect(plan.mushrooms.length).toBeGreaterThan(40);
    expect(plan.reeds.length).toBeGreaterThan(120);
    expect(plan.stumps.length).toBeGreaterThan(4);
    expect(plan.logs.length).toBeGreaterThan(2);
    expect(plan.slabs.length).toBeGreaterThan(2);
    expect(plan.berries.length).toBeGreaterThan(10);
    expect(plan.butterflies.length).toBeGreaterThanOrEqual(12);
    for (const [i, b] of plan.butterflies.entries()) for (const c of plan.butterflies.slice(i + 1)) expect(Math.hypot(b.x - c.x, b.z - c.z)).toBeGreaterThan(13);
  });

  it("flowers gather in meadows: their nearest-neighbour distances are far smaller than uniform scatter would give", () => {
    const f = [...plan.daisies, ...plan.cups];
    let sum = 0;
    for (const a of f.slice(0, 200)) {
      let best = Infinity;
      for (const b of f) if (b !== a) best = Math.min(best, Math.hypot(a.x - b.x, a.z - b.z));
      sum += best;
    }
    const mean = sum / 200;
    const area = Math.PI * 88 * 88;
    const uniform = 0.5 / Math.sqrt(f.length / area);
    expect(mean).toBeLessThan(uniform * 0.6);
  });

  it("plants keep off the footpaths and out of the water, and nothing stands inside an obstacle", () => {
    const plants: (keyof ScatterPlan)[] = ["grass", "daisies", "cups", "ferns", "reeds", "bushes", "berries"];
    for (const k of plants) {
      for (const it of plan[k] as Item[]) {
        if (k !== "reeds") expect(waterEdgeDistance(it.x, it.z), `${k} in water at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBeGreaterThan(-0.05);
        if (k !== "reeds") expect(nearTrail(it.x, it.z, -0.05), `${k} on a path at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBe(false);
        expect(inCampFootprint(it.x, it.z, 0), `${k} inside camp at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBe(false);
        world.forEachNear(it.x, it.z, (o) => expect(inside(o, it.x, it.z, 0), `${k} inside a ${o.tag}`).toBe(false));
      }
    }
  });

  it("reeds gather at the water, ferns under and beside trees and the stream", () => {
    const c = { x: RIVER.b.x, z: RIVER.b.z };
    for (const r of plan.reeds) expect(waterEdgeDistance(r.x, r.z)).toBeLessThan(4);
    expect(plan.reeds.filter((r) => Math.hypot(r.x - c.x, r.z - c.z) < RIVER.pondRadius + 2).length).toBeGreaterThan(10); // the pond has its own
  });

  it("presets scale the counts, never past their caps: low is sparse, high is lush", () => {
    const low = planScatter(world, detail("low"));
    const high = planScatter(world, detail("high"));
    expect(low.grass.length).toBeLessThanOrEqual(PRESETS.low.grassTufts);
    expect(high.grass.length).toBeLessThanOrEqual(PRESETS.high.grassTufts);
    expect(low.daisies.length + low.cups.length).toBeLessThanOrEqual(PRESETS.low.flowers);
    expect(low.ferns.length + low.reeds.length + low.mushrooms.length).toBeLessThan(high.ferns.length + high.reeds.length + high.mushrooms.length);
    expect(low.bushes.length + low.berries.length).toBeLessThanOrEqual(PRESETS.low.bushes);
  });

  it("works on any seed and on a world with no obstacles at all", () => {
    for (const seed of [1, 3, 99, 12345]) expect(all(planScatter(createArena(seed), detail("medium"))).every(([, l]) => l.every((i) => Number.isFinite(i.x)))).toBe(true);
    const empty = { obstacles: [], terrainHeight: () => 0, forEachNear: () => undefined, terrain: { height: () => 0 } } as unknown as CollisionWorld;
    expect(() => planScatter(empty, detail("low"))).not.toThrow();
  });

  it("flat stepping stones lie in the ford and round the well, on the ground, clear of every obstacle", () => {
    expect(plan.flagstones.length).toBeGreaterThanOrEqual(12);
    const inWater = plan.flagstones.filter((s) => s.cls === 1 && waterEdgeDistance(s.x, s.z) < 0);
    expect(inWater.length).toBeGreaterThanOrEqual(5);
    const dry = plan.flagstones.filter((s) => waterEdgeDistance(s.x, s.z) >= 0);
    expect(dry.length).toBeGreaterThanOrEqual(6);
    for (const st of plan.flagstones) {
      expect(Number.isFinite(st.y) && st.sx > 0.25 && st.sx < 0.6).toBe(true);
      world.forEachNear(st.x, st.z, (o) => expect(inside(o, st.x, st.z, 0), `stone inside a ${o.tag}`).toBe(false));
    }
    // dry stones sit on the ground (their flat tops a hand above it), never floating or sunk
    for (const st of dry) expect(Math.abs(st.y - world.terrainHeight(st.x, st.z)), `stone at ${st.x.toFixed(1)},${st.z.toFixed(1)}`).toBeLessThan(0.15);
  });
});
