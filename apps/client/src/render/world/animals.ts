import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshDepthMaterial, RGBADepthPacking, SphereGeometry, type WebGLProgramParametersWithUniforms } from "three";
import { PALETTE, animalPose, createAnimalPose, type Animal, type AnimalKind, type CollisionWorld } from "@cb/shared";
import { WORLD_INK, addOutlineNormals, instancedWorldOutline } from "@cb/procedural/three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import { composeInstance, toonMaterial } from "./toon.ts";

/**
 * The flock: sheep and goats as instanced toon animals. Their positions come from the shared pure `animalPose` (a function of the world
 * and the world clock), written into the instance matrices once a frame (a dozen matrices: nothing to speak of); their legs, bob and head
 * are animated in the vertex shader from three per-instance numbers (how fast, how far down the head is, the stride phase). Not
 * collidable, not simulated, not on the server.
 */

const W = PALETTE.world;

/** Attribute ids in the geometry: which vertices swing (legs, +1 / -1 by diagonal pair) and which follow the head. */
function tag(g: BufferGeometry, leg: number, head: number): BufferGeometry {
  const n = g.attributes.position!.count;
  g.setAttribute("aLeg", new BufferAttribute(new Float32Array(n).fill(leg), 1));
  g.setAttribute("aHead", new BufferAttribute(new Float32Array(n).fill(head), 1));
  return g;
}

const lift = (fn: ColourFn, k: number): ColourFn => (p, n, out) => {
  fn(p, n, out);
  out.multiplyScalar(k);
};

/**
 * One animal, facing +x, standing on y = 0. Two builds: the visible mesh and a slightly plainer hull. Local frame metres: a sheep is a
 * metre long and 0.7 tall; a goat is leaner, longer-legged, with horns and a beard.
 */
function animalGeometry(kind: AnimalKind, lod: 0 | 1): BufferGeometry {
  const sheep = kind === "sheep";
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
  const detail = lod ? 1 : 0;
  // body
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
  parts.push(tag(k.build()!, 0, 0));
  // legs: four, in diagonal pairs (the sign is the gait: front-left with back-right)
  const hips: [number, number, number][] = [
    [0.27, 0.13, 1],
    [0.27, -0.13, -1],
    [-0.27, 0.13, -1],
    [-0.27, -0.13, 1],
  ];
  const legs: BufferGeometry[] = [];
  for (const [x, z, s] of hips) {
    const lk = new Kit();
    lk.limb([x, legTop, z], [x + 0.01, 0, z], sheep ? 0.04 : 0.032, sheep ? 0.028 : 0.022, hideDark.getHex(), 5);
    lk.add(new CylinderGeometry(0.036, 0.04, 0.05, 5), { at: [x + 0.01, 0.025, z], colour: W.hideDark, flat: true });
    legs.push(tag(lk.build()!, s, 0));
  }
  parts.push(...legs);
  // neck and head: the head follows the neck's pivot when it lowers to graze
  const hk = new Kit();
  const neckA: V3 = [sheep ? 0.36 : 0.4, bodyY + 0.08, 0];
  const neckB: V3 = [sheep ? 0.56 : 0.6, bodyY + (sheep ? 0.12 : 0.24), 0];
  hk.limb(neckA, neckB, sheep ? 0.09 : 0.07, sheep ? 0.07 : 0.05, hide.getHex(), 6);
  hk.add(new IcosahedronGeometry(1, 0), { at: [neckB[0] + (sheep ? 0.09 : 0.1), neckB[1] - 0.02, 0], scale: sheep ? [0.14, 0.1, 0.085] : [0.14, 0.08, 0.06], colour: hide.getHex(), flat: true, jitter: 0.01, seed: 521 });
  for (const s of [-1, 1]) {
    // ears
    hk.add(new ConeGeometry(0.035, 0.11, 4), { at: [neckB[0] - 0.01, neckB[1] + 0.04, s * 0.09], rot: [s * 1.3, 0, 0.3], colour: hideDark.getHex(), flat: true });
  }
  if (!sheep) {
    for (const s of [-1, 1]) hk.add(new ConeGeometry(0.03, 0.26, 5), { at: [neckB[0] - 0.02, neckB[1] + 0.14, s * 0.045], rot: [s * 0.15, 0, -0.55], colour: W.rockPale, flat: true });
    hk.add(new ConeGeometry(0.03, 0.12, 4), { at: [neckB[0] + 0.14, neckB[1] - 0.12, 0], rot: [0, 0, 3.2], colour: W.fleeceShade, flat: true }); // beard
  } else {
    hk.add(new IcosahedronGeometry(0.1, 0), { at: [neckB[0] - 0.02, neckB[1] + 0.08, 0], colour: fleece.getHex(), flat: true, jitter: 0.02, seed: 522 }); // a woolly poll
  }
  parts.push(tag(hk.build()!, 0, 1));
  const tk = new Kit();
  tk.add(sheep ? new SphereGeometry(0.09, 5, 4) : new ConeGeometry(0.04, 0.16, 4), { at: [-0.55, bodyY + (sheep ? 0.02 : 0.1), 0], rot: [0, 0, sheep ? 0 : 0.9], colour: sheep ? fleece.getHex() : hide.getHex(), flat: true });
  parts.push(tag(tk.build()!, 0, 0));
  // merge with the shared layout (position, normal, colour, onormal + aLeg/aHead)
  return mergeAnimal(parts);
}

