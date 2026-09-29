import { FLAG } from "@cb/shared";
import type { CharacterRig } from "./rig.ts";

export type ExpressionId = "neutral" | "pain" | "fear" | "triumph" | "drunk" | "angry";

interface FaceTarget {
  /** -1 (lowered/furrowed) .. 1 (raised) */
  brow: number;
  /** Brow tilt: positive = inner ends down (angry), negative = inner ends up (worried). */
  browTilt: number;
  /** 0 closed .. 1 wide */
  eyes: number;
  /** -1 frown .. 1 smile */
  mouthCurve: number;
  /** 0 shut .. 1 gaping */
  mouthOpen: number;
}

const EXPRESSIONS: Record<ExpressionId, FaceTarget> = {
  neutral: { brow: 0, browTilt: 0, eyes: 0.85, mouthCurve: 0.1, mouthOpen: 0 },
  pain: { brow: -0.2, browTilt: -0.7, eyes: 0.25, mouthCurve: -0.8, mouthOpen: 0.6 },
  fear: { brow: 1, browTilt: -0.6, eyes: 1.15, mouthCurve: -0.3, mouthOpen: 0.8 },
  triumph: { brow: 0.5, browTilt: 0.2, eyes: 0.9, mouthCurve: 1, mouthOpen: 0.5 },
  drunk: { brow: 0.1, browTilt: -0.2, eyes: 0.5, mouthCurve: 0.5, mouthOpen: 0.25 },
  angry: { brow: -0.5, browTilt: 0.9, eyes: 0.8, mouthCurve: -0.6, mouthOpen: 0.2 },
};

/** Inputs the animator reads each frame; the game maps replicated state onto this. */
export interface PoseInput {
  /** Horizontal speed, m/s. */
  speed: number;
  /** FLAG bits from @cb/shared. */
  flags: number;
  /** Vertical velocity, m/s (airborne pose). */
  vy: number;
}

const damp = (current: number, target: number, rate: number, dt: number): number => current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Procedural animation for the rigid rig: gait phase is driven by distance travelled (no foot sliding at
 * any speed), with weight shifts, belly/head lag, carry and downed poses and a small facial animation
 * system. Pure joint rotations - no allocation per frame.
 */
export class CharacterAnimator {
  private phase = 0;
  private time = 0;
  private blinkTimer = 2;
  private blink = 0;
  private expression: ExpressionId = "neutral";
  private readonly face: FaceTarget = { ...EXPRESSIONS.neutral };
  private lean = 0;
  private crouch = 0;
  private air = 0;
  private carry = 0;
  private down = 0;
  private breath = 0;
  /** Idle blinking. Disable for stills (photo mode) and deterministic tests. */
  autoBlink = true;
  private drunkness = 0;

  constructor(private readonly rig: CharacterRig) {}

  setExpression(id: ExpressionId): void {
    this.expression = id;
  }

  get currentExpression(): ExpressionId {
    return this.expression;
  }

