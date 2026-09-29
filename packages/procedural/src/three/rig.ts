import {
  BufferGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  DataTexture,
  NearestFilter,
  RedFormat,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
} from "three";
import { ZONE, ZONE_COUNT, woundLevel, type ZoneId } from "@cb/shared";
import * as K from "../catalog.ts";
import { computeProportions, type Proportions } from "../proportions.ts";
import { encodeSpec, type CharacterSpec } from "../spec.ts";
import { buildHead, mouthPlacement } from "./head.ts";
import { outlineMaterial } from "./outline.ts";
import { CREAM, PartBuilder, singe } from "./parts.ts";
import { buildForeArm, buildLowerLeg, buildPelvis, buildTorso, buildUpperArm, buildUpperLeg, type BodyCtx } from "./body.ts";
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
  /** Dark cavity + teeth, revealed as the mouth opens. */
  mouthInterior: Group;
  /** Rest position of the mouth on the face surface (head-centre relative). */
  mouthY: number;
  mouthZ: number;
  lidL: Mesh;
  lidR: Mesh;
  /** Resting geometry constants the animator needs. */
  eyeRadius: number;
  mouthWidth: number;
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

const face = { white: 0xf4efe2, pupil: 0x15100c, brow: 0x2a1c12 };

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
  const jacketC = singe(K.CLOTH_COLORS[spec.jacketColor] ?? 0x555555, burnt);
  const trouserC = singe(K.CLOTH_COLORS[spec.trousersColor] ?? 0x333333, burnt);
  const hatC = singe(K.CLOTH_COLORS[spec.hatColor] ?? 0x333333, burnt);
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
  const eyeR = R * 0.17;
  const eyeX = R * 0.4;
  const eyeY = R * 0.1;
  const eyeZ = -R * 0.86;
  const whiteMat = new MeshToonMaterial({ color: face.white, gradientMap: toonRamp() });
  const pupilMat = new MeshToonMaterial({ color: face.pupil, gradientMap: toonRamp() });
  const browMat = new MeshToonMaterial({ color: hairC, gradientMap: toonRamp() });
  const skinMat = new MeshToonMaterial({ color: skin, gradientMap: toonRamp() });
  const mouthMat = new MeshToonMaterial({ color: 0x5a1f1a, gradientMap: toonRamp() });
  const mkEye = (x: number): { g: Group; pupil: Mesh; lid: Mesh } => {
    const g = new Group();
    g.position.set(x, eyeY, eyeZ);
    const white = new Mesh(new SphereGeometry(eyeR, 8, 6), whiteMat);
    const pupil = new Mesh(new SphereGeometry(eyeR * 0.5, 6, 4), pupilMat);
    pupil.position.set(0, 0, -eyeR * 0.72);
    // A shallow skin-coloured cap over the eyeball. Axis +Y at rest; the animator tilts it: 0.5 rad = retracted
    // up-and-back (eye open), -PI/2 = axis pointing forward over the pupil (eye closed / blink).
    const lid = new Mesh(new SphereGeometry(eyeR * 1.07, 8, 3, 0, Math.PI * 2, 0, 1.15), skinMat);
    lid.rotation.x = 0.5;
    g.add(white, pupil, lid);
    faceRoot.add(g);
    return { g, pupil, lid };
  };
  const eL = mkEye(-eyeX);
  const eRr = mkEye(eyeX);
  const browGeo = new BoxGeometry(R * 0.36, R * 0.07, R * 0.08);
  const browL = new Mesh(browGeo, browMat);
  const browR = new Mesh(browGeo, browMat);
  browL.position.set(-eyeX, R * 0.42, -R * 0.86);
  browR.position.set(eyeX, R * 0.42, -R * 0.86);
  faceRoot.add(browL, browR);
  const mouthWidth = R * 0.5;
  const mouth = new Mesh(new TorusGeometry(mouthWidth * 0.5, R * 0.03, 4, 10, Math.PI), mouthMat);
  const mp = mouthPlacement(P);
  mouth.position.set(0, mp.y, mp.z);
  mouth.rotation.z = Math.PI; // smile arc opens upward by default
  faceRoot.add(mouth);
  // Mouth interior: a dark cavity with a row of teeth (ivory, gold, or missing per the campaign-owned `teeth` flags).
  const mouthInterior = new Group();
  mouthInterior.position.set(0, mp.y, mp.z + R * 0.012);
  mouthInterior.visible = false;
  const cavity = new Mesh(new SphereGeometry(1, 8, 5), new MeshToonMaterial({ color: 0x2a0c0c, gradientMap: toonRamp() }));
  cavity.scale.set(mouthWidth * 0.5, R * 0.15, R * 0.03);
  mouthInterior.add(cavity);
  const teethGeo = buildTeeth(spec, mouthWidth, R, accent);
  if (teethGeo) {
    const teeth = new Mesh(teethGeo, material);
    teeth.position.y = R * 0.03;
    mouthInterior.add(teeth);
    ownedGeosLate.push(teethGeo);
  }
  ownedGeosLate.push(cavity.geometry);
  faceRoot.add(mouthInterior);
  for (const m of [browL, browR, mouth, eL.pupil, eRr.pupil, eL.lid, eRr.lid]) m.castShadow = false;

  const faceParts: FaceParts = {
    eyeL: eL.g, eyeR: eRr.g, pupilL: eL.pupil, pupilR: eRr.pupil, browL, browR, mouth, lidL: eL.lid, lidR: eRr.lid,
    eyeRadius: eyeR, mouthWidth, mouthInterior, mouthY: mp.y, mouthZ: mp.z,
  };
  const ownedGeos: BufferGeometry[] = [browGeo, mouth.geometry, eL.lid.geometry, eRr.lid.geometry, ...ownedGeosLate];
  const ownedMats = [whiteMat, pupilMat, browMat, skinMat, mouthMat, cavity.material as MeshToonMaterial];
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
    for (let z = 0; z < ZONE_COUNT; z++) {
      const sev = woundLevel(mask, z);
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
  };

  return {
    root,
    joints: { root, pelvis, torso, head, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR },
    face: faceParts,
    proportions: P,
    spec,
    get meshCount() {
      return meshes.length + 7 + (outlineOn ? outlines.length : 0) + woundMeshes.filter((m) => m?.visible).length;
    },
    setWounds,
    setOutline(on: boolean) {
      outlineOn = on;
      for (const o of outlines) o.visible = on;
    },
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
  const ivory = 0xeee6cc;
  for (let i = 0; i < 6; i++) {
    const front = i === 2 || i === 3;
    const side = i === 0 || i === 5;
    const goldSide = i === 1 || i === 4;
    if (front && (spec.teeth & 1)) continue; // missing front teeth
    if (side && (spec.teeth & 4)) continue; // missing side teeth
    const isGold = (front && (spec.teeth & 2) !== 0) || (goldSide && (spec.teeth & 8) !== 0);
    b.box(w * 0.92, R * 0.085, R * 0.03, isGold ? gold : ivory, [(i - 2.5) * w, 0, 0]);
  }
  return b.build();
}
