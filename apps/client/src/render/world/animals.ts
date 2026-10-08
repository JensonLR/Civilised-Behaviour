import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshDepthMaterial, RGBADepthPacking, SphereGeometry, type WebGLProgramParametersWithUniforms } from "three";
import { PALETTE, animalPose, createAnimalPose, type Animal, type AnimalKind, type CollisionWorld, villagePlan } from "@cb/shared";
import { WORLD_INK, instancedWorldOutline, type OutlineDisplace } from "@cb/procedural/three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Kit, blend, weldedOutlineNormals, type ColourFn, type V3 } from "./kit.ts";
import { composeInstance, hullFades, toonMaterial } from "./toon.ts";

/**
 * The flock: sheep and goats as instanced toon animals. Their positions come from the shared pure `animalPose` (a function of the world
 * and the world clock), written into the instance matrices once a frame (a dozen matrices: nothing to speak of); their legs, bob and head
 * are animated in the vertex shader from three per-instance numbers (how fast, how far down the head is, the stride phase). Not
 * collidable, not simulated, not on the server.
 */

const W = PALETTE.world;

/** Attribute ids in the geometry: which vertices swing (legs, +1 / -1 by diagonal pair), which follow the head, and which species they belong to. */
function tag(g: BufferGeometry, leg: number, head: number, kind: number): BufferGeometry {
  const n = g.attributes.position!.count;
  g.setAttribute("aLeg", new BufferAttribute(new Float32Array(n).fill(leg), 1));
  g.setAttribute("aHead", new BufferAttribute(new Float32Array(n).fill(head), 1));
  g.setAttribute("aKind", new BufferAttribute(new Float32Array(n).fill(kind), 1));
  return g;
}

const lift = (fn: ColourFn, k: number): ColourFn => (p, n, out) => {
  fn(p, n, out);
  out.multiplyScalar(k);
};

/** Species ids in the shared geometry (the stag shows the deer's parts too, plus its antlers, which are tagged ANTLERS). */
export const SPECIES: Record<AnimalKind, number> = { sheep: 0, goat: 1, deer: 2, duck: 3, cat: 4, stag: 5 };
const ANTLERS = 5;

/** How far each kind's head goes down when it grazes (radians / 1.05): a duck dabbles nearly upside down, a deer browses low. */
export const DIP: Record<AnimalKind, number> = { sheep: 1, goat: 1, deer: 1.4, stag: 1.4, duck: 1.6, cat: 0.7 };

/** Four legs in diagonal pairs (the sign is the gait: front-left with back-right), each its own part so its vertices swing. */
function legsFor(parts: BufferGeometry[], kind: number, x0: number, x1: number, z: number, top: number, r0: number, r1: number, hoof: number, coat: number): void {
  const hips: [number, number, number][] = [
    [x0, z, 1],
    [x0, -z, -1],
    [x1, z, -1],
    [x1, -z, 1],
  ];
  for (const [x, zz, sgn] of hips) {
    const lk = new Kit();
    lk.limb([x, top, zz], [x + 0.01, 0, zz], r0, r1, coat, 5);
    lk.add(new CylinderGeometry(r1 + 0.008, r1 + 0.012, 0.05, 5), { at: [x + 0.01, 0.025, zz], colour: hoof, flat: true });
    parts.push(tag(lk.build()!, sgn, 0, kind));
  }
}

