import { PALETTE } from "@cb/shared";
import * as K from "../catalog.ts";
import { curve } from "./sweep.ts";
import { crossStrap, pushOut, type TorsoFrame } from "./gear.ts";
import { tone, type BodyCtx } from "./bodyKit.ts";
import { PartBuilder, singe, type V3 } from "./parts.ts";
import { bandAround, frameAt, hangingStrip, type Frame } from "./fit/torsoKit.ts";
import { alongY } from "./fit/surface.ts";

/**
 * Belts, sashes and decorations: everything that is laid across the torso's own surface. All of it is placed through the trunk's surface as drawn (`f.trunk`, fit/surface.ts):
 * bands wrap the loft's own sections (any belly), hard pieces stand off the face they lie on by their own thickness, and what goes over the coat's facings clears them (`f.layerAt`).
 */

const BELT_LIFT = 0.011;

/** A proud band round the torso centred at height y (fraction of the torso height), `halfH` half its height; `lift` = the outer face's distance from the surface. */
function band(f: TorsoFrame, y: number, halfH: number, lift: number, color: number, buckle: number | undefined): void {
  const { b, h } = f;
  bandAround(b, f.trunk, h * y - halfH, h * y + halfH, color, { lift, crease: true, steps: 1, edges: false });
  if (buckle !== undefined) buckleAt(f, buckle, lift, h * y, halfH);
}

/** The belt buckle in the spec's shape (index 0 is the square plate every belt had before the others existed), centred at height y on the front, its back on the band's face. */
function buckleAt(f: TorsoFrame, color: number, bandLift: number, y: number, halfH: number): void {
  const { b } = f;
  const fr = frameAt(f.trunk.atX(0, y, 0));
  const dark = tone(color, 0.7);
  const o = bandLift; // the band's outer face
  const cyl = (r: number, thick: number, c: number, out: number, dx = 0, dy = 0): unknown => b.cylinder(r, r, thick, c, fr.at(dx, dy, o + out), fr.rotY);
  switch (f.spec.buckle) {
    case 1: // a round disc with a raised boss
      cyl(0.036, 0.016, color, 0.008);
      cyl(0.024, 0.02, dark, 0.011);
      b.sphere(0.011, color, fr.at(0, 0, o + 0.02), [1, 1, 0.6], fr.rot);
      break;
    case 2: // an oval plate, wider than tall, with an inset
      b.sphere(1, color, fr.at(0, 0, o + 0.008), [0.05, 0.034, 0.011], fr.rot);
      b.sphere(1, dark, fr.at(0, 0, o + 0.012), [0.036, 0.021, 0.011], fr.rot);
      break;
    case 3: // a double-ring frame with a central bar and prong
      for (const sx of [-1, 1]) b.torus(0.026, 0.006, color, fr.at(sx * 0.026, 0, o + 0.006), fr.rot);
      b.box(0.012, halfH * 2.6, 0.014, color, fr.at(0, 0, o + 0.007), fr.rot);
      b.box(0.05, 0.008, 0.01, dark, fr.at(0, 0, o + 0.015), fr.rot);
      break;
    case 4: // a crest plate: a shield with a red stone
      b.box(0.064, 0.048, 0.014, color, fr.at(0, 0.004, o + 0.007), fr.rot);
      b.cone(0.045, 0.03, color, fr.at(0, -0.03, o + 0.007), [fr.rot[0], fr.rot[1], fr.rot[2] + Math.PI * 0.0]);
      b.box(0.04, 0.03, 0.016, dark, fr.at(0, 0.004, o + 0.011), fr.rot);
      b.sphere(0.013, PALETTE.trim.gemRed, fr.at(0, 0.004, o + 0.02), [1, 1, 0.6], fr.rot);
      break;
    default: // 0: the square plate
      b.box(0.07, halfH * 2.3, 0.03, color, fr.at(0, 0, o + 0.012), fr.rot);
      b.box(0.045, halfH * 1.2, 0.034, dark, fr.at(0, 0, o + 0.014), fr.rot);
  }
}

