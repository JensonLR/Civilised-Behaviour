import { Mesh, type BufferGeometry } from "three";
import { FLAG } from "@cb/shared";
import { FIELDS, type CharacterSpec, type FieldDef, type FieldKey } from "../../spec.ts";
import { CharacterAnimator } from "../animator.ts";
import { PartBuilder, type PrimitiveAudit } from "../parts.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "../rig.ts";
import { BONES, framesFromRig, type BodyField, type BoneName, type Region, type V3 } from "./bodyField.ts";
import { FIT_TOL } from "./layers.ts";
import { bodyField } from "./worn.ts";

/**
 * The fit audit: REAL interpenetration and floating, measured against the body field (bodyField.ts) instead of bounding boxes.
 *
 * `measure(spec)` builds the character at LOD0 with the primitive audit on and hands back every primitive with its vertices (bone space), so the tests can ask, per
 * primitive: how deep does it sink into the layer beneath it, does it float clear of everything, does it clip a limb when the body moves. Findings are tagged
 * {metric, field, option, shape, bone, kind, ...} and ranked into a report (`FitReport`, written to test-results/fit-report.json by fit.test.ts).
 */

/** Primitive kinds that are cloth / flexible surfaces; everything else (box, sphere, cylinder, cone, torus, button) is a hard piece. */
const CLOTH_KINDS = new Set(["loft", "sweep", "patch"]);
export const isCloth = (kind: string): boolean => CLOTH_KINDS.has(kind);

/** Fields whose primitives are the body's own garment layer (measured against the skin core); everything else is an accessory laid on the worn surface. */
/** Fields that REPLACE a limb (a hook for a hand, a peg for a shin): they stand where the flesh core would be, so they are not judged for penetration (only for floating and pose clipping). */
export const REPLACEMENT_FIELDS: ReadonlySet<string> = new Set(["woodenLeg", "hook"]);
export const GARMENT_FIELDS: ReadonlySet<string> = new Set(["jacket", "shirt", "trousers", "boots", "gloves", "burnt", "woodenLeg", "hook"]);
/** Fields that live on the head bone (measured against the sculpted head; the hat, hair and beard stack there, see agent H's tests for that stack). */
export const HEAD_FIELDS: ReadonlySet<string> = new Set([
  "noseStyle", "hair", "moustache", "beard", "sideburns", "hat", "eyewear", "brows", "eyeShape", "eyeColor", "earShape", "stubble", "greying", "complexion", "mark", "facePaint", "tattoo",
  "earring", "hatTrim", "hairAcc", "eyepatch", "scars", "teeth", "patchStyle", "scarStyle", "age", "noseScale", "earScale", "jaw", "headScale",
]);

export interface FitPrim {
  id: number;
  bone: BoneName;
  kind: string;
  triangles: number;
  /** Vertex positions, bone space (3 per vertex). */
  local: Float32Array;
  /** Vertex normals, bone space (3 per vertex): a buried vertex whose normal points INTO the body is a hidden face (a hat's underside, a lining), not clipping. */
  nrm: Float32Array;
  /** 1 for the centre vertex of a cap fan (buried inside its own closed form by construction): never counted as clipping. */
  fan: Uint8Array;
  /** Triangle centroids, bone space (3 per triangle, capped): extra samples for floating and sinking on large flat pieces. */
  cent: Float32Array;
  /** Bone-space bounding box. */
  min: V3;
  max: V3;
  /** Identity for diffing two builds: bone, kind, size and where it is. */
  key: string;
  /** Buried in its base by design (a collar's foot in the shoulder slope): not judged for penetration. */
  anchored: boolean;
}

export interface Measured {
  spec: CharacterSpec;
  rig: CharacterRig;
  field: BodyField;
  prims: FitPrim[];
  /** Prims grouped by bone. */
  byBone: Map<BoneName, FitPrim[]>;
}

const isBone = (t: string): t is BoneName => (BONES as readonly string[]).includes(t);

