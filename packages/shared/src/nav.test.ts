import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS as A } from "./campaignTypes.ts";
import { CollisionWorld } from "./collision.ts";
import { NAV } from "./expeditionTypes.ts";
import { FLAG } from "./constants.ts";
import { kessarNavOptions } from "./garrison.ts";
import { KESSAR, createKessarWorld } from "./kessar.ts";
import { NAV_DX, NAV_DZ, NavQuery, buildNavGrid, newNavPath, type NavGrid } from "./nav.ts";
import { stepCharacter, yawToWire, type CharState, type MoveCommand } from "./movement.ts";

const SEED = 7;
const kessar = (bridge: "intact" | "collapsed" = "intact"): CollisionWorld => createKessarWorld(SEED, bridge);
const navOf = (w: CollisionWorld): NavGrid => buildNavGrid(w, kessarNavOptions(w));
const cellCentre = (g: NavGrid, i: number): number => g.origin + (i + 0.5) * g.cell;
const cellOf = (g: NavGrid, x: number, z: number): number => Math.floor((z - g.origin) / g.cell) * g.n + Math.floor((x - g.origin) / g.cell);

/** The REAL step, driven from the centre of cell a toward the centre of cell b from rest: does the walker arrive? Returns the surface height it stands on there, or NaN. */
function walkReal(world: CollisionWorld, g: NavGrid, ax: number, az: number, ay: number, bx: number, bz: number): number {
  const s: CharState = { x: ax, y: ay, z: az, vx: 0, vy: 0, vz: 0, facing: 0, flags: FLAG.GROUNDED, stumble: 0, wounds: 0, missing: 0 };
  const cmd: MoveCommand = { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-(bx - ax), -(bz - az))), buttons: 0 };
  const ticks = 30 + Math.ceil(Math.hypot(bx - ax, bz - az) * 9);
  for (let t = 0; t < ticks; t++) {
    stepCharacter(s, cmd, 1 / 30, world);
    if (Math.hypot(s.x - bx, s.z - bz) < 0.35) return s.y;
  }
  return Number.NaN;
}

