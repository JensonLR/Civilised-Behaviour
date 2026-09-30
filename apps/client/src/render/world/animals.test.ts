import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { animalPose, buildFlock, createAnimalPose, createArena } from "@cb/shared";
import { buildAnimals, setAnimalGround } from "./animals.ts";

describe("the flock as instanced toon animals", () => {
  const w = createArena(7);
  setAnimalGround(w);
  const animals = buildFlock(w);

  it("is one instanced mesh per kind (plus a small ink hull each), with per-instance animation attributes and finite geometry", () => {
    const flock = buildAnimals(animals, true)!;
    expect(flock).toBeDefined();
    expect(flock.sets.map((s) => s.kind).sort()).toEqual(["goat", "sheep"]);
    for (const s of flock.sets) {
      expect(s.mesh.count).toBe(s.animals.length);
      const g = s.mesh.geometry;
      for (const a of ["position", "normal", "color", "onormal", "aLeg", "aHead", "aAnim"]) expect(g.getAttribute(a), `${s.kind} ${a}`).toBeDefined();
      for (let i = 0; i < g.attributes.position!.count; i++) for (const v of [g.attributes.position!.getX(i), g.attributes.position!.getY(i), g.attributes.position!.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
      // four legs swing, in two opposed diagonal pairs; the head is marked
      const legs = g.getAttribute("aLeg");
      const signs = new Set(Array.from({ length: legs.count }, (_, i) => legs.getX(i)));
      expect(signs.has(1) && signs.has(-1) && signs.has(0)).toBe(true);
      const head = g.getAttribute("aHead");
      expect(Array.from({ length: head.count }, (_, i) => head.getX(i)).some((v) => v === 1)).toBe(true);
      // a sheep is about a metre long and 0.6-1.1 m tall
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(new Vector3());
      expect(size.x).toBeGreaterThan(0.8);
      expect(size.x).toBeLessThan(1.8);
      expect(size.y).toBeGreaterThan(0.55);
      expect(size.y).toBeLessThan(1.3); // (a goat with horns stands taller)
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.01); // stands on the ground
      expect(s.hull).toBeDefined();
    }
    expect(buildAnimals(animals, false)!.sets.every((s) => s.hull === undefined)).toBe(true);
    expect(buildAnimals([], true)).toBeUndefined();
  });

  it("puts every animal where the shared pose says, on the ground, each frame, without allocating new instance buffers", () => {
    const flock = buildAnimals(animals, false)!;
    const pose = createAnimalPose();
    const m = new Matrix4();
    const before = flock.sets.map((s) => s.mesh.instanceMatrix.array);
    for (const t of [0, 12.5, 400, 3600.25]) {
      flock.update(t);
      for (const s of flock.sets) {
        s.animals.forEach((a, i) => {
          animalPose(a, t, pose);
          s.mesh.getMatrixAt(i, m);
          const p = new Vector3().setFromMatrixPosition(m);
          expect(p.x).toBeCloseTo(pose.x, 4);
          expect(p.z).toBeCloseTo(pose.z, 4);
          expect(p.y).toBeCloseTo(w.terrainHeight(pose.x, pose.z), 4);
          expect(s.anim.getX(i)).toBeCloseTo(pose.speed, 5);
          expect(s.anim.getY(i)).toBeCloseTo(pose.graze, 5);
        });
      }
    }
    expect(flock.sets.map((s) => s.mesh.instanceMatrix.array)).toEqual(before);
    flock.sets.forEach((s, i) => expect(s.mesh.instanceMatrix.array).toBe(before[i]));
  });

  it("faces the way it walks: the instance's forward axis (+x) points along the pose heading", () => {
    const flock = buildAnimals(animals, false)!;
    const pose = createAnimalPose();
    const m = new Matrix4();
    flock.update(77);
    const s = flock.sets[0]!;
    animalPose(s.animals[0]!, 77, pose);
    s.mesh.getMatrixAt(0, m);
    const fwd = new Vector3(1, 0, 0).transformDirection(m);
    expect(fwd.x).toBeCloseTo(Math.cos(pose.yaw), 4);
    expect(fwd.z).toBeCloseTo(Math.sin(pose.yaw), 4);
  });
});
