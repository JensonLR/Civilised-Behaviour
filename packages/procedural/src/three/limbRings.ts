import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { Ring } from "./loft.ts";
import { sstep } from "./patch.ts";
import { legRadius, ringAt, soil, tone, type BodyCtx } from "./bodyKit.ts";
import { JACKET, closedSkirtLength } from "./garments.ts";
import { CREAM, WOOD, singe } from "./parts.ts";
import { dyeAt } from "./bodyKit.ts";

/**
 * The ring tables of the limbs, in one place. Every limb piece (the sleeve, the trouser leg, the boot) is lofted from a table here, and everything that sits ON a limb (cuffs, stripes,
 * buttons, straps, patches, gloves, prostheses, the fit audit's worn layer) is derived from the same table (see limbKit.ts), so a change of shape moves its details with it.
 */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---- arms ---------------------------------------------------------------------------------------------------------------

/** Loose-sleeved coats hang wider; fitted ones hug. */
export function sleeveFull(jacket: number): number {
  return jacket === JACKET.GREATCOAT ? 1.14 : jacket === JACKET.NORFOLK || jacket === JACKET.HUNTING ? 1.06 : jacket === JACKET.FROCK || jacket === JACKET.NAVAL ? 0.97 : 1;
}

/** Upper-arm sections in the shoulder frame (hanging down): a rounded sleeve head, a full upper arm, easing to the elbow. Shared with the wound dressings. */
export function upperArmRings(P: Proportions, sleeveC: number, jacket = 0): Ring[] {
  const r = P.armRadius;
  const L = P.armUpper;
  const f = sleeveFull(jacket);
  return [
    { y: r * 0.62, rx: r * 0.78 * f, rz: r * 0.74 * f, color: tone(sleeveC, 1.04) },
    { y: r * 0.3, rx: r * 1.22 * f, rz: r * 1.16 * f, pow: 2.2, color: tone(sleeveC, 1.02) },
    { y: -r * 0.1, rx: r * 1.42 * f, rz: r * 1.35 * f, pow: 2.2, color: sleeveC },
    { y: -L * 0.14, rx: r * 1.42 * f, rz: r * 1.36 * f, pow: 2.2, color: sleeveC },
    { y: -L * 0.5, rx: r * 1.18 * f, rz: r * 1.15 * f, color: sleeveC },
    { y: -L * 0.92, rx: r * 1.02 * f, rz: r * 1.0 * f, color: tone(sleeveC, 0.9) },
    { y: -L - r * 0.15, rx: r * 0.95 * f, rz: r * 0.95 * f, color: tone(sleeveC, 0.85) },
  ];
}

/** Sleeves of a shirt-sleeved look (shirt, waistcoat, cape and poncho show the shirt's arms). */
export const shirtSleeved = (jacket: number): boolean => jacket === JACKET.SHIRT || jacket === JACKET.WAISTCOAT || jacket === JACKET.CAPE || jacket === JACKET.PONCHO;

/**
 * The wrist the hand grows from (forearm frame, half-axes): the hand is sized by `handRadius`, and the sleeve, the bare forearm and the gloves all close on this, so the join
 * fits whatever the hand's size against the arm's.
 */
export function wristSize(P: Proportions): { rx: number; rz: number } {
  return { rx: Math.min(P.handRadius * 0.36, P.armRadius * 0.7), rz: Math.min(P.handRadius * 0.48, P.armRadius * 0.78) };
}

/** The thigh ends this far below the knee joint and the shin starts this far above it (a short lap, so the bend has cloth on both sides). */
export const KNEE_LAP = 0.012;

/** Colour of the hand: bare skin, or the glove. */
export function handColour(c: BodyCtx): number {
  const g = c.spec.gloves;
  if (g === 1) return singe(CREAM, c.burnt);
  if (g === 2) return singe(c.leather, c.burnt);
  if (g === 3) return singe(tone(c.leather, 0.92), c.burnt);
  if (g === 4) return singe(tone(c.leather, 0.85), c.burnt);
  if (g === 5) return singe(PALETTE.material.fur, c.burnt);
  return c.skin;
}

/** The forearm's rings are cut at this height below the wrist: the bottom of the sleeve (cuff) hangs 5 mm below where the hand starts. */
export const CUFF_HANG = 0.005;

