import type { Proportions } from "../../proportions.ts";
import { computeProportions } from "../../proportions.ts";
import type { CharacterSpec } from "../../spec.ts";
import { ringAt, ringSurface } from "../bodyKit.ts";
import type { Ring } from "../loft.ts";
import { headShape, type HeadShape } from "../headShape.ts";
import { torsoRings } from "./torsoShape.ts";

/**
 * THE BODY FIELD: an analytic model of the bare body (and of the outermost garment that follows its shape) for one character spec.
 *
 * Every wearable is placed by asking this field where the body is - project onto the surface and offset along the normal - instead of by hand-tuned coordinates, so
 * placement adapts to any size and shape by construction. The same field is what the fit audit (penetration.ts / fit.test.ts) measures against.
 *
 * Frames. Points are in one of two spaces:
 *  - BONE space: the frame a bone's mesh is built in (origin at the joint, +Y up, the face looks toward -Z; limbs hang down -Y). Builders work here.
 *  - RIG space: the root's frame at rest (feet on y = 0). `toRig(bone, p)` / `toBone(bone, p)` convert with the bone's frame; the default frames are the rig's rest
 *    pose computed analytically, `withFrames(...)` swaps in the frames of a posed rig (`framesFromRig`).
 *
 * Two layers of surface, both queried the same way:
 *  - "skin": the flesh core under any cloth (the torso rings of a bare torso x BODY_CORE, limb capsules, the sculpted head, the neck). Nothing may end up inside it.
 *  - "worn": the OUTERMOST body-following surface a player sees (the torso loft of the spec's jacket, the sleeve, the trouser leg). Straps, packs, buckles and medals go on this.
 * `fit/index.ts` builds the full worn layer (sleeves, trousers, cape/poncho); `makeBodyField` alone uses the exact torso and falls back to the skin plus a cloth
 * allowance elsewhere (no dependency on limbs.ts/drape.ts, so builders of any kind can import it).
 */

export type V3 = readonly [number, number, number];
export type Mat16 = ArrayLike<number>;

export type BoneName = "pelvis" | "torso" | "head" | "upperArmL" | "upperArmR" | "foreArmL" | "foreArmR" | "handL" | "handR" | "upperLegL" | "upperLegR" | "lowerLegL" | "lowerLegR";
export const BONES: readonly BoneName[] = ["pelvis", "torso", "head", "upperArmL", "upperArmR", "foreArmL", "foreArmR", "handL", "handR", "upperLegL", "upperLegR", "lowerLegL", "lowerLegR"];
export type Region = "torso" | "pelvis" | "neck" | "head" | "upperArm" | "foreArm" | "hand" | "upperLeg" | "lowerLeg" | "drape";
export type LayerId = "skin" | "worn";

/** Sides of the torso loft at full detail (surface.ts torsoSegments): the worn torso is measured as the polygon that is drawn. */
const TORSO_SEGMENTS = 14;
/** The flesh core is this fraction of a bare torso's section: cloth and the loft are thicker than the body they cover. */
export const BODY_CORE = 0.9;
/** Fallback thickness of cloth over a limb when no worn override is given (a sleeve or a trouser leg over the limb's core). */
export const CLOTH_ALLOWANCE = 1.28;

// ---- small rigid-transform maths (column-major 4x4 like three's Matrix4.elements; no allocation in the query paths) -------------------------------------------------

const ident = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat16, b: Mat16): number[] {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return o;
}
const translate = (x: number, y: number, z: number): number[] => {
  const m = ident();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
};
const rotX = (a: number): number[] => {
  const m = ident();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
};

