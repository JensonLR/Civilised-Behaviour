import { describe, expect, it } from "vitest";
import { CROP_FUEL, FIELD_EDGE, FIELD_THING, HIVE_STAND, ORCHARD_TREE, fieldCover, fieldFuel, fieldThings, orchardPlan, plotAt, plotMask, type FieldPlot } from "./fields.ts";
import { HOLLOWMERE_FIELDS, HOLLOWMERE_ORCHARD } from "./hollowmereFields.ts";
import { ARENA_RADIUS, createArena } from "./arena.ts";
import { FLOCKS } from "./fauna.ts";
import { nearTrail, waterEdgeDistance } from "./landscape.ts";
import { villageKeepOut } from "./village.ts";
import { groundColour } from "./worldgen.ts";
import { regionCover } from "./groundCover.ts";
import { HIGHMARK, HIGHMARK_FIELDS, HIGHMARK_SITES, createHighmarkWorld, herdPlan, highmarkRoadDistance, highmarkSitePoints } from "./highmark.ts";
import { FireGrid } from "./fire.ts";
import { OUTPOST_SITES } from "./outpost.ts";

/** D-116: the Grange's fields, one list that the paint, the planting, the things in them, the grass and the fire all read. */
const plot = (crop: FieldPlot["crop"], x0 = 0, x1 = 20, z0 = 0, z1 = 30): FieldPlot => ({ id: crop, x0, x1, z0, z1, row: 1, crop });

describe("D-116: a field", () => {
  it("is 1 inside, eases out over the edge, and the strongest plot is the one at a point", () => {
    const p = plot("barley");
    expect(plotMask(p, 10, 15)).toBe(1);
    expect(plotMask(p, -FIELD_EDGE / 2, 15)).toBeGreaterThan(0);
    expect(plotMask(p, -FIELD_EDGE / 2, 15)).toBeLessThan(1);
    expect(plotMask(p, -FIELD_EDGE - 0.1, 15)).toBe(0);
    const out = { m: 0 };
    expect(plotAt([plot("hay", -40, -21), p], 10, 15, out)).toBe(1);
    expect(out.m).toBe(1);
    expect(plotAt([p], 60, 60, out)).toBe(-1);
  });

  it("burns as its crop does: the ripe, the stubble and the hay go up, the green barely, the ploughed not at all", () => {
    expect(fieldFuel([plot("barley")], 5, 5)).toBe(1);
    expect(fieldFuel([plot("hay")], 5, 5)).toBe(1);
    expect(fieldFuel([plot("green")], 5, 5)).toBeCloseTo(CROP_FUEL.green, 6);
    expect(fieldFuel([plot("fallow")], 5, 5)).toBe(0);
    expect(fieldCover([plot("fallow")], 5, 5)).toBe(1); // (and no wild grass grows on it either)
  });

  it("has its things inside it: stooks in rows on the stubble, haycocks on the hay, one scarecrow in a standing crop, none on the plough", () => {
    for (const crop of ["stubble", "hay", "barley", "green", "fallow"] as const) {
      const p = plot(crop, 0, 22, 0, 26);
      const things = fieldThings(p);
      for (const t of things) {
        expect(t.x - t.r, crop).toBeGreaterThanOrEqual(p.x0);
        expect(t.x + t.r, crop).toBeLessThanOrEqual(p.x1);
        expect(t.z - t.r, crop).toBeGreaterThanOrEqual(p.z0);
        expect(t.z + t.r, crop).toBeLessThanOrEqual(p.z1);
      }
      if (crop === "stubble") expect(things.filter((t) => t.kind === "stook").length).toBeGreaterThan(12);
      if (crop === "hay") expect(things.filter((t) => t.kind === "haycock").length).toBeGreaterThanOrEqual(4);
      if (crop === "barley" || crop === "green") expect(things.map((t) => t.kind)).toEqual(["scarecrow"]);
      if (crop === "fallow") expect(things).toHaveLength(0);
      // (no two things stand in each other)
      for (const a of things) for (const b of things) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.r + b.r);
      expect(fieldThings(p)).toEqual(things);
    }
  });
});