/** The sheep and the goat: a metre long and 0.7 tall (the goat leaner, long-legged, horned and bearded). */
function livestock(kind: "sheep" | "goat", detail: number): BufferGeometry[] {
  const sheep = kind === "sheep";
  const id = SPECIES[kind];
  const fleece = new Color(W.fleece);
  const shade = new Color(W.fleeceShade);
  const hide = new Color(sheep ? W.hideDark : W.hide);
  const hideDark = new Color(W.hideDark);
  const parts: BufferGeometry[] = [];
  const k = new Kit();
  const bodyColour: ColourFn = sheep
    ? (p, n, out) => {
        out.copy(shade).lerp(fleece, Math.min(1, Math.max(0, (n.y + 0.3) * 0.9)));
        // tufts: a few darker curls in the wool
        if (Math.sin(p.x * 23 + p.z * 17 + p.y * 11) > 0.82) out.lerp(shade, 0.4);
      }
    : (p, n, out) => {
        blend(out, W.hideDark, W.hide, Math.min(1, Math.max(0, (n.y + 0.4) * 0.8)));
        if (Math.sin(p.x * 13 + p.z * 9) > 0.7) out.lerp(fleece, 0.25);
      };
  const legTop = sheep ? 0.32 : 0.42;
  const bodyY = sheep ? 0.5 : 0.62;
  if (sheep) {
    k.add(new IcosahedronGeometry(1, detail), { at: [0, bodyY, 0], scale: [0.5, 0.34, 0.36], colour: bodyColour, flat: true, jitter: 0.05, seed: 501 });
    k.add(new IcosahedronGeometry(1, 0), { at: [-0.3, bodyY + 0.03, 0], scale: [0.27, 0.28, 0.3], colour: bodyColour, flat: true, jitter: 0.05, seed: 502 });
    k.add(new IcosahedronGeometry(1, 0), { at: [0.28, bodyY + 0.02, 0], scale: [0.25, 0.27, 0.28], colour: bodyColour, flat: true, jitter: 0.05, seed: 503 });
    k.add(new IcosahedronGeometry(1, 0), { at: [0.02, bodyY + 0.22, 0.02], scale: [0.3, 0.16, 0.24], colour: lift(bodyColour, 1.05), flat: true, jitter: 0.04, seed: 504 });
  } else {
    k.add(new IcosahedronGeometry(1, detail), { at: [0, bodyY, 0], scale: [0.5, 0.25, 0.2], colour: bodyColour, flat: true, jitter: 0.03, seed: 511 });
    k.add(new IcosahedronGeometry(1, 0), { at: [-0.32, bodyY + 0.02, 0], scale: [0.2, 0.22, 0.19], colour: bodyColour, flat: true, jitter: 0.03, seed: 512 });
    k.add(new IcosahedronGeometry(1, 0), { at: [0.3, bodyY + 0.04, 0], scale: [0.2, 0.22, 0.18], colour: bodyColour, flat: true, jitter: 0.03, seed: 513 });
  }
  parts.push(tag(k.build()!, 0, 0, id));
  legsFor(parts, id, 0.27, -0.27, 0.13, legTop, sheep ? 0.04 : 0.032, sheep ? 0.028 : 0.022, W.hideDark, hideDark.getHex());
  // neck and head: the head follows the neck's pivot when it lowers to graze
  const hk = new Kit();
  const neckA: V3 = [sheep ? 0.36 : 0.4, bodyY + 0.08, 0];
  const neckB: V3 = [sheep ? 0.56 : 0.6, bodyY + (sheep ? 0.12 : 0.24), 0];
  hk.limb(neckA, neckB, sheep ? 0.09 : 0.07, sheep ? 0.07 : 0.05, hide.getHex(), 6);
  hk.add(new IcosahedronGeometry(1, 0), { at: [neckB[0] + (sheep ? 0.09 : 0.1), neckB[1] - 0.02, 0], scale: sheep ? [0.14, 0.1, 0.085] : [0.14, 0.08, 0.06], colour: hide.getHex(), flat: true, jitter: 0.01, seed: 521 });
  for (const s of [-1, 1]) hk.add(new ConeGeometry(0.035, 0.11, 4), { at: [neckB[0] - 0.01, neckB[1] + 0.04, s * 0.09], rot: [s * 1.3, 0, 0.3], colour: hideDark.getHex(), flat: true }); // ears
  if (!sheep) {
    for (const s of [-1, 1]) hk.add(new ConeGeometry(0.03, 0.26, 5), { at: [neckB[0] - 0.02, neckB[1] + 0.14, s * 0.045], rot: [s * 0.15, 0, -0.55], colour: W.rockPale, flat: true });
    hk.add(new ConeGeometry(0.03, 0.12, 4), { at: [neckB[0] + 0.14, neckB[1] - 0.12, 0], rot: [0, 0, 3.2], colour: W.fleeceShade, flat: true }); // beard
  } else {
    hk.add(new IcosahedronGeometry(0.1, 0), { at: [neckB[0] - 0.02, neckB[1] + 0.08, 0], colour: fleece.getHex(), flat: true, jitter: 0.02, seed: 522 }); // a woolly poll
  }
  parts.push(tag(hk.build()!, 0, 1, id));
  const tk = new Kit();
  tk.add(sheep ? new SphereGeometry(0.09, 5, 4) : new ConeGeometry(0.04, 0.16, 4), { at: [-0.55, bodyY + (sheep ? 0.02 : 0.1), 0], rot: [0, 0, sheep ? 0 : 0.9], colour: sheep ? fleece.getHex() : hide.getHex(), flat: true });
  parts.push(tag(tk.build()!, 0, 0, id));
  return parts;
}

