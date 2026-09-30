import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { BufferGeometry } from "three";
import type { Ring } from "./loft.ts";
import { sstep } from "./patch.ts";
import { PartBuilder, singe } from "./parts.ts";
import { dyeAt, frontZ, neckRadii, ringAt, ringSurface, tone, type BodyCtx } from "./bodyKit.ts";
import { lerpColor, torsoRings, type TorsoView } from "./garments.ts";
import { patchSurface, polySurface } from "./fit/surface.ts";
import { curve } from "./sweep.ts";

/**
 * Capes and ponchos: DRAPED cloth, not a bowl. Each is built from two kinds of piece:
 *  - a TORSO piece (the mantle of a cape; the front and back panels of a poncho): a two-layer patch of a flared section surface with folds, a cut hem and an
 *    open front (cape) or a slit neck and pointed panels (poncho), living on the torso bone;
 *  - an ARM piece on each upper-arm bone (the bell of cloth that hangs off the shoulder over the arm): it is CARRIED BY THE ARM, so no swing, raise or haul can
 *    push an arm through the cloth - the cloth lifts with the arm, the way a cape does.
 * Cloth is two layers thick (an outer face, a lining in a contrast dye and a rolled rim: patch.ts `thick`), so the inside of a cape shows its lining from the
 * front, from below and through an open front instead of the world.
 */

/** Waves of folds round the garment. */
const FOLDS = 5;
/** Cloth thickness, metres. */
const CLOTH = 0.009;

const cosF = (phi: number, k: number, phase = 0): number => Math.cos(k * phi + phase);

/** A pleat wave: crests at +1, valleys at -1, sharper than a cosine (cloth folds crease, it does not undulate). */
const pleat = (phi: number, k: number, phase = 0): number => {
  const c = Math.cos(k * phi + phase);
  return Math.sign(c) * Math.abs(c) ** 0.7;
};

/**
 * How deep (0 on a crest .. 1 in a valley) the cloth is folded in at azimuth phi and height y: two pleat waves of different sizes so the folds are not a regular corrugation, growing
 * from nothing at the shoulder line (where the cloth lies on the body) to full depth low down (where it hangs free). Folds only ever go IN from the fitted section, never out, so the
 * clearance the section keeps from the arms (`clearance()`) is a lower bound, not something a fold can spend.
 */
const foldDepth = (phi: number, y: number, h: number, k: number): number => (0.5 - 0.5 * (0.72 * pleat(phi, k) + 0.28 * pleat(phi, k * 2 + 1, 0.6))) * sstep(h * 0.9, -h * 0.08, y);

/**
 * Height for the patch parameter t in 0..1 at azimuth phi: t = 0 IS the hem (whatever shape it has), t = 1 the top edge, and the rows in between run parallel to the hem
 * with more of them near it. So the hem is the grid's own edge (smooth, no iso-cut), stripes and hem lining follow it, and folds shade where the cloth ends.
 */
const upFromHem = (hem: (phi: number) => number, top: number) => (phi: number, t: number): number => {
  const y0 = hem(phi);
  return y0 + (top - y0) * t ** 1.5;
};

/**
 * Rows at fixed fractions of the way from the hem to the top (row j of the list is t = j / (rows - 1)): the cloth's detail is at the hem and at the shoulder line, and a
 * uniform grid would skip the shoulder-line bulge altogether.
 */
const rowsFromHem = (hem: (phi: number) => number, top: number, fractions: readonly number[]) => (phi: number, t: number): number => {
  const y0 = hem(phi);
  const j = Math.min(fractions.length - 1, Math.max(0, t * (fractions.length - 1)));
  const j0 = Math.floor(j);
  const j1 = Math.min(fractions.length - 1, j0 + 1);
  const f = fractions[j0]! + (fractions[j1]! - fractions[j0]!) * (j - j0);
  return y0 + (top - y0) * f;
};

/**
 * Like `upFromHem`, but with sharp stripes: the first rows sit at the given distances above the hem (a pair half a millimetre apart at each stripe edge, so vertex colours
 * change sharply between them), then the remaining rows spread evenly up to the top. Row j of `nv` is at t = j / nv.
 */
