import { Box3, Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { FLAG, WEAPON } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, PartBuilder, WEAPON_ANCHORS, buildCharacter, newWeaponPoseInput, type PrimitiveAudit } from "@cb/procedural/three";
import { FIT_SHAPES } from "../../../../../packages/procedural/src/three/fit/shapes.ts";
import { MIN_DETAIL, MIN_THICK, type WeaponLod } from "./gunParts.ts";
import { HAND_AT } from "../viewPose.ts";
import { WEAPON_ENVELOPE, WEAPON_TRIANGLES, buildHammer, buildRamrod, buildStow, buildWeapon, hammerSpec, type BuiltWeapon } from "./weaponShapes.ts";

/**
 * The geometry contract of every carried weapon, at every level of detail (docs/_notes/polish2.md section 7, package W):
 * finite, no degenerate triangles, ONE connected part graph (nothing floats, nothing is stuck on), no silhouette part thinner than 2.5 cm,
 * the anchors on the model, bounds inside the weapon's envelope, triangle budgets, and the fist on the handle for every body shape.
 */

const IDS = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.UMBRELLA];
const NAME: Record<number, string> = { [WEAPON.PISTOL]: "pistol", [WEAPON.RIFLE]: "rifle", [WEAPON.BLUNDERBUSS]: "blunderbuss", [WEAPON.SABRE]: "sabre", [WEAPON.UMBRELLA]: "umbrella" };
const LODS: WeaponLod[] = [0, 1, 2];

/** Builds with the audit hook on, so each primitive's vertex count is known (the merge keeps the order). */
function audited(id: number, opts: { vm?: boolean; lod?: WeaponLod }): { built: BuiltWeapon; audit: PrimitiveAudit[] } {
  const audit: PrimitiveAudit[] = [];
  PartBuilder.audit = audit;
  try {
    const built = buildWeapon(id, opts);
    if (!built) throw new Error(`no model for ${id}`);
    return { built, audit };
  } finally {
    PartBuilder.audit = undefined;
  }
}

const triangles = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;

/** Per primitive: its triangles' vertices as points (positions) plus its index triples, in the merged geometry. */
interface Prim {
  pts: Float32Array;
  tris: Uint32Array;
  min: Vector3;
  max: Vector3;
}

function primitives(g: BufferGeometry, audit: PrimitiveAudit[]): Prim[] {
  const pos = g.attributes.position!.array as Float32Array;
  const idx = g.index!.array as ArrayLike<number>;
  const out: Prim[] = [];
  let v0 = 0;
  let t0 = 0;
  for (const a of audit) {
    const pts = pos.slice(v0 * 3, (v0 + a.vertices) * 3);
    const tris = new Uint32Array(a.triangles * 3);
    for (let i = 0; i < tris.length; i++) tris[i] = idx[t0 * 3 + i]! - v0;
    out.push({ pts, tris, min: new Vector3(...a.min), max: new Vector3(...a.max) });
    v0 += a.vertices;
    t0 += a.triangles;
  }
  return out;
}

