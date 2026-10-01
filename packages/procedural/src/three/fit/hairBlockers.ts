import { computeProportions, type Proportions } from "../../proportions.ts";
import type { CharacterSpec } from "../../spec.ts";
import { neckRadii, ringAt } from "../bodyKit.ts";
import { capeRings } from "../drape.ts";
import type { Ring } from "../loft.ts";
import { collarKind, collarSections, neckOuter } from "./collarShape.ts";
import { torsoRings } from "./torsoShape.ts";

/**
 * What long hair (and anything else that hangs from the head: a beard, a veil, ribbon tails) must lie OUTSIDE of, beyond the body itself (D-038, polish2 section 8): the collar, whatever is
 * worn round the neck, a cape's mantle, a back pack's slab and the native peoples' yokes. Torso-frame ring stacks (the same loft the body field reads, `WornRings.drape`): the hair's fall
 * profile (`HeadFit.hangProfile`) is pushed out of them like it is pushed out of the shoulders, so a strand lands on a pack or a cape instead of passing through it.
 *
 * Pure of the spec (no builders): the numbers mirror the pieces in gear.ts / drape.ts / garments.ts, which are the places to look when a piece's size changes (longHair.test.ts catches a drift).
 */

/** How far each neckwear option stands off the collar (metres). Index = `NECKWEAR`. */
export const NECKWEAR_TUBE: readonly number[] = [0, 0.03, 0.03, 0.055, 0.03, 0.03, 0.065, 0.075, 0.06, 0.03, 0.04, 0.035, 0.02, 0.03];

/** Packs that stand on the back: [height range of the slab as a fraction of the torso, half width as a fraction of the back half width, depth in metres at gear scale 1]. */
const BACK_PACK: Readonly<Record<number, readonly [number, number, number, number]>> = {
  1: [0.2, 0.86, 0.7, 0.25], // rucksack
  4: [0.28, 0.72, 0.66, 0.19], // specimen case
  5: [0.25, 0.75, 0.74, 0.26], // tin trunk
  7: [0.05, 0.98, 0.6, 0.1], // easel bundle
};

export function hairBlockers(spec: CharacterSpec, P: Proportions = computeProportions(spec)): Ring[][] {
  const h = P.torsoHeight;
  const out: Ring[][] = [];
  const neckY = h * 0.985;
  const outer = neckOuter(P, spec, 0);
  // the collar (a stand or fall collar is as wide as its sections)
  const nk = neckRadii(P);
  const sections = collarSections(collarKind(spec), nk.rx, nk.rz, neckY);
  if (sections.length >= 2) out.push(sections.map((r) => ({ ...r, pow: 2 })));
  // neckwear and its tube
  const tube = NECKWEAR_TUBE[spec.neckwear] ?? 0.04;
  if (spec.neckwear !== 0) {
    const ys = [neckY - 0.075, neckY - 0.02, neckY + 0.05];
    out.push(ys.map((y) => ({ y, rx: outer(y).rx + tube, rz: outer(y).rz + tube, pow: 2 })));
  }
  if (spec.jacket === 6) out.push(capeRings(P, 0));
  const pk = BACK_PACK[spec.pack];
  if (pk) {
    const base = torsoRings(P, 0, spec.jacket === 6 || spec.jacket === 7 ? 0 : spec.jacket);
    const u = Math.max(0.8, Math.min(1.18, h / 0.6));
    const y0 = h * pk[0];
    const y1 = h * (spec.pack === 7 ? 0.98 : spec.pack === 1 ? 0.86 : spec.pack === 4 ? 0.72 : 0.75);
    const hw = ringAt(base, h * 0.5).rx * pk[2];
    let zBack = -Infinity;
    for (let i = 0; i <= 6; i++) {
      const s = ringAt(base, y0 + ((y1 - y0) * i) / 6);
      zBack = Math.max(zBack, s.cz + s.rz);
    }
    const d = pk[3] * u;
    const cz = zBack + 0.004 + d / 2;
    out.push([
      { y: y0, rx: hw * 0.8, rz: d * 0.45, cz, pow: 4 },
      { y: (y0 + y1) / 2, rx: hw, rz: d * 0.5, cz, pow: 4 },
      { y: y1, rx: hw * 0.9, rz: d * 0.4, cz, pow: 4 },
    ]);
  } else if (spec.pack === 2) {
    // a bedroll lies across the shoulders
    const base = torsoRings(P, 0, spec.jacket === 6 || spec.jacket === 7 ? 0 : spec.jacket);
    const u = Math.max(0.8, Math.min(1.18, h / 0.6));
    const y = h * 0.84;
    const r = 0.085 * u;
    const s = ringAt(base, y);
    const len = Math.min(2 * s.rx * 1.12, 0.62) + 0.02;
    out.push([
      { y: y - r, rx: len / 2, rz: r, cz: s.cz + s.rz + r + 0.004, pow: 2 },
      { y: y + r, rx: len / 2, rz: r, cz: s.cz + s.rz + r + 0.004, pow: 2 },
    ]);
  }
  return out;
}
