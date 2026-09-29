import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, SphereGeometry, type DataTexture, type Material } from "three";
import { PALETTE } from "@cb/shared";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as K from "../catalog.ts";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { eyePlacement, mouthPlacement } from "./head.ts";
import { headShape, skinRamp } from "./headShape.ts";
import { curve, sweepGeometry } from "./sweep.ts";
import { PartBuilder, type V3 } from "./parts.ts";
import { MORPH_NAMES, type MorphName } from "./faceMorph.ts";

/** The animated parts of the face: eyes with upper and lower lids, brows, the lip line, the mouth interior and the head's morph targets. */
export interface FaceParts {
  eyeL: Group;
  eyeR: Group;
  /** The iris (the mesh the animator wanders). */
  pupilL: Mesh;
  pupilR: Mesh;
  /** The dark pupil disc riding on the iris (dilates with fear, shrinks with triumph). */
  coreL: Mesh;
  coreR: Mesh;
  browL: Mesh;
  browR: Mesh;
  mouth: Mesh;
  /** Dark cavity + teeth + tongue, revealed as the mouth opens. */
  mouthInterior: Group;
  /** The cavity mesh (its Y scale is the mouth opening). */
  mouthCavity: Mesh;
  /** Tongue (child of the cavity) and the lower teeth: both ride the jaw, so the animator moves them with `jawPoint`. */
  tongue: Mesh;
  teethLower: Mesh | undefined;
  teethUpper: Mesh | undefined;
  /** Rest position of the mouth on the face surface (head-centre relative). */
  mouthY: number;
  mouthZ: number;
  lidL: Mesh;
  lidR: Mesh;
  /** Lower lids: they rise for a squint, a grin or a wince. */
  lowerLidL: Mesh;
  lowerLidR: Mesh;
  /** Resting geometry constants the animator needs. */
  eyeRadius: number;
  mouthWidth: number;
  /** Resting height of the brows (head-centre relative); the animator raises/lowers from here. */
  browY: number;
  /** Per-character eye set: how far the upper lid rests closed (0 = round-open .. 0.4 = sleepy), the lower lid's rest lift, and the tilt of the eyes (radians, outer corner down positive). */
  lidBias: number;
  lowerLidBase: number;
  eyeTilt: number;
  /** Non-uniform scale of the whole eye (shape variation); the animator multiplies it by its "wide" scale. */
  eyeScale: readonly [number, number];
  /** False when the rig was built as a far-crowd silhouette: the face is a placeholder and the animator skips it. */
  active: boolean;
  /** Sets one of the head skin's morph targets (0..1). A no-op when the head has none (crowd LODs). */
  setMorph(name: MorphName, value: number): void;
}

export interface FaceBuild {
  face: FaceParts;
  root: Group;
  geometries: BufferGeometry[];
  materials: Material[];
}

export interface FaceCtx {
  spec: CharacterSpec;
  P: Proportions;
  skin: number;
  hairC: number;
  accent: number;
  irisC: number;
  ramp: DataTexture;
  toonMaterial: MeshToonMaterial;
  /** Reads the head mesh (with morph targets) once the rig has attached it. */
  headMesh: () => Mesh | undefined;
}

const face = { white: PALETTE.face.white, pupil: PALETTE.face.pupil };

/** Eye shapes: upper-lid bias, lower-lid rest, tilt of the eye line (outer corner down), width/height scale, white tint. Indexed by K.EYE_SHAPES. */
const EYE_SHAPE = [
  { bias: 0, lower: 0, tilt: 0, sx: 1, sy: 1, bag: 0 }, // round
  { bias: 0.2, lower: 0.05, tilt: 0.03, sx: 1.02, sy: 0.96, bag: 0 }, // hooded: the upper lid hangs low
  { bias: 0.34, lower: 0.15, tilt: 0.16, sx: 1, sy: 0.92, bag: 0.4 }, // sleepy: heavy lids, drooping outer corners
  { bias: -0.12, lower: -0.05, tilt: -0.04, sx: 1.08, sy: 1.14, bag: 0 }, // wide-eyed
  { bias: 0.28, lower: 0.2, tilt: -0.1, sx: 1.12, sy: 0.72, bag: 0 }, // narrow: slits tilted up at the outer corner
  { bias: 0.08, lower: 0.1, tilt: 0.06, sx: 1, sy: 1, bag: 1 }, // bagged: dark pouches under the eye
] as const;

