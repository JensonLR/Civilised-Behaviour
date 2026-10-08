import { Vector3, type PerspectiveCamera } from "three";
import { clamp, newWorldHit, rayWorld, type CollisionWorld } from "@cb/shared";
import { AIM, blendAim, type V3 } from "../input/aim.ts";
import {
  FIRST_PERSON,
  advanceBob,
  bobOffset,
  damp,
  downedPitch,
  ease,
  eyeFollowRate,
  eyePosition,
  headHidden,
  pitchRange,
  transitionStep,
  type EyeSample,
} from "./firstPerson.ts";
import { easeMountedCamera, newMountedCamera } from "./mounts/mountCamera.ts";
import { atmoUniforms } from "./world/atmosphere.ts";

export interface CameraSettings {
  fov: number;
  sensitivity: number;
  invertY: boolean;
  shake: number;
  /** Vertical FOV in first person. */
  firstPersonFov?: number;
  /** Head bob amount 0..1 (0 = off, and it defaults to off under prefers-reduced-motion; see settings.ts). */
  headBob?: number;
}

export type ViewMode = "third" | "first";

/** A ray the follow camera casts (from the head toward the lens; `d` unit length, `len` metres) and the nearest hit along it so far (`t`, metres; `len` when clear). */
export interface CameraRay {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  len: number;
  t: number;
}

/**
 * Solids that are not the world's colliders but must not come between the lens and the wearer either: the mounts (a wagon parked behind you, a horse at your shoulder).
 * `cast` lowers `ray.t` to the first one the ray enters. Only the ray object crosses the call, so a frame casts without allocating.
 */
export interface CameraOccluders {
  cast(ray: CameraRay): void;
}

const UP = { x: 0, y: 1, z: 0 };
const _bob = { y: 0, side: 0 };
const _wall = newWorldHit();
/** The hip-fire shoulder offset (m) and the head height the follow camera orbits; the aim camera blends from the first to `AIM.camera.shoulder`. */
const HIP_SHOULDER = 0.55;
const HEAD_Y = 1.55;
/** Below this the follow camera does not bother casting for walls (it is at the head already). */
const MIN_FOLLOW = 0.85;
/**
 * The lens has a body: besides the ray from the head to the lens, two more go to the lens's left and right edges this far out. A trunk or a post just
 * BESIDE the line (missed by a single ray) would otherwise sit a hand's breadth from the lens and fill half the picture.
 */
export const LENS_RADIUS = 0.32;
/** The nearest the follow camera comes to the head when a wall is right behind it: just behind the eyes (inside the head, which is drawn see-through then). */
const LENS_FLOOR = 0.12;

