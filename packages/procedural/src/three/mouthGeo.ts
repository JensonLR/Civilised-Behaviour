import { BufferAttribute, BufferGeometry, Color } from "three";
import { PALETTE } from "@cb/shared";
import { MOUTH_MORPH_NAMES, faceDeltas } from "./faceMorph.ts";
import { MOUTH_BAND, skullGrid, type HeadShape } from "./headShape.ts";
import type { V3 } from "./parts.ts";

/**
 * The mouth: the lip seam, the dark opening, the gums, the teeth and the tongue as ONE small mesh with morph targets.
 *
 * The skin has two rows of vertices that bound the mouth (MOUTH_BAND): the upper one stays with the skull, the lower one goes down with the jaw, and the strip of skin between
 * them is what stretches when the mouth opens. Everything in here is laid on THAT strip (a point is a column position x and a fraction v across the strip, lifted a hair off
 * the skin), and every piece is collapsed onto the closed seam at rest. Its morph targets are the skin's own (`faceDeltas`, so a smile, a snarl or a pucker moves it exactly
 * with the lips) plus two of its own:
 *   jaw    every piece slides to its open position: v across the strip moves with the lower row, which the jaw carries
 *   bare   the jaw stays shut but the lips part a little: teeth show in a window (a grin, a snarl, clenched teeth)
 *   tongue the tongue pokes out over the lower lip
 * Nothing here can leave the lips: the interior is a lens between two skin rows, so with the mouth shut it has no area at all.
 */

export interface MouthGeo {
  /** The seam, the opening, teeth and tongue with morph targets in MOUTH_MORPH_NAMES order (LOD0). */
  full: BufferGeometry;
  /** The seam only, static (crowd levels, whose skin has no morph targets). */
  line: BufferGeometry;
  /** Head-centre relative height / depth of the seam at the middle of the mouth. */
  y: number;
  z: number;
  /** Half the width of the mouth (m). */
  halfWidth: number;
}

interface Vtx {
  p: V3; // rest position
  n: V3;
  c: [number, number, number];
  open?: V3; // position at jaw = 1
  bare?: V3; // position at bare = 1
  tongue?: V3; // extra displacement at tongue = 1
  /** No jaw / bare / tongue deltas (a piece that does not collapse at rest). */
  fixed?: boolean;
}

const lin = (hex: number): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const mixc = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a: [number, number, number], k: number): [number, number, number] => [Math.min(1, a[0] * k), Math.min(1, a[1] * k), Math.min(1, a[2] * k)];
const hash = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

let cache = new WeakMap<HeadShape, Map<string, MouthGeo>>();
const all = new Set<MouthGeo>();

/** Frees every cached mouth (rigs still showing one re-upload on their next draw). */
export function clearMouthGeos(): void {
  for (const m of all) {
    m.full.dispose();
    m.line.dispose();
  }
  all.clear();
  cache = new WeakMap();
}

/** The mouth for a head shape, the teeth bits (TEETH_BITS) and the gold colour of the character. Memoised: a look and its clones share it. */
export function mouthGeo(shape: HeadShape, teeth: number, gold: number): MouthGeo {
  let per = cache.get(shape);
  if (!per) cache.set(shape, (per = new Map()));
  const key = `${teeth}|${gold.toString(16)}`;
  let hit = per.get(key);
  if (!hit) {
    hit = buildMouthGeo(shape, teeth, gold);
    all.add(hit);
    if (per.size > 40) per.clear();
    per.set(key, hit);
  }
  return hit;
}

