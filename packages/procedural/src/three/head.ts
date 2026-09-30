import { Color, SphereGeometry, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { buildBeard, buildEarrings, buildEars, buildMoustache, buildNose, buildSideburns, onSkin, skinDir, type FaceCtx } from "./faceParts.ts";
import type { V3 } from "./parts.ts";
import { curve } from "./sweep.ts";
import { buildHair, hairBandThickness, hairCoversFn, hairLiftFn } from "./hair.ts";
import { headFit, type HeadFit } from "./headFit.ts";
import { buildHairAccessory, scarPaths } from "./headExtras.ts";
import { buildEyewear } from "./eyewear.ts";
import { HAT_SEAT, buildHat } from "./hatsGeo.ts";
import { buildFaceDecor } from "./faceDecor.ts";
import { greyed } from "./look.ts";
import { addFaceMorphs } from "./faceMorph.ts";
import { buildSkull, faceSurfaceZ, gridLevel, headShape, type BrushTag } from "./headShape.ts";
import { LEATHER, PartBuilder, singe } from "./parts.ts";
import { tone } from "./bodyKit.ts";

export { faceSurfaceZ };

/** Above a hat's band by this much (x R, in direction space) the skull is entirely inside the hat's crown: those cells are not drawn (hats.test.ts proves it). */
export const HAT_COVERS_ABOVE = 0.16;

/** Height of a hat's band (x R above the head centre): the hat's own seat, or just above the ears when they are taller than that (a hat rests on top of tall ears, never through them). */
export function hatSeat(fc: FaceCtx, hf: HeadFit): number {
  const base = HAT_SEAT[fc.spec.hat] ?? 0.5;
  if (fc.spec.hat === 0) return 0;
  const ear = hf.ear(1);
  return Math.min(0.82, Math.max(base, (ear.top[1] - fc.cy) / fc.P.headRadius + 0.05));
}

/** The head fit of a spec exactly as buildHead sets it up (hair thickness known), for tests and tools. */
export function headFitFor(spec: CharacterSpec, P: Proportions): { fc: FaceCtx; hf: HeadFit; seatY: number } {
  const R = P.headRadius;
  const fc: FaceCtx = { spec, P, shape: headShape(P), b: new PartBuilder(), cy: R, skin: 0, hairC: 0, facialC: 0, accent: 0 };
  const hf = headFit(fc);
  const seatY = spec.hat !== 0 ? hatSeat(fc, hf) : 0;
  hf.hairLift = hairLiftFn(fc, hf, spec.hat !== 0, seatY);
  return { fc, hf, seatY };
}

/** Test hook: while the primitive audit is on, buildHead notes which feature each primitive belongs to (see headAudit.ts). Never used in the game. */
export const headTrace: { marks: { label: string; index: number }[] } = { marks: [] };
const mark = (label: string): void => {
  if (PartBuilder.audit) headTrace.marks.push({ label, index: PartBuilder.audit.length });
};

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
  if (PartBuilder.audit) headTrace.marks = [];
  const hatOn = spec.hat !== 0;
  const hull = PartBuilder.hullMode;
  const coarse = gridLevel(PartBuilder.lod, hull);
  const lod = PartBuilder.lod;
  const fc: FaceCtx = { spec, P, shape, b, cy, skin, hairC, facialC: greyed(hairC, spec), accent };
  const hf = headFit(fc);
  // Where the hat's band sits on the head (x R above the head centre): its design height, raised over tall ears so they never poke through the crown.
  const seatY = hatOn ? hatSeat(fc, hf) : 0;
  hf.hairLift = hairLiftFn(fc, hf, hatOn, seatY);

  // ---- the head itself: one sculpted skin, a neck, ears and a nose that grows out of it -----------------------------------------
  mark("skull");
  b.morphable = true;
  // (skin the eye can never see is not drawn: under a full-thickness hair shell, and under a hat's crown above its band)
  const underHair = spec.hair !== 0 && !hull ? hairCoversFn(fc, hf, hatOn, seatY) : undefined;
  const underHat = hatOn && !hull ? HAT_COVERS_ABOVE + seatY : undefined;
  const omit = underHair || underHat !== undefined ? (dx: number, dy: number, dz: number): boolean => (underHat !== undefined && dy > underHat) || underHair?.(dx, dy, dz) === true : undefined;
  b.add(buildSkull(shape, { skin, coarse, paint: skinPaint(spec, skin, hairC), omit }), skin, [0, cy, 0]);
  b.morphable = false; // the neck, the ears and the nose stay put when the face moves
  mark("neck");
  b.loft(
    [
      { y: -(P.neck + 0.03), rx: R * 0.46, rz: R * 0.44, color: singe(skin, 1) },
      { y: R * 0.25, rx: R * 0.44, rz: R * 0.42, color: skin },
    ],
    skin,
  );
  mark("ears");
  buildEars(fc);
  mark("nose");
  if (lod < 2) buildNose(fc);
  else b.sphere(R * 0.16, skin, [0, cy - R * 0.05, shape.front(0, -R * 0.1)[2] - R * 0.06]);
  b.morphable = true; // hair, sideburns, beard and moustache ride the skin they grow from
  mark("sideburns");
  if (lod < 2) buildSideburns(fc);
  mark("hair");
  buildHair(fc, hatOn, coarse, seatY, hf);
  mark("hairAcc");
  if (lod < 2) buildHairAccessory(fc, hatOn);
  mark("beard");
  buildBeard(fc);
  mark("moustache");
  if (lod < 2) buildMoustache(fc);
  mark("decor");
  if (!hull && lod === 0) buildFaceDecor(fc);
  b.morphable = false;
  mark("earring");
  if (lod < 2) buildEarrings(fc);

  // ---- eyewear and eyepatch: fitted to the eyes, the real nose, the ears and the hair (eyewear.ts) ------------------------------------------------------
  const eye = eyePlacement(P);
  mark("eyewear");
  buildEyewear(fc, hf, eye, { hatOn, seatY, burnt });

  mark("scars");
  // scars: thin raised welts swept along the skin
  const scarC = PALETTE.face.scar;
  const weltLine = (pts: readonly (readonly [number, number])[]): void => {
    b.sweep(
      curve(pts.map(([x, y]) => onSkin(fc, x * R, y * R, R * 0.012)), Math.max(6, pts.length + 2)),
      () => ({ rx: R * 0.02, rz: R * 0.014, pow: 2 }),
      scarC,
      { side: [0, 0, 1], segments: 5 },
    );
  };
  /** A scar in the spec's style: straight, jagged, stitched across, or forked. */
  const welt = (pts: readonly (readonly [number, number])[]): void => {
    const { welts, stitches } = scarPaths(spec.scarStyle, pts);
    for (const w of welts) weltLine(w);
    for (const s of stitches) b.box(R * 0.075, R * 0.011, R * 0.011, PALETTE.face.lash, onSkin(fc, s.at[0] * R, s.at[1] * R, R * 0.02), [0, 0, s.angle]);
  };
  const sc = spec.scars;
  if (sc & 1) welt([[0.5, -0.05], [0.58, -0.2], [0.6, -0.36]]);
  if (sc & 2) welt([[-0.4, 0.55], [-0.37, 0.4], [-0.35, 0.22]]);
  if (sc & 4) welt([[-0.2, -0.8], [-0.05, -0.86], [0.12, -0.9]]);
  if (sc & 8) b.sweep(curve([[-R * 0.22, -R * 0.02, -R * 0.4], [0, R * 0.03, -R * 0.43], [R * 0.22, -R * 0.02, -R * 0.4]], 5).map((p) => hf.pushOut(p, R * 0.016)), () => ({ rx: R * 0.02, rz: R * 0.014 }), scarC, { side: [0, 1, 0], segments: 5 }); // (a throat scar lies ON the neck, whatever collar or coat rises there)
  if (sc & 16) welt([[0.05, 0.72], [0.22, 0.7], [0.4, 0.63]]);
  if (sc & 32) welt([[0.02, 0.08], [0.06, -0.06], [0.03, -0.2]]); // across the bridge of the nose
  if (sc & 64) for (let k = 0; k < 3; k++) welt([[-0.42 - k * 0.08, 0.05 - k * 0.02], [-0.5 - k * 0.09, -0.12 - k * 0.02], [-0.55 - k * 0.09, -0.32 - k * 0.02]]); // claw marks: three parallel slashes

  // ---- hats: fitted to the skull (see hatsGeo.ts). Each hat has a crown half-width at its band; it sits where the head is exactly that wide (plus a
  // margin for hair), so the crown wraps the head instead of floating over it.
  mark("hat");
  if (hatOn) buildHat({ b, spec, hf, R, cy, hatC, accent, burnt, seatY, hairT: hairBandThickness(fc, hf, seatY) });
  return b.build((geo, mw) => addFaceMorphs(geo, mw, P, cy));
}
