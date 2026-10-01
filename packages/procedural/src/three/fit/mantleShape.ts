import type { Proportions } from "../../proportions.ts";
import { neckRadii, ringAt } from "../bodyKit.ts";
import type { Ring } from "../loft.ts";

/**
 * The shoulder MANTLE of the native peoples' cloaks and shawls (Herd Cloak, Crepe Shawl, Court Cloak; D-038): a closed capelet over the shoulders and chest that follows the worn torso's own
 * rings plus a margin (so it never sinks into the coat under it) and never reaches further out than the arms' swing plane (`SH - 1.5 r`, the cape's own rule, drape.ts `clearance`).
 * One definition for the garment (nativeJackets.ts) and for what hair must lie outside of (hairBlockers.ts), so a strand lands ON the cloak instead of passing through it.
 * Torso frame. `lowFrac` = how far down the chest it hangs (fraction of the torso height); `m` = margin over the cloth under it.
 */
export function mantleRings(P: Proportions, base: readonly Ring[], lowFrac: number, m: number, color: number, flareHem = 1.05): Ring[] {
  const h = P.torsoHeight;
  const SH = P.shoulderHalfWidth;
  const nk = neckRadii(P);
  const D = P.torsoDepth / 2;
  const at = (f: number, mm: number, kx = 1): Ring => {
    const s = ringAt(base, h * f);
    const room = Math.max(SH - 1.5 * P.armRadius, s.rx + 0.02);
    return { y: h * f, rx: Math.min(s.rx * kx + mm, room), rz: s.rz + mm, cx: s.cx, cz: s.cz, pow: 2.3, color };
  };
  const rows: Ring[] = [
    { y: h * 0.985 + 0.012, rx: nk.rx * 1.22 + 0.02, rz: nk.rz * 1.22 + 0.02, pow: 2, color },
    { y: h * 0.955, rx: Math.max(nk.rx * 1.9, SH * 0.5) + 0.025 + m * 0.3, rz: Math.max(nk.rz * 1.8, D * 0.55) + 0.025 + m * 0.3, pow: 2.3, color },
    at(0.905, m),
    at(0.78, m),
    at(0.62, m),
    at(0.45, m),
    at(0.3, m * 1.1, flareHem),
  ];
  const kept = rows.filter((r) => r.y >= h * lowFrac - 1e-6);
  // the hem: a last section at the chosen height, flared a little
  const hem = at(lowFrac, m * 1.2, flareHem);
  if (kept.length === 0 || kept[kept.length - 1]!.y - hem.y > 0.004) kept.push({ ...hem, rx: Math.min(hem.rx * flareHem, Math.max(SH - 1.5 * P.armRadius, hem.rx)) });
  return kept;
}
