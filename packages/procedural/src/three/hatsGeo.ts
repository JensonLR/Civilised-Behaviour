import { PALETTE } from "@cb/shared";
import type { CharacterSpec } from "../spec.ts";
import { curve } from "./sweep.ts";
import { sstep } from "./patch.ts";
import { PartBuilder, singe, type V3 } from "./parts.ts";
import { tone } from "./bodyKit.ts";
import { addBrim, addStar, ringAtAz, ringMap, type HeadFit, type StarRing } from "./headFit.ts";

/**
 * Hats. A hat is FITTED to the head it is on, not dropped on a circle: the crown is a star loft through the skull's own cross-sections (plus the thickness of the hair
 * under it and a small gap), so it follows a long, narrow, egg-shaped or huge skull exactly; a brim is a two-layer sheet whose root IS the crown wall's ring at the band;
 * bands, cords and trims are placed on that wall by querying it (`Crown.at`). Nothing is positioned in absolute metres: everything is a fraction of the head radius R or a
 * query of the skull, so a hat is right on the smallest and the biggest head.
 */
export interface HatCtx {
  b: PartBuilder;
  spec: CharacterSpec;
  hf: HeadFit;
  R: number;
  cy: number;
  hatC: number;
  accent: number;
  burnt: number;
  /** Band height above the head centre, in units of R. */
  seatY: number;
  /** Thickness of the hair under the hat at the band, in units of R (the crown clears it). */
  hairT: number;
}

/** A crown: a stack of rings you can query for the wall at any height. */
export interface Crown {
  rings: StarRing[];
  /** Highest point of the crown (bone space). */
  top: number;
  /** Wall radii at bone height y (interpolated between rings, clamped to the ends). */
  radiusAt(y: number): Float64Array;
  /** A point on the wall at azimuth phi and height y, `off` metres out. */
  at(phi: number, y: number, off?: number): V3;
  /** The wall along a meridian, base to apex, `off` metres out. */
  meridian(phi: number, off?: number): V3[];
}

/** Where the band of each hat is, for trims: height above the seat in R. */
const TRIM_Y: readonly number[] = [0, 0.16, 0.06, 0.08, 0.2, 0.04, 0.08, 0.08, 0.06, 0.06, 0.12, 0.35, 0.08, 0.04, 0.12, 0.06, 0.1, 0.06, 0.3, 0.06, 0.08];

export const HAT_SEAT = [0, 0.55, 0.5, 0.42, 0.55, 0.55, 0.5, 0.45, 0.5, 0.45, 0.52, 0.5, 0.42, 0.5, 0.5, 0.5, 0.42, 0.45, 0.5, 0.5, 0.5];

