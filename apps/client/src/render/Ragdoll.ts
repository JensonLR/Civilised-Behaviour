import { Quaternion, Vector3, type Group } from "three";
import { LAYER, ZONE, type CollisionWorld } from "@cb/shared";
import type { CharacterRig } from "@cb/procedural/three";
import type { RAPIER as RapierNs } from "@cb/physics";

type Rapier = typeof RapierNs;
type World = InstanceType<Rapier["World"]>;
type Body = InstanceType<Rapier["RigidBody"]>;

/**
 * Cosmetic ragdolls for the articulated rig. The server never simulates these: it keeps a plain capsule at the victim's
 * position and the client plays a short fall on top of it, then blends back into the animator's lying-down pose. That keeps
 * bandwidth at zero and gameplay authority untouched, at the price of two clients seeing slightly different tumbles.
 *
 * One Rapier world holds the static arena (same colliders the server builds) plus every live ragdoll. Ragdolls are capped and
 * time-limited: they exist for about two seconds per knock-down, never as permanent bodies.
 */
export const RAGDOLL = {
  /** Simultaneous ragdolls. Four players plus headroom for NPCs later; more requests fall back to the plain animation. */
  maxLive: 6,
  fixedDt: 1 / 60,
  maxStepsPerFrame: 3,
  solverIterations: 10,
  /** Fraction of the victim's running speed the fall inherits (the server capsule stops dead the instant they go down). */
  inheritVelocity: 0.5,
  /** The body may roam this far (m) from where the server says the player is before a spring drags it back. */
  tetherRadius: 1.8,
  tetherStrength: 12,
  /** Hard limit on the simulated phase, seconds. */
  maxSimSeconds: 2.6,
  /** Earliest the fall may be declared finished. */
  minSimSeconds: 0.7,
  /** All bodies slower than this (m/s) for `settleSeconds` counts as settled. */
  settleSpeed: 0.4,
  settleSeconds: 0.25,
  /** Seconds to blend from the simulated pose into the animated one. */
  blendSeconds: 0.5,
} as const;

// Approximate masses, kg. Clamped ratios keep the joint solver stable (a raw density-based torso is 100x a forearm).
const MASS = { pelvis: 8, torso: 14, head: 5, upperArm: 2.2, foreArm: 1.6, thigh: 6, shin: 3.5 } as const;

/** Bone order: parents always precede their children. */
const ORDER = ["pelvis", "torso", "head", "shoulderL", "elbowL", "shoulderR", "elbowR", "hipL", "kneeL", "hipR", "kneeR"] as const;
type BoneName = (typeof ORDER)[number];
const PARENT: Record<BoneName, number> = { pelvis: -1, torso: 0, head: 1, shoulderL: 1, elbowL: 3, shoulderR: 1, elbowR: 5, hipL: 0, kneeL: 7, hipR: 0, kneeR: 9 };
const INDEX = Object.fromEntries(ORDER.map((n, i) => [n, i])) as Record<BoneName, number>;

/**
 * Hinge limits, radians of the child's rotation about X relative to its parent, in the rig's own convention (the animator's): a limb that hangs down swings
 * FORWARD with +x, so the torso leans back with +x, a knee bends BACKWARD (shin swings behind) with -x and an elbow bends forward with +x.
 * (These were once written the other way round: the knees folded forward and the elbows backward, and the seeded animator pose started ~1.8 rad outside them.)
 */
export const HINGE_LIMITS: Readonly<Partial<Record<BoneName, readonly [number, number]>>> = {
  torso: [-0.7, 0.7],
  head: [-0.9, 0.9],
  elbowL: [-0.1, 2.5],
  elbowR: [-0.1, 2.5],
  kneeL: [-2.5, 0.1],
  kneeR: [-2.5, 0.1],
};

/**
 * The hands. A hand is not a simulated body: the forearm's capsule already covers it, and a wrist joint would be twelve more solver rows per figure for a fist. While the body
 * falls its wrist hangs loose instead: the hand swings to point down under gravity, at most this far (radians) from the forearm's line, easing there (`WRIST_EASE` per second), and
 * eases back into the animator's wrist when the fall blends out. It starts from whatever the wrist was doing (a fist turned onto a rifle), so nothing pops.
 */
export const WRIST_DANGLE = 1.0;
const WRIST_EASE = 9;
const WRIST_BONES = ["elbowL", "elbowR"] as const;

/** Which body takes the hardest shove for a hit zone. */
const ZONE_BODY: Record<number, BoneName> = {
  [ZONE.HEAD]: "head",
  [ZONE.TORSO]: "torso",
  [ZONE.ARM_L]: "shoulderL",
  [ZONE.ARM_R]: "shoulderR",
  [ZONE.LEG_L]: "hipL",
  [ZONE.LEG_R]: "hipR",
};

