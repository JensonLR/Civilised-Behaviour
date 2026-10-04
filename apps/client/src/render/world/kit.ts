import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, Matrix4, Quaternion, Vector3, type Material, type Object3D } from "three";
import { separateCoplanar } from "./coplanar.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hash3 } from "@cb/shared";
import { isSharedInk } from "@cb/procedural/three";

export type V3 = readonly [number, number, number];

/** Colours a vertex from its local position and (rotated) normal. Writes linear colour into `out`. */
export type ColourFn = (p: Vector3, n: Vector3, out: Color) => void;

export interface AddOptions {
  at?: V3;
  /** Euler XYZ radians. */
  rot?: V3;
  scale?: V3;
  /** A palette hex, or a function of the vertex. */
  colour: number | ColourFn;
  /** Faceted: every triangle gets its own normal (chunky rocks, foliage lobes, canvas panels). */
  flat?: boolean;
  /** Colour each triangle once, from its centroid and face normal (crisp masonry courses and panels instead of vertex gradients). Implies `flat`. */
  perFace?: boolean;
  /** Displace vertices by up to this many local units, hashed from position so coincident vertices move together. */
  jitter?: number;
  seed?: number;
  /** In a Kit built with `{ sway: true }`: how loose the piece hangs in the wind, 0..1, constant or a function of the vertex's local position. */
  sway?: number | ((p: Vector3) => number);
}

const m4 = new Matrix4();
const q = new Quaternion();
const eul = new Euler();
const pos = new Vector3();
const scl = new Vector3();
const tmpN = new Vector3();
const tmpP = new Vector3();
const tmpC = new Color();
const up = new Vector3(0, 1, 0);
const dir = new Vector3();
/** Two limbs in a chain bent by more than this (about 4 degrees) get their joint closed, if they are thick enough for the gap to be seen. */
const KNUCKLE_COS = Math.cos(0.07);
const KNUCKLE_MIN_R = 0.035;

/**
 * Accumulates coloured primitives into ONE non-indexed geometry with per-vertex colour, face or smooth normals and the smoothed
 * `onormal` the ink outline needs (`addOutlineNormals`, shared with the characters). Like PartBuilder, but for scenery: it
 * accepts indexed and non-indexed sources, supports faceted shading and hashed vertex jitter, and lets a colour function look at
 * the vertex (mossy foot, pale top, sunlit crown). `base` places everything added afterwards in the world (landmarks).
 */
export class Kit {
  private readonly parts: BufferGeometry[] = [];
  private readonly baseMatrix = new Matrix4();
  private baseYaw = 0;
  /** The last limb's end, direction and end radius (a limb that starts there at an angle gets a knuckle: see `limb`). */
  private chain: { x: number; y: number; z: number; dx: number; dy: number; dz: number; r: number } | undefined;

  /** `sway: true` gives every piece an `aSway` attribute (0 unless the piece says otherwise): the geometry of things that move in the wind. */
  constructor(private readonly opts: { sway?: boolean } = {}) {}

  /** Places subsequent primitives at (x, y, z) turned by `yaw` (collision convention: local +x = (cos yaw, sin yaw); three rotation.y = -yaw). */
  setBase(x: number, y: number, z: number, yaw = 0): this {
    q.setFromAxisAngle(up, -yaw);
    this.baseMatrix.compose(pos.set(x, y, z), q, scl.set(1, 1, 1));
    this.baseYaw = yaw;
    this.chain = undefined;
    return this;
  }

  /** The collision-convention yaw of the current base (0 after `clearBase`). */
  get yaw(): number {
    return this.baseYaw;
  }

  /** A point given in the current base's frame, in world coordinates. */
  worldPoint(x: number, y: number, z: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    tmpP.set(x, y, z).applyMatrix4(this.baseMatrix);
    out[0] = tmpP.x;
    out[1] = tmpP.y;
    out[2] = tmpP.z;
    return out;
  }

  clearBase(): this {
    this.baseMatrix.identity();
    this.baseYaw = 0;
    this.chain = undefined;
    return this;
  }

  get count(): number {
    return this.parts.length;
  }

  /** Triangles accumulated so far (parts are non-indexed): for budgeting. */
  get triangles(): number {
    let n = 0;
    for (const g of this.parts) n += g.attributes.position!.count / 3;
    return n;
  }

