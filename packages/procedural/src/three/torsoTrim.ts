import { PALETTE } from "@cb/shared";
import * as K from "../catalog.ts";
import { curve } from "./sweep.ts";
import { torsoRibbon, type TorsoFrame } from "./gear.ts";
import { frontZ, tone, type BodyCtx } from "./bodyKit.ts";
import { singe, type V3 } from "./parts.ts";
import { ringSurface } from "./bodyKit.ts";

/** Belts, sashes and decorations: everything that is laid across the torso's own surface. */

/** A proud band round the torso that follows the section at height y (fraction of the torso height), `halfH` half its height, `k` proud. */
function band(f: TorsoFrame, y: number, halfH: number, k: number, color: number, buckle: number | undefined): void {
  const { b, h } = f;
  const s = f.at(h * y);
  b.loft(
    [
      { y: h * y - halfH, rx: s.rx * k, rz: s.rz * k, cx: s.cx, cz: s.cz, pow: s.pow, color: tone(color, 0.92) },
      { y: h * y - halfH * 0.2, rx: s.rx * k * 1.004, rz: s.rz * k * 1.004, cx: s.cx, cz: s.cz, pow: s.pow, color },
      { y: h * y + halfH, rx: s.rx * k, rz: s.rz * k, cx: s.cx, cz: s.cz, pow: s.pow, color: tone(color, 1.06), crease: true },
    ],
    color,
    undefined,
    undefined,
    undefined,
    { capBottom: false, capTop: false },
  );
  if (buckle !== undefined) buckleAt(f, buckle, frontZ({ ...s, rz: s.rz * k }, 0) - 0.012, h * y, halfH);
}

/** The belt buckle in the spec's shape (index 0 is the square plate every belt had before the others existed), centred at height y with its face at z. */
function buckleAt(f: TorsoFrame, color: number, z: number, y: number, halfH: number): void {
  const { b } = f;
  const dark = tone(color, 0.7);
  switch (f.spec.buckle) {
    case 1: // a round disc with a raised boss
      b.cylinder(0.036, 0.036, 0.016, color, [0, y, z], [Math.PI / 2, 0, 0]);
      b.cylinder(0.024, 0.024, 0.02, dark, [0, y, z - 0.003], [Math.PI / 2, 0, 0]);
      b.sphere(0.011, color, [0, y, z - 0.014], [1, 1, 0.6]);
      break;
    case 2: // an oval plate, wider than tall, with an inset
      b.sphere(1, color, [0, y, z], [0.05, 0.034, 0.011]);
      b.sphere(1, dark, [0, y, z - 0.004], [0.036, 0.021, 0.011]);
      break;
    case 3: // a double-ring frame with a central bar and prong
      for (const sx of [-1, 1]) b.torus(0.026, 0.006, color, [sx * 0.026, y, z], [0, 0, 0]);
      b.box(0.012, halfH * 2.6, 0.014, color, [0, y, z]);
      b.box(0.05, 0.008, 0.01, dark, [0, y, z - 0.008]);
      break;
    case 4: // a crest plate: a shield with a red stone
      b.box(0.064, 0.048, 0.014, color, [0, y + 0.004, z]);
      b.cone(0.045, 0.03, color, [0, y - 0.03, z], [Math.PI / 2, Math.PI / 4, Math.PI]);
      b.box(0.04, 0.03, 0.016, dark, [0, y + 0.004, z - 0.003]);
      b.sphere(0.013, PALETTE.trim.gemRed, [0, y + 0.004, z - 0.012], [1, 1, 0.6]);
      break;
    default: // 0: the square plate
      b.box(0.07, halfH * 2.3, 0.03, color, [0, y, z]);
      b.box(0.045, halfH * 1.2, 0.034, dark, [0, y, z - 0.002]);
  }
}

/** A point on the torso surface at height y (metres) and azimuth phi, `lift` proud. */
function on(f: TorsoFrame, y: number, phi: number, lift: number): V3 {
  return ringSurface([{ y: y - 0.5, ...f.at(y), color: 0 }, { y: y + 0.5, ...f.at(y), color: 0 }])(phi, y, lift).p;
}

