import {
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
} from "three";
import * as K from "../catalog.ts";
import { computeProportions, type Proportions } from "../proportions.ts";
import { encodeSpec, type CharacterSpec } from "../spec.ts";
import { CREAM, LEATHER, PartBuilder, SOOT, WOOD, singe } from "./parts.ts";

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
  /** Number of draw-call-producing meshes (excludes shadow-pass doubling). */
  meshCount: number;
  dispose(): void;
}

// Bone geometry is cached by (bone, canonical spec) so identical characters (crowds, clones) share GPU memory.
const geometryCache = new Map<string, BufferGeometry | null>();
const MAX_CACHE = 96;
let sharedMaterial: MeshStandardMaterial | undefined;

const clothMaterial = (): MeshStandardMaterial => (sharedMaterial ??= new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 }));

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
export function buildCharacter(spec: CharacterSpec): CharacterRig {
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
  const attach = (bone: string, parent: Group, make: () => BufferGeometry | undefined): void => {
    const geo = cached(`${bone}|${key}`, make);
    if (!geo) return;
    const m = new Mesh(geo, material);
    m.name = `mesh_${bone}`;
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    meshes.push(m);
  };

  // ---- pelvis: hips, belt, coat tails ------------------------------------------------------------------
  attach("pelvis", pelvis, () => {
    const b = new PartBuilder();
    b.sphere(1, trouserC, [0, 0.0, 0], [P.hipWidth * 1.9 + P.torsoWidth * 0.32, 0.12 * P.scale + 0.05, P.torsoDepth * 0.42]);
    if (spec.jacket === 1 || spec.jacket === 4) {
      // frock coat / greatcoat skirts hanging behind and beside the hips
      const len = spec.jacket === 4 ? P.legUpper * 1.45 : P.legUpper * 0.95;
      b.box(P.torsoWidth * 0.95, len, 0.05, jacketC, [0, -len / 2 + 0.02, P.torsoDepth * 0.3], [0.08, 0, 0]);
      b.box(0.05, len * 0.9, P.torsoDepth * 0.6, jacketC, [-P.torsoWidth * 0.46, -len * 0.45, 0.02]);
      b.box(0.05, len * 0.9, P.torsoDepth * 0.6, jacketC, [P.torsoWidth * 0.46, -len * 0.45, 0.02]);
    }
    return b.build();
  });

  // ---- torso: body, coat details, belt, sash, medals -----------------------------------------------------
  attach("torso", torso, () => {
    const b = new PartBuilder();
    const h = P.torsoHeight;
    const rx = P.torsoWidth / 2;
    const rz = P.torsoDepth / 2;
    const bodyC = spec.jacket === 3 ? trouserC : sleeved ? jacketC : shirtC; // waistcoat: darker cloth body over shirt
    b.sphere(1, bodyC, [0, h * 0.5, 0], [rx * 1.05, h * 0.52, rz]);
    if (P.bellyRadius > 0.01) {
      b.sphere(1, bodyC, [0, h * 0.3, -P.bellyForward * 0.55], [rx * 0.98 + P.bellyRadius * 0.4, h * 0.36 + P.bellyRadius * 0.5, rz + P.bellyForward * 0.8]);
    }
    // shoulders (yoke) so the arm joints read as attached
    b.sphere(1, bodyC, [0, h * 0.86, 0], [P.shoulderHalfWidth + 0.03, h * 0.16, rz * 0.9]);
    // shirt front / collar
    const collarC = singe(CREAM, burnt);
    if (spec.jacket !== 0) {
      b.sphere(1, shirtC, [0, h * 0.72, -rz * 0.86], [rx * 0.32, h * 0.2, rz * 0.24]);
    }
    b.torus(P.neck + 0.06, 0.028, collarC, [0, h * 0.99, 0], [Math.PI / 2, 0, 0], [1.05, 1.05, 1]);
    // shirt pattern: stripes / checks as thin dark bands across the shirt front
    if (spec.shirt === 1 || spec.shirt === 2) {
      for (let i = 0; i < 4; i++) b.box(rx * 0.5, 0.012, 0.01, singe(0x8a6a5a, burnt), [0, h * (0.6 + i * 0.07), -rz * 1.06]);
    }
    // jacket buttons
    if (spec.jacket !== 0) {
      const rows = spec.jacket === 2 ? 5 : 4;
      for (let i = 0; i < rows; i++) b.sphere(0.018, accent, [0.0, h * (0.28 + i * 0.13), -rz * (1.0 + 0.06) - (i < 2 ? P.bellyForward * 0.9 : 0)]);
    }
    // belt / cummerbund at the waist, following the belly ellipse
    const waistY = h * 0.22;
    const wx = rx * 0.98 + P.bellyRadius * 0.45;
    const wz = rz + P.bellyForward * 0.7;
    if (spec.belt === 1) b.torus(1, 0.025, LEATHER, [0, waistY, -P.bellyForward * 0.4], [Math.PI / 2, 0, 0], [wx, wz, 1]);
    if (spec.belt === 1) b.box(0.05, 0.05, 0.02, accent, [0, waistY, -wz - P.bellyForward * 0.4 - 0.03]);
    if (spec.belt === 2) b.torus(1, 0.06, singe(0x7a1f2a, burnt), [0, waistY, -P.bellyForward * 0.4], [Math.PI / 2, 0, 0], [wx, wz, 1]);
    // sash: a tilted ring around the torso (diagonal) or a fat ring at the waist
    if (spec.sash === 1) b.torus(1, 0.04, singe(0x8f1f2a, burnt), [0, h * 0.52, -P.bellyForward * 0.15], [Math.PI / 2, 0.55, 0.25], [rx * 1.12 + P.bellyRadius * 0.2, rz * 1.1 + P.bellyForward * 0.5, 1]);
    if (spec.sash === 2) b.torus(1, 0.05, singe(0xb8a06a, burnt), [0, h * 0.34, -P.bellyForward * 0.3], [Math.PI / 2, 0, 0], [wx * 1.03, wz * 1.05, 1]);
    // medals on the character's left breast (-X), pinned to the surface
    for (let i = 0; i < spec.medals; i++) {
      const mx = -rx * 0.55 + (i % 3) * 0.055;
      const my = h * 0.72 - Math.floor(i / 3) * 0.07;
      b.cylinder(0.026, 0.026, 0.008, i % 2 ? K.ACCENT_COLORS[1] : accent, [mx, my, -rz * 1.03 - 0.01], [Math.PI / 2, 0, 0]);
      b.box(0.02, 0.05, 0.006, i % 2 ? 0x2a4f8a : 0x8a2a2a, [mx, my + 0.04, -rz * 1.02]);
    }
    // scorch marks
    if (burnt >= 2) {
      b.sphere(1, SOOT, [rx * 0.4, h * 0.5, -rz * 0.98], [0.09, 0.07, 0.02]);
      b.sphere(1, SOOT, [-rx * 0.2, h * 0.25, -rz * 1.0 - P.bellyForward * 0.6], [0.07, 0.09, 0.02]);
    }
    return b.build();
  });

  // ---- head ------------------------------------------------------------------------------------------------
  const R = P.headRadius;
  attach("head", head, () => buildHead(spec, P, { skin, hairC, hatC, accent, burnt }));

  // ---- arms ------------------------------------------------------------------------------------------------------
  const armMeshes: [string, Group, Group, number][] = [
    ["L", shoulderL, elbowL, -1],
    ["R", shoulderR, elbowR, 1],
  ];
  for (const [side, shoulder, elbow] of armMeshes) {
    attach(`upperArm${side}`, shoulder, () => {
      const b = new PartBuilder();
      b.limb(P.armRadius * 1.15, P.armRadius, P.armUpper, armC);
      if (spec.jacket !== 0 && spec.jacket !== 3) b.sphere(P.armRadius * 1.4, armC, [0, 0.03, 0], [1, 0.8, 1]); // shoulder cap (clearly larger than the limb top, no coincident shells)
      return b.build();
    });
    attach(`foreArm${side}`, elbow, () => {
      const b = new PartBuilder();
      b.limb(P.armRadius, P.armRadius * 0.85, P.armLower, armC);
      // cuff + hand
      b.torus(P.armRadius * 0.9, 0.022, singe(CREAM, burnt), [0, -P.armLower + 0.02, 0], [Math.PI / 2, 0, 0]);
      b.sphere(P.handRadius, skin, [0, -P.armLower - P.handRadius * 0.7, 0], [1, 1.15, 0.8]);
      b.sphere(P.handRadius * 0.4, skin, [side === "L" ? P.handRadius * 0.7 : -P.handRadius * 0.7, -P.armLower - P.handRadius * 0.4, -P.handRadius * 0.4], [1, 1.4, 0.8]);
      return b.build();
    });
  }

  // ---- legs ---------------------------------------------------------------------------------------------------------
  const legs: [string, Group, Group, number][] = [
    ["L", hipL, kneeL, 1],
    ["R", hipR, kneeR, 2],
  ];
  for (const [side, hip, knee, woodId] of legs) {
    const wooden = spec.woodenLeg === woodId;
    attach(`upperLeg${side}`, hip, () => {
      const b = new PartBuilder();
      const stripe = spec.trousers === 1;
      const r = spec.trousers === 3 ? 0.14 * P.scale + 0.02 : 0.11 * P.scale + 0.02;
      b.limb(r * 1.15, r, P.legUpper, trouserC);
      if (stripe) b.box(0.012, P.legUpper * 0.95, 0.012, singe(CREAM, burnt), [0.0, -P.legUpper / 2, -r * 1.0]);
      return b.build();
    });
    attach(`lowerLeg${side}`, knee, () => buildLowerLeg(spec, P, { trouserC, wooden, footH, burnt, accent }));
  }

  // ---- face (animated parts, separate small meshes) ---------------------------------------------------------------------
  // The merged head geometry is built around the skull centre, R above the neck joint: face parts share that origin.
  const faceRoot = new Group();
  faceRoot.name = "faceRoot";
  faceRoot.position.y = R;
  head.add(faceRoot);
  const eyeR = R * 0.17;
  const eyeX = R * 0.4;
  const eyeY = R * 0.1;
  const eyeZ = -R * 0.86;
  const whiteMat = new MeshStandardMaterial({ color: face.white, roughness: 0.35 });
  const pupilMat = new MeshStandardMaterial({ color: face.pupil, roughness: 0.2 });
  const browMat = new MeshStandardMaterial({ color: hairC, roughness: 0.9 });
  const skinMat = new MeshStandardMaterial({ color: skin, roughness: 0.75 });
  const mouthMat = new MeshStandardMaterial({ color: 0x5a1f1a, roughness: 0.6 });
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
  mouth.position.set(0, -R * 0.38, -R * 0.82);
  mouth.rotation.z = Math.PI; // smile arc opens upward by default
  faceRoot.add(mouth);
  for (const m of [browL, browR, mouth, eL.pupil, eRr.pupil, eL.lid, eRr.lid]) m.castShadow = false;

  const faceParts: FaceParts = {
    eyeL: eL.g, eyeR: eRr.g, pupilL: eL.pupil, pupilR: eRr.pupil, browL, browR, mouth, lidL: eL.lid, lidR: eRr.lid,
    eyeRadius: eyeR, mouthWidth,
  };
  const ownedGeos: BufferGeometry[] = [browGeo, mouth.geometry, eL.lid.geometry, eRr.lid.geometry];
  const ownedMats = [whiteMat, pupilMat, browMat, skinMat, mouthMat];
  eL.g.children.forEach((c) => c instanceof Mesh && ownedGeos.push(c.geometry));
  eRr.g.children.forEach((c) => c instanceof Mesh && ownedGeos.push(c.geometry));

  return {
    root,
    joints: { root, pelvis, torso, head, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR },
    face: faceParts,
    proportions: P,
    spec,
    meshCount: meshes.length + 7,
    dispose() {
      // Bone geometry belongs to the shared cache; only per-instance face parts are freed here.
      for (const g of new Set(ownedGeos)) g.dispose();
      for (const m of ownedMats) m.dispose();
      root.removeFromParent();
    },
  };
}

