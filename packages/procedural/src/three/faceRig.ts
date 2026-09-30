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
  /** Level of detail of the face parts: 0 full (round eyeballs, catch-lights), 1 mid distance (coarser eyes, lids and brows). Cheap: swaps cached geometry. */
  setDetail(level: 0 | 1): void;
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

// ---- shared parts --------------------------------------------------------------------------------------------------------------------------------
// The eyes, lids, brows and mouth of a face are geometry that never changes shape (the animator only moves, turns and scales the MESHES), and materials that
// never change colour: so both are cached across every rig (keyed by exactly what they depend on) and a clone of a look, or a crowd of similar heads, builds
// only the small Mesh/Group objects. Nothing here belongs to a rig, so `dispose()` frees none of it; `clearCharacterCaches()` does.
const sharedGeo = new Map<string, BufferGeometry>();
const sharedMat = new Map<string, Material>();
const MAX_SHARED = 700;

/** Frees the cached face geometry and materials (rigs still showing them re-upload on their next draw). */
export function clearFaceCaches(): void {
  for (const g of sharedGeo.values()) g.dispose();
  for (const m of sharedMat.values()) m.dispose();
  sharedGeo.clear();
  sharedMat.clear();
}
/** How many cached face geometries there are (for tests). */
export const faceCacheSize = (): number => sharedGeo.size;

const cachedGeo = (key: string, make: () => BufferGeometry): BufferGeometry => {
  let g = sharedGeo.get(key);
  if (!g) {
    g = make();
    sharedGeo.set(key, g);
    if (sharedGeo.size > MAX_SHARED) {
      const first = sharedGeo.keys().next().value as string | undefined;
      if (first !== undefined) sharedGeo.delete(first); // (dropped from the table, not disposed: a live rig may still draw it)
    }
  }
  return g;
};
const cachedMat = <T extends Material>(key: string, make: () => T): T => {
  let m = sharedMat.get(key);
  if (!m) {
    m = make();
    sharedMat.set(key, m);
    if (sharedMat.size > MAX_SHARED) {
      const first = sharedMat.keys().next().value as string | undefined;
      if (first !== undefined) sharedMat.delete(first);
    }
  }
  return m as T;
};

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