/** A roe-deer-like deer in the goat's frame (drawn at ~1.5x): long thin legs, pale belly, a cream rump patch, big ears; a stag's antlers are their own part. */
function deer(): BufferGeometry[] {
  const id = SPECIES.deer;
  const parts: BufferGeometry[] = [];
  const coat: ColourFn = (p, n, out) => {
    blend(out, W.deerBelly, W.deerCoat, Math.min(1, Math.max(0, (n.y + 0.25) * 2.2)));
    if (p.x < -0.36 && p.y > 0.55 && n.x < -0.2) out.lerp(new Color(W.deerRump), 0.85); // the rump patch
  };
  const k = new Kit();
  k.add(new IcosahedronGeometry(1, 0), { at: [0, 0.68, 0], scale: [0.5, 0.25, 0.21], colour: coat, flat: true, jitter: 0.025, seed: 601 });
  k.add(new IcosahedronGeometry(1, 0), { at: [-0.34, 0.7, 0], scale: [0.2, 0.22, 0.19], colour: coat, flat: true, jitter: 0.025, seed: 602 });
  k.add(new IcosahedronGeometry(1, 0), { at: [0.3, 0.72, 0], scale: [0.2, 0.21, 0.17], colour: coat, flat: true, jitter: 0.025, seed: 603 });
  k.add(new ConeGeometry(0.05, 0.14, 4), { at: [-0.55, 0.78, 0], rot: [0, 0, 1.9], colour: W.deerRump, flat: true }); // the little white scut
  parts.push(tag(k.build()!, 0, 0, id));
  legsFor(parts, id, 0.3, -0.3, 0.12, 0.54, 0.036, 0.02, W.hideDark, W.deerCoat);
  const hk = new Kit();
  hk.limb([0.38, 0.76, 0], [0.56, 1.04, 0], 0.08, 0.05, W.deerCoat, 6);
  hk.add(new IcosahedronGeometry(1, 0), { at: [0.66, 1.04, 0], scale: [0.14, 0.075, 0.06], colour: W.deerCoat, flat: true, jitter: 0.01, seed: 604 });
  hk.add(new IcosahedronGeometry(1, 0), { at: [0.78, 1.02, 0], scale: [0.05, 0.04, 0.04], colour: W.hideDark, flat: true }); // the nose
  for (const s of [-1, 1]) hk.add(new ConeGeometry(0.045, 0.16, 4), { at: [0.55, 1.13, s * 0.085], rot: [s * 0.9, 0, 0.35], colour: W.deerCoat, flat: true });
  parts.push(tag(hk.build()!, 0, 1, id));
  const ak = new Kit();
  for (const s of [-1, 1]) {
    // each antler: a main beam sweeping up and back, with two tines
    ak.limb([0.53, 1.1, s * 0.05], [0.44, 1.36, s * 0.15], 0.018, 0.012, W.antler, 4);
    ak.limb([0.44, 1.36, s * 0.15], [0.5, 1.56, s * 0.2], 0.012, 0.006, W.antler, 4);
    ak.limb([0.47, 1.26, s * 0.12], [0.62, 1.38, s * 0.15], 0.012, 0.006, W.antler, 4);
    ak.limb([0.44, 1.36, s * 0.15], [0.35, 1.52, s * 0.22], 0.01, 0.005, W.antler, 4);
  }
  parts.push(tag(ak.build()!, 0, 1, ANTLERS));
  return parts;
}

