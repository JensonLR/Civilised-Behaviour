import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { generateCharacter } from "../spec.ts";
import { CharacterAnimator } from "./animator.ts";
import { EXPRESSION_IDS, type ExpressionId } from "./expressions.ts";
import { MOOD_BODY, TABLE_MOODS } from "./moodBody.ts";
import { buildCharacter, type CharacterRig } from "./rig.ts";

const G = FLAG.GROUNDED;
const make = (id: ExpressionId, intensity = 1, seed = 3): { rig: CharacterRig; anim: CharacterAnimator } => {
  const rig = buildCharacter({ ...generateCharacter(seed), woodenLeg: 0 }, { outline: false });
  const anim = new CharacterAnimator(rig);
  anim.autoBlink = false;
  anim.setExpression(id, intensity);
  return { rig, anim };
};
const stand = (anim: CharacterAnimator, seconds = 1.5, flags: number = G, onFrame?: () => void): void => {
  for (let i = 0; i < seconds * 30; i++) {
    anim.update(1 / 30, { speed: 0, flags, vy: 0 });
    onFrame?.();
  }
};
const BONES = ["torso", "head", "shoulderL", "shoulderR", "elbowL", "elbowR", "pelvis"] as const;
const pose = (rig: CharacterRig): number[] => {
  const out: number[] = [];
  for (const b of BONES) out.push(rig.joints[b].rotation.x, rig.joints[b].rotation.y, rig.joints[b].rotation.z);
  return out;
};
const poseOf = (id: ExpressionId, intensity = 1, flags: number = G, seconds = 1.5): number[] => {
  const m = make(id, intensity);
  stand(m.anim, seconds, flags);
  const p = pose(m.rig);
  m.rig.dispose();
  return p;
};
/** Bones that carry a mood (the torso, head, shoulders, elbows) that differ from the neutral pose by at least `tol` radians. */
const differing = (a: number[], b: number[], tol: number): string[] => {
  const names: string[] = [];
  BONES.forEach((bone, i) => {
    if (bone === "pelvis") return;
    for (let k = 0; k < 3; k++) if (Math.abs(a[i * 3 + k]! - b[i * 3 + k]!) >= tol) {
      names.push(bone);
      return;
    }
  });
  return names;
};

// The original five's poses after 1.5 s standing (seed 3, intensity 1), recorded BEFORE the table moods landed: bones torso, head, shoulderL, shoulderR, elbowL, elbowR, pelvis (x, y, z each).
const GOLDEN: Record<string, number[]> = {
  pain: [-0.5596100358823033, 0, 0, 0.7196705039705014, 0.01567137170357233, 0, 0, 0, -0.5, 0.4426729107212442, 0, -0.19691398336655164, 0.6399382950979566, 0, 0, 1.8482891543497177, 0, 0, 0, 0, 0],
  fear: [-0.15965939980393806, 0, 0, -0.05023447048035169, 0.03627475299258362, 0, 0.8286680661753756, 0, 0.20091237917616822, 0.8811209030596361, 0, -0.20091237917616822, 1.8587878585467745, 0, 0, 1.8587878585467745, 0, 0, 0, 0, 0],
  triumph: [-0.09965146465542535, 0, 0, -0.04525809713450901, 0.01566761669463824, 0, 2.0861836247322025, 0, -0.4550012391402207, 2.4586912221055033, 0, 0.4550012391402207, 0.4639910781904107, 0, 0, 0.3289947956110729, 0, 0, 0, 0, 0],
  drunk: [-0.208743730461748, 0.15772653732859668, -0.04011609315162567, 0.14585847833079493, -0.0713483461889535, 0.15282621033019828, -0.07161122443521431, 0, -0.5313688210035946, -0.27810784862783466, 0, 0.512435412639816, 0.14, 0, 0, 0.14, 0, 0, 0, 0, 0.028428442009860822],
  angry: [-0.3996297814509573, 0, 0, 0.3997099951078093, 0.01567137170357233, 0, 0.17597827987448075, 0, -0.5, 0.17597827987448075, 0, 0.5, 0.865910404482233, 0, 0, 0.865910404482233, 0, 0, 0, 0, 0],
};

