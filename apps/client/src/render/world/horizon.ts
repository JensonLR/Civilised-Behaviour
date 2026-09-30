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
import { ARENA_RADIUS, PALETTE, Rng, autumnAt, groundColour, valueNoise, type Rgb } from "@cb/shared";
import { composeInstance } from "./toon.ts";
import { WINDMILL, windmillGeometry } from "./windmill.ts";

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

/** The far range: snowcapped peaks beyond the last ring, far enough that haze layers them. Drawn inside the hills mesh (no extra draw). */
export const RANGE = { radius: 520, width: 150, height: 215, haze: 0.5, segments: 96, seed: 11 } as const;

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
  /** Fog the WEATHER adds on top of the day's (a fog bank or a dust storm hides the hills; clear air leaves their painted haze). */
  uExtraFog: { value: number };
  /** Bark colour for the tree-line trunks. */
  uTrunk: { value: Color };
  /** The windmill on the second summit: its sails turn about this pivot and axis (`aSail` = 1 marks their vertices) at `uSailAngle` radians. */
  uSailPivot: { value: Vector3 };
  uSailAxis: { value: Vector3 };
  uSailAngle: { value: number };
}

export function createHillUniforms(sun: Vector3): HillUniforms {
  return { uFog: { value: new Color() }, uSunDir: { value: sun.clone().normalize() }, uTint: { value: new Color(1, 1, 1) }, uExtraFog: { value: 0 }, uTrunk: { value: new Color(PALETTE.world.trunk) }, uSailPivot: { value: new Vector3(0, -100, 0) }, uSailAxis: { value: new Vector3(1, 0, 0) }, uSailAngle: { value: 0 } };
}

/**
 * Atmospheric perspective for the hills and their trees, shared by both shaders. Each vertex carries a painted haze (rings grow paler
 * with distance, low slopes hazier than crests). Two corrections make it true to where you stand: near the camera the painted haze is
 * capped by the real fog at that distance, so the foot of a hill that starts at the arena's edge is as clear as the meadow beside it
 * (it used to be a flat grey band); and the weather's extra fog closes in on top, so a fog bank really does swallow them.
 */
const HAZE_GLSL = /* glsl */ `
  uniform float uExtraFog;
  float hillHaze(float painted, vec3 wp) {
    float dist = length(wp - cameraPosition);
    float real = 1.0 - exp(-pow(0.0088 * dist, 2.0));
    float h = min(painted, real * 1.3 + 0.05);
    return 1.0 - (1.0 - h) * exp(-pow(uExtraFog * dist, 2.0));
  }
`;