const stripedFromHem = (hem: (phi: number) => number, top: number, edges: readonly number[], nv: number, tail?: readonly number[]) => {
  const d = [0];
  for (const e of edges) d.push(e, e + 0.0006);
  const last = d[d.length - 1]!;
  return (phi: number, t: number): number => {
    const y0 = hem(phi);
    const j = t * nv;
    const jf = Math.min(d.length - 1, Math.floor(j + 1e-6));
    if (j <= d.length - 1 + 1e-6) return y0 + d[jf]! + (jf < d.length - 1 ? (d[jf + 1]! - d[jf]!) * (j - jf) : 0);
    const span = Math.max(top, y0 + last + 0.05) - y0 - last;
    if (tail) {
      // the rows above the stripes sit at the given fractions of the way to the top (row d.length + k is tail[k])
      const k = Math.min(tail.length - 1, Math.max(0, j - d.length));
      const k0 = Math.floor(k);
      const f = tail[k0]! + (tail[Math.min(tail.length - 1, k0 + 1)]! - tail[k0]!) * (k - k0);
      return y0 + last + span * f;
    }
    return y0 + last + span * ((j - (d.length - 1)) / (nv - (d.length - 1)));
  };
};

interface HalfSpec {
  /** Azimuth (0 at the front, pi at the back centre) for w in 0..1 across the half, at height y: w = 0 IS the garment's front edge. */
  phiOf(w: number, y: number): number;
  /** Height for row t at column w (t = 0 is the hem). */
  yOf(w: number, t: number): number;
  surface(phi: number, y: number, lift: number): ReturnType<ReturnType<typeof ringSurface>>;
  color(phi: number, y: number, w: number, t: number): number;
  nu: number;
  nv: number;
  lining: number;
}

/**
 * A garment that is open at the front, as two mirrored patches (one per side) whose grid runs from the front edge (w = 0) to the back centre (w = 1) and from the hem
 * (t = 0) upward. The front edge and the hem are then the grid's own boundary, so they are exact smooth curves (no iso-cut staircase) and the rim follows them.
 */
function mirroredHalves(b: PartBuilder, sp: HalfSpec): void {
  for (const sg of [-1, 1] as const) {
    b.patch(
      {
        at: (w, t, lift) => {
          const y = sp.yOf(w, t);
          return sp.surface(sg * sp.phiOf(w, y), y, lift);
        },
        u0: 0,
        u1: 1,
        v0: 0,
        v1: 1,
        nu: sp.nu,
        nv: sp.nv,
        lift: () => 0,
        color: (w, t) => {
          const y = sp.yOf(w, t);
          return sp.color(sp.phiOf(w, y), y, w, t);
        },
        thick: CLOTH,
        lining: sp.lining,
        // a rim on the hem and the front edge; none under the collar (the top) or down the back seam (the two halves meet there)
        rim: (w, t) => t < 0.97 && w < 0.97,
      },
      true,
    );
  }
}

/** The lining dye: a contrast cloth picked from the jacket's own colour so it always goes with it. */
export function liningDye(c: BodyCtx): number {
  return singe(dyeAt(PALETTE.cloth, c.spec.jacketColor + 4), c.burnt);
}

interface Clear {
  rx: number;
  rz: number;
  /** The section's centre offset (a belly pushes the sections forward): the cloth hangs round the same centre, so it never reaches far behind a big belly. */
  cz: number;
}
/**
 * A section that clears the body at fraction f of the torso height by margin m. The torso piece never reaches further out than the arms' own swing plane
 * (`SH - 1.5 r`: the arm axis stays outside the cloth), unless the body itself is wider there; the flare of a hem goes BACKWARDS, not sideways.
 */
function clearance(P: Proportions, base: readonly Ring[], h: number, f: number, m: number, kx = 1): Clear {
  const s = ringAt(base, h * f);
  const room = Math.max(P.shoulderHalfWidth - 1.5 * P.armRadius, s.rx + 0.02);
  return { rx: Math.min(s.rx * kx + m, room), rz: s.rz + m, cz: s.cz };
}

// ---- the cape ----------------------------------------------------------------------------------------------------------------------------------

