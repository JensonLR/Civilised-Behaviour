import { describe, expect, it } from "vitest";
import { createArena } from "./arena.ts";
import { insideObstacle } from "./camp.ts";
import { PEN } from "./clearing.ts";
import { BODY_R, FLOCKS, animalPose, buildFlock, createAnimalPose, separateBodies, separateCapsules, sleepWeight } from "./fauna.ts";
import { herdAt, herdCount, herdPlan } from "./highmark.ts";
import { RIVER, waterEdgeDistance } from "./landscape.ts";
import { villagePlan } from "./village.ts";

const SEEDS = [1, 7, 42, 1234];

describe("the flock", () => {
  it("is deterministic in the world, and every flock finds room on every seed", () => {
    for (const seed of SEEDS) {
      const a = buildFlock(createArena(seed));
      const b = buildFlock(createArena(seed));
      expect(a).toEqual(b);
      const want = FLOCKS.reduce((n, f) => n + f.count, 0);
      expect(a.length, `seed ${seed}`).toBeGreaterThanOrEqual(want - 2);
      expect(a.filter((x) => x.kind === "goat").length).toBeGreaterThan(0);
      expect(a.filter((x) => x.kind === "sheep").length).toBeGreaterThan(3);
    }
    expect(buildFlock(createArena(1))).not.toEqual(buildFlock(createArena(2)));
  });

  it("an empty world (the menu backdrop) has no animals", () => {
    expect(buildFlock({ obstacles: [] } as never)).toEqual([]);
  });

  it("animals never stand or walk through an obstacle, the water or a fence, over two minutes, on any seed", () => {
    const pose = createAnimalPose();
    for (const seed of SEEDS) {
      const w = createArena(seed);
      for (const a of buildFlock(w)) {
        for (let t = 0; t < 120; t += 0.5) {
          animalPose(a, t, pose);
          let hit = "";
          w.forEachNear(pose.x, pose.z, (o) => {
            if (!hit && insideObstacle(o, pose.x, pose.z, 0.3)) hit = `${o.tag ?? "obstacle"} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`;
          });
          expect(hit, `seed ${seed} ${a.kind} at t=${t} (${pose.x.toFixed(1)},${pose.z.toFixed(1)})`).toBe("");
          if (a.kind === "duck") expect(waterEdgeDistance(pose.x, pose.z), `seed ${seed} duck out of the water`).toBeLessThan(-0.9);
          else expect(waterEdgeDistance(pose.x, pose.z), `seed ${seed} ${a.kind} in the water`).toBeGreaterThan(0.8);
          expect(Math.hypot(pose.x, pose.z)).toBeLessThan(w.boundsRadius);
        }
      }
    }
  }, 60_000);

  it("the sheep in the pen stay in the pen", () => {
    const w = createArena(7);
    const pose = createAnimalPose();
    const pen = FLOCKS.findIndex((f) => f.inPen);
    const before = FLOCKS.slice(0, pen).reduce((n, f) => n + f.count, 0);
    const flock = buildFlock(w);
    let checked = 0;
    for (const a of flock.slice(before, before + FLOCKS[pen]!.count)) {
      for (let t = 0; t < 300; t += 0.5) {
        animalPose(a, t, pose);
        expect(Math.abs(pose.x - PEN.x), `t ${t}`).toBeLessThan(PEN.hx);
        expect(Math.abs(pose.z - PEN.z)).toBeLessThan(PEN.hz);
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it("they move like animals: continuous, slow, facing the way they go, and they stop to graze", () => {
    const w = createArena(7);
    const a = createAnimalPose();
    const b = createAnimalPose();
    for (const animal of buildFlock(w)) {
      let stood = 0;
      let walked = 0;
      let maxSpeed = 0;
      for (let t = 0; t < 240; t += 0.1) {
        animalPose(animal, t, a);
        animalPose(animal, t + 0.1, b);
        expect(Math.hypot(b.x - a.x, b.z - a.z), `t ${t}`).toBeLessThan(0.16); // < 1.6 m/s
        let dyaw = b.yaw - a.yaw;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        expect(Math.abs(dyaw), `turn at t ${t}`).toBeLessThan(0.7);
        for (const v of [a.x, a.z, a.yaw, a.speed, a.graze, a.mps]) expect(Number.isFinite(v)).toBe(true);
        expect(a.speed).toBeGreaterThanOrEqual(0);
        expect(a.speed).toBeLessThanOrEqual(1);
        expect(a.graze).toBeGreaterThanOrEqual(0);
        expect(a.graze).toBeLessThanOrEqual(1);
        maxSpeed = Math.max(maxSpeed, a.mps);
        if (a.graze > 0.9) stood++;
        if (a.mps > 0.2) walked++;
        // while walking, the animal faces its direction of travel
        if (a.mps > 0.35) {
          const heading = Math.atan2(b.z - a.z, b.x - a.x);
          const off = Math.atan2(Math.sin(heading - a.yaw), Math.cos(heading - a.yaw));
          expect(Math.abs(off), `facing at t ${t}`).toBeLessThan(1.2);
        }
      }
      expect(maxSpeed).toBeLessThan(1.5);
      expect(stood, "grazes").toBeGreaterThan(200);
      expect(walked, "wanders").toBeGreaterThan(100);
    }
  }, 60_000);

  it("time is the only input: the same instant is the same pose", () => {
    const w = createArena(7);
    const [animal] = buildFlock(w);
    expect(animalPose(animal!, 123.4)).toEqual(animalPose(animal!, 123.4));
    expect(animalPose(animal!, 123.4)).not.toEqual(animalPose(animal!, 143.4));
  });

  it("the new residents: ducks on the pond, deer (with a stag) at the forest edge, and the village cat, on every seed", () => {
    for (const seed of SEEDS) {
      const flock = buildFlock(createArena(seed));
      const count = (k: string): number => flock.filter((a) => a.kind === k).length;
      expect(count("duck"), `seed ${seed} ducks`).toBeGreaterThanOrEqual(3);
      expect(count("deer") + count("stag"), `seed ${seed} deer`).toBeGreaterThanOrEqual(2);
      expect(count("stag"), `seed ${seed} stag`).toBe(1);
      expect(count("cat"), `seed ${seed} cat`).toBe(1);
      for (const d of flock.filter((a) => a.kind === "duck")) for (let i = 0; i < d.route.length; i += 2) expect(Math.hypot(d.route[i]! - RIVER.b.x, d.route[i + 1]! - RIVER.b.z)).toBeLessThan(RIVER.pondRadius);
      // deer are big, ducks are small
      const size = (k: string): number => flock.find((a) => a.kind === k)!.size;
      expect(size("stag")).toBeGreaterThan(size("deer"));
      expect(size("deer")).toBeGreaterThan(size("sheep") * 1.2);
      expect(size("duck")).toBeLessThan(size("cat"));
    }
  });

  it("the cat naps by day near the granary, is curled up on the steps all night, and never walks through a wall at any hour", () => {
    const pose = createAnimalPose();
    for (const seed of SEEDS) {
      const w = createArena(seed);
      const cat = buildFlock(w).find((a) => a.kind === "cat")!;
      const home = villagePlan(w.terrain).cat;
      expect(Math.hypot(cat.route[0]! - home.x, cat.route[1]! - home.z), `seed ${seed}: sleeps on the steps`).toBeLessThan(3.5);
      for (const h of [22, 23.5, 1, 3, 5]) {
        animalPose(cat, 1000, pose, h);
        expect(pose.curl, `curled at ${h}`).toBe(1);
        expect(Math.hypot(pose.x - cat.route[0]!, pose.z - cat.route[1]!)).toBeLessThan(1e-4);
        expect(pose.speed).toBe(0);
      }
      for (const h of [7, 9, 12, 15, 19, 20.9]) {
        animalPose(cat, 1000, pose, h);
        expect(pose.curl, `awake at ${h}`).toBe(0);
      }
      // a day's worth of cat, one second of world time per step: away from every obstacle, and it never jumps
      const prev = createAnimalPose();
      animalPose(cat, 0, prev, 0);
      for (let t = 1; t < 4000; t++) {
        const h = ((t / 80) * 1) % 24;
        animalPose(cat, t, pose, h);
        let hit = "";
        w.forEachNear(pose.x, pose.z, (o) => {
          if (!hit && insideObstacle(o, pose.x, pose.z, 0.1)) hit = `${o.tag ?? "obstacle"} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`;
        });
        expect(hit, `seed ${seed} cat at ${h.toFixed(2)}h`).toBe("");
        expect(Math.hypot(pose.x - prev.x, pose.z - prev.z), `seed ${seed} cat jumps at t ${t}`).toBeLessThan(1.6);
        prev.x = pose.x;
        prev.z = pose.z;
      }
    }
    expect(sleepWeight(3)).toBe(1);
    expect(sleepWeight(12)).toBe(0);
    expect(sleepWeight(27)).toBe(1); // hours wrap
  }, 60_000);
});

describe("animals never stand in each other", () => {
  it("separateBodies parts overlapping bodies to the sum of their radii, leaves apart ones be, and does the same on every call", () => {
    const x = new Float64Array([0, 0.3, 5, 5]), z = new Float64Array([0, 0, 0, 0]), r = new Float64Array([0.6, 0.6, 0.5, 0.5]);
    separateBodies(x, z, r, 4);
    expect(Math.hypot(x[1]! - x[0]!, z[1]! - z[0]!)).toBeCloseTo(1.2, 6);
    expect(Math.hypot(x[3]! - x[2]!, z[3]! - z[2]!)).toBeCloseTo(1.0, 6); // (exactly on top of each other: parted all the same)
    const x2 = new Float64Array([0, 0.3, 5, 5]), z2 = new Float64Array([0, 0, 0, 0]);
    separateBodies(x2, z2, r, 4);
    expect([...x2, ...z2]).toEqual([...x, ...z]);
    const far = new Float64Array([0, 3]), fz = new Float64Array([0, 0]);
    separateBodies(far, fz, new Float64Array([0.6, 0.6]), 2);
    expect([...far]).toEqual([0, 3]);
  });

  it("separateCapsules parts a head standing in a neighbour's flank, and side-by-side beasts to a body's width", () => {
    // B stands across A's head: A faces +x with its muzzle 1.4 ahead; B's middle 1.5 ahead of A, side on
    const x = new Float64Array([0, 1.5]), z = new Float64Array([0, 0]), yaw = new Float64Array([0, Math.PI / 2]);
    separateCapsules(x, z, yaw, 1.0, 1.4, 0.48, 2);
    const gapAt = (): number => {
      // the nearest points of the two spines, sampled
      let best = Infinity;
      for (let s = 0; s <= 20; s++) for (let t = 0; t <= 20; t++) {
        const a = -1.0 + (2.4 * s) / 20, b = -1.0 + (2.4 * t) / 20;
        best = Math.min(best, Math.hypot(x[0]! + Math.cos(yaw[0]!) * a - (x[1]! + Math.cos(yaw[1]!) * b), z[0]! + Math.sin(yaw[0]!) * a - (z[1]! + Math.sin(yaw[1]!) * b)));
      }
      return best;
    };
    expect(gapAt()).toBeGreaterThan(0.96 - 0.02);
    const sx = new Float64Array([0, 0]), sz = new Float64Array([0, 0.4]), sy = new Float64Array([0, 0]);
    separateCapsules(sx, sz, sy, 1.0, 1.4, 0.48, 2);
    expect(Math.abs(sz[1]! - sz[0]!)).toBeCloseTo(0.96, 6);
  });

  it("through an hour of world time, Hollowmere's sheep and goats never stand in each other once parted", () => {
    const flock = buildFlock(createArena(7)).filter((a) => a.kind === "sheep" || a.kind === "goat");
    const n = flock.length;
    const x = new Float64Array(n), z = new Float64Array(n), r = new Float64Array(n);
    const pose = createAnimalPose();
    let worst = 0;
    for (let t = 0; t < 3600; t += 7.3) {
      flock.forEach((a, i) => {
        animalPose(a, t, pose);
        x[i] = pose.x;
        z[i] = pose.z;
        r[i] = BODY_R[a.kind] * a.size;
      });
      separateBodies(x, z, r, n);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) worst = Math.max(worst, r[i]! + r[j]! - Math.hypot(x[j]! - x[i]!, z[j]! - z[i]!));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it("through an hour of world time, Highmark's herds never stand in each other once parted (as capsules: a 2.8 m beast)", () => {
    for (const seed of [7, 4242]) {
      const plan = herdPlan(seed);
      const n = herdCount(plan);
      const x = new Float64Array(n), z = new Float64Array(n), yaw = new Float64Array(n);
      const p = { x: 0, z: 0, yaw: 0 };
      let worst = 0;
      for (let t = 0; t < 3600; t += 11.7) {
        for (let i = 0; i < n; i++) {
          herdAt(plan, i, t, p);
          x[i] = p.x;
          z[i] = p.z;
          yaw[i] = p.yaw;
        }
        separateCapsules(x, z, yaw, 1.0, 1.4, 0.48, n);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          if (Math.hypot(x[j]! - x[i]!, z[j]! - z[i]!) > 4) continue;
          // the spines' nearest approach, sampled at 12 cm
          let best = Infinity;
          for (let s = 0; s <= 20; s++) for (let u = 0; u <= 20; u++) {
            const a = -1.0 + (2.4 * s) / 20, b = -1.0 + (2.4 * u) / 20;
            best = Math.min(best, Math.hypot(x[i]! + Math.cos(yaw[i]!) * a - x[j]! - Math.cos(yaw[j]!) * b, z[i]! + Math.sin(yaw[i]!) * a - z[j]! - Math.sin(yaw[j]!) * b));
          }
          worst = Math.max(worst, 0.96 - best);
        }
      }
      expect(worst, `seed ${seed}`).toBeLessThan(0.08);
    }
  });
});
