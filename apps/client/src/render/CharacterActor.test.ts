import { Object3D, Scene } from "three";
import { describe, expect, it } from "vitest";
import { encodeSpec, generateCharacter } from "@cb/procedural";
import { FLAG } from "@cb/shared";
import { CharacterActor, type ActorPose } from "./CharacterActor.ts";
import { newEyeSample } from "./firstPerson.ts";

const look = (seed: number): string => encodeSpec(generateCharacter(seed));
const pose = (flags: number = FLAG.GROUNDED, over: Partial<ActorPose> = {}): ActorPose => ({ x: 2, y: 0, z: -3, facing: 0.4, vx: 0, vz: 0, flags, ...over });
const settle = (a: CharacterActor, p: ActorPose, frames = 40): void => {
  for (let i = 0; i < frames; i++) a.update(1 / 60, p);
};
const visibleInHierarchy = (o: Object3D): boolean => {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};

describe("CharacterActor first person", () => {
  it("hides the head and everything on it, keeps torso, arms and legs, and restores on leaving", () => {
    const scene = new Scene();
    const a = new CharacterActor(scene, look(3), 1, true);
    const j = a.animator ? (a as unknown as { rig: { joints: Record<string, Object3D> } }).rig.joints : undefined;
    expect(j).toBeDefined();
    settle(a, pose());
    a.setFirstPerson(true, 1);
    settle(a, pose());
    const head = j!.head!;
    expect(head.visible).toBe(false);
    let headMeshes = 0;
    head.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) {
        headMeshes++;
        expect(visibleInHierarchy(o)).toBe(false); // hair, hat, eyes, brows, outline hull
      }
    });
    expect(headMeshes).toBeGreaterThan(3);
    for (const name of ["torso", "shoulderL", "shoulderR", "hipL", "hipR", "kneeL", "elbowR", "wristL", "wristR"]) expect(visibleInHierarchy(j![name]!)).toBe(true);
    // ... and it is ONLY the head that goes: the hands (their own bones, at the wrists) and every other body mesh are drawn
    const handMeshes: string[] = [];
    j!.root!.traverse((o) => {
      if (!(o as { isMesh?: boolean }).isMesh || o.name === "head_shadow") return;
      let underHead = false;
      for (let n: Object3D | null = o; n; n = n.parent) if (n === head) underHead = true;
      if (!underHead) expect(visibleInHierarchy(o), o.name).toBe(true);
      if (/hand[LR]$/.test(o.name)) handMeshes.push(o.name);
    });
    expect(handMeshes.length).toBeGreaterThanOrEqual(2);
    a.setFirstPerson(false);
    expect(head.visible).toBe(true);
  });

  it("keeps casting a head-sized shadow while the head is hidden, and draws nothing for it", () => {
    const scene = new Scene();
    const a = new CharacterActor(scene, look(4), 1, true);
    a.setFirstPerson(true);
    let proxy: Object3D | undefined;
    scene.traverse((o) => {
      if (o.name === "head_shadow") proxy = o;
    });
    expect(proxy).toBeDefined();
    expect((proxy as unknown as { castShadow: boolean }).castShadow).toBe(true);
    expect((proxy as unknown as { material: { colorWrite: boolean } }).material.colorWrite).toBe(false);
    expect(proxy!.visible).toBe(true);
    a.setFirstPerson(false);
    expect(proxy!.visible).toBe(false);
  });

  it("stays hidden when the look changes (rig rebuild) and never throws mid-carry, revive, downed or ragdoll", () => {
    const scene = new Scene();
    const a = new CharacterActor(scene, look(5), 1, true);
    a.setFirstPerson(true, 0.5);
    a.setLook(look(6)); // rebuilds the rig
    const rig = () => (a as unknown as { rig: { joints: { head: Object3D } } }).rig;
    expect(rig().joints.head.visible).toBe(false);
    const eye = newEyeSample();
    for (const flags of [FLAG.GROUNDED | FLAG.CARRYING, FLAG.GROUNDED | FLAG.REVIVING, FLAG.GROUNDED | FLAG.DOWNED, FLAG.DRAGGING, FLAG.CROUCHING | FLAG.GROUNDED, 0]) {
      expect(() => {
        settle(a, pose(flags, { vx: 1, vz: 1 }), 10);
        a.setFirstPerson(false);
        a.setFirstPerson(true, 1);
        a.sampleEye(eye);
      }).not.toThrow();
      expect(rig().joints.head.visible).toBe(false);
      for (const v of [eye.neck.x, eye.neck.y, eye.neck.z, eye.eyeUp, eye.eyeReach]) expect(Number.isFinite(v)).toBe(true);
    }
    a.setLook(look(7));
    expect(rig().joints.head.visible).toBe(false);
  });

  it("the body turns with the camera in first person and eases back to the server heading after", () => {
    const a = new CharacterActor(new Scene(), look(8), 1, false);
    settle(a, pose(FLAG.GROUNDED, { facing: 0.4 }), 5);
    expect(a.facing).toBeCloseTo(0.4);
    a.setFirstPerson(true, -2.5);
    settle(a, pose(FLAG.GROUNDED, { facing: 0.4 }), 60);
    expect(a.facing).toBeCloseTo(-2.5, 2);
    a.setFirstPerson(false);
    settle(a, pose(FLAG.GROUNDED, { facing: 0.4 }), 400);
    expect(a.facing).toBeCloseTo(0.4, 3);
  });

  it("a remote body (never put in first person) is drawn exactly as before", () => {
    const a = new CharacterActor(new Scene(), look(9), 1, false);
    settle(a, pose(FLAG.GROUNDED, { facing: 1.1 }), 10);
    expect(a.facing).toBe(1.1);
    const rig = (a as unknown as { rig: { joints: { head: Object3D; shoulderL: Object3D } } }).rig;
    expect(rig.joints.head.visible).toBe(true);
  });

  it("carrying puts the hands out in front (toward -Z) in first person, and the eye sample tells when the body is lying", () => {
    const a = new CharacterActor(new Scene(), look(10), 1, false);
    a.setFirstPerson(true, 0.4);
    settle(a, pose(FLAG.GROUNDED | FLAG.CARRYING, { facing: 0.4 }), 60);
    const j = (a as unknown as { rig: { joints: { shoulderL: Object3D; shoulderR: Object3D } } }).rig.joints;
    // A hanging arm swings forward (-Z) with positive X rotation.
    expect(j.shoulderL.rotation.x).toBeGreaterThan(0.5);
    expect(j.shoulderR.rotation.x).toBeGreaterThan(0.5);
    const eye = newEyeSample();
    expect(a.sampleEye(eye).lying).toBe(false);
    settle(a, pose(FLAG.GROUNDED | FLAG.DOWNED), 5);
    expect(a.sampleEye(eye).lying).toBe(true);
    expect(eye.grounded).toBe(true);
  });
});