/** Sections of the cape's mantle (torso frame): a collar, the shoulder line and a flare that clears the body under it. Also the surface wound dressings lie on. */
export function capeRings(P: Proportions, color: number): Ring[] {
  const h = P.torsoHeight;
  const D = P.torsoDepth / 2;
  const SH = P.shoulderHalfWidth;
  const nk = neckRadii(P);
  const base = torsoRings(P, color, 0);
  const at = (f: number, m: number, kx = 1): Clear => clearance(P, base, h, f, m, kx);
  const shoulder = at(0.905, 0.03);
  const mid = at(0.5, 0.04);
  const low = at(0.2, 0.06, 1.03);
  const hip = at(-0.05, 0.09, 1.06);
  return [
    { y: h * 0.985 + 0.012, rx: nk.rx * 1.22, rz: nk.rz * 1.22, pow: 2, color },
    { y: h * 0.955, rx: Math.max(nk.rx * 1.9, SH * 0.5) + 0.025, rz: Math.max(nk.rz * 1.8, D * 0.55) + 0.025, pow: 2.3, color },
    { y: h * 0.905, rx: shoulder.rx, rz: shoulder.rz, cz: shoulder.cz, pow: 2.3, color },
    { y: h * 0.78, ...at(0.78, 0.032), pow: 2.3, color },
    { y: h * 0.5, rx: mid.rx, rz: mid.rz, cz: mid.cz, pow: 2.3, color },
    { y: h * 0.2, rx: low.rx, rz: low.rz, cz: low.cz, pow: 2.3, color },
    { y: -0.04 * h, rx: hip.rx, rz: hip.rz + 0.02, cz: hip.cz + 0.01, pow: 2.3, color },
    { y: -0.2 * h, rx: hip.rx, rz: hip.rz + 0.11, cz: hip.cz + 0.05, pow: 2.3, color },
    { y: -0.36 * h, rx: hip.rx, rz: hip.rz + 0.17, cz: hip.cz + 0.1, pow: 2.3, color },
  ];
}

/** The cape's cut: how far the front opens (radians from the centre line) at height y, and where the hem hangs at azimuth phi. */
function capeCut(h: number): { open(y: number): number; hem(phi: number): number; fold(phi: number, y: number): number } {
  return {
    // shut at the clasp, then opening wider and wider down to a shoulder-to-hip gap
    open: (y) => -0.06 + 1.2 * sstep(h * 0.91, -h * 0.06, y) ** 0.8,
    // lowest at the back and the front tails, drawn up at the sides where the arms lift it
    hem: (phi) => -0.34 * h + 0.235 * h * (1 - Math.cos(phi) ** 2) ** 0.8 + 0.03 * (pleat(phi, FOLDS) - 1) * 0.5 * Math.cos(phi) ** 2, // (the hem is wavy at the back and the front tails, straight where the arms swing under it)
    // pleats: the cloth is folded IN between the crests, deeper the lower it hangs (3.5 cm at the hem); the shading and the colours below follow it
    fold: (phi, y) => 1 - 0.25 * foldDepth(phi, y, h, FOLDS),
  };
}

/** The clasp at the throat: two brass plates joined by a toggle bar (a peg through a loop) and a short chain. */
function clasp(v: TorsoView, y: number, zf: number): void {
  const { b, c } = v;
  for (const sx of [-1, 1]) {
    b.box(0.05, 0.036, 0.011, c.accent, [sx * 0.045, y, zf - 0.006], [0, sx * -0.25, 0]);
    b.sphere(0.011, tone(c.accent, 1.15), [sx * 0.045, y, zf - 0.015], [1, 1, 0.55]);
  }
  b.cylinder(0.0075, 0.0075, 0.1, tone(c.accent, 0.85), [0, y, zf - 0.02], [0, 0, Math.PI / 2]); // the toggle
  b.sweep(curve([[-0.045, y - 0.016, zf - 0.012], [0, y - 0.05, zf - 0.02], [0.045, y - 0.016, zf - 0.012]], 7), () => ({ rx: 0.0045, rz: 0.0045 }), c.accent, { side: [0, 1, 0], segments: 4 });
}

/** A rolled hem: a soft tube of cloth along the cut edge (the two halves' hems), so the edge has body from every angle instead of a paper-thin line. */
function hemRoll(b: PartBuilder, points: readonly (readonly [number, number, number])[], radius: number, color: number): void {
  if (PartBuilder.lod > 0 || points.length < 2) return;
  b.sweep(points as [number, number, number][], (t) => ({ rx: radius * (0.85 + 0.15 * Math.sin(t * Math.PI)), rz: radius, pow: 2 }), color, { side: [0, 1, 0], segments: 5, round: "both" });
}

