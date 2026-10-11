import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS as A } from "./campaignTypes.ts";
import type { Obstacle } from "./collision.ts";
import { fieldThings } from "./fields.ts";
import { regionCover, regionFieldFuel } from "./groundCover.ts";
import { KESSAR, createKessarTerrain, createKessarWorld, kessarLevel, kessarRoad, kessarSitePoints } from "./kessar.ts";
import { LAMPSIDE, LAMPSIDE_GARDENS, LAMPSIDE_SIGNS, inLampside, lampsideObstacles, lampsidePad, lampsidePlan } from "./lampside.ts";
import { padSpread } from "./levelPlan.ts";
import { RUN_BAR } from "./scenarios/crossing.ts";

/** D-119: Lampside, the Ward's lower town between Kessar's toll bar and the fort's gate: one plan the terrain, the colliders, the level, the paint, the scatter and the fire read. */
const SEEDS = [1, 7, 42, 1337, 90210, 3, 500];
const plan = lampsidePlan();
const terrain = createKessarTerrain(7);
const town = lampsideObstacles(terrain);

/** Distance from (x, z) to an obstacle's footprint (0 inside it). */
function gap(o: Obstacle, x: number, z: number): number {
  if (o.kind === "circle") return Math.max(0, Math.hypot(x - o.x, z - o.z) - o.r);
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const lx = (x - o.x) * c + (z - o.z) * s;
  const lz = -(x - o.x) * s + (z - o.z) * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - o.hx), Math.max(0, Math.abs(lz) - o.hz));
}

/** Points round a footprint's edge (and its middle). */
function edge(o: Obstacle): [number, number][] {
  const out: [number, number][] = [[o.x, o.z]];
  if (o.kind === "circle") {
    for (let i = 0; i < 16; i++) out.push([o.x + Math.cos((i / 16) * Math.PI * 2) * o.r, o.z + Math.sin((i / 16) * Math.PI * 2) * o.r]);
    return out;
  }
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  for (let i = 0; i <= 8; i++) for (const [u, v] of [[-1 + i / 4, -1], [-1 + i / 4, 1], [-1, -1 + i / 4], [1, -1 + i / 4]] as const) {
    const lx = u * o.hx, lz = v * o.hz;
    out.push([o.x + lx * c - lz * s, o.z + lx * s + lz * c]);
  }
  return out;
}

