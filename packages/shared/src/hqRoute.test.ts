import { describe, expect, it } from "vitest";
import { CAMP, JETTY, segmentDistance, createArena, createCharState, stepCharacter, yawToWire, regionSpawn, buildNavGrid, NAV_DX, NAV_DZ, classifyObstacle, type CollisionWorld } from "./index.ts";
import { ROUTE_CLEAR, hqPins, hqRoute, hqRouteObstacles, type HqSign, type Pt } from "./hqRoute.ts";
import { ROUTE_TEXT } from "./hqRouteText.ts";

const SEEDS = [1, 7, 91, 1234, 99999];
const dist2Line = (p: Pt, line: readonly Pt[]): number => {
  let d = Infinity;
  for (let i = 0; i + 1 < line.length; i++) d = Math.min(d, segmentDistance(p.x, p.z, line[i]!.x, line[i]!.z, line[i + 1]!.x, line[i + 1]!.z));
  return d;
};

/** Walks the real step along a line (steering at each vertex in turn); returns how far off the line the body ever strayed and where it ended. */
function walk(world: CollisionWorld, from: Pt, line: readonly Pt[], maxSeconds: number): { reached: boolean; worstOff: number; seconds: number; end: Pt } {
  const s = createCharState(from.x, from.z, world);
  const dt = 1 / 30;
  let wp = 0;
  let worst = 0;
  let t = 0;
  for (; t < maxSeconds && wp < line.length; t += dt) {
    const p = line[wp]!;
    if (Math.hypot(p.x - s.x, p.z - s.z) < 0.7) {
      wp++;
      continue;
    }
    stepCharacter(s, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-(p.x - s.x), -(p.z - s.z))), buttons: 0 }, dt, world);
    if (wp > 0) worst = Math.max(worst, dist2Line(s, line));
  }
  return { reached: wp >= line.length, worstOff: worst, seconds: t, end: { x: s.x, z: s.z } };
}

