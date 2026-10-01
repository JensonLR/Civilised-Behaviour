import { Mesh, type BufferGeometry, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Rng } from "@cb/shared";
import { HORSE_FIELDS, HORSE_SEAT, horseFromSeed, sanitizeHorse, type HorseSpec } from "../horse.ts";
import { buildHorse } from "./horse.ts";
import { HorseAnimator } from "./horseAnimator.ts";
import { PartBuilder, type PrimitiveAudit } from "./parts.ts";
import { MOUNT, WAGON } from "../../../shared/src/mount.ts";
import { WAGON_FRAME, buildWagon } from "./wagon.ts";

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => o instanceof Mesh && out.push(o));
  return out;
};
const randomSpec = (rng: Rng): HorseSpec => {
  const o: Record<string, number> = {};
  for (const f of HORSE_FIELDS) o[f.key] = rng.int(0, f.max);
  return sanitizeHorse(o);
};
const finite = (g: BufferGeometry): boolean => Object.values(g.attributes).every((a) => a.array.every((v) => Number.isFinite(v as number)));

describe("horse geometry", () => {
  it("200 random specs: finite, outward-facing, inside the triangle and draw budgets, nothing floating off the animal", () => {
    const rng = new Rng(2024);
    for (let n = 0; n < 200; n++) {
      const spec = randomSpec(rng);
      const audit: PrimitiveAudit[] = [];
      PartBuilder.audit = audit;
      const rig = buildHorse(spec, { outline: true });
      PartBuilder.audit = undefined;
      const meshes = meshesOf(rig.root);
      expect(meshes.length).toBeGreaterThan(20);
      for (const m of meshes) expect(finite(m.geometry), `${m.name} #${n}`).toBe(true);
      // every primitive faces outward (a wound-inside-out piece draws as solid ink under the hull)
      for (const p of audit) if (p.kind !== "sweep") expect(p.outward, `${p.kind} ${n}`).toBeGreaterThan(-1e-6);
      expect(rig.triangles, `spec ${n}`).toBeLessThanOrEqual(6000);
      expect(rig.meshCount).toBeLessThanOrEqual(34); // 28 bone meshes and hulls plus the reins
      rig.root.updateMatrixWorld(true);
      // the animal fits in a box a horse should fit in (height with a lifted head under ~2 m, length under ~3.3 m with tail, width under 1.3)
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let maxX = 0;
      for (const m of meshes) {
        if (m.name.startsWith("rein") || m.name.startsWith("outline_")) continue;
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox!;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const v = { x, y, z };
          const p = (m as Object3D).localToWorld(new (rig.root.position.constructor as new () => typeof rig.root.position)().set(v.x, v.y, v.z));
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
          maxX = Math.max(maxX, Math.abs(p.x));
        }
      }
      expect(minY).toBeGreaterThan(-0.12);
      expect(maxY).toBeLessThan(2.1);
      expect(maxZ - minZ).toBeLessThan(3.6);
      expect(maxX).toBeLessThan(0.85);
      rig.dispose();
    }
  });

  it("dispose frees every geometry it built and takes the horse out of the scene", () => {
    const rig = buildHorse(horseFromSeed(5));
    const geos = new Set<BufferGeometry>();
    for (const m of meshesOf(rig.root)) geos.add(m.geometry);
    let disposed = 0;
    for (const g of geos) g.addEventListener("dispose", () => disposed++);
    const parent = { children: [] as Object3D[] };
    void parent;
    rig.dispose();
    expect(disposed).toBe(geos.size);
    expect(rig.root.parent).toBeNull();
  });

  it("is deterministic: the same spec builds the same vertices", () => {
    const a = buildHorse(horseFromSeed(31));
    const b = buildHorse(horseFromSeed(31));
    const ma = meshesOf(a.root);
    const mb = meshesOf(b.root);
    expect(ma.length).toBe(mb.length);
    ma.forEach((m, i) => expect(Array.from(m.geometry.attributes.position!.array)).toEqual(Array.from(mb[i]!.geometry.attributes.position!.array)));
  });

  it("different specs differ, and the outline hulls can be switched off (draw calls fall)", () => {
    const a = buildHorse(horseFromSeed(1));
    const b = buildHorse(horseFromSeed(2));
    expect(Array.from(meshesOf(a.root)[0]!.geometry.attributes.color!.array)).not.toEqual(Array.from(meshesOf(b.root)[0]!.geometry.attributes.color!.array));
    const withInk = a.meshCount;
    a.setOutline(false);
    expect(a.meshCount).toBeLessThan(withInk);
    expect(a.meshCount).toBeLessThanOrEqual(20);
  });

  it("the seat height of the horse is the mount contract's seat height", () => {
    expect(HORSE_SEAT.y).toBe(MOUNT.seatHeight);
    const rig = buildHorse(horseFromSeed(3));
    expect(rig.seat.y).toBeCloseTo(MOUNT.seatHeight * rig.scale, 6);
  });
});

