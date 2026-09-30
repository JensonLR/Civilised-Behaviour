import type { Proportions } from "../../proportions.ts";
import { legRadius, ringAt, tone, waistHalf, type BodyCtx } from "../bodyKit.ts";
import type { Ring } from "../loft.ts";
import { sstep } from "../patch.ts";
import { torsoRings } from "./torsoShape.ts";

/**
 * The shape of a coat skirt, DERIVED FROM THE BODY under it instead of guessed: at every height below the waist the skirt is the smallest rounded section that clears
 *   - the torso's own lowest section (and the belly that hangs over it: a coat hangs straight down from a paunch and does not tuck back under it),
 *   - both thighs as they are cut (`legRings` = the trouser rings, wherever they are: hip width and leg radius of THIS body),
 * plus an ease that grows toward the hem and a swing allowance (the thighs move; a real coat bells out to let them). Then the hem flares. The frame is the pelvis bone's.
 * The rings only ever grow with the body, so a stubby wide body and a tall thin one both get a skirt that hangs from their own hips and stays outside their own thighs.
 */

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The trouser top as the pelvis bone lofts it (pelvis frame). Under a closed coat skirt it is tucked in (two surfaces cutting through each other show as a sawtooth);
 * the skirt is fitted OUTSIDE these sections. Shared by buildPelvis, the body field's worn layer and the skirt.
 */
export function pelvisTopRings(c: BodyCtx, colors?: { top: number; mid: number; low: number }): Ring[] {
  const { spec, P } = c;
  const D = P.torsoDepth / 2;
  const r = legRadius(c);
  const sc = P.scale;
  // (no longer shrunk under a closed coat: the skirt is fitted outside these sections, so the two surfaces never cross)
  const tuck = 1;
  return [
    { y: 0.09 * sc, rx: waistHalf(P) * 0.95 * tuck, rz: D * 0.78 * tuck, cz: -P.bellyForward * 0.12, color: colors?.top },
    { y: -0.02 * sc, rx: Math.max(P.hipWidth + r * 1.25, waistHalf(P) * 1.02) * tuck, rz: D * 0.86 * tuck, color: colors?.mid },
    { y: -0.12 * sc, rx: (P.hipWidth + r * 1.2) * tuck, rz: D * 0.7 * tuck, color: colors?.low },
  ];
}

export interface SkirtOptions {
  len: number;
  /** Multiplier of the section at the hem (1 = straight). */
  flare: number;
  color: number;
  hemC: number;
  /** The upper-leg trouser rings (hip frame, hanging down). Without them the thigh is estimated from `legRadius`. */
  legRings?: readonly Ring[];
  /** Open coats swing their tails further back (the fronts are cut away). */
  open?: boolean;
}

/** Extents of the torso's lowest sections in the PELVIS frame at pelvis height y: half-width and the front / back distances from the axis. */
function torsoLow(P: Proportions, jacket: number, y: number): { x: number; f: number; b: number } {
  const rings = torsoRings(P, 0, jacket);
  const s = ringAt(rings, y - 0.04 * P.scale); // (the torso bone sits 4 cm x scale above the pelvis)
  return { x: s.rx + Math.abs(s.cx), f: s.rz - s.cz, b: s.rz + s.cz };
}

