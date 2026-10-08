import type { LevelBuilding } from "./rooms.ts";

/**
 * The notices on SEALED doors (D-038, docs/LEVEL_PLAN.md section 4: "a small sign or prop that says why": "CLOSED FOR TIDE", "THE KING IS PENDING"). Each region's cloth atlas has one strip per notice after its
 * signboards; this pushes a flat plaque quad pinned across the boards of each sealed building's door into the region's cloth mesh arrays (position, normal, uv, wave).
 */
export type UvRect = readonly [number, number, number, number];

export interface ClothArrays {
  pos: number[];
  nor: number[];
  uv: number[];
  wave: number[];
}

/** Plaque quad size: a strip 1.2 m wide (the atlas strip is 512:96). */
export const PLAQUE = { hw: 0.6, hh: 0.113 } as const;

/**
 * `uvOf(building)` gives the atlas strip for a sealed building's notice (undefined: none). `doorY(building)` is the height of the door's floor above the terrain at the building (steps lift a palace's door).
 */
export function pushPlaques(buildings: readonly LevelBuilding[], terrainHeight: (x: number, z: number) => number, uvOf: (b: LevelBuilding) => UvRect | undefined, out: ClothArrays): void {
  for (const b of buildings) {
    if (b.kind !== "sealed") continue;
    const rect = uvOf(b);
    if (!rect) continue;
    const [u0, v0, u1, v1] = rect;
    const nx = Math.cos(b.yaw);
    const nz = Math.sin(b.yaw);
    const rx = nz;
    const rz = -nx;
    // (hung on the door's chain, 7 mm in front of it, so the chain runs behind the lettering: it stood 0.3 m out, 6 cm clear of the chain and 11 cm of the boards)
    const cx = b.x + nx * (b.hx + 0.245);
    const cz = b.z + nz * (b.hx + 0.245);
    const y = terrainHeight(b.x, b.z) + b.floor + 0.08 + b.doorH * 0.62;
    const corner = (u: number, v: number): [number, number, number] => [cx + rx * u * PLAQUE.hw, y + v * PLAQUE.hh, cz + rz * u * PLAQUE.hw];
    const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const uvs: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      out.pos.push(...q[i]!);
      out.nor.push(nx, 0, nz);
      out.uv.push(uvs[i]![0], uvs[i]![1]);
      out.wave.push(0);
    }
  }
}
