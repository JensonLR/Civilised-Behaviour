import { Box3, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Group, type Scene } from "three";
import { decodeSpec, generateCharacter } from "@cb/procedural";
import { BodyMarks, CharacterAnimator, HandPoser, buildCharacter, grimeLevel, stepExposure, type CharacterRig, type ExpressionId, type Exposure, type ExposureInput, type GoreLevel, type RideInput } from "@cb/procedural/three";
import { FLAG, WEAPONS, wrapAngle, type HitEvent, type LimbId, type WeaponId } from "@cb/shared";
import { getReduceMotion } from "../settings.ts";
import { damp, type EyeSample } from "./firstPerson.ts";
import type { Ragdoll, RagdollWorld } from "./Ragdoll.ts";
import { ghostTree, seeThroughTree } from "./ghost.ts";
import { WeaponRig } from "./weapons/WeaponRig.ts";
import { PennantHold } from "./pennant.ts";
import { TorchHold } from "./torch.ts";

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

const dropAt = new Vector3();

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
  /** What is in the hands (replicated combat state). Absent = empty hands. */
  combat?: ActorCombat;
  /** Sitting a horse (`MountView.rideInput`): the animator blends the riding pose over its own. Absent = on foot. */
  ride?: RideInput;
  /** What the world is doing to this body now (mud underfoot, a blast or fire near, rain, water): it gathers mud and soot (D-038, `stepExposure`). Absent = nothing accrues. A shared scratch object is fine: it is read at once. */
  ground?: Omit<ExposureInput, "moving">;
  /** D-047: a lit torch in the off hand (the raid's raiders whose weapon leaves it free). Absent = none. */
  torch?: boolean;
  /** D-095: the Society's pennant in the off hand (the siege's picket boys: a planted picket reads from across the field). Absent = none. */
  pennant?: boolean;
}

/** The replicated combat state of one figure, as the actor needs it. */
export interface ActorCombat {
  /** `PlayerState.weapon`: 0 = nothing drawn, else weapon id + 1. */
  weapon: number;
  /** Aim elevation, radians (+ up). */
  elev: number;
  /** 0..100 reload progress (`PlayerState.reload`). */
  reload: number;
  /** Working a cannon (0..1). */
  crew?: number;
  /** The `WEAPON` ids this body carries (the ones not in the hands hang on it: pistol and sabre on the hips, long guns slung). Absent = none drawn. */
  carried?: readonly number[];
}

/**
 * A player's (or NPC's) visible body: an articulated rig built from an encoded look, plus its animator.
 * Rebuilds transparently if the look string changes (creator, campaign events like a new scar).
 * Also owns the purely cosmetic reactions to harm: flinch, pain face, and the ragdoll fall when a hit puts the body down.
 */
const CROWN_BOX = new Box3();

export class CharacterActor {
  private rig!: CharacterRig;
  private anim!: CharacterAnimator;
  /** Hand closure follows what the body is doing (a carried load, a clenched fist, a sprint) and what is held (see `heldGrip`). */
  private hands!: HandPoser;
  /** Grip forced by something in the hand (a weapon or tool sets these); undefined = empty hand. */
  heldGrip: { L?: number | undefined; R?: number | undefined } = {};
  private currentLook = "";
  private painTimer = 0;
  /** D-084: a passing mood (fear, triumph, surprise, a gritted shot) and how long it holds; where the head is looking, and for how long. */
  private mood: ExpressionId = "neutral";
  private moodTimer = 0;
  private lookX = 0;
  private lookZ = 0;
  private lookTimer = 0;
  private ragdoll: Ragdoll | undefined;
  /** The weapon in the hands: model, recoil, blows (weapons/WeaponRig.ts). Rebuilt with the rig. */
  private weapons!: WeaponRig;
  /** D-047: built on the first frame that wants one. */
  private torch?: TorchHold;
  private torchT = 0;
  private torchWasOn = false;
  /** D-095: built on the first frame that wants one. */
  private pennant?: PennantHold;
  private pennantT = 0;
  /** A lit torch left the hand because the body went down: where it fell (world x, ground y, z) and the way it lies. Set by the game (`GroundTorches`); absent = it just goes out. */
  onTorchDropped?: (x: number, y: number, z: number, yaw: number, seed: number) => void;
  private lastVy = 0;
  private lastVx = 0;
  private lastVz = 0;
  // ---- first person (local body only) ----
  private firstPerson = false;
  private viewYaw = 0;
  /** 0..1 easing of the first-person arm pose and body-follows-view; decays after leaving first person. */
  private fpBlend = 0;
  private fpFree = 1;
  /** Third person, local body: the yaw of the aim ray while the sight is up (undefined = none), and 0..1 how far the body has been turned to it. */
  private aimYaw: number | undefined;
  private aimBlend = 0;
  private visFacing = 0;
  private lastFlags = 0;
  private lastSpeed = 0;
  private headShadow: Mesh | undefined;
  /** The first-person viewmodel draws this body's arms and weapon: here they cast their shadow and nothing else (render/ghost.ts). */
  private viewmodelOn = false;
  /** Open wounds, mud and soot on the body (procedural/three/wounds.ts): re-made only when a level changes. */
  private marks!: BodyMarks;
  private readonly exposure: Exposure = { mud: 0, soot: 0 };
  private downedFor = 0;
  private marksKey = -1;