describe("hqRoute: the authored lines and their finger-posts", () => {
  const r = hqRoute();

  it("is deterministic and shaped as documented", () => {
    expect(hqRoute()).toBe(hqRoute());
    expect(r.dock.length).toBeGreaterThan(8);
    expect(r.map.length).toBeGreaterThanOrEqual(3);
    expect(r.signs.length).toBeGreaterThanOrEqual(4);
    expect(r.signs.length).toBeLessThanOrEqual(8);
    expect(new Set(r.signs.map((s) => s.id)).size).toBe(r.signs.length);
    for (const s of r.signs) {
      expect(Number.isFinite(s.x + s.z + s.r + s.height)).toBe(true);
      expect(s.boards.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("the dock line ends at the jetty's foot and the map line at the survey table", () => {
    const e = r.dock[r.dock.length - 1]!;
    expect(Math.hypot(e.x - JETTY.x0, e.z - JETTY.z0)).toBeLessThan(0.6);
    const m = r.map[r.map.length - 1]!;
    expect(Math.hypot(m.x - CAMP.mapTable.x, m.z - CAMP.mapTable.z)).toBeLessThan(2.4); // inside the map station's reach
  });

  it("the posts stand at least 1.2 m off the walking lines (centre to line), on dry ground, clear of every other solid", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const s of r.signs) {
        const line = s.route === "dock" ? r.dock : r.map;
        expect(dist2Line(s, line), s.id).toBeGreaterThanOrEqual(ROUTE_CLEAR);
        expect(dist2Line(s, r.dock) >= ROUTE_CLEAR && dist2Line(s, r.map) >= ROUTE_CLEAR, `${s.id} is clear of BOTH lines`).toBe(true);
        const t = w.terrain as unknown as { waterDepth(x: number, z: number): number };
        expect(t.waterDepth(s.x, s.z), `${s.id} stands in water`).toBe(0);
        for (const o of w.obstacles) {
          if (o.tag === "fingerpost") continue;
          const reach = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
          if (o.tag === "bridge" || o.tag === "jetty" || o.tag === "weir") continue; // floors: a post beside one is fine
          expect(Math.hypot(o.x - s.x, o.z - s.z), `${s.id} (seed ${seed}) inside a ${o.tag}`).toBeGreaterThan(reach + s.r);
        }
      }
    }
  });

  it("are solid in the world (tag fingerpost, appended last), and the same world otherwise", () => {
    const w = createArena(91);
    const posts = w.obstacles.filter((o) => classifyObstacle(o) === "fingerpost");
    expect(posts).toHaveLength(r.signs.length);
    expect(w.obstacles.slice(-posts.length)).toEqual(posts); // last: nothing before it moved
    const s = createCharState(posts[0]!.x - 3, posts[0]!.z, w);
    for (let i = 0; i < 90; i++) stepCharacter(s, { moveF: 0, moveR: 127, yaw: yawToWire(-Math.PI / 2 * 0), buttons: 0 }, 1 / 30, w);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(hqRouteObstacles(w.terrain)).toEqual(posts);
  });

  it("both lines are WALKED by the real step from the spawn ring on every seed: arrive, never detouring more than a metre", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      const sp = regionSpawn("hollowmere", 0, 4);
      const map = walk(w, sp, r.map, 60);
      expect(map.reached, `map, seed ${seed}`).toBe(true);
      expect(map.worstOff, `map, seed ${seed}`).toBeLessThan(1);
      const dock = walk(w, sp, r.dock, 120);
      expect(dock.reached, `dock, seed ${seed}`).toBe(true);
      expect(dock.worstOff, `dock, seed ${seed}`).toBeLessThan(1);
      expect(Math.hypot(dock.end.x - JETTY.x0, dock.end.z - JETTY.z0)).toBeLessThan(3); // inside the dock station's radius
    }
  });

  it("a flood-fill from the spawn (shared step rules, 1 m cells) reaches the dock and the map table with the posts in place", () => {
    for (const seed of [91, 7]) {
      const w = createArena(seed);
      const g = buildNavGrid(w, { cell: 1, clearance: 0.4, bounds: 90 });
      const n = g.n;
      const at = (x: number, z: number): number => Math.floor((z - g.origin) / g.cell) * n + Math.floor((x - g.origin) / g.cell);
      const seen = new Uint8Array(n * n);
      const start = at(2.1, 2.1);
      expect(g.open[start]).toBe(1);
      seen[start] = 1;
      const q = [start];
      for (let h = 0; h < q.length; h++) {
        const k = q[h]!;
        const i = k % n;
        const j = (k - i) / n;
        for (let d = 0; d < 8; d++) {
          if ((g.edges[k]! & (1 << d)) === 0) continue;
          const k2 = (j + NAV_DZ[d]!) * n + i + NAV_DX[d]!;
          if (!seen[k2]) {
            seen[k2] = 1;
            q.push(k2);
          }
        }
      }
      const reachesWithin = (x: number, z: number, rad: number): boolean => {
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) if (Math.hypot(dx, dz) <= rad && seen[at(x + dx, z + dz)]) return true;
        return false;
      };
      expect(reachesWithin(CAMP.mapTable.x, CAMP.mapTable.z, 2), `map table, seed ${seed}`).toBe(true);
      expect(reachesWithin(JETTY.x0, JETTY.z0, 2), `dock, seed ${seed}`).toBe(true);
      // and every authored vertex of both lines is open ground
      for (const p of [...r.dock, ...r.map]) expect(seen[at(p.x, p.z)], `(${p.x}, ${p.z})`).toBe(1);
    }
  });

  it("the lettering is short, filled in, and free of real-world terms", () => {
    const BANNED = /(?<![a-z])(england|english|britain|british|london|paris|france|french|germany|german|spain|china|india|america|american|europe|african|africa|christian|muslim|jewish|church|bible|pope|union jack)(?![a-z])/i;
    const all: HqSign[] = r.signs;
    for (const s of all) {
      for (const b of s.boards) {
        expect(b.text.length, b.text).toBeGreaterThan(2);
        expect(b.text.length, b.text).toBeLessThanOrEqual(44);
        expect(b.text).not.toContain("{");
        expect(BANNED.test(b.text), b.text).toBe(false);
        expect(Number.isFinite(b.yaw + b.y + b.len)).toBe(true);
      }
    }
    for (const lines of Object.values(ROUTE_TEXT)) for (const t of lines) expect(BANNED.test(t), t).toBe(false);
    // the nearest dock post says how far the dock is, and the distance falls along the way
    const dockAhead = all.filter((s) => s.route === "dock").map((s) => Number(/(\d+) m/.exec(s.boards[0]!.text)?.[1]));
    expect(dockAhead.every(Number.isFinite)).toBe(true);
    expect([...dockAhead].sort((a, b) => b - a)).toEqual(dockAhead);
  });

  it("pins for the compass: the survey table and the dock", () => {
    const p = hqPins(CAMP.mapTable);
    expect(p.map((x) => x.id)).toEqual(["map", "dock"]);
    expect(p[0]).toMatchObject({ x: CAMP.mapTable.x, z: CAMP.mapTable.z });
    expect(p[1]).toMatchObject({ x: JETTY.x0, z: JETTY.z0 });
  });
});