/** Builds the character (LOD0, no outline) with the audit on and returns its primitives with vertices. The caller owns `rig` (dispose it). */
export function measure(spec: CharacterSpec): Measured {
  // (the primitive audit only sees bones that are actually built, so a cache hit would silently drop a bone's primitives)
  clearCharacterCaches();
  PartBuilder.audit = [];
  let rig: CharacterRig;
  let audit: PrimitiveAudit[];
  try {
    rig = buildCharacter(spec, { outline: false, lod: 0 });
    audit = PartBuilder.audit;
  } finally {
    PartBuilder.audit = undefined;
  }
  const geoOf = new Map<string, BufferGeometry>();
  rig.root.traverse((o) => {
    if (o instanceof Mesh && o.name.startsWith("mesh_")) geoOf.set(o.name.slice(5), o.geometry);
  });
  const prims: FitPrim[] = [];
  const byBone = new Map<BoneName, FitPrim[]>();
  const cursor = new Map<string, { v: number; t: number }>();
  for (const a of audit) {
    const cur = cursor.get(a.tag) ?? { v: 0, t: 0 };
    cursor.set(a.tag, cur);
    const v0 = cur.v;
    const t0 = cur.t;
    cur.v += a.vertices;
    cur.t += a.triangles;
    if (!isBone(a.tag)) continue;
    const geo = geoOf.get(a.tag);
    if (!geo) continue;
    const pos = geo.attributes.position!;
    const local = new Float32Array(a.vertices * 3);
    const nrm = new Float32Array(a.vertices * 3);
    const nat = geo.attributes.normal;
    for (let i = 0; i < a.vertices; i++) {
      local[i * 3] = pos.getX(v0 + i);
      local[i * 3 + 1] = pos.getY(v0 + i);
      local[i * 3 + 2] = pos.getZ(v0 + i);
      if (nat) {
        nrm[i * 3] = nat.getX(v0 + i);
        nrm[i * 3 + 1] = nat.getY(v0 + i);
        nrm[i * 3 + 2] = nat.getZ(v0 + i);
      }
    }
    const ix = geo.index;
    const nT = Math.min(a.triangles, 400);
    const stride = a.triangles / nT;
    const cent = new Float32Array(nT * 3);
    if (ix) {
      for (let k = 0; k < nT; k++) {
        const t = Math.floor(k * stride) + t0;
        const i0 = ix.getX(t * 3);
        const i1 = ix.getX(t * 3 + 1);
        const i2 = ix.getX(t * 3 + 2);
        cent[k * 3] = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
        cent[k * 3 + 1] = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
        cent[k * 3 + 2] = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
      }
    }
    const fan = new Uint8Array(a.vertices);
    if (ix) {
      const deg = new Uint16Array(a.vertices);
      const tri = a.triangles;
      for (let t = 0; t < tri; t++) for (let c = 0; c < 3; c++) deg[ix.getX((t0 + t) * 3 + c) - v0]!++;
      const nb = new Map<number, number[]>();
      for (let t = 0; t < tri; t++) {
        const ids = [ix.getX((t0 + t) * 3) - v0, ix.getX((t0 + t) * 3 + 1) - v0, ix.getX((t0 + t) * 3 + 2) - v0];
        for (const v of ids) if (deg[v]! >= 6) (nb.get(v) ?? nb.set(v, []).get(v)!).push(...ids.filter((o) => o !== v));
      }
      for (const [v, others] of nb) if (others.every((o) => deg[o]! <= 3)) fan[v] = 1;
    }
    const r = (n: number): number => Math.round(n * 1000);
    const p: FitPrim = {
      id: prims.length,
      bone: a.tag,
      kind: a.kind,
      triangles: a.triangles,
      local,
      nrm,
      fan,
      cent,
      min: a.min,
      max: a.max,
      anchored: a.anchored === true,
      key: `${a.tag}|${a.kind}|${a.triangles}|${r(a.min[0])},${r(a.min[1])},${r(a.min[2])}|${r(a.max[0])},${r(a.max[1])},${r(a.max[2])}`,
    };
    prims.push(p);
    (byBone.get(a.tag) ?? byBone.set(a.tag, []).get(a.tag)!).push(p);
  }
  rig.root.updateMatrixWorld(true);
  return { spec, rig, field: bodyField(spec), prims, byBone };
}

/**
 * The primitives of `withOption` that `base` does not have: what one option added or changed. A primitive matches one of the base's when bone, kind and triangle count are
 * equal and its bounding box is within 1.5 mm (a rounded key would split identical parts whose coordinates straddle a rounding boundary).
 */
export function addedPrims(base: readonly FitPrim[], withOption: readonly FitPrim[]): FitPrim[] {
  const groups = new Map<string, FitPrim[]>();
  const gk = (p: FitPrim): string => `${p.bone}|${p.kind}|${p.triangles}`;
  for (const p of base) (groups.get(gk(p)) ?? groups.set(gk(p), []).get(gk(p))!).push(p);
  const out: FitPrim[] = [];
  for (const p of withOption) {
    const list = groups.get(gk(p));
    let hit = -1;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const q = list[i]!;
        let d = 0;
        for (let a = 0; a < 3; a++) d = Math.max(d, Math.abs(p.min[a]! - q.min[a]!), Math.abs(p.max[a]! - q.max[a]!));
        if (d < 0.0015) {
          hit = i;
          break;
        }
      }
    }
    if (hit >= 0) list!.splice(hit, 1);
    else out.push(p);
  }
  return out;
}

