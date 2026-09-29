import { Mesh, MeshBasicMaterial, SphereGeometry, type Group, type Scene } from "three";
import { decodeSpec, generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig, type ExpressionId, type GoreLevel } from "@cb/procedural/three";
import { FLAG, type HitEvent, type LimbId } from "@cb/shared";
import { damp, type EyeSample } from "./firstPerson.ts";
import type { Ragdoll, RagdollWorld } from "./Ragdoll.ts";

/**
 * First-person arm pose, added on top of the animator for the local body only (nobody else sees it). A relaxed arm hangs far below the
 * bottom of a first-person frame; raised into a loose guard the hands sit low at the frame edges, swing with the gait, and read as "yours".
 */
export const FIRST_PERSON_ARMS = {
  /**
   * Free arms: extra forward raise of the shoulder and bend of the elbow (rad), added to the gait swing. (A positive X rotation swings a
   * hanging arm FORWARD, toward -Z.)
   */
  shoulder: 1.0,
  elbow: 0.85,
  /** Pulls the hands in toward the centre line (shoulder roll, rad). */
  inward: 0.04,
  /**
   * Carrying and kneeling are absolute poses, set here rather than added: the hands must be in front of the eyes whatever the third-person
   * animation does, because a first-person player has nothing else to tell them what they are holding.
   */
  carry: { shoulder: 0.85, elbow: 1.05, inward: 0.5 },
  kneel: { shoulder: 0.5, elbow: 0.5, inward: 0.15 },
} as const;

/** Root pitch of a fully downed figure; mirrors the animator (`j.root.rotation.x = down * (PI / 2 - 0.1)`). */
const LIE_ANGLE = Math.PI / 2 - 0.1;
const wrapPi = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const dampAngle = (cur: number, target: number, rate: number, dt: number): number => cur + wrapPi(target - cur) * (1 - Math.exp(-rate * dt));

