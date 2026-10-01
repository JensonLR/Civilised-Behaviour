import { describe, expect, it } from "vitest";
import { BUTTON, FLAG } from "./constants.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { createCharState, stepCharacter, yawToWire, type CharState } from "./movement.ts";
import { buildNavGrid } from "./nav.ts";
import { createRegionWorld, regionLanding } from "./regions.ts";
import { skylineFrom, skylineStats } from "./skyline.ts";
import {
  VESPER_ANCHORS as A, VESPER_MOUNT_SPOTS, VESPER_SITES as S, VESPER_STOCK, VESPER_TERRACE_Y, VESPER_VIEW_BUDGET, VESPER_WALL_SLOPE, createVesperTerrain, createVesperWorld, vesperCliffHeight,
  vesperEastFoot, vesperFloorY, vesperNavOptions, vesperObstacles, vesperPlan, vesperProps, vesperRoad, vesperRoadDistance, vesperRoadX, vesperSitePoints, vesperSpawn, vesperWestFoot,
} from "./vesper.ts";

const hashOf = (world: CollisionWorld): string => {
  let h = 2166136261;
  const s = JSON.stringify(world.obstacles.map((o) => [o.kind, o.tag, +o.x.toFixed(3), +o.z.toFixed(3), +o.y0.toFixed(3), +o.y1.toFixed(3)]));
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${world.obstacles.length}:${h >>> 0}`;
};
/** What a walker stands on at (x, z): the ground, or the top of a deck or the wharf's planks (the floors of the gorge). */
function surfaceOf(world: CollisionWorld, x: number, z: number): number {
  let y = world.terrainHeight(x, z);
  world.forEachNear(x, z, (o) => {
    if ((o.tag === "jetty" || o.tag === "bridge") && o.kind === "box" && Math.abs(x - o.x) <= o.hx && Math.abs(z - o.z) <= o.hz && o.y1 > y && o.y0 < y + 40) y = Math.max(y, o.y1);
  });
  return y;
}
const open = (world: CollisionWorld, x: number, z: number, r = 0.6): boolean => !world.resolveXZ({ x, z }, surfaceOf(world, x, z), r, 1.8);

describe("Vesper Gorge: the world", () => {
  it("is deterministic per seed across 5 seeds; only the strata noise and the boulders depend on the seed", () => {
    const hashes = new Set<string>();
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const a = createVesperWorld(seed);
      const b = createVesperWorld(seed);
      expect(hashOf(a)).toBe(hashOf(b));
      hashes.add(hashOf(a));
      expect(a.obstacles.length).toBeGreaterThan(80);
      for (const [x, z] of [[0, 0], [12, 40], [-30, -20], [46, 20], [0, -92], [0, 118], [70, -40]] as const) expect(a.terrainHeight(x, z)).toBe(b.terrainHeight(x, z));
      expect(a.terrainHeight(0, 118), "the landing is pinned to the wharf's level").toBeCloseTo(0, 6);
    }
    expect(hashes.size).toBe(5);
    // the buildings, the trestle and the fall do not move with the seed
    const fixed = (seed: number): string => JSON.stringify(createVesperWorld(seed).obstacles.filter((o) => o.tag === "house" || o.tag === "bridge" || o.tag === "wall").map((o) => [o.x, o.z]));
    expect(fixed(1)).toBe(fixed(2));
    expect(vesperObstacles(createVesperTerrain(7), 7)).toEqual(vesperObstacles(createVesperTerrain(7), 7));
    expect(createRegionWorld("vesper", 7).obstacles.length).toBe(createVesperWorld(7).obstacles.length);
  });

  it("the floor climbs to the head at 3.5%, the road follows the gorge's centreline and the headframe terrace stands at the trestle's level", () => {
    const t = createVesperTerrain(7);
    expect(vesperFloorY(118)).toBeCloseTo(0, 9);
    expect(vesperFloorY(-92)).toBeCloseTo(0.035 * 210, 6);
    // along the road no step is steeper than a gentle walk (the dry bed is the steepest thing on it)
    let steepest = 0;
    for (let z = 114; z > -92; z -= 0.5) steepest = Math.max(steepest, Math.abs(t.height(vesperRoadX(z - 0.5), z - 0.5) - t.height(vesperRoadX(z), z)) / 0.5);
    expect(steepest).toBeLessThan(0.55);
    for (const w of A.road) expect(vesperRoadDistance(w.x, w.z), `waypoint ${w.x},${w.z}`).toBeLessThan(0.5);
    expect(vesperRoadX(A.adit.z)).toBeCloseTo(A.adit.x, 6);
    const road = vesperRoad();
    for (let i = 1; i < road.length; i++) expect(Math.hypot(road[i]!.x - road[i - 1]!.x, road[i]!.z - road[i - 1]!.z), `segment ${i}`).toBeLessThan(10);
    // the terrace, the deck and the ledge are one level
    const p = vesperPlan();
    expect(t.height(22, -75)).toBeCloseTo(VESPER_TERRACE_Y, 6);
    expect(t.height(-38, -64)).toBeCloseTo(VESPER_TERRACE_Y, 6);
    expect(p.trestle.y).toBe(VESPER_TERRACE_Y);
    expect(p.headframe.y).toBe(VESPER_TERRACE_Y);
  });

  it("the cliffs are TRUE walls: along both feet and the head, the ground climbs faster than the controller's limit (1.2) within a metre or two, so a walker is refused by the heightfield itself", () => {
    const t = createVesperTerrain(7);
    expect(VESPER_WALL_SLOPE).toBeGreaterThan(1.8);
    let checked = 0;
    for (let z = 110; z > -108; z -= 2) {
      for (const [foot, dir] of [[vesperWestFoot(z), -1], [vesperEastFoot(z), 1]] as const) {
        // the climb 0.3-0.9 m beyond the foot (skip the stretch where the headframe terrace's own wall stands on the foot)
        const x0 = foot + dir * 0.3, x1 = foot + dir * 0.9;
        const slope = (t.height(x1, z) - t.height(x0, z)) / 0.6;
        expect(slope, `foot at z=${z} x=${foot.toFixed(1)}`).toBeGreaterThan(1.3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    // the head wall
    for (let x = -10; x <= 10; x += 2) expect((t.height(x, -113.1) - t.height(x, -112.5)) / 0.6, `head wall at x=${x}`).toBeGreaterThan(1.3);
    // and the wall is as tall as the art direction asks: 30-45 m over the floor, almost everywhere along the gorge
    for (const z of [80, 40, 0, -40, -80]) {
      const h = vesperCliffHeight(z);
      expect(h).toBeGreaterThanOrEqual(30);
      expect(h).toBeLessThanOrEqual(45);
      expect(t.height(vesperWestFoot(z) - 60, z) - t.height(vesperWestFoot(z) + 1, z)).toBeGreaterThan(h * 0.85);
    }
  });

  it("no story anchor stands inside anything that blocks a walker; four spawns, the mount spots and every prop are open", () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const world = createVesperWorld(seed);
      for (const s of vesperSitePoints()) {
        expect(open(world, s.x, s.z), `${s.id} @${seed}`).toBe(true);
        expect(Math.hypot(s.x, s.z), s.id).toBeLessThan(A.bounds - 2);
      }
      for (let i = 0; i < 4; i++) {
        const sp = vesperSpawn(i, 4);
        expect(open(world, sp.x, sp.z), `spawn ${i}`).toBe(true);
        expect(sp.z, "spawn is not on the planks").toBeLessThan(vesperPlan().wharf.z0);
      }
      for (const m of [...VESPER_MOUNT_SPOTS.horses, VESPER_MOUNT_SPOTS.wagon]) expect(open(world, m.x, m.z, 0.9), `mount spot @${seed}`).toBe(true);
      const props = vesperProps(seed, world);
      expect(props.length).toBeGreaterThan(8);
      expect(props.length).toBeLessThanOrEqual(24);
      expect(vesperProps(seed, world)).toEqual(props);
      expect(props.some((p) => p.kind === 1), "no stray powder kegs").toBe(false);
      for (const pr of props) expect(open(world, pr.x, pr.z, 0.3), `prop ${pr.x.toFixed(1)},${pr.z.toFixed(1)} @${seed}`).toBe(true);
      // the scenario's stock stands in the open too
      for (const s of [...VESPER_STOCK.timber, VESPER_STOCK.keg]) expect(open(world, s.x, s.z, 0.35), `stock ${s.x},${s.z} @${seed}`).toBe(true);
    }
  });

  it("authored things do not stand inside each other, keep off the road, and the boulders keep off the road and the story points", () => {
    const world = createVesperWorld(7);
    const tags = new Set(["tent", "flag", "house", "pole", "sign", "waypost", "cart"]);
    const items = world.obstacles.filter((o) => tags.has(o.tag ?? ""));
    const reach = (o: Obstacle): number => (o.kind === "circle" ? o.r : Math.min(o.hx, o.hz));
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!, b = items[j]!;
        // (D-038: the cloister's back mass, piers and end wall, and the records room's walls, are parts of one structure each; `levelAuditRegions.test.ts` audits them as such)
        if (a.tag === "house" && b.tag === "house" && ((a.x < -41 && b.x < -41 && a.z > 25 && a.z < 63 && b.z > 25 && b.z < 63))) continue;
        if (a.kind === "box" && b.kind === "box") {
          // (boxes: no centre inside the other)
          const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
          expect(dx > a.hx + b.hx - 0.01 || dz > a.hz + b.hz - 0.01, `${a.tag}@${a.x.toFixed(1)},${a.z.toFixed(1)} overlaps ${b.tag}@${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBe(true);
          continue;
        }
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.tag}@${a.x.toFixed(1)},${a.z.toFixed(1)} vs ${b.tag}@${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeGreaterThan(reach(a) + reach(b) - 0.01);
      }
    }
    // nothing solid sits on the carriageway (the trestle, its piles and the plug excepted: the road passes under the deck between the piles, and ends at the fall)
    for (const o of world.obstacles) {
      if (o.tag === "bridge" || o.tag === "wall" || o.tag === "jetty" || (o.tag === "rock" && (o.kind === "box" || o.x > 55 || o.x < -55))) continue;
      const e = o.kind === "circle" ? o.r : Math.min(o.hx, o.hz);
      expect(vesperRoadDistance(o.x, o.z), `${o.tag}@${o.x.toFixed(1)},${o.z.toFixed(1)} on the road`).toBeGreaterThan(e + 0.9);
    }
    const boulders = world.obstacles.filter((o) => o.tag === "rock" && o.kind === "circle" && Math.abs(o.x) < 60 && o.z > -108 && o.z < 108);
    expect(boulders.length).toBeGreaterThan(30);
    for (const b of boulders) for (const s of vesperSitePoints()) expect(Math.hypot(b.x - s.x, b.z - s.z), `boulder near ${s.id}`).toBeGreaterThan(4);
  });
});