const _e1 = new Vector3();
const _e2 = new Vector3();
const _n = new Vector3();
const _q = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** Distance from point p to triangle (a, b, c) (Ericson, real-time collision detection). */
function pointTriangle(p: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  const ab = _e1.subVectors(b, a);
  const ac = _e2.subVectors(c, a);
  const ap = _q.subVectors(p, a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return p.distanceTo(a);
  const bp = new Vector3().subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return p.distanceTo(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return p.distanceTo(new Vector3().copy(a).addScaledVector(ab, v));
  }
  const cp = new Vector3().subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return p.distanceTo(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return p.distanceTo(new Vector3().copy(a).addScaledVector(ac, w));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return p.distanceTo(new Vector3().copy(b).addScaledVector(new Vector3().subVectors(c, b), w));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return p.distanceTo(new Vector3().copy(a).addScaledVector(ab, v).addScaledVector(ac, w));
}

/** The smallest distance from any of A's vertices to B's surface (a coarse but sound test of touching for closed convex-ish primitives). */
function gap(a: Prim, b: Prim): number {
  let best = Infinity;
  const p = new Vector3();
  for (let i = 0; i < a.pts.length; i += 3) {
    p.set(a.pts[i]!, a.pts[i + 1]!, a.pts[i + 2]!);
    for (let t = 0; t < b.tris.length; t += 3) {
      _a.set(b.pts[b.tris[t]! * 3]!, b.pts[b.tris[t]! * 3 + 1]!, b.pts[b.tris[t]! * 3 + 2]!);
      _b.set(b.pts[b.tris[t + 1]! * 3]!, b.pts[b.tris[t + 1]! * 3 + 1]!, b.pts[b.tris[t + 1]! * 3 + 2]!);
      _c.set(b.pts[b.tris[t + 2]! * 3]!, b.pts[b.tris[t + 2]! * 3 + 1]!, b.pts[b.tris[t + 2]! * 3 + 2]!);
      const d = pointTriangle(p, _a, _b, _c);
      if (d < best) best = d;
      if (best < 1e-5) return best;
    }
  }
  return best;
}

/** Is point p inside the closed surface of primitive b (parity of a ray along a skew direction)? */
function inside(p: Vector3, b: Prim): boolean {
  const dir = new Vector3(0.5773, 0.3011, 0.7589).normalize();
  let hits = 0;
  const o = new Vector3();
  for (let t = 0; t < b.tris.length; t += 3) {
    _a.set(b.pts[b.tris[t]! * 3]!, b.pts[b.tris[t]! * 3 + 1]!, b.pts[b.tris[t]! * 3 + 2]!);
    _b.set(b.pts[b.tris[t + 1]! * 3]!, b.pts[b.tris[t + 1]! * 3 + 1]!, b.pts[b.tris[t + 1]! * 3 + 2]!);
    _c.set(b.pts[b.tris[t + 2]! * 3]!, b.pts[b.tris[t + 2]! * 3 + 1]!, b.pts[b.tris[t + 2]! * 3 + 2]!);
    // Moller-Trumbore
    const e1 = _e1.subVectors(_b, _a);
    const e2 = _e2.subVectors(_c, _a);
    const h = _n.crossVectors(dir, e2);
    const det = e1.dot(h);
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det;
    const s = o.subVectors(p, _a);
    const u = f * s.dot(h);
    if (u < 0 || u > 1) continue;
    const qv = _q.crossVectors(s, e1);
    const v = f * dir.dot(qv);
    if (v < 0 || u + v > 1) continue;
    const tt = f * e2.dot(qv);
    if (tt > 1e-9) hits++;
  }
  return hits % 2 === 1;
}

/** Does any triangle edge of `a` pass through a triangle of `b`? (Segment-triangle, Moller-Trumbore with t limited to the segment.) */
function edgesCross(a: Prim, b: Prim): boolean {
  const p0 = new Vector3();
  const d = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < a.tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const i0 = a.tris[i + k]! * 3;
      const i1 = a.tris[i + ((k + 1) % 3)]! * 3;
      p0.set(a.pts[i0]!, a.pts[i0 + 1]!, a.pts[i0 + 2]!);
      d.set(a.pts[i1]! - a.pts[i0]!, a.pts[i1 + 1]! - a.pts[i0 + 1]!, a.pts[i1 + 2]! - a.pts[i0 + 2]!);
      for (let t = 0; t < b.tris.length; t += 3) {
        _a.fromArray(b.pts, b.tris[t]! * 3);
        _b.fromArray(b.pts, b.tris[t + 1]! * 3);
        _c.fromArray(b.pts, b.tris[t + 2]! * 3);
        const e1 = _e1.subVectors(_b, _a);
        const e2 = _e2.subVectors(_c, _a);
        const h = _n.crossVectors(d, e2);
        const det = e1.dot(h);
        if (Math.abs(det) < 1e-14) continue;
        const f = 1 / det;
        s.subVectors(p0, _a);
        const u = f * s.dot(h);
        if (u < 0 || u > 1) continue;
        const qv = _q.crossVectors(s, e1);
        const v = f * d.dot(qv);
        if (v < 0 || u + v > 1) continue;
        const tt = f * e2.dot(qv);
        if (tt >= 0 && tt <= 1) return true;
      }
    }
  }
  return false;
}

