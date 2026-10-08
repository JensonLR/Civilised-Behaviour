import { BufferGeometry, Color, Group, Mesh, MeshToonMaterial, SphereGeometry, Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import { BLANKET_DYES, HORSE_COATS, HORSE_MANE, HORSE_SEAT, type HorseSpec } from "../horse.ts";
import { outlineMaterial, sharedToonRamp } from "./outline.ts";
import { PartBuilder, type V3 } from "./parts.ts";
import type { Ring } from "./loft.ts";

/**
 * The horse: a rigid articulated hierarchy like the characters' (no skinning), one merged vertex-coloured mesh per bone with the toon ramp and an ink hull,
 * palette colours only. It faces -Z, +X is its right, the origin is on the ground under the middle of the barrel. A stout, long-nosed cob (the Society buys by the
 * pound): the back is at ~0.9 m and the rider's pelvis sits at HORSE_SEAT.y = 0.95.
 *
 *   root -> body (pivot at the barrel's centre: it bobs, pitches, sags) -> neck -> head -> earL/earR
 *                                                                      -> tail
 *                                                                      -> foreL/foreR/hindL/hindR { top, knee }
 *
 * The reins are four thin meshes re-aimed every frame between the hands, a point on the neck and the bit (`syncReins`), so they follow a tossing head.
 */

export interface HorseLeg {
  /** Shoulder (fore) or hip (hind). Rotation.x swings the leg forward when positive. */
  top: Group;
  /** The knee (fore) or hock (hind). */
  knee: Group;
}

export interface HorseJoints {
  root: Group;
  body: Group;
  neck: Group;
  head: Group;
  earL: Group;
  earR: Group;
  tail: Group;
  foreL: HorseLeg;
  foreR: HorseLeg;
  hindL: HorseLeg;
  hindR: HorseLeg;
}

export interface HorseRig {
  root: Group;
  joints: HorseJoints;
  spec: HorseSpec;
  /** Uniform scale of the whole animal (spec.height); the seat scales with it. */
  scale: number;
  /** The barrel's width factor (spec.bulk), for `barrelOutside`: a rider's legs go round a stout cob wider than round a lean one. */
  girth: number;
  /**
   * Hangs the irons (riding saddle only) where a rider's feet are: `RideInput.iron` as the ride pose wrote it, or undefined for the irons at rest. Rebuilds the stirrups' small mesh only
   * when the place moves (a new rider), so it may be called every frame.
   */
  setStirrups(at: { x: number; y: number; z: number; half: number; yaw: number } | undefined): void;
  /** Where the rider's pelvis goes, in the root's frame (already scaled). */
  seat: { x: number; y: number; z: number };
  /** Number of draw-call-producing meshes right now (outlines included). */
  readonly meshCount: number;
  /** Triangles of the visible main meshes (outline hulls are extra). */
  readonly triangles: number;
  setOutline(on: boolean): void;
  /** Re-aims the reins between the hands, the neck and the bit. The animator calls it after posing the head; `ridden` draws them taut to the hands, otherwise they hang loose. */
  syncReins(ridden: boolean): void;
  dispose(): void;
}

export interface HorseBuildOptions {
  outline?: boolean;
}

// ---- colour helpers (derived from palette entries, never literals) ---------------------------------------------------------------------------------------------------
const tmpA = new Color();
const tmpB = new Color();
const mix = (a: number, b: number, t: number): number => tmpA.setHex(a).lerp(tmpB.setHex(b), t).getHex();
const shade = (a: number, k: number): number => tmpA.setHex(a).multiplyScalar(k).getHex();

let sharedMaterial: MeshToonMaterial | undefined;
const horseMaterial = (): MeshToonMaterial => (sharedMaterial ??= new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() }));

/** Deterministic 0..1 from integers (no Math.random: a spec always builds the same animal). */
const h01 = (a: number, b: number): number => {
  let x = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
};

/** A low-poly blob: the horse is mostly smooth masses, and the stock `sphere` helper tessellates a big one finely (192 triangles for a haunch). */
const blob = (b: PartBuilder, r: number, color: number, pos: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0], w = 8, h = 5): PartBuilder => b.add(new SphereGeometry(r, w, h), color, pos, rot, scale);

// ---- the barrel (shared by the body, the dapples, the blanket) -------------------------------------------------------------------------------------------------
interface BarrelRing {
  y: number;
  rx: number;
  rz: number;
  cz: number;
}
/** Sections along the length: y is distance FORWARD from the centre (the loft is turned so +y points to -Z). */
const BARREL: readonly BarrelRing[] = [
  { y: -0.88, rx: 0.08, rz: 0.1, cz: 0.05 },
  { y: -0.8, rx: 0.2, rz: 0.23, cz: 0.07 },
  { y: -0.62, rx: 0.31, rz: 0.29, cz: 0.01 },
  { y: -0.3, rx: 0.34, rz: 0.27, cz: 0.03 },
  { y: 0.1, rx: 0.36, rz: 0.3, cz: 0.0 },
  { y: 0.45, rx: 0.36, rz: 0.33, cz: -0.03 },
  { y: 0.7, rx: 0.31, rz: 0.34, cz: -0.04 },
  { y: 0.86, rx: 0.22, rz: 0.29, cz: -0.01 },
  { y: 0.95, rx: 0.11, rz: 0.18, cz: -0.02 },
];
const BARREL_POW = 2.2;
const barrelRings = (bulk: number): BarrelRing[] => BARREL.map((r) => ({ ...r, rx: r.rx * bulk }));