describe("D-116: the Grange's fields at Highmark", () => {
  it("the strike's barley is the first, where the rules count it; no two plots overlap", () => {
    expect(HIGHMARK_FIELDS[0]).toMatchObject({ ...HIGHMARK_SITES.strike.field, crop: "barley" });
    for (const a of HIGHMARK_FIELDS)
      for (const b of HIGHMARK_FIELDS) if (a !== b) expect(a.x1 + 2 < b.x0 || b.x1 + 2 < a.x0 || a.z1 + 2 < b.z0 || b.z1 + 2 < a.z0, `${a.id} / ${b.id}`).toBe(true);
  });

  it("keep off the road, the story points, the herds' middles and the outpost's ground", () => {
    const sites = highmarkSitePoints();
    const herds = herdPlan(7).herds;
    const post = OUTPOST_SITES.highmark!.site;
    for (const f of HIGHMARK_FIELDS.slice(1)) {
      for (let x = f.x0; x <= f.x1; x += 1) {
        for (let z = f.z0; z <= f.z1; z += 1) {
          expect(highmarkRoadDistance(x, z), `${f.id} ${x},${z} road`).toBeGreaterThan(HIGHMARK.roadHalf + 3);
          for (const h of herds) expect(Math.hypot(h.cx - x, h.cz - z), `${f.id} herd`).toBeGreaterThan(h.r * 0.5);
          expect(Math.hypot(post.x - x, post.z - z), `${f.id} outpost`).toBeGreaterThan(24);
        }
      }
      for (const s of sites) expect(fieldCover([f], s.x, s.z), `${f.id} ${s.id}`).toBe(0);
    }
  });

  it("the things in them are solid in the world, and the fire can take a haycock", () => {
    const world = createHighmarkWorld(7);
    const things = HIGHMARK_FIELDS.flatMap(fieldThings);
    expect(world.obstacles.filter((o) => o.tag === "hay")).toHaveLength(things.filter((t) => t.kind !== "scarecrow").length);
    expect(world.obstacles.filter((o) => o.tag === "scarecrow")).toHaveLength(things.filter((t) => t.kind === "scarecrow").length);
    const pos = { x: 0, z: 0 };
    for (const t of things) {
      pos.x = t.x + t.r * 0.5;
      pos.z = t.z;
      expect(world.resolveXZ(pos, world.terrainHeight(t.x, t.z), 0.3, 1), `${t.kind} at ${t.x.toFixed(1)},${t.z.toFixed(1)} blocks`).toBe(true);
    }
    const fire = new FireGrid(world, "highmark", 7);
    const cock = things.find((t) => t.kind === "haycock")!;
    expect(fire.fuelOf(fire.cellAt(cock.x, cock.z)), "a haycock is fuel, not a wall").toBeGreaterThan(0.4);
    const fallow = HIGHMARK_FIELDS.find((f) => f.crop === "fallow")!;
    expect(fire.fuelOf(fire.cellAt((fallow.x0 + fallow.x1) / 2, (fallow.z0 + fallow.z1) / 2)), "the plough is a firebreak").toBe(0);
    expect(FIELD_THING.haycock.height).toBeGreaterThan(FIELD_THING.stook.height);
  });
});

