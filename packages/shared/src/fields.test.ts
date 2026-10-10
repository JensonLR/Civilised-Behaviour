import { describe, expect, it } from "vitest";
import { CROP_FUEL, FIELD_EDGE, FIELD_THING, fieldCover, fieldFuel, fieldThings, plotAt, plotMask, type FieldPlot } from "./fields.ts";
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
