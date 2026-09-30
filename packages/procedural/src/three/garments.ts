import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { PALETTE } from "@cb/shared";
import { curve } from "./sweep.ts";
import type { Ring } from "./loft.ts";
import { sstep } from "./patch.ts";
import { CREAM, LEATHER, PartBuilder, singe, type V3 } from "./parts.ts";
import { backZ, dyeAt, frontZ, legRadius, neckRadii, waistHalf, ringAt, ringSurface, soil, tone, type BodyCtx } from "./bodyKit.ts";

/**
 * Coats. Every jacket has its own silhouette (`JACKET_CUT`: how the torso is cut), its own collar, front and skirt. Fronts, lapels, waistcoat
 * V's and coat skirts are PATCHES of the body's own section surface (patch.ts), so they hug the figure by construction and their edges are smooth
 * curves; small hardware (buttons, pockets, epaulettes) sits on the same surface via `surf`.
 *
 * Jacket indices (catalog JACKETS): 0 shirt sleeves, 1 frock coat, 2 tunic, 3 waistcoat, 4 greatcoat, 5 hunting jacket, 6 cape, 7 poncho,
 * 8 smoking jacket, 9 naval reefer, 10 Norfolk jacket.
 */
export const JACKET = { SHIRT: 0, FROCK: 1, TUNIC: 2, WAISTCOAT: 3, GREATCOAT: 4, HUNTING: 5, CAPE: 6, PONCHO: 7, SMOKING: 8, NAVAL: 9, NORFOLK: 10 } as const;