/** Half-axes of the sleeve's opening at the wrist: the arm's own wrist, drawn in toward a small hand (a big hand keeps the full wrist). */
export function sleeveWrist(c: BodyCtx): { rx: number; rz: number } {
  const { P, spec } = c;
  const r = P.armRadius;
  const f = sleeveFull(spec.jacket);
  const w = wristSize(P);
  const rx = Math.max(clamp(P.handRadius * 0.5, r * 0.6, r * 0.82) * f, w.rx * 1.08);
  return { rx, rz: Math.max(rx * 0.975, w.rz * 1.08) };
}

/**
 * The forearm in the elbow frame (hanging down): an elbow crease, the sleeve easing to the wrist, and a last section that tucks the sleeve's end onto the hand's wrist. A shirt
 * with rolled sleeves (shirt 6) ends in a thick roll at the elbow and shows the bare forearm below it. Shared by the builder, the cuff, gloves, prostheses and the fit audit.
 */
export function foreArmRings(c: BodyCtx): Ring[] {
  const { spec, P } = c;
  const r = P.armRadius;
  const L = P.armLower;
  const j = spec.jacket;
  const f = sleeveFull(j);
  const sleeveC = c.armC;
  const skin = c.skin;
  const w = wristSize(P);
  const bottom = -L - CUFF_HANG;
  if (shirtSleeved(j) && spec.shirt === 6) {
    const rollY = -L * 0.28;
    return [
      { y: r * 0.3, rx: r * 1.0, rz: r * 0.98, color: tone(sleeveC, 0.9) },
      { y: r * 0.0, rx: r * 0.95, rz: r * 0.93, color: tone(sleeveC, 0.7), crease: true },
      { y: -L * 0.14, rx: r * 1.04, rz: r * 1.0, color: sleeveC },
      { y: rollY + 0.03, rx: r * 1.08, rz: r * 1.04, color: sleeveC },
      { y: rollY + 0.03, rx: r * 1.12, rz: r * 1.08, color: tone(sleeveC, 0.8), crease: true },
      { y: rollY - 0.03, rx: r * 1.13, rz: r * 1.09, color: tone(sleeveC, 1.06) },
      { y: rollY - 0.03, rx: r * 0.83, rz: r * 0.8, color: tone(skin, 0.95), crease: true },
      { y: -L * 0.72, rx: Math.max(r * 0.76, w.rx * 1.5), rz: Math.max(r * 0.74, w.rz * 1.4), color: skin },
      { y: -L + 0.02, rx: w.rx * 1.12, rz: w.rz * 1.1, color: tone(skin, 0.97) },
      { y: bottom, rx: w.rx * 1.06, rz: w.rz * 1.06, color: tone(skin, 0.94) },
    ];
  }
  const s = sleeveWrist(c);
  const shirtSleeve = shirtSleeved(j);
  return [
    { y: r * 0.3, rx: r * 1.0 * f, rz: r * 0.98 * f, color: tone(sleeveC, 0.9) },
    { y: r * 0.0, rx: r * 0.95 * f, rz: r * 0.93 * f, color: tone(sleeveC, 0.7), crease: true },
    { y: -L * 0.12, rx: r * 1.04 * f, rz: r * 1.0 * f, color: tone(sleeveC, 1.02) },
    { y: -L * 0.35, rx: r * 1.02 * f, rz: r * 1.0 * f, color: sleeveC },
    { y: -L * 0.72, rx: Math.max(r * (shirtSleeve ? 0.98 : 0.88) * f * 0.98, s.rx * 1.06), rz: Math.max(r * (shirtSleeve ? 0.96 : 0.86) * f * 0.98, s.rz * 1.06), color: tone(sleeveC, 0.95) },
    { y: bottom, rx: s.rx, rz: s.rz, color: soil(tone(sleeveC, 0.85), 0.28) },
    // the sleeve turns in onto the wrist: this last section is what the cap closes on, so no gap shows round the hand
    { y: bottom - 0.008, rx: w.rx * 1.03, rz: w.rz * 1.03, color: tone(handColour(c), 0.8) },
  ];
}

// ---- legs ---------------------------------------------------------------------------------------------------------------

/** The widest half-width a leg section may have: the legs stand `hipWidth` from the middle, and thighs (or knees, or trouser bells) must not reach each other. */
export const legRxMax = (P: Proportions): number => P.hipWidth - 0.004;

