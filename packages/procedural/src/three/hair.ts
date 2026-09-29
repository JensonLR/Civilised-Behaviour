import { SphereGeometry } from "three";
import { skinDir, type FaceCtx } from "./faceParts.ts";
import { buildShell, smooth, type Dir, type ShellSpec } from "./shell.ts";
import { curve } from "./sweep.ts";
import { greyAmount } from "./look.ts";
import { PALETTE } from "@cb/shared";
import { PartBuilder, type V3 } from "./parts.ts";
import type { GridLevel } from "./headShape.ts";

// ---- hairstyles -----------------------------------------------------------------------------------------------------------

/** Hairline height (y on the unit sphere) by azimuth: high on the forehead, above the ears at the sides, low at the nape. */
const hairline = (az: number, front = 0.42, side = 0.02, back = -0.62): number =>
  front + (side - front) * smooth(0.5, 1.5, az) + (back - side) * smooth(1.3, 2.9, az);

const shade = (color: number, k: number): number => {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
};

/** A point on the unit head in (azimuth from the face, signed: + = the character's right; height on the unit sphere). */
const dirAt = (az: number, y: number): V3 => {
  const k = Math.sqrt(Math.max(0.02, 1 - y * y));
  return [Math.sin(az) * k, y, -Math.cos(az) * k];
};

