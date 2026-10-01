import { insideObstacle } from "./camp.ts";
import type { Obstacle } from "./collision.ts";
import { JETTY, MILL, RIVER, WEIR, riverCentre, riverHalfWidth, type LandscapeTerrain } from "./landscape.ts";
import { hashFloat } from "./rng.ts";
import type { Terrain } from "./terrain.ts";
import type { AuditDoor } from "./levelAudit.ts";
import { levelOf, planBuilding, type LevelBuilding, type RegionLevel } from "./levelPlan.ts";

/**
 * HOLLOWMERE: the local society's village, a hill-and-river community with its own architecture and manners. ONE authored plan feeds the
 * collision (`villageObstacles`, added to `createArena`), the client's geometry (`world/village.ts`), the terrain pads that flatten the
 * ground under it (`VILLAGE_PADS`), the keep-outs for trees, rocks and ground cover (`villageKeepOut`), the lanterns that glow at dusk, the
 * chimney smoke and the signboards. So the door you see is a door you can walk through, and the wall beside it is a wall.
 *
 * The architecture (their own, not anybody's): lime-washed walls over river-stone footings, dark framing, roofs of scaled shingle or clay
 * tile, indigo doors and teal shutters; a granary with a round roof on mushroom stones; stilted river houses on the pond; a terraced hall
 * with tiers of roof; a gate-tower with a clock that is right twice a day; a watermill; market stalls under striped awnings. Nothing here
 * is a real nation's building. Pure and deterministic: no seed, no Math.random, no Date.now.
 *
 * Frames: a building's local +x is its FRONT (door side), local +z is to its right; world = (x + lx*cos - lz*sin, z + lx*sin + lz*cos) for its yaw
 * (the collision convention; three.js rotation.y = -yaw).
 */

export type BuildingKind = "cottage" | "stilt" | "granary" | "hall" | "workshop" | "mill" | "clock" | "stall";

export interface KindSpec {
  /** Half-depth (along the door axis) and half-width of the footprint. */
  hx: number;
  hz: number;
  /** Wall height above the floor and the width of the doorway (the door is centred on the front, +x). */
  wall: number;
  door: number;
  /** Floor level above the ground (a plinth; the stilt house's deck and the hall's terrace are higher). */
  floor: number;
}

export const KIND: Record<BuildingKind, KindSpec> = {
  // D-038: doors are a person's width (1.5 clear, 1.4 on a stilt house's 3.9 m front) and 2.4 high, so the walls are 2.8 (they were 1.15 / 0.95 wide and 2.45 / 2.35 high: a body with a hat could not use them)
  cottage: { hx: 2.4, hz: 2.05, wall: 2.8, door: 1.5, floor: 0.2 },
  stilt: { hx: 1.95, hz: 1.95, wall: 2.8, door: 1.4, floor: 1.2 },
  granary: { hx: 2.0, hz: 2.0, wall: 3.0, door: 0, floor: 0.6 },
  hall: { hx: 4.1, hz: 5.3, wall: 3.7, door: 2.4, floor: 0.9 },
  workshop: { hx: 2.7, hz: 3.2, wall: 2.7, door: 0, floor: 0.12 },
  mill: { hx: MILL.hx, hz: MILL.hz, wall: 3.6, door: 1.5, floor: 0.3 },
  clock: { hx: 1.9, hz: 1.4, wall: 10.4, door: 3.2, floor: 0 },
  stall: { hx: 1.1, hz: 1.6, wall: 2.3, door: 0, floor: 0 },
};

/** Height above the ground of the gate-tower's clock centre. */
export const GATE_CLOCK_Y = 6.1;

export interface Site {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  /** Collision-convention yaw of the front (+x). */
  yaw: number;
  hx: number;
  hz: number;
}

const toward = (x: number, z: number, px: number, pz: number): number => Math.atan2(pz - z, px - x);
function site(id: string, kind: BuildingKind, x: number, z: number, yaw: number): Site {
  return { id, kind, x, z, yaw, hx: KIND[kind].hx, hz: KIND[kind].hz };
}

/** Where everything stands. Fronts face the street, the plaza or the water; the mill's position comes from the stream. */
export const SITES: readonly Site[] = [
  site("gate", "clock", 3.0, -45.2, Math.atan2(-2.8, -5.9)),
  site("cot-a", "cottage", 5.6, -38.2, toward(5.6, -38.2, 6.1, -43.4)),
  site("mill", "mill", MILL.x, MILL.z, MILL.yaw),
  site("shop", "workshop", -6.0, -55.6, toward(-6.0, -55.6, -6.9, -49.4)),
  site("gran-a", "granary", -9.2, -45.9, toward(-9.2, -45.9, -9.6, -50.0)),
  site("stilt-w", "stilt", -28.4, -46.4, 0),
  site("stilt-e", "stilt", -14.6, -46.2, Math.PI),
  site("hall", "hall", -21, -65.6, Math.PI / 2),
  site("gran-b", "granary", -33.6, -56, toward(-33.6, -56, -32.2, -50.6)),
  site("cot-b", "cottage", -39.8, -51.8, toward(-39.8, -51.8, -36.4, -47.2)),
  site("cot-c", "cottage", -34.8, -31.6, toward(-34.8, -31.6, -40.2, -33)),
  site("stall-1", "stall", -28.2, -57.0, 0),
  site("stall-2", "stall", -28.2, -61.3, 0),
  site("stall-3", "stall", -13.8, -57.0, Math.PI),
  site("stall-4", "stall", -13.8, -61.3, Math.PI),
];

/** Local -> world for a frame (x, z, yaw). */
export function toWorld(f: { x: number; z: number; yaw: number }, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return { x: f.x + lx * c - lz * s, z: f.z + lx * s + lz * c };
}