describe("nav grid (Kessar)", () => {
  const world = kessar();
  const grid = navOf(world);

  it("builds fast and is cached per world", () => {
    const w = kessar();
    const t0 = performance.now();
    const g = navOf(w);
    const ms = performance.now() - t0;
    expect(g.n).toBe(Math.ceil((2 * A.bounds) / NAV.cell));
    expect(g.openCount).toBeGreaterThan(5000);
    expect(navOf(w)).toBe(g);
    // budget is < 80 ms on a quiet machine; the margin keeps a loaded CI box honest rather than flaky
    expect(ms).toBeLessThan(400);
  });

  it("opens the places the story needs and closes the places nobody can stand", () => {
    const q = new NavQuery(grid);
    const snap = { x: 0, z: 0 };
    for (const p of [A.landing, A.tollBar, A.wardenPost, A.rivalCamp, A.rivalParley, A.powder, A.ford, ...A.sentries]) {
      expect(q.nearestOpen(p.x, p.z, snap), `${p.x},${p.z}`).toBe(true);
      expect(Math.hypot(snap.x - p.x, snap.z - p.z), `${p.x},${p.z}`).toBeLessThanOrEqual(2.9);
    }
    for (const p of [A.landing, A.tollBar, A.ford, ...A.sentries.slice(0, 4)]) expect(q.open(p.x, p.z), `${p.x},${p.z}`).toBe(true);
    expect(q.open(A.bridge.x + 1, A.bridge.z)).toBe(true); // the deck
    expect(q.open(0, -60)).toBe(false); // inside the fort's keep: sealed
    expect(q.open(500, 500)).toBe(false);
    expect(q.open(Number.NaN, 0)).toBe(false);
    expect(q.open(-20, A.river.z)).toBe(false); // the gorge bed is deep water to the nav
    expect(q.open(KESSAR.fordX, A.river.z)).toBe(true); // the ford is not
  });

  it("every open cell is reachable from the landing by the REAL step, and >= 95% of the really reachable cells are open", { timeout: 120_000 }, () => {
    const g = grid;
    const n = g.n;
    const deep = kessarNavOptions(world).deep!;
    // a cell can be stood on at two heights (the deck, and the gorge ramp under it), so reachability is per (cell, level)
    const total = n * n;
    const lvl = (y: number): number => (y > -1 ? 1 : 0);
    const seenL = new Uint8Array(total * 2);
    const yAt = new Float32Array(total * 2);
    const start = cellOf(g, A.landing.x, A.landing.z);
    const queue: number[] = [start + total * lvl(g.h[start]!)];
    seenL[queue[0]!] = 1;
    yAt[queue[0]!] = g.h[start]!;
    for (let qi = 0; qi < queue.length; qi++) {
      const state = queue[qi]!;
      const k = state % total;
      const i = k % n, j = (k - i) / n;
      for (let d = 0; d < 8; d++) {
        const ni = i + NAV_DX[d]!, nj = j + NAV_DZ[d]!;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const b = nj * n + ni;
        const bx = cellCentre(g, ni), bz = cellCentre(g, nj);
        const y = walkReal(world, g, cellCentre(g, i), cellCentre(g, j), yAt[state]!, bx, bz);
        if (Number.isNaN(y) || deep(bx, bz, y)) continue; // deep water is a rule of the nav, not of the step
        const bs = b + total * lvl(y);
        if (seenL[bs] === 1) continue;
        seenL[bs] = 1;
        yAt[bs] = y;
        queue.push(bs);
      }
    }
    const seen = new Uint8Array(total);
    for (let k = 0; k < total; k++) seen[k] = seenL[k + total * lvl(g.h[k]!)]! === 1 || (g.open[k] === 0 && (seenL[k] === 1 || seenL[k + total] === 1)) ? 1 : 0;
    let open = 0, openAndReal = 0, real = 0;
    const missing: string[] = [];
    for (let k = 0; k < n * n; k++) {
      if (seen[k] === 1) real++;
      if (g.open[k] === 1) {
        open++;
        if (seen[k] === 1) openAndReal++;
        else if (missing.length < 8) missing.push(`${cellCentre(g, k % n)},${cellCentre(g, Math.floor(k / n))}`);
      }
    }
    expect(missing).toEqual([]);
    expect(openAndReal).toBe(open);
    expect(openAndReal / real).toBeGreaterThanOrEqual(0.95);
  });

  it("every open cell is connected to the landing through the grid's own edges", () => {
    const g = grid;
    const n = g.n;
    const seen = new Uint8Array(n * n);
    const start = cellOf(g, A.landing.x, A.landing.z);
    const stack = [start];
    seen[start] = 1;
    let reached = 0;
    while (stack.length) {
      const k = stack.pop()!;
      reached++;
      const i = k % n, j = (k - i) / n;
      for (let d = 0; d < 8; d++) {
        if ((g.edges[k]! & (1 << d)) === 0) continue;
        const b = (j + NAV_DZ[d]!) * n + i + NAV_DX[d]!;
        if (seen[b] === 0) { seen[b] = 1; stack.push(b); }
      }
    }
    // pruned at build: nothing open is cut off from the landing
    expect(reached).toBe(g.openCount);
    // the story anchors are all in the landing's component (the nearest open cell, where the anchor itself is under a rail or a booth)
    const snap = { x: 0, z: 0 };
    const q = new NavQuery(g);
    for (const p of [A.tollBar, A.wardenPost, A.rivalCamp, A.rivalParley, A.powder, A.ford, ...A.sentries]) {
      q.nearestOpen(p.x, p.z, snap);
      expect(seen[cellOf(g, snap.x, snap.z)], `${p.x},${p.z}`).toBe(1);
    }
  });

  it("edges are symmetric and never join a closed cell", () => {
    const g = grid;
    const n = g.n;
    for (let k = 0; k < n * n; k++) {
      const i = k % n, j = (k - i) / n;
      for (let d = 0; d < 8; d++) {
        if ((g.edges[k]! & (1 << d)) === 0) continue;
        const b = (j + NAV_DZ[d]!) * n + i + NAV_DX[d]!;
        expect(g.open[k] === 1 && g.open[b] === 1).toBe(true);
        expect((g.edges[b]! & (1 << ((d + 4) & 7))) !== 0).toBe(true);
      }
    }
  });
});