/** A cartridge: brass case with a lead tip, standing upright with its base at `p`. */
function cartridge(f: TorsoFrame, p: V3, tilt = 0, big = 1): void {
  const { b } = f;
  const brass = f.accent;
  b.cylinder(0.011 * big, 0.012 * big, 0.05 * big, brass, [p[0], p[1] + 0.025 * big, p[2]], [0, 0, tilt]);
  b.cone(0.011 * big, 0.025 * big, PALETTE.material.iron, [p[0] - Math.sin(tilt) * 0.06 * big, p[1] + 0.062 * big, p[2]], [0, 0, tilt]);
}

/** Every sampled point of a hanging tail pushed clear of the body's outermost cloth (`pushOut` on the control points alone left the curve between them bowing into a flared coat skirt). */
function clearOf(f: TorsoFrame, pts: V3[], gap: number): V3[] {
  return pts.map((p, i) => (i === 0 ? p : pushOut(f, p, gap)));
}

export function addBelt(f: TorsoFrame, c: BodyCtx): void {
  const { b, h, spec, burnt, accent, trunk } = f;
  if (spec.jacket === 7) return; // (a poncho covers the belt)
  const leather = c.leather;
  const waist = 0.2;
  const belt = spec.belt;
  const on = (y: number, phi: number, lift: number): V3 => trunk.at(phi, y, lift).p;
  if (belt === 1 || spec.jacket === 5 || spec.jacket === 10) band(f, waist, 0.022, BELT_LIFT, leather, accent);
  if (spec.jacket === 2 && belt === 0) band(f, waist, 0.02, BELT_LIFT, tone(leather, 0.9), accent);
  if (belt === 2) {
    const cum = singe(PALETTE.trim.cummerbund, burnt);
    bandAround(b, trunk, h * (waist + 0.02) - 0.055, h * (waist + 0.02) + 0.055, cum, { lift: 0.018, steps: 2, bulge: 0.006, crease: true });
    // pleats: two darker folds across the front
    for (const y of [waist - 0.005, waist + 0.045]) bandAround(b, trunk, h * y - 0.004, h * y + 0.004, tone(PALETTE.trim.cummerbund, 0.7), { lift: 0.0245, steps: 0, edges: false, crease: true });
  }
  if (belt === 3) {
    // rope: a twisted cord round the waist, a knot at the left hip and two frayed tails
    const rope = singe(PALETTE.material.rope, burnt);
    band(f, waist, 0.017, 0.0125, rope, undefined);
    const N = 22;
    for (let i = 0; i < N; i++) {
      const phi = -Math.PI + ((i + 0.5) / N) * Math.PI * 2;
      b.sphere(0.0125, i % 2 ? tone(rope, 0.78) : tone(rope, 1.12), on(h * waist, phi, 0.0125 + 0.008), [1, 0.8, 1]);
    }
    const k = on(h * waist, -0.9, 0.028);
    b.sphere(0.03, tone(rope, 0.9), k, [1, 1, 0.8]);
    for (const [dx, len] of [[-0.02, 0.24], [0.03, 0.18]] as const) {
      b.sweep(clearOf(f, curve([k, pushOut(f, [k[0] + dx, k[1] - len * 0.5, k[2] - 0.02], 0.014), pushOut(f, [k[0] + dx * 2, k[1] - len, k[2] - 0.015], 0.014)], 6), 0.03), (t) => ({ rx: 0.011 * (1 - 0.3 * t), rz: 0.011 * (1 - 0.3 * t), pow: 2, color: t > 0.85 ? tone(rope, 1.3) : rope }), rope, { side: [1, 0, 0], segments: 5, round: "both" });
    }
  }
  if (belt === 4) {
    // ammunition belt: a leather band with a row of loops, each holding a cartridge; a square brass buckle
    band(f, waist, 0.032, BELT_LIFT + 0.002, tone(leather, 1.05), accent);
    const N = 11;
    for (let i = 0; i < N; i++) {
      const phi = -1.15 + (i / (N - 1)) * 2.3;
      if (Math.abs(phi) < 0.12) continue; // the buckle
      const p = on(h * waist - 0.03, phi, BELT_LIFT + 0.02);
      cartridge(f, p);
      b.box(0.018, 0.012, 0.012, tone(leather, 0.7), [p[0], p[1] + 0.03, p[2]]);
    }
  }
  if (belt === 5) {
    // cross belts: two straps over the shoulders crossing on the chest and back at a brass plate, meeting a waist belt
    const strap = tone(leather, 1.1);
    band(f, waist, 0.018, BELT_LIFT, tone(leather, 0.95), accent);
    crossStrap(f, strap, 0.03, { sign: 1, hipY: h * 0.2, hipPhi: -0.95 });
    crossStrap(f, strap, 0.03, { sign: -1, hipY: h * 0.2, hipPhi: -0.95 });
    const y = h * 0.6;
    const fr = frameAt(f.s.atX(0, y, 0));
    const o = f.layerAt(0, y) + 0.02;
    b.cylinder(0.04, 0.04, 0.012, accent, fr.at(0, 0, o + 0.006), fr.rotY);
    b.cylinder(0.026, 0.026, 0.016, tone(accent, 0.75), fr.at(0, 0, o + 0.014), fr.rotY);
  }
  if (belt === 6) {
    // bandolier: one broad strap from the right shoulder to the left hip, studded with cartridges in loops
    const strap = tone(leather, 1.05);
    crossStrap(f, strap, 0.05, { sign: 1, hipY: h * 0.18, hipPhi: -1.0, back: false });
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const y = h * (0.18 + (0.94 - 0.18) * t) + 0.005;
      const phi = -1.0 + (0.72 + 1.0) * t;
      const p = f.s.at(phi, y - 0.02, f.layer + 0.03).p;
      cartridge(f, [p[0], p[1], p[2]], 0, 0.9);
    }
  }
  void burnt;
}

