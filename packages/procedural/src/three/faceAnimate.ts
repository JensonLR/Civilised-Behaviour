import { NEUTRAL, blendTarget, type ExpressionId, type FaceTarget } from "./expressions.ts";
import type { FaceParts } from "./faceRig.ts";

const damp = (current: number, target: number, rate: number, dt: number): number => current + (target - current) * (1 - Math.exp(-rate * dt));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Deterministic 0..1 hash of an integer (blink and glance timing: no Math.random in anything a replay or test could see). */
const h01 = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** How fast each part of the pose eases toward its target (per second); the default is quick, the pupils and the brows' asymmetry slower. */
const RATE: Readonly<Partial<Record<keyof FaceTarget, number>>> = { pupil: 8, asym: 6, gazeX: 10, gazeY: 10, tongue: 9, puff: 8, smirk: 10, bare: 16 };
const KEYS = Object.keys(NEUTRAL) as (keyof FaceTarget)[];
/** Upper lid rotation (about X) at which the lash line lies a little below the middle of the eye; the lower lid rises to meet it. */
const LID_CLOSED = -0.59;

/** How a shut eye changes shape (see `FaceAnimator.update`): wider, flatter and a little shallower, as fractions of its open size. */
const SLIT_WIDEN = 0.1;
const SLIT_FLATTEN = 0.4;
const SLIT_SHALLOW = 0.15;
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Drives the face from an expression: eases the live pose (`face.pose`) toward the blend of neutral and the current expression, blinks, glances about, and writes the pose
 * onto the eyes, lids, brows and morph targets. No allocation per frame. One per animator.
 */
export class FaceAnimator {
  private blink = 0;
  private blinkTimer: number;
  private time = 0;
  private dartX = 0;
  private dartY = 0;
  private dartTargetX = 0;
  private dartTargetY = 0;
  private dartSlot = -1;
  private readonly target: FaceTarget = { ...NEUTRAL };

  constructor(private readonly seed: number) {
    this.blinkTimer = 1 + h01(seed) * 3;
  }

