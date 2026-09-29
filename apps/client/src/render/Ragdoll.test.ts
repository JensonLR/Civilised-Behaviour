import { Quaternion, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CollisionWorld, FLAG } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, clearCharacterCaches, type CharacterRig } from "@cb/procedural/three";
import { RAGDOLL, RagdollWorld, type Ragdoll, type RagdollLaunch } from "./Ragdoll.ts";

const DT = 1 / 30;
const flat = new CollisionWorld({ height: () => 0 }, [], 100);
let world: RagdollWorld;
beforeAll(async () => {
  world = await RagdollWorld.create(flat);
});
afterAll(() => {
  world.dispose();
  clearCharacterCaches();
});

const launch = (over: Partial<RagdollLaunch> = {}): RagdollLaunch => ({ vx: 0, vy: 0, vz: 0, dx: 0, dz: 1, power: 0.7, zone: 1, ...over });

/** A standing figure at (x, z) like the actor would pose it. */
function standing(seed = 3, x = 0, z = 0) {
  const rig = buildCharacter(generateCharacter(seed), { outline: false });
  const anim = new CharacterAnimator(rig);
  anim.autoBlink = false; // ambient idle acts (a hand to the hat, a glance at a watch) would make every run start from a different pose
  rig.root.position.set(x, 0, z);
  for (let i = 0; i < 30; i++) anim.update(DT, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
  rig.root.position.set(x, 0, z);
  return { rig, anim };
}

/** One frame the way the actor runs it: animate, step physics, then let the ragdoll override/blend the pose. */
const frame = (anim: CharacterAnimator, rd: Ragdoll, flags = FLAG.GROUNDED | FLAG.DOWNED) => {
  rd.setAnchor(0, 0);
  anim.update(DT, { speed: 0, flags, vy: 0 });
  world.step(DT);
  rd.applyPose(DT);
};

describe("Ragdoll", () => {
  it("builds one body per bone and a fall from standing ends near the ground, above it, within the time limit", () => {
    const { rig, anim } = standing();
    const rd = world.spawn(rig, launch())!;
    expect(rd.bodyCount).toBe(11);
    let lowest = Infinity;
    let t = 0;
    while (rd.phase === "sim" && t < 5) {
      frame(anim, rd);
      lowest = Math.min(lowest, rd.lowestY);
      t += DT;
    }
    expect(rd.phase).toBe("blend");
    expect(t).toBeLessThanOrEqual(RAGDOLL.maxSimSeconds + 2 * DT);
    expect(lowest).toBeGreaterThan(-0.05); // never through the floor
    const p = rd.pelvis;
    expect(p.y).toBeLessThan(0.5); // dropped from ~1 m to lying/sitting
    expect(p.y).toBeGreaterThan(0);
    rd.dispose();
    rig.dispose();
  });

  it("the shove sends the body the way the blow pushed it, and harder blows go further", () => {
    const travel = (dx: number, dz: number, power: number): Vector3 => {
      const { rig, anim } = standing(5);
      const rd = world.spawn(rig, launch({ dx, dz, power }))!;
      const start = rd.pelvis.clone();
      for (let i = 0; i < 40 && rd.phase === "sim"; i++) frame(anim, rd);
      const d = rd.pelvis.clone().sub(start);
      rd.dispose();
      rig.dispose();
      return d;
    };
    const east = travel(1, 0, 0.8);
    const west = travel(-1, 0, 0.8);
    const north = travel(0, -1, 0.8);
    expect(east.x).toBeGreaterThan(0.3);
    expect(west.x).toBeLessThan(-0.3);
    expect(north.z).toBeLessThan(-0.3);
    expect(Math.abs(east.z)).toBeLessThan(Math.abs(east.x));
    const soft = travel(1, 0, 0.1).x;
    expect(travel(1, 0, 1).x).toBeGreaterThan(soft + 0.3);
  });

  it("a full-power blow moves the body a few metres, not across the arena (it must blend back to the server capsule)", () => {
    let worst = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { rig, anim } = standing(seed);
      const rd = world.spawn(rig, launch({ dx: Math.cos(seed * 1.3), dz: Math.sin(seed * 1.3), power: 1, zone: seed % 6, vx: 6.6, vz: 0 }))!;
      let dist = 0;
      for (let i = 0; i < 120 && rd.phase === "sim"; i++) {
        frame(anim, rd);
        if (rd.phase === "sim") dist = Math.max(dist, Math.hypot(rd.pelvis.x, rd.pelvis.z));
      }
      worst = Math.max(worst, dist);
      rd.dispose();
      rig.dispose();
    }
    expect(worst).toBeLessThan(RAGDOLL.tetherRadius + 2);
  });

  it("joints respect their limits: knees never bend backwards, elbows never hyper-extend, and the pose stays finite", () => {
    let kneeMin = Infinity;
    let kneeMax = -Infinity;
    let elbowMin = Infinity;
    let elbowMax = -Infinity;
    for (const seed of [1, 4, 9]) {
      const { rig, anim } = standing(seed);
      const rd = world.spawn(rig, launch({ power: 1, dx: Math.cos(seed), dz: Math.sin(seed), zone: seed % 6 }))!;
      for (let i = 0; i < 60 && rd.phase === "sim"; i++) {
        frame(anim, rd);
        if (rd.phase !== "sim") break;
        for (const k of ["kneeL", "kneeR"] as const) {
          kneeMin = Math.min(kneeMin, rd.hingeAngle(k));
          kneeMax = Math.max(kneeMax, rd.hingeAngle(k));
        }
        for (const e of ["elbowL", "elbowR"] as const) {
          elbowMin = Math.min(elbowMin, rd.hingeAngle(e));
          elbowMax = Math.max(elbowMax, rd.hingeAngle(e));
        }
        rig.root.traverse((o) => {
          for (const v of [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.w]) expect(Number.isFinite(v)).toBe(true);
        });
      }
      rd.dispose();
      rig.dispose();
    }
    // Limits are soft in Rapier's solver: allow a small overshoot.
    expect(kneeMin).toBeGreaterThan(-0.35);
    expect(kneeMax).toBeLessThan(2.85);
    expect(elbowMin).toBeGreaterThan(-2.85);
    expect(elbowMax).toBeLessThan(0.35);
  });

  it("blends back into exactly the animator's pose, in the animator's place", () => {
    const a = standing(7, 4, -2);
    const b = standing(7, 4, -2);
    const rd = world.spawn(a.rig, launch())!;
    let guard = 0;
    while (rd.phase !== "done" && guard++ < 400) {
      a.rig.root.position.set(4, 0, -2); // the actor re-places the root from server state every frame
      frame(a.anim, rd);
      b.anim.update(DT, { speed: 0, flags: FLAG.GROUNDED | FLAG.DOWNED, vy: 0 });
      b.rig.root.position.x = 4; // (the animator owns root.y)
      b.rig.root.position.z = -2;
    }
    expect(rd.phase).toBe("done");
    expect(world.liveCount).toBe(0);
    // One more plain animator frame on each; the ragdoll no longer touches A.
    a.rig.root.updateMatrixWorld(true);
    b.rig.root.updateMatrixWorld(true);
    const qa = new Quaternion();
    const qb = new Quaternion();
    for (const name of ["pelvis", "torso", "head", "shoulderL", "elbowR", "hipL", "kneeR"] as const) {
      a.rig.joints[name].getWorldQuaternion(qa);
      b.rig.joints[name].getWorldQuaternion(qb);
      expect(Math.abs(qa.dot(qb))).toBeGreaterThan(0.999);
    }
    const pa = new Vector3();
    const pb = new Vector3();
    a.rig.joints.head.getWorldPosition(pa);
    b.rig.joints.head.getWorldPosition(pb);
    expect(pa.distanceTo(pb)).toBeLessThan(0.02);
    a.rig.dispose();
    b.rig.dispose();
  });

  it("never pops: the pose changes smoothly through the sim-to-blend hand-over and the blend", () => {
    const { rig, anim } = standing(2);
    const rd = world.spawn(rig, launch())!;
    const head = new Vector3();
    const prev = new Vector3();
    let worst = 0;
    let frames = 0;
    rig.joints.head.getWorldPosition(prev);
    while (rd.phase !== "done" && frames++ < 300) {
      frame(anim, rd);
      rig.root.updateMatrixWorld(true);
      rig.joints.head.getWorldPosition(head);
      worst = Math.max(worst, head.distanceTo(prev));
      prev.copy(head);
    }
    expect(rd.phase).toBe("done");
    // At most ~1.5 m between consecutive 30 Hz frames even at the fastest part of the fall (45 m/s would be a pop).
    expect(worst).toBeLessThan(1.5);
  });

  it("reviving mid-fall ends the simulation and blends out early", () => {
    const { rig, anim } = standing(6);
    const rd = world.spawn(rig, launch())!;
    for (let i = 0; i < 6; i++) frame(anim, rd);
    expect(rd.phase).toBe("sim");
    rd.beginBlend();
    expect(rd.phase).toBe("blend");
    expect(rd.bodyCount).toBe(0); // physics bodies freed as soon as the snapshot is taken
    let frames = 0;
    while (rd.phase !== "done" && frames++ < 100) frame(anim, rd, FLAG.GROUNDED);
    expect(frames * DT).toBeLessThan(RAGDOLL.blendSeconds + 0.15);
  });

  it("is capped and leak-free: extra requests are refused, disposal frees every body", () => {
    const start = world.bodyCount;
    const figs = Array.from({ length: RAGDOLL.maxLive + 1 }, (_, i) => standing(i + 10, i * 2, 0));
    const rds = figs.map((f) => world.spawn(f.rig, launch()));
    expect(rds.filter(Boolean)).toHaveLength(RAGDOLL.maxLive);
    expect(rds[RAGDOLL.maxLive]).toBeUndefined();
    expect(world.liveCount).toBe(RAGDOLL.maxLive);
    expect(world.bodyCount).toBe(start + RAGDOLL.maxLive * 11);
    rds[0]!.dispose();
    expect(world.spawn(figs[RAGDOLL.maxLive]!.rig, launch())).toBeDefined(); // room again
    for (const r of rds) r?.dispose();
    world.step(DT);
    for (const r of [...(world as unknown as { live: Set<Ragdoll> }).live]) r.dispose();
    expect(world.liveCount).toBe(0);
    expect(world.bodyCount).toBe(start);
    figs.forEach((f) => f.rig.dispose());
  });

  it("a body launched hard into the ground stays above it (no tunnelling, even at 90 m/s)", () => {
    const { rig, anim } = standing(8);
    const rd = world.spawn(rig, launch({ vy: -90, power: 1 }))!;
    let lowest = Infinity;
    for (let i = 0; i < 40 && rd.phase === "sim"; i++) {
      frame(anim, rd);
      lowest = Math.min(lowest, rd.lowestY);
    }
    expect(lowest).toBeGreaterThan(-0.4);
    rd.dispose();
    rig.dispose();
  });

  it("degenerate launches (no direction, zero power) still produce a finite fall", () => {
    const { rig, anim } = standing(11);
    const rd = world.spawn(rig, launch({ dx: 0, dz: 0, power: 0 }))!;
    for (let i = 0; i < 90 && rd.phase === "sim"; i++) frame(anim, rd);
    expect(Number.isFinite(rd.pelvis.x + rd.pelvis.y + rd.pelvis.z)).toBe(true);
    rd.dispose();
    rig.dispose();
  });
});