interface HeadColors {
  skin: number;
  hairC: number;
  hatC: number;
  accent: number;
  burnt: number;
}

function buildHead(spec: CharacterSpec, P: Proportions, c: HeadColors): BufferGeometry | undefined {
  const R = P.headRadius;
  const b = new PartBuilder();
  const { skin, hairC, hatC, accent, burnt } = c;
  const cy = R; // head centre above the neck joint
  const nose = P.noseLength;
  // skull, jaw, cheeks, neck
  b.sphere(R, skin, [0, cy, 0], [1, 1.02, 1.0]);
  b.sphere(R * 0.78 * P.jawSize ** 0.5, skin, [0, cy - R * 0.55, -R * 0.28], [1.0 * P.jawSize ** 0.4, 0.75, 0.95]);
  b.sphere(R * 0.28, skin, [-R * 0.55, cy - R * 0.25, -R * 0.55]);
  b.sphere(R * 0.28, skin, [R * 0.55, cy - R * 0.25, -R * 0.55]);
  b.cylinder(R * 0.42, R * 0.5, P.neck * 2 + 0.06, skin, [0, 0.0, 0]);
  // ears
  const es = P.earSize;
  b.sphere(es, skin, [-R * 0.98, cy, 0], [0.45, 1.25, 0.9]);
  b.sphere(es, skin, [R * 0.98, cy, 0], [0.45, 1.25, 0.9]);
  // nose
  const nz = -R * 0.95;
  const ny = cy - R * 0.24; // below the eye line so the nose never swallows the eyes
  switch (spec.noseStyle) {
    case 0: b.sphere(nose * 0.45, skin, [0, ny, nz], [1, 1, 0.9]); break; // button
    case 1: b.cone(nose * 0.32, nose * 1.4, skin, [0, ny + nose * 0.05, nz - nose * 0.4], [-Math.PI / 2 - 0.35, 0, 0]); b.sphere(nose * 0.2, skin, [0, ny - nose * 0.3, nz - nose * 0.9]); break; // hooked
    case 2: b.sphere(nose * 0.62, skin, [0, ny - nose * 0.1, nz - nose * 0.2], [1.1, 1, 1]); break; // bulb
    case 3: b.cylinder(nose * 0.2, nose * 0.32, nose * 1.8, skin, [0, ny - nose * 0.3, nz - nose * 0.4], [-Math.PI / 2 + 0.15, 0, 0]); b.sphere(nose * 0.3, skin, [0, ny - nose * 0.35, nz - nose * 1.3]); break; // long
    case 4: b.sphere(nose * 0.5, skin, [0, ny, nz + nose * 0.05], [1.5, 0.8, 0.7]); break; // flat
    default: b.sphere(nose * 0.55, singe(skin, 0), [0, ny - nose * 0.05, nz - nose * 0.15]); b.sphere(nose * 0.28, 0xc4574a, [0, ny - nose * 0.12, nz - nose * 0.55]); break; // ruddy lump
  }
  // hair (styles hug the skull)
  const hairY = cy + R * 0.1;
  switch (spec.hair) {
    case 1: b.sphere(R * 1.05, hairC, [0, hairY + R * 0.08, R * 0.05], [1, 0.72, 1.02]); b.box(R * 0.9, R * 0.08, R * 0.3, hairC, [-R * 0.25, cy + R * 0.82, -R * 0.55], [0.1, 0, 0.25]); break;
    case 2: for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; b.cone(R * 0.16, R * 0.5, hairC, [Math.cos(a) * R * 0.75, cy + R * 0.7 + (i % 2) * R * 0.1, Math.sin(a) * R * 0.75], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]); } b.sphere(R * 1.02, hairC, [0, cy + R * 0.18, R * 0.05], [1, 0.6, 1.02]); break;
    case 3: for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.sphere(R * 0.28, hairC, [Math.cos(a) * R * 0.78, cy + R * 0.58, Math.sin(a) * R * 0.78]); } b.sphere(R * 0.36, hairC, [0, cy + R * 0.95, 0]); b.sphere(R * 1.0, hairC, [0, cy + R * 0.2, R * 0.08], [1, 0.62, 1.0]); break;
    case 4: b.sphere(R * 1.03, hairC, [0, hairY + R * 0.05, R * 0.06], [1, 0.66, 1.04]); break;
    case 5: b.sphere(R * 1.0, hairC, [-R * 0.62, cy + R * 0.15, R * 0.2], [0.35, 0.55, 0.8]); b.sphere(R * 1.0, hairC, [R * 0.62, cy + R * 0.15, R * 0.2], [0.35, 0.55, 0.8]); b.sphere(R * 1.0, hairC, [0, cy + R * 0.1, R * 0.6], [0.9, 0.55, 0.4]); break;
    case 6: b.sphere(R * 1.02, hairC, [0, hairY + R * 0.05, R * 0.05], [1, 0.62, 1.0]); b.sphere(R * 0.3, hairC, [0, cy + R * 1.05, 0]); break;
    default: break; // bald
  }
  // sideburns
  const sb = [0, 0.16, 0.26, 0.32][spec.sideburns] ?? 0;
  if (sb > 0) for (const sx of [-1, 1]) b.sphere(R * sb, hairC, [sx * R * 0.9, cy - R * 0.15, -R * 0.2], [0.55, 1.6 + sb * 2, 0.8]);
  // beard
  const bz = -R * 0.55;
  switch (spec.beard) {
    case 1: b.sphere(R * 0.85, hairC, [0, cy - R * 0.7, -R * 0.35], [1.0, 0.9, 0.9]); break;
    case 2: b.sphere(R * 0.28, hairC, [0, cy - R * 0.95, bz - R * 0.25]); break;
    case 3: b.cone(R * 0.22, R * 0.55, hairC, [0, cy - R * 1.05, bz - R * 0.2], [Math.PI, 0, 0]); break;
    case 4: b.sphere(R * 0.5, hairC, [-R * 0.62, cy - R * 0.45, -R * 0.25], [0.7, 1.1, 0.9]); b.sphere(R * 0.5, hairC, [R * 0.62, cy - R * 0.45, -R * 0.25], [0.7, 1.1, 0.9]); b.sphere(R * 0.4, hairC, [0, cy - R * 0.95, -R * 0.4]); break;
    case 5: b.cone(R * 0.55, R * 0.95, hairC, [0, cy - R * 1.05, bz - R * 0.1], [Math.PI, 0, 0], [1.1, 1, 0.8]); break;
    default: break;
  }
  // moustache (sits just above the mouth)
  const my = cy - R * 0.4;
  const mz = -R * 0.9 - nose * 0.12;
  const mHair = hairC;
  switch (spec.moustache) {
    case 1: for (const sx of [-1, 1]) { b.cylinder(R * 0.06, R * 0.04, R * 0.55, mHair, [sx * R * 0.3, my, mz], [0, 0, Math.PI / 2]); b.torus(R * 0.12, R * 0.035, mHair, [sx * R * 0.62, my + R * 0.1, mz], [0, 0, sx > 0 ? 0 : Math.PI], [1, 1, 1], Math.PI * 1.4); } break;
    case 2: for (const sx of [-1, 1]) b.sphere(R * 0.3, mHair, [sx * R * 0.24, my - R * 0.05, mz], [1.15, 0.9, 0.6]), b.sphere(R * 0.16, mHair, [sx * R * 0.44, my - R * 0.24, mz + 0.01], [0.7, 1.4, 0.6]); break;
    case 3: b.box(R * 0.6, R * 0.05, R * 0.06, mHair, [0, my + R * 0.03, mz]); break;
    case 4: b.box(R * 0.24, R * 0.09, R * 0.07, mHair, [0, my + R * 0.02, mz]); break;
    case 5: for (const sx of [-1, 1]) { b.sphere(R * 0.16, mHair, [sx * R * 0.18, my, mz], [1.2, 0.7, 0.6]); b.cone(R * 0.05, R * 0.4, mHair, [sx * R * 0.55, my + R * 0.1, mz], [0, 0, -sx * (Math.PI / 2 - 0.5)]); } break;
    case 6: b.box(R * 0.55, R * 0.08, R * 0.07, mHair, [0, my, mz]); for (const sx of [-1, 1]) b.box(R * 0.07, R * 0.45, R * 0.07, mHair, [sx * R * 0.3, my - R * 0.24, mz]); break;
    case 7: for (let i = -3; i <= 3; i++) b.sphere(R * 0.11, mHair, [i * R * 0.13, my - Math.abs(i) * R * 0.01, mz], [0.8, 1.6, 0.6]); break;
    default: break;
  }
  // eyewear
  const ey = cy + R * 0.1;
  const ex = R * 0.4;
  const ez = -R * 0.98;
  switch (spec.eyewear) {
    case 1: b.torus(R * 0.24, R * 0.02, accent, [ex, ey, ez], [0, 0, 0]); b.cylinder(0.004, 0.004, R * 0.9, accent, [ex + R * 0.14, ey - R * 0.5, ez + 0.02], [0, 0, 0.2]); break;
    case 2: for (const sx of [-1, 1]) b.torus(R * 0.22, R * 0.02, 0x2a2018, [sx * ex, ey, ez]); b.box(R * 0.2, R * 0.03, R * 0.03, 0x2a2018, [0, ey, ez]); for (const sx of [-1, 1]) b.box(R * 0.03, R * 0.03, R * 0.95, 0x2a2018, [sx * R * 0.83, ey, ez + R * 0.5]); break;
    case 3: for (const sx of [-1, 1]) b.cylinder(R * 0.26, R * 0.26, R * 0.16, 0x4a3a2a, [sx * ex, ey, ez - 0.005], [Math.PI / 2, 0, 0]); b.torus(R * 1.0, R * 0.05, LEATHER, [0, ey, 0], [Math.PI / 2, 0, 0]); break;
    case 4: for (const sx of [-1, 1]) b.torus(R * 0.14, R * 0.015, accent, [sx * R * 0.2, ey - R * 0.14, ez - R * 0.02]); b.box(R * 0.14, R * 0.02, R * 0.02, accent, [0, ey - R * 0.1, ez - R * 0.02]); break;
    default: break;
  }
  // eyepatch (over the socket, with a band around the head)
  if (spec.eyepatch > 0) {
    const sx = spec.eyepatch === 1 ? -1 : 1;
    b.sphere(R * 0.27, 0x14100c, [sx * ex, ey, ez + R * 0.02], [1, 1, 0.35]);
    b.torus(R * 1.0, R * 0.025, 0x14100c, [0, ey + R * 0.08, 0], [Math.PI / 2 + 0.25 * sx, 0.1 * sx, 0]);
  }
  // scars (thin raised welts)
  const sc = spec.scars;
  const scarC = 0x9a4a4a;
  if (sc & 1) b.box(R * 0.35, R * 0.03, R * 0.03, scarC, [R * 0.62, cy - R * 0.28, -R * 0.72], [0, 0.6, -0.5]);
  if (sc & 2) b.box(R * 0.03, R * 0.3, R * 0.03, scarC, [-R * 0.38, cy + R * 0.42, -R * 0.9], [0, 0, 0.2]);
  if (sc & 4) b.box(R * 0.25, R * 0.03, R * 0.03, scarC, [-R * 0.1, cy - R * 0.88, -R * 0.6], [0.5, 0, 0.3]);
  if (sc & 8) b.box(R * 0.4, R * 0.03, R * 0.03, scarC, [0, -R * 0.1, -R * 0.4], [0, 0, 0.5]);
  if (sc & 16) b.box(R * 0.4, R * 0.03, R * 0.03, scarC, [R * 0.1, cy + R * 0.7, -R * 0.68], [0.3, 0, -0.2]);
  // hats
  const hy = cy + R * 0.78;
  switch (spec.hat) {
    case 1: b.cylinder(R * 0.62, R * 0.66, R * 1.05, hatC, [0, hy + R * 0.5, 0]); b.cylinder(R * 1.05, R * 1.05, R * 0.06, hatC, [0, hy - R * 0.02, 0]); b.torus(R * 0.64, R * 0.035, accent, [0, hy + R * 0.12, 0], [Math.PI / 2, 0, 0]); break;
    case 2: b.sphere(R * 0.78, hatC, [0, hy + R * 0.05, 0], [1, 0.85, 1], [0, 0, 0]); b.cylinder(R * 1.0, R * 1.0, R * 0.05, hatC, [0, hy - R * 0.08, 0]); break;
    case 3: b.sphere(R * 1.12, hatC, [0, hy + R * 0.02, 0], [1, 0.62, 1.05]); b.cylinder(R * 1.28, R * 1.28, R * 0.05, hatC, [0, hy - R * 0.14, 0]); b.sphere(R * 0.1, accent, [0, hy + R * 0.66, 0]); break;
    case 4: b.cylinder(R * 0.7, R * 0.85, R * 1.15, hatC, [0, hy + R * 0.5, 0]); b.box(R * 1.0, R * 0.05, R * 0.6, hatC, [0, hy - R * 0.02, -R * 0.75]); b.cone(R * 0.16, R * 0.7, singe(0xd9d0b8, burnt), [0, hy + R * 1.3, 0]); break;
    case 5: b.sphere(R * 1.0, hatC, [0, hy + R * 0.2, 0], [1.8, 0.5, 0.8], [0, 0, 0.06]); b.sphere(R * 0.14, accent, [R * 1.2, hy + R * 0.25, 0]); break;
    case 6: b.sphere(R * 0.88, hatC, [0, hy + R * 0.18, 0], [1, 0.62, 1]); b.cylinder(R * 1.55, R * 1.55, R * 0.04, hatC, [0, hy - R * 0.06, 0], [0.12, 0, 0.06]); break;
    case 7: b.cylinder(R * 0.95, R * 1.0, R * 0.36, hatC, [0, hy + R * 0.05, 0]); b.box(R * 1.0, R * 0.04, R * 0.45, LEATHER, [0, hy - R * 0.1, -R * 0.95]); b.sphere(R * 0.1, accent, [0, hy + R * 0.02, -R * 0.98]); break;
    default: break;
  }
  return b.build();
}