function clampLeg(rings: Ring[], P: Proportions): Ring[] {
  const m = legRxMax(P);
  return rings.map((r) => (r.rx > m ? { ...r, rx: m } : r));
}

/** Trouser cuts by index (spec.trousers). */
export const TR = { TAILORED: 0, STRIPED: 1, BREECHES: 2, BAGGY: 3, PLUS_FOURS: 4, JODHPURS: 5, SHORTS: 6 } as const;

/** Thigh sections in the hip frame (hanging down) of the spec's trouser cut, before the top is rounded into the hip. */
export function trouserRings(c: BodyCtx): Ring[] {
  const { spec, P } = c;
  const r = legRadius(c);
  const L = P.legUpper;
  const tc = c.trouserC;
  const kind = spec.trousers;
  let rings: Ring[];
  if (kind === TR.BREECHES) {
    // breeches: puffed thigh, gathered tight above the knee
    rings = [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.35, rx: r * 1.6, rz: r * 1.5, pow: 2.2, color: tc },
      { y: -L * 0.8, rx: r * 1.15, rz: r * 1.1, color: tone(tc, 0.9) },
      { y: -L - KNEE_LAP, rx: r * 0.9, rz: r * 0.9, color: tone(tc, 0.85) },
    ];
  } else if (kind === TR.BAGGY) {
    // baggy: hangs from the hip and billows, pinched a little at the knee, with a fold band where the cloth stacks
    rings = [
      { y: 0.04, rx: r * 1.25, rz: r * 1.2, color: tone(tc, 0.95) },
      { y: -L * 0.3, rx: r * 1.38, rz: r * 1.32, pow: 2.2, color: tone(tc, 1.03) },
      { y: -L * 0.62, rx: r * 1.28, rz: r * 1.22, color: tc },
      { y: -L * 0.88, rx: r * 1.2, rz: r * 1.14, color: tone(tc, 0.86) },
      { y: -L - KNEE_LAP, rx: r * 1.15, rz: r * 1.1, color: tone(tc, 0.8) },
    ];
  } else if (kind === TR.PLUS_FOURS) {
    // plus-fours: full thigh and a generous blouse at the knee that overhangs the gaiter (continued in the shin)
    rings = [
      { y: 0.04, rx: r * 1.25, rz: r * 1.2, color: tone(tc, 0.95) },
      { y: -L * 0.3, rx: r * 1.4, rz: r * 1.34, pow: 2.2, color: tone(tc, 1.03) },
      { y: -L * 0.7, rx: r * 1.4, rz: r * 1.32, color: tc },
      { y: -L - KNEE_LAP, rx: r * 1.32, rz: r * 1.26, color: tone(tc, 0.82) },
    ];
  } else if (kind === TR.JODHPURS) {
    // jodhpurs: flared at the hip like wings, then tight from mid-thigh
    rings = [
      { y: 0.04, rx: r * 1.32, rz: r * 1.26, color: tone(tc, 0.95) },
      { y: -L * 0.22, rx: r * 1.72, rz: r * 1.4, pow: 2.1, color: tone(tc, 1.03) },
      { y: -L * 0.5, rx: r * 1.3, rz: r * 1.2, color: tc },
      { y: -L * 0.85, rx: r * 0.92, rz: r * 0.9, color: tone(tc, 0.9) },
      { y: -L - KNEE_LAP, rx: r * 0.85, rz: r * 0.85, color: tone(tc, 0.82) },
    ];
  } else if (kind === TR.SHORTS) {
    // shorts: the trouser leg stops above the knee; bare skin below it
    const skin = c.skin;
    rings = [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.25, rx: r * 1.28, rz: r * 1.22, pow: 2.3, color: tone(tc, 1.03) },
      { y: -L * 0.52, rx: r * 1.24, rz: r * 1.18, color: tone(tc, 0.9) },
      { y: -L * 0.56, rx: r * 1.24, rz: r * 1.18, color: tone(tc, 0.7), crease: true },
      { y: -L * 0.57, rx: r * 1.02, rz: r * 0.98, color: tone(skin, 1.0) },
      { y: -L * 0.75, rx: r * 0.98, rz: r * 0.94, color: skin },
      { y: -L - KNEE_LAP, rx: r * 0.9, rz: r * 0.9, color: tone(skin, 0.9) },
    ];
  } else {
    // a tailored leg: full at the thigh, easing to the knee, a fold band behind the bend
    rings = [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.25, rx: r * 1.28, rz: r * 1.22, pow: 2.3, color: tone(tc, 1.03) },
      { y: -L * 0.6, rx: r * 1.1, rz: r * 1.06, color: tc },
      { y: -L * 0.9, rx: r * 0.96, rz: r * 0.94, color: tone(tc, 0.9) },
      { y: -L - KNEE_LAP, rx: r * 0.92, rz: r * 0.92, color: tone(tc, 0.78) },
    ];
  }
  return clampLeg(rings, P);
}

