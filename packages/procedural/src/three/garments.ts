import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { PALETTE } from "@cb/shared";
import { curve } from "./sweep.ts";
import type { Ring } from "./loft.ts";
import { sstep } from "./patch.ts";
import { CREAM, LEATHER, PartBuilder, singe, type V3 } from "./parts.ts";
import { JACKET_CUT, torsoRings } from "./fit/torsoShape.ts";
import { skirtRings as skirtShapeRings } from "./fit/skirtShape.ts";
import { collarKind, collarSections, neckOuter, type CollarKind } from "./fit/collarShape.ts";
import { dressNativeJacket } from "./nativeJackets.ts";
import { patchSurface, polySurface, type Surf } from "./fit/surface.ts";
import { bandAround, buttonOn, frameAt, hangingStrip } from "./fit/torsoKit.ts";
import { backZ, dyeAt, frontZ, legRadius, neckRadii, waistHalf, ringAt, ringSurface, soil, tone, type BodyCtx } from "./bodyKit.ts";

/**
 * Coats. Every jacket has its own silhouette (`JACKET_CUT`: how the torso is cut), its own collar, front and skirt. Fronts, lapels, waistcoat
 * V's and coat skirts are PATCHES of the body's own section surface (patch.ts), so they hug the figure by construction and their edges are smooth
 * curves; small hardware (buttons, pockets, epaulettes) sits on the same surface via `surf`.
 *
 * Jacket indices (catalog JACKETS): 0 shirt sleeves, 1 frock coat, 2 tunic, 3 waistcoat, 4 greatcoat, 5 hunting jacket, 6 cape, 7 poncho,
 * 8 smoking jacket, 9 naval reefer, 10 Norfolk jacket.
 */
export const JACKET = { SHIRT: 0, FROCK: 1, TUNIC: 2, WAISTCOAT: 3, GREATCOAT: 4, HUNTING: 5, CAPE: 6, PONCHO: 7, SMOKING: 8, NAVAL: 9, NORFOLK: 10, STONE_SMOCK: 11, LAMP_ROBE: 12, HERD_CLOAK: 13, CREPE_SHAWL: 14, WADING_SMOCK: 15, COURT_CLOAK: 16 } as const;

// The torso's cut and sections live in fit/torsoShape.ts (the one definition the body field and every wearable read); re-exported here for the callers that import them from garments.
export { JACKET_CUT, torsoRings };

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
  /** Z of the front surface at height y and lateral offset x (negative = front), on the polygon the torso is drawn as. */
  surf(y: number, x?: number): number;
  /** The trunk as drawn (polygon faces): hard pieces and strips are placed through it. */
  s: Surf;
  /** Surface for masked patches: positions on the drawn polygon, smooth normals (patchSurface). */
  surface: ReturnType<typeof patchSurface>;
  /** Cloth laid on the trunk so far (fronts, facings): where it is and how proud, so straps and hard pieces can clear it (`layerAt`). Filled by dressTorso. */
  layers: { inside(phi: number, y: number): number; lift: number }[];
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
export function stripPatch(v: TorsoView, y0: number, y1: number, lo: (y: number) => number, hi: (y: number) => number, color: number | ((phi: number, y: number) => number), lift = 0.008, side: 1 | -1 | 0 = 0, nu = 10, nv = 12, uMax = 1.6): void {
  const sides: (1 | -1)[] = side === 0 ? [-1, 1] : [side];
  v.layers.push({ inside: (phi, y) => Math.min(Math.abs(phi) - lo(y), hi(y) - Math.abs(phi), (y - y0) * 4, (y1 - y) * 4), lift });
  for (const sg of sides) {
    v.b.patch({
      at: (phi, y, l) => v.surface(phi, y, l),
      u0: sg > 0 ? 0 : -uMax,
      u1: sg > 0 ? uMax : 0,
      v0: y0,
      v1: y1,
      nu: Math.ceil(nu * 0.75),
      nv: Math.ceil(nv * 0.75),
      inside: (phi, y) => Math.min(Math.abs(phi) - lo(y), hi(y) - Math.abs(phi), (y - y0) * 4, (y1 - y) * 4),
      lift: () => lift,
      color,
    });
  }
}

