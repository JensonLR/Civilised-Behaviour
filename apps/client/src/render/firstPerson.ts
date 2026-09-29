/**
 * Pure maths for the first-person camera: no three.js, no DOM, no allocation. CameraRig and CharacterActor wire it up; the unit tests
 * (firstPerson.test.ts) pin it down. Conventions match CameraRig: yaw 0 looks down -Z, pitch > 0 looks DOWN.
 */

export const FIRST_PERSON = {
  /** Vertical field of view in first person (third person uses the user's `fov` setting). */
  fov: 78,
  /** Fraction of the field of view kept while aiming (a gentle zoom). */
  aimFovScale: 0.9,
  /** Near plane in first person: close enough that the shoulders and arms never clip when looking down. Third person keeps the stage default. */
  near: 0.05,
  nearThird: 0.1,
  /** Seconds for the camera to travel between the two views. */
  transitionSeconds: 0.25,
  /** The head is hidden once this much of the transition has happened (and shown again below it), so the lens never sits inside a hat. */
  headHiddenAt: 0.7,
  /** How far behind the actual eyes the lens sits, as a fraction of the eyes' reach in front of the head centre. */
  eyeForwardFraction: 0.55,
  /** Pitch limits (radians, + = down) while the camera is on foot; a downed body cannot look this far. */
  pitchMin: -1.45,
  pitchMax: 1.45,
  /** Where a body lying on its back looks: mostly at the sky, still nudged by the mouse. */
  downedPitch: -1.1,
  downedPitchInfluence: 0.4,
  /** Stride length (m) the bob phase is locked to; one bob cycle per step, so two per stride. */
  stepLength: 0.8,
  /** Full-strength bob, metres. Subtle on purpose: the animator's own pelvis sway already moves the eye a little. */
  bobVertical: 0.02,
  bobSway: 0.012,
} as const;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Standing height of the eyes above the feet for a rig's proportions (the animator's rest pose, no posture lean). */
export interface EyeProportions {
  scale: number;
  legUpper: number;
  legLower: number;
  torsoHeight: number;
  neck: number;
  headRadius: number;
}

/**
 * Feet-to-eye height of a standing figure: foot + legs (pelvis), the torso mount, torso, neck, up to the head centre, plus the eyes' own
 * height in the head (`eyeUp`, from the rig's `face.eyeL.position.y`, relative to the head centre).
 */
export function restEyeHeight(P: EyeProportions, eyeUp: number): number {
  return 0.05 * P.scale + P.legLower + P.legUpper + 0.04 * P.scale + P.torsoHeight + P.neck + P.headRadius + eyeUp;
}

/** Linear step of a 0..1 blend toward `target` (0 = third person, 1 = first) so the whole transition takes `seconds`. */
export function transitionStep(t: number, target: 0 | 1, dt: number, seconds: number = FIRST_PERSON.transitionSeconds): number {
  const step = seconds > 0 ? Math.max(0, dt) / seconds : 1; // the first rAF timestamp can precede `last`: dt < 0 must not run the blend backwards
  return target > t ? Math.min(target, t + step) : Math.max(target, t - step);
}

