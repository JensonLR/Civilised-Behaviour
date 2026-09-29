import {
  BufferGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  MeshBasicMaterial,
  Color,
  DataTexture,
  NearestFilter,
  RedFormat,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  Matrix4,
} from "three";
import { LIMB, PALETTE, ZONE, ZONE_COUNT, woundLevel, zoneLimb, type LimbId, type ZoneId } from "@cb/shared";
import * as K from "../catalog.ts";
import { computeProportions, type Proportions } from "../proportions.ts";
import { encodeSpec, type CharacterSpec } from "../spec.ts";
import { buildHead, eyePlacement, mouthPlacement } from "./head.ts";
import { headShape, skinRamp } from "./headShape.ts";
import { sweepGeometry, curve } from "./sweep.ts";
import { outlineMaterial } from "./outline.ts";
import { CREAM, PartBuilder, singe } from "./parts.ts";
import { buildStump, buildForeArm, buildLowerLeg, buildPelvis, buildTorso, buildUpperArm, buildUpperLeg, type BodyCtx } from "./body.ts";
import { buildWoundGeometry, type GoreLevel } from "./wounds.ts";

/** Named bones of the rigid articulated hierarchy. Every visual part hangs off exactly one of these. */
export interface Joints {
  root: Group;
  pelvis: Group;
  torso: Group;
  head: Group;
  shoulderL: Group;
  shoulderR: Group;
  elbowL: Group;
  elbowR: Group;
  hipL: Group;
  hipR: Group;
  kneeL: Group;
  kneeR: Group;
}

export interface FaceParts {
  eyeL: Group;
  eyeR: Group;
  pupilL: Mesh;
  pupilR: Mesh;
  browL: Mesh;
  browR: Mesh;
  mouth: Mesh;
  /** Dark cavity + teeth + tongue, revealed as the mouth opens. */
  mouthInterior: Group;
  /** The cavity mesh (its Y scale is the mouth opening). */
  mouthCavity: Mesh;
  /** Rest position of the mouth on the face surface (head-centre relative). */
  mouthY: number;
  mouthZ: number;
  lidL: Mesh;
  lidR: Mesh;
  /** Resting geometry constants the animator needs. */
  eyeRadius: number;
  mouthWidth: number;
  /** Resting height of the brows (head-centre relative); the animator raises/lowers from here. */
  browY: number;
}

export interface CharacterRig {
  root: Group;
  joints: Joints;
  face: FaceParts;
  proportions: Proportions;
  spec: CharacterSpec;
  /** Number of draw-call-producing meshes right now (excludes shadow-pass doubling; includes visible outlines). */
  readonly meshCount: number;
  /** Silhouette outline on/off (extra draw per bone). Cheap to toggle. */
  setOutline(on: boolean): void;
  /**
   * Shows the wounds in a packed mask (see @cb/shared wounds.ts): plasters, dressings and stains on the bone each zone
   * belongs to. Cheap to call every frame with an unchanged mask. `gore` recolours stains (never removes the dressings).
   */
  setWounds(mask: number, gore?: GoreLevel): void;
  /**
   * Removes lost limbs (LIMB bit mask from @cb/shared): the limb's meshes (and outlines) are hidden and a capped stump appears at the
   * joint. Cheap to call every frame with an unchanged mask. `gore` recolours the wound cap.
   */
  setMissing(mask: number, gore?: GoreLevel): void;
  /**
   * A free-standing copy of a limb, frozen in its current pose, for flying off as debris: a Group whose origin is the joint (the cut end)
   * with the limb hanging down its -Y. Geometry and materials are shared with the rig (dispose nothing but the group's own children);
   * add it to the scene yourself. Works whether or not the limb is currently hidden.
   */
  detachLimb(limb: LimbId): Group | undefined;
  dispose(): void;
}

// Bone geometry is cached by (bone, canonical spec) so identical characters (crowds, clones) share GPU memory.
const geometryCache = new Map<string, BufferGeometry | null>();
const MAX_CACHE = 256; // 2 entries per bone (main + outline hull) x ~12 bones x a handful of live specs
let sharedMaterial: MeshToonMaterial | undefined;

