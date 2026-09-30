import { Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { CREAM, LEATHER, PartBuilder, WOOD, singe, type V3 } from "./parts.ts";
import { curve } from "./sweep.ts";
import { ringAt } from "./bodyKit.ts";
import { alongY, mount, type Surf } from "./fit/surface.ts";
import { bandAround, buttonOn, hangingStrip, ribbon, seat, shoulderY, type RibbonStop } from "./fit/torsoKit.ts";

/**
 * Expedition gear that hangs on the torso bone: neckwear, packs and hip gear. Everything is PLACED by asking the trunk's surface as drawn (`f.s`, fit/surface.ts):
 * a pack's back panel stands on the back's most prominent point over its height, its straps are ribbons laid on the surface over the shoulder and down the chest, hip gear
 * stands off the widest of the torso, the coat skirt and the thighs (`f.reach`), neckwear wraps the collar it sits on (`f.neck`). Sizes come from the body (section widths,
 * torso height), never from a fixed offset, so the same option fits a beanpole and a paunch.
 */
export interface TorsoFrame {
  b: PartBuilder;
  spec: CharacterSpec;
  P: Proportions;
  h: number;
  /** Half the torso width (the slider), kept for proportions. */
  W: number;
  D: number;
  neckY: number;
  nr: number;
  burnt: number;
  accent: number;
  /** Canvas / cloth colour for neckwear and packs (a dye from the palette). */
  dye: number;
  /** The surface gear rests on: the trunk as lofted, or the cape's / poncho's cloth over it. */
  s: Surf;
  /** The trunk loft itself (belts, medals and pockets are under a drape). */
  trunk: Surf;
  /** Thickness of the coat's facings and patches over `s` (a strap goes above them). */
  layer: number;
  /** How proud the cloth already laid on the trunk is at lateral offset x, torso height y (a medal on a lapel stands on it). */
  layerAt(x: number, y: number): number;
  /** How far the body's outermost cloth reaches from the spine around the hips (torso, coat skirt, thighs), the widest over torso-frame heights y..y1 (an item that hangs down a skirt clears the skirt's widest part). */
  reach(y: number, y1?: number): { x: number; f: number; b: number };
  /** Half-axes of the surface round the neck at height y (bare neck, torso top and collar) plus a gap. */
  neck(y: number, gap?: number): { rx: number; rz: number };
  at(y: number): { rx: number; rz: number; cx: number; cz: number; pow: number };
  tone(color: number, k: number): number;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
/** Gear grows with the wearer's torso (a big man carries a big pack), within limits. */
const gearScale = (f: TorsoFrame): number => clamp(f.h / 0.6, 0.8, 1.18);
const STRAP = 0.0075;

/** z of the plane a pack's back face rests on: the back's most prominent point over the pack's height and half width. */
function backSeat(f: TorsoFrame, y0: number, y1: number, halfW: number): number {
  let z = -Infinity;
  for (let i = 0; i <= 6; i++) {
    const y = y0 + ((y1 - y0) * i) / 6;
    for (const x of [-halfW, 0, halfW]) z = Math.max(z, f.s.back(y, x));
  }
  return z;
}

/** Half the width of the trunk's back at height y (what a pack sits across). */
const backHalf = (f: TorsoFrame, y: number): number => f.s.section(y).rx;

/**
 * A pack strap: a ribbon from the pack (back, height yBack) up to the top of the shoulder where the trunk is `xs` from the spine, over it, and down the front to the chest
 * (azimuth `frontPhi`, height yFront). It follows the surface the whole way, so it seats on any shoulder width and any belly.
 */
function shoulderStrap(f: TorsoFrame, sx: 1 | -1, o: { yBack: number; xBack: number; xs?: number; yFront: number; frontPhi: number; half?: number; color: number }): void {
  const { s, h } = f;
  const xs = (o.xs ?? 0.5) * s.section(h * 0.87).rx * sx;
  const ys = shoulderY(s, h, Math.abs(xs));
  const front = s.atX(xs, ys, 0).phi;
  const back = s.atX(xs, ys, 0, true).phi;
  const backLow = s.atX(sx * o.xBack, o.yBack, 0, true).phi;
  const stops: RibbonStop[] = [
    { phi: backLow, y: o.yBack },
    { phi: back, y: ys },
    { phi: front, y: ys },
    { phi: sx * o.frontPhi, y: o.yFront },
  ];
  ribbon(f.b, s, o.color, stops, o.half ?? 0.028, STRAP, { base: f.layer });
}

/** A cross-body strap: from one shoulder over the chest to the opposite hip (front) and back down the back (a sling, a satchel or an order ribbon). */
export function crossStrap(f: TorsoFrame, color: number, half: number, o: { sign: 1 | -1; hipY: number; hipPhi: number; front?: boolean; back?: boolean; thick?: number }): void {
  const { s, h } = f;
  const xs = o.sign * 0.5 * s.section(h * 0.87).rx;
  const ys = shoulderY(s, h, Math.abs(xs));
  const front = s.atX(xs, ys, 0).phi;
  const back = s.atX(xs, ys, 0, true).phi;
  // (hipPhi is the azimuth of the low front end for the +1 strap; the other shoulder mirrors it)
  const lowFront = o.sign * o.hipPhi;
  const stops: RibbonStop[] = [];
  if (o.front !== false) stops.push({ phi: lowFront, y: o.hipY });
  stops.push({ phi: front, y: ys }, { phi: back, y: ys });
  if (o.back !== false) stops.push({ phi: Math.PI - lowFront, y: o.hipY });
  ribbon(f.b, s, color, stops, half, o.thick ?? STRAP, { base: f.layer, round: o.front === false ? "end" : o.back === false ? "start" : "both" });
}

export function addNeckwear(f: TorsoFrame): void {
  const { b, spec, neckY } = f;
  const sc = clamp(f.h / 0.6, 0.85, 1.15);
  const dye = f.dye;
  const ring = (y: number, gap: number, color: number) => {
    const r = f.neck(y, gap);
    return { y, rx: r.rx, rz: r.rz, color };
  };
  const zNeck = (y: number, gap = 0): number => -f.neck(y, gap).rz;
  if (spec.neckwear === 1) {
    // cravat: a soft roll round the collar, a knot, two tails down the front
    b.loft([ring(neckY - 0.035, 0.012, f.tone(dye, 0.85)), { ...ring(neckY + 0.05, 0.008, dye), crease: true }], dye);
    b.sphere(0.05 * sc, dye, [0, neckY - 0.012, zNeck(neckY - 0.012, 0.012) - 0.026 * sc], [1.15, 1, 0.8]);
    for (const sx of [-1, 1]) hangingStrip(b, f.s, sx * 0.032, neckY - 0.03, neckY - 0.03 - 0.19 * sc, 0.036 * sc, 0.007, sx > 0 ? f.tone(dye, 0.9) : dye, { base: f.layer });
  } else if (spec.neckwear === 2) {
    // bow tie
    const z = zNeck(neckY - 0.012, 0.012) - 0.018;
    for (const sx of [-1, 1]) b.cone(0.055 * sc, 0.1 * sc, dye, [sx * 0.07 * sc, neckY - 0.012, z], [0, 0, (sx * Math.PI) / 2], [1, 1, 0.55]);
    b.sphere(0.028 * sc, f.tone(dye, 0.8), [0, neckY - 0.012, z - 0.004]);
    b.loft([ring(neckY - 0.03, 0.004, f.tone(dye, 0.7)), ring(neckY + 0.005, 0.004, f.tone(dye, 0.7))], dye); // (the band it is tied on)
  } else if (spec.neckwear === 3) {
    // scarf: two turns round the neck, a knot at the side, one long tail with a stripe and a fringe
    const r1 = f.neck(neckY + 0.005, 0.048);
    const r2 = f.neck(neckY - 0.045, 0.036);
    b.torus(Math.max(r1.rx, r1.rz), 0.05, dye, [0, neckY + 0.005, 0], [Math.PI / 2, 0, 0], [r1.rx / Math.max(r1.rx, r1.rz), r1.rz / Math.max(r1.rx, r1.rz), 1]);
    b.torus(Math.max(r2.rx, r2.rz), 0.038, f.tone(dye, 0.78), [0, neckY - 0.045, 0], [Math.PI / 2, 0, 0], [r2.rx / Math.max(r2.rx, r2.rz), r2.rz / Math.max(r2.rx, r2.rz), 1]);
    const x = -r2.rx * 0.8;
    b.sphere(0.06 * sc, dye, [x, neckY - 0.03, zNeck(neckY - 0.03, 0.05) - 0.01], [1, 1, 0.9]);
    hangingStrip(b, f.s, x, neckY - 0.06, neckY - 0.36 * sc, 0.05 * sc, 0.009, dye, { base: f.layer, colorAt: (t) => (t > 0.5 && t < 0.58 ? f.tone(dye, 0.7) : dye) });
    for (let i = 0; i < 4; i++) hangingStrip(b, f.s, x + (i - 1.5) * 0.02, neckY - 0.36 * sc + 0.01, neckY - 0.42 * sc, 0.005, 0.004, dye, { base: f.layer });
  } else if (spec.neckwear === 4) {
    // ascot: a broad silk band folded into the collar, a puffed cross-over at the throat and a pin
    b.loft([ring(neckY - 0.045, 0.012, f.tone(dye, 0.85)), { ...ring(neckY + 0.045, 0.008, dye), crease: true }], dye);
    const z = zNeck(neckY - 0.06, 0.012) - 0.026;
    for (const sx of [-1, 1]) b.sphere(0.06 * sc, sx > 0 ? f.tone(dye, 0.92) : dye, [sx * 0.035, neckY - 0.06, z], [0.85, 1.35, 0.6], [0, 0, sx * 0.4]);
    b.sphere(0.014, PALETTE.trim.pearl, [0, neckY - 0.055, z - 0.028]);
  } else if (spec.neckwear === 5) {
    // neckerchief: knotted at the front, the triangle hanging down the chest
    b.loft([ring(neckY - 0.03, 0.012, f.tone(dye, 0.88)), { ...ring(neckY + 0.04, 0.008, dye), crease: true }], dye);
    b.sphere(0.036 * sc, f.tone(dye, 0.85), [0, neckY - 0.01, zNeck(neckY - 0.01, 0.012) - 0.02], [1.2, 1, 0.8]);
    // the triangle lies on the chest: three strips narrowing downward
    for (let i = 0; i < 3; i++) hangingStrip(b, f.s, 0, neckY - 0.03 - i * 0.045 * sc, neckY - 0.075 - i * 0.045 * sc, (0.085 - i * 0.028) * sc, 0.006, i % 2 ? f.tone(dye, 0.94) : dye, { base: f.layer, round: undefined });
  } else if (spec.neckwear === 6) {
    // ruff: a wheel of pleated linen round the neck
    const linen = singe(CREAM, f.burnt);
    const r1 = f.neck(neckY + 0.005, 0.03);
    const R = Math.max(r1.rx, r1.rz) * 1.25;
    b.torus(R, 0.032, linen, [0, neckY + 0.005, 0], [Math.PI / 2, 0, 0], [r1.rx / Math.max(r1.rx, r1.rz), r1.rz / Math.max(r1.rx, r1.rz), 1]);
    const r2 = f.neck(neckY - 0.03, 0.026);
    const R2 = Math.max(r2.rx, r2.rz) * 1.2;
    b.torus(R2, 0.028, f.tone(linen, 0.9), [0, neckY - 0.03, 0], [Math.PI / 2, 0, 0], [r2.rx / Math.max(r2.rx, r2.rz), r2.rz / Math.max(r2.rx, r2.rz), 1]);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      b.sphere(0.034, i % 2 ? linen : f.tone(linen, 0.92), [Math.sin(a) * (r1.rx + 0.045), neckY + 0.005, Math.cos(a) * (r1.rz + 0.045)], [1, 0.7, 1]);
    }
    b.loft([ring(neckY - 0.04, 0.006, f.tone(linen, 0.8)), ring(neckY + 0.03, 0.006, linen)], linen);
  } else if (spec.neckwear === 7) {
    // fur collar: a shaggy pelt standing up round the neck and hanging in two lobes down the front
    const fur = singe(PALETTE.material.fur, f.burnt);
    b.loft([ring(neckY + 0.06, 0.02, f.tone(fur, 1.1)), { ...ring(neckY, 0.05, fur), rx: f.neck(neckY, 0.05).rx * 1.12, rz: f.neck(neckY, 0.05).rz * 1.12, pow: 2.3 }, { ...ring(neckY - 0.07, 0.055, f.tone(fur, 0.8)), pow: 2.3 }], fur, undefined, undefined, undefined, { capTop: false, capBottom: false });
    for (const sx of [-1, 1]) {
      const sp = f.s.atX(sx * f.neck(neckY - 0.1).rx * 0.9, neckY - 0.1, 0);
      const m = mount(sp);
      b.sphere(0.075 * sc, f.tone(fur, sx > 0 ? 0.95 : 1.05), [sp.p[0] + sp.n[0] * 0.03, sp.p[1] + sp.n[1] * 0.03, sp.p[2] + sp.n[2] * 0.03], [1, 1.6, 0.7], m.rot);
    }
  } else if (spec.neckwear === 8) {
    // muffler: a long knitted scarf, two turns and both ends hanging in front, banded in the cloth's own dye and cream
    const band = singe(CREAM, f.burnt);
    const r1 = f.neck(neckY + 0.01, 0.05);
    const r2 = f.neck(neckY - 0.05, 0.04);
    const m1 = Math.max(r1.rx, r1.rz);
    const m2 = Math.max(r2.rx, r2.rz);
    b.torus(m1, 0.05, dye, [0, neckY + 0.01, 0], [Math.PI / 2, 0, 0], [r1.rx / m1, r1.rz / m1, 1]);
    b.torus(m2, 0.04, f.tone(dye, 0.8), [0, neckY - 0.05, 0], [Math.PI / 2, 0, 0], [r2.rx / m2, r2.rz / m2, 1]);
    for (const [dx, len] of [[-0.05, 0.4], [0.06, 0.32]] as const) {
      hangingStrip(b, f.s, dx, neckY - 0.06, neckY - len * sc, 0.05, 0.009, dye, { base: f.layer, colorAt: (t) => (Math.sin(t * 24) > 0.2 ? band : dye) });
    }
  }
}

export function addPack(f: TorsoFrame): void {
  const { b, spec, h, dye, s } = f;
  const u = gearScale(f);
  const canvas = f.tone(dye, 0.9);
  const brass = f.accent;
  const leather = singe(LEATHER, f.burnt);
  const strapDrop = f.layer;
  if (spec.pack === 1) {
    // rucksack with a flap, two buckled straps and shoulder straps over the chest
    const yLo = h * 0.2;
    const yHi = h * 0.86;
    const Wb = backHalf(f, h * 0.5);
    const hw = Wb * 0.7;
    const z0 = backSeat(f, yLo, yHi, hw) + 0.004;
    const d = 0.25 * u;
    b.loft(
      [
        { y: yLo, rx: hw * 0.8, rz: d * 0.3, cz: z0 + d * 0.3, pow: 3, color: f.tone(canvas, 0.75) },
        { y: h * 0.4, rx: hw, rz: d * 0.5, cz: z0 + d * 0.5, pow: 3, color: canvas },
        { y: h * 0.7, rx: hw * 0.98, rz: d * 0.5, cz: z0 + d * 0.5, pow: 3, color: canvas },
        { y: yHi, rx: hw * 0.75, rz: d * 0.32, cz: z0 + d * 0.32, pow: 3, color: f.tone(canvas, 1.1) },
      ],
      canvas,
    );
    b.box(hw * 1.7, h * 0.17, 0.05 * u, f.tone(canvas, 0.68), [0, h * 0.78, z0 + d * 0.94], [-0.12, 0, 0]);
    b.box(hw * 1.25, h * 0.13, 0.06 * u, f.tone(canvas, 0.8), [0, h * 0.3, z0 + d * 0.82]); // lower pocket
    for (const sx of [-1, 1]) {
      b.box(0.035, h * 0.24, 0.012, leather, [sx * hw * 0.45, h * 0.7, z0 + d * 1.0]);
      b.box(0.04, 0.03, 0.02, brass, [sx * hw * 0.45, h * 0.6, z0 + d * 1.02]);
      shoulderStrap(f, sx as 1 | -1, { yBack: h * 0.74, xBack: hw * 0.55, yFront: h * 0.38, frontPhi: 1.12, xs: 0.5, half: 0.03, color: leather });
    }
  } else if (spec.pack === 2) {
    // bedroll: a rolled blanket across the shoulders, strapped, spiral ends
    const y = h * 0.84;
    const r = 0.085 * u;
    const len = Math.min(2 * backHalf(f, y) * 1.12, 0.62) + 0.02;
    const z = backSeat(f, y - r, y + r, len / 2 - r) + r + 0.004;
    b.cylinder(r, r, len, canvas, [0, y, z], [0, 0, Math.PI / 2]);
    b.cylinder(r * 1.03, r * 1.03, len * 0.12, f.tone(dye, 0.7), [len * 0.36, y, z], [0, 0, Math.PI / 2]);
    b.cylinder(r * 1.03, r * 1.03, len * 0.12, f.tone(dye, 0.7), [-len * 0.36, y, z], [0, 0, Math.PI / 2]);
    for (const sx of [-1, 1]) {
      b.torus(r * 0.6, 0.008, f.tone(dye, 0.6), [sx * (len / 2 + 0.002), y, z], [0, Math.PI / 2, 0]);
      b.torus(r * 1.04, 0.013, leather, [sx * len * 0.24, y, z], [0, Math.PI / 2, 0]);
      b.box(0.03, 0.03, 0.02, brass, [sx * len * 0.24, y, z - r * 1.03]);
      shoulderStrap(f, sx as 1 | -1, { yBack: y - r * 0.7, xBack: len * 0.24, yFront: h * 0.46, frontPhi: 1.05, xs: 0.5, half: 0.028, color: leather });
    }
  } else if (spec.pack === 3) {
    // satchel at the left hip on a diagonal strap
    const y = h * 0.02;
    const rc = f.reach(y - 0.13 * u, y + 0.2 * u);
    const bw = 0.11 * u;
    const zc = (rc.b - rc.f) / 2;
    const x = -(rc.x + bw / 2 + 0.008);
    b.box(bw, 0.25 * u, 0.32 * u, leather, [x, y, zc]);
    b.box(bw * 1.14, 0.09 * u, 0.34 * u, f.tone(leather, 0.8), [x, y + 0.11 * u, zc], [0, 0, 0.05]);
    b.box(0.03, 0.05, 0.05, brass, [x - bw / 2 - 0.004, y + 0.06 * u, zc]);
    b.box(0.02, 0.2 * u, 0.14 * u, f.tone(leather, 1.2), [x - bw / 2 - 0.008, y - 0.02, zc]);
    // the strap: right shoulder, down the chest to the left hip, and down the back; it meets the bag's top ring
    const top = y + 0.125 * u + 0.05;
    crossStrap(f, leather, 0.033, { sign: 1, hipY: top, hipPhi: -1.35, front: true, back: true });
    const ring: V3 = [x + 0.03, y + 0.15 * u, zc];
    b.sphere(0.028, brass, ring); // strap ring
    const side = s.at(-Math.PI / 2, top, 0.004).p;
    b.sweep(curve([side, [side[0] - 0.02, top + 0.005, side[2]], [ring[0] - 0.01, ring[1] + 0.005, ring[2]]], 6), () => ({ rx: 0.016, rz: 0.005, pow: 2.4 }), leather, { side: [0, 0, 1], segments: 4, round: "both" });
  } else if (spec.pack === 4) {
    // a naturalist's specimen case on the back, with a butterfly net lashed to it
    const yc = h * 0.5;
    const hh = h * 0.22;
    const Wb = backHalf(f, yc);
    const hw = Wb * 0.66;
    const dd = 0.19 * u;
    const z0 = backSeat(f, yc - hh, yc + hh, hw) + 0.004;
    const zc = z0 + dd / 2;
    b.box(hw * 2, hh * 2, dd, f.tone(leather, 1.05), [0, yc, zc]);
    b.box(hw * 2.06, 0.03, dd * 1.04, f.tone(leather, 0.8), [0, yc, zc]); // lid seam
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.box(0.05, 0.05, dd * 1.1, brass, [sx * hw * 0.95, yc + sy * hh * 0.95, zc]);
    b.box(0.05, hh * 2.1, dd * 1.05, f.tone(leather, 0.7), [0, yc, zc]);
    b.box(0.07, 0.05, 0.03, brass, [0, yc, z0 + dd + 0.01]);
    for (const sx of [-1, 1]) shoulderStrap(f, sx as 1 | -1, { yBack: yc + hh * 0.7, xBack: hw * 0.6, yFront: h * 0.4, frontPhi: 1.15, xs: 0.5, color: leather });
    // the net: pole, hoop, gauze cone
    const dir: V3 = [0.3, 0.94, 0.12];
    const base: V3 = [hw * 0.7, h * 0.28, z0 + dd + 0.01];
    const L = 1.0;
    const dv = new Vector3(...dir).normalize();
    const mid: V3 = [base[0] + dv.x * L * 0.5, base[1] + dv.y * L * 0.5, base[2] + dv.z * L * 0.5];
    b.cylinder(0.012, 0.014, L, WOOD, mid, alongY(dir));
    const top: V3 = [base[0] + dv.x * L, base[1] + dv.y * L, base[2] + dv.z * L];
    b.torus(0.15, 0.009, PALETTE.material.iron, [top[0] + dv.x * 0.05, top[1] + dv.y * 0.05, top[2] + dv.z * 0.05], alongY(dir).map((v, i) => (i === 0 ? v + Math.PI / 2 : v)) as unknown as V3);
    b.cone(0.15, 0.36, singe(CREAM, f.burnt), [top[0] + dv.x * -0.09 + 0.02, top[1] - 0.12, top[2] + dv.z * 0.05 + 0.02], [Math.PI, 0, 0], [1, 1, 1]);
  } else if (spec.pack === 5) {
    // a tin trunk lugged on the back: painted tin, iron corners and bands, a brass lock and a rope handle over the shoulders
    const yc = h * 0.5;
    const hh = h * 0.25;
    const hw = backHalf(f, yc) * 0.74;
    const dd = 0.26 * u;
    const z0 = backSeat(f, yc - hh, yc + hh, hw) + 0.004;
    const zc = z0 + dd / 2;
    const tin = f.tone(dye, 0.75);
    const iron = PALETTE.material.iron;
    b.box(hw * 2, hh * 2, dd, tin, [0, yc, zc]);
    b.box(hw * 2.08, 0.03, dd * 1.04, f.tone(tin, 0.7), [0, yc + hh - 0.06, zc]);
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) b.box(0.05, 0.05, dd * 1.08, iron, [sx * hw * 0.96, yc + sy * hh * 0.96, zc]);
    for (const sx of [-1, 1]) b.box(0.03, hh * 2.08, dd * 1.06, iron, [sx * hw * 0.4, yc, zc]);
    b.box(0.06, 0.07, 0.03, brass, [0, yc + hh * 0.5, z0 + dd + 0.012]);
    for (const sx of [-1, 1]) shoulderStrap(f, sx as 1 | -1, { yBack: yc + hh * 0.8, xBack: hw * 0.55, yFront: h * 0.4, frontPhi: 1.15, xs: 0.5, half: 0.03, color: leather });
    b.sweep(curve([[-hw * 0.5, yc + hh * 0.9, z0 + dd], [0, yc + hh + 0.06, z0 + dd + 0.02], [hw * 0.5, yc + hh * 0.9, z0 + dd]], 7), () => ({ rx: 0.012, rz: 0.012, pow: 2 }), singe(PALETTE.material.rope, f.burnt), { side: [0, 1, 0], segments: 5, round: "both" });
  } else if (spec.pack === 6) {
    // a rifle slung diagonally across the back: walnut stock, long barrel, brass sling swivels and a leather sling round the chest
    const iron = PALETTE.material.iron;
    const y0 = h * 0.08;
    const Wb = backHalf(f, h * 0.5);
    // from the low left of the back to just past the right shoulder: the muzzle clears the shoulder, never the head
    const end = new Vector3(Wb * 0.75, h * 1.0, 0);
    const base = new Vector3(-Wb * 0.85, y0, 0);
    const dir = end.clone().sub(base).setZ(0);
    const L = dir.length() * 1.06;
    dir.normalize();
    const pts = (t: number): V3 => [base.x + dir.x * L * t, base.y + dir.y * L * t, 0];
    const r = 0.036;
    // seat the whole rifle on the back's most prominent point along its length
    let zr = -Infinity;
    for (let i = 0; i <= 8; i++) {
      const p = pts((i / 8) * 0.6);
      zr = Math.max(zr, s.back(clamp(p[1], 0, h * 0.97), p[0]));
    }
    const zR = zr + r + 0.004;
    const p = (t: number): V3 => {
      const q = pts(t);
      return [q[0], q[1], zR];
    };
    const rot = alongY([dir.x, dir.y, 0]);
    b.cylinder(0.036, 0.05, L * 0.34, WOOD, p(0.17), rot); // stock
    b.cylinder(0.014, 0.028, L * 0.5, iron, p(0.65), rot); // barrel
    b.cylinder(0.02, 0.02, L * 0.24, f.tone(WOOD, 1.1), p(0.6), rot); // fore-end
    b.sphere(0.02, brass, p(0.33));
    b.sphere(0.02, brass, p(0.88));
    crossStrap(f, leather, 0.02, { sign: 1, hipY: h * 0.3, hipPhi: -0.9, front: true, back: false });
  } else if (spec.pack === 7) {
    // a folding easel and canvas: three wooden legs strapped in a bundle with a canvas board, paint box hanging beneath
    const yc = h * 0.58;
    const hh = h * 0.25;
    const hw = backHalf(f, yc) * 0.6;
    const zb = backSeat(f, yc - hh, yc + hh, hw) + 0.004;
    const canvasC = singe(CREAM, f.burnt);
    b.box(hw * 2, hh * 2, 0.03, canvasC, [0, yc, zb + 0.015]);
    b.box(hw * 2.1, hh * 2.1, 0.02, f.tone(WOOD, 0.9), [0, yc, zb + 0.04]);
    const legL = h * 0.98; // the bundle ends at the shoulders: legs any longer would run up the back of the head
    for (const sx of [-1, 0, 1]) b.cylinder(0.016, 0.014, legL, WOOD, [sx * 0.07, h * 0.05 + legL / 2, zb + 0.08], [0, 0, sx * 0.05]);
    for (const sy of [0.45, 0.72]) b.box(hw * 2.2, 0.03, 0.08, leather, [0, h * sy, zb + 0.06]);
    b.box(0.2, 0.13, 0.09, f.tone(leather, 1.05), [0, h * 0.08, zb + 0.05]);
    b.box(0.06, 0.03, 0.02, brass, [0, h * 0.11, zb + 0.098]);
    for (const sx of [-1, 1]) shoulderStrap(f, sx as 1 | -1, { yBack: yc + hh * 0.7, xBack: hw * 0.7, yFront: h * 0.4, frontPhi: 1.15, xs: 0.5, half: 0.026, color: leather });
  } else if (spec.pack === 8) {
    // a birdcage on a strap at the hip: brass ring, bars, a domed roof and a small yellow occupant
    const y0 = h * 0.02;
    const R = 0.1 * u;
    const bh0 = 0.26 * u;
    const rc = f.reach(y0 - bh0 / 2 - 0.03, y0 + bh0 / 2 + 0.2);
    const cx = -(rc.x + R + 0.012);
    const cy = y0 + 0.0;
    const cz = (rc.b - rc.f) / 2;
    const bars = 12;
    const bh = 0.26 * u;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      b.cylinder(0.005, 0.005, bh, brass, [cx + Math.sin(a) * R, cy, cz + Math.cos(a) * R]);
    }
    b.torus(R, 0.008, brass, [cx, cy - bh / 2, cz], [Math.PI / 2, 0, 0]);
    b.torus(R, 0.008, brass, [cx, cy + bh / 2, cz], [Math.PI / 2, 0, 0]);
    b.cylinder(R, R, 0.02, WOOD, [cx, cy - bh / 2 - 0.01, cz]);
    b.cone(R, 0.09, brass, [cx, cy + bh / 2 + 0.045, cz]);
    b.torus(0.03, 0.006, brass, [cx, cy + bh / 2 + 0.105, cz], [0, 0, 0]);
    b.cylinder(0.006, 0.006, R * 2, WOOD, [cx, cy - 0.05, cz], [0, 0, Math.PI / 2]); // the perch
    b.sphere(0.034, PALETTE.trim.straw, [cx, cy - 0.015, cz]);
    b.sphere(0.02, PALETTE.trim.straw, [cx + 0.03, cy + 0.02, cz]);
    // the hanging strap: from the cage's ring up to a hook on the belt at the hip
    const hookY = h * 0.15;
    const hook: V3 = s.at(-Math.PI / 2, hookY, 0.006).p;
    b.sweep(curve([[cx, cy + bh / 2 + 0.105, cz], [cx + 0.03, cy + bh / 2 + 0.16, cz], hook], 8), () => ({ rx: 0.013, rz: 0.006, pow: 2.4 }), leather, { side: [0, 0, 1], segments: 4, round: "both" });
    crossStrap(f, leather, 0.03, { sign: 1, hipY: hookY, hipPhi: -1.35, front: true, back: true });
  } else if (spec.pack === 9) {
    // a furled umbrella through the back of the belt: tapered silk, a wooden crook and a steel ferrule
    const silk = f.tone(dye, 0.55);
    const dir = new Vector3(-0.32, 1, 0).normalize();
    const L = Math.min(0.95 * u, h * 1.02);
    const Wb = backHalf(f, h * 0.3);
    const base0 = new Vector3(Wb * 0.6, h * 0.08, 0);
    let zr = -Infinity;
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * 0.75;
      zr = Math.max(zr, s.back(clamp(base0.y + dir.y * L * t, 0, h * 0.97), base0.x + dir.x * L * t));
    }
    const zU = zr + 0.052;
    const at = (t: number): V3 => [base0.x + dir.x * L * t, base0.y + dir.y * L * t, zU];
    const rot = alongY([dir.x, dir.y, 0]);
    b.cylinder(0.014, 0.05, L * 0.62, silk, at(0.4), rot);
    b.cylinder(0.05, 0.014, L * 0.14, f.tone(silk, 0.9), at(0.72), rot);
    b.cylinder(0.006, 0.011, L * 0.3, PALETTE.material.iron, at(0.05), rot);
    b.cylinder(0.011, 0.009, L * 0.32, WOOD, at(0.84), rot); // the shaft up to the crook
    b.sweep(curve([at(0.88), at(1.0), [at(1.0)[0] - 0.05, at(1.0)[1] + 0.05, at(1.0)[2]], [at(1.0)[0] - 0.09, at(1.0)[1] + 0.0, at(1.0)[2]]], 8), () => ({ rx: 0.014, rz: 0.014, pow: 2 }), WOOD, { side: [0, 0, 1], segments: 5, round: "end" });
    // the belt loop that holds it: a leather band round the waist behind the umbrella
    bandAround(b, s, h * 0.19, h * 0.15, leather, { lift: 0.006 + f.layer * 0, edges: false, steps: 0 });
    crossStrap(f, leather, 0.022, { sign: 1, hipY: h * 0.2, hipPhi: -0.9, front: true, back: false });
  }
  void strapDrop;
}

