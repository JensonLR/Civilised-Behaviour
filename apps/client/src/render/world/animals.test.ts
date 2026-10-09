import { describe, expect, it } from "vitest";
import { Box3, Matrix4, Vector3, type BufferGeometry } from "three";
import { BODY_R, animalPose, buildFlock, createAnimalPose, createArena, separateBodies, villagePlan } from "@cb/shared";
import { DIP, SPECIES, buildAnimals, setAnimalGround } from "./animals.ts";

/** The bounding box of the vertices of one species (kind id) in a group geometry. */
function speciesBox(g: BufferGeometry, kind: number): Box3 {
  const pos = g.getAttribute("position");
  const kinds = g.getAttribute("aKind");
  const box = new Box3();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) if (kinds.getX(i) === kind) box.expandByPoint(v.fromBufferAttribute(pos, i));
  return box;
}

describe("the animals as instanced toon animals", () => {
  const w = createArena(7);
  setAnimalGround(w);
  const animals = buildFlock(w);

  it("is one instanced mesh per group of species (plus a small ink hull each), with per-instance animation attributes and finite geometry", () => {
    const flock = buildAnimals(animals, true)!;
    expect(flock).toBeDefined();
    expect(flock.sets.map((s) => s.name)).toEqual(["livestock", "wildlife"]);
    expect(flock.meshes().length).toBe(4);
    for (const s of flock.sets) {
      expect(s.mesh.count).toBe(s.animals.length);
      const g = s.mesh.geometry;
      for (const a of ["position", "normal", "color", "onormal", "aLeg", "aHead", "aKind", "aAnim", "aSpec"]) expect(g.getAttribute(a), `${s.name} ${a}`).toBeDefined();
      const pos = g.attributes.position!;
      for (let i = 0; i < pos.count; i++) for (const v of [pos.getX(i), pos.getY(i), pos.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
      // every instance names a species that has vertices in this group's geometry
      const kinds = new Set(Array.from({ length: g.getAttribute("aKind").count }, (_, i) => g.getAttribute("aKind").getX(i)));
      for (let i = 0; i < s.animals.length; i++) expect(kinds.has(g.getAttribute("aSpec").getX(i)), `${s.animals[i]!.kind}`).toBe(true);
      // four legs swing in two opposed diagonal pairs and the head is marked
      const legs = g.getAttribute("aLeg");
      const signs = new Set(Array.from({ length: legs.count }, (_, i) => legs.getX(i)));
      expect(signs.has(1) && signs.has(-1) && signs.has(0)).toBe(true);
      const head = g.getAttribute("aHead");
      expect(Array.from({ length: head.count }, (_, i) => head.getX(i)).some((v) => v === 1)).toBe(true);
      expect(s.hull).toBeDefined();
    }
    expect(buildAnimals(animals, false)!.sets.every((s) => s.hull === undefined)).toBe(true);
    expect(buildAnimals([], true)).toBeUndefined();
  });

  it("each species is the right size at its own scale, stands on the ground (or floats on the water line), and faces +x", () => {
    const flock = buildAnimals(animals, false)!;
    const live = flock.sets[0]!.mesh.geometry;
    const wild = flock.sets[1]!.mesh.geometry;
    const scale = (k: keyof typeof SPECIES): number => animals.find((a) => a.kind === k)!.size;
    const height = (g: BufferGeometry, k: keyof typeof SPECIES): number => speciesBox(g, SPECIES[k]).getSize(new Vector3()).y * scale(k);
    const length = (g: BufferGeometry, k: keyof typeof SPECIES): number => speciesBox(g, SPECIES[k]).getSize(new Vector3()).x * scale(k);
    // a sheep is about a metre long and 0.5-0.9 tall; a goat a little taller with horns
    expect(length(live, "sheep")).toBeGreaterThan(0.8);
    expect(length(live, "sheep")).toBeLessThan(1.5);
    expect(height(live, "sheep")).toBeGreaterThan(0.5);
    expect(height(live, "sheep")).toBeLessThan(1.2);
    expect(height(live, "goat")).toBeGreaterThan(0.6);
    // a deer stands about a metre at the shoulder (a bit over a metre and a half with its head up); a stag is bigger and antlered
    expect(height(wild, "deer")).toBeGreaterThan(1.1);
    expect(height(wild, "deer")).toBeLessThan(2.1);
    expect(speciesBox(wild, 5).isEmpty(), "antlers").toBe(false);
    expect(speciesBox(wild, 5).max.y * scale("stag")).toBeGreaterThan(2);
    // a duck is 0.4-0.6 m long and floats: it has no legs below the water line
    expect(length(wild, "duck")).toBeGreaterThan(0.35);
    expect(length(wild, "duck")).toBeLessThan(0.8);
    expect(speciesBox(wild, SPECIES.duck).min.y).toBeGreaterThanOrEqual(-0.01);
    // a cat is a cat: 0.3-0.6 m tall at the back, 0.4-0.8 long with the head
    expect(height(wild, "cat")).toBeGreaterThan(0.3);
    expect(height(wild, "cat")).toBeLessThan(0.8);
    expect(length(wild, "cat")).toBeGreaterThan(0.4);
    expect(length(wild, "cat")).toBeLessThan(1);
    for (const k of ["sheep", "goat", "deer", "cat"] as const) expect(speciesBox(k === "sheep" || k === "goat" ? live : wild, SPECIES[k]).min.y, k).toBeGreaterThanOrEqual(-0.01);
    // a duck dabbles harder than a sheep grazes
    expect(DIP.duck).toBeGreaterThan(DIP.sheep);
  });

  it("puts every animal where the shared pose says (parted from its neighbours by the shared separation), on the ground, each frame, without allocating new instance buffers", () => {
    const flock = buildAnimals(animals, false)!;
    const pose = createAnimalPose();
    const m = new Matrix4();
    const before = flock.sets.map((s) => s.mesh.instanceMatrix.array);
    const waterY = villagePlan(w.terrain).jetty.waterY;
    for (const t of [0, 12.5, 400, 3600.25]) {
      for (const hours of [3, 12]) {
        flock.update(t, hours);
        for (const s of flock.sets) {
          // where each stands: its pose, then the set parted so no two bodies meet (what every client draws)
          const n = s.animals.length;
          const px = new Float64Array(n), pz = new Float64Array(n), pr = new Float64Array(n);
          s.animals.forEach((a, i) => {
            animalPose(a, t, pose, hours);
            px[i] = pose.x;
            pz[i] = pose.z;
            pr[i] = BODY_R[a.kind] * a.size;
          });
          separateBodies(px, pz, pr, n);
          s.animals.forEach((a, i) => {
            animalPose(a, t, pose, hours);
            s.mesh.getMatrixAt(i, m);
            const p = new Vector3().setFromMatrixPosition(m);
            expect(p.x).toBeCloseTo(px[i]!, 4);
            expect(p.z).toBeCloseTo(pz[i]!, 4);
            // (parting moves an animal a step at most: never off across the field)
            expect(Math.hypot(p.x - pose.x, p.z - pose.z)).toBeLessThan(2 * pr[i]!);
            expect(p.y).toBeCloseTo(a.kind === "duck" ? waterY : w.terrainHeight(p.x, p.z), 4);
            expect(s.anim.getX(i)).toBeCloseTo(pose.speed, 5);
            expect(s.anim.getY(i)).toBeCloseTo(pose.graze * DIP[a.kind], 5);
            expect(s.anim.getW(i)).toBeCloseTo(pose.curl, 5);
            expect(s.mesh.geometry.getAttribute("aSpec").getX(i)).toBe(SPECIES[a.kind]);
          });
        }
      }
    }
    flock.sets.forEach((s, i) => expect(s.mesh.instanceMatrix.array).toBe(before[i]));
  });

  it("the village cat is curled up (squashed) at night and upright by day", () => {
    const flock = buildAnimals(animals, false)!;
    const set = flock.sets[1]!;
    const idx = set.animals.findIndex((a) => a.kind === "cat");
    expect(idx).toBeGreaterThanOrEqual(0);
    flock.update(500, 2);
    expect(set.anim.getW(idx)).toBe(1);
    flock.update(500, 13);
    expect(set.anim.getW(idx)).toBe(0);
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