// ---- terrain pads ---------------------------------------------------------------------------------------------------------------

/** A round patch of ground levelled to the height its centre had, blending out over `blend` metres: the village's floors sit on flat ground. */
export interface Pad {
  x: number;
  z: number;
  r: number;
  blend: number;
}

export const VILLAGE_PADS: readonly Pad[] = SITES.filter((s) => s.kind !== "clock" && s.kind !== "stall").map((s) => {
  // (the hall's pad is the whole plaza, so the market stalls stand on level ground too)
  const r = s.kind === "granary" ? 3.0 : Math.hypot(s.hx, s.hz) + (s.kind === "hall" ? 6.2 : s.kind === "stilt" ? 2.7 : 1.3);
  // (D-038: the plaza's pad blends out over 8 m, not 3.4: on seeds where the plaza stands 1.7 m above the stream bank the blend was a 1.2 slope, a wall to a walker)
  return { x: s.x, z: s.z, r, blend: s.kind === "hall" ? 8 : 3.4 };
});

// ---- the plan ---------------------------------------------------------------------------------------------------------------------

export type VPropKind = "well" | "cart" | "crate" | "barrel" | "sack" | "bale" | "rack" | "bench" | "post" | "woodpile" | "skep" | "scarecrow" | "trough" | "anvil" | "millstone" | "stone";

export interface VProp {
  kind: VPropKind;
  x: number;
  z: number;
  yaw: number;
  /** Size multiplier. */
  s: number;
  /** A small hashed integer for the renderer's variety. */
  v: number;
}

export interface Fence {
  x: number;
  z: number;
  hx: number;
  yaw: number;
}

export interface Garden {
  x: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  /** 0 cabbages, 1 bean poles, 2 gourds, 3 flowers, 4 herbs. */
  crop: number;
}

export interface Line {
  a: { x: number; z: number };
  b: { x: number; z: number };
  /** Height of the line above the ground. */
  h: number;
  /** How much washing hangs on it (deterministic variety). */
  v: number;
}

export interface Lantern {
  x: number;
  z: number;
  /** Height above the ground of the lamp (its centre). */
  y: number;
  /** 0 a hanging lamp; 1 a forge (orange glow, never quite out); 2 a candle in the shrine. */
  kind: 0 | 1 | 2;
  /** Direction the bracket arm points back to its wall (unit, x/z); 0,0 when it hangs from a post or from something overhead. */
  ax: number;
  az: number;
  /** 0 a bracket on a wall; 1 an arm on a lamp post (the post stands 0.34 m to the west of the lamp); 2 hangs free (from an awning, an arch). */
  mount: 0 | 1 | 2;
}

export interface Sign {
  /** Index into VILLAGE_SIGNS. */
  text: number;
  x: number;
  z: number;
  /** Height of the sign's centre above the ground. */
  y: number;
  /** Collision-convention yaw of the sign's face normal (the direction it faces). */
  yaw: number;
  w: number;
  h: number;
}

/** Lettering on the village's boards and awnings: what the Hollowmerers say to a visitor. Drawn at runtime in IM Fell (the atlas). */
export const VILLAGE_SIGNS = [
  "HOLLOWMERE",
  "PLEASE DO NOT IMPROVE",
  "THE MILL - flour by arrangement",
  "MARKET - Tuesdays (always)",
  "MEETING HALL - sit anywhere, agree with us",
  "SMITHY & FARRIER (& OPINIONS)",
  "FERRY - no charge for the unworldly",
  "THE CLOCK IS RIGHT TWICE A DAY",
  "GRANARY - keep the cat in",
  "FISH - yesterday's, cheaply",
  "PEARS - not for sale to surveyors",
  "TEA - no surveyors past this point",
] as const;

export interface SmokeVent {
  x: number;
  z: number;
  /** Height above the ground of the chimney top. */
  y: number;
}

export interface Building extends Site {
  /** Ground height at the centre (the pad's level) and the floor's height. */
  ground: number;
  floorY: number;
  spec: KindSpec;
  /** A stilt house's stair: the world height of each tread's top, from the porch outward (as many as the ground below needs, at 0.4 m a step). */
  steps: number[];
}

export interface VillagePlan {
  buildings: Building[];
  props: VProp[];
  fences: Fence[];
  gardens: Garden[];
  lines: Line[];
  lanterns: Lantern[];
  signs: Sign[];
  smoke: SmokeVent[];
  /** Stepping stones across the stream below the mill (world x/z/radius/yaw). */
  stones: { x: number; z: number; r: number; yaw: number }[];
  jetty: { x0: number; z0: number; x1: number; z1: number; width: number; yaw: number; length: number; deckY: number; waterY: number };
  /** The punt moored at the jetty (world x/z of its centre, heading, and the water level it floats on). */
  punt: { x: number; z: number; yaw: number; waterY: number };
  weir: { x: number; z: number; yaw: number; half: number; crestY: number; walkY: number };
  wheel: { x: number; y: number; z: number; r: number; nx: number; nz: number; axleLen: number };
  /** Where the cat sits by day (on the granary steps) and where it sleeps at night (the hall's porch). */
  cat: { x: number; z: number; yaw: number };
}

const V = (x: number, z: number, yaw = 0, s = 1, v = 0): { x: number; z: number; yaw: number; s: number; v: number } => ({ x, z, yaw, s, v });
const hf = (a: number, b: number, c = 0): number => hashFloat(0x8011, a, b, c);

