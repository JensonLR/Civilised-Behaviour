import { BufferAttribute, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { curve } from "./sweep.ts";
import type { Ring } from "./loft.ts";
import { hookHand, pegShin } from "./prosthetics.ts";
import { CREAM, LEATHER, PartBuilder, singe, type V3 } from "./parts.ts";
import { dyeAt, legRadius, ringAt, soil, tone, type BodyCtx } from "./bodyKit.ts";
import { JACKET } from "./garments.ts";
import { dressArmDrape } from "./drape.ts";
import { buildHand, handColor } from "./hand.ts";
import { CUFF_HANG, TR, bootColour, shaftColour, foreArmRings, footDims, lowerLegPlan, shirtSleeved, sleeveFull, sleeveWrist, stockingColour, upperArmRings, upperLegRings, type BootKind, type FootDims, type LowerLegPlan } from "./limbRings.ts";
import { tipAlong, bandOn, boxBetween, buttonOn, clothLift, limbSurface, mountOn, patchOn, stripOn } from "./limbKit.ts";
export { handColor } from "./hand.ts";
export { foreArmRings, lowerLegPlan, upperArmRings, upperLegRings };

/**
 * Arms, hands, legs and feet: sleeves with cuffs and folds, fingered hands, trouser cuts and boots. The ring tables live in limbRings.ts, the tools that place things on them
 * (bands, patches, strips, mounts) in limbKit.ts: nothing here positions a detail by a guessed radius, so every option fits a thin limb and a thick one.
 */

/** The contrast cloth of a look: facings, cuffs, cords. A dye picked from the palette by the jacket's own colour so it always goes with it. */
export function contrastCloth(c: BodyCtx): number {
  return singe(dyeAt(PALETTE.cloth, c.spec.jacketColor + 4), c.burnt);
}

// ---- arms ---------------------------------------------------------------------------------------------------------------

/** Epaulettes sit on the sleeve head, in the shoulder frame: a pad that follows the shoulder from the front of the sleeve over the top and down the back. */
function epaulette(b: PartBuilder, c: BodyCtx, side: "L" | "R", rings: readonly Ring[]): void {
  const kind = c.spec.epaulettes;
  if (kind === 0) return;
  const r = c.P.armRadius;
  const sx = side === "L" ? -1 : 1;
  const gold = c.accent;
  const cloth = tone(c.armC, 0.8);
  const surf = limbSurface(rings);
  const head = rings[0]!;
  const top = head.y;
  const yA = r * 0.34;
  const halfW = Math.min(head.rx * 0.86, r * 0.72);
  // the pad's spine: down the front of the sleeve head, over the flat top, down the back; `lift` is how far its centre line stands off the sleeve
  const spine = (lift: number): V3[] => {
    const capY = top + lift;
    return [surf(0, yA, lift).p, surf(0, top - r * 0.06, lift).p, [0, capY, -head.rz * 0.72], [0, capY, 0], [0, capY, head.rz * 0.72], surf(Math.PI, top - r * 0.06, lift).p, surf(Math.PI, yA, lift).p];
  };
  if (kind === 1 || kind === 2 || kind === 3) {
    b.sweep(spine(0.0035), () => ({ rx: halfW * 1.2, rz: 0.0055, pow: 2.6 }), gold, { side: [1, 0, 0], segments: 4 });
    b.sweep(spine(0.0075), () => ({ rx: halfW * 0.86, rz: 0.0065, pow: 2.6 }), cloth, { side: [1, 0, 0], segments: 4 });
    b.sphere(0.014, gold, [0, top + 0.0075 + 0.008, 0], [1, 0.8, 1]);
  }
  if (kind === 2 || kind === 3) {
    // fringe (2) or thick bullion coils (3) hang off the outer end, along the slope of the sleeve head
    const n = kind === 3 ? 6 : 8;
    for (let i = 0; i < n; i++) {
      const phi = sx * (Math.PI / 2) + (i - (n - 1) / 2) * (kind === 3 ? 0.3 : 0.24);
      if (kind === 3) boxBetween(b, surf(phi, top - r * 0.12, 0.004).p, surf(phi, top - r * 0.12 - 0.04, 0.004).p, 0.02, 0.02, tone(gold, i % 2 ? 0.85 : 1.1));
      else boxBetween(b, surf(phi, top - r * 0.1, 0.002).p, surf(phi, top - r * 0.1 - 0.07, 0.002).p, 0.006, 0.006, gold);
    }
  }
  if (kind === 4) {
    // shoulder cords: a braided loop from the shoulder seam round the sleeve head, with a knot and a tail at the back
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push(surf(a, r * 0.22 + Math.cos(a * 0.5) * 0.004, 0.007).p);
    }
    b.sweep(curve(pts, 16), (t) => ({ rx: 0.008, rz: 0.008, pow: 2, color: Math.sin(t * 60) > 0 ? gold : tone(gold, 0.8) }), gold, { side: [0, 1, 0], segments: 4 });
    b.sphere(0.02, gold, surf(Math.PI, r * 0.3, 0.014).p);
    boxBetween(b, surf(Math.PI, r * 0.22, 0.012).p, surf(Math.PI, r * 0.22 - 0.09, 0.012).p, 0.01, 0.01, gold);
  }
}

