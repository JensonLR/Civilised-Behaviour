import { Quaternion } from "three";
import { FLAG, ZONE, woundLevel } from "@cb/shared";
import { FaceAnimator } from "./faceAnimate.ts";
import type { ExpressionId } from "./expressions.ts";
import type { CharacterRig } from "./rig.ts";
import { armRestAbduction, crouchObstruction, kneeFlexLimit } from "./armClearance.ts";
import { HAND_CENTRE, applyMatrix, forearmMatrix, computeHold, newHoldOut, rotateByQuat, solveArm, solveWrist, type ArmAngles, type HoldBlend, type HoldOut, type WeaponPoseInput } from "./weaponPose.ts";

// The expression set (ids, targets, per-expression face poses) lives in expressions.ts; the face itself is driven by faceAnimate.ts.
export type { ExpressionId } from "./expressions.ts";

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
  /** Turn rate, rad/s (positive = turning left). Optional: absent = derived from how the root's yaw changes between updates. */
  yawRate?: number;
  /** What is in the hands and what they are doing (aim, recoil, reload, a blow, working a cannon). Optional: absent = empty hands. See weaponPose.ts. */
  weapon?: WeaponPoseInput;
}

const damp = (current: number, target: number, rate: number, dt: number): number => current + (target - current) * (1 - Math.exp(-rate * dt));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Deterministic 0..1 hash of an integer (idle behaviour and blink timing: no Math.random in anything a replay or test could see). */
const h01 = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** Idle behaviours, each a few seconds long: nothing, a look round, a shrug, touching the hat, checking a watch, hands behind the back, a stretch, a weight shuffle, scratching the back of the head, looking up at the sky, tapping a foot, rocking from heel to toe. */
const IDLE_ACTS = ["none", "look", "shrug", "hat", "watch", "behind", "stretch", "shuffle", "scratch", "lookUp", "tap", "sway"] as const;

/**
 * Procedural animation for the rigid rig. Conventions (the rig faces -Z, +X is the character's right):
 *  - a limb that hangs down swings FORWARD with a positive rotation.x; a knee bends with a negative one (shin back), an elbow with a positive one;
 *  - the torso, which points up, leans forward with a negative rotation.x;
 *  - shoulders abduct (arm out to the side) with rotation.z away from the body: negative on the left, positive on the right.
 * The legs are solved, not keyed: each frame the animator picks a thigh angle and a knee flexion per leg, then lowers the pelvis until the lower foot is
 * on the ground, so feet plant at every speed, in a crouch, a kneel, a landing, a limp or a stumble. The gait phase is driven by distance travelled (no
 * foot sliding). Pure joint rotations, no allocation per frame.
 */
export class CharacterAnimator {
  private phase = 0;
  private time = 0;
  private expression: ExpressionId = "neutral";
  private expressionIntensity = 1;
  private readonly faceAnim: FaceAnimator;
  private lean = 0;
  private crouch = 0;
  private air = 0;
  private carry = 0;
  private down = 0;
  private kneel = 0;
  private haul = 0;
  private breath = 0;
  /** Ambient life (idle blinking, weight shift, glances, idle actions). Disable for stills (photo mode) and deterministic tests. */
  autoBlink = true;
  /** Mood weights (0..1), smoothed: the expression drives the body as well as the face. */
  private readonly mood = { pain: 0, fear: 0, drunk: 0, triumph: 0, angry: 0 };
  /** Limp amount 0..1 and which leg it favours (-1 left, +1 right). */
  private limp = 0;
  private limpSide = 1;
  /** Damped spring jolt from a blow, in the body's local frame: [x lean, z lean]. */
  private jolt = [0, 0];
  private joltVel = [0, 0];
  // landing / take-off
  private wasAir = 0;
  private fall = 0;
  private landSpring = 0;
  private landVel = 0;
  private stretch = 0;
  private windup = 0;
  // turning
  private prevYaw = Number.NaN;
  private turn = 0;
  private pegBlend = 0;
  private readonly seed: number;
  private readonly shoulderBaseY: number;
  /** Extra resting abduction of the arms (radians) that this body needs to hang clear of its own belly, hips and coat skirt (see armClearance.ts). */
  private readonly armExtra: number;
  /** The same per arm (L, R) when hip gear hangs on that side: a holster or a canteen is something a hanging hand must clear too. */
  private readonly armExtraSide: [number, number];
  /** The deepest knee bend (radians) at which this body's calf and thigh still clear each other (see armClearance.ts `kneeFlexLimit`). */
  private readonly kneeMax: number;
  /** 0..1: how much of a belly (and coat skirt) this body has to fold its thighs against (the thigh cannot rise as far into a crouch or a kneel, the knees splay wider, the trunk leans less). */
  private readonly bellyCrouch: number;
  private readonly skirtCrouch: number;
  private idleAct = 0;
  private idleAmt = 0;
  private idleSlot = -1;
  private walkBlend = 0;
  // starting and stopping
  private prevSpeed = 0;
  private speedKnown = false;
  /** Smoothed acceleration (m/s^2, forward +): the body leans into a start and back into a stop. */
  private accel = 0;
  /**
   * Where the weapon is and where the hands go (torso frame), refreshed every update; the actor puts the weapon model there. `hold.visible` is
   * false with empty hands or busy ones.
   */
  readonly hold: HoldOut = newHoldOut();
  private readonly holdBlend: HoldBlend = { aim: 0, reload: 0, hold: 0, swing: 0 };
  private readonly armR: ArmAngles = { a: 0.9, b: 0.1, e: 0.9 };
  private readonly armL: ArmAngles = { a: 0.9, b: -0.1, e: 0.9 };
  private crewBlend = 0;
  private readonly holdBody = { hw: 0, sy: 0, upper: 0, lower: 0, depth: 0, hand: 0 };
  // ---- wrists: a loose swing behind the forearm, and the turn onto a weapon's grip ----
  /** Forearm pitch (shoulder + elbow) last frame, per side (L, R), to find how fast the forearm swings. */
  private readonly forePitch = [0, 0];
  private forePitchKnown = false;
  /** The hand's trailing bend behind the swinging forearm (radians, per side) and its sideways sway. */
  private readonly wristLag = [0, 0];
  private readonly wristSway = [0, 0];
  private readonly wristQ = new Quaternion();
  private readonly gripQs = [new Quaternion(), new Quaternion()];
  /** Per side (L, R): the wrist rotation being solved, and the direction the fist took on the handle last time (kept across frames so it never flips over). */
  private readonly gripScratch = [{ x: 0, y: 0, z: 0, w: 1, s: 0 }, { x: 0, y: 0, z: 0, w: 1, s: 0 }];
  private readonly gripOff = { x: 0, y: 0, z: 0 };
  private readonly gripRot = { x: 0, y: 0, z: 0 };
  private readonly gripM = new Float64Array(9);
  /** How hard the wrists are on a grip right now (0 free .. 1), per side: for tests and the ragdoll's blend. */
  readonly wristGrip = [0, 0];
  /** The axis error (radians) left after the wrist turned the fist onto the handle, per side (L, R); 0 when nothing is held. */
  readonly gripError = [0, 0];
  private readonly holdInput: WeaponPoseInput = { id: -1, aim: 0, elev: 0, fire: 0, reload: 0, swing: -1, swingKind: 0, fp: 0, crew: 0, hidden: false };
  private readonly emptyWeapon: WeaponPoseInput = { id: -1, aim: 0, elev: 0, fire: 0, reload: 0, swing: -1, swingKind: 0, fp: 0, crew: 0, hidden: false };