/** Torso cut per jacket: multipliers on the waist, chest and shoulder sections, plus the section squareness. */
const JACKET_CUT: Record<number, { waist: number; chest: number; shoulder: number; pow: number }> = {
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

/** What the torso builder hands to the garment code. */
export interface TorsoView {
  b: PartBuilder;
  c: BodyCtx;
  rings: readonly Ring[];
  h: number;
  W: number;
  D: number;
  SH: number;
  neckY: number;
  /** Neck radii where the collar sits. */
  nrx: number;
  nrz: number;
  at(y: number): ReturnType<typeof ringAt>;
  /** Z of the front surface at height y and lateral offset x (negative = front). */
  surf(y: number, x?: number): number;
  surface: ReturnType<typeof ringSurface>;
  /** Colours */
  coat: number;
  facing: number;
  vest: number;
  shirt: number;
  trim: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The V-shaped opening of a coat front: half-angle (radians of azimuth) at height y, closing to a point at `close` and widest at the neck. */
function vHalf(v: TorsoView, close: number, top: number, y: number): number {
  const t = sstep(v.h * close, v.h * 0.97, y);
  return top * Math.pow(t, 0.85);
}

/** A surface strip along the front: between azimuth lo(y) and hi(y) (radians from the centre line) for y in [y0, y1]. */
function stripPatch(v: TorsoView, y0: number, y1: number, lo: (y: number) => number, hi: (y: number) => number, color: number | ((phi: number, y: number) => number), lift = 0.008, side: 1 | -1 | 0 = 0, nu = 10, nv = 12, uMax = 1.6): void {
  const sides: (1 | -1)[] = side === 0 ? [-1, 1] : [side];
  for (const sg of sides) {
    v.b.patch({
      at: (phi, y, l) => v.surface(phi, y, l),
      u0: sg > 0 ? 0 : -uMax,
      u1: sg > 0 ? uMax : 0,
      v0: y0,
      v1: y1,
      nu,
      nv,
      inside: (phi, y) => Math.min(Math.abs(phi) - lo(y), hi(y) - Math.abs(phi), (y - y0) * 4, (y1 - y) * 4),
      lift: () => lift,
      color,
    });
  }
}

/** A row of buttons down the front at azimuth column x (metres), heights ys. */
function buttons(v: TorsoView, ys: readonly number[], x: number, color: number, r = 0.021): void {
  for (const y of ys) v.b.button(r, color, [x, y, v.surf(y, x) - r * 0.2]);
}

/** A rolled edge along the V opening (a soft tube laid along the edge of a lapel or a shawl collar). */
function rollEdge(v: TorsoView, sign: 1 | -1, y0: number, y1: number, phiAt: (y: number) => number, color: number, size = 0.011, lift = 0.012): void {
  const pts: V3[] = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const y = y0 + ((y1 - y0) * i) / N;
    pts.push(v.surface(sign * phiAt(y), y, lift).p);
  }
  v.b.sweep(curve(pts, 9), () => ({ rx: size, rz: size * 0.9, pow: 2 }), color, { side: [1, 0, 0], segments: 5, round: "both" });
}

/** A patch pocket or flap on the torso surface. */
function pocket(v: TorsoView, x: number, y: number, w: number, hgt: number, color: number, flap = true): void {
  const z = v.surf(y, x) - 0.008;
  v.b.box(w, hgt, 0.02, color, [x, y, z]);
  if (flap) v.b.box(w * 1.06, hgt * 0.3, 0.026, tone(color, 0.86), [x, y + hgt * 0.36, z - 0.003]);
  v.b.sphere(0.011, v.c.accent, [x, y + hgt * 0.34, z - 0.017], [1, 1, 0.6]);
}

/** Collars: a band that hugs the neck (never smaller than the neck it sits on), plus the style's turn-down. */
function collar(v: TorsoView, kind: "stand" | "fall" | "shirt" | "high" | "shawl" | "cape", cloth = kind === "shirt" || kind === "high" ? singe(CREAM, v.c.burnt) : v.facing): void {
  const { b, nrx, nrz, neckY } = v;
  const bandTop = kind === "high" ? 0.075 : kind === "stand" ? 0.06 : 0.04;
  if (kind === "fall" || kind === "shawl" || kind === "cape") {
    // a turned-down collar: tight at the neck, flaring out onto the shoulders, the fold at the top
    const flare = kind === "cape" ? 1.62 : 1.5;
    b.loft(
      [
        { y: neckY + bandTop, rx: nrx * 1.17, rz: nrz * 1.17, color: tone(cloth, 1.06) },
        { y: neckY + bandTop - 0.006, rx: nrx * 1.22, rz: nrz * 1.22, color: cloth, crease: true },
        { y: neckY + 0.005, rx: nrx * (flare * 0.8), rz: nrz * (flare * 0.8), color: cloth },
        { y: neckY - 0.045, rx: nrx * flare, rz: nrz * flare * 0.98, color: tone(cloth, 0.86) },
      ],
      cloth,
      undefined,
      undefined,
      undefined,
      { capTop: false, capBottom: false },
    );
    return;
  }
  b.loft(
    [
      { y: neckY - 0.03, rx: nrx * 1.28, rz: nrz * 1.25, color: tone(cloth, 0.9) },
      { y: neckY + bandTop, rx: nrx * 1.2, rz: nrz * 1.17, crease: true, color: cloth },
    ],
    cloth,
    undefined,
    undefined,
    undefined,
    { capTop: false, capBottom: false },
  );
  // a dark seam where the collar meets the neck's skin
  b.loft(
    [
      { y: neckY + bandTop - 0.004, rx: nrx * 1.12, rz: nrz * 1.1, color: tone(cloth, 0.6) },
      { y: neckY + bandTop + 0.002, rx: nrx * 1.1, rz: nrz * 1.08, color: tone(cloth, 0.6) },
    ],
    cloth,
    undefined,
    undefined,
    undefined,
    { capTop: false, capBottom: false },
  );
}

/** Shirt collar points: two folded wings that lie on the chest either side of the throat. */
function collarPoints(v: TorsoView, wing: boolean): void {
  const cloth = singe(CREAM, v.c.burnt);
  for (const sx of [-1, 1]) {
    if (wing) {
      // stiff wing collar: the tips fold outward and up, either side of a small knot
      v.b.box(0.032, 0.05, 0.014, cloth, [sx * v.nrx * 0.62, v.neckY + 0.075, -v.nrz * 1.12], [0.1, sx * 0.5, sx * -0.25]);
    } else {
      v.b.box(0.062, 0.018, 0.088, cloth, [sx * v.nrx * 0.72, v.neckY - 0.022, -v.nrz * 1.0], [0.55, sx * 0.55, sx * 0.25]);
    }
  }
}

function frogging(v: TorsoView, color: number): void {
  // braided loops across the chest: three pairs of toggle bars either side of the closure
  for (let i = 0; i < 4; i++) {
    const y = v.h * (0.45 + i * 0.1);
    const len = v.W * (0.72 - i * 0.05);
    for (const sx of [-1, 1]) {
      const x0 = sx * 0.02;
      const x1 = sx * len;
      v.b.sweep(
        [
          [x0, y, v.surf(y, x0) - 0.012],
          [(x0 + x1) / 2, y + 0.006, v.surf(y, (x0 + x1) / 2) - 0.014],
          [x1, y, v.surf(y, x1) - 0.012],
        ],
        (t) => ({ rx: 0.009, rz: 0.008 + 0.002 * t, pow: 2 }),
        color,
        { side: [0, 1, 0], segments: 5, round: "both" },
      );
      v.b.sphere(0.014, color, [x1, y, v.surf(y, x1) - 0.012], [1, 0.8, 0.6]);
    }
  }
}

/** Everything a jacket adds to the torso: collar, front, lapels, buttons, pockets and trims. */
export function dressTorso(v: TorsoView): void {
  const { b, c, h, W } = v;
  const { spec } = c;
  const j = spec.jacket;
  const gold = c.accent;
  const trimGold = spec.coatTrim === 4 ? tone(PALETTE.trim.sashGold, 1) : gold;
  // ---- the neck: collar -------------------------------------------------------------------------------------------------------
  if (j === JACKET.SHIRT || j === JACKET.WAISTCOAT) {
    if (spec.shirt === 3) collar(v, "stand", singe(CREAM, c.burnt)); // (a collarless shirt: a plain band of shirt cloth)
    else {
      collar(v, spec.shirt === 4 ? "high" : "shirt");
      if (spec.shirt !== 5) collarPoints(v, spec.shirt === 4);
    }
  } else if (j === JACKET.TUNIC || j === JACKET.HUNTING || j === JACKET.NORFOLK || j === JACKET.NAVAL) collar(v, j === JACKET.NAVAL ? "fall" : "stand");
  else if (j === JACKET.FROCK || j === JACKET.GREATCOAT || j === JACKET.SMOKING) collar(v, "fall");
  else if (j === JACKET.CAPE || j === JACKET.PONCHO) collar(v, "stand");

  const vestC = v.vest;
  const shirtFront = singe(CREAM, c.burnt);
  const front = (close: number, top: number, shirtLine: number, lapelW: number, lapelC: number, peak = 0): void => {
    // the V: shirt above the shirt line, waistcoat below it
    stripPatch(v, h * (close - 0.02), h * 0.985, () => -0.001, (y) => vHalf(v, close, top, y), (_phi, y) => (y > h * shirtLine ? shirtFront : vestC), 0.005, 0, 12, 10);
    // lapels either side of the V, widest at the roll
    const lw = (y: number): number => lapelW * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, (y - h * close) / (h * 0.97 - h * close))) ** 0.8));
    stripPatch(v, h * (close - 0.02), h * 0.985, (y) => vHalf(v, close, top, y) - 0.01, (y) => vHalf(v, close, top, y) + lw(y) + (y > h * (close + 0.32) && y < h * (close + 0.42) ? peak : 0), lapelC, 0.012, 0, 12, 10);
    for (const sg of [-1, 1] as const) rollEdge(v, sg, h * close, h * 0.965, (y) => vHalf(v, close, top, y) + 0.005, tone(lapelC, 0.8));
  };

  switch (j) {
    case JACKET.FROCK: {
      front(0.44, 0.42, 0.7, 0.18, v.facing, 0.05);
      buttons(v, [0.32, 0.4].map((f) => h * f), 0, trimGold);
      // breast welt pocket and a pocket square
      b.box(0.075, 0.014, 0.014, tone(v.coat, 0.75), [-W * 0.55, h * 0.6, v.surf(h * 0.6, -W * 0.55) - 0.008], [0, 0, 0.12]);
      b.box(0.035, 0.03, 0.012, shirtFront, [-W * 0.55, h * 0.625, v.surf(h * 0.625, -W * 0.55) - 0.012], [0, 0, 0.12]);
      break;
    }
    case JACKET.WAISTCOAT: {
      // the waistcoat is the jacket colour and the front is a deep V of it; the shirt shows above, the sleeves are shirt
      stripPatch(v, h * 0.1, h * 0.93, () => -0.001, () => 3.2, (_phi, y) => (y > h * 0.79 ? v.vest : v.vest), 0.006, 0, 18, 10);
      stripPatch(v, h * 0.62, h * 0.985, () => -0.001, (y) => 0.55 * sstep(h * 0.62, h * 0.97, y), shirtFront, 0.012, 0, 8, 12);
      // the back of the waistcoat: the same cloth round the sides and over the back, a shade darker (a lining)
      stripPatch(v, h * 0.1, h * 0.92, () => 1.5, () => 3.4, tone(v.vest, 0.82), 0.006, 0, 20, 10, Math.PI);
      for (const sg of [-1, 1] as const) rollEdge(v, sg, h * 0.62, h * 0.93, (y) => 0.55 * sstep(h * 0.62, h * 0.97, y) + 0.01, tone(v.vest, 0.75), 0.008, 0.012);
      buttons(v, [0.2, 0.3, 0.4, 0.5].map((f) => h * f), 0, gold, 0.02);
      // welt pockets low on both sides
      for (const sx of [-1, 1]) b.box(0.075, 0.012, 0.012, tone(v.vest, 0.7), [sx * W * 0.55, h * 0.2, v.surf(h * 0.2, sx * W * 0.55) - 0.008], [0, 0, sx * -0.1]);
      break;
    }
    case JACKET.TUNIC: {
      // double-breasted, high-buttoned: a placket down the middle under two rows of brass buttons, piping at the collar
      b.box(0.034, h * 0.66, 0.018, tone(v.facing, 0.85), [0, h * 0.55, v.surf(h * 0.55) - 0.006]);
      for (const rx of [-1, 1]) buttons(v, [0.24, 0.36, 0.48, 0.6, 0.72].map((f) => h * f), rx * W * 0.22, gold);
      for (const sx of [-1, 1]) pocket(v, sx * W * 0.62, h * 0.3, 0.1, 0.09, tone(v.coat, 0.9), true);
      break;
    }
    case JACKET.GREATCOAT: {
      front(0.3, 0.55, 0.75, 0.25, v.facing, 0.05);
      for (const rx of [-1, 1]) buttons(v, [0.2, 0.36, 0.52, 0.68].map((f) => h * f), rx * W * 0.3, gold, 0.024);
      // a half-belt across the back
      b.box(W * 1.4, 0.05, 0.018, tone(v.coat, 0.8), [0, h * 0.24, backZ(v.at(h * 0.24), 0) + 0.006]);
      b.sphere(0.014, gold, [-W * 0.6, h * 0.24, backZ(v.at(h * 0.24), 0) + 0.014], [1, 1, 0.6]);
      b.sphere(0.014, gold, [W * 0.6, h * 0.24, backZ(v.at(h * 0.24), 0) + 0.014], [1, 1, 0.6]);
      break;
    }
    case JACKET.HUNTING: {
      b.box(0.034, h * 0.66, 0.018, tone(v.facing, 0.85), [0, h * 0.5, v.surf(h * 0.5) - 0.006]);
      buttons(v, [0.24, 0.36, 0.48, 0.6, 0.72].map((f) => h * f), 0, gold);
      for (const sx of [-1, 1]) {
        const x = sx * W * 0.62;
        b.box(0.11, 0.1, 0.03, tone(v.coat, 0.9), [x, h * 0.34, v.surf(h * 0.34, x) - 0.012]);
        b.box(0.11, 0.025, 0.034, v.facing, [x, h * 0.34 + 0.05, v.surf(h * 0.34, x) - 0.013]);
        b.sphere(0.011, gold, [x, h * 0.335 + 0.05, v.surf(h * 0.34, x) - 0.03], [1, 1, 0.6]);
      }
      break;
    }
    case JACKET.NORFOLK: {
      // box pleats: two raised vertical bands either side of the front, and a matching pair on the back
      for (const sx of [-1, 1]) for (const px of [0.36, 0.7]) {
        const x = sx * W * px;
        b.box(0.035, h * 0.62, 0.014, tone(v.coat, 1.06), [x, h * 0.5, v.surf(h * 0.5, x) - 0.005]);
      }
      buttons(v, [0.26, 0.38, 0.5, 0.62, 0.74].map((f) => h * f), 0, gold);
      for (const sx of [-1, 1]) pocket(v, sx * W * 0.56, h * 0.3, 0.09, 0.1, tone(v.coat, 0.92));
      break;
    }
    case JACKET.NAVAL: {
      // double-breasted, six brass buttons in two columns, peaked lapels, gold stripes on the sleeves (see sleeve code)
      front(0.24, 0.3, 0.8, 0.2, v.coat, 0.06);
      for (const rx of [-1, 1]) buttons(v, [0.32, 0.46, 0.6].map((f) => h * f), rx * W * 0.34, gold, 0.024);
      b.box(0.075, 0.014, 0.014, tone(v.coat, 0.7), [-W * 0.62, h * 0.66, v.surf(h * 0.66, -W * 0.62) - 0.008], [0, 0, 0.1]);
      break;
    }
    case JACKET.SMOKING: {
      // a rolled shawl collar in a contrast cloth running from the nape down both sides of the front to a tasselled cord at the waist
      const closeY = 0.32;
      stripPatch(v, h * (closeY - 0.02), h * 0.985, () => -0.001, (y) => vHalf(v, closeY, 0.5, y), shirtFront, 0.005, 0, 10, 9);
      stripPatch(v, h * (closeY - 0.02), h * 0.985, (y) => vHalf(v, closeY, 0.5, y) - 0.01, (y) => vHalf(v, closeY, 0.5, y) + 0.22 * Math.sin(Math.PI * Math.min(1, Math.max(0, (y - h * closeY) / (h * 0.65))) ** 0.7) + 0.06, v.facing, 0.012, 0, 12, 10);
      for (const sg of [-1, 1] as const) rollEdge(v, sg, h * closeY, h * 0.965, (y) => vHalf(v, closeY, 0.5, y) + 0.22 * Math.sin(Math.PI * Math.min(1, Math.max(0, (y - h * closeY) / (h * 0.65))) ** 0.7) + 0.05, tone(v.facing, 1.12), 0.012, 0.014);
      // the cord and its tassels
      const y = h * 0.18;
      const s = v.at(y);
      b.loft([{ y: y - 0.012, rx: s.rx * 1.03, rz: s.rz * 1.03, cx: s.cx, cz: s.cz, pow: s.pow, color: v.trim }, { y: y + 0.012, rx: s.rx * 1.03, rz: s.rz * 1.03, cx: s.cx, cz: s.cz, pow: s.pow, color: v.trim, crease: true }], v.trim, undefined, undefined, undefined, { capBottom: false, capTop: false });
      for (const sx of [-1, 1]) {
        const p: V3 = [sx * s.rx * 0.5, y, v.surf(y, sx * s.rx * 0.5) - 0.02];
        b.sweep([p, [p[0] + sx * 0.02, p[1] - 0.09, p[2] - 0.02], [p[0] + sx * 0.03, p[1] - 0.18, p[2] - 0.02]], (t) => ({ rx: 0.008, rz: 0.008, pow: 2, color: t > 0.85 ? tone(v.trim, 1.2) : v.trim }), v.trim, { side: [1, 0, 0], segments: 4, round: "both" });
        b.sphere(0.02, v.trim, [p[0] + sx * 0.03, p[1] - 0.2, p[2] - 0.02], [1, 1.5, 1]);
      }
      break;
    }
    case JACKET.CAPE:
      break;
    case JACKET.SHIRT: {
      // shirt fronts
      if (spec.shirt === 6) {
        b.box(0.036, h * 0.62, 0.012, tone(shirtFront, 0.92), [0, h * 0.62, v.surf(h * 0.62) - 0.005]);
        buttons(v, [0.42, 0.54, 0.66, 0.78, 0.9].map((f) => h * f), 0, tone(CREAM, 0.7), 0.014);
        pocket(v, -W * 0.5, h * 0.66, 0.085, 0.09, tone(c.shirtC, 0.92), true);
      } else if (spec.shirt === 5) {
        // ruffled jabot: a cascade of frills down the chest
        for (let i = 0; i < 5; i++) {
          const y = h * (0.9 - i * 0.085);
          const w = 0.05 + 0.015 * (4 - i);
          for (const sx of [-1, 1]) b.box(w, 0.036, 0.022, i % 2 ? tone(shirtFront, 0.94) : shirtFront, [sx * w * 0.42, y, v.surf(y, sx * w * 0.4) - 0.014], [0.1, 0, sx * 0.22]);
        }
      } else buttons(v, [0.5, 0.64, 0.78].map((f) => h * f), 0, tone(CREAM, 0.7), 0.014);
      break;
    }
    default:
      break;
  }

  // ---- coat trims (option): frogging, braid piping ------------------------------------------------------------------------------------
  if (spec.coatTrim === 1 && j !== JACKET.SHIRT && j !== JACKET.WAISTCOAT && j !== JACKET.CAPE && j !== JACKET.PONCHO) frogging(v, singe(PALETTE.trim.cummerbund, c.burnt));
  if (spec.coatTrim === 4 && j !== JACKET.SHIRT && j !== JACKET.CAPE && j !== JACKET.PONCHO) {
    // gold braid down both edges of the opening
    for (const sg of [-1, 1] as const) rollEdge(v, sg, h * 0.14, h * 0.96, (y) => (j === JACKET.FROCK ? vHalf(v, 0.44, 0.42, y) : j === JACKET.GREATCOAT ? vHalf(v, 0.3, 0.55, y) : 0.06) + 0.04, trimGold, 0.008, 0.016);
  }
  if (spec.coatTrim === 3 && j !== JACKET.SHIRT && j !== JACKET.CAPE && j !== JACKET.PONCHO) {
    // fur trim: a shaggy pelt round the collar and down the front
    const fur = singe(PALETTE.material.fur, c.burnt);
    v.b.loft(
      [
        { y: v.neckY + 0.045, rx: v.nrx * 1.28, rz: v.nrz * 1.28, color: tone(fur, 1.05) },
        { y: v.neckY + 0.0, rx: v.nrx * 1.7, rz: v.nrz * 1.7, pow: 2.4, color: fur },
        { y: v.neckY - 0.05, rx: v.nrx * 1.72, rz: v.nrz * 1.72, pow: 2.4, color: tone(fur, 0.8) },
      ],
      fur,
      undefined,
      undefined,
      undefined,
      { capTop: false, capBottom: false },
    );
  }

  // ---- shirt patterns (stripes, checks) on the shirt an open jacket shows ---------------------------------------------------------------------
  if ((j === JACKET.SHIRT || j === JACKET.WAISTCOAT) && (spec.shirt === 1 || spec.shirt === 2)) {
    const stripe = singe(PALETTE.trim.shirtStripe, c.burnt);
    const y0 = j === JACKET.WAISTCOAT ? 0.8 : 0.3;
    for (let y = y0; y < 0.94; y += 0.07) {
      const s = v.at(h * y);
      b.loft(
        [
          { y: h * y - 0.007, rx: s.rx * 1.004, rz: s.rz * 1.004, cx: s.cx, cz: s.cz, pow: s.pow, color: stripe },
          { y: h * y + 0.007, rx: s.rx * 1.004, rz: s.rz * 1.004, cx: s.cx, cz: s.cz, pow: s.pow, color: stripe, crease: true },
        ],
        stripe,
        undefined,
        undefined,
        undefined,
        { capBottom: false, capTop: false },
      );
    }
    if (spec.shirt === 2) for (let x = -2; x <= 2; x++) b.box(0.012, h * 0.5, 0.008, stripe, [x * W * 0.3, h * 0.62, v.surf(h * 0.62, x * W * 0.3) - 0.003]);
  }
  void lerp;
  void LEATHER;
  void frontZ;
}

