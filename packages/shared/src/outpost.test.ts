import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS as A } from "./campaignTypes.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { insideObstacle } from "./camp.ts";
import { FLAG } from "./constants.ts";
import { createArena } from "./arena.ts";
import { NAV } from "./expeditionTypes.ts";
import { kessarNavOptions } from "./garrison.ts";
import { createKessarTerrain, createKessarWorld, kessarObstacles, kessarRiverHalf, kessarRiverZ, kessarWallRun } from "./kessar.ts";
import { createCharState, stepCharacter, yawToWire, type CharState } from "./movement.ts";
import { NavQuery, buildNavGrid, newNavPath } from "./nav.ts";
import { KESSAR_OUTPOST, OUTPOST_SITES, RING_R, YARD_R, outpostObstacles, outpostPlan, telegraphPoles } from "./outpost.ts";
import { createRegionWorld, findStation, stationsFor } from "./regions.ts";
import { OUTPOST_STAGES, type OutpostStage } from "./worldTypes.ts";
import { OUTPOST_SIGNS, FOUNDATION_SIGN } from "./outpostText.ts";

const hashOf = (world: CollisionWorld): string => {
  let h = 2166136261;
  const s = JSON.stringify(world.obstacles.map((o) => [o.kind, o.tag, +o.x.toFixed(3), +o.z.toFixed(3), +o.y0.toFixed(3), +o.y1.toFixed(3)]));
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${world.obstacles.length}:${h >>> 0}`;
};
const STAGES = OUTPOST_STAGES.filter((s) => s !== "none") as Exclude<OutpostStage, "none">[];
const SEEDS = [1, 7, 42, 1234, 99999];
const scatterKey = (w: CollisionWorld): string[] => w.obstacles.filter((o) => (o.tag === "tree" || o.tag === "rock") && Math.hypot(o.x - KESSAR_OUTPOST.site.x, o.z - KESSAR_OUTPOST.site.z) < RING_R + 3).map((o) => `${o.tag}:${o.x.toFixed(2)}:${o.z.toFixed(2)}`);
const isOutpostObstacle = (o: Obstacle, plan: ReturnType<typeof outpostPlan>): boolean => plan.pieces.some((p) => p.solid && p.x === o.x && p.z === o.z);

describe("outpost sites", () => {
  const S = KESSAR_OUTPOST.site, R = KESSAR_OUTPOST.rivalSite;
  it("the foundation lies on the south bank between the landing and the Dry Cut; the rival post is about 40 m away; both are flat enough and inside the bounds", () => {
    expect(S.z).toBeGreaterThan(kessarRiverZ(S.x) + kessarRiverHalf(S.x) + kessarWallRun(S.x) + 10);
    expect(Math.hypot(S.x - A.landing.x, S.z - A.landing.z)).toBeGreaterThan(20);
    expect(Math.hypot(S.x - A.landing.x, S.z - A.landing.z)).toBeLessThan(45);
    expect(Math.hypot(R.x - S.x, R.z - S.z)).toBeGreaterThan(35);
    expect(Math.hypot(R.x - S.x, R.z - S.z)).toBeLessThan(45);
    expect(S.z + RING_R).toBeGreaterThan(0); // (the ring may reach the shore: pieces keep clear of it, below)
    for (const seed of SEEDS) {
      const t = createKessarTerrain(seed);
      for (const site of [S, R]) {
        let lo = Infinity, hi = -Infinity;
        for (let a = 0; a < 16; a++) {
          const h = t.height(site.x + Math.cos((a * Math.PI) / 8) * 6, site.z + Math.sin((a * Math.PI) / 8) * 6);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        expect(hi - lo, `seed ${seed} site ${site.x},${site.z} relief within 6 m`).toBeLessThan(1.6);
        expect(t.waterDepth(site.x, site.z)).toBe(0);
      }
      expect(Math.hypot(S.x, S.z)).toBeLessThan(A.bounds - 6);
      expect(Math.hypot(R.x, R.z)).toBeLessThan(A.bounds - 6);
    }
  });
  it("the plan is deterministic, cumulative, inside the ring, off the yard, clear of the shore and off the roads", () => {
    let prev = 0;
    for (const st of OUTPOST_STAGES) {
      const plan = outpostPlan(st);
      expect(JSON.stringify(outpostPlan(st))).toBe(JSON.stringify(plan));
      const solid = plan.pieces.filter((p) => p.solid).length;
      expect(solid).toBeGreaterThanOrEqual(prev);
      prev = solid;
      for (const p of plan.pieces) {
        const d = Math.hypot(p.x - S.x, p.z - S.z);
        if (p.solid) {
          expect(d, `${p.kind}`).toBeGreaterThan(YARD_R + (p.shape === "circle" ? p.hx : Math.hypot(p.hx, p.hz)) - 0.01);
          expect(d + (p.shape === "circle" ? p.hx : Math.hypot(p.hx, p.hz)), `${p.kind} within the ring`).toBeLessThanOrEqual(RING_R + 0.5);
          expect(p.z + (p.shape === "circle" ? p.hx : Math.hypot(p.hx, p.hz)), `${p.kind} off the beach`).toBeLessThan(92);
          expect(createKessarTerrain(7).waterDepth(p.x, p.z), `${p.kind} on dry land`).toBe(0);
        }
      }
    }
    // no two solid pieces overlap
    const town = outpostPlan("town").pieces.filter((p) => p.solid);
    for (let i = 0; i < town.length; i++) {
      for (let j = i + 1; j < town.length; j++) {
        const a = town[i]!, b = town[j]!;
        if ((a.kind === "palisade" && (b.kind === "tower" || b.kind === "post")) || (b.kind === "palisade" && (a.kind === "tower" || a.kind === "post"))) continue; // the stockade's own corners and gateposts
        const oa: Obstacle = a.shape === "circle" ? { kind: "circle", x: a.x, z: a.z, r: a.hx, y0: 0, y1: 1 } : { kind: "box", x: a.x, z: a.z, hx: a.hx, hz: a.hz, yaw: a.yaw, y0: 0, y1: 1 };
        const rb = b.shape === "circle" ? b.hx : Math.min(b.hx, b.hz);
        expect(insideObstacle(oa, b.x, b.z, rb * 0.5), `${a.kind}#${i} overlaps ${b.kind}#${j}`).toBe(false);
      }
    }
    expect(outpostPlan("none").pieces.filter((p) => p.solid)).toEqual([]);
    expect(outpostPlan("camp").gate).toBeUndefined();
    expect(outpostPlan("fortified_outpost").gate).toBeDefined();
    expect(Object.keys(OUTPOST_SIGNS).sort()).toEqual([...STAGES].sort());
    expect(FOUNDATION_SIGN.length).toBeGreaterThan(5);
  });
  it("the telegraph poles lead from the foundation to the bridge and stand off the road", () => {
    const poles = telegraphPoles();
    expect(poles.length).toBeGreaterThanOrEqual(4);
    for (const p of poles) expect(Math.hypot(p.x - S.x, p.z - S.z)).toBeGreaterThan(YARD_R);
    expect(poles.at(-1)!.z).toBeLessThan(40);
    expect(OUTPOST_SITES.hollowmere).toBeUndefined();
    expect(telegraphPoles("hollowmere")).toEqual([]);
  });
  it("the foundation is a station: no sheet, a radius inside the yard", () => {
    const st = stationsFor("kessar").find((x) => x.kind === "foundation")!;
    expect(st).toMatchObject({ id: "foundation", x: S.x, z: S.z });
    expect(st.r).toBeLessThan(YARD_R);
    expect(findStation("kessar", S.x, S.z, 0)?.kind).toBe("foundation");
    expect(findStation("kessar", S.x + 20, S.z, 0)?.kind).not.toBe("foundation");
  });
});

