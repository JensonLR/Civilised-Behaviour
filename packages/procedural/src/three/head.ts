import type { BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { buildBeard, buildEars, buildMoustache, buildNose, buildSideburns, onSkin, type FaceCtx } from "./faceParts.ts";
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
  buildHair(fc, hatOn, coarse);
  buildBeard(fc);
  buildMoustache(fc);

  // ---- eyewear, eyepatch and scars: placed from the same eye/skin queries the face was sculpted with ---------------------------------
  const eye = eyePlacement(P);
  const ex = eye.x;
  const ey = cy + eye.y;
  const glassZ = eye.z - eye.radius * 1.12; // just in front of the eyeball
  const sideX = shape.radius(1, 0, 0) * 1.0; // half-width of the head at eye height (for arms and straps)
  switch (spec.eyewear) {
    case 1: b.torus(eye.radius * 1.5, R * 0.02, accent, [ex, ey, glassZ], [0, 0, 0]); b.cylinder(0.004, 0.004, R * 0.95, accent, [ex + eye.radius * 0.9, ey - R * 0.55, glassZ + 0.02], [0, 0, 0.2]); break;
    case 2: for (const sx of [-1, 1]) b.torus(eye.radius * 1.35, R * 0.02, PALETTE.trim.frame, [sx * ex, ey, glassZ]); b.box(ex * 0.5, R * 0.03, R * 0.03, PALETTE.trim.frame, [0, ey + R * 0.02, glassZ]); for (const sx of [-1, 1]) b.box(R * 0.03, R * 0.03, sideX * 0.95, PALETTE.trim.frame, [sx * sideX * 0.99, ey, glassZ + sideX * 0.47]); break;
    case 3: for (const sx of [-1, 1]) b.cylinder(eye.radius * 1.5, eye.radius * 1.5, R * 0.16, PALETTE.trim.goggleGlass, [sx * ex, ey, glassZ - 0.005], [Math.PI / 2, 0, 0]); b.torus(sideX * 1.06, R * 0.05, LEATHER, [0, ey, 0], [Math.PI / 2, 0, 0]); break;
    case 4: for (const sx of [-1, 1]) b.torus(R * 0.125, R * 0.015, accent, [sx * R * 0.27, ey - R * 0.05, glassZ]); b.box(R * 0.18, R * 0.02, R * 0.02, accent, [0, ey - R * 0.02, glassZ]); break;
    default: break;
  }
  if (spec.eyepatch > 0) {
    const sx = spec.eyepatch === 1 ? -1 : 1;
    b.sphere(eye.radius * 1.6, PALETTE.ink, [sx * ex, ey, eye.z - eye.radius * 0.75], [1, 1, 0.35]);
    b.torus(sideX * 1.06, R * 0.025, PALETTE.ink, [0, ey + R * 0.1, 0], [Math.PI / 2 + 0.28 * sx, 0.1 * sx, 0]);
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

  // ---- hats (every hat gets a band or trim so it reads as made, not as a primitive) -----------------------------------------------------
  const hy = cy + R * 0.78;
  const band = (radius: number, y: number, color = accent): void => void b.torus(radius, R * 0.04, color, [0, y, 0], [Math.PI / 2, 0, 0]);
  switch (spec.hat) {
    case 1: // top hat: tapered crown, flat brim with an upturned edge, band
      b.cylinder(R * 0.6, R * 0.68, R * 1.15, hatC, [0, hy + R * 0.52, 0]);
      b.cylinder(R * 0.6, R * 0.6, R * 0.03, hatC, [0, hy + R * 1.1, 0]);
      b.cylinder(R * 1.08, R * 1.05, R * 0.06, hatC, [0, hy - R * 0.02, 0]);
      b.torus(R * 1.07, R * 0.035, hatC, [0, hy + R * 0.01, 0], [Math.PI / 2, 0, 0]);
      band(R * 0.68, hy + R * 0.16, singe(PALETTE.trim.hatBand, burnt));
      break;
    case 2: // bowler: dome, rolled brim, band
      b.sphere(R * 0.8, hatC, [0, hy + R * 0.02, 0], [1, 0.86, 1.02]);
      b.cylinder(R * 1.02, R * 1.0, R * 0.05, hatC, [0, hy - R * 0.08, 0]);
      b.torus(R * 1.0, R * 0.04, hatC, [0, hy - R * 0.06, 0], [Math.PI / 2, 0, 0]);
      band(R * 0.8, hy + R * 0.0, singe(PALETTE.trim.hatBand, burnt));
      break;
    case 3: // pith helmet: broad dome, ridged brim all round, band, knob
      b.sphere(R * 1.12, hatC, [0, hy + R * 0.02, 0], [1, 0.62, 1.05]);
      b.cylinder(R * 1.3, R * 1.28, R * 0.05, hatC, [0, hy - R * 0.14, 0]);
      b.torus(R * 1.28, R * 0.04, hatC, [0, hy - R * 0.13, 0], [Math.PI / 2, 0, 0]);
      band(R * 1.06, hy - R * 0.1, singe(PALETTE.trim.ivory, burnt));
      b.sphere(R * 0.1, accent, [0, hy + R * 0.66, 0]);
      break;
    case 4: // shako: tall, flared crown, peak, cord and spike
      b.cylinder(R * 0.7, R * 0.85, R * 1.15, hatC, [0, hy + R * 0.5, 0]);
      b.box(R * 1.0, R * 0.05, R * 0.6, hatC, [0, hy - R * 0.02, -R * 0.75]);
      b.torus(R * 0.86, R * 0.035, accent, [0, hy + R * 0.16, 0], [Math.PI / 2, 0, 0]);
      b.cone(R * 0.16, R * 0.7, singe(PALETTE.trim.ivory, burnt), [0, hy + R * 1.3, 0]);
      break;
    case 5: // bicorne: wide crescent worn sideways with a cockade
      b.sphere(R * 1.0, hatC, [0, hy + R * 0.2, 0], [1.8, 0.5, 0.8], [0, 0, 0.06]);
      b.torus(R * 0.9, R * 0.05, accent, [0, hy + R * 0.02, 0], [Math.PI / 2, 0, 0], [1.9, 0.8, 1]);
      b.sphere(R * 0.14, accent, [R * 1.2, hy + R * 0.25, 0]);
      break;
    case 6: // slouch hat: soft dome, wide drooping brim, band
      b.sphere(R * 0.88, hatC, [0, hy + R * 0.18, 0], [1, 0.62, 1]);
      b.cylinder(R * 1.55, R * 1.55, R * 0.04, hatC, [0, hy - R * 0.06, 0], [0.12, 0, 0.06]);
      band(R * 0.86, hy + R * 0.06, singe(PALETTE.trim.hatBandBrown, burnt));
      break;
    case 7: // peaked cap: low crown, visor, badge
      b.cylinder(R * 0.95, R * 1.0, R * 0.36, hatC, [0, hy + R * 0.05, 0]);
      b.box(R * 1.0, R * 0.04, R * 0.45, LEATHER, [0, hy - R * 0.1, -R * 0.95]);
      b.sphere(R * 0.1, accent, [0, hy + R * 0.02, -R * 0.98]);
      band(R * 1.0, hy - R * 0.07, singe(PALETTE.trim.hatBand, burnt));
      break;
    case 8: // flat cap: squashed dome with a short peak
      b.sphere(R * 1.06, hatC, [0, hy + R * 0.06, R * 0.04], [1.05, 0.4, 1.1]);
      b.box(R * 0.8, R * 0.05, R * 0.4, hatC, [0, hy - R * 0.02, -R * 1.02], [0.15, 0, 0]);
      b.sphere(R * 0.07, accent, [0, hy + R * 0.2, 0]);
      break;
    case 9: // plumed helmet: polished dome, crest ridge, swept plume
      b.sphere(R * 1.04, accent, [0, hy + R * 0.05, 0], [1, 0.9, 1.04]);
      b.cylinder(R * 1.1, R * 1.1, R * 0.05, accent, [0, hy - R * 0.06, 0]);
      b.box(R * 0.09, R * 0.14, R * 1.5, singe(PALETTE.trim.plumeQuill, burnt), [0, hy + R * 0.9, R * 0.05]);
      for (let i = 0; i < 4; i++) b.cone(R * 0.16, R * 0.75, singe(PALETTE.trim.plume, burnt), [0, hy + R * (0.95 - i * 0.05), R * (0.4 + i * 0.32)], [Math.PI / 2 + 0.25 * i, 0, 0]);
      break;
    case 10: // boater: flat-topped straw crown, stiff flat brim, striped band
      b.cylinder(R * 0.7, R * 0.72, R * 0.5, singe(PALETTE.trim.straw, burnt), [0, hy + R * 0.24, 0]);
      b.cylinder(R * 1.15, R * 1.15, R * 0.04, singe(PALETTE.trim.straw, burnt), [0, hy - R * 0.02, 0]);
      b.cylinder(R * 0.73, R * 0.73, R * 0.14, singe(PALETTE.cloth[0], burnt), [0, hy + R * 0.1, 0]);
      break;
    default: break;
  }
  return b.build();
}
