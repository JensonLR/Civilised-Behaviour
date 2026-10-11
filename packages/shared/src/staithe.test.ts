import { describe, expect, it } from "vitest";
import type { Obstacle } from "./collision.ts";
import { ARRIVAL_TOWARD, arrivalCentre, inArrival, kitKegSpots } from "./stores.ts";
import { STAITHE_SIGNS, inStaithe, staitheObstacles, staithePlan, staitheTop } from "./staithe.ts";
import { VESPER_ANCHORS as A, VESPER_MOUNT_SPOTS, VESPER_ROAD_HALF, createVesperTerrain, createVesperWorld, vesperLevel, vesperPlan, vesperProps, vesperRoadDistance, vesperRoadX, vesperSitePoints, vesperSpawn } from "./vesper.ts";

/** D-126: the Staithe, the hamlet at Vesper's landing: one plan the colliders, the level plan, the plaques and the client read. */
const SEEDS = [1, 7, 42, 1337, 90210, 3, 500];
const plan = staithePlan();
const hamlet = staitheObstacles(createVesperTerrain(7));

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

const near = (o: Obstacle, p: { x: number; z: number }): number => Math.min(...edge(o).map(([x, z]) => Math.hypot(x - p.x, z - p.z)));

describe("D-126: the Staithe", () => {
  it("is five sealed houses with their doors to the road, each its own notice, and the Guild's coffins, post and line and the Company's steelyard", () => {
    expect(plan.houses.map((h) => h.kind)).toEqual(["receiving", "weigh", "bunk", "bunk", "bunk"]);
    expect(new Set(plan.houses.map((h) => h.sign)).size).toBe(plan.houses.length);
    for (const s of STAITHE_SIGNS) expect(s.length, s).toBeLessThanOrEqual(34);
    for (const h of plan.houses) {
      const lb = vesperLevel().buildings.find((b) => b.id === `staithe.${h.id}`)!;
      expect(lb, h.id).toBeDefined();
      expect(lb.kind).toBe("sealed");
      expect(lb.sign).toBe(h.sign);
      expect(lb.height).toBeCloseTo(staitheTop(h), 6);
      expect(lb.doorH).toBeLessThan(h.wallH);
      // the door's face looks at the road: its middle is nearer the road than the house's middle, by the house's whole half depth
      const dx = h.x + Math.cos(h.yaw) * h.hx, dz = h.z + Math.sin(h.yaw) * h.hx;
      expect(vesperRoadDistance(h.x, h.z) - vesperRoadDistance(dx, dz), h.id).toBeCloseTo(h.hx, 1);
    }
    expect(hamlet.filter((o) => o.tag === "house")).toHaveLength(5);
    expect(hamlet.filter((o) => o.tag === "pole")).toHaveLength(4);
    expect(hamlet.filter((o) => o.tag === "crate")).toHaveLength(1);
    // the coffins stand against the Receiving House's south gable, the post by its door, the line behind it; the steelyard by the weigh-house's corner
    const r = plan.houses[0]!;
    expect(plan.coffins.z - plan.coffins.hz - (r.z + r.hz)).toBeGreaterThan(0);
    expect(plan.coffins.z - plan.coffins.hz - (r.z + r.hz)).toBeLessThan(0.05);
    expect(plan.post.x).toBeGreaterThan(r.x + r.hx);
    expect(plan.line.x).toBeLessThan(r.x - r.hx);
    const w = plan.houses[1]!;
    expect(Math.hypot(plan.gallows.x - (w.x + Math.cos(w.yaw) * w.hx), plan.gallows.z - (w.z - w.hz))).toBeLessThan(2.2);
  });

  it("keeps the road, the arrival, the mounts, the stores, the kit's kegs, the lamps and every story point clear", () => {
    const arrival = arrivalCentre(vesperSpawn);
    for (const o of hamlet) {
      const what = `${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`;
      for (const [x, z] of edge(o)) {
        expect(vesperRoadDistance(x, z), what).toBeGreaterThan(VESPER_ROAD_HALF + 1.2);
        expect(inArrival(arrival, ARRIVAL_TOWARD, x, z, 0.4), what).toBe(false);
      }
      for (const p of vesperSitePoints()) expect(near(o, p), `${what} by ${p.id}`).toBeGreaterThan(5);
      for (const m of [...VESPER_MOUNT_SPOTS.horses, VESPER_MOUNT_SPOTS.wagon]) expect(near(o, m), `${what} by a mount`).toBeGreaterThan(2.5);
      for (const l of vesperPlan().lamps) expect(near(o, l), `${what} by a lamp`).toBeGreaterThan(1);
      for (const c of vesperPlan().carts) expect(near(o, c), `${what} by a cart`).toBeGreaterThan(2);
    }
    for (const seed of SEEDS) {
      const w = createVesperWorld(seed);
      const props = vesperProps(seed, w);
      for (const p of [...props, ...kitKegSpots(A.landing, arrival, w, props, 24)]) for (const o of hamlet) expect(gap(o, p.x, p.z), `seed ${seed} ${o.tag} by a store at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeGreaterThan(1);
      // the ore road from the landing to the cloister's track is walked on its line with nothing in the way
      for (let z = 112; z >= 50; z -= 0.5) {
        const pos = { x: vesperRoadX(z), z };
        expect(w.resolveXZ(pos, w.terrainHeight(pos.x, z), 0.4, 1.7), `seed ${seed} z ${z}`).toBe(false);
      }
    }
  });

  it("has no two of its solids through each other: each stands against another (the coffins at their gable, the post on the front) or a body's width from it; every sealed door's apron is open", () => {
    for (let i = 0; i < hamlet.length; i++) for (let j = i + 1; j < hamlet.length; j++) {
      const a = hamlet[i]!, b = hamlet[j]!;
      const apart = Math.min(...edge(a).map(([x, z]) => gap(b, x, z)), ...edge(b).map(([x, z]) => gap(a, x, z)));
      const what = `${a.tag} ${a.x.toFixed(1)},${a.z.toFixed(1)} / ${b.tag} ${b.x.toFixed(1)},${b.z.toFixed(1)}`;
      expect(apart, what).toBeGreaterThan(0.005);
      expect(apart < 0.06 || apart > 1.0, `${what}: ${apart.toFixed(2)} m is neither against it nor a passage`).toBe(true);
    }
    const w = createVesperWorld(7);
    for (const h of plan.houses) {
      const lb = vesperLevel().buildings.find((b) => b.id === `staithe.${h.id}`)!;
      const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
      // the apron: 1.6 m deep before the door, the door's width and 0.3 m each side
      for (let along = 0.1; along <= 1.6; along += 0.25) for (let across = -(lb.door / 2 + 0.3); across <= lb.door / 2 + 0.3; across += 0.25) {
        const x = h.x + c * (h.hx + along) - s * across, z = h.z + s * (h.hx + along) + c * across;
        for (const o of w.obstacles) expect(gap(o, x, z), `${h.id}'s apron at ${x.toFixed(1)},${z.toFixed(1)}: ${o.tag}`).toBeGreaterThan(0);
      }
    }
  });

  it("is appended after the seeded boulders: none of them stands in its yards, and the hamlet is every solid there", () => {
    for (const seed of SEEDS) {
      const w = createVesperWorld(seed);
      for (const o of w.obstacles) {
        if (o.tag !== "rock" || o.kind !== "circle") continue;
        expect(inStaithe(o.x, o.z, o.r, 1), `seed ${seed} rock at ${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBe(false);
      }
      const mine = staitheObstacles(w.terrain);
      const here = w.obstacles.filter((o) => inStaithe(o.x, o.z, 0, 0));
      expect(here.length, `seed ${seed}`).toBe(mine.length);
      for (const o of mine) expect(w.obstacles).toContainEqual(o);
      // the gorge keeps its dressing: the boulders the hamlet took were a handful
      expect(w.obstacles.filter((o) => o.tag === "rock" && o.kind === "circle" && Math.abs(o.x) < 60 && o.z > -108 && o.z < 108).length, `seed ${seed}`).toBeGreaterThan(36);
    }
  });

  it("leaves the gorge's landmark in sight: from the landing the headframe's top is never behind a house of the hamlet", () => {
    const t = createVesperTerrain(7);
    const arrival = arrivalCentre(vesperSpawn);
    const eye = { x: arrival.x, y: t.height(arrival.x, arrival.z) + 1.6, z: arrival.z };
    const hf = vesperPlan().headframe;
    for (const frac of [1, 0.75, 0.5]) {
      const top = { x: hf.x, y: hf.y + hf.height * frac, z: hf.z };
      for (let i = 1; i < 400; i++) {
        const f = i / 400;
        const x = eye.x + (top.x - eye.x) * f, y = eye.y + (top.y - eye.y) * f, z = eye.z + (top.z - eye.z) * f;
        for (const o of hamlet) if (gap(o, x, z) === 0) expect(y, `the ray to ${frac} of the headframe meets ${o.tag} at ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThan(o.y1);
      }
    }
  });
});