  constructor(
    private readonly scene: Scene,
    look: string | undefined,
    private readonly fallbackSeed: number,
    private outline = true,
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

  /** D-100: the height of the figure's top, hat included (metres over its feet, measured at rest when it was built): where a name plate sits. */
  get crown(): number {
    return this.crownH;
  }
  private crownH = 1.8;

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
    this.marks?.dispose();
    this.torch?.dispose();   // (off the old hand before the rig goes: its geometry is shared by every torch)
    this.pennant?.dispose();
    this.rig?.dispose();
    this.rig = buildCharacter(spec, { outline: this.outline });
    // D-100: the figure's real top, hat and all, measured once at rest (a plate set a fixed 0.55 m over the bare head hung a metre clear of a near figure, over whoever stood behind)
    this.rig.root.position.set(0, 0, 0);
    this.rig.root.updateMatrixWorld(true);
    this.crownH = Math.max(this.rig.proportions.totalHeight, CROWN_BOX.setFromObject(this.rig.root).max.y);
    this.torch?.attach(this.rig.joints.wristL);
    this.pennant?.attach(this.rig.joints.wristL);
    this.marks = new BodyMarks(this.rig);
    this.marksKey = -1;
    this.anim = new CharacterAnimator(this.rig);
    this.hands = new HandPoser(this.rig);
    this.weapons?.dispose();
    this.weapons = new WeaponRig(this.rig, this.anim, this.outline);
    if (prevPos) {
      this.rig.root.position.copy(prevPos);
      this.rig.root.rotation.y = prevYaw;
    }
    this.scene.add(this.rig.root);
    this.currentLook = look ?? "";
    this.headShadow = undefined;
    this.applyHeadVisibility();
    if (this.viewmodelOn) this.applyViewmodelGhost();
  }

  /** The graphics preset turned the ink line on or off: applies to the body and the weapon in its hands at once. */
  setOutline(on: boolean): void {
    if (on === this.outline) return;
    this.outline = on;
    this.rig.setOutline(on);
    this.weapons.setOutline(on);
  }

  /** Body heading as drawn (the server's facing for everyone else; the view direction for the local body in first person, the aim ray's while aiming in third). */
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

  /**
   * Third person, LOCAL body: the yaw of the aim ray (the direction the shot leaves the eye; `CombatView.aimHeading`), or undefined when there is none. While AIM is held the body is
   * drawn turned to it, smoothed, and eased back to the server's heading after. Presentation only: the shared step's `facing` (which already follows the camera's yaw while aiming) and
   * the server's authority are untouched, and every other body is drawn from its replicated facing as before. Cheap to call every frame.
   */
  setAimYaw(yaw: number | undefined): void {
    this.aimYaw = yaw;
  }

  /** D-077: the follow camera is hard against this (local) body: draw it see-through (ghost.ts `seeThroughTree`), and with the lens inside the head, without the head. Cheap to call every frame. */
  setSeeThrough(on: boolean, lensInHead = false): void {
    if (on !== this.seeThroughOn) {
      this.seeThroughOn = on;
      seeThroughTree(this.rig.root, on);
    }
    // the lens is inside the head: the head goes (its shadow stays), as in first person
    if (lensInHead !== this.lensInHead) {
      this.lensInHead = lensInHead;
      this.applyHeadVisibility();
    }
  }
  private seeThroughOn = false;
  private lensInHead = false;

  /**
   * The viewmodel is drawing this (local) body's arms and weapon: stop drawing them here, but keep their shadow. Cheap to call every frame;
   * takes effect at once. Also re-applied after every `update()` (a dressing or stump that appears later must be ghosted too).
   */
  setViewmodel(on: boolean): void {
    if (on === this.viewmodelOn && !on) return;
    this.viewmodelOn = on;
    this.applyViewmodelGhost();
  }