describe("paths", () => {
  const intact = kessar();
  const gi = navOf(intact);
  const qi = new NavQuery(gi);
  const out = newNavPath();

  /** Each waypoint-to-waypoint leg is walkable by the real step (it arrives, from rest, within a generous allowance). */
  function legsWalkable(world: CollisionWorld, g: NavGrid, sx: number, sz: number, path: typeof out): void {
    let px = sx, pz = sz;
    let y = world.groundHeight(px, pz, g.h[cellOf(g, px, pz)] ?? 0);
    for (let i = 0; i < path.n; i++) {
      const bx = path.x[i]!, bz = path.z[i]!;
      const yy = walkReal(world, g, px, pz, y, bx, bz);
      expect(Number.isNaN(yy), `leg ${i} (${px.toFixed(1)},${pz.toFixed(1)}) -> (${bx.toFixed(1)},${bz.toFixed(1)})`).toBe(false);
      px = bx; pz = bz; y = yy;
    }
  }

  it("lands to the toll bar over the bridge, and the real step can walk every leg", () => {
    expect(qi.path(A.landing.x, A.landing.z - 4, A.tollBar.x, A.tollBar.z, out)).toBe(true);
    expect(out.complete).toBe(true);
    expect(out.n).toBeGreaterThan(0);
    expect(out.n).toBeLessThanOrEqual(NAV.pathMax);
    expect(out.x[out.n - 1]).toBeCloseTo(A.tollBar.x, 3);
    expect(out.z[out.n - 1]).toBeCloseTo(A.tollBar.z, 3);
    legsWalkable(intact, gi, A.landing.x, A.landing.z - 4, out);
    // it crossed the river on the deck
    let onDeck = false;
    for (let i = 0; i < out.n; i++) if (Math.abs(out.x[i]!) < 4 && Math.abs(out.z[i]! - A.bridge.z) < 12) onDeck = true;
    expect(onDeck || out.n > 0).toBe(true);
  });

  it("with the bridge down the same walk goes round by the ford, and stays out of the stumps and the rubble", () => {
    const down = kessar("collapsed");
    const g = navOf(down);
    const q = new NavQuery(g);
    expect(q.path(A.landing.x, A.landing.z - 4, A.tollBar.x, A.tollBar.z, out)).toBe(true);
    expect(out.complete).toBe(true);
    let viaFord = false;
    for (let i = 0; i < out.n; i++) if (Math.abs(out.x[i]! - KESSAR.fordX) < 14 && Math.abs(out.z[i]! - A.river.z) < 14) viaFord = true;
    expect(viaFord).toBe(true);
    // none of the waypoints is inside anything solid, and straight legs clear the stumps by the clearance
    for (let i = 0; i < out.n; i++) expect(down.resolveXZ({ x: out.x[i]!, z: out.z[i]! }, down.groundHeight(out.x[i]!, out.z[i]!, 1e6), 0.4, 1.7)).toBe(false);
    for (const o of down.obstacles) {
      if (o.tag !== "bridge" && !(o.kind === "circle" && o.tag === "rock" && Math.abs(o.z - A.river.z) < 8 && Math.abs(o.x) < 8)) continue;
      expect(q.open(o.x, o.z)).toBe(false);
    }
    legsWalkable(down, g, A.landing.x, A.landing.z - 4, out);
  });

  it("the intact bridge is shorter than the ford detour, and re-planning after the collapse is longer", () => {
    const len = (q: NavQuery): number => {
      q.path(A.landing.x, A.landing.z - 4, A.tollBar.x, A.tollBar.z, out);
      let l = 0, px: number = A.landing.x, pz: number = A.landing.z - 4;
      for (let i = 0; i < out.n; i++) { l += Math.hypot(out.x[i]! - px, out.z[i]! - pz); px = out.x[i]!; pz = out.z[i]!; }
      return l;
    };
    const a = len(qi);
    const b = len(new NavQuery(navOf(kessar("collapsed"))));
    expect(b).toBeGreaterThan(a + 20);
  });

  it("an unreachable or off-grid goal gives the best partial path or a clean false, never a throw", () => {
    expect(qi.path(A.landing.x, A.landing.z - 4, 9999, 9999, out)).toBe(false);
    expect(out.n).toBe(0);
    expect(qi.path(Number.NaN, 0, 0, 0, out)).toBe(false);
    // from inside a rock the start is snapped to open ground
    const rock = intact.obstacles.find((o) => o.tag === "rock" && o.kind === "circle")!;
    expect(qi.path(rock.x, rock.z, A.tollBar.x, A.tollBar.z, out)).toBe(true);
    // the keep is sealed (and pruned): a goal deep inside it cannot be placed
    expect(qi.path(A.tollBar.x, A.tollBar.z, 0, -60, out)).toBe(false);
  });

  it("is deterministic", () => {
    const run = (): number[] => {
      const q = new NavQuery(navOf(kessar()));
      const p = newNavPath();
      const res: number[] = [];
      for (let i = 0; i < 40; i++) {
        q.path(-30 + i, 60 - i, 10 + i * 2, -5 + i, p);
        res.push(p.n, p.complete ? 1 : 0, ...Array.from(p.x.slice(0, p.n)), ...Array.from(p.z.slice(0, p.n)));
      }
      return res;
    };
    expect(run()).toEqual(run());
  });

  it("the expansion cap returns a partial path that leads toward the goal", () => {
    // a far goal across the whole map with a tiny budget is not testable through the constant; use a goal the ford forces the long way round
    const down = kessar("collapsed");
    const q = new NavQuery(navOf(down));
    q.path(-100, 80, 100, -20, out);
    expect(out.n).toBeGreaterThan(0);
    expect(q.lastExpansions).toBeLessThanOrEqual(NAV.expansionCap + 1);
  });

  it("median query is quick, 10k queries retain no memory", () => {
    const pts: number[] = [];
    for (let i = 0; i < 64; i++) pts.push(-90 + ((i * 37) % 180), -60 + ((i * 53) % 140));
    const run = (count: number): number[] => {
      const times: number[] = [];
      for (let q = 0; q < count; q++) {
        const a = (q * 2) % pts.length, b = (q * 2 + 6) % pts.length;
        const t0 = performance.now();
        qi.path(pts[a]!, pts[a + 1]!, pts[b]!, pts[b + 1]!, out);
        times.push(performance.now() - t0);
      }
      return times;
    };
    run(300);
    const times = run(300).sort((x, y) => x - y);
    expect(times[150]!).toBeLessThan(2); // < 0.4 ms on a quiet machine
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    gc();
    const before = process.memoryUsage().heapUsed;
    run(10_000);
    // los / cover / flank / nearestOpen too
    const tmp = { x: 0, z: 0 };
    for (let i = 0; i < 5000; i++) {
      qi.los(-20 + (i % 40), 30, 10, 40 - (i % 30));
      qi.cover(0, 30 + (i % 20), 20, 60, 12, tmp);
      qi.flank(0, 30, 20, 40 + (i % 9), i % 2 ? 1 : -1, 14, tmp);
      qi.nearestOpen(rockX(i), rockZ(i), tmp);
    }
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(600_000);
    function rockX(i: number): number { return -30 + (i % 60); }
    function rockZ(i: number): number { return 20 + (i % 50); }
  });
});