describe("CharacterActor third-person aim", () => {
  const AIMING = FLAG.GROUNDED | FLAG.AIMING;
  it("turns the local body to the aim ray while AIM is held, smoothed, and eases back to the server heading on release", () => {
    const a = new CharacterActor(new Scene(), look(11), 1, false);
    settle(a, pose(FLAG.GROUNDED, { facing: 0.4 }), 5);
    a.setAimYaw(-1.2); // a ray is known, but AIM is not held: the body keeps the server's heading
    settle(a, pose(FLAG.GROUNDED, { facing: 0.4 }), 30);
    expect(a.facing).toBe(0.4);
    a.update(1 / 60, pose(AIMING, { facing: 0.4 }));
    expect(a.facing).toBeGreaterThan(-1.2); // smoothed: one frame does not snap
    expect(a.facing).toBeLessThan(0.4);
    settle(a, pose(AIMING, { facing: 0.4 }), 90);
    expect(a.facing).toBeCloseTo(-1.2, 2);
    a.setAimYaw(2.9); // the long way round is across the +-PI seam, not through zero
    a.update(1 / 60, pose(AIMING, { facing: 0.4 }));
    expect(a.facing).toBeLessThan(-1.2);
    settle(a, pose(AIMING, { facing: 0.4 }), 120);
    expect(Math.abs(Math.atan2(Math.sin(a.facing - 2.9), Math.cos(a.facing - 2.9)))).toBeLessThan(0.01);
    settle(a, pose(FLAG.GROUNDED, { facing: 0.4 }), 400); // AIM released
    expect(a.facing).toBeCloseTo(0.4, 3);
  });

  it("does nothing without a ray, when downed, in first person, or for a body that was never given one", () => {
    const a = new CharacterActor(new Scene(), look(12), 1, false);
    a.setAimYaw(undefined);
    settle(a, pose(AIMING, { facing: 0.4 }), 60);
    expect(a.facing).toBe(0.4);
    a.setAimYaw(1.5);
    settle(a, pose(AIMING | FLAG.DOWNED, { facing: 0.4 }), 60);
    expect(a.facing).toBeCloseTo(0.4, 2);
    a.setFirstPerson(true, -2);
    settle(a, pose(AIMING, { facing: 0.4 }), 80);
    expect(a.facing).toBeCloseTo(-2, 2); // the camera's yaw wins in first person
    const remote = new CharacterActor(new Scene(), look(13), 1, false);
    settle(remote, pose(AIMING, { facing: 1.1 }), 60);
    expect(remote.facing).toBe(1.1);
  });
});