/** A mallard drake, floating: the body sits on the water line (y = 0), the neck and head follow the dabbling dip. Drawn at ~0.4x. */
function duck(): BufferGeometry[] {
  const id = SPECIES.duck;
  const body: ColourFn = (p, n, out) => {
    out.set(W.mallardFlank);
    if (p.x > 0.15) out.set(W.mallardBreast);
    else if (p.y > 0.42 && p.x < -0.1 && n.y > 0.3) out.set(W.mallardFlank).multiplyScalar(0.8);
    else if (p.x < -0.42) out.set(W.hideDark);
    if (n.y < -0.4) out.lerp(new Color(W.fleece), 0.6);
  };
  const k = new Kit();
  k.add(new IcosahedronGeometry(1, 1), { at: [0, 0.3, 0], scale: [0.55, 0.27, 0.3], colour: body, flat: true, jitter: 0.02, seed: 611 });
  k.add(new IcosahedronGeometry(1, 0), { at: [0.32, 0.36, 0], scale: [0.26, 0.26, 0.27], colour: body, flat: true, jitter: 0.02, seed: 612 });
  k.add(new ConeGeometry(0.11, 0.3, 4), { at: [-0.6, 0.42, 0], rot: [0, 0, 1.15], colour: W.hideDark, flat: true }); // the tail
  addWings(k);
  const parts = [tag(k.build()!, 0, 0, id)];
  const hk = new Kit();
  hk.limb([0.4, 0.48, 0], [0.5, 0.86, 0], 0.1, 0.075, W.mallardHead, 6);
  hk.add(new IcosahedronGeometry(0.13, 1), { at: [0.54, 0.95, 0], colour: W.mallardHead, flat: true, jitter: 0.01, seed: 613 });
  hk.add(new CylinderGeometry(0.078, 0.08, 0.03, 6), { at: [0.47, 0.75, 0], colour: W.fleece, flat: true }); // the white neck ring
  hk.add(new ConeGeometry(0.06, 0.2, 4), { at: [0.72, 0.92, 0], rot: [0, 0, -1.5708], scale: [1, 1, 1.9], colour: W.duckBill, flat: true }); // the bill
  parts.push(tag(hk.build()!, 0, 1, id));
  return parts;
}
function addWings(k: Kit): void {
  for (const s of [-1, 1]) k.add(new IcosahedronGeometry(1, 0), { at: [-0.05, 0.42, s * 0.22], scale: [0.36, 0.12, 0.1], rot: [s * 0.35, 0, 0.06], colour: W.mallardFlank, flat: true, jitter: 0.02, seed: 614 + s });
}

/** The village cat: a ginger tabby with cream paws, a curled tail and pricked ears, in the goat's frame (drawn at ~0.5x). */
function cat(): BufferGeometry[] {
  const id = SPECIES.cat;
  const fur: ColourFn = (p, n, out) => {
    out.set(W.catGinger);
    if (Math.sin(p.x * 26) > 0.55 && n.y > -0.1) out.multiplyScalar(0.78); // tabby stripes
    if (n.y < -0.55) out.set(W.catCream);
  };
  const k = new Kit();
  k.add(new IcosahedronGeometry(1, 0), { at: [0, 0.56, 0], scale: [0.44, 0.22, 0.18], colour: fur, flat: true, jitter: 0.02, seed: 621 });
  k.add(new IcosahedronGeometry(1, 0), { at: [-0.3, 0.55, 0], scale: [0.2, 0.22, 0.2], colour: fur, flat: true, jitter: 0.02, seed: 622 });
  // the tail: three segments curling up behind
  k.limb([-0.44, 0.6, 0], [-0.7, 0.66, 0], 0.05, 0.04, W.catGinger, 5);
  k.limb([-0.7, 0.66, 0], [-0.86, 0.9, 0], 0.04, 0.035, W.catGinger, 5);
  k.limb([-0.86, 0.9, 0], [-0.8, 1.08, 0], 0.035, 0.03, W.catCream, 5);
  const parts = [tag(k.build()!, 0, 0, id)];
  legsFor(parts, id, 0.28, -0.26, 0.11, 0.4, 0.05, 0.035, W.catCream, W.catGinger);
  const hk = new Kit();
  hk.limb([0.36, 0.62, 0], [0.5, 0.78, 0], 0.11, 0.09, W.catGinger, 6);
  hk.add(new IcosahedronGeometry(1, 0), { at: [0.6, 0.8, 0], scale: [0.15, 0.13, 0.15], colour: fur, flat: true, jitter: 0.015, seed: 623 });
  for (const s of [-1, 1]) hk.add(new ConeGeometry(0.06, 0.13, 3), { at: [0.57, 0.95, s * 0.085], rot: [s * 0.25, 0, 0], colour: W.catGinger, flat: true });
  hk.add(new IcosahedronGeometry(1, 0), { at: [0.74, 0.77, 0], scale: [0.04, 0.03, 0.04], colour: W.catCream, flat: true }); // the muzzle
  parts.push(tag(hk.build()!, 0, 1, id));
  return parts;
}