  constructor(private readonly rig: CharacterRig) {
    const s = rig.spec;
    this.seed = (s.height * 31 + s.headScale * 17 + s.belly * 7 + s.hat * 131 + s.noseStyle * 53) | 0;
    this.shoulderBaseY = rig.joints.shoulderL.position.y;
    this.armExtra = Math.max(0, armRestAbduction(s, rig.proportions) - 0.08);
    this.armExtraSide = [Math.max(this.armExtra, armRestAbduction(s, rig.proportions, 0.08, "L") - 0.08), Math.max(this.armExtra, armRestAbduction(s, rig.proportions, 0.08, "R") - 0.08)];
    this.kneeMax = kneeFlexLimit(s, rig.proportions);
    const ob = crouchObstruction(s, rig.proportions);
    this.bellyCrouch = ob.belly;
    this.skirtCrouch = ob.skirt;
    this.faceAnim = new FaceAnimator(this.seed);
  }

  /** Shows an expression at an intensity 0..1 (0 is the neutral face, 1 the full expression; a flinch and a scream are one expression at two strengths). */
  setExpression(id: ExpressionId, intensity = 1): void {
    this.expression = id;
    this.expressionIntensity = intensity;
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

  /** Call the moment a jump is requested: the body dips and coils for a moment before the take-off (the server jumps in the same tick, so this is a cosmetic lead-in). */
  windUp(): void {
    this.windup = 1;
  }

  update(dt: number, pose: PoseInput): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(dt, 0.1);
    const { joints: j, proportions: P, spec } = this.rig;
    // The animator owns the WHOLE pose every frame. Channels it does not animate are zeroed so nothing else (a ragdoll that
    // just finished, a future dismemberment tween) can leave a stale rotation or offset behind.
    for (const bone of [j.hipL, j.hipR, j.kneeL, j.kneeR, j.shoulderL, j.shoulderR, j.elbowL, j.elbowR]) bone.rotation.set(0, 0, 0);
    j.wristL.quaternion.set(0, 0, 0, 1);
    j.wristR.quaternion.set(0, 0, 0, 1);
    j.pelvis.rotation.set(0, 0, 0);
    j.pelvis.position.x = 0;
    j.pelvis.position.z = 0;
    j.shoulderL.position.y = j.shoulderR.position.y = this.shoulderBaseY;
    this.time += dt;
    this.breath += dt;
    const speed = Number.isFinite(pose.speed) ? Math.max(0, pose.speed) : 0;
    this.accel = damp(this.accel, this.speedKnown ? clamp((speed - this.prevSpeed) / dt, -14, 14) : 0, 7, dt);
    this.prevSpeed = speed;
    this.speedKnown = true;
    const grounded = (pose.flags & FLAG.GROUNDED) !== 0;
    const crouching = (pose.flags & FLAG.CROUCHING) !== 0;
    const downed = (pose.flags & FLAG.DOWNED) !== 0;
    const carrying = (pose.flags & FLAG.CARRYING) !== 0;
    const sprinting = (pose.flags & FLAG.SPRINTING) !== 0;
    const reviving = (pose.flags & FLAG.REVIVING) !== 0;
    const dragging = (pose.flags & FLAG.DRAGGING) !== 0;
    const peg = (pose.flags & FLAG.PEG_LEG) !== 0;

    this.crouch = damp(this.crouch, crouching ? 1 : 0, 14, dt);
    this.air = damp(this.air, grounded ? 0 : 1, 16, dt);
    this.carry = damp(this.carry, carrying ? 1 : 0, 12, dt);
    this.down = damp(this.down, downed ? 1 : 0, 6, dt);
    this.kneel = damp(this.kneel, reviving ? 1 : 0, 10, dt);
    this.haul = damp(this.haul, dragging ? 1 : 0, 8, dt);
    this.pegBlend = damp(this.pegBlend, peg ? 1 : 0, 8, dt);
    this.updateMood(dt);
    const m = this.mood;

    // ---- take-off and landing ----------------------------------------------------------------------------------------------
    const vy = Number.isFinite(pose.vy) ? pose.vy : 0;
    if (!grounded) this.fall = Math.max(this.fall, -vy); // the hardest downward speed of this flight
    if (this.wasAir > 0.5 && grounded) {
      // touchdown: a downward speed of 6 m/s is a hard landing; the body compresses and springs back
      this.landVel += clamp(this.fall / 6, 0.15, 1.4) * 9;
      this.fall = 0;
    }
    if (this.wasAir < 0.5 && !grounded && vy > 1) this.stretch = 1; // leaving the ground: an instant of full extension
    this.wasAir = this.air;
    this.landVel += (-this.landSpring * 260 - this.landVel * 19) * dt;
    this.landSpring += this.landVel * dt;
    this.stretch = damp(this.stretch, 0, 7, dt);
    this.windup = damp(this.windup, 0, 9, dt);
    const land = clamp(this.landSpring, -0.3, 1.2);

    // Injuries: a wounded leg (severity 2+) shortens its swing, and the body dips onto it and leans away with each step.
    const wl = woundLevel(pose.wounds ?? 0, ZONE.LEG_L);
    const wr = woundLevel(pose.wounds ?? 0, ZONE.LEG_R);
    const worstLeg = Math.max(wl, wr);
    this.limp = damp(this.limp, worstLeg >= 2 ? (worstLeg - 1) / 2 : 0, 4, dt);
    if (worstLeg >= 2) this.limpSide = wl >= wr ? -1 : 1;
    const pegSide = spec.woodenLeg === 1 ? -1 : 1; // -1 left, +1 right

    // Flinch spring (critically-ish damped): decays in about a third of a second.
    // Sub-stepped: one explicit step of this stiff spring is unstable above ~0.08 s, and a slow frame (the game caps dt at 0.1) used to
    // blow the torso up to 1e50 radians and leave the figure flailing for good.
    const joltSteps = Math.max(1, Math.ceil(dt / 0.016));
    const jdt = dt / joltSteps;
    for (let s = 0; s < joltSteps; s++) {
      for (let i = 0; i < 2; i++) {
        this.joltVel[i]! += (-this.jolt[i]! * 220 - this.joltVel[i]! * 15) * jdt;
        this.jolt[i]! += this.joltVel[i]! * jdt;
      }
    }

    // ---- turning: how fast the body is rotating, from the caller or from the root's own yaw ---------------------------------------------
    const yaw = j.root.rotation.y;
    let yawRate = pose.yawRate ?? 0;
    if (pose.yawRate === undefined && Number.isFinite(this.prevYaw)) {
      let d = yaw - this.prevYaw;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      yawRate = d / dt;
    }
    this.prevYaw = yaw;
    this.turn = damp(this.turn, clamp(Number.isFinite(yawRate) ? yawRate : 0, -8, 8), 9, dt);

    // ---- gait: distance-locked phase, walk blending into run and sprint ----------------------------------------------------------------
    const legLen = P.legUpper + P.legLower;
    const g = Math.min(speed / 4.4, 1.7); // 1 = a run
    const runW = smooth(0.45, 1.0, g);
    const sprintW = sprinting ? smooth(0.9, 1.3, g) : 0;
    const strideLen = Math.max(0.3, legLen * (1.9 + 1.3 * runW));
    this.walkBlend = damp(this.walkBlend, smooth(0.03, 0.25, g), 12, dt);
    const move = this.walkBlend * (1 - this.air) * (1 - this.down);
    if (grounded) this.phase += (speed * dt * Math.PI * 2) / strideLen;
    // A drunk's steps are uneven: the phase surges and lags.
    const drunkPhase = m.drunk * 0.35 * Math.sin(this.time * 1.7) * move;
    const ph = this.phase + drunkPhase;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const sR = -s; // the right leg is half a cycle behind
    const cR = -c;

    const A = lerp(0.36, 0.78, runW) + sprintW * 0.14; // thigh swing amplitude
    const kSwing = lerp(0.85, 1.75, runW);
    const kBase = lerp(0.05, 0.22, runW);
    // knee flexion peaks in mid-swing, when the thigh passes under the body moving forward (cos of the phase, a little early)
    const knee = (angle: number): number => kBase + kSwing * Math.pow(Math.max(0, Math.cos(angle + 0.25)), 1.3);
    // left/right thigh (forward +) and knee flexion (bend +) from the cycle
    let aL = s * A * move;
    let aR = sR * A * move;
    let kL = knee(ph) * move;
    let kR = knee(ph + Math.PI) * move;
    // limp: the bad leg swings less and the body drops onto it
    const badL = this.limpSide < 0 ? 1 : 0;
    aL *= 1 - 0.45 * this.limp * badL;
    aR *= 1 - 0.45 * this.limp * (1 - badL);
    // a wooden peg: a stiff leg that swings from the hip, out to the side, with no knee
    const pegL = pegSide < 0 ? this.pegBlend : 0;
    const pegR = pegSide > 0 ? this.pegBlend : 0;
    kL *= 1 - pegL;
    kR *= 1 - pegR;
    aL *= 1 - 0.25 * pegL;
    aR *= 1 - 0.25 * pegR;

    // poses that replace the cycle
    const airW = this.air;
    const falling = clamp(-vy / 6, 0, 1);
    const rising = clamp(vy / 5, 0, 1);
    // airborne: the legs tuck as the body rises, reach forward for the ground as it falls
    aL = lerp(aL, 0.55 + falling * 0.35 - this.stretch * 0.5, airW);
    aR = lerp(aR, 0.1 + falling * 0.25 - this.stretch * 0.5, airW);
    kL = lerp(kL, 1.0 * rising + 0.35 - falling * 0.2 - this.stretch * 0.8, airW);
    kR = lerp(kR, 0.55 * rising + 0.3 - falling * 0.2 - this.stretch * 0.8, airW);
    // crouch: thighs forward, shins back; a squat
    // stopping in a hurry: the knees give a little (and starting, a small dip before the push)
    const braking = clamp(-this.accel * 0.02, 0, 0.16) * (1 - this.air) + clamp(this.accel * 0.006, 0, 0.05) * (1 - this.air);
    const crouchW = clamp(this.crouch + m.fear * 0.2 + this.windup * 0.5 + land * 0.55 + braking, 0, 1.4) * (1 - this.down);
    // (a paunch stops the thigh short of the height the belly is: less hip flexion, and the knee folds a little more to make up)
    const bc = this.bellyCrouch;
    const fc = Math.min(1.6, bc + 1.5 * this.skirtCrouch * (1 - bc * 0.5)); // (what stops the thigh: a belly, a skirt)
    aL += crouchW * (1.05 - 0.4 * fc);
    aR += crouchW * (1.05 - 0.4 * fc);
    kL += crouchW * (1.9 - 0.25 * fc);
    kR += crouchW * (1.9 - 0.25 * fc);
    // hunched, knock-kneed cowering and the drunk's bent knees
    aL += m.pain * 0.14 + m.drunk * 0.08;
    aR += m.pain * 0.14 + m.drunk * 0.08;
    kL += m.pain * 0.3 + m.drunk * 0.25 * (1 + Math.sin(this.time * 2.3) * 0.6);
    kR += m.pain * 0.3 + m.drunk * 0.25 * (1 + Math.sin(this.time * 2.3 + 2) * 0.6);
    // kneeling to a patient: the left knee goes down, the right foot stays planted ahead
    aL = lerp(aL, 0.0, this.kneel);
    kL = lerp(kL, 1.55, this.kneel);
    aR = lerp(aR, 1.45 - 0.5 * fc, this.kneel);
    kR = lerp(kR, 1.45, this.kneel);
    // lying down: relaxed legs, one knee a little up
    aL = lerp(aL, 0.12, this.down);
    aR = lerp(aR, -0.05, this.down);
    kL = lerp(kL, 0.35, this.down);
    kR = lerp(kR, 0.12, this.down);

    // a thick leg cannot fold as far as a thin one: past this the calf goes through the thigh
    // (a kneeling body is exempt: the knee is on the ground and the shin lies along it whatever the thickness)
    const kCap = lerp(this.kneeMax, 4, this.kneel);
    kL = Math.min(kL, kCap);
    kR = Math.min(kR, kCap);
    j.hipL.rotation.x = aL;
    j.hipR.rotation.x = aR;
    j.kneeL.rotation.x = -kL;
    j.kneeR.rotation.x = -kR;
    // legs splay a little for balance: wider in a crouch, out in the air, a stiff peg swings outward
    j.hipL.rotation.z = -(0.03 + crouchW * (0.12 + 0.2 * bc) + airW * 0.12 + pegL * 0.16 * Math.max(0, s) * move + m.drunk * 0.06 + this.down * 0.1);
    j.hipR.rotation.z = 0.03 + crouchW * (0.12 + 0.2 * bc) + airW * 0.12 + pegR * 0.16 * Math.max(0, sR) * move + m.drunk * 0.06 + this.down * 0.1;

    // Pelvis height: lower it until the lower foot is on the ground. Extent = how far the foot hangs below the hip.
    const foot = P.legLower + 0.05 * P.scale;
    const extent = (a: number, k: number): number => P.legUpper * Math.cos(a) + foot * Math.cos(a - k);
    const eL = lerp(extent(aL, kL), P.legUpper * Math.cos(aL) + 0.03, this.kneel); // kneeling: the knee is the contact point
    const eR = extent(aR, kR);
    let hipsY = Math.max(eL, eR);
    // running has a flight phase: the body rises at mid-stride; a limp and a peg lurch down onto the bad leg
    hipsY += runW * 0.05 * Math.abs(s) * move * (1 - this.air);
    const onBad = Math.max(0, this.limpSide < 0 ? -s : s);
    hipsY -= this.limp * 0.05 * P.scale * onBad * Math.max(move, 0.3);
    const onPeg = Math.max(0, pegSide < 0 ? -s : s);
    hipsY -= this.pegBlend * 0.045 * P.scale * onPeg * Math.max(move, 0.3);
    hipsY -= land * 0.03;
    j.pelvis.position.y = hipsY - this.down * 0.55;
    // feet stay under the body: move the hips over the average foot position
    const footZ = (a: number, k: number): number => P.legUpper * Math.sin(a) + foot * Math.sin(a - k);
    const shiftZ = (footZ(aL, kL) + footZ(aR, kR)) * 0.5;
    j.pelvis.position.z = clamp(shiftZ, -0.35, 0.35) * (1 - this.down) * (1 - airW * 0.6);

    // Pelvis: turns with the stride (the advancing hip leads), rolls over the stance leg and shifts its weight onto it.
    const twist = Math.min(1, g * 1.4) * (1 + 0.4 * runW) * move;
    const pelvisYaw = -0.11 * s * twist;
    j.pelvis.rotation.y = pelvisYaw;
    const roll = 0.045 * c * move + this.limpSide * this.limp * 0.1 * onBad + (pegSide * this.pegBlend * 0.09 * onPeg) + m.drunk * 0.1 * Math.sin(this.time * 1.9);
    j.pelvis.rotation.z = roll;
    j.pelvis.position.x = 0.022 * c * move * (1 + runW * 0.4) + m.drunk * 0.05 * Math.sin(this.time * 1.9) * (0.4 + move);

    // Torso: leans into speed and the turn, twists against the pelvis, breathes, and takes the mood.
    const leanTarget = Math.min(speed / 4.4, 1.5) * (0.11 + 0.06 * runW + (sprinting ? 0.14 : 0)) + this.crouch * (0.28 - 0.12 * bc) + this.kneel * (0.55 - 0.2 * bc) - this.haul * 0.3 + land * 0.25 + this.windup * 0.2 - this.stretch * 0.18 + clamp(this.accel * 0.02, -0.14, 0.13) * (1 - this.air) * (1 - this.down);
    this.lean = damp(this.lean, leanTarget, 8, dt);
    const moodLean = m.pain * 0.3 + m.angry * 0.14 + m.fear * -0.1 - m.triumph * 0.16 + m.drunk * 0.06;
    j.torso.rotation.x = -(P.lean + this.lean + moodLean * (1 - this.air)) - this.down * 0.15 + this.jolt[0]! * 0.6 + this.limp * 0.06 + m.drunk * 0.12 * Math.sin(this.time * 1.3);
    const torsoTwist = (0.11 + 0.1) * s * twist - clamp(this.turn, -6, 6) * 0.03 * (1 - this.air); // (the shoulders lag the turn a little, the head leads it)
    j.torso.rotation.y = torsoTwist + m.drunk * 0.16 * Math.sin(this.time * 1.1);
    const bank = clamp(this.turn * speed * 0.018, -0.3, 0.3); // banking into a turn: the body leans toward the inside
    j.torso.rotation.z = this.jolt[1]! * 0.6 - this.limpSide * this.limp * 0.08 * onBad - roll * 0.7 - bank + m.drunk * 0.08 * Math.sin(this.time * 1.6 + 1);
    j.pelvis.rotation.z += bank * 0.3;
    const breathe = Math.sin(this.breath * (1.7 + m.pain * 1.4 + m.fear * 1.9)) * (0.012 + m.pain * 0.008 + m.fear * 0.01);
    // landing squash (and the take-off stretch): the trunk shortens and widens on touchdown, lengthens as it leaves the ground
    const squash = clamp(land, 0, 1) * 0.07 - this.stretch * 0.04;
    j.torso.scale.set(1 + breathe + squash * 0.5, 1 + breathe * 0.6 - squash, 1 + breathe + squash * 0.5);
    // the shoulders rise with the in-breath, and with tension
    const tense = m.pain * 0.02 + m.fear * 0.03 + m.angry * 0.02;
    j.shoulderL.position.y = j.shoulderR.position.y = this.shoulderBaseY + breathe * 0.35 + tense;

    // ---- arms ------------------------------------------------------------------------------------------------------------------------
    const busy = Math.max(this.carry, this.kneel, this.haul, this.down * 0.6);
    const swingA = lerp(0.42, 0.95, runW) * (1 - busy) * move;
    const armLx = -s * swingA;
    const armRx = -sR * swingA;
    // elbows flex more the faster you go, and more on the forward swing
    const eBase = 0.16 + runW * 0.85 + sprintW * 0.2;
    const eSwing = 0.25 + runW * 0.6;
    let shL = armLx + this.air * (-0.45 + falling * -0.5);
    let shR = armRx + this.air * (-0.45 + falling * -0.5);
    let elL = eBase * move + (1 - move) * 0.14 + Math.max(0, -s) * eSwing * move * (1 - busy);
    let elR = eBase * move + (1 - move) * 0.14 + Math.max(0, -sR) * eSwing * move * (1 - busy);
    // (a wide body holds its arms further out; not while carrying, hauling or kneeling, when the arms are in front of it anyway)
    const clearK = (1 - busy) * (1 - this.air * 0.5);
    const clear = this.armExtra * clearK;
    let szL = -0.08 - this.armExtraSide[0] * clearK - this.air * 0.7 + this.carry * 0.55 + this.down * 0.6 - crouchW * 0.05;
    let szR = 0.08 + this.armExtraSide[1] * clearK + this.air * 0.7 - this.carry * 0.55 - this.down * 0.6 + crouchW * 0.05;
    // kneeling: hands reach forward and down over the patient. hauling: arms trail BACK, gripping the body under the arms. carrying: cradle.
    shL += -this.carry * 0.0 + this.carry * 1.0 + this.kneel * 1.0 - this.haul * 0.9;
    shR += this.carry * 1.0 + this.kneel * 1.0 - this.haul * 0.9;
    elL += this.carry * 0.75 + this.kneel * 0.4 + this.haul * 0.1;
    elR += this.carry * 0.75 + this.kneel * 0.4 + this.haul * 0.1;
    // take-off stretch: both arms thrown up
    shL += this.stretch * 2.2;
    shR += this.stretch * 2.2;
    // landing: the arms spread for balance
    szL -= land * 0.35;
    szR += land * 0.35;
    // moods that take the arms
    const still = 1 - Math.min(1, move * 1.6);
    // pain: the right hand clutches the belly, the left hangs and trembles
    const tremble = Math.sin(this.time * 41) * 0.03 * (m.pain + m.fear);
    shR = lerp(shR, 0.55 + tremble, m.pain * 0.85);
    elR = lerp(elR, 2.15, m.pain * 0.85);
    szR = lerp(szR, -0.32, m.pain * 0.85);
    elL += m.pain * 0.5;
    // fear: both hands up in front of the chin, elbows tight
    shL = lerp(shL, 0.95 + tremble, m.fear * 0.9);
    shR = lerp(shR, 0.95 - tremble, m.fear * 0.9);
    elL = lerp(elL, 2.05, m.fear * 0.9);
    elR = lerp(elR, 2.05, m.fear * 0.9);
    szL = lerp(szL, 0.28, m.fear * 0.9);
    szR = lerp(szR, -0.28, m.fear * 0.9);
    // triumph: fists in the air (pumping while moving)
    const pump = Math.sin(this.time * 7) * 0.25;
    shL = lerp(shL, 2.45 + pump * 0.6, m.triumph * 0.9);
    shR = lerp(shR, 2.6 - pump * 0.6, m.triumph * 0.9);
    elL = lerp(elL, 0.5, m.triumph * 0.9);
    elR = lerp(elR, 0.35, m.triumph * 0.9);
    szL = lerp(szL, -0.45, m.triumph * 0.9);
    szR = lerp(szR, 0.45, m.triumph * 0.9);
    // anger: fists clenched, elbows bent, shoulders forward
    shL = lerp(shL, 0.32, m.angry * 0.55 * still) + m.angry * armLx * 0.6;
    shR = lerp(shR, 0.32, m.angry * 0.55 * still) + m.angry * armRx * 0.6;
    elL = lerp(elL, 1.35, m.angry * 0.6);
    elR = lerp(elR, 1.35, m.angry * 0.6);
    // drunk: arms slack and swinging with the sway
    shL += m.drunk * Math.sin(this.time * 1.9 + 0.5) * 0.35;
    shR += m.drunk * Math.sin(this.time * 1.9 + 2.5) * 0.35;
    szL -= m.drunk * (0.15 + 0.15 * Math.sin(this.time * 2.7));
    szR += m.drunk * (0.15 + 0.15 * Math.sin(this.time * 2.2 + 1));
    // idle life: breathing arms, weight shifts, glances and the occasional small action
    const idle = (1 - Math.min(1, move * 2)) * (1 - this.air) * (1 - this.crouch) * (1 - busy) * (1 - this.down) * (1 - Math.max(m.pain, m.fear, m.triumph, m.angry));
    let headYaw = 0;
    let headPitch = 0;
    if (idle > 0.01 && this.autoBlink) {
      const shift = Math.sin(this.time * 0.45);
      j.pelvis.rotation.z += shift * 0.035 * idle;
      j.torso.rotation.z -= shift * 0.03 * idle;
      j.pelvis.position.x += shift * 0.012 * idle;
      szL -= Math.sin(this.breath * 1.7) * 0.02 * idle;
      szR += Math.sin(this.breath * 1.7) * 0.02 * idle;
      headYaw += Math.sin(this.time * 0.37) * Math.sin(this.time * 0.13 + 1) * 0.22 * idle;
      headPitch += Math.sin(this.time * 0.29) * 0.04 * idle;
      // every ~9 s pick a small action (a different one per character and per slot) and play it with a smooth in/out
      const period = 9;
      const slot = Math.floor(this.time / period + h01(this.seed) * 3);
      if (slot !== this.idleSlot) {
        this.idleSlot = slot;
        const r = h01(slot * 7919 + this.seed);
        this.idleAct = r < 0.32 ? 0 : 1 + Math.floor(h01(slot * 104729 + this.seed) * (IDLE_ACTS.length - 1));
      }
      const t = (this.time / period + h01(this.seed) * 3) % 1;
      const env = smooth(0.05, 0.22, t) * (1 - smooth(0.62, 0.8, t));
      this.idleAmt = damp(this.idleAmt, env, 30, dt);
      const w = this.idleAmt * idle * (this.idleAct === 0 ? 0 : 1);
      switch (IDLE_ACTS[this.idleAct]) {
        case "look":
          headYaw += Math.sin(t * Math.PI * 4) * 0.7 * w;
          j.torso.rotation.y += Math.sin(t * Math.PI * 4) * 0.12 * w;
          break;
        case "shrug":
          j.shoulderL.position.y += 0.03 * w;
          j.shoulderR.position.y += 0.03 * w;
          elL += 0.7 * w;
          elR += 0.7 * w;
          szL -= 0.35 * w;
          szR += 0.35 * w;
          headPitch += 0.08 * w;
          break;
        case "hat":
          // the right hand goes up to the brim
          shR = lerp(shR, 2.75, w);
          elR = lerp(elR, 1.6, w);
          szR = lerp(szR, 0.1, w);
          headPitch -= 0.06 * w;
          break;
        case "watch":
          shL = lerp(shL, 1.0, w);
          elL = lerp(elL, 1.75, w); // (kept well inside the ragdoll's elbow limit: a body can be knocked down mid-act)
          szL = lerp(szL, 0.35, w);
          headPitch += 0.28 * w;
          break;
        case "behind":
          shL = lerp(shL, -0.55, w);
          shR = lerp(shR, -0.55, w);
          elL = lerp(elL, 0.35, w);
          elR = lerp(elR, 0.35, w);
          szL = lerp(szL, 0.28, w);
          szR = lerp(szR, -0.28, w);
          j.torso.rotation.x -= 0.06 * w;
          break;
        case "stretch":
          shL = lerp(shL, 2.7, w);
          shR = lerp(shR, 2.7, w);
          szL = lerp(szL, -0.25, w);
          szR = lerp(szR, 0.25, w);
          j.torso.rotation.x += 0.16 * w; // arch back
          headPitch -= 0.25 * w;
          break;
        case "scratch":
          // the right hand goes up to the back of the head, the head tilts into it
          shR = lerp(shR, 2.95, w);
          elR = lerp(elR, 1.95, w);
          szR = lerp(szR, 0.45, w);
          headPitch += 0.05 * w;
          headYaw += Math.sin(t * Math.PI * 8) * 0.06 * w;
          break;
        case "lookUp":
          headPitch -= 0.4 * w;
          j.torso.rotation.x += 0.09 * w; // (leans back to take in the sky)
          shL = lerp(shL, shL + 0.2, w);
          shR = lerp(shR, shR + 0.2, w);
          break;
        case "tap":
          // a foot tapping, one hand on the hip
          j.hipR.rotation.x += 0.16 * w * Math.max(0, Math.sin(t * Math.PI * 10));
          j.kneeR.rotation.x -= 0.1 * w * Math.max(0, Math.sin(t * Math.PI * 10));
          shL = lerp(shL, 0.25, w);
          elL = lerp(elL, 1.7, w);
          szL = lerp(szL, -0.5, w);
          break;
        case "sway":
          j.pelvis.rotation.z += 0.05 * w * Math.sin(t * Math.PI * 4);
          j.pelvis.position.x += 0.02 * w * Math.sin(t * Math.PI * 4);
          j.torso.rotation.z -= 0.04 * w * Math.sin(t * Math.PI * 4);
          break;
        case "shuffle":
          j.pelvis.rotation.z += 0.07 * w * Math.sin(t * Math.PI * 6);
          j.hipL.rotation.x += 0.18 * w * Math.max(0, Math.sin(t * Math.PI * 6));
          headYaw += Math.sin(t * Math.PI * 2) * 0.2 * w;
          break;
        default:
          break;
      }
    } else this.idleAmt = damp(this.idleAmt, 0, 12, dt);

    j.shoulderL.rotation.x = shL;
    j.shoulderR.rotation.x = shR;
    j.shoulderL.rotation.z = szL;
    j.shoulderR.rotation.z = szR;
    // (an elbow folds no further than the ragdoll's hinge lets it: a sprint's swing with a pained arm used to reach 2.56)
    j.elbowL.rotation.x = clamp(elL, 0, 2.42);
    j.elbowR.rotation.x = clamp(elR, 0, 2.42);
    this.applyHold(dt, pose, busy, speed);
    this.applyWrists(dt);

    // ---- head: stays level against the torso, glances, leads the turn, takes the mood ---------------------------------------------------------
    j.head.rotation.x = -j.torso.rotation.x * 0.75 - (crouchW > 0 ? 0.1 * crouchW : 0) + this.jolt[0]! * 0.5 + headPitch + m.pain * 0.3 + m.angry * 0.1 - m.fear * 0.15 - m.triumph * 0.12 + m.drunk * 0.1 * Math.sin(this.time * 1.5 + 1);
    j.head.rotation.y = -(j.torso.rotation.y + j.pelvis.rotation.y) * 0.8 + Math.sin(this.time * 0.6) * 0.05 * (0.4 + idle) + headYaw + this.turn * 0.05 + m.fear * Math.sin(this.time * 6) * 0.05;
    j.head.rotation.z = -(j.pelvis.rotation.z + j.torso.rotation.z) * 0.5 + m.drunk * Math.sin(this.time * 1.3) * 0.16 - bank * 0.4;

    // ---- downed: rotate the whole figure onto its back ---------------------------------------------------------------------------------
    j.root.rotation.z = 0;
    // +X tilts the head backward (leaning forward is negative X in this rig), so a downed character lies on their back.
    j.root.rotation.x = this.down * (Math.PI / 2 - 0.1);
    j.root.position.y = this.down * (P.torsoDepth * 0.5 + 0.05);

    this.updateFace(dt);
  }

