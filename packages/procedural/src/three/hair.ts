import { skinDir, type FaceCtx } from "./faceParts.ts";
import { buildShell, smooth, type Dir, type ShellSpec } from "./shell.ts";
import { curve } from "./sweep.ts";
import { SphereGeometry } from "three";
import type { V3 } from "./parts.ts";

// ---- hairstyles -----------------------------------------------------------------------------------------------------------

/** Hairline height (y on the unit sphere) by azimuth: high on the forehead, above the ears at the sides, low at the nape. */
const hairline = (az: number, front = 0.42, side = 0.1, back = -0.25): number =>
  front + (side - front) * smooth(0.5, 1.7, az) + (back - side) * smooth(1.7, 3.0, az);

export function buildHair(c: FaceCtx, hatOn: boolean, coarse: boolean): void {
  const { spec, P, b, shape, hairC, cy } = c;
  const R = P.headRadius;
  const shell = (s: Omit<ShellSpec, "color" | "coarse">): void => {
    const g = buildShell(shape, { ...s, color: hairC, coarse });
    if (g) b.add(g, hairC, [0, cy, 0]);
  };
  // Under a hat the crown is cut away so nothing pokes through it.
  const hatCut = (y: number): number => (hatOn ? 1 - smooth(0.5, 0.68, y) : 1);
  const cap = (front = 0.42, side = 0.1, back = -0.25): ((d: Dir) => number) => (d) => smooth(hairline(d.az, front, side, back) - 0.05, hairline(d.az, front, side, back) + 0.05, d.y) * hatCut(d.y);

  switch (spec.hair) {
    case 1: { // side part: a swept-over mass with a parting line
      const m = cap(0.4);
      shell({
        mask: m,
        thick: (d) => {
          const part = Math.exp(-(((d.phi + 0.5) / 0.09) ** 2)) * smooth(0.3, 0.7, d.y);
          const over = d.phi > -0.5 ? 0.05 : 0;
          return 0.075 + 0.03 * d.y + over + 0.02 * smooth(0.6, 1, d.y) - 0.07 * part;
        },
      });
      break;
    }
    case 2: { // wild tufts: a thin cap with a ring of spikes
      shell({ mask: cap(0.5, 0.15, -0.1), thick: () => 0.06 });
      if (!hatOn) {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + 0.3;
          const dx = Math.sin(a) * 0.75;
          const dz = Math.cos(a) * 0.75;
          const p0 = skinDir(c, dx, 0.66, dz, -R * 0.02);
          const p1: V3 = [p0[0] + dx * R * 0.5, p0[1] + R * 0.3, p0[2] + dz * R * 0.5];
          const p2: V3 = [p0[0] + dx * R * 0.85, p0[1] + R * 0.62, p0[2] + dz * R * 0.85];
          b.sweep([p0, p1, p2], (t) => ({ rx: R * 0.15 * (1 - t * 0.95), rz: R * 0.12 * (1 - t * 0.95), pow: 2.2 }), hairC, { side: [0, 0, 1], segments: 6 });
        }
      }
      break;
    }
    case 3: { // curls: a cap studded with round curls (never a row across the brow)
      shell({ mask: cap(0.5, 0.2, -0.2), thick: () => 0.05 });
      const curl = (p: V3, r: number): void => void b.add(new SphereGeometry(r, 8, 5), hairC, p, [0, 0, 0], [1, 0.9, 1]);
      for (let i = 0; i < 10; i++) {
        const az = 0.85 + (i / 9) * 4.55; // from the temple round the back to the other temple
        const dy = 0.2 + (i % 3) * 0.16;
        curl(skinDir(c, Math.sin(az) * (1 - dy * 0.3), dy, -Math.cos(az) * (1 - dy * 0.3), R * 0.09), R * 0.2);
      }
      if (!hatOn) for (let i = 0; i < 5; i++) curl(skinDir(c, Math.cos(i * 1.26) * 0.45, 0.93, Math.sin(i * 1.26) * 0.45 + 0.1, R * 0.06), R * 0.22);
      break;
    }
    case 4: // slicked back: a thin, high-gloss cap
      shell({ mask: cap(0.5, 0.15, -0.3), thick: (d) => 0.045 + 0.02 * d.y, shine: 0.3 });
      break;
    case 5: // receding: a wreath round the sides and back, bare on top
      shell({
        mask: (d) => cap(0.3, 0.05, -0.3)(d) * smooth(0.6, 1.5, d.az) * (1 - smooth(0.7, 0.95, d.y) * 0.9),
        thick: () => 0.08,
      });
      break;
    case 6: { // top knot
      shell({ mask: cap(0.5, 0.1, -0.2), thick: () => 0.05 });
      if (!hatOn) {
        const top = skinDir(c, 0, 1, 0.02, 0);
        b.loft(
          [
            { y: 0, rx: R * 0.16, rz: R * 0.16, color: hairC },
            { y: R * 0.14, rx: R * 0.13, rz: R * 0.13, color: hairC, crease: true },
            { y: R * 0.2, rx: R * 0.28, rz: R * 0.28, color: hairC },
            { y: R * 0.4, rx: R * 0.3, rz: R * 0.3, color: hairC },
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
      shell({ mask: cap(0.42, 0.05, -0.2), thick: () => 0.07 });
      for (const s of [-1, 1]) {
        const top = skinDir(c, s * 0.95, 0.15, 0.12, R * 0.02);
        const pts: V3[] = [top, [top[0] + s * R * 0.06, top[1] - R * 0.7, top[2] + R * 0.06], [top[0] + s * R * 0.05, top[1] - R * 1.5, top[2] + R * 0.05], [top[0] + s * R * 0.0, top[1] - R * 2.1, top[2] + R * 0.02]];
        b.sweep(curve(pts, 10), (t) => ({ rx: R * (0.09 - 0.03 * t), rz: R * (0.22 - 0.05 * t), pow: 3 }), hairC, { side: [0, 0, 1], segments: 7 });
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
        mask: cap(0.5, 0.1, -0.25),
        thick: (d) => 0.05 + 0.3 * Math.exp(-(((d.phi / 0.55) ** 2) + (((d.y - 0.78) / 0.28) ** 2))) * (d.z < 0 ? 1 : 0.2),
        lift: (d) => [0, 0.14 * Math.exp(-(((d.phi / 0.55) ** 2) + (((d.y - 0.78) / 0.28) ** 2))), -0.08 * Math.exp(-(((d.phi / 0.55) ** 2) + (((d.y - 0.78) / 0.28) ** 2)))],
        shine: 0.28,
      });
      break;
    default:
      break;
  }
}