  update(dt: number, pose: PoseInput): void {
    const { joints: j, proportions: P, face } = this.rig;
    this.time += dt;
    this.breath += dt;
    const speed = pose.speed;
    const grounded = (pose.flags & FLAG.GROUNDED) !== 0;
    const crouching = (pose.flags & FLAG.CROUCHING) !== 0;
    const downed = (pose.flags & FLAG.DOWNED) !== 0;
    const carrying = (pose.flags & FLAG.CARRYING) !== 0;
    const sprinting = (pose.flags & FLAG.SPRINTING) !== 0;

    this.crouch = damp(this.crouch, crouching ? 1 : 0, 14, dt);
    this.air = damp(this.air, grounded ? 0 : 1, 16, dt);
    this.carry = damp(this.carry, carrying ? 1 : 0, 12, dt);
    this.down = damp(this.down, downed ? 1 : 0, 6, dt);

    // Gait: one stride per ~1.5 m of travel; cadence rises with speed but stays distance-locked.
    const stride = 1.25 * (P.legUpper + P.legLower) * 1.5;
    if (grounded) this.phase += (speed * dt * Math.PI * 2) / Math.max(stride, 0.3);
    const move = Math.min(speed / 4.4, 1.6) * (1 - this.air);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const swing = (0.55 + (sprinting ? 0.25 : 0)) * move;

    // Legs: thighs swing, knees bend on the back-swing. Airborne: tuck.
    const legL = s * swing;
    const legR = -s * swing;
    j.hipL.rotation.x = legL * (1 - this.air) - this.air * 0.5 - this.crouch * 0.9;
    j.hipR.rotation.x = legR * (1 - this.air) - this.air * 0.2 - this.crouch * 0.9;
    j.kneeL.rotation.x = Math.max(0, -s) * swing * 1.5 * (1 - this.air) + this.air * 0.9 + this.crouch * 1.5;
    j.kneeR.rotation.x = Math.max(0, s) * swing * 1.5 * (1 - this.air) + this.air * 0.5 + this.crouch * 1.5;

    // Pelvis: bob twice per stride, sway, and drop when crouching.
    const bob = Math.abs(c) * 0.035 * move;
    const crouchDrop = this.crouch * (P.legUpper + P.legLower) * 0.32;
    j.pelvis.position.y = (P.legUpper + P.legLower + 0.05 * P.scale) - crouchDrop + bob - this.down * 0.55;
    j.pelvis.rotation.y = s * 0.18 * move;
    j.pelvis.rotation.z = -s * 0.05 * move;

    // Torso: lean into acceleration/sprint, counter-rotate against the pelvis, breathe.
    const leanTarget = Math.min(speed / 4.4, 1.5) * (sprinting ? 0.28 : 0.13) + this.crouch * 0.25;
    this.lean = damp(this.lean, leanTarget, 8, dt);
    j.torso.rotation.x = -(P.lean + this.lean) - this.down * 0.15;
    j.torso.rotation.y = -s * 0.22 * move;
    const breathe = Math.sin(this.breath * 1.7) * 0.012;
    j.torso.scale.set(1 + breathe, 1 + breathe * 0.6, 1 + breathe);

    // Arms: counter-swing; carrying raises both forward and in; downed sprawl.
    const armL = -s * swing * 1.1 * (1 - this.carry);
    const armR = s * swing * 1.1 * (1 - this.carry);
    j.shoulderL.rotation.x = armL - this.carry * 0.95 - this.air * 0.5 * (1 - this.carry);
    j.shoulderR.rotation.x = armR - this.carry * 0.95 - this.air * 0.5 * (1 - this.carry);
    // Carrying pulls the arms in toward the centre line (cradling), not out to the sides.
    j.shoulderL.rotation.z = -0.08 - this.air * 0.7 + this.carry * 0.55 + this.down * 0.6;
    j.shoulderR.rotation.z = 0.08 + this.air * 0.7 - this.carry * 0.55 - this.down * 0.6;
    j.elbowL.rotation.x = -0.15 - Math.max(0, s) * swing * 0.5 - this.carry * 0.75;
    j.elbowR.rotation.x = -0.15 - Math.max(0, -s) * swing * 0.5 - this.carry * 0.75;

    // Head: stays level against torso motion, subtle lag.
    j.head.rotation.x = (P.lean + this.lean) * 0.7 - this.crouch * 0.1;
    j.head.rotation.y = -j.torso.rotation.y * 0.6 + Math.sin(this.time * 0.6) * 0.05;
    j.head.rotation.z = -j.pelvis.rotation.z * 0.5 + this.drunkness * Math.sin(this.time * 1.3) * 0.12;

    // Downed: rotate the whole figure onto its back.
    this.rig.root.rotation.z = 0;
    // +X tilts the head backward (leaning forward is negative X in this rig), so a downed character lies on their back.
    this.rig.root.rotation.x = this.down * (Math.PI / 2 - 0.1);
    this.rig.root.position.y = this.down * (P.torsoDepth * 0.5 + 0.05);

    this.updateFace(dt);
  }

  private updateFace(dt: number): void {
    const { face } = this.rig;
    const target = EXPRESSIONS[this.expression];
    const r = 14;
    this.face.brow = damp(this.face.brow, target.brow, r, dt);
    this.face.browTilt = damp(this.face.browTilt, target.browTilt, r, dt);
    this.face.eyes = damp(this.face.eyes, target.eyes, r, dt);
    this.face.mouthCurve = damp(this.face.mouthCurve, target.mouthCurve, r, dt);
    this.face.mouthOpen = damp(this.face.mouthOpen, target.mouthOpen, r, dt);
    this.drunkness = damp(this.drunkness, this.expression === "drunk" ? 1 : 0, 3, dt);

    // Blink: brief closure every 2-5 s; drunk characters droop instead.
    this.blinkTimer -= dt;
    if (this.autoBlink && this.blinkTimer <= 0) {
      this.blink = 1;
      this.blinkTimer = 2 + ((Math.sin(this.time * 12.9898) * 43758.5453) % 1 + 1) % 1 * 3;
    }
    this.blink = Math.max(0, this.blink - dt * 9);
    const closed = Math.min(1, this.blink + (1 - Math.min(this.face.eyes, 1)) * 0.9);
    const lidAngle = 0.5 + (-Math.PI / 2 - 0.5) * closed;
    face.lidL.rotation.x = lidAngle;
    face.lidR.rotation.x = lidAngle;
    const wide = Math.max(0, this.face.eyes - 1);
    face.eyeL.scale.setScalar(1 + wide * 0.5);
    face.eyeR.scale.setScalar(1 + wide * 0.5);

    // Brows: height + tilt (mirrored).
    const R = this.rig.proportions.headRadius;
    const by = R * 0.42 + this.face.brow * R * 0.14;
    face.browL.position.y = by;
    face.browR.position.y = by;
    face.browL.rotation.z = -this.face.browTilt * 0.5;
    face.browR.rotation.z = this.face.browTilt * 0.5;

    // Mouth: arc flips between smile and frown; opening stretches it vertically.
    const curve = this.face.mouthCurve;
    face.mouth.rotation.z = curve >= 0 ? Math.PI : 0;
    face.mouth.scale.set(1, 0.35 + Math.abs(curve) * 0.65 + this.face.mouthOpen * 0.8, 1 + this.face.mouthOpen * 0.25);
    face.mouth.position.y = -R * 0.38 - (curve >= 0 ? 0 : -R * 0.06) - this.face.mouthOpen * R * 0.05;

    // Pupils wander when drunk.
    const wobble = this.drunkness * Math.sin(this.time * 2.1) * face.eyeRadius * 0.3;
    face.pupilL.position.x = wobble;
    face.pupilR.position.x = -wobble;
  }
}
