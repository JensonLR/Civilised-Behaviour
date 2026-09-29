import type { BufferGeometry } from "three";
import { ZONE, type ZoneId } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { faceSurfaceZ } from "./head.ts";
import { PartBuilder } from "./parts.ts";

/** Player gore setting. "off" replaces every drop of red with dressings and iodine so wounds still read. */
export type GoreLevel = "full" | "reduced" | "off";

interface Palette {
  /** Fresh stain, older stain, drip. */
  fresh: number;
  old: number;
  drip: number;
  /** Multiplier on stain size. */
  size: number;
  drips: boolean;
}

const BANDAGE = 0xe6dbbd;
const BANDAGE_DIRTY = 0xc9bb96;

const PALETTES: Record<GoreLevel, Palette> = {
  full: { fresh: 0xa3161a, old: 0x6e0f12, drip: 0x8a1216, size: 1, drips: true },
  reduced: { fresh: 0x7d4136, old: 0x5c302a, drip: 0x6b352d, size: 0.7, drips: false },
  // Iodine and grime: reads as "treated wound" with no blood at all.
  off: { fresh: 0xc08a2c, old: 0x9c8a66, drip: 0xb08028, size: 0.85, drips: false },
};

/** Front (-Z) surface of an ellipsoid centred at (0, cy, 0) at height y and lateral offset x. Falls back to the equator. */
const ellipsoidFront = (cy: number, rx: number, ry: number, rz: number, x: number, y: number): number =>
  -rz * Math.sqrt(Math.max(0.05, 1 - (x / rx) ** 2 - ((y - cy) / ry) ** 2));

/**
 * Bandages, plasters and stains for one body zone at one severity, as a single merged vertex-coloured geometry in the
 * BONE's local frame (same convention as the bone meshes: joint at the origin, +Y up, face toward -Z).
 *
 * Severity reads without any red: 1 = a plaster, 2 = a wrapped dressing, 3 = a bulky, blood-soaked wrap with a tail.
 * `gore` only recolours and resizes the stains. Returns undefined for severity 0.
 */