describe("the collision world depends on (seed, bridge, outpost stage, telegraph)", () => {
  it("is deterministic per seed across 5 seeds at every stage; 'none' is the plain world; Hollowmere is untouched", () => {
    for (const seed of SEEDS) {
      const plain = createKessarWorld(seed);
      expect(hashOf(createKessarWorld(seed, "intact", { outpost: "none", telegraph: false }))).toBe(hashOf(plain));
      expect(hashOf(createRegionWorld("kessar", seed, { bridge: "intact", outpost: "none" }))).toBe(hashOf(plain));
      expect(hashOf(createRegionWorld("kessar", seed, {}))).toBe(hashOf(plain));
      const seen = new Set<string>([hashOf(plain)]);
      for (const st of STAGES) {
        const a = createKessarWorld(seed, "intact", { outpost: st });
        expect(hashOf(a)).toBe(hashOf(createKessarWorld(seed, "intact", { outpost: st })));
        seen.add(hashOf(a));
      }
      expect(seen.size).toBe(6);
      expect(hashOf(createKessarWorld(seed, "intact", { outpost: "town", telegraph: true }))).not.toBe(hashOf(createKessarWorld(seed, "intact", { outpost: "town" })));
    }
    // Hollowmere's arena (after R's finger-posts) is recorded here: O must never move it
    expect(hashOf(createArena(7))).toBe(HOLLOWMERE_ARENA_7);
    expect(hashOf(createRegionWorld("hollowmere", 7, { outpost: "town", telegraph: true }))).toBe(HOLLOWMERE_ARENA_7);
  });

  it("per stage and bridge: the yard is empty, nothing stands inside anything, the scatter plan is identical at every stage", () => {
    for (const bridge of ["intact", "collapsed"] as const) {
      for (const seed of [7, 42]) {
        let scatter: string[] | undefined;
        for (const st of STAGES) {
          const w = createKessarWorld(seed, bridge, { outpost: st, telegraph: st === "town" });
          const plan = outpostPlan(st);
          const S = plan.site;
          for (const o of w.obstacles) expect(insideObstacle(o, S.x, S.z, YARD_R - 0.3), `${st}: ${o.tag} in the yard`).toBe(false);
          // nothing of the seeded dressing overlaps a stage piece: the scatter was cleared out of the ring
          const others = w.obstacles.filter((o) => !isOutpostObstacle(o, plan));
          for (const p of plan.pieces.filter((x) => x.solid)) {
            const r = p.shape === "circle" ? p.hx : Math.hypot(p.hx, p.hz);
            for (const o of others) {
              if (o.tag !== "tree" && o.tag !== "rock") continue;
              const ro = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
              expect(Math.hypot(o.x - p.x, o.z - p.z), `${st} seed ${seed} ${p.kind} vs ${o.tag}`).toBeGreaterThan((r + ro) * 0.7);
            }
          }
          const sk = scatterKey(w);
          scatter ??= sk;
          expect(sk, `${st} scatter`).toEqual(scatter);
        }
      }
    }
  });

  it("a stage appends colliders and moves nothing outside the ring (bar the cleared scatter)", () => {
    const seed = 7;
    const base = kessarObstacles(createKessarTerrain(seed), seed, "intact");
    const town = kessarObstacles(createKessarTerrain(seed), seed, "intact", { outpost: "town" });
    const key = (o: Obstacle): string => `${o.kind}:${o.tag}:${o.x.toFixed(3)}:${o.z.toFixed(3)}`;
    const far = (list: Obstacle[]): string[] => list.filter((o) => Math.hypot(o.x - KESSAR_OUTPOST.site.x, o.z - KESSAR_OUTPOST.site.z) >= RING_R).map(key);
    expect(far(town)).toEqual(far(base));
    expect(outpostObstacles("none", false, createKessarTerrain(seed))).toEqual([]);
  });
});

