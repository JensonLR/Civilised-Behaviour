import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { HIGHMARK, HIGHMARK_ANCHORS, highmarkRiverZ, type HighmarkTerrain } from "./shared.ts";
import { waterMaterial, type WaterUniforms } from "../water.ts";

/**
 * Highmark's river along the south edge, as ONE ribbon in the shared toon-water shader (world/water.ts `waterMaterial`: banded depth tones, travelling ripples, foam on the banks).
 * The shader wants `aQ` (0 at the middle of a channel .. 1 at its shore) and `aFlow`; this only supplies them. The ribbon's shore is wherever the bank rises through the water's
 * level (measured, row by row). It is slow: Highmark's river takes its time over everything.
 */

const ROW = 4;
const COLS = 7;

/** The water's level (the bank minus a hand). */
export const highmarkWaterY = (): number => HIGHMARK.level + HIGHMARK.river.water;

/** How far from the river's centreline the water meets the ground at x (the bed is symmetric about it). */
export function riverShore(terrain: HighmarkTerrain, x: number): number {
  const zc = highmarkRiverZ(x);
  const y = highmarkWaterY();
  let lo = 0;
  let hi = 18;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (terrain.height(x, zc - mid) < y) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function riverGeometry(terrain: HighmarkTerrain): BufferGeometry {
  const pos: number[] = [];
  const q: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const x0 = -HIGHMARK_ANCHORS.bounds - 12;
  const x1 = HIGHMARK_ANCHORS.bounds + 12;
  const rows = Math.ceil((x1 - x0) / ROW);
  const y = highmarkWaterY();
  for (let i = 0; i <= rows; i++) {
    const x = x0 + i * ROW;
    const zc = highmarkRiverZ(x);
    const half = riverShore(terrain, x) + 0.12;
    for (let j = 0; j < COLS; j++) {
      const v = -1 + (2 * j) / (COLS - 1);
      pos.push(x, y, zc + v * half);
      q.push(Math.abs(v) * 1.02);
      flow.push(0.32, 0);
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
  g.computeBoundingSphere();
  return g;
}

export function buildHighmarkWater(terrain: HighmarkTerrain, animated: boolean): { mesh: Mesh; uniforms: WaterUniforms } {
  const geo = riverGeometry(terrain);
  const { material, uniforms } = waterMaterial(animated);
  uniforms.uWeir.value.set(0, -1000, 1, 0); // (the shared shader has a weir and two splash spots for Hollowmere's stream: none here)
  const mesh = new Mesh(geo, material);
  mesh.name = "water";
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}
