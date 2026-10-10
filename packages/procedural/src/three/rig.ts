import {
  BufferGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  Matrix4,
  ShaderMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type Bone,
  type Material,
} from "three";
import { HEAD, LIMB, PALETTE, ZONE, ZONE_COUNT, woundLevel, zoneLimb, type LimbId, type ZoneId } from "@cb/shared";
import * as K from "../catalog.ts";
import { computeProportions, type Proportions } from "../proportions.ts";
import { encodeSpec, type CharacterSpec } from "../spec.ts";
import { buildHead } from "./head.ts";
import { morphOutlineMaterial } from "./faceMorph.ts";
import { buildFace, clearFaceCaches, inertFace, irisColour, type FaceBuild, type FaceParts } from "./faceRig.ts";
import { outlineMaterial, sharedToonRamp } from "./outline.ts";
import { hairSwayHullMaterial, hairSwayMaterial, type HairSwayUniform } from "./hairSway.ts";
import { mergeRigid, posedBounds, type RigidPart } from "./merged.ts";
import { PartBuilder, singe, type Lod } from "./parts.ts";
import { buildProsthesis } from "./prosthetics.ts";
import { buildNeckStump, buildStump, buildForeArm, buildHandBone, buildLowerLeg, buildPelvis, buildTorso, buildUpperArm, buildUpperLeg, type BodyCtx } from "./body.ts";
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
  /**
   * The hand's own bone, a child of the elbow (the forearm) at the wrist: the hand turns here (weaponPose.ts `solveWrist` follows a weapon's grip, the animator adds a loose swing,
   * the ragdoll lets it dangle). Its local Z is the hand's grip axis. Appended to the interface: code that only knows the older joints is unaffected.
   */
  wristL: Group;
  wristR: Group;
  hipL: Group;
  hipR: Group;
  kneeL: Group;
  kneeR: Group;
}

export interface CharacterRig {
  root: Group;
  joints: Joints;
  face: FaceParts;
  /**
   * The hair's sway as ONE vec3 (head bone frame, metres at the tips: x right, y up, z behind) that the head's shader reads (hairSway.ts). The animator drives it; a rig whose head has no
   * hair, or that is at a crowd level, ignores it. Appended to the interface: code that does not know it is unaffected.
   */
  hairSway: { value: Vector3 };
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
   * add it to the scene yourself. Works whether or not the limb is currently hidden. D-118: `HEAD` gives the head (its face, hat and hair, frozen
   * in its last expression) with the origin at the neck joint and the head standing up its +Y.
   */
  detachLimb(limb: number): Group | undefined;
  /** D-118: the head has come off (`setMissing` with the HEAD bit): the head joint and everything on it is hidden, and a neck stump stands on the collar. */
  readonly headless: boolean;
  dispose(): void;
}

// Bone geometry is cached by (bone, canonical spec, level of detail) so identical characters (crowds, clones) share GPU memory.
const geometryCache = new Map<string, BufferGeometry | null>();
const MAX_CACHE = 1536; // main + outline hull per bone per live spec per level (22 villagers at three levels need ~800; a 512 cap made people rebuild as you crossed the village)
let sharedMaterial: MeshToonMaterial | undefined;

/** D-078: the bones whose geometry is clothes (a sleeve, a coat, trousers, a skirt): their vertices are woven unless skin or leather. */
const CLOTH_BONES = /^(pelvis|torso|upperArm|foreArm|upperLeg|lowerLeg)/;

/**
 * D-078: the characters' clothes were flat fills beside a world that has grain (D-075). Fabric vertices (`fab`) now carry a woven surface worked out in
 * the BONE's own space (so it travels with the sleeve, never swims): a fine over-under of threads about 9 mm apart, which fades out where the threads
 * would be finer than a couple of pixels, and a soft mottle of wear and dye that stays at any distance. It only darkens and lightens the dye; skin,
 * leather, hair and the face are untouched.
 */