// ---- reachability with the REAL movement step ---------------------------------------------------------------------------------------------

const CELL = 2;
const span = Math.ceil(A.bounds / CELL);
const key = (i: number, j: number): number => (i + span) * (2 * span + 1) + (j + span);

interface Reach { at(x: number, z: number): boolean; onDeck(x: number, z: number): boolean; maxY: number }

/** A flood fill over (cell, layer): a walker's feet may be on the ground or on a deck above the road, so a cell can be two places. Edges are walked with the REAL step. */
function flood(world: CollisionWorld, from: { x: number; z: number }): Reach {
  const seen = new Map<number, number>();   // key -> feet height of the first arrival
  const st: CharState = createCharState(0, 0, world);
  const probe = { x: 0, z: 0 };
  const layer = (x: number, z: number, y: number): number => (y > world.terrainHeight(x, z) + 2 ? 1 : 0);
  const standable = (x: number, z: number, y: number): boolean => {
    probe.x = x;
    probe.z = z;
    return !world.resolveXZ(probe, world.groundHeight(x, z, y), 0.4, 1.8);
  };
  const tryEdge = (x0: number, z0: number, y0: number, x1: number, z1: number): number | undefined => {
    if (!standable(x0, z0, y0) || !standable(x1, z1, world.groundHeight(x1, z1, y0))) return undefined;
    st.x = x0;
    st.z = z0;
    st.y = y0;
    st.vx = st.vy = st.vz = 0;
    st.flags = FLAG.GROUNDED;
    st.stumble = 0;
    const yaw = yawToWire(Math.atan2(-(x1 - x0), -(z1 - z0)));
    for (let k = 0; k < 40; k++) {
      stepCharacter(st, { moveF: 127, moveR: 0, yaw, buttons: 0 }, 1 / 30, world);
      if (Math.hypot(st.x - x1, st.z - z1) < 0.3) return st.y;   // (arrival is judged to 30 cm: a looser bar lets a walker held at a wall's foot count as having reached the cell above it)
    }
    return undefined;
  };
  let maxY = -99;
  const q: [number, number, number][] = [];
  const si = Math.round(from.x / CELL), sj = Math.round(from.z / CELL);
  const y00 = world.groundHeight(si * CELL, sj * CELL, 1e6 * 0 + world.terrainHeight(si * CELL, sj * CELL));
  seen.set(key(si, sj) * 2, y00);
  q.push([si, sj, y00]);
  while (q.length) {
    const [i, j, y] = q.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      const x1 = ni * CELL, z1 = nj * CELL;
      if (Math.hypot(x1, z1) > A.bounds - 1) continue;
      const ny = tryEdge(i * CELL, j * CELL, y, x1, z1);
      if (ny === undefined) continue;
      const k = key(ni, nj) * 2 + layer(x1, z1, ny);
      if (seen.has(k)) continue;
      seen.set(k, ny);
      q.push([ni, nj, ny]);
      maxY = Math.max(maxY, ny);
    }
  }
  const near = (x: number, z: number, deck: boolean | undefined): boolean => {
    for (const di of [0, -1, 1]) for (const dj of [0, -1, 1]) {
      const i = Math.round(x / CELL) + di, j = Math.round(z / CELL) + dj;
      if (Math.hypot(i * CELL - x, j * CELL - z) > 1.5) continue;
      for (const l of deck === undefined ? [0, 1] : [deck ? 1 : 0]) if (seen.has(key(i, j) * 2 + l)) return true;
    }
    return false;
  };
  return { maxY, at: (x, z) => near(x, z, undefined), onDeck: (x, z) => near(x, z, true) };
}

