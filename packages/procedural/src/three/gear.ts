import { Euler, Quaternion, Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { CREAM, LEATHER, PartBuilder, WOOD, singe, type V3 } from "./parts.ts";
import { curve } from "./sweep.ts";

/**
 * Expedition gear that hangs on the torso bone: neckwear, packs and hip gear. Everything is placed from the torso's own cross-sections
 * (`at`), so it sits ON the coat rather than near it; straps are ribbons swept along the surface.
 */
export interface TorsoFrame {
  b: PartBuilder;
  spec: CharacterSpec;
  P: Proportions;
  h: number;
  W: number;
  D: number;
  neckY: number;
  nr: number;
  burnt: number;
  accent: number;
  /** Canvas / cloth colour for neckwear and packs (a dye from the palette). */
  dye: number;
  at(y: number): { rx: number; rz: number; cx: number; cz: number; pow: number };
  tone(color: number, k: number): number;
}

const up = new Vector3(0, 1, 0);
const orient = (dir: V3): V3 => {
  const q = new Quaternion().setFromUnitVectors(up, new Vector3(...dir).normalize());
  const e = new Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z];
};

/** Superellipse surface point of the torso at height y and azimuth phi (0 = front, +x positive), `lift` proud. */
function surfacePoint(f: TorsoFrame, y: number, phi: number, lift: number): V3 {
  const q = f.at(y);
  const e = 2 / q.pow;
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  return [q.cx + (q.rx + lift) * Math.sign(sn) * Math.abs(sn) ** e, y, q.cz - (q.rz + lift) * Math.sign(cs) * Math.abs(cs) ** e];
}

const frontZ = (f: TorsoFrame, y: number, x = 0): number => {
  const q = f.at(y);
  const u = Math.min(0.999, Math.abs(x - q.cx) / q.rx);
  return q.cz - q.rz * (1 - u ** q.pow) ** (1 / q.pow);
};
const backZ = (f: TorsoFrame, y: number, x = 0): number => 2 * f.at(y).cz - frontZ(f, y, x);

/**
 * A flat ribbon laid on the torso from the shoulder (azimuth `shoulderPhi`, over the top) diagonally down to `hipY`/`hipPhi`, on the front,
 * the back, or both. `sign` mirrors it to the other shoulder.
 */
export function torsoRibbon(f: TorsoFrame, color: number, half: number, opts: { sign: 1 | -1; hipY: number; hipPhi: number; front?: boolean; back?: boolean; shoulderPhi?: number }): void {
  const { b, h } = f;
  const sp = opts.shoulderPhi ?? 0.72;
  const path: V3[] = [];
  const normals: V3[] = [];
  const push = (y: number, phi: number): void => {
    const p = surfacePoint(f, y, opts.sign * phi, 0.012);
    path.push(p);
    normals.push([Math.sin(opts.sign * phi), 0, -Math.cos(opts.sign * phi)]);
  };
  const N = 6;
  const front = opts.front !== false;
  const back = opts.back !== false;
  if (front) for (let i = 0; i <= N; i++) push(h * (opts.hipY / h + (0.94 - opts.hipY / h) * (i / N)), opts.hipPhi + (sp - opts.hipPhi) * (i / N));
  for (let i = front ? 1 : 0; i < (back ? 4 : 5); i++) {
    const t = i / 4;
    push(h * (0.945 + 0.04 * Math.sin(Math.PI * t)), sp + (Math.PI - 2 * sp) * t);
  }
  if (back) for (let i = 0; i <= N; i++) push(h * (0.94 - (0.94 - opts.hipY / h) * (i / N)), Math.PI - sp + (sp - opts.hipPhi) * (i / N));
  if (path.length < 3) return;
  b.sweep(path, () => ({ rx: half, rz: 0.009, pow: 3.2 }), color, {
    segments: 6,
    round: "both",
    sideAt: (i) => {
      const a = path[Math.max(0, i - 1)]!;
      const c = path[Math.min(path.length - 1, i + 1)]!;
      const t: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = normals[i]!;
      return [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]] as V3;
    },
  });
}