const WEAVE_VERT_HEAD = /* glsl */ `
  attribute float fab;
  varying float vFab;
  varying vec3 vLoc;
`;
const WEAVE_FRAG_HEAD = /* glsl */ `
  varying float vFab;
  varying vec3 vLoc;
  float wHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float wNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;
const WEAVE_BODY = /* glsl */ `
  if (vFab > 0.5) {
    vec3 q = vLoc * 110.0;
    float a = q.y, b = q.x + q.z;
    float weave = sin(a * 3.14159) * sin(b * 3.14159);
    float px = fwidth(a) + fwidth(b);
    float fine = 1.0 - smoothstep(0.25, 0.7, px);
    float mott = wNoise(vLoc * 7.0) * 0.6 + wNoise(vLoc * 23.0) * 0.4;
    diffuseColor.rgb *= 1.0 + weave * 0.075 * fine + (mott - 0.5) * 0.11;
  }
`;

function makeClothMaterial(): MeshToonMaterial {
  const m = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() }); // (the world's own ramp: a hill and a hat are lit in the same bands)
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WEAVE_VERT_HEAD}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFab = fab; vLoc = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${WEAVE_FRAG_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${WEAVE_BODY}`);
  };
  m.customProgramCacheKey = (): string => "charWeave";
  return m;
}

const clothMaterial = (): MeshToonMaterial => (sharedMaterial ??= makeClothMaterial());

function cached(key: string, make: () => BufferGeometry | undefined): BufferGeometry | undefined {
  const hit = geometryCache.get(key);
  if (hit !== undefined) {
    // least-recently-USED, not first-built: a person's geometry that is still in play is never the one evicted (the village's rebuild hitch, docs/PERFORMANCE.md)
    geometryCache.delete(key);
    geometryCache.set(key, hit);
    return hit ?? undefined;
  }
  const g = make() ?? null;
  geometryCache.set(key, g);
  if (geometryCache.size > MAX_CACHE) {
    // Evict oldest entries; geometries still referenced by live rigs are re-created on demand, never freed under them.
    const first = geometryCache.keys().next().value as string | undefined;
    if (first !== undefined) geometryCache.delete(first);
  }
  return g ?? undefined;
}