// ---- measurements ------------------------------------------------------------------------------------------------------------------------------------------------

export interface PrimMetrics {
  /** Deepest vertex inside the skin core / the worn surface (metres, >= 0), and where (rig space). */
  depthSkin: number;
  depthWorn: number;
  at: V3;
  /** Smallest signed distance of any sample (vertices and triangle centroids) to the worn surface / the skin. Small = touching. */
  gapWorn: number;
  gapSkin: number;
  /** Signed distance of the primitive's centre to the worn surface (negative = the centre is buried). */
  centreWorn: number;
  /** Smallest side of the bone-space bounding box: how thick the piece is. */
  thickness: number;
}

const CAP = 0.08;

/**
 * Which parts of the body a primitive of this bone is judged against at REST. The rig's rest pose hangs the arms straight down beside the thighs, where the animator never
 * leaves them, so a limb piece is judged against its OWN limb only (limb-vs-body clipping is `judgePoseClip`'s job, in the poses that really happen).
 */
export function familyRegions(bone: BoneName, layer: "skin" | "worn" = "worn"): readonly Region[] {
  if (bone === "torso") return layer === "skin" ? ["torso", "neck"] : ["torso", "neck", "head", "pelvis"]; // (the trunk's own garments sit over the torso; gear hangs over the coat skirt)
  if (bone === "pelvis") return layer === "skin" ? ["pelvis", "upperLeg"] : ["pelvis", "upperLeg"]; // (a skirt or a trouser top clears the pelvis and the thighs; the torso above overlaps it by design)
  if (bone === "head") return layer === "skin" ? HEAD_SKIN : ["head", "neck", "torso"];
  if (bone.startsWith("upperArm")) return ["upperArm"];
  if (bone.startsWith("foreArm")) return ["foreArm", "hand"];
  if (bone.startsWith("upperLeg")) return ["upperLeg"];
  return ["lowerLeg"];
}
const HEAD_SKIN: readonly Region[] = ["head", "neck"];
const p3: [number, number, number] = [0, 0, 0];

const gp: [number, number, number] = [0, 0, 0];
/** True when the vertex's normal points against the body's outward direction there (into the body). */
function facesInward(field: BodyField, p: FitPrim, vi: number, r: V3, layer: "skin" | "worn", fam: readonly Region[]): boolean {
  const e = 0.004;
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let a = 0; a < 3; a++) {
    gp[0] = r[0];
    gp[1] = r[1];
    gp[2] = r[2];
    gp[a] = r[a]! + e;
    const hi = field.sdf(gp, layer, CAP, fam);
    gp[a] = r[a]! - e;
    const lo = field.sdf(gp, layer, CAP, fam);
    if (a === 0) gx = hi - lo;
    else if (a === 1) gy = hi - lo;
    else gz = hi - lo;
  }
  const gl = Math.hypot(gx, gy, gz) || 1;
  const nb = field.toRigDir(p.bone, [p.nrm[vi * 3]!, p.nrm[vi * 3 + 1]!, p.nrm[vi * 3 + 2]!]);
  return (nb[0] * gx + nb[1] * gy + nb[2] * gz) / gl < -0.2;
}

