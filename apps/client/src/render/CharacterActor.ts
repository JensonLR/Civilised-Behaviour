import type { Group, Scene } from "three";
import { decodeSpec, generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig, type ExpressionId, type GoreLevel } from "@cb/procedural/three";
import { FLAG, type HitEvent, type LimbId } from "@cb/shared";
import type { Ragdoll, RagdollWorld } from "./Ragdoll.ts";

/** Everything that places and poses one figure this frame, taken from replicated + predicted state. */
export interface ActorPose {
  x: number;
  y: number;
  z: number;
  facing: number;
  /** Horizontal velocity, m/s. */
  vx: number;
  vz: number;
  vy?: number;
  /** FLAG bits. */
  flags: number;
  /** Packed wound mask (server-owned). */
  wounds?: number;
  /** Lost-limb mask (LIMB bits, server-owned). */
  missing?: number;
}

/**
 * A player's (or NPC's) visible body: an articulated rig built from an encoded look, plus its animator.
 * Rebuilds transparently if the look string changes (creator, campaign events like a new scar).
 * Also owns the purely cosmetic reactions to harm: flinch, pain face, and the ragdoll fall when a hit puts the body down.
 */
export class CharacterActor {
  private rig!: CharacterRig;
  private anim!: CharacterAnimator;
  private currentLook = "";
  private painTimer = 0;
  private ragdoll: Ragdoll | undefined;
  private lastVy = 0;
  private lastVx = 0;
  private lastVz = 0;

  constructor(
    private readonly scene: Scene,
    look: string | undefined,
    private readonly fallbackSeed: number,
    private readonly outline = true,
    /** Ragdoll physics, if loaded yet (it is fetched lazily; until then a knock-down uses the plain fall animation). */
    private readonly ragdolls: () => RagdollWorld | undefined = () => undefined,
  ) {
    this.build(look);
  }

  get root(): CharacterRig["root"] {
    return this.rig.root;
  }

  get animator(): CharacterAnimator {
    return this.anim;
  }

  get height(): number {
    return this.rig.proportions.totalHeight;
  }

  /** True while a physics ragdoll is driving (or blending out of) the pose. */
  get ragdolled(): boolean {
    return this.ragdoll !== undefined;
  }

  private build(look: string | undefined): void {
    const spec = (look ? decodeSpec(look) : undefined) ?? generateCharacter(this.fallbackSeed);
    const prev = this.rig?.root;
    const prevPos = prev?.position.clone();
    const prevYaw = prev?.rotation.y ?? 0;
    this.ragdoll?.dispose();
    this.ragdoll = undefined;
    this.rig?.dispose();
    this.rig = buildCharacter(spec, { outline: this.outline });
    this.anim = new CharacterAnimator(this.rig);
    if (prevPos) {
      this.rig.root.position.copy(prevPos);
      this.rig.root.rotation.y = prevYaw;
    }
    this.scene.add(this.rig.root);
    this.currentLook = look ?? "";
  }

  setLook(look: string | undefined): void {
    if ((look ?? "") !== this.currentLook) this.build(look);
  }

  /**
   * A blow landed on this figure: jolt the torso away from it, pull a pained face and, if it put them down, hand the
   * body to the ragdoll. `facing` is the body's current yaw, used to express the world-space push in the body's own frame.
   */
  hit(e: HitEvent, facing: number): void {
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);
    this.anim.flinch(e.dx * cos - e.dz * sin, e.dx * sin + e.dz * cos, e.power);
    this.painTimer = 0.5 + e.power * 0.7;
    if (!e.down || this.ragdoll) return;
    const world = this.ragdolls();
    if (!world) return;
    this.ragdoll = world.spawn(this.rig, { vx: this.lastVx, vy: this.lastVy, vz: this.lastVz, dx: e.dx, dz: e.dz, power: e.power, zone: e.zone });
  }

  /** `showLimbs` false (a personal comfort setting) renders lost limbs as ordinary grievous wounds instead of stumps. */
  update(dt: number, pose: ActorPose, gore: GoreLevel = "full", showLimbs = true): void {
    const downed = (pose.flags & FLAG.DOWNED) !== 0;
    this.rig.root.position.x = pose.x;
    this.rig.root.position.z = pose.z;
    this.rig.root.rotation.y = pose.facing;
    this.painTimer = Math.max(0, this.painTimer - dt);
    this.anim.setExpression(downed || this.painTimer > 0 ? "pain" : "neutral");
    this.lastVx = pose.vx;
    this.lastVy = pose.vy ?? 0;
    this.lastVz = pose.vz;
    this.anim.update(dt, { speed: Math.hypot(pose.vx, pose.vz), flags: pose.flags, vy: pose.vy ?? 0, wounds: pose.wounds });
    // The animator overwrites root.position.y each update with its own offset (e.g. lift when lying down);
    // the ground height is added afterwards.
    this.rig.root.position.y += pose.y;
    this.rig.setWounds(pose.wounds ?? 0, gore);
    this.rig.setMissing(showLimbs ? (pose.missing ?? 0) : 0, gore);

    const rd = this.ragdoll;
    if (rd) {
      // Revived mid-fall: stop flopping and get up. The grace period covers the hit event arriving a patch or two before the
      // DOWNED flag does (they travel separately), which must not cancel the fall it just started.
      if (!downed && rd.age > 0.5) rd.beginBlend();
      rd.setAnchor(pose.x, pose.z);
      rd.applyPose(dt);
      if (rd.phase === "done") this.ragdoll = undefined;
    }
  }

  /** A free-standing copy of a limb in its current pose, to fly off as debris (see CharacterRig.detachLimb). */
  detachLimb(limb: LimbId): Group | undefined {
    return this.rig.detachLimb(limb);
  }

  setExpression(id: ExpressionId): void {
    this.anim.setExpression(id);
  }

  dispose(): void {
    this.ragdoll?.dispose();
    this.ragdoll = undefined;
    this.rig.dispose();
  }
}