/** The bones' frames (bone -> rig) at the rig's rest pose: the same hierarchy `buildCharacter` makes (rig.ts), so a mismatch shows in `fit.test.ts`. */
export function restFrames(P: Proportions): Record<BoneName, number[]> {
  const footH = 0.05 * P.scale;
  const hipY = footH + P.legLower + P.legUpper;
  const pelvis = translate(0, hipY, 0);
  const torso = mul(mul(pelvis, translate(0, 0.04 * P.scale, 0)), rotX(-P.lean));
  const head = mul(torso, translate(0, P.torsoHeight + P.neck, 0));
  const shoulderY = P.torsoHeight * 0.88;
  const shL = mul(torso, translate(-P.shoulderHalfWidth, shoulderY, 0));
  const shR = mul(torso, translate(P.shoulderHalfWidth, shoulderY, 0));
  const hipL = mul(pelvis, translate(-P.hipWidth, 0, 0));
  const hipR = mul(pelvis, translate(P.hipWidth, 0, 0));
  return {
    pelvis,
    torso,
    head,
    upperArmL: shL,
    upperArmR: shR,
    foreArmL: mul(shL, translate(0, -P.armUpper, 0)),
    foreArmR: mul(shR, translate(0, -P.armUpper, 0)),
    handL: mul(mul(shL, translate(0, -P.armUpper, 0)), translate(0, -P.armLower, 0)),
    handR: mul(mul(shR, translate(0, -P.armUpper, 0)), translate(0, -P.armLower, 0)),
    upperLegL: hipL,
    upperLegR: hipR,
    lowerLegL: mul(hipL, translate(0, -P.legUpper, 0)),
    lowerLegR: mul(hipR, translate(0, -P.legUpper, 0)),
  };
}

/** The frames of a built (and possibly posed) rig: pass the result to `field.withFrames`. Call `rig.root.updateMatrixWorld(true)` first. */
export function framesFromRig(rig: { joints: object }): Record<BoneName, number[]> {
  const j = rig.joints as Record<string, { matrixWorld: { elements: ArrayLike<number> } }>;
  const m = (k: string): number[] => Array.from(j[k]!.matrixWorld.elements);
  return {
    pelvis: m("pelvis"),
    torso: m("torso"),
    head: m("head"),
    upperArmL: m("shoulderL"),
    upperArmR: m("shoulderR"),
    foreArmL: m("elbowL"),
    foreArmR: m("elbowR"),
    handL: m("wristL"),
    handR: m("wristR"),
    upperLegL: m("hipL"),
    upperLegR: m("hipR"),
    lowerLegL: m("kneeL"),
    lowerLegR: m("kneeR"),
  };
}

// ---- signed-distance primitives (bone space) ----------------------------------------------------------------------------------------------------------------------

interface Prim {
  readonly bone: BoneName;
  readonly region: Region;
  /** Bone-space bounding box [minx, miny, minz, maxx, maxy, maxz], for culling. */
  readonly box: readonly [number, number, number, number, number, number];
  /** Signed distance (metres, negative inside) of a bone-space point; first-order accurate near the surface. */
  dist(x: number, y: number, z: number): number;
}

interface LoftTables {
  n: number;
  y: Float64Array;
  rx: Float64Array;
  rz: Float64Array;
  cx: Float64Array;
  cz: Float64Array;
  pw: Float64Array;
}

function tablesOf(rings: readonly Ring[]): LoftTables {
  const sorted = [...rings].sort((a, b) => a.y - b.y);
  const n = sorted.length;
  const t: LoftTables = { n, y: new Float64Array(n), rx: new Float64Array(n), rz: new Float64Array(n), cx: new Float64Array(n), cz: new Float64Array(n), pw: new Float64Array(n) };
  sorted.forEach((r, i) => {
    t.y[i] = r.y;
    t.rx[i] = r.rx;
    t.rz[i] = r.rz;
    t.cx[i] = r.cx ?? 0;
    t.cz[i] = r.cz ?? 0;
    t.pw[i] = r.pow ?? 2.4;
  });
  return t;
}

/** Interpolated section at height y (already inside the table's range) -> scratch [rx, rz, cx, cz, pow]. */
const S = new Float64Array(5);
function sectionAt(t: LoftTables, y: number): void {
  let i = 0;
  while (i < t.n - 2 && y > t.y[i + 1]!) i++;
  const span = t.y[i + 1]! - t.y[i]!;
  const k = span > 1e-9 ? Math.min(1, Math.max(0, (y - t.y[i]!) / span)) : 0;
  S[0] = t.rx[i]! + (t.rx[i + 1]! - t.rx[i]!) * k;
  S[1] = t.rz[i]! + (t.rz[i + 1]! - t.rz[i]!) * k;
  S[2] = t.cx[i]! + (t.cx[i + 1]! - t.cx[i]!) * k;
  S[3] = t.cz[i]! + (t.cz[i + 1]! - t.cz[i]!) * k;
  S[4] = t.pw[i]! + (t.pw[i + 1]! - t.pw[i]!) * k;
}

