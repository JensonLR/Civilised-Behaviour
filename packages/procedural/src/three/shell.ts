import { BufferAttribute, BufferGeometry, Color } from "three";
import { orientOutward } from "./sweep.ts";
import type { V3 } from "./parts.ts";
import { skullGrid, type GridLevel, type HeadShape } from "./headShape.ts";

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where on the head a direction is: azimuth from the front (0 = face, +-pi = back of head) and height. */
export interface Dir {
  x: number;
  y: number;
  z: number;
  /** |azimuth| from the face, 0..pi. */
  az: number;
  /** Signed azimuth (+ = the character's right). */
  phi: number;
}

export interface ShellSpec {
  /** 0..1 coverage. Vertices at 0 are left out; small values feather to the skin. */
  mask(d: Dir): number;
  /** Thickness in units of R where covered. */
  thick(d: Dir): number;
  /** Extra displacement (units of R) added on top of the radial offset, e.g. a pompadour swept up and back. */
  lift?(d: Dir): V3;
  color: number;
  /** Turns the shell's colour toward `tintColor` by this much (0..1) at a place: greying hair, dyed streaks. */
  tint?(d: Dir): number;
  tintColor?: number;
  /** Multiplies colour by height for a soft highlight on top. */
  shine?: number;
  coarse?: GridLevel;
}

/**
 * A skin-hugging shell over part of the head, built on the skull's own grid: hair, beard and sideburn masses that follow
 * the sculpt exactly (no gaps, no poking through) and can be shaped by a coverage mask and a thickness function.
 * Grid triangles that straddle the mask's edge are CLIPPED at the iso-line, so hairlines are smooth curves instead of the
 * grid's staircase, and the shell's edge lies exactly on the skin.
 */
const ISO = 0.3;

export function buildShell(shape: HeadShape, spec: ShellSpec): BufferGeometry | undefined {
  const { cols, rows, phis, thetas } = skullGrid(spec.coarse, true);
  const R = shape.R;
  const base = new Color(spec.color);
  const c = new Color();
  const tintCol = new Color();
  const dirAt = (x: number, y: number, z: number): Dir => {
    const l = Math.hypot(x, y, z) || 1;
    const dx = x / l;
    const dy = y / l;
    const dz = z / l;
    const phi = Math.atan2(dx, -dz);
    return { x: dx, y: dy, z: dz, az: Math.abs(phi), phi };
  };
  interface V {
    d: Dir;
    m: number;
  }
  const grid: V[] = [];
  for (let j = 0; j <= rows; j++) {
    const th = thetas[j]!;
    for (let i = 0; i < cols; i++) {
      const ph = phis[i]!;
      const d: Dir = { x: Math.sin(ph) * Math.cos(th), y: Math.sin(th), z: -Math.cos(ph) * Math.cos(th), az: Math.abs(ph), phi: ph };
      grid.push({ d, m: spec.mask(d) });
    }
  }

  const welded = new Map<string, number>();
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const emit = (v: V): number => {
    const d = v.d;
    const m = v.m;
    const t = spec.thick(d) * R * smooth(ISO, ISO + 0.4, m);
    const r = shape.radius(d.x, d.y, d.z) + t + 0.0015;
    const lift = spec.lift?.(d) ?? [0, 0, 0];
    const x = d.x * r + lift[0] * R;
    const y = d.y * r + lift[1] * R;
    const z = d.z * r + lift[2] * R;
    const key = `${Math.round(x * 4000)},${Math.round(y * 4000)},${Math.round(z * 4000)}`;
    const hit = welded.get(key);
    if (hit !== undefined) return hit;
    const id = pos.length / 3;
    welded.set(key, id);
    pos.push(x, y, z);
    c.copy(base);
    if (spec.tint && spec.tintColor !== undefined) c.lerp(tintCol.setHex(spec.tintColor), spec.tint(d));
    c.multiplyScalar(0.9 + (spec.shine ?? 0.16) * smooth(-0.4, 0.9, d.y) + 0.1 * smooth(0, 0.36 * R, t));
    col.push(c.r, c.g, c.b);
    return id;
  };
  const mid = (a: V, b: V): V => {
    const t = (ISO - a.m) / (b.m - a.m);
    const d = dirAt(a.d.x + (b.d.x - a.d.x) * t, a.d.y + (b.d.y - a.d.y) * t, a.d.z + (b.d.z - a.d.z) * t);
    return { d, m: ISO };
  };
  const tri = (a: V, b: V, c2: V): void => {
    const ins = [a.m >= ISO, b.m >= ISO, c2.m >= ISO];
    const n = ins.filter(Boolean).length;
    if (n === 0) return;
    if (n === 3) {
      idx.push(emit(a), emit(b), emit(c2));
      return;
    }
    // Sutherland-Hodgman against m >= ISO, then a fan.
    const poly: V[] = [];
    const vs = [a, b, c2];
    for (let k = 0; k < 3; k++) {
      const p = vs[k]!;
      const q = vs[(k + 1) % 3]!;
      const pin = p.m >= ISO;
      const qin = q.m >= ISO;
      if (pin) poly.push(p);
      if (pin !== qin) poly.push(mid(p, q));
    }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(emit(poly[0]!), emit(poly[k]!), emit(poly[k + 1]!));
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const i2 = (i + 1) % cols;
      const a = grid[j * cols + i]!;
      const b = grid[j * cols + i2]!;
      const c2 = grid[(j + 1) * cols + i]!;
      const d2 = grid[(j + 1) * cols + i2]!;
      tri(a, c2, b);
      tri(b, c2, d2);
    }
  }
  if (idx.length === 0) return undefined;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  orientOutward(geo);
  geo.computeVertexNormals();
  // Blend the mesh normals with the skull's own smooth normals so a thin cap shades like the head it sits on.
  const nrm = geo.attributes.normal as BufferAttribute;
  for (let i = 0; i < nrm.count; i++) {
    const p: V3 = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    const sn = shape.normal(p);
    const x = nrm.getX(i) * 0.4 + sn[0] * 0.6;
    const y = nrm.getY(i) * 0.4 + sn[1] * 0.6;
    const z = nrm.getZ(i) * 0.4 + sn[2] * 0.6;
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(i, x / l, y / l, z / l);
  }
  geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return geo;
}

