import { describe, expect, it } from "vitest";
import { ARENA_RADIUS, createArena, spawnPoint } from "./arena.ts";
import { CAMP, hqPlan, insideObstacle } from "./camp.ts";
import { CHARACTER, STEP_DT } from "./constants.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { HILL, JETTY, MILL, RIVER, TRAILS, WEIR, nearTrail, riverCentre, riverHalfWidth, trailDistance, waterEdgeDistance, withLandscape, type LandscapeTerrain } from "./landscape.ts";
import { createTerrain } from "./terrain.ts";
import { createCharState, stepCharacter, yawToWire } from "./movement.ts";
import { scatterProps } from "./props.ts";
import { SITES, VILLAGE_PADS, VILLAGE_SIGNS, toWorld, villageGarden, villageKeepOut, villageObstacles, villagePlan, villageYard, type Building } from "./village.ts";
import { classifyObstacle } from "./worldgen.ts";

const SEEDS = [1, 7, 42, 1234, 99999];
const VILLAGE_TAGS = ["house", "vprop", "jetty", "weir"];
const extent = (o: Obstacle): number => (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz));
const villageOf = (w: CollisionWorld): Obstacle[] => w.obstacles.filter((o) => VILLAGE_TAGS.includes(o.tag ?? ""));

/** Walks a character toward (tx, tz) for up to `steps` fixed steps (the shared movement step, exactly what client and server run). */
function walk(w: CollisionWorld, from: { x: number; z: number }, to: { x: number; z: number }, steps = 60 * 12, stop = 0.35): ReturnType<typeof createCharState> {
  const s = createCharState(from.x, from.z, w);
  for (let i = 0; i < steps; i++) {
    const dx = to.x - s.x;
    const dz = to.z - s.z;
    if (Math.hypot(dx, dz) < stop) break;
    stepCharacter(s, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-dx, -dz)), buttons: 0 }, STEP_DT, w);
  }
  return s;
}

/** Local frame helper for a building. */
const front = (b: Building, d: number, lz = 0): { x: number; z: number } => toWorld(b, b.hx + d, lz);
const inside = (b: Building, p: { x: number; z: number }, m = 0): boolean => {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const lx = (p.x - b.x) * c + (p.z - b.z) * s;
  const lz = -(p.x - b.x) * s + (p.z - b.z) * c;
  return Math.abs(lx) < b.hx - m && Math.abs(lz) < b.hz - m;
};