/** A point on the barrel's surface (body frame): `along` is z (negative forward), `theta` is the angle from the top, clockwise seen from the front (so +theta is the right side). */
function barrelPoint(rings: BarrelRing[], z: number, theta: number, lift = 0, out: { x: number; y: number; z: number; nx: number; ny: number } = { x: 0, y: 0, z: 0, nx: 0, ny: 0 }) {
  const y = -z; // ring coordinate
  let a = rings[0]!;
  let b = rings[rings.length - 1]!;
  for (let i = 0; i < rings.length - 1; i++) {
    if (y >= rings[i]!.y && y <= rings[i + 1]!.y) {
      a = rings[i]!;
      b = rings[i + 1]!;
      break;
    }
  }
  const t = b.y === a.y ? 0 : Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y)));
  const rx = a.rx + (b.rx - a.rx) * t + lift;
  const rz = a.rz + (b.rz - a.rz) * t + lift;
  const cz = a.cz + (b.cz - a.cz) * t;
  out.x = Math.sin(theta) * rx;
  out.y = Math.cos(theta) * rz + cz;
  out.z = z;
  out.nx = Math.sin(theta);
  out.ny = Math.cos(theta);
  return out;
}

/**
 * Where a point stands against the barrel, in the body frame (x right, y up from the barrel's pivot, z negative forward), with the barrel's section grown by `pad` m all round: the
 * superellipse's radial measure minus 1, so > 0 is outside and < 0 inside (about metres over the section's half-size). `girth` is the horse's barrel factor (`HorseRig.girth`). The same
 * rings and power the barrel is lofted from, so a rider's leg can be kept off the mesh that is drawn. Allocation-free.
 */
export function barrelOutside(girth: number, x: number, y: number, z: number, pad = 0): number {
  const rings = BARREL;
  const v = -z;
  let i = 0;
  while (i < rings.length - 2 && v > rings[i + 1]!.y) i++;
  const a = rings[i]!;
  const b = rings[i + 1]!;
  if (v < rings[0]!.y - pad || v > rings[rings.length - 1]!.y + pad) return 1; // beyond the nose of the chest or the tail
  const t = Math.min(1, Math.max(0, (v - a.y) / (b.y - a.y)));
  const rx = (a.rx + (b.rx - a.rx) * t) * girth + pad;
  const rz = a.rz + (b.rz - a.rz) * t + pad;
  const cz = a.cz + (b.cz - a.cz) * t;
  return (Math.abs(x / rx) ** BARREL_POW + Math.abs((y - cz) / rz) ** BARREL_POW) ** (1 / BARREL_POW) - 1;
}

// ---- bone builders --------------------------------------------------------------------------------------------------------------------------------------------------
interface Ctx {
  spec: HorseSpec;
  coat: number;
  coat2: number;
  points: number;
  mane: number;
  leather: number;
  leatherDark: number;
  brass: number;
  white: number;
  hoof: number;
  blanket: number;
  blanketAlt: number;
  bulk: number;
  neckLen: number;
  headScale: number;
}

function makeCtx(spec: HorseSpec): Ctx {
  const coat = HORSE_COATS[spec.coat] ?? HORSE_COATS[0]!;
  const coat2 = HORSE_COATS[spec.coat2] ?? HORSE_COATS[1]!;
  const mane = HORSE_MANE[spec.maneColor] ?? -1;
  const pale = new Color(coat).getHSL({ h: 0, s: 0, l: 0 }).l > 0.55;
  return {
    spec,
    coat,
    coat2,
    points: shade(coat, pale ? 0.8 : 0.62),
    mane: mane === -1 ? shade(coat, 0.55) : mane === -2 ? coat2 : mane,
    leather: PALETTE.material.leather,
    leatherDark: PALETTE.material.leatherBlack,
    brass: PALETTE.weapons.brass,
    white: PALETTE.hair[7]!,
    hoof: PALETTE.material.leatherBlack,
    blanket: BLANKET_DYES[spec.blanketColor] ?? BLANKET_DYES[0]!,
    blanketAlt: PALETTE.material.cream,
    bulk: (0.92 + (spec.bulk / 255) * 0.18) * 0.84,
    neckLen: 1.0 + (spec.neck / 255) * 0.25,
    headScale: 1.12 + (spec.head / 255) * 0.3,
  };
}

const ROT_Z_FORWARD: V3 = [-Math.PI / 2, 0, 0]; // a loft stacks along +Y: this turns its +Y into the horse's forward (-Z) and its ring's Z into UP

function buildBody(c: Ctx): BufferGeometry | undefined {
  const b = new PartBuilder();
  const rings = barrelRings(c.bulk);
  const lofts: Ring[] = rings.map((r) => ({ y: r.y, rx: r.rx, rz: r.rz, cz: r.cz, pow: BARREL_POW }));
  b.loft(lofts, c.coat, [0, 0, 0], ROT_Z_FORWARD);
  // withers and haunches: the muscle the barrel alone lacks
  blob(b, 0.14, c.coat, [0, 0.265, -0.52], [1, 0.75, 1.5]);
  for (const s of [-1, 1]) {
    blob(b, 0.18, c.coat, [s * 0.2 * c.bulk, 0.07, 0.58], [0.9, 1.05, 1.15]);
    blob(b, 0.15, c.coat, [s * 0.21 * c.bulk, 0.04, -0.5], [0.85, 1.05, 1.0]);
  }
  pattern(b, c, rings);
  tack(b, c, rings);
  return b.build();
}