export interface RagdollLaunch {
  /** The victim's own velocity, m/s. */
  vx: number;
  vy: number;
  vz: number;
  /** Unit horizontal direction of the blow. */
  dx: number;
  dz: number;
  /** 0..1 */
  power: number;
  /** ZONE that was hit. */
  zone: number;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _axisX = new Vector3(1, 0, 0);
const _down = new Vector3(0, -1, 0);
const _fingers = new Vector3(0, -1, 0);
const _qa = new Quaternion();

export class RagdollWorld {
  private readonly world: World;
  private readonly live = new Set<Ragdoll>();
  private acc = 0;

  private constructor(
    readonly R: Rapier,
    world: World,
  ) {
    this.world = world;
  }

  /** Loads Rapier (lazily: the WASM only ships to players when the first knock-down happens) and builds the static arena. */
  static async create(terrain: CollisionWorld): Promise<RagdollWorld> {
    const { RAPIER, initRapier, buildStaticWorld } = await import("@cb/physics");
    await initRapier();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = RAGDOLL.fixedDt;
    world.numSolverIterations = RAGDOLL.solverIterations; // stiffer joint limits than the default 4
    buildStaticWorld(world, terrain);
    return new RagdollWorld(RAPIER, world);
  }

  get liveCount(): number {
    return this.live.size;
  }

  /** Rigid bodies currently in the physics world (static arena colliders are not bodies). For leak tests. */
  get bodyCount(): number {
    return this.world.bodies.len();
  }

  /** Steps the physics for the elapsed frame time (nothing runs while no ragdoll exists). */
  step(dt: number): void {
    if (this.live.size === 0) {
      this.acc = 0;
      return;
    }
    this.acc = Math.min(this.acc + dt, RAGDOLL.fixedDt * RAGDOLL.maxStepsPerFrame);
    while (this.acc >= RAGDOLL.fixedDt) {
      this.acc -= RAGDOLL.fixedDt;
      this.world.step();
      for (const r of this.live) r.afterStep();
    }
  }

  /** Starts a ragdoll from the rig's CURRENT pose. Returns undefined when the live cap is reached. */
  spawn(rig: CharacterRig, launch: RagdollLaunch): Ragdoll | undefined {
    if (this.live.size >= RAGDOLL.maxLive) return undefined;
    const r = new Ragdoll(this, this.world, rig, launch, () => this.live.delete(r));
    this.live.add(r);
    return r;
  }

  dispose(): void {
    for (const r of [...this.live]) r.dispose();
    this.world.free();
  }
}

export type RagdollPhase = "sim" | "blend" | "done";

export class Ragdoll {
  phase: RagdollPhase = "sim";
  /** Seconds since the ragdoll started. */
  age = 0;
  private blendT = 0;
  private calm = 0;
  private readonly bodies: Body[] = [];
  private readonly joints: Group[];
  /** World-space snapshot taken when the blend starts. */
  private readonly snapQ = ORDER.map(() => new Quaternion());
  private readonly snapPelvis = new Vector3();
  private readonly worldQ = ORDER.map(() => new Quaternion());
  private readonly pelvisPos = new Vector3();
  private readonly root: Group;
  /** Where the server says this player is; the ragdoll is tethered to it (see RAGDOLL.tetherRadius). */
  private anchorX = 0;
  private anchorZ = 0;
  private hasAnchor = false;
  /** The wrists' own rotation (local, in the forearm's frame): the pose they had, then the dangle; and the snapshot the blend starts from. */
  private readonly wristJoints: Group[];
  private readonly wristQ = [new Quaternion(), new Quaternion()];
  private readonly wristSnap = [new Quaternion(), new Quaternion()];

  constructor(
    private readonly owner: RagdollWorld,
    private readonly world: World,
    private readonly rig: CharacterRig,
    launch: RagdollLaunch,
    private readonly onDone: () => void,
  ) {
    const j = rig.joints;
    this.root = j.root;
    this.joints = ORDER.map((n) => j[n]);
    this.wristJoints = [j.wristL, j.wristR];
    for (let i = 0; i < 2; i++) this.wristQ[i]!.copy(this.wristJoints[i]!.quaternion);
    this.build(launch);
  }