  private applyViewmodelGhost(): void {
    const j = this.rig.joints;
    const on = this.viewmodelOn;
    ghostTree(j.shoulderL, on);
    ghostTree(j.shoulderR, on);
    this.weapons.ghost(on);
  }

  private applyHeadVisibility(): void {
    const hide = this.firstPerson || this.lensInHead;
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
    if (!e.down) return;
    const lift = e.lift ?? 0;
    // D-064: a blast finding a body still in the air throws it on; a body already lying (or easing back into the pose) is picked up and thrown again
    if (this.ragdoll) {
      if (lift > 0) this.ragdoll.kick(e.dx, e.dz, e.power, lift);
      return;
    }
    const world = this.ragdolls();
    if (!world) return;
    this.ragdoll = world.spawn(this.rig, { vx: this.lastVx, vy: this.lastVy, vz: this.lastVz, dx: e.dx, dz: e.dz, power: e.power, zone: e.zone, lift });
  }

  /**
   * The wounds of a body that is down are OPEN (the living wear dressings) and dry over the minutes it lies there; mud and soot gather from `pose.ground` and show as levels 0..3. The
   * marks are re-made only when one of those changes, never per frame.
   */
  private updateMarks(dt: number, pose: ActorPose, gore: GoreLevel, downed: boolean): void {
    const lying = downed || this.ragdoll !== undefined;
    this.downedFor = downed ? this.downedFor + dt : 0;
    const g = pose.ground;
    if (g) stepExposure(this.exposure, dt, { mud: g.mud, moving: this.lastSpeed > 0.5, blast: g.blast, rain: g.rain, washing: g.washing });
    const open = lying ? (pose.wounds ?? 0) : 0;
    const dryB = Math.min(3, Math.floor(Math.min(1, this.downedFor / 180) * 4));
    const mud = grimeLevel(this.exposure.mud);
    const soot = grimeLevel(this.exposure.soot);
    const key = ((((open * 4 + dryB) * 4 + mud) * 4 + soot) * 3) + (gore === "full" ? 0 : gore === "reduced" ? 1 : 2);
    if (key === this.marksKey) return;
    this.marksKey = key;
    this.marks.set({ open, dryness: dryB / 3, mud, soot, gore });
  }