/** Coat patterns on the body: dapples (a paler ring-spotted bloom) and piebald patches. */
function pattern(b: PartBuilder, c: Ctx, rings: BarrelRing[]): void {
  const p = c.spec.pattern;
  const pt = { x: 0, y: 0, z: 0, nx: 0, ny: 0 };
  if (p === 3) {
    const light = mix(c.coat, c.white, 0.14);
    const dark = shade(c.coat, 0.88);
    for (let i = 0; i < 18; i++) {
      const z = -0.7 + h01(c.spec.coat, i) * 1.4;
      const th = (h01(i, c.spec.coat2 + 9) * 2 - 1) * 2.3;
      barrelPoint(rings, z, th, 0.0, pt);
      const rot = -Math.atan2(pt.nx, pt.ny);
      {
        const r = 0.07 + h01(i, 4) * 0.03;
        b.cylinder(r * 0.85, r, 0.03, i % 3 === 0 ? dark : light, [pt.x, pt.y, pt.z], [0, 0, rot]);
      }
    }
  } else if (p === 4) {
    const patches: [number, number, number][] = [
      [0.1, 1.15, 0.2],
      [-0.5, -0.9, 0.17],
      [0.5, -1.7, 0.15],
      [-0.1, 0.0, 0.2],
    ];
    patches.forEach(([z, th, r], i) => {
      barrelPoint(rings, z, th, -0.012, pt);
      blob(b, r, c.coat2, [pt.x, pt.y, pt.z], [1, 0.33, 1.25 - i * 0.05], [0, 0, -Math.atan2(pt.nx, pt.ny)]);
    });
  }
}

/** The riding or pack saddle, blanket, girth, harness and packs. */
function tack(b: PartBuilder, c: Ctx, rings: BarrelRing[]): void {
  const s = c.spec;
  const topY = 0.29;
  if (s.blanket !== 0 && s.harness === 0) {
    const band = (z0: number, z1: number, grow: number, color: number, n = 3): Ring[] => {
      const out: Ring[] = [];
      for (let i = 0; i < n; i++) {
        const z = z0 + ((z1 - z0) * i) / (n - 1);
        const r = rings.reduce((best, k) => (Math.abs(k.y + z) < Math.abs(best.y + z) ? k : best), rings[0]!);
        out.push({ y: -z, rx: r.rx + grow, rz: r.rz + grow, cz: r.cz, pow: 2.2, color });
      }
      return out;
    };
    // a rug over the barrel from behind the withers to the loins; the motif is bands of the second colour
    const base = c.blanket;
    const alt = s.blanket === 1 || s.blanket === 2 ? c.blanketAlt : shade(c.blanket, 0.62);
    if (s.blanket === 1) {
      for (let i = 0; i < 5; i++) b.loft(band(-0.36 + i * 0.16, -0.36 + i * 0.16 + 0.14, 0.014, i % 2 === 0 ? base : alt), base, [0, 0, 0], ROT_Z_FORWARD);
    } else {
      b.loft(band(-0.4, 0.4, 0.014, base, 5), base, [0, 0, 0], ROT_Z_FORWARD);
      if (s.blanket === 2) for (let i = 0; i < 4; i++) b.loft(band(-0.3 + i * 0.2, -0.2 + i * 0.2, 0.02, alt), alt, [0, 0, 0], ROT_Z_FORWARD);
      if (s.blanket === 3 || s.blanket === 4) {
        const pt = { x: 0, y: 0, z: 0, nx: 0, ny: 0 };
        for (const side of [-1, 1])
          for (let i = 0; i < 3; i++) {
            barrelPoint(rings, -0.22 + i * 0.22, side * 1.5, 0.02, pt);
            const rot = -Math.atan2(pt.nx, pt.ny);
            if (s.blanket === 3) b.box(0.13, 0.025, 0.13, alt, [pt.x, pt.y, pt.z], [0, Math.PI / 4, rot]);
            else {
              b.box(0.12, 0.022, 0.035, alt, [pt.x, pt.y + 0.03, pt.z + 0.03], [0.6, 0, rot]);
              b.box(0.12, 0.022, 0.035, alt, [pt.x, pt.y + 0.03, pt.z - 0.03], [-0.6, 0, rot]);
            }
          }
      }
    }
  }
  if (s.saddle === 1) {
    blob(b, 0.23, c.leather, [0, topY + 0.025, 0.02], [1.05, 0.26, 1.55]); // the seat
    blob(b, 0.065, c.leather, [0, topY + 0.065, -0.3], [1, 0.9, 0.9], [0, 0, 0], 6, 4); // pommel
    blob(b, 0.08, c.leather, [0, topY + 0.07, 0.31], [1.3, 0.8, 0.8], [0, 0, 0], 6, 4); // cantle
    for (const side of [-1, 1]) {
      b.box(0.03, 0.2, 0.3, c.leather, [side * 0.35 * c.bulk, 0.2, -0.02], [0, 0, side * 0.2]); // flaps
      // (the leathers and irons are their own mesh, `buildStirrups`: they are let down or taken up to the rider's leg)
    }
  } else if (s.saddle === 2) {
    const wood = PALETTE.material.wood;
    for (const side of [-1, 1]) {
      b.box(0.1, 0.1, 0.62, wood, [side * 0.17, topY + 0.04, 0.02]);
      b.box(0.05, 0.22, 0.05, wood, [side * 0.17, topY + 0.14, -0.3]);
      b.box(0.05, 0.22, 0.05, wood, [side * 0.17, topY + 0.14, 0.32]);
    }
    b.box(0.5, 0.04, 0.06, wood, [0, topY + 0.25, -0.3]);
    b.box(0.5, 0.04, 0.06, wood, [0, topY + 0.25, 0.32]);
  }
  if (s.saddle !== 0) {
    const pt = { x: 0, y: 0, z: 0, nx: 0, ny: 0 };
    barrelPoint(rings, 0.18, 0, 0.012, pt);
    b.loft([{ y: 0.12, rx: rings[3]!.rx + 0.03, rz: rings[3]!.rz + 0.03, pow: 2.2 }, { y: 0.17, rx: rings[3]!.rx + 0.03, rz: rings[3]!.rz + 0.03, pow: 2.2 }], c.leatherDark, [0, 0, 0], ROT_Z_FORWARD); // girth
  }
  if (s.harness === 1) {
    // collar, and traces running along the flanks to the hitch point behind the croup
    b.torus(0.17, 0.05, c.leather, [0, 0.3, -0.66], [-0.62, 0, 0], [1, 1, 1]);
    b.torus(0.17, 0.018, c.brass, [0, 0.3, -0.66], [-0.62, 0, 0], [1.02, 1.02, 2.4]);
    for (const side of [-1, 1]) {
      const spine: V3[] = [
        [side * 0.27, 0.2, -0.62],
        [side * 0.42 * c.bulk, 0.1, -0.3],
        [side * 0.45 * c.bulk, 0.02, 0.3],
        [side * 0.38, -0.02, 0.9],
        [side * HORSE_SEAT.trace.x, HORSE_SEAT.trace.y - 0.62, HORSE_SEAT.trace.z],
      ];
      b.sweep(spine, () => ({ rx: 0.012, rz: 0.012 }), c.leatherDark, { segments: 4, caps: true });
    }
    b.loft(
      [{ y: -0.18, rx: rings[3]!.rx + 0.025, rz: rings[3]!.rz + 0.025, cz: 0, pow: 2.2 }, { y: -0.12, rx: rings[3]!.rx + 0.025, rz: rings[3]!.rz + 0.025, cz: 0, pow: 2.2 }],
      c.leather,
      [0, 0, 0],
      ROT_Z_FORWARD,
    );
    b.cylinder(0.02, 0.02, 0.6, c.leatherDark, [0, topY + 0.01, 0.0], [0, 0, Math.PI / 2]); // the saddle strap over the back
  }
  if (s.packs === 1) {
    for (const side of [-1, 1]) b.box(0.14, 0.3, 0.42, mix(c.leather, c.blanket, 0.35), [side * 0.43 * c.bulk, 0.05, 0.4], [0, 0, side * 0.1]);
  } else if (s.packs === 2) {
    b.cylinder(0.11, 0.11, 0.7, c.blanket, [0, topY + 0.14, 0.42], [0, 0, Math.PI / 2]);
    for (const x of [-0.2, 0.2]) b.torus(0.115, 0.012, c.leatherDark, [x, topY + 0.14, 0.42], [0, Math.PI / 2, 0]);
  } else if (s.packs === 3) {
    for (const side of [-1, 1]) {
      b.box(0.2, 0.3, 0.5, PALETTE.material.wood, [side * 0.46 * c.bulk, 0.12, 0.2]);
      b.box(0.015, 0.3, 0.52, c.leatherDark, [side * 0.56 * c.bulk, 0.12, 0.2]);
    }
  }
}