// ---- reachability with the REAL movement step ----------------------------------------------------------------------------------------

const CELL = 2;
const span = Math.ceil(A.bounds / CELL);
const key = (i: number, j: number): number => (i + span) * (2 * span + 1) + (j + span);

function reach(world: CollisionWorld, from: { x: number; z: number }): (x: number, z: number) => boolean {
  const seen = new Set<number>();
  const st: CharState = createCharState(0, 0, world);
  const probe = { x: 0, z: 0 };
  const surface = (x: number, z: number): number => {
    let y = world.terrainHeight(x, z);
    world.forEachNear(x, z, (o) => {
      if ((o.tag === "bridge" || o.tag === "jetty") && o.kind === "box" && Math.abs(x - o.x) <= o.hx && Math.abs(z - o.z) <= o.hz && o.y1 > y) y = o.y1;
    });
    return y;
  };
  const standable = (x: number, z: number): boolean => {
    probe.x = x;
    probe.z = z;
    return !world.resolveXZ(probe, surface(x, z), 0.4, 1.8);
  };
  const tryEdge = (x0: number, z0: number, x1: number, z1: number): boolean => {
    if (!standable(x0, z0) || !standable(x1, z1)) return false;
    st.x = x0;
    st.z = z0;
    st.y = surface(x0, z0);
    st.vx = st.vy = st.vz = 0;
    st.flags = FLAG.GROUNDED;
    st.stumble = 0;
    const yaw = yawToWire(Math.atan2(-(x1 - x0), -(z1 - z0)));
    for (let k = 0; k < 40; k++) {
      stepCharacter(st, { moveF: 127, moveR: 0, yaw, buttons: 0 }, 1 / 30, world);
      if (Math.hypot(st.x - x1, st.z - z1) < 0.6) return true;
    }
    return false;
  };
  const q: [number, number][] = [];
  const si = Math.round(from.x / CELL), sj = Math.round(from.z / CELL);
  seen.add(key(si, sj));
  q.push([si, sj]);
  while (q.length) {
    const [i, j] = q.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      const x1 = ni * CELL, z1 = nj * CELL;
      if (Math.hypot(x1, z1) > A.bounds - 1 || seen.has(key(ni, nj))) continue;
      if (tryEdge(i * CELL, j * CELL, x1, z1)) {
        seen.add(key(ni, nj));
        q.push([ni, nj]);
      }
    }
  }
  return (x, z) => {
    for (const di of [0, -1, 1]) for (const dj of [0, -1, 1]) {
      const i = Math.round(x / CELL) + di, j = Math.round(z / CELL) + dj;
      if (Math.hypot(i * CELL - x, j * CELL - z) <= 1.5 && seen.has(key(i, j))) return true;
    }
    return false;
  };
}