  /** `showLimbs` false (a personal comfort setting) renders lost limbs as ordinary grievous wounds instead of stumps. */
  update(dt: number, pose: ActorPose, gore: GoreLevel = "full", showLimbs = true): void {
    const downed = (pose.flags & FLAG.DOWNED) !== 0;
    this.rig.root.position.x = pose.x;
    this.rig.root.position.z = pose.z;
    this.fpBlend = damp(this.fpBlend, this.firstPerson ? 1 : 0, 10, dt);
    this.lastFlags = pose.flags;
    this.lastSpeed = Math.hypot(pose.vx, pose.vz);
    const aimTurn = !this.firstPerson && this.aimYaw !== undefined && (pose.flags & FLAG.AIMING) !== 0 && !downed;
    this.aimBlend = damp(this.aimBlend, aimTurn ? 1 : 0, 10, dt);
    if (this.fpBlend > 0.002 || this.aimBlend > 0.002) {
      // The local body turns with the camera in first person (fast, but not instant: a little trailing reads as weight), and eases back
      // to the server's heading on the way out. In third person, while the sight is up, it turns to the aim ray the same way.
      const follow = this.firstPerson ? this.viewYaw : aimTurn ? this.aimYaw! : pose.facing;
      this.visFacing = dampAngle(this.visFacing, follow, this.firstPerson ? 25 : aimTurn ? 20 : 12, dt);
    } else this.visFacing = pose.facing;
    this.rig.root.rotation.y = this.visFacing;
    this.painTimer = Math.max(0, this.painTimer - dt);
    this.moodTimer = Math.max(0, this.moodTimer - dt);
    this.lookTimer = Math.max(0, this.lookTimer - dt);
    // D-084: the face in play. Pain wins; then a passing mood (a scream of panic, a grin over a fallen enemy, the start at a blast); a raised sight narrows the eyes.
    if (downed || this.painTimer > 0) this.anim.setExpression("pain");
    else if (this.moodTimer > 0) this.anim.setExpression(this.mood, Math.min(1, 0.4 + this.moodTimer));
    else if ((pose.flags & FLAG.AIMING) !== 0) this.anim.setExpression("angry", 0.55);
    else this.anim.setExpression("neutral");
    // and the head turns to what drew it (a blast, a shout), unless that is behind the shoulder or the body is down
    let look = 0;
    if (this.lookTimer > 0 && !downed) {
      const rel = wrapAngle(Math.atan2(-(this.lookX - pose.x), -(this.lookZ - pose.z)) - this.visFacing);
      if (Math.abs(rel) < 2.3) look = rel;
    }
    this.anim.setLook(look);
    this.lastVx = pose.vx;
    this.lastVy = pose.vy ?? 0;
    this.lastVz = pose.vz;
    const c = pose.combat;
    const weaponId = c && c.weapon > 0 ? c.weapon - 1 : -1;
    // Hands that are busy (carrying, dragging, kneeling, lying) put the weapon away; a fall too.
    const busy = (pose.flags & (FLAG.CARRYING | FLAG.DRAGGING | FLAG.REVIVING | FLAG.DOWNED | FLAG.DRAGGED)) !== 0 || this.ragdoll !== undefined;
    const wi = this.weapons.update(dt, {
      weapon: weaponId,
      aiming: (pose.flags & FLAG.AIMING) !== 0,
      elev: c?.elev ?? 0,
      reload: c && c.reload > 0 ? c.reload / 100 : 0,
      hidden: busy,
      crew: (pose.flags & FLAG.OPERATING) !== 0 ? Math.max(c?.crew ?? 0, 1) : 0,
      fp: this.fpBlend,
      carried: c?.carried,
    });
    this.anim.motion = getReduceMotion() ? 0.3 : 1;   // hair sway only (D-037): 30% under "reduce motion"
    this.anim.update(dt, { speed: Math.hypot(pose.vx, pose.vz), flags: pose.flags, vy: pose.vy ?? 0, wounds: pose.wounds, weapon: wi, ride: pose.ride });
    this.weapons.apply(this.anim.hold);
    // Fists close on what they hold (the hand poser reads these; empty hands go back to the body's own grip).
    const h = this.anim.hold;
    const staff = (pose.flags & FLAG.OPERATING) !== 0 ? 0.85 : undefined; // (a cannon's crew has both fists round the rammer's staff)
    this.heldGrip.R = h.visible && h.right.w > 0.3 ? 0.92 : staff;
    this.heldGrip.L = h.visible && h.left.w > 0.3 ? 0.88 : staff;
    // D-047: a torch in a free off hand (never while the hands are busy or the weapon wants the left hand too)
    const torchOn = pose.torch === true && !busy && !(h.visible && h.left.w > 0.3);
    if (torchOn && !this.torch) {
      this.torch = new TorchHold(this.fallbackSeed);
      this.torch.attach(this.rig.joints.wristL);
    }
    if (torchOn) this.heldGrip.L = 0.85;
    // the bearer went down: the torch falls where the hand was, instead of vanishing with the grip (read before `update` hides it)
    if (this.torchWasOn && !torchOn && this.torch && ((pose.flags & FLAG.DOWNED) !== 0 || this.ragdoll !== undefined)) {
      this.torch.group.getWorldPosition(dropAt);
      this.onTorchDropped?.(dropAt.x, pose.y, dropAt.z, pose.facing + 1.2, this.fallbackSeed);
    }
    this.torchWasOn = torchOn;
    this.torchT += dt;
    this.torch?.update(torchOn, this.torchT);
    // D-095: a pennant in the same free off hand (a picket boy who goes down lets it go: it is not lit, so it simply goes)
    const pennantOn = pose.pennant === true && !torchOn && !busy && !(h.visible && h.left.w > 0.3) && (pose.flags & FLAG.DOWNED) === 0;
    if (pennantOn && !this.pennant) {
      this.pennant = new PennantHold(this.fallbackSeed);
      this.pennant.attach(this.rig.joints.wristL);
    }
    if (pennantOn) this.heldGrip.L = 0.85;
    this.pennantT += dt;
    this.pennant?.update(pennantOn, this.pennantT);
    this.hands.update(dt, pose.flags, Math.hypot(pose.vx, pose.vz), this.anim.currentExpression, this.heldGrip.L, this.heldGrip.R);
    // The animator overwrites root.position.y each update with its own offset (e.g. lift when lying down);
    // the ground height is added afterwards.
    this.rig.root.position.y += pose.y;
    if (this.fpBlend > 0.002) this.poseFirstPersonArms(dt, pose);
    this.rig.setWounds(pose.wounds ?? 0, gore);
    this.rig.setMissing(showLimbs ? (pose.missing ?? 0) : 0, gore);
    this.updateMarks(dt, pose, gore, downed);
    if (this.viewmodelOn) this.applyViewmodelGhost();

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
    const hold = this.anim.hold;
    const wR = hold.visible || hold.right.w > 0.05 ? hold.right.w : 0; // an arm on a weapon is posed by the animator's IK, not the guard
    const wL = hold.visible || hold.left.w > 0.05 ? hold.left.w : 0;
    const carrying = (pose.flags & FLAG.CARRYING) !== 0;
    const kneeling = (pose.flags & FLAG.REVIVING) !== 0;
    const other = (pose.flags & (FLAG.DRAGGING | FLAG.DOWNED)) !== 0;
    const A = FIRST_PERSON_ARMS;
    // Free arms take the guard on top of the gait swing; the busy poses replace it (dragging and lying down keep the animator's own).
    this.fpFree = damp(this.fpFree, carrying || kneeling || other ? 0 : 1, 10, dt);
    const k = this.fpBlend;
    const free = this.fpFree * k;
    for (const [sh, el, side, armed] of [[j.shoulderL, j.elbowL, 1, wL], [j.shoulderR, j.elbowR, -1, wR]] as const) {
      const f = free * (1 - armed);
      sh.rotation.x += A.shoulder * f;
      el.rotation.x += A.elbow * f;
      sh.rotation.z += side * A.inward * f;
      if (carrying || kneeling) {
        const pose = carrying ? A.carry : A.kneel;
        sh.rotation.x += (pose.shoulder - sh.rotation.x) * k;
        el.rotation.x += (pose.elbow - el.rotation.x) * k;
        sh.rotation.z += (side * pose.inward - sh.rotation.z) * k;
      }
    }
  }