/** A standing collar round the neck, open at the front: a patch of the neck's own rings flaring out at the top, lined inside. `open` is the half-gap at the front (radians). */
function neckCollar(v: TorsoView, y0: number, y1: number, cloth: number, lining: number, open: number): void {
  const { b, c } = v;
  if (PartBuilder.lod > 0) return; // (crowds: the mantle's top row is the collar)
  const nk = neckRadii(c.P);
  const rings: Ring[] = [
    { y: y0, rx: nk.rx * 1.42 + 0.02, rz: nk.rz * 1.42 + 0.02, pow: 2 },
    { y: (y0 + y1) / 2, rx: nk.rx * 1.36 + 0.012, rz: nk.rz * 1.36 + 0.012, pow: 2 },
    { y: y1, rx: nk.rx * 1.52 + 0.015, rz: nk.rz * 1.52 + 0.015, pow: 2 },
  ];
  const surf = ringSurface(rings, undefined, (phi) => 1 - 0.035 * (0.5 - 0.5 * pleat(phi, 8)));
  b.patch(
    {
      at: (phi, t, lift) => surf(phi, y0 + (y1 - y0) * t, lift),
      u0: open,
      u1: Math.PI * 2 - open,
      v0: 0,
      v1: 1,
      nu: 22,
      nv: 3,
      lift: () => 0,
      color: (phi, t) => tone(cloth, (0.9 + 0.14 * t) * (1 - 0.12 * (0.5 - 0.5 * pleat(phi, 8)))),
      thick: 0.008,
      lining,
      rim: () => true,
    },
    true,
  );
}

/** The cape's torso piece: an open-fronted mantle with pleats baked into its shading, a lining, a rolled hem, a standing collar and a brass toggle. */
export function dressCape(v: TorsoView): void {
  const { b, c, h, neckY } = v;
  const P = c.P;
  const cloth = v.coat;
  const lining = liningDye(c);
  const rings = capeRings(P, cloth);
  const cut = capeCut(h);
  if (PartBuilder.lod >= 2) {
    // a far figure: one closed cone of cloth in the cape's silhouette (patches are not built at this level)
    b.loft(rings.map((r, i) => ({ ...r, rx: r.rx * (i > 4 ? 1.05 : 1), color: tone(cloth, 1 - i * 0.02) })), cloth, undefined, undefined, undefined, { capTop: false, capBottom: false });
    return;
  }
  const surface = ringSurface(rings, undefined, cut.fold);
  const top = neckY + 0.012;
  const openHem = cut.open(-0.3 * h); // (the front opening has reached its full width by the hem)
  const hemW = (w: number): number => cut.hem(openHem + w * (Math.PI - openHem));
  const ROWS = [0, 0.04, 0.14, 0.32, 0.55, 0.74, 0.87, 0.95, 1];
  const Y = rowsFromHem(hemW, top, ROWS);
  const phiOf = (w: number, y: number): number => cut.open(y) + w * (Math.PI - cut.open(y));
  mirroredHalves(b, {
    phiOf,
    yOf: (w, t) => Y(w, t),
    surface,
    color: (phi, y) => {
      const k = sstep(h * 0.95, -0.12 * h, y);
      // the pleats are in the colour too: valleys a shade darker (ambient occlusion), crests a touch lighter, so the folds read in the toon bands as well
      const shade = 1 - 0.42 * foldDepth(phi, y, h, FOLDS) + 0.1 * (1 - foldDepth(phi, y, h, FOLDS)) * sstep(h * 0.9, 0, y);
      return lerpColor(tone(cloth, 1.06 * shade), tone(cloth, 0.84 * shade), k);
    },
    nu: 20,
    nv: ROWS.length - 1,
    lining,
  });
  // rolled hem along both halves (from the front tails round to the back centre)
  for (const sg of [-1, 1]) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const w = i / 12;
      const y0 = hemW(w);
      pts.push(surface(sg * phiOf(w, y0), y0 + 0.002, 0).p);
    }
    hemRoll(b, pts, 0.0105, tone(lining, 0.95));
  }
  neckCollar(v, h * 0.955, neckY + 0.034, cloth, lining, 0.32);
  const s = surface(0, h * 0.935, 0.01).p;
  clasp(v, h * 0.935, s[2]);
}