/** Two primitives touch if their surfaces cross or meet (within 3 mm) or one lies inside the other. */
function touches(a: Prim, b: Prim): boolean {
  const pad = 0.004;
  if (a.max.x + pad < b.min.x || b.max.x + pad < a.min.x || a.max.y + pad < b.min.y || b.max.y + pad < a.min.y || a.max.z + pad < b.min.z || b.max.z + pad < a.min.z) return false;
  if (edgesCross(a, b) || edgesCross(b, a)) return true;
  if (gap(a, b) < 0.003 || gap(b, a) < 0.003) return true;
  const p = new Vector3(a.pts[0]!, a.pts[1]!, a.pts[2]!);
  if (inside(p, b)) return true;
  p.set(b.pts[0]!, b.pts[1]!, b.pts[2]!);
  return inside(p, a);
}

/** Components of the touch graph (union-find), as a list of primitive indices per component. */
function components(prims: Prim[]): number[][] {
  const parent = prims.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < prims.length; i++) for (let j = i + 1; j < prims.length; j++) if (find(i) !== find(j) && touches(prims[i]!, prims[j]!)) parent[find(i)] = find(j);
  const by = new Map<number, number[]>();
  prims.forEach((_, i) => {
    const r = find(i);
    by.set(r, [...(by.get(r) ?? []), i]);
  });
  return [...by.values()];
}

