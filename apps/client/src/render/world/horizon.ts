import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  IcosahedronGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARENA_RADIUS, PALETTE, Rng, groundColour, valueNoise, type Rgb } from "@cb/shared";
import { composeInstance } from "./toon.ts";

/**
 * The country beyond the arena: three low-poly hill rings that grow paler and hazier with distance, a tree line of tiny conifer and
 * broadleaf silhouettes on the wooded shoulders, and a ground skirt that carries the meadow out to the horizon where fog dissolves
 * it. The hills are unlit by the scene's lights: a small shader lights their facets in three steps from the sun's CURRENT direction
 * and blends toward the fog colour by a per-vertex haze, so the day cycle can tint them without rebuilding anything.
 */

export interface RingSpec {
  radius: number;
  width: number;
  height: number;
  haze: number;
  segments: number;
  colour: number;
  seed: number;
  /** Tree height range on this ring (metres): bigger with distance so silhouettes keep their angular size. */
  tree: readonly [number, number];
}

export const HILL_RINGS: readonly RingSpec[] = [
  { radius: 150, width: 38, height: 24, haze: 0.2, segments: 56, colour: PALETTE.world.hillNear, seed: 3, tree: [9, 15] },
  { radius: 236, width: 64, height: 54, haze: 0.42, segments: 64, colour: PALETTE.world.hillMid, seed: 5, tree: [13, 22] },
  { radius: 332, width: 96, height: 96, haze: 0.66, segments: 72, colour: PALETTE.world.hillFar, seed: 7, tree: [22, 36] },
];

const FOOT = -12;

/** Crest height (0..1) at an angle: broad swells plus sharper peaks, periodic round the circle. */
export function ridge(seed: number, theta: number): number {
  const x = Math.cos(theta);
  const z = Math.sin(theta);
  return 0.18 + 0.55 * valueNoise(seed, x * 2.6 + 9, z * 2.6 + 9) + 0.27 * valueNoise(seed + 1, x * 7 + 3, z * 7 + 3);
}

/** Uniforms shared by the hill and tree-line shaders; the day cycle writes them once a frame. */
export interface HillUniforms {
  uFog: { value: Color };
  uSunDir: { value: Vector3 };
  uTint: { value: Color };
}

export function createHillUniforms(sun: Vector3): HillUniforms {
  return { uFog: { value: new Color() }, uSunDir: { value: sun.clone().normalize() }, uTint: { value: new Color(1, 1, 1) } };
}