export function addNeckwear(f: TorsoFrame): void {
  const { b, spec, neckY, nr, dye } = f;
  const zf = frontZ(f, neckY - 0.02) - 0.004;
  if (spec.neckwear === 1) {
    // cravat: a soft roll round the collar, a knot, two tails down the front
    b.loft([{ y: neckY - 0.035, rx: nr * 1.28, rz: nr * 1.22, color: f.tone(dye, 0.85) }, { y: neckY + 0.05, rx: nr * 1.1, rz: nr * 1.05, color: dye, crease: true }], dye);
    b.sphere(0.05, dye, [0, neckY - 0.012, zf - 0.035], [1.15, 1, 0.8]);
    for (const sx of [-1, 1]) b.box(0.075, 0.2, 0.014, sx > 0 ? f.tone(dye, 0.9) : dye, [sx * 0.03, neckY - 0.13, frontZ(f, neckY - 0.13) - 0.02], [0, 0, sx * 0.14]);
  } else if (spec.neckwear === 2) {
    // bow tie
    for (const sx of [-1, 1]) b.cone(0.055, 0.1, dye, [sx * 0.07, neckY - 0.012, zf - 0.03], [0, 0, sx * Math.PI / 2], [1, 1, 0.55]);
    b.sphere(0.028, f.tone(dye, 0.8), [0, neckY - 0.012, zf - 0.034]);
  } else if (spec.neckwear === 3) {
    // scarf: two turns round the neck, a knot at the side, one long tail with a stripe and a fringe
    b.torus(nr * 1.2, 0.05, dye, [0, neckY + 0.005, 0], [Math.PI / 2, 0, 0]);
    b.torus(nr * 1.16, 0.038, f.tone(dye, 0.78), [0, neckY - 0.045, 0], [Math.PI / 2, 0, 0]);
    b.sphere(0.06, dye, [-nr * 0.9, neckY - 0.03, zf - 0.03], [1, 1, 0.9]);
    const x = -nr * 0.9;
    const tail: V3[] = [[x, neckY - 0.06, zf - 0.04], [x - 0.01, neckY - 0.2, frontZ(f, neckY - 0.2) - 0.026], [x + 0.02, neckY - 0.36, frontZ(f, neckY - 0.36) - 0.02]];
    b.sweep(curve(tail, 8), () => ({ rx: 0.052, rz: 0.012, pow: 2.6 }), dye, { side: [1, 0, 0], segments: 6 });
    b.box(0.09, 0.012, 0.012, f.tone(dye, 0.7), [x + 0.015, neckY - 0.28, frontZ(f, neckY - 0.28) - 0.03]);
    for (let i = 0; i < 4; i++) b.box(0.008, 0.045, 0.008, dye, [x + 0.02 + (i - 1.5) * 0.02, neckY - 0.395, frontZ(f, neckY - 0.395) - 0.02]);
  }
}