/** A cartridge: brass case with a lead tip, standing upright with its base at `p`. */
function cartridge(f: TorsoFrame, p: V3, tilt = 0, big = 1): void {
  const { b } = f;
  const brass = f.accent;
  b.cylinder(0.011 * big, 0.012 * big, 0.05 * big, brass, [p[0], p[1] + 0.025 * big, p[2]], [0, 0, tilt]);
  b.cone(0.011 * big, 0.025 * big, PALETTE.material.iron, [p[0] - Math.sin(tilt) * 0.06 * big, p[1] + 0.062 * big, p[2]], [0, 0, tilt]);
}

export function addBelt(f: TorsoFrame, c: BodyCtx): void {
  const { b, h, spec, burnt, accent } = f;
  const leather = c.leather;
  const waist = 0.2;
  const belt = spec.belt;
  if (belt === 1 || spec.jacket === 5 || spec.jacket === 10) band(f, waist, 0.022, 1.03, leather, accent);
  if (spec.jacket === 2 && belt === 0) band(f, waist, 0.02, 1.03, tone(leather, 0.9), accent);
  if (belt === 2) {
    band(f, waist + 0.02, 0.055, 1.03, singe(PALETTE.trim.cummerbund, burnt), undefined);
    // pleats: two darker folds across the front
    for (const y of [waist - 0.005, waist + 0.045]) {
      const s = f.at(h * y);
      b.loft(
        [{ y: h * y - 0.004, rx: s.rx * 1.034, rz: s.rz * 1.034, cx: s.cx, cz: s.cz, pow: s.pow, color: tone(PALETTE.trim.cummerbund, 0.7) }, { y: h * y + 0.004, rx: s.rx * 1.034, rz: s.rz * 1.034, cx: s.cx, cz: s.cz, pow: s.pow, color: tone(PALETTE.trim.cummerbund, 0.7), crease: true }],
        PALETTE.trim.cummerbund,
        undefined,
        undefined,
        undefined,
        { capBottom: false, capTop: false },
      );
    }
  }
  if (belt === 3) {
    // rope: a twisted cord round the waist, a knot at the left hip and two frayed tails
    const rope = singe(PALETTE.material.rope, burnt);
    band(f, waist, 0.017, 1.035, rope, undefined);
    const N = 22;
    for (let i = 0; i < N; i++) {
      const phi = -Math.PI + ((i + 0.5) / N) * Math.PI * 2;
      const p = on(f, h * waist, phi, 0.028);
      b.sphere(0.0125, i % 2 ? tone(rope, 0.78) : tone(rope, 1.12), p, [1, 0.8, 1]);
    }
    const k = on(f, h * waist, -0.9, 0.03);
    b.sphere(0.03, tone(rope, 0.9), k, [1, 1, 0.8]);
    for (const [dx, len] of [[-0.02, 0.24], [0.03, 0.18]] as const) {
      b.sweep(curve([k, [k[0] + dx, k[1] - len * 0.5, k[2] - 0.02], [k[0] + dx * 2, k[1] - len, k[2] - 0.015]], 6), (t) => ({ rx: 0.011 * (1 - 0.3 * t), rz: 0.011 * (1 - 0.3 * t), pow: 2, color: t > 0.85 ? tone(rope, 1.3) : rope }), rope, { side: [1, 0, 0], segments: 5, round: "both" });
    }
  }
  if (belt === 4) {
    // ammunition belt: a leather band with a row of loops, each holding a cartridge; a square brass buckle
    band(f, waist, 0.032, 1.032, tone(leather, 1.05), accent);
    const N = 11;
    for (let i = 0; i < N; i++) {
      const phi = -1.15 + (i / (N - 1)) * 2.3;
      if (Math.abs(phi) < 0.12) continue; // the buckle
      const p = on(f, h * waist - 0.03, phi, 0.036);
      cartridge(f, p);
      b.box(0.018, 0.012, 0.012, tone(leather, 0.7), [p[0], p[1] + 0.03, p[2]]);
    }
  }
  if (belt === 5) {
    // cross belts: two straps over the shoulders crossing on the chest and back at a brass plate, meeting a waist belt
    const strap = tone(leather, 1.1);
    band(f, waist, 0.018, 1.03, tone(leather, 0.95), accent);
    torsoRibbon(f, strap, 0.03, { sign: 1, hipY: h * 0.2, hipPhi: -0.95 });
    torsoRibbon(f, strap, 0.03, { sign: -1, hipY: h * 0.2, hipPhi: -0.95 });
    const y = h * 0.6;
    b.cylinder(0.04, 0.04, 0.012, accent, [0, y, frontZ(f.at(y), 0) - 0.03], [Math.PI / 2, 0, 0]);
    b.cylinder(0.026, 0.026, 0.016, tone(accent, 0.75), [0, y, frontZ(f.at(y), 0) - 0.034], [Math.PI / 2, 0, 0]);
  }
  if (belt === 6) {
    // bandolier: one broad strap from the right shoulder to the left hip, studded with cartridges in loops
    const strap = tone(leather, 1.05);
    torsoRibbon(f, strap, 0.05, { sign: 1, hipY: h * 0.18, hipPhi: -1.0, back: false });
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const y = h * (0.18 + (0.94 - 0.18) * t) + 0.005;
      const phi = -1.0 + (0.72 + 1.0) * t;
      const p = on(f, y - 0.02, phi, 0.03);
      cartridge(f, [p[0], p[1], p[2]], -0.55 * 0 + 0.0, 0.9);
    }
  }
}