/** Rectangular fence round a garden: sections ~2.4 m long, a gap of `gate` metres in the middle of side `gateSide` (0 +x, 1 +z, 2 -x, 3 -z). */
function rectFence(out: Fence[], cx: number, cz: number, yaw: number, hx: number, hz: number, gateSide: number, gate = 1.1): void {
  const sides: [number, number, number, number][] = [
    [hx, -hz, hx, hz], // +x
    [hx, hz, -hx, hz], // +z
    [-hx, hz, -hx, -hz], // -x
    [-hx, -hz, hx, -hz], // -z
  ];
  const f = { x: cx, z: cz, yaw };
  sides.forEach(([ax, az, bx, bz], i) => {
    const len = Math.hypot(bx - ax, bz - az);
    const legs: [number, number][] = i === gateSide ? [[0, 0.5 - gate / 2 / len], [0.5 + gate / 2 / len, 1]] : [[0, 1]];
    for (const [t0, t1] of legs) {
      const n = Math.max(1, Math.ceil(((t1 - t0) * len) / 2.4));
      for (let k = 0; k < n; k++) {
        const a = t0 + ((t1 - t0) * k) / n;
        const b = t0 + ((t1 - t0) * (k + 1)) / n;
        const mx = ax + (bx - ax) * ((a + b) / 2);
        const mz = az + (bz - az) * ((a + b) / 2);
        const w = toWorld(f, mx, mz);
        out.push({ x: w.x, z: w.z, hx: ((b - a) * len) / 2, yaw: yaw + Math.atan2(bz - az, bx - ax) });
      }
    }
  });
}

/** Tags a plan by terrain: heights are looked up here and nowhere else. */
const cache = new WeakMap<Terrain, VillagePlan>();