describe("Vesper Gorge: everything is reachable on foot except the pocket behind the fall", () => {
  const world = createVesperWorld(7);
  const r = flood(world, A.landing);

  it("a flood fill with the real stepCharacter from the landing reaches every story point; the only exception is the miners' pocket, behind the rock fall", () => {
    for (const s of vesperSitePoints()) {
      if (s.id.startsWith("miners")) {
        expect(r.at(s.x, s.z), `${s.id} is sealed in (the fall is a wall)`).toBe(false);
        expect(open(world, s.x, s.z), `${s.id} stands in the open (no collision change is needed to put a miner there)`).toBe(true);
        continue;
      }
      expect(r.at(s.x, s.z), `${s.id} (${s.x},${s.z})`).toBe(true);
    }
  }, 180_000);

  it("the Lower Gallery's miners are placed behind the fall without any collision change: the plug spans the gorge and the dig point is on the near side", () => {
    const f = vesperPlan().fall;
    for (const m of S.miners) expect(m.z, "behind (north of) the plug").toBeLessThan(f.z - f.hz);
    expect(VESPER_STOCK.dig.z).toBeGreaterThan(f.z + f.hz);
    expect(VESPER_STOCK.blast.z).toBeGreaterThan(f.z - f.hz);
    expect(VESPER_STOCK.blast.z).toBeLessThan(f.z + f.hz);
    // the plug is the world's only answer to a scenario: the same function builds the world whatever the run (there is no argument for it to vary on)
    expect(createVesperWorld.length).toBe(1);
    const plug = world.obstacles.find((o) => o.tag === "rock" && o.kind === "box" && o.z === f.z)!;
    expect(plug.kind === "box" && plug.hx).toBeGreaterThanOrEqual(vesperEastFoot(f.z) - 0.01);
    expect(plug.kind === "box" && plug.hx).toBeGreaterThanOrEqual(-vesperWestFoot(f.z) - 0.01);
    // nothing on the pocket's side is reachable: the head of the gorge ends at the fall
    for (let x = -10; x <= 10; x += 2) expect(r.at(x, -100), `x=${x} behind the fall`).toBe(false);
    expect(r.at(0, -92)).toBe(true);
  });

  it("the cliffs and benches are closed: the flood fill never leaves the gorge, never climbs above the trestle's level, and never reaches a rim", () => {
    expect(r.maxY, "highest point walked").toBeLessThan(VESPER_TERRACE_Y + 0.8);
    expect(r.maxY, "(and the terrace is walked)").toBeGreaterThan(VESPER_TERRACE_Y - 0.5);
    // beyond the cliff feet nothing is reachable
    for (const z of [100, 60, 20, -20, -60]) {
      expect(r.at(vesperWestFoot(z) - 6, z), `west of the cliff at z=${z}`).toBe(false);
      expect(r.at(vesperEastFoot(z) + 6, z), `east of the cliff at z=${z}`).toBe(false);
    }
    expect(r.at(-70, 0)).toBe(false);
    expect(r.at(70, 0)).toBe(false);
  });

  it("the trestle is a floor: the tipple ledge is reached by the deck (the ramps under its two ends are hidden by it), and the road passes underneath", () => {
    const p = vesperPlan();
    expect(r.at(-33, -57.5), "the tipple ledge is reachable").toBe(true);   // (D-038: the tipple moved onto the ledge's flat; this is the ledge beside it)
    expect(r.onDeck(0, p.trestle.z), "on the deck").toBe(true);
    expect(r.onDeck(-26, p.trestle.z), "on the deck over the landing's ramp").toBe(true);
    expect(r.at(-33, -62), "on the ledge, level with the deck").toBe(true);   // (D-038: (-36,-62) is inside the tipple now)
    expect(r.at(0, -50), "and the floor under it is walked too").toBe(true);
    expect(r.at(vesperRoadX(-66), -66), "the road under the deck").toBe(true);
    // walking the deck: the real step carries a walker from the terrace to the ledge and up to the deck's level
    const st = createCharState(20, -66, world);
    for (let k = 0; k < 900 && st.x > -30; k++) stepCharacter(st, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-(-34 - st.x), 0)), buttons: BUTTON.SPRINT }, 1 / 30, world);
    expect(st.x, "crossed").toBeLessThan(-30);
    expect(st.y, "on the deck's level the whole way").toBeCloseTo(VESPER_TERRACE_Y, 1);
    // a walker on the road passes under it
    const under = createCharState(vesperRoadX(-58), -58, world);
    for (let k = 0; k < 400 && under.z > -76; k++) stepCharacter(under, { moveF: 127, moveR: 0, yaw: yawToWire(0), buttons: BUTTON.SPRINT }, 1 / 30, world);
    expect(under.z, "walked under the deck").toBeLessThan(-72);
    expect(under.y, "at the floor, not the deck").toBeLessThan(vesperFloorY(under.z) + 1.5);
    // without the east ramp the terrace is walled: pressing straight at its west face from the floor gets nowhere
    const wall = createCharState(10, -50, world);
    for (let k = 0; k < 200; k++) stepCharacter(wall, { moveF: 127, moveR: 0, yaw: yawToWire(-Math.PI / 2), buttons: BUTTON.SPRINT }, 1 / 30, world);
    expect(wall.y, "the terrace's west wall is a wall").toBeLessThan(VESPER_TERRACE_Y - 3);
    expect(wall.x).toBeLessThan(16);
  });

  it("straight-line walks into a cliff, even with a jump, never climb it and are refused by the ground, not by anything invisible", () => {
    for (const [x0, z0, yawDeg] of [[-40, 30, 90], [36, 30, -90], [-44, -20, 90], [0, -100, 0], [36, -50, -90], [10, -50, -90], [-30, -50, 90]] as const) {
      const st = createCharState(x0, z0, world);
      // (yaw 0 is north; +x is east: a positive turn is to the west)
      for (let k = 0; k < 400; k++) stepCharacter(st, { moveF: 127, moveR: 0, yaw: yawToWire((yawDeg * Math.PI) / 180), buttons: BUTTON.SPRINT | (k % 15 === 0 ? BUTTON.JUMP : 0) }, 1 / 30, world);
      expect(st.y - world.terrainHeight(x0, z0), `from (${x0},${z0}) heading ${yawDeg}`).toBeLessThan(6);
      expect(Math.abs(st.x - vesperRoadX(st.z)), `from (${x0},${z0})`).toBeLessThan(60);
    }
  });

  it("the nav grid connects the landing to every reachable site and builds in under 150 ms; the pocket prunes itself", () => {
    const opts = vesperNavOptions(world);
    expect(opts.tag).toBe("vesper");
    const t0 = performance.now();
    const grid = buildNavGrid(world, opts);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(150);
    expect(grid.openCount).toBeGreaterThan(3500);
    const idx = (x: number, z: number): number => Math.floor((z - grid.origin) / grid.cell) * grid.n + Math.floor((x - grid.origin) / grid.cell);
    for (const s of vesperSitePoints()) {
      if (s.id.startsWith("miners")) {
        expect(grid.open[idx(s.x, s.z)], `${s.id} is sealed off the grid`).toBe(0);
        continue;
      }
      expect(grid.open[idx(s.x, s.z)], `${s.id} is an open cell`).toBe(1);
    }
  });
});