export function addPack(f: TorsoFrame): void {
  const { b, spec, h, W, dye } = f;
  const canvas = f.tone(dye, 0.9);
  const brass = f.accent;
  const leather = singe(LEATHER, f.burnt);
  const zb = backZ(f, h * 0.55);
  if (spec.pack === 1) {
    // rucksack with a flap, two buckled straps and shoulder straps over the chest
    const z0 = zb + 0.02;
    b.loft(
      [
        { y: h * 0.2, rx: W * 0.6, rz: 0.075, cz: z0 + 0.08, pow: 3, color: f.tone(canvas, 0.75) },
        { y: h * 0.4, rx: W * 0.74, rz: 0.125, cz: z0 + 0.115, pow: 3, color: canvas },
        { y: h * 0.7, rx: W * 0.72, rz: 0.125, cz: z0 + 0.115, pow: 3, color: canvas },
        { y: h * 0.86, rx: W * 0.55, rz: 0.08, cz: z0 + 0.09, pow: 3, color: f.tone(canvas, 1.1) },
      ],
      canvas,
    );
    b.box(W * 1.2, h * 0.17, 0.05, f.tone(canvas, 0.68), [0, h * 0.78, z0 + 0.235], [-0.12, 0, 0]);
    b.box(W * 0.9, h * 0.13, 0.06, f.tone(canvas, 0.8), [0, h * 0.3, z0 + 0.2]); // lower pocket
    for (const sx of [-1, 1]) {
      b.box(0.035, h * 0.24, 0.012, leather, [sx * W * 0.32, h * 0.7, z0 + 0.255]);
      b.box(0.04, 0.03, 0.02, brass, [sx * W * 0.32, h * 0.6, z0 + 0.26]);
      torsoRibbon(f, leather, 0.028, { sign: sx as 1 | -1, hipY: h * 0.36, hipPhi: 1.15, shoulderPhi: 0.55, back: false });
    }
  } else if (spec.pack === 2) {
    // bedroll: a rolled blanket across the shoulders, strapped, spiral ends
    const len = W * 2.35;
    const y = h * 0.84;
    const z = backZ(f, y) + 0.1;
    b.cylinder(0.085, 0.085, len, canvas, [0, y, z], [0, 0, Math.PI / 2]);
    b.cylinder(0.088, 0.088, len * 0.12, f.tone(dye, 0.7), [len * 0.36, y, z], [0, 0, Math.PI / 2]);
    b.cylinder(0.088, 0.088, len * 0.12, f.tone(dye, 0.7), [-len * 0.36, y, z], [0, 0, Math.PI / 2]);
    for (const sx of [-1, 1]) {
      b.torus(0.05, 0.008, f.tone(dye, 0.6), [sx * (len / 2 + 0.002), y, z], [0, Math.PI / 2, 0]);
      b.torus(0.088, 0.013, leather, [sx * len * 0.24, y, z], [0, Math.PI / 2, 0]);
      b.box(0.03, 0.03, 0.02, brass, [sx * len * 0.24, y, z - 0.09]);
    }
    torsoRibbon(f, leather, 0.028, { sign: 1, hipY: h * 0.5, hipPhi: 1.0, shoulderPhi: 0.75, back: false });
    torsoRibbon(f, leather, 0.028, { sign: -1, hipY: h * 0.5, hipPhi: 1.0, shoulderPhi: 0.75, back: false });
  } else if (spec.pack === 3) {
    // satchel at the left hip on a diagonal strap
    const y = h * 0.02;
    const q = f.at(y + 0.08);
    const x = -(q.rx + 0.075);
    b.box(0.11, 0.25, 0.32, leather, [x, y, q.cz + 0.02]);
    b.box(0.125, 0.09, 0.34, f.tone(leather, 0.8), [x, y + 0.11, q.cz + 0.02], [0, 0, 0.05]);
    b.box(0.03, 0.05, 0.05, brass, [x - 0.06, y + 0.06, q.cz + 0.02]);
    b.box(0.02, 0.2, 0.14, f.tone(leather, 1.2), [x - 0.058, y - 0.02, q.cz + 0.02]);
    torsoRibbon(f, leather, 0.033, { sign: 1, hipY: h * 0.12, hipPhi: -1.05, shoulderPhi: 0.72 });
    b.sphere(0.028, brass, [x + 0.03, y + 0.15, q.cz + 0.02]); // strap ring
  } else if (spec.pack === 4) {
    // a naturalist's specimen case on the back, with a butterfly net lashed to it
    const z0 = zb + 0.02;
    b.box(W * 1.3, h * 0.44, 0.19, f.tone(leather, 1.05), [0, h * 0.5, z0 + 0.11]);
    b.box(W * 1.34, 0.03, 0.2, f.tone(leather, 0.8), [0, h * 0.5, z0 + 0.11]); // lid seam
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.box(0.05, 0.05, 0.21, brass, [sx * W * 0.63, h * 0.5 + sy * h * 0.21, z0 + 0.11]);
    b.box(0.05, h * 0.46, 0.2, f.tone(leather, 0.7), [0, h * 0.5, z0 + 0.111]);
    b.box(0.07, 0.05, 0.03, brass, [0, h * 0.5, z0 + 0.22]);
    for (const sx of [-1, 1]) torsoRibbon(f, leather, 0.028, { sign: sx as 1 | -1, hipY: h * 0.4, hipPhi: 1.15, shoulderPhi: 0.55, back: false });
    // the net: pole, hoop, gauze cone
    const dir: V3 = [0.3, 0.94, 0.12];
    const base: V3 = [W * 0.45, h * 0.28, z0 + 0.21];
    const L = 1.0;
    const d = new Vector3(...dir).normalize();
    const mid: V3 = [base[0] + d.x * L * 0.5, base[1] + d.y * L * 0.5, base[2] + d.z * L * 0.5];
    b.cylinder(0.012, 0.014, L, WOOD, mid, orient(dir));
    const top: V3 = [base[0] + d.x * L, base[1] + d.y * L, base[2] + d.z * L];
    b.torus(0.15, 0.009, PALETTE.material.iron, [top[0] + d.x * 0.05, top[1] + d.y * 0.05, top[2] + d.z * 0.05], orient(dir).map((v, i) => (i === 0 ? v + Math.PI / 2 : v)) as unknown as V3);
    b.cone(0.15, 0.36, singe(CREAM, f.burnt), [top[0] + d.x * -0.09 + 0.02, top[1] - 0.12, top[2] + d.z * 0.05 + 0.02], [Math.PI, 0, 0], [1, 1, 1]);
  }
}