/** Smoothstep: eases the lerp between the two views at both ends. */
export function ease(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Should the local head be hidden at this transition amount? (Hysteresis-free: `transitionStep` is monotone.) */
export const headHidden = (t: number): boolean => t >= FIRST_PERSON.headHiddenAt;

/** Pitch range for the current view: on foot in first person the eyes can look nearly straight up and down; the follow camera cannot. */
export function pitchRange(firstPerson: boolean): readonly [number, number] {
  return firstPerson ? [FIRST_PERSON.pitchMin, FIRST_PERSON.pitchMax] : [-0.35, 1.25];
}

/**
 * The pitch the lens actually uses. `down` is the 0..1 amount the body is lying on its back (downed or ragdolled): the view swings up
 * toward the sky, and the mouse only nudges it, so a downed player sees a lying-down view and not a stuck camera.
 */
export function downedPitch(userPitch: number, down: number): number {
  const lying = FIRST_PERSON.downedPitch + clamp(userPitch, -0.5, 0.8) * FIRST_PERSON.downedPitchInfluence;
  return userPitch + (lying - userPitch) * clamp(down, 0, 1);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where the lens goes. `neck` is the head joint in world space; `up`/`forward` are the head's own axes in world space (they differ from
 * world up and the view direction once the body lies down); `eyeUp` is the eyes' height above the neck joint and `eyeReach` how far they
 * sit in front of it. `down` (0..1) blends from the upright eye (always straight above the neck, pushed forward along the view yaw so it
 * never depends on the head's idle glances) to the lying eye (the head's own axes). Writes into `out`.
 */
export function eyePosition(
  out: Vec3,
  neck: Vec3,
  up: Vec3,
  forward: Vec3,
  yaw: number,
  eyeUp: number,
  eyeReach: number,
  down: number,
): Vec3 {
  const reach = eyeReach * FIRST_PERSON.eyeForwardFraction;
  const fx = -Math.sin(yaw) * reach;
  const fz = -Math.cos(yaw) * reach;
  const d = clamp(down, 0, 1);
  out.x = neck.x + fx + (up.x * eyeUp + forward.x * reach - fx) * d;
  out.y = neck.y + eyeUp + (up.y * eyeUp + forward.y * reach - eyeUp) * d;
  out.z = neck.z + fz + (up.z * eyeUp + forward.z * reach - fz) * d;
  return out;
}

/** Advances the bob phase (radians) by distance travelled, so the bob never runs while standing still or in the air. */
export function advanceBob(phase: number, speed: number, dt: number, grounded: boolean): number {
  if (!grounded) return phase;
  return (phase + (speed * dt * Math.PI * 2) / FIRST_PERSON.stepLength) % (Math.PI * 2 * 1000);
}

/**
 * Head bob: a small vertical dip per step and a slower side-to-side sway, scaled by walking speed. `amount` is the user's setting
 * (0 = off, 1 = full); at 0 the offset is exactly zero. `down` (0..1) fades it out while lying. Writes `out.y` and `out.side`
 * (metres; `side` is along the camera's right).
 */
export function bobOffset(out: { y: number; side: number }, phase: number, speed: number, amount: number, down = 0): { y: number; side: number } {
  const k = clamp(amount, 0, 1) * (1 - clamp(down, 0, 1));
  if (k === 0 || speed < 0.05) {
    out.y = 0;
    out.side = 0;
    return out;
  }
  const m = clamp(speed / 4.4, 0, 1.4) * k;
  out.y = -Math.abs(Math.sin(phase)) * FIRST_PERSON.bobVertical * m;
  out.side = Math.sin(phase) * FIRST_PERSON.bobSway * m;
  return out;
}

/**
 * How quickly the camera's body-relative eye offset follows the animated head. The animator already sways the pelvis and torso with the
 * gait; with head bob off that motion is low-passed away (a slow rate), with it on the eye follows the body closely.
 */
export function eyeFollowRate(headBob: number): number {
  return 3.5 + 20 * clamp(headBob, 0, 1);
}

/** Frame-rate-independent exponential approach. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));
}

/**
 * What the camera needs to know about the local body this frame (filled by CharacterActor.sampleEye, read by CameraRig). All positions
 * and axes are world space.
 */
export interface EyeSample {
  /** The head joint (top of the neck). */
  neck: Vec3;
  /** The head's own up and forward axes. */
  up: Vec3;
  forward: Vec3;
  /** Centre of the torso: the stable anchor while a ragdoll flops (its head tumbles, its torso does not tumble as far). */
  torso: Vec3;
  /** Eye height above the neck joint, and how far in front of the head centre the eyes sit. */
  eyeUp: number;
  eyeReach: number;
  /** Downed or in a physics fall: the view lies down and looks up. */
  lying: boolean;
  /** How far over the animated body is (0 upright .. 1 flat on its back), read from the rig itself so the lens never lags a fall or a get-up. Falls back to `lying`. */
  lie?: number;
  /** A physics ragdoll is driving the pose right now: follow the torso, not the head. */
  ragdolled: boolean;
  /** Horizontal speed, m/s, and whether the feet are on the ground (drives the head bob). */
  speed: number;
  grounded: boolean;
}

export const newEyeSample = (): EyeSample => ({
  neck: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  torso: { x: 0, y: 0, z: 0 },
  eyeUp: 0,
  eyeReach: 0,
  lying: false,
  ragdolled: false,
  speed: 0,
  grounded: true,
});
