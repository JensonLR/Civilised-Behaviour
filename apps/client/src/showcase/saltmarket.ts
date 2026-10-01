import { Vector3 } from "three";

/**
 * The Saltmarket Delta's named vantage points for `?showcase=world&region=saltmarket&view=<name>` (D-037, package D4; `ky(x, z)` is the ground height there). A view is [camera position, look-at]. The names
 * docs/_notes/regions34.md section 4 asks for: landing, quay, boardwalk, channel, stilts, customs, berth, cove, drop, exchange, flood (inside the hall, at high water: `time` and the scenario clock decide how high),
 * horizon (the whole delta from the quay: the silhouette shot), `top`; and a few more the art review wants: walk3 (the skyline's own viewpoint), lanterns, crane, campanile, windpump, reeds, rim, bridge.
 */
export const SALTMARKET_DEFAULT_VIEW = "horizon";
export function saltmarketViews(ky: (x: number, z: number) => number): Record<string, [Vector3, Vector3]> {
  const v = (x: number, h: number, z: number, lx: number, lh: number, lz: number): [Vector3, Vector3] => [new Vector3(x, ky(x, z) + h, z), new Vector3(lx, ky(lx, lz) + lh, lz)];
  return {
    landing: [new Vector3(3.2, ky(0, 118) + 1.9, 124), new Vector3(0, ky(0, 60) + 3, 40)],
    horizon: [new Vector3(0, ky(0, 128) + 3.2, 134), new Vector3(0, ky(0, -60) + 6, -60)],
    quay: v(1.2, 2.2, 116, -2, 1.2, 134),
    boardwalk: [new Vector3(0.6, 2.2, 106), new Vector3(-6, 1.6, 60)],
    channel: [new Vector3(16, 2.6, 106), new Vector3(-14, 0.2, 90)],
    stilts: v(-33, 2.1, 98, -44, 2.4, 108),
    customs: v(-25, 2.4, 78, -38, 2.6, 62),
    berth: v(-37, 2.4, 80, -44, 1.0, 91),
    cove: v(50, 3.0, 9, 66, 1.0, -8),
    drop: v(-55, 2.2, -45, -69, 2.0, -58),
    exchange: v(0.5, 2.2, -16, 0, 3.0, -44),
    flood: v(-8, 2.0, -36, 3, 0.8, -52),
    bridge: [new Vector3(7, 2.4, 80), new Vector3(0, 0.6, 94)],
    rim: [new Vector3(-12, 2.0, 80), new Vector3(-28, 0.8, 90)],
    walk3: v(-10, 1.7, 40, 0, 3, -60),
    lanterns: v(3, 2.2, 90, 0, 2.2, 56),
    crane: v(26, 2.0, 96, 32.5, 6, 106.5),
    campanile: v(22, 2.4, -12, 21, 6, -35),
    windpump: v(-78, 2.4, 2, -90, 6, -11),
    reeds: v(-70, 1.6, 14, -78, 0.9, 4),
    top: [new Vector3(0, 190, 10), new Vector3(0, 0, 10)],
  };
}