/** Depth and gap measurements of one primitive against the field (at the field's frames). */
export function primMetrics(field: BodyField, p: FitPrim): PrimMetrics {
  let depthSkin = 0;
  let depthWorn = 0;
  let gapWorn = CAP;
  let gapSkin = CAP;
  let at: V3 = [0, 0, 0];
  const n = p.local.length / 3;
  const step = n > 300 ? Math.ceil(n / 300) : 1;
  // (things on the head - a beard, hair, a hat brim - are judged against the head and neck as skin, and against the head, neck and the coat as the worn surface)
  const fam = familyRegions(p.bone, "worn");
  const famSkin = familyRegions(p.bone, "skin");
  const one = (x: number, y: number, z: number, verts: boolean, vi = -1): void => {
    const r = field.toRig(p.bone, [x, y, z]);
    const w = field.sdf(r, "worn", CAP, fam);
    const s = field.sdf(r, "skin", CAP, famSkin);
    if (w < gapWorn) gapWorn = w;
    if (s < gapSkin) gapSkin = s;
    if (verts && (s < -depthSkin || w < -depthWorn) && !(vi >= 0 && p.fan[vi])) {
      // a buried vertex whose normal points into the body is a hidden face (under a hat, the back of a lining): it is not clipping
      if (vi >= 0 && facesInward(field, p, vi, r, s < w ? "skin" : "worn", s < w ? famSkin : fam)) return;
      if (-s > depthSkin) {
        depthSkin = -s;
        if (s < w) at = r;
      }
      if (-w > depthWorn) {
        depthWorn = -w;
        if (w <= s) at = r;
      }
    }
  };
  for (let i = 0; i < n; i += step) one(p.local[i * 3]!, p.local[i * 3 + 1]!, p.local[i * 3 + 2]!, true, i);
  for (let i = 0; i < p.cent.length / 3; i++) one(p.cent[i * 3]!, p.cent[i * 3 + 1]!, p.cent[i * 3 + 2]!, false);
  p3[0] = (p.min[0] + p.max[0]) / 2;
  p3[1] = (p.min[1] + p.max[1]) / 2;
  p3[2] = (p.min[2] + p.max[2]) / 2;
  const centreWorn = field.sdf(field.toRig(p.bone, p3), "worn", CAP, fam);
  const thickness = Math.min(p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]);
  return { depthSkin, depthWorn, at, gapWorn, gapSkin, centreWorn, thickness };
}

export type Metric = "garmentPenetration" | "accessoryPenetration" | "accessorySink" | "floating" | "poseClip" | "poseExtreme" | "headPenetration";

export interface Finding {
  metric: Metric;
  /** Millimetre-precise value in metres (depth, gap or new penetration). */
  value: number;
  tol: number;
  field: string;
  option: number;
  optionName: string;
  shape: string;
  bone: string;
  kind: string;
  at: [number, number, number];
  /** Free text: which pose, which region. */
  note?: string;
}

export interface Tag {
  field: string;
  option: number;
  optionName: string;
  shape: string;
}

const optionName = (field: string, v: number): string => {
  const def = (FIELDS as readonly FieldDef[]).find((f) => f.key === field);
  return def?.options?.[v] ?? String(v);
};
export const makeTag = (field: string, option: number, shape: string): Tag => ({ field, option, optionName: optionName(field, option), shape });

/**
 * Penetration and sink findings for a set of primitives (`subset`, e.g. the primitives one option added) that belong to `field`.
 * Garment fields are measured against the skin core; accessory fields against the outermost garment (worn surface); head fields against the sculpted head.
 */
export function judgePenetration(m: Measured, subset: readonly FitPrim[], tag: Tag): Finding[] {
  const out: Finding[] = [];
  if (REPLACEMENT_FIELDS.has(tag.field)) return out;
  const garment = GARMENT_FIELDS.has(tag.field);
  const head = HEAD_FIELDS.has(tag.field);
  for (const p of subset) {
    if (p.anchored) continue;
    const k = primMetrics(m.field, p);
    const base = { field: tag.field, option: tag.option, optionName: tag.optionName, shape: tag.shape, bone: p.bone, kind: p.kind, at: [...k.at] as [number, number, number] };
    const cloth = isCloth(p.kind);
    if (garment || head) {
      const tol = cloth ? FIT_TOL.cloth : FIT_TOL.hard;
      // a garment's own primitives are the surface: measured against the skin core. Hard pieces of a garment (buckles, spurs, buttons) sink their own half thickness.
      const depth = cloth ? k.depthSkin : Math.max(0, k.depthSkin - k.thickness * 0.5);
      if (depth > tol) out.push({ ...base, metric: head ? "headPenetration" : "garmentPenetration", value: depth, tol });
    } else if (cloth) {
      if (k.depthWorn > FIT_TOL.strap) out.push({ ...base, metric: "accessoryPenetration", value: k.depthWorn, tol: FIT_TOL.strap });
    } else {
      // (a torus is a ring round something: its centre is meant to be inside the thing it encircles)
      const sink = p.kind === "torus" ? 0 : Math.max(0, -k.centreWorn - k.thickness * 0.5);
      if (sink > FIT_TOL.hard) out.push({ ...base, metric: "accessorySink", value: sink, tol: FIT_TOL.hard });
    }
  }
  return out;
}

/**
 * Floating findings: a group of primitives (connected by touching bounding boxes) of `subset` that neither touches the body (within FIT_TOL.float of the worn
 * surface or the skin) nor any other primitive of the same bone hangs in the air. `others` are the rest of the character's primitives.
 */