export function addSash(f: TorsoFrame, c: BodyCtx): void {
  const { b, h, spec, burnt, trunk } = f;
  const s = spec.sash;
  if (s === 0 || spec.jacket === 7) return; // (a poncho covers the sash)
  const red = singe(PALETTE.trim.sashRed, burnt);
  const gold = singe(PALETTE.trim.sashGold, burnt);
  if (s === 1) crossStrap(f, red, 0.052, { sign: 1, hipY: h * 0.24, hipPhi: -1.0 });
  if (s === 2) bandAround(b, trunk, h * 0.26 - 0.06, h * 0.26 + 0.06, gold, { lift: 0.017, steps: 2, bulge: 0.004, crease: true });
  if (s === 3) {
    // two sashes crossing on the chest, one over each shoulder
    crossStrap(f, red, 0.042, { sign: 1, hipY: h * 0.24, hipPhi: -1.0 });
    crossStrap(f, singe(PALETTE.trim.ribbonBlue, burnt), 0.042, { sign: -1, hipY: h * 0.24, hipPhi: -1.0, thick: 0.0085 });
    const y = h * 0.6;
    const fr = frameAt(f.s.atX(0, y, 0));
    b.sphere(0.03, c.accent, fr.at(0, 0, f.layerAt(0, y) + 0.03), [1, 1, 0.55], fr.rot);
  }
  if (s === 4) {
    // a broad waist wrap, knotted at the side with two tasselled ends
    bandAround(b, trunk, h * 0.26 - 0.055, h * 0.26 + 0.055, red, { lift: 0.019, steps: 2, bulge: 0.005, crease: true });
    const y = h * 0.26;
    const sp = trunk.at(0.9, y, 0);
    const fr = frameAt(sp);
    const k = fr.at(0, 0, 0.019 + 0.03);
    b.sphere(0.04, tone(red, 0.9), k, [1, 1, 0.8], fr.rot);
    for (const [dx, len] of [[0.03, 0.26], [0.09, 0.2]] as const) {
      b.sweep(clearOf(f, curve([k, pushOut(f, [k[0] + dx * 0.5, k[1] - len * 0.5, k[2] - 0.02], 0.034), pushOut(f, [k[0] + dx, k[1] - len, k[2] - 0.015], 0.034)], 6), 0.05), () => ({ rx: 0.03 * 0.9, rz: 0.012, pow: 2.4 }), red, { side: [1, 0, 0], segments: 5 });
      for (let i = 0; i < 4; i++) { const tp = pushOut(f, [k[0] + dx + (i - 1.5) * 0.012, k[1] - len - 0.03, k[2] - 0.015], 0.034); b.box(0.006, 0.05, 0.006, gold, tp); }
    }
  }
  if (s === 5) {
    // an order ribbon: a slim watered ribbon over the right shoulder with the order's badge hanging at the left hip
    const blue = singe(PALETTE.trim.ribbonBlue, burnt);
    crossStrap(f, blue, 0.028, { sign: 1, hipY: h * 0.16, hipPhi: -1.0 });
    const sp = f.s.at(-1.0, h * 0.16, 0);
    const fr = frameAt(sp);
    const o = f.layer + 0.02;
    b.sphere(0.022, gold, fr.at(0, -0.02, o), [1, 1, 0.6], fr.rot);
    b.cylinder(0.032, 0.032, 0.008, gold, fr.at(0, -0.075, o + 0.006), fr.rotY);
    b.cylinder(0.02, 0.02, 0.01, red, fr.at(0, -0.075, o + 0.012), fr.rotY);
  }
}