function neckSpine(L: number): V3[] {
  return [
    [0, 0, 0.08],
    [0, 0.13 * L, -0.09],
    [0, 0.29 * L, -0.21],
    [0, 0.45 * L, -0.3],
  ];
}

function buildNeck(c: Ctx): BufferGeometry | undefined {
  const b = new PartBuilder();
  const L = c.neckLen;
  const spine = neckSpine(L);
  b.sweep(spine, (t) => ({ rx: 0.165 - 0.06 * t, rz: 0.25 - 0.1 * t, pow: 2.3 }), c.coat, { segments: 8, side: [1, 0, 0] });
  // mane: locks along the crest, hanging down the right side
  const style = c.spec.mane;
  const n = style === 0 ? 7 : style === 3 ? 12 : 10;
  for (let i = 0; i < n; i++) {
    const t = 0.04 + (0.92 * i) / (n - 1);
    const f = t * (spine.length - 1);
    const k = Math.min(spine.length - 2, Math.floor(f));
    const u = f - k;
    const p0 = spine[k]!;
    const p1 = spine[k + 1]!;
    const px = p0[0] + (p1[0] - p0[0]) * u;
    const py = p0[1] + (p1[1] - p0[1]) * u;
    const pz = p0[2] + (p1[2] - p0[2]) * u;
    const crest = 0.25 - 0.1 * t;
    const len = style === 0 ? 0.07 : style === 3 ? 0.21 + 0.06 * h01(i, 3) : style === 2 ? 0.13 : 0.17 + 0.04 * h01(i, 5);
    const col = style === 2 && i % 2 === 0 ? c.brass : c.mane;
    // a lock is a cone hanging from the crest (a roached mane stands up like a brush)
    if (style === 0) b.cone(0.045, 0.1, col, [px, py + crest * 0.95 + 0.03, pz + 0.04], [0.2, 0, 0]);
    else b.cone(0.05, len * 1.5, col, [px + 0.035 + 0.02 * h01(i, 1), py + crest * 0.75 - len * 0.45, pz + 0.06], [0, 0, Math.PI - 0.18 + 0.1 * h01(i, 2)], [1, 1, 0.55]);
  }
  if (c.spec.harness === 1) {
    for (const s of [-1, 1]) b.sphere(0.04, c.brass, [s * 0.16, 0.1, -0.03], [1, 1, 1]); // hames
  }
  return b.build();
}

