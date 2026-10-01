import type { ExpressionId } from "./expressions.ts";

/**
 * What an expression does to the BODY (the face is faceAnimate.ts). The animator keeps a smoothed weight per expression and adds each weight times its row
 * of `MOOD_BODY`; the table is exhaustive over `ExpressionId`, so a new expression is a compile error until somebody decides what its body does.
 *
 * Signs follow the rig (animator.ts): a torso or head pitch that is POSITIVE tips back (chest out, chin up), NEGATIVE folds forward; `out` abducts both arms away
 * from the body; `lift` raises the shoulders (metres); the right hand has its own extra (a hand on the belly, a hand at the mouth). `heave` is a trunk oscillation
 * (radians of torso pitch at `rate` rad/s, with a little of it in the shoulders): a laugh convulses, a sleeper breathes slowly.
 *
 * Neutral and the original five (pain, fear, triumph, drunk, angry) are authored inline in the animator's gait code, where they interact with the stride: their rows here are
 * `NONE` on purpose, so adding them to the table twice would double them.
 */
export interface BodyMood {
  /** Torso pitch: + back (chest out), - folded forward. */
  chest: number;
  /** Torso yaw (a turn away) and roll (a lean to the side). */
  twist: number;
  roll: number;
  /** Shoulders raised (+) or dropped (-), metres. */
  lift: number;
  /** Head pitch (+ back, chin up, as the rig's head.rotation.x), yaw and roll. */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** Both arms: shoulder swing (+ forward), abduction, elbow flexion. */
  armSwing: number;
  armOut: number;
  armBend: number;
  /** Extra for the right hand only. */
  handSwing: number;
  handBend: number;
  /** Trunk oscillation: amplitude (radians) and rate (rad/s). */
  heave: number;
  heaveRate: number;
}

const NONE: Readonly<BodyMood> = {
  chest: 0, twist: 0, roll: 0, lift: 0, headPitch: 0, headYaw: 0, headRoll: 0, armSwing: 0, armOut: 0, armBend: 0, handSwing: 0, handBend: 0, heave: 0, heaveRate: 0,
};
const body = (o: Partial<BodyMood>): Readonly<BodyMood> => ({ ...NONE, ...o });

export const MOOD_BODY: Readonly<Record<ExpressionId, Readonly<BodyMood>>> = {
  neutral: NONE,
  pain: NONE,
  fear: NONE,
  triumph: NONE,
  drunk: NONE,
  angry: NONE,
  // smug: chest out, chin up and tilted, elbows out with the thumbs in the waistcoat
  smug: body({ chest: 0.1, roll: 0.03, headPitch: 0.12, headRoll: 0.12, headYaw: 0.08, lift: 0.006, armSwing: 0.28, armOut: 0.2, armBend: 0.95, heave: 0.006, heaveRate: 2.2 }),
  // disgust: the whole body leans away from it, the head turns off, one hand comes up between
  disgust: body({ chest: 0.13, twist: -0.12, roll: -0.05, lift: 0.014, headPitch: 0.06, headYaw: 0.3, headRoll: -0.1, armSwing: 0.2, armOut: 0.1, armBend: 0.5, handSwing: 0.75, handBend: 0.9 }),
  // surprise: a start backwards, shoulders up, both hands thrown out and open
  surprise: body({ chest: 0.15, lift: 0.03, headPitch: 0.1, armSwing: 0.45, armOut: 0.4, armBend: 0.65, heave: 0.01, heaveRate: 9 }),
  // laugh: the trunk heaves, the head is thrown back, one hand holds the stomach
  laugh: body({ chest: 0.05, lift: 0.018, headPitch: 0.22, headRoll: 0.06, armSwing: 0.2, armOut: 0.15, armBend: 0.6, handSwing: 0.45, handBend: 1.1, heave: 0.07, heaveRate: 15 }),
  // sleep: folded over, the head hanging on one side, arms slack, one slow breath
  sleep: body({ chest: -0.22, roll: 0.05, lift: -0.02, headPitch: -0.4, headRoll: 0.18, armSwing: 0.04, armOut: 0, armBend: 0.2, heave: 0.024, heaveRate: 2.6 }),
};

/** The five expressions whose body lives in the table (the others are authored inline in the animator). */
export const TABLE_MOODS = ["smug", "disgust", "surprise", "laugh", "sleep"] as const satisfies readonly ExpressionId[];
export type TableMood = (typeof TABLE_MOODS)[number];

/** The summed body mood for the current weights (written into `out`; allocation-free). `time` drives the heave; `free` (0..1) is how free the body is to emote: 0 downed or in the air. */
export function sumBodyMood(w: Readonly<Record<TableMood, number>>, time: number, free: number, out: BodyMood): BodyMood {
  out.chest = out.twist = out.roll = out.lift = out.headPitch = out.headYaw = out.headRoll = 0;
  out.armSwing = out.armOut = out.armBend = out.handSwing = out.handBend = out.heave = out.heaveRate = 0;
  for (let i = 0; i < TABLE_MOODS.length; i++) {
    const id = TABLE_MOODS[i]!;
    const k = w[id] * free;
    if (k < 1e-4) continue;
    const r = MOOD_BODY[id];
    out.chest += r.chest * k;
    out.twist += r.twist * k;
    out.roll += r.roll * k;
    out.lift += r.lift * k;
    out.headPitch += r.headPitch * k;
    out.headYaw += r.headYaw * k;
    out.headRoll += r.headRoll * k;
    out.armSwing += r.armSwing * k;
    out.armOut += r.armOut * k;
    out.armBend += r.armBend * k;
    out.handSwing += r.handSwing * k;
    out.handBend += r.handBend * k;
    // the trunk oscillation: each mood's own rate, summed as a displacement (so a blend of two stays smooth)
    out.heave += r.heave * k * Math.sin(time * r.heaveRate);
  }
  return out;
}