/** Invisible but depth-casting stand-in for a hidden head: the shadow pass still sees a head-sized ball, the colour pass draws nothing. */
let headShadowGeo: SphereGeometry | undefined;
let headShadowMat: MeshBasicMaterial | undefined;

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
  // ---- first person (local body only) ----
  private firstPerson = false;
  private viewYaw = 0;
  /** 0..1 easing of the first-person arm pose and body-follows-view; decays after leaving first person. */
  private fpBlend = 0;
  private fpFree = 1;
  private visFacing = 0;
  private lastFlags = 0;
  private lastSpeed = 0;
  private headShadow: Mesh | undefined;

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
    this.headShadow = undefined;
    this.applyHeadVisibility();
  }

  /** Body heading as drawn (the server's facing for everyone else; the view direction for the local body in first person). */
  get facing(): number {
    return this.visFacing;
  }

  /**
   * First-person mode for the LOCAL body. The head (with its hair, hat, glasses and outline) is hidden so it never clips the lens, a
   * head-sized invisible ball keeps casting the head's shadow, the arms move into view and the body turns with the camera (`viewYaw`,
   * radians, the camera's yaw). Cheap to call every frame; safe at any time (mid-carry, revive, downed, ragdoll).
   */
  setFirstPerson(on: boolean, viewYaw = 0): void {
    this.viewYaw = viewYaw;
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    this.applyHeadVisibility();
  }

  private applyHeadVisibility(): void {
    const hide = this.firstPerson;
    this.rig.joints.head.visible = !hide;
    if (hide && !this.headShadow) {
      const P = this.rig.proportions;
      headShadowGeo ??= new SphereGeometry(1, 10, 6);
      headShadowMat ??= new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      const m = new Mesh(headShadowGeo, headShadowMat);
      m.name = "head_shadow";
      m.castShadow = true;
      m.receiveShadow = false;
      m.scale.setScalar(P.headRadius * 1.05);
      m.position.set(0, P.torsoHeight + P.neck + P.headRadius, 0);
      this.rig.joints.torso.add(m);
      this.headShadow = m;
    }
    if (this.headShadow) this.headShadow.visible = hide;
  }

  /**
   * Fills what the first-person camera needs (see EyeSample). Call after `update()`; refreshes the rig's world matrices, so use it only
   * while the local player is in (or entering) first person.
   */
  sampleEye(out: EyeSample): EyeSample {
    const { root, head, torso } = this.rig.joints;
    root.updateMatrixWorld(true);
    const h = head.matrixWorld.elements;
    out.neck.x = h[12]!;
    out.neck.y = h[13]!;
    out.neck.z = h[14]!;
    const ul = Math.hypot(h[4]!, h[5]!, h[6]!) || 1;
    out.up.x = h[4]! / ul;
    out.up.y = h[5]! / ul;
    out.up.z = h[6]! / ul;
    const fl = Math.hypot(h[8]!, h[9]!, h[10]!) || 1;
    out.forward.x = -h[8]! / fl;
    out.forward.y = -h[9]! / fl;
    out.forward.z = -h[10]! / fl;
    const t = torso.matrixWorld.elements;
    out.torso.x = t[12]!;
    out.torso.y = t[13]!;
    out.torso.z = t[14]!;
    const eye = this.rig.face.eyeL.position;
    out.eyeUp = this.rig.proportions.headRadius + eye.y;
    out.eyeReach = Math.max(0, -eye.z);
    out.ragdolled = this.ragdoll !== undefined;
    out.lying = out.ragdolled || (this.lastFlags & FLAG.DOWNED) !== 0;
    out.lie = Math.min(1, Math.max(0, root.rotation.x / LIE_ANGLE)); // the animator lays the whole figure over by this angle when downed
    out.speed = this.lastSpeed;
    out.grounded = (this.lastFlags & FLAG.GROUNDED) !== 0;
    return out;
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
    this.fpBlend = damp(this.fpBlend, this.firstPerson ? 1 : 0, 10, dt);
    this.lastFlags = pose.flags;
    this.lastSpeed = Math.hypot(pose.vx, pose.vz);
    if (this.fpBlend > 0.002) {
      // The local body turns with the camera in first person (fast, but not instant: a little trailing reads as weight), and eases back
      // to the server's heading on the way out.
      this.visFacing = dampAngle(this.visFacing, this.firstPerson ? this.viewYaw : pose.facing, this.firstPerson ? 25 : 12, dt);
    } else this.visFacing = pose.facing;
    this.rig.root.rotation.y = this.visFacing;
    this.painTimer = Math.max(0, this.painTimer - dt);
    this.anim.setExpression(downed || this.painTimer > 0 ? "pain" : "neutral");
    this.lastVx = pose.vx;
    this.lastVy = pose.vy ?? 0;
    this.lastVz = pose.vz;
    this.anim.update(dt, { speed: Math.hypot(pose.vx, pose.vz), flags: pose.flags, vy: pose.vy ?? 0, wounds: pose.wounds });
    // The animator overwrites root.position.y each update with its own offset (e.g. lift when lying down);
    // the ground height is added afterwards.
    this.rig.root.position.y += pose.y;
    if (this.fpBlend > 0.002) this.poseFirstPersonArms(dt, pose);
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

  /** Puts the arms where a first-person camera can see them (see FIRST_PERSON_ARMS). Runs after the animator; a ragdoll pose still overrides it. */
  private poseFirstPersonArms(dt: number, pose: ActorPose): void {
    const j = this.rig.joints;
    const carrying = (pose.flags & FLAG.CARRYING) !== 0;
    const kneeling = (pose.flags & FLAG.REVIVING) !== 0;
    const other = (pose.flags & (FLAG.DRAGGING | FLAG.DOWNED)) !== 0;
    const A = FIRST_PERSON_ARMS;
    // Free arms take the guard on top of the gait swing; the busy poses replace it (dragging and lying down keep the animator's own).
    this.fpFree = damp(this.fpFree, carrying || kneeling || other ? 0 : 1, 10, dt);
    const k = this.fpBlend;
    const free = this.fpFree * k;
    for (const [sh, el, side] of [[j.shoulderL, j.elbowL, 1], [j.shoulderR, j.elbowR, -1]] as const) {
      sh.rotation.x += A.shoulder * free;
      el.rotation.x += A.elbow * free;
      sh.rotation.z += side * A.inward * free;
      if (carrying || kneeling) {
        const pose = carrying ? A.carry : A.kneel;
        sh.rotation.x += (pose.shoulder - sh.rotation.x) * k;
        el.rotation.x += (pose.elbow - el.rotation.x) * k;
        sh.rotation.z += (side * pose.inward - sh.rotation.z) * k;
      }
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
