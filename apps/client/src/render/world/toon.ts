import {
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type Scene,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { instancedOutline, outlineMaterial, sharedToonRamp } from "@cb/procedural/three";

/** Time in seconds, shared by every wind-animated material. One object, updated once per frame (no allocation). */
export const worldTime = { value: 0 };

/** The scenery material: the characters' toon ramp, vertex colours (and per-instance colour when the mesh has it). */
export function toonMaterial(opts: { doubleSided?: boolean; wind?: number } = {}): MeshToonMaterial {
  const m = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp(), side: opts.doubleSided ? DoubleSide : undefined });
  if (opts.wind) windify(m, opts.wind);
  return m;
}

/**
 * Gentle wind for grass and flowers: tips (local y) sway with a phase taken from the instance's world position, so a meadow
 * ripples instead of nodding in unison. Vertex-only, no textures, cheap enough for thousands of instances.
 */
export function windify(m: MeshToonMaterial, strength: number): void {
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = worldTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 wp = vec2(0.0);
        #endif
        float tipK = position.y * ${strength.toFixed(3)};
        transformed.x += (sin(uTime * 1.7 + wp.x * 0.33 + wp.y * 0.21) + 0.45 * sin(uTime * 3.1 + wp.y * 0.9)) * tipK;
        transformed.z += cos(uTime * 1.3 + wp.x * 0.19 - wp.y * 0.29) * tipK * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => `wind${strength}`;
}

export interface InstanceSet {
  mesh: InstancedMesh;
  hull?: InstancedMesh;
}

const m4 = new Matrix4();
const qt = new Quaternion();
const sc = new Vector3();
const ps = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const tmpEuler = new Euler();
const tmpQ = new Quaternion();

/** Writes an instance matrix from a position, a yaw about Y, a small tilt (radians, about X then Z) and a scale. Allocation-free. */
export function composeInstance(out: Matrix4, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tiltX = 0, tiltZ = 0): Matrix4 {
  qt.setFromAxisAngle(yAxis, yaw);
  if (tiltX !== 0 || tiltZ !== 0) {
    const e = tmpEuler.set(tiltX, 0, tiltZ);
    qt.multiply(tmpQ.setFromEuler(e));
  }
  return out.compose(ps.set(x, y, z), qt, sc.set(sx, sy, sz));
}

export interface InstanceOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Draw the ink hull too (medium/high presets). The hull shares the instance buffer, so it costs one draw for all instances. */
  outline?: boolean;
  /** Hull geometry when a cheaper one exists (coarser lobes); must have the same vertex layout only in that it carries `onormal`. */
  hullGeometry?: BufferGeometry;
  name: string;
}

/** Builds an InstancedMesh (+ ink hull) from prepared matrices and optional per-instance colours. */
export function makeInstances(
  scene: Scene | Object3D,
  geometry: BufferGeometry,
  material: MeshToonMaterial,
  matrices: readonly Matrix4[],
  colours: readonly Color[] | undefined,
  o: InstanceOptions,
): InstanceSet | undefined {
  if (matrices.length === 0) return undefined;
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  mesh.name = o.name;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  if (colours) colours.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = o.castShadow ?? false;
  mesh.receiveShadow = o.receiveShadow ?? true;
  mesh.computeBoundingSphere(); // instances are static: real bounds keep culling honest
  scene.add(mesh);
  const set: InstanceSet = { mesh };
  if (o.outline) {
    const hull = instancedOutline(mesh);
    if (o.hullGeometry) hull.geometry = o.hullGeometry;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.boundingSphere = mesh.boundingSphere;
    scene.add(hull);
    set.hull = hull;
  }
  return set;
}

/** A single (non-instanced) mesh with its ink hull as a sibling. */
export function makeSolid(scene: Scene | Object3D, geometry: BufferGeometry, material: MeshToonMaterial, o: { name: string; outline?: boolean; hullGeometry?: BufferGeometry; castShadow?: boolean }): Mesh[] {
  const mesh = new Mesh(geometry, material);
  mesh.name = o.name;
  mesh.castShadow = o.castShadow ?? true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const out: Mesh[] = [mesh];
  if (o.outline) {
    const hull = new Mesh(o.hullGeometry ?? geometry, outlineMaterial());
    hull.name = `${o.name}_outline`;
    scene.add(hull);
    out.push(hull);
  }
  return out;
}
