/**
 * The expression set as data. Every expression is a full face pose (`FaceTarget`); the face animator (faceAnimate.ts) eases the live pose toward the current target and drives the
 * eyes, lids, brows and the head's morph targets from it. An expression can be shown at any intensity 0..1 (a blend of the neutral pose and the expression), so a flinch and a
 * scream are the same expression at two strengths. Order is the wire order of nothing (expressions are cosmetic and never replicated), but APPEND new ones.
 */

export type ExpressionId = "neutral" | "pain" | "fear" | "triumph" | "drunk" | "angry" | "smug" | "disgust" | "surprise" | "laugh" | "sleep";

export const EXPRESSION_IDS: readonly ExpressionId[] = ["neutral", "pain", "fear", "triumph", "drunk", "angry", "smug", "disgust", "surprise", "laugh", "sleep"];

export interface FaceTarget {
  /** Brow height: -1 (lowered) .. 1 (raised). */
  brow: number;
  /** Brow tilt: positive = inner ends down (angry), negative = inner ends up (worried). */
  browTilt: number;
  /** Brow curve: -1 (flat, drooping) .. 1 (high arch: surprise, a raised eyebrow). */
  browArch: number;
  /** Brows drawn together and down at the middle (a frown line between them): 0..1. */
  knit: number;
  /** 0 closed .. 1 open .. 1.2 wide. */
  eyes: number;
  /** Slant of the upper lids: positive = inner ends down (a glare), negative = outer ends down (sad, sleepy). */
  lidSlant: number;
  /** Lower lids and cheeks pushed up (a grin, a wince, a glare): 0..1. */
  squint: number;
  /** Pupil size multiplier (fear widens, triumph narrows). */
  pupil: number;
  /** Where the eyes look: +x toward the character's right, +y up (radians-ish, -1..1). */
  gazeX: number;
  gazeY: number;
  /** -1 frown .. 1 smile. */
  mouthCurve: number;
  /** 0 shut .. 1 gaping. */
  mouthOpen: number;
  /** Lips pursed into an O: 0..1. */
  pucker: number;
  /** Corners pulled straight out and back (a grimace, a scream): 0..1. */
  stretch: number;
  /** Upper lip and nose folds lifted, nostrils flared (disgust, a snarl): 0..1. */
  snarl: number;
  /** One corner of the mouth up: -1 (the character's left) .. 1 (right). */
  smirk: number;
  /** Teeth bared through parted lips with the jaw shut: 0..1. */
  bare: number;
  /** Tongue out: 0..1. */
  tongue: number;
  /** Cheeks puffed: 0..1. */
  puff: number;
  /** One brow higher than the other (drunk, scornful): -1..1. */
  asym: number;
}

export const NEUTRAL: Readonly<FaceTarget> = {
  brow: 0, browTilt: 0, browArch: 0.2, knit: 0, eyes: 0.78, lidSlant: 0, squint: 0, pupil: 1, gazeX: 0, gazeY: 0,
  mouthCurve: 0.15, mouthOpen: 0, pucker: 0, stretch: 0, snarl: 0, smirk: 0, bare: 0, tongue: 0, puff: 0, asym: 0,
};

const make = (over: Partial<FaceTarget>): Readonly<FaceTarget> => ({ ...NEUTRAL, ...over });

export const EXPRESSIONS: Readonly<Record<ExpressionId, Readonly<FaceTarget>>> = {
  neutral: NEUTRAL,
  // pain: brows knitted and drawn up at the inner ends, eyes squeezed, the mouth hauled open and back
  pain: make({ brow: -0.1, browTilt: -0.75, browArch: 0.1, knit: 0.6, eyes: 0.3, lidSlant: -0.3, squint: 0.9, pupil: 0.85, mouthCurve: -0.7, mouthOpen: 0.5, stretch: 0.6, snarl: 0.35 }),
  // fear: brows high and drawn together, eyes wide, pupils wide, mouth open and pulled back
  fear: make({ brow: 1, browTilt: -0.55, browArch: 0.6, knit: 0.3, eyes: 1.2, pupil: 1.5, mouthCurve: -0.35, mouthOpen: 0.75, stretch: 0.5, gazeY: -0.1 }),
  triumph: make({ brow: 0.5, browTilt: 0.15, browArch: 0.55, eyes: 0.9, squint: 0.55, pupil: 0.85, mouthCurve: 1, mouthOpen: 0.5, stretch: 0.15 }),
  drunk: make({ brow: 0.1, browTilt: -0.2, browArch: 0.1, eyes: 0.5, lidSlant: -0.2, squint: 0.2, pupil: 1.15, mouthCurve: 0.55, mouthOpen: 0.25, smirk: 0.6, tongue: 0.25, asym: 0.7 }),
  // angry: brows down and knitted, a glare under them, teeth bared
  angry: make({ brow: -0.5, browTilt: 0.9, browArch: -0.3, knit: 0.9, eyes: 0.75, lidSlant: 0.6, squint: 0.55, pupil: 0.8, mouthCurve: -0.55, mouthOpen: 0.15, snarl: 0.7, bare: 0.9, stretch: 0.25 }),
  // smug: one brow up, half-lidded eyes glancing aside, a smirk
  smug: make({ brow: 0.15, browTilt: 0.2, browArch: 0.45, eyes: 0.55, lidSlant: 0.15, squint: 0.25, pupil: 0.9, gazeX: 0.3, mouthCurve: 0.6, smirk: 1, asym: 0.9 }),
  // disgust: nose wrinkled, upper lip lifted, brows down, the tongue out a little
  disgust: make({ brow: -0.25, browTilt: 0.4, browArch: -0.1, knit: 0.5, eyes: 0.55, lidSlant: 0.2, squint: 0.7, pupil: 0.9, mouthCurve: -0.85, mouthOpen: 0.3, snarl: 1, stretch: 0.2, tongue: 0.5, smirk: -0.2 }),
  // surprise: brows high and arched, eyes wide, the mouth an O
  surprise: make({ brow: 1, browTilt: -0.1, browArch: 0.9, eyes: 1.2, pupil: 1.2, mouthCurve: 0, mouthOpen: 0.6, pucker: 0.75 }),
  // laugh: eyes squeezed shut into arcs, cheeks high, the mouth wide with teeth
  laugh: make({ brow: 0.4, browTilt: -0.15, browArch: 0.6, eyes: 0.2, squint: 1, pupil: 0.9, mouthCurve: 1, mouthOpen: 0.85, stretch: 0.35, tongue: 0.2 }),
  // sleep: eyes shut, everything slack, the jaw hanging a little
  sleep: make({ brow: -0.05, browArch: 0, eyes: 0, squint: 0.1, mouthCurve: 0.05, mouthOpen: 0.15, pupil: 1 }),
};

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Writes the blend of the neutral pose and `id` at `intensity` (0..1) into `out`. */
export function blendTarget(id: ExpressionId, intensity: number, out: FaceTarget): FaceTarget {
  const t = EXPRESSIONS[id] ?? NEUTRAL;
  const k = clamp01(intensity);
  const o = out as unknown as Record<string, number>;
  const a = NEUTRAL as unknown as Record<string, number>;
  const b = t as unknown as Record<string, number>;
  for (const key of Object.keys(NEUTRAL)) o[key] = a[key]! + (b[key]! - a[key]!) * k;
  return out;
}