/** A row of buttons down the front at azimuth column x (metres), heights ys. */
export function buttons(v: TorsoView, ys: readonly number[], x: number, color: number, r = 0.021): void {
  for (const y of ys) buttonOn(v.b, v.s, x, y, r, color, layerAtX(v, x, y));
}

/** How proud the cloth already laid on the trunk is at lateral offset x, height y (a button on a lapel stands on it). */
export function layerAtX(v: Pick<TorsoView, "s" | "layers">, x: number, y: number): number {
  const phi = v.s.atX(x, y, 0).phi;
  let lift = 0;
  for (const l of v.layers) if (l.inside(phi, y) > 0) lift = Math.max(lift, l.lift);
  return lift;
}

/** A rolled edge along the V opening (a soft tube laid along the edge of a lapel or a shawl collar). */
function rollEdge(v: TorsoView, sign: 1 | -1, y0: number, y1: number, phiAt: (y: number) => number, color: number, size = 0.011, lift = 0.012): void {
  const pts: V3[] = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const y = y0 + ((y1 - y0) * i) / N;
    pts.push(v.surface(sign * phiAt(y), y, lift).p);
  }
  v.b.sweep(curve(pts, 8), () => ({ rx: size, rz: size * 0.9, pow: 2 }), color, { side: [1, 0, 0], segments: 4, round: "both", coarseDome: true });
}

/** A patch pocket or flap on the torso surface. */
export function pocket(v: TorsoView, x: number, y: number, w: number, hgt: number, color: number, flap = true): void {
  const fr = frameAt(v.s.atX(x, y, 0));
  const o = layerAtX(v, x, y);
  v.b.box(w, hgt, 0.02, color, fr.at(0, 0, o + 0.01), fr.rot);
  if (flap) v.b.box(w * 1.06, hgt * 0.3, 0.026, tone(color, 0.86), fr.at(0, hgt * 0.36, o + 0.013), fr.rot);
  v.b.sphere(0.011, v.c.accent, fr.at(0, hgt * 0.34, o + 0.026), [1, 1, 0.6], fr.rot);
}

/** A small flat piece on the front of the trunk (a welt, a handkerchief, a plate): centred at lateral x, height y; `roll` turns it in the surface. */
export function tab(v: TorsoView, x: number, y: number, w: number, hgt: number, d: number, color: number, o: { out?: number; roll?: number } = {}): void {
  const fr = frameAt(v.s.atX(x, y, 0));
  v.b.box(w, hgt, d, color, fr.at(0, 0, layerAtX(v, x, y) + (o.out ?? 0) + d / 2), [fr.rot[0], fr.rot[1], fr.rot[2] + (o.roll ?? 0)]);
}

/** A placket (a buttoned strip of facing) down the centre front between two heights: a strip laid on the surface, so it follows the belly and the chest. */
export function placket(v: TorsoView, y0: number, y1: number, color: number): void {
  hangingStrip(v.b, v.s, 0, y1, y0, 0.017, 0.0075, color, { base: layerAtX(v, 0, (y0 + y1) / 2), round: undefined });
}

/** A raised box pleat down the front at lateral x. */
function pleat(v: TorsoView, x: number, y0: number, y1: number, color: number): void {
  hangingStrip(v.b, v.s, x, y1, y0, 0.0175, 0.0055, color, { base: layerAtX(v, x, (y0 + y1) / 2), round: undefined });
}

/** A half-belt across the back (a strip round the back of the coat between azimuths). */
export function bandBack(v: TorsoView, y: number, halfH: number, halfWidth: number, color: number): void {
  const pts = [-1, -0.5, 0, 0.5, 1].map((k) => v.s.atX(k * halfWidth, y, 0.008, true).p);
  v.b.sweep(pts, () => ({ rx: halfH, rz: 0.008, pow: 3 }), color, { side: [0, 1, 0], segments: 4, round: "both" });
}

