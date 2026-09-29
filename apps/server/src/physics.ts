import {
  CHARACTER,
  INTERACT,
  LAYER,
  PROP_DEFS,
  type CollisionWorld,
  type PropKindId,
  type PropSpawn,
} from "@cb/shared";
import { RAPIER, buildStaticWorld, collisionGroups as groups, initRapier, yawQuat } from "@cb/physics";

export { initRapier, yawQuat };

const G = {
  // Static world geometry is created by buildStaticWorld (shared with the client's ragdoll world).
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
    buildStaticWorld(this.world, this.terrainWorld);
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

export type { PropKindId };