export function villagePlan(terrain: Terrain): VillagePlan {
  const hit = cache.get(terrain);
  if (hit) return hit;
  const g = (x: number, z: number): number => terrain.height(x, z);
  const buildings: Building[] = SITES.map((s) => {
    const spec = KIND[s.kind];
    const ground = g(s.x, s.z);
    const steps: number[] = [];
    if (s.kind === "stilt") {
      for (let i = 0; i < 6; i++) {
        const p = toWorld(s, s.hx + 1.2 + 0.25 + i * 0.5, 0);
        const top = ground + spec.floor - 0.4 * (i + 1);
        steps.push(top);
        if (top - g(p.x, p.z) <= 0.42) break;
      }
    }
    return { ...s, ground, floorY: ground + spec.floor, spec, steps };
  });
  const props: VProp[] = [];
  const fences: Fence[] = [];
  const gardens: Garden[] = [];
  const lines: Line[] = [];
  const lanterns: Lantern[] = [];
  const signs: Sign[] = [];
  const smoke: SmokeVent[] = [];
  const P = (kind: VPropKind, x: number, z: number, yaw = 0, s = 1): void => {
    props.push({ kind, x, z, yaw, s, v: Math.floor(hf(props.length, 7) * 1000) });
  };
  const L = (b: Site, lx: number, lz: number): { x: number; z: number } => toWorld(b, lx, lz);

  for (const b of buildings) {
    const k = b.spec;
    switch (b.kind) {
      case "cottage": {
        const lamp = L(b, b.hx + 0.28, k.door / 2 + 0.45);
        lanterns.push({ x: lamp.x, z: lamp.z, y: 2.05, kind: 0, ax: -Math.cos(b.yaw), az: -Math.sin(b.yaw), mount: 0 });
        const wp = L(b, 0.5, -b.hz - 0.62);
        P("woodpile", wp.x, wp.z, b.yaw, 1);
        if (b.id !== "cot-a") {
          // (the fisher's cottage has no garden: its back yard is where the weir's walkway lands)
          const gp = L(b, -b.hx - 3.5, 0);
          gardens.push({ x: gp.x, z: gp.z, yaw: b.yaw, hx: 2.6, hz: 3.3, crop: Math.floor(hf(b.x, b.z) * 5) });
          rectFence(fences, gp.x, gp.z, b.yaw, 2.6, 3.3, 3, 1.2);
        }
        const sk = L(b, -b.hx + 0.5, -b.hz - 1.5);
        P("skep", sk.x, sk.z, b.yaw, 1);
        const v = L(b, -b.hx * 0.4, 0.6);
        smoke.push({ x: v.x, z: v.z, y: k.floor + k.wall + 1.95 });
        const pa = L(b, 1.5, b.hz + 1.7);
        const pb = L(b, -1.7, b.hz + 1.7);
        lines.push({ a: pa, b: pb, h: 2.0, v: Math.floor(hf(b.x, b.z, 3) * 100) });
        P("post", pa.x, pa.z, b.yaw, 0.85);
        P("post", pb.x, pb.z, b.yaw, 0.85);
        break;
      }
      case "stilt": {
        const lamp = L(b, b.hx + 1.3, k.door / 2 + 0.4);
        lanterns.push({ x: lamp.x, z: lamp.z, y: k.floor + 2.0, kind: 0, ax: 0, az: 0, mount: 2 });
        const r1 = L(b, 0.5, b.hz + 1.9);
        P("rack", r1.x, r1.z, b.yaw + Math.PI / 2, 1);
        const br = L(b, 0.5, -b.hz - 0.85);
        P("barrel", br.x, br.z, 0, 1);
        const cr = L(b, -0.8, -b.hz - 0.8);
        P("crate", cr.x, cr.z, b.yaw + 0.3, 1);
        const v = L(b, -0.9, -0.6);
        smoke.push({ x: v.x, z: v.z, y: k.floor + k.wall + 1.7 });
        break;
      }
      case "granary": {
        const lamp = L(b, b.hx + 0.2, 1.1);
        lanterns.push({ x: lamp.x, z: lamp.z, y: 1.9, kind: 0, ax: -Math.cos(b.yaw), az: -Math.sin(b.yaw), mount: 0 });
        const b1 = L(b, b.hx + 1.0, -1.7);
        P("bale", b1.x, b1.z, 0, 1);
        const b2 = L(b, 0.2, b.hz + 1.2);
        P("bale", b2.x, b2.z, 0, 0.9);
        const b3 = L(b, -b.hx - 0.9, 0.8);
        P("barrel", b3.x, b3.z, 0, 1);
        P("barrel", L(b, -b.hx - 0.9, 1.5).x, L(b, -b.hx - 0.9, 1.5).z, 0, 1);
        break;
      }
      case "hall": {
        for (const s of [-1, 1]) {
          const lamp = L(b, b.hx + 0.2, s * (k.door / 2 + 0.3));
          lanterns.push({ x: lamp.x, z: lamp.z, y: 2.7, kind: 0, ax: -Math.cos(b.yaw), az: -Math.sin(b.yaw), mount: 0 });
        }
        const wp = L(b, -b.hx - 1.1, b.hz * 0.45);
        P("woodpile", wp.x, wp.z, b.yaw + Math.PI / 2, 1.1);
        const v = L(b, -1.4, -b.hz * 0.6);
        smoke.push({ x: v.x, z: v.z, y: k.floor + k.wall + 3.0 });
        break;
      }
      case "workshop": {
        const lamp = L(b, b.hx - 0.3, -b.hz + 0.35);
        lanterns.push({ x: lamp.x, z: lamp.z, y: 2.1, kind: 0, ax: -Math.cos(b.yaw), az: -Math.sin(b.yaw), mount: 0 });
        const forge = L(b, -b.hx + 0.85, -b.hz + 1.0);
        lanterns.push({ x: forge.x, z: forge.z, y: k.floor + 1.35, kind: 1, ax: 0, az: 0, mount: 2 });
        const an = L(b, 0.6, -0.9);
        P("anvil", an.x, an.z, b.yaw, 1);
        const tr = L(b, b.hx + 1.1, -b.hz + 0.7);
        P("trough", tr.x, tr.z, b.yaw + Math.PI / 2, 1);
        const b1 = L(b, b.hx + 0.9, b.hz + 0.6);
        P("barrel", b1.x, b1.z, 0, 1);
        const b2 = L(b, b.hx + 1.0, b.hz - 0.3);
        P("barrel", b2.x, b2.z, 0, 1);
        const wp = L(b, -0.4, b.hz + 0.9);
        P("woodpile", wp.x, wp.z, b.yaw, 1.15);
        const ch = L(b, -b.hx + 0.85, -b.hz + 1.0);
        smoke.push({ x: ch.x, z: ch.z, y: k.floor + 5.5 });
        break;
      }
      case "mill": {
        const lamp = L(b, b.hx + 0.25, k.door / 2 + 0.45);
        lanterns.push({ x: lamp.x, z: lamp.z, y: 2.3, kind: 0, ax: -Math.cos(b.yaw), az: -Math.sin(b.yaw), mount: 0 });
        for (let i = 0; i < 4; i++) {
          const s = L(b, b.hx + 0.8 + (i % 2) * 0.7, 1.4 + Math.floor(i / 2) * 0.7);   // (D-038: 0.7 m apart, on the right of the door and away from the cart: sacks 0.5 m apart sank into each other)
          P("sack", s.x, s.z, 0, 1);
        }
        const cart = L(b, b.hx + 2.6, -3.2);
        P("cart", cart.x, cart.z, b.yaw - 0.4, 1);
        const v = L(b, -0.6, 1.4);
        smoke.push({ x: v.x, z: v.z, y: k.floor + k.wall + 1.6 });
        break;
      }
      case "clock": {
        // the gate is a tower straddling the street; a shrine's candles burn in a niche of its south pier
        for (const s of [-1, 1]) {
          const lamp = L(b, 0, s * (k.door / 2 + 0.1));
          lanterns.push({ x: lamp.x, z: lamp.z, y: 2.9, kind: 0, ax: 0, az: 0, mount: 2 });
        }
        const niche = L(b, 0, -(k.door / 2 + 1.4 + 0.15));
        lanterns.push({ x: niche.x, z: niche.z, y: 1.15, kind: 2, ax: 0, az: 0, mount: 2 });
        break;
      }
      case "stall": {
        const lamp = L(b, b.hx - 0.15, 0);
        lanterns.push({ x: lamp.x, z: lamp.z, y: 2.05, kind: 0, ax: 0, az: 0, mount: 2 });
        for (const [lx, lz, kind] of [[-0.15, b.hz - 0.6, "crate"], [-0.6, -b.hz + 0.5, "barrel"], [-0.55, 0.15, "sack"]] as const) {
          const w = L(b, lx, lz);
          P(kind, w.x, w.z, b.yaw, 1);
        }
        break;
      }
    }
  }

  // ---- the street and the plaza ---------------------------------------------------------------------------------------------------
  // lantern posts along the way in, on alternate sides
  // (D-038: three posts stood inside a building or on the well and moved to the open street: (-8,-53.2) in the smithy, (-14,-47.5) in the east stilt house, (-17.2,-54.8) on the well)
  const posts: [number, number][] = [[10.2, -38.0], [6.4, -49.0], [-5.6, -44.6], [-10.0, -48.2], [-13.5, -49.4], [-19.0, -50.0], [-25.2, -54.6], [-30.4, -48.0], [-37.2, -47.4], [-42.0, -33.0]];
  for (const [x, z] of posts) {
    props.push({ kind: "post", x, z, yaw: 0, s: 1.1, v: 0 });
    lanterns.push({ x: x + 0.34, z, y: 2.4, kind: 0, ax: 0, az: 0, mount: 1 });
  }
  props.push({ ...V(-17.6, -54.2, 0.2, 1, 3), kind: "well" });
  props.push({ ...V(-24.4, -53.0, 0.5, 1, 4), kind: "cart" });
  props.push({ ...V(-26.4, -54.0, Math.PI / 2, 1, 5), kind: "bench" }, { ...V(-15.6, -54.0, Math.PI / 2, 1, 6), kind: "bench" });
  // the mill's leat: stones to cross by, below the wheel
  const stones: VillagePlan["stones"] = [];
  {
    const c = riverCentre(MILL.s + 5.2, { x: 0, z: 0 });
    const c2 = riverCentre(MILL.s + 5.8, { x: 0, z: 0 });
    const tl = Math.hypot(c2.x - c.x, c2.z - c.z);
    const nx = -(c2.z - c.z) / tl;
    const nz = (c2.x - c.x) / tl;
    const hw = riverHalfWidth(MILL.s + 5.2);
    for (let i = 0; i < 6; i++) {
      const o = -hw - 0.55 + ((2 * hw + 1.1) * i) / 5;
      stones.push({ x: c.x + nx * o + (hf(i, 1) - 0.5) * 0.3, z: c.z + nz * o + (hf(i, 2) - 0.5) * 0.3, r: 0.36 + hf(i, 3) * 0.12, yaw: hf(i, 4) * 6.28 });
    }
  }

  // ---- water: jetty, punt, weir, wheel --------------------------------------------------------------------------------------------------
  const ls = terrain as Partial<LandscapeTerrain>;
  const level = (s: number): number => (typeof ls.channelLevel === "function" ? ls.channelLevel(s) : g(RIVER.b.x, RIVER.b.z));
  const waterY = level(RIVER.length) - RIVER.freeboard;
  const jl = Math.hypot(JETTY.x1 - JETTY.x0, JETTY.z1 - JETTY.z0);
  const jyaw = Math.atan2(JETTY.z1 - JETTY.z0, JETTY.x1 - JETTY.x0);
  const jetty = { x0: JETTY.x0, z0: JETTY.z0, x1: JETTY.x1, z1: JETTY.z1, width: JETTY.width, yaw: jyaw, length: jl, deckY: waterY + 0.3, waterY };
  const puntAt = toWorld({ x: JETTY.x0, z: JETTY.z0, yaw: jyaw }, jl * 0.62, JETTY.side * (JETTY.width / 2 + 1.05));
  const punt = { x: puntAt.x, z: puntAt.z, yaw: jyaw + 0.06, waterY };
  {
    // nets on a rack at the jetty's foot; a lantern at its end
    const rk = toWorld({ x: JETTY.x0, z: JETTY.z0, yaw: jyaw }, -1.4, -JETTY.side * 2.2);
    props.push({ kind: "rack", x: rk.x, z: rk.z, yaw: jyaw + Math.PI / 2, s: 1, v: 11 });
    const lampAt = toWorld({ x: JETTY.x0, z: JETTY.z0, yaw: jyaw }, jl - 0.15, -JETTY.width / 2 + 0.1);
    props.push({ kind: "post", x: lampAt.x - 0.34, z: lampAt.z, yaw: 0, s: 0.8, v: 12 });
    lanterns.push({ x: lampAt.x, z: lampAt.z, y: jetty.deckY - g(lampAt.x, lampAt.z) + 1.7, kind: 0, ax: 0, az: 0, mount: 1 });
  }
  const wc = riverCentre(WEIR.s, { x: 0, z: 0 });
  const wc2 = riverCentre(WEIR.s + 0.5, { x: 0, z: 0 });
  const wl = Math.hypot(wc2.x - wc.x, wc2.z - wc.z);
  // the walkway crosses the stream: its local +x runs across the flow (the flow direction turned a quarter)
  const weir = { x: wc.x, z: wc.z, yaw: Math.atan2((wc2.x - wc.x) / wl, -(wc2.z - wc.z) / wl), half: WEIR.half, crestY: level(WEIR.s - 1.5) - RIVER.freeboard, walkY: level(WEIR.s - 1.5) - RIVER.freeboard + 0.3 };
  const mill = buildings.find((b) => b.kind === "mill")!;
  const wheel = { x: MILL.wheel.x, y: level(MILL.s) - RIVER.freeboard + MILL.wheel.axleAbove, z: MILL.wheel.z, r: MILL.wheel.r, nx: MILL.nx, nz: MILL.nz, axleLen: 0.8 };

  // the cat: by day on the granary steps, at night in the hall's porch (the renderer and fauna.ts choose)
  const gran = buildings.find((b) => b.id === "gran-a")!;
  const cp = toWorld(gran, gran.hx + 0.5, -1.0);
  const cat = { x: cp.x, z: cp.z, yaw: gran.yaw + 2.4 };

  // ---- signs ------------------------------------------------------------------------------------------------------------------------
  const sg = (text: number, at: { x: number; z: number }, y: number, yaw: number, w: number, h = 0.32): void => {
    signs.push({ text, x: at.x, z: at.z, y, yaw, w, h });
  };
  {
    const gate = buildings.find((b) => b.id === "gate")!;
    for (const s of [1, -1]) sg(0, toWorld(gate, s * (gate.hx + 0.04), 0), 4.7, gate.yaw + (s > 0 ? 0 : Math.PI), 2.6, 0.5);
    for (const s of [1, -1]) sg(7, toWorld(gate, s * (gate.hx + 0.04), 0), GATE_CLOCK_Y + 1.0, gate.yaw + (s > 0 ? 0 : Math.PI), 1.7, 0.3);
    const sh = buildings.find((b) => b.id === "shop")!;
    sg(5, toWorld(sh, sh.hx + 0.05, 0), sh.spec.floor + 2.65, sh.yaw, 2.3);
    sg(2, toWorld(mill, mill.hx + 0.06, -mill.spec.door / 2 - 0.9), 2.5, mill.yaw, 1.5);
    const hall = buildings.find((b) => b.id === "hall")!;
    sg(4, toWorld(hall, hall.hx + 0.06, 0), hall.spec.floor + 3.25, hall.yaw, 3.5, 0.36);
    const st1 = buildings.find((b) => b.id === "stall-1")!;
    const st2 = buildings.find((b) => b.id === "stall-2")!;
    const st3 = buildings.find((b) => b.id === "stall-3")!;
    const st4 = buildings.find((b) => b.id === "stall-4")!;
    sg(9, toWorld(st1, st1.hx + 0.03, 0), 2.05, st1.yaw, 1.5, 0.28);
    sg(10, toWorld(st2, st2.hx + 0.03, 0), 2.05, st2.yaw, 1.5, 0.28);
    sg(3, toWorld(st3, st3.hx + 0.03, 0), 2.05, st3.yaw, 1.5, 0.28);
    sg(11, toWorld(st4, st4.hx + 0.03, 0), 2.05, st4.yaw, 1.5, 0.28);
    const gb = buildings.find((b) => b.id === "gran-b")!;
    sg(8, toWorld(gb, gb.hx + 0.45, -0.3), 1.3, gb.yaw, 1.0, 0.24);
    const f = toWorld({ x: JETTY.x0, z: JETTY.z0, yaw: jyaw }, -0.6, JETTY.side * 1.0);
    sg(6, f, 1.6, jyaw + Math.PI, 1.3, 0.28);
    sg(1, { x: 11.0, z: -36.0 }, 1.5, Math.atan2(-1, 0.3), 1.2, 0.26); // by the fishing spot as you come in
  }

  const plan: VillagePlan = { buildings, props, fences, gardens, lines, lanterns, signs, smoke, stones, jetty, punt, weir, wheel, cat };
  cache.set(terrain, plan);
  return plan;
}

