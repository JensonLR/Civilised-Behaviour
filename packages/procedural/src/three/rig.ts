import {
  BufferGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  DataTexture,
  NearestFilter,
  RedFormat,
  Matrix4,
  type Material,
} from "three";
import { LIMB, PALETTE, ZONE, ZONE_COUNT, woundLevel, zoneLimb, type LimbId, type ZoneId } from "@cb/shared";
import * as K from "../catalog.ts";
import { computeProportions, type Proportions } from "../proportions.ts";
import { encodeSpec, type CharacterSpec } from "../spec.ts";
import { buildHead } from "./head.ts";
import { morphOutlineMaterial } from "./faceMorph.ts";
import { buildFace, clearFaceCaches, inertFace, irisColour, type FaceBuild, type FaceParts } from "./faceRig.ts";
import { outlineMaterial } from "./outline.ts";
import { PartBuilder, singe, type Lod } from "./parts.ts";
import { buildProsthesis } from "./prosthetics.ts";
import { buildStump, buildForeArm, buildLowerLeg, buildPelvis, buildTorso, buildUpperArm, buildUpperLeg, type BodyCtx } from "./body.ts";
import { buildWoundGeometry, type GoreLevel } from "./wounds.ts";

export type { FaceParts } from "./faceRig.ts";
export type { Lod } from "./parts.ts";

/** Named bones of the rigid articulated hierarchy. Every visual part hangs off exactly one of these. */
export interface Joints {
  root: Group;
  pelvis: Group;
  torso: Group;
  /** One Group that holds ALL head geometry (skull, hair, hat, eyewear, face parts): hide it and the whole head is gone. */
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

export interface CharacterRig {
  root: Group;
  joints: Joints;
  face: FaceParts;
  proportions: Proportions;
  spec: CharacterSpec;
  /** The level of detail the meshes are currently at (0 full, 1 mid distance, 2 far silhouette). */
  readonly lod: Lod;
  /** Number of draw-call-producing meshes right now (excludes shadow-pass doubling; includes visible outlines). */
  readonly meshCount: number;
  /**
   * Switches the geometry to another crowd level of detail without touching the hierarchy: the joints, the face object and every reference the
   * animator, the ragdoll or the actor hold stay valid; only the bone meshes swap (from the geometry cache, built once per spec and level).
   */
  setLod(lod: Lod): void;
  /**
   * Closes or opens a hand: 0 is the relaxed, open hand (fingers apart, a little curled), 1 a closed fist, anything between a smooth curl (a grip on a rod: 0.8). One
   * number per hand, no extra draw call (a morph target on the forearm mesh). Only the full-detail level has fingers; the crowd levels keep a plain fist and ignore it.
   * The value is remembered across `setLod`. Hands with a hook ignore it. Drive it from `updateHandGrips` (animatorExtras.ts) or from the weapon in the hand.
   */
  setHandGrip(side: "L" | "R", amount: number): void;
  /** The grip last set for a hand (0 relaxed .. 1 fist). */
  handGrip(side: "L" | "R"): number;
  /** Silhouette outline on/off (extra draw per bone). Cheap to toggle; the hulls are built the first time they are switched on. */
  setOutline(on: boolean): void;
  /**
   * Shows the wounds in a packed mask (see @cb/shared wounds.ts): plasters, dressings and stains on the bone each zone
   * belongs to. Cheap to call every frame with an unchanged mask. `gore` recolours stains (never removes the dressings).
   */
  setWounds(mask: number, gore?: GoreLevel): void;
  /**
   * Removes lost limbs (LIMB bit mask from @cb/shared): the limb's meshes (and outlines) are hidden and a capped stump appears at the
   * joint. Cheap to call every frame with an unchanged mask. `gore` recolours the wound cap. A lost leg whose side matches `spec.woodenLeg`
   * (or a lost arm matching `spec.hook`) is fitted with a prosthesis instead: a peg leg, or an iron arm ending in a hook.
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

// Bone geometry is cached by (bone, canonical spec, level of detail) so identical characters (crowds, clones) share GPU memory.
const geometryCache = new Map<string, BufferGeometry | null>();
const MAX_CACHE = 512; // main + outline hull per bone per live spec per level
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
  clearFaceCaches();
}

/** Runs a builder in a given level of detail / hull mode (the PartBuilder statics are restored afterwards, whatever happens). */
function withMode<T>(lod: Lod, hull: boolean, make: () => T): T {
  const prevLod = PartBuilder.lod;
  const prevHull = PartBuilder.hullMode;
  PartBuilder.lod = lod;
  PartBuilder.hullMode = hull;
  try {
    return make();
  } finally {
    PartBuilder.lod = prevLod;
    PartBuilder.hullMode = prevHull;
  }
}

export interface BuildOptions {
  /** Draw a silhouette outline (default true). Crowds should pass false. */
  outline?: boolean;
  /** Level of detail (default 0): 1 drops fine detail and small accessories, 2 is a cheap far-crowd silhouette. See `CharacterRig.setLod`. */
  lod?: Lod;
}

interface Attachment {
  bone: string;
  parent: Group;
  make: () => BufferGeometry | undefined;
  mesh?: Mesh;
  hull?: Mesh;
  /** Bone 'head' carries the face morph targets at LOD0. */
  morphs: boolean;
}

/**
 * Builds the full articulated caricature for a spec. The hierarchy is rigid (no skinning) so limbs can
 * detach cleanly for dismemberment and pose replication stays cheap. Rest pose: standing, facing -Z.
 */
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
  const shirtC = singe(K.SHIRT_COLORS[spec.shirtColor] ?? PALETTE.material.cream, burnt);
  const leatherC = singe(K.LEATHER_COLORS[spec.bootColor] ?? PALETTE.material.leather, burnt);
  const sleeved = spec.jacket !== 0 && spec.jacket !== 3; // shirt sleeves and waistcoats show the shirt's arms
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

