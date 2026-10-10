import { describe, expect, it } from "vitest";
import { HIVE_STAND, HOLLOWMERE_FIELDS, HOLLOWMERE_ORCHARD, RIVER, createArena, fieldCover, fieldThings, inCampFootprint, nearTrail, orchardCover, villageKeepOut, waterEdgeDistance, type CollisionWorld, type Obstacle } from "@cb/shared";
import { PRESETS } from "../Stage.ts";
import { BLOOM_HUES, HOLLOWMERE_LAND, planScatter, type Item, type ScatterPlan } from "./scatter.ts";

const detail = (name: "test" | "low" | "medium" | "high") => PRESETS[name];
const all = (p: ScatterPlan): [string, Item[]][] => [
  ...(Object.entries(p).filter(([k]) => k !== "butterflies" && k !== "fields") as [string, Item[]][]),
  ...(Object.entries(p.fields).map(([k, v]) => [`fields.${k}`, v]) as [string, Item[]][]),
];
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

  it("thinning the trees is visual only: the test preset draws a share of them, each on a real obstacle, and the arena's obstacles are the same objects and count", () => {
    const fresh = createArena(7);
    const before = JSON.stringify(fresh.obstacles);
    const n = fresh.obstacles.length;
    const thin = planScatter(fresh, detail("test"));
    const full = planScatter(fresh, { ...detail("test"), treeDensity: 1 });
    expect(fresh.obstacles.length).toBe(n);
    expect(JSON.stringify(fresh.obstacles)).toBe(before); // planning never touches the shared obstacles (collision stays identical to the server's)
    const trees = (p: ScatterPlan): number => p.broadleaf.length + p.acacia.length + p.birch.length + p.pine.length + p.snag.length;
    expect(trees(full)).toBeGreaterThan(100);
    expect(trees(thin)).toBeLessThan(trees(full) * 0.6);
    expect(trees(thin)).toBeGreaterThan(trees(full) * 0.25);
    const key = (t: Item): string => `${t.x}|${t.z}`;
    const fullAt = new Set([...full.broadleaf, ...full.acacia, ...full.birch, ...full.pine, ...full.snag].map(key));
    for (const t of [...thin.broadleaf, ...thin.acacia, ...thin.birch, ...thin.pine, ...thin.snag]) expect(fullAt.has(key(t)), key(t)).toBe(true); // thinning only ever removes: nothing new, nothing moved
    // density 1 is exactly the old behaviour: every preset that leaves it out gets the whole forest
    expect(planScatter(fresh, detail("low"))).toEqual(planScatter(fresh, { ...detail("low"), treeDensity: undefined }));
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

  it("the village is left to its builders: no tree, rock, bush, flower, fern or reed grows inside its keep-out", () => {
    for (const k of ["broadleaf", "acacia", "birch", "pine", "snag", "rocks", "slabs", "bushes", "berries", "stumps", "logs", "daisies", "cups", "ferns", "mushrooms", "pebbles", "grass"] as const) {
      for (const it of plan[k] as Item[]) expect(villageKeepOut(it.x, it.z, 0), `${k} inside the village at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBe(false);
    }
  });

  it("crags: a handful of cliff faces on the hill flank, the rim and elsewhere, each planted on the ground, clear of the camp and the village, the same on every run", () => {
    expect(plan.cliffs.length).toBeGreaterThanOrEqual(6);
    for (const c of plan.cliffs) {
      for (const v of [c.x, c.y, c.z, c.yaw, c.sx, c.sy, c.sz]) expect(Number.isFinite(v)).toBe(true);
      expect(c.sy).toBeGreaterThan(1);
      expect(inCampFootprint(c.x, c.z, 0)).toBe(false);
      expect(villageKeepOut(c.x, c.z, 0), `cliff in the village at ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBe(false);
      expect(c.y).toBeLessThan(world.terrainHeight(c.x, c.z) + 1.2); // its foot is at, or sunk into, the ground it stands on
    }
    for (const seed of [1, 7, 42]) {
      const a = planScatter(createArena(seed), detail("medium")).cliffs;
      expect(a.length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      expect(planScatter(createArena(seed), detail("medium")).cliffs).toEqual(a);
    }
    // a cliff is a hard obstacle in the shared world: what the client draws, the server collides with
    const obstacles = world.obstacles.filter((o) => o.tag === "cliff");
    expect(obstacles.length).toBe(plan.cliffs.length);
  });
});

describe("D-117: Hollowmere's worked land", () => {
  const world = createArena(7);
  const plan = planScatter(world, detail("medium"), undefined, HOLLOWMERE_LAND);
  const bare = planScatter(world, detail("medium"));
  const inField = (x: number, z: number): boolean => fieldCover(HOLLOWMERE_FIELDS, x, z) >= 0.999;
  const worked = (x: number, z: number): boolean => fieldCover(HOLLOWMERE_FIELDS, x, z) > 0 || orchardCover(HOLLOWMERE_ORCHARD, x, z) > 0;

  it("is planted: barley in its rows, the stooks, haycocks and scarecrows where the world has them, ridges and drills, the orchard's trees, its hives and windfalls", () => {
    const f = plan.fields;
    expect(f.barley.length).toBeGreaterThan(300);
    const things = HOLLOWMERE_FIELDS.flatMap(fieldThings);
    expect(f.stooks).toHaveLength(things.filter((t) => t.kind === "stook").length);
    expect(f.haycocks).toHaveLength(things.filter((t) => t.kind === "haycock").length);
    expect(f.scarecrows).toHaveLength(things.filter((t) => t.kind === "scarecrow").length);
    expect(f.furrows.length).toBeGreaterThan(50);
    expect(f.drills.length).toBeGreaterThan(100);
    // the orchard is drawn from the world's own obstacles: a tree on every fruit tree, the stand on the hive stand with its skeps
    const trees = world.obstacles.filter((o) => o.tag === "orchard");
    expect(plan.orchard).toHaveLength(trees.length);
    for (const t of plan.orchard) expect(trees.some((o) => o.x === t.x && o.z === t.z)).toBe(true);
    expect(plan.hives).toHaveLength(1);
    expect(plan.hives[0]!.cls).toBe(HOLLOWMERE_ORCHARD.hives);
    expect(plan.windfalls.length).toBeGreaterThan(30);
    for (const [name, list] of all(plan)) {
      if (!name.startsWith("fields.") && !["orchard", "hives", "windfalls"].includes(name)) continue;
      for (const it of list) {
        for (const v of [it.x, it.y, it.z, it.yaw, it.sx, it.sy, it.sz]) expect(Number.isFinite(v), name).toBe(true);
        expect(Math.abs(it.y - world.terrainHeight(it.x, it.z)), `${name} at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBeLessThan(0.3);
      }
    }
    // a barley clump or a windfall stands in nothing solid, on no path and in no water
    for (const it of [...f.barley, ...plan.windfalls]) {
      world.forEachNear(it.x, it.z, (o) => expect(inside(o, it.x, it.z, 0), `inside a ${o.tag} at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBe(false));
      expect(nearTrail(it.x, it.z, 0)).toBe(false);
      expect(waterEdgeDistance(it.x, it.z)).toBeGreaterThan(0);
    }
  });

  it("nothing wild grows on it: no grass or flower in a field, no shrub, fern or toadstool ring anywhere in the worked land", () => {
    for (const k of ["grass", "daisies", "cups"] as const) for (const it of plan[k]) expect(inField(it.x, it.z), `${k} in a field at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBe(false);
    for (const k of ["bushes", "berries", "ferns"] as const) for (const it of plan[k]) expect(worked(it.x, it.z), `${k} in the worked land at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBe(false);
    // and the hive stand is solid where it is drawn
    const st = plan.hives[0]!;
    const box = world.obstacles.find((o) => o.tag === "hive")!;
    expect(box.kind === "box" && Math.abs(box.hz * 2 - st.cls * HIVE_STAND.pitch) < 1e-9).toBe(true);
  });

  it("is Hollowmere's alone: without it (Kessar borrows this scatter) nothing is planted and the grass grows where the fields would be", () => {
    expect(all(bare).filter(([k]) => k.startsWith("fields.") || ["orchard", "hives", "windfalls"].includes(k)).every(([, l]) => l.length === 0)).toBe(true);
    expect(bare.grass.filter((g) => inField(g.x, g.z)).length).toBeGreaterThan(50);
  });
});

describe("the front door's figure", () => {
  it("stands on trodden ground: no grass or flower within the stand (MENU_STAND agrees with CreatorPreview's BACKDROP)", async () => {
    const { BACKDROP } = await import("../CreatorPreview.ts");
    const { MENU_STAND, planScatter } = await import("./scatter.ts");
    expect([MENU_STAND.x, MENU_STAND.z]).toEqual([BACKDROP.x, BACKDROP.z]);
    const { createArena } = await import("@cb/shared");
    const plan = planScatter(createArena(7), { grassTufts: 5000, flowers: 900, bushes: 130, clutter: 1 });
    for (const it of [...plan.grass, ...plan.daisies, ...plan.cups]) expect(Math.hypot(it.x - MENU_STAND.x, it.z - MENU_STAND.z)).toBeGreaterThanOrEqual(MENU_STAND.r);
  });
});
