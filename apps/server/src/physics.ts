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
  // A shot's ray sees free props and nothing else (held props are in a group with a WORLD-only filter, so they are skipped).
  RAY_PROPS: groups(LAYER.PROP, LAYER.PROP),
} as const;

/** A ray's first prop: which one, how far, and the surface normal there. */
export interface PropRayHit {
  id: string;
  t: number;
  nx: number;
  ny: number;
  nz: number;
}

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
  /** Collider handle -> prop id, so a ray can name what it hit. */
  private readonly propOfCollider = new Map<number, string>();

  private statics: RAPIER.Collider[] = [];

  constructor(terrainWorld: CollisionWorld) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.statics = buildStaticWorld(this.world, terrainWorld);
  }

  /** Swaps the static geometry in place (a bridge fell): props and player capsules stay, the old terrain and obstacles go. */
  replaceStatic(terrainWorld: CollisionWorld): void {
    for (const c of this.statics) this.world.removeCollider(c, true);
    this.statics = buildStaticWorld(this.world, terrainWorld);
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
    this.propOfCollider.set(collider.handle, id);
    return pb;
  }

  removeProp(id: string): void {
    const p = this.props.get(id);
    if (!p) return;
    this.propOfCollider.delete(p.collider.handle);
    this.world.removeRigidBody(p.body);
    this.props.delete(id);
  }

  /**
   * First free (not carried) prop along a ray of unit direction, within `maxT` metres. Static geometry and people are ignored: the
   * caller compares against the analytic world and the players' zones itself. Allocates a little (Rapier's ray object); it is called
   * once per shot or projectile segment, never per frame.
   */
  raycastProp(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: PropRayHit): boolean {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRayAndGetNormal(ray, maxT, true, undefined, G.RAY_PROPS);
    if (!hit) return false;
    const id = this.propOfCollider.get(hit.collider.handle);
    if (id === undefined) return false;
    out.id = id;
    out.t = hit.timeOfImpact;
    out.nx = hit.normal.x;
    out.ny = hit.normal.y;
    out.nz = hit.normal.z;
    return true;
  }

  /**
   * Shoves a prop: `dvMax`-limited change of velocity (m/s) along (dx,dy,dz) (unit), applied at a point so it also spins. The impulse is
   * scaled by the body's mass, so a bullet nudges a barrel and a cannon ball sends it flying, but nothing leaves the map.
   */
  shoveProp(id: string, dx: number, dy: number, dz: number, impulse: number, px: number, py: number, pz: number, maxSpeed: number): void {
    const p = this.props.get(id);
    if (!p || p.holder !== "" || !(impulse > 0)) return;
    // (callers lift the direction a little - dy + 0.5 for a blast - which makes it longer than a unit vector: normalise, or a light prop leaves 12% over the cap)
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-6)) return;
    const mass = p.body.mass();
    const dv = Math.min(maxSpeed, impulse / Math.max(mass, 0.05));
    const j = (dv * mass) / len;
    p.body.applyImpulseAtPoint({ x: dx * j, y: dy * j, z: dz * j }, { x: px, y: py, z: pz }, true);
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