export function judgeFloating(m: Measured, subset: readonly FitPrim[], tag: Tag): Finding[] {
  if (subset.length === 0) return [];
  const tol = FIT_TOL.float;
  const inSubset = new Set(subset.map((p) => p.id));
  const metrics = subset.map((p) => primMetrics(m.field, p));
  // spatial hash of the other primitives' samples, per bone
  const cell = tol;
  const hashes = new Map<BoneName, Map<string, number>>();
  const hashOf = (bone: BoneName): Map<string, number> => {
    let h = hashes.get(bone);
    if (h) return h;
    h = new Map();
    for (const q of m.byBone.get(bone) ?? []) {
      if (inSubset.has(q.id)) continue;
      for (const arr of [q.local, q.cent]) {
        for (let i = 0; i < arr.length; i += 3) {
          const key = `${Math.floor(arr[i]! / cell)},${Math.floor(arr[i + 1]! / cell)},${Math.floor(arr[i + 2]! / cell)}`;
          h.set(key, 1);
        }
      }
    }
    hashes.set(bone, h);
    return h;
  };
  const near = (p: FitPrim): boolean => {
    const h = hashOf(p.bone);
    if (h.size === 0) return false;
    const test = (x: number, y: number, z: number): boolean => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (h.has(`${cx + dx},${cy + dy},${cz + dz}`)) return true;
      return false;
    };
    const stride = Math.max(1, Math.floor(p.local.length / 3 / 120));
    for (let i = 0; i < p.local.length; i += 3 * stride) if (test(p.local[i]!, p.local[i + 1]!, p.local[i + 2]!)) return true;
    for (let i = 0; i < p.cent.length; i += 3) if (test(p.cent[i]!, p.cent[i + 1]!, p.cent[i + 2]!)) return true;
    return false;
  };
  const touches = subset.map((p, i) => Math.min(metrics[i]!.gapWorn, metrics[i]!.gapSkin) <= tol || near(p));
  // union-find over bounding-box contact (same bone)
  const parent = subset.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < subset.length; i++) {
    for (let j = i + 1; j < subset.length; j++) {
      const a = subset[i]!;
      const b = subset[j]!;
      if (a.bone !== b.bone) continue;
      if (a.min[0] <= b.max[0] + tol && b.min[0] <= a.max[0] + tol && a.min[1] <= b.max[1] + tol && b.min[1] <= a.max[1] + tol && a.min[2] <= b.max[2] + tol && b.min[2] <= a.max[2] + tol) parent[find(i)] = find(j);
    }
  }
  const okRoot = new Set<number>();
  subset.forEach((_, i) => touches[i] && okRoot.add(find(i)));
  const out: Finding[] = [];
  const worstOf = new Map<number, number>();
  subset.forEach((_, i) => {
    const r = find(i);
    if (okRoot.has(r)) return;
    const gap = Math.min(metrics[i]!.gapWorn, metrics[i]!.gapSkin);
    worstOf.set(r, Math.min(worstOf.get(r) ?? Infinity, gap));
  });
  for (const [root, gap] of worstOf) {
    const p = subset[root]!;
    const c = m.field.toRig(p.bone, [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2]);
    out.push({ metric: "floating", value: gap, tol, field: tag.field, option: tag.option, optionName: tag.optionName, shape: tag.shape, bone: p.bone, kind: p.kind, at: c });
  }
  return out;
}

// ---- poses --------------------------------------------------------------------------------------------------------------------------------------------------------

type JointName = "hipL" | "hipR" | "kneeL" | "kneeR" | "shoulderL" | "shoulderR" | "elbowL" | "elbowR" | "torso" | "pelvis";
export interface PoseDef {
  name: string;
  /** Euler rotations (x, y, z radians) per joint, applied on top of the rest pose. */
  set?: Partial<Record<JointName, readonly [number, number, number]>>;
  /** Or run the animator into a state: [flags, speed, seconds]. */
  animate?: { flags: number; speed: number; frames: number };
  /** "game": a pose the animator really produces (judged as poseClip); "extreme": the limit of a joint's range, beyond what play reaches (judged as poseExtreme, looser). */
  tier: "game" | "extreme";
}

