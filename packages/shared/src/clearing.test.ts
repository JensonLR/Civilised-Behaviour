import { describe, expect, it } from "vitest";
import { CHARACTER, STEP_DT } from "./constants.ts";
import { createArena } from "./arena.ts";
import { insideObstacle } from "./camp.ts";
import type { Obstacle } from "./collision.ts";
import { PEN, WELL, bridgeDeck, clearingObstacles, getBridge, getFordStones, getWayposts, penFences } from "./clearing.ts";
import { TRAILS, nearTrail, waterEdgeDistance } from "./landscape.ts";
import { createCharState, stepCharacter, yawToWire } from "./movement.ts";

const FURNITURE = ["well", "fence", "waypost", "bridge"];
const SEEDS = [1, 7, 42, 1234, 99999];

const extent = (o: Obstacle): number => (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz));

describe("the clearing's furniture", () => {
  it("is in every arena as obstacles with the right tags, identical on a second build", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const tag of FURNITURE) expect(w.obstacles.filter((o) => o.tag === tag).length, `${tag} seed ${seed}`).toBeGreaterThan(0);
      expect(w.obstacles.filter((o) => o.tag === "well").length).toBe(1);
      expect(w.obstacles.filter((o) => o.tag === "fence").length).toBe(penFences().length);
      expect(w.obstacles.filter((o) => o.tag === "waypost").length).toBe(getWayposts().length);
      expect(w.obstacles.filter((o) => o.tag === "bridge").length).toBe(getBridge().segments.length + 2 * (getBridge().segments.length - 2)); // deck spans + two handrails on each middle span
    }
    expect(clearingObstacles(createArena(3).terrain)).toEqual(clearingObstacles(createArena(3).terrain));
  });

  it("nothing else was built on top of it: no obstacle overlaps a well, fence, signpost or bridge piece (any seed)", () => {
    for (const seed of SEEDS) {
      const w = createArena(seed);
      const furniture = w.obstacles.filter((o) => FURNITURE.includes(o.tag ?? ""));
      for (const f of furniture) {
        for (const o of w.obstacles) {
          if (o === f) continue;
          if (f.tag === "fence" && o.tag === "fence") continue; // sections of one run touch by design
          if (f.tag === "bridge" && o.tag === "bridge") continue;
          if (o.tag === "bridge" && f.tag === "waypost") continue;
          const reach = extent(f) + extent(o);
          if (Math.hypot(f.x - o.x, f.z - o.z) > reach) continue;
          // a coarse check said they are close: test the footprints properly by sampling the smaller one
          let hit = false;
          const step = 0.25;
          for (let dx = -extent(f); dx <= extent(f) && !hit; dx += step) for (let dz = -extent(f); dz <= extent(f) && !hit; dz += step) hit = insideObstacle(f, f.x + dx, f.z + dz, 0) && insideObstacle(o, f.x + dx, f.z + dz, 0);
          expect(hit, `seed ${seed}: ${f.tag} at ${f.x.toFixed(1)},${f.z.toFixed(1)} overlaps ${o.tag ?? "obstacle"} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`).toBe(false);
        }
      }
    }
  });

  it("the well, the pen and the signposts stand on dry ground off the paths; the signposts are beside a path, not on it", () => {
    const w = createArena(7);
    expect(nearTrail(WELL.x, WELL.z, 0.2)).toBe(false);
    expect(waterEdgeDistance(WELL.x, WELL.z)).toBeGreaterThan(3);
    for (const f of penFences()) {
      expect(nearTrail(f.x, f.z, 0), `fence ${f.x},${f.z}`).toBe(false);
      expect(waterEdgeDistance(f.x, f.z)).toBeGreaterThan(2);
    }
    const posts = getWayposts();
    expect(posts.length).toBeGreaterThanOrEqual(3);
    for (const p of posts) {
      expect(nearTrail(p.x, p.z, 0.4), `waypost on ${p.trail}`).toBe(false);
      const trail = TRAILS.find((t) => t.name === p.trail)!;
      let d = Infinity;
      for (let i = 0; i + 1 < trail.line.length; i += 2) d = Math.min(d, Math.hypot(trail.line[i]! - p.x, trail.line[i + 1]! - p.z));
      expect(d, `waypost beside ${p.trail}`).toBeLessThan(4.2);
      expect(waterEdgeDistance(p.x, p.z)).toBeGreaterThan(0.5);
    }
    void w;
  });

  const walk = (w: ReturnType<typeof createArena>, from: { x: number; z: number }, to: { x: number; z: number }, steps = 300): { x: number; z: number } => {
    const s = createCharState(from.x, from.z, w);
    const yaw = yawToWire(Math.atan2(-(to.x - from.x), -(to.z - from.z)));
    for (let i = 0; i < steps; i++) stepCharacter(s, { moveF: 127, moveR: 0, yaw, buttons: 0 }, STEP_DT, w);
    return { x: s.x, z: s.z };
  };

  it("the pen keeps sheep in and lets people in by the gate", () => {
    const w = createArena(7);
    const east = PEN.x + PEN.hx;
    // through the gate, from the camp side into the middle of the pen
    const inside = walk(w, { x: east + 4, z: PEN.z }, { x: PEN.x, z: PEN.z });
    expect(inside.x).toBeLessThan(east - 1.5);
    expect(Math.abs(inside.z - PEN.z)).toBeLessThan(PEN.hz);
    // through each fence run: stopped outside (the north rail; the south rail; the west rail)
    const north = walk(w, { x: PEN.x, z: PEN.z - PEN.hz - 3 }, { x: PEN.x, z: PEN.z }, 200);
    expect(north.z).toBeLessThan(PEN.z - PEN.hz + 0.2);
    const south = walk(w, { x: PEN.x, z: PEN.z + PEN.hz + 3 }, { x: PEN.x, z: PEN.z }, 200);
    expect(south.z).toBeGreaterThan(PEN.z + PEN.hz - 0.2);
    const west = walk(w, { x: PEN.x - PEN.hx - 3, z: PEN.z }, { x: PEN.x, z: PEN.z }, 200);
    expect(west.x).toBeLessThan(PEN.x - PEN.hx + 0.2);
  });

  it("the footbridge carries its path over the stream: a walker crosses it with the shared step, above the water", () => {
    const w = createArena(7);
    const bw = getBridge();
    const deck = bridgeDeck(w.terrain);
    expect(bw.segments.length).toBeGreaterThanOrEqual(3);
    const first = bw.segments[0]!;
    const last = bw.segments[bw.segments.length - 1]!;
    // never more than a small step up from the bank at each end (it may sit a little below the higher bank: a small step down)
    for (const [x, z] of [[first.x0, first.z0], [last.x1, last.z1]] as const) {
      const up = deck - w.terrainHeight(x, z);
      expect(up, `step at ${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThanOrEqual(CHARACTER.stepHeight);
    }
    // the deck really is above the water everywhere along it
    const lt = w.terrain as unknown as { waterDepth(x: number, z: number): number };
    let wet = 0;
    for (const s of bw.segments) {
      const mx = (s.x0 + s.x1) / 2;
      const mz = (s.z0 + s.z1) / 2;
      const surface = w.terrainHeight(mx, mz) + lt.waterDepth(mx, mz);
      if (lt.waterDepth(mx, mz) > 0.05) {
        wet++;
        expect(deck).toBeGreaterThan(surface + 0.1);
      }
    }
    expect(wet, "the bridge spans real water").toBeGreaterThan(0);
    // walk it end to end following the segment ends, in both directions
    for (const dir of [1, -1]) {
      const segs = dir > 0 ? bw.segments : [...bw.segments].reverse().map((q) => ({ x0: q.x1, z0: q.z1, x1: q.x0, z1: q.z0 }));
      const yaw0 = Math.atan2(segs[0]!.z1 - segs[0]!.z0, segs[0]!.x1 - segs[0]!.x0);
      const s = createCharState(segs[0]!.x0 - 1.2 * Math.cos(yaw0), segs[0]!.z0 - 1.2 * Math.sin(yaw0), w);
      let onDeck = 0;
      let target = 0;
      for (let i = 0; i < 60 * 30 && target < segs.length; i++) {
        const seg = segs[target]!;
        if (Math.hypot(seg.x1 - s.x, seg.z1 - s.z) < 0.6) {
          target++;
          continue;
        }
        stepCharacter(s, { moveF: 127, moveR: 0, yaw: yawToWire(Math.atan2(-(seg.x1 - s.x), -(seg.z1 - s.z))), buttons: 0 }, STEP_DT, w);
        if (s.y > deck - 0.05) onDeck++;
      }
      expect(target, `reached the far end (${dir})`).toBe(segs.length);
      expect(onDeck, `spent the crossing on the deck (${dir})`).toBeGreaterThan(20);
    }
  });

  it("the ford's stepping stones lie in the water along the Observatory path", () => {
    const w = createArena(7);
    const stones = getFordStones();
    expect(stones.length).toBeGreaterThanOrEqual(5);
    for (const s of stones) {
      expect(waterEdgeDistance(s.x, s.z), `stone ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBeLessThan(0);
      expect(s.r).toBeGreaterThan(0.25);
      expect(s.r).toBeLessThan(0.6);
      for (const o of w.obstacles) if (o.kind === "circle") expect(Math.hypot(o.x - s.x, o.z - s.z), `stone vs ${o.tag}`).toBeGreaterThan(o.r + s.r * 0.5);
    }
  });
});
