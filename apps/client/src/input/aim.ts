import { COMBAT, MOVEMENT, clamp, newBodyHit, newWorldHit, rayBody, rayWorld, wrapAngle, type BodyPose, type CollisionWorld } from "@cb/shared";

/**
 * THE THIRD-PERSON AIM CONTRACT (D-038, docs/_notes/polish2.md section 5). The player's report: third person is hard to aim and shoot, first person is great. The causes (read from
 * CameraRig.ts, Controls.ts and weapons.ts): the camera sits behind and beside the head while the server shoots from the HEAD (`COMBAT.eyeHeight`), so the picture's middle and the
 * muzzle line disagree; the aim camera widens the shoulder but keeps the field of view, so everything stays small; the aim yaw is just the camera yaw, so a shot lands beside the
 * crosshair at close range and the character turns lazily; a pad has no help at all. This file fixes the MATHS and names every tunable; package I implements the camera and the input
 * around it (CameraRig.ts aim logic, Controls.ts, CombatHud.ts reticle) and may tune the numbers (never the names, never the server's slack).
 *
 *  - `aimSolve`: the shot goes from the SERVER's eye through the point the crosshair is on, so what is under the crosshair is what the round meets, at any range.
 *  - `blendAim`: the over-the-shoulder transition is an exponential approach (no snap, no overshoot), the same shape in and out.
 *  - `assistLook` / `AIM.assist`: pad-only soft help, client-side, bounded to a fraction of the server's `aimYawSlack` so the server never has to know about it.
 *  - `reticleRadiusPx`: the hip-fire circle is the real spread cone, projected, so it tells the truth (and shrinks when you stand still and aim).
 *
 * INTEGRATOR WIRING (Game.ts, per frame, after `rig.update(...)`): `rig.crosshairRay(o, d)`; `hit = crosshairDistance(world, o, d, otherBodies)` (poses of everyone but the local player);
 * `s = aimSolve(eyeNow, o, d, hit)`; send `aimYaw: s.yaw, aimElev: s.elev` beside the camera `yaw`. Pad only: `controls.assistOn` -> `assistLook(eye, yaw, elev, hostileRows, true, out)`, then
 * `rig.yaw += out.dYaw * dt`, `rig.pitch -= out.dElev * dt` (clamped so the total drift stays under `AIM.assist.maxPull`), `controls.lookSlow = out.slow`. Set `controls.canInteract` /
 * `controls.holdInteract` from the same rules as the prompt; `controls.rumble("shot" | "hit" | "hurt" | "blast")` on those events; reticle `gap = reticleRadiusPx(spread, fov, h, rig.aimAmount > 0.5)`.
 */

export type AimMode = "hip" | "aim";

