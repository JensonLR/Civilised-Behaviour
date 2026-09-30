import { Color } from "three";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import type { Ring } from "./loft.ts";
import { SOOT } from "./parts.ts";

/** Everything the body builders need, resolved once per character. */
export interface BodyCtx {
  spec: CharacterSpec;
  P: Proportions;
  skin: number;
  jacketC: number;
  trouserC: number;
  shirtC: number;
  /** Sleeve colour. */
  armC: number;
  accent: number;
  burnt: number;
  footH: number;
  /** Strap and boot leather (a colour from the spec's leather choice, singed). */
  leather: number;
}

/** Scales a colour's brightness (ambient-occlusion style darkening baked into section colours). */
export function tone(color: number, k: number): number {
  const c = new Color(color);
  c.multiplyScalar(k);
  c.r = Math.min(1, c.r);
  c.g = Math.min(1, c.g);
  c.b = Math.min(1, c.b);
  return c.getHex();
}

/** Grime: mixes a colour toward soot. Hems, knees and cuffs of people who have been dragged through a colony pick this up first. */
export function soil(color: number, amount: number): number {
  return new Color(color).lerp(new Color(SOOT), Math.max(0, Math.min(1, amount))).getHex();
}

/** Linear interpolation of a ring table at height y (clamped), for placing details on the surface. */
export function ringAt(rings: readonly Ring[], y: number): Required<Pick<Ring, "rx" | "rz" | "cx" | "cz" | "pow">> {
  const pick = (r: Ring) => ({ rx: r.rx, rz: r.rz, cx: r.cx ?? 0, cz: r.cz ?? 0, pow: r.pow ?? 2.4 });
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  const lo = Math.min(first.y, last.y);
  const hi = Math.max(first.y, last.y);
  if (y <= lo) return pick(first.y <= last.y ? first : last);
  if (y >= hi) return pick(first.y <= last.y ? last : first);
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      const A = pick(a);
      const B = pick(b);
      return { rx: A.rx + (B.rx - A.rx) * t, rz: A.rz + (B.rz - A.rz) * t, cx: A.cx + (B.cx - A.cx) * t, cz: A.cz + (B.cz - A.cz) * t, pow: A.pow + (B.pow - A.pow) * t };
    }
  }
  return pick(last);
}

/** Z (negative = front) of the surface of a section at lateral offset x. */
export function frontZ(section: ReturnType<typeof ringAt>, x = 0): number {
  const u = Math.min(0.999, Math.abs(x - section.cx) / section.rx);
  return section.cz - section.rz * (1 - u ** section.pow) ** (1 / section.pow);
}


/** Z (positive = back) of the back surface of a section at lateral offset x. */
export function backZ(section: ReturnType<typeof ringAt>, x = 0): number {
  return 2 * section.cz - frontZ(section, x);
}

/** A point on a section's surface at azimuth phi (0 = front, +pi/2 = the character's right), `lift` proud. */
export function sectionPoint(section: ReturnType<typeof ringAt>, y: number, phi: number, lift = 0): [number, number, number] {
  const e = 2 / section.pow;
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  return [section.cx + (section.rx + lift) * Math.sign(sn) * Math.abs(sn) ** e, y, section.cz - (section.rz + lift) * Math.sign(cs) * Math.abs(cs) ** e];
}

/** Cloth dyes as they hang from the spec: index into the cloth palette, wrapped. */
export const dyeAt = (palette: readonly number[], i: number): number => palette[((i % palette.length) + palette.length) % palette.length]!;

/** Radii of the neck where it meets the collar (the head's neck loft, see head.ts). */
export const neckRadii = (P: Proportions): { rx: number; rz: number } => ({ rx: P.headRadius * 0.42, rz: P.headRadius * 0.4 });

// ---- surfaces for patches ------------------------------------------------------------------------------------------------------

type Section = ReturnType<typeof ringAt>;

/**
 * A patch surface over a stack of sections (torso, coat skirt, limb): u = azimuth phi (0 = front, +pi/2 = the character's right), v = height y.
 * The outward normal is taken numerically from the surface itself, so a patch shades exactly like the loft under it and no seam shows.
 */
export function ringSurface(
  rings: readonly Ring[],
  scaleAt?: (y: number) => number,
  /** Radial modulation by azimuth and height (folds, pleats, a wavy hem): multiplies the section's radii; normals follow it, so the folds shade. */
  fold?: (phi: number, y: number) => number,
): (phi: number, y: number, lift: number) => { p: [number, number, number]; n: [number, number, number] } {
  const sec = (y: number): Section => ringAt(rings, y);
  const pt = (phi: number, y: number, lift: number): [number, number, number] => {
    const s = sec(y);
    const k = (scaleAt ? scaleAt(y) : 1) * (fold ? fold(phi, y) : 1);
    return sectionPoint({ ...s, rx: s.rx * k, rz: s.rz * k, cx: s.cx, cz: s.cz }, y, phi, lift);
  };
  return (phi, y, lift) => {
    const e = 0.02;
    const a = pt(phi - e, y, 0);
    const b = pt(phi + e, y, 0);
    const c0 = pt(phi, y - 0.012, 0);
    const c1 = pt(phi, y + 0.012, 0);
    const t1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const t2 = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    let nx = t1[1]! * t2[2]! - t1[2]! * t2[1]!;
    let ny = t1[2]! * t2[0]! - t1[0]! * t2[2]!;
    let nz = t1[0]! * t2[1]! - t1[1]! * t2[0]!;
    const s = sec(y);
    const p = pt(phi, y, lift);
    if (nx * (p[0] - s.cx) + nz * (p[2] - s.cz) < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    return { p, n: [nx / l, ny / l, nz / l] };
  };
}

/** Radius of a thigh before the trouser cut scales it (metres): the visual leg is fitted to the collision envelope, see proportions.ts. */
export const legRadius = (c: BodyCtx): number => (c.spec.trousers === 3 ? 0.125 : c.spec.trousers === 4 ? 0.11 : 0.1) * c.P.scale + 0.02;

/** Half-width of the waist: never much narrower than the shoulders it hangs from, or the figure reads as a wasp in a coat. */
export const waistHalf = (P: Proportions): number => Math.max(P.torsoWidth / 2 + P.bellyRadius * 0.5, P.shoulderHalfWidth * 0.74);
