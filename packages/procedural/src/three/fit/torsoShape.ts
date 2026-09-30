import type { Proportions } from "../../proportions.ts";
import type { Ring } from "../loft.ts";
import { neckRadii, soil, tone } from "../bodyKit.ts";

/**
 * The torso's cut and cross-sections. This is the ONE definition of the trunk's shape: the torso loft, the wound dressings, the body field (fit/bodyField.ts) and every
 * wearable that sits on the trunk read it, so a garment can never disagree with the body it is worn on. (Lived in garments.ts; garments.ts re-exports it.)
 */

/** Torso cut per jacket: multipliers on the waist, chest and shoulder sections, plus the section squareness. */
export const JACKET_CUT: Record<number, { waist: number; chest: number; shoulder: number; pow: number }> = {
  0: { waist: 1, chest: 1, shoulder: 1, pow: 0 },
  1: { waist: 0.92, chest: 1.03, shoulder: 1.04, pow: 0 }, // fitted: nipped waist, padded chest
  2: { waist: 1.0, chest: 1.03, shoulder: 1.05, pow: 0.2 },
  3: { waist: 0.97, chest: 1.0, shoulder: 1.0, pow: 0 },
  4: { waist: 1.1, chest: 1.1, shoulder: 1.08, pow: 0.1 }, // greatcoat: bulk everywhere
  5: { waist: 1.04, chest: 1.03, shoulder: 1.03, pow: 0.4 },
  6: { waist: 1, chest: 1, shoulder: 1, pow: 0 },
  7: { waist: 1, chest: 1, shoulder: 1, pow: 0 },
  8: { waist: 0.97, chest: 1.0, shoulder: 1.02, pow: 0 },
  9: { waist: 0.94, chest: 1.03, shoulder: 1.05, pow: 0.1 }, // reefer: short, snug, square-shouldered
  10: { waist: 1.04, chest: 1.04, shoulder: 1.03, pow: 0.5 }, // Norfolk: boxy
};

/** The torso's cross-sections, bone-local (origin at the waist joint, +Y up to the base of the neck). Shared with the wound dressings. */
export function torsoRings(P: Proportions, color: number, jacket = 0): Ring[] {
  const h = P.torsoHeight;
  const W = P.torsoWidth / 2;
  const D = P.torsoDepth / 2;
  const BF = P.bellyForward;
  const BR = P.bellyRadius;
  const SH = P.shoulderHalfWidth;
  const WH = Math.max(P.torsoWidth / 2 + P.bellyRadius * 0.5, P.shoulderHalfWidth * 0.74);
  const cut = JACKET_CUT[jacket] ?? JACKET_CUT[0]!;
  const nk = neckRadii(P);
  const dPow = cut.pow;
  return [
    { y: -0.05 * h, rx: Math.max(W * 0.85, WH * 0.92) * cut.waist, rz: D * 0.78, cz: -BF * 0.15, pow: 2.4 + dPow, color: soil(tone(color, 0.8), 0.12) },
    { y: 0.1 * h, rx: Math.max(W * 0.95 + BR * 0.3, WH * 0.97) * cut.waist, rz: D * 0.9 + BF * 0.15, cz: -BF * 0.45, pow: 2.4 + dPow, color: tone(color, 0.9) },
    { y: 0.28 * h, rx: Math.max(W * 1.0 + BR * 0.5, WH) * cut.waist, rz: D * 0.98 + BF * 0.4, cz: -BF * 0.55, pow: 2.2 + dPow, color },
    { y: 0.5 * h, rx: Math.max(W * 1.04, WH * 1.03) * cut.chest, rz: D * 0.95 + BF * 0.1, cz: -BF * 0.2, pow: 2.4 + dPow, color },
    { y: 0.72 * h, rx: W * 1.12 * cut.chest, rz: D * 0.9, cz: -BF * 0.05, pow: 2.6 + dPow * 0.5, color },
    { y: 0.87 * h, rx: SH * 0.94 * cut.shoulder, rz: D * 0.78, pow: 3.2, color },
    { y: 0.955 * h, rx: Math.max(SH * 0.5, nk.rx * 1.7), rz: Math.max(D * 0.52, nk.rz * 1.5), pow: 2.6, color },
    { y: 1.0 * h, rx: nk.rx * 1.12, rz: nk.rz * 1.12, pow: 2, color },
  ];
}