export const AIM = {
  /** Hold the aim button to aim (default) or toggle it (setting `holdToAim`). */
  holdDefault: true,
  camera: {
    /** Metres the aim camera sits to the right of the character's shoulder line (hip: 0.55, see CameraRig). */
    shoulder: 0.95,
    /** Follow distance while aiming as a fraction of the hip distance. */
    distanceScale: 0.58,
    /** Vertical field of view while aiming as a fraction of the setting (a tighter lens: the crosshair target grows). */
    fovScale: 0.78,
    /** Seconds to reach 95 % of the way in and back out (exponential: `blendAim`). */
    blendIn: 0.16,
    blendOut: 0.22,
    /** Aim camera never goes closer to a wall than this (m); it slides along the wall instead of cutting through. */
    wallClearance: 0.35,
    /**
     * D-040, the "ready" view: a firearm in hand but the aim button not held. The playtest found the hip camera looking at the wearer's chest, so the crosshair (the middle of
     * the picture, where a hip shot goes) sat ON the player's own head and hid the target. Ready, the camera looks down the line like the aim view, from further out on the
     * shoulder and at most of the hip distance: the body stands left of the crosshair and the field ahead is clear.
     */
    readyShoulder: 1.0,
    readyDistanceScale: 0.8,
  },
  /** Look speed while aiming: mouse and pad multipliers (the pad's comes from the `padAimSensitivity` setting; this is the mouse's). */
  look: { mouseScale: 0.72 },
  /** The body turns to the aim at the shared turn rate and walks at the shared aim factor: both are the SERVER's rules (movement.ts), restated so the camera and the animation agree. */
  body: { turnRate: MOVEMENT.turnRate, moveFactor: MOVEMENT.aimFactor },
  /** Where the shot converges when nothing is under the crosshair, and the least it may be (a wall at the shoulder must not pull the shot sideways through the character). */
  convergence: { far: 45, near: 3 },
  /** Pad-only soft aim assist. All angles in radians. `maxPull` stays well inside the server's `COMBAT.aimYawSlack` (0.6). */
  assist: { cone: 0.075, strength: 1.6, slowdown: 0.45, maxPull: COMBAT.aimYawSlack * 0.2, stickyCone: 0.11 },
  /** The reticle: hip-fire circle radius bounds in CSS pixels; the aimed dot. */
  reticle: { hipMinPx: 12, hipMaxPx: 72, aimedPx: 5 },
} as const;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface AimSolution {
  /** The wire aim: `aimYaw` (0 = -Z, as CameraRig and the server use) and `aimElev` (up +). */
  yaw: number;
  elev: number;
  /** The point the crosshair is on (or the convergence point). */
  point: V3;
  /** True when the solution had to be pulled back inside the server's yaw slack. */
  clamped: boolean;
}

const _s: AimSolution = { yaw: 0, elev: 0, point: { x: 0, y: 0, z: 0 }, clamped: false };

/**
 * The shot direction from `eye` (the character's head, where the SERVER shoots from) through the point at `hitDist` along the camera ray (`camPos`, unit `camDir`). `hitDist` is the distance
 * of the first thing the crosshair ray meets, or `AIM.convergence.far` when it meets nothing. Clamped to the server's yaw slack around the camera's own yaw and to its elevation limit.
 * Returns a shared scratch object: copy what you keep.
 */
export function aimSolve(eye: V3, camPos: V3, camDir: V3, hitDist: number, slack: number = COMBAT.aimYawSlack, out: AimSolution = _s): AimSolution {
  const d = clamp(Number.isFinite(hitDist) ? hitDist : AIM.convergence.far, AIM.convergence.near, 1000);
  const px = camPos.x + camDir.x * d;
  const py = camPos.y + camDir.y * d;
  const pz = camPos.z + camDir.z * d;
  const dx = px - eye.x;
  const dy = py - eye.y;
  const dz = pz - eye.z;
  const camYaw = Math.atan2(-camDir.x, -camDir.z);
  let yaw = Math.atan2(-dx, -dz);
  let clamped = false;
  const off = wrapAngle(yaw - camYaw);
  if (Math.abs(off) > slack) {
    yaw = wrapAngle(camYaw + Math.sign(off) * slack * 0.98);
    clamped = true;
  }
  let elev = Math.atan2(dy, Math.hypot(dx, dz));
  if (Math.abs(elev) > COMBAT.aimElevMax) {
    elev = Math.sign(elev) * COMBAT.aimElevMax;
    clamped = true;
  }
  out.yaw = yaw;
  out.elev = elev;
  out.point.x = px;
  out.point.y = py;
  out.point.z = pz;
  out.clamped = clamped;
  return out;
}

/** One frame of the aim blend `k` (0 = hip, 1 = aimed): an exponential approach with the in/out times of `AIM.camera`. Never overshoots, never snaps. */
export function blendAim(k: number, aiming: boolean, dt: number): number {
  const t95 = aiming ? AIM.camera.blendIn : AIM.camera.blendOut;
  const rate = Math.log(20) / t95; // reaches 95 % in t95
  const next = k + ((aiming ? 1 : 0) - k) * (1 - Math.exp(-Math.max(0, dt) * rate));
  return next < 1e-3 ? 0 : next > 0.999 ? 1 : next;
}

