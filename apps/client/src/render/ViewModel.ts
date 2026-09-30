import { DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from "three";
import { decodeSpec, generateCharacter } from "@cb/procedural";
import * as Proc from "@cb/procedural/three";
import { buildCharacter, type CharacterRig, type GoreLevel } from "@cb/procedural/three";
import { WeaponModel } from "./weapons/WeaponModels.ts";
import {
  MODE,
  VM,
  computeViewmodel,
  matchScreenPoint,
  newVmOut,
  newVmState,
  newViewArm,
  solveViewArm,
  stepViewmodel,
  viewmodelFov,
  vmBodyFrom,
  vmFire,
  vmSwing,
  type Mode,
  type VmBody,
  type VmFrame,
} from "./viewPose.ts";

/** What the viewmodel needs from the game's stage: the world scene (to copy its lights), the world camera and the renderer. */
export interface ViewModelHost {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  readonly outlines: boolean;
}

/** The per-frame facts the game hands over, beyond the pure `VmFrame`. */
export interface ViewModelFrame extends VmFrame {
  look: string | undefined;
  gore: GoreLevel;
  wounds: number;
  missing: number;
  /** The user's field-of-view setting (the viewmodel's own follows it a little). */
  userFov: number;
  /** Sway and recoil amount 0..1, and walking bob 0..1 (settings). */
  motion: number;
  bob: number;
}

/**
 * The wrist API (weaponPose.ts `solveWrist`, the rig's `wristL/R` bones) arrived with the hands-on-a-grip work; the viewmodel uses it when it is there, so
 * a fist wraps the weapon's handle, and falls back to the forearm's own line when it is not.
 */
interface WristApi {
  solveWrist(a: number, b: number, e: number, ax: number, ay: number, az: number, out: { x: number; y: number; z: number; w: number; s?: number }, m: Float64Array): number;
  rotateByQuat(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number, o: { x: number; y: number; z: number }): void;
  applyMatrix(m: Float64Array, x: number, y: number, z: number, o: { x: number; y: number; z: number }): void;
  forearmMatrix(a: number, b: number, e: number, m: Float64Array): void;
  HAND_CENTRE: number;
}
const WR = Proc as unknown as Partial<WristApi>;
const HAS_WRIST = typeof WR.solveWrist === "function" && typeof WR.rotateByQuat === "function" && typeof WR.applyMatrix === "function" && typeof WR.forearmMatrix === "function";

const _M = new Float64Array(9);
const _off = { x: 0, y: 0, z: 0 };
const _rot = { x: 0, y: 0, z: 0 };
const _gs = [
  { x: 0, y: 0, z: 0, w: 1, s: 0 },
  { x: 0, y: 0, z: 0, w: 1, s: 0 },
];

const _p = new Vector3();
const _q = { x: 0, y: 0, z: 0 };

/**
 * The first-person viewmodel: the local player's own arms (built from the same look, so sleeves and skin match) and the weapon in hand, drawn
 * in a second pass on their own camera. The pass clears the depth buffer first, so nothing in the world can cut into the hands however close a
 * wall is, and uses its own field of view, so a wide world lens does not stretch the gun. Lit by the world's own sun and sky (copied every frame),
 * the same toon ramp, the same ink line.
 *
 * The scene graph is camera-relative: `root` is put at the world camera's position and orientation each frame and everything inside is in camera
 * space (see viewmodel.ts). Only the shoulders of a full character rig are used - they are re-parented under `root` and the rest of the body is
 * never added to any scene - so wounds, missing limbs, prosthetics and hand grips work exactly as on the body.
 */
export class ViewModel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(VM.fov, 1, VM.near, VM.far);
  private readonly root = new Group();
  private readonly state = newVmState();
  private readonly out = newVmOut();
  private readonly armR = newViewArm();
  private readonly armL = newViewArm();
  private readonly hemi = new HemisphereLight(0xffffff, 0xffffff, 1);
  private readonly sun = new DirectionalLight(0xffffff, 3);
  private srcSun: DirectionalLight | undefined;
  private srcHemi: HemisphereLight | undefined;
  private readonly models = new Map<number, WeaponModel>();
  private model: WeaponModel | undefined;
  private rig: CharacterRig | undefined;
  private body: VmBody | undefined;
  private currentLook = "";
  private fovDeg: number = VM.fov;
  private worldFov = 78;
  private drawn = false;
  private shots = 0;
  private wasAutoReset = true;

  constructor(private readonly host: ViewModelHost) {
    this.scene.add(this.root, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = false;
    this.wasAutoReset = host.renderer.info.autoReset;
    host.renderer.info.autoReset = false; // two passes a frame: the game resets the counters once (Game.frame), so the overlay shows both
  }

  /** True when the viewmodel was drawn this frame (the game hides the body's own arms and weapon while it is). */
  get active(): boolean {
    return this.drawn;
  }

  /** Bare hands or the weapon id currently in the viewmodel's hands. */
  get weaponId(): number {
    return this.state.id;
  }

  /** The arm rig, for tests and stills. */
  get armsRig(): CharacterRig | undefined {
    return this.rig;
  }

  private ensureRig(look: string | undefined): void {
    if (this.rig && (look ?? "") === this.currentLook) return;
    if (this.rig) {
      this.root.remove(this.rig.joints.shoulderL, this.rig.joints.shoulderR);
      this.rig.dispose();
    }
    const spec = (look ? decodeSpec(look) : undefined) ?? generateCharacter(1);
    const rig = buildCharacter(spec, { outline: this.host.outlines });
    // keep only the arms: the shoulders come out of the torso and into camera space; the rest of the body is never drawn
    this.root.add(rig.joints.shoulderL, rig.joints.shoulderR);
    this.rig = rig;
    this.body = vmBodyFrom(rig.proportions, rig.face.eyeL.position.y);
    this.currentLook = look ?? "";
  }

  private findLights(): void {
    if (this.srcSun && this.srcHemi) return;
    for (const o of this.host.scene.children) {
      if (!this.srcSun && o instanceof DirectionalLight) this.srcSun = o;
      else if (!this.srcHemi && o instanceof HemisphereLight) this.srcHemi = o;
    }
  }

  /** A shot left the barrel: the recoil picture begins. */
  fire(weapon: number): void {
    vmFire(this.state, weapon, this.shots++);
  }

  /** A blow begins. */
  swing(windup: number, bash: boolean): void {
    vmSwing(this.state, windup, bash);
  }

  /** Puts everything back to rest (a new session). */
  reset(): void {
    Object.assign(this.state, newVmState());
    this.drawn = false;
  }

  /** Advances the animation and poses the arms and the weapon. Call after the world camera has been placed for this frame. */
  update(dt: number, f: ViewModelFrame): void {
    const cam = this.host.camera;
    this.ensureRig(f.look);
    const rig = this.rig!;
    const body = this.body!;
    this.state.motion = f.motion;
    this.state.bob = f.bob;
    stepViewmodel(this.state, f, dt);
    const out = computeViewmodel(this.state, body, this.out);
    this.drawn = out.visible;
    this.worldFov = cam.fov;
    if (!this.drawn) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    // the camera-relative frame
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    this.camera.position.copy(cam.position);
    this.camera.quaternion.copy(cam.quaternion);
    this.fovDeg = viewmodelFov(f.userFov);
    if (this.camera.fov !== this.fovDeg || this.camera.aspect !== cam.aspect) {
      this.camera.fov = this.fovDeg;
      this.camera.aspect = cam.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.root.updateMatrixWorld(true);

    // lights: the world's sun and sky, expressed in the same world frame
    this.findLights();
    const ss = this.srcSun;
    const sh = this.srcHemi;
    if (ss) {
      this.sun.color.copy(ss.color);
      this.sun.intensity = ss.intensity;
      this.sun.position.copy(ss.position).sub(ss.target.position).normalize().multiplyScalar(10);
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
    }
    if (sh) {
      this.hemi.color.copy(sh.color);
      this.hemi.groundColor.copy(sh.groundColor);
      this.hemi.intensity = sh.intensity;
    }

    // the arms
    rig.setWounds(f.wounds, f.gore);
    rig.setMissing(f.missing, f.gore);
    rig.setHandGrip("R", out.right.grip);
    rig.setHandGrip("L", out.left.grip);
    const j = rig.joints as CharacterRig["joints"] & { wristL?: Group; wristR?: Group };
    const dC = rig.proportions.handRadius * body.fs * (HAS_WRIST ? (WR.HAND_CENTRE ?? 0) : 0);
    for (const [sh_, el, wrist, side, hand, arm, gi] of [
      [j.shoulderR, j.elbowR, j.wristR, 1, out.right, this.armR, 1],
      [j.shoulderL, j.elbowL, j.wristL, -1, out.left, this.armL, 0],
    ] as const) {
      solveViewArm(body, side, hand.x, hand.y, hand.z, arm);
      if (HAS_WRIST && wrist) {
        // the wrist lays the fist's grip axis on the handle (or lets it hang from the forearm's line), and the arm is solved again for where that leaves the CENTRE of the fist
        const gs = _gs[gi]!;
        const handle = hand.ax * hand.ax + hand.ay * hand.ay + hand.az * hand.az > 0.25;
        for (let it = 0; it < 3; it++) {
          if (handle) {
            WR.solveWrist!(arm.a, arm.b, arm.e, hand.ax, hand.ay, hand.az, gs, _M);
            WR.rotateByQuat!(gs, 0, -dC, 0, _rot);
          } else {
            WR.forearmMatrix!(arm.a, arm.b, arm.e, _M);
            gs.x = gs.y = gs.z = 0;
            gs.w = 1;
            _rot.x = 0;
            _rot.y = -dC;
            _rot.z = 0;
          }
          WR.applyMatrix!(_M, _rot.x, _rot.y, _rot.z, _off);
          solveViewArm(body, side, hand.x - _off.x, hand.y - _off.y, hand.z - _off.z, arm);
        }
        if (handle) WR.solveWrist!(arm.a, arm.b, arm.e, hand.ax, hand.ay, hand.az, gs, _M);
        wrist.quaternion.set(gs.x, gs.y, gs.z, gs.w);
      }
      sh_.position.set(arm.sx, arm.sy, arm.sz);
      sh_.rotation.set(arm.a, 0, arm.b);
      el.rotation.set(arm.e, 0, 0);
      sh_.scale.setScalar(body.us);
      el.scale.setScalar(body.fs / body.us);
    }

    // the weapon
    this.setModel(out.weapon);
    const m = this.model;
    if (m) {
      m.group.visible = out.weaponVisible;
      if (out.weaponVisible) {
        m.group.position.set(out.px, out.py, out.pz);
        m.group.rotation.set(out.rx, out.ry, out.rz);
        m.setRod(out.rod);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  private setModel(id: number): void {
    if (this.model && this.model.id === id) return;
    if (this.model) this.model.group.visible = false;
    this.model = undefined;
    if (id < 0) return;
    let m = this.models.get(id);
    if (!m) {
      m = new WeaponModel(id, this.host.outlines, true);
      m.group.traverse((o) => (o.castShadow = false));
      this.root.add(m.group);
      this.models.set(id, m);
    }
    this.model = m;
  }

  /** Draws the viewmodel over the world just rendered: depth cleared, colour kept. */
  render(): void {
    if (!this.drawn) return;
    const r = this.host.renderer;
    const auto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }

  /**
   * The muzzle of the drawn weapon in WORLD space, placed where the world camera would draw it at the same spot on the screen as the viewmodel does
   * (the two lenses differ), pushed `ahead` metres along the barrel so the flash sits in front of the gun and not behind it. Undefined when no
   * weapon is shown.
   */
  muzzleWorld(out: Vector3, ahead = 0.06): Vector3 | undefined {
    const m = this.model;
    if (!this.drawn || !m || !m.group.visible) return undefined;
    m.muzzle.getWorldPosition(_p);
    this.root.worldToLocal(_p);
    // (a little further along the barrel, in camera space)
    const d = this.direction(_dir);
    _p.x += d.x * ahead;
    _p.y += d.y * ahead;
    _p.z += d.z * ahead;
    matchScreenPoint(_p.x, _p.y, _p.z, this.fovDeg, this.worldFov, _q);
    out.set(_q.x, _q.y, _q.z);
    return this.root.localToWorld(out);
  }

  /** The unit direction the barrel points, in world space. */
  muzzleDirection(out: Vector3): Vector3 {
    const m = this.model;
    if (!m) return out.set(0, 0, -1);
    m.group.getWorldDirection(out).negate();
    return out;
  }

  private direction(out: Vector3): Vector3 {
    const m = this.model;
    if (!m) return out.set(0, 0, -1);
    return out.set(0, 0, -1).applyQuaternion(m.group.quaternion);
  }

  dispose(): void {
    if (this.rig) {
      this.root.remove(this.rig.joints.shoulderL, this.rig.joints.shoulderR);
      this.rig.dispose();
    }
    for (const w of this.models.values()) w.dispose();
    this.models.clear();
    this.root.removeFromParent();
    this.host.renderer.info.autoReset = this.wasAutoReset;
    this.rig = undefined;
    this.drawn = false;
  }
}

const _dir = new Vector3();

/** Maps the game's hands-busy flags to a viewmodel mode. */
export function modeFor(carrying: boolean, kneeling: boolean, dragging: boolean, operating: boolean): Mode {
  return operating ? MODE.CREW : carrying ? MODE.CARRY : kneeling ? MODE.KNEEL : dragging ? MODE.DRAG : MODE.FREE;
}
