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
import { KESSAR_OUTPOST, OUTPOST_REGIONS, OUTPOST_SITES, RING_R, YARD_R, outpostObstacles, outpostPlan, outpostRoad, rivalPostObstacles, telegraphPoles, type OutpostPiece } from "./outpost.ts";
import { createRegionWorld, findStation, regionNavOptions, stationsFor } from "./regions.ts";
import { HIGHMARK_ANCHORS, createHighmarkTerrain, createHighmarkWorld, herdPlan, highmarkSitePoints } from "./highmark.ts";
import { foundOutpost, newSettlements, regionWorldOpts, serializeSettlements } from "./settlement.ts";
import { newCampaign, serializeCampaign } from "./factions.ts";
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
/** D-091: every piece the industrial age can add (the plan stands each only at its stage). */
const ALL_TECH = { railway: true, works: true, crank: true } as const;

// ---- footprints: convex outlines on the ground, tested by separating axes (a centre-in-shape test let a hut's corner sit in a tower) ----------------------
type Poly = [number, number][];
const boxPoly = (x: number, z: number, hx: number, hz: number, yaw: number): Poly => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return ([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] as const).map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
};
const circlePoly = (x: number, z: number, r: number): Poly => Array.from({ length: 16 }, (_, i) => [x + Math.cos((i * Math.PI) / 8) * r, z + Math.sin((i * Math.PI) / 8) * r]);
const piecePoly = (p: OutpostPiece): Poly => (p.shape === "circle" ? circlePoly(p.x, p.z, p.hx) : boxPoly(p.x, p.z, p.hx, p.hz, p.yaw));
const obstaclePoly = (o: Obstacle): Poly => (o.kind === "circle" ? circlePoly(o.x, o.z, o.r) : boxPoly(o.x, o.z, o.hx, o.hz, o.yaw));
/** How far two convex outlines pass into each other (<= 0: apart by that much). */
function depth(a: Poly, b: Poly): number {
  let least = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nx = -(q[1] - p[1]) / l, nz = (q[0] - p[0]) / l;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const d = v[0] * nx + v[1] * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = v[0] * nx + v[1] * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      least = Math.min(least, Math.min(a1, b1) - Math.max(a0, b0));
    }
  }
  return least;
}
/** The road's legs as outlines (its half-width either side of each leg). */
const roadPolys = (level: 1 | 2): Poly[] => {
  const r = outpostRoad(level)!;
  const out: Poly[] = [];
  for (let i = 0; i + 1 < r.path.length; i++) {
    const a = r.path[i]!, b = r.path[i + 1]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    out.push(boxPoly((a.x + b.x) / 2, (a.z + b.z) / 2, r.half, l / 2, Math.atan2(b.x - a.x, b.z - a.z)));
  }
  return out;
};
/** Joined on purpose: the stockade's own segments, and the towers and gateposts set in its line. */
const joined = (a: OutpostPiece, b: OutpostPiece): boolean =>
  (a.kind === "palisade" && (b.kind === "palisade" || b.kind === "tower" || b.kind === "post")) || (b.kind === "palisade" && (a.kind === "tower" || a.kind === "post"));

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
      const plan = outpostPlan(st, "kessar", ALL_TECH);
      expect(JSON.stringify(outpostPlan(st, "kessar", ALL_TECH))).toBe(JSON.stringify(plan));
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

