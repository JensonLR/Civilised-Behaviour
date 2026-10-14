import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS as A } from "./campaignTypes.ts";
import type { Obstacle } from "./collision.ts";
import { KESSAR, createKessarTerrain, createKessarWorld, kessarLevel, kessarPlan, kessarProps, kessarRoad, kessarSitePoints, kessarSpawn } from "./kessar.ts";
import { LAMPSIDE } from "./lampside.ts";
import { padSpread } from "./levelPlan.ts";
import { CHARACTER, STEP_DT } from "./constants.ts";
import { createCharState, stepCharacter, yawToWire } from "./movement.ts";
import { regionMountSpots } from "./mount.ts";
import { inOutpostRing, telegraphPoles } from "./outpost.ts";
import { RELIC_BOARDS, RELIC_SIGNS, inRelicWorks, relicObstacles, relicPad, relicPlan } from "./relicWorks.ts";
import { ARRIVAL_TOWARD, arrivalCentre, inArrival, kitKegSpots } from "./stores.ts";

/** D-129: the Relic Works on Kessar's west beach: one plan the terrain, the colliders, the level and the cloth read. */
const SEEDS = [1, 7, 42, 1337, 90210, 3, 500];
const plan = relicPlan();
const works = relicObstacles(createKessarTerrain(7));

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

const apart = (a: Obstacle, b: Obstacle): number => Math.min(...edge(a).map(([x, z]) => gap(b, x, z)), ...edge(b).map(([x, z]) => gap(a, x, z)));

/** A board's two ends (it runs across its face direction, 2.5 m long). */
const boardEnds = (b: { x: number; z: number; yaw: number }): [number, number][] => [-1, 1].map((s) => [b.x - Math.sin(b.yaw) * 1.25 * s, b.z + Math.cos(b.yaw) * 1.25 * s]);

