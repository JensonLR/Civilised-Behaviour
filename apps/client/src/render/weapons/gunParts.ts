import { BoxGeometry, ConeGeometry, CylinderGeometry, Euler, Quaternion, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry } from "three";
import { PartBuilder, type SweepSection, type V3 } from "@cb/procedural/three";

/**
 * The weapon builder: a thin layer over `PartBuilder` that makes ONE primitive per call, remembers what each one is (its thickness, whether it is a
 * decoration, which hand holds it) and tessellates by weapon level of detail without ever dropping a piece (the characters' crowd levels drop small
 * primitives; a gun with its lock missing is a gun in two floating halves, so weapons choose their own simplification).
 *
 * Model space (the contract with `WEAPON_ANCHORS`): origin = the RIGHT hand's grip, -Z down the barrel or blade, +Y up, +X the wielder's right.
 */

export type WeaponLod = 0 | 1 | 2;

/** What the builder knows about one primitive; `meta[i]` is the i-th primitive merged into the geometry (the merge keeps the order). */
export interface PartMeta {
  kind: "box" | "rod" | "ball" | "ring" | "tube" | "cone";
  /** The smaller dimension of the part's own box (metres): what must be at least `MIN_THICK` for a part that carries the silhouette. */
  thick: number;
  /** Small furniture (a trigger, a sight, a rivet head): allowed down to `MIN_DETAIL`, left out of the far levels of detail, and it must touch a body part. */
  detail: boolean;
}

/** The thinnest a silhouette part may be (metres): a gun has to read at 10 m on a screen. */
export const MIN_THICK = 0.025;
/** The thinnest a decoration may be. */
export const MIN_DETAIL = 0.012;

/** An axis a fist wraps round: the segment from `a` to `b` (weapon space) with the handle's radius. */
export interface HandleAxis {
  hand: "R" | "L";
  a: V3;
  b: V3;
  r: number;
}

/** Tessellation by level: cylinder sides, sphere (width, height), sweep sides, torus tube sides. */
const SIDES = [10, 7, 5] as const;
const BALL: readonly (readonly [number, number])[] = [[10, 7], [7, 5], [5, 3]];
const SWEEP = [8, 6, 4] as const;

const q = new Quaternion();
const e = new Euler();
const up = new Vector3(0, 1, 0);
const dir = new Vector3();

export class GunBuilder {
  readonly b = new PartBuilder();
  readonly meta: PartMeta[] = [];
  readonly handles: HandleAxis[] = [];

  constructor(readonly lod: WeaponLod) {}

  private put(geo: BufferGeometry, color: number, pos: V3, rot: V3, scale: V3, meta: PartMeta): this {
    if (meta.detail && this.lod > 0) {
      geo.dispose();
      return this;
    }
    this.b.add(geo, color, pos, rot, scale);
    this.meta.push(meta);
    return this;
  }

  /** A box. */
  box(w: number, h: number, d: number, color: number, pos: V3, rot: V3 = [0, 0, 0], detail = false): this {
    return this.put(new BoxGeometry(w, h, d), color, pos, rot, [1, 1, 1], { kind: "box", thick: Math.min(w, h, d), detail });
  }

  /** A round bar from `a` to `b`, `rA` thick at a and `rB` at b (a cone frustum). */
  rod(a: V3, b: V3, rA: number, rB: number, color: number, detail = false): this {
    dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return this;
    dir.divideScalar(len);
    q.setFromUnitVectors(up, dir);
    e.setFromQuaternion(q, "XYZ");
    // (CylinderGeometry: the first radius is the +Y end)
    return this.put(new CylinderGeometry(rB, rA, len, SIDES[this.lod]!, 1, false), color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [e.x, e.y, e.z], [1, 1, 1], {
      kind: "rod",
      thick: Math.min(2 * Math.max(rA, rB), len),
      detail,
    });
  }

  /** A bar laid along Z from `z0` (back) to `z1` (front), at height `y` and sideways `x`: `rBack` thick at the back. */
  lay(z0: number, z1: number, rBack: number, rFront: number, color: number, y = 0, x = 0, detail = false): this {
    return this.rod([x, y, Math.max(z0, z1)], [x, y, Math.min(z0, z1)], rBack, rFront, color, detail);
  }

  /** A band round a bar along Z at `z` (a ring, `w` wide). */
  band(z: number, r: number, w: number, color: number, y = 0, x = 0, detail = false): this {
    return this.lay(z + w / 2, z - w / 2, r, r, color, y, x, detail);
  }