const HILL_VERT = /* glsl */ `
  attribute vec3 aCol;
  attribute float aHaze;
  uniform vec3 uFog; uniform vec3 uSunDir; uniform vec3 uTint;
  varying vec3 vCol;
  void main() {
    vec3 n = normal;
    float lit = clamp(dot(n, uSunDir), 0.0, 1.0);
    float stepK = lit > 0.62 ? 1.24 : (lit > 0.3 ? 1.0 : 0.78);
    vCol = mix(aCol * stepK * uTint, uFog, aHaze);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const HILL_FRAG = /* glsl */ `
  varying vec3 vCol;
  void main() {
    gl_FragColor = vec4(vCol, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function hillMaterial(u: HillUniforms): ShaderMaterial {
  return new ShaderMaterial({ uniforms: u as unknown as Record<string, { value: unknown }>, vertexShader: HILL_VERT, fragmentShader: HILL_FRAG, side: DoubleSide, fog: false });
}

interface RingCell {
  p: Vector3[]; // 4 corners
  tint: number[];
}

/** All rings merged into one flat-faceted geometry: position, face normal, unhazed colour and haze. */
export function buildHills(): { geometry: BufferGeometry; slopes: { ring: RingSpec; tri: [Vector3, Vector3, Vector3]; j: number }[] } {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const haze: number[] = [];
  const slopes: { ring: RingSpec; tri: [Vector3, Vector3, Vector3]; j: number }[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const base = new Color();
  const tmp = new Color();
  const forest = new Color(PALETTE.world.crownDeep);
  for (const ring of HILL_RINGS) {
    const rng = new Rng(ring.seed * 977);
    base.set(ring.colour);
    const cols: { rows: [number, number, number][]; tint: number[] }[] = [];
    for (let k = 0; k < ring.segments; k++) {
      const theta = ((k + rng.range(-0.3, 0.3)) / ring.segments) * Math.PI * 2;
      const H = ring.height * ridge(ring.seed, theta) * rng.range(0.85, 1.12);
      const foothill = H * rng.range(0.28, 0.5);
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      // cross-section: inner foot, foothill shoulder, crest, outer foot (radius, y)
      const prof: [number, number][] = [
        [ring.radius - ring.width, FOOT],
        [ring.radius - ring.width * rng.range(0.35, 0.6), foothill],
        [ring.radius + rng.range(-4, 4), H],
        [ring.radius + ring.width * 0.8, FOOT],
      ];
      // the foothill shoulder is wooded: tinted toward the trees' deep green, less so on the far rings
      cols.push({ rows: prof.map(([r, y]) => [cx * r, y, cz * r] as [number, number, number]), tint: [0, 0.4 * (1 - ring.haze), 0.1, 0] });
    }
    for (let k = 0; k < ring.segments; k++) {
      const p = cols[k]!.rows;
      const q = cols[(k + 1) % ring.segments]!.rows;
      const pt = cols[k]!.tint;
      const qt = cols[(k + 1) % ring.segments]!.tint;
      for (let j = 0; j < 3; j++) {
        const quad = [p[j]!, q[j]!, q[j + 1]!, p[j + 1]!];
        const quadTint = [pt[j]!, qt[j]!, qt[j + 1]!, pt[j + 1]!];
        for (const tri of [[0, 1, 2], [0, 2, 3]] as const) {
          const tints = [quadTint[tri[0]]!, quadTint[tri[1]]!, quadTint[tri[2]]!];
          a.set(...quad[tri[0]]!);
          b.set(...quad[tri[1]]!);
          c.set(...quad[tri[2]]!);
          n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
          if (n.y < 0) n.negate(); // faces are seen from inside the ring: light them by their upward side
          let vi = 0;
          for (const v of [a, b, c]) {
            const hazeY = ring.haze + (1 - Math.min(1, Math.max(0, (v.y - FOOT) / (ring.height * 0.6 - FOOT)))) * 0.42;
            tmp.copy(base).lerp(forest, tints[vi++]!);
            pos.push(v.x, v.y, v.z);
            nor.push(n.x, n.y, n.z);
            col.push(tmp.r, tmp.g, tmp.b);
            haze.push(Math.min(0.95, hazeY));
          }
          if (j < 2) slopes.push({ ring, tri: [a.clone(), b.clone(), c.clone()], j });
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("aCol", new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute("aHaze", new BufferAttribute(new Float32Array(haze), 1));
  g.computeBoundingSphere();
  return { geometry: g, slopes };
}

// ---- the tree line -----------------------------------------------------------------------------------------------------------------

/** A two-tier conifer, five-sided (10 triangles), height 1, radius ~0.28: normals point outward so the hill shader lights it. */
export function coniferGeometry(): BufferGeometry {
  const lower = new ConeGeometry(0.34, 0.62, 5, 1, true);
  lower.translate(0, 0.31, 0);
  const upper = new ConeGeometry(0.23, 0.56, 5, 1, true);
  upper.translate(0, 0.72, 0);
  const g = mergeGeometries([lower, upper].map((x) => (x.index ? x.toNonIndexed() : x)), false)!;
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

/** A far broadleaf: a short trunk under a faceted round crown (about 26 triangles), height 1. */
export function roundCrownGeometry(): BufferGeometry {
  const crown = new IcosahedronGeometry(0.42, 0).toNonIndexed();
  crown.scale(1, 0.86, 1);
  crown.translate(0, 0.62, 0);
  const trunk = new ConeGeometry(0.07, 0.4, 3, 1, true).toNonIndexed();
  trunk.translate(0, 0.2, 0);
  const g = mergeGeometries([crown, trunk], false)!;
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

export interface TreeLine {
  conifers: InstancedMesh;
  rounds: InstancedMesh;
}

/**
 * Scatters small tree silhouettes on the hill rings' wooded shoulders (denser low, thinning toward the crest, in clumps), coloured
 * from the hill palette and hazed like the hill under them. `count` is the total across all rings; 0 builds nothing.
 */
export function buildTreeLine(hills: { slopes: { ring: RingSpec; tri: [Vector3, Vector3, Vector3]; j: number }[] }, material: ShaderMaterial, count: number): TreeLine | undefined {
  if (count <= 0) return undefined;
  const rng = new Rng(0x7ee1);
  const shoulder = hills.slopes.filter((s) => s.j === 0 || s.j === 1);
  const cM: Matrix4[] = [];
  const cC: Color[] = [];
  const cH: number[] = [];
  const rM: Matrix4[] = [];
  const rC: Color[] = [];
  const rH: number[] = [];
  const deep = new Color(PALETTE.world.hillTree);
  const light = new Color(PALETTE.world.hillTreeLight);
  const dry = new Color(PALETTE.world.hillTreeDry);
  const p = new Vector3();
  for (let tries = 0; cM.length + rM.length < count && tries < count * 6; tries++) {
    const s = shoulder[Math.floor(rng.next() * shoulder.length)]!;
    let u = rng.next();
    let v = rng.next();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    p.copy(s.tri[0]).multiplyScalar(1 - u - v).addScaledVector(s.tri[1], u).addScaledVector(s.tri[2], v);
    const ring = s.ring;
    const frac = (p.y - FOOT) / (ring.height * 0.9 - FOOT); // 0 at the foot, ~1 at the crest
    if (p.y < 2) continue;
    // clumps: trees gather where a noise field is high; the wood thins out toward the crest
    const clump = valueNoise(0x51, p.x / 26, p.z / 26);
    if (rng.next() > (0.35 + clump) * (1 - frac * 0.8)) continue;
    const t = rng.next();
    const h = ring.tree[0] + (ring.tree[1] - ring.tree[0]) * t * t;
    const conifer = clump > 0.45 ? rng.next() < 0.78 : rng.next() < 0.3;
    const yaw = rng.range(0, Math.PI * 2);
    const w = h * (conifer ? 0.5 : 0.62) * rng.range(0.85, 1.2);
    const colour = deep.clone().lerp(light, rng.next() * 0.7).lerp(dry, rng.next() < 0.08 ? 0.7 : 0);
    const haze = Math.min(0.95, ring.haze + (1 - Math.min(1, Math.max(0, (p.y - FOOT) / (ring.height * 0.6 - FOOT)))) * 0.3 + 0.06);
    const m = composeInstance(new Matrix4(), p.x, p.y - h * 0.04, p.z, yaw, w, h, w);
    if (conifer) (cM.push(m), cC.push(colour), cH.push(haze));
    else (rM.push(m), rC.push(colour), rH.push(haze));
  }
  const make = (geo: BufferGeometry, mats: Matrix4[], cols: Color[], hz: number[], name: string): InstancedMesh => {
    const mesh = new InstancedMesh(geo, material, Math.max(1, mats.length));
    mesh.count = mats.length;
    mesh.name = name;
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    cols.forEach((c, i) => mesh.setColorAt(i, c));
    geo.setAttribute("aHazeI", new InstancedBufferAttribute(new Float32Array(hz.length ? hz : [0]), 1));
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  };
  return { conifers: make(coniferGeometry(), cM, cC, cH, "hill-conifers"), rounds: make(roundCrownGeometry(), rM, rC, rH, "hill-rounds") };
}

const TREE_VERT = /* glsl */ `
  attribute float aHazeI;
  uniform vec3 uFog; uniform vec3 uSunDir; uniform vec3 uTint;
  varying vec3 vCol;
  void main() {
    vec3 n = normalize(mat3(instanceMatrix) * normal);
    float lit = clamp(dot(n, uSunDir), 0.0, 1.0);
    float stepK = lit > 0.55 ? 1.22 : (lit > 0.25 ? 1.0 : 0.72);
    vec3 base = instanceColor * stepK * uTint;
    vCol = mix(base, uFog, aHazeI);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

/** Shader for the tree-line instances: same lighting and haze as the hills, per-instance colour and haze. */
export function treeLineMaterial(u: HillUniforms): ShaderMaterial {
  return new ShaderMaterial({ uniforms: u as unknown as Record<string, { value: unknown }>, vertexShader: TREE_VERT, fragmentShader: HILL_FRAG, side: DoubleSide, fog: false });
}

// ---- the skirt --------------------------------------------------------------------------------------------------------------------

/** Flat ground beyond the terrain: a disc ring from just inside the terrain's faded edge out past the farthest hills. */
export function buildSkirt(): BufferGeometry {
  const inner = ARENA_RADIUS + 24;
  const outer = 480;
  const radial = 10;
  const around = 72;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const rgb: Rgb = { r: 0, g: 0, b: 0 };
  const cc = new Color();
  const radii: number[] = [];
  for (let i = 0; i <= radial; i++) radii.push(inner * Math.pow(outer / inner, i / radial));
  const push = (r: number, th: number): void => {
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    groundColour(x, z, 0, 0, rgb);
    cc.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace);
    pos.push(x, -0.12, z);
    nor.push(0, 1, 0);
    col.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < radial; i++) {
    for (let k = 0; k < around; k++) {
      const t0 = (k / around) * Math.PI * 2;
      const t1 = ((k + 1) / around) * Math.PI * 2;
      // counter-clockwise seen from above (+y)
      push(radii[i]!, t0);
      push(radii[i + 1]!, t1);
      push(radii[i + 1]!, t0);
      push(radii[i]!, t0);
      push(radii[i]!, t1);
      push(radii[i + 1]!, t1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

export type { RingCell };
