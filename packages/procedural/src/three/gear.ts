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
    segments: 4,
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
  } else if (spec.neckwear === 4) {
    // ascot: a broad silk band folded into the collar, a puffed cross-over at the throat and a pin
    b.loft([{ y: neckY - 0.045, rx: nr * 1.3, rz: nr * 1.26, color: f.tone(dye, 0.85) }, { y: neckY + 0.045, rx: nr * 1.12, rz: nr * 1.08, color: dye, crease: true }], dye);
    for (const sx of [-1, 1]) b.sphere(0.06, sx > 0 ? f.tone(dye, 0.92) : dye, [sx * 0.035, neckY - 0.06, zf - 0.03], [0.85, 1.35, 0.6], [0, 0, sx * 0.4]);
    b.sphere(0.014, PALETTE.trim.pearl, [0, neckY - 0.055, zf - 0.075]);
  } else if (spec.neckwear === 5) {
    // neckerchief: knotted at the front, the triangle hanging down the chest
    b.loft([{ y: neckY - 0.03, rx: nr * 1.24, rz: nr * 1.2, color: f.tone(dye, 0.88) }, { y: neckY + 0.04, rx: nr * 1.1, rz: nr * 1.06, color: dye, crease: true }], dye);
    b.sphere(0.036, f.tone(dye, 0.85), [0, neckY - 0.01, zf - 0.03], [1.2, 1, 0.8]);
    b.cone(0.085, 0.17, dye, [0, neckY - 0.12, frontZ(f, neckY - 0.12) - 0.012], [Math.PI, 0, 0], [1, 1, 0.16]);
  } else if (spec.neckwear === 6) {
    // ruff: a wheel of pleated linen round the neck
    const linen = singe(CREAM, f.burnt);
    b.torus(nr * 1.75, 0.032, linen, [0, neckY + 0.005, 0], [Math.PI / 2, 0, 0]);
    b.torus(nr * 1.55, 0.028, f.tone(linen, 0.9), [0, neckY - 0.03, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      b.sphere(0.034, i % 2 ? linen : f.tone(linen, 0.92), [Math.sin(a) * nr * 2.0, neckY + 0.005, Math.cos(a) * nr * 2.0], [1, 0.7, 1]);
    }
    b.loft([{ y: neckY - 0.04, rx: nr * 1.35, rz: nr * 1.3, color: f.tone(linen, 0.8) }, { y: neckY + 0.03, rx: nr * 1.15, rz: nr * 1.1, color: linen }], linen);
  } else if (spec.neckwear === 7) {
    // fur collar: a shaggy pelt standing up round the neck and hanging in two lobes down the front
    const fur = singe(PALETTE.material.fur, f.burnt);
    b.loft(
      [
        { y: neckY + 0.06, rx: nr * 1.22, rz: nr * 1.18, color: f.tone(fur, 1.1) },
        { y: neckY + 0.0, rx: nr * 1.9, rz: nr * 1.85, pow: 2.3, color: fur },
        { y: neckY - 0.07, rx: nr * 2.05, rz: nr * 2.0, pow: 2.3, color: f.tone(fur, 0.8) },
      ],
      fur,
      undefined,
      undefined,
      undefined,
      { capTop: false, capBottom: false },
    );
    for (const sx of [-1, 1]) b.sphere(0.075, f.tone(fur, sx > 0 ? 0.95 : 1.05), [sx * nr * 1.0, neckY - 0.1, zf - 0.03], [1, 1.6, 0.7]);
  } else if (spec.neckwear === 8) {
    // muffler: a long knitted scarf, two turns and both ends hanging in front, banded in the cloth's own dye and cream
    const band = singe(CREAM, f.burnt);
    b.torus(nr * 1.22, 0.05, dye, [0, neckY + 0.01, 0], [Math.PI / 2, 0, 0]);
    b.torus(nr * 1.18, 0.04, f.tone(dye, 0.8), [0, neckY - 0.05, 0], [Math.PI / 2, 0, 0]);
    for (const [dx, len] of [[-0.05, 0.4], [0.06, 0.32]] as const) {
      const pts: V3[] = [[dx, neckY - 0.04, zf - 0.03], [dx, neckY - len * 0.5, frontZ(f, neckY - len * 0.5) - 0.024], [dx + 0.01, neckY - len, frontZ(f, neckY - len) - 0.02]];
      b.sweep(curve(pts, 10), (t) => ({ rx: 0.05, rz: 0.012, pow: 2.6, color: Math.sin(t * 24) > 0.2 ? band : dye }), dye, { side: [1, 0, 0], segments: 6 });
    }
  }
}