// ---- the poncho -------------------------------------------------------------------------------------------------------------------------------

/** The poncho panels' sections (torso frame): the shoulder line, then a flare that clears the chest and belly. Also the surface wound dressings lie on. */
export function ponchoRings(P: Proportions, color: number): Ring[] {
  const h = P.torsoHeight;
  const D = P.torsoDepth / 2;
  const SH = P.shoulderHalfWidth;
  const nk = neckRadii(P);
  const base = torsoRings(P, color, 0);
  const at = (f: number, m: number, kx = 1): Clear => clearance(P, base, h, f, m, kx);
  const sh = at(0.9, 0.04);
  return [
    { y: h * 0.985 + 0.012, rx: nk.rx * 1.22, rz: nk.rz * 1.22, pow: 2, color },
    { y: h * 0.95, rx: Math.max(nk.rx * 1.9, SH * 0.55) + 0.03, rz: Math.max(nk.rz * 1.8, D * 0.6) + 0.03, pow: 2.2, color },
    { y: h * 0.9, rx: sh.rx, rz: sh.rz, cz: sh.cz, pow: 2.2, color },
    { y: h * 0.72, ...at(0.72, 0.06), pow: 2.2, color },
    { y: h * 0.48, ...at(0.48, 0.08, 1.02), pow: 2.2, color },
    { y: h * 0.22, ...at(0.22, 0.09, 1.04), pow: 2.2, color },
    { y: h * 0.06, ...at(0.06, 0.1, 1.06), pow: 2.2, color },
  ];
}

/** How far a point of the poncho hem is towards its lowest point (1 at the tip of the front and back panels, 0 at the sides). */
const tip = (phi: number): number => Math.max(0, 1 - Math.min(Math.abs(phi), Math.PI - Math.abs(phi)) / 1.2);

/** The poncho's cut: the hem height round the body (pointed front and back panels, high at the sides), and the slit at the neck. */
function ponchoCut(h: number): { hem(phi: number): number; slit(y: number): number; fold(phi: number, y: number): number } {
  return {
    hem: (phi) => 0.62 * h + (0.1 * h - 0.62 * h) * tip(phi) ** 0.95 + 0.008 * cosF(phi, 5),
    slit: (y) => 0.3 * sstep(h * 0.76, h * 0.965, y),
    fold: (phi, y) => 1 - 0.16 * foldDepth(phi, y, h, 4),
  };
}