/** The head, in its own frame: skull at the origin (the poll), the nose running along -Z. */
function buildHead(c: Ctx): BufferGeometry | undefined {
  const b = new PartBuilder();
  const R = c.spec.roman;
  const ring = (y: number, rx: number, rz: number, cz: number, pow = 2.3): Ring => ({ y, rx, rz, cz, pow });
  const rings: Ring[] = [
    ring(-0.1, 0.095, 0.125, 0.02),
    ring(0.0, 0.118, 0.16, 0.0),
    ring(0.16, 0.108, 0.15, -0.012),
    ring(0.3, 0.078, 0.105 + R * 0.006, -0.03 + R * 0.008),
    ring(0.42, 0.068, 0.088 + R * 0.004, -0.044 + R * 0.006),
    ring(0.5, 0.066, 0.078, -0.052),
    ring(0.57, 0.058, 0.066, -0.056),
  ];
  b.loft(rings, c.coat, [0, 0, 0], ROT_Z_FORWARD);
  // the muzzle is paler; two nostrils; teeth (the horse's expression is the horse's own business)
  blob(b, 0.06, mix(c.coat, c.hoof, 0.25), [0, -0.058, -0.57], [1, 0.8, 0.7], [0, 0, 0], 8, 5);
  for (const s of [-1, 1]) {
    b.sphere(0.021, c.leatherDark, [s * 0.034, -0.045, -0.615], [0.7, 1, 0.7]);
    b.sphere(0.034, PALETTE.face.white, [s * 0.108, 0.05, -0.04], [0.8, 1, 1]); // eye
    b.sphere(0.02, PALETTE.face.pupil, [s * 0.128, 0.05, -0.052], [0.6, 1, 1]);
    blob(b, 0.075, c.coat, [s * 0.075, -0.01, 0.05], [0.9, 1.1, 1.1], [0, 0, 0], 7, 5); // cheek
  }
  for (const x of [-0.03, -0.01, 0.01, 0.03]) b.box(0.016, 0.034, 0.014, PALETTE.trim.teeth, [x, -0.1, -0.61]);
  // forelock, between the ears
  for (let i = 0; i < 3; i++) b.cone(0.03, 0.09, c.mane, [(i - 1) * 0.03, 0.1 - 0.02 * i, -0.08 - 0.015 * i], [-2.7, 0, 0], [1, 1, 0.6]);
  if (c.spec.pattern === 1 || c.spec.pattern === 2) {
    const spine: V3[] = [
      [0, 0.158, -0.01],
      [0, 0.14, -0.15],
      [0, 0.086 + R * 0.006, -0.3],
      [0, 0.05, -0.43],
      [0, 0.025, -0.53],
    ];
    if (c.spec.pattern === 1) b.sweep(spine, (t) => ({ rx: 0.02 + 0.016 * t, rz: 0.012 }), c.white, { segments: 5, caps: true });
    else blob(b, 0.03, c.white, [0, 0.12, -0.1], [0.8, 0.3, 1.1], [0.35, 0, 0], 6, 4);
  }
  if (c.spec.pattern === 4) blob(b, 0.07, c.coat2, [0.085, 0.07, -0.2], [0.5, 0.9, 1.5], [0, 0, 0], 6, 4);
  bridle(b, c);
  return b.build();
}

function bridle(b: PartBuilder, c: Ctx): void {
  const s = c.spec.bridle;
  if (s === 0) {
    // a rope halter: noseband loop and a loop behind the ears
    b.torus(0.073, 0.012, PALETTE.material.rope, [0, -0.012, -0.38], [0, 0, 0], [1, 1.1, 1]);
    b.torus(0.12, 0.012, PALETTE.material.rope, [0, 0.0, -0.02], [0, 0, 0], [1, 1.3, 1]);
    return;
  }
  const col = c.leather;
  b.torus(0.075, 0.01, col, [0, -0.018, -0.4], [0, 0, 0], [1, 1.1, 1]); // noseband
  b.torus(0.124, 0.01, col, [0, 0.0, -0.045], [0, 0, 0], [1, 1.3, 1]); // headstall behind the cheeks
  for (const side of [-1, 1]) {
    b.box(0.008, 0.15, 0.012, col, [side * 0.102, 0.04, -0.22], [0.25, 0, 0]); // cheek strap
    b.torus(0.018, 0.006, s === 2 ? c.brass : PALETTE.weapons.steel, [side * 0.085, -0.05, -0.37], [0, Math.PI / 2, 0]); // bit ring
    if (s === 2) b.sphere(0.014, c.brass, [side * 0.115, 0.01, -0.21]);
  }
  b.box(0.2, 0.012, 0.016, col, [0, 0.12, -0.1], [0.3, 0, 0]); // browband
}

function buildEar(c: Ctx, side: -1 | 1): BufferGeometry | undefined {
  const b = new PartBuilder();
  b.cone(0.036, 0.15, c.coat, [0, 0.075, 0], [0, 0, side * -0.18], [1, 1, 0.55]);
  b.cone(0.02, 0.09, mix(c.coat, c.leatherDark, 0.3), [0, 0.06, -0.012], [0, 0, side * -0.18], [1, 1, 0.5]);
  return b.build();
}