export function buildUpperArm(c: BodyCtx, side: "L" | "R" = "L"): BufferGeometry | undefined {
  const { spec, P } = c;
  const b = new PartBuilder();
  const r = P.armRadius;
  const L = P.armUpper;
  const sleeveC = c.armC;
  const rings = upperArmRings(P, sleeveC, spec.jacket);
  b.loft(rings, sleeveC);
  // the seam where the sleeve head meets the body: a darker line just under the shoulder
  if (spec.jacket !== JACKET.SHIRT && spec.jacket !== JACKET.WAISTCOAT) bandOn(b, rings, -r * 0.05, -r * 0.14, tone(sleeveC, 0.72), { lift: 0.0025, edges: false, colorBottom: tone(sleeveC, 0.72) });
  if (spec.jacket === JACKET.HUNTING || spec.jacket === JACKET.NORFOLK) {
    // elbow patch on the back of the arm: an oval of leather laid on the sleeve, with its stitched rim
    const surf = limbSurface(rings);
    const y = -L * 0.96;
    const rm = (ringAt(rings, y).rx + ringAt(rings, y).rz) / 2;
    patchOn(b, surf, { phi: Math.PI, radius: rm, y, halfW: rm * 0.62, halfH: L * 0.14, shape: "oval", lift: 0.004, color: LEATHER, cells: 6 });
    patchOn(b, surf, { phi: Math.PI, radius: rm, y, halfW: rm * 0.62, halfH: L * 0.14, shape: "ring", hole: 0.86, lift: 0.0058, color: tone(LEATHER, 1.35), cells: 8 });
  }
  epaulette(b, c, side, rings);
  dressArmDrape(b, c, side); // (a cape's or poncho's cloth over the arm rides on the arm, so it can never be pierced by it)
  return b.build();
}

/**
 * The forearm with its hand. At full detail it carries two morph targets, the hand at half a grip and at a full one (relative to the relaxed hand it is built in), so
 * `rig.setHandGrip` can close the fingers with one number and no extra draw call. The three builds have the same topology by construction (hand.ts).
 */
export function buildForeArm(c: BodyCtx, side: "L" | "R" = "L"): BufferGeometry | undefined {
  const base = foreArmAt(c, side, 0);
  if (!base || PartBuilder.lod > 0 || PartBuilder.hullMode || c.spec.hook === (side === "L" ? 1 : 2)) return base;
  const audit = PartBuilder.audit;
  PartBuilder.audit = undefined; // (the two extra poses are not new parts)
  let half: BufferGeometry | undefined;
  let full: BufferGeometry | undefined;
  try {
    half = foreArmAt(c, side, 0.5);
    full = foreArmAt(c, side, 1);
  } finally {
    PartBuilder.audit = audit;
  }
  if (!half || !full || half.attributes.position!.count !== base.attributes.position!.count || full.attributes.position!.count !== base.attributes.position!.count) {
    half?.dispose();
    full?.dispose();
    return base;
  }
  const delta = (name: "position" | "normal", from: BufferGeometry): BufferAttribute => {
    const a = base.attributes[name]!;
    const b = from.attributes[name]!;
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count * 3; i++) out[i] = (b.array[i] as number) - (a.array[i] as number);
    return new BufferAttribute(out, 3);
  };
  base.morphAttributes.position = [delta("position", half), delta("position", full)];
  base.morphAttributes.normal = [delta("normal", half), delta("normal", full)];
  base.morphTargetsRelative = true;
  base.userData.morphNames = ["gripHalf", "gripFull"];
  base.computeBoundingSphere(); // (with the morph extremes included)
  half.dispose();
  full.dispose();
  return base;
}

/** What a cuff looks like at a height: how far its outermost cloth stands off the sleeve (0 above the cuff), so a detail can sit on it. */
type CuffLift = (y: number) => number;

/**
 * The cuff of a sleeve, in the forearm frame, laid on the sleeve's own rings: a turned band with a flared lower edge, gold stripes, a strap, a shirt cuff with a link. The bands are
 * offsets of the sleeve's sections (limbKit `bandOn`), so a cuff fits whatever the arm's thickness and taper. Returns the cuff's lift at a height for the creator's cuff details.
 */