describe("D-129: the Relic Works' plan", () => {
  it("is a works with its door sealed and its notice, a kiln, a walled ageing yard of two beds, a drying shelf, a stall by the road and two boards, every notice short enough to letter", () => {
    const sealed = kessarLevel().buildings.filter((b) => b.id.startsWith("relic."));
    expect(sealed.map((b) => [b.id, b.kind, b.sign])).toEqual([["relic.works", "sealed", RELIC_SIGNS[0]]]);
    for (const t of [...RELIC_SIGNS, ...RELIC_BOARDS]) expect(t.length, t).toBeLessThanOrEqual(36);
    // the works' door looks east, to the road (its front face nearer the road's line than its middle)
    const w = plan.works;
    expect(Math.abs(w.x + Math.cos(w.yaw) * w.hx)).toBeLessThan(Math.abs(w.x));
    // the yard's one gate is in its east wall, facing the works' back door across the lane
    expect(plan.yard.gates).toHaveLength(1);
    const g = plan.yard.gates[0]!;
    expect(g.x).toBeCloseTo(plan.yard.x1, 6);
    expect(Math.abs(g.z - w.z)).toBeLessThan(1);
    expect(w.x - w.hx - plan.yard.x1 - LAMPSIDE.wall.half).toBeGreaterThan(3);
    expect(plan.beds).toHaveLength(2);
    expect(works.filter((o) => o.tag === "sign")).toHaveLength(plan.boards.length);
    expect(plan.boards.map((b) => b.text).sort()).toEqual([0, 1]);
  });

  it("keeps the road, the arrival, the horses, the kit's kegs, the stores, the story points, the palms, the outpost's ground and the telegraph clear", () => {
    const arrival = arrivalCentre(kessarSpawn);
    const spots = regionMountSpots("kessar");
    const palms = kessarPlan().palms;
    for (const o of works) {
      const id = `${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`;
      for (const [x, z] of edge(o)) {
        expect(kessarRoad(x, z), id).toBeLessThan(0.02);
        expect(inArrival(arrival, ARRIVAL_TOWARD, x, z, 1), id).toBe(false);
        expect(inOutpostRing(x, z, 2), id).toBe(false);
      }
      for (const h of spots.horses) expect(gap(o, h.x, h.z), `${id} by a horse`).toBeGreaterThan(3);
      expect(gap(o, spots.wagon.x, spots.wagon.z), `${id} by the wagon`).toBeGreaterThan(5);
      for (const p of [A.landing, A.rivalCamp, A.powder]) expect(gap(o, p.x, p.z), `${id} by ${p.x},${p.z}`).toBeGreaterThan(6);
      for (const p of kessarSitePoints()) expect(gap(o, p.x, p.z), `${id} by ${p.id}`).toBeGreaterThan(6);
      for (const p of palms) expect(gap(o, p.x, p.z), `${id} by the palm at ${p.x},${p.z}`).toBeGreaterThan(1);
      for (const p of telegraphPoles("kessar")) expect(gap(o, p.x, p.z), `${id} by a telegraph pole`).toBeGreaterThan(3);
    }
    // the boards' ends too (a board is wider than its post)
    for (const b of plan.boards) for (const [x, z] of boardEnds(b)) {
      expect(kessarRoad(x, z)).toBeLessThan(0.02);
      expect(inArrival(arrival, ARRIVAL_TOWARD, x, z, 1)).toBe(false);
      for (const h of spots.horses) expect(Math.hypot(x - h.x, z - h.z)).toBeGreaterThan(2.5);
    }
    for (const seed of SEEDS) {
      const w = createKessarWorld(seed);
      const stores = kessarProps(seed, w);
      for (const p of stores) expect(inRelicWorks(p.x, p.z, 0.4, 0.5), `seed ${seed} store at ${p.x},${p.z}`).toBe(false);
      // the kit's kegs still land in their rows on the bank east of the landing, all of them
      const kegs = kitKegSpots(A.landing, arrival, w, stores, 12);
      expect(kegs, `seed ${seed}`).toHaveLength(12);
      for (const k of kegs) expect(inRelicWorks(k.x, k.z, 0.4, 2)).toBe(false);
    }
  });

  it("stands on levelled ground at the bank's level on every seed: the works, the kiln, the yard and the stall", () => {
    for (const seed of SEEDS) {
      const t = createKessarTerrain(seed);
      const h = (x: number, z: number): number => t.height(x, z);
      const y = plan.yard;
      for (const b of [plan.works, { ...plan.kiln, yaw: 0, hx: plan.kiln.half, hz: plan.kiln.half }, { x: (y.x0 + y.x1) / 2, z: (y.z0 + y.z1) / 2, yaw: 0, hx: (y.x1 - y.x0) / 2 + 0.3, hz: (y.z1 - y.z0) / 2 + 0.3 }, plan.stall]) {
        expect(padSpread(h, b), `seed ${seed} at ${b.x},${b.z}`).toBeLessThan(0.05);
        expect(h(b.x, b.z)).toBeCloseTo(KESSAR.level, 1);
      }
      // and the sea is still the sea past the shore
      expect((t as { waterDepth(x: number, z: number): number }).waterDepth(-30, 104)).toBeGreaterThan(0.3);
    }
    expect(relicPad(-30, 80)).toBe(1);
    expect(relicPad(-30, 40)).toBe(0);
  });

  it("has no two of its solids through each other or squeezed (against, or a body's width apart), and its gate is open", () => {
    const solids = works.filter((o) => o.tag !== "wall");
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i]!, b = solids[j]!;
      const d = apart(a, b);
      // (the stall's counter and backboard are one stall: the keeper's room between them is theirs)
      if (a.tag === "stall" && b.tag === "stall") continue;
      // the drying shelf stands against the works' gable (a hand's breadth), everything else is clear by more than a body
      if ((a.tag === "crate" && b.tag === "house") || (a.tag === "house" && b.tag === "crate")) expect(d).toBeLessThan(0.06);
      else expect(d, `${a.tag} ${a.x.toFixed(1)},${a.z.toFixed(1)} / ${b.tag} ${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeGreaterThan(1);
    }
    // inside the yard the beds keep a lane of 1.5 or more from every wall
    for (const b of works.filter((o) => o.tag === "bund")) for (const w of works.filter((o) => o.tag === "wall")) expect(apart(b, w)).toBeGreaterThan(1.5);
    // and outside it nothing stands within a body's width of a wall (the gate's board stands clear of its wall)
    for (const o of solids.filter((q) => q.tag !== "bund")) for (const w of works.filter((q) => q.tag === "wall")) expect(apart(o, w), `${o.tag} by a wall`).toBeGreaterThan(1);
    const g = plan.yard.gates[0]!;
    for (const o of works) expect(gap(o, g.x, g.z), `${o.tag} in the gate`).toBeGreaterThan(g.width / 2 - 0.05);
    for (const b of plan.boards) for (const [x, z] of boardEnds(b)) expect(Math.abs(z - g.z) > g.width / 2 + 0.4 || Math.abs(x - g.x) > 1.5).toBe(true);
  });

  it("is appended after the seeded dressing: no tree or rock stands in its ground, and its solids are every solid there", () => {
    for (const seed of SEEDS) {
      const w = createKessarWorld(seed);
      for (const o of w.obstacles) {
        if (o.tag !== "tree" && o.tag !== "rock") continue;
        const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
        expect(inRelicWorks(o.x, o.z, r, o.tag === "tree" ? 3.5 : 1), `seed ${seed} ${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBe(false);
      }
      const here = w.obstacles.filter((o) => inRelicWorks(o.x, o.z, 0, 0));
      const own = relicObstacles(w.terrain);
      expect(here.length, `seed ${seed}`).toBe(own.length);
      // and they are the last solids before the outpost's (none here at this stage)
      const tail = w.obstacles.slice(w.obstacles.length - own.length);
      expect(tail.map((o) => [o.tag, o.x, o.z])).toEqual(own.map((o) => [o.tag, o.x, o.z]));
    }
  });

  it("walks: a body comes up from the beach, through the yard's gate and onto a bed (a step, not a wall), and reaches the stall's counter from the road", () => {
    const w = createKessarWorld(7);
    // (the shared movement step, exactly what client and server run)
    const walk = (from: { x: number; z: number }, to: { x: number; z: number }, secs: number): { x: number; y: number; z: number } => {
      const s = createCharState(from.x, from.z, w);
      for (let i = 0; i < secs / STEP_DT; i++) {
        const dx = to.x - s.x, dz = to.z - s.z;
        if (Math.hypot(dx, dz) < 0.2) break;
        stepCharacter(s, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-dx, -dz)), buttons: 0 }, STEP_DT, w);
      }
      return s;
    };
    const g = plan.yard.gates[0]!;
    // from the lane behind the works, in at the gate, up the east lane
    const lane = { x: g.x + 1.6, z: g.z };
    const inside = walk(lane, { x: g.x - 1.1, z: g.z }, 6);
    expect(Math.hypot(inside.x - (g.x - 1.1), inside.z - g.z)).toBeLessThan(0.4);
    // and onto the near bed from the lane
    const bed = plan.beds[1]!;
    const on = walk({ x: g.x - 1.1, z: g.z }, { x: bed.x, z: g.z }, 6);
    expect(Math.abs(on.x - bed.x)).toBeLessThan(0.4);
    expect(on.y - w.terrainHeight(bed.x, g.z)).toBeGreaterThan(bed.height - 0.05);
    expect(bed.height).toBeLessThan(CHARACTER.stepHeight);
    // the stall's counter from the road beside it
    const st = plan.stall;
    const at = walk({ x: -2.8, z: st.z }, { x: st.x + st.hx + CHARACTER.radius + 0.1, z: st.z }, 8);
    expect(Math.abs(at.x - (st.x + st.hx + CHARACTER.radius + 0.1))).toBeLessThan(0.3);
  });

  it("is seen from the arrival: the stall and its board stand ahead and to the left of the party's camera, inside 20 m, and the works beyond them", () => {
    const c = arrivalCentre(kessarSpawn);
    // (the camera stands behind the party, about 5 m back from the ring's middle, looking up the way)
    const cam = { x: c.x - ARRIVAL_TOWARD.x * 5, z: c.z - ARRIVAL_TOWARD.z * 5 };
    const look = (x: number, z: number): { d: number; deg: number } => ({ d: Math.hypot(x - cam.x, z - cam.z), deg: (Math.atan2(-(x - cam.x), -(z - cam.z)) * 180) / Math.PI });
    const s = look(plan.stall.x, plan.stall.z);
    expect(s.d).toBeLessThan(20);
    expect(s.deg).toBeGreaterThan(15);
    expect(s.deg).toBeLessThan(45);
    const b = plan.boards[0]!;
    // the stall's board turned to the landing: its face looks within 30 degrees of the arrival
    const to = Math.atan2(c.z - b.z, c.x - b.x);
    expect(Math.abs(Math.atan2(Math.sin(to - b.yaw), Math.cos(to - b.yaw)))).toBeLessThan(Math.PI / 6);
    expect(look(plan.works.x, plan.works.z).d).toBeLessThan(30);
  });
});