describe("nothing in a town stands in anything else (D-091)", () => {
  for (const region of OUTPOST_REGIONS) {
    it(`${region}: no two pieces pass into each other at any stage, with the railway and the works; the wire's poles and the Syndicate's post stand clear of all of it`, () => {
      const t = region === "kessar" ? createKessarTerrain(7) : createHighmarkTerrain(7);
      for (const st of STAGES) {
        const pieces = outpostPlan(st, region, ALL_TECH).pieces.filter((p) => p.kind !== "stakes");
        for (let i = 0; i < pieces.length; i++) {
          for (let j = i + 1; j < pieces.length; j++) {
            const a = pieces[i]!, b = pieces[j]!;
            if (joined(a, b)) continue;
            // (the engine stands on its own siding)
            if ((a.kind === "siding" && b.tech === "railway") || (b.kind === "siding" && a.tech === "railway")) continue;
            expect(depth(piecePoly(a), piecePoly(b)), `${st}: ${a.kind} at ${a.x.toFixed(1)},${a.z.toFixed(1)} passes into ${b.kind} at ${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeLessThan(-0.3);
          }
        }
        const extra = [...outpostObstacles(st, true, t, region).filter((o) => o.tag === "pole" && telegraphPoles(region).some((q) => q.x === o.x && q.z === o.z)), ...rivalPostObstacles(2, t, region)];
        for (const o of extra) for (const p of pieces) expect(depth(obstaclePoly(o), piecePoly(p)), `${st}: ${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)} in ${p.kind}`).toBeLessThan(-0.5);
      }
    });
  }

  it("Kessar's road runs up the middle and out through the stockade's gate, clear of every piece, every pole and everything Kessar built (both levels, every stage)", () => {
    for (const level of [1, 2] as const) {
      const legs = roadPolys(level);
      const road = outpostRoad(level)!;
      // the head of the road is the yard's board; its far end lies on the south-bank track
      expect(road.path[0]!.z).toBeLessThan(KESSAR_OUTPOST.site.z - YARD_R + 1);
      for (const st of STAGES) {
        for (const p of outpostPlan(st, "kessar", ALL_TECH).pieces) {
          if (p.kind === "stakes" || p.kind === "sign") continue;
          for (const leg of legs) expect(depth(leg, piecePoly(p)), `level ${level} ${st}: the road under ${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeLessThan(-0.4);
        }
      }
      for (const seed of SEEDS) {
        const w = createKessarWorld(seed, "intact", { outpost: "town", telegraph: true, rivalPost: 2, ...ALL_TECH });
        for (const o of w.obstacles) for (const leg of legs) expect(depth(leg, obstaclePoly(o)), `level ${level} seed ${seed}: the road under ${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBeLessThan(-0.3);
      }
    }
    expect(outpostRoad(0)).toBeUndefined();
  });

  it("the wire's poles stand clear of everything Kessar built and of the seeded dressing, on dry land", () => {
    for (const seed of SEEDS) {
      const w = createKessarWorld(seed, "intact", { outpost: "town", telegraph: true, rivalPost: 2, ...ALL_TECH });
      const poles = telegraphPoles();
      for (const q of poles) {
        expect(createKessarTerrain(seed).waterDepth(q.x, q.z), `pole ${q.x},${q.z} dry`).toBe(0);
        for (const o of w.obstacles) {
          if (o.tag === "pole" && o.kind === "circle" && o.x === q.x && o.z === q.z) continue;
          expect(depth(circlePoly(q.x, q.z, 0.16), obstaclePoly(o)), `seed ${seed}: pole ${q.x},${q.z} in ${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBeLessThan(-0.3);
        }
      }
    }
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
          const w = createKessarWorld(seed, bridge, { outpost: st, telegraph: st === "town", ...ALL_TECH });
          const plan = outpostPlan(st, "kessar", ALL_TECH);
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
        const w = createKessarWorld(7, bridge, { outpost: st, telegraph: st === "town", ...ALL_TECH });
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
      const w = createKessarWorld(7, bridge, { outpost: st, telegraph: st === "town", ...ALL_TECH });
      const r = reach(w, A.landing);
      for (const [name, x, z] of goals) expect(r(x, z), `${st} ${bridge} ${name}`).toBe(true);
      // the stockade's gate is the way in: a point just inside it is reachable too
      if (st === "fortified_outpost") expect(r(S.x, S.z - 12), "inside the stockade").toBe(true);
    }, 120_000);
  }
});

// (re-recorded for D-038: Hollowmere's camp, village doors and footbridge deck were replanned on purpose: two tents, a crate, wider door steps and a deck at most a step above its bank; the obstacle COUNT is unchanged)
// (re-recorded again for the hub-seed defects of D-038's follow-up: the village pads are relaxed so no street seam is steeper than a body can walk (the heights under every obstacle moved by up to ~1 m on the plaza), and one boulder that stood inside the aqueduct on seed 7 (rock at 24.91,-34.53) is no longer there: 473 -> 472. Nothing else moved: the crag, rock and tree streams are untouched.)
// (re-recorded for the overlap audit: two trees whose crowns reached into a cottage's roof and a garden (a tree stands a crown's reach, 4.8 m, from every building) and one crag whose drawn capstone ran into the aqueduct's span are no longer there: 472 -> 469. Nothing else moved: they are filtered out after generation, as the furniture clashes are.)
// (re-recorded for D-097: one dock finger-post moved three metres along the route (at 52 -> 55), its "camp" board having run into the stilt house; the count is unchanged.)
// (D-115: one finger-post fewer, the map room's second, which stood in front of the spawn; nothing else moved, proven on eight seeds)
// (D-117: the village's fields and orchard, appended after everything: the dressing that stood in them is not there (on eight seeds every obstacle that went was within
//  6 m of a field or the orchard; nothing else moved) and their stooks, haycocks, scarecrows, fruit trees, stumps and hive stand are added before the finger-posts, which stay last: 468 -> 474 on seed 7.)
const HOLLOWMERE_ARENA_7 = "474:3973209010";

// ---- D-056: the Society's second post, at Highmark; none in the gorge or the free port -----------------------------------------------------------------------

describe("Highmark's outpost (D-056)", () => {
  const HS = OUTPOST_SITES.highmark!;
  const S = HS.site, R = HS.rivalSite;
  const HL = HIGHMARK_ANCHORS.landing;
  const scatter = (o: Obstacle): boolean => o.tag === "tree" || o.tag === "rock";

  it("the sites: flat, dry, inside the bounds, 30+ m from every story point, the rival 35-45 m off; the foundation is a station; no wire; Vesper and the Saltmarket have none", () => {
    expect(OUTPOST_REGIONS.sort()).toEqual(["highmark", "kessar"]);
    expect(OUTPOST_SITES.vesper).toBeUndefined();
    expect(OUTPOST_SITES.saltmarket).toBeUndefined();
    expect(Math.hypot(R.x - S.x, R.z - S.z)).toBeGreaterThan(35);
    expect(Math.hypot(R.x - S.x, R.z - S.z)).toBeLessThan(45);
    expect(Math.hypot(S.x - HL.x, S.z - HL.z), "a short carry from the landing").toBeLessThan(60);
    for (const seed of SEEDS) {
      const t = createHighmarkTerrain(seed);
      for (const site of [S, R]) {
        let lo = Infinity, hi = -Infinity;
        for (let a = 0; a < 16; a++) {
          const h = t.height(site.x + Math.cos((a * Math.PI) / 8) * 6, site.z + Math.sin((a * Math.PI) / 8) * 6);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        expect(hi - lo, `seed ${seed} relief`).toBeLessThan(1.6);
        expect(t.waterDepth?.(site.x, site.z) ?? 0).toBe(0);
        expect(Math.hypot(site.x, site.z)).toBeLessThan(HIGHMARK_ANCHORS.bounds - 6);
      }
    }
    for (const p of highmarkSitePoints()) expect(Math.hypot(p.x - S.x, p.z - S.z), p.id).toBeGreaterThan(30);
    expect(telegraphPoles("highmark")).toEqual([]);
    const st = stationsFor("highmark").find((x) => x.kind === "foundation")!;
    expect(st).toMatchObject({ x: S.x, z: S.z });
    expect(findStation("highmark", S.x, S.z, 0)?.kind).toBe("foundation");
    for (const r of ["vesper", "saltmarket", "hollowmere"] as const) expect(stationsFor(r).some((x) => x.kind === "foundation"), r).toBe(false);
  });

  it("every piece at every stage stands on dry land, clear of everything the region built, inside the bounds; the herds graze clear of the ring", () => {
    for (const seed of SEEDS) {
      const plain = createHighmarkWorld(seed);
      const t = createHighmarkTerrain(seed);
      for (const p of outpostPlan("town", "highmark", ALL_TECH).pieces.filter((x) => x.solid)) {
        const r = p.shape === "circle" ? p.hx : Math.hypot(p.hx, p.hz);
        expect(t.waterDepth?.(p.x, p.z) ?? 0, `${p.kind} dry`).toBe(0);
        expect(Math.hypot(p.x, p.z) + r).toBeLessThan(HIGHMARK_ANCHORS.bounds - 4);
        for (const o of plain.obstacles) if (!scatter(o)) expect(insideObstacle(o, p.x, p.z, r + 0.5), `seed ${seed} ${p.kind} vs ${o.tag}`).toBe(false);
      }
      for (const h of herdPlan(seed).herds) expect(Math.hypot(h.cx - S.x, h.cz - S.z), "herd ground").toBeGreaterThan(h.r * 1.2 + RING_R + 3);
    }
  });

  it("'none' is the plain world; a stage clears the scatter out of the ring, empties the yard and moves nothing outside it; the world opts follow the region", () => {
    for (const seed of SEEDS) {
      const plain = createHighmarkWorld(seed);
      expect(hashOf(createRegionWorld("highmark", seed, { outpost: "none" }))).toBe(hashOf(plain));
      expect(hashOf(createRegionWorld("highmark", seed, {}))).toBe(hashOf(plain));
      const far = (w: CollisionWorld): string[] => w.obstacles.filter((o) => Math.hypot(o.x - S.x, o.z - S.z) >= RING_R).map((o) => `${o.kind}:${o.tag}:${o.x.toFixed(3)}:${o.z.toFixed(3)}`);
      for (const st of STAGES) {
        const w = createRegionWorld("highmark", seed, { outpost: st, telegraph: true });
        expect(far(w), st).toEqual(far(plain));
        for (const o of w.obstacles) expect(insideObstacle(o, S.x, S.z, YARD_R - 0.3), `${st}: ${o.tag} in the yard`).toBe(false);
        expect(w.obstacles.some((o) => scatter(o) && Math.hypot(o.x - S.x, o.z - S.z) < RING_R)).toBe(false);
        expect(hashOf(w), "no wire at Highmark").toBe(hashOf(createRegionWorld("highmark", seed, { outpost: st })));
      }
    }
    const c = serializeCampaign(newCampaign(7));
    const s = serializeSettlements({ ...newSettlements(), posts: { highmark: { ...foundOutpost(newSettlements(), "highmark", newCampaign(7), 7).posts.highmark!, stage: "settlement" } }, tech: { ...newSettlements().tech, telegraph: true } });
    expect(regionWorldOpts(c, s, "highmark")).toMatchObject({ outpost: "settlement", telegraph: false });
    expect(regionWorldOpts(c, s, "kessar").outpost).toBe("none");
    expect(regionWorldOpts(c, s, "vesper").outpost).toBe("none");
    expect(regionWorldOpts(c, s).outpost).toBe("none");
  });

  it("the nav grid reaches the yard from the landing at every stage, and the real movement step walks into the yard and inside the stockade", () => {
    for (const st of OUTPOST_STAGES) {
      const w = createHighmarkWorld(7, { outpost: st });
      const q = new NavQuery(buildNavGrid(w, regionNavOptions("highmark", w)));
      const path = newNavPath();
      expect(q.open(S.x, S.z), `${st} yard open`).toBe(true);
      expect(q.path(HL.x, HL.z - 3, S.x, S.z, path), `${st} yard reachable`).toBe(true);
      expect(path.complete).toBe(true);
    }
    for (const st of ["fortified_outpost", "town"] as const) {
      const r = reach(createHighmarkWorld(7, { outpost: st }), { x: HL.x, z: HL.z - 3 });
      expect(r(S.x, S.z), `${st} yard`).toBe(true);
      if (st === "fortified_outpost") expect(r(S.x, S.z - 12), "inside the stockade").toBe(true);
    }
  }, 180_000);
});