/** Thigh sections in the hip frame (hanging down) for the spec's trouser cut. Shared with the wound dressings and the fit audit. */
export function upperLegRings(c: BodyCtx): Ring[] {
  const rings = trouserRings(c);
  // the top of the thigh is rounded into the hip instead of ending in a flat slab that pokes out of the coat
  const top = rings[0]!;
  // (a very short leg has its second section above 3.5 cm already: then the first two are the rounding and there is no extra section)
  const rest = rings.slice(1);
  const out: Ring[] = [{ ...top, y: top.y - 0.004, rx: top.rx * 0.78, rz: top.rz * 0.8, color: tone(top.color ?? c.trouserC, 0.85) }];
  if (rest[0]!.y < -0.035 - 0.004) out.push({ ...top, y: -0.035 });
  out.push(...rest);
  // Under a closed coat skirt the thigh is slimmed to a core: the skirt hides it, and two surfaces crossing show as a sawtooth. Back to full size well above the knee,
  // so the lower leg (which is built from the full trouser) meets it without a step.
  const hem = closedSkirtLength(c.spec, c.P);
  if (hem <= 0) return out;
  const full = Math.min(hem * 1.9, c.P.legUpper * 0.86);
  return out.map((r) => {
    const k = 0.55 + 0.45 * sstep(-hem * 1.05, -full, r.y);
    return k >= 1 ? r : { ...r, rx: r.rx * k, rz: r.rz * k };
  });
}

export interface BootKind {
  /** Boot height as a fraction of the lower leg. */
  top: number;
  tall?: boolean;
  laces?: boolean;
  spats?: boolean;
  hobnails?: boolean;
  puttees?: boolean;
  rubber?: boolean;
  soft?: boolean;
  clog?: boolean;
  spurs?: boolean;
}
export const BOOTS: readonly BootKind[] = [
  { top: 0.36, tall: true },
  { top: 0.1, laces: true },
  { top: 0.14, spats: true },
  { top: 0.1, laces: true, hobnails: true },
  { top: 0.1, laces: true, puttees: true },
  { top: 0.58, tall: true, rubber: true },
  { top: 0.045, soft: true },
  { top: 0.36, tall: true, spurs: true },
  { top: 0.05, clog: true },
];

/** Everything the lower leg is built from, in the knee frame (hanging down): the trouser (or stocking, or skin) shin, the boot's shaft, and the two together as one surface. */
export interface LowerLegPlan {
  kind: BootKind;
  /** Length knee to ankle (the foot hangs below). */
  len: number;
  /** Radius the trouser leg is cut to (bell of a baggy leg, a jodhpur's slim ankle). */
  legR: number;
  /** Fraction of the leg the boot covers (capped), its top height, and the shaft's width factor (rubber boots are wide). */
  bootTop: number;
  shaftTop: number;
  wide: number;
  /** The height of the bottom section of the shaft (just above the foot). */
  ankleY: number;
  shin: Ring[];
  shaft: Ring[];
  /** shin then shaft: the outer surface of the whole lower leg for details to sit on (turn-ups, folds, puttees, buckles, laces). */
  surface: Ring[];
  /** Half-axes of the ankle (the shaft's last section): the foot is sized to carry it. */
  ankle: { rx: number; rz: number };
}