describe("CharacterActor torch (the raid's raiders)", () => {
  it("a bearer who goes down drops the lit torch where the hand was, once; carrying something only puts it away", () => {
    const a = new CharacterActor(new Scene(), look(12), 3, false);
    const drops: [number, number, number][] = [];
    a.onTorchDropped = (x, y, z) => drops.push([x, y, z]);
    settle(a, pose(FLAG.GROUNDED, { torch: true }));
    expect(drops).toEqual([]);
    // busy hands (a carried crate) put it away: no drop
    settle(a, pose(FLAG.GROUNDED | FLAG.CARRYING, { torch: true }), 5);
    expect(drops).toEqual([]);
    settle(a, pose(FLAG.GROUNDED, { torch: true }), 5);
    // down: it falls, near the body, on the body's ground (y), and only on the frame it fell
    settle(a, pose(FLAG.GROUNDED | FLAG.DOWNED, { torch: true }), 30);
    expect(drops.length).toBe(1);
    const [x, y, z] = drops[0]!;
    expect(Math.hypot(x - 2, z + 3)).toBeLessThan(1.5);
    expect(y).toBe(0);
    a.dispose();
  });
});

describe("D-084: faces in play", () => {
  const anim = (a: CharacterActor) => (a as unknown as { anim: { currentExpression: string; look: number } }).anim;

  it("pain wins; then a passing mood for its time; a raised sight narrows the eyes; then the neutral face again", () => {
    const a = new CharacterActor(new Scene(), look(5), 1, false);
    settle(a, pose());
    expect(anim(a).currentExpression).toBe("neutral");
    a.cue("triumph", 1);
    settle(a, pose(), 10);
    expect(anim(a).currentExpression).toBe("triumph");
    settle(a, pose(FLAG.GROUNDED | FLAG.AIMING), 60); // (the grin has passed; the sight is up)
    expect(anim(a).currentExpression).toBe("angry");
    a.cue("fear", 2);
    settle(a, pose(FLAG.GROUNDED | FLAG.DOWNED), 5);
    expect(anim(a).currentExpression).toBe("pain");
    settle(a, pose(), 200);
    expect(anim(a).currentExpression).toBe("neutral");
  });

  it("a weaker mood never cuts a stronger short (a panicked soldier does not grin at the next shot), and the same mood is extended, not restarted", () => {
    const a = new CharacterActor(new Scene(), look(6), 1, false);
    a.cue("fear", 3);
    a.cue("angry", 1);
    a.cue("triumph", 1);
    expect(a.currentMood).toBe("fear");
    settle(a, pose(), 200); // (past three seconds)
    expect(a.currentMood).toBeUndefined();
    a.cue("surprise", 1);
    a.cue("fear", 0.5);
    expect(a.currentMood).toBe("fear");
  });

  it("the head turns toward a blast to one side, eases back after, and never twists to look behind", () => {
    const a = new CharacterActor(new Scene(), look(7), 1, false);
    const p = pose(FLAG.GROUNDED, { x: 0, z: 0, facing: 0 }); // facing north (-z)
    settle(a, p);
    a.lookAt(-6, -6, 1); // ahead and to one side
    settle(a, p, 30);
    const side = anim(a).look;
    expect(Math.abs(side)).toBeGreaterThan(0.4);
    expect(Math.abs(side)).toBeLessThanOrEqual(1.05);
    settle(a, p, 200);
    expect(Math.abs(anim(a).look)).toBeLessThan(0.05);
    a.lookAt(0, 8, 2); // directly behind
    settle(a, p, 30);
    expect(Math.abs(anim(a).look)).toBeLessThan(0.05);
  });
});