/**
 * One hanging medal (style 1 ribbon drape, 2 cross, 3 star): a pin bar, a ribbon of two colours folded into a V, and the badge below it,
 * lying on the coat in the local frame `fr` (out = the coat facing under it). Everything overlaps its neighbour, so the whole thing is one connected piece.
 */
function medal(f: TorsoFrame, fr: Frame, style: number, metal: number, ribbon: number, stripe: number, out: number): void {
  const { b } = f;
  const by = -0.012; // the badge hangs under its ribbon (a row is 0.07 tall: pin, ribbon and badge all fit inside it)
  b.box(0.046, 0.007, 0.008, tone(metal, 0.85), fr.at(0, 0.03, out + 0.005), fr.rot); // the pin bar
  for (const sx of [-1, 1]) {
    b.box(0.016, 0.043, 0.006, ribbon, fr.at(sx * 0.0085, 0.011, out + 0.004), [fr.rot[0], fr.rot[1], fr.rot[2] - sx * 0.3]);
    b.box(0.005, 0.043, 0.007, stripe, fr.at(sx * 0.0085, 0.011, out + 0.0055), [fr.rot[0], fr.rot[1], fr.rot[2] - sx * 0.3]);
  }
  const zz = out + 0.006;
  if (style === 1) {
    b.cylinder(0.02, 0.02, 0.008, metal, fr.at(0, by, zz), fr.rotY);
    b.torus(0.013, 0.004, tone(metal, 0.7), fr.at(0, by, zz + 0.005), fr.rot);
  } else if (style === 2) {
    b.box(0.04, 0.013, 0.008, metal, fr.at(0, by, zz), fr.rot);
    b.box(0.013, 0.04, 0.008, metal, fr.at(0, by, zz), fr.rot);
    for (const [dx, dy] of [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]] as const) b.box(dy === 0 ? 0.009 : 0.02, dx === 0 ? 0.009 : 0.02, 0.008, tone(metal, 1.12), fr.at(dx, by + dy, zz), fr.rot);
    b.sphere(0.008, stripe, fr.at(0, by, zz + 0.006), [1, 1, 0.6], fr.rot);
  } else {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      // a point of the star lying in the surface, tip pointing along (sin a, cos a)
      b.cone(0.0105, 0.03, metal, fr.at(Math.sin(a) * 0.013, by + Math.cos(a) * 0.013, zz), [fr.rot[0], fr.rot[1], fr.rot[2] - a]);
    }
    b.cylinder(0.012, 0.012, 0.009, tone(metal, 0.8), fr.at(0, by, zz + 0.002), fr.rotY);
  }
}

