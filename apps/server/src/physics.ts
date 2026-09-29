import RAPIER from "@dimforge/rapier3d-compat";
import {
  CHARACTER,
  INTERACT,
  LAYER,
  PROP_DEFS,
  type CollisionWorld,
  type PropKindId,
  type PropSpawn,
} from "@cb/shared";

let rapierReady: Promise<void> | undefined;
/** Rapier's WASM is initialised once per process. */
export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/** Collision group helper: Rapier packs membership (high 16) and filter (low 16) bits. */
const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

const G = {
  WORLD: groups(LAYER.WORLD, LAYER.PROP | LAYER.RAGDOLL | LAYER.PLAYER),
  PROP: groups(LAYER.PROP, LAYER.WORLD | LAYER.PROP | LAYER.PLAYER),
  // Players are kinematic pushers: they collide with props only (players never collide with each other here).
  PLAYER: groups(LAYER.PLAYER, LAYER.PROP),
  // Held props ignore players (they'd otherwise fight the holder) but still hit the world.
  HELD: groups(LAYER.PROP, LAYER.WORLD),
} as const;

export interface PropBody {
  id: string;
  kind: PropKindId;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  holder: string;
}

const HEIGHTFIELD_STEP = 1; // metres between height samples

/**
 * Server-side dynamic world: props (crates, barrels, bottles...), player push-capsules and, later,
 * ragdolls/debris. Static geometry mirrors the analytic CollisionWorld the character controller uses.
 * Bodies are capped (INTERACT.maxPropsPerRoom) and sleep when at rest, so an idle room costs ~nothing.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly props = new Map<string, PropBody>();
  private readonly players = new Map<string, RAPIER.RigidBody>();
  private nextPropId = 1;

  constructor(private readonly terrainWorld: CollisionWorld) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.buildStatic();
  }

  private buildStatic(): void {
    const r = this.terrainWorld.boundsRadius;
    const n = Math.floor((2 * r) / HEIGHTFIELD_STEP) + 1; // samples per side
    // Rapier heightfield: nrows x ncols, column-major, scale = full extent in x/z and a y multiplier.
    const heights = new Float32Array(n * n);
    for (let col = 0; col < n; col++) {
      for (let row = 0; row < n; row++) {
        const x = -r + col * HEIGHTFIELD_STEP;
        const z = -r + row * HEIGHTFIELD_STEP;
        heights[col * n + row] = this.terrainWorld.terrainHeight(x, z);
      }
    }
    const hf = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: 2 * r, y: 1, z: 2 * r }).setCollisionGroups(G.WORLD);
    this.world.createCollider(hf);

    for (const o of this.terrainWorld.obstacles) {
      const hy = (o.y1 - o.y0) / 2;
      const cy = (o.y0 + o.y1) / 2;
      const desc =
        o.kind === "circle"
          ? RAPIER.ColliderDesc.cylinder(hy, o.r).setTranslation(o.x, cy, o.z)
          : RAPIER.ColliderDesc.cuboid(o.hx, hy, o.hz).setTranslation(o.x, cy, o.z).setRotation(yawQuat(-o.yaw));
      this.world.createCollider(desc.setCollisionGroups(G.WORLD));
    }
  }

  get propCount(): number {
    return this.props.size;
  }

  spawnProp(spawn: PropSpawn, y: number): PropBody | undefined {
    if (this.props.size >= INTERACT.maxPropsPerRoom) return undefined;
    const def = PROP_DEFS[spawn.kind];
    const id = String(this.nextPropId++);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, y + def.half[1] + 0.05, spawn.z)
        .setRotation(yawQuat(spawn.yaw))
        .setLinearDamping(0.15)
        .setAngularDamping(0.6)
        .setCanSleep(true),
    );
    const shape =
      def.shape === "box"
        ? RAPIER.ColliderDesc.cuboid(def.half[0], def.half[1], def.half[2] || def.half[0])
        : def.shape === "cylinder"
          ? RAPIER.ColliderDesc.cylinder(def.half[1], def.half[0])
          : RAPIER.ColliderDesc.capsule(def.half[1], def.half[0]);
    const collider = this.world.createCollider(
      shape.setMass(def.mass).setFriction(0.8).setRestitution(def.shape === "capsule" ? 0.35 : 0.1).setCollisionGroups(G.PROP),
      body,
    );
    const pb: PropBody = { id, kind: spawn.kind, body, collider, holder: "" };
    this.props.set(id, pb);
    return pb;
  }

  removeProp(id: string): void {
    const p = this.props.get(id);
    if (!p) return;
    this.world.removeRigidBody(p.body);
    this.props.delete(id);
  }

  /** Adds/updates the kinematic capsule that lets a player shove props around. */
  syncPlayer(sessionId: string, x: number, y: number, z: number, crouching: boolean): void {
    const h = crouching ? CHARACTER.crouchHeight : CHARACTER.height;
    let body = this.players.get(sessionId);
    if (!body) {
      body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + h / 2, z));
      this.world.createCollider(
        RAPIER.ColliderDesc.capsule(Math.max(h / 2 - CHARACTER.radius, 0.05), CHARACTER.radius).setCollisionGroups(G.PLAYER),
        body,
      );
      this.players.set(sessionId, body);
    }
    body.setNextKinematicTranslation({ x, y: y + h / 2, z });
  }

  removePlayer(sessionId: string): void {
    const b = this.players.get(sessionId);
    if (b) this.world.removeRigidBody(b);
    this.players.delete(sessionId);
  }

  /** Attach a prop to a holder: kinematic, ignoring player collisions, positioned by moveHeld(). */
  hold(id: string, holder: string): boolean {
    const p = this.props.get(id);
    if (!p || p.holder !== "") return false;
    p.holder = holder;
    p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    p.collider.setCollisionGroups(G.HELD);
    return true;
  }

  moveHeld(id: string, x: number, y: number, z: number, yaw: number): void {
    const p = this.props.get(id);
    if (!p || p.holder === "") return;
    p.body.setNextKinematicTranslation({ x, y, z });
    p.body.setNextKinematicRotation(yawQuat(yaw));
  }

  /** Releases a held prop with a velocity (player's own velocity + optional throw impulse). */
  release(id: string, vx: number, vy: number, vz: number): void {
    const p = this.props.get(id);
    if (!p || p.holder === "") return;
    p.holder = "";
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    p.collider.setCollisionGroups(G.PROP);
    p.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    p.body.setAngvel({ x: (vz - vx) * 0.3, y: 0, z: (vx - vz) * 0.3 }, true);
    p.body.wakeUp();
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  dispose(): void {
    this.world.free();
    this.props.clear();
    this.players.clear();
  }
}

/** Quaternion for a rotation of `yaw` radians about +Y. */
export function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export type { PropKindId };