/** Collars: a band that hugs the neck (never smaller than the neck it sits on), plus the style's turn-down. Sizes come from fit/collarShape.ts (neckwear wraps the same sections). */
export function collar(v: TorsoView, kind: CollarKind, cloth = kind === "shirt" || kind === "high" ? singe(CREAM, v.c.burnt) : v.facing): void {
  const { b, nrx, nrz, neckY } = v;
  const sec = collarSections(kind, nrx, nrz, neckY);
  const noCaps = { capTop: false, capBottom: false };
  // (a collar's foot is buried in the shoulder slope by design)
  PartBuilder.anchored = true;
  try {
    collarBody(v, kind, cloth, sec, noCaps);
  } finally {
    PartBuilder.anchored = false;
  }
}

function collarBody(v: TorsoView, kind: CollarKind, cloth: number, sec: ReturnType<typeof collarSections>, noCaps: { capTop: boolean; capBottom: boolean }): void {
  const { b, nrx, nrz } = v;
  if (kind === "fall" || kind === "shawl" || kind === "cape") {
    // a turned-down collar: tight at the neck, flaring out onto the shoulders, the fold at the top
    const shade = [1.06, 1, 1, 0.86];
    b.loft(sec.map((r, i) => ({ ...r, color: tone(cloth, shade[i]!) })), cloth, undefined, undefined, undefined, noCaps);
    return;
  }
  b.loft([{ ...sec[0]!, color: tone(cloth, 0.9) }, { ...sec[1]!, color: cloth }], cloth, undefined, undefined, undefined, noCaps);
  if (PartBuilder.lod >= 1) return;
  // a dark seam where the collar meets the neck's skin
  const top = sec[1]!;
  b.loft(
    [
      { y: top.y - 0.004, rx: nrx * 1.12, rz: nrz * 1.1, color: tone(cloth, 0.6) },
      { y: top.y + 0.002, rx: nrx * 1.1, rz: nrz * 1.08, color: tone(cloth, 0.6) },
    ],
    cloth,
    undefined,
    undefined,
    undefined,
    noCaps,
  );
}