describe("moods: every expression has a body", () => {
  const neutral = poseOf("neutral");

  it("the table is exhaustive and the table moods are exactly the five the original code did not know", () => {
    expect(Object.keys(MOOD_BODY).sort()).toEqual([...EXPRESSION_IDS].sort());
    expect([...TABLE_MOODS].sort()).toEqual(["disgust", "laugh", "sleep", "smug", "surprise"]);
  });

  for (const id of TABLE_MOODS) {
    it(`${id}: at intensity 1 at least two body bones move by 0.02 rad or more, and intensity 0 is neutral`, () => {
      const p = poseOf(id, 1);
      expect(differing(p, neutral, 0.02).length).toBeGreaterThanOrEqual(2);
      const zero = poseOf(id, 0);
      zero.forEach((v, i) => expect(Math.abs(v - neutral[i]!)).toBeLessThan(1e-9));
    });
  }

  it("sleep slumps the head and the torso; a laugh heaves the trunk", () => {
    const sleep = poseOf("sleep");
    // torso x (index 0) folds forward (more negative); the head (index 3) ends lower than the neutral head
    expect(neutral[0]! - sleep[0]!).toBeGreaterThanOrEqual(0.05);
    expect(Math.abs(neutral[3]! - sleep[3]!)).toBeGreaterThanOrEqual(0.05);
    const m = make("laugh");
    stand(m.anim, 1.5);
    let lo = Infinity;
    let hi = -Infinity;
    stand(m.anim, 1.5, G, () => {
      lo = Math.min(lo, m.rig.joints.torso.rotation.x);
      hi = Math.max(hi, m.rig.joints.torso.rotation.x);
    });
    expect((hi - lo) / 2).toBeGreaterThanOrEqual(0.02);
    m.rig.dispose();
  });

  it("the original five keep their golden poses to 1e-6", () => {
    for (const [id, want] of Object.entries(GOLDEN)) {
      const got = poseOf(id as ExpressionId);
      got.forEach((v, i) => expect(Math.abs(v - want[i]!), `${id}[${i}]`).toBeLessThan(1e-6));
    }
  });

  it("every angle stays inside the rig's limits for all eleven moods, standing and walking", () => {
    for (const id of EXPRESSION_IDS) {
      const m = make(id);
      for (const speed of [0, 2.5, 6]) {
        for (let i = 0; i < 90; i++) {
          m.anim.update(1 / 30, { speed, flags: G, vy: 0 });
          const j = m.rig.joints;
          for (const el of [j.elbowL, j.elbowR]) {
            expect(el.rotation.x).toBeLessThanOrEqual(2.42);
            expect(el.rotation.x).toBeGreaterThanOrEqual(0);
          }
          // (the arm solver's shoulder range; the original five's sprint-swing is older than it and is not held to it here)
          for (const sh of TABLE_MOODS.includes(id as never) ? [j.shoulderL, j.shoulderR] : []) {
            expect(sh.rotation.x, `${id} ${speed}`).toBeGreaterThan(-1.3);
            expect(sh.rotation.x).toBeLessThan(3.0);
            expect(Math.abs(sh.rotation.z)).toBeLessThan(1.5);
          }
          expect(Math.abs(j.torso.rotation.x)).toBeLessThan(1);
          expect(Math.abs(j.head.rotation.x)).toBeLessThan(1.2);
        }
      }
      m.rig.dispose();
    }
  });

  it("nothing while downed or in the air: the table moods add no body", () => {
    const downNeutral = poseOf("neutral", 1, FLAG.DOWNED);
    const airNeutral = poseOf("neutral", 1, 0);
    for (const id of TABLE_MOODS) {
      poseOf(id, 1, FLAG.DOWNED).forEach((v, i) => expect(Math.abs(v - downNeutral[i]!)).toBeLessThan(2e-3));
      poseOf(id, 1, 0).forEach((v, i) => expect(Math.abs(v - airNeutral[i]!)).toBeLessThan(2e-3));
    }
  });

  it("deterministic: two characters with the same spec and mood pose identically", () => {
    for (const id of TABLE_MOODS) expect(poseOf(id)).toEqual(poseOf(id));
  });

  it("allocation-free: a thousand frames of every table mood do not grow the heap", () => {
    const m = make("laugh");
    stand(m.anim, 1);
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    gc();
    const before = process.memoryUsage().heapUsed;
    for (const id of TABLE_MOODS) {
      m.anim.setExpression(id);
      for (let i = 0; i < 1000; i++) m.anim.update(1 / 30, { speed: i % 3, flags: G, vy: 0 });
    }
    gc();
    // what is RETAINED: a leak of one object per frame (5000 frames) would be hundreds of kilobytes
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(2e5);
    m.rig.dispose();
  });
});