/** The poncho's torso pieces: a front and a back panel, pointed, with a slit at the neck. Stripes near the hem. */
export function dressPoncho(v: TorsoView): void {
  const { b, c, h, neckY } = v;
  const P = c.P;
  const cloth = v.coat;
  const lining = tone(cloth, 0.72);
  const stripe1 = liningDye(c);
  const stripe2 = tone(v.facing, 1.5);
  const rings = ponchoRings(P, cloth);
  const cut = ponchoCut(h);
  if (PartBuilder.lod >= 2) {
    b.loft(rings.map((r, i) => ({ ...r, rx: r.rx * (i > 3 ? 1.06 : 1), color: tone(cloth, 1 - i * 0.03) })), cloth, undefined, undefined, undefined, { capTop: false, capBottom: false });
    return;
  }
  const surface = ringSurface(rings, undefined, cut.fold);
  const top = neckY + 0.012;
  const NV = 8;
  const hemW = (w: number): number => cut.hem(w * Math.PI);
  const Y = stripedFromHem(hemW, top, [0.026, 0.06], NV, [0.2, 0.42, 0.62, 0.8, 0.92, 1]);
  mirroredHalves(b, {
    // the neck slit is the front edge of each half (it closes to nothing at 0.76 h), so it is a clean V in the grid's own boundary
    phiOf: (w, y) => cut.slit(y) + w * (Math.PI - cut.slit(y)),
    yOf: (w, t) => Y(w, t),
    surface,
    color: (_phi, y, _w, t) => {
      const j = Math.round(t * NV);
      if (j <= 1) return stripe2;
      if (j <= 3) return stripe1;
      const d = foldDepth(_phi, y, h, 4);
      return lerpColor(tone(cloth, 1.06 * (1 - 0.4 * d)), tone(cloth, 0.9 * (1 - 0.4 * d)), sstep(h * 0.9, h * 0.3, y));
    },
    nu: 20,
    nv: NV,
    lining,
  });
  if (PartBuilder.lod === 0) {
    // the neck hole has a rolled edge (a collar of the same wool), and each panel's point a rolled hem
    const nk = neckRadii(P);
    const ry = neckY + 0.008;
    const rr = 1.26;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push([Math.sin(a) * nk.rx * rr, ry - 0.012 * (1 - Math.cos(a)) * 0.5, -Math.cos(a) * nk.rz * rr]);
    }
    b.sweep(pts, () => ({ rx: 0.016, rz: 0.016, pow: 2 }), tone(cloth, 0.8), { side: [0, 1, 0], segments: 5 });
    for (const sg of [-1, 1]) {
      const hp: [number, number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const w = i / 12;
        const y0 = hemW(w);
        hp.push(surface(sg * (cut.slit(y0) + w * (Math.PI - cut.slit(y0))), y0 + 0.002, 0).p);
      }
      hemRoll(b, hp, 0.0095, tone(stripe2, 0.9));
    }
  }
  if (PartBuilder.lod === 0) {
    // fringe: tassels hanging from the tips of the front and back panels
    for (const phi of [0, Math.PI]) {
      for (let k = -1; k <= 1; k++) {
        const d = k * 0.12;
        const a = phi === 0 ? d : Math.PI - d; // (azimuth of the tassel; the back tip is at pi, the hem there is the mirror of the front)
        const hem = cut.hem(a > Math.PI ? 2 * Math.PI - a : a);
        const s = surface(a, hem, 0).p;
        b.box(0.012, 0.05, 0.012, tone(cloth, 0.66), [s[0], hem - 0.01, s[2]]);
      }
    }
  }
}

// ---- the arm pieces (upper-arm frame: origin at the shoulder, the arm hangs down -Y) ---------------------------------------------------------------------

/** Fraction of the upper arm the drape covers at its shortest (the bare sleeve, and any wound dressing on it, starts below). */
export function drapeCover(jacket: number): number {
  return jacket === 6 ? 0.5 : jacket === 7 ? 0.6 : 0;
}

/** Radius (m) of the drape round the upper arm at fraction f of its length (0 at the shoulder), for dressings that must lie on what a player sees. */
export function drapeRadius(P: Proportions, jacket: number, f: number): number {
  const r = P.armRadius;
  const rings = armRings(P, jacket);
  const s = ringAt(rings, -P.armUpper * f);
  void r;
  return (s.rx + s.rz) / 2 + CLOTH;
}

function armRings(P: Proportions, jacket: number): Ring[] {
  const r = P.armRadius;
  const L = P.armUpper;
  const wide = jacket === 7 ? 1.32 : 1;
  return [
    { y: r * 0.72, rx: r * 1.18 * wide + 0.012, rz: r * 1.15 * wide + 0.012, pow: 2.2 },
    { y: 0, rx: r * 1.5 * wide + 0.018, rz: r * 1.47 * wide + 0.018, pow: 2.2 },
    { y: -L * 0.3, rx: r * 1.6 * wide + 0.018, rz: r * 1.54 * wide + 0.018, pow: 2.2 },
    { y: -L * 0.65, rx: r * 1.7 * wide + 0.02, rz: r * 1.62 * wide + 0.02, pow: 2.2 },
    { y: -L * 0.9, rx: r * 1.76 * wide + 0.022, rz: r * 1.68 * wide + 0.022, pow: 2.2 },
  ];
}

