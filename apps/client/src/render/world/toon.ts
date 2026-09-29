import {
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshToonMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { PALETTE } from "@cb/shared";
import { WORLD_INK, instancedWorldOutline, outlineSettings, sharedToonRamp, worldOutlineMaterial, type OutlineDisplace, type WorldInkClass } from "@cb/procedural/three";

/** Time in seconds, shared by every wind-animated material. One object, updated once per frame (no allocation). */
export const worldTime = { value: 0 };

/** Up to four things that walk through the grass: (x, z, radius, strength). Written by `WorldView.setPushers`; read by every blade shader. */
export const MAX_PUSHERS = 4;
export const pushers = { value: Array.from({ length: MAX_PUSHERS }, () => new Vector4(0, 0, 1, 0)) };

/** The campfire as a light for the toon materials: position, strength (0 by day, ~1 at night) and colour. A cheap banded warm term, not a real light. */
export const fireLight = { uFirePos: { value: new Vector3(0, -100, 0) }, uFireI: { value: 0 }, uFireCol: { value: new Color(PALETTE.camp.glow) } };

// ---- wind ------------------------------------------------------------------------------------------------------------------------

export type WindKind = "none" | "tree" | "grass" | "flora" | "reed";

/** Shared GLSL: a gust field, tree sway (crowns move, trunks are stiff) and blade sway that also bends away from up to four pushers. */
const WIND_HEAD = /* glsl */ `
  uniform float uTime;
  uniform vec4 uPush[${MAX_PUSHERS}];
  float windGust(vec2 p) {
    return 0.8 + 0.2 * sin(dot(p, vec2(0.037, 0.021)) - uTime * 0.5) + 0.12 * sin(dot(p, vec2(-0.013, 0.046)) * 1.7 - uTime * 0.33);
  }
  vec3 windTree(vec3 lp, vec3 base, float sy, float flutter) {
    float ph = base.x * 0.37 + base.z * 0.53;
    float g = windGust(base.xz);
    float hw = smoothstep(2.6, 7.2, lp.y);
    hw *= hw;
    vec3 d = vec3(0.0);
    d.x = (sin(uTime * 1.05 + ph) + 0.4 * sin(uTime * 2.3 + ph * 1.7)) * 0.12;
    d.z = (cos(uTime * 0.9 + ph * 0.8) + 0.3 * sin(uTime * 2.9 + ph)) * 0.085;
    d *= hw * g * sy;
    float fl = hw * 0.05 * sy * flutter;
    d.x += sin(uTime * 3.7 + lp.x * 4.1 + lp.y * 2.3 + ph) * fl;
    d.y += sin(uTime * 3.1 + lp.z * 3.7 + lp.y * 1.9) * fl * 0.5;
    d.z += cos(uTime * 3.3 + lp.z * 4.3 + lp.x * 2.1) * fl;
    return d;
  }
  vec3 windBlade(vec3 lp, vec3 base, float k, float pushK) {
    float ph = base.x * 0.33 + base.z * 0.21;
    float g = windGust(base.xz);
    float tip = lp.y * k;
    vec3 d = vec3(0.0);
    d.x = (sin(uTime * 1.7 + ph) + 0.45 * sin(uTime * 3.1 + base.z * 0.9)) * tip * g;
    d.z = cos(uTime * 1.3 + base.x * 0.19 - base.z * 0.29) * tip * 0.6 * g;
    for (int i = 0; i < ${MAX_PUSHERS}; i++) {
      vec4 p = uPush[i];
      vec2 away = base.xz - p.xy;
      float dist = length(away);
      float f = (1.0 - smoothstep(0.15, p.z, dist)) * p.w;
      vec2 dir = away / max(dist, 0.05);
      float h = clamp(lp.y * 2.2, 0.0, 1.0);
      d.xz += dir * f * h * pushK * 0.95;
      d.y -= lp.y * f * pushK * 0.85;
    }
    return d;
  }
`;

const windApply = (kind: WindKind, fluttering: boolean): string => {
  switch (kind) {
    case "tree":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windTree(transformed, instanceMatrix[3].xyz, length(instanceMatrix[1].xyz), ${fluttering ? "1.0" : "0.0"});\n#endif`;
    case "grass":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windBlade(transformed, instanceMatrix[3].xyz, 0.26, 1.0);\n#endif`;
    case "flora":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windBlade(transformed, instanceMatrix[3].xyz, 0.2, 0.9);\n#endif`;
    case "reed":
      return `#ifdef USE_INSTANCING\n mvPosition.xyz += windBlade(transformed, instanceMatrix[3].xyz, 0.13, 0.5);\n#endif`;
    default:
      return "";
  }
};

/** The scenery outline follows the same tree sway (without the leaf flutter) so the ink stays glued to the crowns. */
export function outlineDisplace(kind: WindKind): OutlineDisplace | undefined {
  if (kind !== "tree") return undefined;
  return {
    key: "tree",
    uniforms: { uTime: worldTime, uPush: pushers },
    header: WIND_HEAD,
    apply: "#ifdef USE_INSTANCING\n local.xyz += windTree(position, instanceMatrix[3].xyz, length(instanceMatrix[1].xyz), 0.0);\n#endif",
  };
}

export interface ToonOptions {
  doubleSided?: boolean;
  wind?: WindKind;
  /** Lit by the campfire's warm term (default true). */
  fire?: boolean;
  /** The geometry carries `aTint` (0..1): only that fraction of the per-instance colour is applied (blooms tint petals, not stems). */
  tinted?: boolean;
  /** Extra fragment work on the diffuse colour, run after vertex colours are applied (terrain trail overlay). */
  colourPatch?: { key: string; uniforms: Record<string, { value: unknown }>; head: string; body: string };
}

/**
 * The scenery material: the characters' toon ramp, vertex colours (and per-instance colour when the mesh has it), optional wind with
 * pusher bend, and the campfire's warm banded light. World-space position is exported as `vWPos` (world meshes sit at the origin).
 */
export function toonMaterial(opts: ToonOptions = {}): MeshToonMaterial {
  const m = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp(), side: opts.doubleSided ? DoubleSide : undefined });
  const wind = opts.wind ?? "none";
  const fire = opts.fire ?? true;
  const patch = opts.colourPatch;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uPush = pushers;
    if (fire) Object.assign(shader.uniforms, fireLight);
    if (patch) Object.assign(shader.uniforms, patch.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WIND_HEAD}\nvarying vec3 vWPos;${opts.tinted ? "\nattribute float aTint;" : ""}`)
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        ${windApply(wind, true)}
        vWPos = mvPosition.xyz;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    if (opts.tinted) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <color_vertex>",
        `vColor = vec4(1.0);
        #ifdef USE_COLOR
          vColor.rgb *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
        #endif`,
      );
    }
    let fs = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\nvarying vec3 vWPos;\n${fire ? "uniform vec3 uFirePos; uniform float uFireI; uniform vec3 uFireCol;" : ""}\n${patch?.head ?? ""}`,
    );
    if (patch) fs = fs.replace("#include <color_fragment>", `#include <color_fragment>\n${patch.body}`);
    if (fire) {
      fs = fs.replace(
        "#include <opaque_fragment>",
        `{
          float fd = length(vWPos - uFirePos);
          float fa = uFireI * (1.0 - smoothstep(1.0, 9.5, fd));
          fa = floor(fa * 3.0 + 0.5) / 3.0;
          outgoingLight += uFireCol * fa * diffuseColor.rgb * 0.62;
        }
        #include <opaque_fragment>`,
      );
    }
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = (): string => `world|${wind}|${fire ? 1 : 0}|${opts.doubleSided ? 2 : 1}|${opts.tinted ? "t" : ""}|${patch?.key ?? ""}`;
  return m;
}