/** The level-set function f of a section's superellipse (f = 1 on the surface) at (x, z); scratch S must hold the section. */
function superF(x: number, z: number): number {
  const p = S[4]!;
  const a = Math.abs(x - S[2]!) / S[0]!;
  const b = Math.abs(z - S[3]!) / S[1]!;
  return Math.pow(Math.pow(a, p) + Math.pow(b, p), 1 / p);
}

/** Signed distance (metres, negative inside) from (x, z) to the polygon of `seg` sides that the loft draws for the section in S (vertices as loftGeometry.ringVertex places them). */
const PX = new Float64Array(64);
const PZ = new Float64Array(64);
function polygonDist(x: number, z: number, seg: number): number {
  const p = S[4]!;
  const e = 2 / p;
  for (let k = 0; k < seg; k++) {
    const th = (k / seg) * Math.PI * 2;
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    PX[k] = S[2]! + S[0]! * Math.sign(sn) * Math.abs(sn) ** e;
    PZ[k] = S[3]! - S[1]! * Math.sign(cs) * Math.abs(cs) ** e;
  }
  let best = Infinity;
  let sign = -1;
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    const ax = PX[k]!;
    const az = PZ[k]!;
    const bx = PX[k2]! - ax;
    const bz = PZ[k2]! - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1)));
    const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
    if (d < best) best = d;
    // the vertices run front (-Z) -> right (+X) -> back: the interior is where every edge's cross product is positive
    if (bx * (z - az) - bz * (x - ax) < 0) sign = 1;
  }
  return sign * best;
}

/** Signed distance to a stack of superellipse sections (a loft with flat caps): the level set of f, divided by its gradient's length (exact for circles). */
function loftDist(t: LoftTables, x: number, y: number, z: number, seg = 0): number {
  const y0 = t.y[0]!;
  const y1 = t.y[t.n - 1]!;
  const yc = y < y0 ? y0 : y > y1 ? y1 : y;
  sectionAt(t, yc);
  const p = S[4]!;
  const rx = S[0]!;
  const rz = S[1]!;
  if (seg > 0) {
    // the loft as DRAWN (a polygon): planar distance to it, corrected for the taper (the surface leans, so the normal distance is shorter)
    const dp = polygonDist(x, z, seg);
    if (y > y0 && y < y1) {
      const e = 0.004;
      sectionAt(t, Math.min(y1, yc + e));
      const dHi = polygonDist(x, z, seg);
      sectionAt(t, Math.max(y0, yc - e));
      const dLo = polygonDist(x, z, seg);
      const lean = (dHi - dLo) / (Math.min(y1, yc + e) - Math.max(y0, yc - e));
      const dn = dp / Math.sqrt(1 + lean * lean);
      const dcap0 = Math.max(y0 - y, y - y1);
      return dn > 0 || dcap0 > 0 ? Math.hypot(dn > 0 ? dn : 0, dcap0 > 0 ? dcap0 : 0) : Math.max(dn, dcap0);
    }
    const dcap = Math.max(y0 - y, y - y1);
    return dp > 0 || dcap > 0 ? Math.hypot(dp > 0 ? dp : 0, dcap > 0 ? dcap : 0) : Math.max(dp, dcap);
  }
  const dx = x - S[2]!;
  const dz = z - S[3]!;
  const a = Math.abs(dx) / rx;
  const b = Math.abs(dz) / rz;
  const s = Math.pow(a, p) + Math.pow(b, p);
  const f = Math.pow(s, 1 / p);
  let d2: number;
  if (f < 1e-6) d2 = -Math.min(rx, rz);
  else {
    const g = Math.pow(f, 1 - p);
    const fx = g * Math.pow(a, p - 1) * (dx < 0 ? -1 : 1) / rx;
    const fz = g * Math.pow(b, p - 1) * (dz < 0 ? -1 : 1) / rz;
    let fy = 0;
    if (y > y0 && y < y1) {
      const e = 1e-3;
      const yy = Math.min(y1, y + e);
      const yl = Math.max(y0, y - e);
      sectionAt(t, yy);
      const fa = superF(x, z);
      sectionAt(t, yl);
      const fb = superF(x, z);
      fy = (fa - fb) / (yy - yl);
    }
    d2 = (f - 1) / (Math.hypot(fx, fz, fy) || 1);
  }
  // the flat caps: a point on a cap face is ON the surface, one beyond it is outside by its distance to the face
  const dc = Math.max(y0 - y, y - y1);
  if (d2 > 0 || dc > 0) return Math.hypot(d2 > 0 ? d2 : 0, dc > 0 ? dc : 0);
  return Math.max(d2, dc);
}