function buildMouthGeo(shape: HeadShape, teeth: number, gold: number): MouthGeo {
  const R = shape.R;
  const g = skullGrid(false);
  const centre = g.cols / 2;
  const skinPt = (col: number, row: number): V3 => {
    const th = g.thetas[row]!;
    const ph = g.phis[col]!;
    const dx = Math.sin(ph) * Math.cos(th);
    const dy = Math.sin(th);
    const dz = -Math.cos(ph) * Math.cos(th);
    const r = shape.radius(dx, dy, dz);
    return [dx * r, dy * r, dz * r];
  };
  // the columns of the mouth: from the middle out to just past the corner
  let half = 3;
  while (half < 9 && Math.abs(skinPt(centre + half, MOUTH_BAND.rowUp)[0]) < R * 0.27) half++;
  const n = half * 2 + 1;
  const U: V3[] = [];
  const L: V3[] = [];
  const N: V3[] = [];
  const JD: V3[] = []; // how far the jaw carries the lower row (m)
  const d = new Float64Array(MOUTH_MORPH_NAMES.length * 3);
  for (let k = 0; k < n; k++) {
    const col = centre - half + k;
    const u = skinPt(col, MOUTH_BAND.rowUp);
    const l = skinPt(col, MOUTH_BAND.rowLo);
    U.push(u);
    L.push(l);
    const m: V3 = [(u[0] + l[0]) / 2, (u[1] + l[1]) / 2, (u[2] + l[2]) / 2];
    N.push(shape.normal(m));
    faceDeltas(l[0] / R, l[1] / R, l[2] / R, d);
    JD.push([d[0]! * R, d[1]! * R, d[2]! * R]);
  }
  const halfWidth = Math.abs(U[n - 1]![0]);

  /** The strip at lateral x: upper row, lower row, normal, and the jaw displacement of the lower row. */
  const bandAt = (x: number): { u: V3; l: V3; n: V3; jd: V3 } => {
    let k = 0;
    while (k < n - 2 && U[k + 1]![0] < x) k++;
    const s = Math.max(0, Math.min(1, (x - U[k]![0]) / (U[k + 1]![0] - U[k]![0] || 1)));
    const mix3 = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
    const nn = mix3(N[k]!, N[k + 1]!);
    const nl = Math.hypot(...nn) || 1;
    return { u: mix3(U[k]!, U[k + 1]!), l: mix3(L[k]!, L[k + 1]!), n: [nn[0] / nl, nn[1] / nl, nn[2] / nl], jd: mix3(JD[k]!, JD[k + 1]!) };
  };
  /** Point at lateral x, fraction v across the strip (0 upper row, 1 lower row), `eps` (x R) off the skin. */
  const rest = (x: number, v: number, eps: number): V3 => {
    const b = bandAt(x);
    return [b.u[0] + (b.l[0] - b.u[0]) * v + b.n[0] * eps * R, b.u[1] + (b.l[1] - b.u[1]) * v + b.n[1] * eps * R, b.u[2] + (b.l[2] - b.u[2]) * v + b.n[2] * eps * R];
  };
  /** The same point with the jaw fully open. */
  const opened = (x: number, v: number, eps: number): V3 => {
    const b = bandAt(x);
    const p = rest(x, v, eps);
    return [p[0] + b.jd[0] * v, p[1] + b.jd[1] * v, p[2] + b.jd[2] * v];
  };
  /** The same point with the lips parted into a window `h` (x R) tall, jaw shut (v is a fraction of the window). */
  const barePt = (x: number, v: number, eps: number, h = 0.115): V3 => {
    const b = bandAt(x);
    const mid = rest(x, 0.5, eps);
    const gx = b.l[0] - b.u[0];
    const gy = b.l[1] - b.u[1];
    const gz = b.l[2] - b.u[2];
    const gl = Math.hypot(gx, gy, gz) || 1;
    const k = ((v - 0.5) * h * R) / gl;
    return [mid[0] + gx * k, mid[1] + gy * k, mid[2] + gz * k];
  };
  const normalAt = (x: number): V3 => bandAt(x).n;

  const mouthC = lin(PALETTE.face.mouth);
  const cavityC = lin(PALETTE.face.cavity);
  const gumC = lin(PALETTE.face.gum);
  const tongueC = lin(PALETTE.face.tongue);
  const ivory = lin(PALETTE.trim.teeth);
  const goldC = lin(gold);

  const seam: Vtx[] = [];
  const seamIdx: number[] = [];
  const body: Vtx[] = [];
  const bodyIdx: number[] = [];

  // ---- the seam: a slim dark tube along the middle of the strip, tapering to the corners ---------------------------------------------------------------
  const SP = 7;
  const SEG = 4;
  for (let i = 0; i < SP; i++) {
    const s = -1 + (2 * i) / (SP - 1);
    const x = s * halfWidth * 0.985;
    const t = 1 - Math.abs(s);
    const a = R * (0.0085 + 0.0075 * Math.sin(Math.PI * Math.min(1, t * 1.15) / 1)); // half height along the strip
    const bd = R * (0.0055 + 0.0045 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    const c0 = rest(x, 0.5, 0.004);
    const c1 = opened(x, 0, 0.004);
    const b = bandAt(x);
    const gx = b.l[0] - b.u[0];
    const gy = b.l[1] - b.u[1];
    const gz = b.l[2] - b.u[2];
    const gl = Math.hypot(gx, gy, gz) || 1;
    const dir: V3 = [gx / gl, gy / gl, gz / gl];
    for (let k = 0; k < SEG; k++) {
      const th = (k / SEG) * Math.PI * 2;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const off = (c: V3): V3 => [c[0] + dir[0] * a * cs + b.n[0] * bd * sn, c[1] + dir[1] * a * cs + b.n[1] * bd * sn, c[2] + dir[2] * a * cs + b.n[2] * bd * sn];
      const nrm: V3 = [dir[0] * cs + b.n[0] * sn, dir[1] * cs + b.n[1] * sn, dir[2] * cs + b.n[2] * sn];
      const p = off(c0);
      seam.push({ p, n: nrm, c: mulc(mouthC, 0.92 + 0.08 * sn), open: off(c1), bare: p });
    }
  }
  for (let i = 0; i < SP - 1; i++) {
    for (let k = 0; k < SEG; k++) {
      const a0 = i * SEG + k;
      const b0 = i * SEG + ((k + 1) % SEG);
      seamIdx.push(a0, b0, a0 + SEG, b0, b0 + SEG, a0 + SEG);
    }
  }

  // ---- the opening: three rows across the strip, lip-dark at both edges and cavity-dark between ----------------------------------------------------------
  const rowsV = [0, 0.5, 1];
  const base0 = body.length;
  for (let r = 0; r < rowsV.length; r++) {
    const v = rowsV[r]!;
    for (let k = 0; k < n; k++) {
      const x = U[k]![0];
      const p = rest(x, 0.5, 0.008);
      body.push({ p, n: normalAt(x), c: r === 1 ? cavityC : mixc(cavityC, mouthC, 0.75), open: opened(x, v, 0.008), bare: barePt(x, v, 0.008) });
    }
  }
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < n - 1; k++) {
      const a0 = base0 + r * n + k;
      bodyIdx.push(a0, a0 + n, a0 + 1, a0 + 1, a0 + n, a0 + n + 1);
    }
  }

  // ---- teeth and gums ----------------------------------------------------------------------------------------------------------------------------------------
  const missingFront = (teeth & 1) !== 0;
  const goldFront = (teeth & 2) !== 0;
  const missingSide = (teeth & 4) !== 0;
  const goldSide = (teeth & 8) !== 0;
  const buck = (teeth & 16) !== 0;
  const crooked = (teeth & 32) !== 0;
  const pitch = (halfWidth * 2 * 0.86) / 6;
  const WIDTH = [0.8, 0.95, 1.06, 1.06, 0.95, 0.8];
  const HEIGHT_U = [0.86, 0.96, 1.08, 1.08, 0.96, 0.86];
  const HEIGHT_L = [0.9, 0.95, 0.98, 0.98, 0.95, 0.9];
  // gums: a strip along the root of each row (upper: at the top edge of the opening, lower: at the bottom edge)
  const gum = (upper: boolean): void => {
    const b0 = body.length;
    const sp = 6;
    for (let r = 0; r < 2; r++) {
      const vo = upper ? (r === 0 ? 0 : 0.13) : r === 0 ? 0.87 : 1;
      const vb = upper ? (r === 0 ? 0 : 0.5) : r === 0 ? 0.5 : 1;
      for (let i = 0; i < sp; i++) {
        const s = -1 + (2 * i) / (sp - 1);
        const x = s * pitch * 3.2;
        body.push({ p: rest(x, 0.5, 0.0105), n: normalAt(x), c: gumC, open: opened(x, vo, 0.0105), bare: barePt(x, vb, 0.0105) });
      }
    }
    for (let i = 0; i < sp - 1; i++) bodyIdx.push(b0 + i, b0 + sp + i, b0 + i + 1, b0 + i + 1, b0 + sp + i, b0 + sp + i + 1);
  };
  gum(true);
  gum(false);
  const tooth = (i: number, upper: boolean): void => {
    const front = i === 2 || i === 3;
    const side = i === 0 || i === 5;
    const goldSideTooth = i === 1 || i === 4;
    if (upper) {
      if (front && missingFront) return;
      if (side && missingSide) return;
    } else if (side && i === 0 && missingSide) return;
    const isGold = upper && ((front && goldFront) || (goldSideTooth && goldSide));
    const col = isGold ? goldC : ivory;
    const cx = (i - 2.5) * pitch + (upper ? 0 : pitch * 0.12);
    const hw = pitch * 0.5 * (upper ? WIDTH[i]! : WIDTH[i]! * 0.9) * (front && upper ? 1.02 : 1);
    const crook = crooked ? (((i * 7) % 5) - 2) * 0.07 : 0;
    const sh = crooked ? (hash(i * 31 + (upper ? 5 : 9)) - 0.5) * 0.06 : 0; // crooked teeth also sit at different depths along the strip
    const hU = HEIGHT_U[i]!;
    const hL = HEIGHT_L[i]!;
    // four rows down the tooth: gum edge, crown, crown, rounded biting edge; v is the fraction across the strip, open and bare give the two layouts
    const rowsO = upper ? [0.02, 0.06, 0.2 * hU + 0.02, 0.3 * hU + 0.02] : [0.98, 0.94, 1 - 0.18 * hL - 0.02, 1 - 0.26 * hL - 0.02];
    const rowsB = upper ? [0.0, 0.05, 0.36 * hU, 0.47 * hU] : [1, 0.95, 1 - 0.36 * hL, 1 - 0.47 * hL];
    const widths = [1, 1, 1, 0.68];
    const b0 = body.length;
    const tip = mulc(col, 0.94);
    const cols4 = [mixc(gumC, col, 0.4), col, col, tip];
    for (let r = 0; r < 4; r++) {
      for (const sx of [-1, 1]) {
        const x = cx + sx * hw * 0.92 * widths[r]! + (sx * crook * pitch * 0.3) * (r / 3);
        const eps = 0.0122 + sh * 0.1;
        const vO = Math.max(-0.05, Math.min(1.05, rowsO[r]! + sh));
        const vB = Math.max(-0.05, Math.min(1.05, rowsB[r]! + sh));
        body.push({ p: rest(x, 0.5, eps), n: normalAt(x), c: cols4[r]!, open: opened(x, vO, eps), bare: barePt(x, vB, eps) });
      }
    }
    for (let r = 0; r < 3; r++) {
      const a0 = b0 + r * 2;
      bodyIdx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
  };
  for (let i = 0; i < 6; i++) tooth(i, true);
  for (let i = 0; i < 6; i++) tooth(i, false);

  // ---- the tongue: a low mound in the lower half of the opening ----------------------------------------------------------------------------------------
  {
    const cols = 5;
    const rowsT = [0.62, 0.8, 1.0];
    const b0 = body.length;
    for (let r = 0; r < rowsT.length; r++) {
      for (let i = 0; i < cols; i++) {
        const s = -1 + (2 * i) / (cols - 1);
        const x = s * halfWidth * 0.5 * (r === 2 ? 0.8 : 1);
        const hump = 0.0115 + 0.006 * (1 - s * s) * (r === 1 ? 1 : 0.4);
        const vo = rowsT[r]! - (r === 2 ? 0.03 : 0);
        const cen = 1 - Math.abs(s);
        const c = mixc(mulc(tongueC, 0.86), tongueC, r === 1 ? 0.3 + 0.7 * cen : 0.2);
        const outward = normalAt(x);
        body.push({
          p: rest(x, 0.5, 0.0095),
          n: normalAt(x),
          c: r === 1 && i === 2 ? mulc(tongueC, 0.8) : c,
          open: opened(x, vo, hump),
          bare: barePt(x, 0.5 + (rowsT[r]! - 0.5) * 0.4, 0.0095),
          tongue: [-outward[0] * R * 0.1 + 0, -outward[1] * R * 0.1 - R * 0.05 * (r + 1) * 0.6, -outward[2] * R * 0.1],
        });
      }
    }
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < cols - 1; i++) {
        const a0 = b0 + r * cols + i;
        bodyIdx.push(a0, a0 + cols, a0 + 1, a0 + 1, a0 + cols, a0 + cols + 1);
      }
    }
  }

  // ---- buck teeth: two big incisors that lie over the lower lip, shut or open ---------------------------------------------------------------------------
  if (buck) {
    const b0 = body.length;
    for (const sx of [-1, 1]) {
      const x0 = sx * pitch * 0.5;
      const hw = pitch * 0.5;
      const rowsBuck = [-0.35, -0.1, 1.2, 2.1, 2.3];
      const wBuck = [0.92, 1, 1, 0.9, 0.62];
      const start = body.length;
      for (let r = 0; r < rowsBuck.length; r++) {
        for (const e of [-1, 1]) {
          const x = x0 + e * hw * wBuck[r]! * 0.94;
          const p = rest(x, rowsBuck[r]!, 0.03 - (r >= 2 ? 0 : 0.012));
          const c = r === 0 ? mixc(gumC, ivory, 0.5) : r === rowsBuck.length - 1 ? mulc(ivory, 0.94) : ivory;
          body.push({ p, n: normalAt(x), c, fixed: true });
        }
      }
      for (let r = 0; r < rowsBuck.length - 1; r++) {
        const a0 = start + r * 2;
        bodyIdx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
      }
    }
    void b0;
  }

  const finish = (verts: Vtx[], idx: number[], morph: boolean): BufferGeometry => {
    const geo = new BufferGeometry();
    const nv = verts.length;
    const pos = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3);
    verts.forEach((v, i) => {
      pos.set(v.p, i * 3);
      nrm.set(v.n, i * 3);
      col.set(v.c, i * 3);
    });
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("normal", new BufferAttribute(nrm, 3));
    geo.setAttribute("color", new BufferAttribute(col, 3));
    // triangles face the way the skin does: judged on the OPEN layout (at rest the interior has no area)
    const fixed: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [verts[idx[t]!]!, verts[idx[t + 1]!]!, verts[idx[t + 2]!]!];
      const pa = a.open ?? a.p;
      const pb = b.open ?? b.p;
      const pc = c.open ?? c.p;
      const e1: V3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2: V3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const fx = e1[1] * e2[2] - e1[2] * e2[1];
      const fy = e1[2] * e2[0] - e1[0] * e2[2];
      const fz = e1[0] * e2[1] - e1[1] * e2[0];
      const dot = fx * (a.n[0] + b.n[0] + c.n[0]) + fy * (a.n[1] + b.n[1] + c.n[1]) + fz * (a.n[2] + b.n[2] + c.n[2]);
      if (dot >= 0) fixed.push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
      else fixed.push(idx[t]!, idx[t + 2]!, idx[t + 1]!);
    }
    geo.setIndex(fixed);
    if (morph) {
      const K = MOUTH_MORPH_NAMES.length;
      const targets = MOUTH_MORPH_NAMES.map(() => new Float32Array(nv * 3));
      const dd = new Float64Array(12 * 3);
      verts.forEach((v, i) => {
        faceDeltas(v.p[0] / R, v.p[1] / R, v.p[2] / R, dd, 0);
        for (let k = 1; k < 12; k++) {
          targets[k]![i * 3] = dd[k * 3]! * R;
          targets[k]![i * 3 + 1] = dd[k * 3 + 1]! * R;
          targets[k]![i * 3 + 2] = dd[k * 3 + 2]! * R;
        }
        if (!v.fixed) {
          if (v.open) for (let c = 0; c < 3; c++) targets[0]![i * 3 + c] = v.open[c]! - v.p[c]!;
          if (v.bare) for (let c = 0; c < 3; c++) targets[K - 2]![i * 3 + c] = v.bare[c]! - v.p[c]!;
          if (v.tongue) for (let c = 0; c < 3; c++) targets[K - 1]![i * 3 + c] = v.tongue[c]!;
        }
      });
      geo.morphAttributes.position = targets.map((t) => new BufferAttribute(t, 3));
      geo.morphTargetsRelative = true;
      geo.userData.morphNames = MOUTH_MORPH_NAMES;
    }
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  };

  const lineOnly = seam.map((v) => ({ ...v, open: undefined, bare: undefined }));
  const full = finish([...seam, ...body], [...seamIdx, ...bodyIdx.map((i) => i + seam.length)], true);
  const line = finish(lineOnly, seamIdx, false);
  const mid = rest(0, 0.5, 0);
  return { full, line, y: mid[1], z: mid[2], halfWidth };
}