interface LegOpts {
  trouserC: number;
  wooden: boolean;
  footH: number;
  burnt: number;
  accent: number;
}

function buildLowerLeg(spec: CharacterSpec, P: Proportions, o: LegOpts): BufferGeometry | undefined {
  const b = new PartBuilder();
  const r = (spec.trousers === 3 ? 0.14 : 0.11) * P.scale + 0.02;
  const len = P.legLower;
  if (o.wooden) {
    b.cylinder(r * 0.55, r * 0.35, len + o.footH, WOOD, [0, -(len + o.footH) / 2, 0]);
    b.cylinder(r * 0.6, r * 0.6, 0.05, LEATHER, [0, -0.03, 0]); // leather cup at the knee
    b.cylinder(r * 0.5, r * 0.5, 0.03, 0x555555, [0, -(len + o.footH) + 0.02, 0]); // iron ferrule
    return b.build();
  }
  const bootTall = spec.boots === 0;
  const leather = singe(LEATHER, o.burnt);
  if (spec.trousers === 2) {
    // breeches: legs end at the knee, socks/boots below
    b.limb(r, r * 0.8, len * 0.25, o.trouserC);
    b.limb(r * 0.8, r * 0.75, len, bootTall ? leather : singe(0xd9d0b8, o.burnt), [0, -len * 0.05, 0]);
  } else {
    b.limb(r, r * 0.85, len, o.trouserC);
    if (bootTall) b.cylinder(r * 0.98, r * 0.86, len * 0.62, leather, [0, -len * 0.7, 0]);
  }
  if (spec.trousers === 1) b.box(0.012, len * 0.95, 0.012, singe(CREAM, o.burnt), [0, -len / 2, -r * 1.0]);
  // boot
  const fl = P.footLength;
  const fw = P.footWidth;
  const bootC = spec.boots === 2 ? leather : leather;
  b.sphere(1, bootC, [0, -len - o.footH * 0.4, -fl * 0.22], [fw, o.footH * 1.4 + 0.03, fl * 0.62]);
  if (spec.boots === 2) b.sphere(1, singe(0xd9d0b8, o.burnt), [0, -len + 0.03, -fl * 0.12], [fw * 0.9, 0.09, fl * 0.42]); // spats
  if (spec.boots === 3) for (let i = 0; i < 4; i++) b.sphere(0.012, 0x777777, [((i % 2) - 0.5) * fw, -len - o.footH * 1.15, -fl * (0.1 + (i >> 1) * 0.35)]); // hobnails
  if (spec.boots === 1) b.cylinder(r * 0.9, r * 0.9, 0.08, bootC, [0, -len + 0.02, 0]);
  return b.build();
}