function buildTail(c: Ctx): BufferGeometry | undefined {
  const b = new PartBuilder();
  const style = c.spec.tail;
  const len = style === 1 ? 0.45 : 0.8;
  const spine: V3[] = [
    [0, 0, -0.02],
    [0, -0.08, 0.07],
    [0, -len * 0.4, 0.14],
    [0, -len * 0.75, 0.15],
    [0, -len, 0.12],
  ];
  const thin = style === 2 ? 0.6 : 1;
  b.sweep(spine, (t) => ({ rx: (0.03 + 0.04 * Math.sin(t * Math.PI * 0.8) - 0.012 * t) * thin, rz: (0.035 + 0.035 * Math.sin(t * Math.PI * 0.8) - 0.015 * t) * thin }), c.mane, { segments: 6, round: "end" });
  if (style === 3) {
    b.sweep(spine.map(([x, y, z]) => [x + 0.04, y * 0.9, z + 0.02] as V3), (t) => ({ rx: 0.035 * (1 - 0.6 * t), rz: 0.03 }), c.mane, { segments: 5, round: "end" });
    b.sweep(spine.map(([x, y, z]) => [x - 0.045, y * 0.8, z + 0.03] as V3), (t) => ({ rx: 0.03 * (1 - 0.6 * t), rz: 0.03 }), c.mane, { segments: 5, round: "end" });
  }
  if (style === 2) for (let i = 1; i < 4; i++) b.sphere(0.028, c.brass, [0, -len * 0.25 * i - 0.02, 0.1 + 0.015 * i]);
  blob(b, 0.07, c.coat, [0, 0.0, 0.0], [1, 0.9, 1], [0, 0, 0], 6, 4); // the dock
  return b.build();
}

/** Upper foreleg (forearm), in the shoulder frame hanging down. */
function buildForeUpper(c: Ctx, side: -1 | 1): BufferGeometry | undefined {
  const b = new PartBuilder();
  const col = c.spec.pattern === 3 ? shade(c.coat, 0.9) : c.coat;
  b.sweep(
    [
      [0, 0.04, 0],
      [0, -0.12, 0.015],
      [0, -0.26, 0.005],
      [0, -0.34, 0],
    ],
    (t) => ({ rx: 0.115 - 0.045 * t, rz: 0.125 - 0.05 * t, pow: 2.3 }),
    col,
    { segments: 7, side: [1, 0, 0] },
  );
  blob(b, 0.075, c.coat, [0, -0.34, -0.005], [0.85, 0.8, 1], [0, 0, 0], 6, 4); // the knee
  void side;
  return b.build();
}

/** Lower foreleg: cannon, fetlock, pastern and hoof, in the knee frame. `lower` colour is the points (or white socks). */
function buildForeLower(c: Ctx): BufferGeometry | undefined {
  const b = new PartBuilder();
  const col = c.spec.pattern === 2 ? c.white : c.points;
  b.sweep(
    [
      [0, 0.0, 0],
      [0, -0.1, 0],
      [0, -0.2, 0.002],
    ],
    () => ({ rx: 0.052, rz: 0.058, pow: 2.4 }),
    col,
    { segments: 6, side: [1, 0, 0], caps: false },
  );
  blob(b, 0.062, col, [0, -0.215, 0.004], [0.9, 1, 1.05], [0, 0, 0], 6, 4);
  b.sweep(
    [
      [0, -0.21, 0.004],
      [0, -0.255, -0.02],
      [0, -0.285, -0.045],
    ],
    () => ({ rx: 0.046, rz: 0.048 }),
    col,
    { segments: 6, side: [1, 0, 0] },
  );
  b.cylinder(0.055, 0.075, 0.07, c.hoof, [0, -0.3, -0.05], [-0.15, 0, 0]);
  return b.build();
}

function buildHindUpper(c: Ctx): BufferGeometry | undefined {
  const b = new PartBuilder();
  b.sweep(
    [
      [0, 0.06, -0.02],
      [0, -0.12, 0.0],
      [0, -0.28, 0.07],
      [0, -0.4, 0.1],
    ],
    (t) => ({ rx: 0.125 - 0.055 * t, rz: 0.17 - 0.08 * t, pow: 2.3 }),
    c.coat,
    { segments: 8, side: [1, 0, 0] },
  );
  blob(b, 0.062, c.coat, [0, -0.4, 0.115], [0.85, 0.8, 1.2], [0, 0, 0], 6, 4); // the hock's point
  return b.build();
}

function buildHindLower(c: Ctx): BufferGeometry | undefined {
  const b = new PartBuilder();
  const col = c.spec.pattern === 2 ? c.white : c.points;
  b.sweep(
    [
      [0, 0.0, 0.012],
      [0, -0.1, -0.005],
      [0, -0.2, -0.02],
    ],
    () => ({ rx: 0.052, rz: 0.06, pow: 2.4 }),
    col,
    { segments: 6, side: [1, 0, 0], caps: false },
  );
  blob(b, 0.062, col, [0, -0.215, -0.024], [0.9, 1, 1.05], [0, 0, 0], 6, 4);
  b.sweep(
    [
      [0, -0.21, -0.024],
      [0, -0.25, -0.05],
      [0, -0.27, -0.075],
    ],
    () => ({ rx: 0.046, rz: 0.048 }),
    col,
    { segments: 6, side: [1, 0, 0] },
  );
  b.cylinder(0.055, 0.075, 0.07, c.hoof, [0, -0.285, -0.08], [-0.15, 0, 0]);
  return b.build();
}