/** Pose extremes: every direction each limb can go, and the animator's locomotion states. */
export const POSES: readonly PoseDef[] = [
  { name: "arms swing forward", set: { shoulderL: [1.5, 0, 0], shoulderR: [1.5, 0, 0], elbowL: [1.2, 0, 0], elbowR: [1.2, 0, 0] }, tier: "extreme" },
  { name: "arms swing back", set: { shoulderL: [-1.1, 0, 0], shoulderR: [-1.1, 0, 0] }, tier: "extreme" },
  { name: "arms out", set: { shoulderL: [0, 0, -1.4], shoulderR: [0, 0, 1.4] }, tier: "extreme" },
  { name: "arms out and forward", set: { shoulderL: [0.9, 0, -0.9], shoulderR: [0.9, 0, 0.9], elbowL: [0.6, 0, 0], elbowR: [0.6, 0, 0] }, tier: "extreme" },
  { name: "arms across", set: { shoulderL: [0.6, 0, 0.6], shoulderR: [0.6, 0, -0.6], elbowL: [1.9, 0, 0], elbowR: [1.9, 0, 0] }, tier: "extreme" },
  { name: "elbows flexed", set: { elbowL: [2.4, 0, 0], elbowR: [2.4, 0, 0] }, tier: "extreme" },
  { name: "stride", set: { hipL: [0.85, 0, 0], hipR: [-0.5, 0, 0], kneeR: [-0.9, 0, 0] }, tier: "extreme" },
  { name: "high knee", set: { hipL: [1.5, 0, -0.1], kneeL: [-1.7, 0, 0], hipR: [-0.1, 0, 0] }, tier: "extreme" },
  { name: "splay", set: { hipL: [0.2, 0, -0.5], hipR: [0.2, 0, 0.5] }, tier: "extreme" },
  { name: "deep crouch", set: { hipL: [1.6, 0, -0.15], hipR: [1.6, 0, 0.15], kneeL: [-2.3, 0, 0], kneeR: [-2.3, 0, 0], torso: [-0.5, 0, 0] }, tier: "extreme" },
  { name: "sprint lean", set: { torso: [-0.45, 0, 0], shoulderL: [-0.8, 0, 0], shoulderR: [1.2, 0, 0], hipL: [0.9, 0, 0], hipR: [-0.6, 0, 0] }, tier: "extreme" },
  { name: "twist", set: { torso: [0, 0.6, 0], shoulderL: [0.7, 0, 0], shoulderR: [-0.7, 0, 0] }, tier: "extreme" },
  { name: "idle", animate: { flags: FLAG.GROUNDED, speed: 0, frames: 30 }, tier: "game" },
  { name: "walk", animate: { flags: FLAG.GROUNDED, speed: 2.2, frames: 47 }, tier: "game" },
  { name: "run", animate: { flags: FLAG.GROUNDED, speed: 5.5, frames: 41 }, tier: "game" },
  { name: "sprint", animate: { flags: FLAG.GROUNDED | FLAG.SPRINTING, speed: 7.5, frames: 43 }, tier: "game" },
  { name: "crouch", animate: { flags: FLAG.GROUNDED | FLAG.CROUCHING, speed: 0, frames: 30 }, tier: "game" },
  { name: "kneel", animate: { flags: FLAG.GROUNDED | FLAG.REVIVING, speed: 0, frames: 40 }, tier: "game" },
  { name: "carry", animate: { flags: FLAG.GROUNDED | FLAG.CARRYING, speed: 2, frames: 40 }, tier: "game" },
  { name: "airborne", animate: { flags: 0, speed: 3, frames: 20 }, tier: "game" },
];

const JOINT_OF = (rig: CharacterRig, j: JointName) => (j === "torso" ? rig.joints.torso : j === "pelvis" ? rig.joints.pelvis : rig.joints[j]);

/** Puts the rig into a pose and returns its frames. Resets every joint first. */
export function poseRig(rig: CharacterRig, pose: PoseDef): ReturnType<typeof framesFromRig> {
  const j = rig.joints;
  const reset: JointName[] = ["hipL", "hipR", "kneeL", "kneeR", "shoulderL", "shoulderR", "elbowL", "elbowR"];
  for (const n of reset) JOINT_OF(rig, n).rotation.set(0, 0, 0);
  j.pelvis.rotation.set(0, 0, 0);
  const lean = rig.proportions.lean;
  j.torso.rotation.set(-lean, 0, 0);
  if (pose.animate) {
    const a = new CharacterAnimator(rig);
    a.autoBlink = false;
    for (let i = 0; i < pose.animate.frames; i++) a.update(1 / 30, { speed: pose.animate.speed, flags: pose.animate.flags, vy: 0 });
  } else if (pose.set) {
    for (const [n, r] of Object.entries(pose.set) as [JointName, readonly [number, number, number]][]) {
      const o = JOINT_OF(rig, n);
      if (n === "torso") o.rotation.set(-lean + r[0], r[1], r[2]);
      else o.rotation.set(r[0], r[1], r[2]);
    }
  }
  rig.root.updateMatrixWorld(true);
  return framesFromRig(rig);
}