/** All the species of a group in ONE geometry (a vertex collapses to nothing when its `aKind` is not the instance's `aSpec`): one draw for the lot. */
function groupGeometry(kinds: readonly AnimalKind[], lod: 0 | 1): BufferGeometry {
  const detail = lod ? 1 : 0;
  const parts: BufferGeometry[] = [];
  for (const kind of kinds) {
    if (kind === "sheep" || kind === "goat") parts.push(...livestock(kind, detail));
    else if (kind === "deer") parts.push(...deer());
    else if (kind === "duck") parts.push(...duck());
    else if (kind === "cat") parts.push(...cat());
  }
  return mergeAnimal(parts);
}

function mergeAnimal(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  weldedOutlineNormals(g);
  g.computeBoundingSphere();
  return g;
}

/**
 * The vertex animation, applied to `transformed` before instancing. A vertex whose species is not the instance's collapses to nothing (so
 * one geometry carries every species of a group). Otherwise: legs swing about the hip by the stride phase (opposite diagonals in
 * opposition), the body bobs a little, the head dips about the neck's root as the animal grazes, and a curled-up sleeper squashes down.
 * `aAnim` per instance: x = stride speed 0..1, y = head dip (0..1.6), z = stride phase (radians), w = curl 0..1; `aSpec` = species id.
 */
const ANIM_HEAD = /* glsl */ `
  attribute float aLeg; attribute float aHead; attribute float aKind; attribute vec4 aAnim; attribute float aSpec;
`;
const ANIM_CORE = /* glsl */ `
  float vis = step(abs(aKind - aSpec), 0.5) + step(abs(aKind - 2.0), 0.5) * step(abs(aSpec - 5.0), 0.5);
  if (vis < 0.5) {
    transformed = vec3(0.0);
  } else {
    float swing = aLeg * sin(aAnim.z) * aAnim.x * 0.7;
    float hip = 0.42;
    float reach = clamp(1.0 - transformed.y / hip, 0.0, 1.0);
    transformed.x += swing * reach * 0.42;
    transformed.y += abs(sin(aAnim.z)) * aAnim.x * 0.02;
    if (aAnim.w > 0.001) {
      transformed.y *= 1.0 - 0.42 * aAnim.w;
      transformed.x *= 1.0 - 0.14 * aAnim.w;
      transformed.z *= 1.0 + 0.2 * aAnim.w;
    }
    if (aHead > 0.5) {
      // dip about the neck root: rotate in the x-y plane
      // (each species' neck root: the farm animals' is low, a deer's high, a duck's on the water line, a cat's between)
      vec2 pivot = vec2(0.38, 0.58);
      if (aSpec > 4.5 || (aSpec > 1.5 && aSpec < 2.5)) pivot = vec2(0.4, 0.74);
      else if (aSpec > 2.5 && aSpec < 3.5) pivot = vec2(0.4, 0.48);
      else if (aSpec > 3.5) pivot = vec2(0.36, 0.62 * (1.0 - 0.42 * aAnim.w));
      float ang = -aAnim.y * 1.05;
      vec2 d = transformed.xy - pivot;
      float c = cos(ang); float s = sin(ang);
      transformed.xy = pivot + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
      transformed.y -= aAnim.y * 0.03;
    }
  }
`;
const ANIM_BODY = ANIM_CORE;
/** The same pose for the ink hull, which works on the local position before the instance matrix. */
const ANIM_HULL: OutlineDisplace = {
  key: "animal",
  uniforms: {},
  header: "attribute float aLeg; attribute float aHead; attribute float aKind; attribute vec4 aAnim; attribute float aSpec;",
  apply: "",
  pre: `{ vec3 transformed = local.xyz; ${ANIM_CORE} local.xyz = transformed; }`,
};

/** Which species share a draw: the farm animals in one mesh, the wild ones and the cat in another. */
const GROUPS: readonly { name: string; kinds: readonly AnimalKind[] }[] = [
  { name: "livestock", kinds: ["sheep", "goat"] },
  { name: "wildlife", kinds: ["deer", "duck", "cat"] },
];

interface Set {
  name: string;
  kinds: readonly AnimalKind[];
  mesh: InstancedMesh;
  hull?: InstancedMesh;
  anim: InstancedBufferAttribute;
  animals: Animal[];
}