/** Where the irons hang with nobody in the saddle (the right one; `StirrupPlace` in ridePose.ts): straight down from the bar, facing forward. */
export const STIRRUP_REST = { x: HORSE_SEAT.stirrup.x, y: HORSE_SEAT.stirrup.y - 0.62 - 0.03 + 0.05 * 1.2, z: HORSE_SEAT.stirrup.z, half: 0.05, yaw: 0 } as const;
/** The stirrup bar under the saddle's skirt, where each leather hangs from (right side, body frame). */
const STIRRUP_BAR = { x: HORSE_SEAT.stirrup.x - 0.02, y: 0.14, z: -0.02 } as const;

/**
 * The two stirrups for an iron at `at` (the right one; the left mirrors): a leather from the bar to the top of the iron, and the iron, an upright brass loop (taller than wide, as
 * irons are) whose opening faces the way the toes point, with its tread across the bottom. Rebuilt when a rider of another leg length mounts (`HorseRig.setStirrups`).
 */
function buildStirrups(c: Ctx, at: { x: number; y: number; z: number; half: number; yaw: number }): BufferGeometry | undefined {
  const b = new PartBuilder();
  const ry = at.half * 1.2;
  for (const side of [-1, 1]) {
    const ix = side * at.x;
    const topY = at.y + ry;
    const dx = side * STIRRUP_BAR.x - ix;
    const dy = STIRRUP_BAR.y - topY;
    const dz = STIRRUP_BAR.z - at.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3;
    // the leather: a strap from the iron's top up to the bar (Euler XYZ that turns +Y onto the strap: Rz first, then Rx)
    b.box(0.015, len, 0.03, c.leatherDark, [ix + dx / 2, topY + dy / 2, at.z + dz / 2], [Math.atan2(dz / len, dy / len), 0, -Math.asin(Math.max(-1, Math.min(1, dx / len)))]);
    b.torus(at.half, 0.011, c.brass, [ix, at.y, at.z], [0, side * at.yaw, 0], [1, 1.2, 1]); // the iron
    b.box(at.half * 1.6, 0.012, 0.045, c.brass, [ix, at.y - ry + 0.006, at.z], [0, side * at.yaw, 0]); // its tread
  }
  return b.build();
}

function withHull<T>(hull: boolean, make: () => T): T {
  const prev = PartBuilder.hullMode;
  const prevLod = PartBuilder.lod;
  PartBuilder.hullMode = hull;
  PartBuilder.lod = 0;
  try {
    return make();
  } finally {
    PartBuilder.hullMode = prev;
    PartBuilder.lod = prevLod;
  }
}

/**
 * Builds a horse. Each call builds fresh geometry owned by the rig (a herd of a dozen is cheap; `dispose()` frees it). Materials are shared module-wide.
 */
