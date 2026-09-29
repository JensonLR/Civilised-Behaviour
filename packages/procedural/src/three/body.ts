import type { BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import { skinRamp } from "./headShape.ts";
import { dyeAt, frontZ, neckRadii, ringAt, ringSurface, soil, tone, waistHalf, type BodyCtx } from "./bodyKit.ts";
export { frontZ, ringAt, soil, tone, type BodyCtx } from "./bodyKit.ts";
import { stumpPost } from "./prosthetics.ts";
import { addNeckwear, addHipGear, addPack, type TorsoFrame } from "./gear.ts";
import type { Ring } from "./loft.ts";
import { PartBuilder, SOOT, singe } from "./parts.ts";
import { dressCape, dressPoncho, dressSkirts, dressTorso, torsoRings, type TorsoView } from "./garments.ts";
import { addBelt, addDecorations, addSash } from "./torsoTrim.ts";
import { legRadius, upperArmRings, upperLegRings } from "./limbs.ts";

/** Half-width of the waist: never much narrower than the shoulders it hangs from, or the figure reads as a wasp in a coat. */
export { waistHalf };

export { torsoRings };

/** The contrast cloth of a look: facings, cuffs, cords. A dye picked from the palette by the jacket's own colour so it always goes with it. */
export function contrastDye(c: BodyCtx): number {
  return singe(dyeAt(PALETTE.cloth, c.spec.jacketColor + 4), c.burnt);
}

/** The waistcoat worn under a coat that opens at the front: a dye that differs from the coat and the trousers. */
export function vestDye(c: BodyCtx): number {
  return singe(dyeAt(PALETTE.cloth, c.spec.trousersColor + 6), c.burnt);
}

// ---- torso ------------------------------------------------------------------------------------------------------

export function buildTorso(c: BodyCtx): BufferGeometry | undefined {
  const { spec, P, burnt, accent } = c;
  const b = new PartBuilder();
  const h = P.torsoHeight;
  const W = P.torsoWidth / 2;
  const D = P.torsoDepth / 2;
  const j = spec.jacket;
  const nk = neckRadii(P);
  const under = j === 0 || j === 3 ? c.shirtC : j === 6 || j === 7 ? vestDye(c) : c.jacketC;
  const rings = torsoRings(P, under, j);
  b.loft(rings, under);
  const at = (y: number) => ringAt(rings, y);
  const surf = (y: number, x = 0) => frontZ(at(y), x);
  const facing = j === 8 ? contrastDye(c) : tone(c.jacketC, 0.68);
  const view: TorsoView = {
    b,
    c,
    rings,
    h,
    W,
    D,
    SH: P.shoulderHalfWidth,
    neckY: h * 0.985,
    nrx: nk.rx,
    nrz: nk.rz,
    at,
    surf,
    surface: ringSurface(rings),
    coat: j === 0 || j === 3 ? c.shirtC : c.jacketC,
    facing,
    vest: j === 3 ? c.jacketC : vestDye(c),
    shirt: c.shirtC,
    trim: j === 8 ? contrastDye(c) : accent,
  };
  dressTorso(view);
  if (j === 6) dressCape(view);
  if (j === 7) dressPoncho(view);
  if (j === 0) {
    // Braces (suspenders) for shirt sleeves.
    const braceC = tone(c.trouserC, 0.85);
    for (const sx of [-1, 1]) {
      const x = sx * W * 0.42;
      const yTop = h * 0.94;
      const yBot = h * 0.16;
      const yMid = (yTop + yBot) / 2;
      b.box(0.045, yTop - yBot, 0.014, braceC, [x, yMid, surf(yMid, x) - 0.005], [0, 0, sx * -0.035]);
    }
  }

  // Belts, sashes, decorations and gear are shared by every jacket; they read the torso's own surface.
  const frame: TorsoFrame = { b, spec, P, h, W, D, neckY: view.neckY, nr: Math.max(nk.rx, nk.rz), burnt, accent, dye: singe(PALETTE.cloth[(spec.hatColor + 4) % PALETTE.cloth.length]!, burnt), at, tone };
  addBelt(frame, c);
  addSash(frame, c);
  addDecorations(frame, c);
  if (spec.neckwear) addNeckwear(frame);
  if (spec.pack) addPack(frame);
  if (spec.hipGear) addHipGear(frame);
  // Scorch marks.
  if (burnt >= 2) {
    b.sphere(1, SOOT, [W * 0.4, h * 0.5, surf(h * 0.5, W * 0.4) - 0.004], [0.09, 0.07, 0.02]);
    b.sphere(1, SOOT, [-W * 0.2, h * 0.25, surf(h * 0.25, -W * 0.2) - 0.004], [0.07, 0.09, 0.02]);
  }
  return b.build();
}

// ---- pelvis: hips, trouser top, coat skirts -------------------------------------------------------------------------

export function buildPelvis(c: BodyCtx): BufferGeometry | undefined {
  const { spec, P } = c;
  const b = new PartBuilder();
  const D = P.torsoDepth / 2;
  const r = legRadius(c);
  const sc = P.scale;
  const tc = c.trouserC;
  // Under a closed coat skirt the trouser top is tucked inside it (two surfaces cutting through each other show as a sawtooth).
  const tuck = [2, 4, 5, 8, 9, 10].includes(spec.jacket) ? 0.86 : 1;
  b.loft(
    [
      { y: 0.09 * sc, rx: waistHalf(P) * 0.95 * tuck, rz: D * 0.78 * tuck, cz: -P.bellyForward * 0.12, color: tone(tc, 0.95) },
      { y: -0.02 * sc, rx: Math.max(P.hipWidth + r * 1.25, waistHalf(P) * 1.02) * tuck, rz: D * 0.86 * tuck, color: tc },
      { y: -0.12 * sc, rx: (P.hipWidth + r * 1.2) * tuck, rz: D * 0.7 * tuck, color: tone(tc, 0.85) },
    ],
    tc,
  );
  // Coat skirts: every coat has its own (frock-coat tails with a centre vent, a greatcoat's long bell, a reefer's short flare, ...).
  dressSkirts(b, c);
  void spec;
  return b.build();
}

// ---- arms and legs live in limbs.ts (re-exported here for the dressings that follow their surfaces) -------------------------

export { buildForeArm, buildLowerLeg, buildUpperArm, buildUpperLeg, handColor, legRadius, upperArmRings, upperLegRings } from "./limbs.ts";

// ---- stumps (where a limb used to be) ----------------------------------------------------------------------------------------

/**
 * The end of a limb that has been taken off, in the shoulder or hip frame: a short stub of sleeve or trouser with a torn edge and a
 * capped wound - flesh, a ring of blood (iodine when gore is off) and the pale disc of bone. Bone-local, hanging along -Y.
 */
export function buildStump(c: BodyCtx, limb: "arm" | "leg", gore: "full" | "reduced" | "off", fitted = false): BufferGeometry | undefined {
  const { P } = c;
  const b = new PartBuilder();
  const cloth = limb === "arm" ? c.armC : c.trouserC;
  const rings = limb === "arm" ? upperArmRings(P, cloth) : upperLegRings(c);
  const len = limb === "arm" ? P.armUpper : P.legUpper;
  const cut = len * (limb === "arm" ? 0.3 : 0.28);
  // Keep the top of the limb's own rings down to the cut, then close with a torn edge.
  const stub: Ring[] = [];
  for (const r of rings) if (-r.y <= cut) stub.push(r);
  const end = ringAt(rings, -cut);
  stub.push({ y: -cut, rx: end.rx, rz: end.rz, color: tone(cloth, 0.8) });
  stub.push({ y: -cut, rx: end.rx * 1.04, rz: end.rz * 1.04, color: tone(cloth, 0.6), crease: true });
  stub.push({ y: -cut - 0.02, rx: end.rx * 0.98, rz: end.rz * 0.98, color: tone(cloth, 0.5) });
  b.loft(stub, cloth, undefined, undefined, undefined, { capTop: false, capBottom: false });
  if (fitted) {
    // a prosthesis covers the wound: a leather socket, and a post down to the elbow or knee
    stumpPost(b, c, limb, cut, end);
    return b.build();
  }
  // The wound cap: flesh disc, blood ring, bone.
  const ramp = skinRamp(c.skin);
  const flesh = tone(ramp.lip.getHex(), 0.95);
  const blood = gore === "off" ? PALETTE.gore.off.fresh : gore === "reduced" ? PALETTE.gore.reduced.fresh : PALETTE.gore.full.fresh;
  const rx = end.rx * 0.93;
  const rz = end.rz * 0.93;
  const y = -cut - 0.022;
  b.loft([{ y: y + 0.01, rx, rz, color: blood }, { y: y - 0.012, rx: rx * 0.97, rz: rz * 0.97, color: blood }], blood);
  b.loft([{ y: y - 0.008, rx: rx * 0.78, rz: rz * 0.78, color: flesh }, { y: y - 0.02, rx: rx * 0.74, rz: rz * 0.74, color: flesh }], flesh);
  b.loft([{ y: y - 0.018, rx: rx * 0.34, rz: rz * 0.34, color: PALETTE.trim.ivory }, { y: y - 0.03, rx: rx * 0.3, rz: rz * 0.3, color: PALETTE.trim.ivory }], PALETTE.trim.ivory);
  return b.build();
}