function cuffBase(b: PartBuilder, c: BodyCtx, rings: readonly Ring[], L: number, r: number, side: "L" | "R"): CuffLift {
  const j = c.spec.jacket;
  const contrast = contrastCloth(c);
  const cream = singe(CREAM, c.burnt);
  const shirtCuff = tone(c.shirtC, 1.04);
  const gold = c.accent;
  const trimC = c.spec.coatTrim === 2 && j !== JACKET.SHIRT && j !== JACKET.WAISTCOAT ? contrast : undefined;
  const cl = clothLift(r);
  const bottom = -L - CUFF_HANG;
  const surf = limbSurface(rings);
  const out: { yTop: number; yBot: number; l0: number; l1: number }[] = [];
  const band = (uTop: number, uBot: number, color: number, l0: number, l1 = l0, thin = false): void => {
    bandOn(b, rings, bottom + uTop, bottom + uBot, color, { lift: l0, liftBottom: l1, edges: !thin });
    out.push({ yTop: bottom + uTop, yBot: bottom + uBot, l0, l1 });
  };
  const button = (y: number, phi: number, color = gold): void => {
    buttonOn(b, surf, phi, y, liftOf(out, y) - 0.001, 0.011, color);
  };
  const outer = c.armC;
  if (shirtSleeved(j)) {
    // a shirt cuff: the sleeve gathers into a stiff band with a link on the outside of the wrist
    band(0.06, 0, shirtCuff, cl * 0.7, cl * 0.9);
    const y = bottom + 0.03;
    const m = mountOn(surf, side === "L" ? -Math.PI / 2 : Math.PI / 2, y, liftOf(out, y) + 0.004);
    b.sphere(0.011, gold, m.pos, [1, 1, 0.5], m.rot);
    return (yy) => liftOf(out, yy);
  }
  const facing = trimC ?? (j === JACKET.SMOKING ? contrast : j === JACKET.GREATCOAT ? tone(c.armC, 0.75) : j === JACKET.TUNIC ? tone(c.armC, 0.72) : c.armC);
  if (j === JACKET.FROCK) {
    // a turned cuff flaring a little at the edge, three buttons up the back seam, a line of shirt peeking below
    band(0.085, 0.012, trimC ?? tone(outer, 1.08), cl * 0.8, cl * 1.15);
    band(0.014, 0, cream, 0.004, 0.004, true);
    for (let i = 0; i < 3; i++) button(bottom + 0.073 - i * 0.02, Math.PI);
  } else if (j === JACKET.GREATCOAT) {
    band(0.12, 0.01, facing, cl * 0.9, cl * 1.4);
    band(0.014, 0, cream, 0.004, 0.004, true);
    for (let i = 0; i < 2; i++) button(bottom + 0.105 - i * 0.02, Math.PI);
  } else if (j === JACKET.SMOKING) {
    band(0.11, 0.01, facing, cl * 0.9, cl * 1.5);
    band(0.014, 0, cream, 0.004, 0.004, true);
  } else if (j === JACKET.NAVAL) {
    // gold stripes: a broad band and two narrow ones (the executive curl is left to the ink line)
    band(0.12, 0.1, gold, cl * 0.5, cl * 0.5, true);
    band(0.085, 0.07, gold, cl * 0.5, cl * 0.5, true);
    band(0.055, 0.04, gold, cl * 0.5, cl * 0.5, true);
    band(0.014, 0, cream, 0.004, 0.004, true);
    if (trimC) band(0.03, 0.014, trimC, cl * 0.5, cl * 0.5, true);
  } else if (j === JACKET.TUNIC) {
    band(0.075, 0.005, facing, cl * 0.8, cl * 1.2);
    band(0.014, 0, cream, 0.004, 0.004, true);
    for (let i = 0; i < 2; i++) button(bottom + 0.063 - i * 0.02, Math.PI);
  } else {
    // hunting / Norfolk: a strapped cuff
    band(0.07, 0.005, trimC ?? tone(outer, 0.9), cl * 0.8, cl);
    band(0.014, 0, cream, 0.004, 0.004, true);
    button(bottom + 0.058, Math.PI);
  }
  return (yy) => liftOf(out, yy);
}

function liftOf(bands: readonly { yTop: number; yBot: number; l0: number; l1: number }[], y: number): number {
  let best = 0;
  for (const q of bands) {
    if (y > q.yTop + 0.001 || y < q.yBot - 0.001) continue;
    const t = q.yTop === q.yBot ? 0 : (q.yTop - y) / (q.yTop - q.yBot);
    best = Math.max(best, q.l0 + (q.l1 - q.l0) * Math.max(0, Math.min(1, t)));
  }
  return best;
}

/** Extra cuff detail chosen in the creator: a row of buttons up the outer seam, gold links, or a buckled strap. `out` is the azimuth that faces away from the body. */
function cuffDetail(b: PartBuilder, c: BodyCtx, rings: readonly Ring[], L: number, r: number, side: "L" | "R", lift: CuffLift): void {
  const style = c.spec.cuffDetail;
  if (style === 0 || PartBuilder.lod > 0 || shirtSleeved(c.spec.jacket) && c.spec.shirt === 6) return;
  const outPhi = side === "L" ? -Math.PI / 2 : Math.PI / 2;
  const bottom = -L - CUFF_HANG;
  const gold = c.accent;
  const surf = limbSurface(rings);
  const cl = clothLift(r);
  if (style === 1) {
    for (let i = 0; i < 4; i++) {
      const y = bottom + 0.024 + i * 0.021;
      buttonOn(b, surf, outPhi, y, Math.max(lift(y), cl * 0.5) - 0.001, 0.0115, gold);
    }
  } else if (style === 2) {
    // cufflinks: a head on each side of the cuff (the shank through the cloth is inside it; a red stone on the outer head)
    const y = bottom + 0.045;
    const l = Math.max(lift(y), cl * 0.5);
    for (const [phi, gem] of [[-Math.PI / 2, side === "L"], [Math.PI / 2, side === "R"]] as const) {
      const m = mountOn(surf, phi, y, l + 0.003);
      b.cylinder(0.014, 0.014, 0.006, gold, m.pos, [0, 0, Math.PI / 2]);
      b.sphere(0.006, gem ? PALETTE.trim.gemRed : PALETTE.trim.pearl, [m.pos[0] + m.n[0] * 0.005, m.pos[1] + m.n[1] * 0.005, m.pos[2] + m.n[2] * 0.005], [1, 1, 0.5], m.rot);
    }
  } else {
    // a buckled strap round the cuff, with the buckle on the outside and a loose tail
    const y = bottom + 0.05;
    const strap = tone(c.leather, 1.02);
    const l = Math.max(lift(y), cl * 0.5);
    bandOn(b, rings, y + 0.012, y - 0.012, strap, { lift: l + 0.003, edges: false, colorBottom: tone(strap, 0.85) });
    const m = mountOn(surf, outPhi, y, l + 0.008);
    b.box(0.032, 0.03, 0.008, gold, m.pos, m.rot);
    const m2 = mountOn(surf, outPhi, y, l + 0.011);
    b.box(0.012, 0.018, 0.006, tone(gold, 0.7), m2.pos, m2.rot);
    const tail0 = mountOn(surf, outPhi + (side === "L" ? -0.35 : 0.35), y - 0.012, l + 0.006);
    const tail1 = mountOn(surf, outPhi + (side === "L" ? -0.35 : 0.35), y - 0.04, l + 0.006);
    boxBetween(b, tail0.pos, tail1.pos, 0.01, 0.005, tone(strap, 0.9));
  }
}