const LIMB_REGIONS: readonly Region[] = ["upperArm", "foreArm", "hand", "upperLeg", "lowerLeg"];
const ARM_REGIONS: readonly Region[] = ["upperArm", "foreArm", "hand"];
const LEG_REGIONS: readonly Region[] = ["upperLeg", "lowerLeg"];
const TRUNK_REGIONS: readonly Region[] = ["torso", "pelvis"];
const LIMB_BONES = new Set<BoneName>(["upperArmL", "upperArmR", "foreArmL", "foreArmR", "upperLegL", "upperLegR", "lowerLegL", "lowerLegR"]);
const ARM_BONES = new Set<BoneName>(["upperArmL", "upperArmR", "foreArmL", "foreArmR"]);

/**
 * How far the BARE limbs of a posed body overlap the bare trunk (arms and legs separately): a big belly under a "carry" pose has the forearms inside it whatever anyone wears. That is
 * the animator's business, not a garment's, so it is subtracted from what a garment is blamed for (a coat sleeve inside a belly-deep forearm is not the coat's fault).
 */
function bodyOverlap(posed: BodyField): { arm: number; leg: number } {
  const out = { arm: 0, leg: 0 };
  const list: [BoneName, number][] = [["upperArmL", -1], ["upperArmR", -1], ["foreArmL", -1], ["foreArmR", -1], ["upperLegL", -1], ["upperLegR", -1], ["lowerLegL", -1], ["lowerLegR", -1]];
  for (const [bone] of list) {
    const len = bone.startsWith("upperArm") ? posed.P.armUpper : bone.startsWith("foreArm") ? posed.P.armLower : bone.startsWith("upperLeg") ? posed.P.legUpper : posed.P.legLower;
    for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      for (let k = 0; k < 8; k++) {
        const sp = posed.limbSurface(bone, -len * t, (k / 8) * Math.PI * 2, 0, "skin");
        const d = -posed.sdf(posed.toRig(bone, sp.p), "skin", 0.3, TRUNK_REGIONS);
        if (ARM_BONES.has(bone)) out.arm = Math.max(out.arm, d);
        else out.leg = Math.max(out.leg, d);
      }
    }
  }
  return out;
}

/**
 * Pose clipping: for every pose, the NEW penetration (beyond what the same vertex has at rest, and beyond what the bare body itself overlaps in that pose) of trunk garments and
 * gear into the moving limbs, and of limb garments (sleeves, trouser legs, drapes on the arm) into the trunk. Rest overlaps (a sleeve head inside the shoulder) are ignored by
 * construction. `subset` restricts the primitives (default: all).
 */