// ---- coat skirts (pelvis bone) -------------------------------------------------------------------------------------------------------------

/** Pelvis-frame sections of a coat skirt hanging from the waist to `len` below it. */
function skirtRings(c: BodyCtx, len: number, flare: number, color: number, hemC: number): Ring[] {
  const { P } = c;
  const W = P.torsoWidth / 2;
  const D = P.torsoDepth / 2;
  const cz = -P.bellyForward * 0.2;
  const top = 0.03 * P.scale;
  // The coat must clear the thighs in depth as well as width (a slim torso over stout legs).
  const rz = Math.max(D * 0.86 + P.bellyForward * 0.2, legRadius(c) * 1.5);
  // The coat must clear the thighs it hangs over: the legs stand wider apart than the waist.
  const hip = Math.max(W * 0.96, P.hipWidth + legRadius(c) * 1.95);
  const wTop = Math.max(W * 0.96, waistHalf(P) * 1.02);
  return [
    { y: top, rx: wTop, rz, cz, pow: 2.6, color: tone(color, 0.92) },
    { y: top - 0.025, rx: hip * 0.98, rz: rz * 1.04, cz, pow: 2.6, color: tone(color, 0.96) },
    { y: -len * 0.18, rx: hip, rz: rz * 1.05, cz, pow: 2.6, color },
    { y: -len * 0.5, rx: lerp(hip, hip * flare, 0.5), rz: rz * (1 + (flare - 1) * 0.5) * 1.05, cz, pow: 2.6, color },
    { y: -len, rx: hip * flare, rz: rz * flare * 1.05, cz, pow: 2.6, color: tone(color, 0.88) },
    { y: -len - 0.001, rx: hip * flare, rz: rz * flare * 1.05, cz, pow: 2.6, color: hemC },
    { y: -len - 0.03, rx: hip * flare, rz: rz * flare * 1.05, cz, pow: 2.6, color: hemC },
  ];
}