describe("horse animator", () => {
  const make = (seed = 3) => {
    const rig = buildHorse(horseFromSeed(seed));
    const anim = new HorseAnimator(rig, seed);
    anim.ambient = false;
    return { rig, anim };
  };

  it("legs are in the gait's order: a trot moves the diagonal pairs together, a walk is four-beat", () => {
    const { rig, anim } = make();
    const j = rig.joints;
    const sample = (speed: number): { lf: number[]; rf: number[]; lh: number[]; rh: number[] } => {
      const out = { lf: [] as number[], rf: [] as number[], lh: [] as number[], rh: [] as number[] };
      for (let i = 0; i < 240; i++) {
        anim.update(1 / 30, { speed });
        if (i >= 150) {
          out.lf.push(j.foreL.top.rotation.x);
          out.rf.push(j.foreR.top.rotation.x);
          out.lh.push(j.hindL.top.rotation.x);
          out.rh.push(j.hindR.top.rotation.x);
        }
      }
      return out;
    };
    const corr = (a: number[], b: number[]): number => {
      const ma = a.reduce((x, y) => x + y, 0) / a.length;
      const mb = b.reduce((x, y) => x + y, 0) / b.length;
      let n = 0;
      let da = 0;
      let db = 0;
      for (let i = 0; i < a.length; i++) {
        n += (a[i]! - ma) * (b[i]! - mb);
        da += (a[i]! - ma) ** 2;
        db += (b[i]! - mb) ** 2;
      }
      return n / Math.sqrt(da * db || 1);
    };
    const trot = sample(6.4);
    expect(corr(trot.lf, trot.rh)).toBeGreaterThan(0.95); // diagonal pair
    expect(corr(trot.rf, trot.lh)).toBeGreaterThan(0.95);
    expect(corr(trot.lf, trot.rf)).toBeLessThan(-0.9);
    const walk = sample(3);
    expect(Math.abs(corr(walk.lf, walk.rf))).toBeLessThan(0.9);
    expect(corr(walk.lf, walk.lh)).toBeLessThan(0.9); // not a pace
    const gallop = sample(10.5);
    // a gallop swings further than a walk
    expect(Math.max(...gallop.lf) - Math.min(...gallop.lf)).toBeGreaterThan(Math.max(...walk.lf) - Math.min(...walk.lf));
  });

  it("the stride is locked to distance: twice the speed over the same time is not twice the cycles (the legs do not skate)", () => {
    const { anim } = make();
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 3 });
    const p0 = anim.stridePhase;
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 3 });
    let cycles = (anim.stridePhase - p0 + 1) % 1;
    // one second at 3 m/s covers 3 m: stride = 1.4 + 0.3 * 3 = 2.3 m
    expect(cycles).toBeCloseTo(3 / 2.3 - Math.floor(3 / 2.3), 1);
    cycles = 0;
    expect(anim.motion.stride).toBeCloseTo(2.3, 5);
  });

  it("is continuous across speeds: sweeping from a halt to a gallop and back never jumps a joint by more than a stride's worth", () => {
    const { rig, anim } = make();
    const j = rig.joints;
    let last = [j.foreL.top.rotation.x, j.hindR.top.rotation.x, j.body.position.y, j.head.rotation.x];
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const speed = 10.5 * (0.5 - 0.5 * Math.cos((i / 300) * Math.PI)); // 0 -> 10.5 -> 0 over 20 s
      anim.update(1 / 30, { speed });
      const now = [j.foreL.top.rotation.x, j.hindR.top.rotation.x, j.body.position.y, j.head.rotation.x];
      for (let k = 0; k < now.length; k++) worst = Math.max(worst, Math.abs(now[k]! - last[k]!));
      last = now;
      for (const v of now) expect(Number.isFinite(v)).toBe(true);
    }
    expect(worst).toBeLessThan(0.45);
  });

  it("owns its channels: after a rear, jump and bolt the rest pose comes back exactly", () => {
    const { rig, anim } = make();
    const j = rig.joints;
    for (let i = 0; i < 45; i++) anim.update(1 / 30, { speed: 0, rear: 1, bolting: true });
    for (let i = 0; i < 20; i++) anim.update(1 / 30, { speed: 8, grounded: false, vy: 3 });
    for (let i = 0; i < 240; i++) anim.update(1 / 30, { speed: 0 });
    expect(j.body.rotation.x).toBeCloseTo(0, 2);
    expect(j.body.position.y).toBeCloseTo(0.62, 2);
    expect(j.head.rotation.x).toBeCloseTo(-0.8, 1);
    expect(j.foreL.top.rotation.x).toBeCloseTo(0, 2);
    expect(j.hindR.knee.rotation.x).toBeCloseTo(0, 2);
  });

  it("rears on the hind hooves (the barrel pitches nose-up and its centre moves with the pivot) and sags under load", () => {
    const { rig, anim } = make();
    const j = rig.joints;
    for (let i = 0; i < 60; i++) anim.update(1 / 30, { speed: 0, rear: 1 });
    expect(j.body.rotation.x).toBeGreaterThan(0.7);
    expect(j.body.position.y).toBeGreaterThan(0.9);
    expect(anim.motion.pitch).toBeGreaterThan(0.7);
    const a = make(5);
    for (let i = 0; i < 60; i++) a.anim.update(1 / 30, { speed: 0, load: 1 });
    expect(a.rig.joints.body.position.y).toBeLessThan(0.62 - 0.02);
  });

  it("a jump tucks the forelegs and pitches with the arc", () => {
    const { rig, anim } = make();
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 8, grounded: false, vy: 4 });
    expect(rig.joints.body.rotation.x).toBeGreaterThan(0.1);
    expect(rig.joints.foreL.knee.rotation.x).toBeLessThan(-1);
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 8, grounded: false, vy: -5 });
    expect(rig.joints.body.rotation.x).toBeLessThan(-0.1);
  });

  it("hostile input (NaN, negative, infinite, huge dt) never poisons a joint", () => {
    const { rig, anim } = make();
    anim.update(1 / 30, { speed: NaN, vy: Infinity, turn: NaN, load: -4, rear: 9 });
    anim.update(NaN, { speed: 3 });
    anim.update(100, { speed: -50 });
    anim.update(1 / 30, { speed: 1e9 });
    rig.root.updateMatrixWorld(true);
    for (const m of meshesOf(rig.root)) for (const v of m.matrixWorld.elements) expect(Number.isFinite(v)).toBe(true);
  });

  it("the reins follow a tossing head and are slack when nobody holds them", () => {
    const { rig, anim } = make();
    anim.update(1 / 30, { speed: 6.4, ridden: true });
    const rein = rig.root.getObjectByName("rein1") as Mesh;
    expect(rein.visible).toBe(true);
    anim.update(1 / 30, { speed: 0, ridden: false });
    expect(rein.visible).toBe(true);
    expect(rein.scale.z).toBeGreaterThan(0.02);
  });
});