function foreArmAt(c: BodyCtx, side: "L" | "R", grip: number): BufferGeometry | undefined {
  const { spec, P } = c;
  const b = new PartBuilder();
  const r = P.armRadius;
  const L = P.armLower;
  const j = spec.jacket;
  const sleeveC = c.armC;
  const f = sleeveFull(j);
  const rolled = shirtSleeved(j) && spec.shirt === 6; // work shirts are worn with the sleeves rolled to the elbow
  if (PartBuilder.lod >= 2) {
    // far figure: a tapered sleeve and a ball for the hand
    const s = sleeveWrist(c);
    b.loft([{ y: r * 0.3, rx: r * f, rz: r * 0.98 * f, color: tone(sleeveC, 0.9) }, { y: -L * 0.5, rx: r * f, rz: r * f, color: sleeveC }, { y: -L, rx: s.rx, rz: s.rz, color: sleeveC }], sleeveC);
    b.sphere(P.handRadius * 0.95, handColor(c), [0, -L - P.handRadius * 0.55, -P.handRadius * 0.15]);
    return b.build();
  }
  // elbow crease + forearm, with the shirt's blouse gathering into the cuff (or the bare forearm below a roll)
  const rings = foreArmRings(c);
  b.loft(rings, sleeveC);
  if (!rolled) {
    const lift = cuffBase(b, c, rings, L, r, side);
    cuffDetail(b, c, rings, L, r, side, lift);
  }
  if (spec.hook === (side === "L" ? 1 : 2)) hookHand(b, c, L);
  else buildHand(b, c, L, side, grip);
  return b.build();
}

// ---- legs ---------------------------------------------------------------------------------------------------------------

export { legRadius };

export function buildUpperLeg(c: BodyCtx, side: "L" | "R" = "L"): BufferGeometry | undefined {
  const { spec, P, burnt } = c;
  const b = new PartBuilder();
  const L = P.legUpper;
  const tc = c.trouserC;
  const rings = upperLegRings(c);
  b.loft(rings, tc);
  const shorts = spec.trousers === TR.SHORTS;
  const surf = limbSurface(rings);
  // knee cap: gives the bend a visible pivot. It rides on the front of the knee section, so it is as big as the knee and stands the same 1.2 cm proud on a thin leg and a stout one.
  const kn = ringAt(rings, -L - 0.01);
  const kr = Math.min(kn.rx, kn.rz) * 0.55;
  b.sphere(kr, shorts ? tone(c.skin, 1.0) : spec.trousers === TR.BREECHES || spec.trousers === TR.PLUS_FOURS ? tone(stockingColour(c), 0.96) : tone(tc, 0.97), [kn.cx, -L - 0.01, kn.cz - kn.rz - 0.008 + kr * 0.55], [1.15, 0.85, 0.55]); // (in the colour of the leg below, or it shows as a spike through the stocking)
  const front = (y0: number, y1: number, color: number, w: number, thick: number): void => stripOn(b, rings, surf, 0, y0, y1, w, thick, color);
  if (spec.trousers === TR.STRIPED) front(-0.02, -L * 0.9, singe(CREAM, burnt), 0.008, 0.004); // stripe (it stops above the knee: the knee cap and the bend are not striped)
  else if (!shorts && spec.trousers !== TR.BAGGY) front(-0.03, -L * 0.88, tone(tc, 1.28), 0.008, 0.004); // pressed crease
  if (spec.trousers === TR.BREECHES) {
    // garter strap gathering the breeches above the knee
    const y = -L * 0.9;
    const cl = clothLift(legRadius(c));
    bandOn(b, rings, y + 0.02, y - 0.02, c.leather, { lift: cl * 0.5, edges: false, crease: true, colorBottom: tone(c.leather, 0.85) });
    const m = mountOn(surf, (side === "L" ? -1 : 1) * 0.9, y, cl * 0.5 + 0.007);
    b.box(0.03, 0.03, 0.012, c.accent, m.pos, m.rot);
  }
  trousersTrim(b, c, rings, surf, L, side);
  return b.build();
}