  let lod: Lod = options.lod ?? 0;
  let outlineOn = options.outline ?? true;
  const attachments: Attachment[] = [];
  const meshes: Mesh[] = [];
  const outlines: Mesh[] = [];
  const hiddenBones = new Set<string>();

  const meshGeometry = (a: Attachment): BufferGeometry | undefined =>
    cached(`${a.bone}|${key}|L${lod}`, () => {
      PartBuilder.auditTag = a.bone;
      return withMode(lod, false, a.make);
    });
  const hullGeometry = (a: Attachment): BufferGeometry | undefined => cached(`${a.bone}|${key}|L${lod}|hull`, () => withMode(lod, true, a.make));
  const ensureHull = (a: Attachment): void => {
    if (a.hull || !a.mesh) return;
    const hg = hullGeometry(a);
    if (!hg) return;
    const o = new Mesh(hg, a.morphs && hg.morphAttributes.position ? morphOutlineMaterial() : outlineMaterial());
    o.name = `outline_${a.bone}`;
    o.visible = !hiddenBones.has(a.bone);
    o.castShadow = false;
    a.parent.add(o);
    a.hull = o;
    outlines.push(o);
    if (a.morphs) a.mesh.userData.hull = o;
  };
  const attach = (bone: string, parent: Group, make: () => BufferGeometry | undefined, morphs = false): void => {
    const a: Attachment = { bone, parent, make, morphs };
    attachments.push(a);
    const geo = meshGeometry(a);
    if (!geo) return;
    const m = new Mesh(geo, material);
    m.name = `mesh_${bone}`;
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    a.mesh = m;
    meshes.push(m);
    if (outlineOn) ensureHull(a);
  };

  const body: BodyCtx = { spec, P, skin, jacketC, trouserC, shirtC, armC, accent, burnt, footH, leather: leatherC };
  // ---- pelvis, torso ---------------------------------------------------------------------------------------------
  attach("pelvis", pelvis, () => buildPelvis(body));
  attach("torso", torso, () => buildTorso(body));

