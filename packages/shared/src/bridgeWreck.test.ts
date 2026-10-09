import { describe, expect, it } from "vitest";
import { FALL, WRECK, bridgeLips, bridgeWreckObstacles, kessarBridgeWreck, obbOverlap, wreckCorners, wreckKeepouts, wreckLandTime, wreckPoseAt, type WreckPose } from "./bridgeWreck.ts";
import { KESSAR, createKessarWorld, kessarPlan } from "./kessar.ts";

/** D-097: the Kessar bridge's fall. The span's pieces lie in the gorge, touching nothing but the ground, and fall there on a timetable that ends exactly where they lie. */
describe("the bridge's fall (D-097)", () => {
  const world = createKessarWorld(7, "collapsed");
  const T = world.terrain;
  const pieces = kessarBridgeWreck(T);
  const L = KESSAR.level;

  it("is a pure plan: the same pieces every time; eight runs of deck (the end ones hung from the broken faces) and six of parapet", () => {
    expect(kessarBridgeWreck(createKessarWorld(7, "collapsed").terrain)).toEqual(pieces);
    expect(pieces.filter((p) => p.kind === "deck")).toHaveLength(WRECK.runs * 2);
    expect(pieces.filter((p) => p.kind === "parapet")).toHaveLength(6);
    expect(pieces.filter((p) => p.hinge)).toHaveLength(4);
    // what the pieces were covers the span between the two broken ends, deck and parapets
    const [lipN, lipS] = bridgeLips();
    const decks = pieces.filter((p) => p.kind === "deck");
    expect(Math.min(...decks.map((p) => p.from.z - p.size[2] / 2))).toBeCloseTo(lipN + WRECK.overhang, 0);
    expect(Math.max(...decks.map((p) => p.from.z + p.size[2] / 2))).toBeCloseTo(lipS - WRECK.overhang, 0);
  });

  it("every piece lies in the gorge: on the ground (not floating, not buried), below the banks, clear of every other piece, the pier stumps and the broken ends", () => {
    const keep = wreckKeepouts();
    pieces.forEach((p, i) => {
      const cs = wreckCorners(p.size, p.rest);
      // (a hung end run's near edge is bedded in the broken face it hangs from, on the bank: its far end is what lies in the gorge)
      for (const c of cs.filter((_, k) => !p.hinge || (k % 2 ? 1 : -1) === p.hinge.dir)) {
        expect(T.height(c[0], c[2]), `piece ${i} over the gorge`).toBeLessThan(L - 0.45);
        expect(c[1], `piece ${i} below the lip`).toBeLessThan(L + 0.15);
      }
      // resting on the ground: its lowest corner at the ground (less the sink), none of it deep in it (a hung end run is bedded in its broken face at the top only)
      const gap = Math.min(...cs.map((c) => c[1] - T.height(c[0], c[2])));
      expect(gap, `piece ${i} rests on the ground`).toBeLessThan(0.05);
      if (!p.hinge) expect(gap, `piece ${i} not buried`).toBeGreaterThan(-WRECK.sink - 0.35);
      for (let j = i + 1; j < pieces.length; j++) expect(obbOverlap(p.size, p.rest, pieces[j]!.size, pieces[j]!.rest, 0.02), `pieces ${i} and ${j}`).toBe(false);
      if (!p.hinge) for (const k of keep) expect(obbOverlap(p.size, p.rest, k.size, k.pose, 0.02), `piece ${i} clear of the stumps and ends`).toBe(false);
    });
  });

  it("the fall: each piece starts in the bridge, holds until its delay, and lands exactly where it lies at its landing time; the middle lets go first", () => {
    const out: WreckPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    for (const p of pieces) {
      expect(wreckPoseAt(p, 0, out)).toMatchObject({ x: p.from.x, y: p.from.y, z: p.from.z, rx: 0, ry: 0, rz: 0 });
      const t1 = wreckLandTime(p);
      expect(t1).toBeGreaterThan(p.delay + 0.3);
      expect(t1).toBeLessThan(3);
      const end = { ...wreckPoseAt(p, t1 + 1e-6, out) };
      for (const k of ["x", "y", "z", "rx", "ry", "rz"] as const) expect(end[k], k).toBeCloseTo(p.rest[k], 3);
      // and it never goes below where it comes to rest on the way down (a free piece's drop is ballistic; a hung one swings down to it)
      for (let t = p.delay; t < t1; t += 0.05) expect(wreckPoseAt(p, t, out).y).toBeGreaterThanOrEqual(p.rest.y - 0.05);
    }
    const mid = (bridgeLips()[0] + bridgeLips()[1]) / 2;
    const near = pieces.filter((p) => p.kind === "deck" && Math.abs(p.from.z - mid) < 3);
    const ends = pieces.filter((p) => p.hinge);
    expect(Math.max(...near.map((p) => p.delay))).toBeLessThan(Math.min(...ends.map((p) => p.delay)) + 0.05);
    expect(FALL.g).toBeGreaterThan(9);
  });

  it("the collapsed world holds the pieces solid (and no seeded rubble), and keeps a walker out of the gap at both lips; the standing world has none of it", () => {
    const obs = bridgeWreckObstacles(T);
    expect(obs).toHaveLength(pieces.length);
    for (const o of obs) expect(world.obstacles).toContainEqual(o);
    const bedRocks = world.obstacles.filter((o) => o.kind === "circle" && o.tag === "rock" && Math.abs(o.z - 20) < 6 && Math.abs(o.x) < 6);
    expect(bedRocks, "the old seeded rubble is gone").toEqual([]);
    for (const s of kessarPlan().stubs) expect(world.obstacles.some((o) => o.kind === "box" && o.tag === "wall" && Math.abs(o.z - s.z) < 0.01 && o.y1 >= L + KESSAR.rimHeight - 0.01), "the gap is closed at the lip").toBe(true);
    const standing = createKessarWorld(7, "intact");
    expect(standing.obstacles.some((o) => obs.some((w) => w.x === o.x && w.z === o.z && o.tag === "rock"))).toBe(false);
  });
});