function loftPrim(bone: BoneName, region: Region, rings: readonly Ring[], seg = 0): Prim {
  const t = tablesOf(rings);
  let mx = 0;
  let mz = 0;
  for (let i = 0; i < t.n; i++) {
    mx = Math.max(mx, Math.abs(t.cx[i]!) + t.rx[i]!);
    mz = Math.max(mz, Math.abs(t.cz[i]!) + t.rz[i]!);
  }
  return { bone, region, box: [-mx, t.y[0]!, -mz, mx, t.y[t.n - 1]!, mz], dist: (x, y, z) => loftDist(t, x, y, z, seg) };
}

function ellipsoidPrim(bone: BoneName, region: Region, c: V3, r: V3): Prim {
  const m = Math.min(r[0], r[1], r[2]);
  return {
    bone,
    region,
    box: [c[0] - r[0], c[1] - r[1], c[2] - r[2], c[0] + r[0], c[1] + r[1], c[2] + r[2]],
    dist: (x, y, z) => {
      const q = Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]);
      return (q - 1) * m;
    },
  };
}

function headPrim(shape: HeadShape, R: number): Prim {
  return {
    bone: "head",
    region: "head",
    box: [-R * 1.25, R - R * 1.25, -R * 1.25, R * 1.25, R + R * 1.25, R * 1.25],
    dist: (x, y, z) => {
      const dy = y - R;
      const l = Math.hypot(x, dy, z);
      if (l < 1e-9) return -R;
      return l - shape.radius(x / l, dy / l, z / l);
    },
  };
}

// ---- the field ------------------------------------------------------------------------------------------------------------------------------------------------------

export interface Nearest {
  /** Closest point on the surface, rig space. */
  point: V3;
  /** Outward unit normal there, rig space. */
  normal: V3;
  region: Region;
  /** Signed distance of the query point (negative inside). */
  dist: number;
}

export interface SurfacePoint {
  /** Point on the surface (lifted along the normal), bone space. */
  p: [number, number, number];
  /** Outward unit normal, bone space. */
  n: [number, number, number];
}

export interface WornRings {
  torso?: readonly Ring[];
  pelvis?: readonly Ring[];
  upperArm?: readonly Ring[];
  foreArm?: readonly Ring[];
  upperLeg?: readonly Ring[];
  lowerLeg?: readonly Ring[];
  /** Under a closed coat skirt the thigh is slimmed to a core (limbRings.ts `upperLegRings`): the flesh core under it is then no bigger than the trouser that covers it (else the crease and stripe on it would be 'sunk in the leg'). */
  slimLeg?: boolean;
  /** Extra obstacles for what HANGS from the head (hair, a veil, a beard): torso-frame ring stacks (collar, neckwear, cape, pack slab, yokes; hairBlockers.ts). Region "drape": no wearable's own audit asks for it. */
  drape?: readonly (readonly Ring[])[];
}

