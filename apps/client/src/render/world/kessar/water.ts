import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { smoothstep } from "@cb/shared";
import { waterMaterial, type WaterUniforms } from "../water.ts";
import { KESSAR, KESSAR_ANCHORS, kessarRiverZ, kessarWaterY, type KessarTerrain } from "./shared.ts";
import { seaDepthAt } from "./ground.ts";

/**
 * Kessar's water: the river through the gorge and the sea, as ONE mesh in the shared toon-water shader (world/water.ts `waterMaterial`: banded depth
 * tones, travelling ripples, foam on the banks). The shader wants `aQ` (0 at the middle of a channel .. 1 at its shore) and `aFlow`; this only supplies
 * them. The river ribbon runs wall to wall at the water's own level, so its shore is wherever the gorge rises through it (measured, row by row); the sea
 * is a grid over the shelving shore whose `aQ` comes from the depth over the drawn ground.
 */

const ROW = 4;
const COLS = 7;

/** How far from the river's centreline the water meets the ground at x (the terrain is symmetric about the centreline inside the gorge). */
export function riverShore(terrain: KessarTerrain, x: number): number {
  const zc = kessarRiverZ(x);
  const y = kessarWaterY(x);
  let lo = 0;
  let hi = 16;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (terrain.height(x, zc - mid) < y) lo = mid;
    else hi = mid;
  }
  return lo;
}

function riverGeometry(terrain: KessarTerrain): BufferGeometry {
  const pos: number[] = [];
  const q: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const x0 = -KESSAR_ANCHORS.bounds - 12;
  const x1 = KESSAR_ANCHORS.bounds + 12;
  const rows = Math.ceil((x1 - x0) / ROW);
  for (let i = 0; i <= rows; i++) {
    const x = x0 + i * ROW;
    const zc = kessarRiverZ(x);
    const half = riverShore(terrain, x) + 0.12;
    const y = kessarWaterY(x);
    const speed = 0.55;
    // the river runs toward the sea's side of the map, west to east
    for (let j = 0; j < COLS; j++) {
      const v = -1 + (2 * j) / (COLS - 1);
      pos.push(x, y, zc + v * half);
      q.push(Math.abs(v) * 1.02);
      flow.push(speed, 0);
    }
    if (i > 0) {
      const a = (i - 1) * COLS;
      const b = i * COLS;
      for (let j = 0; j + 1 < COLS; j++) idx.push(a + j, a + j + 1, b + j + 1, a + j, b + j + 1, b + j);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aQ", new BufferAttribute(new Float32Array(q), 1));
  g.setAttribute("aFlow", new BufferAttribute(new Float32Array(flow), 2));
  g.setIndex(idx);
  return g;
}

function seaGeometry(terrain: KessarTerrain): BufferGeometry {
  const xs: number[] = [];
  for (let x = -KESSAR_ANCHORS.bounds - 40; x <= KESSAR_ANCHORS.bounds + 40; x += 8) xs.push(x);
  for (const far of [-480, 480]) xs.push(far);
  xs.sort((a, b) => a - b);
  const zs: number[] = [88, 92, 94, 96, 97, 98, 99, 100, 101, 102, 103, 104, 106, 108, 112, 120, 136, 170, 480];
  const pos: number[] = [];
  const q: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  for (const z of zs) {
    for (const x of xs) {
      const depth = seaDepthAt(terrain, x, z);
      pos.push(x, KESSAR.seaLevel, z);
      q.push(1.02 * (1 - smoothstep(0, 0.62, depth)));
      flow.push(0.18, 0.05);
    }
  }
  const W = xs.length;
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < W; i++) {
      const a = j * W + i;
      const b = a + W;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aQ", new BufferAttribute(new Float32Array(q), 1));
  g.setAttribute("aFlow", new BufferAttribute(new Float32Array(flow), 2));
  g.setIndex(idx);
  return g;
}

export function buildKessarWater(terrain: KessarTerrain, animated: boolean): { mesh: Mesh; uniforms: WaterUniforms } {
  const parts = [riverGeometry(terrain), seaGeometry(terrain)];
  const geo = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  const { material, uniforms } = waterMaterial(animated);
  uniforms.uWeir.value.set(0, -1000, 1, 0); // (the shared shader has a weir and two splash spots for Hollowmere's stream: none here)
  const mesh = new Mesh(geo, material);
  mesh.name = "water";
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}