export function addSash(f: TorsoFrame, c: BodyCtx): void {
  const { b, h, spec, burnt } = f;
  const s = spec.sash;
  const red = singe(PALETTE.trim.sashRed, burnt);
  const gold = singe(PALETTE.trim.sashGold, burnt);
  if (s === 1) torsoRibbon(f, red, 0.052, { sign: 1, hipY: h * 0.24, hipPhi: -1.0 });
  if (s === 2) band(f, 0.26, 0.06, 1.04, gold, undefined);
  if (s === 3) {
    // two sashes crossing on the chest, one over each shoulder
    torsoRibbon(f, red, 0.042, { sign: 1, hipY: h * 0.24, hipPhi: -1.0 });
    torsoRibbon(f, singe(PALETTE.trim.ribbonBlue, burnt), 0.042, { sign: -1, hipY: h * 0.24, hipPhi: -1.0 });
    const y = h * 0.6;
    b.sphere(0.03, c.accent, [0, y, frontZ(f.at(y), 0) - 0.028], [1, 1, 0.55]);
  }
  if (s === 4) {
    // a broad waist wrap, knotted at the side with two tasselled ends
    band(f, 0.26, 0.055, 1.045, red, undefined);
    const y = h * 0.26;
    const k = on(f, y, 0.9, 0.05);
    b.sphere(0.04, tone(red, 0.9), k, [1, 1, 0.8]);
    for (const [dx, len] of [[0.03, 0.26], [0.09, 0.2]] as const) {
      b.sweep(curve([k, [k[0] + dx * 0.5, k[1] - len * 0.5, k[2] - 0.02], [k[0] + dx, k[1] - len, k[2] - 0.015]], 6), (t) => ({ rx: 0.03 * (1 - 0.25 * t), rz: 0.012, pow: 2.4 }), red, { side: [1, 0, 0], segments: 5 });
      for (let i = 0; i < 4; i++) b.box(0.006, 0.05, 0.006, gold, [k[0] + dx + (i - 1.5) * 0.012, k[1] - len - 0.03, k[2] - 0.015]);
    }
  }
  if (s === 5) {
    // an order ribbon: a slim watered ribbon over the right shoulder with the order's badge hanging at the left hip
    const blue = singe(PALETTE.trim.ribbonBlue, burnt);
    torsoRibbon(f, blue, 0.028, { sign: 1, hipY: h * 0.16, hipPhi: -1.0 });
    const p = on(f, h * 0.16, -1.0, 0.035);
    b.sphere(0.022, gold, [p[0], p[1] - 0.02, p[2]], [1, 1, 0.6]);
    b.cylinder(0.032, 0.032, 0.008, gold, [p[0], p[1] - 0.075, p[2] - 0.006], [Math.PI / 2, 0, 0]);
    b.cylinder(0.02, 0.02, 0.01, red, [p[0], p[1] - 0.075, p[2] - 0.012], [Math.PI / 2, 0, 0]);
  }
}

/**
 * One hanging medal (style 1 ribbon drape, 2 cross, 3 star): a pin bar, a ribbon of two colours folded into a V, and the badge below it,
 * lying on the coat at (mx, my) with the surface at sz. Everything overlaps its neighbour, so the whole thing is one connected piece.
 */