  private build(launch: RagdollLaunch): void {
    const R = this.owner.R;
    const P = this.rig.proportions;
    const groups = ((LAYER.RAGDOLL & 0xffff) << 16) | (LAYER.WORLD & 0xffff);
    this.root.updateMatrixWorld(true);

    const shape = (name: BoneName): { desc: InstanceType<Rapier["ColliderDesc"]>; mass: number } => {
      const capsule = (len: number, r: number, mass: number) => ({
        desc: R.ColliderDesc.capsule(Math.max(0.01, len / 2 - r), r).setTranslation(0, -len / 2, 0),
        mass,
      });
      const legR = 0.11 * P.scale + 0.02;
      switch (name) {
        case "pelvis": return { desc: R.ColliderDesc.cuboid(P.torsoWidth * 0.42, 0.09, P.torsoDepth * 0.38), mass: MASS.pelvis };
        case "torso": return { desc: R.ColliderDesc.cuboid(P.torsoWidth * 0.45, P.torsoHeight / 2, P.torsoDepth * 0.4 + P.bellyForward * 0.3).setTranslation(0, P.torsoHeight / 2, 0), mass: MASS.torso };
        case "head": return { desc: R.ColliderDesc.ball(P.headRadius * 0.95).setTranslation(0, P.headRadius, 0), mass: MASS.head };
        case "shoulderL":
        case "shoulderR": return capsule(P.armUpper, P.armRadius * 1.1, MASS.upperArm);
        case "elbowL":
        case "elbowR": return capsule(P.armLower + P.handRadius * 1.4, P.armRadius, MASS.foreArm);
        case "hipL":
        case "hipR": return capsule(P.legUpper, legR, MASS.thigh);
        case "kneeL":
        case "kneeR": return capsule(P.legLower + 0.05 * P.scale, legR * 0.85, MASS.shin);
      }
    };

    const seed = this.seedPose();
    const dirLen = Math.hypot(launch.dx, launch.dz) || 1;
    const push = 1.0 + launch.power * 3.2;
    const hitBody = ZONE_BODY[launch.zone] ?? "torso";
    for (let i = 0; i < ORDER.length; i++) {
      const name = ORDER[i]!;
      const wp = seed.pos[i]!;
      const wq = seed.quat[i]!;
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(wp.x, wp.y, wp.z)
          .setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
          .setLinearDamping(0.4)
          .setAngularDamping(1.6),
      );
      const { desc, mass } = shape(name);
      this.world.createCollider(desc.setMass(mass).setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups), body);
      // Everything inherits the victim's velocity; the blow shoves the hit zone hardest and lifts the whole body a little.
      const k = name === hitBody ? 1.5 : 1;
      body.setLinvel(
        {
          x: launch.vx * RAGDOLL.inheritVelocity + (launch.dx / dirLen) * push * k * (0.7 + Math.random() * 0.3),
          y: launch.vy * RAGDOLL.inheritVelocity + 1.0 + launch.power * 1.6,
          z: launch.vz * RAGDOLL.inheritVelocity + (launch.dz / dirLen) * push * k * (0.7 + Math.random() * 0.3),
        },
        true,
      );
      body.setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 }, true);
      this.bodies.push(body);
    }

    // Joints. The child body's origin IS its pivot, so its anchor is (0,0,0); the parent anchor is the rig's rest offset.
    const anchor = (child: BoneName): { x: number; y: number; z: number } => {
      const p = this.joints[INDEX[child]]!.position;
      return { x: p.x, y: p.y, z: p.z };
    };
    const zero = { x: 0, y: 0, z: 0 };
    const axisX = { x: 1, y: 0, z: 0 };
    const hinge = (child: BoneName): void => {
      const [min, max] = HINGE_LIMITS[child]!;
      const joint = this.world.createImpulseJoint(R.JointData.revolute(anchor(child), zero, axisX), this.bodies[PARENT[child]]!, this.bodies[INDEX[child]]!, true);
      // Limits MUST be set on the created joint: assigning JointData.limitsEnabled/limits is silently ignored in rapier 0.21
      // (found the hard way: torsos folded to -1.3 rad against a 0.7 limit). The ragdoll tests assert the limits hold.
      (joint as InstanceType<Rapier["RevoluteImpulseJoint"]>).setLimits(min, max);
    };
    const ball = (child: BoneName): void => {
      this.world.createImpulseJoint(R.JointData.spherical(anchor(child), zero), this.bodies[PARENT[child]]!, this.bodies[INDEX[child]]!, true);
    };
    hinge("torso");
    hinge("head");
    ball("shoulderL");
    ball("shoulderR");
    hinge("elbowL");
    hinge("elbowR");
    ball("hipL");
    ball("hipR");
    hinge("kneeL");
    hinge("kneeR");
    this.readBodies();
  }

  /**
   * The pose the bodies start in: the rig's CURRENT pose, made legal. A hinge child keeps only its swing about X, clamped into the hinge's limits (a body
   * knocked down mid idle-act, mid fear-crouch or mid triumph-pump would otherwise start outside a limit and the solver would throw the joint across its
   * whole range to get back in), and every body is placed from its parent's legal pose, so nothing is left displaced from its joint. Ball joints keep their
   * animated rotation. The pelvis takes the rig's world transform as it is.
   */
  private seedPose(): { pos: Vector3[]; quat: Quaternion[] } {
    const pos = ORDER.map(() => new Vector3());
    const quat = ORDER.map(() => new Quaternion());
    this.joints[0]!.getWorldPosition(pos[0]!);
    this.joints[0]!.getWorldQuaternion(quat[0]!);
    for (let i = 1; i < ORDER.length; i++) {
      const name = ORDER[i]!;
      const parent = PARENT[name];
      const local = _q.copy(this.joints[i]!.quaternion);
      const lim = HINGE_LIMITS[name];
      if (lim) {
        if (local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w); // (the same rotation, the short way round)
        const angle = 2 * Math.atan2(local.x, local.w); // swing about X (the twist and bank a torso or head carries are dropped: a hinge has neither)
        const wrapped = angle;
        local.setFromAxisAngle(_axisX, Math.max(lim[0], Math.min(lim[1], wrapped)));
      }
      quat[i]!.copy(quat[parent]!).multiply(local);
      pos[i]!.copy(this.joints[i]!.position).applyQuaternion(quat[parent]!).add(pos[parent]!);
    }
    return { pos, quat };
  }

  /** Copies body transforms into `worldQ` / `pelvisPos`. */
  private readBodies(): void {
    if (this.bodies.length === 0) return; // freed after the snapshot: keep the last known transforms
    for (let i = 0; i < this.bodies.length; i++) {
      const r = this.bodies[i]!.rotation();
      this.worldQ[i]!.set(r.x, r.y, r.z, r.w);
    }
    const t = this.bodies[0]!.translation();
    this.pelvisPos.set(t.x, t.y, t.z);
  }

  /** Tells the ragdoll where the (server-authoritative) player actually is. Call every frame. */
  setAnchor(x: number, z: number): void {
    this.anchorX = x;
    this.anchorZ = z;
    this.hasAnchor = true;
  }

  /** Called by the world after every fixed step: ages the fall and decides when it has settled (or run too long). */
  afterStep(): void {
    if (this.phase !== "sim") return;
    const dt = RAGDOLL.fixedDt;
    this.age += dt;
    if (this.hasAnchor) this.tether(dt);
    let fastest = 0;
    for (const b of this.bodies) {
      const v = b.linvel();
      fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z));
    }
    this.calm = fastest < RAGDOLL.settleSpeed ? this.calm + dt : 0;
    if (this.age >= RAGDOLL.maxSimSeconds || (this.age >= RAGDOLL.minSimSeconds && this.calm >= RAGDOLL.settleSeconds)) this.beginBlend();
  }

  /** A soft spring: past the tether radius, every body is pulled toward the anchor in proportion to how far out it is. */
  private tether(dt: number): void {
    const p = this.bodies[0]!.translation();
    const dx = this.anchorX - p.x;
    const dz = this.anchorZ - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= RAGDOLL.tetherRadius) return;
    const pull = (d - RAGDOLL.tetherRadius) * RAGDOLL.tetherStrength * dt;
    for (const b of this.bodies) {
      const m = b.mass();
      b.applyImpulse({ x: (dx / d) * pull * m, y: 0, z: (dz / d) * pull * m }, true);
    }
  }

  /**
   * Call once per frame AFTER the animator has posed the rig and the actor has placed the root. In the simulated phase this
   * overrides the pose with the physics bodies; in the blend phase it mixes the physics snapshot into the animated pose.
   */
  applyPose(dt: number): void {
    if (this.phase === "sim") {
      this.readBodies();
      this.root.position.set(0, 0, 0);
      this.root.rotation.set(0, 0, 0);
      this.writeWorldPose(this.worldQ, this.pelvisPos);
      this.dangleWrists(dt);
      return;
    }
    if (this.phase !== "blend") return;
    this.blendT = Math.min(1, this.blendT + dt / RAGDOLL.blendSeconds);
    const k = this.blendT * this.blendT * (3 - 2 * this.blendT); // smoothstep
    // World orientation of every joint and the pelvis position, as the animator just posed them.
    this.root.updateMatrixWorld(true);
    const qs = this.worldQ;
    for (let i = 0; i < ORDER.length; i++) {
      this.joints[i]!.getWorldQuaternion(_q);
      qs[i]!.copy(this.snapQ[i]!).slerp(_q, k);
    }
    this.joints[0]!.getWorldPosition(_v);
    this.pelvisPos.copy(this.snapPelvis).lerp(_v, k);
    this.writeWorldPose(qs, this.pelvisPos);
    // the wrists ease from the dangle they ended the fall with into the animator's wrist (what is in the joint right now)
    for (let i = 0; i < 2; i++) {
      const w = this.wristJoints[i]!;
      _qa.copy(w.quaternion);
      w.quaternion.copy(this.wristSnap[i]!).slerp(_qa, k);
    }
    if (this.blendT >= 1) this.finish();
  }

  /** While simulating: each hand hangs from its forearm, pointing as far toward the ground as the wrist allows (see WRIST_DANGLE). */
  private dangleWrists(dt: number): void {
    const rate = 1 - Math.exp(-WRIST_EASE * dt);
    for (let i = 0; i < 2; i++) {
      const fore = this.worldQ[INDEX[WRIST_BONES[i]!]]!;
      // gravity in the forearm's frame; the hand's fingers point along -Y there
      _v.copy(_down).applyQuaternion(_q.copy(fore).invert());
      const cos = Math.max(-1, Math.min(1, _v.dot(_fingers)));
      const angle = Math.acos(cos);
      _q2.setFromUnitVectors(_fingers, _v);
      if (angle > WRIST_DANGLE) _q2.set(_q2.x * Math.sin(WRIST_DANGLE / 2) / Math.sin(angle / 2), _q2.y * Math.sin(WRIST_DANGLE / 2) / Math.sin(angle / 2), _q2.z * Math.sin(WRIST_DANGLE / 2) / Math.sin(angle / 2), Math.cos(WRIST_DANGLE / 2)); // (the same turn, cut short at the limit)
      this.wristQ[i]!.slerp(_q2, rate);
      this.wristJoints[i]!.quaternion.copy(this.wristQ[i]!);
    }
  }

  /** Stop simulating and ease back into the animated pose (also used when a teammate revives the body mid-fall). */
  beginBlend(): void {
    if (this.phase !== "sim") return;
    this.readBodies();
    for (let i = 0; i < ORDER.length; i++) this.snapQ[i]!.copy(this.worldQ[i]!);
    for (let i = 0; i < 2; i++) this.wristSnap[i]!.copy(this.wristQ[i]!);
    this.snapPelvis.copy(this.pelvisPos);
    this.phase = "blend";
    this.blendT = 0;
    this.freeBodies(); // the snapshot is all the blend needs
  }

  /**
   * Writes joint transforms so each joint's WORLD orientation equals `qs[i]` and the pelvis sits at `pelvis` (world).
   * Joint positions are left at their rest offsets: the physics joints keep the bodies together, so the rig stays intact.
   */
  private writeWorldPose(qs: Quaternion[], pelvis: Vector3): void {
    this.root.getWorldQuaternion(_q2).invert();
    _v2.copy(pelvis).sub(this.root.position).applyQuaternion(_q2);
    this.joints[0]!.position.copy(_v2);
    for (let i = 0; i < ORDER.length; i++) {
      const parent = PARENT[ORDER[i]!];
      const parentQ = parent < 0 ? this.root.quaternion : qs[parent]!;
      _q.copy(parentQ).invert().multiply(qs[i]!);
      this.joints[i]!.quaternion.copy(_q);
    }
  }

  private freeBodies(): void {
    for (const b of this.bodies) this.world.removeRigidBody(b);
    this.bodies.length = 0;
  }

  private finish(): void {
    this.phase = "done";
    this.onDone();
  }

  dispose(): void {
    this.freeBodies();
    if (this.phase !== "done") {
      this.phase = "done";
      this.onDone();
    }
  }

  /** Lowest point of any body (diagnostics and tests). */
  get lowestY(): number {
    let y = Infinity;
    for (const b of this.bodies) y = Math.min(y, b.translation().y);
    return y;
  }

  get pelvis(): Vector3 {
    this.readBodies();
    return this.pelvisPos;
  }

  get bodyCount(): number {
    return this.bodies.length;
  }

  /** Relative angle (radians) of a hinge child about X, for limit tests. */
  hingeAngle(child: BoneName): number {
    const p = this.bodies[PARENT[child]]!.rotation();
    const c = this.bodies[INDEX[child]]!.rotation();
    _q.set(p.x, p.y, p.z, p.w).invert().multiply(_q2.set(c.x, c.y, c.z, c.w));
    if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w); // shortest way round, so the angle lies in (-pi, pi)
    return 2 * Math.atan2(_q.x, _q.w);
  }
}