export function judgePoseClip(m: Measured, tag: Tag, poses: readonly PoseDef[] = POSES, subset?: readonly FitPrim[], layer: "worn" | "skin" = "worn"): Finding[] {
  const out: Finding[] = [];
  const prims = subset ?? m.prims;
  const targets = prims.filter((p) => p.bone === "torso" || p.bone === "pelvis" || LIMB_BONES.has(p.bone));
  const against = (p: FitPrim): readonly Region[] => (LIMB_BONES.has(p.bone) ? TRUNK_REGIONS : LIMB_REGIONS);
  // rest depths (per vertex), cached
  const restDepth = new Map<number, Float32Array>();
  for (const p of targets) {
    const n = p.local.length / 3;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = m.field.toRig(p.bone, [p.local[i * 3]!, p.local[i * 3 + 1]!, p.local[i * 3 + 2]!]);
      const s = m.field.sdf(r, layer, 0.05, against(p));
      d[i] = s < 0 ? -s : 0;
    }
    restDepth.set(p.id, d);
  }
  const worst = new Map<string, Finding>();
  for (const pose of poses) {
    const frames = poseRig(m.rig, pose);
    const posed = m.field.withFrames(frames);
    const own = bodyOverlap(posed);
    for (const p of targets) {
      const rest = restDepth.get(p.id)!;
      const n = p.local.length / 3;
      const limb = LIMB_BONES.has(p.bone);
      let best = 0;
      let bi = -1;
      for (let i = 0; i < n; i++) {
        const r = posed.toRig(p.bone, [p.local[i * 3]!, p.local[i * 3 + 1]!, p.local[i * 3 + 2]!]);
        let d: number;
        if (limb) {
          const s = posed.sdf(r, layer, 0.05, TRUNK_REGIONS);
          if (s >= 0) continue;
          d = -s - rest[i]! - (ARM_BONES.has(p.bone) ? own.arm : own.leg);
        } else {
          // a trunk piece: into an arm (less the arms' own overlap with the trunk) or a leg (less the legs')
          const sa = posed.sdf(r, layer, 0.05, ARM_REGIONS);
          const sl = posed.sdf(r, layer, 0.05, LEG_REGIONS);
          d = Math.max(sa < 0 ? -sa - own.arm : 0, sl < 0 ? -sl - own.leg : 0) - rest[i]!;
        }
        if (d > best) {
          best = d;
          bi = i;
        }
      }
      if (best > FIT_TOL.pose) {
        const at = posed.toRig(p.bone, [p.local[bi * 3]!, p.local[bi * 3 + 1]!, p.local[bi * 3 + 2]!]);
        const key = `${p.id}|${pose.tier}`;
        const f: Finding = { metric: pose.tier === "game" ? "poseClip" : "poseExtreme", value: best, tol: FIT_TOL.pose, field: tag.field, option: tag.option, optionName: tag.optionName, shape: tag.shape, bone: p.bone, kind: p.kind, at, note: pose.name };
        const prev = worst.get(key);
        if (!prev || prev.value < f.value) worst.set(key, f);
      }
    }
  }
  // back to rest for whoever uses the rig next
  poseRig(m.rig, { name: "rest", tier: "game" });
  out.push(...worst.values());
  return out;
}

// ---- reporting -----------------------------------------------------------------------------------------------------------------------------------------------------

export interface MetricSummary {
  metric: Metric;
  tol: number;
  /** Findings above tolerance. */
  count: number;
  /** Worst value in centimetres. */
  worstCm: number;
  /** The worst findings, ranked. */
  top: Finding[];
  /** Worst per field and option (cm), to see which catalog entries need work. */
  byOption: Record<string, number>;
  /** Worst per body shape (cm). */
  byShape: Record<string, number>;
}

/** Who owns a finding, by the bone the piece is on: the trunk (torso, pelvis: garments, gear, straps), the limbs (sleeves, trousers, boots, gloves ...) or the head (hats, hair, faces). */
export type FitGroup = "trunk" | "limbs" | "head";
export const FIT_GROUPS: readonly FitGroup[] = ["trunk", "limbs", "head"];
export const groupOfBone = (bone: string): FitGroup => (bone === "torso" || bone === "pelvis" ? "trunk" : bone === "head" ? "head" : "limbs");

export class FitReport {
  readonly findings: Finding[] = [];
  /** Builds measured. */
  builds = 0;
  add(fs: readonly Finding[]): void {
    this.findings.push(...fs);
  }
  /** Ranked summary per metric; `group` restricts it to the findings on that group's bones. */
  summary(top = 25, group?: FitGroup): Record<Metric, MetricSummary> {
    const metrics: Metric[] = ["garmentPenetration", "accessoryPenetration", "accessorySink", "floating", "poseClip", "poseExtreme", "headPenetration"];
    const out = {} as Record<Metric, MetricSummary>;
    for (const metric of metrics) {
      const fs = this.findings.filter((f) => f.metric === metric && (!group || groupOfBone(f.bone) === group)).sort((a, b) => b.value - a.value);
      const byOption: Record<string, number> = {};
      const byShape: Record<string, number> = {};
      for (const f of fs) {
        const k = `${f.field}=${f.option} ${f.optionName}`;
        byOption[k] = Math.max(byOption[k] ?? 0, round1(f.value * 100));
        byShape[f.shape] = Math.max(byShape[f.shape] ?? 0, round1(f.value * 100));
      }
      out[metric] = { metric, tol: fs[0]?.tol ?? 0, count: fs.length, worstCm: round1((fs[0]?.value ?? 0) * 100), top: fs.slice(0, top), byOption, byShape };
    }
    return out;
  }
}
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Convenience for tests: the catalog's choice fields with their option ranges (skipping sliders). */
export function choiceFields(): { key: FieldKey; max: number; kind: FieldDef["kind"]; options?: readonly string[]; group: FieldDef["group"] }[] {
  return (FIELDS as readonly FieldDef[]).filter((f) => f.kind !== "slider").map((f) => ({ key: f.key as FieldKey, max: f.max, kind: f.kind, options: f.options, group: f.group }));
}