const TWO_PI = Math.PI * 2;
const wrap = (p: number): number => ((((p + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
/** A rounded tongue: 1 in front (phi = 0), 0 beyond +-half. For visors and peaks. */
const tongue = (phi: number, half: number): number => {
  const a = Math.abs(wrap(phi));
  return a >= half ? 0 : Math.sqrt(Math.cos((a / half) * (Math.PI / 2)));
};

export function buildHat(h: HatCtx): void {
  const { b, spec, hf, R, cy, hatC, accent, burnt } = h;
  const N = hf.N;
  const coarse = PartBuilder.hullMode || PartBuilder.lod >= 1;
  const seatRel = h.seatY * R; // head-centre relative
  const hy = cy + seatRel; // bone space
  const m0 = R * (0.045 + h.hairT * 1.2);
  const sec0 = hf.section(seatRel);
  const rb = ringMap(sec0, (r) => r + m0);
  const topRel = hf.skullTop;
  const clearH = cy + topRel + R * 0.06 - hy; // the crown must at least reach this above the band
  const hatBand = singe(PALETTE.trim.hatBand, burnt);
  const ivory = singe(PALETTE.trim.ivory, burnt);
  const leather = singe(PALETTE.material.leather, burnt);
  const fur = singe(PALETTE.material.fur, burnt);
  const furDark = singe(PALETTE.material.furDark, burnt);

  // ---- crowns ------------------------------------------------------------------------------------------------------------------------------------
  const makeCrown = (rings: StarRing[]): Crown => {
    const radiusAt = (y: number): Float64Array => {
      let i = 0;
      while (i < rings.length - 2 && y > rings[i + 1]!.y) i++;
      const a = rings[i]!;
      const c = rings[Math.min(rings.length - 1, i + 1)]!;
      const t = Math.max(0, Math.min(1, (y - a.y) / (c.y - a.y || 1)));
      const out = new Float64Array(N);
      for (let k = 0; k < N; k++) out[k] = a.r[k]! + (c.r[k]! - a.r[k]!) * t;
      return out;
    };
    const at = (phi: number, y: number, off = 0): V3 => {
      const r = ringAtAz(radiusAt(y), phi) + off;
      return [Math.sin(phi) * r, y, -Math.cos(phi) * r];
    };
    return { rings, top: rings[rings.length - 1]!.y, radiusAt, at, meridian: (phi, off = 0) => rings.map((g) => at(phi, g.y, off)) };
  };
  const FR = coarse ? [0, 0.5, 0.85] : [0, 0.28, 0.52, 0.72, 0.88, 0.97];
  interface DomeOpts {
    /** Vertical stretch (>= 1: the crown never dips into the skull). */
    k?: number;
    full?: (f: number) => number;
    az?: (phi: number, f: number) => number;
    dy?: (phi: number, f: number) => number;
    m1?: number;
    color?: number;
    /** Leave the dome open at the top (the caller closes it) - unused by default. */
    noAdd?: boolean;
  }
  /** A dome: the skull's sections from the band to the crown, offset out by the hair and a gap, optionally stretched upward. */
  const dome = (o: DomeOpts = {}): Crown => {
    const k = o.k ?? 1;
    const m1 = o.m1 ?? R * 0.05;
    const color = o.color ?? hatC;
    const rings: StarRing[] = FR.map((f) => {
      const ys = seatRel + (topRel - seatRel) * f;
      const sec = hf.section(ys);
      const m = m0 + (m1 - m0) * sstep(0.4, 1, f); // (thick hair rises above the band too: the margin holds until the dome closes in)
      const fu = o.full?.(f) ?? 1;
      const r = new Float64Array(N);
      const dy = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const phi = (i / N) * TWO_PI;
        r[i] = (sec[i]! + m) * fu * (o.az?.(phi, f) ?? 1);
        dy[i] = o.dy?.(phi, f) ?? 0;
      }
      return { y: hy + (ys - seatRel) * k, r, dy, color: tone(color, 0.96 + 0.1 * f) };
    });
    const apexY = hy + (topRel + m1 - seatRel) * k;
    const c = makeCrown(rings);
    c.top = apexY;
    addStar(b, rings, { color, top: "dome", apexY });
    return c;
  };
  /** A column: the band's outline scaled by a profile [height fraction, radius scale], flat lid with a bevel. */
  const column = (H: number, prof: readonly (readonly [number, number])[], o: { bevel?: number; lid?: number; color?: number; lean?: number; fur?: boolean } = {}): Crown => {
    const color = o.color ?? hatC;
    const rings: StarRing[] = prof.map(([t, sc], i) => {
      const r = ringMap(rb, (v, k) => v * sc * (o.fur ? 1 + 0.035 * (k % 2 ? 1 : -1) * (i === 0 ? 0.3 : 1) : 1));
      const g: StarRing = { y: hy + t * H, r, color: tone(color, 0.94 + 0.12 * t) };
      if (o.lean) g.cz = -o.lean * t;
      return g;
    });
    const last = rings[rings.length - 1]!;
    const bev = o.bevel ?? 0;
    if (bev > 0) {
      const lr = o.lid ?? 1;
      rings.push({ y: last.y + bev * 0.6, r: ringMap(last.r, (v) => v - bev * 0.7), color: tone(color, 1.06), cz: last.cz });
      void lr;
    }
    const c = makeCrown(rings);
    addStar(b, rings, { color, top: "flat" });
    return c;
  };
  const strip = (cr: Crown, y: number, hh: number, color: number, out = R * 0.008): void => {
    const lo = cr.radiusAt(y - hh / 2);
    const hi = cr.radiusAt(y + hh / 2);
    addStar(
      b,
      [
        { y: y - hh / 2, r: ringMap(lo, (v) => v + out), color },
        { y: y + hh / 2, r: ringMap(hi, (v) => v + out), color },
      ],
      { color, top: "none" },
    );
  };
  const brim = (cr: Crown, y: number, width: (phi: number) => number, rise: ((phi: number, s: number) => number) | undefined, color: number, thick = R * 0.03, lining = tone(color, 0.78), nv = 2): ((phi: number, s: number, lift?: number) => V3) =>
    addBrim(b, { y, inner: cr.radiusAt(y), width, rise, thick, color, lining, nv });
  const sphereAt = (r: number, color: number, p: V3, sc?: V3): void => void b.sphere(r, color, p, sc);

  let trimCrown: Crown | undefined;
  switch (spec.hat) {
    case 1: { // top hat: a tall crown that flares a little at the top, a narrow brim rolled up at the sides, a band
      const cr = column(Math.max(R * 1.12, clearH + R * 0.04), [[0, 1], [0.5, 1.03], [1, 1.07]], { bevel: R * 0.04 });
      brim(cr, hy, (p) => R * 0.4 * (1 + 0.12 * Math.cos(2 * p)), (p, s) => R * (0.14 * Math.sin(p) ** 2 * s * s - 0.012 * s), hatC, R * 0.03);
      strip(cr, hy + R * 0.16, R * 0.2, hatBand);
      trimCrown = cr;
      break;
    }
    case 2: { // bowler: a rounded dome, a narrow brim rolled up at the sides, a band
      const cr = dome({ k: 1.16, full: (f) => 1 + 0.05 * Math.sin(Math.PI * f) });
      brim(cr, hy, () => R * 0.2, (p, s) => R * (0.08 * Math.sin(p) ** 2 * s * s - 0.01 * s), hatC, R * 0.03);
      strip(cr, hy + R * 0.09, R * 0.16, hatBand);
      trimCrown = cr;
      break;
    }
    case 3: { // pith helmet: a broad dome, a shelf of brim sloping down all round, a band, a knob
      const cr = dome({ k: 1.04, full: (f) => 1 + 0.06 * Math.sin(Math.PI * f) });
      brim(cr, hy, () => R * 0.56, (_p, s) => -R * 0.14 * s ** 1.3, hatC, R * 0.035);
      strip(cr, hy + R * 0.1, R * 0.15, ivory);
      sphereAt(R * 0.09, accent, [0, cr.top + R * 0.02, 0]);
      trimCrown = cr;
      break;
    }
    case 4: { // shako: tall flared crown, a stiff peak, a cord, a spike
      const cr = column(Math.max(R * 1.15, clearH + R * 0.05), [[0, 1], [0.6, 1.05], [1, 1.13]], { bevel: R * 0.04 });
      brim(cr, hy, (p) => R * 0.36 * tongue(p, 1.05), (_p, s) => -R * 0.07 * s, tone(hatC, 0.75), R * 0.035);
      strip(cr, hy + R * 0.2, R * 0.06, accent, R * 0.012);
      b.cylinder(R * 0.09, R * 0.09, R * 0.06, accent, [0, cr.top + R * 0.03, 0]);
      b.cone(R * 0.11, R * 0.6, ivory, [0, cr.top + R * 0.36, 0]);
      trimCrown = cr;
      break;
    }
    case 5: { // bicorne: a soft dome with its brim folded up flat at the front and back and drawn out into two upturned points at the sides, a gilt edge and a cockade
      const cr = dome({ k: 1.05, full: (f) => 1 + 0.04 * Math.sin(Math.PI * f) });
      const surf = brim(
        cr,
        hy,
        (p) => R * (0.1 + 1.0 * Math.abs(Math.sin(p)) ** 4),
        (p, s) => R * (0.46 * Math.cos(p) ** 2 * s ** 1.2 + 0.2 * Math.sin(p) ** 2 * s * s),
        hatC,
        R * 0.03,
        tone(hatC, 0.78),
        4,
      );
      const lace: V3[] = [];
      const steps = coarse ? 20 : 40;
      for (let i = 0; i <= steps; i++) lace.push(surf((i / steps) * TWO_PI, 1, R * 0.012));
      b.sweep(lace, () => ({ rx: R * 0.02, rz: R * 0.02, pow: 2 }), accent, { side: [0, 1, 0], segments: 3 });
      sphereAt(R * 0.1, accent, surf(0, 1, R * 0.05), [1, 1, 0.55]);
      trimCrown = cr;
      break;
    }
    case 6: { // slouch hat: a soft dome, a wide brim that droops all round and is pinned up on one side, a band
      const cr = dome({ k: 1.12, full: (f) => 1 + 0.07 * Math.sin(Math.PI * f) });
      brim(cr, hy, () => R * 0.88, (p, s) => R * (-0.12 * s - 0.2 * s * s + 0.34 * s * s * Math.max(0, Math.sin(p)) ** 2), hatC, R * 0.03);
      strip(cr, hy + R * 0.08, R * 0.14, singe(PALETTE.trim.hatBandBrown, burnt));
      trimCrown = cr;
      break;
    }
    case 7: { // peaked cap: a low crown that overhangs at the top, a visor, a band, a badge
      const cr = column(Math.max(R * 0.44, clearH + R * 0.03), [[0, 1], [0.55, 1.05], [1, 1.14]], { bevel: R * 0.035 });
      brim(cr, hy, (p) => R * 0.4 * tongue(p, 1.05), (_p, s) => -R * 0.07 * s, leather, R * 0.03, tone(leather, 0.7));
      strip(cr, hy + R * 0.07, R * 0.13, hatBand, R * 0.012);
      const badge = cr.at(0, hy + R * 0.2, R * 0.012);
      b.sphere(R * 0.08, accent, badge, [1, 1, 0.45]);
      trimCrown = cr;
      break;
    }
    case 8: { // flat cap: a soft pouf that overhangs the band, a short peak, a button
      const cr = dome({ k: 1.0, m1: R * 0.07, full: (f) => 1 + 0.13 * Math.sin(Math.min(1, f * 1.15) * Math.PI), az: (p, f) => 1 + 0.08 * Math.max(0, Math.cos(p)) * Math.sin(Math.PI * f) });
      brim(cr, hy, (p) => R * 0.3 * tongue(p, 0.85), (_p, s) => -R * 0.05 * s, tone(hatC, 0.9), R * 0.03);
      sphereAt(R * 0.06, accent, [0, cr.top + R * 0.005, 0]);
      trimCrown = cr;
      break;
    }
    case 9: { // plumed helmet: a polished dome, a rim, a fin-like crest along the top and a fan of feathers falling back from a socket
      const cr = dome({ k: 1.14, color: accent });
      strip(cr, hy + R * 0.03, R * 0.09, tone(accent, 0.8), R * 0.012);
      const quill = singe(PALETTE.trim.plumeQuill, burnt);
      const crest = [...cr.meridian(0, R * 0.08).slice(1), ...cr.meridian(Math.PI, R * 0.08).reverse().slice(0, -1)];
      b.sweep(curve(crest, 14), (t) => ({ rx: R * 0.024, rz: R * 0.1 * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02))), pow: 2.2, color: quill }), quill, { side: [1, 0, 0], segments: 4, round: "both" });
      const plume = singe(PALETTE.trim.plume, burnt);
      const sock = cr.at(Math.PI, hy + (cr.top - hy) * 0.8, R * 0.05);
      b.cylinder(R * 0.06, R * 0.08, R * 0.12, tone(accent, 0.85), [sock[0], sock[1] + R * 0.02, sock[2]]);
      for (let i = 0; i < 5; i++) {
        const k = i - 2;
        const col = i % 2 ? tone(plume, 1.15) : plume;
        const pts: V3[] = [
          [k * R * 0.02, sock[1] + R * 0.08, sock[2]],
          [k * R * 0.05, sock[1] + R * (0.3 - Math.abs(k) * 0.03), sock[2] + R * 0.3],
          [k * R * 0.11, sock[1] + R * (0.3 - Math.abs(k) * 0.08), sock[2] + R * 0.68],
          [k * R * 0.17, sock[1] - R * (0.1 + Math.abs(k) * 0.07), sock[2] + R * 0.92],
        ];
        b.sweep(curve(pts, 8), (t) => ({ rx: R * (0.055 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.012), rz: R * 0.026, pow: 2.2, color: t > 0.7 ? tone(col, 1.1) : col }), col, { side: [1, 0, 0], segments: 4, round: "end" });
      }
      trimCrown = cr;
      break;
    }
    case 10: { // boater: a flat-topped straw crown, a stiff flat brim, a striped band
      const straw = singe(PALETTE.trim.straw, burnt);
      const cr = column(Math.max(R * 0.6, clearH + R * 0.04), [[0, 0.97], [1, 1.0]], { bevel: R * 0.035, color: straw });
      brim(cr, hy, () => R * 0.52, undefined, straw, R * 0.03, tone(straw, 0.78));
      strip(cr, hy + R * 0.12, R * 0.15, singe(PALETTE.cloth[0], burnt), R * 0.012);
      strip(cr, hy + R * 0.12, R * 0.05, ivory, R * 0.016);
      trimCrown = cr;
      break;
    }
    case 11: { // fez: a flat-topped cone in felt with a long tassel
      const fh = Math.max(R * 0.95, clearH + R * 0.06);
      const cr = column(fh, [[0, 1.0], [1, 0.84]], { bevel: R * 0.02 });
      strip(cr, hy + R * 0.03, R * 0.06, tone(hatC, 0.75), R * 0.01);
      // the tassel: from the middle of the top, over the edge on the right, and down the outside of the wall
      const wall = (y: number): number => ringAtAz(cr.radiusAt(y), Math.PI / 2);
      const topY = cr.top;
      const cordC = hatBand;
      const path: V3[] = [[R * 0.06, topY, 0], [wall(topY) * 0.6, topY + R * 0.06, 0], [wall(topY) + R * 0.05, topY - R * 0.03, 0], [wall(topY - R * 0.3) + R * 0.055, topY - R * 0.3, 0], [wall(topY - R * 0.5) + R * 0.055, topY - R * 0.52, 0]];
      b.sweep(curve(path, 9), (t) => ({ rx: R * 0.026, rz: R * 0.026, pow: 2, color: t > 0.85 ? tone(cordC, 1.4) : cordC }), cordC, { side: [0, 0, 1], segments: 4, round: "end" });
      const end = path[path.length - 1]!;
      b.cylinder(R * 0.035, R * 0.035, R * 0.05, accent, [end[0], end[1] - R * 0.03, end[2]]);
      b.cylinder(R * 0.07, R * 0.045, R * 0.22, tone(cordC, 1.25), [end[0], end[1] - R * 0.17, end[2]]);
      trimCrown = cr;
      break;
    }
    case 12: { // veiled pith: a pith helmet with a gauze veil hanging behind and to the sides, clear of the head, neck and shoulders
      const cr = dome({ k: 1.04, full: (f) => 1 + 0.06 * Math.sin(Math.PI * f) });
      const bw = R * 0.56;
      brim(cr, hy, () => bw, (_p, s) => -R * 0.14 * s ** 1.3, hatC, R * 0.035);
      strip(cr, hy + R * 0.1, R * 0.15, ivory);
      sphereAt(R * 0.09, accent, [0, cr.top + R * 0.02, 0]);
      buildVeil(h, cr, bw);
      trimCrown = cr;
      break;
    }
    case 13: { // tricorn: a low crown in a broad brim turned up along three straight walls; the corners (one ahead, two behind) stay flat and point outward
      const cr = dome({ k: 1.0, full: (f) => 1 + 0.03 * Math.sin(Math.PI * f) });
      const corner = (th: number): number => Math.max(0, Math.cos(3 * th)) ** 1.1;
      const surf = brim(
        cr,
        hy - R * 0.01,
        (th) => R * (0.24 + 0.72 * corner(th)),
        (th, s) => R * 0.52 * (1 - corner(th)) ** 1.25 * sstep(0.4, 1, s) ** 1.5,
        hatC,
        R * 0.03,
        tone(hatC, 0.78),
        5,
      );
      const lace: V3[] = [];
      const steps = coarse ? 18 : 36;
      for (let i = 0; i <= steps; i++) lace.push(surf((i / steps) * TWO_PI, 1, R * 0.012));
      b.sweep(lace, () => ({ rx: R * 0.02, rz: R * 0.02, pow: 2 }), accent, { side: [0, 1, 0], segments: 3 });
      strip(cr, hy + R * 0.03, R * 0.06, accent, R * 0.01);
      trimCrown = cr;
      break;
    }
    case 14: { // kepi: a drum crown leaning forward with a flat top, a short visor and a gold band
      const kh = Math.max(clearH + R * 0.04, R * 0.46);
      const cr = column(kh, [[0, 1], [0.6, 1.05], [1, 1.1]], { bevel: R * 0.03, lean: R * 0.07 });
      brim(cr, hy, (p) => R * 0.32 * tongue(p, 0.95), (_p, s) => -R * 0.07 * s, leather, R * 0.028, tone(leather, 0.7));
      strip(cr, hy + R * 0.13, R * 0.08, accent, R * 0.012);
      b.sphere(R * 0.06, accent, cr.at(0, hy + R * 0.13, R * 0.015), [1, 1, 0.5]);
      trimCrown = cr;
      break;
    }
    case 15: { // deerstalker: a low cap with a peak at both ends and ear flaps tied up over the crown
      const cr = dome({ k: 1.05, full: (f) => 1 + 0.04 * Math.sin(Math.PI * f) });
      const flapC = tone(hatC, 0.85);
      brim(cr, hy, (p) => R * 0.34 * tongue(p, 0.95) + R * 0.28 * tongue(p - Math.PI, 0.95), (p, s) => -R * (Math.abs(wrap(p)) < 1.5 ? 0.06 : 0.03) * s, flapC, R * 0.03);
      // the flaps lie along the crown, one each side, and are tied over the top
      for (const sx of [-1, 1]) {
        const mer = cr.meridian((sx * Math.PI) / 2, R * 0.03).slice(0, -1);
        b.sweep(curve(mer, mer.length + 3), (t) => ({ rx: R * (0.16 - 0.03 * t), rz: R * 0.05, pow: 2.4, color: tone(hatC, 1.06) }), hatC, { side: [0, 0, 1], segments: 4, round: "both" });
      }
      const knot: V3 = [0, cr.top + R * 0.03, 0];
      sphereAt(R * 0.065, hatBand, knot);
      for (const sx of [-1, 1]) b.cone(R * 0.05, R * 0.17, hatBand, [knot[0] + sx * R * 0.1, knot[1], 0], [0, 0, -(sx * Math.PI) / 2]);
      strip(cr, hy + R * 0.05, R * 0.06, tone(hatC, 0.7), R * 0.01);
      trimCrown = cr;
      break;
    }
    case 16: { // topee: a tall sun helmet, a puggaree wound round it, a brim swept out and down behind
      const cr = dome({ k: 1.16, full: (f) => 1 + 0.05 * Math.sin(Math.PI * f) });
      const back = (p: number): number => (1 - Math.cos(p)) / 2;
      brim(cr, hy, (p) => R * (0.4 + 0.34 * back(p)), (p, s) => -R * (0.07 + 0.24 * back(p)) * s, tone(hatC, 0.96), R * 0.035);
      strip(cr, hy + R * 0.08, R * 0.13, ivory, R * 0.012);
      strip(cr, hy + R * 0.2, R * 0.08, tone(ivory, 0.85), R * 0.008);
      b.cone(R * 0.05, R * 0.2, accent, [0, cr.top + R * 0.08, 0]);
      b.box(R * 0.1, R * 0.26, R * 0.025, ivory, cr.at(Math.PI / 2, hy + R * 0.02, R * 0.02), [0, -Math.PI / 2, 0]);
      trimCrown = cr;
      break;
    }
    case 17: { // nightcap: a soft cap fitted to the head with a long tail that flops over the top, hangs down the back and ends in a pompom
      const cr = dome({ k: 1.08, m1: R * 0.07, full: (f) => 1 + 0.05 * Math.sin(Math.PI * f) });
      strip(cr, hy + R * 0.04, R * 0.1, tone(hatC, 1.25), R * 0.03);
      const phi = Math.PI - 0.3;
      const yH = cr.top - R * 0.15;
      const ys = Array.from({ length: 7 }, (_, i) => yH - (R * 1.5 * i) / 6);
      const prof = hf.hangProfile(phi, ys, { gap: R * 0.07 + 0.01, slope: 1.6, maxR: R * 1.5, outer: (y) => Math.max(hf.headOuter(phi, y), y >= hy ? ringAtAz(cr.radiusAt(y), phi) : 0) + R * 0.1 });
      const keep = Math.max(3, ys.filter((y) => y >= prof.land - 1e-9).length);
      const path: V3[] = [[R * 0.03, cr.top + R * 0.02, R * 0.02], [R * 0.05, cr.top + R * 0.2, R * 0.3]];
      for (let i = 0; i < keep; i++) path.push([Math.sin(phi) * prof.rho[i]!, ys[i]!, -Math.cos(phi) * prof.rho[i]!]);
      b.sweep(curve(path, 12), (t) => ({ rx: R * (0.15 + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.3)) - 0.09 * t * t), rz: R * (0.15 + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.3)) - 0.09 * t * t), pow: 2.1, color: tone(hatC, 0.95 + 0.1 * t) }), hatC, { side: [1, 0, 0], segments: 8, round: "end" });
      const tip = path[path.length - 1]!;
      sphereAt(R * 0.13, tone(hatC, 1.3), [tip[0], tip[1] - R * 0.1, tip[2] + R * 0.02]);
      trimCrown = cr;
      break;
    }
    case 18: { // busby: a tall shaggy fur cylinder, a cloth bag falling to one side, a plume, cap-lines and a chin scale
      const bh = Math.max(R * 1.2, clearH + R * 0.25);
      const busbyFur = tone(furDark, 0.86);
      const prof: [number, number][] = [[0, 1.02], [0.4, 1.1], [1, 1.06]];
      const rings: StarRing[] = prof.map(([t, sc]) => ({
        y: hy + t * bh,
        r: ringMap(rb, (v, k) => v * sc * (1 + 0.035 * (k % 2 ? 1 : -1))),
        colors: Array.from({ length: N }, (_, k) => tone(k % 2 ? furDark : busbyFur, 0.8 + 0.4 * t)),
      }));
      const cr = makeCrown(rings);
      addStar(b, rings, { color: busbyFur, top: "flat" });
      const topY = cr.top;
      const topR = rings[2]!.r;
      if (PartBuilder.lod === 0 && !PartBuilder.hullMode) {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TWO_PI + 0.2;
          const rr = ringAtAz(topR, a) - R * 0.02;
          b.cone(R * 0.075, R * 0.2, i % 2 ? furDark : tone(furDark, 1.25), [Math.sin(a) * rr, topY + R * 0.06, -Math.cos(a) * rr]);
        }
      }
      // the bag: from the middle of the crown out over the right side and down
      const rr = ringAtAz(topR, Math.PI / 2);
      const bag = curve([[R * 0.2, topY + R * 0.02, R * 0.05], [rr * 0.8, topY + R * 0.03, R * 0.06], [rr + R * 0.14, topY - bh * 0.2, R * 0.05], [rr + R * 0.17, topY - bh * 0.55, R * 0.02]], 7);
      b.sweep(bag, (t) => ({ rx: R * (0.16 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.1))), rz: R * (0.13 + 0.03 * Math.sin(Math.PI * t)), pow: 2.2, color: t > 0.9 ? tone(hatC, 0.8) : hatC }), hatC, { side: [0, 0, 1], segments: 6, round: "end" });
      const bagEnd = bag[bag.length - 1]!;
      sphereAt(R * 0.05, accent, [bagEnd[0], bagEnd[1] - R * 0.17, bagEnd[2]]);
      // the plume at the front, left
      const plume = singe(PALETTE.trim.plume, burnt);
      const pr = ringAtAz(topR, -0.55);
      const px = -Math.sin(0.55) * pr;
      const pz = -Math.cos(0.55) * pr;
      b.cylinder(R * 0.05, R * 0.07, R * 0.12, accent, [px, topY + R * 0.03, pz]);
      b.sweep(curve([[px, topY + R * 0.08, pz], [px, topY + R * 0.34, pz - R * 0.02], [px + R * 0.1, topY + R * 0.62, pz + R * 0.06], [px + R * 0.36, topY + R * 0.7, pz + R * 0.22]], 7), (t) => ({ rx: R * 0.14 * (1 - 0.5 * t), rz: R * 0.12 * (1 - 0.45 * t), pow: 2.2, color: t > 0.5 ? tone(plume, 1.12) : plume }), plume, { side: [1, 0, 0], segments: 5, round: "end" });
      // cap-lines: a gold cord swagged across the front of the fur, and a band at the foot
      const sw = [cr.at(-1.25, hy + bh * 0.9, R * 0.02), cr.at(-0.5, hy + bh * 0.58, R * 0.02), cr.at(0.5, hy + bh * 0.58, R * 0.02), cr.at(1.25, hy + bh * 0.9, R * 0.02)];
      b.sweep(curve(sw, 9), () => ({ rx: R * 0.018, rz: R * 0.018, pow: 2 }), accent, { side: [0, 1, 0], segments: 3 });
      strip(cr, hy + R * 0.08, R * 0.05, accent, R * 0.02);
      b.box(R * 0.1, R * 0.12, R * 0.03, accent, cr.at(0, hy + bh * 0.4, R * 0.03));
      trimCrown = cr;
      break;
    }
    case 19: { // sou'wester: an oilskin dome, a short brim in front, a long one behind sloping down over the neck
      const cr = dome({ k: 1.1, full: (f) => 1 + 0.03 * Math.sin(Math.PI * f) });
      const backness = (p: number): number => sstep(0.3, 2.2, Math.abs(wrap(p)));
      brim(
        cr,
        hy,
        (p) => R * (0.26 + 0.62 * backness(p)),
        (p, s) => -R * (0.05 + 0.5 * backness(p)) * s ** 1.3,
        tone(hatC, 0.92),
        R * 0.03,
        tone(hatC, 0.7),
      );
      strip(cr, hy + R * 0.05, R * 0.09, tone(hatC, 0.75), R * 0.01);
      b.box(R * 0.05, R * 0.05, R * 0.22, tone(hatC, 0.7), cr.at(Math.PI / 2, hy + R * 0.02, R * 0.03));
      trimCrown = cr;
      break;
    }
    case 20: { // wide-awake: a low soft crown with a dent, a very wide brim drooping all round
      const cr = dome({ k: 1.0, full: (f) => 1 + 0.05 * Math.sin(Math.PI * f) });
      brim(cr, hy - R * 0.02, () => R * 0.9, (_p, s) => -R * 0.24 * s ** 1.4, hatC, R * 0.028);
      strip(cr, hy + R * 0.06, R * 0.12, singe(PALETTE.trim.hatBandBrown, burnt));
      sphereAt(R * 0.36, tone(hatC, 0.82), [0, cr.top - R * 0.005, 0], [1, 0.13, 1]);
      trimCrown = cr;
      break;
    }
    default:
      break;
  }

  // ---- hat trims -------------------------------------------------------------------------------------------------------------------------------
  const t = spec.hatTrim;
  if (t === 0 || spec.hat === 0 || !trimCrown) return;
  const cr = trimCrown;
  const by = hy + (TRIM_Y[spec.hat] ?? 0.06) * R;
  /** A point on the crown wall at the trim band, azimuth phi, `off` out. */
  const on = (phi: number, dy = 0, off = 0): V3 => cr.at(phi, by + dy, off);
  if (t === 1) {
    // goggles pushed up on the front of the hat: two lenses in brass rims on a strap wound round the crown
    strip(cr, by + R * 0.03, R * 0.06, leather, R * 0.014);
    for (const sx of [-1, 1]) {
      const phi = sx * 0.34;
      const p = on(phi, R * 0.12, R * 0.05);
      b.torus(R * 0.15, R * 0.033, accent, p, [0.2, -phi, 0]);
      b.cylinder(R * 0.13, R * 0.13, R * 0.03, singe(PALETTE.trim.goggleGlass, burnt), on(phi, R * 0.12, R * 0.035), [Math.PI / 2 + 0.2, -phi, 0]);
    }
    b.box(R * 0.12, R * 0.05, R * 0.04, leather, on(0, R * 0.12, R * 0.04), [0, 0, 0]);
  } else if (t === 2) {
    // a feather tucked in the band at the side: a curving quill with a vane
    const col = spec.hatColor % 2 ? singe(PALETTE.trim.featherGreen, burnt) : singe(PALETTE.trim.featherBlue, burnt);
    const s0 = on(1.25, 0, R * 0.02);
    const dir = (o: number, up: number): V3 => [s0[0] + Math.sin(1.25) * o, s0[1] + up, s0[2] - Math.cos(1.25) * o];
    b.sweep(curve([s0, dir(R * 0.16, R * 0.5), dir(R * 0.1, R * 1.0), dir(-R * 0.2, R * 1.3)], 8), (u) => ({ rx: R * 0.02 + R * 0.075 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - 0.3 * u), rz: R * 0.018, pow: 2.2, color: u < 0.12 ? ivory : col }), col, { side: [0, 0, 1], segments: 5, round: "end" });
  } else if (t === 3) {
    // a cap badge: a brass shield with an enamel centre on the front of the band
    b.box(R * 0.14, R * 0.16, R * 0.03, accent, on(0, R * 0.03, R * 0.018));
    b.cone(R * 0.1, R * 0.1, accent, on(0, -R * 0.09, R * 0.018), [Math.PI / 2, Math.PI / 4, Math.PI], [1, 1, 0.4]);
    b.box(R * 0.07, R * 0.08, R * 0.035, singe(PALETTE.trim.ribbonRed, burnt), on(0, R * 0.03, R * 0.036));
  } else if (t === 4) {
    // a cockade: a pleated rosette pinned at the left of the band
    const phi = -0.85;
    b.torus(R * 0.11, R * 0.04, singe(PALETTE.trim.ribbonRed, burnt), on(phi, R * 0.05, R * 0.03), [0, -phi, 0]);
    b.torus(R * 0.06, R * 0.03, ivory, on(phi, R * 0.05, R * 0.06), [0, -phi, 0]);
    b.sphere(R * 0.035, accent, on(phi, R * 0.05, R * 0.09));
  } else if (t === 5) {
    // ribbon tails: two streamers from a bow at the back of the band, hanging to the nape (and clear of it)
    const rc = singe(PALETTE.trim.ribbonBlue, burnt);
    const knot = on(Math.PI, 0, R * 0.02);
    b.sphere(R * 0.06, rc, knot);
    for (const sx of [-1, 1]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 2; i++) {
        const y = knot[1] - (R * 0.42 * i) / 1;
        const clear = hf.clearRadius(Math.PI + sx * 0.12, y, ringAtAz(cr.radiusAt(Math.max(hy, y)), Math.PI) + R * 0.03 * i, R * 0.03);
        pts.push([sx * R * (0.05 + 0.08 * i), y, clear]);
      }
      b.sweep(curve(pts, 6), () => ({ rx: R * 0.05, rz: R * 0.012, pow: 2.4 }), rc, { side: [1, 0, 0], segments: 4 });
    }
  }
  void fur;
}

