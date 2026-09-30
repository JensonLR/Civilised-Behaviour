import { BufferAttribute, SphereGeometry, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import { curve } from "./sweep.ts";
import type { Ring } from "./loft.ts";
import { sstep } from "./patch.ts";
import { hookHand, pegShin } from "./prosthetics.ts";
import { CREAM, LEATHER, PartBuilder, SOOT, WOOD, singe, type V3 } from "./parts.ts";
import { legRadius, ringAt, soil, tone, type BodyCtx } from "./bodyKit.ts";
import { JACKET, closedSkirtLength } from "./garments.ts";
import { dressArmDrape } from "./drape.ts";
import { buildHand, handColor } from "./hand.ts";
export { handColor } from "./hand.ts";
import { dyeAt } from "./bodyKit.ts";

/** Arms, hands, legs and feet: sleeves with cuffs and folds, fingered hands, trouser cuts and boots. */

/** The contrast cloth of a look: facings, cuffs, cords. A dye picked from the palette by the jacket's own colour so it always goes with it. */
export function contrastCloth(c: BodyCtx): number {
  return singe(dyeAt(PALETTE.cloth, c.spec.jacketColor + 4), c.burnt);
}

// ---- arms ---------------------------------------------------------------------------------------------------------------

/** Loose-sleeved coats hang wider; fitted ones hug. */
function sleeveFull(jacket: number): number {
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

/** Epaulettes sit on the sleeve head, in the shoulder frame. */
function epaulette(b: PartBuilder, c: BodyCtx, side: "L" | "R"): void {
  const kind = c.spec.epaulettes;
  if (kind === 0) return;
  const r = c.P.armRadius;
  const sx = side === "L" ? -1 : 1;
  const gold = c.accent;
  const cloth = tone(c.armC, 0.8);
  const y = r * 0.42;
  const w = r * 1.5; // across (X)
  const len = r * 2.6; // front to back (Z)
  const rot: V3 = [0, 0, sx * 0.14];
  if (kind === 1 || kind === 2 || kind === 3) {
    b.loft([{ y: -len * 0.5, rx: w * 0.5, rz: 0.008, color: tone(gold, 0.85) }, { y: 0, rx: w * 0.55, rz: 0.01, color: gold }, { y: len * 0.5, rx: w * 0.45, rz: 0.008, color: tone(gold, 0.85) }], gold, [0, y + r * 0.35, 0], [Math.PI / 2, 0, 0]);
    b.loft([{ y: -len * 0.44, rx: w * 0.4, rz: 0.011, color: cloth }, { y: len * 0.44, rx: w * 0.36, rz: 0.011, color: cloth }], cloth, [0, y + r * 0.38, 0], [Math.PI / 2, 0, 0]);
    b.sphere(0.014, gold, [0, y + r * 0.5, 0], [1, 0.8, 1]);
  }
  if (kind === 2 || kind === 3) {
    // fringe (2) or thick bullion coils (3) hang off the outer end
    const n = kind === 3 ? 6 : 8;
    for (let i = 0; i < n; i++) {
      const z = -len * 0.42 + (i / (n - 1)) * len * 0.84;
      if (kind === 3) b.cylinder(0.011, 0.011, w * 0.5, tone(gold, i % 2 ? 0.85 : 1.1), [sx * w * 0.6, y + r * 0.1, z], [0, 0, Math.PI / 2 + sx * 0.4]);
      else b.box(0.006, 0.07, 0.006, gold, [sx * w * 0.68, y - r * 0.15, z], rot);
    }
    if (kind === 3) b.torus(w * 0.5, 0.012, gold, [0, y + r * 0.38, 0], [Math.PI / 2, 0, 0], [1, len / (w * 1.0) * 0.5, 1]);
  }
  if (kind === 4) {
    // shoulder cords: a braided loop from the shoulder seam round the sleeve head
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push([Math.sin(a) * r * 1.0 * sx * 0 + Math.sin(a) * r * 1.05, y - r * 0.15 + Math.cos(a * 0.5) * 0.004, Math.cos(a) * r * 1.05]);
    }
    b.sweep(curve(pts, 16), (t) => ({ rx: 0.008, rz: 0.008, pow: 2, color: Math.sin(t * 60) > 0 ? gold : tone(gold, 0.8) }), gold, { side: [0, 1, 0], segments: 4 });
    b.sphere(0.02, gold, [0, y + r * 0.1, r * 1.1]);
    b.box(0.01, 0.09, 0.01, gold, [sx * r * 0.6, y - r * 0.6, r * 1.15]);
  }
}

export function buildUpperArm(c: BodyCtx, side: "L" | "R" = "L"): BufferGeometry | undefined {
  const { spec, P } = c;
  const b = new PartBuilder();
  const r = P.armRadius;
  const L = P.armUpper;
  const sleeveC = c.armC;
  b.loft(upperArmRings(P, sleeveC, spec.jacket), sleeveC);
  // the seam where the sleeve head meets the body: a darker line just under the shoulder
  const f = sleeveFull(spec.jacket);
  if (spec.jacket !== JACKET.SHIRT && spec.jacket !== JACKET.WAISTCOAT)
    b.loft([{ y: -r * 0.05, rx: r * 1.44 * f, rz: r * 1.37 * f, color: tone(sleeveC, 0.72) }, { y: -r * 0.13, rx: r * 1.44 * f, rz: r * 1.37 * f, color: tone(sleeveC, 0.72) }], sleeveC, undefined, undefined, undefined, { capBottom: false, capTop: false });
  if (spec.jacket === JACKET.HUNTING || spec.jacket === JACKET.NORFOLK) b.box(r * 0.5, L * 0.25, r * 0.2, LEATHER, [0, -L * 0.98, r * 0.85]); // elbow patch (back of the arm)
  epaulette(b, c, side);
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

/** The cuff of a sleeve, in the forearm frame: `y0` = the wrist. */
function cuff(b: PartBuilder, c: BodyCtx, L: number, r: number): void {
  const j = c.spec.jacket;
  const contrast = contrastCloth(c);
  const burnt = c.burnt;
  const cream = singe(CREAM, burnt);
  const shirtCuff = tone(c.shirtC, 1.04);
  const gold = c.accent;
  const trimC = c.spec.coatTrim === 2 && j !== JACKET.SHIRT && j !== JACKET.WAISTCOAT ? contrast : undefined;
  const ring = (y: number, k: number, color: number): Ring => ({ y, rx: r * k, rz: r * k * 0.97, color });
  const band = (yTop: number, yBot: number, kTop: number, kBot: number, color: number, buttons = 0): void => {
    const thin = yTop - yBot < 0.03;
    const rows = thin ? [ring(yTop, kTop + 0.02, tone(color, 1.05)), ring(yBot, kBot + 0.02, tone(color, 0.85))] : [ring(yTop, kTop, tone(color, 1.05)), ring(yTop - 0.004, kTop + 0.03, color), ring(yBot, kBot + 0.02, tone(color, 0.82))];
    b.loft(rows, color, undefined, undefined, undefined, { capBottom: false, capTop: false, segments: 8 });
    if (buttons > 0) for (let i = 0; i < buttons; i++) b.sphere(0.011, gold, [0, yTop - 0.012 - i * 0.02, r * 1.05 * kTop + 0.004], [1, 1, 0.5]);
  };
  const bottom = -L - 0.005;
  if (j === JACKET.SHIRT || j === JACKET.WAISTCOAT || j === JACKET.CAPE || j === JACKET.PONCHO) {
    // a shirt cuff: the sleeve gathers into a stiff band with a link
    band(bottom + 0.06, bottom, 0.9, 0.9, shirtCuff);
    b.sphere(0.011, gold, [r * 0.9, bottom + 0.03, 0], [0.6, 1, 1]);
    return;
  }
  const outer = trimC ?? (j === JACKET.GREATCOAT || j === JACKET.SMOKING ? c.armC : c.armC);
  const facing = trimC ?? (j === JACKET.SMOKING ? contrast : j === JACKET.GREATCOAT ? tone(c.armC, 0.75) : j === JACKET.TUNIC ? tone(c.armC, 0.72) : c.armC);
  if (j === JACKET.FROCK) {
    // a turned cuff flaring a little at the edge, three buttons up the back seam, a line of shirt peeking below
    band(bottom + 0.085, bottom + 0.012, 0.94, 1.02, trimC ?? tone(outer, 1.08), 3);
    band(bottom + 0.014, bottom, 0.9, 0.9, cream);
  } else if (j === JACKET.GREATCOAT) {
    band(bottom + 0.12, bottom + 0.01, 0.98, 1.08, facing, 2);
    band(bottom + 0.014, bottom, 0.9, 0.9, cream);
  } else if (j === JACKET.SMOKING) {
    band(bottom + 0.11, bottom + 0.01, 0.98, 1.1, facing, 0);
    band(bottom + 0.014, bottom, 0.9, 0.9, cream);
  } else if (j === JACKET.NAVAL) {
    // gold stripes: a broad band and two narrow ones with the executive curl
    band(bottom + 0.12, bottom + 0.1, 1.0, 1.0, gold);
    band(bottom + 0.085, bottom + 0.07, 1.0, 1.0, gold);
    band(bottom + 0.055, bottom + 0.04, 1.0, 1.0, gold);
    band(bottom + 0.014, bottom, 0.9, 0.9, cream);
    if (trimC) band(bottom + 0.03, bottom + 0.014, 1.0, 1.0, trimC);
  } else if (j === JACKET.TUNIC) {
    band(bottom + 0.075, bottom + 0.005, 0.95, 1.04, facing, 2);
    band(bottom + 0.014, bottom, 0.9, 0.9, cream);
  } else {
    // hunting / Norfolk: a strapped cuff
    band(bottom + 0.07, bottom + 0.005, 0.96, 1.0, trimC ?? tone(outer, 0.9), 1);
    band(bottom + 0.014, bottom, 0.9, 0.9, cream);
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
  const shirtSleeve = j === JACKET.SHIRT || j === JACKET.WAISTCOAT || j === JACKET.CAPE || j === JACKET.PONCHO;
  const rolled = shirtSleeve && spec.shirt === 6; // work shirts are worn with the sleeves rolled to the elbow
  const skin = handColor(c) === c.skin ? c.skin : c.skin;
  const wristY = -L;
  if (PartBuilder.lod >= 2) {
    // far figure: a tapered sleeve and a ball for the hand
    b.loft([{ y: r * 0.3, rx: r * f, rz: r * 0.98 * f, color: tone(sleeveC, 0.9) }, { y: -L * 0.5, rx: r * f, rz: r * f, color: sleeveC }, { y: -L, rx: r * 0.84 * f, rz: r * 0.82 * f, color: sleeveC }], sleeveC);
    b.sphere(P.handRadius * 0.95, handColor(c), [0, -L - P.handRadius * 0.55, -P.handRadius * 0.15]);
    return b.build();
  }
  // elbow crease + forearm, with the shirt's blouse gathering into the cuff
  const rings: Ring[] = [
    { y: r * 0.3, rx: r * 1.0 * f, rz: r * 0.98 * f, color: tone(sleeveC, 0.9) },
    { y: r * 0.0, rx: r * 0.95 * f, rz: r * 0.93 * f, color: tone(sleeveC, 0.7), crease: true },
    { y: -L * 0.12, rx: r * 1.04 * f, rz: r * 1.0 * f, color: tone(sleeveC, 1.02) },
    { y: -L * 0.35, rx: r * 1.02 * f, rz: r * 1.0 * f, color: sleeveC },
    { y: -L * 0.72, rx: r * (shirtSleeve ? 0.98 : 0.88) * f, rz: r * (shirtSleeve ? 0.96 : 0.86) * f, color: tone(sleeveC, 0.95) },
    { y: -L * 0.9, rx: r * 0.84 * f, rz: r * 0.82 * f, color: soil(tone(sleeveC, 0.9), 0.22) },
    { y: -L + 0.012, rx: r * 0.82 * f, rz: r * 0.8 * f, color: soil(tone(sleeveC, 0.85), 0.28) },
  ];
  if (rolled) {
    // sleeve ends in a thick roll at the elbow; bare forearm below
    const rollY = -L * 0.28;
    const rl: Ring[] = [
      { y: r * 0.3, rx: r * 1.0, rz: r * 0.98, color: tone(sleeveC, 0.9) },
      { y: r * 0.0, rx: r * 0.95, rz: r * 0.93, color: tone(sleeveC, 0.7), crease: true },
      { y: -L * 0.14, rx: r * 1.04, rz: r * 1.0, color: sleeveC },
      { y: rollY + 0.03, rx: r * 1.08, rz: r * 1.04, color: sleeveC },
      { y: rollY + 0.03, rx: r * 1.12, rz: r * 1.08, color: tone(sleeveC, 0.8), crease: true },
      { y: rollY - 0.03, rx: r * 1.13, rz: r * 1.09, color: tone(sleeveC, 1.06) },
      { y: rollY - 0.03, rx: r * 0.83, rz: r * 0.8, color: tone(skin, 0.95), crease: true },
      { y: -L * 0.72, rx: r * 0.76, rz: r * 0.74, color: skin },
      { y: wristY - 0.004, rx: r * 0.66, rz: r * 0.62, color: tone(skin, 0.94) },
    ];
    b.loft(rl, sleeveC);
  } else {
    b.loft(rings, sleeveC);
    cuff(b, c, L, r);
  }
  if (spec.hook === (side === "L" ? 1 : 2)) hookHand(b, c, L);
  else buildHand(b, c, L, side, grip);
  return b.build();
}

// ---- legs ---------------------------------------------------------------------------------------------------------------

export { legRadius };

/** Colour of the stockings shown where trousers stop short of the boot (breeches, plus-fours, shorts). */
function sockColor(c: BodyCtx): number {
  return singe(c.spec.trousers === 6 ? PALETTE.trim.ivory : tone(PALETTE.material.linen, 0.92), c.burnt);
}

/** Thigh sections in the hip frame (hanging down) for the spec's trouser cut. Shared with the wound dressings. */
export function upperLegRings(c: BodyCtx): Ring[] {
  const rings = trouserRings(c);
  // the top of the thigh is rounded into the hip instead of ending in a flat slab that pokes out of the coat
  const top = rings[0]!;
  const out: Ring[] = [{ ...top, y: top.y - 0.004, rx: top.rx * 0.78, rz: top.rz * 0.8, color: tone(top.color ?? c.trouserC, 0.85) }, { ...top, y: -0.035 }, ...rings.slice(1)];
  // Under a closed coat skirt the thigh is slimmed to a core: the skirt hides it, and two surfaces crossing show as a sawtooth.
  const hem = closedSkirtLength(c.spec, c.P);
  if (hem <= 0) return out;
  return out.map((r) => {
    const k = 0.55 + 0.45 * sstep(-hem * 1.05, -hem * 1.9, r.y);
    return k >= 1 ? r : { ...r, rx: r.rx * k, rz: r.rz * k };
  });
}

function trouserRings(c: BodyCtx): Ring[] {
  const { spec, P } = c;
  const r = legRadius(c);
  const L = P.legUpper;
  const tc = c.trouserC;
  const kind = spec.trousers;
  if (kind === 2) {
    // breeches: puffed thigh, gathered tight above the knee
    return [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.35, rx: r * 1.6, rz: r * 1.5, pow: 2.2, color: tc },
      { y: -L * 0.8, rx: r * 1.15, rz: r * 1.1, color: tone(tc, 0.9) },
      { y: -L - 0.02, rx: r * 0.9, rz: r * 0.9, color: tone(tc, 0.85) },
    ];
  }
  if (kind === 3) {
    // baggy: hangs from the hip and billows, pinched a little at the knee, with a fold band where the cloth stacks
    return [
      { y: 0.04, rx: r * 1.25, rz: r * 1.2, color: tone(tc, 0.95) },
      { y: -L * 0.3, rx: r * 1.38, rz: r * 1.32, pow: 2.2, color: tone(tc, 1.03) },
      { y: -L * 0.62, rx: r * 1.28, rz: r * 1.22, color: tc },
      { y: -L * 0.88, rx: r * 1.2, rz: r * 1.14, color: tone(tc, 0.86) },
      { y: -L - 0.02, rx: r * 1.15, rz: r * 1.1, color: tone(tc, 0.8) },
    ];
  }
  if (kind === 4) {
    // plus-fours: full thigh and a generous blouse at the knee that overhangs the gaiter (continued in the shin)
    return [
      { y: 0.04, rx: r * 1.25, rz: r * 1.2, color: tone(tc, 0.95) },
      { y: -L * 0.3, rx: r * 1.4, rz: r * 1.34, pow: 2.2, color: tone(tc, 1.03) },
      { y: -L * 0.7, rx: r * 1.4, rz: r * 1.32, color: tc },
      { y: -L - 0.02, rx: r * 1.32, rz: r * 1.26, color: tone(tc, 0.82) },
    ];
  }
  if (kind === 5) {
    // jodhpurs: flared at the hip like wings, then tight from mid-thigh
    return [
      { y: 0.04, rx: r * 1.32, rz: r * 1.26, color: tone(tc, 0.95) },
      { y: -L * 0.22, rx: r * 1.72, rz: r * 1.4, pow: 2.1, color: tone(tc, 1.03) },
      { y: -L * 0.5, rx: r * 1.3, rz: r * 1.2, color: tc },
      { y: -L * 0.85, rx: r * 0.92, rz: r * 0.9, color: tone(tc, 0.9) },
      { y: -L - 0.02, rx: r * 0.85, rz: r * 0.85, color: tone(tc, 0.82) },
    ];
  }
  if (kind === 6) {
    // shorts: the trouser leg stops above the knee; bare skin below it
    const skin = c.skin;
    return [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.25, rx: r * 1.28, rz: r * 1.22, pow: 2.3, color: tone(tc, 1.03) },
      { y: -L * 0.52, rx: r * 1.24, rz: r * 1.18, color: tone(tc, 0.9) },
      { y: -L * 0.56, rx: r * 1.24, rz: r * 1.18, color: tone(tc, 0.7), crease: true },
      { y: -L * 0.57, rx: r * 1.02, rz: r * 0.98, color: tone(skin, 1.0) },
      { y: -L * 0.75, rx: r * 0.98, rz: r * 0.94, color: skin },
      { y: -L - 0.02, rx: r * 0.9, rz: r * 0.9, color: tone(skin, 0.9) },
    ];
  }
  // a tailored leg: full at the thigh, easing to the knee, a fold band behind the bend
  return [
    { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
    { y: -L * 0.25, rx: r * 1.28, rz: r * 1.22, pow: 2.3, color: tone(tc, 1.03) },
    { y: -L * 0.6, rx: r * 1.1, rz: r * 1.06, color: tc },
    { y: -L * 0.9, rx: r * 0.96, rz: r * 0.94, color: tone(tc, 0.9) },
    { y: -L - 0.02, rx: r * 0.92, rz: r * 0.92, color: tone(tc, 0.78) },
  ];
}

/** Front surface z (negative) of the thigh at depth y below the hip. */
function legFront(rings: readonly Ring[], y: number): number {
  const s = ringAt(rings, y);
  return s.cz - s.rz;
}

export function buildUpperLeg(c: BodyCtx, side: "L" | "R" = "L"): BufferGeometry | undefined {
  const { spec, P, burnt } = c;
  const b = new PartBuilder();
  const r = legRadius(c);
  const L = P.legUpper;
  const tc = c.trouserC;
  const rings = upperLegRings(c);
  b.loft(rings, tc);
  const shorts = spec.trousers === 6;
  b.add(new SphereGeometry(r * 0.62, 6, 4), shorts ? tone(c.skin, 1.0) : tone(tc, 0.97), [0, -L - 0.01, -r * 0.55], [0, 0, 0], [1, 0.9, 0.8]); // knee cap: gives the bend a visible pivot
  const crease = (y0: number, y1: number, color: number, w: number, lift = 0.004): void => {
    // a pressed crease / stripe down the front of the leg, following the section
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const y = y0 + ((y1 - y0) * i) / 6;
      pts.push([0, y, legFront(rings, y) - lift]);
    }
    b.sweep(pts, () => ({ rx: w, rz: 0.004, pow: 2.4 }), color, { side: [1, 0, 0], segments: 4, round: "both" });
  };
  if (spec.trousers === 1) crease(-0.02, -L * 0.96, singe(CREAM, burnt), 0.008); // stripe
  else if (!shorts && spec.trousers !== 3) crease(-0.03, -L * 0.95, tone(tc, 1.28), 0.005); // pressed crease
  if (spec.trousers === 2 || spec.trousers === 4) {
    // garter strap / knee band
    const y = spec.trousers === 4 ? -L - 0.004 : -L * 0.9;
    const s = ringAt(rings, y);
    b.loft([{ y: y + 0.02, rx: s.rx * 1.01, rz: s.rz * 1.01, color: c.leather }, { y: y - 0.02, rx: s.rx * 1.01, rz: s.rz * 1.01, color: c.leather, crease: true }], c.leather, undefined, undefined, undefined, { capBottom: false, capTop: false });
    b.box(0.03, 0.03, 0.012, c.accent, [s.rx * 0.9, y, -s.rz * 0.5]);
  }
  trousersTrim(b, c, rings, L, side);
  return b.build();
}

/** Knee patches, mends, mud and side stripes on the thigh (hip frame). */
function trousersTrim(b: PartBuilder, c: BodyCtx, rings: readonly Ring[], L: number, side: "L" | "R"): void {
  const t = c.spec.trouserTrim;
  if (t === 0) return;
  const r = legRadius(c);
  const tc = c.trouserC;
  const patchC = tone(c.leather, 1.1);
  const z = (y: number): number => legFront(rings, y);
  const sx = side === "L" ? -1 : 1;
  const yK = -L * 0.94;
  if (t === 1) {
    // leather knee patches: an oval pad with a stitched border
    b.sphere(r * 0.7, patchC, [0, yK, z(yK) + r * 0.62], [1, 0.9, 0.34]);
    b.torus(r * 0.62, 0.004, tone(patchC, 1.4), [0, yK, z(yK) + r * 0.05], [0, 0, 0], [1, 0.9, 1]);
  } else if (t === 2) {
    // patched and mended: a square patch of odd cloth and a darn, with stitches
    const odd = tone(dyeAt(PALETTE.cloth, c.spec.trousersColor + 3), 1.05);
    b.box(r * 0.62, r * 0.6, 0.012, singe(odd, c.burnt), [-sx * r * 0.2, -L * 0.9, z(-L * 0.9) - 0.002], [0, 0, 0.18]);
    for (let i = 0; i < 4; i++) b.box(0.014, 0.004, 0.004, tone(tc, 0.55), [-sx * r * 0.2 + (i - 1.5) * 0.02, -L * 0.9 + r * 0.32, z(-L * 0.9) - 0.012]);
    b.box(r * 0.4, r * 0.3, 0.01, tone(tc, 1.35), [sx * r * 0.25, -L * 0.38, z(-L * 0.38) - 0.002], [0, 0, -0.3]);
    for (let i = 0; i < 3; i++) b.box(0.02, 0.004, 0.004, tone(tc, 0.5), [sx * r * 0.25 + (i - 1) * 0.02, -L * 0.38, z(-L * 0.38) - 0.01], [0, 0, -0.3]);
  } else if (t === 3) {
    // muddy knees: a dirty oval above and below the knee
    const mud = soil(tc, 0.7);
    b.sphere(r * 0.9, mud, [0, yK, z(yK) + r * 0.62], [1, 1.1, 0.3]);
    b.sphere(r * 0.5, tone(mud, 0.8), [sx * r * 0.2, yK - 0.05, z(yK) + r * 0.5], [1, 0.8, 0.3]);
  } else if (t === 4) {
    // a broad side stripe (a uniform's braid) down the outer seam
    const stripe = c.spec.jacket === JACKET.NAVAL || c.spec.jacket === JACKET.TUNIC ? c.accent : tone(tc, 1.6);
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const y = 0.0 - (L * 0.98 * i) / 6;
      const s = ringAt(rings, y);
      pts.push([sx * (s.rx + 0.004), y, s.cz]);
    }
    b.sweep(pts, () => ({ rx: 0.012, rz: 0.014, pow: 2.4 }), stripe, { side: [0, 0, 1], segments: 4, round: "both" });
  }
}