describe("Vesper Gorge: the silhouette is a cleft, measured", () => {
  const world = createVesperWorld(7);
  const stats = (x: number, z: number) => skylineStats(skylineFrom(world, x, z));

  it("from the middle of the road the gorge is walled in: walled >= 0.6, mean >= 12 degrees, max >= 20", () => {
    const s = stats(A.road[3]!.x, A.road[3]!.z);
    expect(s.walled).toBeGreaterThanOrEqual(0.6);
    expect(s.mean).toBeGreaterThanOrEqual(12);
    expect(s.max).toBeGreaterThanOrEqual(20);
    // every point of the road from the first bend to the head is a cleft
    for (const w of A.road.slice(2)) expect(stats(w.x, w.z).walled, `walled at ${w.z}`).toBeGreaterThanOrEqual(0.6);
  });

  it("from the landing the cliffs rise on both sides (max >= 14 degrees) and a vertical of rock stands against the sky (spikes >= 1)", () => {
    const s = stats(A.landing.x, A.landing.z);
    expect(s.max).toBeGreaterThanOrEqual(14);
    expect(s.spikes).toBeGreaterThanOrEqual(1);
    // (the mouth is open behind the landing: this is the gorge seen from outside, not yet walled in)
    expect(s.walled).toBeLessThan(0.7);
  });

  it("Kessar's and Highmark's landings do not satisfy the cleft's targets: the targets stay discriminating", () => {
    for (const id of ["kessar", "highmark"] as const) {
      const l = regionLanding(id);
      const s = skylineStats(skylineFrom(createRegionWorld(id, 7), l.x, l.z));
      expect(s.walled < 0.6 || s.mean < 12, `${id} landing: walled ${s.walled.toFixed(2)} mean ${s.mean.toFixed(1)}`).toBe(true);
      expect(s.walled, id).toBeLessThan(0.2);
    }
  });

  it("the view budget is declared for every preset and never loosened", () => {
    expect(VESPER_VIEW_BUDGET.meshes.test).toBeLessThanOrEqual(22);
    expect(VESPER_VIEW_BUDGET.meshes.high).toBeLessThanOrEqual(46);
    expect(VESPER_VIEW_BUDGET.triangles.high).toBeLessThanOrEqual(540_000);
  });
});