export function eyeShape(spec: CharacterSpec) {
  return EYE_SHAPE[spec.eyeShape] ?? EYE_SHAPE[0];
}

/** Iris colour: the spec's choice, or (Auto) a stable pick from hair and skin. */
export function irisColour(spec: CharacterSpec): number {
  const list = K.IRIS_COLORS;
  if (spec.eyeColor > 0) return list[(spec.eyeColor - 1) % list.length]!;
  return list[(spec.hairColor + spec.skin * 3) % list.length]!;
}

/** Colours a (flattened) iris sphere from the pole out: bright pupil ring, base colour, dark limbal rim. */
function shadeIris(geo: SphereGeometry, base: number): void {
  const c = new Color();
  const pos = geo.attributes.position as BufferAttribute;
  const r = geo.parameters.radius;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.acos(Math.max(-1, Math.min(1, -pos.getZ(i) / r))) / (Math.PI / 2); // 0 at the front pole, 1 at the equator
    const k = t < 0.45 ? 1.28 : t < 0.8 ? 1 : 0.58;
    c.setHex(base).multiplyScalar(k);
    col[i * 3] = Math.min(1, c.r);
    col[i * 3 + 1] = Math.min(1, c.g);
    col[i * 3 + 2] = Math.min(1, c.b);
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
}

/** Darkens the last ring of a lid cap toward the lash colour, so the lid's edge is a drawn line instead of a soft skin blend. */
function shadeLid(geo: SphereGeometry, skin: Color, edge: Color, rings: number): void {
  const pos = geo.attributes.position as BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const r = geo.parameters.radius;
  const tl = geo.parameters.thetaLength as number;
  const ts = (geo.parameters.thetaStart as number) ?? 0;
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const theta = Math.acos(Math.max(-1, Math.min(1, pos.getY(i) / r)));
    const t = Math.min(1, Math.abs(theta - ts) / tl); // 0 at the pole, 1 at the rim
    c.copy(skin);
    if (t > 1 - 1.5 / rings) c.lerp(edge, 0.85);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
}

/** A brow: (spine control points in units of R as [x, y, z], half-widths and depths along it), by style. Inner end is at negative x. */
interface BrowStyle {
  pts: readonly V3[];
  rx: (t: number) => number;
  rz: number;
  fluff?: boolean;
  visible?: boolean;
}
const BROWS: readonly BrowStyle[] = [
  { pts: [[-0.2, -0.005, 0], [-0.08, 0.035, 0], [0.06, 0.035, 0], [0.2, -0.01, 0.01]], rx: (t) => 0.04 + 0.03 * Math.sin(Math.PI * Math.min(1, t * 1.1)), rz: 0.05 }, // natural
  { pts: [[-0.22, 0, 0], [-0.08, 0.04, 0], [0.08, 0.045, 0], [0.22, -0.005, 0.01]], rx: (t) => 0.07 + 0.045 * Math.sin(Math.PI * Math.min(1, t * 1.1)), rz: 0.075, fluff: true }, // bushy
  { pts: [[-0.18, -0.01, 0], [-0.06, 0.05, 0], [0.08, 0.055, 0], [0.22, -0.03, 0.01]], rx: (t) => 0.018 + 0.014 * Math.sin(Math.PI * t), rz: 0.028 }, // thin, high arch
  { pts: [[-0.4, 0.005, 0], [-0.18, 0.02, 0], [0.04, 0.045, 0], [0.2, -0.01, 0.01]], rx: (t) => 0.055 + 0.03 * (1 - t), rz: 0.058 }, // unibrow: the inner end runs to the middle of the face
  { pts: [[-0.22, 0.01, 0], [-0.08, 0.012, 0], [0.08, 0.008, 0], [0.24, 0.005, 0.01]], rx: (t) => 0.07 + 0.02 * Math.sin(Math.PI * t), rz: 0.065 }, // heavy and flat
  { pts: [[-0.2, -0.03, 0], [-0.06, 0.0, 0], [0.09, 0.055, 0], [0.22, 0.0, 0.01]], rx: (t) => 0.034 + 0.02 * (1 - t) * (1 - t), rz: 0.04 }, // villain: a sharp peak over the outer eye
  { pts: [[-0.16, 0, 0], [0, 0.01, 0], [0.16, 0, 0.01]], rx: () => 0.014, rz: 0.012, visible: false }, // shaved: only a faint ridge
];

