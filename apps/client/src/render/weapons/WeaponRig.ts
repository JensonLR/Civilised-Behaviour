import { Vector3 } from "three";
import { WEAPON, WEAPONS, type WeaponId } from "@cb/shared";
import { newWeaponPoseInput, type CharacterAnimator, type CharacterRig, type HoldOut, type WeaponPoseInput } from "@cb/procedural/three";
import { ghostTree } from "../ghost.ts";
import type { WeaponLod } from "./gunParts.ts";
import { WeaponModel } from "./WeaponModels.ts";
import { Holsters } from "./WeaponMounts.ts";

/** How long the recoil picture of a shot takes to settle, by weapon (seconds). */
const KICK_SECONDS: Record<number, number> = { [WEAPON.PISTOL]: 0.24, [WEAPON.RIFLE]: 0.36, [WEAPON.BLUNDERBUSS]: 0.42 };

/** What the game knows about a wielder this frame. */
export interface WieldContext {
  /** Weapon in hand (`WEAPON` id) or -1. */
  weapon: number;
  aiming: boolean;
  /** Aim elevation, radians (+ up). */
  elev: number;
  /** 0..1 reload progress, or 0 when not reloading. */
  reload: number;
  /** Hands busy (carrying, dragging, kneeling, downed): the weapon is put away. */
  hidden: boolean;
  /** Working a cannon: 0..1. */
  crew: number;
  /** First person blend (0..1). */
  fp: number;
  /** The weapons this body carries (`WEAPON` ids); the ones not in the hands hang on it (pistol and sabre on the hips, long guns on the back). Omit to draw none. */
  carried?: readonly number[];
}

/**
 * The bridge between a character and the weapon in its hands: it owns the model (parented to the torso, so it rides lean, twist and flinch),
 * the cosmetic timers (recoil kick, a blow in flight) and the pose input the animator reads; after the animator has run it places the model
 * where the animator's hold says. One per wielder; the game never touches the animator's weapon fields directly.
 */
export class WeaponRig {
  /** The animator's weapon input, refreshed by `update` (pass it as `PoseInput.weapon`). */
  readonly input: WeaponPoseInput = newWeaponPoseInput();
  private model: WeaponModel | undefined;
  private readonly models = new Map<number, WeaponModel>();
  private kick = 0;
  private kickSeconds = 0.3;
  private swingT = -1;
  private swingSeconds = 0.5;
  private swingCount = 0;
  private readonly tmp = new Vector3();
  private holsters: Holsters | undefined;
  private lod: WeaponLod = 0;
  /** The hammer: 1 the instant a shot falls it, kept until the reload ends and it is cocked again; `hammerNow` follows with a snap (a hammer falls in a few frames). */
  private hammerTarget = 0;
  private hammerNow = 0;

  constructor(
    private readonly rig: CharacterRig,
    private readonly anim: CharacterAnimator,
    private outline: boolean,
  ) {}

  /** The graphics preset turned the ink line on or off. */
  setOutline(on: boolean): void {
    this.outline = on;
    for (const m of this.models.values()) m.setOutline(on);
    this.holsters?.setOutline(on);
  }

  get weaponId(): number {
    return this.input.id;
  }

  /** True while a blow is in the air. */
  get swinging(): boolean {
    return this.swingT >= 0;
  }

  /** A shot just left the barrel: recoil, at once. */
  fire(weapon: number): void {
    this.kick = 1;
    this.hammerTarget = 1;
    this.hammerNow = Math.max(this.hammerNow, 0.35);
    this.kickSeconds = KICK_SECONDS[weapon] ?? 0.3;
  }

  /** A blow begins (melee weapon, butt-stroke, or fists when `weapon` is -1). The strike lands at the windup, 36% into the animation. */
  swing(weapon: number, bash = false): void {
    const def = weapon >= 0 ? WEAPONS[weapon as WeaponId] : WEAPONS[WEAPON.FISTS];
    const wind = (bash ? def.melee?.windup : def.melee?.windup) ?? 0.2;
    this.swingSeconds = Math.max(0.3, wind / 0.36);
    this.swingT = 0;
    this.input.swingKind = bash ? 3 : this.swingCount++ % 3;
  }

  /** Cancels a blow in the air (weapon changed, hands busy). */
  cancelSwing(): void {
    this.swingT = -1;
  }