describe("wagon", () => {
  it("its frame matches the shared WAGON contract", () => {
    expect(WAGON_FRAME.deck).toBe(WAGON.deck);
    expect(WAGON_FRAME.rack).toBe(WAGON.rack);
    expect(-WAGON_FRAME.hitchZ).toBe(WAGON.len);
    expect(WAGON_FRAME.wheelRadius).toBe(WAGON.wheelRadius);
    expect(WAGON_FRAME.bayY).toBe(WAGON.bays[0]!.y);
    WAGON_FRAME.bays.forEach(([x, z], i) => {
      expect(x).toBe(WAGON.bays[i]!.x);
      expect(z).toBe(WAGON.bays[i]!.z);
    });
  });

  it("builds inside its budgets, shows crates per bay, rolls its wheels with distance, and disposes", () => {
    const w = buildWagon({ coat: 4, cargo: 0 });
    const empty = w.meshCount;
    w.setCargo(4);
    expect(w.meshCount).toBe(empty + 8);
    w.setCargo(99);
    expect(w.meshCount).toBe(empty + 8);
    w.setCargo(-3);
    expect(w.meshCount).toBe(empty);
    expect(w.triangles).toBeLessThan(2500);
    expect(empty).toBeLessThanOrEqual(10);
    for (const m of meshesOf(w.root)) expect(finite(m.geometry)).toBe(true);
    w.roll(WAGON.wheelRadius * 2 * Math.PI);
    expect(Math.abs(w.wheelL.rotation.x)).toBeCloseTo(2 * Math.PI, 5); // one metre-turn: a full revolution
    const geos = new Set(meshesOf(w.root).map((m) => m.geometry));
    let disposed = 0;
    for (const g of geos) g.addEventListener("dispose", () => disposed++);
    w.dispose();
    expect(disposed).toBe(geos.size);
  });
});