  add(source: BufferGeometry, o: AddOptions): this {
    const g = source.index ? source.toNonIndexed() : source.clone();
    g.deleteAttribute("uv");
    const p = g.attributes.position as BufferAttribute;
    if (o.jitter) {
      const seed = o.seed ?? 1;
      const k = o.jitter;
      for (let i = 0; i < p.count; i++) {
        const ix = Math.round(p.getX(i) * 1000);
        const iy = Math.round(p.getY(i) * 1000);
        const iz = Math.round(p.getZ(i) * 1000);
        p.setXYZ(
          i,
          p.getX(i) + ((hash3(seed, ix, iy, iz) / 4294967296) - 0.5) * 2 * k,
          p.getY(i) + ((hash3(seed + 1, ix, iy, iz) / 4294967296) - 0.5) * 2 * k,
          p.getZ(i) + ((hash3(seed + 2, ix, iy, iz) / 4294967296) - 0.5) * 2 * k,
        );
      }
    }
    if (o.flat || o.jitter || o.perFace) g.computeVertexNormals(); // non-indexed: one normal per face
    const nrm = g.attributes.normal as BufferAttribute;
    // Colour first, in local space with the normal turned by the piece's own rotation (so "facing up" means up in the world).
    const rot = o.rot ?? [0, 0, 0];
    eul.set(rot[0], rot[1], rot[2]);
    q.setFromEuler(eul);
    const colours = new Float32Array(p.count * 3);
    const fn = typeof o.colour === "number" ? undefined : o.colour;
    if (!fn) tmpC.set(o.colour as number);
    if (fn && o.perFace) {
      for (let i = 0; i + 2 < p.count; i += 3) {
        tmpP.set((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3);
        tmpN.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyQuaternion(q);
        fn(tmpP, tmpN, tmpC);
        for (let k = 0; k < 3; k++) {
          colours[(i + k) * 3] = tmpC.r;
          colours[(i + k) * 3 + 1] = tmpC.g;
          colours[(i + k) * 3 + 2] = tmpC.b;
        }
      }
    } else {
      for (let i = 0; i < p.count; i++) {
        if (fn) {
          tmpP.set(p.getX(i), p.getY(i), p.getZ(i));
          tmpN.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyQuaternion(q);
          fn(tmpP, tmpN, tmpC);
        }
        colours[i * 3] = tmpC.r;
        colours[i * 3 + 1] = tmpC.g;
        colours[i * 3 + 2] = tmpC.b;
      }
    }
    g.setAttribute("color", new BufferAttribute(colours, 3));
    if (this.opts.sway) {
      const sway = new Float32Array(p.count);
      const sf = o.sway;
      for (let i = 0; i < p.count; i++) sway[i] = typeof sf === "function" ? Math.min(1, Math.max(0, sf(tmpP.set(p.getX(i), p.getY(i), p.getZ(i))))) : (sf ?? 0);
      g.setAttribute("aSway", new BufferAttribute(sway, 1));
    }
    const at = o.at ?? [0, 0, 0];
    const sc = o.scale ?? [1, 1, 1];
    m4.compose(pos.set(at[0], at[1], at[2]), q, scl.set(sc[0], sc[1], sc[2]));
    m4.premultiply(this.baseMatrix);
    g.applyMatrix4(m4);
    this.parts.push(g);
    return this;
  }

  /** A tapered tube between two points (trunks, branches, poles, ropes). Open-ended: a limb that carries on from the last one closes its joint (below). */
  limb(a: V3, b: V3, rA: number, rB: number, colour: number | ColourFn, radial = 7, capped = false, sway?: number | ((t: number) => number)): this {
    dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return this;
    dir.divideScalar(len);
    // A limb that carries on from the last one's end at an angle (a kinked trunk, a bent branch, a rail round a corner): two open-ended cylinders meeting
    // at an angle leave a wedge-shaped hole on the outside of the bend, and you saw through the trunk. Up to 45 degrees the new limb simply starts
    // r tan(angle) back along its own axis: its side then spans the outside of the bend and both open rims lie inside the other cylinder (no extra
    // triangles, so nothing in the budgets). A sharper bend is a knee or an elbow inside a body, left as it was. (Not for swaying limbs, whose joint
    // would have to sway as both do.)
    let from: V3 = a;
    const c = this.chain;
    const kr = c ? Math.max(rA, c.r) : 0;
    if (c && sway === undefined && kr >= KNUCKLE_MIN_R && Math.abs(a[0] - c.x) + Math.abs(a[1] - c.y) + Math.abs(a[2] - c.z) < 1e-4) {
      const cos = dir.x * c.dx + dir.y * c.dy + dir.z * c.dz;
      if (cos < KNUCKLE_COS && cos >= Math.SQRT1_2) {
        const e = (kr * Math.sqrt(1 - cos * cos)) / cos;
        from = [a[0] - dir.x * e, a[1] - dir.y * e, a[2] - dir.z * e];
      }
    }
    this.chain = sway === undefined ? { x: b[0], y: b[1], z: b[2], dx: dir.x, dy: dir.y, dz: dir.z, r: rB } : undefined;
    const span = Math.hypot(b[0] - from[0], b[1] - from[1], b[2] - from[2]);
    q.setFromUnitVectors(up, dir);
    eul.setFromQuaternion(q);
    // CylinderGeometry: top radius first, then bottom. A limb runs a -> b, so the top is at b.
    return this.add(new CylinderGeometry(rB, rA, span, radial, 1, !capped), {
      at: [(from[0] + b[0]) / 2, (from[1] + b[1]) / 2, (from[2] + b[2]) / 2],
      rot: [eul.x, eul.y, eul.z],
      colour,
      // `sway` as a function of how far along the limb (0 at a, 1 at b)
      sway: typeof sway === "function" ? (p: Vector3): number => sway(p.y / span + 0.5) : sway,
    });
  }

  /** Merges everything: one geometry, `position` + `normal` + `color` + `onormal`. Undefined if nothing was added. */
  build(): BufferGeometry | undefined {
    if (this.parts.length === 0) return undefined;
    separateCoplanar(this.parts); // D-080: a piece laid flush on another of a different colour is lifted off it, so the two never fight for the depth buffer
    const merged = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    this.chain = undefined;
    if (!merged) return undefined;
    weldedOutlineNormals(merged);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/**
 * The ink hull's smoothed normals (`onormal`): every vertex at the same position (to 0.5 mm) gets the normalised sum of the normals there, so a
 * flat-shaded solid's hull does not split at its edges. The same result as `addOutlineNormals` in the character package, but keyed on a hash of the
 * rounded integer coordinates in a typed open-addressing table instead of a string per vertex: several times faster, which matters because the
 * whole village, camp and every tree are built with it at start-up.
 */
export function weldedOutlineNormals(geo: BufferGeometry): void {
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal!;
  const n = pos.count;
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  const qz = new Int32Array(n);
  let size = 16;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const rep = new Int32Array(n);
  const acc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = Math.round(pos.getX(i) * 2000);
    const y = Math.round(pos.getY(i) * 2000);
    const z = Math.round(pos.getZ(i) * 2000);
    qx[i] = x;
    qy[i] = y;
    qz[i] = z;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    let r = -1;
    for (;;) {
      const t = table[h]!;
      if (t < 0) {
        table[h] = i;
        r = i;
        break;
      }
      if (qx[t] === x && qy[t] === y && qz[t] === z) {
        r = t;
        break;
      }
      h = (h + 1) & mask;
    }
    rep[i] = r;
    acc[r * 3] = acc[r * 3]! + nor.getX(i);
    acc[r * 3 + 1] = acc[r * 3 + 1]! + nor.getY(i);
    acc[r * 3 + 2] = acc[r * 3 + 2]! + nor.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rep[i]! * 3;
    const len = Math.hypot(acc[r]!, acc[r + 1]!, acc[r + 2]!) || 1;
    out[i * 3] = acc[r]! / len;
    out[i * 3 + 1] = acc[r + 1]! / len;
    out[i * 3 + 2] = acc[r + 2]! / len;
  }
  geo.setAttribute("onormal", new BufferAttribute(out, 3));
}

// ---- colour helpers (all take palette hexes; results are linear working-space colours like everything else in three) --------------

const cA = new Color();
const cB = new Color();

/** A straight blend between two palette colours by `t` (0..1). */
export function blend(out: Color, a: number, b: number, t: number): Color {
  return out.set(a).lerp(cB.set(b), t < 0 ? 0 : t > 1 ? 1 : t);
}

/** Colour by local height: `lo` at y0 blending to `hi` at y1. */
export function byHeight(lo: number, hi: number, y0: number, y1: number): ColourFn {
  return (p, _n, out) => blend(out, lo, hi, (p.y - y0) / (y1 - y0));
}

/** Foliage/rock lighting painted into the vertices: `dark` on undersides, `mid` on the flanks, `light` on faces looking up. */
export function topLit(dark: number, mid: number, light: number, litFrom = 0.35): ColourFn {
  return (_p, n, out) => {
    if (n.y < 0.1) blend(out, dark, mid, (n.y + 1) / 1.35);
    else blend(out, mid, light, (n.y - litFrom) / (1 - litFrom));
  };
}

/** Multiplies a colour function's output by a flat factor (shade a whole piece). */
export function shaded(fn: ColourFn, k: number): ColourFn {
  return (p, n, out) => {
    fn(p, n, out);
    out.multiplyScalar(k);
  };
}

export function scaledColour(hex: number, k: number): number {
  cA.set(hex).multiplyScalar(k);
  return cA.getHex();
}

/** Frees a scene object and everything it owns. */
export function disposeTree(o: Object3D): void {
  o.removeFromParent();
  o.traverse((c) => {
    const m = c as { geometry?: BufferGeometry; material?: Material | Material[] };
    m.geometry?.dispose();
    // the ink materials (the characters' and every scenery weight) belong to every mesh in the game
    if (Array.isArray(m.material)) for (const x of m.material) !isSharedInk(x) && x.dispose();
    else if (m.material && !isSharedInk(m.material)) m.material.dispose();
  });
}
