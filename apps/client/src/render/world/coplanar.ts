import type { BufferGeometry } from "three";

/**
 * D-080: NO Z-FIGHTING. A builder often lays one piece flush on another: a dark plank seam on a timber floor, a half-timber beam on a plastered wall,
 * two masonry blocks of different shades overlapping at a joint. Coplanar faces of different colours fight for the depth buffer and shimmer as the
 * camera moves. Before a kit merges its parts, every pair of coplanar, overlapping, differently coloured triangles from two different parts is found,
 * and the smaller part is lifted `LIFT` along that face's normal, so it sits proud of its neighbour (4 mm: the depth buffer's step at about 50 m).
 *
 * Triangles are bucketed by their plane (normal to 1/40, distance to 4 mm, each also checked against the neighbouring distance bucket); within a
 * bucket a sweep over the projected extent finds the overlaps; each pair is confirmed in the plane (separating axes, each triangle shrunk 1 cm so
 * faces that only meet at an edge do not count). Pure geometry, run once at build time.
 */
export const LIFT = 0.004;
/** The most any one part is moved in all (a few lifts, never enough to leave what it rests on). */
const MAX_LIFT = LIFT * 3;
const COLOUR_DIFF = 0.12;
const SHRINK = 0.01;

interface Tri {
  part: number;
  // projected corners (2D on the plane's dominant axes), shrunk toward the centroid
  x0: number; y0: number; x1: number; y1: number; x2: number; y2: number;
  minU: number; maxU: number;
  nx: number; ny: number; nz: number;
  r: number; g: number; b: number;
}

export function separateCoplanar(parts: readonly BufferGeometry[]): number {
  const areas = new Float64Array(parts.length);
  const buckets = new Map<string, Tri[]>();
  for (let pi = 0; pi < parts.length; pi++) {
    const g = parts[pi]!;
    const pos = g.getAttribute("position");
    const col = g.getAttribute("color");
    if (!pos) continue;
    const index = g.getIndex();
    const n = index ? index.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const ia = index ? index.getX(t) : t, ib = index ? index.getX(t + 1) : t + 1, ic = index ? index.getX(t + 2) : t + 2;
      const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
      const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
      const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) continue;
      areas[pi]! += len / 2;
      if (len / 2 < 0.002) continue; // (slivers: nothing to see fight)
      nx /= len; ny /= len; nz /= len;
      const d = nx * ax + ny * ay + nz * az;
      const drop = Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz) ? 0 : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
      const P = (x: number, y: number, z: number): [number, number] => (drop === 0 ? [y, z] : drop === 1 ? [x, z] : [x, y]);
      const pa = P(ax, ay, az), pb = P(bx, by, bz), pc = P(cx, cy, cz);
      const mx = (pa[0] + pb[0] + pc[0]) / 3, my = (pa[1] + pb[1] + pc[1]) / 3;
      const s = (p: [number, number]): [number, number] => {
        const dx = p[0] - mx, dy = p[1] - my, l = Math.hypot(dx, dy) || 1;
        const k = Math.max(0, l - SHRINK) / l;
        return [mx + dx * k, my + dy * k];
      };
      const qa = s(pa), qb = s(pb), qc = s(pc);
      const r = col ? (col.getX(ia) + col.getX(ib) + col.getX(ic)) / 3 : 0, gg = col ? (col.getY(ia) + col.getY(ib) + col.getY(ic)) / 3 : 0, bb = col ? (col.getZ(ia) + col.getZ(ib) + col.getZ(ic)) / 3 : 0;
      const tri: Tri = { part: pi, x0: qa[0], y0: qa[1], x1: qb[0], y1: qb[1], x2: qc[0], y2: qc[1], minU: Math.min(qa[0], qb[0], qc[0]), maxU: Math.max(qa[0], qb[0], qc[0]), nx, ny, nz, r, g: gg, b: bb };
      const key = `${Math.round(nx * 40)},${Math.round(ny * 40)},${Math.round(nz * 40)},${Math.round(d / LIFT)}`;
      let l = buckets.get(key);
      if (!l) buckets.set(key, (l = []));
      l.push(tri);
    }
  }
  // how far each part has been lifted so far (a part can be lifted off two different neighbours along two different normals)
  const lift = new Map<number, [number, number, number]>();
  const along = (pi: number, t: Tri): number => {
    const v = lift.get(pi);
    return v ? v[0] * t.nx + v[1] * t.ny + v[2] * t.nz : 0;
  };
  const consider = (a: Tri, b: Tri): void => {
    if (a.part === b.part) return;
    if (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < COLOUR_DIFF) return; // (the same colour: a fight nobody can see)
    if (Math.abs(along(a.part, a) - along(b.part, a)) >= LIFT * 0.75) return; // already apart along this face's normal
    if (!overlap(a, b)) return;
    // the smaller part lifts, unless it has already been lifted as far as it may go (a part with many neighbours must not creep off its support)
    const room = (pi: number): boolean => {
      const v = lift.get(pi);
      return !v || Math.hypot(v[0], v[1], v[2]) < MAX_LIFT - 1e-6;
    };
    const first = areas[a.part]! <= areas[b.part]! ? a.part : b.part;
    const second = first === a.part ? b.part : a.part;
    const small = room(first) ? first : room(second) ? second : -1;
    if (small < 0) return;
    const v = lift.get(small) ?? [0, 0, 0];
    v[0] += a.nx * LIFT;
    v[1] += a.ny * LIFT;
    v[2] += a.nz * LIFT;
    lift.set(small, v);
  };
  for (const [key, list] of buckets) {
    list.sort((p, q) => p.minU - q.minU);
    // within the bucket, and against the next bucket up in distance (two coplanar faces can straddle a 4 mm boundary)
    sweep(list, list, consider);
    const k = key.lastIndexOf(",");
    const up = buckets.get(`${key.slice(0, k)},${Number(key.slice(k + 1)) + 1}`);
    if (up) {
      up.sort((p, q) => p.minU - q.minU);
      sweep(list, up, consider);
    }
  }
  for (const [pi, [x, y, z]] of lift) parts[pi]!.translate(x, y, z);
  return lift.size;
}

function sweep(a: Tri[], b: Tri[], f: (p: Tri, q: Tri) => void): void {
  let start = 0;
  for (const p of a) {
    while (start < b.length && b[start]!.maxU < p.minU) start++;
    for (let j = start; j < b.length && b[j]!.minU <= p.maxU; j++) if (b[j] !== p) f(p, b[j]!);
  }
}

function overlap(a: Tri, b: Tri): boolean {
  const ax = [a.x0, a.x1, a.x2], ay = [a.y0, a.y1, a.y2], bx = [b.x0, b.x1, b.x2], by = [b.y0, b.y1, b.y2];
  for (let s = 0; s < 2; s++) {
    const tx = s === 0 ? ax : bx, ty = s === 0 ? ay : by;
    for (let i = 0; i < 3; i++) {
      const nx = ty[(i + 1) % 3]! - ty[i]!, ny = tx[i]! - tx[(i + 1) % 3]!;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (let k = 0; k < 3; k++) {
        const da = ax[k]! * nx + ay[k]! * ny, db = bx[k]! * nx + by[k]! * ny;
        if (da < amin) amin = da;
        if (da > amax) amax = da;
        if (db < bmin) bmin = db;
        if (db > bmax) bmax = db;
      }
      if (amax <= bmin || bmax <= amin) return false;
    }
  }
  return true;
}