export function addPack(f: TorsoFrame): void {
  const { b, spec, h, W, dye } = f;
  const canvas = f.tone(dye, 0.9);
  const brass = f.accent;
  const leather = singe(LEATHER, f.burnt);
  const zb = Math.min(backZ(f, h * 0.28), backZ(f, h * 0.55), backZ(f, h * 0.8)); // the back is not straight: seat things on its least prominent point
  if (spec.pack === 1) {
    // rucksack with a flap, two buckled straps and shoulder straps over the chest
    const z0 = zb - 0.012;
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
    const z0 = zb - 0.012;
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
  } else if (spec.pack === 5) {
    // a tin trunk lugged on the back: painted tin, iron corners and bands, a brass lock and a rope handle over the shoulders
    const z0 = zb - 0.012;
    const tin = f.tone(dye, 0.75);
    const iron = PALETTE.material.iron;
    b.box(W * 1.5, h * 0.5, 0.26, tin, [0, h * 0.5, z0 + 0.13]);
    b.box(W * 1.56, 0.03, 0.27, f.tone(tin, 0.7), [0, h * 0.5 + h * 0.25 - 0.06, z0 + 0.13]);
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) b.box(0.05, 0.05, 0.28, iron, [sx * W * 0.72, h * 0.5 + sy * h * 0.24, z0 + 0.13]);
    for (const sx of [-1, 1]) b.box(0.03, h * 0.52, 0.275, iron, [sx * W * 0.3, h * 0.5, z0 + 0.13]);
    b.box(0.06, 0.07, 0.03, brass, [0, h * 0.62, z0 + 0.275]);
    for (const sx of [-1, 1]) torsoRibbon(f, leather, 0.03, { sign: sx as 1 | -1, hipY: h * 0.4, hipPhi: 1.15, shoulderPhi: 0.55, back: false });
    b.sweep(curve([[-W * 0.4, h * 0.76, z0 + 0.27], [0, h * 0.82, z0 + 0.3], [W * 0.4, h * 0.76, z0 + 0.27]], 7), () => ({ rx: 0.012, rz: 0.012, pow: 2 }), f.tone(singe(PALETTE.material.rope, f.burnt), 1), { side: [0, 1, 0], segments: 5, round: "both" });
  } else if (spec.pack === 6) {
    // a rifle slung diagonally across the back: walnut stock, long barrel, brass sling swivels and a leather sling round the chest
    const iron = PALETTE.material.iron;
    const zR = zb + 0.02;
    const dir = new Vector3(0.5, 1, 0).normalize();
    const base = new Vector3(-W * 0.9, h * 0.1, zR);
    const L = 1.15;
    const p = (t: number): V3 => [base.x + dir.x * L * t, base.y + dir.y * L * t, zR];
    const rot = orient([dir.x, dir.y, 0]);
    b.cylinder(0.036, 0.05, L * 0.34, WOOD, [...p(0.17)] as unknown as V3, rot); // stock
    b.cylinder(0.014, 0.028, L * 0.5, iron, [...p(0.65)] as unknown as V3, rot); // barrel
    b.cylinder(0.02, 0.02, L * 0.24, f.tone(WOOD, 1.1), [...p(0.6)] as unknown as V3, rot); // fore-end
    b.sphere(0.02, brass, p(0.33));
    b.sphere(0.02, brass, p(0.88));
    torsoRibbon(f, leather, 0.02, { sign: 1, hipY: h * 0.3, hipPhi: -0.9 });
  } else if (spec.pack === 7) {
    // a folding easel and canvas: three wooden legs strapped in a bundle with a canvas board, paint box hanging beneath
    const canvas = singe(CREAM, f.burnt);
    b.box(W * 1.2, h * 0.5, 0.03, canvas, [0, h * 0.58, zb + 0.03]);
    b.box(W * 1.28, h * 0.54, 0.02, f.tone(WOOD, 0.9), [0, h * 0.58, zb + 0.048]);
    for (const sx of [-1, 0, 1]) b.cylinder(0.016, 0.014, 1.15, WOOD, [sx * 0.07, h * 0.58 + 0.1, zb + 0.09], [0, 0, sx * 0.05]);
    for (const sy of [0.45, 0.72]) b.box(W * 1.35, 0.03, 0.08, leather, [0, h * sy, zb + 0.06]);
    b.box(0.2, 0.13, 0.09, f.tone(leather, 1.05), [0, h * 0.06, zb + 0.06]);
    b.box(0.06, 0.03, 0.02, brass, [0, h * 0.09, zb + 0.108]);
    for (const sx of [-1, 1]) torsoRibbon(f, leather, 0.026, { sign: sx as 1 | -1, hipY: h * 0.4, hipPhi: 1.15, shoulderPhi: 0.55, back: false });
  } else if (spec.pack === 8) {
    // a birdcage on a strap at the hip: brass ring, bars, a domed roof and a small yellow occupant
    const q = f.at(h * 0.02);
    const cx = -(q.rx + 0.14);
    const cy = h * 0.0;
    const cz = q.cz + 0.02;
    const bars = 12;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      b.cylinder(0.005, 0.005, 0.26, brass, [cx + Math.sin(a) * 0.1, cy, cz + Math.cos(a) * 0.1]);
    }
    b.torus(0.1, 0.008, brass, [cx, cy - 0.13, cz], [Math.PI / 2, 0, 0]);
    b.torus(0.1, 0.008, brass, [cx, cy + 0.13, cz], [Math.PI / 2, 0, 0]);
    b.cylinder(0.1, 0.1, 0.02, f.tone(WOOD, 1), [cx, cy - 0.14, cz]);
    b.cone(0.1, 0.09, brass, [cx, cy + 0.175, cz]);
    b.torus(0.03, 0.006, brass, [cx, cy + 0.235, cz], [0, 0, 0]);
    b.cylinder(0.006, 0.006, 0.2, WOOD, [cx, cy - 0.05, cz], [0, 0, Math.PI / 2]); // the perch
    b.sphere(0.034, PALETTE.trim.straw, [cx, cy - 0.015, cz]);
    b.sphere(0.02, PALETTE.trim.straw, [cx + 0.03, cy + 0.02, cz]);
    // the hanging strap: from the cage's ring up to a hook on the belt at the hip
    const hook: V3 = [-q.rx * 0.98, h * 0.13, q.cz];
    b.sweep(curve([[cx, cy + 0.235, cz], [cx + 0.03, cy + 0.32, cz], hook], 8), () => ({ rx: 0.013, rz: 0.006, pow: 2.4 }), leather, { side: [0, 0, 1], segments: 4, round: "both" });
    torsoRibbon(f, leather, 0.03, { sign: 1, hipY: h * 0.12, hipPhi: -1.05, shoulderPhi: 0.72 });
  } else if (spec.pack === 9) {
    // a furled umbrella through the back of the belt: tapered silk, a wooden crook and a steel ferrule
    const silk = f.tone(dye, 0.55);
    const zU = zb - 0.005;
    const dir = new Vector3(-0.32, 1, 0).normalize();
    const base = new Vector3(W * 0.6, h * 0.08, zU + 0.03);
    const L = 0.95;
    const at = (t: number): V3 => [base.x + dir.x * L * t, base.y + dir.y * L * t, base.z];
    const rot = orient([dir.x, dir.y, 0]);
    b.cylinder(0.014, 0.05, L * 0.62, silk, at(0.4), rot);
    b.cylinder(0.05, 0.014, L * 0.14, f.tone(silk, 0.9), at(0.72), rot);
    b.cylinder(0.006, 0.011, L * 0.3, PALETTE.material.iron, at(0.05), rot);
    b.cylinder(0.011, 0.009, L * 0.32, WOOD, at(0.84), rot); // the shaft up to the crook
    b.sweep(curve([at(0.88), at(1.0), [at(1.0)[0] - 0.05, at(1.0)[1] + 0.05, at(1.0)[2]], [at(1.0)[0] - 0.09, at(1.0)[1] + 0.0, at(1.0)[2]]], 8), () => ({ rx: 0.014, rz: 0.014, pow: 2 }), WOOD, { side: [0, 0, 1], segments: 5, round: "end" });
    for (const sx of [-1, 1]) b.box(0.05, 0.03, 0.03, leather, [sx * 0.0 + W * 0.6 * 0.5, h * 0.12 + sx * 0.0, zb + 0.02]);
    torsoRibbon(f, leather, 0.022, { sign: 1, hipY: h * 0.2, hipPhi: -0.9 });
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
  } else if (spec.hipGear === 5) {
    // sabre: a black scabbard with brass mounts hanging from the belt on the left, the hilt and knuckle guard at the hip
    const y = h * 0.1;
    const q = f.at(y + 0.06);
    const x = -(q.rx + 0.045);
    const top: V3 = [x, y + 0.06, q.cz + 0.03];
    const reach = Math.min(0.78, (f.P.legUpper + f.P.legLower) * 0.8 + h * 0.1); // never longer than the wearer's leg: the scabbard swings clear of the ground
    const tip: V3 = [x - 0.1, y - reach, q.cz + 0.26];
    const mid: V3 = [x - 0.04, y - reach * 0.44, q.cz + 0.12];
    const black = f.tone(leather, 0.55);
    b.sweep(curve([top, mid, tip], 9), (t) => ({ rx: 0.026 * (1 - 0.35 * t), rz: 0.014 * (1 - 0.3 * t), pow: 2.4, color: black }), black, { side: [1, 0, 0], segments: 5, round: "end" });
    b.box(0.05, 0.03, 0.03, brass, [top[0], top[1] - 0.05, top[2]]); // locket
    b.sphere(0.02, brass, [tip[0], tip[1], tip[2]]); // chape
    b.cylinder(0.014, 0.017, 0.11, f.tone(leather, 0.7), [top[0], top[1] + 0.06, top[2]]); // grip
    b.sweep(curve([[top[0] + 0.04, top[1] + 0.005, top[2] - 0.03], [top[0] + 0.05, top[1] + 0.03, top[2]], [top[0] + 0.03, top[1] + 0.005, top[2] + 0.04]], 6), () => ({ rx: 0.008, rz: 0.008, pow: 2 }), brass, { side: [0, 1, 0], segments: 4, round: "both" }); // knuckle guard
    b.sphere(0.02, brass, [top[0], top[1] + 0.13, top[2]]); // pommel
    belt();
  } else if (spec.hipGear === 6) {
    // machete: a broad leather sheath on the right hip, a bone-handled hilt sticking up
    const y = h * 0.04;
    const q = f.at(y + 0.06);
    const x = q.rx + 0.04;
    const zc = q.cz + 0.02;
    const sl = Math.min(0.44, (f.P.legUpper + f.P.legLower) * 0.5);
    b.loft([{ y: y + 0.08, rx: 0.035, rz: 0.018, cz: zc, cx: x, pow: 2.6, color: leather }, { y: y - sl * 0.5, rx: 0.045, rz: 0.02, cz: zc + 0.03, cx: x + 0.01, pow: 2.6, color: f.tone(leather, 0.85) }, { y: y - sl, rx: 0.035, rz: 0.016, cz: zc + 0.06, cx: x + 0.02, pow: 2.6, color: f.tone(leather, 0.7) }], leather);
    b.cylinder(0.017, 0.02, 0.12, PALETTE.trim.ivory, [x, y + 0.14, zc]);
    b.box(0.08, 0.016, 0.03, brass, [x, y + 0.08, zc]);
    b.sphere(0.016, brass, [x, y + 0.205, zc]);
    belt();
  } else if (spec.hipGear === 7) {
    // a coil of rope hung from the belt on the right: five loops and a trailing end
    const y = h * 0.08;
    const q = f.at(y);
    const x = q.rx + 0.075;
    const zc = q.cz + 0.02;
    const rope = singe(PALETTE.material.rope, f.burnt);
    for (let i = 0; i < 5; i++) b.torus(0.105 - i * 0.004, 0.02, i % 2 ? f.tone(rope, 0.88) : rope, [x, y - 0.04 + (i - 2) * 0.034, zc], [Math.PI / 2, 0, 0], [1, 1, 1]);
    b.cylinder(0.014, 0.014, 0.08, leather, [x - 0.02, y + 0.09, zc - 0.05]);
    const tl = Math.min(0.38, (f.P.legUpper + f.P.legLower) * 0.42);
    b.sweep(curve([[x + 0.03, y - 0.14, zc + 0.05], [x + 0.06, y - tl * 0.7, zc + 0.08], [x + 0.03, y - tl, zc + 0.1]], 6), (t) => ({ rx: 0.016 * (1 - 0.3 * t), rz: 0.016 * (1 - 0.3 * t), pow: 2 }), rope, { side: [1, 0, 0], segments: 5, round: "end" });
    belt();
  } else if (spec.hipGear === 8) {
    // a pocket watch on a chain: hanging from the waistcoat, the open silver hunter face turned out
    const x0 = -W * 0.34;
    const y0 = h * 0.58;
    const zf0 = frontZ(f, y0, x0) - 0.016;
    const wx = W * 0.02;
    const wy = h * 0.45;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = y0 + (wy - y0) * t - 0.04 * Math.sin(Math.PI * t);
      const x = x0 + (wx - x0) * t;
      pts.push([x, y, frontZ(f, y, x) - 0.014]);
    }
    b.sweep(pts, () => ({ rx: 0.006, rz: 0.006, pow: 2 }), brass, { side: [0, 0, 1], segments: 4, round: "both" });
    b.sphere(0.014, brass, [x0, y0, zf0]);
    const wz = frontZ(f, wy - 0.05, wx) - 0.03;
    b.cylinder(0.05, 0.05, 0.016, brass, [wx, wy - 0.06, wz], [Math.PI / 2, 0, 0]);
    b.cylinder(0.041, 0.041, 0.012, PALETTE.trim.ivory, [wx, wy - 0.06, wz - 0.006], [Math.PI / 2, 0, 0]);
    b.sphere(0.012, brass, [wx, wy - 0.008, wz]);
    b.box(0.006, 0.03, 0.004, PALETTE.material.soot, [wx, wy - 0.06, wz - 0.014]);
    b.box(0.022, 0.006, 0.004, PALETTE.material.soot, [wx + 0.008, wy - 0.06, wz - 0.014]);
  } else if (spec.hipGear === 9) {
    // cartridge pouches: two box pouches with flaps and brass studs, either side of the belt buckle
    const y = h * 0.19;
    for (const sx of [-1, 1]) {
      const x = sx * W * 0.5;
      const z = frontZ(f, y, x) - 0.035;
      b.box(0.11, 0.09, 0.055, leather, [x, y, z]);
      b.box(0.115, 0.045, 0.06, f.tone(leather, 0.8), [x, y + 0.03, z - 0.003]);
      b.sphere(0.012, brass, [x, y + 0.008, z - 0.032], [1, 1, 0.6]);
    }
    belt();
  }
}
