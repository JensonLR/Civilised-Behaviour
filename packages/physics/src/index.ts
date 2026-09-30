import RAPIER from "@dimforge/rapier3d-compat";
import { LAYER, type CollisionWorld } from "@cb/shared";

export { RAPIER };

let rapierReady: Promise<void> | undefined;
/** Rapier's WASM is initialised once per process (Node server) or page (browser client). */
export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/** Collision group helper: Rapier packs membership (high 16) and filter (low 16) bits. */
export const collisionGroups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

/** Quaternion for a rotation of `yaw` radians about +Y. */
export function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Static world geometry belongs to the WORLD layer and is visible to props, ragdolls and player capsules. */
export const WORLD_GROUPS = collisionGroups(LAYER.WORLD, LAYER.PROP | LAYER.RAGDOLL | LAYER.PLAYER);

/** Metres between heightfield samples. */
export const HEIGHTFIELD_STEP = 1;

/**
 * Builds the static colliders (terrain heightfield + every obstacle) that mirror the analytic CollisionWorld the
 * character controller uses. Server and client build the SAME geometry from the same shared description, so a ragdoll
 * that lands on the client agrees with where the server thinks the ground is.
 */
export function buildStaticWorld(world: RAPIER.World, terrainWorld: CollisionWorld): RAPIER.Collider[] {
  const made: RAPIER.Collider[] = [];
  const r = terrainWorld.boundsRadius;
  const n = Math.floor((2 * r) / HEIGHTFIELD_STEP) + 1; // samples per side
  // Rapier heightfield: nrows x ncols, column-major, scale = full extent in x/z and a y multiplier.
  const heights = new Float32Array(n * n);
  for (let col = 0; col < n; col++) {
    for (let row = 0; row < n; row++) {
      const x = -r + col * HEIGHTFIELD_STEP;
      const z = -r + row * HEIGHTFIELD_STEP;
      heights[col * n + row] = terrainWorld.terrainHeight(x, z);
    }
  }
  made.push(world.createCollider(RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: 2 * r, y: 1, z: 2 * r }).setCollisionGroups(WORLD_GROUPS)));

  for (const o of terrainWorld.obstacles) {
    const hy = (o.y1 - o.y0) / 2;
    const cy = (o.y0 + o.y1) / 2;
    const desc =
      o.kind === "circle"
        ? RAPIER.ColliderDesc.cylinder(hy, o.r).setTranslation(o.x, cy, o.z)
        : RAPIER.ColliderDesc.cuboid(o.hx, hy, o.hz).setTranslation(o.x, cy, o.z).setRotation(yawQuat(-o.yaw));
    made.push(world.createCollider(desc.setCollisionGroups(WORLD_GROUPS)));
  }
  return made;
}