  // ---- head ------------------------------------------------------------------------------------------------
  const R = P.headRadius;
  attach("head", head, () => buildHead(spec, P, { skin, hairC, hatC, accent, burnt, morph: PartBuilder.lod === 0 }), true);

  // ---- arms ------------------------------------------------------------------------------------------------------
  for (const [side, shoulder, elbow] of [["L", shoulderL, elbowL], ["R", shoulderR, elbowR]] as const) {
    attach(`upperArm${side}`, shoulder, () => buildUpperArm(body, side));
    attach(`foreArm${side}`, elbow, () => buildForeArm(body, side));
  }

  // ---- legs ---------------------------------------------------------------------------------------------------------
  for (const [side, hip, knee, woodId] of [["L", hipL, kneeL, 1], ["R", hipR, kneeR, 2]] as const) {
    attach(`upperLeg${side}`, hip, () => buildUpperLeg(body, side));
    attach(`lowerLeg${side}`, knee, () => buildLowerLeg(body, spec.woodenLeg === woodId, side));
  }

  // ---- face (animated parts, separate small meshes; a far-crowd rig gets a placeholder that costs nothing) ----------------------
  const headAttachment = attachments.find((a) => a.bone === "head")!;
  const irisC = irisColour(spec);
  const faceCtx = { spec, P, skin, hairC, accent, irisC, ramp: toonRamp(), toonMaterial: material, headMesh: () => headAttachment.mesh };
  // The face parts are built the first time the figure is near enough to show them (a far-crowd rig never builds them); the FaceParts object is the same one
  // throughout (filled in place), so references to `rig.face` stay valid. Their geometry and materials are shared between rigs (faceRig.ts).
  const faceParts: FaceParts = inertFace();
  let faceBuild: FaceBuild | undefined;
  const applyFaceLod = (): void => {
    if (lod >= 2) {
      if (faceBuild) faceBuild.root.visible = false;
      faceParts.active = false;
      return;
    }
    if (!faceBuild) {
      PartBuilder.auditTag = "face";
      faceBuild = buildFace(faceCtx, head);
      Object.assign(faceParts, faceBuild.face);
    }
    faceBuild.root.visible = true;
    faceBuild.setDetail(lod === 0 ? 0 : 1);
    faceParts.active = true;
    // mid distance: drop the catch-lights, pupils and lower lids (a pixel or two), keep eyes, lids and brows
    for (const iris of [faceParts.pupilL, faceParts.pupilR]) for (const c of iris.children) c.visible = lod === 0;
    faceParts.lowerLidL.visible = faceParts.lowerLidR.visible = lod === 0;
  };
  applyFaceLod();

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

  // ---- lost limbs: hide the limb's bone meshes, show a stump at the joint (and a prosthesis if the look says so) --------------------------
  const LIMB_BONES: Record<number, { bones: string[]; joint: Group; lower: Group; kind: "arm" | "leg"; side: "L" | "R"; prosthetic: boolean }> = {
    [LIMB.ARM_L]: { bones: ["upperArmL", "foreArmL"], joint: shoulderL, lower: elbowL, kind: "arm", side: "L", prosthetic: spec.hook === 1 },
    [LIMB.ARM_R]: { bones: ["upperArmR", "foreArmR"], joint: shoulderR, lower: elbowR, kind: "arm", side: "R", prosthetic: spec.hook === 2 },
    [LIMB.LEG_L]: { bones: ["upperLegL", "lowerLegL"], joint: hipL, lower: kneeL, kind: "leg", side: "L", prosthetic: spec.woodenLeg === 1 },
    [LIMB.LEG_R]: { bones: ["upperLegR", "lowerLegR"], joint: hipR, lower: kneeR, kind: "leg", side: "R", prosthetic: spec.woodenLeg === 2 },
  };
  const stumpMeshes = new Map<number, Mesh>();
  const prosthesisMeshes = new Map<number, Mesh>();
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
      let prosthesis = prosthesisMeshes.get(limb);
      if (!gone) {
        if (stump) stump.visible = false;
        if (prosthesis) prosthesis.visible = false;
        continue;
      }
      const fitted = info.prosthetic;
      const geo = cached(`stump|${info.kind}|${info.side}|${fitted ? "p" : "b"}|${gore}|${key}`, () => withMode(lod, false, () => buildStump(body, info.kind, gore, fitted)));
      if (geo) {
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
      if (fitted) {
        // the lower half of the prosthesis hangs from the elbow or knee, so it swings and bends with the animation
        const pg = cached(`prosthesis|${info.kind}|${info.side}|${key}`, () => withMode(lod, false, () => buildProsthesis(body, info.kind, info.side)));
        if (pg) {
          if (!prosthesis) {
            prosthesis = new Mesh(pg, material);
            prosthesis.name = `prosthesis_${limb}`;
            prosthesis.castShadow = true;
            info.lower.add(prosthesis);
            prosthesisMeshes.set(limb, prosthesis);
          }
          prosthesis.geometry = pg;
          prosthesis.visible = true;
        }
      } else if (prosthesis) prosthesis.visible = false;
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
      if (m.morphTargetInfluences && c.morphTargetInfluences) for (let i = 0; i < m.morphTargetInfluences.length; i++) c.morphTargetInfluences[i] = m.morphTargetInfluences[i]!; // (a severed hand keeps its grip)
      pivot.add(c);
    };
    for (const m of meshes) if (info.bones.includes(m.name.slice(5))) copy(m);
    if (outlineOn) for (const o of outlines) if (info.bones.includes(o.name.slice(8))) copy(o);
    return pivot;
  };