// ---- collision ---------------------------------------------------------------------------------------------------------------------

const WALL_T = 0.28;

/** The walls of a rectangular building as boxes, with a doorway `door` wide centred on its front (+x); door 0 leaves the front open. */
function ringWalls(out: Obstacle[], b: Site, y0: number, y1: number, hx: number, hz: number, door: number, openFront = false, t = WALL_T): void {
  const box = (lx: number, lz: number, ex: number, ez: number, tag: "house" = "house"): void => {
    const w = toWorld(b, lx, lz);
    out.push({ kind: "box", tag, x: w.x, z: w.z, hx: ex, hz: ez, yaw: b.yaw, y0, y1 });
  };
  box(-hx + t / 2, 0, t / 2, hz); // back
  box(0, -hz + t / 2, hx, t / 2); // left
  box(0, hz - t / 2, hx, t / 2); // right
  if (openFront) return;
  if (door <= 0) {
    box(hx - t / 2, 0, t / 2, hz);
    return;
  }
  const side = (hz - door / 2) / 2;
  box(hx - t / 2, -(door / 2 + side), t / 2, side);
  box(hx - t / 2, door / 2 + side, t / 2, side);
}

/** Collidable footprint of one prop (steppable heights stay under CHARACTER.stepHeight). */
function propObstacles(out: Obstacle[], p: VProp, g: number): void {
  const s = p.s;
  const c = (r: number, h: number): void => {
    out.push({ kind: "circle", tag: "vprop", x: p.x, z: p.z, r, y0: g - 0.6, y1: g + h });
  };
  const bx = (hx: number, hz: number, h: number, yaw = p.yaw): void => {
    out.push({ kind: "box", tag: "vprop", x: p.x, z: p.z, hx, hz, yaw, y0: g - 0.6, y1: g + h });
  };
  switch (p.kind) {
    case "well":
      c(0.95, 1.15);
      break;
    case "cart":
      bx(1.25 * s, 0.8 * s, 1.35);
      break;
    case "crate":
      bx(0.34 * s, 0.34 * s, 0.6 * s);
      break;
    case "barrel":
      c(0.32 * s, 0.9);
      break;
    case "sack":
      c(0.3 * s, 0.45);
      break;
    case "bale":
      c(0.56 * s, 0.85);
      break;
    case "rack": {
      const a = toWorld(p, 0, -1.2 * s);
      const b = toWorld(p, 0, 1.2 * s);
      for (const q of [a, b]) out.push({ kind: "circle", tag: "vprop", x: q.x, z: q.z, r: 0.08, y0: g - 0.6, y1: g + 2.0 });
      break;
    }
    case "bench":
      bx(0.7 * s, 0.22, 0.45);
      break;
    case "post":
      c(0.07 * s, 2.6 * s);
      break;
    case "woodpile":
      bx(0.85 * s, 0.4, 1.15);
      break;
    case "skep":
      c(0.27, 0.55);
      break;
    case "scarecrow":
      c(0.09, 2.0);
      break;
    case "trough":
      bx(0.8, 0.3, 0.5);
      break;
    case "anvil":
      c(0.3, 0.78);
      break;
    case "millstone":
      c(0.8, 0.42);
      break;
    case "stone":
      break;
  }
}