/** A thing the pad's assist may pull toward: a hostile's chest (world metres) and its body radius. */
export interface AssistTarget {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface AssistOut {
  /** Rate to add to yaw / elevation this frame, radians per second (apply `* dt`). */
  dYaw: number;
  dElev: number;
  /** Multiplier on the look stick's speed while the crosshair is on or near a target (1 = none). */
  slow: number;
  /** The target the assist is on, or "". */
  id: string;
}

/**
 * Soft aim assist for a PAD only (callers pass `enabled = false` for the mouse): inside a cone around the aim a hostile pulls the aim toward its chest and slows the look stick, both strongest
 * at the centre and fading to nothing at the cone's edge. The pull is a RATE (so it feels like friction, not a snap) and the caller keeps the total drift inside `AIM.assist.maxPull`
 * of where the player pointed, which is inside the server's slack: the server never sees anything it would not accept from a steady hand. Writes `out`; allocation-free.
 */
export function assistLook(eye: V3, yaw: number, elev: number, targets: readonly AssistTarget[], enabled: boolean, out: AssistOut): AssistOut {
  out.dYaw = 0;
  out.dElev = 0;
  out.slow = 1;
  out.id = "";
  if (!enabled) return out;
  let best = Infinity;
  for (const t of targets) {
    const dx = t.x - eye.x;
    const dy = t.y - eye.y;
    const dz = t.z - eye.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.5 || dist > 60) continue;
    const ty = Math.atan2(-dx, -dz);
    const te = Math.atan2(dy, dist);
    const ey = wrapAngle(ty - yaw);
    const ee = te - elev;
    const ang = Math.hypot(ey * Math.cos(elev), ee);
    // a body is bigger on the screen up close: the cone is the larger of the fixed one and the body's own angular size
    const cone = Math.max(AIM.assist.cone, Math.atan2(t.r, dist));
    if (ang >= cone || ang >= best) continue;
    best = ang;
    const closeness = 1 - ang / cone;
    out.dYaw = ey * AIM.assist.strength * closeness;
    out.dElev = ee * AIM.assist.strength * closeness;
    out.slow = 1 - (1 - AIM.assist.slowdown) * closeness;
    out.id = t.id;
  }
  return out;
}

/** CSS-pixel radius of the circle a spread cone (half-angle `spread`, radians) makes at the crosshair, for a vertical field of view `fovDeg` on a viewport `heightPx` tall. */
export function reticleRadiusPx(spread: number, fovDeg: number, heightPx: number, aimed = false): number {
  if (aimed && spread < 0.004) return AIM.reticle.aimedPx;
  const half = Math.tan((clamp(fovDeg, 20, 120) * Math.PI) / 360);
  const px = (Math.tan(clamp(spread, 0, 0.6)) / half) * (heightPx / 2);
  return clamp(px, AIM.reticle.hipMinPx, AIM.reticle.hipMaxPx);
}

const _wh = newWorldHit();
const _bh = newBodyHit();

/**
 * How far along the crosshair ray (`o`, unit `d`) the first thing is: the nearest solid in the collision world (walls, rocks, trees, the ground) or a body from `bodies` (everyone but the
 * local player, as poses), whichever is closer; `AIM.convergence.far` when the ray meets nothing. This is the `hitDist` of `aimSolve`: with it a target at 5 m is hit where the crosshair is,
 * not where a wall 40 m behind it would put the shot. `inflate` is the bodies' forgiveness (m). Allocation-free.
 */
export function crosshairDistance(world: CollisionWorld, o: V3, d: V3, bodies: readonly BodyPose[] = [], maxT: number = AIM.convergence.far, inflate = 0.08): number {
  let best = maxT;
  if (rayWorld(world, o.x, o.y, o.z, d.x, d.y, d.z, maxT, _wh) && _wh.t < best) best = _wh.t;
  for (let i = 0; i < bodies.length; i++) {
    if (rayBody(bodies[i]!, o.x, o.y, o.z, d.x, d.y, d.z, best, inflate, _bh) && _bh.t < best) best = _bh.t;
  }
  return best;
}
