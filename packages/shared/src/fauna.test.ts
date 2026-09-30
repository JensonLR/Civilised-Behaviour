import { describe, expect, it } from "vitest";
import { createArena } from "./arena.ts";
import { insideObstacle } from "./camp.ts";
import { PEN } from "./clearing.ts";
import { FLOCKS, animalPose, buildFlock, createAnimalPose } from "./fauna.ts";
import { waterEdgeDistance } from "./landscape.ts";

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
          expect(waterEdgeDistance(pose.x, pose.z), `seed ${seed} ${a.kind} in the water`).toBeGreaterThan(0.8);
          expect(Math.hypot(pose.x, pose.z)).toBeLessThan(w.boundsRadius);
        }
      }
    }
  });

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
  });

  it("time is the only input: the same instant is the same pose", () => {
    const w = createArena(7);
    const [animal] = buildFlock(w);
    expect(animalPose(animal!, 123.4)).toEqual(animalPose(animal!, 123.4));
    expect(animalPose(animal!, 123.4)).not.toEqual(animalPose(animal!, 143.4));
  });
});