/** Every solid part of the village: walls with their doorways, floors and steps, awning poles and tables, fences, props, the jetty and the weir's walkway. */
export function villageObstacles(terrain: Terrain): Obstacle[] {
  const plan = villagePlan(terrain);
  const out: Obstacle[] = [];
  for (const b of plan.buildings) {
    const k = b.spec;
    const y0 = b.ground - 1;
    const slab = (lx: number, lz: number, ex: number, ez: number, top: number, tag: "house" = "house"): void => {
      const w = toWorld(b, lx, lz);
      out.push({ kind: "box", tag, x: w.x, z: w.z, hx: ex, hz: ez, yaw: b.yaw, y0, y1: b.ground + top });
    };
    const circle = (lx: number, lz: number, r: number, top: number): void => {
      const w = toWorld(b, lx, lz);
      out.push({ kind: "circle", tag: "house", x: w.x, z: w.z, r, y0, y1: b.ground + top });
    };
    switch (b.kind) {
      case "cottage":
      case "mill": {
        slab(0, 0, b.hx, b.hz, k.floor); // the plinth is the floor (a hand above the yard: walked onto, not jumped)
        ringWalls(out, b, y0, b.ground + k.floor + k.wall, b.hx, b.hz, k.door);
        if (b.kind === "mill") circle(0.2, 0.9, 0.8, k.floor + 0.42); // the runner stone
        break;
      }
      case "stilt": {
        // a deck on stilts (the crawl space is boarded in), a porch and three steps up; walls stand on the deck
        slab(0.6, 0, b.hx + 0.6, b.hz, k.floor);
        b.steps.forEach((top, i) => slab(b.hx + 1.2 + 0.25 + i * 0.5, 0, 0.25, 0.55, top - b.ground));
        ringWalls(out, b, b.ground + k.floor - 0.1, b.ground + k.floor + k.wall, b.hx, b.hz, k.door);
        break;
      }
      case "granary": {
        // a round store on mushroom stones: solid, with a ladder to its hatch
        circle(0, 0, b.hx + 0.05, k.wall + k.floor + 0.6);
        break;
      }
      case "hall": {
        // a stepped terrace: two steps up to the porch, then the floor; benches inside, a dais at the back
        slab(0.6, 0, b.hx + 1.3, b.hz, k.floor);
        slab(b.hx + 1.3 + 0.55, 0, 0.55, 3.6, k.floor - 0.45);
        ringWalls(out, b, b.ground + k.floor - 0.2, b.ground + k.floor + k.wall, b.hx, b.hz, k.door);
        slab(-b.hx + 1.0, 0, 0.9, 2.6, k.floor + 0.3);
        for (const sg of [-1, 1]) slab(b.hx + 0.6, sg * (k.door / 2 + 1.9), 0.24, 0.8, k.floor + 0.45); // benches on the porch either side of the doors
        for (const lx of [-1.0, 1.2]) for (const s of [-1, 1]) slab(lx, s * 2.2, 0.28, 1.2, k.floor + 0.44);
        break;
      }
      case "workshop": {
        slab(0, 0, b.hx, b.hz, k.floor);
        ringWalls(out, b, y0, b.ground + k.floor + k.wall, b.hx, b.hz, 0, true);
        // the forge and its chimney stack are part of the back wall's corner
        slab(-b.hx + 0.85, -b.hz + 1.0, 0.85, 0.75, 1.15);
        circle(-b.hx + 0.85, -b.hz + 1.0, 0.6, 5.6);
        slab(b.hx - 0.7, b.hz - 1.5, 0.4, 1.0, 0.95); // the bench
        break;
      }
      case "clock": {
        // two piers with the street between them and a lintel high above it
        const pier = k.door / 2 + 0.7;
        for (const s of [-1, 1]) slab(0, s * pier, b.hx, 0.7, k.wall);
        const w = toWorld(b, 0, 0);
        out.push({ kind: "box", tag: "house", x: w.x, z: w.z, hx: b.hx, hz: k.door / 2 + 0.05, yaw: b.yaw, y0: b.ground + 3.7, y1: b.ground + k.wall });
        break;
      }
      case "stall": {
        // four awning poles, a counter across the front, sacks and crates behind
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) circle(sx * (b.hx - 0.12), sz * (b.hz - 0.12), 0.07, 2.3);
        slab(b.hx - 0.42, 0, 0.32, b.hz - 0.3, 0.9);
        break;
      }
    }
  }
  for (const p of plan.props) propObstacles(out, p, terrain.height(p.x, p.z));
  for (const f of plan.fences) {
    const y = terrain.height(f.x, f.z);
    out.push({ kind: "box", tag: "vprop", x: f.x, z: f.z, hx: f.hx, hz: 0.07, yaw: f.yaw, y0: y - 0.5, y1: y + 0.95 });
  }
  // the jetty's deck (a plank pier: walk out along it), and the weir's walkway across the stream
  const j = plan.jetty;
  const jc = { x: (j.x0 + j.x1) / 2, z: (j.z0 + j.z1) / 2 };
  out.push({ kind: "box", tag: "jetty", x: jc.x, z: jc.z, hx: j.length / 2, hz: j.width / 2, yaw: j.yaw, y0: j.deckY - 1.4, y1: j.deckY });
  const w = plan.weir;
  out.push({ kind: "box", tag: "weir", x: w.x, z: w.z, hx: w.half, hz: 0.42, yaw: w.yaw, y0: w.walkY - 1.6, y1: w.walkY });
  // the lamp posts' bases and the clothes-line posts are props; the punt and the wheel are dressing (nobody collides with them)
  return out;
}