/** Knee patches, mends, mud and side stripes on the thigh (hip frame). */
function trousersTrim(b: PartBuilder, c: BodyCtx, rings: readonly Ring[], surf: ReturnType<typeof limbSurface>, L: number, side: "L" | "R"): void {
  const t = c.spec.trouserTrim;
  if (t === 0) return;
  const tc = c.trouserC;
  const patchC = tone(c.leather, 1.1);
  const sx = side === "L" ? -1 : 1;
  const yK = -L * 0.92;
  const rad = (y: number): number => {
    const s = ringAt(rings, y);
    return (s.rx + s.rz) / 2;
  };
  if (t === 1) {
    // leather knee patches: an oval pad with a stitched border
    const rm = rad(yK);
    patchOn(b, surf, { phi: 0, radius: rm, y: yK, halfW: rm * 0.66, halfH: rm * 0.6, shape: "oval", lift: 0.005, color: patchC, cells: 8 });
    patchOn(b, surf, { phi: 0, radius: rm, y: yK, halfW: rm * 0.66, halfH: rm * 0.6, shape: "ring", hole: 0.88, lift: 0.0068, color: tone(patchC, 1.4), cells: 10 });
  } else if (t === 2) {
    // patched and mended: a square patch of odd cloth and a darn, with stitches
    const odd = singe(tone(dyeAt(PALETTE.cloth, c.spec.trousersColor + 3), 1.05), c.burnt);
    const y1 = -L * 0.88;
    const r1 = rad(y1);
    patchOn(b, surf, { phi: -sx * 0.28, radius: r1, y: y1, halfW: r1 * 0.36, halfH: r1 * 0.34, shape: "rect", turn: 0.18, lift: 0.004, color: odd, cells: 6 });
    for (let i = 0; i < 4; i++) {
      const m = mountOn(surf, -sx * 0.28 + (i - 1.5) * 0.11, y1 + r1 * 0.3, 0.0062);
      b.box(0.014, 0.004, 0.004, tone(tc, 0.55), m.pos, m.rot);
    }
    const y2 = -L * 0.38;
    const r2 = rad(y2);
    patchOn(b, surf, { phi: sx * 0.3, radius: r2, y: y2, halfW: r2 * 0.25, halfH: r2 * 0.22, shape: "rect", turn: -0.3, lift: 0.004, color: tone(tc, 1.35), cells: 5 });
    for (let i = 0; i < 3; i++) {
      const m = mountOn(surf, sx * 0.3 + (i - 1) * 0.1, y2, 0.0062);
      b.box(0.02, 0.004, 0.004, tone(tc, 0.5), m.pos, m.rot);
    }
  } else if (t === 3) {
    // muddy knees: a dirty oval above and below the knee
    const mud = soil(tc, 0.7);
    const rm = rad(yK);
    patchOn(b, surf, { phi: 0, radius: rm, y: yK, halfW: rm * 0.8, halfH: rm * 0.85, shape: "oval", lift: 0.0035, color: mud, cells: 8 });
    patchOn(b, surf, { phi: sx * 0.2, radius: rm, y: yK - 0.05, halfW: rm * 0.45, halfH: rm * 0.4, shape: "oval", lift: 0.0045, color: tone(mud, 0.8), cells: 6 });
  } else if (t === 4) {
    // a broad side stripe (a uniform's braid) down the outer seam
    const stripe = c.spec.jacket === JACKET.NAVAL || c.spec.jacket === JACKET.TUNIC ? c.accent : tone(tc, 1.6);
    stripOn(b, rings, surf, sx * (Math.PI / 2), -0.01, c.spec.trousers === TR.SHORTS ? -L * 0.54 : -L * 0.98, 0.012, 0.007, stripe); // (shorts end above the knee)
  }
}

// ---- lower legs and boots ------------------------------------------------------------------------------------------------------

export function buildLowerLeg(c: BodyCtx, wooden: boolean, side: "L" | "R" = "L"): BufferGeometry | undefined {
  const { spec, P, burnt } = c;
  const b = new PartBuilder();
  const len = P.legLower;
  if (wooden) {
    pegShin(b, c, len);
    return b.build();
  }
  const plan = lowerLegPlan(c);
  const { kind, shaftTop } = plan;
  const boot = bootColour(c, kind);
  const dims = footDims(c, plan);
  const tr = spec.trousers;
  const bareShin = tr === TR.SHORTS;
  const stockinged = tr === TR.BREECHES || tr === TR.PLUS_FOURS || bareShin;
  const shinBase = bareShin ? c.skin : stockinged ? stockingColour(c) : c.trouserC;
  if (PartBuilder.lod >= 2) {
    // far figure: the trouser leg, the boot top, and a wedge for the foot
    const s = plan.shin;
    const h = plan.shaft;
    b.loft([s[0]!, s[s.length - 1]!], c.trouserC, undefined, undefined, undefined, { capTop: false });
    b.loft([h[0]!, h[h.length - 1]!], boot, undefined, undefined, undefined, { capTop: false });
    footWedge(b, boot, dims, -len - c.footH);
    return b.build();
  }
  const tc = c.trouserC;
  const cl = clothLift(legRadius(c));
  const surface = plan.surface;
  const surf = limbSurface(surface);
  b.loft(plan.shin, shinBase, undefined, undefined, undefined, { capTop: false });
  // boot shaft
  b.loft(plan.shaft, shaftColour(c, kind), undefined, undefined, undefined, { capTop: false, capBottom: false }); // (open at the top: the trouser runs down inside it)
  const span = shaftTop - plan.ankleY;
  if (kind.tall) {
    // folded top / cuff of the boot, then a buckle strap on the outer side (or the pull-on loops of a rubber boot)
    const fold = kind.rubber ? tone(boot, 1.28) : tone(boot, 1.5);
    bandOn(b, surface, shaftTop + 0.032, shaftTop - 0.03, fold, { lift: cl * 0.6, liftBottom: cl * 0.7, edges: true, crease: true });
    const out = side === "L" ? -1 : 1;
    if (!kind.rubber) {
      const y = shaftTop - Math.min(0.11, Math.max(span, 0.05) * 0.45);
      const m = mountOn(surf, out * (Math.PI / 2) * 0.92, y, 0.007);
      b.box(0.028, 0.03, 0.014, c.accent, m.pos, m.rot); // strap buckle on the outer side
    } else {
      for (const sx of [-1, 1]) {
        const m0 = mountOn(surf, sx * (Math.PI / 2), shaftTop + 0.02, 0.006);
        const m1 = mountOn(surf, sx * (Math.PI / 2), shaftTop - 0.07, 0.006);
        boxBetween(b, m0.pos, m1.pos, 0.02, 0.012, tone(boot, 1.2)); // pull-on loops
      }
    }
  }
  if (!kind.tall && !kind.soft && !kind.clog && tr !== TR.BREECHES && tr !== TR.PLUS_FOURS && tr !== TR.JODHPURS && tr !== TR.SHORTS) {
    // turn-up: a folded band of trouser cloth just above the boot, dirtier than the leg, standing off the leg it wraps
    const cuffC = soil(tone(tc, 1.12), 0.3);
    bandOn(b, surface, shaftTop + 0.075, shaftTop - 0.015, cuffC, { lift: cl * 1.05, liftBottom: cl * 1.35, edges: true, crease: true, colorBottom: tone(cuffC, 0.82) });
  }
  if (tr === TR.PLUS_FOURS) {
    // the knee band that gathers the plus-fours over the gaiter, with its buckle on the outer side
    const y = -len * 0.175;
    bandOn(b, surface, y + 0.02, y - 0.02, c.leather, { lift: cl * 0.5, edges: false, crease: true, colorBottom: tone(c.leather, 0.85) });
    const m = mountOn(surf, (side === "L" ? -1 : 1) * 0.9, y, cl * 0.5 + 0.007);
    b.box(0.03, 0.03, 0.012, c.accent, m.pos, m.rot);
  }
  const fastened = (kind.laces && spec.laces === 0) || (spec.laces > 0 && !kind.rubber && !kind.soft && !kind.clog);
  if (fastened && PartBuilder.lod === 0) laceUp(b, c, plan, dims, boot, side, surf);
  if (kind.puttees) {
    // puttees: a cloth strip wound in a spiral from the ankle to the knee, on the leg's own surface
    const wrapC = singe(PALETTE.trim.puttee, burnt);
    const yTop = tr === TR.PLUS_FOURS ? -len * 0.31 : -len * 0.06; // (plus-fours end in a blouse that hangs over the gaiter: the wrap stops under it)
    const yBot = shaftTop + 0.01;
    const pts: V3[] = [];
    const turns = 5;
    const N = turns * 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(surf(Math.PI + t * turns * Math.PI * 2, yBot + (yTop - yBot) * t, 0.006).p);
    }
    b.sweep(pts, () => ({ rx: 0.02, rz: 0.007, pow: 3.4, color: wrapC }), wrapC, { side: [0, 1, 0], segments: 6, round: "both" });
    bandOn(b, surface, yTop + 0.02, yTop, wrapC, { lift: 0.007, edges: false, crease: true, colorBottom: tone(wrapC, 0.7) });
  }
  if (kind.spurs) {
    // a spur on the heel: a brass yoke, a shank and a rowel
    const yS = plan.ankleY + 0.04;
    const sAt = ringAt(surface, yS);
    const rm = (sAt.rx + sAt.rz) / 2;
    b.torus(rm + 0.006, 0.006, c.accent, [sAt.cx, yS, sAt.cz + 0.005], [Math.PI / 2, 0, 0], [sAt.rx / rm, sAt.rz / rm, 1], Math.PI * 1.2);
    const back = sAt.cz + sAt.rz;
    b.sweep([[0, yS, back - 0.004], [0, yS - 0.01, back + 0.012], [0, yS - 0.02, back + 0.03]], () => ({ rx: 0.007, rz: 0.007, pow: 2 }), c.accent, { side: [1, 0, 0], segments: 4 });
    b.torus(0.022, 0.005, c.accent, [0, yS - 0.02, back + 0.033], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.cone(0.005, 0.014, c.accent, [0, yS - 0.02 + Math.sin(a) * 0.028, back + 0.033 + Math.cos(a) * 0.028], [a + Math.PI / 2, 0, 0]);
    }
  }
  buildFoot(b, c, len, boot, kind, dims);
  return b.build();
}

