import { SphereGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { CharacterSpec } from "../spec.ts";
import { curve } from "./sweep.ts";
import { numericSurface, sstep } from "./patch.ts";
import { PartBuilder, singe, type V3 } from "./parts.ts";
import { tone, ringSurface } from "./bodyKit.ts";
import type { HeadShape } from "./headShape.ts";

/**
 * Hats. Every crown is fitted to the sculpted skull: `rb` is the crown's half-width at the band (skull width there plus a margin for hair), `hy` the
 * height of the band above the head bone, `topH` the height that clears the crown of the skull. Trims (goggles, feather, badge, cockade, ribbons)
 * read `bandOf` so they sit on the band of whichever hat was chosen.
 */
export interface HatCtx {
  b: PartBuilder;
  spec: CharacterSpec;
  shape: HeadShape;
  R: number;
  cy: number;
  hatC: number;
  accent: number;
  burnt: number;
  /** Band height above the head centre, in units of R. */
  seatY: number;
  /** Crown half-width at the band (metres). */
  rb: number;
  hy: number;
  topH: number;
}

/** Where the band of each hat is, for trims: height above the seat in R, and radius as a multiple of `rb`. */
const BAND: readonly { y: number; r: number }[] = [
  { y: 0, r: 1 },
  { y: 0.16, r: 1.03 }, // top hat
  { y: 0.05, r: 1.02 }, // bowler
  { y: 0.06, r: 1.08 }, // pith
  { y: 0.2, r: 1.03 }, // shako
  { y: 0.02, r: 1.0 }, // bicorne
  { y: 0.06, r: 1.02 }, // slouch
  { y: 0.06, r: 1.05 }, // peaked cap
  { y: 0.03, r: 1.06 }, // flat cap
  { y: 0.05, r: 1.1 }, // plumed helmet
  { y: 0.12, r: 1.0 }, // boater
  { y: 0.35, r: 0.94 }, // fez
  { y: 0.06, r: 1.08 }, // veiled pith
  { y: 0.04, r: 1.0 }, // tricorn
  { y: 0.1, r: 1.04 }, // kepi
  { y: 0.05, r: 1.0 }, // deerstalker
  { y: 0.06, r: 1.1 }, // topee
  { y: 0.05, r: 1.04 }, // nightcap
  { y: 0.3, r: 1.05 }, // busby
  { y: 0.05, r: 1.03 }, // sou'wester
  { y: 0.06, r: 1.02 }, // wide-awake
];

export const HAT_SEAT = [0, 0.55, 0.5, 0.42, 0.55, 0.55, 0.5, 0.45, 0.5, 0.45, 0.52, 0.5, 0.42, 0.5, 0.5, 0.5, 0.42, 0.45, 0.5, 0.5, 0.5];

export function buildHat(h: HatCtx): void {
  const { b, spec, shape, R, hatC, accent, burnt, rb, hy, topH } = h;
  const band = (radius: number, y: number, color: number = accent): void => void b.torus(radius, R * 0.04, color, [0, y, 0], [Math.PI / 2, 0, 0]);
  const dome = (r: number, sy: number, y: number, color: number, sx = 1, sz = 1): void => void b.add(new SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, [0, y, 0], [0, 0, 0], [sx, sy, sz]);
  const domeH = (rx: number, minSy: number): number => Math.max(minSy, topH / rx);
  const hatBand = singe(PALETTE.trim.hatBand, burnt);
  const ivory = singe(PALETTE.trim.ivory, burnt);
  const fur = singe(PALETTE.material.fur, burnt);
  const furDark = singe(PALETTE.material.furDark, burnt);
  switch (spec.hat) {
    case 1: // top hat: tapered crown, flat brim with a rolled edge, band
      b.cylinder(rb * 0.9, rb * 1.03, R * 1.15, hatC, [0, hy + R * 0.575, 0]);
      b.cylinder(rb * 0.92, rb * 0.92, R * 0.03, hatC, [0, hy + R * 1.15, 0]);
      b.cylinder(rb * 1.5, rb * 1.5, R * 0.05, hatC, [0, hy, 0]);
      b.torus(rb * 1.5, R * 0.03, hatC, [0, hy, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.03, hy + R * 0.16, hatBand);
      break;
    case 2: // bowler: dome, rolled brim, band
      dome(rb * 1.02, domeH(rb * 1.02, 0.9), hy, hatC);
      b.cylinder(rb * 1.24, rb * 1.22, R * 0.05, hatC, [0, hy, 0]);
      b.torus(rb * 1.23, R * 0.035, hatC, [0, hy, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.02, hy + R * 0.05, hatBand);
      break;
    case 3: { // pith helmet: broad dome, ridged brim all round, band, knob
      const pithSy = domeH(rb * 1.1, 0.6);
      dome(rb * 1.1, pithSy, hy, hatC);
      b.cylinder(rb * 1.42, rb * 1.4, R * 0.05, hatC, [0, hy, 0]);
      b.torus(rb * 1.4, R * 0.04, hatC, [0, hy, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.08, hy + R * 0.06, ivory);
      b.sphere(R * 0.1, accent, [0, hy + rb * 1.1 * pithSy, 0]);
      break;
    }
    case 4: // shako: tall, flared crown, peak, cord and spike
      b.cylinder(rb * 1.12, rb * 1.0, R * 1.15, hatC, [0, hy + R * 0.575, 0]);
      b.box(rb * 1.2, R * 0.05, R * 0.55, hatC, [0, hy, -rb * 1.05]);
      b.torus(rb * 1.03, R * 0.035, accent, [0, hy + R * 0.2, 0], [Math.PI / 2, 0, 0]);
      b.cone(R * 0.16, R * 0.7, ivory, [0, hy + R * 1.5, 0]);
      break;
    case 5: // bicorne: wide crescent worn sideways with a cockade
      dome(rb, domeH(rb, 0.6), hy, hatC, 2.0, 0.95);
      b.torus(rb, R * 0.05, accent, [0, hy, 0], [Math.PI / 2, 0, 0], [2.0, 0.95, 1]);
      b.sphere(R * 0.14, accent, [rb * 1.9, hy + R * 0.12, 0]);
      break;
    case 6: // slouch hat: soft dome, wide drooping brim, band
      dome(rb * 1.02, domeH(rb * 1.02, 0.62), hy, hatC);
      b.cylinder(rb * 1.75, rb * 1.75, R * 0.04, hatC, [0, hy - R * 0.02, 0], [0.1, 0, 0.05]);
      band(rb * 1.02, hy + R * 0.06, singe(PALETTE.trim.hatBandBrown, burnt));
      break;
    case 7: // peaked cap: low crown, visor, badge
      b.cylinder(rb * 1.0, rb * 1.07, topH, hatC, [0, hy + topH / 2, 0]);
      b.cylinder(rb * 0.98, rb * 0.98, R * 0.03, hatC, [0, hy + topH, 0]);
      b.box(rb * 1.05, R * 0.04, R * 0.5, singe(PALETTE.material.leather, burnt), [0, hy, -rb * 1.02]);
      b.sphere(R * 0.1, accent, [0, hy + R * 0.14, -rb * 1.06]);
      band(rb * 1.05, hy + R * 0.06, hatBand);
      break;
    case 8: { // flat cap: squashed dome with a short peak
      const capSy = domeH(rb * 1.06, 0.42);
      dome(rb * 1.06, capSy, hy, hatC, 1.05, 1.1);
      b.box(rb * 0.85, R * 0.05, R * 0.4, hatC, [0, hy, -rb * 1.12], [0.15, 0, 0]);
      b.sphere(R * 0.07, accent, [0, hy + rb * 1.06 * capSy, 0]);
      break;
    }
    case 9: { // plumed helmet: polished dome, crest ridge, swept plume
      const helmSy = domeH(rb * 1.04, 0.9);
      dome(rb * 1.04, helmSy, hy, accent);
      b.cylinder(rb * 1.1, rb * 1.1, R * 0.05, accent, [0, hy, 0]);
      b.box(R * 0.09, R * 0.14, rb * 1.7, singe(PALETTE.trim.plumeQuill, burnt), [0, hy + rb * 1.04 * helmSy, R * 0.05]);
      for (let i = 0; i < 4; i++) b.cone(R * 0.16, R * 0.75, singe(PALETTE.trim.plume, burnt), [0, hy + rb * 1.04 * helmSy + R * 0.05 - i * R * 0.05, R * (0.4 + i * 0.32)], [Math.PI / 2 + 0.25 * i, 0, 0]);
      break;
    }
    case 10: // boater: flat-topped straw crown, stiff flat brim, striped band
      b.cylinder(rb * 0.96, rb * 1.0, topH, singe(PALETTE.trim.straw, burnt), [0, hy + topH / 2, 0]);
      b.cylinder(rb * 1.5, rb * 1.5, R * 0.04, singe(PALETTE.trim.straw, burnt), [0, hy, 0]);
      b.cylinder(rb * 1.005, rb * 1.005, R * 0.14, singe(PALETTE.cloth[0], burnt), [0, hy + R * 0.12, 0]);
      break;
    case 11: { // fez: a flat-topped cone in red felt with a long black tassel
      const fh = Math.max(R * 0.95, topH + R * 0.06);
      b.cylinder(rb * 0.86, rb * 1.0, fh, hatC, [0, hy + fh / 2, 0]);
      b.cylinder(rb * 0.84, rb * 0.84, R * 0.02, tone(hatC, 1.12), [0, hy + fh + R * 0.005, 0]);
      b.torus(rb * 1.0, R * 0.03, tone(hatC, 0.75), [0, hy + R * 0.02, 0], [Math.PI / 2, 0, 0]);
      const top: V3 = [rb * 0.2, hy + fh, 0];
      b.sweep(curve([top, [rb * 0.6, hy + fh + R * 0.12, R * 0.05], [rb * 0.95, hy + fh - R * 0.05, R * 0.06], [rb * 1.0, hy + fh - R * 0.5, R * 0.05]], 8), (t) => ({ rx: R * 0.028, rz: R * 0.028, pow: 2, color: t > 0.85 ? tone(hatBand, 1.5) : hatBand }), hatBand, { side: [0, 0, 1], segments: 4, round: "end" });
      b.cylinder(R * 0.04, R * 0.04, R * 0.16, hatBand, [rb * 1.0, hy + fh - R * 0.62, R * 0.05]);
      break;
    }
    case 12: { // veiled pith: a pith helmet with a gauze veil hanging behind and to the sides down to the shoulders
      const pithSy = domeH(rb * 1.1, 0.6);
      dome(rb * 1.1, pithSy, hy, hatC);
      b.cylinder(rb * 1.42, rb * 1.4, R * 0.05, hatC, [0, hy, 0]);
      b.torus(rb * 1.4, R * 0.04, hatC, [0, hy, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.08, hy + R * 0.06, ivory);
      b.sphere(R * 0.1, accent, [0, hy + rb * 1.1 * pithSy, 0]);
      const veil = singe(tone(PALETTE.material.linen, 1.05), burnt);
      const rings = [
        { y: hy - R * 0.02, rx: rb * 1.4, rz: rb * 1.4, pow: 2.2, color: veil },
        { y: hy - R * 0.75, rx: rb * 1.2, rz: rb * 1.16, pow: 2.2, color: veil },
        { y: hy - R * 1.5, rx: rb * 0.85, rz: rb * 0.82, pow: 2.2, color: tone(veil, 0.92) },
      ];
      const surf = ringSurface(rings);
      b.patch(
        {
          at: (phi, y, l) => surf(phi, y, l),
          u0: -Math.PI,
          u1: Math.PI,
          v0: hy - R * 1.5,
          v1: hy - R * 0.02,
          nu: 24,
          nv: 5,
          inside: (phi, y) => Math.min(Math.abs(phi) - 1.05, (y - (hy - R * 1.5)) * 3, (hy - R * 0.02 - y) * 3),
          lift: () => 0.004,
          color: (_phi, y) => (y < hy - R * 1.4 ? tone(veil, 0.8) : veil),
        },
        true,
      );
      break;
    }
    case 13: { // tricorn: a low crown in a broad brim turned up along three straight walls; the corners (one ahead, two behind) stay flat and point outward
      const crownSy = domeH(rb * 1.02, 0.5);
      dome(rb * 1.02, crownSy, hy, hatC);
      const corner = (th: number): number => Math.max(0, Math.cos(3 * th)) ** 1.1; // 1 at the three corners, 0 half-way between them
      const rOut = (th: number): number => rb * (1.2 + 0.85 * corner(th));
      const wallH = (th: number): number => R * 0.5 * (1 - corner(th)) ** 1.25;
      // (th, s): th round the hat from the front, s from the crown (0) out to the edge (1); the brim is flat out to s = 0.4 and folds up beyond it
      const brim = numericSurface((th, s): V3 => {
        const fold = sstep(0.4, 1, s);
        const rho = rb * 1.0 + (rOut(th) - rb) * s * (1 - 0.12 * fold * (1 - corner(th)));
        return [Math.sin(th) * rho, hy - R * 0.01 + wallH(th) * fold ** 1.5, -Math.cos(th) * rho];
      });
      b.patch(
        {
          at: (th, s, lift) => brim(th, s, lift),
          u0: 0,
          u1: Math.PI * 2,
          v0: 0,
          v1: 1,
          nu: 36,
          nv: 4,
          wrap: true,
          lift: () => 0,
          color: (_th, s) => (s > 0.8 ? tone(hatC, 1.08) : tone(hatC, 0.96)),
          thick: R * 0.03,
          lining: tone(hatC, 0.78),
          rim: (_th, s) => s > 0.9,
        },
        true,
      );
      // gold lace all round the edge (a thin tube along the rim, the top of each wall)
      const lace: V3[] = [];
      for (let i = 0; i <= 36; i++) {
        const th = (i / 36) * Math.PI * 2;
        const q = brim(th, 1, R * 0.012).p;
        lace.push(q);
      }
      b.sweep(lace, () => ({ rx: R * 0.02, rz: R * 0.02, pow: 2 }), accent, { side: [0, 1, 0], segments: 3 });
      b.torus(rb * 1.02, R * 0.03, accent, [0, hy + R * 0.02, 0], [Math.PI / 2, 0, 0]);
      break;
    }
    case 14: { // kepi: a drum crown leaning forward with a flat top, a short visor and a gold band
      const kh = Math.max(topH + R * 0.02, R * 0.45);
      b.cylinder(rb * 1.08, rb * 1.0, kh, hatC, [0, hy + kh / 2, -R * 0.03], [-0.16, 0, 0]);
      b.cylinder(rb * 1.04, rb * 1.04, R * 0.03, tone(hatC, 1.12), [0, hy + kh + R * 0.03, -R * 0.1], [-0.16, 0, 0]);
      b.box(rb * 0.95, R * 0.035, R * 0.42, singe(PALETTE.material.leather, burnt), [0, hy + R * 0.02, -rb * 1.02], [0.18, 0, 0]);
      b.torus(rb * 1.0, R * 0.03, accent, [0, hy + R * 0.14, 0], [Math.PI / 2, 0, 0]);
      b.sphere(R * 0.07, accent, [0, hy + R * 0.14, -rb * 1.04], [1, 1, 0.5]);
      break;
    }
    case 15: { // deerstalker: a low cap with a peak at both ends and ear flaps tied up over the crown
      dome(rb * 1.03, domeH(rb * 1.03, 0.7), hy, hatC);
      b.box(rb * 0.9, R * 0.04, R * 0.42, tone(hatC, 0.85), [0, hy, -rb * 1.08], [0.2, 0, 0]);
      b.box(rb * 0.9, R * 0.04, R * 0.36, tone(hatC, 0.85), [0, hy, rb * 1.08], [-0.2, 0, 0]);
      // the ear flaps are tied up over the crown, lying along it either side of the bow
      const topY = hy + rb * 1.03 * domeH(rb * 1.03, 0.7);
      for (const sx of [-1, 1]) b.box(R * 0.2, R * 0.05, rb * 1.3, tone(hatC, 1.06), [sx * rb * 0.42, topY - R * 0.06, 0], [0, 0, sx * -0.55]);
      const knot: V3 = [0, topY + R * 0.03, 0];
      b.sphere(R * 0.07, hatBand, knot);
      for (const sx of [-1, 1]) b.cone(R * 0.06, R * 0.16, hatBand, [knot[0] + sx * R * 0.1, knot[1] + R * 0.02, 0], [0, 0, -sx * Math.PI / 2]);
      band(rb * 1.03, hy + R * 0.04, tone(hatC, 0.7));
      break;
    }
    case 16: { // topee: a tall ribbed sun helmet with a puggaree wound round it and a brim that sweeps out and down behind
      const topSy = domeH(rb * 1.08, 0.75);
      dome(rb * 1.08, topSy, hy, hatC);
      for (let i = 1; i <= 3; i++) b.torus(rb * 1.08 * Math.sqrt(Math.max(0.05, 1 - (i / 4.2) ** 2)), R * 0.014, tone(hatC, 0.8), [0, hy + rb * 1.08 * topSy * (i / 4.2), 0], [Math.PI / 2, 0, 0]);
      b.cylinder(rb * 1.35, rb * 1.33, R * 0.05, hatC, [0, hy, R * 0.05]);
      b.cylinder(rb * 1.35, rb * 1.62, R * 0.1, tone(hatC, 0.94), [0, hy - R * 0.06, rb * 0.32], [0.16, 0, 0], [1, 1, 0.75]);
      band(rb * 1.1, hy + R * 0.05, ivory);
      band(rb * 1.1, hy + R * 0.14, tone(ivory, 0.85));
      b.cone(R * 0.05, R * 0.2, accent, [0, hy + rb * 1.08 * topSy + R * 0.08, 0]);
      b.box(R * 0.12, R * 0.3, R * 0.03, ivory, [rb * 1.06, hy - R * 0.1, R * 0.1]);
      break;
    }
    case 17: { // nightcap: a soft cone that flops to one side with a pompom
      const base = hy + R * 0.02;
      const path: V3[] = [[0, base, 0], [0, base + R * 0.6, R * 0.03], [rb * 0.35, base + R * 1.05, R * 0.08], [rb * 0.95, base + R * 1.05, R * 0.14], [rb * 1.35, base + R * 0.7, R * 0.16]];
      b.sweep(curve(path, 12), (t) => ({ rx: rb * (1.04 - 0.85 * t * t), rz: rb * (1.04 - 0.85 * t * t), pow: 2.2, color: t < 0.12 ? tone(hatC, 0.85) : hatC }), hatC, { side: [1, 0, 0], segments: 8, round: "end" });
      b.torus(rb * 1.02, R * 0.06, tone(hatC, 1.25), [0, base + R * 0.03, 0], [Math.PI / 2, 0, 0]);
      b.sphere(R * 0.13, tone(hatC, 1.3), [rb * 1.42, base + R * 0.6, R * 0.16]);
      break;
    }
    case 18: { // busby: a tall shaggy fur cylinder with a cloth bag falling from the top to one side, a plume at the front, gold cap-lines and a chin scale
      const bh = Math.max(R * 1.2, topH + R * 0.25);
      const busbyFur = tone(furDark, 0.86); // (a busby is dark bearskin: the light fur colour is only for the shaggy tips)
      const rr = (y: number, k: number): { y: number; rx: number; rz: number; pow: number; color: number } => ({ y: hy + y * bh, rx: rb * k, rz: rb * k, pow: 2.1, color: busbyFur });
      const wall = [rr(1, 1.06), rr(0.55, 1.14), rr(0, 1.05)];
      const surf = ringSurface(wall, undefined, (phi, y) => 1 + 0.05 * Math.cos(14 * phi) * (0.6 + 0.4 * Math.sin((y - hy) * 30)) + 0.03 * Math.cos(5 * phi + 1));
      if (PartBuilder.hullMode || PartBuilder.lod >= 2) b.loft(wall.map((w) => ({ ...w, y: w.y - hy })), fur, [0, hy, 0], undefined, undefined, { capTop: false, capBottom: false });
      else
        b.patch(
          {
            at: (phi, y, lift) => surf(phi, y, lift),
            u0: -Math.PI,
            u1: Math.PI,
            v0: hy,
            v1: hy + bh,
            nu: 28,
            nv: 5,
            wrap: true,
            lift: () => 0,
            color: (phi, y) => {
              const streak = 0.5 + 0.5 * Math.cos(14 * phi);
              const up = (y - hy) / bh;
              return tone(streak > 0.55 ? furDark : busbyFur, 0.8 + 0.4 * up);
            },
          },
          true,
        );
      // the rounded top, shaggy at its rim
      b.sphere(rb * 1.04, tone(furDark, 1.1), [0, hy + bh, 0], [1, 0.32, 1]);
      if (PartBuilder.lod === 0) for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.2;
        b.cone(R * 0.075, R * 0.2, i % 2 ? furDark : tone(furDark, 1.25), [Math.sin(a) * rb * 1.02, hy + bh * 1.0 + R * 0.01, -Math.cos(a) * rb * 1.02], [0, 0, 0], [1, 1, 1]);
      }
      // the bag: a cloth pouch from the crown falling down the right side, with a tassel
      const bag = curve([[rb * 0.25, hy + bh * 1.02, R * 0.05], [rb * 0.85, hy + bh * 1.02, R * 0.06], [rb * 1.22, hy + bh * 0.6, R * 0.05], [rb * 1.26, hy + bh * 0.2, R * 0.02]], 6);
      b.sweep(bag, (t) => ({ rx: R * (0.16 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.1))), rz: R * (0.13 + 0.03 * Math.sin(Math.PI * t)), pow: 2.2, color: t > 0.9 ? tone(hatC, 0.8) : hatC }), hatC, { side: [0, 0, 1], segments: 6, round: "end" });
      b.sphere(R * 0.05, accent, [rb * 1.27, hy + bh * 0.15, R * 0.02]);
      const plume = singe(PALETTE.trim.plume, burnt);
      b.cylinder(R * 0.05, R * 0.07, R * 0.12, accent, [-rb * 0.42, hy + bh * 1.02, -rb * 0.7]);
      b.sweep(curve([[-rb * 0.42, hy + bh * 1.04, -rb * 0.7], [-rb * 0.42, hy + bh * 1.32, -rb * 0.72], [-rb * 0.3, hy + bh * 1.62, -rb * 0.66], [-rb * 0.02, hy + bh * 1.72, -rb * 0.5]], 6), (t) => ({ rx: R * 0.14 * (1 - 0.5 * t), rz: R * 0.12 * (1 - 0.45 * t), pow: 2.2, color: t > 0.5 ? tone(plume, 1.12) : plume }), plume, { side: [1, 0, 0], segments: 5, round: "end" });
      // cap-lines: a gold cord swagged across the front of the fur, and a band at the foot
      b.sweep(curve([[-rb * 0.98, hy + bh * 0.92, -rb * 0.35], [-rb * 0.45, hy + bh * 0.55, -rb * 1.02], [rb * 0.45, hy + bh * 0.55, -rb * 1.02], [rb * 0.98, hy + bh * 0.92, -rb * 0.35]], 9), () => ({ rx: R * 0.018, rz: R * 0.018, pow: 2 }), accent, { side: [0, 1, 0], segments: 3 });
      b.torus(rb * 1.08, R * 0.025, accent, [0, hy + R * 0.08, 0], [Math.PI / 2, 0, 0]);
      b.box(R * 0.1, R * 0.12, R * 0.03, accent, [0, hy + bh * 0.4, -rb * 1.13]);
      break;
    }
    case 19: { // sou'wester: oilskin dome, a short brim in front and a long one behind sloping down over the neck
      dome(rb * 1.03, domeH(rb * 1.03, 0.78), hy, hatC);
      b.cylinder(rb * 1.18, rb * 1.16, R * 0.04, tone(hatC, 0.92), [0, hy, 0]);
      b.loft(
        [
          { y: hy + R * 0.02, rx: rb * 1.12, rz: rb * 0.85, cz: rb * 0.35, pow: 2.2, color: tone(hatC, 0.95) },
          { y: hy - R * 0.5, rx: rb * 1.32, rz: rb * 0.6, cz: rb * 0.92, pow: 2.4, color: tone(hatC, 0.88) },
          { y: hy - R * 1.05, rx: rb * 1.5, rz: rb * 0.35, cz: rb * 1.4, pow: 3, color: tone(hatC, 0.8) },
        ],
        hatC,
        undefined,
        undefined,
        undefined,
        { capTop: false },
      );
      band(rb * 1.03, hy + R * 0.04, tone(hatC, 0.75));
      b.box(R * 0.05, R * 0.05, R * 0.25, tone(hatC, 0.7), [rb * 1.0, hy - R * 0.1, -R * 0.1]);
      break;
    }
    case 20: { // wide-awake: a low soft felt crown with a dent and a very wide brim that droops in front and behind
      dome(rb * 1.02, domeH(rb * 1.02, 0.55), hy, hatC, 1, 1.05);
      // the brim droops all round: a shallow cone, the crown end at the band and the rim well below it
      b.cylinder(rb * 1.0, rb * 2.0, R * 0.16, hatC, [0, hy - R * 0.06, 0], [0.0, 0, 0.0], undefined, true);
      b.torus(rb * 2.0, R * 0.02, tone(hatC, 0.85), [0, hy - R * 0.14, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.02, hy + R * 0.06, singe(PALETTE.trim.hatBandBrown, burnt));
      b.sphere(rb * 0.4, tone(hatC, 0.82), [0, hy + rb * 1.02 * domeH(rb * 1.02, 0.55) - R * 0.05, 0], [1, 0.25, 1]); // the dent
      break;
    }
    default:
      break;
  }

  // ---- hat trims -----------------------------------------------------------------------------------------------------------------------
  const t = spec.hatTrim;
  if (t === 0 || spec.hat === 0) return;
  const bd = BAND[spec.hat] ?? BAND[0]!;
  const by = hy + bd.y * R;
  const br = rb * bd.r;
  if (t === 1) {
    // goggles pushed up on the front of the hat: two lenses in brass rims on a leather strap wound round the crown
    const leather = singe(PALETTE.material.leather, burnt);
    for (const sx of [-1, 1]) {
      b.torus(R * 0.16, R * 0.035, accent, [sx * R * 0.2, by + R * 0.1, -br * 0.98], [0.15, 0, 0]);
      b.cylinder(R * 0.14, R * 0.14, R * 0.03, singe(PALETTE.trim.goggleGlass, burnt), [sx * R * 0.2, by + R * 0.1, -br * 0.98], [Math.PI / 2 + 0.15, 0, 0]);
    }
    b.box(R * 0.14, R * 0.05, R * 0.04, leather, [0, by + R * 0.1, -br * 0.99]);
    b.torus(br * 1.0, R * 0.03, leather, [0, by + R * 0.03, 0], [Math.PI / 2, 0, 0]);
  } else if (t === 2) {
    // a feather tucked in the band at the side: a curving quill with a vane
    const col = spec.hatColor % 2 ? singe(PALETTE.trim.featherGreen, burnt) : singe(PALETTE.trim.featherBlue, burnt);
    const s0: V3 = [br * 0.96, by, -br * 0.2];
    b.sweep(curve([s0, [br * 1.05, by + R * 0.5, -br * 0.35], [br * 0.9, by + R * 1.0, -br * 0.4], [br * 0.6, by + R * 1.3, -br * 0.2]], 8), (u) => ({ rx: R * 0.02 + R * 0.075 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - 0.3 * u), rz: R * 0.018, pow: 2.2, color: u < 0.12 ? ivory : col }), col, { side: [0, 0, 1], segments: 5, round: "end" });
  } else if (t === 3) {
    // a cap badge: a brass shield with an enamel centre on the front of the band
    b.box(R * 0.14, R * 0.16, R * 0.03, accent, [0, by + R * 0.03, -br * 1.02]);
    b.cone(R * 0.1, R * 0.1, accent, [0, by - R * 0.09, -br * 1.02], [Math.PI / 2, Math.PI / 4, Math.PI], [1, 1, 0.4]);
    b.box(R * 0.07, R * 0.08, R * 0.035, singe(PALETTE.trim.ribbonRed, burnt), [0, by + R * 0.03, -br * 1.04]);
  } else if (t === 4) {
    // a cockade: a pleated rosette pinned at the left of the band
    b.torus(R * 0.11, R * 0.04, singe(PALETTE.trim.ribbonRed, burnt), [-br * 0.95, by + R * 0.05, -br * 0.3], [0, Math.PI / 2 - 0.3, 0]);
    b.torus(R * 0.06, R * 0.03, ivory, [-br * 0.98, by + R * 0.05, -br * 0.3 - R * 0.03], [0, Math.PI / 2 - 0.3, 0]);
    b.sphere(R * 0.035, accent, [-br * 1.0, by + R * 0.05, -br * 0.3 - R * 0.06]);
  } else if (t === 5) {
    // ribbon tails: two streamers from a bow at the back of the band, hanging to the nape
    const rc = singe(PALETTE.trim.ribbonBlue, burnt);
    b.sphere(R * 0.06, rc, [0, by + R * 0.01, br * 1.0]);
    for (const sx of [-1, 1]) b.sweep(curve([[sx * R * 0.04, by, br * 1.0], [sx * R * 0.14, by - R * 0.4, br * 1.08], [sx * R * 0.2, by - R * 0.85, br * 1.1]], 6), () => ({ rx: R * 0.05, rz: R * 0.012, pow: 2.4 }), rc, { side: [1, 0, 0], segments: 4 });
  }
  void shape;
  void sstep;
}