// ---- keep-outs for scatter -------------------------------------------------------------------------------------------------------------

let cachedFlat: Obstacle[] | undefined;
const flat: Terrain = { height: () => 0 };
const pads = VILLAGE_PADS;
const BOX = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
for (const p of pads) {
  BOX.x0 = Math.min(BOX.x0, p.x - p.r - p.blend);
  BOX.x1 = Math.max(BOX.x1, p.x + p.r + p.blend);
  BOX.z0 = Math.min(BOX.z0, p.z - p.r - p.blend);
  BOX.z1 = Math.max(BOX.z1, p.z + p.r + p.blend);
}

/** 0..1: how much of a village yard (levelled, trodden ground) is at (x, z): 1 inside a building's pad, easing out over its blend. Cheap. */
export function villageYard(x: number, z: number): number {
  if (x < BOX.x0 || x > BOX.x1 || z < BOX.z0 || z > BOX.z1) return 0;
  let best = 0;
  for (const p of pads) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r + p.blend) continue;
    const t = d <= p.r ? 1 : 1 - (d - p.r) / p.blend;
    if (t > best) best = t;
  }
  return best;
}

const PLAZA = { x: -21, z: -57.6, rx: 7.2, rz: 4.5 };

/** 0..1: cobbled paving: the plaza in front of the hall and the arch of the gate (a ragged, soft-shouldered ellipse; the shader adds the stones). */
export function villageCobble(x: number, z: number): number {
  const dx = (x - PLAZA.x) / PLAZA.rx;
  const dz = (z - PLAZA.z) / PLAZA.rz;
  const e = Math.sqrt(dx * dx + dz * dz);
  const plaza = e >= 1.15 ? 0 : e <= 0.85 ? 1 : (1.15 - e) / 0.3;
  const gate = SITES[0]!;
  const gx = (x - gate.x) * Math.cos(gate.yaw) + (z - gate.z) * Math.sin(gate.yaw);
  const gz = -(x - gate.x) * Math.sin(gate.yaw) + (z - gate.z) * Math.cos(gate.yaw);
  const under = Math.abs(gx) < 3.4 && Math.abs(gz) < 1.9 ? 1 : 0;
  return Math.max(plaza, under);
}