/** Shirt collar points: two folded wings that lie on the chest either side of the throat. */
function collarPoints(v: TorsoView, wing: boolean): void {
  const cloth = singe(CREAM, v.c.burnt);
  const outer = neckOuter(v.c.P, v.c.spec, 0);
  for (const sx of [-1, 1]) {
    if (wing) {
      // stiff wing collar: the tips fold outward and up, either side of a small knot; they stand on the collar band
      const y = v.neckY + 0.075;
      v.b.box(0.032, 0.05, 0.014, cloth, [sx * v.nrx * 0.62, y, -outer(y).rz - 0.006], [0.1, sx * 0.5, sx * -0.25]);
    } else {
      // shirt points: folded down onto the chest either side of the throat, lying on the collar band and the torso top
      const y = v.neckY - 0.03;
      const sp = v.s.atX(sx * v.nrx * 0.85, y - 0.02, 0);
      const z = Math.min(sp.p[2], -outer(y).rz) - 0.03;
      v.b.box(0.062, 0.018, 0.088, cloth, [sx * v.nrx * 0.85, y - 0.005, z + 0.004], [0.55, sx * 0.55, sx * 0.25]);
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
      const lift = layerAtX(v, (x0 + x1) / 2, y) + 0.009;
      v.b.sweep(
        [v.s.atX(x0, y, lift).p, v.s.atX((x0 + x1) / 2, y + 0.006, lift + 0.002).p, v.s.atX(x1, y, lift).p],
        (t) => ({ rx: 0.009, rz: 0.008 + 0.002 * t, pow: 2 }),
        color,
        { side: [0, 1, 0], segments: 5, round: "both" },
      );
      v.b.sphere(0.014, color, v.s.atX(x1, y, lift).p, [1, 0.8, 0.6]);
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
  else if (j >= JACKET.STONE_SMOCK) dressNativeJacket(v, j); // (the fictional peoples' garments: their own collars, fronts and mantles: nativeJackets.ts)

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
      tab(v, -W * 0.55, h * 0.6, 0.075, 0.014, 0.014, tone(v.coat, 0.75), { roll: 0.12 });
      tab(v, -W * 0.55, h * 0.625, 0.035, 0.03, 0.012, shirtFront, { roll: 0.12, out: 0.004 });
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
      for (const sx of [-1, 1]) tab(v, sx * W * 0.55, h * 0.2, 0.075, 0.012, 0.012, tone(v.vest, 0.7), { roll: sx * -0.1 });
      break;
    }
    case JACKET.TUNIC: {
      // double-breasted, high-buttoned: a placket down the middle under two rows of brass buttons, piping at the collar
      placket(v, h * 0.26, h * 0.88, tone(v.facing, 0.85));
      for (const rx of [-1, 1]) buttons(v, [0.24, 0.36, 0.48, 0.6, 0.72].map((f) => h * f), rx * W * 0.22, gold);
      for (const sx of [-1, 1]) pocket(v, sx * W * 0.62, h * 0.3, 0.1, 0.09, tone(v.coat, 0.9), true);
      break;
    }
    case JACKET.GREATCOAT: {
      front(0.3, 0.55, 0.75, 0.25, v.facing, 0.05);
      for (const rx of [-1, 1]) buttons(v, [0.2, 0.36, 0.52, 0.68].map((f) => h * f), rx * W * 0.3, gold, 0.024);
      // a half-belt across the back
      bandBack(v, h * 0.24, 0.025, v.at(h * 0.24).rx * 0.7, tone(v.coat, 0.8));
      for (const sx of [-1, 1]) {
        const fr = frameAt(v.s.atX(sx * v.at(h * 0.24).rx * 0.62, h * 0.24, 0, true));
        b.sphere(0.014, gold, fr.at(0, 0, 0.02), [1, 1, 0.6], fr.rot);
      }
      break;
    }
    case JACKET.HUNTING: {
      placket(v, h * 0.26, h * 0.83, tone(v.facing, 0.85));
      buttons(v, [0.24, 0.36, 0.48, 0.6, 0.72].map((f) => h * f), 0, gold);
      for (const sx of [-1, 1]) {
        const x = sx * W * 0.62;
        const fr = frameAt(v.s.atX(x, h * 0.34, 0));
        const o = layerAtX(v, x, h * 0.34);
        b.box(0.11, 0.1, 0.03, tone(v.coat, 0.9), fr.at(0, 0, o + 0.015), fr.rot);
        b.box(0.11, 0.025, 0.034, v.facing, fr.at(0, 0.05, o + 0.017), fr.rot);
        b.sphere(0.011, gold, fr.at(0, 0.045, o + 0.034), [1, 1, 0.6], fr.rot);
      }
      break;
    }
    case JACKET.NORFOLK: {
      // box pleats: two raised vertical bands either side of the front, and a matching pair on the back
      for (const sx of [-1, 1]) for (const px of [0.36, 0.7]) {
        const x = sx * W * px;
        pleat(v, x, h * 0.26, h * 0.81, tone(v.coat, 1.06));
      }
      buttons(v, [0.26, 0.38, 0.5, 0.62, 0.74].map((f) => h * f), 0, gold);
      for (const sx of [-1, 1]) pocket(v, sx * W * 0.56, h * 0.3, 0.09, 0.1, tone(v.coat, 0.92));
      break;
    }
    case JACKET.NAVAL: {
      // double-breasted, six brass buttons in two columns, peaked lapels, gold stripes on the sleeves (see sleeve code)
      front(0.24, 0.3, 0.8, 0.2, v.coat, 0.06);
      for (const rx of [-1, 1]) buttons(v, [0.32, 0.46, 0.6].map((f) => h * f), rx * W * 0.34, gold, 0.024);
      tab(v, -W * 0.62, h * 0.66, 0.075, 0.014, 0.014, tone(v.coat, 0.7), { roll: 0.1 });
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
      bandAround(b, v.s, y - 0.012, y + 0.012, v.trim, { lift: 0.01, steps: 0, crease: true });
      for (const sx of [-1, 1]) {
        const p: V3 = v.s.atX(sx * s.rx * 0.5, y, 0.018).p;
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
        placket(v, h * 0.31, h * 0.93, tone(shirtFront, 0.92));
        buttons(v, [0.42, 0.54, 0.66, 0.78, 0.9].map((f) => h * f), 0, tone(CREAM, 0.7), 0.014);
        pocket(v, -W * 0.5, h * 0.66, 0.085, 0.09, tone(c.shirtC, 0.92), true);
      } else if (spec.shirt === 5) {
        // ruffled jabot: a cascade of frills down the chest
        for (let i = 0; i < 5; i++) {
          const y = h * (0.9 - i * 0.085);
          const w = 0.05 + 0.015 * (4 - i);
          for (const sx of [-1, 1]) tab(v, sx * w * 0.42, y, w, 0.036, 0.022, i % 2 ? tone(shirtFront, 0.94) : shirtFront, { roll: sx * 0.22 });
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
    const nkr = neckOuter(c.P, spec, 0);
    v.b.loft(
      [
        { y: v.neckY + 0.045, rx: nkr(v.neckY + 0.045).rx + 0.015, rz: nkr(v.neckY + 0.045).rz + 0.015, color: tone(fur, 1.05) },
        { y: v.neckY + 0.0, rx: nkr(v.neckY).rx + 0.04, rz: nkr(v.neckY).rz + 0.04, pow: 2.4, color: fur },
        { y: v.neckY - 0.05, rx: nkr(v.neckY - 0.05).rx + 0.04, rz: nkr(v.neckY - 0.05).rz + 0.04, pow: 2.4, color: tone(fur, 0.8) },
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
    for (let y = y0; y < 0.94; y += 0.07) bandAround(b, v.s, h * y - 0.007, h * y + 0.007, stripe, { lift: 0.003, steps: 0, edges: false, crease: true });
    if (spec.shirt === 2) for (let x = -2; x <= 2; x++) hangingStrip(b, v.s, x * W * 0.3, h * 0.87, h * 0.37, 0.006, 0.0025, stripe, { round: undefined });
  }
  void lerp;
  void LEATHER;
  void frontZ;
}

// ---- coat skirts (pelvis bone) -------------------------------------------------------------------------------------------------------------

/**
 * Pelvis-frame sections of a coat skirt hanging from the waist to `len` below it: derived from the body's own torso, hips and thighs (fit/skirtShape.ts).
 * `legRings` are the trouser thigh rings (`upperLegRings(c)`); the callers that cannot import limbs pass none and get a thigh estimated from the leg radius.
 */
export function skirtRings(c: BodyCtx, len: number, flare: number, color: number, hemC: number, legRings?: readonly Ring[], open = false): Ring[] {
  return skirtShapeRings(c, { len, flare, color, hemC, legRings, open });
}

/**
 * D-065: the native wrap (TROUSERS "Wrap Skirt"): a closed cloth from the waist to the knee. Under a closed coat skirt it lengthens that skirt (one surface, never two crossing);
 * under a coat open at the front (a robe, a cloak) the robe stands as it is and the legs below are its leggings; with no skirt at all it is a skirt of its own, in the trouser cloth.
 */
const WRAP_LEN = 1.08;
/** The first of the peoples' own garments (spec.ts NATIVE_FROM.jacket; not imported: spec.ts is upstream of the geometry and this keeps the dependency one way). */
const NATIVE_JACKET_FROM = 11;
const isWrap = (spec: CharacterSpec): boolean => spec.trousers === 7; // (limbRings.ts TR.WRAP: limbRings imports this file, so not imported back)

/** How far below the waist a closed coat skirt hangs (0 = none, or open in front so the legs must show). The native wrap counts (D-065). */
export function closedSkirtLength(spec: CharacterSpec, P: Proportions): number {
  const coat = coatClosedLength(spec, P);
  const sk = coatSkirtSpec(spec, P);
  if (!isWrap(spec) || (sk?.open && sk.len > P.legUpper * WRAP_LEN)) return coat;
  return Math.max(coat, P.legUpper * WRAP_LEN);
}

function coatClosedLength(spec: CharacterSpec, P: Proportions): number {
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
    case JACKET.STONE_SMOCK:
      return P.legUpper * 0.42;
    case JACKET.WADING_SMOCK:
      return P.legUpper * 0.34;
    default:
      return 0;
  }
}

/** The skirt of the spec's jacket: how far it hangs below the waist, how much it flares at the hem, and whether it is cut open at the front (frock coat, greatcoat). */
export function skirtSpec(spec: CharacterSpec, P: Proportions): { len: number; flare: number; open: boolean; wrap?: boolean } | undefined {
  const coat = coatSkirtSpec(spec, P);
  if (!isWrap(spec) || (coat?.open && coat.len > P.legUpper * WRAP_LEN)) return coat; // (a long robe stays open in front, or it is walked through: the legs below are its leggings)
  if (coat) return { len: Math.max(coat.len, P.legUpper * WRAP_LEN), flare: Math.max(coat.flare, 1.1), open: false };
  return { len: P.legUpper * WRAP_LEN, flare: 1.1, open: false, wrap: true };
}

function coatSkirtSpec(spec: CharacterSpec, P: Proportions): { len: number; flare: number; open: boolean } | undefined {
  switch (spec.jacket) {
    case JACKET.FROCK:
      return { len: P.legUpper * 1.0, flare: 1.12, open: true };
    case JACKET.GREATCOAT:
      return { len: P.legUpper * 1.4, flare: 1.32, open: true };
    case JACKET.TUNIC:
      return { len: coatClosedLength(spec, P), flare: 1.12, open: false };
    case JACKET.HUNTING:
      return { len: coatClosedLength(spec, P), flare: 1.05, open: false };
    case JACKET.NAVAL:
      return { len: coatClosedLength(spec, P), flare: 1.06, open: false };
    case JACKET.NORFOLK:
      return { len: coatClosedLength(spec, P), flare: 1.08, open: false };
    case JACKET.SMOKING:
      return { len: coatClosedLength(spec, P), flare: 1.1, open: false };
    case JACKET.STONE_SMOCK:
      return { len: coatClosedLength(spec, P), flare: 1.1, open: false };
    case JACKET.WADING_SMOCK:
      return { len: coatClosedLength(spec, P), flare: 1.06, open: false };
    case JACKET.LAMP_ROBE: // ankle-length and split at the front (a closed bell would be walked through)
      return { len: P.legUpper * 1.2, flare: 1.1, open: true };
    case JACKET.HERD_CLOAK:
      return { len: P.legUpper * 1.0, flare: 1.2, open: true };
    case JACKET.COURT_CLOAK:
      return { len: P.legUpper * 1.4, flare: 1.32, open: true };
    default:
      return undefined;
  }
}

/** Waves of folds round a skirt. */
const SKIRT_FOLDS = 7;

/**
 * The coat skirt for the spec's jacket, on the pelvis bone. `legRings` = the thigh rings (`upperLegRings(c)`), so the skirt is cut to clear THESE thighs.
 * Every skirt is cloth with a lining, a rolled hem and folds that deepen toward the hem; open coats (frock coat, greatcoat) are cut away at the front and split
 * at the back, closed ones (tunic, hunting, reefer, Norfolk, smoking jacket) are a full bell.
 */
export function dressSkirts(b: PartBuilder, c: BodyCtx, legRings?: readonly Ring[]): void {
  const { spec, P } = c;
  const j = spec.jacket;
  const sc = P.scale;
  const sk = skirtSpec(spec, P);
  if (!sk || sk.len <= 0) return;
  const coat = sk.wrap ? c.trouserC : c.jacketC; // (a wrap with no coat over it is the trouser cloth)
  const hemC = soil(tone(coat, 0.7), 0.22);
  const { len, flare, open } = sk;
  // the lining: a contrast silk, seen from below, through the vent and along every free edge
  const lining = tone(singe(dyeAt(PALETTE.cloth, (sk.wrap ? spec.trousersColor : spec.jacketColor) + 4), c.burnt), 0.9);
  const rings = skirtRings(c, len, flare, coat, hemC, legRings, open);
  // D-065: the peoples' garments (and the wrap) carry a woven border in the hat's dye, the Society's never do
  const band = j >= NATIVE_JACKET_FROM || sk.wrap || isWrap(spec) ? tone(singe(dyeAt(PALETTE.cloth, spec.hatColor === spec.jacketColor ? spec.hatColor + 3 : spec.hatColor), c.burnt), 0.95) : undefined;
  if (PartBuilder.lod > 0 && !open) {
    // (a crowd figure needs the bell, not every fold section)
    b.loft(rings.filter((_, i) => i === 0 || i >= rings.length - 3 || i % 2 === 0), coat, undefined, undefined, undefined, { capTop: false });
    return;
  }
  const top = 0.03 * sc;
  // folds: only ever OUT from the fitted section (never into a thigh), deepening from the waist to the hem
  const amp = (y: number): number => (open ? 0.1 : 0.075) * sstep(top, -len * 0.9, y) ** 1.2;
  const fold = (phi: number, y: number): number => 1 + amp(y) * (0.5 + 0.5 * Math.cos(SKIRT_FOLDS * phi + Math.PI));
  const surface = ringSurface(rings, undefined, PartBuilder.lod === 0 ? fold : undefined);
  // the hem hangs lower at the front and the back than at the sides (where the thigh lifts it), and a shade lower in each fold's valley
  const hemY = (phi: number): number => -len * (1 + (open ? 0.05 : 0.14) * Math.cos(2 * phi)) - 0.006 * Math.cos(SKIRT_FOLDS * phi + Math.PI);
  const ROWS = open ? [0, 0.06, 0.2, 0.42, 0.7, 1] : [0, 0.08, 0.32, 0.65, 1];
  const yOf = (phi: number, t: number): number => {
    const k = Math.min(ROWS.length - 1, Math.max(0, t * (ROWS.length - 1)));
    const k0 = Math.floor(k);
    const f = ROWS[k0]! + (ROWS[Math.min(ROWS.length - 1, k0 + 1)]! - ROWS[k0]!) * (k - k0);
    const y0 = hemY(phi);
    return y0 + (top - y0) * f;
  };
  const frontCut = j === JACKET.FROCK
    ? (y: number): number => 0.05 + 1.15 * sstep(0.03 * sc, -len * 0.8, y)
    : j === JACKET.GREATCOAT
      ? (y: number): number => 0.02 + 0.5 * sstep(-len * 0.35, -len, y)
      : (): number => -0.5;
  const vent = j === JACKET.FROCK
    ? (y: number): number => 0.03 + 0.12 * sstep(0.03 * sc, -len, y)
    : j === JACKET.GREATCOAT
      ? (y: number): number => 0.02 + 0.2 * sstep(-len * 0.3, -len, y)
      : (): number => -0.5;
  b.patch(
    {
      // (u = azimuth, v = 0 at the hem .. 1 at the waist: the hem is the grid's own edge, an exact smooth curve, and the rim follows it)
      at: (phi, t, lift) => surface(phi, yOf(phi, t), lift),
      u0: -Math.PI,
      u1: Math.PI,
      v0: 0,
      v1: 1,
      nu: open ? 24 : 22,
      nv: ROWS.length - 1,
      inside: (phi, t) => {
        const a = Math.abs(phi);
        const y = yOf(phi, t);
        // (distances in radians / metres mixed as before: the ramp is a few cells wide, so only the sign and the zero line matter)
        return Math.min(a - frontCut(y), Math.PI - a - vent(y));
      },
      lift: () => 0.0,
      // (the folds are drawn in the cloth as well as in the shape: valleys a shade darker, deeper toward the hem, so they read under the flat toon light)
      color: (phi, t) => {
        if (t < 0.03) return hemC;
        if (band !== undefined && ((t > 0.06 && t < 0.14) || (t > 0.18 && t < 0.21))) return band; // (a woven border: no tailor's hem looks like it)
        const ridge = 0.5 + 0.5 * Math.cos(SKIRT_FOLDS * phi + Math.PI);
        const depth = 0.05 + 0.16 * (1 - t);
        return lerpColor(tone(coat, 0.94 - 0.06 * (1 - t) - depth), tone(coat, 1.0 - 0.06 * (1 - t)), ridge);
      },
      // a two-layer skirt: the lining shows from below and through the vent, and every free edge has a rolled rim (LOD0 only)
      thick: 0.008,
      lining,
      rim: (_phi, t) => t < 0.97,
    },
    true,
  );
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