/** Sections of a coat skirt in the pelvis frame, from just above the waist down to `len` below it. */
export function skirtRings(c: BodyCtx, o: SkirtOptions): Ring[] {
  const { P, spec } = c;
  const sc = P.scale;
  const { len, flare, color, hemC } = o;
  const top = 0.03 * sc;
  const total = top + len;
  const r0 = legRadius(c);
  const leg = (y: number): { x: number; f: number; b: number } => {
    if (o.legRings && o.legRings.length > 0) {
      const s = ringAt(o.legRings, Math.min(y, o.legRings[0]!.y));
      return { x: P.hipWidth + s.rx + Math.abs(s.cx), f: s.rz - s.cz, b: s.rz + s.cz };
    }
    return { x: P.hipWidth + r0, f: r0, b: r0 };
  };
  const t0 = torsoLow(P, spec.jacket, top);
  const pel = pelvisTopRings(c);
  const pelvis = (y: number): { x: number; f: number; b: number } => {
    const s = ringAt(pel, y);
    return { x: s.rx + Math.abs(s.cx), f: s.rz - s.cz, b: s.rz + s.cz };
  };
  const section = (y: number, isHem = false): Ring => {
    const d = Math.max(0, top - y);
    const t = Math.min(1, d / total);
    const lg = leg(y);
    const tl = torsoLow(P, spec.jacket, Math.max(y, top - 0.02));
    // the belly and the waist: the coat drops straight from the widest point at the top and only eases in slowly (a paunch is not tucked away below the belt)
    const hang = 1 - 0.55 * sstep(0, total * 0.9, d);
    const ease = 0.014 + 0.035 * t;
    const swing = (o.open ? 0.4 : 0.42) * d * 0.5;
    const pv = pelvis(y);
    const X = Math.max((t0.x + 0.012) * hang + tl.x * (1 - hang) * 0.5, lg.x + ease * 1.25, pv.x + ease);
    const F = Math.max((t0.f + 0.012) * hang, lg.f + ease + swing * 0.7, pv.f + ease);
    const B = Math.max((t0.b + 0.012) * hang, lg.b + ease + swing * (o.open ? 1.5 : 0.8), pv.b + ease);
    const g = 1 + (flare - 1) * t ** 1.35 * (isHem ? 1 : 1);
    const rz = ((F + B) / 2) * g;
    const cz = ((B - F) / 2) * g;
    return { y, rx: X * g, rz, cz, pow: 2.6, color: tone(color, isHem ? 0.88 : lerp(0.94, 1, sstep(0, total * 0.3, d))) };
  };
  const hem = section(-len, true);
  // (a smooth silhouette needs more than a few sections: waist, hip, and a gentle run to the hem)
  const rings: Ring[] = [section(top), section(top - 0.02)];
  for (const f of [0.1, 0.2, 0.34, 0.52, 0.76]) rings.push(section(top - total * f));
  rings.push(hem, { ...hem, y: -len - 0.001, color: hemC }, { ...hem, y: -len - 0.03, color: hemC });
  return rings.map((r, i) => (i === 0 ? { ...r, color: tone(color, 0.92) } : r));
}

/**
 * How far the body's outermost cloth reaches sideways / forward / backward from the spine at TORSO-frame height y, around the hips: the larger of the torso section and, below the
 * waist, the coat skirt or the trouser top with the thighs. A satchel, a holster, a scabbard or a canteen on the hip stands off THIS (never off the bare torso ring, which a skirt
 * or a wide hip is wider than).
 */
export function hipReach(c: BodyCtx, skirt: readonly Ring[] | undefined, legRings?: readonly Ring[]): (y: number) => { x: number; f: number; b: number } {
  const { P, spec } = c;
  const trunk = torsoRings(P, 0, spec.jacket === 6 || spec.jacket === 7 ? 0 : spec.jacket);
  const pel = pelvisTopRings(c);
  const r0 = legRadius(c);
  const low = pel[pel.length - 1]!.y;
  return (y) => {
    const s = ringAt(trunk, y);
    let x = s.rx + Math.abs(s.cx);
    let f = s.rz - s.cz;
    let b = s.rz + s.cz;
    const yp = y + 0.04 * P.scale;
    if (yp < 0.09 * P.scale) {
      const q = skirt && skirt.length > 0 ? ringAt(skirt, yp) : ringAt(pel, Math.max(yp, low));
      x = Math.max(x, q.rx + Math.abs(q.cx));
      f = Math.max(f, q.rz - q.cz);
      b = Math.max(b, q.rz + q.cz);
      if (!skirt || skirt.length === 0) {
        const lr = legRings && legRings.length > 0 ? ringAt(legRings, Math.min(yp, legRings[0]!.y)) : undefined;
        const lx = P.hipWidth + (lr ? lr.rx + Math.abs(lr.cx) : r0);
        x = Math.max(x, lx);
        f = Math.max(f, lr ? lr.rz - lr.cz : r0);
        b = Math.max(b, lr ? lr.rz + lr.cz : r0);
      }
    }
    return { x, f, b };
  };
}