export function buildHorse(spec: HorseSpec, options: HorseBuildOptions = {}): HorseRig {
  const c = makeCtx(spec);
  const material = horseMaterial();
  const geometries: BufferGeometry[] = [];
  const meshes: Mesh[] = [];
  const hulls: Mesh[] = [];
  let outlineOn = options.outline ?? true;
  let triangles = 0;

  const mk = (name: string, parent: Group, x = 0, y = 0, z = 0): Group => {
    const g = new Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const attach = (bone: string, parent: Group, make: () => BufferGeometry | undefined): void => {
    const geo = withHull(false, make);
    if (!geo) return;
    geometries.push(geo);
    triangles += (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
    const m = new Mesh(geo, material);
    m.name = `mesh_${bone}`;
    m.castShadow = true;
    parent.add(m);
    meshes.push(m);
    const hg = withHull(true, make);
    if (hg) {
      geometries.push(hg);
      const h = new Mesh(hg, outlineMaterial());
      h.name = `outline_${bone}`;
      h.castShadow = false;
      h.visible = outlineOn;
      parent.add(h);
      hulls.push(h);
    }
  };

  const root = new Group();
  root.name = "horse";
  const scale = 0.95 + (spec.height / 255) * 0.1;
  root.scale.setScalar(scale);
  const body = mk("body", root, 0, 0.62, 0);
  const neck = mk("neck", body, 0, 0.26, -0.68);
  const head = mk("head", neck, 0, 0.45 * c.neckLen, -0.3);
  head.rotation.x = -0.8;
  head.scale.setScalar(c.headScale);
  const earL = mk("earL", head, -0.07, 0.11, 0.02);
  const earR = mk("earR", head, 0.07, 0.11, 0.02);
  const tail = mk("tail", body, 0, 0.22, 0.9);
  const leg = (name: string, x: number, y: number, z: number, kneeY: number, kneeZ: number): HorseLeg => {
    const top = mk(`${name}Top`, body, x, y, z);
    const knee = mk(`${name}Knee`, top, 0, kneeY, kneeZ);
    return { top, knee };
  };
  const bx = 0.2 * c.bulk;
  const foreL = leg("foreL", -bx, 0.05, -0.5, -0.34, 0);
  const foreR = leg("foreR", bx, 0.05, -0.5, -0.34, 0);
  const hindL = leg("hindL", -bx, 0.08, 0.62, -0.4, 0.1);
  const hindR = leg("hindR", bx, 0.08, 0.62, -0.4, 0.1);

  attach("body", body, () => buildBody(c));
  attach("neck", neck, () => buildNeck(c));
  attach("head", head, () => buildHead(c));
  attach("earL", earL, () => buildEar(c, -1));
  attach("earR", earR, () => buildEar(c, 1));
  attach("tail", tail, () => buildTail(c));
  attach("foreUpperL", foreL.top, () => buildForeUpper(c, -1));
  attach("foreUpperR", foreR.top, () => buildForeUpper(c, 1));
  attach("foreLowerL", foreL.knee, () => buildForeLower(c));
  attach("foreLowerR", foreR.knee, () => buildForeLower(c));
  attach("hindUpperL", hindL.top, () => buildHindUpper(c));
  attach("hindUpperR", hindR.top, () => buildHindUpper(c));
  attach("hindLowerL", hindL.knee, () => buildHindLower(c));
  attach("hindLowerR", hindR.knee, () => buildHindLower(c));

  // ---- stirrups: their own small mesh, rebuilt when a rider's legs want the irons elsewhere ------------------------------------------------------------------------
  const stirrups = mk("stirrups", body);
  const hung = { x: NaN, y: NaN, z: NaN, half: NaN, yaw: NaN };
  const setStirrups = (at: { x: number; y: number; z: number; half: number; yaw: number } | undefined): void => {
    if (spec.saddle !== 1) return;
    const p = at && Number.isFinite(at.x + at.y + at.z + at.half + at.yaw) && at.half > 0 ? at : STIRRUP_REST;
    if (Math.abs(p.x - hung.x) < 0.004 && Math.abs(p.y - hung.y) < 0.004 && Math.abs(p.z - hung.z) < 0.004 && Math.abs(p.half - hung.half) < 0.002 && Math.abs(p.yaw - hung.yaw) < 0.02) return;
    Object.assign(hung, { x: p.x, y: p.y, z: p.z, half: p.half, yaw: p.yaw });
    for (const m of [...stirrups.children] as Mesh[]) {
      m.removeFromParent();
      m.geometry.dispose();
      const gi = geometries.indexOf(m.geometry);
      if (gi >= 0) geometries.splice(gi, 1);
      const mi = meshes.indexOf(m);
      if (mi >= 0) {
        meshes.splice(mi, 1);
        triangles -= (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
      }
      const hi = hulls.indexOf(m);
      if (hi >= 0) hulls.splice(hi, 1);
    }
    attach("stirrups", stirrups, () => buildStirrups(c, hung));
  };
  setStirrups(undefined);

  // ---- reins: hand -> neck side -> bit, re-aimed every frame -----------------------------------------------------------------------------------------------------
  const reinGeo = withHull(false, () => {
    const g = new PartBuilder().box(0.012, 0.012, 1, c.leather, [0, 0, -0.5]).build()!;
    return g;
  });
  geometries.push(reinGeo);
  const reins: { mesh: Mesh }[] = [];
  const hasReins = spec.bridle !== 0 && spec.harness === 0;
  if (hasReins) {
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(reinGeo, material);
      m.name = `rein${i}`;
      m.castShadow = false;
      m.frustumCulled = false;
      m.visible = false;
      root.add(m);
      reins.push({ mesh: m });
    }
  }
  const handA = new Vector3();
  const mid = new Vector3();
  const bit = new Vector3();
  const dir = new Vector3();
  const FORWARD = new Vector3(0, 0, -1);
  // The box runs along -Z from its origin and is one metre long: put its origin at `from`, turn -Z toward `to`, stretch it to the distance. Root-local space (the reins are root children).
  const aim = (m: Mesh, from: Vector3, to: Vector3): void => {
    dir.subVectors(to, from);
    const len = dir.length();
    m.position.copy(from);
    m.scale.set(1, 1, Math.max(len, 1e-4));
    if (len > 1e-6) m.quaternion.setFromUnitVectors(FORWARD, dir.multiplyScalar(1 / len));
    m.visible = true;
  };
  const syncReins = (ridden: boolean): void => {
    if (reins.length === 0) return;
    body.updateMatrix();
    neck.updateMatrix();
    head.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      bit.set(s * 0.085, -0.05, -0.37).applyMatrix4(head.matrix).applyMatrix4(neck.matrix).applyMatrix4(body.matrix);
      mid.set(s * 0.2, 0.22 * c.neckLen, -0.14).applyMatrix4(neck.matrix).applyMatrix4(body.matrix);
      if (ridden) handA.set(s * HORSE_SEAT.hand.x, HORSE_SEAT.hand.y - 0.62, HORSE_SEAT.hand.z).applyMatrix4(body.matrix); // (the hands are barrel-attached, like the seat)
      else handA.set(s * 0.19, 0.3, -0.3).applyMatrix4(neck.matrix).applyMatrix4(body.matrix); // slack: draped over the withers
      aim(reins[i * 2]!.mesh, mid, handA);
      aim(reins[i * 2 + 1]!.mesh, bit, mid);
    }
  };

  const setOutline = (on: boolean): void => {
    outlineOn = on;
    for (const h of hulls) h.visible = on;
  };
  syncReins(false);

  return {
    root,
    joints: { root, body, neck, head, earL, earR, tail, foreL, foreR, hindL, hindR },
    spec,
    scale,
    girth: c.bulk,
    seat: { x: 0, y: HORSE_SEAT.y * scale, z: HORSE_SEAT.z * scale },
    get meshCount() {
      return meshes.length + reins.length + (outlineOn ? hulls.length : 0);
    },
    get triangles() {
      return triangles;
    },
    setOutline,
    syncReins,
    setStirrups,
    dispose() {
      root.removeFromParent();
      for (const g of geometries) g.dispose();
      geometries.length = 0;
    },
  };
}