function buildBrowGeometry(style: BrowStyle, R: number, color: number): BufferGeometry {
  const b = new PartBuilder();
  const spine = curve(style.pts.map((p): V3 => [p[0] * R, p[1] * R, p[2] * R]), 9);
  b.sweep(spine, (t) => ({ rx: R * style.rx(t), rz: R * style.rz, pow: 2.2 }), color, { side: [0, 1, 0], segments: 6 });
  if (style.fluff) {
    // a second, shorter tuft on top: the brow looks grown rather than drawn
    const top = curve(style.pts.slice(1, 4).map((p): V3 => [p[0] * R * 0.95, (p[1] + 0.035) * R, p[2] * R - R * 0.005]), 6);
    b.sweep(top, (t) => ({ rx: R * (0.04 + 0.03 * Math.sin(Math.PI * t)), rz: R * 0.05, pow: 2.2 }), color, { side: [0, 1, 0], segments: 5 });
  }
  return b.build() ?? sweepGeometry(spine, () => ({ rx: 0.01, rz: 0.01 }), { color });
}

/**
 * Builds the face's animated parts on `parent` (the head bone): eyes with lids, brows, the lip line and the mouth interior. The head's skin, ears, nose
 * and hair are part of the head bone's merged mesh; these parts are separate so they can move.
 */
