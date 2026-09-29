import { Color, SphereGeometry, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { buildBeard, buildEarrings, buildEars, buildMoustache, buildNose, buildSideburns, onSkin, skinDir, type FaceCtx } from "./faceParts.ts";
import type { V3 } from "./parts.ts";
import { curve } from "./sweep.ts";
import { buildHair } from "./hair.ts";
import { HAT_SEAT, buildHat } from "./hatsGeo.ts";
import { buildFaceDecor } from "./faceDecor.ts";
import { greyed } from "./look.ts";
import { addFaceMorphs } from "./faceMorph.ts";
import { buildSkull, faceSurfaceZ, gridLevel, headShape, type BrushTag } from "./headShape.ts";
import { LEATHER, PartBuilder, singe } from "./parts.ts";
import { tone } from "./bodyKit.ts";

export { faceSurfaceZ };

export interface HeadColors {
  skin: number;
  hairC: number;
  hatC: number;
  accent: number;
  burnt: number;
  /** Add the face morph targets (jaw, smile, ...) to the geometry: LOD0 only. */
  morph?: boolean;
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

/** Stubble and ruddy cheeks, baked into the skull's vertex colours (stubble is a shadow on the jaw: it needs no geometry). */
function skinPaint(spec: CharacterSpec, skin: number, hairC: number): ((dx: number, dy: number, dz: number, c: Color, w: Record<BrushTag, number>) => void) | undefined {
  const level = [0, 0.24, 0.38, 0.52][spec.stubble] ?? 0;
  const ruddy = spec.complexion === 3;
  if (level === 0 && !ruddy) return undefined;
  const shadow = new Color(skin).lerp(new Color(hairC), 0.62).multiplyScalar(0.8);
  const hot = new Color(PALETTE.trim.blushHot).lerp(new Color(skin), 0.25);
  return (dx, dy, dz, c, w) => {
    if (ruddy) c.lerp(hot, Math.min(1, w.cheek) * 0.5);
    if (level > 0) {
      const az = Math.abs(Math.atan2(dx, -dz));
      // below the cheekbone, in front of the ears, thinning toward the lower lip and along the jaw and under the chin
      const zone = smoothStep(-0.05, -0.4, dy) * (1 - smoothStep(1.35, 1.7, az)) * (1 - Math.min(1, w.lip) * 0.7) * (1 - Math.min(1, w.socket));
      const speck = 0.78 + 0.44 * hashUnit(Math.round(dx * 60) * 977 + Math.round(dy * 60) * 131 + Math.round(dz * 60) * 17);
      c.lerp(shadow, Math.min(1, zone * level * speck));
    }
  };
}
const smoothStep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hashUnit = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

export function buildHead(spec: CharacterSpec, P: Proportions, c: HeadColors): BufferGeometry | undefined {
  const R = P.headRadius;
  const b = new PartBuilder();
  b.trackMorph = c.morph === true;
  const { skin, hairC, hatC, accent, burnt } = c;
  const cy = R; // head centre above the neck joint
  const shape = headShape(P);
  const hatOn = spec.hat !== 0;
  // Where each hat's band sits on the head (x R above the head centre) - forehead height, above the brow ridge. The crown is then exactly as wide
  // as the skull is there plus a margin for hair, so the hat wraps the head instead of hovering over it.
  const seatY = hatOn ? (HAT_SEAT[spec.hat] ?? 0.5) : 0;
  const hatCrown = hatOn ? shape.widthAt(seatY * R) / R + 0.085 : 0;
  const hull = PartBuilder.hullMode;
  const coarse = gridLevel(PartBuilder.lod, hull);
  const lod = PartBuilder.lod;
  const fc: FaceCtx = { spec, P, shape, b, cy, skin, hairC, facialC: greyed(hairC, spec), accent };

  // ---- the head itself: one sculpted skin, a neck, ears and a nose that grows out of it -----------------------------------------
  b.morphable = true;
  b.add(buildSkull(shape, { skin, coarse, paint: skinPaint(spec, skin, hairC) }), skin, [0, cy, 0]);
  b.morphable = false; // the neck, the ears and the nose stay put when the face moves
  b.loft(
    [
      { y: -(P.neck + 0.03), rx: R * 0.46, rz: R * 0.44, color: singe(skin, 1) },
      { y: R * 0.25, rx: R * 0.44, rz: R * 0.42, color: skin },
    ],
    skin,
  );
  if (lod < 2) buildEars(fc);
  if (lod < 2) buildNose(fc);
  else b.sphere(R * 0.16, skin, [0, cy - R * 0.05, shape.front(0, -R * 0.1)[2] - R * 0.06]);
  b.morphable = true; // hair, sideburns, beard and moustache ride the skin they grow from
  if (lod < 2) buildSideburns(fc);
  buildHair(fc, hatOn, coarse, seatY);
  buildBeard(fc);
  if (lod < 2) buildMoustache(fc);
  if (!hull && lod === 0) buildFaceDecor(fc);
  b.morphable = false;
  if (lod < 2) buildEarrings(fc);

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
      // The chain hangs free in front of the cheek and jaw (proud of the skin, so it never lies across the face like a scratch).
      const chain = [ring, onSkin(fc, ex + R * 0.1, -R * 0.3, R * 0.09), onSkin(fc, ex + R * 0.16, -R * 0.75, R * 0.15), onSkin(fc, ex + R * 0.2, -R * 1.05, R * 0.17)];
      b.sweep(curve(chain, 10), () => ({ rx: R * 0.01, rz: R * 0.01, pow: 2 }), accent, { side: [0, 0, 1], segments: 5, round: "end" });
      b.sphere(R * 0.035, accent, chain[3]!);
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
    case 5: { // smoked glasses: round black lenses in heavy rims, arms hugging the temples
      const r = eye.radius * 1.42;
      const dark = PALETTE.material.smoke;
      for (const sx of [-1, 1]) {
        b.cylinder(r, r, R * 0.03, dark, [sx * ex, ey, glassZ - R * 0.01], [Math.PI / 2, 0, 0]);
        lens(sx, r, PALETTE.trim.frame, 0.034);
        strap(PALETTE.trim.frame, 0.62, 1.42, 0.12, 0.12, sx < 0 ? -1 : 1, 0.016, 0.02, [[sx * (ex + r), ey, glassZ]]);
      }
      b.sweep(curve([[-(ex - r), ey + R * 0.01, glassZ], [-R * 0.05, ey + R * 0.035, bridgeZ], [R * 0.05, ey + R * 0.035, bridgeZ], [ex - r, ey + R * 0.01, glassZ]], 8), () => ({ rx: R * 0.02, rz: R * 0.02, pow: 2 }), PALETTE.trim.frame, { side: [0, 1, 0], segments: 5 });
      break;
    }
    case 6: { // snow goggles: a carved wood band across the eyes with two narrow slits and a strap round the head
      const wood = singe(PALETTE.material.wood, burnt);
      const pts: V3[] = [];
      for (let k = 0; k <= 10; k++) {
        const az = -1.05 + (2.1 * k) / 10;
        pts.push(skinDir(fc, Math.sin(az) * 0.95, eye.y / R + 0.02, -Math.cos(az) * 0.95, R * 0.05));
      }
      b.sweep(curve(pts, 14), () => ({ rx: R * 0.15, rz: R * 0.05, pow: 2.6 }), wood, { side: [0, 1, 0], segments: 6, round: "both" });
      for (const sx of [-1, 1]) b.box(eye.radius * 1.7, R * 0.03, R * 0.06, PALETTE.material.soot, [sx * ex, ey, glassZ - R * 0.06]);
      strap(LEATHER, 1.05, 3.14, 0.12, 0.12, 1, 0.02, 0.05);
      strap(LEATHER, 1.05, 3.14, 0.12, 0.12, -1, 0.02, 0.05);
      break;
    }
    case 7: { // jeweller's loupe: a brass tube screwed into the right eye, a strap round the head
      const r = eye.radius * 1.15;
      b.cylinder(r, r * 1.15, R * 0.28, accent, [ex, ey, glassZ - R * 0.12], [Math.PI / 2, 0, 0]);
      b.torus(r * 1.16, R * 0.03, tone(accent, 0.8), [ex, ey, glassZ - R * 0.26], [0, 0, 0]);
      b.cylinder(r * 0.78, r * 0.78, R * 0.02, PALETTE.trim.goggleGlass, [ex, ey, glassZ - R * 0.27], [Math.PI / 2, 0, 0]);
      strap(LEATHER, 0.62, 3.14, 0.12, 0.2, 1, 0.02, 0.04, [[ex + r * 0.4, ey, glassZ - R * 0.02]]);
      break;
    }
    case 8: { // half-moons: small reading glasses low on the nose, only the lower half of each lens ringed
      const r = eye.radius * 1.15;
      for (const sx of [-1, 1]) {
        b.torus(r, R * 0.016, accent, [sx * ex, ey - eye.radius * 0.7, glassZ], [0, 0, 0], [1, 0.8, 1], Math.PI);
        b.box(r * 2, R * 0.016, R * 0.016, accent, [sx * ex, ey - eye.radius * 0.7, glassZ]);
        strap(accent, 0.62, 1.42, 0.06, 0.1, sx < 0 ? -1 : 1, 0.01, 0.012, [[sx * (ex + r), ey - eye.radius * 0.7, glassZ]]);
      }
      b.sweep(curve([[-(ex - r), ey - eye.radius * 0.6, glassZ], [-R * 0.05, ey - eye.radius * 0.5, bridgeZ], [R * 0.05, ey - eye.radius * 0.5, bridgeZ], [ex - r, ey - eye.radius * 0.6, glassZ]], 8), () => ({ rx: R * 0.012, rz: R * 0.012, pow: 2 }), accent, { side: [0, 1, 0], segments: 5 });
      break;
    }
    case 9: { // left monocle: on the other eye, the chain falling on the other side
      lens(-1, eye.radius * 1.5, accent);
      const ring: V3 = [-ex - eye.radius * 0.35, ey - eye.radius * 1.5, glassZ];
      const chain = [ring, onSkin(fc, -ex - R * 0.1, -R * 0.3, R * 0.09), onSkin(fc, -ex - R * 0.16, -R * 0.75, R * 0.15), onSkin(fc, -ex - R * 0.2, -R * 1.05, R * 0.17)];
      b.sweep(curve(chain, 10), () => ({ rx: R * 0.01, rz: R * 0.01, pow: 2 }), accent, { side: [0, 0, 1], segments: 5, round: "end" });
      b.sphere(R * 0.035, accent, chain[3]!);
      break;
    }
    case 10: { // pushed-up goggles: aviator goggles resting on the forehead, brass rims, glass, a strap round the head at the hairline
      const r = eye.radius * 1.5;
      const gy = ey + R * 0.62;
      for (const sx of [-1, 1]) {
        const p = onSkin(fc, sx * ex * 0.85, gy - cy, R * 0.09);
        b.cylinder(r, r, R * 0.12, PALETTE.trim.goggleGlass, [p[0], p[1], p[2]], [Math.PI / 2 - 0.35, 0, 0]);
        b.torus(r, R * 0.035, accent, [p[0], p[1], p[2] - R * 0.05], [-0.35, 0, 0]);
      }
      const mid = onSkin(fc, 0, gy - cy, R * 0.1);
      b.box(R * 0.14, R * 0.04, R * 0.05, LEATHER, [mid[0], mid[1], mid[2] - R * 0.02]);
      strap(LEATHER, 0.8, 3.14, 0.6, 0.6, 1, 0.02, 0.05, [[ex * 0.85 + r, gy, mid[2] + R * 0.02]]);
      strap(LEATHER, 0.8, 3.14, 0.6, 0.6, -1, 0.02, 0.05, [[-ex * 0.85 - r, gy, mid[2] + R * 0.02]]);
      break;
    }
    default: break;
  }
  if (spec.eyepatch > 0) {
    const sx = spec.eyepatch === 1 ? -1 : 1;
    b.sphere(eye.radius * 1.4, PALETTE.ink, [sx * ex, ey, eye.z - eye.radius * 0.7], [1, 1, 0.3]);
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
  if (sc & 32) welt([[0.02, 0.08], [0.06, -0.06], [0.03, -0.2]]); // across the bridge of the nose
  if (sc & 64) for (let k = 0; k < 3; k++) welt([[-0.42 - k * 0.08, 0.05 - k * 0.02], [-0.5 - k * 0.09, -0.12 - k * 0.02], [-0.55 - k * 0.09, -0.32 - k * 0.02]]); // claw marks: three parallel slashes

  // ---- hats: fitted to the skull (see hatsGeo.ts). Each hat has a crown half-width at its band; it sits where the head is exactly that wide (plus a
  // margin for hair), so the crown wraps the head instead of floating over it.
  if (hatOn) {
    const rb = hatCrown * R;
    const hy = cy + seatY * R;
    // Every crown must clear the top of the sculpted skull with a margin, whatever height the hat's own design says.
    const topH = Math.max(R * 0.3, shape.radius(0, 1, 0) + R * 0.1 - seatY * R);
    buildHat({ b, spec, shape, R, cy, hatC, accent, burnt, seatY, rb, hy, topH });
  }
  return b.build((geo, mw) => addFaceMorphs(geo, mw, P, cy));
}