  /**
   * The wrists. A hand that holds nothing trails a swinging forearm a little (a loose bend behind the swing, easing back when it stops), the way a real hand lags; a hand on a
   * grip is turned by the wrist onto the handle (`applyHold` solved it), blended by how firmly it holds.
   */
  private applyWrists(dt: number): void {
    const j = this.rig.joints;
    for (const [i, sh, el, wrist] of [[0, j.shoulderL, j.elbowL, j.wristL], [1, j.shoulderR, j.elbowR, j.wristR]] as const) {
      const pitch = sh.rotation.x + el.rotation.x;
      const v = this.forePitchKnown ? (pitch - this.forePitch[i]!) / dt : 0;
      this.forePitch[i] = pitch;
      const free = 1 - this.wristGrip[i]!;
      this.wristLag[i] = damp(this.wristLag[i]!, clamp(-0.05 * v, -0.55, 0.55) * free, 16, dt);
      // ... and sways a touch outward with the arm's abduction
      this.wristSway[i] = damp(this.wristSway[i]!, clamp(-sh.rotation.z * 0.25, -0.2, 0.2) * free, 10, dt);
      wrist.rotation.set(this.wristLag[i]!, 0, this.wristSway[i]!);
      const w = this.wristGrip[i]!;
      if (w > 0.003) {
        this.wristQ.copy(wrist.quaternion);
        wrist.quaternion.copy(this.wristQ).slerp(this.gripQs[i]!, w);
      }
    }
    this.forePitchKnown = true;
  }