/** The cape sleeve / poncho wing that hangs off a shoulder over the arm, on the upper-arm bone so it moves with the arm. */
export function dressArmDrape(b: PartBuilder, c: BodyCtx, side: "L" | "R"): void {
  const jacket = c.spec.jacket;
  if (jacket !== 6 && jacket !== 7) return;
  const { P } = c;
  const r = P.armRadius;
  const L = P.armUpper;
  const poncho = jacket === 7;
  const cloth = c.jacketC;
  const rings = armRings(P, jacket);
  const out = side === "L" ? -Math.PI / 2 : Math.PI / 2; // azimuth (round the arm) that faces away from the body
  const cover = drapeCover(jacket);
  const lining = poncho ? tone(cloth, 0.72) : liningDye(c);
  const stripe1 = liningDye(c);
  const stripe2 = tone(dyeAt(PALETTE.cloth, c.spec.jacketColor + 4), 1.35);
  // the hem: a wavy line for the cape; a lappet pointing away from the body for the poncho (one of its four corners)
  const hem = (phi: number): number => {
    if (poncho) return -L * (cover - 0.12 + 0.36 * Math.max(0, Math.cos(phi - out)) ** 1.4);
    return -L * (cover - 0.07 + 0.27 * Math.max(0, Math.cos(phi - out)) ** 1.3 + 0.025 * (pleat(phi, 4, 0.5) - 1) * 0.5); // (a drape over the arm: high in front and behind, hanging lowest on the outside)
  };
  const fold = (phi: number, y: number): number => 1 + 0.06 * sstep(r * 0.5, -L * 0.6, y) * cosF(phi, 4, out);
  if (PartBuilder.lod >= 2) {
    // a far figure: the bell as one open cone (no lining, no cut hem)
    const cone = rings.filter((_, i) => i < 4).map((rg, i) => ({ ...rg, y: i === 3 ? -L * (cover + 0.05) : rg.y, color: tone(cloth, 1.04 - 0.06 * i) }));
    b.loft(cone, cloth, undefined, undefined, undefined, { capTop: false, capBottom: false });
    return;
  }
  const surface = ringSurface(rings, undefined, fold);
  const NV = poncho ? 6 : 4;
  const Y = poncho ? stripedFromHem(hem, r * 0.72, [0.03], NV) : upFromHem(hem, r * 0.72);
  b.patch(
    {
      at: (phi, t, lift) => surface(phi, Y(phi, t), lift),
      u0: -Math.PI,
      u1: Math.PI,
      v0: 0,
      v1: 1,
      nu: 12,
      nv: NV,
      lift: () => 0,
      color: (phi, t) => {
        const y = Y(phi, t);
        if (poncho) {
          if (Math.round(t * NV) <= 1) return stripe1;
        }
        return lerpColor(tone(cloth, 1.06), tone(cloth, 0.86), sstep(r, -L * 0.6, y));
      },
      thick: CLOTH,
      lining,
      rim: (_phi, t) => t < 0.97,
      wrap: false,
    },
    true,
  );
}

// ---- what dressings lie on ---------------------------------------------------------------------------------------------------------------------------

/** The outermost torso surface for dressings that must lie on what a player sees: the poncho's panel when one is worn (the cape leaves the chest open), else the torso. */
export function outerTorsoRings(P: Proportions, color: number, jacket: number): Ring[] {
  if (jacket === 7) return ponchoRings(P, color);
  return torsoRings(P, color, jacket === 6 ? 0 : jacket);
}

/** A stand-alone geometry of the cape's or poncho's torso piece (for tests and the clip audit): undefined for other jackets. */
export function buildDrapeOnly(c: BodyCtx, part: "torso" | "armL" | "armR"): BufferGeometry | undefined {
  const j = c.spec.jacket;
  if (j !== 6 && j !== 7) return undefined;
  const b = new PartBuilder();
  if (part === "torso") {
    const P = c.P;
    const h = P.torsoHeight;
    const nk = neckRadii(P);
    const rings = torsoRings(P, c.jacketC, 0);
    const at = (y: number) => ringAt(rings, y);
    const view = {
      b,
      c,
      rings,
      h,
      W: P.torsoWidth / 2,
      D: P.torsoDepth / 2,
      SH: P.shoulderHalfWidth,
      neckY: h * 0.985,
      nrx: nk.rx,
      nrz: nk.rz,
      at,
      surf: (y: number, x = 0) => frontZ(at(y), x),
      s: polySurface(rings),
      surface: patchSurface(rings),
      layers: [],
      coat: c.jacketC,
      facing: tone(c.jacketC, 0.68),
      vest: c.jacketC,
      shirt: c.shirtC,
      trim: c.accent,
    } satisfies TorsoView;
    if (j === 6) dressCape(view);
    else dressPoncho(view);
  } else dressArmDrape(b, c, part === "armL" ? "L" : "R");
  return b.build();
}