export interface BodyField {
  readonly spec: CharacterSpec;
  readonly P: Proportions;
  readonly head: HeadShape;
  /** Bone -> rig matrices in use (rest by default). */
  readonly frames: Readonly<Record<BoneName, Mat16>>;
  /** Signed distance (metres, negative inside) of a rig-space point to the layer's surface. `cap` (default infinity) lets the query stop early: anything farther returns `cap`. */
  sdf(p: V3, layer?: LayerId, cap?: number, only?: readonly Region[]): number;
  /** Same, for a point already in a bone's space (the cheapest query while building; the body is taken at REST frames relative to that bone's own subtree only). */
  sdfBone(bone: BoneName, p: V3, layer?: LayerId, cap?: number): number;
  /** Closest surface point, outward normal, region and distance for a rig-space point. */
  nearest(p: V3, layer?: LayerId): Nearest;
  toRig(bone: BoneName, p: V3): [number, number, number];
  toBone(bone: BoneName, p: V3): [number, number, number];
  toRigDir(bone: BoneName, d: V3): [number, number, number];
  /** The torso's section rings for a layer (bone space, ascending or descending as built): `worn` is the spec's jacket cut, `skin` the fleshy core. */
  torsoRings(layer?: LayerId): readonly Ring[];
  /** A point on the torso surface at height y (bone space), azimuth phi (0 = front, +pi/2 = the character's right), `lift` metres out along the normal. */
  torsoSurface(y: number, phi: number, lift?: number, layer?: LayerId): SurfacePoint;
  /** The section (rx, rz, cx, cz, pow) of the torso at height y. */
  torsoSection(y: number, layer?: LayerId): { rx: number; rz: number; cx: number; cz: number; pow: number };
  /** Same for the sculpted head: `dir` is a direction from the head centre (bone space of the head: centre at (0, R, 0)), `lift` metres out. */
  headSurface(dir: V3, lift?: number): SurfacePoint;
  /** A point on a limb's surface (bone space: the limb hangs down -Y from its joint) at depth y (negative below the joint), azimuth phi, lift out. Bones: upperArm*, foreArm*, upperLeg*, lowerLeg*. */
  limbSurface(bone: BoneName, y: number, phi: number, lift?: number, layer?: LayerId): SurfacePoint;
  /** Radius of the neck where a collar sits (the head's own neck loft). */
  neck: { rx: number; rz: number };
  /** Where the neck meets the torso, torso space (y), and the shoulders' seat (x half-width, y). */
  anchors: { neckY: number; shoulderX: number; shoulderY: number; hipX: number };
  /** A copy of the field bound to other frames (a posed rig). */
  withFrames(frames: Record<BoneName, Mat16>): BodyField;
}

const rest = new WeakMap<Proportions, Record<BoneName, number[]>>();