/** Pockets, on the front of the coat (not under a cape or poncho, which cover the torso). */
export function addPockets(f: TorsoFrame, c: BodyCtx): void {
  const { b, h, W, spec, burnt, accent, trunk } = f;
  const p = spec.pocket;
  if (p === 0 || spec.jacket === 6 || spec.jacket === 7 || PartBuilder.lod > 0) return; // (a few centimetres of cloth: invisible beyond full detail)
  const cloth = singe(spec.jacket === 0 ? c.shirtC : c.jacketC, burnt);
  const edge = tone(cloth, 0.62);
  const x = -W * 0.46;
  const y = h * 0.58;
  const fr = frameAt(trunk.atX(x, y, 0));
  const o = f.layerAt(x, y);
  const bx = (dx: number, dy: number, w: number, hh: number, d: number, col: number, out: number, roll = 0): unknown => b.box(w, hh, d, col, fr.at(dx, dy, o + out + d / 2), [fr.rot[0], fr.rot[1], fr.rot[2] + roll]);
  if (p === 1 || p === 2 || p === 4) {
    // a welted breast pocket: a patch a shade lighter than the coat, with a dark mouth
    bx(0, -0.008, 0.09, 0.07, 0.008, tone(cloth, 1.1), 0);
    bx(0, 0.03, 0.096, 0.012, 0.012, edge, 0.004);
  }
  if (p === 2) {
    // a folded handkerchief: two points showing above the mouth
    for (const sx of [-1, 1]) bx(sx * 0.016, 0.05, 0.03, 0.058, 0.008, PALETTE.trim.ivory, 0.006, -sx * 0.24);
    bx(0, 0.042, 0.016, 0.04, 0.009, singe(PALETTE.trim.ribbonRed, burnt), 0.008);
  }
  if (p === 4) {
    const cols = [PALETTE.trim.pencil, PALETTE.trim.ribbonRed, PALETTE.trim.frame];
    for (let i = 0; i < 3; i++) {
      const tilt = (i - 1) * 0.16;
      const px = (i - 1) * 0.021;
      b.cylinder(0.0085, 0.0085, 0.08, singe(cols[i]!, burnt), fr.at(px, 0.05, o + 0.012), [fr.rot[0], fr.rot[1], fr.rot[2] - tilt]);
      b.cone(0.0085, 0.016, i === 0 ? PALETTE.trim.ivory : accent, fr.at(px - Math.sin(tilt) * 0.048, 0.096, o + 0.012), [fr.rot[0], fr.rot[1], fr.rot[2] - tilt]);
    }
  }
  if (p === 3) {
    // a pair of flap pockets low on the front, each with a button
    for (const sx of [-1, 1]) {
      const fx = sx * W * 0.4;
      const fy = h * 0.46;
      const g = frameAt(trunk.atX(fx, fy, 0));
      const oo = f.layerAt(fx, fy);
      const put = (dx: number, dy: number, w: number, hh: number, d: number, col: number, out: number, roll = 0): unknown => b.box(w, hh, d, col, g.at(dx, dy, oo + out + d / 2), [g.rot[0], g.rot[1], g.rot[2] + roll]);
      put(0, -0.004, 0.11, 0.05, 0.012, tone(cloth, 0.9), 0); // the pocket behind the flap
      put(0, 0.026, 0.12, 0.012, 0.014, edge, 0.004);
      put(0, 0.004, 0.11, 0.04, 0.014, tone(cloth, 1.08), 0.008, sx * 0.1);
      b.sphere(0.011, accent, g.at(0, -0.012, oo + 0.024), [1, 1, 0.6], g.rot);
    }
  }
}