// ---- lower legs and boots ------------------------------------------------------------------------------------------------------

interface BootKind {
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
const BOOTS: readonly BootKind[] = [
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

/** The material a boot is made of and its base colour. */
const tr0 = (spec: { trousers: number }): number => spec.trousers;

function bootColour(c: BodyCtx, k: BootKind): number {
  if (k.rubber) return singe(PALETTE.material.rubber, c.burnt);
  if (k.clog) return singe(WOOD, c.burnt);
  if (k.soft) return singe(tone(dyeAt(PALETTE.cloth, c.spec.trousersColor + 8), 0.9), c.burnt);
  return c.leather;
}

export function buildLowerLeg(c: BodyCtx, wooden: boolean, side: "L" | "R" = "L"): BufferGeometry | undefined {
  const { spec, P, burnt } = c;
  const b = new PartBuilder();
  const r = legRadius(c);
  const len = P.legLower;
  if (wooden) {
    pegShin(b, c, len);
    return b.build();
  }
  const kind = BOOTS[spec.boots] ?? BOOTS[0]!;
  const boot = bootColour(c, kind);
  if (PartBuilder.lod >= 2) {
    // far figure: the trouser leg, the boot top, and a wedge for the foot
    const legR0 = tr0(spec) === 3 ? r * 1.1 : r * 0.9;
    const top = -len * (1 - Math.min(0.62, kind.top));
    b.loft([{ y: 0.02, rx: legR0 * 1.04, rz: legR0 * 1.02, color: tone(c.trouserC, 0.9) }, { y: top, rx: legR0 * 0.86, rz: legR0 * 0.84, color: c.trouserC }], c.trouserC, undefined, undefined, undefined, { capTop: false });
    b.loft([{ y: top + 0.01, rx: legR0 * 0.9, rz: legR0 * 0.88, color: boot }, { y: -len + 0.02, rx: legR0 * 0.8, rz: legR0 * 0.8, color: tone(boot, 0.9) }], boot, undefined, undefined, undefined, { capTop: false });
    const fl = P.footLength;
    const fw = P.footWidth;
    const yFloor = -len - c.footH;
    b.loft([{ y: 0, rx: fw * 0.45, rz: fl * 0.12, cz: fl * 0.1, color: tone(boot, 0.8) }, { y: fl * 0.6, rx: fw * 0.55, rz: fl * 0.13, cz: fl * 0.1, color: boot }, { y: fl * 1.05, rx: fw * 0.3, rz: fl * 0.09, cz: fl * 0.08, color: tone(boot, 1.1) }], boot, [0, yFloor + 0.01, fl * 0.34], [-Math.PI / 2, 0, 0]);
    return b.build();
  }
  const tc = c.trouserC;
  const tr = spec.trousers;
  const legR = tr === 3 ? r * 1.1 : tr === 4 ? r * 1.0 : tr === 5 ? r * 0.84 : r * 0.9;
  const bootTop = Math.min(0.62, kind.top);
  const shaftTop = -len * (1 - bootTop);
  const sock = sockColor(c);
  const bareShin = tr === 6;
  const stockinged = tr === 2 || tr === 4 || bareShin;
  const shinBase = bareShin ? c.skin : stockinged ? sock : tc;
  // trouser (or stocking, or skin) shin down to the boot
  const shin: Ring[] = [
    { y: 0.02, rx: legR * 1.05, rz: legR * 1.02, color: tone(shinBase, 0.78) },
    { y: -len * 0.22, rx: legR * 1.04, rz: legR * 1.08, pow: 2.2, color: tone(shinBase, 1.02) }, // calf
    { y: -len * 0.55, rx: legR * 0.94, rz: legR * 0.92, color: shinBase },
    { y: Math.min(shaftTop + 0.02, -len * 0.6), rx: legR * 0.82, rz: legR * 0.8, color: soil(tone(shinBase, 0.9), 0.22 + 0.04 * spec.boots) },
  ];
  if (tr === 4) {
    // plus-fours overhang: the knickerbocker cloth hangs over a gaiter
    shin[0] = { y: 0.02, rx: legR * 1.32, rz: legR * 1.26, color: tone(tc, 0.82) };
    shin.splice(1, 1, { y: -len * 0.06, rx: legR * 1.34, rz: legR * 1.28, pow: 2.2, color: tc });
    shin.splice(2, 0, { y: -len * 0.2, rx: legR * 1.12, rz: legR * 1.08, color: tone(tc, 0.72) }, { y: -len * 0.21, rx: legR * 0.98, rz: legR * 0.96, color: sock, crease: true });
  }
  b.loft(shin, shinBase, undefined, undefined, undefined, { capTop: false });
  // boot shaft
  const shaftC = kind.spats ? singe(PALETTE.trim.ivory, burnt) : boot;
  const wide = kind.rubber ? 1.14 : 1;
  if (!kind.soft && !kind.clog) {
    b.loft(
      [
        { y: shaftTop + 0.012, rx: legR * 0.94 * wide, rz: legR * 0.92 * wide, color: tone(shaftC, 1.15) },
        { y: shaftTop - 0.03, rx: legR * 0.88 * wide, rz: legR * 0.86 * wide, color: shaftC, crease: true },
        { y: -len * (1 - bootTop * 0.4), rx: legR * 0.84 * wide, rz: legR * 0.83 * wide, color: tone(shaftC, 0.95) },
        { y: -len + 0.02, rx: legR * 0.8 * wide, rz: legR * 0.8 * wide, color: tone(shaftC, 0.88) },
      ],
      shaftC,
      undefined,
      undefined,
      undefined,
      { capTop: false },
    );
  } else {
    // slippers and clogs: only a low collar round the ankle
    b.loft(
      [
        { y: shaftTop + 0.02, rx: legR * 0.9, rz: legR * 0.88, color: tone(boot, 1.15) },
        { y: shaftTop - 0.005, rx: legR * 0.84, rz: legR * 0.82, color: boot, crease: true },
        { y: -len + 0.02, rx: legR * 0.8, rz: legR * 0.8, color: tone(boot, 0.9) },
      ],
      boot,
      undefined,
      undefined,
      undefined,
      { capTop: false },
    );
  }
  if (kind.tall) {
    // folded top / cuff of the boot
    const fold = kind.rubber ? tone(boot, 1.28) : tone(boot, 1.5);
    b.loft([{ y: shaftTop + 0.032, rx: legR * 0.99 * wide, rz: legR * 0.97 * wide, color: fold }, { y: shaftTop - 0.03, rx: legR * 0.99 * wide, rz: legR * 0.97 * wide, color: fold, crease: true }], boot, undefined, undefined, undefined, { capBottom: false, capTop: false });
    if (!kind.rubber) b.box(0.028, 0.03, 0.022, c.accent, [legR * 0.88, shaftTop - Math.min(0.11, len * bootTop * 0.45), -legR * 0.05]); // strap buckle on the outer side
    if (kind.rubber) for (const sx of [-1, 1]) b.box(0.02, 0.09, 0.02, tone(boot, 1.2), [sx * legR * wide * 0.98, shaftTop - 0.05, 0]); // pull-on loops
  }
  if (!kind.tall && !kind.soft && !kind.clog && tr !== 2 && tr !== 4 && tr !== 5 && tr !== 6) {
    // turn-up: a folded band of trouser cloth just above the boot, dirtier than the leg
    const cuffC = soil(tone(tc, 1.12), 0.3);
    b.loft([{ y: shaftTop + 0.075, rx: legR * 0.92, rz: legR * 0.9, color: cuffC }, { y: shaftTop + 0.06, rx: legR * 0.97, rz: legR * 0.95, color: cuffC }, { y: shaftTop - 0.015, rx: legR * 0.97, rz: legR * 0.95, color: tone(cuffC, 0.82), crease: true }], tc, undefined, undefined, undefined, { capBottom: false, capTop: false });
  }
  if (kind.laces) {
    // laces: little crossings up the front of the ankle (inside the shaft, never below the sole)
    const lace = singe(PALETTE.trim.ivory, burnt);
    const span = len * bootTop;
    for (let i = 0; i < 2; i++) {
      const y = shaftTop - span * (0.22 + 0.36 * i);
      for (const sx of [-1, 1]) b.box(legR * 0.42, 0.007, 0.007, lace, [sx * legR * 0.1, y, -legR * 0.87], [0, 0, sx * 0.55]);
    }
  }
  if (kind.puttees) {
    // puttees: a cloth strip wound in a spiral from the ankle to the knee
    const wrapC = singe(PALETTE.trim.puttee, burnt);
    const yTop = -len * 0.06;
    const yBot = shaftTop + 0.01;
    const pts: V3[] = [];
    const turns = 5;
    const N = turns * 8;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = yBot + (yTop - yBot) * t;
      const a = t * turns * Math.PI * 2;
      const s = legR * (1.0 + 0.05 * (1 - t));
      pts.push([Math.sin(a) * s * 0.98, y, Math.cos(a) * s * 0.96]);
    }
    b.sweep(pts, () => ({ rx: 0.02, rz: 0.008, pow: 2.4, color: wrapC }), wrapC, { side: [0, 1, 0], segments: 4, round: "both" });
    b.loft([{ y: yTop + 0.02, rx: legR * 1.02, rz: legR * 1.0, color: tone(wrapC, 0.9) }, { y: yTop, rx: legR * 1.04, rz: legR * 1.02, color: tone(wrapC, 0.7), crease: true }], wrapC, undefined, undefined, undefined, { capBottom: false, capTop: false });
  }
  if (kind.spurs) {
    // a spur on the heel: a brass yoke, a shank and a rowel
    const yS = -len + 0.06;
    b.torus(legR * 0.86, 0.006, c.accent, [0, yS, legR * 0.05], [Math.PI / 2, 0, 0], [1, 1.05, 1], Math.PI * 1.2);
    b.sweep([[0, yS, legR * 0.78], [0, yS - 0.01, legR * 0.95], [0, yS - 0.02, legR * 1.12]], () => ({ rx: 0.007, rz: 0.007, pow: 2 }), c.accent, { side: [1, 0, 0], segments: 4 });
    b.torus(0.022, 0.005, c.accent, [0, yS - 0.02, legR * 1.15], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.cone(0.005, 0.014, c.accent, [0, yS - 0.02 + Math.sin(a) * 0.028, legR * 1.15 + Math.cos(a) * 0.028], [a + Math.PI / 2, 0, 0]);
    }
  }
  buildFoot(b, c, len, boot, kind);
  void side;
  void sstep;
  return b.build();
}

/** The shoe: a lofted last (heel to toe) with a raised toe cap, a darker sole and heel block, and optional spats or hobnails. */
function buildFoot(b: PartBuilder, c: BodyCtx, legLen: number, bootC: number, kind: BootKind): void {
  const { spec, P, footH } = c;
  const fl = P.footLength;
  const fw = P.footWidth;
  // Chunky on purpose: a caricature shoe is a loaf, not a plank. Height follows length so big feet stay bulky.
  let H = Math.max(footH * 1.6 + 0.04, fl * 0.27);
  if (kind.soft) H *= 0.7;
  if (kind.rubber) H *= 1.08;
  const yFloor = -legLen - footH;
  const soleC = kind.clog ? tone(bootC, 0.8) : kind.soft ? tone(bootC, 0.55) : tone(bootC, 0.5);
  const heelZ = fl * 0.34;
  const toeUp = kind.clog ? 0.16 : kind.soft ? 0.1 : 0;
  // Loft axis: local +Y = forward (world -Z) after the rotation, local Z = up; cz lifts the section off the ground.
  const fwK = kind.rubber ? 1.1 : 1;
  const rings: Ring[] = [
    { y: 0, rx: fw * 0.4 * fwK, rz: H * 0.46, cz: H * 0.5, pow: 2.5, color: tone(bootC, 0.88) },
    { y: fl * 0.14, rx: fw * 0.47 * fwK, rz: H * 0.5, cz: H * 0.52, pow: 2.8, color: bootC },
    { y: fl * 0.42, rx: fw * 0.5 * fwK, rz: H * 0.5, cz: H * 0.5, pow: 3, color: bootC },
    { y: fl * 0.68, rx: fw * 0.55 * fwK, rz: H * 0.4, cz: H * (0.42 + toeUp), pow: 2.8, color: tone(bootC, 1.08) },
    { y: fl * 0.9, rx: fw * 0.5 * fwK, rz: H * 0.33, cz: H * (0.38 + toeUp * 1.6), pow: 2.5, color: tone(bootC, 1.18) },
    { y: fl * 1.06, rx: fw * (kind.soft ? 0.22 : 0.3), rz: H * 0.24, cz: H * (0.36 + toeUp * 2.4), pow: 2.2, color: tone(bootC, 1.12) },
  ];
  b.loft(rings, bootC, [0, yFloor + 0.01, heelZ], [-Math.PI / 2, 0, 0], undefined, { segments: 8 });
  // sole slab (a touch wider than the upper) and a heel block
  b.loft(
    [
      { y: -0.01, rx: fw * 0.44, rz: 0.018, cz: 0.012, pow: 3, color: soleC },
      { y: fl * 0.55, rx: fw * 0.6, rz: 0.018, cz: 0.012, pow: 3, color: soleC },
      { y: fl * 1.08, rx: fw * 0.36, rz: 0.018, cz: 0.012 + toeUp * 0.1, pow: 3, color: soleC },
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
  if (kind.hobnails) for (let i = 0; i < 6; i++) b.sphere(0.014, PALETTE.trim.hobnail, [((i % 2) - 0.5) * fw * 0.6, yFloor - 0.004, heelZ - fl * (0.15 + (i >> 1) * 0.3)], [1, 0.5, 1]);
  if (kind.soft) {
    // slipper: a pompom / a curled toe tip
    b.sphere(fw * 0.14, tone(bootC, 1.35), [0, yFloor + H * 0.7, heelZ - fl * 0.98]);
  }
  if (kind.clog) {
    // carved clog: a band of darker wood across the instep and a pale carved rim
    b.loft([{ y: fl * 0.32, rx: fw * 0.52, rz: H * 0.46, cz: H * 0.52, color: tone(bootC, 0.7) }, { y: fl * 0.42, rx: fw * 0.5, rz: H * 0.5, cz: H * 0.5, color: tone(bootC, 0.7) }], bootC, [0, yFloor + 0.01, heelZ], [-Math.PI / 2, 0, 0], undefined, { capBottom: false, capTop: false });
  }
  void spec;
}