function medal(f: TorsoFrame, style: number, metal: number, ribbon: number, stripe: number, mx: number, my: number, sz: number): void {
  const { b } = f;
  const zz = sz - 0.012;
  const by = my - 0.02; // the badge hangs lower than the old flat disc, under its ribbon
  b.box(0.05, 0.008, 0.008, tone(metal, 0.85), [mx, my + 0.05, zz + 0.002]); // the pin bar
  for (const sx of [-1, 1]) {
    b.box(0.017, 0.058, 0.006, ribbon, [mx + sx * 0.009, my + 0.026, zz + 0.001], [0, 0, sx * 0.3]);
    b.box(0.005, 0.058, 0.007, stripe, [mx + sx * 0.009, my + 0.026, zz - 0.001], [0, 0, sx * 0.3]);
  }
  if (style === 1) {
    b.cylinder(0.022, 0.022, 0.008, metal, [mx, by, zz], [Math.PI / 2, 0, 0]);
    b.torus(0.015, 0.004, tone(metal, 0.7), [mx, by, zz - 0.006], [0, 0, 0]);
  } else if (style === 2) {
    b.box(0.044, 0.014, 0.008, metal, [mx, by, zz]);
    b.box(0.014, 0.044, 0.008, metal, [mx, by, zz]);
    for (const [dx, dy] of [[0.022, 0], [-0.022, 0], [0, 0.022], [0, -0.022]] as const) b.box(dy === 0 ? 0.01 : 0.022, dx === 0 ? 0.01 : 0.022, 0.008, tone(metal, 1.1), [mx + dx, by + dy, zz]);
    b.sphere(0.008, stripe, [mx, by, zz - 0.006], [1, 1, 0.6]);
  } else {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.cone(0.011, 0.032, metal, [mx + Math.sin(a) * 0.014, by + Math.cos(a) * 0.014, zz], [0, 0, -a]);
    }
    b.cylinder(0.013, 0.013, 0.009, tone(metal, 0.8), [mx, by, zz - 0.002], [Math.PI / 2, 0, 0]);
  }
}

/** Pockets, on the front of the coat (not under a cape or poncho, which cover the torso). */
export function addPockets(f: TorsoFrame, c: BodyCtx): void {
  const { b, h, W, spec, burnt, accent } = f;
  const p = spec.pocket;
  if (p === 0 || spec.jacket === 6 || spec.jacket === 7) return;
  const z = (y: number, x: number): number => frontZ(f.at(y), x);
  const cloth = singe(spec.jacket === 0 ? c.shirtC : c.jacketC, burnt);
  const edge = tone(cloth, 0.62);
  const x = -W * 0.46;
  const y = h * 0.58;
  const sz = z(y, x) - 0.007;
  if (p === 1 || p === 2 || p === 4) {
    // a welted breast pocket: a patch a shade lighter than the coat, with a dark mouth
    b.box(0.072, 0.056, 0.007, tone(cloth, 1.08), [x, y - 0.006, sz]);
    b.box(0.076, 0.009, 0.01, edge, [x, y + 0.024, sz - 0.002]);
  }
  if (p === 2) {
    // a folded handkerchief: two points showing above the mouth
    for (const sx of [-1, 1]) b.box(0.02, 0.04, 0.007, PALETTE.trim.ivory, [x + sx * 0.012, y + 0.038, sz - 0.001], [0, 0, sx * 0.26]);
    b.box(0.012, 0.03, 0.008, singe(PALETTE.trim.ribbonRed, burnt), [x, y + 0.03, sz - 0.004]);
  }
  if (p === 4) {
    const cols = [PALETTE.trim.pencil, PALETTE.trim.ribbonRed, PALETTE.trim.frame];
    for (let i = 0; i < 3; i++) {
      const tilt = (i - 1) * 0.16;
      const px = x + (i - 1) * 0.017;
      b.cylinder(0.006, 0.006, 0.062, singe(cols[i]!, burnt), [px, y + 0.045, sz - 0.003], [0, 0, -tilt]);
      b.cone(0.006, 0.012, i === 0 ? PALETTE.trim.ivory : accent, [px - Math.sin(tilt) * 0.038, y + 0.082, sz - 0.003], [0, 0, -tilt]);
    }
  }
  if (p === 3) {
    // a pair of flap pockets low on the front, each with a button
    for (const sx of [-1, 1]) {
      const fx = sx * W * 0.4;
      const fy = h * 0.33;
      const fz = z(fy, fx) - 0.007;
      b.box(0.1, 0.008, 0.008, edge, [fx, fy + 0.02, fz]);
      b.box(0.1, 0.034, 0.009, tone(cloth, 1.06), [fx, fy, fz - 0.001], [0, 0, sx * 0.12]);
      b.sphere(0.008, accent, [fx, fy - 0.004, fz - 0.008], [1, 1, 0.6]);
    }
  }
}

