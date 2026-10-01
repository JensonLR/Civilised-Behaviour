import { BufferAttribute, BufferGeometry, Color, Mesh } from "three";
import { PALETTE, SALTMARKET, SALTMARKET_CHANNELS, smoothstep, type SaltmarketTerrain, type Terrain } from "./shared.ts";
import { GROUND_HALF, visualY } from "./ground.ts";
import { waterMaterial, type WaterUniforms } from "../water.ts";

/**
 * The delta's water as ONE mesh in the shared toon-water shader (world/water.ts `waterMaterial`: banded depth tones, travelling ripples, foam on the banks), recoloured to the delta's silt. The surface is flat at
 * `SALTMARKET.waterY`; the mesh is the terrain's own grid, kept only where a vertex is wet, with the channel coordinate `aQ` taken from the DEPTH at each vertex (1 at the waterline, 0 from 0.8 m down; dry vertices
 * read above 1, hidden under the ground). Because the grid is the ground's, the shoreline the shader paints is exactly where the ground mesh crosses the water.
 */

export const saltmarketWaterY = (): number => SALTMARKET.waterY;

/** The tide's drift where nobody is looking (the shader's ripples travel along it): slow, with the cuts running faster along their length. */
export function flowAt(x: number, z: number, out: [number, number]): [number, number] {
  let fx = 0.12, fz = 0.04, w = 0;
  for (const ch of SALTMARKET_CHANNELS) {
    if (!ch.deep) continue;
    const x_ = ch.axis === "x";
    const u = x_ ? x : z;
    if (u < ch.lo || u > ch.hi) continue;
    const c = ch.c;
    const d = Math.abs((x_ ? z : x) - c) - ch.half - 4;
    const k = 1 - smoothstep(0, 10, d);
    if (k > w) {
      w = k;
      fx = x_ ? 0.34 : 0;
      fz = x_ ? 0 : 0.28;
    }
  }
  out[0] = fx * w + 0.12 * (1 - w);
  out[1] = fz * w + 0.04 * (1 - w);
  return out;
}

export function buildSaltmarketWaterGeometry(terrain: Terrain, segments: number): BufferGeometry | undefined {
  const n = segments + 1;
  const step = (GROUND_HALF * 2) / segments;
  const depth = new Float32Array(n * n);
  const wd = (terrain as Partial<SaltmarketTerrain>).waterDepth;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -GROUND_HALF + i * step, z = -GROUND_HALF + j * step;
    depth[j * n + i] = SALTMARKET.waterY - visualY(terrain.height(x, z), x, z) + 0 * (wd ? wd(x, z) : 0);
  }
  const pos: number[] = [];
  const q: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const map = new Int32Array(n * n).fill(-1);
  const fl: [number, number] = [0, 0];
  const vert = (i: number, j: number): number => {
    const k = j * n + i;
    if (map[k]! >= 0) return map[k]!;
    const x = -GROUND_HALF + i * step, z = -GROUND_HALF + j * step;
    map[k] = pos.length / 3;
    pos.push(x, SALTMARKET.waterY, z);
    q.push(Math.max(0, 1.02 - depth[k]! * (0.97 / 0.8)));
    flowAt(x, z, fl);
    flow.push(fl[0], fl[1]);
    return map[k]!;
  };
  for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
    const d0 = depth[j * n + i]!, d1 = depth[j * n + i + 1]!, d2 = depth[(j + 1) * n + i]!, d3 = depth[(j + 1) * n + i + 1]!;
    if (d0 <= 0 && d1 <= 0 && d2 <= 0 && d3 <= 0) continue;
    // the ground's own diagonal: (i, j + 1) - (i + 1, j)
    const a = vert(i, j), b = vert(i, j + 1), c = vert(i + 1, j + 1), d = vert(i + 1, j);
    idx.push(a, b, d, b, c, d);
  }
  if (idx.length === 0) return undefined;
  // every triangle faces up
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!, uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!, vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    if (uz * vx - ux * vz < 0) {
      idx[t + 1] = c;
      idx[t + 2] = b;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aQ", new BufferAttribute(new Float32Array(q), 1));
  g.setAttribute("aFlow", new BufferAttribute(new Float32Array(flow), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The water material, recoloured to the silt: slate-blue shallows, deep indigo-slate in the cuts, salt foam, a pale glint. */
export function buildSaltmarketWater(terrain: Terrain, segments: number, animated: boolean): { mesh: Mesh; uniforms: WaterUniforms; material: ReturnType<typeof waterMaterial>["material"] } | undefined {
  const geo = buildSaltmarketWaterGeometry(terrain, segments);
  if (!geo) return undefined;
  const { material, uniforms } = waterMaterial(animated);
  uniforms.uWeir.value.set(0, -1000, 1, 0);
  const P = PALETTE.saltmarket;
  const u = material.uniforms as Record<string, { value: Color }>;
  u.uDeep!.value.set(P.siltWaterDeep);
  u.uShallow!.value.set(P.siltWater);
  u.uFoam!.value.set(P.salt);
  u.uGlint!.value.set(P.siltWaterPale);
  const mesh = new Mesh(geo, material);
  mesh.name = "water";
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms, material };
}