export function lowerLegPlan(c: BodyCtx): LowerLegPlan {
  const { spec, P } = c;
  const r = legRadius(c);
  const len = P.legLower;
  const kind = BOOTS[spec.boots] ?? BOOTS[0]!;
  const tr = spec.trousers;
  const legR = tr === TR.BAGGY ? r * 1.1 : tr === TR.PLUS_FOURS ? r * 1.0 : tr === TR.JODHPURS ? r * 0.84 : r * 0.9;
  const bootTop = Math.min(0.62, kind.top);
  const wide = kind.rubber ? 1.14 : 1;
  // the boot is never lower than the shoe it stands in: a low boot's top is the rim of the shoe, where the trouser leg comes out of it
  const ankle0 = { rx: legR * 0.8 * (kind.soft || kind.clog ? 1 : wide), rz: legR * 0.8 * (kind.soft || kind.clog ? 1 : wide) };
  const foot0 = footDimsFor(c, kind, ankle0);
  const footTop = -len - c.footH + 0.012 + foot0.H;
  const hb = Math.min(len * 0.9, Math.max(len * bootTop, footTop + len + 0.01));
  const shaftTop = -len + hb;
  const bareShin = tr === TR.SHORTS;
  const stocking = tr === TR.BREECHES || tr === TR.PLUS_FOURS || bareShin;
  const shinBase = bareShin ? c.skin : stocking ? stockingColour(c) : c.trouserC;
  const knee = ringAt(upperLegRings(c), -P.legUpper - KNEE_LAP);
  const kx = Math.max(knee.rx, 0.02);
  const kz = Math.max(knee.rz, 0.02);
  // ---- the boot's shaft ----
  const ankleY = -len + Math.min(0.02, hb * 0.25);
  const lipY = shaftTop + 0.012;
  const foldY = shaftTop - Math.min(0.03, hb * 0.3);
  const shaft: Ring[] = [];
  if (!kind.soft && !kind.clog) {
    shaft.push(
      { y: lipY, rx: legR * 0.94 * wide, rz: legR * 0.92 * wide, color: tone(shaftColour(c, kind), 1.15) },
      { y: foldY, rx: legR * 0.88 * wide, rz: legR * 0.86 * wide, color: shaftColour(c, kind), crease: true },
      { y: foldY - (foldY - ankleY) * 0.55, rx: legR * 0.84 * wide, rz: legR * 0.83 * wide, color: tone(shaftColour(c, kind), 0.95) },
      { y: ankleY, rx: legR * 0.8 * wide, rz: legR * 0.8 * wide, color: tone(shaftColour(c, kind), 0.88) },
    );
  } else {
    // slippers and clogs: only a low collar round the ankle
    const boot = bootColour(c, kind);
    shaft.push(
      { y: shaftTop + Math.min(0.02, hb * 0.6), rx: legR * 0.9, rz: legR * 0.88, color: tone(boot, 1.15) },
      { y: shaftTop - Math.min(0.005, hb * 0.2), rx: legR * 0.84, rz: legR * 0.82, color: boot, crease: true },
      { y: ankleY, rx: legR * 0.8, rz: legR * 0.8, color: tone(boot, 0.9) },
    );
  }
  // ---- the shin: trouser (or stocking, or skin) from the knee down into the top of the boot; where the trouser ends its last section is the shaft's lip, a hair narrower ----
  const endY = Math.min(shaftTop + 0.02, -len * 0.6);
  const inShaft = ringAt(shaft, endY); // (the trouser ends inside the boot: its last section is a hair narrower than the shaft round it at that height)
  const shin: Ring[] = [
    // (a hair inside the thigh's last section: the two overlap by a couple of centimetres round the joint and must not share a surface)
    { y: KNEE_LAP, rx: kx * 0.97, rz: kz * 0.97, color: tone(shinBase, 0.78) },
    { y: -len * 0.22, rx: Math.max(legR * 1.04, kx * 0.98), rz: Math.max(legR * 1.08, kz * 0.98), pow: 2.2, color: tone(shinBase, 1.02) }, // calf
    { y: -len * 0.55, rx: legR * 0.94, rz: legR * 0.92, color: shinBase },
    { y: endY, rx: inShaft.rx * 0.965, rz: inShaft.rz * 0.965, color: soil(tone(shinBase, 0.9), 0.22 + 0.04 * spec.boots) },
  ];
  if (tr === TR.PLUS_FOURS) {
    // plus-fours overhang: the knickerbocker cloth hangs over a gaiter
    const tc = c.trouserC;
    const sk = stockingColour(c);
    shin[0] = { y: KNEE_LAP, rx: kx * 0.97, rz: kz * 0.97, color: tone(tc, 0.82) };
    shin.splice(1, 1, { y: -len * 0.06, rx: Math.max(legR * 1.34, kx), rz: Math.max(legR * 1.28, kz), pow: 2.2, color: tc });
    shin.splice(2, 0, { y: -len * 0.2, rx: legR * 1.12, rz: legR * 1.08, color: tone(tc, 0.72) }, { y: -len * 0.21, rx: legR * 0.98, rz: legR * 0.96, color: sk, crease: true });
  }
  const m = legRxMax(P);
  const clampR = (rr: Ring[]): Ring[] => rr.map((q) => (q.rx > m ? { ...q, rx: m } : q));
  const shinC = clampR(shin);
  const shaftC = clampR(shaft);
  const last = shaftC[shaftC.length - 1]!;
  return {
    kind,
    len,
    legR,
    bootTop,
    shaftTop,
    wide,
    ankleY,
    shin: shinC,
    shaft: shaftC,
    // (where the trouser runs on inside a tall boot the boot's outside is what shows: the shin only counts down to the shaft's lip)
    surface: [...shinC.filter((q) => q.y > shaftC[0]!.y + 0.001), ...shaftC],
    ankle: { rx: last.rx, rz: last.rz },
  };
}