function mergeAnimal(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  addOutlineNormals(g);
  g.computeBoundingSphere();
  return g;
}

/**
 * The vertex animation, applied to `transformed` before instancing: legs swing about the hip by the stride phase (opposite diagonals in
 * opposition), the whole body bobs a little, and the head dips about the neck's root as the animal grazes. `aAnim` per instance:
 * x = stride speed 0..1, y = graze 0..1, z = stride phase (radians), w = unused.
 */
const ANIM_HEAD = /* glsl */ `
  attribute float aLeg; attribute float aHead; attribute vec4 aAnim;
`;
const ANIM_BODY = /* glsl */ `
  {
    float swing = aLeg * sin(aAnim.z) * aAnim.x * 0.7;
    float hip = 0.42;
    float reach = clamp(1.0 - transformed.y / hip, 0.0, 1.0);
    transformed.x += swing * reach * 0.42;
    transformed.y += abs(aLeg) * max(0.0, -swing * reach) * 0.0;
    transformed.y += abs(sin(aAnim.z)) * aAnim.x * 0.02;
    if (aHead > 0.5) {
      // dip about the neck root: rotate in the x-y plane
      vec2 pivot = vec2(0.38, 0.58);
      float ang = -aAnim.y * 1.05;
      vec2 d = transformed.xy - pivot;
      float c = cos(ang); float s = sin(ang);
      transformed.xy = pivot + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
      transformed.y -= aAnim.y * 0.03;
    }
  }
`;

interface Set {
  kind: AnimalKind;
  mesh: InstancedMesh;
  hull?: InstancedMesh;
  anim: InstancedBufferAttribute;
  animals: Animal[];
}

export interface Flock {
  sets: Set[];
  /** Repose every animal for the world clock `worldSec` and hand the meshes their matrices. Allocation-free. */
  update(worldSec: number): void;
  meshes(): InstancedMesh[];
}

/** Builds the instanced flock for an already-routed set of animals. `outlines` adds the (small) scenery ink hull. */
export function buildAnimals(animals: readonly Animal[], outlines: boolean): Flock | undefined {
  if (animals.length === 0) return undefined;
  const sets: Set[] = [];
  const mat4 = new Matrix4();
  const col = new Color();
  for (const kind of ["sheep", "goat"] as const) {
    const group = animals.filter((a) => a.kind === kind);
    if (group.length === 0) continue;
    const geo = animalGeometry(kind, 1);
    const anim = new InstancedBufferAttribute(new Float32Array(group.length * 4), 4);
    anim.setUsage(35048); // DynamicDrawUsage
    geo.setAttribute("aAnim", anim);
    const material = toonMaterial({ vertexPatch: { key: "animal", head: ANIM_HEAD, body: ANIM_BODY }, wetDark: 0.4 });
    const mesh = new InstancedMesh(geo, material, group.length);
    mesh.name = kind === "sheep" ? "sheep" : "goats";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // a dozen animals: one draw either way, and the bounds move
    mesh.customDepthMaterial = animalDepthMaterial();
    group.forEach((a, i) => {
      mesh.setMatrixAt(i, mat4.identity());
      // wool and hide vary a little from one animal to the next
      mesh.setColorAt(i, col.setRGB(0.9 + a.tone * 0.14, 0.9 + a.tone * 0.1, 0.88 + a.tone * 0.12));
    });
    let hull: InstancedMesh | undefined;
    if (outlines) {
      hull = instancedWorldOutline(mesh, { thickness: WORLD_INK.small });
      hull.frustumCulled = false;
      hull.castShadow = false;
      hull.receiveShadow = false;
    }
    sets.push({ kind, mesh, hull, anim, animals: group });
  }
  const pose = createAnimalPose();
  return {
    sets,
    update(worldSec: number): void {
      for (const s of sets) {
        s.animals.forEach((a, i) => {
          animalPose(a, worldSec, pose);
          // model faces +x; three's rotation.y = -yaw. The stride phase runs with the distance walked.
          composeInstance(mat4, pose.x, groundAt(pose.x, pose.z), pose.z, -pose.yaw, a.size, a.size, a.size);
          s.mesh.setMatrixAt(i, mat4);
          const stride = (worldSec * 5.2 + a.seed * 40) % (Math.PI * 200);
          s.anim.setXYZW(i, pose.speed, pose.graze, stride, 0);
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
export function setAnimalGround(world: CollisionWorld): void {
  groundAt = (x, z) => world.terrainHeight(x, z);
}

function animalDepthMaterial(): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${ANIM_HEAD}`).replace("#include <begin_vertex>", `#include <begin_vertex>\n${ANIM_BODY}`);
  };
  m.customProgramCacheKey = (): string => "animalDepth";
  return m;
}