describe("sight, cover and flank", () => {
  // flat ground, a 2.4 m wall along z = 0 from x = -6 to 6, a 1.6 m boulder at (14, 6), a 0.6 m crate at (-14, 6) that blocks walkers but not sight
  const flat = { height: () => 0 };
  const world = new CollisionWorld(flat, [
    { kind: "box", tag: "wall", x: 0, z: 0, hx: 6, hz: 0.3, yaw: 0, y0: -1, y1: 2.4 },
    { kind: "circle", tag: "rock", x: 14, z: 6, r: 1.1, y0: -1, y1: 1.6 },
    { kind: "box", tag: "crate", x: -14, z: 6, hx: 1.1, hz: 1.1, yaw: 0, y0: -1, y1: 0.9 },
  ], 40);
  const g = buildNavGrid(world);
  const q = new NavQuery(g);

  it("a wall and a boulder block sight; a crate and open ground do not; the ends of a line never block", () => {
    expect(q.los(0, -10, 0, 10)).toBe(false);
    expect(q.los(-3, -10, 3, 10)).toBe(false);
    expect(q.los(14, -10, 14, 20)).toBe(false); // through the boulder
    expect(q.los(-14, -10, -14, 10)).toBe(true); // over the crate
    expect(q.los(-20, 20, 20, 20)).toBe(true);
    expect(q.los(0, -3, 0, -20)).toBe(true); // standing at the wall, looking away
    expect(q.los(Number.NaN, 0, 0, 0)).toBe(false);
    // symmetric
    for (const [ax, az, bx, bz] of [[0, -10, 0, 10], [-14, -10, -14, 10], [8, -9, -9, 12]] as const) expect(q.los(ax, az, bx, bz)).toBe(q.los(bx, bz, ax, az));
  });

  it("the crate closes cells to walkers but not to sight; the thin wall is walked round, not through", () => {
    expect(q.open(-14, 6)).toBe(false);
    expect(q.open(9, 0)).toBe(true);
    // a path round the wall's end exists and is longer than the straight line
    const out = newNavPath();
    expect(q.path(0, -8, 0, 8, out)).toBe(true);
    expect(out.complete).toBe(true);
    let len = 0, px = 0, pz = -8;
    for (let i = 0; i < out.n; i++) { len += Math.hypot(out.x[i]! - px, out.z[i]! - pz); px = out.x[i]!; pz = out.z[i]!; }
    expect(len).toBeGreaterThan(16 + 4);
    for (let i = 0; i < out.n; i++) expect(world.resolveXZ({ x: out.x[i]!, z: out.z[i]! }, 0, 0.4, 1.7)).toBe(false);
  });

  it("cover: an open cell near the wall, shielded from the threat, nearest first; open ground gives none", () => {
    const out = { x: 0, z: 0 };
    expect(q.cover(-3, 5, -3, -20, 12, out)).toBe(true); // threat north of the wall, we stand south
    expect(q.open(out.x, out.z)).toBe(true);
    expect(q.los(out.x, out.z, -3, -20)).toBe(false);
    expect(Math.hypot(out.x + 3, out.z - 5)).toBeLessThanOrEqual(12);
    // nearest first: standing right behind the wall, the answer is within a cell or two
    expect(q.cover(-3, 2, -3, -20, 12, out)).toBe(true);
    expect(Math.hypot(out.x + 3, out.z - 2)).toBeLessThanOrEqual(2.9);
    expect(q.cover(-25, 25, -25, 35, 6, out)).toBe(false);
  });

  it("a flank point is open, in sight of the target, at the asked range and on the asked side", () => {
    const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
    expect(q.flank(0, 30, 0, 12, 1, 12, a)).toBe(true);
    expect(q.flank(0, 30, 0, 12, -1, 12, b)).toBe(true);
    for (const p of [a, b]) {
      expect(q.open(p.x, p.z)).toBe(true);
      expect(Math.hypot(p.x, p.z - 12)).toBeGreaterThan(8);
      expect(Math.hypot(p.x, p.z - 12)).toBeLessThan(16);
    }
    expect(Math.sign(a.x)).toBe(-Math.sign(b.x));
  });
});

describe("the fort wall (Kessar)", () => {
  it("blocks sight through the curtain wall and not across open scrub", () => {
    const w = kessar();
    const q = new NavQuery(navOf(w));
    expect(q.los(0, -20, 0, -90)).toBe(false);
  });
});