  /** A shot left the barrel: play the recoil now (the local player's own shot is predicted; everyone else's arrives as an event). */
  fireWeapon(weapon: number): void {
    this.weapons.fire(weapon);
  }

  /** A blow begins: a swing of the blade, a butt-stroke, a punch. */
  swingWeapon(weapon: number, bash: boolean): void {
    this.weapons.swing(weapon, bash);
  }

  /** The muzzle of the weapon in hand in world space, or undefined when nothing is held. */
  muzzleWorld(out: Vector3): Vector3 | undefined {
    return this.weapons.muzzleWorld(out);
  }

  /** The unit direction the weapon in hand points. */
  muzzleDirection(out: Vector3): Vector3 {
    return this.weapons.muzzleDirection(out);
  }

  /** The weapon in hand (`WEAPON` id) and whether it is drawn on screen right now. */
  get weaponId(): number {
    return this.weapons.weaponId;
  }
  get weaponShown(): boolean {
    return this.anim.hold.visible;
  }

  /** A free-standing copy of a limb in its current pose, to fly off as debris (see CharacterRig.detachLimb). */
  detachLimb(limb: LimbId): Group | undefined {
    return this.rig.detachLimb(limb);
  }

  /** Moods by how much they matter: a weaker one never cuts a stronger short (a soldier who panicked does not grin at the next shot). */
  static readonly MOOD_RANK: Readonly<Partial<Record<ExpressionId, number>>> = { fear: 4, triumph: 3, disgust: 2, surprise: 2, laugh: 2, angry: 1 };

  /** D-084: a passing mood held for `seconds` (the face eases back after). Ignored while a stronger one still holds. */
  cue(mood: ExpressionId, seconds: number): void {
    const rank = CharacterActor.MOOD_RANK[mood] ?? 0;
    if (this.moodTimer > 0 && (CharacterActor.MOOD_RANK[this.mood] ?? 0) > rank) return;
    const same = this.mood === mood && this.moodTimer > 0;
    this.mood = mood;
    this.moodTimer = same ? Math.max(this.moodTimer, seconds) : seconds;
  }

  /** D-084: the head turns toward the world point (x, z) for `seconds`. */
  lookAt(x: number, z: number, seconds: number): void {
    if (!Number.isFinite(x + z)) return;
    this.lookX = x;
    this.lookZ = z;
    this.lookTimer = Math.max(this.lookTimer, seconds);
  }

  /** The passing mood, if one holds (tests). */
  get currentMood(): ExpressionId | undefined {
    return this.moodTimer > 0 ? this.mood : undefined;
  }

  setExpression(id: ExpressionId): void {
    this.anim.setExpression(id);
  }

  dispose(): void {
    this.torch?.dispose();
    this.pennant?.dispose();
    this.marks.dispose();
    this.ragdoll?.dispose();
    this.ragdoll = undefined;
    this.weapons?.dispose();
    this.rig.dispose();
  }
}