export function addDecorations(f: TorsoFrame, _c: BodyCtx): void {
  const { b, h, W, spec, burnt, accent } = f;
  const z = (y: number, x: number): number => frontZ(f.at(y), x);
  // medals on the left breast (-X), pinned to the surface
  const ribbons = [PALETTE.trim.ribbonRed, PALETTE.trim.ribbonBlue, PALETTE.trim.ribbonGreen, PALETTE.trim.ribbonPurple];
  for (let i = 0; i < spec.medals; i++) {
    const mx = -W * 0.5 + (i % 3) * 0.055;
    const my = h * 0.74 - Math.floor(i / 3) * 0.07;
    const sz = z(my, mx);
    if (spec.medalStyle === 0) {
      b.cylinder(0.026, 0.026, 0.008, i % 2 ? K.ACCENT_COLORS[1]! : accent, [mx, my, sz - 0.012], [Math.PI / 2, 0, 0]);
      b.box(0.02, 0.05, 0.006, i % 2 ? PALETTE.trim.ribbonBlue : PALETTE.trim.ribbonRed, [mx, my + 0.04, sz - 0.008]);
      continue;
    }
    medal(f, spec.medalStyle, [K.ACCENT_COLORS[i % 3 === 1 ? 1 : 0]!, PALETTE.trim.bronze, accent][i % 3]!, singe(ribbons[i % 4]!, burnt), singe(ribbons[(i + 1) % 4]!, burnt), mx, my, sz);
  }
  const d = spec.decoration;
  if (d === 1) {
    // ribbon bars: a row of little coloured rectangles above the pocket
    const cols = [PALETTE.trim.ribbonBlue, PALETTE.trim.ribbonRed, PALETTE.trim.ribbonGreen, PALETTE.trim.ribbonPurple];
    for (let i = 0; i < 4; i++) {
      const x = -W * 0.6 + i * 0.026;
      const y = h * 0.84;
      b.box(0.024, 0.02, 0.008, singe(cols[i]!, burnt), [x, y, z(y, x) - 0.008]);
    }
  } else if (d === 2) {
    // order star: a many-pointed star on the right breast
    const x = W * 0.46;
    const y = h * 0.66;
    const sz = z(y, x) - 0.012;
    b.cylinder(0.024, 0.024, 0.01, tone(accent, 0.85), [x, y, sz - 0.004], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.cone(0.012, 0.05, i % 2 ? tone(accent, 0.8) : accent, [x + Math.sin(a) * 0.035, y + Math.cos(a) * 0.035, sz], [Math.PI / 2, 0, -a]);
    }
    b.sphere(0.014, PALETTE.trim.gemRed, [x, y, sz - 0.014], [1, 1, 0.6]);
  } else if (d === 3) {
    // regimental badge: a small shield on the left breast pocket
    const x = -W * 0.5;
    const y = h * 0.66;
    const sz = z(y, x) - 0.012;
    b.box(0.05, 0.05, 0.01, accent, [x, y, sz]);
    b.cone(0.035, 0.03, accent, [x, y - 0.04, sz], [Math.PI / 2, Math.PI / 4, Math.PI]);
    b.box(0.03, 0.03, 0.012, PALETTE.trim.ribbonRed, [x, y + 0.002, sz - 0.004]);
  } else if (d === 4) {
    // rosette: a pleated cockade with two ribbon tails on the left lapel
    const x = -W * 0.36;
    const y = h * 0.8;
    const sz = z(y, x) - 0.014;
    b.torus(0.032, 0.012, PALETTE.trim.ribbonRed, [x, y, sz], [0, 0, 0]);
    b.torus(0.018, 0.01, PALETTE.trim.ivory, [x, y, sz - 0.008], [0, 0, 0]);
    b.sphere(0.012, accent, [x, y, sz - 0.014]);
    for (const sx of [-1, 1]) b.box(0.02, 0.07, 0.006, sx > 0 ? PALETTE.trim.ribbonBlue : PALETTE.trim.ribbonRed, [x + sx * 0.014, y - 0.055, sz - 0.002], [0, 0, sx * 0.2]);
  }
}