interface Station {
  p: V3;
  /** Unit normal of the surface there (pointing out of the boot). */
  n: V3;
  /** Where it is: on the shoe's upper at `f` (metres from the heel), or on the shaft at height `y`. */
  f?: number;
  y?: number;
}

/**
 * The line up the front of the boot, from the toe box over the instep and up the shaft to its top: stations on the shoe's own upper (its sections, see footUpperRings) and then on
 * the shaft's surface. Laces, eyelets and straps sit on these, so they follow the boot whatever its height, whatever the size of the foot or the leg.
 */
function frontLine(c: BodyCtx, plan: LowerLegPlan, d: FootDims, bootC: number, surf: ReturnType<typeof limbSurface>): { line: Station[]; across: (st: Station, half: number, lift: number, n: number) => V3[] } {
  const yFloor = -plan.len - c.footH;
  const upper = footUpperRings(d, bootC, plan.kind);
  const y0 = yFloor + 0.012;
  const topAt = (f: number, x: number, lift: number): V3 => {
    const s = ringAt(upper, f);
    const u = Math.min(0.999, Math.abs(x - s.cx) / s.rx);
    const y = y0 + s.cz + (s.rz + lift) * (1 - u ** s.pow) ** (1 / s.pow);
    return [x, y, d.heelZ - f];
  };
  const out: Station[] = [];
  // the instep is only exposed IN FRONT of the leg's column: from just ahead of the ankle's front (measured from the heel) toward the toe cap
  const fJoin = d.heelZ + plan.ankle.rz * 1.03;
  const fToe = Math.min(d.fl * 0.8, fJoin + 0.09);
  const steps = 4;
  if (fToe > fJoin + 0.02) {
    for (let i = 0; i <= steps; i++) {
      const f = fToe - ((fToe - fJoin) * i) / steps; // toe first, then up toward the ankle
      const p = topAt(f, 0, 0.002);
      const a = topAt(f - 0.01, 0, 0);
      const bp = topAt(f + 0.01, 0, 0);
      // the surface rises toward the ankle: the normal is perpendicular to the tangent in the y-z plane, pointing up and forward
      const tz = bp[2] - a[2];
      const ty = bp[1] - a[1];
      const l = Math.hypot(tz, ty) || 1;
      out.push({ p, n: [0, tz / l, -ty / l], f });
    }
  }
  const yJoin = out.length ? out[out.length - 1]!.p[1] : plan.ankleY;
  const yTop = plan.shaftTop - Math.min(plan.kind.tall ? 0.04 : 0.005, (plan.shaftTop - plan.ankleY) * 0.3);
  if (yTop > yJoin + 0.012) {
    const n = Math.max(1, Math.round((yTop - yJoin) / 0.02));
    for (let i = 1; i <= n; i++) {
      const y = yJoin + ((yTop - yJoin) * i) / n;
      const q = surf(0, y, 0.002);
      out.push({ p: q.p, n: q.n, y });
    }
  }
  // points across the boot at a station (x from one side to the other), following the section there: over the instep for the shoe, round the shaft for the shaft
  const across = (st: Station, half: number, lift: number, n: number): V3[] => {
    const pts: V3[] = [];
    for (let j = 0; j < n; j++) {
      const t = -1 + (2 * j) / (n - 1);
      if (st.f !== undefined) {
        const s = ringAt(upper, st.f);
        pts.push(topAt(st.f, t * Math.min(half, s.rx * 0.92), lift));
      } else {
        const sec = ringAt(plan.surface, st.y!);
        const phi = Math.asin(Math.min(0.95, half / Math.max(sec.rx, 1e-6))) * t;
        pts.push(surf(phi, st.y!, lift).p);
      }
    }
    return pts;
  };
  return { line: out, across };
}

