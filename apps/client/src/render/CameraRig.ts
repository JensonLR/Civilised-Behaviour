import { Vector3, type PerspectiveCamera } from "three";
import { clamp, type CollisionWorld } from "@cb/shared";
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

const UP = { x: 0, y: 1, z: 0 };
const _bob = { y: 0, side: 0 };

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
  distance = 5.6;
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
  /** 0..1: how far the follow camera has swung from looking at the wearer to looking down the aim (so the crosshair, not the head, is the middle of the picture). */
  private aimK = 0;
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
    const fov = this.settings.fov + this.mountCam.fov * (1 - e) + (fpFov - this.settings.fov) * e;
    const near = this.fp > 0 ? FIRST_PERSON.near : FIRST_PERSON.nearThird;
    if (Math.abs(this.camera.fov - fov) > 1e-3 || this.camera.near !== near) {
      this.camera.fov = fov;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** The follow camera: unchanged behaviour, tracked every frame so a switch back has no pop. */
  private updateThird(target: Vector3, dt: number, aiming: boolean): void {
    this.focus.lerp(target, 1 - Math.exp(-dt * 18));
    if (this.focus.distanceToSquared(target) > 100) this.focus.copy(target);

    // Downed: no kill-cam and no cut, just the same camera settling closer and lower, looking a little up at the sky and the faces bending over you,
    // with a slow unsteady drift (the player can still look around; this only moves the framing).
    const dk = this.downedK;
    const dist = ((aiming ? this.distance * 0.62 : this.distance) + this.mountCam.pull) * (1 - 0.32 * dk);
    const pitch = clamp(this.pitch - 0.3 * dk, -0.35, 1.25); // first person may look further than the follow camera can
    const cp = Math.cos(pitch);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // Camera sits behind the look direction (look = -Z at yaw 0), offset to the right shoulder.
    const shoulder = aiming ? 1.15 : 0.55; // aiming: wide enough that the weapon clears the wearer's head and reads beside the crosshair
    this.desired.set(
      this.focus.x + sinY * cp * dist + cosY * shoulder,
      this.focus.y + 1.55 + this.mountCam.rise - 0.95 * dk + Math.sin(pitch) * dist,
      this.focus.z + cosY * cp * dist - sinY * shoulder,
    );
    const floor = this.world.terrainHeight(this.desired.x, this.desired.z) + 0.4;
    if (this.desired.y < floor) this.desired.y = floor;

    this.thirdPos.lerp(this.desired, 1 - Math.exp(-dt * 20));
    this.aimK += ((aiming ? 1 : 0) - this.aimK) * (1 - Math.exp(-dt * 12));
    if (this.aimK < 1e-3) this.aimK = 0;
    // aiming: look at a far point straight ahead of the wearer, so the picture's middle is what the shot will meet and the body sits to the side
    const k = this.aimK * 30;
    this.thirdLook.set(
      this.focus.x - sinY * cp * k + Math.sin(this.clock * 0.7) * 0.12 * dk,
      this.focus.y + 1.35 - 0.7 * dk + 0.2 * this.aimK - Math.sin(pitch) * k + Math.sin(this.clock * 0.53 + 1) * 0.07 * dk,
      this.focus.z - cosY * cp * k,
    );
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