/** A 4-step lighting ramp: banded light and shadow give forms a graphic, illustrated read that flat PBR shading smears out. */
let ramp: DataTexture | undefined;
function toonRamp(): DataTexture {
  if (ramp) return ramp;
  const tex = new DataTexture(new Uint8Array([120, 175, 225, 255]), 4, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return (ramp = tex);
}

const clothMaterial = (): MeshToonMaterial => (sharedMaterial ??= new MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() }));

function cached(key: string, make: () => BufferGeometry | undefined): BufferGeometry | undefined {
  const hit = geometryCache.get(key);
  if (hit !== undefined) return hit ?? undefined;
  const g = make() ?? null;
  geometryCache.set(key, g);
  if (geometryCache.size > MAX_CACHE) {
    // Evict oldest entries; geometries still referenced by live rigs are re-created on demand, never freed under them.
    const first = geometryCache.keys().next().value as string | undefined;
    if (first !== undefined) geometryCache.delete(first);
  }
  return g ?? undefined;
}

export function clearCharacterCaches(): void {
  for (const g of geometryCache.values()) g?.dispose();
  geometryCache.clear();
}

const face = { white: PALETTE.face.white, pupil: PALETTE.face.pupil };
/** Iris colours (chosen per character from the spec so it stays stable). */
const IRIS_COLORS = PALETTE.iris;

/**
 * Builds the full articulated caricature for a spec. The hierarchy is rigid (no skinning) so limbs can
 * detach cleanly for dismemberment and pose replication stays cheap. Rest pose: standing, facing -Z.
 */
export interface BuildOptions {
  /** Draw a silhouette outline (default true). Crowds should pass false. */
  outline?: boolean;
}