export function buildHair(c: FaceCtx, hatOn: boolean, coarse: GridLevel, hatSeat = 0.6): void {
  const { spec, P, b, shape, hairC, cy } = c;
  const R = P.headRadius;
  const grey = spec.greying > 0;
  const shell = (s: Omit<ShellSpec, "color" | "coarse" | "tint" | "tintColor">, color = hairC): void => {
    const g = buildShell(shape, { ...s, color, coarse, tint: grey ? (d) => greyAmount(spec, d.az, d.y) : undefined, tintColor: PALETTE.hair[6] });
    if (g) b.add(g, color, [0, cy, 0]);
  };
  // Under a hat the crown is cut away so nothing pokes through it.
  const hatCut = (y: number): number => (hatOn ? 1 - smooth(hatSeat - 0.14, hatSeat + 0.02, y) : 1);
  const cap = (front = 0.42, side = 0.02, back = -0.62): ((d: Dir) => number) => (d) => smooth(hairline(d.az, front, side, back) - 0.05, hairline(d.az, front, side, back) + 0.05, d.y) * hatCut(d.y);
  const hi = tone(hairC, 1.14);
  const lo = tone(hairC, 0.86);

  /**
   * A lock of hair: a thin ribbon laid on the head along a path of [azimuth, height] points, its wide side lying on the surface. `lift` (x R) is how
   * far it stands off the skin (about the thickness of the shell under it); `w` and `d` are half-width and half-depth (x R). Several of these over a
   * shell give the layered, strand-like read a flat cap cannot.
   */
  const lock = (path: readonly (readonly [number, number])[], lift: number, w: number, d: number, color: number, taper = 0.6, samples = 5): void =>
    lockDirs(path.map(([az, y]) => dirAt(az, y)), lift, w, d, color, taper, samples);
  const lockDirs = (dirs: readonly V3[], lift: number, w: number, d: number, color: number, taper = 0.6, samples = 5): void => {
    if (PartBuilder.lod > 0 || (hatOn && dirs.some((v) => v[1] > hatSeat - 0.1))) return; // strands are fine detail: crowd levels keep only the shell
    const pts = dirs.map((v, i) => skinDir(c, v[0], v[1], v[2], R * (lift + d * 0.4 - 0.02 * (i === 0 ? 1 : 0))));
    const spine = curve(pts, samples);
    const dsp = curve(dirs, samples);
    b.sweep(
      spine,
      (t) => ({ rx: R * w * (1 - taper * t * t), rz: R * d * (1 - 0.5 * t), pow: 2.2, color: t > 0.6 ? color : tone(color, 0.96) }),
      color,
      {
        segments: 4,
        sideAt: (i) => {
          const a = spine[Math.max(0, i - 1)]!;
          const e = spine[Math.min(spine.length - 1, i + 1)]!;
          const tv: V3 = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
          const n = dsp[Math.min(dsp.length - 1, i)] ?? dsp[dsp.length - 1]!;
          return [n[1] * tv[2] - n[2] * tv[1], n[2] * tv[0] - n[0] * tv[2], n[0] * tv[1] - n[1] * tv[0]] as V3;
        },
      },
    );
  };

  switch (spec.hair) {
    case 1: { // side part: a swept-over mass with a parting line and locks combed from it
      const m = cap(0.4);
      shell({
        mask: m,
        thick: (d) => {
          const part = Math.exp(-(((d.phi + 0.5) / 0.09) ** 2)) * smooth(0.3, 0.7, d.y);
          const over = d.phi > -0.5 ? 0.05 : 0;
          return 0.075 + 0.03 * d.y + over + 0.02 * smooth(0.6, 1, d.y) - 0.07 * part;
        },
      });
      for (let i = 0; i < 6; i++) lock([[-0.5 + i * 0.05, 0.9 - i * 0.05], [0.4 + i * 0.12, 0.8 - i * 0.06], [1.0 + i * 0.1, 0.5 - i * 0.12], [1.5 + i * 0.05, 0.05 - i * 0.12]], 0.085, 0.07, 0.03, i % 2 ? hi : lo);
      break;
    }
    case 2: { // wild tufts: a thin cap with a ring of spikes
      shell({ mask: cap(0.5, 0.1, -0.3), thick: () => 0.06 });
      if (!hatOn) {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + 0.3;
          const dx = Math.sin(a) * 0.75;
          const dz = Math.cos(a) * 0.75;
          const p0 = skinDir(c, dx, 0.66, dz, -R * 0.02);
          const p1: V3 = [p0[0] + dx * R * 0.5, p0[1] + R * 0.3, p0[2] + dz * R * 0.5];
          const p2: V3 = [p0[0] + dx * R * 0.85, p0[1] + R * 0.62, p0[2] + dz * R * 0.85];
          b.sweep([p0, p1, p2], (t) => ({ rx: R * 0.15 * (1 - t * 0.95), rz: R * 0.12 * (1 - t * 0.95), pow: 2.2 }), i % 2 ? hi : hairC, { side: [0, 0, 1], segments: 6 });
        }
      }
      break;
    }
    case 3: { // curls: a cap studded with round curls (never a row across the brow)
      shell({ mask: cap(0.5, 0.1, -0.4), thick: () => 0.05 });
      const curl = (p: V3, r: number, k = 1): void => void b.add(new SphereGeometry(r, 8, 5), tone(hairC, k), p, [0, 0, 0], [1, 0.9, 1]);
      for (let i = 0; i < 10; i++) {
        const az = 0.85 + (i / 9) * 4.55; // from the temple round the back to the other temple
        const dy = Math.min(0.2 + (i % 3) * 0.16, hatOn ? hatSeat - 0.14 : 9);
        curl(skinDir(c, Math.sin(az) * (1 - dy * 0.3), dy, -Math.cos(az) * (1 - dy * 0.3), R * 0.09), R * 0.2, i % 2 ? 1.1 : 0.92);
      }
      if (!hatOn) for (let i = 0; i < 5; i++) curl(skinDir(c, Math.cos(i * 1.26) * 0.45, 0.93, Math.sin(i * 1.26) * 0.45 + 0.1, R * 0.06), R * 0.22, i % 2 ? 1.08 : 0.94);
      break;
    }
    case 4: // slicked back: a thin, high-gloss cap combed into lines
      shell({ mask: cap(0.5, 0.1, -0.55), thick: (d) => 0.045 + 0.02 * d.y, shine: 0.3 });
      for (let i = 0; i < 7; i++) {
        const s = -0.72 + i * 0.24; // combed lines from the hairline over the crown to the nape
        lockDirs([[s * 0.9, 0.55, -0.75], [s * 0.6, 0.98, -0.2], [s * 0.6, 0.85, 0.5], [s * 0.85, 0.15, 0.9]], 0.06, 0.05, 0.02, i % 2 ? hi : hairC, 0.5, 9);
      }
      break;
    case 5: // receding: a wreath round the sides and back, bare on top
      shell({
        mask: (d) => cap(0.3, 0.0, -0.6)(d) * smooth(0.6, 1.5, d.az) * (1 - smooth(0.7, 0.95, d.y) * 0.9),
        thick: () => 0.08,
      });
      for (let i = 0; i < 5; i++) lock([[1.0 + i * 0.03, 0.55 - i * 0.02], [1.7 + i * 0.12, 0.45 - i * 0.14], [2.4 + i * 0.1, 0.2 - i * 0.16]], 0.09, 0.06, 0.025, i % 2 ? hi : lo, 0.4);
      break;
    case 6: { // top knot
      shell({ mask: cap(0.5, 0.05, -0.5), thick: () => 0.05 });
      if (!hatOn) {
        const top = skinDir(c, 0, 1, 0.02, 0);
        b.loft(
          [
            { y: 0, rx: R * 0.16, rz: R * 0.16, color: hairC },
            { y: R * 0.14, rx: R * 0.13, rz: R * 0.13, color: hairC, crease: true },
            { y: R * 0.2, rx: R * 0.28, rz: R * 0.28, color: hairC },
            { y: R * 0.4, rx: R * 0.3, rz: R * 0.3, color: hi },
            { y: R * 0.58, rx: R * 0.16, rz: R * 0.16, color: hairC },
          ],
          hairC,
          [top[0], top[1] - R * 0.03, top[2]],
        );
      }
      break;
    }
    case 7: // bowl cut: a heavy helmet of hair with a blunt fringe
      shell({
        mask: (d) => {
          const hl = d.z < 0 ? 0.5 - 0.12 * smooth(0.6, 1.3, d.az) : 0.5 - 0.5 * smooth(0.5, 1.4, d.az);
          const edge = smooth(-0.02, 0.02, d.y - Math.min(hl, 0.52) + (d.az > 1.2 ? 0.55 : 0));
          return edge * (d.az < 1.5 ? smooth(hl - 0.03, hl + 0.03, d.y) : smooth(-0.02, 0.03, d.y - 0.02)) * hatCut(d.y);
        },
        thick: (d) => 0.12 + 0.03 * smooth(0.3, 0.5, d.y) * smooth(1.3, 0.3, d.az),
      });
      break;
    case 8: { // long lank: a cap plus long flat curtains to the shoulders
      shell({ mask: cap(0.42, 0.0, -0.45), thick: () => 0.07 });
      for (const s of [-1, 1]) {
        const top = skinDir(c, s * 0.95, 0.15, 0.12, R * 0.02);
        const pts: V3[] = [top, [top[0] + s * R * 0.06, top[1] - R * 0.7, top[2] + R * 0.06], [top[0] + s * R * 0.05, top[1] - R * 1.5, top[2] + R * 0.05], [top[0] + s * R * 0.0, top[1] - R * 2.1, top[2] + R * 0.02]];
        b.sweep(curve(pts, 10), (t) => ({ rx: R * (0.09 - 0.03 * t), rz: R * (0.22 - 0.05 * t), pow: 3, color: t > 0.5 ? tone(hairC, 0.94) : hairC }), hairC, { side: [0, 0, 1], segments: 7 });
        for (const dz of [-0.06, 0.06]) b.sweep(curve(pts.map((p): V3 => [p[0], p[1] - R * 0.05, p[2] + R * dz]), 8), (t) => ({ rx: R * 0.025 * (1 - t), rz: R * 0.24, pow: 2.2 }), dz > 0 ? hi : lo, { side: [0, 0, 1], segments: 4 });
      }
      const back = skinDir(c, 0, 0.1, 1, R * 0.02);
      b.sweep(
        curve([back, [back[0], back[1] - R * 0.9, back[2] + R * 0.12], [back[0], back[1] - R * 1.9, back[2] + R * 0.1], [back[0], back[1] - R * 2.4, back[2] + R * 0.06]], 10),
        (t) => ({ rx: R * (0.85 - 0.25 * t), rz: R * (0.1 + 0.02 * t), pow: 2.8 }),
        hairC,
        { side: [1, 0, 0], segments: 9 },
      );
      break;
    }
    case 9: // pompadour: a cap with a great swept-up quiff above the forehead
      shell({
        mask: cap(0.5, 0.05, -0.5),
        thick: (d) => 0.05 + 0.3 * Math.exp(-(((d.phi / 0.55) ** 2) + (((d.y - 0.78) / 0.28) ** 2))) * (d.z < 0 ? 1 : 0.2),
        lift: (d) => [0, 0.14 * Math.exp(-(((d.phi / 0.55) ** 2) + (((d.y - 0.78) / 0.28) ** 2))), -0.08 * Math.exp(-(((d.phi / 0.55) ** 2) + (((d.y - 0.78) / 0.28) ** 2)))],
        shine: 0.28,
      });
      break;
    case 10: { // ponytail: a slicked cap, a tie at the back and a tail swinging down the neck
      shell({ mask: cap(0.5, 0.1, -0.5), thick: (d) => 0.045 + 0.02 * d.y, shine: 0.25 });
      const tie = skinDir(c, 0, 0.12, 1, R * 0.05);
      const tail: V3[] = [tie, [tie[0], tie[1] - R * 0.15, tie[2] + R * 0.25], [tie[0] + R * 0.04, tie[1] - R * 0.7, tie[2] + R * 0.42], [tie[0] - R * 0.03, tie[1] - R * 1.4, tie[2] + R * 0.4], [tie[0], tie[1] - R * 1.85, tie[2] + R * 0.34]];
      b.sweep(curve(tail, 9), (t) => ({ rx: R * (0.15 - 0.08 * t * t + 0.05 * Math.sin(Math.PI * t)), rz: R * (0.13 - 0.06 * t * t + 0.05 * Math.sin(Math.PI * t)), pow: 2.3, color: t > 0.5 ? hi : hairC }), hairC, { side: [1, 0, 0], segments: 6, round: "end" });
      b.torus(R * 0.11, R * 0.03, PALETTE.trim.ribbonRed, [tie[0], tie[1] - R * 0.14, tie[2] + R * 0.12], [Math.PI / 2 - 0.6, 0, 0]);
      break;
    }
    case 11: { // plait: a tight cap and a braid hanging down the back, tied with a ribbon
      shell({ mask: cap(0.5, 0.1, -0.5), thick: (d) => 0.05 + 0.015 * d.y });
      const start = skinDir(c, 0, 0.05, 1, R * 0.02);
      // the braid: a cable swept down the back of the neck, its radius pulsing so it reads as interlaced plaits
      const path: V3[] = [start, [start[0], start[1] - R * 0.35, start[2] - R * 0.22], [start[0], start[1] - R * 0.9, start[2] - R * 0.3], [start[0], start[1] - R * 1.4, start[2] - R * 0.24], [start[0], start[1] - R * 1.75, start[2] - R * 0.2]];
      b.sweep(curve(path, 22), (t, i) => ({ rx: R * (0.085 - 0.03 * t + 0.022 * Math.sin(i * 1.9)), rz: R * (0.085 - 0.03 * t + 0.022 * Math.sin(i * 1.9)), pow: 2.2, color: Math.sin(i * 1.9) > 0 ? hi : lo }), hairC, { side: [1, 0, 0], segments: 5, round: "end" });
      b.torus(R * 0.06, R * 0.02, PALETTE.trim.ribbonBlue, [start[0], start[1] - R * 1.72, start[2] - R * 0.2], [Math.PI / 2, 0, 0]);
      break;
    }
    case 12: { // monk fringe: bald crown, a ring of hair round the sides and back
      shell({
        mask: (d) => cap(0.05, -0.05, -0.62)(d) * (1 - smooth(0.05, 0.3, d.y)) * smooth(0.55, 1.05, d.az),
        thick: () => 0.085,
      });
      for (let i = 0; i < 6; i++) lock([[1.1 + i * 0.05, 0.22], [1.8 + i * 0.22, 0.05], [2.4 + i * 0.13, -0.2]], 0.09, 0.07, 0.03, i % 2 ? hi : lo, 0.5);
      break;
    }
    case 13: { // comb-over: a thin fringe at the sides, a few long strands dragged across the bald crown
      shell({ mask: (d) => cap(0.05, 0.0, -0.55)(d) * (1 - smooth(0.1, 0.35, d.y)) * smooth(0.5, 1.0, d.az), thick: () => 0.06 });
      if (!hatOn) for (let i = 0; i < 6; i++) lock([[-1.35, 0.32 + i * 0.05], [-0.7, 0.72 + i * 0.035], [0.1, 0.94 - i * 0.02], [0.95, 0.72 - i * 0.035]], 0.02, 0.035, 0.016, i % 2 ? hi : hairC, 0.5, 8);
      break;
    }
    case 14: { // thin wisps: a few sad strands
      if (!hatOn) for (let i = 0; i < 7; i++) lock([[-0.6 + i * 0.2, 0.55], [-0.5 + i * 0.18, 0.85 + (i % 3) * 0.03], [-0.3 + i * 0.17, 0.98]], 0.015, 0.02, 0.012, i % 2 ? hi : lo, 0.6);
      shell({ mask: (d) => cap(0.0, -0.05, -0.55)(d) * (1 - smooth(0.0, 0.3, d.y)) * smooth(0.6, 1.1, d.az), thick: () => 0.05 });
      break;
    }
    case 15: { // shaggy mane: a big layered mass of hair with locks falling to the shoulders all round
      shell({ mask: cap(0.5, -0.2, -0.85), thick: (d) => 0.13 + 0.05 * smooth(0.2, 0.9, d.y) }, hairC);
      for (let i = 0; i < 12; i++) {
        const az = -2.7 + i * 0.5;
        if (Math.abs(az) < 0.6) continue;
        const s = Math.sign(az);
        const a = skinDir(c, ...dirAt(az, 0.15), R * 0.1);
        const pts: V3[] = [a, [a[0] + s * R * 0.14, a[1] - R * 0.5, a[2] + (Math.abs(az) > 1.8 ? R * 0.1 : -R * 0.02)], [a[0] + s * R * 0.2, a[1] - R * 1.05, a[2] + (Math.abs(az) > 1.8 ? R * 0.16 : R * 0.02)], [a[0] + s * R * 0.16, a[1] - R * (1.35 + 0.15 * (i % 3)), a[2] + (Math.abs(az) > 1.8 ? R * 0.14 : R * 0.03)]];
        b.sweep(curve(pts, 7), (t) => ({ rx: R * (0.14 - 0.11 * t), rz: R * (0.09 - 0.05 * t), pow: 2.2, color: t > 0.4 ? (i % 2 ? hi : lo) : hairC }), hairC, { side: [0, 0, 1], segments: 5, round: "end" });
      }
      break;
    }
    case 16: { // mop top: a thick bowl that grows over the ears, with a long fringe hanging over the brow
      shell({
        mask: (d) => {
          const hl = d.z < 0 ? 0.28 - 0.3 * smooth(0.6, 1.3, d.az) : 0.05 - 0.5 * smooth(0.5, 1.6, d.az);
          return smooth(hl - 0.05, hl + 0.03, d.y) * hatCut(d.y);
        },
        thick: (d) => 0.11 + 0.05 * smooth(0.2, 0.9, d.y),
        shine: 0.1,
      });
      for (let i = 0; i < 8; i++) lock([[-0.6 + i * 0.16, 0.86], [-0.55 + i * 0.15, 0.55], [-0.5 + i * 0.14, 0.26 + (i % 2) * 0.03]], 0.13, 0.07, 0.03, i % 2 ? hi : lo, 0.5);
      break;
    }
    default:
      break;
  }
}

function tone(color: number, k: number): number {
  return shade(color, k);
}