/** Entries in the shared bone-geometry cache (tests and the crowd's budget check: a crowd person must stay a few dozen entries, not hundreds). */
export function characterCacheSize(): number {
  return geometryCache.size;
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
  /**
   * CROWD rig (scenery people; D-036): levels 1 and 2 are each drawn as ONE skinned mesh weighted rigidly to this rig's own joints (merged.ts), so a person costs 1 draw there instead of
   * 21 / 11. Level 1 carries a frozen neutral face (no blinks or brows at 20-45 m). Level 0 is unchanged. Not for people who are wounded, maimed or ink-lined at a distance: at levels
   * 1 and 2 a merged rig draws no outline hulls, no wound dressings and no stumps (the crowd is scenery; heroes and ragdolls do not use this).
   */
  merged?: boolean;
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
  const wristL = mk("wristL", elbowL, 0, -P.armLower, 0);
  const wristR = mk("wristR", elbowR, 0, -P.armLower, 0);
  const hipL = mk("hipL", pelvis, -P.hipWidth, 0, 0);
  const hipR = mk("hipR", pelvis, P.hipWidth, 0, 0);
  const kneeL = mk("kneeL", hipL, 0, -P.legUpper, 0);
  const kneeR = mk("kneeR", hipR, 0, -P.legUpper, 0);
  torso.rotation.x = -P.lean;

  // CROWD rigs (options.merged): the rest pose, captured now while nobody has posed anything and the root is the identity, is what the merged meshes are built and bound in.
  const mergedOn = options.merged === true;
  const boneList: Group[] = [pelvis, torso, head, shoulderL, elbowL, wristL, shoulderR, elbowR, wristR, hipL, kneeL, hipR, kneeR];
  const restOf = new Map<Group, Matrix4>();
  let skeleton: Skeleton | undefined;
  if (mergedOn) {
    root.updateMatrixWorld(true);
    for (const b of boneList) restOf.set(b, b.matrixWorld.clone());
  }

  let lod: Lod = options.lod ?? 0;
  let outlineOn = options.outline ?? true;
  const attachments: Attachment[] = [];
  const meshes: Mesh[] = [];
  const outlines: Mesh[] = [];
  const hiddenBones = new Set<string>();

  // Hair sway (hairSway.ts): a head that has hair on it draws with this rig's own copy of the cloth shader and ink hull, which read the rig's one `hairSway` vec3 (the animator drives it).
  const hairSway: HairSwayUniform = { value: new Vector3() };
  const swayMaterials: Material[] = [];
  let headCloth: MeshToonMaterial | undefined;
  const hullKinds = new Map<string, ShaderMaterial>();
  const bodyMaterial = (a: Attachment, g: BufferGeometry): MeshToonMaterial => {
    if (a.bone !== "head" || !g.hasAttribute("hsw")) return material;
    if (!headCloth) swayMaterials.push((headCloth = hairSwayMaterial(material, hairSway)));
    return headCloth;
  };
  const hullMaterial = (a: Attachment, g: BufferGeometry): ShaderMaterial => {
    const morph = a.morphs && !!g.morphAttributes.position;
    if (a.bone !== "head" || !g.hasAttribute("hsw")) return morph ? morphOutlineMaterial() : outlineMaterial();
    const k = morph ? "morph" : "plain";
    let m = hullKinds.get(k);
    if (!m) {
      m = hairSwayHullMaterial(morph, hairSway);
      hullKinds.set(k, m);
      swayMaterials.push(m);
    }
    return m;
  };
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
    const o = new Mesh(hg, hullMaterial(a, hg));
    o.name = `outline_${a.bone}`;
    o.visible = !hiddenBones.has(a.bone) && !a.mesh.userData.lodOff;
    o.castShadow = false;
    a.parent.add(o);
    a.hull = o;
    outlines.push(o);
    if (a.morphs) a.mesh.userData.hull = o;
  };
  // A bone's mesh exists as soon as its builder gives geometry at the current level (the hand bone has none at the far level: the forearm draws the far fist). It is created the first
  // time there is geometry, and hidden (not freed) at levels where there is none.
  const ensureMesh = (a: Attachment): void => {
    if (a.mesh) return;
    const geo = meshGeometry(a);
    if (!geo) return;
    const m = new Mesh(geo, bodyMaterial(a, geo));
    m.name = `mesh_${a.bone}`;
    m.castShadow = true;
    m.receiveShadow = false;
    m.visible = !hiddenBones.has(a.bone);
    a.parent.add(m);
    a.mesh = m;
    meshes.push(m);
    if (outlineOn) ensureHull(a);
  };
  const attach = (bone: string, parent: Group, make: () => BufferGeometry | undefined, morphs = false): void => {
    // D-078: the bones that are clothes mark their vertices as fabric (except skin and leather), for the material's weave
    if (CLOTH_BONES.test(bone)) {
      const inner = make;
      make = () => {
        PartBuilder.fabric = { except: [skin, leatherC] };
        try {
          return inner();
        } finally {
          PartBuilder.fabric = undefined;
        }
      };
    }
    const a: Attachment = { bone, parent, make, morphs };
    attachments.push(a);
    if (!(mergedOn && lod >= 1)) ensureMesh(a); // (a merged crowd rig never builds per-bone geometry at levels 1 and 2)
  };

  const body: BodyCtx = { spec, P, skin, jacketC, trouserC, shirtC, armC, accent, burnt, footH, leather: leatherC };
  // ---- pelvis, torso ---------------------------------------------------------------------------------------------
  attach("pelvis", pelvis, () => buildPelvis(body));
  attach("torso", torso, () => buildTorso(body));

  // ---- head ------------------------------------------------------------------------------------------------
  const R = P.headRadius;
  attach("head", head, () => buildHead(spec, P, { skin, hairC, hatC, accent, burnt, morph: PartBuilder.lod === 0 }), true);

  // ---- arms ------------------------------------------------------------------------------------------------------
  for (const [side, shoulder, elbow, wrist] of [["L", shoulderL, elbowL, wristL], ["R", shoulderR, elbowR, wristR]] as const) {
    attach(`upperArm${side}`, shoulder, () => buildUpperArm(body, side));
    attach(`foreArm${side}`, elbow, () => buildForeArm(body, side));
    attach(`hand${side}`, wrist, () => buildHandBone(body, side)); // (the hand is its own bone: it turns at the wrist)
  }

  // ---- legs ---------------------------------------------------------------------------------------------------------
  for (const [side, hip, knee, woodId] of [["L", hipL, kneeL, 1], ["R", hipR, kneeR, 2]] as const) {
    attach(`upperLeg${side}`, hip, () => buildUpperLeg(body, side));
    attach(`lowerLeg${side}`, knee, () => buildLowerLeg(body, spec.woodenLeg === woodId, side));
  }

  // ---- face (animated parts, separate small meshes; a far-crowd rig gets a placeholder that costs nothing) ----------------------
  const headAttachment = attachments.find((a) => a.bone === "head")!;
  const irisC = irisColour(spec);
  const faceCtx = { spec, P, skin, hairC, accent, irisC, ramp: sharedToonRamp(), toonMaterial: material, headMesh: () => headAttachment.mesh };
  // The face parts are built the first time the figure is near enough to show them (a far-crowd rig never builds them); the FaceParts object is the same one
  // throughout (filled in place), so references to `rig.face` stay valid. Their geometry and materials are shared between rigs (faceRig.ts).
  const faceParts: FaceParts = inertFace();
  let faceBuild: FaceBuild | undefined;
  const ensureFace = (): FaceBuild => {
    if (!faceBuild) {
      PartBuilder.auditTag = "face";
      faceBuild = buildFace(faceCtx, head);
      Object.assign(faceParts, faceBuild.face);
    }
    return faceBuild;
  };
  const applyFaceLod = (): void => {
    if (lod >= 2) {
      if (faceBuild) faceBuild.root.visible = false;
      faceParts.active = false;
      return;
    }
    ensureFace();
    if (mergedOn && lod === 1) {
      // the merged level-1 mesh carries a frozen copy of this face; the live parts stay built (level 0 needs them) but hidden and un-animated
      faceBuild!.root.visible = false;
      faceParts.active = false;
      return;
    }
    faceBuild!.root.visible = true;
    faceBuild!.setDetail(lod === 0 ? 0 : 1);
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
    [LIMB.ARM_L]: { bones: ["upperArmL", "foreArmL", "handL"], joint: shoulderL, lower: elbowL, kind: "arm", side: "L", prosthetic: spec.hook === 1 },
    [LIMB.ARM_R]: { bones: ["upperArmR", "foreArmR", "handR"], joint: shoulderR, lower: elbowR, kind: "arm", side: "R", prosthetic: spec.hook === 2 },
    [LIMB.LEG_L]: { bones: ["upperLegL", "lowerLegL"], joint: hipL, lower: kneeL, kind: "leg", side: "L", prosthetic: spec.woodenLeg === 1 },
    [LIMB.LEG_R]: { bones: ["upperLegR", "lowerLegR"], joint: hipR, lower: kneeR, kind: "leg", side: "R", prosthetic: spec.woodenLeg === 2 },
  };
  const stumpMeshes = new Map<number, Mesh>();
  const prosthesisMeshes = new Map<number, Mesh>();
  let shownMissing = 0;
  let shownMissingGore: GoreLevel = "full";
  // D-118: the head. Hiding its joint hides everything on it (the head's mesh and hull, the face's parts, its dressing, the marks on it); the neck stump stands on the
  // torso where the joint is, so it stays when the head is gone.
  let neckStump: Mesh | undefined;
  const setHeadless = (gone: boolean, gore: GoreLevel): void => {
    head.visible = !gone;
    if (!gone) {
      if (neckStump) neckStump.visible = false;
      return;
    }
    const geo = cached(`stump|neck|${gore}|${key}`, () => withMode(lod, false, () => buildNeckStump(body, gore)));
    if (!geo) return;
    if (!neckStump) {
      neckStump = new Mesh(geo, material);
      neckStump.name = "stump_head";
      neckStump.castShadow = true;
      neckStump.position.copy(head.position);
      torso.add(neckStump);
    }
    neckStump.geometry = geo;
    neckStump.visible = true;
  };
  const setMissing = (mask: number, gore: GoreLevel = "full"): void => {
    if (mask === shownMissing && gore === shownMissingGore) return;
    shownMissing = mask;
    shownMissingGore = gore;
    setHeadless((mask & HEAD) !== 0, gore);
    for (const limb of [LIMB.ARM_L, LIMB.ARM_R, LIMB.LEG_L, LIMB.LEG_R] as LimbId[]) {
      const info = LIMB_BONES[limb]!;
      const gone = (mask & limb) !== 0;
      for (const bone of info.bones) {
        if (gone) hiddenBones.add(bone);
        else hiddenBones.delete(bone);
      }
      for (const m of meshes) if (info.bones.includes(m.name.slice(5))) m.visible = !gone && !m.userData.lodOff;
      for (const o of outlines) if (info.bones.includes(o.name.slice(8))) o.visible = outlineOn && !gone && !meshes.find((m) => m.name === `mesh_${o.name.slice(8)}`)?.userData.lodOff;
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
  /** D-118: the head as it is now, every child of its joint copied in place (shared geometry and materials; a mesh keeps its expression). */
  const detachHead = (): Group => {
    root.updateWorldMatrix(true, true);
    const pivot = new Group();
    head.matrixWorld.decompose(pivot.position, pivot.quaternion, pivot.scale);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrix();
    inv.copy(pivot.matrix).invert();
    for (const child of head.children) {
      const c = child.clone(true);
      c.matrixAutoUpdate = false;
      c.matrix.multiplyMatrices(inv, child.matrixWorld);
      pivot.add(c);
    }
    return pivot;
  };
  const detachLimb = (limb: number): Group | undefined => {
    if (limb === HEAD) return detachHead();
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
    for (const o of outlines) o.visible = on && !hiddenBones.has(o.name.slice(8)) && !meshes.find((m) => m.name === `mesh_${o.name.slice(8)}`)?.userData.lodOff;
  };

  // ---- hands: one number per hand drives two morph targets (half a grip and a full grip) on the forearm mesh --------------------------------------------------
  const grip = { L: 0, R: 0 };
  const applyGrip = (side: "L" | "R"): void => {
    const m = meshes.find((o) => o.name === `mesh_hand${side}`);
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

  // ---- merged crowd levels: one skinned mesh per level, built on first use from the same bone builders (and, at level 1, the frozen face), cached by (spec, level) ---------------
  const mergedMeshes: (SkinnedMesh | undefined)[] = [undefined, undefined, undefined];
  const mergedGeometry = (level: 1 | 2): BufferGeometry | undefined =>
    cached(`merged|${key}|L${level}`, () => {
      const parts: RigidPart[] = [];
      for (const a of attachments) {
        PartBuilder.auditTag = a.bone;
        PartBuilder.sway = false; // (a merged head never sways: it is not asked to pay for the attribute)
        let g: BufferGeometry | undefined;
        try {
          g = withMode(level, false, a.make);
        } finally {
          PartBuilder.sway = true;
        }
        if (g) parts.push({ geometry: g, bone: boneList.indexOf(a.parent), matrix: restOf.get(a.parent)! });
      }
      if (level === 1) {
        const headRest = restOf.get(head)!;
        for (const s of ensureFace().statics) parts.push({ geometry: s.geometry, bone: boneList.indexOf(head), matrix: new Matrix4().multiplyMatrices(headRest, s.matrix) });
      }
      const merged = mergeRigid(parts);
      for (const p of parts) if (!ownedByFace(p.geometry)) p.geometry.dispose(); // (bone geometry was built just for this; the face's belongs to the face cache)
      return merged;
    });
  const faceGeometries = new Set<BufferGeometry>();
  const ownedByFace = (g: BufferGeometry): boolean => faceGeometries.has(g);
  const ensureMerged = (level: 1 | 2): void => {
    if (mergedMeshes[level]) return;
    if (level === 1) for (const s of ensureFace().statics) faceGeometries.add(s.geometry);
    const geo = mergedGeometry(level);
    if (!geo) return;
    if (!skeleton) skeleton = new Skeleton(boneList as unknown as Bone[], boneList.map((b) => restOf.get(b)!.clone().invert()));
    const m = new SkinnedMesh(geo, material);
    m.name = `merged_L${level}`;
    m.castShadow = level === 1;
    m.receiveShadow = false;
    m.boundingSphere = posedBounds(geo);
    root.add(m);
    m.bind(skeleton, new Matrix4()); // identity bind: the vertices already are in the rig-root frame (merged.ts)
    mergedMeshes[level] = m;
  };
  const showMerged = (): void => {
    if (!mergedOn) return;
    for (const level of [1, 2] as const) {
      if (lod === level) ensureMerged(level);
      const m = mergedMeshes[level];
      if (m) m.visible = lod === level;
    }
  };

  const setLod = (next: Lod): void => {
    if (next === lod) return;
    lod = next;
    if (mergedOn && lod >= 1) {
      // a crowd level: the per-bone meshes (and their hulls) are put away, never rebuilt at this level; the merged mesh below draws instead
      for (const a of attachments) {
        if (a.mesh) {
          a.mesh.userData.lodOff = true;
          a.mesh.visible = false;
        }
        if (a.hull) a.hull.visible = false;
      }
      applyFaceLod();
      showMerged();
      return;
    }
    showMerged(); // (back at level 0, or never merged: hides the merged meshes)
    for (const a of attachments) {
      const g = meshGeometry(a);
      if (a.mesh) {
        const off = !g;
        a.mesh.userData.lodOff = off;
        if (g) {
          a.mesh.geometry = g;
          a.mesh.material = bodyMaterial(a, g);
          a.mesh.updateMorphTargets();
        }
        a.mesh.visible = !off && !hiddenBones.has(a.bone);
      } else if (g) ensureMesh(a);
      if (a.hull && a.mesh) {
        const h = g ? hullGeometry(a) : undefined;
        if (h) {
          a.hull.geometry = h;
          a.hull.material = hullMaterial(a, h);
          a.hull.updateMorphTargets();
        }
        a.hull.visible = outlineOn && !!h && !hiddenBones.has(a.bone);
      }
    }
    applyFaceLod();
    applyGrip("L");
    applyGrip("R");
  };

  if (mergedOn && lod >= 1) showMerged(); // (a rig BUILT at a crowd level)

  const isShown = (o: Mesh): boolean => {
    for (let n: Group | Mesh | null = o; n; n = n.parent as Group | null) if (!n.visible) return false;
    return true;
  };

  return {
    root,
    joints: { root, pelvis, torso, head, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, hipL, hipR, kneeL, kneeR },
    face: faceParts,
    hairSway,
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
    get headless() {
      return (shownMissing & HEAD) !== 0;
    },
    dispose() {
      // Bone and face geometry and materials belong to the shared caches (freed by clearCharacterCaches); a rig owns only its scene-graph objects (and a merged rig's bone texture).
      for (const m of swayMaterials) m.dispose();
      swayMaterials.length = 0;
      headCloth = undefined;
      hullKinds.clear();
      for (const m of mergedMeshes) m?.removeFromParent();
      mergedMeshes.fill(undefined);
      skeleton?.dispose();
      skeleton = undefined;
      root.removeFromParent();
    },
  };
}