/** How far below the waist a closed coat skirt hangs (0 = none, or open in front so the legs must show). */
export function closedSkirtLength(spec: CharacterSpec, P: Proportions): number {
  switch (spec.jacket) {
    case JACKET.TUNIC:
      return P.legUpper * 0.5;
    case JACKET.HUNTING:
      return P.legUpper * 0.36;
    case JACKET.NAVAL:
      return P.legUpper * 0.42;
    case JACKET.NORFOLK:
      return P.legUpper * 0.5;
    case JACKET.SMOKING:
      return P.legUpper * 0.62;
    default:
      return 0;
  }
}

/** The coat skirt for the spec's jacket, on the pelvis bone. */
export function dressSkirts(b: PartBuilder, c: BodyCtx): void {
  const { spec, P } = c;
  const j = spec.jacket;
  const coat = c.jacketC;
  const hemC = soil(tone(coat, 0.7), 0.22);
  const sc = P.scale;
  // the lining: a contrast silk, seen from below, through the vent and along every free edge
  const lining = tone(singe(dyeAt(PALETTE.cloth, spec.jacketColor + 4), c.burnt), 0.9);
  const closed = (len: number, flare: number): void => {
    const rings = skirtRings(c, len, flare, coat, hemC);
    if (PartBuilder.lod > 0) {
      b.loft(rings, coat, undefined, undefined, undefined, { capTop: false });
      return;
    }
    // Open at the hem, not capped: the outer cloth rolls under into a thick edge, and inside is the lining (its faces point in), so from below a skirt is a
    // hollow bell of silk, not a flat black disc.
    const hem = rings[rings.length - 1]!;
    const roll = rings.slice(0, -2);
    const last = roll[roll.length - 1]!;
    roll.push(
      { ...last, y: -len - 0.006, rx: last.rx * 1.012, rz: last.rz * 1.012, color: hemC },
      { ...last, y: -len - 0.022, rx: last.rx * 1.008, rz: last.rz * 1.008, color: hemC },
      { ...hem, y: -len - 0.03, rx: hem.rx * 0.992, rz: hem.rz * 0.992, color: hemC },
    );
    b.loft(roll, coat, undefined, undefined, undefined, { capTop: false, capBottom: false });
    const inner = (k: number, y: number, col: number): Ring => {
      const s = ringAt(rings, y);
      return { y, rx: s.rx * k, rz: s.rz * k, cx: s.cx, cz: s.cz, pow: s.pow, color: col };
    };
    b.loft([inner(0.97, -len - 0.028, tone(lining, 0.85)), inner(0.965, -len * 0.7, lining), inner(0.965, -len * 0.3, tone(lining, 0.9)), inner(0.96, 0.01, tone(lining, 0.8))], lining, undefined, undefined, undefined, { capTop: false, capBottom: false, inward: true });
  };
  const cut = (len: number, flare: number, frontCut: (y: number) => number, vent: (y: number) => number): void => {
    const rings = skirtRings(c, len, flare, coat, hemC);
    const surface = ringSurface(rings);
    const top = 0.03 * sc;
    b.patch(
      {
        at: (phi, y, lift) => surface(phi, y, lift),
        u0: -Math.PI,
        u1: Math.PI,
        v0: -len - 0.03,
        v1: top,
        nu: 30,
        nv: 6,
        inside: (phi, y) => {
          const a = Math.abs(phi);
          return Math.min(a - frontCut(y), Math.PI - a - vent(y));
        },
        lift: () => 0.0,
        color: (_phi, y) => (y < -len ? hemC : lerpColor(tone(coat, 0.94), tone(coat, 0.88), sstep(top, -len, y))),
        // a two-layer skirt: the lining shows from below and through the vent, and every free edge has a rolled rim (LOD0 only)
        thick: 0.008,
        lining,
        rim: (_phi, y) => y < top - 0.02,
      },
      true,
    );
  };
  if (j === JACKET.FROCK) {
    // a frock coat: closed to the waist, then the fronts sweep back to the sides and two long tails hang behind, split by a centre vent
    const len = P.legUpper * 1.0;
    cut(len, 1.12, (y) => 0.05 + 1.15 * sstep(0.03 * sc, -len * 0.8, y), (y) => 0.03 + 0.12 * sstep(0.03 * sc, -len, y));
  } else if (j === JACKET.TUNIC) closed(closedSkirtLength(spec, P), 1.12);
  else if (j === JACKET.HUNTING) closed(closedSkirtLength(spec, P), 1.05);
  else if (j === JACKET.GREATCOAT) {
    const len = P.legUpper * 1.4;
    cut(len, 1.32, (y) => 0.02 + 0.5 * sstep(-len * 0.35, -len, y), (y) => 0.02 + 0.2 * sstep(-len * 0.3, -len, y));
  } else if (j === JACKET.NAVAL) closed(closedSkirtLength(spec, P), 1.06);
  else if (j === JACKET.NORFOLK) closed(closedSkirtLength(spec, P), 1.08);
  else if (j === JACKET.SMOKING) closed(closedSkirtLength(spec, P), 1.1);
}

const lerpColor = (a: number, b: number, t: number): number => {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
};
export { lerpColor };
