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
  if (buckle !== undefined) {
    const z = frontZ({ ...s, rz: s.rz * k }, 0) - 0.012;
    f.b.box(0.07, halfH * 2.3, 0.03, buckle, [0, h * y, z]);
    f.b.box(0.045, halfH * 1.2, 0.034, tone(buckle, 0.7), [0, h * y, z - 0.002]);
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

export function addDecorations(f: TorsoFrame, _c: BodyCtx): void {
  const { b, h, W, spec, burnt, accent } = f;
  const z = (y: number, x: number): number => frontZ(f.at(y), x);
  // medals on the left breast (-X), pinned to the surface
  for (let i = 0; i < spec.medals; i++) {
    const mx = -W * 0.5 + (i % 3) * 0.055;
    const my = h * 0.74 - Math.floor(i / 3) * 0.07;
    const sz = z(my, mx);
    b.cylinder(0.026, 0.026, 0.008, i % 2 ? K.ACCENT_COLORS[1]! : accent, [mx, my, sz - 0.012], [Math.PI / 2, 0, 0]);
    b.box(0.02, 0.05, 0.006, i % 2 ? PALETTE.trim.ribbonBlue : PALETTE.trim.ribbonRed, [mx, my + 0.04, sz - 0.008]);
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
