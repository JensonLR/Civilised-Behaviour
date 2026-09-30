import type { Proportions } from "../../proportions.ts";
import type { CharacterSpec } from "../../spec.ts";
import { neckRadii, ringAt } from "../bodyKit.ts";
import type { Ring } from "../loft.ts";
import { torsoRings } from "./torsoShape.ts";

/**
 * The collar's shape and the OUTER surface round the neck (torso frame): the one place that says how wide the neck area is once the torso's top, the collar and the shirt are on.
 * Neckwear (cravat, scarf, ruff, muffler ...) is sized from `neckOuter`, so it wraps the collar instead of being buried in it or floating off it, on a thin neck and a bull neck.
 */

export type CollarKind = "stand" | "fall" | "shirt" | "high" | "shawl" | "cape";

/** Which collar the spec's jacket / shirt has (the same rules as garments.dressTorso). */
export function collarKind(spec: CharacterSpec): CollarKind {
  const j = spec.jacket;
  if (j === 0 || j === 3) return spec.shirt === 3 ? "stand" : spec.shirt === 4 ? "high" : "shirt";
  if (j === 9) return "fall";
  if (j === 1 || j === 4 || j === 8) return "fall";
  return "stand"; // tunic, hunting, Norfolk, cape, poncho
}

/** The collar's main sections (a descending stack: the fold or top edge first). Sizes come from the neck radii; nothing here is an absolute size. */
export function collarSections(kind: CollarKind, nrx: number, nrz: number, neckY: number): Ring[] {
  const bandTop = kind === "high" ? 0.075 : kind === "stand" ? 0.06 : 0.04;
  if (kind === "fall" || kind === "shawl" || kind === "cape") {
    const flare = kind === "cape" ? 1.62 : 1.5;
    return [
      { y: neckY + bandTop, rx: nrx * 1.17, rz: nrz * 1.17 },
      { y: neckY + bandTop - 0.006, rx: nrx * 1.22, rz: nrz * 1.22, crease: true },
      { y: neckY + 0.005, rx: nrx * (flare * 0.8), rz: nrz * (flare * 0.8) },
      { y: neckY - 0.045, rx: nrx * flare, rz: nrz * flare * 0.98 },
    ];
  }
  return [
    { y: neckY - 0.03, rx: nrx * 1.28, rz: nrz * 1.25 },
    { y: neckY + bandTop, rx: nrx * 1.2, rz: nrz * 1.17, crease: true },
  ];
}

/** Top of the collar (torso frame) for the spec: where a cravat's upper edge can reach. */
export function collarTop(P: Proportions, spec: CharacterSpec): number {
  const h = P.torsoHeight;
  const nk = neckRadii(P);
  return Math.max(...collarSections(collarKind(spec), nk.rx, nk.rz, h * 0.985).map((r) => r.y));
}

/**
 * Half-axes of the outermost surface round the neck at torso-frame height y: the largest of the bare neck, the torso's top sections (below the neck base) and the collar.
 * `gap` is added on top. (Body-following: everything is derived from the neck radii and the torso rings.)
 */
export function neckOuter(P: Proportions, spec: CharacterSpec, gap = 0): (y: number) => { rx: number; rz: number } {
  const h = P.torsoHeight;
  const nk = neckRadii(P);
  const collar = collarSections(collarKind(spec), nk.rx, nk.rz, h * 0.985);
  const trunk = torsoRings(P, 0, spec.jacket === 6 || spec.jacket === 7 ? 0 : spec.jacket);
  const top = trunk[trunk.length - 1]!;
  return (y) => {
    let rx = nk.rx * 1.06;
    let rz = nk.rz * 1.06;
    if (y <= top.y) {
      const s = ringAt(trunk, y);
      rx = Math.max(rx, s.rx);
      rz = Math.max(rz, s.rz);
    }
    const lo = Math.min(...collar.map((r) => r.y));
    const hi = Math.max(...collar.map((r) => r.y));
    if (y >= lo && y <= hi) {
      const c = ringAt(collar, y);
      rx = Math.max(rx, c.rx);
      rz = Math.max(rz, c.rz);
    }
    return { rx: rx + gap, rz: rz + gap };
  };
}
