import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, Matrix4, Quaternion, Vector3, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hash3 } from "@cb/shared";
import { addOutlineNormals, isSharedInk } from "@cb/procedural/three";

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

/**
 * Accumulates coloured primitives into ONE non-indexed geometry with per-vertex colour, face or smooth normals and the smoothed
 * `onormal` the ink outline needs (`addOutlineNormals`, shared with the characters). Like PartBuilder, but for scenery: it
 * accepts indexed and non-indexed sources, supports faceted shading and hashed vertex jitter, and lets a colour function look at
 * the vertex (mossy foot, pale top, sunlit crown). `base` places everything added afterwards in the world (landmarks).
 */
export class Kit {
  private readonly parts: BufferGeometry[] = [];
  private readonly baseMatrix = new Matrix4();

  /** Places subsequent primitives at (x, y, z) turned by `yaw` (collision convention: local +x = (cos yaw, sin yaw); three rotation.y = -yaw). */
  setBase(x: number, y: number, z: number, yaw = 0): this {
    q.setFromAxisAngle(up, -yaw);
    this.baseMatrix.compose(pos.set(x, y, z), q, scl.set(1, 1, 1));
    return this;
  }

  clearBase(): this {
    this.baseMatrix.identity();
    return this;
  }

  get count(): number {
    return this.parts.length;
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
    const at = o.at ?? [0, 0, 0];
    const sc = o.scale ?? [1, 1, 1];
    m4.compose(pos.set(at[0], at[1], at[2]), q, scl.set(sc[0], sc[1], sc[2]));
    m4.premultiply(this.baseMatrix);
    g.applyMatrix4(m4);
    this.parts.push(g);
    return this;
  }

  /** A tapered tube between two points (trunks, branches, poles, ropes). Open-ended: joints are hidden by the next segment or a blob. */
  limb(a: V3, b: V3, rA: number, rB: number, colour: number | ColourFn, radial = 7, capped = false): this {
    dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return this;
    dir.divideScalar(len);
    q.setFromUnitVectors(up, dir);
    eul.setFromQuaternion(q);
    // CylinderGeometry: top radius first, then bottom. A limb runs a -> b, so the top is at b.
    return this.add(new CylinderGeometry(rB, rA, len, radial, 1, !capped), {
      at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      rot: [eul.x, eul.y, eul.z],
      colour,
    });
  }

  /** Merges everything: one geometry, `position` + `normal` + `color` + `onormal`. Undefined if nothing was added. */
  build(): BufferGeometry | undefined {
    if (this.parts.length === 0) return undefined;
    const merged = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    if (!merged) return undefined;
    addOutlineNormals(merged);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
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
