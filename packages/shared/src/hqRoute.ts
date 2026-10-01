import type { Obstacle } from "./collision.ts";
import { ROUTE_TEXT } from "./hqRouteText.ts";
import { JETTY } from "./landscape.ts";
import type { Terrain } from "./terrain.ts";

/**
 * The way round HQ (D-035, R: the first-run player should never wonder where the boat or the map is). Two authored walking lines and the finger-posts that stand beside them:
 *   `map`  from the apron of the marquee's mouth, round the flagpole and in at the marquee's open south side to the survey table;
 *   `dock` from the camp's fire, up the footbridge path, through the village's main street and down the ferry lane to the jetty.
 * Both lines are walked by the REAL step in the tests (hqRoute.test.ts); the posts stand at least `ROUTE_CLEAR` metres off them, are solid (tag `fingerpost`) and are
 * appended LAST to Hollowmere's obstacle list so no tree, rock or prop has moved because of them. Pure and deterministic: no seed, no clock.
 */

export interface Pt {
  x: number;
  z: number;
}

export interface HqBoard {
  text: string;
  /** World direction the board points, collision convention (the direction (cos yaw, sin yaw) in x/z). */
  yaw: number;
  /** Height of the board's centre above the ground, and its length from the post to the tip. */
  y: number;
  len: number;
}

export interface HqSign {
  id: string;
  route: "map" | "dock";
  x: number;
  z: number;
  /** Solid radius and the height of the post. */
  r: number;
  height: number;
  boards: HqBoard[];
}

export interface HqRoute {
  dock: Pt[];
  map: Pt[];
  signs: HqSign[];
}

/** A post stands at least this far from the walking line (centre to line). */
export const ROUTE_CLEAR = 1.2;
const POST_R = 0.12;
const POST_H = 2.6;

const DOCK: readonly Pt[] = [
  { x: 4.5, z: -3.5 }, { x: 7, z: -10.5 }, { x: 11.5, z: -14.5 }, { x: 11.5, z: -19.5 }, { x: 11.4, z: -25 }, { x: 12.2, z: -38.6 }, { x: 8.5, z: -42.2 }, { x: 3, z: -45.4 },
  { x: -3, z: -47.9 }, { x: -9, z: -50 }, { x: -15, z: -51.4 }, { x: -21, z: -51.8 }, { x: -23.1, z: -47.4 }, { x: -22.9, z: -44.6 }, { x: -22.9, z: -42.4 },
];
const MAP: readonly Pt[] = [{ x: 1.5, z: -7.5 }, { x: 3.5, z: -6.5 }, { x: 0.5, z: -4.5 }, { x: -0.5, z: -6.5 }];

/** Where along a line (metres from its start) each post stands, which side of it (+1 = left of the way on), and how far off. */
const DOCK_POSTS: readonly { at: number; side: 1 | -1; off: number }[] = [
  { at: 4, side: -1, off: 1.9 },
  { at: 27, side: -1, off: 1.9 },
  { at: 52, side: -1, off: 2.2 },
  { at: 78, side: 1, off: 2.1 },
];
const MAP_POSTS: readonly { at: number; side: 1 | -1; off: number }[] = [
  { at: 4.5, side: 1, off: 2 },
  { at: 7, side: 1, off: 2 },
];

const lengthOf = (pts: readonly Pt[]): number => {
  let l = 0;
  for (let i = 0; i + 1 < pts.length; i++) l += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.z - pts[i]!.z);
  return l;
};

/** The point `s` metres along the line and the unit direction of the walk there. */
function along(pts: readonly Pt[], s: number): { x: number; z: number; dx: number; dz: number } {
  let left = Math.max(0, s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= l || i + 2 === pts.length) {
      const t = l > 0 ? Math.min(1, left / l) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / (l || 1), dz: (b.z - a.z) / (l || 1) };
    }
    left -= l;
  }
  const e = pts[pts.length - 1]!;
  return { x: e.x, z: e.z, dx: 0, dz: -1 };
}

const metres = (m: number): string => String(Math.max(5, Math.round(m / 5) * 5));
const fill = (t: string, m: number): string => t.replace("{m}", metres(m));

function post(
  pts: readonly Pt[],
  route: "map" | "dock",
  i: number,
  spec: { at: number; side: 1 | -1; off: number },
  ahead: readonly string[],
  back: readonly string[],
  aside: readonly string[],
): HqSign {
  const total = lengthOf(pts);
  const p = along(pts, spec.at);
  // the left of the way on, in x/z, is (dz, -dx) (z grows toward the viewer: the walk's left-hand side)
  const nx = p.dz * spec.side;
  const nz = -p.dx * spec.side;
  const yawFwd = Math.atan2(p.dz, p.dx);
  const toGo = total - spec.at;
  return {
    id: `${route}-${i}`,
    route,
    x: p.x + nx * spec.off,
    z: p.z + nz * spec.off,
    r: POST_R,
    height: POST_H,
    boards: [
      { text: fill(ahead[i % ahead.length]!, route === "dock" ? toGo : 0), yaw: yawFwd, y: 2.3, len: 1.9 },
      { text: fill(back[i % back.length]!, spec.at), yaw: yawFwd + Math.PI, y: 1.9, len: 1.7 },
      // the Society's advice points across the way, toward the walker: it is meant to be read in passing
      { text: aside[i % aside.length]!, yaw: yawFwd - spec.side * (Math.PI / 2) + 0.2 * spec.side, y: 1.5, len: 2.1 },
    ],
  };
}

let cached: HqRoute | undefined;
export function hqRoute(): HqRoute {
  if (cached) return cached;
  const signs: HqSign[] = [];
  DOCK_POSTS.forEach((s, i) => signs.push(post(DOCK, "dock", i, s, ROUTE_TEXT.dockAhead, ROUTE_TEXT.dockBack, ROUTE_TEXT.dockAside)));
  MAP_POSTS.forEach((s, i) => signs.push(post(MAP, "map", i, s, ROUTE_TEXT.mapAhead, ROUTE_TEXT.mapBack, ROUTE_TEXT.mapAside)));
  cached = { dock: DOCK.map((p) => ({ ...p })), map: MAP.map((p) => ({ ...p })), signs };
  return cached;
}

/** The posts' collision: one thin solid each, appended last to Hollowmere's obstacle list (arena.ts). */
export function hqRouteObstacles(terrain: Terrain): Obstacle[] {
  const out: Obstacle[] = [];
  for (const s of hqRoute().signs) {
    const g = terrain.height(s.x, s.z);
    out.push({ kind: "circle", tag: "fingerpost", x: s.x, z: s.z, r: s.r, y0: g - 1, y1: g + s.height });
  }
  return out;
}

/** Places the compass pins: the survey table (the map room) and the dock (the boat), from the same authored numbers the stations use. */
export function hqPins(table: Pt): { id: string; label: string; x: number; z: number }[] {
  return [
    { id: "map", label: "Map room", x: table.x, z: table.z },
    { id: "dock", label: "Dock", x: JETTY.x0, z: JETTY.z0 },
  ];
}