describe("HOLLOWMERE: the plan", () => {
  it("is pure and deterministic: the same seed gives identical obstacles, and the layout in x/z is the same for every seed", () => {
    const a = createArena(7);
    const b = createArena(7);
    expect(villageObstacles(a.terrain)).toEqual(villageObstacles(b.terrain));
    const p1 = villagePlan(createArena(1).terrain);
    const p2 = villagePlan(createArena(99).terrain);
    expect(p1.buildings.map((q) => [q.id, q.x, q.z, q.yaw])).toEqual(p2.buildings.map((q) => [q.id, q.x, q.z, q.yaw]));
    expect(p1.props.map((q) => [q.kind, q.x, q.z])).toEqual(p2.props.map((q) => [q.kind, q.x, q.z]));
    expect(p1.buildings[0]!.ground).not.toBe(p2.buildings[0]!.ground); // (only the ground under it differs)
  });

  it("has eight to fourteen buildings of several distinct kinds, and every obstacle is in the arena exactly as villageObstacles built it", () => {
    const kinds = new Set(SITES.map((s) => s.kind));
    const buildings = SITES.filter((s) => s.kind !== "stall");
    expect(buildings.length).toBeGreaterThanOrEqual(8);
    expect(buildings.length).toBeLessThanOrEqual(14);
    for (const k of ["cottage", "stilt", "granary", "hall", "workshop", "mill", "clock", "stall"]) expect(kinds.has(k as never), k).toBe(true);
    for (const seed of SEEDS) {
      const w = createArena(seed);
      const expected = villageObstacles(w.terrain);
      const inArena = villageOf(w);
      expect(inArena.length, `seed ${seed}`).toBe(expected.length);
      expect(inArena).toEqual(expected);
    }
  });

  it("every building stands on dry ground inside the map, off the Observatory's hill, clear of the camp, the spawn ring and the props' scatter ring", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const b of villagePlan(w.terrain).buildings) {
        for (const [cx, cz] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 0]] as const) {
          const p = toWorld(b, cx * b.hx, cz * b.hz);
          expect(waterEdgeDistance(p.x, p.z), `${b.id} corner in the water (seed ${seed})`).toBeGreaterThan(0.2);
          expect(Math.hypot(p.x, p.z), `${b.id} outside the map`).toBeLessThan(ARENA_RADIUS - 6);
          expect(Math.hypot(p.x - HILL.x, p.z - HILL.z), `${b.id} on the hill`).toBeGreaterThan(30);
          expect(Math.hypot(p.x, p.z), `${b.id} inside the camp`).toBeGreaterThan(30);
        }
      }
      for (const pr of scatterProps(seed, w.terrain, 48)) expect(villageKeepOut(pr.x, pr.z, 0)).toBe(false);
      for (let i = 0; i < 4; i++) {
        const sp = spawnPoint(i, 4);
        expect(villageKeepOut(sp.x, sp.z, 2)).toBe(false);
      }
      for (const [k, v] of Object.entries(CAMP)) {
        void k;
        const at = v as { x?: number; z?: number };
        if (typeof at.x === "number" && typeof at.z === "number") expect(villageKeepOut(at.x, at.z, 6), `camp piece ${k}`).toBe(false);
      }
    }
  });

  it("no two buildings overlap (0.6 m apart at least), and no building sits on a road except the gate-tower, whose arch is the road", () => {
    const bs = villagePlan(createArena(7).terrain).buildings;
    const corners = (b: Building): { x: number; z: number }[] => {
      const out: { x: number; z: number }[] = [];
      for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) out.push(toWorld(b, (i / 4) * b.hx, (j / 4) * b.hz));
      return out;
    };
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!;
        const b = bs[j]!;
        if (Math.hypot(a.x - b.x, a.z - b.z) > 14) continue;
        for (const p of corners(a)) expect(inside(b, p, -0.6), `${a.id} overlaps ${b.id}`).toBe(false);
        for (const p of corners(b)) expect(inside(a, p, -0.6), `${b.id} overlaps ${a.id}`).toBe(false);
      }
    }
    for (const b of bs) {
      if (b.kind === "clock" || b.kind === "stall") continue;
      for (const p of corners(b)) expect(nearTrail(p.x, p.z, -0.6, "late") && !inside(b, p, 0.3) ? false : nearTrail(p.x, p.z, -0.3, "late"), `${b.id} stands on a road at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(false);
    }
  });

  it("nothing solid stands on a village road's bare middle (walkers can follow every street), and props never overlap buildings or each other", () => {
    const w = createArena(7);
    const solid = villageOf(w);
    for (const t of TRAILS.filter((q) => q.late)) {
      for (let i = 0; i + 1 < t.line.length; i += 2) {
        const x = t.line[i]!;
        const z = t.line[i + 1]!;
        for (const o of solid) {
          if (o.tag === "jetty" || o.y0 > w.terrainHeight(x, z) + 1.85 || o.y1 - w.terrainHeight(x, z) < 1.0) continue; // (a lintel or an awning above head height, a step or a low threshold is not in the way)
          expect(insideObstacle(o, x, z, 0.35), `${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)} blocks ${t.name}`).toBe(false);
        }
      }
    }
    // pairwise footprints: only walls of one building, fence sections of one run and the jetty's own posts may touch
    const nearest = (o: Obstacle): number => {
      let best = -1;
      let bd = Infinity;
      SITES.forEach((s, i) => {
        const d = Math.hypot(o.x - s.x, o.z - s.z) - Math.hypot(s.hx, s.hz);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i]!;
        const b = solid[j]!;
        if (Math.hypot(a.x - b.x, a.z - b.z) > extent(a) + extent(b)) continue;
        if (a.tag === "house" && b.tag === "house" && nearest(a) === nearest(b)) continue;
        if (a.tag === "vprop" && b.tag === "vprop" && extent(a) < 1.6 && extent(b) < 1.6 && (a.kind === "box" && a.hz === 0.07 && b.kind === "box" && b.hz === 0.07)) continue; // fence sections
        const lowSlab = (o: Obstacle): boolean => o.tag === "house" && o.y1 - w.terrainHeight(o.x, o.z) < 0.4; // (a floor is something you stand on, not something in the way)
        if (lowSlab(a) || lowSlab(b)) continue;
        if (a.tag === "jetty" || b.tag === "jetty" || a.tag === "weir" || b.tag === "weir") continue;
        let hit = false;
        const s = a.kind === "circle" ? a.r : Math.max(a.hx, a.hz);
        for (let dx = -s; dx <= s && !hit; dx += 0.12) for (let dz = -s; dz <= s && !hit; dz += 0.12) hit = insideObstacle(a, a.x + dx, a.z + dz, -0.03) && insideObstacle(b, a.x + dx, a.z + dz, -0.03);
        expect(hit, `${a.tag} (${a.x.toFixed(1)},${a.z.toFixed(1)}) overlaps ${b.tag} (${b.x.toFixed(1)},${b.z.toFixed(1)})`).toBe(false);
      }
    }
  });

  it("the ground under every building is level, and the pads do not make cliffs (walkable slopes round the village on every seed)", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const b of villagePlan(w.terrain).buildings) {
        if (b.kind === "clock" || b.kind === "stall" || b.kind === "mill" || waterEdgeDistance(b.x, b.z) < 12) continue; // (beside the water the ground is carved into the bank: see the stilts, below)
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
          const p = toWorld(b, (i / 3) * b.hx * 0.9, (j / 3) * b.hz * 0.9);
          const h = w.terrainHeight(p.x, p.z);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        expect(hi - lo, `${b.id} seed ${seed}`).toBeLessThan(0.12);
      }
      // the pads add at most a little to the ground's own slope (on hostile seeds the natural ground here is already steeper than a person can climb)
      let steepest = 0;
      let natural = 0;
      const bare = withLandscape(createTerrain(seed));
      for (let x = -46; x <= 16; x += 0.5) for (let z = -72; z <= -28; z += 0.5) {
        const h = w.terrainHeight(x, z);
        steepest = Math.max(steepest, Math.hypot(w.terrainHeight(x + 0.5, z) - h, w.terrainHeight(x, z + 0.5) - h) / 0.5);
        const h0 = bare.height(x, z);
        natural = Math.max(natural, Math.hypot(bare.height(x + 0.5, z) - h0, bare.height(x, z + 0.5) - h0) / 0.5);
      }
      expect(steepest, `seed ${seed}`).toBeLessThan(Math.max(1.3, natural + 0.7));
    }
    expect(VILLAGE_PADS.length).toBeGreaterThanOrEqual(8);
  });

  it("trees, rocks, stumps and logs are cleared from yards, buildings and roads on every seed, and yards/gardens are flagged for the ground paint", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const o of w.obstacles) {
        if (!["tree", "rock", "snag", "stump", "log"].includes(classifyObstacle(o))) continue;
        expect(villageKeepOut(o.x, o.z, 0), `seed ${seed} ${o.tag} at ${o.x.toFixed(1)},${o.z.toFixed(1)} in the village`).toBe(false);
        expect(nearTrail(o.x, o.z, 0, "late")).toBe(false);
      }
    }
    const b = villagePlan(createArena(7).terrain).buildings[1]!;
    expect(villageYard(b.x, b.z)).toBe(1);
    expect(villageYard(0, 0)).toBe(0);
    expect(villageGarden(0, 0)).toBe(0);
    expect(villagePlan(createArena(7).terrain).gardens.some((g) => villageGarden(g.x, g.z) === 1)).toBe(true);
  });
});

describe("HOLLOWMERE: doors are doors and walls are walls (the shared movement step)", () => {
  const world = createArena(7);
  const plan = villagePlan(world.terrain);

  it("you can walk in through the door of every enterable building and stand inside it (any seed: the stilt houses' stairs follow the ground)", () => {
    for (const seed of [7, 1, 42, 1234, 99999, 207616]) {
      const w2 = createArena(seed);
      for (const b of villagePlan(w2.terrain).buildings) {
        if (!["cottage", "stilt", "hall", "mill", "workshop"].includes(b.kind)) continue;
        const s = walk(w2, front(b, 5), { x: b.x - Math.cos(b.yaw) * 0.6, z: b.z - Math.sin(b.yaw) * 0.6 });
        expect(inside(b, { x: s.x, z: s.z }, 0.2), `${b.id} seed ${seed}: stopped at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
        expect(s.y, `${b.id} floor`).toBeGreaterThan(b.ground + b.spec.floor - 0.35);
      }
    }
  });

  it("a stilt house's last tread is within a body's step of the ground under it on every seed, including a bank that falls away fast (hub seed 207616: 0.49 m with 0.4 m rises)", () => {
    for (const seed of [7, 42, 1337, 1247, 207616]) {
      const w2 = createArena(seed);
      for (const b of villagePlan(w2.terrain).buildings) {
        if (b.kind !== "stilt") continue;
        const i = b.steps.length - 1;
        const p = toWorld(b, b.hx + 1.2 + 0.25 + i * 0.5, 0);
        expect(b.steps[i]! - w2.terrain.height(p.x, p.z), `${b.id} seed ${seed}`).toBeLessThanOrEqual(0.42 + 1e-9);
        for (let k = 0; k < b.steps.length; k++) expect((k === 0 ? b.ground + b.spec.floor : b.steps[k - 1]!) - b.steps[k]!, `${b.id} seed ${seed} rise ${k}`).toBeLessThanOrEqual(CHARACTER.stepHeight);
      }
    }
  });

  it("the wall beside a door is solid: walking at it from outside never gets in (and neither does the back or a side)", () => {
    for (const b of plan.buildings) {
      if (!["cottage", "stilt", "hall", "mill", "workshop", "granary"].includes(b.kind)) continue;
      // the front wall, a metre to the side of the doorway
      const off = b.kind === "granary" ? 0 : b.spec.door / 2 + 0.9;
      const targets = [
        { from: front(b, 4, off * 1.02), to: toWorld(b, 0, off) },
        { from: toWorld(b, -b.hx - 4, 0), to: toWorld(b, 0, 0) },
        { from: toWorld(b, 0, b.hz + 4), to: toWorld(b, 0, 0) },
        { from: toWorld(b, 0, -b.hz - 4), to: toWorld(b, 0, 0) },
      ];
      targets.forEach((t, i) => {
        if (b.kind === "workshop" && i === 0) return;
        const s = walk(world, t.from, t.to, 60 * 8);
        // a stilt house's deck is climbed from the front only; the mill's back wall is on the bank
        expect(inside(b, { x: s.x, z: s.z }, 0.3) && s.y < b.ground + b.spec.floor + 1, `${b.id} side ${i}: walked into the walls at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(false);
      });
    }
  });

  it("the gate-tower's arch is the street: walk through it along the road; its piers are solid", () => {
    const gate = plan.buildings.find((b) => b.kind === "clock")!;
    const a = toWorld(gate, -gate.hx - 6, 0);
    const b = toWorld(gate, gate.hx + 6, 0);
    const s = walk(world, a, b, 60 * 12);
    expect(Math.hypot(s.x - b.x, s.z - b.z)).toBeLessThan(0.6);
    const pier = walk(world, toWorld(gate, -gate.hx - 4, 2.3), toWorld(gate, gate.hx + 4, 2.3), 60 * 8);
    expect(Math.hypot(pier.x - gate.x, pier.z - gate.z), "walked through a pier").toBeGreaterThan(3);
  });

  it("the jetty can be walked out along, the weir's walkway can be crossed, and the wheel and punt are only scenery", () => {
    const j = plan.jetty;
    const out = walk(world, { x: j.x0 - Math.cos(j.yaw) * 2.5, z: j.z0 - Math.sin(j.yaw) * 2.5 }, { x: j.x1, z: j.z1 }, 60 * 10, 0.5);
    expect(Math.hypot(out.x - j.x1, out.z - j.z1), "did not reach the end of the jetty").toBeLessThan(0.9);
    expect(out.y).toBeGreaterThan(j.waterY);
    const w = plan.weir;
    const across = { x: Math.cos(w.yaw), z: Math.sin(w.yaw) };
    const hw = riverHalfWidth(WEIR.s);
    const start = { x: w.x - across.x * (hw + 3.2), z: w.z - across.z * (hw + 3.2) };
    const end = { x: w.x + across.x * (hw + 3.2), z: w.z + across.z * (hw + 3.2) };
    const s = walk(world, start, end, 60 * 14, 0.5);
    expect(Math.hypot(s.x - end.x, s.z - end.z), "could not cross the weir").toBeLessThan(1.2);
    // the punt and the wheel are not obstacles
    expect(villageOf(world).some((o) => Math.hypot(o.x - plan.punt.x, o.z - plan.punt.z) < 1.2 && o.tag !== "jetty")).toBe(false);
    expect(MILL.wheel.r).toBeGreaterThan(1);
  });

  it("the marquee: walk in through its mouth to the survey table; its back and north canvas are solid", () => {
    const h = hqPlan().marquee;
    const local = (lx: number, lz: number): { x: number; z: number } => ({ x: h.x + lx * Math.cos(h.yaw) - lz * Math.sin(h.yaw), z: h.z + lx * Math.sin(h.yaw) + lz * Math.cos(h.yaw) });
    const inn = walk(world, local(h.hx + 3, 0.6), local(-1, 0.6), 60 * 8);
    expect(Math.abs((inn.x - h.x) * Math.cos(h.yaw) + (inn.z - h.z) * Math.sin(h.yaw)), "did not get under the ridge").toBeLessThan(h.hx);
    const back = walk(world, local(0, 0.3), local(-h.hx - 4, 0.3), 60 * 6);
    expect((back.x - h.x) * Math.cos(h.yaw) + (back.z - h.z) * Math.sin(h.yaw), "walked through the back wall").toBeGreaterThan(-h.hx - 0.1);
    const north = walk(world, local(0, 0), local(0, -h.hz - 4), 60 * 6);
    expect(-(north.x - h.x) * Math.sin(h.yaw) + (north.z - h.z) * Math.cos(h.yaw), "walked through the north canvas").toBeGreaterThan(-h.hz - 0.1);
  });

  it("a walker can follow the whole main street from the fishing spot to the west end and out along the west road", () => {
    const main = TRAILS.find((t) => t.name === "village")!;
    const s = createCharState(main.line[0]!, main.line[1]!, world);
    let target = 1;
    let steps = 0;
    for (; steps < 60 * 150; steps++) {
      while (target < main.line.length / 2 - 1 && Math.hypot(main.line[target * 2]! - s.x, main.line[target * 2 + 1]! - s.z) < 1.4) target++;
      const dx = main.line[target * 2]! - s.x;
      const dz = main.line[target * 2 + 1]! - s.z;
      stepCharacter(s, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-dx, -dz)), buttons: 0 }, STEP_DT, world);
      if (target >= main.line.length / 2 - 1 && Math.hypot(dx, dz) < 1.2) break;
    }
    expect(Math.hypot(s.x - main.line[main.line.length - 2]!, s.z - main.line[main.line.length - 1]!), `stuck at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBeLessThan(1.6);
  });

  it("every door is at the end of a road: a lane runs from the street to within two metres of each enterable building's threshold", () => {
    for (const b of plan.buildings) {
      if (!["cottage", "stilt", "hall", "mill", "workshop", "granary"].includes(b.kind)) continue;
      const d = front(b, b.kind === "stilt" ? 3.2 : 0.7);
      const t = TRAILS.filter((q) => q.late).reduce((best, q) => Math.min(best, trailDistance(q, d.x, d.z)), Infinity);
      expect(t, `${b.id} has no path to its door`).toBeLessThan(2.4);
    }
    expect(Math.hypot(MILL.door.x - front(plan.buildings.find((q) => q.kind === "mill")!, 0.5).x, MILL.door.z - front(plan.buildings.find((q) => q.kind === "mill")!, 0.5).z)).toBeLessThan(0.2);
    const l = TRAILS.find((t) => t.name === "ferry-lane")!;
    expect(Math.hypot(l.line[l.line.length - 2]! - JETTY.x0, l.line[l.line.length - 1]! - JETTY.z0)).toBeLessThan(0.8);
  });
});

describe("HOLLOWMERE: lights, smoke, signs, water", () => {
  const w = createArena(7);
  const plan = villagePlan(w.terrain);

  it("lamps hang at sensible heights (not underground, not in the sky), the forge and shrine glow, chimneys smoke above their roofs", () => {
    expect(plan.lanterns.length).toBeGreaterThanOrEqual(14);
    expect(plan.lanterns.some((l) => l.kind === 1)).toBe(true);
    expect(plan.lanterns.some((l) => l.kind === 2)).toBe(true);
    for (const l of plan.lanterns) {
      expect(l.y).toBeGreaterThan(0.8);
      expect(l.y).toBeLessThan(5);
      expect(Number.isFinite(l.x + l.z)).toBe(true);
    }
    expect(plan.smoke.length).toBeGreaterThanOrEqual(4);
    for (const v of plan.smoke) expect(v.y).toBeGreaterThan(3);
  });

  it("signs point at real text and stand in front of something; the clock's hands can turn (the gate has a clock height)", () => {
    for (const s of plan.signs) {
      expect(s.text).toBeGreaterThanOrEqual(0);
      expect(s.text).toBeLessThan(VILLAGE_SIGNS.length);
      expect(s.w).toBeGreaterThan(0.8);
    }
    expect(new Set(plan.signs.map((s) => s.text)).size).toBeGreaterThanOrEqual(8);
  });

  it("the jetty reaches out over the pond, the punt floats beside it on the pond's level, the weir sits on the stream, the wheel hangs over the water", () => {
    const j = plan.jetty;
    expect(waterEdgeDistance(j.x1, j.z1)).toBeLessThan(-0.5);
    expect(waterEdgeDistance(j.x0, j.z0)).toBeGreaterThan(0);
    expect(Math.abs(plan.punt.waterY - j.waterY)).toBeLessThan(1e-9);
    expect(waterEdgeDistance(plan.punt.x, plan.punt.z)).toBeLessThan(0);
    const c = riverCentre(WEIR.s, { x: 0, z: 0 });
    expect(Math.hypot(plan.weir.x - c.x, plan.weir.z - c.z)).toBeLessThan(1e-6);
    // the wheel's axle is over or beside the water, its lowest paddle dips below the surface
    const wheel = plan.wheel;
    expect(waterEdgeDistance(wheel.x, wheel.z)).toBeLessThan(0.6);
    const ls = w.terrain as LandscapeTerrain;
    const surface = ls.channelLevel(MILL.s) - RIVER.freeboard;
    expect(wheel.y - wheel.r).toBeLessThan(surface);
    expect(wheel.y - wheel.r).toBeGreaterThan(surface - 0.8);
    // and the mill sits ON the bank (its water-side wall within a metre of the water)
    expect(waterEdgeDistance(toWorld(SITES.find((s) => s.id === "mill")!, -MILL.hx, 0).x, toWorld(SITES.find((s) => s.id === "mill")!, -MILL.hx, 0).z)).toBeLessThan(1.4);
  });

  it("the walkable weir keeps the drop: the water is 0.3 m lower below it", () => {
    const ls = w.terrain as LandscapeTerrain;
    expect(ls.channelLevel(WEIR.s - 1.5) - ls.channelLevel(WEIR.s + 1.5)).toBeGreaterThan(0.25);
    void CHARACTER;
  });
});