  /**
   * Weapons in the hands: the weapon's place and the hands' targets come from `computeHold` (weaponPose.ts); each arm's angles are then solved by IK
   * and blended over the gait arms by how firmly that hand is on the weapon, so drawing, holstering and letting go never snap. A crew working a
   * cannon leans into the work with both arms out, ramming.
   */
  private applyHold(dt: number, pose: PoseInput, busy: number, speed: number): void {
    const { joints: j, proportions: P } = this.rig;
    const w = pose.weapon ?? this.emptyWeapon;
    const B = this.holdBlend;
    const drawn = (w.id >= 0 || w.swing >= 0) && !w.hidden && busy < 0.5;
    B.hold = damp(B.hold, drawn ? 1 : 0, 11, dt);
    B.aim = damp(B.aim, drawn ? clamp(w.aim, 0, 1) : 0, 13, dt);
    B.reload = damp(B.reload, drawn && w.reload > 0 ? 1 : 0, 9, dt);
    B.swing = damp(B.swing, drawn && w.swing >= 0 ? 1 : 0, 26, dt);
    this.crewBlend = damp(this.crewBlend, w.crew > 0 && !w.hidden ? clamp(w.crew, 0, 1) : 0, 8, dt);

    const hold = this.hold;
    if (B.hold < 0.003 && this.crewBlend < 0.003) {
      hold.visible = false;
      hold.right.w = 0;
      hold.left.w = 0;
      return;
    }
    const body = this.holdBody;
    body.hw = P.shoulderHalfWidth;
    body.sy = this.shoulderBaseY;
    body.upper = P.armUpper;
    body.lower = P.armLower;
    body.depth = P.torsoDepth;
    body.hand = P.handRadius;
    let input = w;
    if (w.hidden || busy >= 0.5) {
      // (a scratch copy: the hot loop allocates nothing)
      input = Object.assign(this.holdInput, w);
      input.id = -1;
      input.swing = -1;
    }
    computeHold(input, B, body, this.time, clamp(speed / 4.4, 0, 1.4), hold);
    // the blow twists the body and the shot rocks it back
    j.torso.rotation.y += hold.twist * B.hold;
    j.torso.rotation.x += hold.lean * B.hold;
    j.head.rotation.y -= hold.twist * B.hold * 0.7;
    // the fist's centre sits a little below the wrist joint: the wrist goes where the fist's centre must be
    const dCentre = P.handRadius * HAND_CENTRE;
    const M = this.gripM;
    for (const [sh, el, side, tgt, ang, gi] of [
      [j.shoulderR, j.elbowR, 1, hold.right, this.armR, 1],
      [j.shoulderL, j.elbowL, -1, hold.left, this.armL, 0],
    ] as const) {
      const k = tgt.w * B.hold;
      const gs = this.gripScratch[gi]!;
      this.wristGrip[gi] = 0;
      this.gripError[gi] = 0;
      if (k < 0.003) {
        ang.a = sh.rotation.x; // (warm start for the next time this hand is wanted)
        ang.b = sh.rotation.z;
        ang.e = el.rotation.x;
        continue;
      }
      const tx = tgt.x - side * P.shoulderHalfWidth;
      const ty = tgt.y - this.shoulderBaseY;
      const tz = tgt.z;
      solveArm(P.armUpper, P.armLower, side, tx, ty, tz, ang);
      const handle = tgt.ax * tgt.ax + tgt.ay * tgt.ay + tgt.az * tgt.az > 0.25;
      if (handle) {
        // the wrist turns the fist's grip axis onto the handle, and the arm is re-solved for where that leaves the fist's centre (three times: the answer settles at once)
        for (let it = 0; it < 3; it++) {
          solveWrist(ang.a, ang.b, ang.e, tgt.ax, tgt.ay, tgt.az, gs, M);
          rotateByQuat(gs, 0, -dCentre, 0, this.gripRot);
          applyMatrix(M, this.gripRot.x, this.gripRot.y, this.gripRot.z, this.gripOff);
          solveArm(P.armUpper, P.armLower, side, tx - this.gripOff.x, ty - this.gripOff.y, tz - this.gripOff.z, ang);
        }
        this.gripError[gi] = solveWrist(ang.a, ang.b, ang.e, tgt.ax, tgt.ay, tgt.az, gs, M);
        this.gripQs[gi]!.set(gs.x, gs.y, gs.z, gs.w);
        this.wristGrip[gi] = k;
      } else {
        // a hand with nothing to wrap round (a free hand, the reload's work): the fist hangs on from the forearm's line
        forearmMatrix(ang.a, ang.b, ang.e, M);
        applyMatrix(M, 0, -dCentre, 0, this.gripOff);
        solveArm(P.armUpper, P.armLower, side, tx - this.gripOff.x, ty - this.gripOff.y, tz - this.gripOff.z, ang);
      }
      sh.rotation.x = lerp(sh.rotation.x, ang.a, k);
      sh.rotation.z = lerp(sh.rotation.z, ang.b, k);
      el.rotation.x = lerp(el.rotation.x, ang.e, k);
    }
    // working a cannon: lean into it, arms out and pumping (the rammer, the sponge)
    const c = this.crewBlend;
    if (c > 0.003) {
      const ram = Math.sin(this.time * 5.2);
      j.torso.rotation.x -= c * (0.32 + 0.1 * ram);
      for (const [sh, el, side] of [[j.shoulderL, j.elbowL, -1], [j.shoulderR, j.elbowR, 1]] as const) {
        sh.rotation.x = lerp(sh.rotation.x, 1.15 + 0.35 * ram * (side === 1 ? 1 : -1), c);
        sh.rotation.z = lerp(sh.rotation.z, side * 0.18, c);
        el.rotation.x = lerp(el.rotation.x, 0.5 + 0.3 * ram, c);
      }
      // ... both fists wrapped round the rammer's staff, which runs straight ahead of the crew (the same wrist solve as a weapon's grip)
      for (const [gi, sh, el] of [[0, j.shoulderL, j.elbowL], [1, j.shoulderR, j.elbowR]] as const) {
        const gs = this.gripScratch[gi]!;
        this.gripError[gi] = solveWrist(sh.rotation.x, sh.rotation.z, el.rotation.x, 0, 0, -1, gs, this.gripM);
        this.gripQs[gi]!.set(gs.x, gs.y, gs.z, gs.w);
        this.wristGrip[gi] = Math.max(this.wristGrip[gi]!, c);
      }
    }
  }

  /** The expression drives the body too: each mood's weight eases toward 1 while it is on (and only while the character is standing free). */
  private updateMood(dt: number): void {
    const e = this.expression;
    const m = this.mood;
    m.pain = damp(m.pain, e === "pain" ? 1 : 0, 6, dt);
    m.fear = damp(m.fear, e === "fear" ? 1 : 0, 6, dt);
    m.drunk = damp(m.drunk, e === "drunk" ? 1 : 0, 3, dt);
    m.triumph = damp(m.triumph, e === "triumph" ? 1 : 0, 7, dt);
    m.angry = damp(m.angry, e === "angry" ? 1 : 0, 6, dt);
  }

  private updateFace(dt: number): void {
    this.faceAnim.update(this.rig.face, this.rig.proportions.headRadius, dt, this.expression, this.expressionIntensity, this.mood.drunk, this.autoBlink);
  }
}