/** Shadow-pass material that sways with the trees so a crown's shadow moves with the crown. */
export function windDepthMaterial(kind: WindKind): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uPush = pushers;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${WIND_HEAD}`).replace(
      "#include <project_vertex>",
      `vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      ${windApply(kind, false)}
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  m.customProgramCacheKey = (): string => `worldDepth|${kind}`;
  return m;
}

export interface InstanceSet {
  mesh: InstancedMesh;
  hull?: InstancedMesh;
}

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
  /** Ink weight class: thinner than the characters' line, heavier for bigger things. */
  ink?: WorldInkClass;
  /** Wind the ink hull follows (trees). */
  wind?: WindKind;
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
  if (o.wind === "tree" && mesh.castShadow) mesh.customDepthMaterial = windDepthMaterial("tree");
  mesh.computeBoundingSphere(); // instances are static: real bounds keep culling honest
  if (o.wind && o.wind !== "none" && mesh.boundingSphere) mesh.boundingSphere.radius += 1.5; // sway must not pop at the frustum edge
  scene.add(mesh);
  const set: InstanceSet = { mesh };
  if (o.outline) {
    const hull = instancedWorldOutline(mesh, { thickness: WORLD_INK[o.ink ?? "medium"], displace: outlineDisplace(o.wind ?? "none") });
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
export function makeSolid(scene: Scene | Object3D, geometry: BufferGeometry, material: MeshToonMaterial, o: { name: string; outline?: boolean; ink?: WorldInkClass; hullGeometry?: BufferGeometry; castShadow?: boolean }): Mesh[] {
  const mesh = new Mesh(geometry, material);
  mesh.name = o.name;
  mesh.castShadow = o.castShadow ?? true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const out: Mesh[] = [mesh];
  if (o.outline) {
    const hull = new Mesh(o.hullGeometry ?? geometry, worldOutlineMaterial({ thickness: WORLD_INK[o.ink ?? "large"] }));
    hull.name = `${o.name}_outline`;
    scene.add(hull);
    out.push(hull);
  }
  return out;
}

/** A texture-free uniform helper: `{ value: Texture }`. */
export const textureUniform = (t: Texture): { value: Texture } => ({ value: t });

export { outlineSettings };
