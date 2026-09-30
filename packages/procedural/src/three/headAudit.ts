import { PALETTE } from "@cb/shared";
import type { BufferGeometry } from "three";
import { computeProportions, type Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { buildHead, headFitFor, headTrace, type HeadColors } from "./head.ts";
import type { HeadFit } from "./headFit.ts";
import { PartBuilder, type V3 } from "./parts.ts";

/**
 * Head-region audit support (test and tooling code, never used in the game): builds a head with the primitive audit on and hands back every primitive labelled with the
 * feature that made it (skull, ears, hair, hat ...) together with its vertices and triangles, so tests can measure REAL fit (vertices inside the skull or the body, parts
 * that float free of everything, hair poking through a crown) instead of bounding boxes. `headFit.test.ts` and `hatHair.test.ts` use it.
 */

export const AUDIT_COLORS: HeadColors = { skin: PALETTE.skin[2], hairC: PALETTE.hair[1], hatC: PALETTE.cloth[5], accent: PALETTE.metal[0], burnt: 0 };

export interface AuditPrim {
  label: string;
  kind: string;
  /** Vertex positions, head-bone space (3 per vertex). */
  verts: Float32Array;
  /** Triangle indices into `verts` (3 per triangle). */
  tris: Uint32Array;
}

export interface HeadAudit {
  spec: CharacterSpec;
  P: Proportions;
  hf: HeadFit;
  seatY: number;
  geo: BufferGeometry;
  prims: AuditPrim[];
}

export function auditHead(spec: CharacterSpec, colors: HeadColors = AUDIT_COLORS): HeadAudit {
  const P = computeProportions(spec);
  PartBuilder.audit = [];
  let geo: BufferGeometry | undefined;
  let audit;
  try {
    geo = buildHead(spec, P, colors);
    audit = PartBuilder.audit;
  } finally {
    PartBuilder.audit = undefined;
  }
  if (!geo) throw new Error("no head");
  const marks = headTrace.marks;
  const pos = geo.attributes.position!;
  const ix = geo.index!;
  const prims: AuditPrim[] = [];
  let v0 = 0;
  let t0 = 0;
  let mi = 0;
  audit!.forEach((a, i) => {
    while (mi + 1 < marks.length && marks[mi + 1]!.index <= i) mi++;
    const label = marks[mi] && marks[mi]!.index <= i ? marks[mi]!.label : "?";
    const verts = new Float32Array(a.vertices * 3);
    for (let k = 0; k < a.vertices; k++) {
      verts[k * 3] = pos.getX(v0 + k);
      verts[k * 3 + 1] = pos.getY(v0 + k);
      verts[k * 3 + 2] = pos.getZ(v0 + k);
    }
    const tris = new Uint32Array(a.triangles * 3);
    for (let k = 0; k < a.triangles * 3; k++) tris[k] = ix.getX(t0 * 3 + k) - v0;
    prims.push({ label, kind: a.kind, verts, tris });
    v0 += a.vertices;
    t0 += a.triangles;
  });
  const { hf, seatY } = headFitFor(spec, P);
  return { spec, P, hf, seatY, geo, prims };
}

/** Deepest a primitive's vertices sink INTO the skull (metres; 0 if none). Cap-fan centres and the like are ordinary vertices here. */
export function skullDepth(a: HeadAudit, p: AuditPrim): number {
  const { hf, P } = a;
  let worst = 0;
  const cy = P.headRadius;
  for (let i = 0; i < p.verts.length; i += 3) {
    const x = p.verts[i]!;
    const y = p.verts[i + 1]! - cy;
    const z = p.verts[i + 2]!;
    const l = Math.hypot(x, y, z) || 1e-9;
    const d = l - hf.shape.radius(x / l, y / l, z / l);
    if (-d > worst) worst = -d;
  }
  return worst;
}

/** Deepest a primitive's vertices sink into the neck, trunk or upper arms (metres; 0 if none). */
export function bodyDepth(a: HeadAudit, p: AuditPrim): number {
  let worst = 0;
  for (let i = 0; i < p.verts.length; i += 3) {
    const d = a.hf.bodyDist(p.verts[i]!, p.verts[i + 1]!, p.verts[i + 2]!);
    if (-d > worst) worst = -d;
  }
  return worst;
}

const distPointTri = (p: V3, a: V3, b: V3, c: V3): number => {
  // closest point on triangle (Ericson, Real-Time Collision Detection)
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u: V3, v: V3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q: V3;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp: V3 = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
      } else {
        const cp: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den;
              const w = vc * den;
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
            }
          }
        }
      }
    }
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/**
 * How far a primitive floats: the smallest distance from any of its vertices to the skull surface or to a triangle of any OTHER primitive (metres). A primitive that touches
 * nothing has a large value; one that is attached has ~0. (Its own vertices near another primitive's triangles count, so a brim resting on a crown is attached.)
 */