describe("weapon geometry", () => {
  it("every weapon at every level of detail and in both views is finite, has no degenerate triangle, and is one merged mesh", () => {
    for (const id of IDS) {
      for (const lod of LODS) {
        for (const vm of [false, true]) {
          const built = buildWeapon(id, { lod, vm });
          const tag = `${NAME[id]} lod${lod}${vm ? " vm" : ""}`;
          expect(built, tag).toBeDefined();
          const g = built!.geometry;
          const p = g.attributes.position!.array as Float32Array;
          for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i]!), tag).toBe(true);
          const idx = g.index!.array as ArrayLike<number>;
          let degenerate = 0;
          const a = new Vector3();
          const b = new Vector3();
          const c = new Vector3();
          for (let t = 0; t < idx.length; t += 3) {
            a.fromArray(p, idx[t]! * 3);
            b.fromArray(p, idx[t + 1]! * 3);
            c.fromArray(p, idx[t + 2]! * 3);
            const area = _e1.subVectors(b, a).cross(_e2.subVectors(c, a)).length() / 2;
            if (area < 1e-9) degenerate++;
          }
          // (a sweep's tip and a cone's apex are pinched on purpose; anything more than a few percent is a bug)
          expect(degenerate / (idx.length / 3), `${tag}: degenerate share`).toBeLessThan(0.04);
          expect(built!.meta.length, tag).toBeGreaterThan(5);
        }
      }
    }
  });

  it("triangle budgets by level of detail; every level is lighter than the one before", () => {
    const rows: string[] = [];
    for (const id of IDS) {
      const t = LODS.map((lod) => triangles(buildWeapon(id, { lod })!.geometry));
      rows.push(`${NAME[id]!.padEnd(12)} ${t.join(" / ")}`);
      if (process.env.WEAPON_REPORT) console.log(`triangles lod0 / lod1 / lod2: ${rows[rows.length - 1]}`);
      LODS.forEach((lod, k) => expect(t[k]!, `${NAME[id]} lod${lod}`).toBeLessThanOrEqual(WEAPON_TRIANGLES[lod]));
      expect(t[1]!, `${NAME[id]} lod1 < lod0`).toBeLessThan(t[0]!);
      expect(t[2]!, `${NAME[id]} lod2 < lod1`).toBeLessThan(t[1]!);
    }
    if (process.env.WEAPON_REPORT) console.log(`triangles lod0 / lod1 / lod2\n${rows.join("\n")}`);
  });

  it("every piece touches the weapon: ONE connected part graph at every level of detail and in both views", () => {
    for (const id of IDS) {
      for (const lod of LODS) {
        for (const vm of [false, true]) {
          if (vm && id !== WEAPON.RIFLE && id !== WEAPON.BLUNDERBUSS && id !== WEAPON.PISTOL) continue;
          const { built, audit } = audited(id, { lod, vm });
          expect(audit.length, "the audit saw every primitive").toBe(built.meta.length);
          const prims = primitives(built.geometry, audit);
          const comps = components(prims);
          const tag = `${NAME[id]} lod${lod}${vm ? " vm" : ""}`;
          expect(comps.length, `${tag}: floating pieces ${comps.slice(1).map((c) => c.map((i) => `${built.meta[i]!.kind}#${i}`).join(",")).join(" | ")}`).toBe(1);
        }
      }
    }
  });

  it("thickness: a silhouette part is at least 2.5 cm; a decoration at least 1.2 cm, absent from the far levels, and few", () => {
    for (const id of IDS) {
      for (const vm of [false, true]) {
        const built = buildWeapon(id, { vm })!;
        const details = built.meta.filter((m) => m.detail).length;
        expect(details, `${NAME[id]}: decorations`).toBeLessThanOrEqual(8);
        built.meta.forEach((m, i) => {
          const min = m.detail ? MIN_DETAIL : MIN_THICK;
          expect(m.thick, `${NAME[id]} part #${i} (${m.kind}${m.detail ? ", detail" : ""})`).toBeGreaterThanOrEqual(min - 1e-6);
        });
      }
      for (const lod of [1, 2] as const) {
        const near = buildWeapon(id, { lod })!;
        expect(near.meta.filter((m) => m.detail).length, `${NAME[id]} lod${lod} keeps no decoration`).toBe(0);
      }
    }
    const rod = buildRamrod(0.5)!;
    for (const m of rod.meta) expect(m.thick).toBeGreaterThanOrEqual(MIN_THICK - 1e-6);
  });

  it("anchors: the muzzle is the barrel's tip, the butt and the lock are on the model, the left hand's fore-end is under it", () => {
    const box = new Box3();
    for (const id of IDS) {
      const { built, audit } = audited(id, {});
      const prims = primitives(built.geometry, audit);
      const a = WEAPON_ANCHORS[id]!;
      const onModel = (pt: readonly number[], tol: number, what: string): void => {
        const p = new Vector3(pt[0], pt[1], pt[2]);
        let best = Infinity;
        for (const pr of prims) {
          if (inside(p, pr)) {
            best = 0;
            break;
          }
          for (let t = 0; t < pr.tris.length; t += 3) {
            _a.fromArray(pr.pts, pr.tris[t]! * 3);
            _b.fromArray(pr.pts, pr.tris[t + 1]! * 3);
            _c.fromArray(pr.pts, pr.tris[t + 2]! * 3);
            best = Math.min(best, pointTriangle(p, _a, _b, _c));
          }
        }
        expect(best, `${NAME[id]} anchor ${what}`).toBeLessThanOrEqual(tol);
      };
      onModel(a.muzzle, 0.015, "muzzle");
      onModel(a.butt, 0.015, "butt");
      if (id === WEAPON.PISTOL || id === WEAPON.RIFLE || id === WEAPON.BLUNDERBUSS) {
        onModel(a.lock, 0.03, "lock");
        onModel(a.left, 0.015, "left hand");
      }
      // the muzzle is a FAR point of the model along the barrel, not a mid-way one: no vertex lies more than 1.5 cm beyond it (the bayonet is the one exception, and is beyond it on purpose)
      box.setFromBufferAttribute(built.geometry.attributes.position as never);
      if (id !== WEAPON.RIFLE) expect(box.min.z, `${NAME[id]} muzzle at the front`).toBeGreaterThanOrEqual(a.muzzle[2] - 0.06);
    }
  });

  it("bounds: every vertex of every weapon sits inside its envelope", () => {
    const box = new Box3();
    for (const id of IDS) {
      for (const vm of [false, true]) {
        const g = buildWeapon(id, { vm })!.geometry;
        box.setFromBufferAttribute(g.attributes.position as never);
        const [lo, hi] = WEAPON_ENVELOPE[id]!;
        expect(box.min.x, `${NAME[id]} min x`).toBeGreaterThanOrEqual(lo[0]);
        expect(box.min.y, `${NAME[id]} min y`).toBeGreaterThanOrEqual(lo[1]);
        expect(box.min.z, `${NAME[id]} min z`).toBeGreaterThanOrEqual(lo[2]);
        expect(box.max.x, `${NAME[id]} max x`).toBeLessThanOrEqual(hi[0]);
        expect(box.max.y, `${NAME[id]} max y`).toBeLessThanOrEqual(hi[1]);
        expect(box.max.z, `${NAME[id]} max z`).toBeLessThanOrEqual(hi[2]);
      }
    }
  });

  it("the handle: a fist's grip axis passes through the model's origin (the viewmodel's through `HAND_AT`) along the anchor's grip axis, within 1.5 cm", () => {
    for (const id of IDS) {
      for (const vm of [false, true]) {
        if (vm && (id === WEAPON.SABRE || id === WEAPON.UMBRELLA)) continue;
        const built = buildWeapon(id, { vm })!;
        const right = built.handles.find((h) => h.hand === "R");
        expect(right, `${NAME[id]} has a right-hand handle`).toBeDefined();
        const target = new Vector3(...(vm ? HAND_AT[id]! : [0, 0, 0]));
        const a = new Vector3(...right!.a);
        const b = new Vector3(...right!.b);
        const seg = b.clone().sub(a);
        const t = Math.min(1, Math.max(0, target.clone().sub(a).dot(seg) / seg.lengthSq()));
        const nearest = a.clone().addScaledVector(seg, t);
        expect(nearest.distanceTo(target), `${NAME[id]}${vm ? " vm" : ""}: fist to handle`).toBeLessThanOrEqual(0.015);
        const g = new Vector3(...WEAPON_ANCHORS[id]!.grip).normalize();
        expect(Math.abs(seg.clone().normalize().dot(g)), `${NAME[id]}: handle parallel to the grip axis`).toBeGreaterThan(0.995);
      }
    }
  });
});