  /** A ball (scaled to an ellipsoid if you like). */
  ball(r: number, color: number, pos: V3, scale: V3 = [1, 1, 1], detail = false): this {
    const [w, h] = BALL[this.lod]!;
    return this.put(new SphereGeometry(r, w, h), color, pos, [0, 0, 0], scale, { kind: "ball", thick: 2 * r * Math.min(...scale), detail });
  }

  /** A cone with its base at `pos` and its point along `rot` (default: up +Y). */
  cone(r: number, h: number, color: number, pos: V3, rot: V3 = [0, 0, 0], detail = false): this {
    return this.put(new ConeGeometry(r, h, SIDES[this.lod]!, 1), color, pos, rot, [1, 1, 1], { kind: "cone", thick: Math.min(2 * r, h), detail });
  }

  /** A hoop (part of a ring): `arc` radians of a circle of radius `r`, drawn with a tube `tube` thick. Lies in the XY plane before `rot`. */
  ring(r: number, tube: number, color: number, pos: V3, rot: V3 = [0, 0, 0], arc = Math.PI * 2, scale: V3 = [1, 1, 1], detail = false): this {
    const radial = Math.max(6, Math.round([16, 10, 7][this.lod]! * Math.min(1, arc / Math.PI + 0.25)));
    return this.put(new TorusGeometry(r, tube, [5, 4, 3][this.lod]!, radial, arc), color, pos, rot, scale, { kind: "ring", thick: 2 * tube, detail });
  }

  /** A tube swept along `spine`, its cross-section given by `section(t)` (superellipse half-axes along the side axis and the normal). */
  tube(spine: readonly V3[], section: (t: number, i: number) => SweepSection, color: number, opts: { side?: V3; round?: "start" | "end" | "both"; detail?: boolean } = {}): this {
    // fewer spine points further out: a smooth curve is only worth its points up close
    let pts = spine;
    if (this.lod >= 1 && spine.length > 5) pts = spine.filter((_, i) => i % 2 === 0 || i === spine.length - 1);
    let rx = 0;
    let rz = 0;
    for (let k = 0; k <= 8; k++) {
      const s = section(k / 8, Math.round((k / 8) * (pts.length - 1)));
      rx = Math.max(rx, s.rx);
      rz = Math.max(rz, s.rz);
    }
    const before = this.b.count;
    const detail = opts.detail === true;
    if (detail && this.lod > 0) return this;
    // (the section is evaluated over the points actually used, so tapers stay right)
    this.b.sweep(pts, section, color, { segments: SWEEP[this.lod]!, side: opts.side ?? [1, 0, 0], caps: true, ...(opts.round ? { round: opts.round } : {}), ...(this.lod > 0 ? { coarseDome: true } : {}) });
    if (this.b.count === before) return this;
    this.meta.push({ kind: "tube", thick: 2 * Math.min(rx, rz), detail });
    return this;
  }

  /** A handle: a fist wraps round `a`..`b`. Recorded for the grip tests; the geometry is the caller's. */
  handle(hand: "R" | "L", a: V3, b: V3, r: number): this {
    this.handles.push({ hand, a, b, r });
    return this;
  }

  build(): BufferGeometry | undefined {
    return this.b.build();
  }
}

/** Points along a smooth path through `keys` (Catmull-Rom), `n` of them: for stocks and blades. Each key is a V3. */
export function smoothPath(keys: readonly V3[], n: number): V3[] {
  const out: V3[] = [];
  const m = keys.length - 1;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * m;
    const k = Math.min(m - 1, Math.floor(u));
    const t = u - k;
    const p0 = keys[Math.max(0, k - 1)]!;
    const p1 = keys[k]!;
    const p2 = keys[k + 1]!;
    const p3 = keys[Math.min(m, k + 2)]!;
    const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}

/** Scalar Catmull-Rom through `vals` at u in 0..1 (the same spline, for a section's half-axes). */
export function smoothAt(vals: readonly number[], u: number): number {
  const m = vals.length - 1;
  const x = Math.min(1, Math.max(0, u)) * m;
  const k = Math.min(m - 1, Math.floor(x));
  const t = x - k;
  const a = vals[Math.max(0, k - 1)]!;
  const b = vals[k]!;
  const c = vals[k + 1]!;
  const d = vals[Math.min(m, k + 2)]!;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}
