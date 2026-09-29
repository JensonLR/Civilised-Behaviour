import type { Obstacle } from "./collision.ts";
import type { Terrain } from "./terrain.ts";

/**
 * The Society's expedition camp at the spawn, as authored data. The SAME numbers make the collision (createArena), the
 * visuals (client landmarks) and the keep-out for props and players (scatterProps), so the tent you see is the tent you
 * bump into and nothing ever spawns inside a bell tent. All positions are in the flat spawn clearing (radius 14).
 * Yaw convention is the collision one: local +x = (cos yaw, sin yaw) in (x, z); three.js rotation.y = -yaw.
 */
export const CAMP = {
  /** Two elliptical bell tents west of the spawn, doors (local +x end) facing the fire. */
  tents: [
    { x: -8, z: 3, yaw: 0.28 },
    { x: -8.4, z: -4, yaw: -0.2 },
  ],
  tentHalf: { hx: 2, hz: 1.6, height: 2.4 },
  fire: { x: 7, z: -4, r: 0.6, height: 0.45 },
  flag: { x: 2.6, z: -8.4, r: 0.16, height: 6.4 },
  sign: { x: 10.4, z: 0.4, r: 0.18, height: 2.8 },
  luggage: { x: -4.6, z: 8.9, hx: 0.95, hz: 0.55, yaw: 0.5, height: 1.4 },
  cart: { x: 9.6, z: 7.4, hx: 1.45, hz: 0.95, yaw: -0.6, height: 2.0 },
  /** The old authored step-up crates. */
  crates: [
    { x: 4, z: 6, half: 0.6, yaw: 0.3, height: 0.45 },
    { x: 5.2, z: 6.4, half: 0.6, yaw: -0.2, height: 0.9 },
  ],
  /** The ruined wall north of the camp. */
  wall: { x: 0, z: -12, hx: 6, hz: 0.4, height: 2.2 },
} as const;

/** The camp's collidable landmarks (tagged so the renderer knows what each one is). Deterministic, allocation only at build time. */
export function campObstacles(terrain: Terrain): Obstacle[] {
  const out: Obstacle[] = [];
  const ground = (x: number, z: number): number => terrain.height(x, z);
  const w = CAMP.wall;
  out.push({ kind: "box", tag: "wall", x: w.x, z: w.z, hx: w.hx, hz: w.hz, yaw: 0, y0: ground(w.x, w.z) - 1, y1: ground(w.x, w.z) + w.height });
  for (const c of CAMP.crates) {
    const y = ground(c.x, c.z);
    out.push({ kind: "box", tag: "crate", x: c.x, z: c.z, hx: c.half, hz: c.half, yaw: c.yaw, y0: y - 0.5, y1: y + c.height });
  }
  const th = CAMP.tentHalf;
  for (const t of CAMP.tents) {
    const y = ground(t.x, t.z);
    out.push({ kind: "box", tag: "tent", x: t.x, z: t.z, hx: th.hx, hz: th.hz, yaw: t.yaw, y0: y - 0.5, y1: y + th.height });
  }
  const f = CAMP.fire;
  out.push({ kind: "circle", tag: "fire", x: f.x, z: f.z, r: f.r, y0: ground(f.x, f.z) - 0.5, y1: ground(f.x, f.z) + f.height });
  const fl = CAMP.flag;
  out.push({ kind: "circle", tag: "flag", x: fl.x, z: fl.z, r: fl.r, y0: ground(fl.x, fl.z) - 1, y1: ground(fl.x, fl.z) + fl.height });
  const sg = CAMP.sign;
  out.push({ kind: "circle", tag: "sign", x: sg.x, z: sg.z, r: sg.r, y0: ground(sg.x, sg.z) - 1, y1: ground(sg.x, sg.z) + sg.height });
  const lg = CAMP.luggage;
  out.push({ kind: "box", tag: "luggage", x: lg.x, z: lg.z, hx: lg.hx, hz: lg.hz, yaw: lg.yaw, y0: ground(lg.x, lg.z) - 0.5, y1: ground(lg.x, lg.z) + lg.height });
  const ct = CAMP.cart;
  out.push({ kind: "box", tag: "cart", x: ct.x, z: ct.z, hx: ct.hx, hz: ct.hz, yaw: ct.yaw, y0: ground(ct.x, ct.z) - 0.5, y1: ground(ct.x, ct.z) + ct.height });
  return out;
}

/** True if (x, z) is inside (or within `margin` metres of) any obstacle footprint. */
export function insideObstacle(o: Obstacle, x: number, z: number, margin: number): boolean {
  const dx = x - o.x;
  const dz = z - o.z;
  if (o.kind === "circle") return dx * dx + dz * dz <= (o.r + margin) * (o.r + margin);
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return Math.abs(dx * c + dz * s) <= o.hx + margin && Math.abs(-dx * s + dz * c) <= o.hz + margin;
}

let cachedCamp: Obstacle[] | undefined;
const flatTerrain: Terrain = { height: () => 0 };

/** Keep-out test for anything that spawns on the ground near the camp (props, players): heights do not matter, footprints do. */
export function inCampFootprint(x: number, z: number, margin: number): boolean {
  cachedCamp ??= campObstacles(flatTerrain);
  for (const o of cachedCamp) if (insideObstacle(o, x, z, margin)) return true;
  return false;
}