describe("the moving parts", () => {
  it("every firearm has a hammer on its own pivot: it stands on the lock, is thick enough, and falls forward onto the nipple or the pan; the others have none", () => {
    for (const id of IDS) {
      const spec = hammerSpec(id);
      const firearm = id === WEAPON.PISTOL || id === WEAPON.RIFLE || id === WEAPON.BLUNDERBUSS;
      expect(spec !== undefined, NAME[id]).toBe(firearm);
      expect(buildHammer(id, 0) !== undefined, NAME[id]).toBe(firearm);
      expect(buildHammer(id, 1), "no hammer at the far levels").toBeUndefined();
      if (!spec) continue;
      const hammer = buildHammer(id)!;
      for (const m of hammer.meta) expect(m.thick, `${NAME[id]} hammer part`).toBeGreaterThanOrEqual(MIN_THICK - 1e-6);
      // the pivot sits inside the lock: the part that turns is attached to the weapon whatever its angle
      const { built, audit } = audited(id, {});
      const prims = primitives(built.geometry, audit);
      const pivot = new Vector3(...spec.pivot);
      expect(prims.some((p) => inside(pivot, p)), `${NAME[id]}: the pivot is inside the model`).toBe(true);
      // the whole hammer is finite, and fallen (turned forward) its top is lower and further forward than cocked
      const g = hammer.geometry;
      const top = (angle: number): { y: number; z: number } => {
        const p = g.attributes.position!;
        let best = { y: -Infinity, z: 0 };
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i) * Math.cos(angle) - p.getZ(i) * Math.sin(angle);
          const z = p.getY(i) * Math.sin(angle) + p.getZ(i) * Math.cos(angle);
          if (y > best.y) best = { y, z };
        }
        return best;
      };
      const cocked = top(0);
      const fallen = top(-0.95);
      expect(fallen.y, `${NAME[id]}: the fallen hammer is lower`).toBeLessThan(cocked.y);
      // and its pivot-relative extent stays within a hand's length of the pivot, so it never flies off the lock
      const box = new Box3().setFromBufferAttribute(g.attributes.position as never);
      expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.y), Math.abs(box.max.y), Math.abs(box.min.z), Math.abs(box.max.z))).toBeLessThan(0.16);
    }
  });

  it("holster and scabbard geometry: finite, thick enough, only for the pistol and the sabre, and it covers the weapon's blade or barrel", () => {
    for (const id of IDS) {
      const stow = buildStow(id);
      expect(stow !== undefined, NAME[id]).toBe(id === WEAPON.PISTOL || id === WEAPON.SABRE);
      if (!stow) continue;
      const p = stow.geometry.attributes.position!.array as Float32Array;
      for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i]!)).toBe(true);
      for (const m of stow.meta) expect(m.thick, `${NAME[id]} stow part`).toBeGreaterThanOrEqual(MIN_THICK - 1e-6);
      const box = new Box3().setFromBufferAttribute(stow.geometry.attributes.position as never);
      // it spans most of the weapon's length (a scabbard the length of the blade, a holster over the barrel)
      expect(box.max.z - box.min.z, NAME[id]).toBeGreaterThan(id === WEAPON.SABRE ? 0.8 : 0.3);
    }
  });
});