/**
 * The veil of a veiled pith: gauze hanging from the brim edge, gathering in as it falls, and RESTING on the shoulders where it lands (it does not pass through the coat, the
 * neck or the collar, and does not spread round the body like a tent). It is a patch on a hang profile (HeadFit.hangProfile), like long hair.
 */
function buildVeil(h: HatCtx, cr: Crown, bw: number): void {
  const { b, hf, R, cy, burnt } = h;
  const hy = cy + h.seatY * R;
  const veil = singe(tone(PALETTE.material.linen, 1.05), burnt);
  const yTop = hy - R * 0.15; // (just below the drooping edge of the brim: the veil hangs FROM it)
  const yBot = hy - R * 1.35;
  const lodLow = PartBuilder.lod >= 1 || PartBuilder.hullMode;
  const nu = lodLow ? 16 : 26;
  const nv = lodLow ? 4 : 6;
  const phi0 = 1.25;
  const ys = Array.from({ length: nv + 1 }, (_, j) => yTop + ((yBot - yTop) * j) / nv);
  const cols: number[][] = [];
  const lands: number[] = [];
  const phis: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const phi = phi0 + ((2 * Math.PI - 2 * phi0) * i) / nu;
    phis.push(phi);
    const a = phi > Math.PI ? 2 * Math.PI - phi : phi;
    const edge = ringAtAz(cr.radiusAt(hy), phi) + bw * 0.98;
    const lowR = ringAtAz(cr.radiusAt(hy), phi) + R * 0.2;
    const p = hf.hangProfile(phi, ys, {
      gap: R * 0.06 + 0.01,
      inward: true,
      slope: 1.6,
      outer: (y) => {
        const t = Math.max(0, Math.min(1, (yTop - y) / (yTop - yBot)));
        const yr = y - cy;
        const skull = yr > -R * 1.05 ? ringAtAz(hf.section(yr), phi) + hf.hairLift(Math.sin(phi), 0, -Math.cos(phi)) + R * 0.08 : 0;
        return Math.max(skull, edge + (lowR - edge) * (t * t * (3 - 2 * t)));
      },
    });
    void a;
    cols.push(p.rho);
    lands.push(p.land === -Infinity ? -1e9 : p.land);
    cols[i] = p.rho;
  }
  const rho = (phi: number, y: number): number => {
    const fu = Math.max(0, Math.min(nu, ((phi - phi0) / (2 * Math.PI - 2 * phi0)) * nu));
    const i = Math.min(nu - 1, Math.floor(fu));
    const fy = Math.max(0, Math.min(nv, ((yTop - y) / (yTop - yBot)) * nv));
    const j = Math.min(nv - 1, Math.floor(fy));
    const a = cols[i]![j]! + (cols[i]![j + 1]! - cols[i]![j]!) * (fy - j);
    const e = cols[i + 1]![j]! + (cols[i + 1]![j + 1]! - cols[i + 1]![j]!) * (fy - j);
    return a + (e - a) * Math.min(1, fu - i);
  };
  const landAt = (phi: number): number => {
    const fu = Math.max(0, Math.min(nu, ((phi - phi0) / (2 * Math.PI - 2 * phi0)) * nu));
    const i = Math.min(nu - 1, Math.floor(fu));
    return Math.max(lands[i]!, lands[i + 1]!);
  };
  const surf = (phi: number, y: number, lift: number): { p: V3; n: V3 } => {
    const r = rho(phi, y);
    const dr = (rho(phi, y + R * 0.05) - rho(phi, y - R * 0.05)) / (R * 0.1);
    const nrm: V3 = [Math.sin(phi), -dr, -Math.cos(phi)];
    const l = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
    const n: V3 = [nrm[0] / l, nrm[1] / l, nrm[2] / l];
    return { p: [Math.sin(phi) * r + n[0] * lift, y + n[1] * lift, -Math.cos(phi) * r + n[2] * lift], n };
  };
  void phis;
  b.patch(
    {
      at: surf,
      u0: phi0,
      u1: 2 * Math.PI - phi0,
      v0: yBot,
      v1: yTop,
      nu,
      nv,
      inside: (phi, y) => Math.min((y - Math.max(yBot, landAt(phi) - R * 0.03 * Math.sin(phi * 9))) * 3, (yTop - y) * 3),
      lift: () => 0.004,
      color: (_phi, y) => (y < hy - R * 1.4 ? tone(veil, 0.8) : veil),
    },
    true,
  );
}