export function buildFace(ctx: FaceCtx, parent: Group): FaceBuild {
  const { P, spec, skin, hairC, accent, irisC, ramp } = ctx;
  const R = P.headRadius;
  const shape = headShape(P);
  const shp = eyeShape(spec);
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const mat = <T extends Material>(m: T): T => (materials.push(m), m);
  const geo = <T extends BufferGeometry>(g: T): T => (geometries.push(g), g);

  const root = new Group();
  root.name = "faceRoot";
  root.position.y = R;
  parent.add(root);

  const eye = eyePlacement(P);
  const eyeR = eye.radius;
  const ramps = skinRamp(skin);
  const lidTone = new Color(skin).lerp(ramps.shade, 0.35);
  const bagTone = new Color(skin).lerp(ramps.shade, 0.6);
  const lashC = new Color(PALETTE.face.lash);
  const whiteTint = new Color(face.white).lerp(new Color(PALETTE.trim.blushHot), spec.complexion === 3 ? 0.12 : spec.eyeShape === 5 ? 0.06 : 0);
  const whiteMat = mat(new MeshToonMaterial({ color: whiteTint, gradientMap: ramp }));
  const irisMat = mat(new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
  const pupilMat = mat(new MeshToonMaterial({ color: face.pupil, gradientMap: ramp }));
  const glintMat = mat(new MeshBasicMaterial({ color: 0xffffff }));
  const browMat = mat(new MeshToonMaterial({ color: greyed(hairC, spec), gradientMap: ramp }));
  const lidMat = mat(new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
  const mouthMat = mat(new MeshToonMaterial({ color: PALETTE.face.mouth, gradientMap: ramp }));

  const mkEye = (sx: number): { g: Group; iris: Mesh; core: Mesh; lid: Mesh; lower: Mesh } => {
    const g = new Group();
    g.position.set(sx * eye.x, eye.y, eye.z);
    g.scale.set(shp.sx, shp.sy, 1);
    g.rotation.z = -sx * shp.tilt; // the outer corner drops for sleepy eyes and lifts for narrow ones
    const white = new Mesh(geo(new SphereGeometry(eyeR, 12, 8)), whiteMat);
    const irisGeo = geo(new SphereGeometry(eyeR * 0.56, 10, 6));
    shadeIris(irisGeo, irisC);
    const iris = new Mesh(irisGeo, irisMat);
    iris.scale.set(1, 1, 0.5);
    iris.position.set(0, 0, -eyeR * 0.74);
    const core = new Mesh(geo(new SphereGeometry(eyeR * 0.3, 8, 5)), pupilMat);
    core.position.set(0, 0, -eyeR * 0.3);
    // Two catch-lights, a big one and a small one on the other side, merged into one mesh: what makes an eye look alive.
    const g1 = new SphereGeometry(eyeR * 0.14, 6, 4);
    g1.translate(-eyeR * 0.2 * Math.sign(sx || 1), eyeR * 0.24, -eyeR * 0.5);
    const g2 = new SphereGeometry(eyeR * 0.07, 5, 3);
    g2.translate(eyeR * 0.16 * Math.sign(sx || 1), -eyeR * 0.16, -eyeR * 0.46);
    const glintGeo = geo(mergeGeometries([g1, g2])!);
    g1.dispose();
    g2.dispose();
    const glint = new Mesh(glintGeo, glintMat);
    iris.add(core, glint);
    // Upper lid: a shallow skin cap over the eyeball with a drawn lash line on its edge. Axis +Y at rest; the animator tilts it: 0.5 rad = retracted
    // up-and-back (eye open), -PI/2 = pointing forward over the pupil (eye closed / blink).
    const lidGeo = geo(new SphereGeometry(eyeR * 1.07, 10, 4, 0, Math.PI * 2, 0, 1.15));
    shadeLid(lidGeo, lidTone, lashC, 4);
    const lid = new Mesh(lidGeo, lidMat);
    lid.rotation.x = 0.5;
    // Lower lid: a smaller cap opening downward; it rises for a squint. Pouches darken it.
    const lowGeo = geo(new SphereGeometry(eyeR * 1.06, 10, 3, 0, Math.PI * 2, 0, 0.95));
    shadeLid(lowGeo, shp.bag > 0 ? bagTone : lidTone, shp.bag > 0 ? bagTone : lidTone, 3);
    const lower = new Mesh(lowGeo, lidMat);
    lower.rotation.x = Math.PI - 0.6; // axis -Y, tilted back
    g.add(white, iris, lid, lower);
    root.add(g);
    return { g, iris, core, lid, lower };
  };
  const eL = mkEye(-1);
  const eRr = mkEye(1);

  // ---- brows ----------------------------------------------------------------------------------------------------------------
  const browY = R * 0.37;
  const browZ = shape.front(eye.x, browY)[2] - R * 0.012;
  const style = BROWS[spec.brows] ?? BROWS[0]!;
  const browGeo = geo(buildBrowGeometry(style, R, greyed(hairC, spec)));
  const browL = new Mesh(browGeo, browMat);
  const browR = new Mesh(browGeo, browMat);
  // Inner ends toward the nose: the left brow is mirrored so the thick end is always inner.
  browL.scale.x = -1;
  browL.position.set(-eye.x, browY, browZ);
  browR.position.set(eye.x, browY, browZ);
  browL.visible = browR.visible = style.visible !== false;
  root.add(browL, browR);

  // ---- mouth --------------------------------------------------------------------------------------------------------------------
  const mouthWidth = R * 0.56;
  const mp = mouthPlacement(P);
  const lipSpine = curve([[-mouthWidth / 2, 0, 0], [-mouthWidth / 4, mouthWidth * 0.1, 0], [mouthWidth / 4, mouthWidth * 0.1, 0], [mouthWidth / 2, 0, 0]], 9);
  const mouth = new Mesh(
    geo(sweepGeometry(lipSpine, (t) => ({ rx: R * 0.026 * (0.5 + 0.5 * Math.sin(Math.PI * t)), rz: R * 0.024, pow: 2 }), { color: PALETTE.face.mouth, segments: 5, side: [0, 1, 0] })),
    mouthMat,
  );
  mouth.position.set(0, mp.y, mp.z);
  root.add(mouth);
  // Open mouth: a D-shaped cavity hanging from the upper lip line, upper teeth along its top edge, a tongue and the lower teeth riding the jaw.
  const mouthInterior = new Group();
  mouthInterior.position.set(0, mp.y, mp.z - R * 0.004);
  mouthInterior.visible = false;
  const cavityMat = mat(new MeshToonMaterial({ color: PALETTE.face.cavity, gradientMap: ramp }));
  const cavity = new Mesh(geo(new SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), cavityMat);
  cavity.scale.set(mouthWidth * 0.5, R * 0.01, R * 0.03);
  const tongueMat = mat(new MeshToonMaterial({ color: PALETTE.face.tongue, gradientMap: ramp }));
  const tongue = new Mesh(geo(new SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)), tongueMat);
  tongue.scale.set(0.5, 0.38, 0.9);
  tongue.position.set(0, -0.98, 0.15);
  cavity.add(tongue);
  mouthInterior.add(cavity);
  const upper = buildTeeth(spec, mouthWidth, R, accent, "upper");
  const lower = buildTeeth(spec, mouthWidth, R, accent, "lower");
  let teethUpper: Mesh | undefined;
  let teethLower: Mesh | undefined;
  if (upper) {
    teethUpper = new Mesh(geo(upper), ctx.toonMaterial);
    teethUpper.position.set(0, -R * 0.043, -R * 0.005);
    mouthInterior.add(teethUpper);
  }
  if (lower) {
    teethLower = new Mesh(geo(lower), ctx.toonMaterial);
    teethLower.position.set(0, -R * 0.09, -R * 0.005);
    mouthInterior.add(teethLower);
  }
  root.add(mouthInterior);
  if (spec.teeth & K.TEETH_BITS.BUCK) {
    // Buck teeth: two big incisors that lie over the lower lip whether the mouth is open or shut.
    const b = new PartBuilder();
    const w = mouthWidth * 0.16;
    for (const sx of [-1, 1]) b.box(w, R * 0.13, R * 0.04, PALETTE.trim.teeth, [sx * w * 0.52, 0, 0], [0.12, 0, sx * 0.03]);
    const buck = new Mesh(geo(b.build()!), ctx.toonMaterial);
    buck.position.set(0, mp.y - R * 0.055, mp.z - R * 0.028);
    root.add(buck);
  }
  for (const m of [browL, browR, mouth, eL.iris, eRr.iris, eL.lid, eRr.lid, eL.lower, eRr.lower]) m.castShadow = false;

  const faceParts: FaceParts = {
    eyeL: eL.g,
    eyeR: eRr.g,
    pupilL: eL.iris,
    pupilR: eRr.iris,
    coreL: eL.core,
    coreR: eRr.core,
    browL,
    browR,
    mouth,
    lidL: eL.lid,
    lidR: eRr.lid,
    lowerLidL: eL.lower,
    lowerLidR: eRr.lower,
    eyeRadius: eyeR,
    mouthWidth,
    browY,
    mouthInterior,
    mouthCavity: cavity,
    tongue,
    teethLower,
    teethUpper,
    mouthY: mp.y,
    mouthZ: mp.z,
    lidBias: shp.bias,
    lowerLidBase: shp.lower,
    eyeTilt: shp.tilt,
    eyeScale: [shp.sx, shp.sy],
    active: true,
    setMorph(name, value) {
      const m = ctx.headMesh();
      const inf = m?.morphTargetInfluences;
      if (!inf) return;
      const i = MORPH_NAMES.indexOf(name);
      if (i >= 0 && i < inf.length) inf[i] = value;
    },
  };
  return { face: faceParts, root, geometries, materials };
}

export { greyed } from "./look.ts";
import { greyed } from "./look.ts";

/** A row of six teeth. Bits (TEETH_BITS): 1 missing front, 2 gold front, 4 missing side, 8 gold side, 32 crooked. Returns undefined if none remain. */
function buildTeeth(spec: CharacterSpec, mouthWidth: number, R: number, gold: number, row: "upper" | "lower"): BufferGeometry | undefined {
  const b = new PartBuilder();
  const w = (mouthWidth * 0.86) / 6;
  const ivory: number = PALETTE.trim.teeth;
  for (let i = 0; i < 6; i++) {
    const front = i === 2 || i === 3;
    const side = i === 0 || i === 5;
    const goldSide = i === 1 || i === 4;
    if (row === "upper") {
      if (front && (spec.teeth & 1)) continue; // missing front teeth
      if (side && (spec.teeth & 4)) continue; // missing side teeth
    } else if (row === "lower" && (spec.teeth & 4) && i === 0) continue;
    const isGold = row === "upper" && ((front && (spec.teeth & 2) !== 0) || (goldSide && (spec.teeth & 8) !== 0));
    const h = row === "upper" ? R * 0.065 : R * 0.05;
    const crook = (spec.teeth & 32) !== 0 ? ((i * 7) % 5 - 2) * 0.07 : 0; // crooked: each tooth leans its own way
    b.box(w * 0.92, h, R * 0.03, isGold ? gold : ivory, [(i - 2.5) * w, row === "upper" ? 0 : h * 0.1, crook * R * 0.03], [0, crook * 0.5, crook]);
  }
  return b.build();
}