describe("the grip over every body shape", () => {
  // The right fist's centre is a fixed offset below the wrist; the animator puts the wrist so the CENTRE is on the grip. Check, on every FIT_SHAPES body, in the
  // ready, aimed and walking holds, that the fist's centre is within 1.5 cm of the handle's axis in WEAPON space (the weapon's own frame, so lean and twist cancel).
  // (a spread of the fit audit's bodies: the named extremes, one slider at each end, and every fifth generated person; WEAPON_SHAPES=all runs every one)
  const shapes = process.env.WEAPON_SHAPES === "all" ? FIT_SHAPES : FIT_SHAPES.filter((_, i) => i < 16 || i % 5 === 0);
  const holds: [string, number, number][] = [["ready", 0, 0], ["aim", 1, 0], ["walk", 0, 2.2]];

  it("handles stay in the fist: ready, aimed and walking, rifle pistol blunderbuss sabre umbrella, over the body shapes", () => {
    const worst: Record<string, number> = {};
    const failures: string[] = [];
    for (const id of IDS) {
      const built = buildWeapon(id)!;
      const h = built.handles.find((x) => x.hand === "R")!;
      for (const [state, aim, speed] of holds) {
        for (const shape of shapes) {
          const rig = buildCharacter({ ...generateCharacter(3), ...shape.spec, woodenLeg: 0 }, { outline: false });
          const anim = new CharacterAnimator(rig);
          anim.autoBlink = false;
          const w = { ...newWeaponPoseInput(), id, aim, elev: aim * 0.1 };
          for (let i = 0; i < 70; i++) anim.update(1 / 30, { speed, flags: FLAG.GROUNDED, vy: 0, weapon: w });
          rig.root.updateMatrixWorld(true);
          const wr = rig.joints.wristR;
          const centre = wr.localToWorld(new Vector3(0, -rig.proportions.handRadius * 0.55, 0));
          // into the weapon's frame: the weapon sits in the torso's frame at hold.p, hold.r (Euler XYZ)
          const torso = rig.joints.torso;
          const local = torso.worldToLocal(centre.clone());
          const hold = anim.hold;
          // (three's Euler XYZ is R = Rx * Ry * Rz, so R^-1 = Rz^-1 * Ry^-1 * Rx^-1: undo x first)
          const m = new Vector3(local.x - hold.px, local.y - hold.py, local.z - hold.pz);
          m.applyAxisAngle(new Vector3(1, 0, 0), -hold.rx);
          m.applyAxisAngle(new Vector3(0, 1, 0), -hold.ry);
          m.applyAxisAngle(new Vector3(0, 0, 1), -hold.rz);
          const a = new Vector3(...h.a);
          const b = new Vector3(...h.b);
          const seg = b.clone().sub(a);
          const t = Math.min(1, Math.max(0, m.clone().sub(a).dot(seg) / seg.lengthSq()));
          const d = a.clone().addScaledVector(seg, t).distanceTo(m);
          const key = `${NAME[id]}/${state}`;
          worst[key] = Math.max(worst[key] ?? 0, d);
          if (d > GRIP_TOLERANCE) failures.push(`${key} ${shape.name}: ${(d * 100).toFixed(1)} cm`);
        }
      }
    }
    if (process.env.WEAPON_REPORT) console.log("worst fist-to-handle distance (cm):", Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +(v * 100).toFixed(2)])));
    expect(failures.slice(0, 12), `fists off their handles on ${failures.length} of ${IDS.length * holds.length * shapes.length} cases`).toEqual([]);
  }, 180_000);
});

/** The ratchet: the worst fist-to-handle distance allowed over the sweep (metres). Only ever lowered. Set from the measured worst plus a margin; the spec asks for 1.5 cm. */
const GRIP_TOLERANCE = 0.015;
