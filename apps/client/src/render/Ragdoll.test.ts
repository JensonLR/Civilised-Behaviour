import { Quaternion, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CollisionWorld, FLAG } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, clearCharacterCaches, type CharacterRig } from "@cb/procedural/three";
import { HINGE_LIMITS, RAGDOLL, RagdollWorld, WRIST_DANGLE, type Ragdoll, type RagdollLaunch } from "./Ragdoll.ts";

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
  const anim = new CharacterAnimator(rig); // (ambient life stays ON: a body can be knocked down mid idle act, and the ragdoll must cope)
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

  it("D-064: a blast throws the body up as well as away (lift), and a kick mid-fall throws it on", () => {
    const peak = (lift: number, kick = false): number => {
      const { rig, anim } = standing(6);
      const rd = world.spawn(rig, launch({ power: 1, lift }))!;
      const y0 = rd.pelvis.y;
      let top = y0;
      for (let i = 0; i < 30 && rd.phase === "sim"; i++) {
        if (kick && i === 6) expect(rd.kick(1, 0, 1, 1)).toBe(true);
        frame(anim, rd);
        top = Math.max(top, rd.pelvis.y);
      }
      rd.dispose();
      rig.dispose();
      return top - y0;
    };
    const bullet = peak(0);
    const blast = peak(1);
    expect(blast).toBeGreaterThan(bullet + 0.4);
    expect(peak(0, true)).toBeGreaterThan(bullet + 0.2);
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
    // Limits are soft in Rapier's solver: allow a small overshoot. In the rig's convention a knee bends BACKWARD with a negative x and an elbow bends FORWARD with a positive x.
    expect(kneeMin).toBeGreaterThan(HINGE_LIMITS.kneeL![0] - 0.35);
    expect(kneeMax).toBeLessThan(HINGE_LIMITS.kneeL![1] + 0.35);
    expect(elbowMin).toBeGreaterThan(HINGE_LIMITS.elbowL![0] - 0.35);
    expect(elbowMax).toBeLessThan(HINGE_LIMITS.elbowL![1] + 0.35);
  });

  it("the limits agree with the animator: knees bend the way the animator bends them, elbows too (a sign error once folded ragdoll knees forward)", () => {
    const rig = buildCharacter(generateCharacter(3), { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.setExpression("fear");
    for (let i = 0; i < 40; i++) anim.update(DT, { speed: 0, flags: FLAG.GROUNDED | FLAG.CROUCHING, vy: 0 });
    // the animator's own crouched, frightened pose lies inside every hinge limit
    for (const k of ["kneeL", "kneeR", "elbowL", "elbowR"] as const) {
      const x = rig.joints[k].rotation.x;
      expect(x, k).toBeGreaterThanOrEqual(HINGE_LIMITS[k]![0]);
      expect(x, k).toBeLessThanOrEqual(HINGE_LIMITS[k]![1]);
    }
    expect(rig.joints.kneeL.rotation.x).toBeLessThan(-0.5); // knees bend with a negative x
    expect(rig.joints.elbowL.rotation.x).toBeGreaterThan(0.5); // elbows with a positive one
    rig.dispose();
  });

  it("starts inside every limit whatever the character was doing: moods, crouch, carrying and every idle act (found: ~0.3 rad past the elbow limit mid-act)", () => {
    const HINGES = ["torso", "head", "elbowL", "elbowR", "kneeL", "kneeR"] as const;
    let checked = 0;
    for (const expr of ["neutral", "pain", "fear", "angry", "triumph", "drunk"] as const) {
      for (let s = 0; s < 14; s++) {
        const rig = buildCharacter(generateCharacter(20 + s), { outline: false });
        const anim = new CharacterAnimator(rig);
        anim.setExpression(expr);
        const flags = FLAG.GROUNDED | (s % 5 === 1 ? FLAG.CROUCHING : 0) | (s % 5 === 2 ? FLAG.CARRYING : 0);
        // idle acts come round every ~9 s: sample the whole cycle at different moments
        for (let i = 0; i < 40 + s * 37; i++) anim.update(DT, { speed: 0, flags, vy: 0 });
        const rd = world.spawn(rig, launch({ power: 0.3 }))!;
        for (const h of HINGES) {
          const a = rd.hingeAngle(h);
          expect(a, `${expr} #${s} ${h}`).toBeGreaterThanOrEqual(HINGE_LIMITS[h]![0] - 0.02);
          expect(a, `${expr} #${s} ${h}`).toBeLessThanOrEqual(HINGE_LIMITS[h]![1] + 0.02);
        }
        for (let i = 0; i < 3; i++) frame(anim, rd); // ... and the first frames of the fall stay inside them (soft limits: a hair over)
        for (const h of HINGES) {
          const a = rd.hingeAngle(h);
          expect(a, `${expr} #${s} ${h} after 3 frames`).toBeGreaterThanOrEqual(HINGE_LIMITS[h]![0] - 0.12);
          expect(a, `${expr} #${s} ${h} after 3 frames`).toBeLessThanOrEqual(HINGE_LIMITS[h]![1] + 0.12);
        }
        rd.dispose();
        rig.dispose();
        checked++;
      }
    }
    expect(checked).toBe(84);
  }, 30_000); // (CPU-bound: every mood, act and pose through the ragdoll; 2.1 s alone, over 5 s with servers and a browser beside it. A time limit, not a budget.)

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
    for (const name of ["pelvis", "torso", "head", "shoulderL", "elbowR", "wristL", "wristR", "hipL", "kneeR"] as const) {
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


  it("the wrists dangle: the hands hang from the forearms, never bend past their limit and start from the pose they had (a fist on a grip); the blend test below proves they end on the animator's wrist", () => {
    const { rig, anim } = standing(12);
    // a fist turned hard onto a handle (as a rifle grip does) when the blow lands
    rig.joints.wristR.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -0.9);
    const before = rig.joints.wristR.quaternion.clone();
    const rd = world.spawn(rig, launch({ power: 1, dx: 0.7, dz: 0.7 }))!;
    const angle = (q: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    // the first frame of the fall changes the wrist by a small step, not a jump to the dangle
    const first = new Quaternion();
    rd.setAnchor(0, 0);
    anim.update(DT, { speed: 0, flags: FLAG.GROUNDED | FLAG.DOWNED, vy: 0 });
    rig.joints.wristR.quaternion.copy(before); // (what the actor's frame leaves in the joint: the animator's pose; here the grip)
    world.step(DT);
    rd.applyPose(DT);
    first.copy(rig.joints.wristR.quaternion);
    expect(first.angleTo(before)).toBeLessThan(0.7);
    let worst = 0;
    let frames = 0;
    let prev = first.clone();
    let step = 0;
    while (rd.phase === "sim" && frames++ < 200) {
      frame(anim, rd);
      for (const w of [rig.joints.wristL, rig.joints.wristR]) {
        expect(Number.isFinite(w.quaternion.x + w.quaternion.y + w.quaternion.z + w.quaternion.w)).toBe(true);
        worst = Math.max(worst, angle(w.quaternion));
      }
      step = Math.max(step, prev.angleTo(rig.joints.wristR.quaternion));
      prev.copy(rig.joints.wristR.quaternion);
    }
    expect(worst).toBeLessThanOrEqual(WRIST_DANGLE + 0.01);
    expect(step).toBeLessThan(0.9); // (a loose hand swings, it does not snap)
    // blend out: the wrists end exactly on the animator's
    let g = 0;
    while (rd.phase !== "done" && g++ < 300) frame(anim, rd);
    expect(rd.phase).toBe("done");
    rig.dispose();
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