function buildBrowGeometry(style: BrowStyle, R: number, color: number, detail: 0 | 1 = 0): BufferGeometry {
  const b = new PartBuilder();
  const spine = curve(style.pts.map((p): V3 => [p[0] * R, p[1] * R, p[2] * R]), detail === 0 ? 9 : 5);
  b.sweep(spine, (t) => ({ rx: R * style.rx(t), rz: R * style.rz, pow: 2.2 }), color, { side: [0, 1, 0], segments: detail === 0 ? 6 : 4 });
  if (style.fluff) {
    // a second, shorter tuft on top: the brow looks grown rather than drawn
    const top = curve(style.pts.slice(1, 4).map((p): V3 => [p[0] * R * 0.95, (p[1] + 0.035) * R, p[2] * R - R * 0.005]), detail === 0 ? 6 : 4);
    b.sweep(top, (t) => ({ rx: R * (0.04 + 0.03 * Math.sin(Math.PI * t)), rz: R * 0.05, pow: 2.2 }), color, { side: [0, 1, 0], segments: detail === 0 ? 5 : 4 });
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
  const hex = (c: number | Color): string => (typeof c === "number" ? c : c.getHex()).toString(16);
  /** Geometry swaps for `setDetail`: [mesh, geometry at detail 0, geometry at detail 1]. */
  const swaps: [Mesh, BufferGeometry, BufferGeometry][] = [];
  const both = (m: Mesh, g0: BufferGeometry, g1: BufferGeometry): Mesh => (swaps.push([m, g0, g1]), m);

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
  const toon = (key: string, color: number | Color): MeshToonMaterial => cachedMat(`toon|${key}|${hex(color)}`, () => new MeshToonMaterial({ color, gradientMap: ramp }));
  const vertexToon = (key: string): MeshToonMaterial => cachedMat(`vtoon|${key}`, () => new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
  const whiteMat = toon("white", whiteTint);
  const irisMat = vertexToon("iris");
  const pupilMat = toon("pupil", face.pupil);
  const glintMat = cachedMat("glint", () => new MeshBasicMaterial({ color: 0xffffff }));
  const browMat = toon("brow", greyed(hairC, spec));
  const lidMat = vertexToon("lid");
  const mouthMat = toon("mouth", PALETTE.face.mouth);
  const eK = eyeR.toFixed(5);

  const mkEye = (sx: number): { g: Group; iris: Mesh; core: Mesh; lid: Mesh; lower: Mesh } => {
    const sign = Math.sign(sx || 1);
    const g = new Group();
    g.position.set(sx * eye.x, eye.y, eye.z);
    g.scale.set(shp.sx, shp.sy, 1);
    g.rotation.z = -sx * shp.tilt; // the outer corner drops for sleepy eyes and lifts for narrow ones
    const whiteGeo = (d: 0 | 1): BufferGeometry => cachedGeo(`white|${eK}|${d}`, () => new SphereGeometry(eyeR, d === 0 ? 12 : 8, d === 0 ? 8 : 5));
    const white = both(new Mesh(whiteGeo(0), whiteMat), whiteGeo(0), whiteGeo(1));
    const irisGeo = (d: 0 | 1): BufferGeometry =>
      cachedGeo(`iris|${eK}|${hex(irisC)}|${d}`, () => {
        const gi = new SphereGeometry(eyeR * 0.56, d === 0 ? 10 : 7, d === 0 ? 6 : 4);
        shadeIris(gi, irisC);
        return gi;
      });
    const iris = both(new Mesh(irisGeo(0), irisMat), irisGeo(0), irisGeo(1));
    iris.scale.set(1, 1, 0.5);
    iris.position.set(0, 0, -eyeR * 0.74);
    const core = new Mesh(cachedGeo(`core|${eK}`, () => new SphereGeometry(eyeR * 0.3, 8, 5)), pupilMat);
    core.position.set(0, 0, -eyeR * 0.3);
    // Two catch-lights, a big one and a small one on the other side, merged into one mesh: what makes an eye look alive.
    const glintGeo = cachedGeo(`glint|${eK}|${sign}`, () => {
      const g1 = new SphereGeometry(eyeR * 0.14, 6, 4);
      g1.translate(-eyeR * 0.2 * sign, eyeR * 0.24, -eyeR * 0.5);
      const g2 = new SphereGeometry(eyeR * 0.07, 5, 3);
      g2.translate(eyeR * 0.16 * sign, -eyeR * 0.16, -eyeR * 0.46);
      const m = mergeGeometries([g1, g2])!;
      g1.dispose();
      g2.dispose();
      return m;
    });
    const glint = new Mesh(glintGeo, glintMat);
    iris.add(core, glint);
    // Upper lid: a shallow skin cap over the eyeball with a drawn lash line on its edge. Axis +Y at rest; the animator tilts it: 0.5 rad = retracted
    // up-and-back (eye open), -PI/2 = pointing forward over the pupil (eye closed / blink).
    const lidKey = `${eK}|${hex(lidTone)}|${hex(lashC)}`;
    const lidGeo = (d: 0 | 1): BufferGeometry =>
      cachedGeo(`lid|${lidKey}|${d}`, () => {
        const gl = new SphereGeometry(eyeR * 1.07, d === 0 ? 10 : 8, d === 0 ? 4 : 3, 0, Math.PI * 2, 0, 1.15);
        shadeLid(gl, lidTone, lashC, d === 0 ? 4 : 3);
        return gl;
      });
    const lid = both(new Mesh(lidGeo(0), lidMat), lidGeo(0), lidGeo(1));
    lid.rotation.x = 0.5;
    // Lower lid: a smaller cap opening downward; it rises for a squint. Pouches darken it. (Hidden at the mid level of detail.)
    const lowTone = shp.bag > 0 ? bagTone : lidTone;
    const lower = new Mesh(
      cachedGeo(`low|${eK}|${hex(lowTone)}|${shp.bag > 0 ? 1 : 0}`, () => {
        const gl = new SphereGeometry(eyeR * 1.06, 10, 3, 0, Math.PI * 2, 0, 0.95);
        shadeLid(gl, lowTone, shp.bag > 0 ? bagTone : lidTone, 3);
        return gl;
      }),
      lidMat,
    );
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
  const browColor = greyed(hairC, spec);
  const browGeo = (d: 0 | 1): BufferGeometry => cachedGeo(`brow|${spec.brows}|${R.toFixed(5)}|${hex(browColor)}|${d}`, () => buildBrowGeometry(style, R, browColor, d));
  const browL = both(new Mesh(browGeo(0), browMat), browGeo(0), browGeo(1));
  const browR = both(new Mesh(browGeo(0), browMat), browGeo(0), browGeo(1));
  // Inner ends toward the nose: the left brow is mirrored so the thick end is always inner.
  browL.scale.x = -1;
  browL.position.set(-eye.x, browY, browZ);
  browR.position.set(eye.x, browY, browZ);
  browL.visible = browR.visible = style.visible !== false;
  root.add(browL, browR);

  // ---- mouth --------------------------------------------------------------------------------------------------------------------
  const mouthWidth = R * 0.56;
  const mp = mouthPlacement(P);
  const lipGeo = (d: 0 | 1): BufferGeometry =>
    cachedGeo(`lip|${R.toFixed(5)}|${d}`, () => {
      const lipSpine = curve([[-mouthWidth / 2, 0, 0], [-mouthWidth / 4, mouthWidth * 0.1, 0], [mouthWidth / 4, mouthWidth * 0.1, 0], [mouthWidth / 2, 0, 0]], d === 0 ? 9 : 6);
      return sweepGeometry(lipSpine, (t) => ({ rx: R * 0.026 * (0.5 + 0.5 * Math.sin(Math.PI * t)), rz: R * 0.024, pow: 2 }), { color: PALETTE.face.mouth, segments: d === 0 ? 5 : 4, side: [0, 1, 0] });
    });
  const mouth = both(new Mesh(lipGeo(0), mouthMat), lipGeo(0), lipGeo(1));
  mouth.position.set(0, mp.y, mp.z);
  root.add(mouth);
  // Open mouth: a D-shaped cavity hanging from the upper lip line, upper teeth along its top edge, a tongue and the lower teeth riding the jaw.
  const mouthInterior = new Group();
  mouthInterior.position.set(0, mp.y, mp.z - R * 0.004);
  mouthInterior.visible = false;
  const cavityMat = toon("cavity", PALETTE.face.cavity);
  const cavity = new Mesh(cachedGeo("cavity", () => new SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), cavityMat);
  cavity.scale.set(mouthWidth * 0.5, R * 0.01, R * 0.03);
  const tongueMat = toon("tongue", PALETTE.face.tongue);
  const tongue = new Mesh(cachedGeo("tongue", () => new SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)), tongueMat);
  tongue.scale.set(0.5, 0.38, 0.9);
  tongue.position.set(0, -0.98, 0.15);
  cavity.add(tongue);
  mouthInterior.add(cavity);
  const teethKey = `${spec.teeth}|${mouthWidth.toFixed(5)}|${R.toFixed(5)}|${hex(accent)}`;
  const upper = cachedTeeth(`teeth|up|${teethKey}`, () => buildTeeth(spec, mouthWidth, R, accent, "upper"));
  const lower = cachedTeeth(`teeth|lo|${teethKey}`, () => buildTeeth(spec, mouthWidth, R, accent, "lower"));
  let teethUpper: Mesh | undefined;
  let teethLower: Mesh | undefined;
  if (upper) {
    teethUpper = new Mesh(upper, ctx.toonMaterial);
    teethUpper.position.set(0, -R * 0.043, -R * 0.005);
    mouthInterior.add(teethUpper);
  }
  if (lower) {
    teethLower = new Mesh(lower, ctx.toonMaterial);
    teethLower.position.set(0, -R * 0.09, -R * 0.005);
    mouthInterior.add(teethLower);
  }
  root.add(mouthInterior);
  if (spec.teeth & K.TEETH_BITS.BUCK) {
    // Buck teeth: two big incisors that lie over the lower lip whether the mouth is open or shut.
    const buckGeo = cachedGeo(`buck|${mouthWidth.toFixed(5)}|${R.toFixed(5)}`, () => {
      const b = new PartBuilder();
      const w = mouthWidth * 0.16;
      for (const sx of [-1, 1]) b.box(w, R * 0.13, R * 0.04, PALETTE.trim.teeth, [sx * w * 0.52, 0, 0], [0.12, 0, sx * 0.03]);
      return b.build()!;
    });
    const buck = new Mesh(buckGeo, ctx.toonMaterial);
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
  const setDetail = (level: 0 | 1): void => {
    for (const [m, g0, g1] of swaps) {
      const g = level === 0 ? g0 : g1;
      if (m.geometry !== g) m.geometry = g;
    }
  };
  return { face: faceParts, root, setDetail };
}

/** A cached teeth row (undefined when every tooth is missing). */
function cachedTeeth(key: string, make: () => BufferGeometry | undefined): BufferGeometry | undefined {
  const hit = sharedGeo.get(key);
  if (hit) return hit;
  const g = make();
  if (g) sharedGeo.set(key, g);
  return g;
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


const DUMMY_GROUP = new Group();
const DUMMY_MESH = new Mesh();

/**
 * The face of a far-crowd figure before it ever needed one: the same object shape as a built face, with shared inert placeholders and `active: false`
 * (the animator skips an inactive face). `buildFace` fills the SAME object in when the figure first comes close, so references to `rig.face` stay valid.
 */
export function inertFace(): FaceParts {
  return {
    eyeL: DUMMY_GROUP,
    eyeR: DUMMY_GROUP,
    pupilL: DUMMY_MESH,
    pupilR: DUMMY_MESH,
    coreL: DUMMY_MESH,
    coreR: DUMMY_MESH,
    browL: DUMMY_MESH,
    browR: DUMMY_MESH,
    mouth: DUMMY_MESH,
    mouthInterior: DUMMY_GROUP,
    mouthCavity: DUMMY_MESH,
    tongue: DUMMY_MESH,
    teethLower: undefined,
    teethUpper: undefined,
    mouthY: 0,
    mouthZ: 0,
    lidL: DUMMY_MESH,
    lidR: DUMMY_MESH,
    lowerLidL: DUMMY_MESH,
    lowerLidR: DUMMY_MESH,
    eyeRadius: 0,
    mouthWidth: 0,
    browY: 0,
    lidBias: 0,
    lowerLidBase: 0,
    eyeTilt: 0,
    eyeScale: [1, 1],
    active: false,
    setMorph() {},
  };
}