  /** Advances the timers and fills `input`. Call before `anim.update(dt, { ..., weapon: rig.input })`. */
  update(dt: number, c: WieldContext): WeaponPoseInput {
    const i = this.input;
    // the weapon follows the body's crowd level of detail (a far wielder carries the plain silhouette)
    const lod = Math.min(2, this.rig.lod) as WeaponLod;
    if (lod !== this.lod) this.setLod(lod);
    if (c.weapon !== i.id) this.setWeapon(c.weapon);
    if (c.carried) (this.holsters ??= new Holsters(this.rig, this.outline)).show(c.carried, c.hidden ? -1 : c.weapon);
    else this.holsters?.show([], -1);
    i.id = c.weapon;
    i.aim = c.aiming ? 1 : 0;
    i.elev = c.elev;
    i.reload = c.reload;
    i.hidden = c.hidden;
    i.crew = c.crew;
    i.fp = c.fp;
    this.kick = Math.max(0, this.kick - dt / this.kickSeconds);
    i.fire = this.kick;
    // the hammer is cocked when the reload is done (the last tenth of it), or when another weapon is drawn
    if (c.reload >= 0.9 || c.weapon < 0) this.hammerTarget = 0;
    this.hammerNow += (this.hammerTarget - this.hammerNow) * Math.min(1, dt * (this.hammerTarget > this.hammerNow ? 60 : 14));
    this.model?.setHammer(this.hammerNow);
    if (this.swingT >= 0) {
      this.swingT += dt;
      if (this.swingT >= this.swingSeconds || c.hidden) this.swingT = -1;
    }
    i.swing = this.swingT >= 0 ? this.swingT / this.swingSeconds : -1;
    return i;
  }

  private setLod(lod: WeaponLod): void {
    this.lod = lod;
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    this.model = undefined;
    this.holsters?.setLod(lod);
    if (this.input.id >= 0) this.setWeapon(this.input.id);
    this.applyHammer();
  }

  private applyHammer(): void {
    this.model?.setHammer(this.hammerNow);
  }

  private setWeapon(id: number): void {
    if (this.model) this.model.group.visible = false;
    this.model = undefined;
    this.swingT = -1;
    if (id < 0) return;
    let m = this.models.get(id);
    if (!m) {
      m = new WeaponModel(id, this.outline, false, this.lod);
      if (m.group.children.length > 1) {
        this.rig.joints.torso.add(m.group);
        this.models.set(id, m);
      } else {
        // a weapon without a model (bare hands, the cannon) shows nothing
        this.models.set(id, m);
      }
    }
    this.model = m;
  }

  /** The first-person viewmodel draws the weapon: keep only its shadow on the body (see render/ghost.ts). */
  ghost(on: boolean): void {
    for (const m of this.models.values()) ghostTree(m.group, on);
  }

  /** After the animator has run: put the model where the hold says and show it only when the hands really carry it. */
  apply(hold: HoldOut): void {
    const m = this.model;
    if (!m) return;
    const on = hold.visible && this.input.id === m.id;
    m.group.visible = on;
    if (!on) return;
    m.group.position.set(hold.px, hold.py, hold.pz);
    m.group.rotation.set(hold.rx, hold.ry, hold.rz);
    m.setRod(hold.rod);
  }

  /** The muzzle in world space, or undefined when nothing is held. Refreshes the matrices it needs. */
  muzzleWorld(out: Vector3): Vector3 | undefined {
    const m = this.model;
    if (!m || !m.group.visible) return undefined;
    this.rig.root.updateMatrixWorld(true);
    m.muzzle.getWorldPosition(this.tmp);
    return out.copy(this.tmp);
  }

  /** The world direction the muzzle points (unit), for the smoke. */
  muzzleDirection(out: Vector3): Vector3 {
    const m = this.model;
    if (!m) return out.set(0, 0, -1);
    m.group.getWorldDirection(out).negate(); // (an Object3D looks down +Z; the barrel is -Z)
    return out;
  }

  /** Where the first fist would be, for cosmetic effects tied to the right hand. */
  rightHandWorld(out: Vector3): Vector3 {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.joints.elbowR.localToWorld(out.set(0, -this.rig.proportions.armLower, 0));
  }

  dispose(): void {
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    this.model = undefined;
    this.holsters?.dispose();
    void this.anim;
  }
}