export function buildWoundGeometry(zone: ZoneId, severity: number, gore: GoreLevel, P: Proportions, spec: CharacterSpec): BufferGeometry | undefined {
  if (severity <= 0) return undefined;
  const sev = Math.min(3, Math.floor(severity));
  const pal = PALETTES[gore];
  const b = new PartBuilder();
  const stain = (x: number, y: number, z: number, w: number, h: number, color = sev >= 3 ? pal.fresh : pal.old): void => {
    b.sphere(1, color, [x, y, z], [w * pal.size, h * pal.size, 0.012]);
  };
  const plaster = (x: number, y: number, z: number, w: number, h: number, rotZ = 0.5): void => {
    b.box(w, h, 0.014, BANDAGE, [x, y, z], [0, 0, rotZ]);
    b.box(w * 0.36, h * 0.9, 0.018, BANDAGE_DIRTY, [x, y, z - 0.002], [0, 0, rotZ]); // the pad
  };
  /** A rolled edge of a dressing: a short, slightly proud open ring (a torus costs ~5x the triangles). */
  const edge = (r: number, y: number, sx = 1, sz = 1): void => {
    b.cylinder(r + 0.006, r + 0.006, 0.016, BANDAGE_DIRTY, [0, y, 0], undefined, [sx, 1, sz], true);
  };
  /** A cylindrical dressing around a limb between two fractions of its length. `radiusAt(f)` is the limb radius at fraction f. */
  const wrapLimb = (len: number, radiusAt: (f: number) => number, from: number, to: number, color = BANDAGE): void => {
    const pad = 0.014;
    b.cylinder(radiusAt(from) + pad, radiusAt(to) + pad, (to - from) * len, color, [0, -len * (from + to) * 0.5, 0], undefined, undefined, true);
    // rolled edges
    edge(radiusAt(from) + pad, -len * from);
    edge(radiusAt(to) + pad, -len * to);
  };
  /** Dangling tail of the bandage at the side of a limb. */
  const tail = (x: number, y: number, z: number, length: number): void => {
    b.box(0.03, length, 0.012, BANDAGE, [x, y - length / 2, z], [0, 0, 0.12]);
  };

  switch (zone) {
    case ZONE.TORSO: {
      const h = P.torsoHeight;
      const rx = P.torsoWidth / 2;
      const rz = P.torsoDepth / 2;
      const ry = h * 0.52;
      const cy = h * 0.5;
      if (sev === 1) {
        const y = h * 0.66;
        plaster(rx * 0.32, y, ellipsoidFront(cy, rx * 1.05, ry, rz, rx * 0.32, y) - 0.012, 0.11, 0.055);
      } else {
        // A chest wrap following the torso ellipse: open cylinder scaled to rx/rz.
        const top = sev === 2 ? 0.74 : 0.8;
        const bot = sev === 2 ? 0.56 : 0.46;
        const wy = h * (top + bot) * 0.5;
        const wh = h * (top - bot);
        b.cylinder(1, 1, wh, BANDAGE, [0, wy, 0], undefined, [rx * 1.08 + P.bellyRadius * 0.12, 1, rz * 1.1 + P.bellyForward * 0.25], true);
        edge(0.994, wy + wh / 2, rx * 1.08 + P.bellyRadius * 0.12, rz * 1.1 + P.bellyForward * 0.25);
        edge(0.994, wy - wh / 2, rx * 1.08 + P.bellyRadius * 0.12, rz * 1.1 + P.bellyForward * 0.25);
        const fz = -(rz * 1.1 + P.bellyForward * 0.25) - 0.006;
        stain(rx * 0.3, wy, fz, sev === 2 ? 0.06 : 0.1, sev === 2 ? 0.07 : 0.13);
        if (sev === 3) {
          stain(-rx * 0.35, wy - wh * 0.15, fz + 0.004, 0.05, 0.06, pal.old);
          if (pal.drips) b.sphere(1, pal.drip, [rx * 0.3, wy - wh * 0.5 - 0.09, fz + 0.002], [0.016, 0.1, 0.008]);
        }
        // and one on the back so it reads from the follow camera
        stain(-rx * 0.2, wy, rz * 1.1 + P.bellyForward * 0.02 + 0.006, sev === 2 ? 0.05 : 0.09, sev === 2 ? 0.06 : 0.11);
      }
      break;
    }
    case ZONE.HEAD: {
      const R = P.headRadius;
      const cy = R;
      const side = spec.skin % 2 === 0 ? 1 : -1; // which cheek/temple: stable per character, so the same face is always marked the same way
      if (sev === 1) {
        const x = side * R * 0.5;
        const y = -R * 0.22;
        plaster(x, cy + y, faceSurfaceZ(P, y, x) - 0.012, R * 0.42, R * 0.2, side * 0.55);
      } else {
        // Head bandage: a band around the skull just above the brows, tied off with a knot and two tails at the side.
        const by = R * 0.5;
        const half = sev === 2 ? R * 0.15 : R * 0.24;
        // Hair sits ~12% proud of the skull; the band has to clear it or it disappears into the hair.
        const skullR = (y: number): number => R * Math.sqrt(Math.max(0.1, 1 - (y / (1.02 * R)) ** 2)) * (spec.hair === 0 ? 1 : 1.13) + 0.012;
        const rr = skullR(by);
        // Tapered so the band hugs the dome instead of floating like a bucket rim.
        b.cylinder(skullR(by + half), skullR(by - half), half * 2, BANDAGE, [0, cy + by, 0], undefined, undefined, true);
        edge(skullR(by + half), cy + by + half);
        edge(skullR(by - half), cy + by - half);
        b.sphere(0.03, BANDAGE, [side * rr * 0.9, cy + by, -rr * 0.35]);
        tail(side * rr * 0.92, cy + by, -rr * 0.3, R * 0.5);
        // A hat hides the band, so a cheek plaster keeps the wound readable under headwear.
        const cx = -side * R * 0.5;
        const cyy = -R * 0.22;
        plaster(cx, cy + cyy, faceSurfaceZ(P, cyy, cx) - 0.012, R * 0.42, R * 0.2, -side * 0.55);
        stain(side * rr * 0.4, cy + by + 0.005, -rr * 0.92, sev === 2 ? 0.05 : 0.085, half * 0.9);
        if (sev === 3) {
          stain(-side * rr * 0.3, cy + by, rr * 0.94, 0.07, half * 0.8, pal.old);
          // blood running down from under the wrap
          if (pal.drips) b.sphere(1, pal.drip, [side * rr * 0.4, cy + by - half - R * 0.28, faceSurfaceZ(P, by - half - R * 0.28, side * rr * 0.4) - 0.006], [0.018, R * 0.3, 0.008]);
        }
      }
      break;
    }
    case ZONE.ARM_L:
    case ZONE.ARM_R: {
      const sx = zone === ZONE.ARM_L ? -1 : 1;
      const r = P.armRadius;
      const len = P.armUpper;
      const rad = (f: number): number => r * (1.15 - 0.15 * f);
      if (sev === 1) {
        plaster(sx * rad(0.5) * 0.35, -len * 0.5, -rad(0.5) - 0.01, 0.09, 0.05, 0.5);
      } else {
        wrapLimb(len, rad, sev === 2 ? 0.3 : 0.15, sev === 2 ? 0.7 : 0.85);
        const zf = -rad(0.5) - 0.02;
        stain(sx * rad(0.5) * 0.25, -len * 0.5, zf, sev === 2 ? 0.04 : 0.065, sev === 2 ? 0.055 : 0.1);
        stain(-sx * rad(0.5) * 0.1, -len * 0.45, rad(0.5) + 0.02, 0.04, 0.07, pal.old); // back of the arm
        if (sev === 3) {
          tail(sx * (rad(0.5) + 0.012), -len * 0.82, 0.0, 0.16);
          if (pal.drips) b.sphere(1, pal.drip, [sx * rad(0.8) * 0.2, -len * 0.9, zf + 0.004], [0.014, 0.09, 0.008]);
        }
      }
      break;
    }
    case ZONE.LEG_L:
    case ZONE.LEG_R: {
      const sx = zone === ZONE.LEG_L ? -1 : 1;
      const r = (spec.trousers === 3 ? 0.14 : 0.11) * P.scale + 0.02;
      const len = P.legUpper;
      const rad = (f: number): number => r * (1.15 - 0.15 * f);
      if (sev === 1) {
        plaster(sx * rad(0.5) * 0.3, -len * 0.5, -rad(0.5) - 0.01, 0.1, 0.055, -0.5);
      } else {
        wrapLimb(len, rad, sev === 2 ? 0.3 : 0.15, sev === 2 ? 0.7 : 0.88);
        const zf = -rad(0.5) - 0.02;
        stain(sx * rad(0.5) * 0.2, -len * 0.5, zf, sev === 2 ? 0.05 : 0.08, sev === 2 ? 0.065 : 0.12);
        stain(0, -len * 0.45, rad(0.5) + 0.02, 0.05, 0.08, pal.old);
        if (sev === 3) {
          tail(sx * (rad(0.5) + 0.012), -len * 0.8, 0.0, 0.2);
          if (pal.drips) b.sphere(1, pal.drip, [sx * rad(0.8) * 0.2, -len * 0.92, zf + 0.004], [0.016, 0.11, 0.008]);
        }
      }
      break;
    }
  }
  return b.build();
}