/** Builds the field. `worn` overrides the worn layer's rings per region (see fit/index.ts, which supplies the real sleeves, trousers and drapes). */
export function makeBodyField(spec: CharacterSpec, worn: WornRings = {}, P: Proportions = computeProportions(spec)): BodyField {
  const R = P.headRadius;
  const shape = headShape(P);
  const r = P.armRadius;
  const legR = 0.1 * P.scale + 0.02;
  const nk = { rx: R * 0.42, rz: R * 0.4 };
  const sc = P.scale;

  // --- skin cores -------------------------------------------------------------------------------------------------------
  const bare = torsoRings(P, 0, 0);
  const core = (rs: readonly Ring[], k: number): Ring[] => rs.map((q) => ({ ...q, rx: q.rx * k, rz: q.rz * k }));
  const torsoCore = core(bare, BODY_CORE);
  const torsoWorn = worn.torso ?? torsoRings(P, 0, spec.jacket);
  const lA = P.armUpper;
  const upperArm: Ring[] = [
    { y: r * 0.5, rx: r * 0.62, rz: r * 0.6 },
    { y: r * 0.15, rx: r * 0.98, rz: r * 0.94, pow: 2.2 },
    { y: -r * 0.15, rx: r * 1.12, rz: r * 1.06, pow: 2.2 },
    { y: -lA * 0.5, rx: r * 0.98, rz: r * 0.94 },
    { y: -lA * 0.92, rx: r * 0.84, rz: r * 0.82 },
    { y: -lA - r * 0.1, rx: r * 0.78, rz: r * 0.78 },
  ];
  const lF = P.armLower;
  const foreArm: Ring[] = [
    { y: r * 0.25, rx: r * 0.78, rz: r * 0.76 },
    { y: -lF * 0.12, rx: r * 0.86, rz: r * 0.82 },
    { y: -lF * 0.4, rx: r * 0.8, rz: r * 0.78 },
    { y: -lF * 0.85, rx: r * 0.62, rz: r * 0.6 },
    { y: -lF - 0.005, rx: r * 0.56, rz: r * 0.54 },
  ];
  const lU = P.legUpper;
  const upperLegFull: Ring[] = [
    { y: 0.02, rx: legR * 0.85, rz: legR * 0.85 },
    { y: -0.03, rx: legR * 1.0, rz: legR * 1.0 },
    { y: -lU * 0.3, rx: legR * 1.0, rz: legR * 0.98 },
    { y: -lU * 0.75, rx: legR * 0.86, rz: legR * 0.84 },
    { y: -lU - 0.02, rx: legR * 0.74, rz: legR * 0.74 },
  ];
  const upperLeg: Ring[] = worn.slimLeg && worn.upperLeg ? upperLegFull.map((q) => { const w = ringAt(worn.upperLeg!, q.y); return { ...q, rx: Math.min(q.rx, w.rx * 0.94), rz: Math.min(q.rz, w.rz * 0.94) }; }) : upperLegFull;
  const lL = P.legLower;
  const lowerLeg: Ring[] = [
    { y: 0.02, rx: legR * 0.74, rz: legR * 0.74 },
    { y: -lL * 0.22, rx: legR * 0.76, rz: legR * 0.8 },
    { y: -lL * 0.6, rx: legR * 0.68, rz: legR * 0.68 },
    { y: -lL + 0.02, rx: legR * 0.56, rz: legR * 0.56 },
  ];
  const hw = P.hipWidth;
  const bf = P.bellyForward;
  const D = P.torsoDepth / 2;
  const pelvisCore: Ring[] = [
    { y: 0.09 * sc, rx: Math.max(P.torsoWidth / 2 + P.bellyRadius * 0.5, P.shoulderHalfWidth * 0.74) * 0.82, rz: D * 0.7, cz: -bf * 0.12 },
    { y: -0.02 * sc, rx: (hw + legR * 0.9), rz: D * 0.72 },
    { y: -0.12 * sc, rx: (hw + legR * 0.8), rz: D * 0.6 },
  ];
  const neckLoft: Ring[] = [
    { y: -(P.neck + 0.03), rx: R * 0.46, rz: R * 0.44 },
    { y: R * 0.25, rx: R * 0.44, rz: R * 0.42 },
  ];

  const skin: Prim[] = [
    loftPrim("torso", "torso", torsoCore),
    loftPrim("pelvis", "pelvis", pelvisCore),
    loftPrim("head", "neck", neckLoft),
    headPrim(shape, R),
  ];
  const wornPrims: Prim[] = [
    loftPrim("torso", "torso", torsoWorn, TORSO_SEGMENTS),
    loftPrim("pelvis", "pelvis", worn.pelvis ?? core(pelvisCore, CLOTH_ALLOWANCE)),
    loftPrim("head", "neck", neckLoft),
    headPrim(shape, R),
  ];
  for (const rings of worn.drape ?? []) wornPrims.push(loftPrim("torso", "drape", rings));
  const handC: V3 = [0, -P.handRadius * 0.85, -P.handRadius * 0.05]; // (the hand bone's frame: origin at the wrist)
  const handR: V3 = [P.handRadius * 0.6, P.handRadius * 0.95, P.handRadius * 0.65];
  for (const side of ["L", "R"] as const) {
    skin.push(
      loftPrim(`upperArm${side}`, "upperArm", upperArm),
      loftPrim(`foreArm${side}`, "foreArm", foreArm),
      ellipsoidPrim(`hand${side}`, "hand", handC, handR),
      loftPrim(`upperLeg${side}`, "upperLeg", upperLeg),
      loftPrim(`lowerLeg${side}`, "lowerLeg", lowerLeg),
    );
    wornPrims.push(
      loftPrim(`upperArm${side}`, "upperArm", worn.upperArm ?? core(upperArm, CLOTH_ALLOWANCE)),
      loftPrim(`foreArm${side}`, "foreArm", worn.foreArm ?? core(foreArm, CLOTH_ALLOWANCE)),
      ellipsoidPrim(`hand${side}`, "hand", handC, handR),
      loftPrim(`upperLeg${side}`, "upperLeg", worn.upperLeg ?? core(upperLeg, CLOTH_ALLOWANCE)),
      loftPrim(`lowerLeg${side}`, "lowerLeg", worn.lowerLeg ?? core(lowerLeg, CLOTH_ALLOWANCE)),
    );
  }

  const ringsOf = (bone: BoneName, layer: LayerId): readonly Ring[] => {
    if (bone === "torso") return layer === "skin" ? torsoCore : torsoWorn;
    const w = layer === "worn";
    if (bone.startsWith("upperArm")) return w ? (worn.upperArm ?? core(upperArm, CLOTH_ALLOWANCE)) : upperArm;
    if (bone.startsWith("foreArm")) return w ? (worn.foreArm ?? core(foreArm, CLOTH_ALLOWANCE)) : foreArm;
    if (bone.startsWith("upperLeg")) return w ? (worn.upperLeg ?? core(upperLeg, CLOTH_ALLOWANCE)) : upperLeg;
    if (bone.startsWith("lowerLeg")) return w ? (worn.lowerLeg ?? core(lowerLeg, CLOTH_ALLOWANCE)) : lowerLeg;
    if (bone === "pelvis") return w ? (worn.pelvis ?? core(pelvisCore, CLOTH_ALLOWANCE)) : pelvisCore;
    return neckLoft;
  };
  const surfaceFns = new Map<string, ReturnType<typeof ringSurface>>();
  const surfaceOf = (bone: BoneName, layer: LayerId): ReturnType<typeof ringSurface> => {
    const key = `${bone.replace(/[LR]$/, "")}|${layer}`;
    let fn = surfaceFns.get(key);
    if (!fn) surfaceFns.set(key, (fn = ringSurface([...ringsOf(bone, layer)].sort((a, b) => a.y - b.y))));
    return fn;
  };

  const make = (frames: Record<BoneName, Mat16>): BodyField => {
    // inverse of a rigid frame: transpose the rotation, negate the rotated translation
    const inv = {} as Record<BoneName, Float64Array>;
    for (const b of BONES) {
      const m = frames[b];
      const o = new Float64Array(12);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = m[i * 4 + j]!; // rows of R^T (R[j][i] in column-major is m[i*4+j])
      for (let i = 0; i < 3; i++) o[9 + i] = -(o[i * 3]! * m[12]! + o[i * 3 + 1]! * m[13]! + o[i * 3 + 2]! * m[14]!);
      inv[b] = o;
    }
    const toBoneXYZ = (bone: BoneName, x: number, y: number, z: number, out: number[]): void => {
      const o = inv[bone];
      out[0] = o[0]! * x + o[1]! * y + o[2]! * z + o[9]!;
      out[1] = o[3]! * x + o[4]! * y + o[5]! * z + o[10]!;
      out[2] = o[6]! * x + o[7]! * y + o[8]! * z + o[11]!;
    };
    const tmp = [0, 0, 0];
    const sdf = (p: V3, layer: LayerId = "skin", cap = Infinity, only?: readonly Region[]): number => {
      const prims = layer === "skin" ? skin : wornPrims;
      let best = cap;
      for (const q of prims) {
        if (only && !only.includes(q.region)) continue;
        toBoneXYZ(q.bone, p[0], p[1], p[2], tmp);
        const [x, y, z] = tmp as [number, number, number];
        if (best < Infinity) {
          // cull: the box's distance is a lower bound of the primitive's
          const b = q.box;
          const ex = Math.max(b[0] - x, 0, x - b[3]);
          const ey = Math.max(b[1] - y, 0, y - b[4]);
          const ez = Math.max(b[2] - z, 0, z - b[5]);
          if (ex * ex + ey * ey + ez * ez >= best * best && best >= 0) continue;
        }
        const d = q.dist(x, y, z);
        if (d < best) best = d;
      }
      return best;
    };
    const sdfBone = (bone: BoneName, p: V3, layer: LayerId = "skin", cap = Infinity): number => {
      const m = frames[bone];
      const w: V3 = [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!];
      return sdf(w, layer, cap);
    };
    const toRig = (bone: BoneName, p: V3): [number, number, number] => {
      const m = frames[bone];
      return [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!];
    };
    const toRigDir = (bone: BoneName, d: V3): [number, number, number] => {
      const m = frames[bone];
      return [m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2], m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2], m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2]];
    };
    const toBone = (bone: BoneName, p: V3): [number, number, number] => {
      const o: number[] = [0, 0, 0];
      toBoneXYZ(bone, p[0], p[1], p[2], o);
      return o as [number, number, number];
    };
    const nearest = (p: V3, layer: LayerId = "skin"): Nearest => {
      const d0 = sdf(p, layer);
      const e = 0.004;
      const g = (i: 0 | 1 | 2): number => {
        const a: [number, number, number] = [p[0], p[1], p[2]];
        const b: [number, number, number] = [p[0], p[1], p[2]];
        a[i] += e;
        b[i] -= e;
        return sdf(a, layer) - sdf(b, layer);
      };
      let nx = g(0);
      let ny = g(1);
      let nz = g(2);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const point: [number, number, number] = [p[0] - nx * d0, p[1] - ny * d0, p[2] - nz * d0];
      // region: which primitive is closest at the surface point
      let region: Region = "torso";
      let best = Infinity;
      for (const q of layer === "skin" ? skin : wornPrims) {
        const b = toBone(q.bone, point);
        const d = Math.abs(q.dist(b[0], b[1], b[2]));
        if (d < best) {
          best = d;
          region = q.region;
        }
      }
      return { point, normal: [nx, ny, nz], region, dist: d0 };
    };
    const torsoSection = (y: number, layer: LayerId = "worn"): { rx: number; rz: number; cx: number; cz: number; pow: number } => {
      const t = tablesOf(ringsOf("torso", layer));
      const yc = Math.min(t.y[t.n - 1]!, Math.max(t.y[0]!, y));
      sectionAt(t, yc);
      return { rx: S[0]!, rz: S[1]!, cx: S[2]!, cz: S[3]!, pow: S[4]! };
    };
    const field: BodyField = {
      spec,
      P,
      head: shape,
      frames,
      sdf,
      sdfBone,
      nearest,
      toRig,
      toBone,
      toRigDir,
      torsoRings: (layer: LayerId = "worn") => ringsOf("torso", layer),
      torsoSurface: (y, phi, lift = 0, layer = "worn") => surfaceOf("torso", layer)(phi, y, lift),
      torsoSection,
      headSurface: (dir, lift = 0) => {
        const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const rr = shape.radius(dir[0] / l, dir[1] / l, dir[2] / l);
        const c: V3 = [(dir[0] / l) * rr, (dir[1] / l) * rr, (dir[2] / l) * rr]; // centre-relative skin point
        const n = shape.normal(c);
        return { p: [c[0] + n[0] * lift, R + c[1] + n[1] * lift, c[2] + n[2] * lift], n };
      },
      limbSurface: (bone, y, phi, lift = 0, layer = "worn") => surfaceOf(bone, layer)(phi, y, lift),
      neck: nk,
      anchors: { neckY: P.torsoHeight * 0.985, shoulderX: P.shoulderHalfWidth, shoulderY: P.torsoHeight * 0.88, hipX: P.hipWidth },
      withFrames: (f) => make(f),
    };
    return field;
  };
  let frames = rest.get(P);
  if (!frames) rest.set(P, (frames = restFrames(P)));
  return make(frames);
}
