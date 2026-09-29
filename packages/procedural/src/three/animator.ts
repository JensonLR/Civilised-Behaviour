import { FLAG, ZONE, woundLevel } from "@cb/shared";
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
  neutral: { brow: 0, browTilt: 0, eyes: 0.85, mouthCurve: 0.4, mouthOpen: 0 },
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
  /** Packed wound mask (see @cb/shared wounds.ts). Leg wounds add a limp. Optional: absent = uninjured. */
  wounds?: number;
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
  private kneel = 0;
  private haul = 0;
  private breath = 0;
  /** Idle blinking. Disable for stills (photo mode) and deterministic tests. */
  autoBlink = true;
  private drunkness = 0;
  /** Limp amount 0..1 and which leg it favours (-1 left, +1 right). */
  private limp = 0;
  private limpSide = 1;
  /** Damped spring jolt from a blow, in the body's local frame: [x lean, z lean]. */
  private jolt = [0, 0];
  private joltVel = [0, 0];

  constructor(private readonly rig: CharacterRig) {}

  setExpression(id: ExpressionId): void {
    this.expression = id;
  }

  get currentExpression(): ExpressionId {
    return this.expression;
  }

  /**
   * A blow just landed. `lx`/`lz` is the direction it pushes the body in the body's LOCAL frame (+z = backwards).
   * The torso and head snap away from it and spring back; purely cosmetic, so it never touches replicated state.
   */
  flinch(lx: number, lz: number, power: number): void {
    if (!Number.isFinite(lx) || !Number.isFinite(lz) || !Number.isFinite(power)) return;
    const k = 9 * Math.max(0.15, Math.min(1, power));
    this.joltVel[0]! += lz * k;
    this.joltVel[1]! += -lx * k;
  }

  update(dt: number, pose: PoseInput): void {
    const { joints: j, proportions: P, face } = this.rig;
    // The animator owns the WHOLE pose every frame. Channels it does not animate are zeroed so nothing else (a ragdoll that
    // just finished, a future dismemberment tween) can leave a stale rotation or offset behind.
    for (const bone of [j.hipL, j.hipR, j.kneeL, j.kneeR, j.shoulderL, j.shoulderR, j.elbowL, j.elbowR]) bone.rotation.set(0, 0, 0);
    j.pelvis.rotation.x = 0;
    j.pelvis.position.x = 0;
    j.pelvis.position.z = 0;
    this.time += dt;
    this.breath += dt;
    const speed = pose.speed;
    const grounded = (pose.flags & FLAG.GROUNDED) !== 0;
    const crouching = (pose.flags & FLAG.CROUCHING) !== 0;
    const downed = (pose.flags & FLAG.DOWNED) !== 0;
    const carrying = (pose.flags & FLAG.CARRYING) !== 0;
    const sprinting = (pose.flags & FLAG.SPRINTING) !== 0;
    const reviving = (pose.flags & FLAG.REVIVING) !== 0;
    const dragging = (pose.flags & FLAG.DRAGGING) !== 0;

    this.crouch = damp(this.crouch, crouching ? 1 : 0, 14, dt);
    this.air = damp(this.air, grounded ? 0 : 1, 16, dt);
    this.carry = damp(this.carry, carrying ? 1 : 0, 12, dt);
    this.down = damp(this.down, downed ? 1 : 0, 6, dt);
    this.kneel = damp(this.kneel, reviving ? 1 : 0, 10, dt);
    this.haul = damp(this.haul, dragging ? 1 : 0, 8, dt);

    // Injuries: a wounded leg (severity 2+) shortens its swing, and the body dips onto it and leans away with each step.
    const wl = woundLevel(pose.wounds ?? 0, ZONE.LEG_L);
    const wr = woundLevel(pose.wounds ?? 0, ZONE.LEG_R);
    const worstLeg = Math.max(wl, wr);
    this.limp = damp(this.limp, worstLeg >= 2 ? (worstLeg - 1) / 2 : 0, 4, dt);
    if (worstLeg >= 2) this.limpSide = wl >= wr ? -1 : 1;

    // Flinch spring (critically-ish damped): decays in about a third of a second.
    for (let i = 0; i < 2; i++) {
      this.joltVel[i]! += (-this.jolt[i]! * 220 - this.joltVel[i]! * 15) * dt;
      this.jolt[i]! += this.joltVel[i]! * dt;
    }

    // Gait: one stride per ~1.5 m of travel; cadence rises with speed but stays distance-locked.
    const stride = 1.25 * (P.legUpper + P.legLower) * 1.5;
    if (grounded) this.phase += (speed * dt * Math.PI * 2) / Math.max(stride, 0.3);
    const move = Math.min(speed / 4.4, 1.6) * (1 - this.air);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const swing = (0.55 + (sprinting ? 0.25 : 0)) * move;

    // Legs: thighs swing, knees bend on the back-swing. Airborne: tuck.
    const legL = s * swing * (this.limpSide < 0 ? 1 - 0.45 * this.limp : 1);
    const legR = -s * swing * (this.limpSide > 0 ? 1 - 0.45 * this.limp : 1);
    j.hipL.rotation.x = legL * (1 - this.air) - this.air * 0.5 - this.crouch * 0.9 - this.kneel * 1.1;
    j.hipR.rotation.x = legR * (1 - this.air) - this.air * 0.2 - this.crouch * 0.9 + this.kneel * 0.2;
    j.kneeL.rotation.x = Math.max(0, -s) * swing * 1.5 * (1 - this.air) + this.air * 0.9 + this.crouch * 1.5 + this.kneel * 1.9;
    j.kneeR.rotation.x = Math.max(0, s) * swing * 1.5 * (1 - this.air) + this.air * 0.5 + this.crouch * 1.5 + this.kneel * 1.7;

    // Pelvis: bob twice per stride, sway, and drop when crouching.
    const bob = Math.abs(c) * 0.035 * move;
    const crouchDrop = (this.crouch * 0.32 + this.kneel * 0.5) * (P.legUpper + P.legLower);
    j.pelvis.position.y = (P.legUpper + P.legLower + 0.05 * P.scale) - crouchDrop + bob - this.down * 0.55;
    // Limp: the pelvis sinks while weight is on the bad leg (the leg swinging back = s sign for that side).
    const onBad = Math.max(0, this.limpSide < 0 ? -s : s);
    j.pelvis.position.y -= this.limp * 0.06 * P.scale * onBad * Math.max(move, 0.3);
    j.pelvis.rotation.y = s * 0.18 * move;
    j.pelvis.rotation.z = -s * 0.05 * move + this.limpSide * this.limp * 0.1 * onBad;

    // Torso: lean into acceleration/sprint, counter-rotate against the pelvis, breathe.
    const leanTarget = Math.min(speed / 4.4, 1.5) * (sprinting ? 0.28 : 0.13) + this.crouch * 0.25 + this.kneel * 0.55 - this.haul * 0.3;
    this.lean = damp(this.lean, leanTarget, 8, dt);
    j.torso.rotation.x = -(P.lean + this.lean) - this.down * 0.15 + this.jolt[0]! * 0.6 + this.limp * 0.06;
    j.torso.rotation.y = -s * 0.22 * move;
    j.torso.rotation.z = this.jolt[1]! * 0.6 - this.limpSide * this.limp * 0.08 * onBad;
    const breathe = Math.sin(this.breath * 1.7) * 0.012;
    j.torso.scale.set(1 + breathe, 1 + breathe * 0.6, 1 + breathe);

    // Arms: counter-swing; carrying raises both forward and in; downed sprawl.
    const busy = Math.max(this.carry, this.kneel, this.haul);
    const armL = -s * swing * 1.1 * (1 - busy);
    const armR = s * swing * 1.1 * (1 - busy);
    // Kneeling: hands reach forward and down over the patient. Hauling: arms trail BACK, gripping the body under the arms.
    j.shoulderL.rotation.x = armL - this.carry * 0.95 - this.kneel * 1.0 + this.haul * 0.9 - this.air * 0.5 * (1 - busy);
    j.shoulderR.rotation.x = armR - this.carry * 0.95 - this.kneel * 1.0 + this.haul * 0.9 - this.air * 0.5 * (1 - busy);
    // Carrying pulls the arms in toward the centre line (cradling), not out to the sides.
    j.shoulderL.rotation.z = -0.08 - this.air * 0.7 + this.carry * 0.55 + this.down * 0.6;
    j.shoulderR.rotation.z = 0.08 + this.air * 0.7 - this.carry * 0.55 - this.down * 0.6;
    j.elbowL.rotation.x = -0.15 - Math.max(0, s) * swing * 0.5 * (1 - busy) - this.carry * 0.75 - this.kneel * 0.4 - this.haul * 0.1;
    j.elbowR.rotation.x = -0.15 - Math.max(0, -s) * swing * 0.5 * (1 - busy) - this.carry * 0.75 - this.kneel * 0.4 - this.haul * 0.1;

    // Head: stays level against torso motion, subtle lag.
    j.head.rotation.x = (P.lean + this.lean) * 0.7 - this.crouch * 0.1 + this.jolt[0]! * 0.5;
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
    const by = face.browY + this.face.brow * R * 0.12;
    face.browL.position.y = by;
    face.browR.position.y = by;
    face.browL.rotation.z = -this.face.browTilt * 0.5;
    face.browR.rotation.z = this.face.browTilt * 0.5;

    // Mouth: arc flips between smile and frown; opening stretches it vertically.
    const curve = this.face.mouthCurve;
    const open = this.face.mouthOpen;
    // Lip line: an arch (frown) flipped into a smile; it fades out as the mouth opens into a D-shaped cavity.
    face.mouth.rotation.z = curve >= 0 ? Math.PI : 0;
    face.mouth.scale.set(1, 0.3 + Math.abs(curve) * 1.1, 1);
    face.mouth.position.y = face.mouthY;
    face.mouth.visible = open < 0.3;
    // Cavity hangs from the upper lip line; corners widen a little with a grin.
    const w = face.mouthWidth * 0.5 * (0.85 + 0.25 * Math.max(0, curve) + 0.1 * open);
    face.mouthInterior.visible = open > 0.1;
    face.mouthCavity.scale.set(w, Math.max(0.001, open * R * 0.25), R * 0.03);
    face.mouthInterior.position.y = face.mouthY + R * 0.005;

    // Pupils wander when drunk.
    const wobble = this.drunkness * Math.sin(this.time * 2.1) * face.eyeRadius * 0.3;
    face.pupilL.position.x = wobble;
    face.pupilR.position.x = -wobble;
  }
}