  /**
   * `drunk` is the animator's smoothed drunkenness 0..1 (the eyes droop and drift); `ambient` switches on the blinking and the little glances (off for stills and deterministic
   * tests). `R` is the head radius.
   */
  update(face: FaceParts, R: number, dt: number, id: ExpressionId, intensity: number, drunk: number, ambient: boolean): void {
    if (!face.active) return; // a far-crowd rig has no face to move
    this.time += dt;
    const f = face.pose;
    const t = blendTarget(id, intensity, this.target);
    const rate = 14;
    for (const k of KEYS) f[k] = damp(f[k], t[k], RATE[k] ?? rate, dt);

    // ---- blinks and glances ------------------------------------------------------------------------------------------------
    this.blinkTimer -= dt;
    if (ambient && this.blinkTimer <= 0) {
      this.blink = 1;
      this.blinkTimer = 2 + h01(Math.floor(this.time * 10) + this.seed) * 3;
    }
    this.blink = Math.max(0, this.blink - dt * 9);
    if (ambient) {
      const slot = Math.floor(this.time / 1.3);
      if (slot !== this.dartSlot) {
        this.dartSlot = slot;
        this.dartTargetX = (h01(slot * 7 + this.seed) - 0.5) * 0.3;
        this.dartTargetY = (h01(slot * 13 + this.seed + 5) - 0.5) * 0.16;
      }
    } else {
      this.dartTargetX = this.dartTargetY = 0;
    }
    this.dartX = damp(this.dartX, this.dartTargetX, 22, dt);
    this.dartY = damp(this.dartY, this.dartTargetY, 22, dt);

    // ---- eyes: the upper lid closes with a blink, a squeeze or a droop and lifts for wide eyes; the lower lid rises for a squint --------------------------------------------
    const wideExtra = Math.max(0, f.eyes - 1);
    const closed = clamp(this.blink + (1 - Math.min(f.eyes, 1)) * 0.9 + face.lidBias + drunk * 0.1 * (0.5 + 0.5 * Math.sin(this.time * 1.4)) - wideExtra * 0.7, -0.5, 1);
    // (the lid comes down until its lash line lies just below the middle of the eye and no further: any lower and the eye would be a bump with its edge buried in the cheek)
    const lidAngle = Math.max(LID_CLOSED, 0.5 + (-Math.PI / 2 - 0.5) * closed);
    face.lidL.rotation.x = lidAngle;
    face.lidR.rotation.x = lidAngle;
    // a glare slants the upper lids (inner ends down), a sad or sleepy look tips them the other way
    const slant = f.lidSlant * 0.3 * (1 - this.blink);
    face.lidR.rotation.z = slant;
    face.lidL.rotation.z = -slant;
    // the lower lid rises to meet the upper one as it closes, and further for a squint
    const shut = clamp((0.5 - lidAngle) / (0.5 - LID_CLOSED), 0, 1);
    const low = Math.PI - 0.6 + face.lowerLidBase * 1.2 + Math.min(1.1, f.squint * 0.75 + shut * shut * 1.05);
    face.lowerLidL.rotation.x = low;
    face.lowerLidR.rotation.x = low;
    // a SHUT eye is an almond, not a bump: the whole eye (ball, lids, the lot) flattens and widens as the lid comes to its closed angle, so the visible lid is a wide slit with its
    // lash line, at least 2.2 times as wide as it is tall (a fully round eye sphere under a round cap read as a button). Only past a half shut, so an open or a half-lidded eye is untouched.
    const slit = smooth(0.55, 1, shut);
    const sc = 1 + wideExtra * 0.35;
    const ex = face.eyeScale[0] * sc * (1 + SLIT_WIDEN * slit);
    const ey = face.eyeScale[1] * sc * (1 - SLIT_FLATTEN * slit);
    const ez = sc * (1 - SLIT_SHALLOW * slit);
    face.eyeL.scale.set(ex, ey, ez);
    face.eyeR.scale.set(ex, ey, ez);
    face.coreL.scale.setScalar(f.pupil);
    face.coreR.scale.setScalar(f.pupil);
    // the eyes turn: the irises (and the pupils on them) rotate about the centre of the eyeball; a drunk's drift apart
    const wobble = drunk * Math.sin(this.time * 2.1) * 0.45;
    const gx = f.gazeX + this.dartX;
    const gy = f.gazeY + this.dartY;
    face.pupilL.rotation.set(gy * 0.34, -(gx + wobble) * 0.34, 0);
    face.pupilR.rotation.set(gy * 0.34, -(gx - wobble) * 0.34, 0);

    // ---- brows: height, tilt, curve (morph targets on the brow) and how far they are drawn together; one higher when asymmetric -------------------------------------------
    const by = face.browY + f.brow * R * 0.12;
    const bx = face.browX - f.knit * R * 0.05;
    const byL = by + f.asym * R * 0.05;
    const byR = by - f.asym * R * 0.05;
    face.browL.position.set(-bx, byL, face.browZ(bx, byL));
    face.browR.position.set(bx, byR, face.browZ(bx, byR));
    face.browL.rotation.z = -f.browTilt * 0.32;
    face.browR.rotation.z = f.browTilt * 0.32;
    const raisedL = Math.max(0, f.asym);
    const raisedR = Math.max(0, -f.asym);
    const brow = (m: typeof face.browL, raised: number): void => {
      const inf = m.morphTargetInfluences;
      if (!inf || inf.length < 4) return;
      inf[0] = clamp(f.browArch + raised * 0.7, -1, 1.2);
      inf[1] = clamp(Math.max(0, -f.browTilt), 0, 1);
      inf[2] = clamp(Math.max(0, f.browTilt) + f.knit * 0.6, 0, 1.2);
      inf[3] = clamp(Math.max(0, -f.browArch) * 0.8 + Math.max(0, -f.brow) * 0.3, 0, 1);
    };
    brow(face.browL, raisedL);
    brow(face.browR, raisedR);

    // ---- the mouth and the skin around it: the morph targets on the head and on the mouth itself ----------------------------------------------------------------------
    const curve = f.mouthCurve;
    face.setMorph("jaw", clamp(f.mouthOpen * 0.95, 0, 1));
    face.setMorph("smile", clamp((curve - 0.15) * 1.15, 0, 1));
    face.setMorph("frown", clamp(-curve, 0, 1));
    face.setMorph("squint", clamp(f.squint, 0, 1));
    face.setMorph("puff", clamp(f.puff + drunk * 0.3 * (0.5 + 0.5 * Math.sin(this.time * 0.9)), 0, 1));
    face.setMorph("pucker", clamp(f.pucker, 0, 1));
    face.setMorph("stretch", clamp(f.stretch, 0, 1));
    face.setMorph("snarl", clamp(f.snarl, 0, 1));
    face.setMorph("smirkL", clamp(-f.smirk, 0, 1));
    face.setMorph("smirkR", clamp(f.smirk, 0, 1));
    face.setMorph("browUp", clamp(f.brow, 0, 1));
    face.setMorph("browKnit", clamp(f.knit, 0, 1));
    face.setMorph("bare", clamp(f.bare, 0, 1));
    face.setMorph("tongue", clamp(f.tongue, 0, 1));
  }
}

export type { ExpressionId };