/** The boot's fastening (the creator's `laces` choice, and the plain crossings of lace-up boots): eyelets and laces, a bow, or buckled straps, on the front line of the boot. */
function laceUp(b: PartBuilder, c: BodyCtx, plan: LowerLegPlan, d: FootDims, boot: number, side: "L" | "R", surf: ReturnType<typeof limbSurface>): void {
  const { spec, burnt } = c;
  const { line, across } = frontLine(c, plan, d, boot, surf);
  // arc length along the line, to space the eyelets evenly
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1]! + Math.hypot(line[i]!.p[0] - line[i - 1]!.p[0], line[i]!.p[1] - line[i - 1]!.p[1], line[i]!.p[2] - line[i - 1]!.p[2]));
  const total = cum[cum.length - 1]!;
  if (total < 0.02) return;
  const at = (s: number): Station => {
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < s) i++;
    const t = (s - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
    const A = line[i - 1]!;
    const B = line[i]!;
    const lerp3 = (p: V3, q: V3): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const n = lerp3(A.n, B.n);
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    const st: Station = { p: lerp3(A.p, B.p), n: [n[0] / nl, n[1] / nl, n[2] / nl] };
    // it lies on the shoe's upper or on the shaft, whichever end of the span it is nearer to
    const from = t < 0.5 ? A : B;
    if (from.f !== undefined) st.f = A.f !== undefined && B.f !== undefined ? A.f + (B.f - A.f) * t : from.f;
    else st.y = A.y !== undefined && B.y !== undefined ? A.y + (B.y - A.y) * t : from.y;
    return st;
  };
  const lace = singe(PALETTE.trim.ivory, burnt);
  const eyeX = Math.min(plan.legR * 0.2, d.fw * 0.16);
  const n = Math.max(2, Math.min(6, Math.floor(total / 0.024) + 1));
  const stations: Station[] = [];
  for (let i = 0; i < n; i++) stations.push(at((total * i) / (n - 1)));
  const on = (st: Station, x: number, lift: number): V3 => [x, st.p[1] + st.n[1] * lift, st.p[2] + st.n[2] * lift];
  if (spec.laces === 3) {
    // buckled straps across the instep and the shaft
    const strap = tone(boot, 1.18);
    const k = Math.min(3, n);
    for (let i = 0; i < k; i++) {
      const st = stations[k === 1 ? 0 : Math.round((i * (n - 1)) / (k - 1))]!;
      const w = plan.legR * 0.8;
      const pts = across(st, w, 0.004, 7);
      b.sweep(pts, () => ({ rx: 0.0095, rz: 0.004, pow: 2.4 }), strap, { side: st.f !== undefined ? [0, 0, 1] : [0, 1, 0], segments: 4 });
      const end = pts[side === "L" ? 0 : 6]!;
      b.box(0.014, 0.022, 0.012, c.accent, [end[0], end[1] + st.n[1] * 0.004, end[2] + st.n[2] * 0.004]);
    }
    return;
  }
  // eyelets, tongue and lace: laces 0 crossed (plain lace-up boots), 1 crossed, 2 crossed with a bow, 3 straps (above)
  const top = stations[n - 1]!;
  if (spec.laces > 0) for (let i = 0; i < n - 1; i++) boxBetween(b, on(stations[i]!, 0, 0.0015), on(stations[i + 1]!, 0, 0.0015), plan.legR * 0.34, 0.006, tone(boot, 0.7)); // the tongue
  for (let i = 0; i < n; i++) {
    const st = stations[i]!;
    if (spec.laces > 0) for (const sx of [-1, 1]) b.cone(0.0065, 0.005, c.accent, on(st, sx * eyeX, 0.003), tipAlong(st.n)); // eyelets
    if (i < n - 1) {
      const nx = stations[i + 1]!;
      if (spec.laces === 0 || spec.laces === 1) {
        for (const sx of [-1, 1]) boxBetween(b, on(st, sx * eyeX, 0.006), on(nx, -sx * eyeX, 0.006), 0.006, 0.006, lace);
      } else b.box(eyeX * 2.1, 0.006, 0.006, lace, on(st, 0, 0.006));
    }
  }
  if (spec.laces === 2) {
    // a bow at the top: two loops and two tails
    const st = top;
    for (const sx of [-1, 1]) {
      b.torus(0.013, 0.003, lace, on(st, sx * 0.015, 0.012), [0, 0, 0], [1, 1.2, 1]);
      b.box(0.005, 0.03, 0.005, lace, on(st, sx * 0.012, 0.008), [0, 0, sx * 0.2]);
    }
    b.sphere(0.005, tone(lace, 0.9), on(st, 0, 0.008));
  }
}

