import { describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { generateCharacter } from "../spec.ts";
import { CharacterAnimator, type ExpressionId, type PoseInput } from "./animator.ts";
import { buildCharacter, type CharacterRig } from "./rig.ts";

const make = (seed = 3): { rig: CharacterRig; anim: CharacterAnimator } => {
  const rig = buildCharacter({ ...generateCharacter(seed), woodenLeg: 0 }, { outline: false });
  const anim = new CharacterAnimator(rig);
  return { rig, anim };
};
const G = FLAG.GROUNDED;
const run = (anim: CharacterAnimator, seconds: number, pose: PoseInput, onFrame?: (t: number) => void): void => {
  for (let i = 0; i < seconds * 30; i++) {
    anim.update(1 / 30, pose);
    onFrame?.(i / 30);
  }
};

describe("animator polish", () => {
  it("running counter-rotates: the torso twists against the pelvis, and the arms swing opposite the legs", () => {
    const { rig, anim } = make();
    anim.autoBlink = false;
    const twist: number[] = [];
    const pelvis: number[] = [];
    run(anim, 3, { speed: 6, flags: G, vy: 0 }, () => {
      twist.push(rig.joints.torso.rotation.y);
      pelvis.push(rig.joints.pelvis.rotation.y);
    });
    const tail = (a: number[]) => a.slice(-30);
    const range = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(range(tail(twist))).toBeGreaterThan(0.05);
    expect(range(tail(pelvis))).toBeGreaterThan(0.03);
    // opposite phase: when the pelvis yaws one way the torso yaws the other
    let opposed = 0;
    let same = 0;
    for (let i = 0; i < 30; i++) {
      const p = tail(pelvis)[i]!;
      const t = tail(twist)[i]!;
      if (Math.abs(p) > 0.01 && Math.abs(t) > 0.01) (Math.sign(p) !== Math.sign(t) ? opposed++ : same++);
    }
    expect(opposed).toBeGreaterThan(same);
    // arms opposite legs
    const armsAndLegs: [number, number][] = [];
    run(anim, 1, { speed: 6, flags: G, vy: 0 }, () => armsAndLegs.push([rig.joints.shoulderL.rotation.x, rig.joints.hipL.rotation.x]));
    let anti = 0;
    for (const [a, l] of armsAndLegs) if (Math.abs(a) > 0.05 && Math.abs(l) > 0.05 && Math.sign(a) !== Math.sign(l)) anti++;
    expect(anti).toBeGreaterThan(armsAndLegs.length * 0.3);
    rig.dispose();
  });

  it("a sprint leans further forward than a walk, and a crouch sinks the pelvis", () => {
    const walk = make();
    const sprint = make();
    const crouch = make();
    const idle = make();
    for (const m of [walk, sprint, crouch, idle]) m.anim.autoBlink = false;
    run(walk.anim, 2, { speed: 2, flags: G, vy: 0 });
    run(sprint.anim, 2, { speed: 6.5, flags: G | FLAG.SPRINTING, vy: 0 });
    run(crouch.anim, 2, { speed: 0, flags: G | FLAG.CROUCHING, vy: 0 });
    run(idle.anim, 2, { speed: 0, flags: G, vy: 0 });
    expect(-sprint.rig.joints.torso.rotation.x).toBeGreaterThan(-walk.rig.joints.torso.rotation.x + 0.05);
    expect(crouch.rig.joints.pelvis.position.y).toBeLessThan(idle.rig.joints.pelvis.position.y - 0.05);
    // the knees bend in a crouch
    expect(crouch.rig.joints.kneeL.rotation.x).toBeLessThan(idle.rig.joints.kneeL.rotation.x - 0.4);
  });

  it("take-off and landing have anticipation and follow-through: a wind-up dip before the jump, a spring on touchdown", () => {
    const { rig, anim } = make();
    anim.autoBlink = false;
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    const rest = rig.joints.pelvis.position.y;
    anim.windUp();
    let dip = 0;
    run(anim, 0.3, { speed: 0, flags: G, vy: 0 }, () => (dip = Math.max(dip, rest - rig.joints.pelvis.position.y)));
    expect(dip).toBeGreaterThan(0.015);
    // airborne, then land hard
    run(anim, 0.6, { speed: 0, flags: 0, vy: -6 });
    let lowY = Infinity;
    let deepestKnee = 0;
    run(anim, 0.5, { speed: 0, flags: G, vy: 0 }, () => {
      lowY = Math.min(lowY, rig.joints.pelvis.position.y);
      deepestKnee = Math.min(deepestKnee, rig.joints.kneeL.rotation.x);
    });
    run(anim, 2, { speed: 0, flags: G, vy: 0 });
    const settled = rig.joints.pelvis.position.y;
    expect(deepestKnee).toBeLessThan(rig.joints.kneeL.rotation.x - 0.2); // the knees give on touchdown ...
    expect(lowY).toBeLessThan(settled - 0.004); // ... the body dips below where it settles ...
    expect(Math.abs(settled - rest)).toBeLessThan(0.05); // ... and comes back to rest
    rig.dispose();
  });

  it("turning while moving banks the body into the turn, either way", () => {
    const left = make();
    const right = make();
    for (const m of [left, right]) m.anim.autoBlink = false;
    run(left.anim, 2, { speed: 5, flags: G, vy: 0, yawRate: 3 });
    run(right.anim, 2, { speed: 5, flags: G, vy: 0, yawRate: -3 });
    const lz = left.rig.joints.torso.rotation.z;
    const rz = right.rig.joints.torso.rotation.z;
    expect(Math.sign(lz)).not.toBe(Math.sign(rz));
    expect(Math.abs(lz - rz)).toBeGreaterThan(0.1);
  });

  it("idle life has variety: over a minute the standing pose is not one repeated loop, yet is deterministic per character", () => {
    const sample = (seed: number): string => {
      const { rig, anim } = make(seed);
      const seen = new Set<string>();
      let trace = "";
      run(anim, 60, { speed: 0, flags: G, vy: 0 }, (t) => {
        if (Math.round(t * 30) % 15 === 0) {
          const r = rig.joints;
          const key = [r.shoulderL.rotation.x, r.shoulderR.rotation.x, r.head.rotation.y, r.torso.rotation.y].map((v) => v.toFixed(1)).join(",");
          seen.add(key);
          trace += key + ";";
        }
      });
      rig.dispose();
      return trace.length + ":" + seen.size + ":" + trace;
    };
    const a = sample(3);
    expect(sample(3)).toBe(a);
    expect(Number(a.split(":")[1])).toBeGreaterThan(12);
    expect(sample(11)).not.toBe(a);
  });

  it("moods move the whole body, not just the face: pain hunches, fear cowers, triumph throws the arms up, drunk sways", () => {
    const pose = (mood: ExpressionId): { rig: CharacterRig; anim: CharacterAnimator } => {
      const m = make();
      m.anim.autoBlink = false;
      m.anim.setExpression(mood);
      return m;
    };
    const neutral = pose("neutral");
    const pain = pose("pain");
    const fear = pose("fear");
    const triumph = pose("triumph");
    const drunk = pose("drunk");
    const st = { speed: 0, flags: G, vy: 0 };
    for (const m of [neutral, pain, fear, triumph, drunk]) run(m.anim, 3, st);
    expect(-pain.rig.joints.torso.rotation.x).toBeGreaterThan(-neutral.rig.joints.torso.rotation.x + 0.1); // hunched forward
    expect(fear.rig.joints.kneeL.rotation.x).toBeLessThan(neutral.rig.joints.kneeL.rotation.x - 0.05); // knees give
    expect(triumph.rig.joints.shoulderL.rotation.x).toBeGreaterThan(neutral.rig.joints.shoulderL.rotation.x + 1); // arms up
    let lo = Infinity;
    let hi = -Infinity;
    run(drunk.anim, 4, st, () => {
      lo = Math.min(lo, drunk.rig.joints.torso.rotation.z);
      hi = Math.max(hi, drunk.rig.joints.torso.rotation.z);
    });
    expect(hi - lo).toBeGreaterThan(0.04); // swaying
    for (const m of [neutral, pain, fear, triumph, drunk]) m.rig.dispose();
  });

  it("a peg leg swings stiffly outward and hops the pelvis; no NaN across mixed moods, poses and LODs", () => {
    const rig = buildCharacter({ ...generateCharacter(5), woodenLeg: 2 }, { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    let swing = 0;
    run(anim, 2, { speed: 3, flags: G | FLAG.PEG_LEG, vy: 0 }, () => (swing = Math.max(swing, Math.abs(rig.joints.hipR.rotation.z))));
    expect(swing).toBeGreaterThan(0.08);
    const moods: ExpressionId[] = ["neutral", "pain", "fear", "triumph", "drunk", "angry"];
    moods.forEach((mood, i) => {
      anim.setExpression(mood);
      rig.setLod((i % 3) as 0 | 1 | 2);
      run(anim, 1, { speed: i * 1.2, flags: i % 2 ? G | FLAG.CROUCHING : G | FLAG.SPRINTING, vy: 0, yawRate: i - 2 });
    });
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => o.matrix.elements.forEach((e) => expect(Number.isFinite(e)).toBe(true)));
    rig.dispose();
  });
});