describe("D-119: Lampside's plan", () => {
  it("is five houses with sealed doors facing the street, each a notice of its own, and nine lamps (a door's each, a stall's each, a post each side of the street)", () => {
    expect(plan.houses).toHaveLength(5);
    const sealed = kessarLevel().buildings.filter((b) => b.id.startsWith("lampside."));
    expect(sealed.map((b) => b.kind)).toEqual(["sealed", "sealed", "sealed", "sealed", "sealed"]);
    expect(new Set(sealed.map((b) => b.sign)).size).toBe(5);
    for (const b of sealed) {
      expect(LAMPSIDE_SIGNS as readonly string[]).toContain(b.sign);
      expect(b.sign!.length).toBeLessThanOrEqual(36);
      // the door looks at the street: its face is the one nearer the road's line (x = 0)
      const front = b.x + Math.cos(b.yaw) * b.hx;
      expect(Math.abs(front), b.id).toBeLessThan(Math.abs(b.x));
      expect(Math.abs(front), b.id).toBeGreaterThan(5);
    }
    expect(plan.houses.length + plan.stalls.length + plan.posts.length).toBe(9);
  });

  it("keeps the road, the customs yard, every sentry's post, the parley, the run past the bar and the fort's gate open", () => {
    for (const o of town) {
      for (const [x, z] of edge(o)) expect(kessarRoad(x, z), `${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBeLessThan(0.02);
      expect(o.z, o.tag).toBeLessThan(-2); // (north of the customs yard)
      for (const p of [A.tollBar, A.wardenPost, A.rivalParley, A.fort.gate, ...A.sentries]) expect(gap(o, p.x, p.z), `${o.tag} by ${p.x},${p.z}`).toBeGreaterThan(3);
      for (const p of kessarSitePoints()) expect(gap(o, p.x, p.z), `${o.tag} by ${p.id}`).toBeGreaterThan(5);
      // the gate's apron (6 x 4 in front of it, LEVEL_PLAN) stays open ground
      expect(gap(o, 0, -30) > 3 || Math.abs(o.x) > 3.5, o.tag).toBe(true);
    }
    // the street runs from the bar to the gate through the run's ground: a body walks it on the road's line, nothing in the way, on every seed
    for (const seed of SEEDS) {
      const w = createKessarWorld(seed);
      for (let z = 6; z >= -30; z -= 0.5) {
        const pos = { x: 0, z };
        expect(w.resolveXZ(pos, w.terrainHeight(0, z), 0.4, 1.7), `seed ${seed} z ${z}`).toBe(false);
      }
    }
    expect(Math.hypot(0 - RUN_BAR.x, -16 - RUN_BAR.z)).toBeLessThan(RUN_BAR.r);
  });

  it("stands on levelled ground: every house's footprint is flat at the bank's level on every seed, and the hill still rises behind it", () => {
    for (const seed of SEEDS) {
      const t = createKessarTerrain(seed);
      for (const h of plan.houses) {
        expect(padSpread((x, z) => t.height(x, z), h), `seed ${seed} ${h.id}`).toBeLessThan(0.05);
        expect(t.height(h.x, h.z)).toBeCloseTo(KESSAR.level, 1);
      }
      expect(t.height(0, -60)).toBeGreaterThan(KESSAR.level + KESSAR.hillRise - 0.5);
    }
    expect(lampsidePad(0, -15)).toBe(1);
    expect(lampsidePad(80, -15)).toBe(0);
  });

  it("has no two of its solids through each other (a garden's wall runs meet end to end), and its gates are open", () => {
    const solids = town.filter((o) => o.tag !== "wall");
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i]!, b = solids[j]!;
      const apart = Math.min(...edge(a).map(([x, z]) => gap(b, x, z)), ...edge(b).map(([x, z]) => gap(a, x, z)));
      expect(apart, `${a.tag} ${a.x.toFixed(1)},${a.z.toFixed(1)} / ${b.tag} ${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeGreaterThan(0.3);
    }
    for (const o of solids) for (const w of town.filter((q) => q.tag === "wall")) expect(Math.min(...edge(o).map(([x, z]) => gap(w, x, z))), `${o.tag} by a wall`).toBeGreaterThan(0.3);
    expect(plan.gates).toHaveLength(5);
    for (const g of plan.gates) for (const o of town) expect(gap(o, g.x, g.z), `${o.tag} in the gate at ${g.x.toFixed(1)},${g.z.toFixed(1)}`).toBeGreaterThan(g.width / 2 - 0.05);
  });

  it("is appended after the seeded dressing: no tree or rock of it stands in the town, and the town is every solid there", () => {
    for (const seed of SEEDS) {
      const w = createKessarWorld(seed);
      for (const o of w.obstacles) {
        if (o.tag !== "tree" && o.tag !== "rock") continue;
        const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
        expect(inLampside(o.x, o.z, r, o.tag === "tree" ? 3.5 : 1), `seed ${seed} ${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBe(false);
      }
      const P = LAMPSIDE.pad;
      const here = w.obstacles.filter((o) => o.x > P.x0 && o.x < P.x1 && o.z > P.z0 && o.z < P.z1 && Math.hypot(o.x - A.fort.x, o.z - A.fort.z) > 34);
      expect(here.length, `seed ${seed}`).toBe(lampsideObstacles(w.terrain).filter((o) => Math.hypot(o.x - A.fort.x, o.z - A.fort.z) > 34).length);
    }
  });

  it("grows what is sown: the gardens burn as their crops do (the barley well, the young green barely), the street not at all, and each standing crop has its scarecrow, solid", () => {
    const w = createKessarWorld(7);
    const [green, barley, grove] = LAMPSIDE_GARDENS;
    const mid = (p: typeof green): [number, number] => [(p!.x0 + p!.x1) / 2 + 1.3, (p!.z0 + p!.z1) / 2 + 0.7];
    expect(regionFieldFuel("kessar", ...mid(barley))).toBe(1);
    expect(regionCover("kessar", w, ...mid(barley))).toBe(1);
    expect(regionFieldFuel("kessar", ...mid(green))).toBeCloseTo(0.3, 6);
    expect(regionFieldFuel("kessar", ...mid(grove))).toBeCloseTo(0.3, 6);
    for (const [x, z] of [[0, -12], [10.6, -21], [3, -25]] as const) expect(regionCover("kessar", w, x, z), `${x},${z}`).toBe(0);
    for (const p of LAMPSIDE_GARDENS) for (const t of fieldThings(p)) expect(w.obstacles.some((o) => o.tag === "scarecrow" && o.x === t.x && o.z === t.z), p.id).toBe(true);
    // and the date palms stand inside their gardens' walls, off the paths from the gates
    for (const p of plan.palms) expect(LAMPSIDE_GARDENS.some((g) => p.x > g.x0 && p.x < g.x1 && p.z > g.z0 && p.z < g.z1), `${p.x},${p.z}`).toBe(true);
    expect(LAMPSIDE.palm.r).toBeGreaterThan(0);
  });
});
