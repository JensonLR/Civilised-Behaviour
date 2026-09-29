import { SphereGeometry, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { buildBeard, buildEars, buildMoustache, buildNose, buildSideburns, onSkin, skinDir, type FaceCtx } from "./faceParts.ts";
import type { V3 } from "./parts.ts";
import { curve } from "./sweep.ts";
import { buildHair } from "./hair.ts";
import { buildSkull, faceSurfaceZ, headShape } from "./headShape.ts";
import { LEATHER, PartBuilder, singe } from "./parts.ts";

export { faceSurfaceZ };

export interface HeadColors {
  skin: number;
  hairC: number;
  hatC: number;
  accent: number;
  burnt: number;
}

/** Where the animated mouth sits (relative to head centre): in the sculpted groove between the lips. */
export function mouthPlacement(P: Proportions): { y: number; z: number } {
  const y = -P.headRadius * 0.49;
  return { y, z: headShape(P).front(0, y)[2] - P.headRadius * 0.012 };
}

/** Where the eyeballs sit (relative to head centre). */
export function eyePlacement(P: Proportions): { x: number; y: number; z: number; radius: number } {
  const R = P.headRadius;
  const x = R * 0.4;
  const y = R * 0.1;
  const radius = R * 0.19;
  return { x, y, z: headShape(P).front(x, y)[2] + radius * 0.55, radius };
}

export function buildHead(spec: CharacterSpec, P: Proportions, c: HeadColors): BufferGeometry | undefined {
  const R = P.headRadius;
  const b = new PartBuilder();
  const { skin, hairC, hatC, accent, burnt } = c;
  const cy = R; // head centre above the neck joint
  const shape = headShape(P);
  const hatOn = spec.hat !== 0;
  // Where each hat's band sits on the head (x R above the head centre) - forehead height, above the brow ridge. The crown is then exactly as wide
  // as the skull is there plus a margin for hair, so the hat wraps the head instead of hovering over it.
  const HAT_SEAT = [0, 0.55, 0.5, 0.42, 0.55, 0.55, 0.5, 0.45, 0.5, 0.45, 0.52];
  const seatY = hatOn ? (HAT_SEAT[spec.hat] ?? 0.5) : 0;
  const hatCrown = hatOn ? shape.widthAt(seatY * R) / R + 0.085 : 0;
  const coarse = PartBuilder.hullMode;
  const fc: FaceCtx = { spec, P, shape, b, cy, skin, hairC, accent };

  // ---- the head itself: one sculpted skin, a neck, ears and a nose that grows out of it -----------------------------------------
  b.add(buildSkull(shape, { skin, coarse }), skin, [0, cy, 0]);
  b.loft(
    [
      { y: -(P.neck + 0.03), rx: R * 0.46, rz: R * 0.44, color: singe(skin, 1) },
      { y: R * 0.25, rx: R * 0.44, rz: R * 0.42, color: skin },
    ],
    skin,
  );
  buildEars(fc);
  buildNose(fc);
  buildSideburns(fc);
  buildHair(fc, hatOn, coarse, seatY);
  buildBeard(fc);
  buildMoustache(fc);

  // ---- eyewear and eyepatch: every frame, arm and strap is a sweep that FOLLOWS the skin (or hangs from it), so nothing pokes out --------------------
  const eye = eyePlacement(P);
  const ex = eye.x;
  const ey = cy + eye.y;
  const glassZ = eye.z - eye.radius * 1.12; // just in front of the eyeball
  const bridgeZ = shape.front(0, R * 0.1)[2] - R * 0.075; // in front of the nose root, which is the only thing between the lenses
  /** A strap/arm: hugs the skin from azimuth a0 to a1 (radians from the face) at a height rising from y0 to y1 (unit sphere), `off` proud. */
  const strap = (color: number, a0: number, a1: number, y0: number, y1: number, sign: 1 | -1, thick: number, flat: number, extra: readonly V3[] = []): void => {
    const pts: V3[] = [...extra];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const az = a0 + (a1 - a0) * t;
      const y = y0 + (y1 - y0) * t;
      pts.push(skinDir(fc, sign * Math.sin(az) * (1 - y * y * 0.4), y, -Math.cos(az) * (1 - y * y * 0.4), R * (0.014 + thick * 0.4)));
    }
    b.sweep(curve(pts, 12), () => ({ rx: R * flat, rz: R * thick, pow: 2.4 }), color, { side: [0, 1, 0], segments: 6, round: "both" });
  };
  const lens = (sx: number, r: number, color: number, tube = 0.02): void => void b.torus(r, R * tube, color, [sx * ex, ey, glassZ], [0, 0, 0]);
  switch (spec.eyewear) {
    case 1: { // monocle on a chain
      lens(1, eye.radius * 1.5, accent);
      const ring: V3 = [ex + eye.radius * 0.35, ey - eye.radius * 1.5, glassZ];
      b.sweep(curve([ring, onSkin(fc, ex + R * 0.2, -R * 0.35, R * 0.03), onSkin(fc, R * 0.55, -R * 0.75, R * 0.03), onSkin(fc, R * 0.4, -R * 1.02, R * 0.02)], 12), () => ({ rx: R * 0.008, rz: R * 0.008, pow: 2 }), accent, { side: [0, 0, 1], segments: 5, round: "end" });
      break;
    }
    case 2: { // spectacles: two round rims, an arched bridge over the nose root, arms hugging the temples back to the ears
      const r = eye.radius * 1.35;
      for (const sx of [-1, 1]) {
        lens(sx, r, PALETTE.trim.frame);
        strap(PALETTE.trim.frame, 0.62, 1.42, 0.12, 0.12, sx < 0 ? -1 : 1, 0.012, 0.014, [[sx * (ex + r), ey, glassZ]]);
      }
      b.sweep(curve([[-(ex - r), ey + R * 0.01, glassZ], [-R * 0.05, ey + R * 0.035, bridgeZ], [R * 0.05, ey + R * 0.035, bridgeZ], [ex - r, ey + R * 0.01, glassZ]], 8), () => ({ rx: R * 0.014, rz: R * 0.014, pow: 2 }), PALETTE.trim.frame, { side: [0, 1, 0], segments: 5 });
      break;
    }
    case 3: { // goggles: brass-rimmed lenses and a leather strap round the back of the head
      const r = eye.radius * 1.5;
      for (const sx of [-1, 1]) {
        b.cylinder(r, r, R * 0.14, PALETTE.trim.goggleGlass, [sx * ex, ey, glassZ - 0.004], [Math.PI / 2, 0, 0]);
        b.torus(r, R * 0.035, accent, [sx * ex, ey, glassZ - R * 0.07], [0, 0, 0]);
        strap(LEATHER, 0.6, 3.14, 0.12, 0.12, sx < 0 ? -1 : 1, 0.02, 0.05, [[sx * (ex + r), ey, glassZ]]);
      }
      b.sweep(curve([[-(ex - r), ey, glassZ], [-R * 0.05, ey + R * 0.02, bridgeZ], [R * 0.05, ey + R * 0.02, bridgeZ], [ex - r, ey, glassZ]], 8), () => ({ rx: R * 0.03, rz: R * 0.02, pow: 2 }), LEATHER, { side: [0, 1, 0], segments: 5 });
      break;
    }
    case 4: { // pince-nez: two small rims clipped on the nose bridge
      for (const sx of [-1, 1]) b.torus(R * 0.12, R * 0.015, accent, [sx * R * 0.2, ey - R * 0.03, shape.front(sx * R * 0.2, eye.y - R * 0.03)[2] - R * 0.05], [0, 0, 0]);
      b.sweep(curve([[-R * 0.08, ey - R * 0.02, bridgeZ], [0, ey + R * 0.005, bridgeZ - R * 0.01], [R * 0.08, ey - R * 0.02, bridgeZ]], 6), () => ({ rx: R * 0.012, rz: R * 0.012, pow: 2 }), accent, { side: [0, 1, 0], segments: 5 });
      break;
    }
    default: break;
  }
  if (spec.eyepatch > 0) {
    const sx = spec.eyepatch === 1 ? -1 : 1;
    b.sphere(eye.radius * 1.6, PALETTE.ink, [sx * ex, ey, eye.z - eye.radius * 0.75], [1, 1, 0.35]);
    // The strap climbs from the patch over the ear, round the back of the head and to the other temple.
    strap(PALETTE.ink, 0.6, 2 * Math.PI - 1.25, 0.12, 0.34, sx, 0.016, 0.03, [[sx * ex, ey, eye.z - eye.radius * 0.75]]);
  }

  // scars: thin raised welts swept along the skin
  const scarC = PALETTE.face.scar;
  const welt = (pts: readonly (readonly [number, number])[]): void => {
    b.sweep(
      curve(pts.map(([x, y]) => onSkin(fc, x * R, y * R, R * 0.012)), 6),
      () => ({ rx: R * 0.02, rz: R * 0.014, pow: 2 }),
      scarC,
      { side: [0, 0, 1], segments: 5 },
    );
  };
  const sc = spec.scars;
  if (sc & 1) welt([[0.5, -0.05], [0.58, -0.2], [0.6, -0.36]]);
  if (sc & 2) welt([[-0.4, 0.55], [-0.37, 0.4], [-0.35, 0.22]]);
  if (sc & 4) welt([[-0.2, -0.8], [-0.05, -0.86], [0.12, -0.9]]);
  if (sc & 8) b.sweep(curve([[-R * 0.22, -R * 0.02, -R * 0.4], [0, R * 0.03, -R * 0.43], [R * 0.22, -R * 0.02, -R * 0.4]], 5), () => ({ rx: R * 0.02, rz: R * 0.014 }), scarC, { side: [0, 1, 0], segments: 5 });
  if (sc & 16) welt([[0.05, 0.72], [0.22, 0.7], [0.4, 0.63]]);

  // ---- hats: fitted to the skull. Each hat has a crown half-width at its band; it sits where the head is exactly that wide (plus a
  // margin for hair), so the crown wraps the head instead of floating over it.
  const rb = hatCrown * R;
  const hy = cy + seatY * R;
  const band = (radius: number, y: number, color: number = accent): void => void b.torus(radius, R * 0.04, color, [0, y, 0], [Math.PI / 2, 0, 0]);
  const dome = (r: number, sy: number, y: number, color: number, sx = 1, sz = 1): void => void b.add(new SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, [0, y, 0], [0, 0, 0], [sx, sy, sz]);
  switch (spec.hat) {
    case 1: // top hat: tapered crown, flat brim with a rolled edge, band
      b.cylinder(rb * 0.9, rb * 1.03, R * 1.15, hatC, [0, hy + R * 0.575, 0]);
      b.cylinder(rb * 0.92, rb * 0.92, R * 0.03, hatC, [0, hy + R * 1.15, 0]);
      b.cylinder(rb * 1.5, rb * 1.5, R * 0.05, hatC, [0, hy, 0]);
      b.torus(rb * 1.5, R * 0.03, hatC, [0, hy, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.03, hy + R * 0.16, singe(PALETTE.trim.hatBand, burnt));
      break;
    case 2: // bowler: dome, rolled brim, band
      dome(rb * 1.02, 0.9, hy, hatC);
      b.cylinder(rb * 1.24, rb * 1.22, R * 0.05, hatC, [0, hy, 0]);
      b.torus(rb * 1.23, R * 0.035, hatC, [0, hy, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.02, hy + R * 0.05, singe(PALETTE.trim.hatBand, burnt));
      break;
    case 3: // pith helmet: broad dome, ridged brim all round, band, knob
      dome(rb * 1.1, 0.6, hy, hatC);
      b.cylinder(rb * 1.42, rb * 1.4, R * 0.05, hatC, [0, hy, 0]);
      b.torus(rb * 1.4, R * 0.04, hatC, [0, hy, 0], [Math.PI / 2, 0, 0]);
      band(rb * 1.08, hy + R * 0.06, singe(PALETTE.trim.ivory, burnt));
      b.sphere(R * 0.1, accent, [0, hy + rb * 1.1 * 0.6, 0]);
      break;
    case 4: // shako: tall, flared crown, peak, cord and spike
      b.cylinder(rb * 1.12, rb * 1.0, R * 1.15, hatC, [0, hy + R * 0.575, 0]);
      b.box(rb * 1.2, R * 0.05, R * 0.55, hatC, [0, hy, -rb * 1.05]);
      b.torus(rb * 1.03, R * 0.035, accent, [0, hy + R * 0.2, 0], [Math.PI / 2, 0, 0]);
      b.cone(R * 0.16, R * 0.7, singe(PALETTE.trim.ivory, burnt), [0, hy + R * 1.5, 0]);
      break;
    case 5: // bicorne: wide crescent worn sideways with a cockade
      dome(rb, 0.6, hy, hatC, 2.0, 0.95);
      b.torus(rb, R * 0.05, accent, [0, hy, 0], [Math.PI / 2, 0, 0], [2.0, 0.95, 1]);
      b.sphere(R * 0.14, accent, [rb * 1.9, hy + R * 0.12, 0]);
      break;
    case 6: // slouch hat: soft dome, wide drooping brim, band
      dome(rb * 1.02, 0.62, hy, hatC);
      b.cylinder(rb * 1.75, rb * 1.75, R * 0.04, hatC, [0, hy - R * 0.02, 0], [0.1, 0, 0.05]);
      band(rb * 1.02, hy + R * 0.06, singe(PALETTE.trim.hatBandBrown, burnt));
      break;
    case 7: // peaked cap: low crown, visor, badge
      b.cylinder(rb * 1.0, rb * 1.07, R * 0.4, hatC, [0, hy + R * 0.2, 0]);
      b.cylinder(rb * 0.98, rb * 0.98, R * 0.03, hatC, [0, hy + R * 0.4, 0]);
      b.box(rb * 1.05, R * 0.04, R * 0.5, LEATHER, [0, hy, -rb * 1.02]);
      b.sphere(R * 0.1, accent, [0, hy + R * 0.14, -rb * 1.06]);
      band(rb * 1.05, hy + R * 0.06, singe(PALETTE.trim.hatBand, burnt));
      break;
    case 8: // flat cap: squashed dome with a short peak
      dome(rb * 1.06, 0.42, hy, hatC, 1.05, 1.1);
      b.box(rb * 0.85, R * 0.05, R * 0.4, hatC, [0, hy, -rb * 1.12], [0.15, 0, 0]);
      b.sphere(R * 0.07, accent, [0, hy + rb * 1.06 * 0.42, 0]);
      break;
    case 9: // plumed helmet: polished dome, crest ridge, swept plume
      dome(rb * 1.04, 0.9, hy, accent);
      b.cylinder(rb * 1.1, rb * 1.1, R * 0.05, accent, [0, hy, 0]);
      b.box(R * 0.09, R * 0.14, rb * 1.7, singe(PALETTE.trim.plumeQuill, burnt), [0, hy + rb * 1.04 * 0.9, R * 0.05]);
      for (let i = 0; i < 4; i++) b.cone(R * 0.16, R * 0.75, singe(PALETTE.trim.plume, burnt), [0, hy + rb * 1.04 * 0.9 + R * 0.05 - i * R * 0.05, R * (0.4 + i * 0.32)], [Math.PI / 2 + 0.25 * i, 0, 0]);
      break;
    case 10: // boater: flat-topped straw crown, stiff flat brim, striped band
      b.cylinder(rb * 0.96, rb * 1.0, R * 0.5, singe(PALETTE.trim.straw, burnt), [0, hy + R * 0.25, 0]);
      b.cylinder(rb * 1.5, rb * 1.5, R * 0.04, singe(PALETTE.trim.straw, burnt), [0, hy, 0]);
      b.cylinder(rb * 1.005, rb * 1.005, R * 0.14, singe(PALETTE.cloth[0], burnt), [0, hy + R * 0.12, 0]);
      break;
    default: break;
  }
  return b.build();
}
