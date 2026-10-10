import { describe, expect, it } from "vitest";
import { PROP_DEFS, PropKind, type PropSpawn } from "./props.ts";
import { REGIONS, createRegionWorld, regionLanding, regionProps, regionSpawn } from "./regions.ts";
import type { RegionId } from "./campaignTypes.ts";

const IDS = Object.keys(REGIONS) as RegionId[];
import { spawnPoint } from "./arena.ts";
import {
  ARRIVAL,
  ARRIVAL_TOWARD,
  HUB_ARRIVAL,
  arrivalCentre,
  barrelHuddle,
  chairCircle,
  compose,
  crateStack,
  inArrival,
  kitKegSpots,
  pieceRadius,
  placeStillLife,
  type StillLife,
} from "./stores.ts";

/** D-115: the stores are still lifes, set out by someone who meant it, and never in the arrival. */
const CRATE_H = PROP_DEFS[PropKind.CRATE].half[1] * 2;
const SEEDS = [1, 7, 42, 1337, 90210];
/** Every piece of every still life a region authors, on every seed: a new wall or tree that pushes a piece out fails here, loudly. */
const EXPECTED: Record<string, number> = { hollowmere: 14, kessar: 14, highmark: 24, vesper: 23, saltmarket: 14 };

describe("D-115: the still lifes", () => {
  it("a crate stack is courses, each crate across the two below it, a crate's height up", () => {
    const s = crateStack([3, 2, 1]);
    expect(s).toHaveLength(6);
    expect(s.filter((p) => p.up === 0)).toHaveLength(3);
    for (const p of s.filter((q) => q.up > 0)) {
      expect(p.on).toHaveLength(2);
      const [a, b] = p.on.map((i) => s[i]!);
      expect(p.up).toBeCloseTo(a!.up + CRATE_H, 1);
      expect(p.lz).toBeCloseTo((a!.lz + b!.lz) / 2, 6);
    }
    // a course wider than the one beneath is cut to fit
    expect(crateStack([2, 2])).toHaveLength(3);
  });

  it("chairs round a fire face it, in the world as well as the frame", () => {
    for (const yaw of [0, 0.7, -2.1, Math.PI]) {
      const out: PropSpawn[] = [];
      placeStillLife({ x: 10, z: -4, yaw, pieces: chairCircle(4, 2, -1, 1) }, () => true, out);
      expect(out).toHaveLength(4);
      for (const c of out) {
        // a chair faces (sin yaw, cos yaw)
        const fx = Math.sin(c.yaw);
        const fz = Math.cos(c.yaw);
        const tx = (10 - c.x) / 2;
        const tz = (-4 - c.z) / 2;
        expect(fx * tx + fz * tz, `yaw ${yaw}`).toBeGreaterThan(0.95);
      }
    }
  });

  it("a piece that does not fit is not there, nor anything resting on it", () => {
    const out: PropSpawn[] = [];
    const missed: number[] = [];
    // the left-hand bottom crate's ground is taken: it goes, and so does the crate above that rests on it
    const sl: StillLife = { x: 0, z: 0, yaw: 0, pieces: compose(crateStack([2, 1]), barrelHuddle(3)) };
    placeStillLife(sl, (_x, z) => z > -0.2 || z < -1.5, out, (_x, _z, k) => missed.push(k));
    expect(out.filter((p) => p.kind === PropKind.CRATE)).toHaveLength(1);
    expect(out.filter((p) => p.up)).toHaveLength(0);
    expect(missed.filter((k) => k === PropKind.CRATE)).toHaveLength(2);
  });

  it("the arrival is the ring, the view up the way and the camera's ground, and not the ground beside them", () => {
    const c = { x: 0, z: 100 };
    expect(inArrival(c, ARRIVAL_TOWARD, 1, 101, 0.3)).toBe(true);   // in the ring
    expect(inArrival(c, ARRIVAL_TOWARD, 1, 100 - ARRIVAL.aheadL + 1, 0.3)).toBe(true);   // up the way
    expect(inArrival(c, ARRIVAL_TOWARD, 0.5, 104, 0.3)).toBe(true);   // where the camera hangs
    expect(inArrival(c, ARRIVAL_TOWARD, 7, 100, 0.5)).toBe(false);   // beside the ring
    expect(inArrival(c, ARRIVAL_TOWARD, 5, 90, 0.5)).toBe(false);   // beside the way
    expect(inArrival(c, ARRIVAL_TOWARD, 0, 100 - ARRIVAL.aheadL - 2, 0.5)).toBe(false);   // past the first view
    expect(arrivalCentre(spawnPoint)).toEqual({ x: expect.closeTo(HUB_ARRIVAL.x, 9), z: expect.closeTo(HUB_ARRIVAL.z, 9) });
  });
});

describe("D-115: every region's stores", () => {
  for (const id of IDS) {
    it(`${id}: every piece set out on every seed, none in the arrival, every stacked crate on two`, () => {
      const centre = arrivalCentre((i, n) => regionSpawn(id, i, n));
      for (const seed of SEEDS) {
        const world = createRegionWorld(id, seed);
        const props = regionProps(id, seed, world);
        expect(props.length, `${id} @${seed}`).toBe(EXPECTED[id]);
        for (const p of props) expect(inArrival(centre, ARRIVAL_TOWARD, p.x, p.z, pieceRadius(p.kind)), `${id} ${p.x.toFixed(1)},${p.z.toFixed(1)} @${seed}`).toBe(false);
        for (const p of props.filter((q) => q.up)) {
          const under = props.filter((q) => q.kind === PropKind.CRATE && Math.abs((q.up ?? 0) + CRATE_H - p.up!) < 0.05 && Math.hypot(q.x - p.x, q.z - p.z) < 0.6);
          expect(under.length, `${id} stacked ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(2);
        }
      }
    });
  }

  it("nothing authored stands in a landing's ring but the slim lamp posts that frame the way on (no sign, no crate, no tree)", () => {
    for (const id of IDS) {
      const c = arrivalCentre((i, n) => regionSpawn(id, i, n));
      for (const seed of SEEDS) {
        for (const o of createRegionWorld(id, seed).obstacles) {
          const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
          if (Math.hypot(o.x - c.x, o.z - c.z) >= ARRIVAL.ringR + r) continue;
          expect(o.tag === "pole" && r <= 0.25, `${id} ${o.tag}@${o.x.toFixed(1)},${o.z.toFixed(1)} @${seed}`).toBe(true);
        }
      }
    }
  });

  it("the expedition's own kegs come ashore beside the arrival, not in it, apart and clear of the stores", () => {
    for (const id of IDS) {
      if (id === "hollowmere") continue;
      const centre = arrivalCentre((i, n) => regionSpawn(id, i, n));
      for (const seed of SEEDS) {
        const world = createRegionWorld(id, seed);
        const props = regionProps(id, seed, world);
        const kegs = kitKegSpots(regionLanding(id), centre, world, props, 6);
        expect(kegs, `${id} @${seed}`).toHaveLength(6);
        for (const k of kegs) {
          expect(inArrival(centre, ARRIVAL_TOWARD, k.x, k.z, pieceRadius(PropKind.BARREL)), `${id} keg ${k.x},${k.z}`).toBe(false);
          expect(Math.hypot(k.x - regionLanding(id).x, k.z - regionLanding(id).z), `${id}: still at the landing`).toBeLessThan(12);
          for (const p of props) expect(Math.hypot(p.x - k.x, p.z - k.z)).toBeGreaterThan(0.9);
        }
      }
    }
  });
});