describe("every stage stays walkable", () => {
  const S = KESSAR_OUTPOST.site;
  const goals: [string, number, number][] = [["yard", S.x, S.z], ["toll bar", 2, 6], ["fort gate", A.fort.gate.x, A.fort.gate.z], ["landing", A.landing.x, A.landing.z]];
  for (const bridge of ["intact", "collapsed"] as const) {
    it(`the nav grid reaches the yard, the toll bar and the fort gate from the landing at every stage, bridge ${bridge}`, () => {
      for (const st of OUTPOST_STAGES) {
        const w = createKessarWorld(7, bridge, { outpost: st, telegraph: st === "town" });
        const q = new NavQuery(buildNavGrid(w, kessarNavOptions(w)));
        const path = newNavPath();
        for (const [name, x, z] of goals) {
          expect(q.open(x, z), `${st} ${name} open`).toBe(true);
          expect(q.path(A.landing.x, A.landing.z + 0, x, z, path) || name === "landing", `${st} ${name} reachable`).toBe(true);
        }
        // the yard to the toll bar
        expect(q.path(S.x, S.z, 2, 6, path), `${st} yard -> toll bar`).toBe(true);
        expect(path.complete).toBe(true);
        expect(NAV.clearance).toBeGreaterThan(0);
      }
    }, 60_000);
  }

  for (const [st, bridge] of [["fortified_outpost", "intact"], ["town", "intact"], ["town", "collapsed"]] as const) {
    it(`the real movement step walks from the landing to the yard, the toll bar and the fort gate: ${st}, bridge ${bridge}`, () => {
      const w = createKessarWorld(7, bridge, { outpost: st, telegraph: st === "town" });
      const r = reach(w, A.landing);
      for (const [name, x, z] of goals) expect(r(x, z), `${st} ${bridge} ${name}`).toBe(true);
      // the stockade's gate is the way in: a point just inside it is reachable too
      if (st === "fortified_outpost") expect(r(S.x, S.z - 12), "inside the stockade").toBe(true);
    }, 120_000);
  }
});

const HOLLOWMERE_ARENA_7 = "473:1236351889";