export function addDecorations(f: TorsoFrame, _c: BodyCtx): void {
  const { b, h, W, spec, burnt, accent, trunk } = f;
  if (spec.jacket === 7) return; // (under the poncho)
  // medals on the left breast (-X), pinned to the surface
  const ribbons = [PALETTE.trim.ribbonRed, PALETTE.trim.ribbonBlue, PALETTE.trim.ribbonGreen, PALETTE.trim.ribbonPurple];
  for (let i = 0; i < spec.medals; i++) {
    const mx = -W * 0.5 + (i % 3) * 0.055;
    const my = h * 0.74 - Math.floor(i / 3) * 0.07;
    const fr = frameAt(trunk.atX(mx, my, 0));
    const o = f.layerAt(mx, my);
    if (spec.medalStyle === 0) {
      b.cylinder(0.026, 0.026, 0.008, i % 2 ? K.ACCENT_COLORS[1]! : accent, fr.at(0, 0, o + 0.006), fr.rotY);
      b.box(0.02, 0.05, 0.006, i % 2 ? PALETTE.trim.ribbonBlue : PALETTE.trim.ribbonRed, fr.at(0, 0.04, o + 0.004), fr.rot);
      continue;
    }
    medal(f, fr, spec.medalStyle, [K.ACCENT_COLORS[i % 3 === 1 ? 1 : 0]!, PALETTE.trim.bronze, accent][i % 3]!, singe(ribbons[i % 4]!, burnt), singe(ribbons[(i + 1) % 4]!, burnt), o);
  }
  const d = spec.decoration;
  const put = (x: number, y: number): { fr: Frame; o: number } => ({ fr: frameAt(trunk.atX(x, y, 0)), o: f.layerAt(x, y) });
  if (d === 1) {
    // ribbon bars: a row of little coloured rectangles above the pocket
    const cols = [PALETTE.trim.ribbonBlue, PALETTE.trim.ribbonRed, PALETTE.trim.ribbonGreen, PALETTE.trim.ribbonPurple];
    for (let i = 0; i < 4; i++) {
      const { fr, o } = put(-W * 0.6 + i * 0.026, h * 0.84);
      b.box(0.024, 0.02, 0.008, singe(cols[i]!, burnt), fr.at(0, 0, o + 0.006), fr.rot);
    }
  } else if (d === 2) {
    // order star: a many-pointed star on the right breast
    const { fr, o } = put(W * 0.46, h * 0.66);
    b.cylinder(0.024, 0.024, 0.01, tone(accent, 0.85), fr.at(0, 0, o + 0.006), fr.rotY);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      // points radiate in the surface: the cone's axis is turned into the surface plane along (sin a, cos a)
      const dirp: V3 = [fr.right[0] * Math.sin(a) + fr.up[0] * Math.cos(a), fr.right[1] * Math.sin(a) + fr.up[1] * Math.cos(a), fr.right[2] * Math.sin(a) + fr.up[2] * Math.cos(a)];
      const cp = fr.at(Math.sin(a) * 0.035, Math.cos(a) * 0.035, o + 0.006);
      b.cone(0.012, 0.05, i % 2 ? tone(accent, 0.8) : accent, cp, alongY(dirp));
    }
    b.sphere(0.014, PALETTE.trim.gemRed, fr.at(0, 0, o + 0.014), [1, 1, 0.6], fr.rot);
  } else if (d === 3) {
    // regimental badge: a small shield on the left breast pocket
    const { fr, o } = put(-W * 0.5, h * 0.66);
    b.box(0.05, 0.05, 0.01, accent, fr.at(0, 0, o + 0.006), fr.rot);
    b.cone(0.035, 0.03, accent, fr.at(0, -0.04, o + 0.006), [fr.rot[0], fr.rot[1], fr.rot[2] + Math.PI * 0]);
    b.box(0.03, 0.03, 0.012, PALETTE.trim.ribbonRed, fr.at(0, 0.002, o + 0.011), fr.rot);
  } else if (d === 4) {
    // rosette: a pleated cockade with two ribbon tails on the left lapel
    const { fr, o } = put(-W * 0.36, h * 0.8);
    b.torus(0.032, 0.012, PALETTE.trim.ribbonRed, fr.at(0, 0, o + 0.014), fr.rot);
    b.torus(0.018, 0.01, PALETTE.trim.ivory, fr.at(0, 0, o + 0.022), fr.rot);
    b.sphere(0.012, accent, fr.at(0, 0, o + 0.03));
    for (const sx of [-1, 1]) b.box(0.02, 0.07, 0.006, sx > 0 ? PALETTE.trim.ribbonBlue : PALETTE.trim.ribbonRed, fr.at(sx * 0.014, -0.055, o + 0.006), [fr.rot[0], fr.rot[1], fr.rot[2] + sx * 0.2]);
  }
  void hangingStrip;
}