/** Pushes a point out of the hip envelope (torso, coat skirt, thighs) so a hanging tail or a swinging cord lies outside it, `gap` clear. */
export function pushOut(f: TorsoFrame, p: V3, gap = 0.012): V3 {
  const r = f.reach(p[1], p[1]);
  const zc = (r.b - r.f) / 2;
  const X = r.x + gap;
  const Z = (p[2] < zc ? r.f : r.b) + gap;
  const e = 2.6;
  const q = (Math.abs(p[0]) / X) ** e + (Math.abs(p[2] - zc) / Z) ** e;
  const sc = q ** (1 / e);
  if (sc >= 1 || sc < 1e-6) return p;
  return [p[0] / sc, p[1], zc + (p[2] - zc) / sc];
}

/** A leather strap from the belt (the lower edge, at the side of the trunk) to the top of a hip-hung item at `item`: the item hangs from the belt whatever the skirt or hip between them. */
function beltHang(f: TorsoFrame, item: V3, half = 0.014): void {
  const sx = item[0] < 0 ? -1 : 1;
  const y = f.h * 0.17 - 0.018;
  const side = f.trunk.at(sx * Math.PI * 0.5, y, 0.008).p;
  const mid: V3 = [(side[0] + item[0]) / 2 + sx * 0.012, Math.max(item[1], y - 0.04) + (y - item[1]) * 0.35, (side[2] + item[2]) / 2];
  f.b.sweep(curve([side, mid, item], 6), () => ({ rx: 0.006, rz: half, pow: 2.4 }), singe(LEATHER, f.burnt), { side: [0, 0, 1], segments: 4, round: "both" });
}

