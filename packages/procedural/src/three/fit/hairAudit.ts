import { Vector3, type BufferAttribute } from "three";
import type { CharacterSpec } from "../../spec.ts";
import { HAIR_SWAY_MAX, swayOffset } from "../hairSway.ts";
import { auditHead, type AuditPrim } from "../headAudit.ts";
import { makeBodyField } from "./bodyField.ts";
import { wornRings } from "./worn.ts";

/**
 * Test and tooling support for the hair and head audits (never used in the game): how deep a character's hair sinks into the body and the things hair must lie outside of (the body field with
 * its hair obstacles, `WornRings.drape`), at rest and at the furthest sway, and where two thin sheets of the head (hair and a hat's brim, spectacles and a crown) cross each other.
 * Shared by longHair.test.ts and fitCombos.test.ts.
 */

export interface HairMeasure {
  /** Deepest hair vertex inside the body or an obstacle at rest (metres, >= 0). */
  rest: number;
  /** Same at the furthest sway (every corner of the box the animator may drive). */
  sway: number;
  /** Triangles of the hair's strands, curtains and ornaments (everything that is not a shell over the skull). */
  extrasTris: number;
}

const SWAY_CORNERS: Vector3[] = (() => {
  const out: Vector3[] = [];
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) out.push(new Vector3(sx * HAIR_SWAY_MAX.x, HAIR_SWAY_MAX.y, sz * HAIR_SWAY_MAX.z));
  return out;
})();

export function measureHair(spec: CharacterSpec): HairMeasure {
  const a = auditHead(spec);
  const field = makeBodyField(spec, wornRings(spec, true), a.P);
  const regions = ["torso", "neck", "upperArm", "drape"] as const;
  const depthOf = (x: number, y: number, z: number): number => -field.sdf(field.toRig("head", [x, y, z]), "worn", 0.05, regions);
  const hsw = a.geo.getAttribute("hsw") as BufferAttribute | null;
  const hsy = a.geo.getAttribute("hsy") as BufferAttribute | null;
  const pos = a.geo.attributes.position!;
  // the merged head's vertices are in the order of the audit's primitives, so a primitive's vertices are a running offset
  let v0 = 0;
  let rest = 0;
  let sway = 0;
  let extrasTris = 0;
  const d = new Vector3();
  for (const p of a.prims) {
    const n = p.verts.length / 3;
    if (p.label === "hair") {
      if (p.kind !== "add") extrasTris += p.tris.length / 3;
      for (let k = 0; k < n; k++) {
        const x = pos.getX(v0 + k);
        const y = pos.getY(v0 + k);
        const z = pos.getZ(v0 + k);
        rest = Math.max(rest, depthOf(x, y, z));
        if (hsw && hsy) {
          const w: [number, number, number, number] = [hsw.getX(v0 + k), hsw.getY(v0 + k), hsw.getZ(v0 + k), hsw.getW(v0 + k)];
          if (w[0] <= 0 && w[1] <= 0 && w[2] <= 0 && w[3] <= 0) continue;
          for (const c of SWAY_CORNERS) {
            swayOffset(w, hsy.getX(v0 + k), c, d);
            sway = Math.max(sway, depthOf(x + d.x, y + d.y, z + d.z));
          }
        }
      }
    }
    v0 += n;
  }
  a.geo.dispose();
  return { rest, sway, extrasTris };
}

export interface Clash {
  /** How many edges of A pass through a triangle of B. */
  crossings: number;
  /** The deepest such crossing: the shorter side of the edge, beyond the sheet it passes through (metres). */
  depth: number;
}

const EPS = 1e-9;

/**
 * Edges of `a`'s triangles that pass THROUGH a triangle of `b` (a strand through a brim, spectacle arms through a crown). The depth of a crossing is the shorter of the two pieces of the
 * edge on either side of the sheet: an edge that merely ends on the sheet is not a crossing, one that pokes 2 cm through it is 2 cm deep. Prims are in head-bone space. `minRho`: only crossings
 * farther than this from the head's axis count (hair tucked inside a crown crosses the crown's own lip, where nobody can see it; a strand through a BRIM is what shows).
 */
export function sheetClashes(a: readonly AuditPrim[], b: readonly AuditPrim[], minRho = 0): Clash {
  const tris: number[][] = [];
  for (const p of b) {
    for (let t = 0; t < p.tris.length; t += 3) {
      const i0 = p.tris[t]! * 3;
      const i1 = p.tris[t + 1]! * 3;
      const i2 = p.tris[t + 2]! * 3;
      const v = p.verts;
      tris.push([v[i0]!, v[i0 + 1]!, v[i0 + 2]!, v[i1]!, v[i1 + 1]!, v[i1 + 2]!, v[i2]!, v[i2 + 1]!, v[i2 + 2]!]);
    }
  }
  let crossings = 0;
  let depth = 0;
  const edge = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    for (const t of tris) {
      if (Math.max(t[0]!, t[3]!, t[6]!) < minX || Math.min(t[0]!, t[3]!, t[6]!) > maxX) continue;
      if (Math.max(t[1]!, t[4]!, t[7]!) < minY || Math.min(t[1]!, t[4]!, t[7]!) > maxY) continue;
      if (Math.max(t[2]!, t[5]!, t[8]!) < minZ || Math.min(t[2]!, t[5]!, t[8]!) > maxZ) continue;
      // Moller-Trumbore, segment form
      const e1x = t[3]! - t[0]!, e1y = t[4]! - t[1]!, e1z = t[5]! - t[2]!;
      const e2x = t[6]! - t[0]!, e2y = t[7]! - t[1]!, e2z = t[8]! - t[2]!;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < EPS) continue;
      const inv = 1 / det;
      const sx = ax - t[0]!, sy = ay - t[1]!, sz = az - t[2]!;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (s <= 0.02 || s >= 0.98) continue; // (an edge that ends on the sheet touches it, it does not pass through)
      if (minRho > 0 && Math.hypot(ax + dx * s, az + dz * s) < minRho) continue;
      crossings++;
      depth = Math.max(depth, Math.min(s, 1 - s) * len);
    }
  };
  for (const p of a) {
    const v = p.verts;
    for (let t = 0; t < p.tris.length; t += 3) {
      const ids = [p.tris[t]! * 3, p.tris[t + 1]! * 3, p.tris[t + 2]! * 3];
      for (let k = 0; k < 3; k++) {
        const i = ids[k]!;
        const j = ids[(k + 1) % 3]!;
        edge(v[i]!, v[i + 1]!, v[i + 2]!, v[j]!, v[j + 1]!, v[j + 2]!);
      }
    }
  }
  return { crossings, depth };
}