/** A cheap wedge for the foot of a far figure. */
function footWedge(b: PartBuilder, boot: number, d: FootDims, yFloor: number): void {
  const { fl, fw } = d;
  b.loft([{ y: 0, rx: fw * 0.45, rz: fl * 0.12, cz: fl * 0.1, color: tone(boot, 0.8) }, { y: fl * 0.6, rx: fw * 0.55, rz: fl * 0.13, cz: fl * 0.1, color: boot }, { y: fl * 1.05, rx: fw * 0.3, rz: fl * 0.09, cz: fl * 0.08, color: tone(boot, 1.1) }], boot, [0, yFloor + 0.01, fl * 0.34], [-Math.PI / 2, 0, 0]);
}

/** The shoe's upper as sections along the foot (local y forward from the heel, local z up): shared by the shoe and by the laces that run over its instep. */
function footUpperRings(d: FootDims, bootC: number, kind: BootKind): Ring[] {
  const { fl, fw, H, fwK, toeUp } = d;
  return [
    { y: 0, rx: fw * 0.4 * fwK, rz: H * 0.46, cz: H * 0.5, pow: 2.5, color: tone(bootC, 0.88) },
    { y: fl * 0.14, rx: fw * 0.47 * fwK, rz: H * 0.5, cz: H * 0.52, pow: 2.8, color: bootC },
    { y: fl * 0.42, rx: fw * 0.5 * fwK, rz: H * 0.5, cz: H * 0.5, pow: 3, color: bootC },
    { y: fl * 0.68, rx: fw * 0.55 * fwK, rz: H * 0.4, cz: H * (0.42 + toeUp), pow: 2.8, color: tone(bootC, 1.08) },
    { y: fl * 0.9, rx: fw * 0.5 * fwK, rz: H * 0.33, cz: H * (0.38 + toeUp * 1.6), pow: 2.5, color: tone(bootC, 1.18) },
    { y: fl * 1.06, rx: fw * (kind.soft ? 0.22 : 0.3), rz: H * 0.24, cz: H * (0.36 + toeUp * 2.4), pow: 2.2, color: tone(bootC, 1.12) },
  ];
}

/** The shoe: a lofted last (heel to toe) with a raised toe cap, a darker sole and heel block, and optional spats or hobnails. The sole's underside is the ground plane (y = 0 in the rest pose). */
function buildFoot(b: PartBuilder, c: BodyCtx, legLen: number, bootC: number, kind: BootKind, d: FootDims): void {
  const { footH } = c;
  const { fl, fw, H, heelZ, toeUp } = d;
  const yFloor = -legLen - footH;
  const soleC = kind.clog ? tone(bootC, 0.8) : kind.soft ? tone(bootC, 0.55) : tone(bootC, 0.5);
  // Loft axis: local +Y = forward (world -Z) after the rotation, local Z = up; cz lifts the section off the ground.
  const rings = footUpperRings(d, bootC, kind);
  b.loft(rings, bootC, [0, yFloor + 0.012, heelZ], [-Math.PI / 2, 0, 0], undefined, { segments: 8 });
  // sole slab (a touch wider than the upper) and a heel block; the slab's underside is exactly on the ground
  b.loft(
    [
      { y: -0.01, rx: fw * 0.44, rz: 0.009, cz: 0.009, pow: 3, color: soleC },
      { y: fl * 0.55, rx: fw * 0.6, rz: 0.009, cz: 0.009, pow: 3, color: soleC },
      { y: fl * 1.08, rx: fw * 0.36, rz: 0.009, cz: 0.009 + toeUp * 0.1, pow: 3, color: soleC },
    ],
    soleC,
    [0, yFloor, heelZ],
    [-Math.PI / 2, 0, 0],
    undefined,
    { segments: 8 },
  );
  if (!kind.soft) b.box(fw * 0.75, footH * 0.9, fl * 0.2, soleC, [0, yFloor + footH * 0.45, heelZ - fl * 0.02]);
  if (kind.spats) {
    // spats: cream cloth over the instep
    const spat = singe(PALETTE.trim.ivory, c.burnt);
    b.loft([{ y: 0.03, rx: fw * 0.5, rz: H * 0.5, cz: H * 0.55, color: spat }, { y: fl * 0.5, rx: fw * 0.55, rz: H * 0.42, cz: H * 0.5, crease: true, color: spat }], bootC, [0, yFloor + 0.025, heelZ - fl * 0.02], [-Math.PI / 2, 0, 0], undefined, { capBottom: false });
  }
  if (kind.hobnails) for (let i = 0; i < 6; i++) b.cone(0.013, 0.01, PALETTE.trim.hobnail, [((i % 2) - 0.5) * fw * 0.6, yFloor + 0.003, heelZ - fl * (0.15 + (i >> 1) * 0.3)], [Math.PI, 0, 0]); // (nail heads under the sole, points down)
  if (kind.soft) {
    // slipper: a pompom / a curled toe tip
    b.sphere(fw * 0.14, tone(bootC, 1.35), [0, yFloor + H * 0.7, heelZ - fl * 0.98]);
  }
  if (kind.clog) {
    // carved clog: a band of darker wood across the instep and a pale carved rim
    b.loft([{ y: fl * 0.32, rx: fw * 0.52, rz: H * 0.46, cz: H * 0.52, color: tone(bootC, 0.7) }, { y: fl * 0.42, rx: fw * 0.5, rz: H * 0.5, cz: H * 0.5, color: tone(bootC, 0.7) }], bootC, [0, yFloor + 0.01, heelZ], [-Math.PI / 2, 0, 0], undefined, { capBottom: false, capTop: false });
  }
}