export interface Flock {
  sets: Set[];
  /** Repose every animal for the world clock `worldSec` (and the time of day, which puts the cat to bed) and hand the meshes their matrices. Allocation-free. */
  update(worldSec: number, hours?: number): void;
  meshes(): InstancedMesh[];
}

/** Builds the instanced animals for an already-routed set of animals: one mesh per group of species. `outlines` adds the (small) scenery ink hull. */
export function buildAnimals(animals: readonly Animal[], outlines: boolean): Flock | undefined {
  if (animals.length === 0) return undefined;
  const sets: Set[] = [];
  const mat4 = new Matrix4();
  const col = new Color();
  for (const g of GROUPS) {
    const group = animals.filter((a) => (g.kinds as readonly string[]).includes(a.kind === "stag" ? "deer" : a.kind));
    if (group.length === 0) continue;
    const kinds = g.kinds.filter((k) => group.some((a) => (a.kind === "stag" ? "deer" : a.kind) === k));
    const geo = groupGeometry(kinds, 1);
    const anim = new InstancedBufferAttribute(new Float32Array(group.length * 4), 4);
    anim.setUsage(35048); // DynamicDrawUsage
    geo.setAttribute("aAnim", anim);
    const spec = new InstancedBufferAttribute(new Float32Array(group.length), 1);
    group.forEach((a, i) => spec.setX(i, SPECIES[a.kind]));
    geo.setAttribute("aSpec", spec);
    const material = toonMaterial({ vertexPatch: { key: "animal", head: ANIM_HEAD, body: ANIM_BODY }, wetDark: 0.4 });
    const mesh = new InstancedMesh(geo, material, group.length);
    mesh.name = g.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // a couple of dozen animals: one draw either way, and the bounds move
    mesh.customDepthMaterial = animalDepthMaterial();
    group.forEach((a, i) => {
      mesh.setMatrixAt(i, mat4.identity());
      // coats and wool vary a little from one animal to the next
      mesh.setColorAt(i, col.setRGB(0.9 + a.tone * 0.14, 0.9 + a.tone * 0.1, 0.88 + a.tone * 0.12));
    });
    let hull: InstancedMesh | undefined;
    if (outlines) {
      hull = instancedWorldOutline(mesh, { thickness: WORLD_INK.small, displace: ANIM_HULL, fade: hullFades(material) });
      hull.frustumCulled = false;
      hull.castShadow = false;
      hull.receiveShadow = false;
    }
    sets.push({ name: g.name, kinds, mesh, hull, anim, animals: group });
  }
  const pose = createAnimalPose();
  return {
    sets,
    update(worldSec: number, hours = 12): void {
      for (const s of sets) {
        s.animals.forEach((a, i) => {
          animalPose(a, worldSec, pose, hours);
          // model faces +x; three's rotation.y = -yaw. Ducks ride the water line (the pond's surface, not the bed under it).
          composeInstance(mat4, pose.x, a.kind === "duck" ? waterAt(pose.x, pose.z) : groundAt(pose.x, pose.z), pose.z, -pose.yaw, a.size, a.size, a.size);
          s.mesh.setMatrixAt(i, mat4);
          // the stride phase runs with the distance walked; a swimming duck paddles no legs, so its phase only drives the bob
          const stride = (worldSec * 5.2 + a.seed * 40) % (Math.PI * 200);
          s.anim.setXYZW(i, pose.speed, pose.graze * DIP[a.kind], stride, pose.curl);
        });
        s.mesh.instanceMatrix.needsUpdate = true;
        s.anim.needsUpdate = true;
      }
    },
    meshes: () => sets.flatMap((s) => (s.hull ? [s.mesh, s.hull] : [s.mesh])),
  };
}

// The ground under an animal is set by whoever owns the terrain: `setGround` is called once at build.
let groundAt = (_x: number, _z: number): number => 0;
let waterAt = (_x: number, _z: number): number => 0;
export function setAnimalGround(world: CollisionWorld): void {
  groundAt = (x, z) => world.terrainHeight(x, z);
  const surface = villagePlan(world.terrain).jetty.waterY; // the pond's surface (the same number the punt and the jetty piles use)
  waterAt = () => surface;
}

function animalDepthMaterial(): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${ANIM_HEAD}`).replace("#include <begin_vertex>", `#include <begin_vertex>\n${ANIM_BODY}`);
  };
  m.customProgramCacheKey = (): string => "animalDepth";
  return m;
}
