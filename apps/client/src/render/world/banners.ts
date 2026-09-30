import { GATE_CLOCK_Y, villagePlan, type CollisionWorld } from "@cb/shared";
import { CLOCK_UV, VSIGN_ASPECT, vsignUv, type Rect } from "./atlas.ts";
import type { V3 } from "./kit.ts";

/**
 * The flat, textured decals of the world (village boards, the gate clock's dial, later the HQ's heraldry, notice board and crate stencils), as quads
 * handed to `buildBanners`, which merges them with the pennant and the signboard lettering into ONE draw. A quad is four corners in CCW order
 * seen from the front (bottom-left, bottom-right, top-right, top-left), its outward normal, a UV rectangle and a wave weight per corner (0 = still).
 */
export type PushQuad = (corners: readonly [V3, V3, V3, V3], normal: V3, rect: Rect, wave?: readonly [number, number, number, number]) => void;

/** Corners of a w x h decal centred at (x, y, z) facing the direction (cos yaw, sin yaw), upright. */
export function facing(x: number, y: number, z: number, yaw: number, w: number, h: number): { corners: [V3, V3, V3, V3]; normal: V3 } {
  const nx = Math.cos(yaw);
  const nz = Math.sin(yaw);
  const rx = nz; // right, seen from the front
  const rz = -nx;
  const p = (u: number, v: number): V3 => [x + rx * u * (w / 2), y + v * (h / 2), z + rz * u * (w / 2)];
  return { corners: [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)], normal: [nx, 0, nz] };
}

export function villageBanners(world: CollisionWorld, quad: PushQuad): void {
  const plan = villagePlan(world.terrain);
  for (const s of plan.signs) {
    const y = world.terrainHeight(s.x, s.z) + s.y;
    const h = s.w / VSIGN_ASPECT;
    const f = facing(s.x, y, s.z, s.yaw, s.w, h);
    quad(f.corners, f.normal, vsignUv(s.text));
  }
  const gate = plan.buildings.find((b) => b.kind === "clock");
  if (gate) {
    for (const side of [1, -1]) {
      const x = gate.x + Math.cos(gate.yaw) * side * (gate.hx + 0.07);
      const z = gate.z + Math.sin(gate.yaw) * side * (gate.hx + 0.07);
      const f = facing(x, gate.ground + GATE_CLOCK_Y, z, gate.yaw + (side > 0 ? 0 : Math.PI), 1.42, 1.42);
      quad(f.corners, f.normal, CLOCK_UV);
    }
  }
}