const HILL_VERT = /* glsl */ `
  attribute vec3 aCol;
  attribute float aHaze;
  attribute float aSail;
  uniform vec3 uFog; uniform vec3 uSunDir; uniform vec3 uTint;
  uniform vec3 uSailPivot; uniform vec3 uSailAxis; uniform float uSailAngle;
  ${HAZE_GLSL}
  varying vec3 vCol;
  vec3 sailRot(vec3 v, float ang) { float c = cos(ang); float s = sin(ang); return v * c + cross(uSailAxis, v) * s + uSailAxis * dot(uSailAxis, v) * (1.0 - c); }
  void main() {
    vec3 n = normal;
    vec3 pos = position;
    if (aSail > 0.5) {
      pos = uSailPivot + sailRot(position - uSailPivot, uSailAngle);
      n = sailRot(n, uSailAngle);
    }
    float lit = clamp(dot(n, uSunDir), 0.0, 1.0);
    float stepK = lit > 0.62 ? 1.24 : (lit > 0.3 ? 1.0 : 0.78);
    vCol = mix(aCol * stepK * uTint, uFog, hillHaze(aHaze, pos));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
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
export function buildHills(): { geometry: BufferGeometry; slopes: { ring: RingSpec; tri: [Vector3, Vector3, Vector3]; j: number }[]; summit?: { x: number; y: number; z: number; axisX: number; axisZ: number } } {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const haze: number[] = [];
  const sail: number[] = [];
  const slopes: { ring: RingSpec; tri: [Vector3, Vector3, Vector3]; j: number }[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const base = new Color();
  const tmp = new Color();
  const forest = new Color(PALETTE.world.crownDeep);
  const meadow = new Color(PALETTE.world.grass);
  HILL_RINGS.forEach((ring, ringIndex) => {
    const rng = new Rng(ring.seed * 977);
    base.set(ring.colour);
    // The innermost ring rises out of the meadow itself: its inner foot is at ground level and painted meadow green, so the arena's edge
    // melts into the hills instead of meeting a wall of grey (the other rings start far below the ground, hidden behind it).
    const meadowK = ringIndex === 0 ? [0.9, 0.35, 0, 0] : [0, 0, 0, 0];
    const footY = ringIndex === 0 ? -0.1 : FOOT;
    const cols: { rows: [number, number, number][]; tint: number[] }[] = [];
    for (let k = 0; k < ring.segments; k++) {
      const theta = ((k + rng.range(-0.3, 0.3)) / ring.segments) * Math.PI * 2;
      const H = ring.height * ridge(ring.seed, theta) * rng.range(0.85, 1.12);
      const foothill = H * rng.range(0.28, 0.5);
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      // cross-section: inner foot, foothill shoulder, crest, outer foot (radius, y)
      const prof: [number, number][] = [
        [ring.radius - ring.width, footY],
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
          const jj = tri.map((q) => j + (q >= 2 ? 1 : 0));
          for (const v of [a, b, c]) {
            const hazeY = ring.haze + (1 - Math.min(1, Math.max(0, (v.y - FOOT) / (ring.height * 0.6 - FOOT)))) * 0.42;
            tmp.copy(base).lerp(forest, tints[vi]!);
            tmp.lerp(meadow, meadowK[jj[vi]!]!);
            vi++;
            pos.push(v.x, v.y, v.z);
            nor.push(n.x, n.y, n.z);
            col.push(tmp.r, tmp.g, tmp.b);
            haze.push(Math.min(0.95, hazeY));
            sail.push(0);
          }
          if (j < 2) slopes.push({ ring, tri: [a.clone(), b.clone(), c.clone()], j });
        }
      }
    }
  });
  // ---- the far range: jagged peaks with snowfields above a snowline, hazed in layers ----
  {
    const rng = new Rng(RANGE.seed * 313);
    const rock = new Color(PALETTE.world.peakRock);
    const forestC = new Color(PALETTE.world.hillFar);
    const snow = new Color(PALETTE.world.snow);
    const shade = new Color(PALETTE.world.snowShade);
    const cols: [number, number, number][][] = [];
    const tints: number[][] = [];
    for (let k = 0; k < RANGE.segments; k++) {
      const theta = ((k + rng.range(-0.3, 0.3)) / RANGE.segments) * Math.PI * 2;
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      // ridged noise: sharp peaks and saddles
      const r1 = 1 - Math.abs(2 * valueNoise(RANGE.seed, cx * 3.4 + 9, cz * 3.4 + 9) - 1);
      const r2 = 1 - Math.abs(2 * valueNoise(RANGE.seed + 1, cx * 9 + 3, cz * 9 + 3) - 1);
      const H = RANGE.height * (0.28 + 0.5 * r1 * r1 + 0.3 * r2 * r2) * rng.range(0.85, 1.12);
      const snowline = H * rng.range(0.5, 0.62);
      const rad = RANGE.radius + rng.range(-10, 10);
      cols.push([
        [cx * (RANGE.radius - RANGE.width), FOOT, cz * (RANGE.radius - RANGE.width)],
        [cx * (rad - RANGE.width * 0.42), H * 0.34, cz * (rad - RANGE.width * 0.42)],
        [cx * (rad - RANGE.width * 0.16), snowline, cz * (rad - RANGE.width * 0.16)],
        [cx * rad, H, cz * rad],
        [cx * (RANGE.radius + RANGE.width * 0.7), FOOT, cz * (RANGE.radius + RANGE.width * 0.7)],
      ]);
      tints.push([0, 0.5, 0.15, 1, 0]);
    }
    for (let k = 0; k < RANGE.segments; k++) {
      const p = cols[k]!;
      const q = cols[(k + 1) % RANGE.segments]!;
      const pt = tints[k]!;
      const qt = tints[(k + 1) % RANGE.segments]!;
      for (let j = 0; j < 4; j++) {
        const quad = [p[j]!, q[j]!, q[j + 1]!, p[j + 1]!];
        const quadTint = [pt[j]!, qt[j]!, qt[j + 1]!, pt[j + 1]!];
        for (const tri of [[0, 1, 2], [0, 2, 3]] as const) {
          a.set(...quad[tri[0]]!);
          b.set(...quad[tri[1]]!);
          c.set(...quad[tri[2]]!);
          n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
          if (n.y < 0) n.negate();
          // a face is snow if most of it lies above the snowline; steeper faces shed it
          const snowy = j >= 2 ? (j === 3 ? 1 : 0.5) * (n.y > 0.35 ? 1 : 0.55) : 0;
          for (const v of [a, b, c]) {
            const frac = Math.min(1, Math.max(0, (v.y - FOOT) / (RANGE.height * 0.55 - FOOT)));
            tmp.copy(rock).lerp(forestC, (1 - frac) * 0.55);
            tmp.lerp(shade, snowy * 0.5).lerp(snow, snowy * (n.y > 0.5 ? 0.85 : 0.55));
            pos.push(v.x, v.y, v.z);
            nor.push(n.x, n.y, n.z);
            col.push(tmp.r, tmp.g, tmp.b);
            // layered haze: pale at the foot and thinning up the peaks, never clear
            haze.push(Math.min(0.94, RANGE.haze + (1 - frac) * 0.36));
            sail.push(0);
          }
        }
      }
    }
  }
  // ---- the second summit: a windmill on the near ring's highest crest in the south-west ----
  let summit: { x: number; y: number; z: number; axisX: number; axisZ: number } | undefined;
  {
    const ring = HILL_RINGS[0]!;
    const rng = new Rng(ring.seed * 977);
    let bestH = -1;
    let bx = 0;
    let bz = 0;
    for (let k = 0; k < ring.segments; k++) {
      const theta = ((k + rng.range(-0.3, 0.3)) / ring.segments) * Math.PI * 2;
      const H = ring.height * ridge(ring.seed, theta) * rng.range(0.85, 1.12);
      rng.range(0.28, 0.5); // (the foothill and shoulder draws of the ring loop above: keep the stream in step)
      rng.range(0.35, 0.6);
      const rr = ring.radius + rng.range(-4, 4);
      if (theta > 2.05 && theta < 3.35 && H > bestH) {
        bestH = H;
        bx = Math.cos(theta) * rr;
        bz = Math.sin(theta) * rr;
      }
    }
    // the windmill faces the arena; the ridge under it is levelled by a broad pad of packed earth (a low plinth in the geometry)
    const len = Math.hypot(bx, bz) || 1;
    const ax = -bx / len;
    const az = -bz / len;
    summit = { x: bx, y: bestH, z: bz, axisX: ax, axisZ: az };
    const mill = windmillGeometry();
    const mp = mill.attributes.position as BufferAttribute;
    const mn2 = mill.attributes.normal as BufferAttribute;
    const mc = mill.attributes.color as BufferAttribute;
    const ms = mill.attributes.aSway as BufferAttribute;
    const yaw = Math.atan2(az, ax); // local +x -> (ax, az)
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i);
      const y = mp.getY(i);
      const z = mp.getZ(i);
      pos.push(bx + x * cy - z * sy, bestH - 0.6 + y, bz + x * sy + z * cy);
      const nx = mn2.getX(i);
      const nz = mn2.getZ(i);
      nor.push(nx * cy - nz * sy, mn2.getY(i), nx * sy + nz * cy);
      col.push(mc.getX(i), mc.getY(i), mc.getZ(i));
      haze.push(0.16);
      sail.push(ms.getX(i) > 0.5 ? 1 : 0);
    }
    mill.dispose();
    void WINDMILL;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("aCol", new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute("aHaze", new BufferAttribute(new Float32Array(haze), 1));
  g.setAttribute("aSail", new BufferAttribute(new Float32Array(sail), 1));
  g.computeBoundingSphere();
  return { geometry: g, slopes, summit };
}

// ---- the tree line -----------------------------------------------------------------------------------------------------------------

/** Marks every vertex of a part as trunk (1) or crown (0): the shader paints trunks bark-brown whatever the crown's colour. */
function markTrunk(g: BufferGeometry, v: 0 | 1): BufferGeometry {
  g.setAttribute("aTrunk", new BufferAttribute(new Float32Array(g.attributes.position!.count).fill(v), 1));
  return g;
}

/** Bakes a vertical shade into a tree geometry: dark under the crown, bright at the top (`aShade`), so a far tree has form, not just a flat facet. */
function shadeByHeight(g: BufferGeometry, lo: number, hi: number): BufferGeometry {
  const p = g.attributes.position!;
  const shade = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) shade[i] = lo + (hi - lo) * Math.min(1, Math.max(0, p.getY(i)));
  g.setAttribute("aShade", new BufferAttribute(shade, 1));
  return g;
}

/** A three-tier pine, six-sided (18 triangles), height 1, radius ~0.3: normals point outward so the hill shader lights it. */
export function coniferGeometry(): BufferGeometry {
  const tiers: [number, number, number, number][] = [
    [0.36, 0.5, 0.24, 6],
    [0.28, 0.46, 0.5, 6],
    [0.19, 0.42, 0.76, 6],
  ];
  const parts = tiers.map(([r, h, y, seg]) => {
    const c = new ConeGeometry(r, h, seg, 1, true);
    c.translate(0, y, 0);
    return markTrunk(c.toNonIndexed(), 0);
  });
  const trunk = new ConeGeometry(0.05, 0.3, 4, 1, true).toNonIndexed();
  trunk.translate(0, 0.1, 0);
  const g = mergeGeometries([...parts, markTrunk(trunk, 1)], false)!;
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return shadeByHeight(g, 0.66, 1.08);
}

/**
 * A far broadleaf: a sturdy trunk under a clustered, lumpy crown (four overlapping faceted lobes, about 90 triangles), height 1. One
 * faceted hexagon in haze reads as a paper cut-out; overlapping lobes give the crown a cauliflower silhouette and shaded underside.
 */
export function roundCrownGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const lobe = (x: number, y: number, z: number, r: number, sy = 0.82): void => {
    const g = new IcosahedronGeometry(r, 0); // polyhedra are already non-indexed
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    parts.push(markTrunk(g, 0));
  };
  lobe(0, 0.6, 0, 0.3);
  lobe(0.24, 0.52, 0.06, 0.22);
  lobe(-0.23, 0.55, -0.08, 0.23);
  lobe(0.03, 0.83, 0.02, 0.2);
  const trunk = new ConeGeometry(0.075, 0.5, 5, 1, true).toNonIndexed();
  trunk.translate(0, 0.25, 0);
  parts.push(markTrunk(trunk, 1));
  const g = mergeGeometries(parts, false)!;
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return shadeByHeight(g, 0.62, 1.1);
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
  const pine = new Color(PALETTE.world.pine);
  const pineLight = new Color(PALETTE.world.pineLight);
  const autumn = [new Color(PALETTE.world.autumnRed), new Color(PALETTE.world.autumnOrange), new Color(PALETTE.world.autumnGold)];
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
    // Conifers stay a dark pine. Broadleaves follow the season by REGION: whole hillsides turn autumn red, orange or gold together, and the
    // rest stay green with the odd dry tree. (The same region idea colours the arena's own broadleaves; see scatter.ts.)
    const season = autumnAt(p.x, p.z);
    const turned = season.amount > 0.5;
    const colour = conifer
      ? pine.clone().lerp(pineLight, rng.next() * 0.75)
      : turned
        ? autumn[Math.min(2, Math.floor((season.hue * 0.6 + rng.next() * 0.4) * 3))]!.clone().lerp(dry, rng.next() * 0.3)
        : deep.clone().lerp(light, rng.next() * 0.7).lerp(dry, rng.next() < 0.06 ? 0.55 : 0);
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
  attribute float aShade;
  attribute float aTrunk;
  uniform vec3 uTrunk;
  uniform vec3 uFog; uniform vec3 uSunDir; uniform vec3 uTint;
  ${HAZE_GLSL}
  varying vec3 vCol;
  void main() {
    vec3 n = normalize(mat3(instanceMatrix) * normal);
    float lit = clamp(dot(n, uSunDir), 0.0, 1.0);
    float stepK = lit > 0.55 ? 1.22 : (lit > 0.25 ? 1.0 : 0.72);
    vec3 base = mix(instanceColor * aShade, uTrunk * (0.7 + 0.3 * aShade), aTrunk) * stepK * uTint;
    vec3 wp = (instanceMatrix * vec4(position, 1.0)).xyz;
    vCol = mix(base, uFog, hillHaze(aHazeI, wp));
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