export function buildCharacter(spec: CharacterSpec, options: BuildOptions = {}): CharacterRig {
  const P = computeProportions(spec);
  const key = encodeSpec(spec);
  const skin = K.SKIN_TONES[spec.skin] ?? K.SKIN_TONES[0];
  const burnt = spec.burnt;
  const jacketC = singe(K.CLOTH_COLORS[spec.jacketColor] ?? PALETTE.cloth[6], burnt);
  const trouserC = singe(K.CLOTH_COLORS[spec.trousersColor] ?? PALETTE.cloth[5], burnt);
  const hatC = singe(K.CLOTH_COLORS[spec.hatColor] ?? PALETTE.cloth[5], burnt);
  const accent = K.ACCENT_COLORS[spec.accentColor] ?? K.ACCENT_COLORS[0];
  const hairC = K.HAIR_COLORS[spec.hairColor] ?? K.HAIR_COLORS[0];
  const shirtC = singe(CREAM, burnt);
  const sleeved = spec.jacket !== 0; // 0 = shirt sleeves
  const armC = sleeved ? jacketC : shirtC;

  const footH = 0.05 * P.scale;
  const hipY = footH + P.legLower + P.legUpper;
  const material = clothMaterial();

  const root = new Group();
  root.name = "root";
  root.rotation.order = "YXZ"; // yaw first (outermost), then tilt, so "downed" falls backward relative to facing
  const mk = (name: string, parent: Group, x = 0, y = 0, z = 0): Group => {
    const g = new Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const pelvis = mk("pelvis", root, 0, hipY, 0);
  const torso = mk("torso", pelvis, 0, 0.04 * P.scale, 0);
  const head = mk("head", torso, 0, P.torsoHeight + P.neck, 0);
  const shoulderY = P.torsoHeight * 0.88;
  const shoulderL = mk("shoulderL", torso, -P.shoulderHalfWidth, shoulderY, 0);
  const shoulderR = mk("shoulderR", torso, P.shoulderHalfWidth, shoulderY, 0);
  const elbowL = mk("elbowL", shoulderL, 0, -P.armUpper, 0);
  const elbowR = mk("elbowR", shoulderR, 0, -P.armUpper, 0);
  const hipL = mk("hipL", pelvis, -P.hipWidth, 0, 0);
  const hipR = mk("hipR", pelvis, P.hipWidth, 0, 0);
  const kneeL = mk("kneeL", hipL, 0, -P.legUpper, 0);
  const kneeR = mk("kneeR", hipR, 0, -P.legUpper, 0);
  torso.rotation.x = -P.lean;

  const meshes: Mesh[] = [];
  const outlines: Mesh[] = [];
  let outlineOn = options.outline ?? true;
  const hiddenBones = new Set<string>();
  const attach = (bone: string, parent: Group, make: () => BufferGeometry | undefined): void => {
    const geo = cached(`${bone}|${key}`, make);
    if (!geo) return;
    const m = new Mesh(geo, material);
    m.name = `mesh_${bone}`;
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    meshes.push(m);
    // Outline hull: the same bone rebuilt coarsely, without tiny details (cached separately, shared like the main geometry).
    const hull = cached(`${bone}|${key}|hull`, () => {
      PartBuilder.hullMode = true;
      try {
        return make();
      } finally {
        PartBuilder.hullMode = false;
      }
    });
    if (hull) {
      const o = new Mesh(hull, outlineMaterial());
      o.name = `outline_${bone}`;
      o.visible = outlineOn;
      o.castShadow = false;
      parent.add(o);
      outlines.push(o);
    }
  };

  const body: BodyCtx = { spec, P, skin, jacketC, trouserC, shirtC, armC, accent, burnt, footH };
  // ---- pelvis, torso ---------------------------------------------------------------------------------------------
  attach("pelvis", pelvis, () => buildPelvis(body));
  attach("torso", torso, () => buildTorso(body));

  // ---- head ------------------------------------------------------------------------------------------------
  const R = P.headRadius;
  attach("head", head, () => buildHead(spec, P, { skin, hairC, hatC, accent, burnt }));

  // ---- arms ------------------------------------------------------------------------------------------------------
  for (const [side, shoulder, elbow] of [["L", shoulderL, elbowL], ["R", shoulderR, elbowR]] as const) {
    attach(`upperArm${side}`, shoulder, () => buildUpperArm(body));
    attach(`foreArm${side}`, elbow, () => buildForeArm(body));
  }

  // ---- legs ---------------------------------------------------------------------------------------------------------
  for (const [side, hip, knee, woodId] of [["L", hipL, kneeL, 1], ["R", hipR, kneeR, 2]] as const) {
    attach(`upperLeg${side}`, hip, () => buildUpperLeg(body));
    attach(`lowerLeg${side}`, knee, () => buildLowerLeg(body, spec.woodenLeg === woodId));
  }

  // ---- face (animated parts, separate small meshes) ---------------------------------------------------------------------
  // The merged head geometry is built around the skull centre, R above the neck joint: face parts share that origin.
  const faceRoot = new Group();
  faceRoot.name = "faceRoot";
  faceRoot.position.y = R;
  head.add(faceRoot);
  const ownedGeosLate: BufferGeometry[] = [];
  const eye = eyePlacement(P);
  const eyeR = eye.radius;
  const eyeX = eye.x;
  const eyeY = eye.y;
  const eyeZ = eye.z;
  const shape = headShape(P);
  const irisC = IRIS_COLORS[(spec.hairColor + spec.skin * 3) % IRIS_COLORS.length]!;
  const whiteMat = new MeshToonMaterial({ color: face.white, gradientMap: toonRamp() });
  const irisMat = new MeshToonMaterial({ color: irisC, gradientMap: toonRamp() });
  const pupilMat = new MeshToonMaterial({ color: face.pupil, gradientMap: toonRamp() });
  const glintMat = new MeshBasicMaterial({ color: 0xffffff });
  const browMat = new MeshToonMaterial({ color: hairC, gradientMap: toonRamp() });
  // The lid is a cap of the same skin tone the socket is baked with, so a blink closes into the face instead of onto it.
  const skinMat = new MeshToonMaterial({ color: new Color(skin).lerp(skinRamp(skin).shade, 0.35), gradientMap: toonRamp() });
  const mouthMat = new MeshToonMaterial({ color: PALETTE.face.mouth, gradientMap: toonRamp() });
  const mkEye = (x: number): { g: Group; pupil: Mesh; lid: Mesh } => {
    const g = new Group();
    g.position.set(x, eyeY, eyeZ);
    const white = new Mesh(new SphereGeometry(eyeR, 12, 8), whiteMat);
    // Iris (the mesh the animator wanders), with the pupil and a catch-light riding on it: the catch-light is what makes an eye look alive.
    const pupil = new Mesh(new SphereGeometry(eyeR * 0.54, 10, 6), irisMat);
    pupil.scale.set(1, 1, 0.5);
    pupil.position.set(0, 0, -eyeR * 0.74);
    const dark = new Mesh(new SphereGeometry(eyeR * 0.3, 8, 5), pupilMat);
    dark.position.set(0, 0, -eyeR * 0.3);
    const glint = new Mesh(new SphereGeometry(eyeR * 0.13, 6, 4), glintMat);
    glint.position.set(-eyeR * 0.2 * Math.sign(x || 1), eyeR * 0.22, -eyeR * 0.5);
    pupil.add(dark, glint);
    // A shallow skin-coloured cap over the eyeball. Axis +Y at rest; the animator tilts it: 0.5 rad = retracted
    // up-and-back (eye open), -PI/2 = axis pointing forward over the pupil (eye closed / blink).
    const lid = new Mesh(new SphereGeometry(eyeR * 1.07, 10, 4, 0, Math.PI * 2, 0, 1.15), skinMat);
    lid.rotation.x = 0.5;
    g.add(white, pupil, lid);
    faceRoot.add(g);
    return { g, pupil, lid };
  };
  const eL = mkEye(-eyeX);
  const eRr = mkEye(eyeX);
  // Brows: a tapered, arched tube (thick at the inner end) sitting on the brow ridge. Its origin is its centre so the animator can tilt it.
  const browY = R * 0.37;
  const browZ = shape.front(eyeX, browY)[2] - R * 0.012;
  const browSpine = curve([[-R * 0.2, -R * 0.005, 0], [-R * 0.08, R * 0.035, 0], [R * 0.06, R * 0.035, 0], [R * 0.2, -R * 0.01, R * 0.01]], 9);
  const browGeo = sweepGeometry(browSpine, (t) => ({ rx: R * (0.04 + 0.03 * Math.sin(Math.PI * Math.min(1, t * 1.1)) ), rz: R * 0.05, pow: 2.2 }), { color: hairC, segments: 6, side: [0, 1, 0] });
  const browL = new Mesh(browGeo, browMat);
  const browR = new Mesh(browGeo, browMat);
  // Inner ends toward the nose: the left brow is mirrored so the thick end is always inner.
  browL.scale.x = -1;
  browL.position.set(-eyeX, browY, browZ);
  browR.position.set(eyeX, browY, browZ);
  faceRoot.add(browL, browR);
  const mouthWidth = R * 0.56;
  const mp = mouthPlacement(P);
  // Lip line: a shallow, tapered arc swept along the sculpted groove. Built as a frown (arch); the animator flips it for a smile.
  const lipSpine = curve([[-mouthWidth / 2, 0, 0], [-mouthWidth / 4, mouthWidth * 0.1, 0], [mouthWidth / 4, mouthWidth * 0.1, 0], [mouthWidth / 2, 0, 0]], 9);
  const mouth = new Mesh(
    sweepGeometry(lipSpine, (t) => ({ rx: R * 0.026 * (0.5 + 0.5 * Math.sin(Math.PI * t)), rz: R * 0.024, pow: 2 }), { color: PALETTE.face.mouth, segments: 5, side: [0, 1, 0] }),
    mouthMat,
  );
  mouth.position.set(0, mp.y, mp.z);
  faceRoot.add(mouth);
  // Open mouth: a D-shaped cavity hanging from the upper lip line, upper teeth along its top edge and a tongue at the bottom.
  const mouthInterior = new Group();
  mouthInterior.position.set(0, mp.y, mp.z - R * 0.004);
  mouthInterior.visible = false;
  const cavityMat = new MeshToonMaterial({ color: PALETTE.face.cavity, gradientMap: toonRamp() });
  const cavity = new Mesh(new SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), cavityMat);
  cavity.scale.set(mouthWidth * 0.5, R * 0.01, R * 0.03);
  const tongueMat = new MeshToonMaterial({ color: PALETTE.face.tongue, gradientMap: toonRamp() });
  const tongue = new Mesh(new SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), tongueMat);
  tongue.scale.set(0.5, 0.38, 0.9);
  tongue.position.set(0, -0.98, 0.15);
  cavity.add(tongue);
  mouthInterior.add(cavity);
  const teethGeo = buildTeeth(spec, mouthWidth, R, accent);
  if (teethGeo) {
    const teeth = new Mesh(teethGeo, material);
    teeth.position.set(0, -R * 0.043, -R * 0.005);
    mouthInterior.add(teeth);
    ownedGeosLate.push(teethGeo);
  }
  ownedGeosLate.push(cavity.geometry, tongue.geometry);
  faceRoot.add(mouthInterior);
  for (const m of [browL, browR, mouth, eL.pupil, eRr.pupil, eL.lid, eRr.lid]) m.castShadow = false;

  const faceParts: FaceParts = {
    eyeL: eL.g, eyeR: eRr.g, pupilL: eL.pupil, pupilR: eRr.pupil, browL, browR, mouth, lidL: eL.lid, lidR: eRr.lid,
    eyeRadius: eyeR, mouthWidth, browY, mouthInterior, mouthCavity: cavity, mouthY: mp.y, mouthZ: mp.z,
  };
  const ownedGeos: BufferGeometry[] = [browGeo, mouth.geometry, eL.lid.geometry, eRr.lid.geometry, ...ownedGeosLate];
  const ownedMats = [whiteMat, irisMat, pupilMat, glintMat, browMat, skinMat, mouthMat, cavityMat, tongueMat];
  eL.g.children.forEach((c) => c instanceof Mesh && ownedGeos.push(c.geometry));
  eRr.g.children.forEach((c) => c instanceof Mesh && ownedGeos.push(c.geometry));

  // ---- wounds: one lazily created mesh per zone on its bone, geometry swapped by (severity, gore) ------------------------
  const zoneBones: Record<number, Group> = {
    [ZONE.HEAD]: head,
    [ZONE.TORSO]: torso,
    [ZONE.ARM_L]: shoulderL,
    [ZONE.ARM_R]: shoulderR,
    [ZONE.LEG_L]: hipL,
    [ZONE.LEG_R]: hipR,
  };
  const woundMeshes: (Mesh | undefined)[] = new Array(ZONE_COUNT).fill(undefined);
  let shownMask = 0;
  let shownGore: GoreLevel = "full";
  const setWounds = (mask: number, gore: GoreLevel = "full"): void => {
    if (mask === shownMask && gore === shownGore) return;
    shownMask = mask;
    shownGore = gore;
    applyWounds();
  };
  /** (Re)builds the dressings from the current mask; a zone whose limb is gone shows nothing (the stump carries the wound). */
  function applyWounds(): void {
    const mask = shownMask;
    const gore = shownGore;
    for (let z = 0; z < ZONE_COUNT; z++) {
      const lost = zoneLimb(z);
      const sev = lost !== undefined && (shownMissing & lost) !== 0 ? 0 : woundLevel(mask, z);
      let m = woundMeshes[z];
      if (sev === 0) {
        if (m) m.visible = false;
        continue;
      }
      const geo = cached(`wound|${z}|${sev}|${gore}|${key}`, () => buildWoundGeometry(z as ZoneId, sev, gore, P, spec));
      if (!geo) continue;
      if (!m) {
        m = new Mesh(geo, material);
        m.name = `wound_${z}`;
        m.castShadow = false;
        zoneBones[z]!.add(m);
        woundMeshes[z] = m;
      }
      m.geometry = geo;
      m.visible = true;
    }
  }

  // ---- lost limbs: hide the limb's bone meshes, show a stump at the joint ---------------------------------------------------------------
  const LIMB_BONES: Record<number, { bones: string[]; joint: Group; kind: "arm" | "leg" }> = {
    [LIMB.ARM_L]: { bones: ["upperArmL", "foreArmL"], joint: shoulderL, kind: "arm" },
    [LIMB.ARM_R]: { bones: ["upperArmR", "foreArmR"], joint: shoulderR, kind: "arm" },
    [LIMB.LEG_L]: { bones: ["upperLegL", "lowerLegL"], joint: hipL, kind: "leg" },
    [LIMB.LEG_R]: { bones: ["upperLegR", "lowerLegR"], joint: hipR, kind: "leg" },
  };
  const stumpMeshes = new Map<number, Mesh>();
  let shownMissing = 0;
  let shownMissingGore: GoreLevel = "full";
  const setMissing = (mask: number, gore: GoreLevel = "full"): void => {
    if (mask === shownMissing && gore === shownMissingGore) return;
    shownMissing = mask;
    shownMissingGore = gore;
    for (const limb of [LIMB.ARM_L, LIMB.ARM_R, LIMB.LEG_L, LIMB.LEG_R] as LimbId[]) {
      const info = LIMB_BONES[limb]!;
      const gone = (mask & limb) !== 0;
      for (const bone of info.bones) {
        if (gone) hiddenBones.add(bone);
        else hiddenBones.delete(bone);
      }
      for (const m of meshes) if (info.bones.includes(m.name.slice(5))) m.visible = !gone;
      for (const o of outlines) if (info.bones.includes(o.name.slice(8))) o.visible = outlineOn && !gone;
      let stump = stumpMeshes.get(limb);
      if (!gone) {
        if (stump) stump.visible = false;
        continue;
      }
      const geo = cached(`stump|${info.kind}|${gore}|${key}`, () => buildStump(body, info.kind, gore));
      if (!geo) continue;
      if (!stump) {
        stump = new Mesh(geo, material);
        stump.name = `stump_${limb}`;
        stump.castShadow = true;
        info.joint.add(stump);
        stumpMeshes.set(limb, stump);
      }
      stump.geometry = geo;
      stump.visible = true;
    }
    applyWounds();
  };

  const inv = new Matrix4();
  const detachLimb = (limb: LimbId): Group | undefined => {
    const info = LIMB_BONES[limb];
    if (!info) return undefined;
    root.updateWorldMatrix(true, true);
    const pivot = new Group();
    info.joint.matrixWorld.decompose(pivot.position, pivot.quaternion, pivot.scale);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrix();
    inv.copy(pivot.matrix).invert();
    const copy = (m: Mesh): void => {
      const c = new Mesh(m.geometry, m.material);
      c.matrixAutoUpdate = false;
      c.matrix.multiplyMatrices(inv, m.matrixWorld);
      c.castShadow = m.castShadow;
      pivot.add(c);
    };
    for (const m of meshes) if (info.bones.includes(m.name.slice(5))) copy(m);
    if (outlineOn) for (const o of outlines) if (info.bones.includes(o.name.slice(8))) copy(o);
    return pivot;
  };

  return {
    root,
    joints: { root, pelvis, torso, head, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR },
    face: faceParts,
    proportions: P,
    spec,
    get meshCount() {
      return meshes.filter((m) => m.visible).length + 7 + (outlineOn ? outlines.filter((o) => o.visible).length : 0) + woundMeshes.filter((m) => m?.visible).length + [...stumpMeshes.values()].filter((m) => m.visible).length;
    },
    setWounds,
    setOutline(on: boolean) {
      outlineOn = on;
      for (const o of outlines) o.visible = on && !hiddenBones.has(o.name.slice(8));
    },
    setMissing,
    detachLimb,
    dispose() {
      // Bone geometry belongs to the shared cache; only per-instance face parts are freed here.
      for (const g of new Set(ownedGeos)) g.dispose();
      for (const m of ownedMats) m.dispose();
      root.removeFromParent();
    },
  };
}

/** A row of six teeth. Bits (TEETH_BITS): 1 missing front, 2 gold front, 4 missing side, 8 gold side. Returns undefined if none remain. */
function buildTeeth(spec: CharacterSpec, mouthWidth: number, R: number, gold: number): BufferGeometry | undefined {
  const b = new PartBuilder();
  const w = (mouthWidth * 0.86) / 6;
  const ivory: number = PALETTE.trim.teeth;
  for (let i = 0; i < 6; i++) {
    const front = i === 2 || i === 3;
    const side = i === 0 || i === 5;
    const goldSide = i === 1 || i === 4;
    if (front && (spec.teeth & 1)) continue; // missing front teeth
    if (side && (spec.teeth & 4)) continue; // missing side teeth
    const isGold = (front && (spec.teeth & 2) !== 0) || (goldSide && (spec.teeth & 8) !== 0);
    b.box(w * 0.92, R * 0.065, R * 0.03, isGold ? gold : ivory, [(i - 2.5) * w, 0, 0]);
  }
  return b.build();
}