export function floatGap(a: HeadAudit, index: number): number {
  const me = a.prims[index]!;
  let best = Infinity;
  const cy = a.P.headRadius;
  for (let i = 0; i < me.verts.length; i += 3) {
    const x = me.verts[i]!;
    const y = me.verts[i + 1]! - cy;
    const z = me.verts[i + 2]!;
    const l = Math.hypot(x, y, z) || 1e-9;
    best = Math.min(best, Math.abs(l - a.hf.shape.radius(x / l, y / l, z / l)));
  }
  let lo: V3 = [Infinity, Infinity, Infinity];
  let hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < me.verts.length; i += 3) {
    lo = [Math.min(lo[0], me.verts[i]!), Math.min(lo[1], me.verts[i + 1]!), Math.min(lo[2], me.verts[i + 2]!)];
    hi = [Math.max(hi[0], me.verts[i]!), Math.max(hi[1], me.verts[i + 1]!), Math.max(hi[2], me.verts[i + 2]!)];
  }
  for (let j = 0; j < a.prims.length; j++) {
    if (j === index) continue;
    const o = a.prims[j]!;
    // cheap reject by bounding box distance
    let olo: V3 = [Infinity, Infinity, Infinity];
    let ohi: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < o.verts.length; i += 3) {
      olo = [Math.min(olo[0], o.verts[i]!), Math.min(olo[1], o.verts[i + 1]!), Math.min(olo[2], o.verts[i + 2]!)];
      ohi = [Math.max(ohi[0], o.verts[i]!), Math.max(ohi[1], o.verts[i + 1]!), Math.max(ohi[2], o.verts[i + 2]!)];
    }
    const gx = Math.max(0, lo[0] - ohi[0], olo[0] - hi[0]);
    const gy = Math.max(0, lo[1] - ohi[1], olo[1] - hi[1]);
    const gz = Math.max(0, lo[2] - ohi[2], olo[2] - hi[2]);
    if (Math.hypot(gx, gy, gz) >= best) continue;
    for (let t = 0; t < o.tris.length; t += 3) {
      const A: V3 = [o.verts[o.tris[t]! * 3]!, o.verts[o.tris[t]! * 3 + 1]!, o.verts[o.tris[t]! * 3 + 2]!];
      const B: V3 = [o.verts[o.tris[t + 1]! * 3]!, o.verts[o.tris[t + 1]! * 3 + 1]!, o.verts[o.tris[t + 1]! * 3 + 2]!];
      const C: V3 = [o.verts[o.tris[t + 2]! * 3]!, o.verts[o.tris[t + 2]! * 3 + 1]!, o.verts[o.tris[t + 2]! * 3 + 2]!];
      for (let i = 0; i < me.verts.length; i += 3) {
        const d = distPointTri([me.verts[i]!, me.verts[i + 1]!, me.verts[i + 2]!], A, B, C);
        if (d < best) best = d;
      }
      if (best < 1e-4) return best;
    }
  }
  return best;
}