export function addHipGear(f: TorsoFrame): void {
  const { b, spec, h, W, neckY, nr } = f;
  const leather = singe(LEATHER, f.burnt);
  const brass = f.accent;
  const belt = (): void => {
    const y = h * 0.17;
    const q = f.at(y);
    const k = 1.035;
    b.loft(
      [
        { y: y - 0.022, rx: q.rx * k, rz: q.rz * k, cx: q.cx, cz: q.cz, pow: q.pow, color: leather },
        { y: y + 0.022, rx: q.rx * k, rz: q.rz * k, cx: q.cx, cz: q.cz, pow: q.pow, color: leather, crease: true },
      ],
      leather,
      undefined,
      undefined,
      undefined,
      { capBottom: false, capTop: false },
    );
  };
  if (spec.hipGear === 1) {
    // canteen on the right hip: a felt-covered flask with a cork and a strap
    const y = h * 0.08;
    const q = f.at(y);
    const x = q.rx + 0.045;
    const cover = f.tone(singe(CREAM, f.burnt), 0.9);
    b.cylinder(0.105, 0.105, 0.06, cover, [x, y, q.cz + 0.06], [0, 0, Math.PI / 2]);
    b.cylinder(0.09, 0.09, 0.066, f.tone(cover, 0.85), [x, y, q.cz + 0.06], [0, 0, Math.PI / 2]);
    b.cylinder(0.02, 0.02, 0.05, brass, [x, y + 0.115, q.cz + 0.06]);
    b.sphere(0.02, WOOD, [x, y + 0.148, q.cz + 0.06]);
    b.box(0.015, 0.16, 0.03, leather, [x + 0.024, y + 0.08, q.cz + 0.06]);
    belt();
  } else if (spec.hipGear === 2) {
    // holster on the left hip with a walnut grip
    const y = h * 0.06;
    const q = f.at(y + 0.06);
    const x = -(q.rx + 0.04);
    b.box(0.07, 0.21, 0.11, leather, [x, y, q.cz + 0.02]);
    b.box(0.076, 0.07, 0.115, f.tone(leather, 0.8), [x, y + 0.085, q.cz + 0.02]);
    b.box(0.03, 0.09, 0.055, WOOD, [x, y + 0.17, q.cz + 0.045], [0.35, 0, 0]);
    b.sphere(0.014, brass, [x - 0.04, y + 0.08, q.cz + 0.02]);
    belt();
  } else if (spec.hipGear === 3) {
    // watch chain: a swag across the waistcoat from a buttonhole to the pocket, with a fob and a watch
    const x0 = -W * 0.32;
    const x1 = W * 0.4;
    const y0 = h * 0.56;
    const y1 = h * 0.5;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t - 0.055 * Math.sin(Math.PI * t);
      pts.push([x, y, frontZ(f, y, x) - 0.013]);
    }
    b.sweep(pts, () => ({ rx: 0.006, rz: 0.006, pow: 2 }), brass, { side: [0, 0, 1], segments: 4, round: "both" });
    b.cylinder(0.034, 0.034, 0.012, brass, [x1, y1 - 0.04, frontZ(f, y1 - 0.04, x1) - 0.014], [Math.PI / 2, 0, 0]);
    b.sphere(0.014, brass, [x0, y0, frontZ(f, y0, x0) - 0.016]);
  } else if (spec.hipGear === 4) {
    // field glasses on a neck strap, hanging at the chest
    const y = h * 0.5;
    const z = frontZ(f, y) - 0.075;
    const strap: V3[] = [[-nr * 1.1, neckY - 0.02, frontZ(f, neckY - 0.02) - 0.02], [-0.05, y + 0.14, frontZ(f, y + 0.14) - 0.03], [-0.035, y + 0.07, z], ];
    const strapR: V3[] = strap.map((p): V3 => [-p[0], p[1], p[2]]);
    for (const s of [strap, strapR]) b.sweep(curve(s, 6), () => ({ rx: 0.014, rz: 0.006, pow: 2.5 }), leather, { side: [0, 0, 1], segments: 5, round: "end" });
    for (const sx of [-1, 1]) {
      b.cylinder(0.026, 0.04, 0.14, leather, [sx * 0.04, y, z]);
      b.cylinder(0.042, 0.042, 0.02, brass, [sx * 0.04, y - 0.07, z]);
      b.cylinder(0.03, 0.03, 0.012, brass, [sx * 0.04, y + 0.07, z]);
    }
    b.box(0.05, 0.03, 0.03, f.tone(leather, 0.8), [0, y + 0.02, z]);
  }
}