describe("D-117: Hollowmere's worked land", () => {
  const rects = [...HOLLOWMERE_FIELDS, HOLLOWMERE_ORCHARD];
  const world = createArena(7);

  it("lies on open, gentle ground: off every path, out of the water and the village, inside the arena, apart, and clear of the grazing flocks", () => {
    for (const a of rects)
      for (const b of rects) if (a !== b) expect(a.x1 + 2 <= b.x0 || b.x1 + 2 <= a.x0 || a.z1 + 2 <= b.z0 || b.z1 + 2 <= a.z0, `${a.id} / ${b.id}`).toBe(true);
    const grazing = FLOCKS.filter((f) => !f.inPen && !f.water && !f.cat);
    for (const f of rects) {
      for (let x = f.x0; x <= f.x1; x += 1) {
        for (let z = f.z0; z <= f.z1; z += 1) {
          expect(nearTrail(x, z, 0.5), `${f.id} ${x},${z} path`).toBe(false);
          expect(waterEdgeDistance(x, z), `${f.id} ${x},${z} water`).toBeGreaterThan(2);
          expect(villageKeepOut(x, z, 1), `${f.id} ${x},${z} village`).toBe(false);
          expect(Math.hypot(x, z), `${f.id} ${x},${z} edge`).toBeLessThan(ARENA_RADIUS - 4);
          const h = world.terrainHeight(x, z);
          expect(Math.hypot(world.terrainHeight(x + 0.5, z) - h, world.terrainHeight(x, z + 0.5) - h) / 0.5, `${f.id} ${x},${z} slope`).toBeLessThan(0.25);
          for (const g of grazing) expect(Math.hypot(g.home.x - x, g.home.z - z), `${f.id} ${g.kind}`).toBeGreaterThan(g.radius);
        }
      }
    }
  });

  it("the orchard: trees in their rows inside it, no crown in another's trunk, a stump or two, and the hive stand in a gap of its own", () => {
    const o = orchardPlan(HOLLOWMERE_ORCHARD);
    expect(orchardPlan(HOLLOWMERE_ORCHARD)).toEqual(o);
    expect(o.trees.length).toBeGreaterThanOrEqual(14);
    expect(o.stand.n).toBe(HOLLOWMERE_ORCHARD.hives);
    for (const t of o.trees) {
      expect(t.x - ORCHARD_TREE.crown * t.s * 0.5).toBeGreaterThan(HOLLOWMERE_ORCHARD.x0);
      expect(t.x).toBeLessThan(HOLLOWMERE_ORCHARD.x1);
      expect(t.z).toBeGreaterThan(HOLLOWMERE_ORCHARD.z0);
      expect(t.z).toBeLessThan(HOLLOWMERE_ORCHARD.z1);
      expect(t.s * 2.1, "a crown starts above a person's head").toBeGreaterThan(1.85);
      for (const u of o.trees) if (u !== t) expect(Math.hypot(u.x - t.x, u.z - t.z)).toBeGreaterThan(ORCHARD_TREE.crown * t.s + ORCHARD_TREE.r * u.s);
      for (const st of o.stumps) expect(Math.hypot(st.x - t.x, st.z - t.z)).toBeGreaterThan(3);
      expect(Math.hypot(o.stand.x - t.x, o.stand.z - t.z) - (o.stand.n * HIVE_STAND.pitch) / 2, "the stand's end is clear of a trunk").toBeGreaterThan(2);
    }
  });

  it("the world holds what is drawn: the fields' things, the fruit trees and the hive stand, and no tree, rock or crag of the seeded dressing stands in them, on any seed", () => {
    const things = HOLLOWMERE_FIELDS.flatMap(fieldThings);
    const o = orchardPlan(HOLLOWMERE_ORCHARD);
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const w = createArena(seed);
      expect(w.obstacles.filter((q) => q.tag === "hay"), `${seed}`).toHaveLength(things.filter((t) => t.kind !== "scarecrow").length);
      expect(w.obstacles.filter((q) => q.tag === "scarecrow")).toHaveLength(things.filter((t) => t.kind === "scarecrow").length);
      expect(w.obstacles.filter((q) => q.tag === "orchard")).toHaveLength(o.trees.length);
      expect(w.obstacles.filter((q) => q.tag === "hive")).toHaveLength(1);
      for (const q of w.obstacles) {
        if (!["tree", "rock", "snag", "log", "cliff"].includes(q.tag ?? "")) continue;
        const r = q.kind === "circle" ? q.r : Math.hypot(q.hx, q.hz);
        for (const f of rects) {
          const gap = Math.hypot(Math.max(f.x0 - q.x, 0, q.x - f.x1), Math.max(f.z0 - q.z, 0, q.z - f.z1));
          expect(gap, `${seed}: ${q.tag} at ${q.x.toFixed(1)},${q.z.toFixed(1)} in ${f.id}`).toBeGreaterThan(r);
        }
      }
    }
    // solid where they are drawn
    const pos = { x: 0, z: 0 };
    for (const t of [...things, ...o.trees.map((u) => ({ ...u, kind: "orchard", r: ORCHARD_TREE.r * u.s }))]) {
      pos.x = t.x + t.r * 0.5;
      pos.z = t.z;
      expect(world.resolveXZ(pos, world.terrainHeight(t.x, t.z), 0.3, 1), `${t.kind} at ${t.x.toFixed(1)},${t.z.toFixed(1)} blocks`).toBe(true);
    }
  });

  it("burns as Highmark's do, and is painted as worked ground", () => {
    const fire = new FireGrid(world, "hollowmere", 7);
    const mid = (id: string): { x: number; z: number } => {
      const f = HOLLOWMERE_FIELDS.find((p) => p.id === id)!;
      return { x: (f.x0 + f.x1) / 2 + 0.3, z: (f.z0 + f.z1) / 2 + 0.3 };
    };
    const cock = HOLLOWMERE_FIELDS.flatMap(fieldThings).find((t) => t.kind === "haycock")!;
    expect(fire.fuelOf(fire.cellAt(cock.x, cock.z)), "a haycock is fuel").toBeGreaterThan(0.4);
    const fallow = mid("fallow.west");
    expect(fire.fuelOf(fire.cellAt(fallow.x, fallow.z)), "the plough is a firebreak").toBe(0);
    expect(regionCover("hollowmere", world, fallow.x, fallow.z), "no meadow grass to burn on the plough").toBe(0);
    const barley = mid("barley.mill");
    expect(fire.fuelOf(fire.cellAt(barley.x, barley.z))).toBeGreaterThan(0.5);
    // the plough is earth, the stubble straw: both well away from the meadow's green
    const c = { r: 0, g: 0, b: 0 };
    const greenness = (x: number, z: number): number => {
      groundColour(x, z, world.terrainHeight(x, z), 0, c);
      return c.g - (c.r + c.b) / 2;
    };
    const meadow = greenness(10, 60);
    expect(greenness(fallow.x, fallow.z)).toBeLessThan(meadow - 0.05);
    const stub = mid("stubble.far");
    expect(greenness(stub.x, stub.z)).toBeLessThan(meadow - 0.03);
  });
});