export function addHipGear(f: TorsoFrame): void {
  const { b, spec, h, W, s } = f;
  const u = gearScale(f);
  const leather = singe(LEATHER, f.burnt);
  const brass = f.accent;
  const belt = (): void => bandAround(b, s, h * 0.17 - 0.022, h * 0.17 + 0.022, leather, { lift: 0.009 + f.layer * 0, steps: 0 });
  if (spec.hipGear === 1) {
    // canteen on the right hip: a felt-covered flask with a cork and a strap
    const y = h * 0.08;
    const rc = f.reach(y - 0.11 * u, y + 0.16 * u);
    const x = rc.x + 0.03 + 0.035 * u;
    const zc = (rc.b - rc.f) / 2 + 0.06;
    const cover = f.tone(singe(CREAM, f.burnt), 0.9);
    b.cylinder(0.105 * u, 0.105 * u, 0.06 * u, cover, [x, y, zc], [0, 0, Math.PI / 2]);
    b.cylinder(0.09 * u, 0.09 * u, 0.066 * u, f.tone(cover, 0.85), [x, y, zc], [0, 0, Math.PI / 2]);
    b.cylinder(0.02, 0.02, 0.05, brass, [x, y + 0.115 * u, zc]);
    b.sphere(0.02, WOOD, [x, y + 0.148 * u, zc]);
    b.box(0.015, 0.16 * u, 0.03, leather, [x + 0.024 * u, y + 0.08 * u, zc]);
    beltHang(f, [x, y + 0.14 * u, zc]);
    belt();
  } else if (spec.hipGear === 2) {
    // holster on the left hip with a walnut grip
    const y = h * 0.06;
    const rc = f.reach(y - 0.11 * u, y + 0.2 * u);
    const x = -(rc.x + 0.035 * u + 0.006);
    const zc = (rc.b - rc.f) / 2 + 0.02;
    b.box(0.07 * u, 0.21 * u, 0.11 * u, leather, [x, y, zc]);
    b.box(0.076 * u, 0.07 * u, 0.115 * u, f.tone(leather, 0.8), [x, y + 0.085 * u, zc]);
    b.box(0.03, 0.09 * u, 0.055, WOOD, [x, y + 0.17 * u, zc + 0.025], [0.35, 0, 0]);
    b.sphere(0.014, brass, [x - 0.04 * u, y + 0.08 * u, zc]);
    beltHang(f, [x, y + 0.115 * u, zc]);
    belt();
  } else if (spec.hipGear === 3) {
    // watch chain: a swag across the waistcoat from a buttonhole to the pocket, with a fob and a watch
    const x0 = -W * 0.32;
    const x1 = W * 0.4;
    const y0 = h * 0.56;
    const y1 = h * 0.5;
    const pts: V3[] = [];
    const lift = f.layer + 0.006;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t - 0.055 * Math.sin(Math.PI * t);
      pts.push(s.atX(x, y, lift).p);
    }
    b.sweep(pts, () => ({ rx: 0.006, rz: 0.006, pow: 2 }), brass, { side: [0, 0, 1], segments: 4, round: "both" });
    const w = s.atX(x1, y1 - 0.04, 0);
    const m = mount(w);
    b.cylinder(0.034, 0.034, 0.012, brass, [w.p[0] + w.n[0] * (lift + 0.002), w.p[1] + w.n[1] * (lift + 0.002), w.p[2] + w.n[2] * (lift + 0.002)], [m.rot[0] + Math.PI / 2, m.rot[1], m.rot[2]]);
    const k = s.atX(x0, y0, lift);
    b.sphere(0.014, brass, k.p);
  } else if (spec.hipGear === 4) {
    // field glasses on a neck strap, hanging at the chest
    const y = h * 0.5;
    const base = f.layer + 0.004;
    const nk = f.neck(f.neckY, 0.02);
    let glassZ = Infinity;
    for (let i = 0; i <= 4; i++) glassZ = Math.min(glassZ, f.trunk.front(y - 0.09 * u + (0.18 * u * i) / 4));
    glassZ -= 0.05 * u + 0.012;
    const top = f.neckY - 0.03;
    for (const sx of [-1, 1]) {
      const ta = s.atX(sx * nk.rx * 1.0, top, base).p;
      const tb = s.atX(sx * 0.05, y + 0.14, base).p;
      b.sweep(curve([ta, tb, [sx * 0.04, y + 0.07 * u, glassZ + 0.01]], 6), () => ({ rx: 0.014, rz: 0.006, pow: 2.5 }), leather, { side: [0, 0, 1], segments: 5, round: "end" });
    }
    for (const sx of [-1, 1]) {
      b.cylinder(0.026, 0.04, 0.14 * u, leather, [sx * 0.04, y, glassZ]);
      b.cylinder(0.042, 0.042, 0.02, brass, [sx * 0.04, y - 0.07 * u, glassZ]);
      b.cylinder(0.03, 0.03, 0.012, brass, [sx * 0.04, y + 0.07 * u, glassZ]);
    }
    b.box(0.05, 0.03, 0.03, f.tone(leather, 0.8), [0, y + 0.02, glassZ]);
  } else if (spec.hipGear === 5) {
    // sabre: a black scabbard with brass mounts hanging from the belt on the left, the hilt and knuckle guard at the hip
    const y = h * 0.1;
    const scabLen = Math.min(0.78, (f.P.legUpper + f.P.legLower) * 0.8 + h * 0.1);
    const rc = f.reach(y - scabLen * 0.5, y + 0.2);
    const x = -(rc.x + 0.03);
    const zc = (rc.b - rc.f) / 2 + 0.03;
    const top: V3 = [x, y + 0.06, zc];
    const reach = Math.min(0.78, (f.P.legUpper + f.P.legLower) * 0.8 + h * 0.1); // never longer than the wearer's leg: the scabbard swings clear of the ground
    const tip: V3 = [x - 0.1, y - reach, zc + 0.23];
    const mid: V3 = [x - 0.04, y - reach * 0.44, zc + 0.1];
    const black = f.tone(leather, 0.55);
    b.sweep(curve([top, mid, tip], 9), (t) => ({ rx: 0.026 * (1 - 0.35 * t), rz: 0.014 * (1 - 0.3 * t), pow: 2.4, color: black }), black, { side: [1, 0, 0], segments: 5, round: "end" });
    b.box(0.05, 0.03, 0.03, brass, [top[0], top[1] - 0.05, top[2]]); // locket
    b.sphere(0.02, brass, [tip[0], tip[1], tip[2]]); // chape
    b.cylinder(0.014, 0.017, 0.11, f.tone(leather, 0.7), [top[0], top[1] + 0.06, top[2]]); // grip
    b.sweep(curve([[top[0] + 0.04, top[1] + 0.005, top[2] - 0.03], [top[0] + 0.05, top[1] + 0.03, top[2]], [top[0] + 0.03, top[1] + 0.005, top[2] + 0.04]], 6), () => ({ rx: 0.008, rz: 0.008, pow: 2 }), brass, { side: [0, 1, 0], segments: 4, round: "both" }); // knuckle guard
    b.sphere(0.02, brass, [top[0], top[1] + 0.13, top[2]]); // pommel
    beltHang(f, [top[0], top[1] - 0.045, top[2]]);
    belt();
  } else if (spec.hipGear === 6) {
    // machete: a broad leather sheath on the right hip, a bone-handled hilt sticking up
    const y = h * 0.04;
    const rc = f.reach(y - Math.min(0.44, (f.P.legUpper + f.P.legLower) * 0.5), y + 0.22);
    const x = rc.x + 0.05;
    const zc = (rc.b - rc.f) / 2 + 0.02;
    const sl = Math.min(0.44, (f.P.legUpper + f.P.legLower) * 0.5);
    b.loft([{ y: y + 0.08, rx: 0.035, rz: 0.018, cz: zc, cx: x, pow: 2.6, color: leather }, { y: y - sl * 0.5, rx: 0.045, rz: 0.02, cz: zc + 0.03, cx: x + 0.01, pow: 2.6, color: f.tone(leather, 0.85) }, { y: y - sl, rx: 0.035, rz: 0.016, cz: zc + 0.06, cx: x + 0.02, pow: 2.6, color: f.tone(leather, 0.7) }], leather);
    b.cylinder(0.017, 0.02, 0.12, PALETTE.trim.ivory, [x, y + 0.14, zc]);
    b.box(0.08, 0.016, 0.03, brass, [x, y + 0.08, zc]);
    b.sphere(0.016, brass, [x, y + 0.205, zc]);
    beltHang(f, [x, y + 0.08, zc]);
    belt();
  } else if (spec.hipGear === 7) {
    // a coil of rope hung from the belt on the right: five loops and a trailing end
    const y = h * 0.08;
    const rc = f.reach(y - 0.14 * u, y + 0.14);
    const x = rc.x + 0.03 + 0.06 * u;
    const zc = (rc.b - rc.f) / 2 + 0.02;
    const rope = singe(PALETTE.material.rope, f.burnt);
    // (loops hang in vertical planes side by side, like a coil on a hook: not rings round the hip)
    for (let i = 0; i < 5; i++) b.torus((0.1 - i * 0.003) * u, 0.02, i % 2 ? f.tone(rope, 0.88) : rope, [x + (i - 2) * 0.034, y - 0.02, zc], [0, Math.PI / 2, 0]);
    b.cylinder(0.014, 0.014, 0.05, leather, [x, y - 0.02 + 0.1 * u + 0.005, zc]); // the hook the coil hangs on: through the top of the loops
    beltHang(f, [x, y - 0.02 + 0.1 * u + 0.03, zc]);
    const tl = Math.min(0.38, (f.P.legUpper + f.P.legLower) * 0.42);
    const start: V3 = [x + 0.068, y - 0.02 - 0.094 * u, zc]; // leaves the lowest point of the outer loop
    b.sweep(curve([start, pushOut(f, [x + 0.07, y - 0.02 - 0.094 * u - tl * 0.5, zc + 0.05], 0.014), pushOut(f, [x + 0.06, y - 0.02 - 0.094 * u - tl, zc + 0.09], 0.014)], 6), (t) => ({ rx: 0.016 * (1 - 0.3 * t), rz: 0.016 * (1 - 0.3 * t), pow: 2 }), rope, { side: [1, 0, 0], segments: 5, round: "end" });
    belt();
  } else if (spec.hipGear === 8) {
    // a pocket watch on a chain: hanging from the waistcoat, the open silver hunter face turned out
    const x0 = -W * 0.34;
    const y0 = h * 0.58;
    const wx = W * 0.02;
    const wy = h * 0.45;
    const lift = f.layer + 0.006;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = y0 + (wy - y0) * t - 0.04 * Math.sin(Math.PI * t);
      const x = x0 + (wx - x0) * t;
      pts.push(s.atX(x, y, lift).p);
    }
    b.sweep(pts, () => ({ rx: 0.006, rz: 0.006, pow: 2 }), brass, { side: [0, 0, 1], segments: 4, round: "both" });
    b.sphere(0.014, brass, s.atX(x0, y0, lift + 0.002).p);
    const w = s.atX(wx, wy - 0.06, 0);
    const wm = mount(w);
    const wr: V3 = [wm.rot[0] + Math.PI / 2, wm.rot[1], wm.rot[2]];
    const c0 = f.layer + 0.012;
    const at = (d: number): V3 => [w.p[0] + w.n[0] * (c0 + d), w.p[1] + w.n[1] * (c0 + d), w.p[2] + w.n[2] * (c0 + d)];
    b.cylinder(0.05, 0.05, 0.016, brass, at(0), wr);
    b.cylinder(0.041, 0.041, 0.012, PALETTE.trim.ivory, at(0.007), wr);
    b.sphere(0.012, brass, [w.p[0] + 0, w.p[1] + 0.06 - 0.008 + 0.008, w.p[2] + w.n[2] * (c0)]);
    b.box(0.006, 0.03, 0.004, PALETTE.material.soot, at(0.011), wm.rot);
    b.box(0.022, 0.006, 0.004, PALETTE.material.soot, [at(0.011)[0] + 0.008, at(0.011)[1], at(0.011)[2]], wm.rot);
  } else if (spec.hipGear === 9) {
    // cartridge pouches: two box pouches with flaps and brass studs, either side of the belt buckle
    const y = h * 0.19;
    for (const sx of [-1, 1]) {
      const x = sx * f.trunk.section(y).rx * 0.5;
      const sp = f.trunk.atX(x, y, 0);
      const m = mount(sp);
      const c = (d: number): V3 => [sp.p[0] + sp.n[0] * (0.009 + d), sp.p[1] + sp.n[1] * (0.009 + d), sp.p[2] + sp.n[2] * (0.009 + d)];
      b.box(0.11 * u, 0.09 * u, 0.055 * u, leather, c(0.0275 * u), m.rot);
      b.box(0.115 * u, 0.045 * u, 0.06 * u, f.tone(leather, 0.8), [c(0.03 * u)[0], c(0.03 * u)[1] + 0.03, c(0.03 * u)[2]], m.rot);
      b.sphere(0.012, brass, c(0.057 * u), [1, 1, 0.6]);
    }
    belt();
  }
  void buttonOn;
  void ringAt;
}
