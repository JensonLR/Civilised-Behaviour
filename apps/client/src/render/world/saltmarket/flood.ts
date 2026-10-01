import { BufferAttribute, BufferGeometry, Mesh, type ShaderMaterial } from "three";
import { SALTMARKET_ANCHORS, smoothstep, type ScenarioView } from "./shared.ts";

/**
 * The Exchange floods at every spring tide and holds its sale regardless. The water in the hall is COSMETIC (the collision world never changes with a scenario): a pure function of the contract's clock.
 * While the auction is running the level follows `endsAtWorldMs` (high water, the hammer): `FLOOD.base` an hour or more out, rising with the square of the tide's progress over the last `FLOOD.window` seconds to `FLOOD.max`
 * at the hammer. At rest (no contract, or another contract's) the hall has an ankle-deep shine. When the sale resolves the view holds the level where it was (a sale washed out goes on up to the maximum).
 */
export const FLOOD = { base: 0.12, max: 1.55, window: 420 } as const;

/** The water's height above the hall's floor at the world clock `worldSec`: monotone non-decreasing in `worldSec` while a timer runs, bounded to [base, max], finite for any input. */
export function floodLevel(endsAtWorldMs: number, worldSec: number): number {
  if (!(endsAtWorldMs > 0) || !Number.isFinite(worldSec)) return FLOOD.base;
  const remain = (endsAtWorldMs - worldSec * 1000) / 1000;
  if (!Number.isFinite(remain)) return FLOOD.base;
  const u = smoothstep(0, 1, 1 - remain / FLOOD.window);   // 0 a window out, 1 at the hammer
  return FLOOD.base + (FLOOD.max - FLOOD.base) * u * u;
}

/** What level the contract on show asks for: the clock's, when the Exchange's auction is running; the held level when it has ended; the rest level otherwise. Pure; `held` is the level the view last drew. */
export function floodTarget(v: ScenarioView | undefined, worldSec: number, held: number): number {
  if (!v || v.template !== "flooded_market") return FLOOD.base;
  if (v.resolution !== undefined) return v.resolution === "washed_out" ? FLOOD.max : Math.max(held, FLOOD.base);
  return floodLevel(v.endsAtWorldMs, worldSec);
}

/**
 * The flood's surface: a rectangle over the hall and its apron in the delta's water shader (the view shares the material with the rest of the water), laid at the floor's height and lifted by `floodLevel`.
 * Its edge reads as foam (`aQ` 1 at the rim, deep inside).
 */
export function buildFloodMesh(material: ShaderMaterial, floorY: number): Mesh {
  const E = SALTMARKET_ANCHORS.exchange;
  const x0 = E.x - 16.6, x1 = E.x + 16.6, z0 = E.z - 16, z1 = E.z + 21;
  const cols = 14, rows = 16;
  const pos: number[] = [], q: number[] = [], flow: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, v = j / rows;
    pos.push(x0 + (x1 - x0) * u, 0, z0 + (z1 - z0) * v);
    const edge = Math.min(u, 1 - u, (v * (z1 - z0)) / 4, ((1 - v) * (z1 - z0)) / 4);
    q.push(1.02 - 0.82 * smoothstep(0, 0.9, edge * 3));
    flow.push(0.06, 0.02);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
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
  const mesh = new Mesh(g, material);
  mesh.name = "flood";
  mesh.renderOrder = 2;
  mesh.position.y = floorY + FLOOD.base;
  mesh.userData.floorY = floorY;
  return mesh;
}