  const setOutline = (on: boolean): void => {
    outlineOn = on;
    if (on) for (const a of attachments) ensureHull(a);
    for (const o of outlines) o.visible = on && !hiddenBones.has(o.name.slice(8));
  };

  // ---- hands: one number per hand drives two morph targets (half a grip and a full grip) on the forearm mesh --------------------------------------------------
  const grip = { L: 0, R: 0 };
  const applyGrip = (side: "L" | "R"): void => {
    const m = meshes.find((o) => o.name === `mesh_foreArm${side}`);
    const inf = m?.morphTargetInfluences;
    if (!inf || inf.length < 2) return;
    const a = grip[side];
    // Lagrange weights through the poses at 0, 0.5 and 1 (relative targets): exact at those three grips, a smooth curl between
    inf[0] = 4 * a * (1 - a);
    inf[1] = a * (2 * a - 1);
  };
  const setHandGrip = (side: "L" | "R", amount: number): void => {
    const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
    if (a === grip[side]) return;
    grip[side] = a;
    applyGrip(side);
  };

  const setLod = (next: Lod): void => {
    if (next === lod) return;
    lod = next;
    for (const a of attachments) {
      if (a.mesh) {
        const g = meshGeometry(a);
        if (g) {
          a.mesh.geometry = g;
          a.mesh.updateMorphTargets();
        }
      }
      if (a.hull) {
        const g = hullGeometry(a);
        if (g) {
          a.hull.geometry = g;
          a.hull.material = a.morphs && g.morphAttributes.position ? morphOutlineMaterial() : outlineMaterial();
          a.hull.updateMorphTargets();
        }
      }
    }
    applyFaceLod();
    applyGrip("L");
    applyGrip("R");
  };

  const isShown = (o: Mesh): boolean => {
    for (let n: Group | Mesh | null = o; n; n = n.parent as Group | null) if (!n.visible) return false;
    return true;
  };

  return {
    root,
    joints: { root, pelvis, torso, head, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR },
    face: faceParts,
    proportions: P,
    spec,
    get lod() {
      return lod;
    },
    get meshCount() {
      let n = 0;
      root.traverse((o) => {
        if (o instanceof Mesh && isShown(o)) n++;
      });
      return n;
    },
    setWounds,
    setOutline,
    setMissing,
    setLod,
    setHandGrip,
    handGrip: (side) => grip[side],
    detachLimb,
    dispose() {
      // Bone and face geometry and materials belong to the shared caches (freed by clearCharacterCaches); a rig owns only its scene-graph objects.
      root.removeFromParent();
    },
  };
}