/**
 * The player's camera. Two views share one yaw/pitch (the input stream reports yaw so the shared movement step stays camera-relative):
 *  - third person: an over-the-shoulder follow camera that keeps itself above the terrain;
 *  - first person: the lens sits at the local rig's eyes, follows yaw/pitch exactly, bobs a little when walking, drops with a crouch or a
 *    kneel and lies down with a downed or ragdolled body.
 * Switching is a 0.25 s blend of position, look target, field of view and near plane, never a cut. The third-person state keeps updating
 * underneath so switching back is seamless.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.32;
  /** Solids besides the world that the follow camera keeps in front of it (the game sets the mounts' view). */
  occluders: CameraOccluders | undefined = undefined;
  private readonly camRay: CameraRay = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, len: 0, t: 0 };
  distance = 5.6;
  /** Set by the game each frame: a firearm is in hand (the "ready" view: the follow camera looks down the line with the body to the left of the crosshair, D-040). */
  ready = false;
  /** Set by the game each frame: the local body sits a horse, and how fast it goes as a fraction of a gallop. The follow camera pulls back and up, and widens a little at speed. */
  mounted = false;
  mountSpeed01 = 0;
  private readonly mountCam = newMountedCamera();
  private view: ViewMode = "third";
  /** 0 = third person .. 1 = first person. */
  private fp = 0;
  private readonly focus = new Vector3();
  private readonly desired = new Vector3();
  private readonly thirdPos = new Vector3();
  private readonly thirdLook = new Vector3();
  /** 0..1: how far the follow camera has gone from the hip view to the over-the-shoulder aim view (closer, tighter lens, shoulder out, looking down the aim). `blendAim`: exponential, never snaps. */
  private aimK = 0;
  /** 0..1: how far the follow camera has gone into the ready view (a firearm in hand), blended like the aim. */
  private readyK = 0;
  private readonly dirTmp = new Vector3();
  private readonly look3 = new Vector3();
  /** Metres the follow camera was pulled in by a wall this frame (0 = free); for tests and the HUD. */
  wallPull = 0;
  private readonly fpPos = new Vector3();
  private readonly fpLook = new Vector3();
  private readonly lookBlend = new Vector3();
  // First-person state
  private readonly eyeOut = { x: 0, y: 0, z: 0 };
  private readonly neckW = { x: 0, y: 0, z: 0 };
  private readonly yawFwd = { x: 0, y: 0, z: -1 };
  private readonly rel = new Vector3();
  private readonly soft = new Vector3();
  private primed = false;
  private downK = 0;
  private softK = 0;
  private wasRagdolled = false;
  private bobPhase = 0;
  private fpFovScale = 1;
  private shakeEnergy = 0;
  /** 0..1: how far into the downed framing the follow camera is (eases in over ~1 s, out as quickly when helped up). */
  private downedK = 0;
  private clock = 0;
  /** Recoil picture: the lens rises and sways a little after a shot and settles back. Cosmetic only; the aim (`pitch`, `yaw`) is never touched. */
  private kickPitch = 0;
  private kickYaw = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private world: CollisionWorld,
    readonly settings: CameraSettings,
  ) {}

  /** The region changed: the ground the camera keeps above is the new one. */
  setWorld(world: CollisionWorld): void {
    this.world = world;
  }

  get mode(): ViewMode {
    return this.view;
  }

  /** 0..1 how far the over-the-shoulder aim view is in (0 = hip, 1 = aimed). The HUD reads it to swap the hip circle for the aimed dot. */
  get aimAmount(): number {
    return this.aimK;
  }

  /**
   * The ray through the middle of the picture (where the crosshair is), from the lens: `origin` and unit `dir`. Call after `update`. This is what the shot is solved against (`aimSolve` in
   * input/aim.ts): what is under the crosshair is what the round meets, in third person and in first.
   */
  crosshairRay(origin: V3, dir: V3): void {
    origin.x = this.camera.position.x;
    origin.y = this.camera.position.y;
    origin.z = this.camera.position.z;
    this.camera.getWorldDirection(this.dirTmp);
    dir.x = this.dirTmp.x;
    dir.y = this.dirTmp.y;
    dir.z = this.dirTmp.z;
  }

  /** 0..1 blend between the views (for tests and UI). */
  get firstPersonAmount(): number {
    return this.fp;
  }

  /** True once the transition is far enough along that the local head must be hidden (and the crosshair shown). */
  get headHidden(): boolean {
    return headHidden(this.fp);
  }

  /** True while the first-person camera is (or is becoming) active and needs an EyeSample each frame. */
  get wantsEye(): boolean {
    return this.view === "first" || this.fp > 0;
  }

  /** `instant` skips the blend (start-up with `?view=first` / the saved choice). */
  setView(mode: ViewMode, instant = false): void {
    this.view = mode;
    if (instant) this.fp = mode === "first" ? 1 : 0;
    this.primed = false;
    this.clampPitch();
  }

  toggleView(): ViewMode {
    this.setView(this.view === "first" ? "third" : "first");
    return this.view;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * this.settings.sensitivity;
    this.pitch += dy * this.settings.sensitivity * (this.settings.invertY ? -1 : 1);
    this.clampPitch();
  }

  /** Moves the view by an angle (radians; `dElev` up is positive, as the shot's elevation): the pad's aim assist pulls the aim this way, never the mouse's. */
  nudge(dYaw: number, dElev: number): void {
    this.yaw += dYaw;
    this.pitch -= dElev;
    this.clampPitch();
  }

  private clampPitch(): void {
    const [lo, hi] = pitchRange(this.view === "first");
    this.pitch = clamp(this.pitch, lo, hi);
  }

  addShake(amount: number): void {
    this.shakeEnergy = Math.min(1, this.shakeEnergy + amount);
  }

  /** A shot's recoil as a camera kick (radians): the lens rises `pitch` and turns `yaw`, then eases back. Scaled by the camera shake setting. */
  addKick(pitch: number, yaw = 0): void {
    const k = this.settings.shake;
    this.kickPitch = Math.min(0.09, this.kickPitch + pitch * k);
    this.kickYaw = Math.max(-0.05, Math.min(0.05, this.kickYaw + yaw * k));
  }

  /**
   * `target` is the character's feet position; `dt` in seconds. `eye` (from CharacterActor.sampleEye) is required for first person: while
   * it is missing the camera simply stays in third person.
   */
  update(target: Vector3, dt: number, aiming: boolean, eye?: EyeSample, downed = false): void {
    dt = Math.max(0, dt); // the first frame's timestamp can precede the loop's `last`
    this.clock += dt;
    easeMountedCamera(this.mountCam, dt, this.mounted, this.mountSpeed01);
    this.downedK = damp(this.downedK, downed ? 1 : 0, downed ? 2.2 : 3.5, dt);
    if (this.downedK < 1e-3) this.downedK = 0;
    this.updateThird(target, dt, aiming);

    this.fp = transitionStep(this.fp, this.view === "first" && eye ? 1 : 0, dt);
    const e = ease(this.fp);
    const useFirst = eye !== undefined && this.fp > 0;
    if (useFirst) this.updateFirst(target, dt, aiming, eye);
    else this.primed = false;

    // D-077: the scenery's camera fade follows the subject (the chest), only while the follow camera is the one in use
    atmoUniforms.uFocus.value.set(this.focus.x, this.focus.y + 1.2, this.focus.z, useFirst ? 1 - e : 1);
    if (useFirst) {
      this.camera.position.lerpVectors(this.thirdPos, this.fpPos, e);
      this.lookBlend.lerpVectors(this.thirdLook, this.fpLook, e);
      this.camera.lookAt(this.lookBlend);
    } else {
      this.camera.position.copy(this.thirdPos);
      this.camera.lookAt(this.thirdLook);
    }

    if (this.kickPitch !== 0 || this.kickYaw !== 0) {
      this.camera.rotateX(this.kickPitch);
      this.camera.rotateY(this.kickYaw);
      const k = Math.exp(-dt * 8);
      this.kickPitch = Math.abs(this.kickPitch) < 1e-4 ? 0 : this.kickPitch * k;
      this.kickYaw = Math.abs(this.kickYaw) < 1e-4 ? 0 : this.kickYaw * k;
    }
    this.shakeEnergy = Math.max(0, this.shakeEnergy - dt * 2.2);
    const shake = this.shakeEnergy * this.shakeEnergy * 0.12 * this.settings.shake;
    if (shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
      if (e > 0) this.camera.rotateZ((Math.random() - 0.5) * shake * 0.5 * e);
    }

    const fpFov = (this.settings.firstPersonFov ?? FIRST_PERSON.fov) * this.fpFovScale;
    // the aim lens: a tighter field of view while aiming over the shoulder (the target under the crosshair grows), fading out as the first-person lens takes over
    const smoothAim = this.aimK * this.aimK * (3 - 2 * this.aimK);
    const lens = 1 - (1 - AIM.camera.fovScale) * smoothAim * (1 - e);
    const fov = (this.settings.fov + this.mountCam.fov * (1 - e)) * lens + (fpFov - this.settings.fov) * e;
    const near = this.fp > 0 ? FIRST_PERSON.near : FIRST_PERSON.nearThird;
    if (Math.abs(this.camera.fov - fov) > 1e-3 || this.camera.near !== near) {
      this.camera.fov = fov;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** One of the lens's three rays (side 0 the centre, 1 its right edge, -1 its left): the fraction of the way out to the first solid, less the clearance (1 = clear). */
  private lensRay(hx: number, hy: number, hz: number, wx: number, wy: number, wz: number, side: number, cosY: number, sinY: number): number {
    const ex = wx + cosY * LENS_RADIUS * side;
    const ez = wz - sinY * LENS_RADIUS * side;
    const el = Math.hypot(ex, wy, ez);
    const t = this.firstSolid(hx, hy, hz, ex / el, wy / el, ez / el, el);
    return t < el ? (t - AIM.camera.wallClearance) / el : 1;
  }

  /** Metres along the ray to the first solid, the world's or an occluder's (`len` when the way is clear). */
  private firstSolid(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): number {
    const t = rayWorld(this.world, ox, oy, oz, dx, dy, dz, len, _wall) ? _wall.t : len;
    const occ = this.occluders;
    if (!occ) return t;
    const r = this.camRay;
    r.ox = ox;
    r.oy = oy;
    r.oz = oz;
    r.dx = dx;
    r.dy = dy;
    r.dz = dz;
    r.len = t;
    r.t = t;
    occ.cast(r);
    return r.t;
  }

  /**
   * The follow camera, tracked every frame so a switch back has no pop. Aiming blends (`blendAim`) the shoulder out to `AIM.camera.shoulder`, the distance in to `distanceScale`, and
   * turns the view to look straight down the aim (the picture's middle is what the shot meets and the body sits to the side); the lens tightens in `update`. A wall behind the character
   * pulls the camera in along its own line (never closer than `MIN_FOLLOW`, never inside the head), with `AIM.camera.wallClearance` to spare.
   */
  private updateThird(target: Vector3, dt: number, aiming: boolean): void {
    this.focus.lerp(target, 1 - Math.exp(-dt * 18));
    if (this.focus.distanceToSquared(target) > 100) this.focus.copy(target);

    // Downed: no kill-cam and no cut, just the same camera settling closer and lower, looking a little up at the sky and the faces bending over you,
    // with a slow unsteady drift (the player can still look around; this only moves the framing).
    const dk = this.downedK;
    this.aimK = blendAim(this.aimK, aiming && dk < 0.5, dt);
    this.readyK = blendAim(this.readyK, this.ready && dk < 0.5, dt);
    const ak = this.aimK * this.aimK * (3 - 2 * this.aimK); // smoothstep of the exponential approach: it starts from rest as well as ending at rest
    const rk = this.readyK * this.readyK * (3 - 2 * this.readyK) * (1 - ak); // (the aim view takes over from the ready view, never adds to it)
    const dist = (this.distance * (1 - (1 - AIM.camera.distanceScale) * ak - (1 - AIM.camera.readyDistanceScale) * rk) + this.mountCam.pull) * (1 - 0.32 * dk);
    const pitch = clamp(this.pitch - 0.3 * dk, -0.35, 1.25); // first person may look further than the follow camera can
    const cp = Math.cos(pitch);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // Camera sits behind the look direction (look = -Z at yaw 0), offset to the right shoulder.
    const shoulder = HIP_SHOULDER + (AIM.camera.shoulder - HIP_SHOULDER) * ak + (AIM.camera.readyShoulder - HIP_SHOULDER) * rk;
    const hy = this.focus.y + HEAD_Y + this.mountCam.rise - 0.95 * dk;
    this.desired.set(
      this.focus.x + sinY * cp * dist + cosY * shoulder,
      hy + Math.sin(pitch) * dist,
      this.focus.z + cosY * cp * dist - sinY * shoulder,
    );
    const floor = this.world.terrainHeight(this.desired.x, this.desired.z) + 0.4;
    if (this.desired.y < floor) this.desired.y = floor;

    // Walls: from the head toward the wanted camera spot; the first solid on that line pulls the camera in front of it.
    this.wallPull = 0;
    const hx = this.focus.x;
    const hz = this.focus.z;
    const wx = this.desired.x - hx;
    const wy = this.desired.y - hy;
    const wz = this.desired.z - hz;
    const wl = Math.hypot(wx, wy, wz);
    if (wl > MIN_FOLLOW) {
      // How far out (a fraction of the line) the centre ray and the rays to the lens's left and right edges get before something stops them
      // (right = the camera's own right). Something beside the lens on ONE side slides the lens toward the middle (a parapet along the path, a
      // trunk at the lens's elbow) instead of hauling the camera in to the back of the head; the centre blocked, or both sides, pulls it in.
      const fC = this.lensRay(hx, hy, hz, wx, wy, wz, 0, cosY, sinY);
      const fR = this.lensRay(hx, hy, hz, wx, wy, wz, 1, cosY, sinY);
      const fL = this.lensRay(hx, hy, hz, wx, wy, wz, -1, cosY, sinY);
      let frac = 1;
      if (fR < 1 && fL < 1) frac = Math.min(fC, fR, fL);
      else if (fC < 1 || fR < 1 || fL < 1) {
        // blocked on one side only: slide toward the free side (the shoulder's offset and the lens's own width, at most), then judge the slid line alone
        const side = fR < 1 || (fC < 1 && fL >= 1) ? 1 : -1;
        const slide = (shoulder + LENS_RADIUS) * clamp((1 - Math.min(fC, fR, fL)) * 6, 0, 1);
        const sx = wx - cosY * slide * side;
        const sz = wz + sinY * slide * side;
        const sl = Math.hypot(sx, wy, sz);
        const st = this.firstSolid(hx, hy, hz, sx / sl, wy / sl, sz / sl, sl);
        if (st < sl) frac = (st - AIM.camera.wallClearance) / sl;
        this.desired.set(hx + sx, hy + wy, hz + sz);
      }
      if (frac < 1) {
        const dx = this.desired.x - hx, dy = this.desired.y - hy, dz = this.desired.z - hz;
        const dl = Math.hypot(dx, dy, dz);
        // never inside the wall: a wall nearer than MIN_FOLLOW is followed all the way in (the body is drawn see-through then, Game.ts), down to just behind the eyes
        const keep = clamp(frac * dl, LENS_FLOOR, dl);
        this.wallPull = dl - keep;
        const k = keep / dl;
        this.desired.set(hx + dx * k, hy + dy * k, hz + dz * k);
      }
    }

    // follow quickly; a wall pull-in is taken at once (a camera lerping through a wall for a few frames is the ugly part)
    this.thirdPos.lerp(this.desired, 1 - Math.exp(-dt * 20));
    if (this.wallPull > 0) {
      const away = this.thirdPos.distanceTo(this.focus) - this.desired.distanceTo(this.focus);
      if (away > 0) this.thirdPos.copy(this.desired);
    }
    // hip: look at the wearer's chest; aimed: look exactly down the aim (parallel to yaw/pitch), so the crosshair ray IS the aim direction and a shot solved against it never drifts
    this.look3.set(
      this.focus.x + Math.sin(this.clock * 0.7) * 0.12 * dk,
      this.focus.y + 1.35 - 0.7 * dk + Math.sin(this.clock * 0.53 + 1) * 0.07 * dk,
      this.focus.z,
    );
    // how far the view looks down the line (aimed or ready) rather than at the wearer's chest; a camera a wall has pushed in to the head looks the way
    // the player looks too (from there the chest is straight down)
    const close = 1 - clamp((this.thirdPos.distanceTo(this.focus) - 1.6) / 1.4, 0, 1);
    const line = Math.max(ak + rk, close * close * (3 - 2 * close));
    if (line > 0) {
      const far = 30;
      this.thirdLook.set(this.thirdPos.x - sinY * cp * far, this.thirdPos.y - Math.sin(pitch) * far, this.thirdPos.z - cosY * cp * far);
      this.thirdLook.lerpVectors(this.look3, this.thirdLook, line);
    } else this.thirdLook.copy(this.look3);
  }

  private updateFirst(feet: Vector3, dt: number, aiming: boolean, eye: EyeSample): void {
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    this.yawFwd.x = -sinY;
    this.yawFwd.z = -cosY;
    const bobAmount = this.settings.headBob ?? 1;

    // Lying down: an animated body (downed, getting up) reports exactly how far over it is (`lie`), so the lens follows the body itself and
    // never lags behind it into the torso; a physics ragdoll has no such number and is eased in, then lightly smoothed.
    if (eye.ragdolled) {
      this.downK = damp(this.downK, 1, 3.5, dt);
      this.softK = damp(this.softK, 1, 6, dt);
      this.wasRagdolled = true;
    } else {
      const lie = eye.lie ?? (eye.lying ? 1 : 0);
      // The frame a ragdoll hands back to the animator the body is suddenly upright: ease the view up instead of snapping.
      if (this.wasRagdolled && Math.abs(this.downK - lie) > 0.01) this.downK = damp(this.downK, lie, 8, dt);
      else {
        this.wasRagdolled = false;
        this.downK = lie;
      }
      this.softK = damp(this.softK, 0, 8, dt);
    }

    // Anchor: the head joint normally; the torso while a ragdoll flops (a flying head would put the lens inside a skull).
    const a = eye.ragdolled ? eye.torso : eye.neck;
    const eyeUp = eye.ragdolled ? eye.eyeUp + 0.12 : eye.eyeUp; // clear of the torso's thickness, which the anchor sits in the middle of
    const reach = eye.ragdolled ? 0.15 : eye.eyeReach;
    const up = eye.ragdolled ? UP : eye.up;
    const fwd = eye.ragdolled ? this.yawFwd : eye.forward;

    // The anchor relative to the feet is what the animation moves (gait sway, crouch, kneel, lean, lying down). Horizontally it follows
    // closely; vertically it is low-passed at a rate the head-bob setting controls, so with bob off the gait's own sway is filtered out.
    const rx = a.x - feet.x;
    const ry = a.y - feet.y;
    const rz = a.z - feet.z;
    const fresh = !this.primed;
    if (fresh) {
      this.rel.set(rx, ry, rz);
      this.primed = true;
      this.downK = eye.ragdolled ? 1 : eye.lie ?? (eye.lying ? 1 : 0);
      this.softK = eye.ragdolled ? 1 : 0;
    } else {
      // Mid-way between standing and lying the head sweeps a metre in half a second: follow it tightly or the lens is left inside the torso.
      const sweep = eye.ragdolled ? 0 : 4 * this.downK * (1 - this.downK);
      const vRate = Math.max(eyeFollowRate(bobAmount), 6 + 10 * Math.max(this.downK, this.softK)) + 60 * sweep;
      const hRate = 14 + 60 * sweep;
      this.rel.x = damp(this.rel.x, rx, hRate, dt);
      this.rel.z = damp(this.rel.z, rz, hRate, dt);
      this.rel.y = damp(this.rel.y, ry, vRate, dt);
    }
    this.neckW.x = feet.x + this.rel.x;
    this.neckW.y = feet.y + this.rel.y;
    this.neckW.z = feet.z + this.rel.z;
    eyePosition(this.eyeOut, this.neckW, up, fwd, this.yaw, eyeUp, reach, this.downK);

    // Head bob, locked to distance walked.
    this.bobPhase = advanceBob(this.bobPhase, eye.speed, dt, eye.grounded);
    bobOffset(_bob, this.bobPhase, eye.speed, bobAmount, this.downK);
    this.eyeOut.x += cosY * _bob.side;
    this.eyeOut.z += -sinY * _bob.side;
    this.eyeOut.y += _bob.y;

    // Lying or falling: blend toward a lightly smoothed eye so a tumbling body does not shake the picture.
    if (fresh) this.soft.set(this.eyeOut.x, this.eyeOut.y, this.eyeOut.z);
    const k = 1 - Math.exp(-dt * 12);
    this.soft.x += (this.eyeOut.x - this.soft.x) * k;
    this.soft.y += (this.eyeOut.y - this.soft.y) * k;
    this.soft.z += (this.eyeOut.z - this.soft.z) * k;
    this.fpPos.set(
      this.eyeOut.x + (this.soft.x - this.eyeOut.x) * this.softK,
      this.eyeOut.y + (this.soft.y - this.eyeOut.y) * this.softK,
      this.eyeOut.z + (this.soft.z - this.eyeOut.z) * this.softK,
    );
    const floor = this.world.terrainHeight(this.fpPos.x, this.fpPos.z) + 0.12;
    if (this.fpPos.y < floor) this.fpPos.y = floor;

    const pitch = downedPitch(this.pitch, this.downK);
    const cp = Math.cos(pitch);
    this.fpLook.set(this.fpPos.x - sinY * cp * 10, this.fpPos.y - Math.sin(pitch) * 10, this.fpPos.z - cosY * cp * 10);
    this.fpFovScale = damp(this.fpFovScale, aiming ? FIRST_PERSON.aimFovScale : 1, 10, dt);
  }
}