/** Colour of the stockings shown where trousers stop short of the boot (breeches, plus-fours, shorts). */
export function stockingColour(c: BodyCtx): number {
  return singe(c.spec.trousers === TR.BREECHES ? PALETTE.trim.ivory : tone(PALETTE.material.linen, 0.92), c.burnt);
}

/** The material a boot is made of and its base colour. */
export function bootColour(c: BodyCtx, k: BootKind): number {
  if (k.rubber) return singe(PALETTE.material.rubber, c.burnt);
  if (k.clog) return singe(WOOD, c.burnt);
  if (k.soft) return singe(tone(dyeAt(PALETTE.cloth, c.spec.trousersColor + 8), 0.9), c.burnt);
  return c.leather;
}

/** The colour of the shaft: spats are cream cloth, everything else the boot's own. */
export function shaftColour(c: BodyCtx, k: BootKind): number {
  return k.spats ? singe(PALETTE.trim.ivory, c.burnt) : bootColour(c, k);
}

// ---- feet ---------------------------------------------------------------------------------------------------------------

export interface FootDims {
  /** Foot length and width as built: the spec's, raised where the ankle it carries (or the shoe's proportions) would not fit. */
  fl: number;
  fw: number;
  /** Height of the shoe's upper at the ankle. */
  H: number;
  /** Where the heel sits behind the leg's axis. */
  heelZ: number;
  fwK: number;
  toeUp: number;
}

/**
 * The shoe the leg stands on. The foot is never narrower than the ankle it has to carry (a small foot under a stout leg becomes a shoe that fits the leg), never shorter than about
 * twice its width, and the heel sits far enough behind the leg to contain it.
 */
export function footDims(c: BodyCtx, plan: LowerLegPlan = lowerLegPlan(c)): FootDims {
  return footDimsFor(c, plan.kind, plan.ankle);
}

/** The shoe for a given boot kind and ankle (see footDims): also used by the lower-leg plan itself to raise a low boot to the shoe's rim. */
export function footDimsFor(c: BodyCtx, kind: BootKind, ankle: { rx: number; rz: number }): FootDims {
  const { P, footH } = c;
  const fwK = kind.rubber ? 1.1 : 1;
  const fw = Math.max(P.footWidth, (ankle.rx * 2.15) / fwK);
  const fl = Math.max(P.footLength, fw * 1.9);
  let H = Math.max(footH * 1.6 + 0.04, fl * 0.27);
  if (kind.soft) H *= 0.7;
  if (kind.rubber) H *= 1.08;
  const heelZ = Math.max(fl * 0.34, ankle.rz + 0.025);
  const toeUp = kind.clog ? 0.16 : kind.soft ? 0.1 : 0;
  return { fl, fw, H, heelZ, fwK, toeUp };
}

/** Radius of the leg used for pegs and stump caps: the tailored thigh's, scaled with the body (a peg is not fatter than the leg it replaces). */
export const pegRadius = (c: BodyCtx): number => legRadius(c);