/** 1 inside a garden bed (tilled soil), 0 outside (a hard edge; beds are rectangles). */
export function villageGarden(x: number, z: number): number {
  if (x < BOX.x0 - 8 || x > BOX.x1 + 8 || z < BOX.z0 - 8 || z > BOX.z1 + 8) return 0;
  cachedFlatPlan ??= villagePlan(flat);
  for (const g of cachedFlatPlan.gardens) {
    const c = Math.cos(g.yaw);
    const sn = Math.sin(g.yaw);
    const lx = (x - g.x) * c + (z - g.z) * sn;
    const lz = -(x - g.x) * sn + (z - g.z) * c;
    if (Math.abs(lx) < g.hx - 0.15 && Math.abs(lz) < g.hz - 0.15) return 1;
  }
  return 0;
}
let cachedFlatPlan: VillagePlan | undefined;

/** True if a tree, rock or plant would stand in the village: on a yard, or within `margin` metres of anything solid in it. */
export function villageKeepOut(x: number, z: number, margin: number): boolean {
  if (x < BOX.x0 - margin || x > BOX.x1 + margin || z < BOX.z0 - margin || z > BOX.z1 + margin) return false;
  for (const p of pads) if (Math.hypot(x - p.x, z - p.z) < p.r + margin) return true;
  cachedFlat ??= villageObstacles(flat);
  for (const o of cachedFlat) if (insideObstacle(o, x, z, margin)) return true;
  return false;
}


// ---- the level plan (D-038; docs/LEVEL_PLAN.md section 7) ---------------------------------------------------------------------------------------

/** The hub's door height (every village door is 2.4 clear; the hall's double door is 3.0). */
const VILLAGE_DOOR_H = 2.4;

let cachedLevel: RegionLevel | undefined;
/**
 * What every building of Hollowmere IS (read by the audit and the view): the three cottages, the two stilt houses, the mill and the hall are walkable rooms (the doors are `KIND`'s: 1.5, 1.4, 1.5, 2.4 m clear);
 * the smithy and the four stalls are `open-front`; the two granaries are round stores with a hatch up a ladder and no ground door (`solid`). The clock gate is a passage (the audit's `AuditDoor`), declared here too.
 * The collision is `villageObstacles` (ringWalls with the same doorways); the `RoomRect`s are inside its walls (`WALL_T`).
 */
export function villageLevel(): RegionLevel {
  if (cachedLevel) return cachedLevel;
  const buildings: LevelBuilding[] = [];
  for (const s of SITES) {
    const k = KIND[s.kind];
    const at = { x: s.x, z: s.z, yaw: s.yaw, hx: s.hx, hz: s.hz };
    if (s.kind === "cottage" || s.kind === "stilt" || s.kind === "mill" || s.kind === "hall") {
      buildings.push(planBuilding(s.id, "interior", at, { height: k.floor + k.wall + (s.kind === "hall" ? 5.2 : s.kind === "mill" ? 2.4 : 2.0), floor: k.floor, wallH: k.wall, door: k.door, doorH: s.kind === "hall" ? 3.0 : VILLAGE_DOOR_H, steps: 0, t: WALL_T }));
    } else if (s.kind === "workshop" || s.kind === "stall") buildings.push(planBuilding(s.id, "open-front", at, { height: k.floor + k.wall + 1.5, floor: k.floor, wallH: k.wall, door: 0 }));
    else if (s.kind === "granary") buildings.push(planBuilding(s.id, "solid", at, { height: k.wall + k.floor + 3.1, floor: k.floor, wallH: k.wall, door: 0 }));
  }
  // the clock gate: two piers with the street between them; the passage's threshold is on the front (+x) face, `through` is 1.6 m beyond the back
  const g = SITES.find((x) => x.kind === "clock")!;
  const gk = KIND.clock;
  const f = { x: g.x, z: g.z, yaw: g.yaw };
  const front = toWorld(f, g.hx, 0);
  const far = toWorld(f, -g.hx - 1.6, 0);
  const passage: AuditDoor = { id: "gate.passage", building: "gate", x: front.x, z: front.z, yaw: g.yaw, width: gk.door, height: 3.7, leads: "passage", through: far, wide: true };
  cachedLevel = levelOf(buildings, [passage]);
  return cachedLevel;
}
