import { Vector3 } from "three";

/**
 * Vesper Gorge's named vantage points for `?showcase=world&region=vesper&view=<name>` (D-037, package C3; `ky(x, z)` is the ground height there). A view is [camera position, look-at]. `time=13` is noon, `time=dusk`
 * is the lamps' hour (the Guild's lamps and the headframe's work-light burn), `weather=fog` thickens the gorge. The gorge is a CLEFT: `cleft` is the silhouette shot (the whole gorge from the landing), `rim` looks
 * down into it from the west cliff's top, `road` and `floor` walk it, and the rest are the story points: wharf, headframe, trestle, assay, pegging, cloister, adit and fall (the Lower Gallery's plug).
 * The scenario's state can be dressed for a still with `fall=open|dug|blasted|sealed|consecrated` and `pegs=party,rival,none,party` (see VesperView.applyScenario).
 */
export const VESPER_DEFAULT_VIEW = "cleft";
export function vesperViews(ky: (x: number, z: number) => number): Record<string, [Vector3, Vector3]> {
  return {
    landing: [new Vector3(3.2, ky(0, 118) + 1.9, 124), new Vector3(0, ky(0, 60) + 4, 40)],
    wharf: [new Vector3(9, ky(0, 142) + 3.4, 146), new Vector3(0, 1.4, 124)],
    road: [new Vector3(2, ky(0, 78) + 1.8, 84), new Vector3(-2, ky(0, 10) + 10, 0)],
    floor: [new Vector3(3, ky(0, 14) + 1.8, 20), new Vector3(-44, ky(-44, 12) + 14, 6)],
    headframe: [new Vector3(6, ky(6, -34) + 2.2, -34), new Vector3(26, 24, -66)],
    trestle: [new Vector3(-34, ky(-34, -34) + 3.5, -30), new Vector3(-3, 11, -66)],
    assay: [new Vector3(12, ky(12, 30) + 2.4, 32), new Vector3(39, ky(39, 16) + 5, 16)],
    pegging: [new Vector3(-30, ky(-30, -8) + 2.4, -8), new Vector3(-38, ky(-38, -30) + 1.2, -30)],
    cloister: [new Vector3(-18, ky(-18, 62) + 2.8, 64), new Vector3(-47, ky(-47, 44) + 4.5, 44)],
    adit: [new Vector3(3, ky(3, -78) + 2.2, -76), new Vector3(0, ky(0, -96) + 4, -96)],
    fall: [new Vector3(3.4, ky(3.4, -88) + 1.8, -87), new Vector3(0, ky(0, -96) + 2.6, -96)],
    cleft: [new Vector3(0, ky(0, 128) + 3.2, 134), new Vector3(0, ky(0, -90) + 8, -90)],
    rim: [new Vector3(-76, ky(-76, 30) + 3, 34), new Vector3(24, 6, -30)],
    top: [new Vector3(0, 190, 10), new Vector3(0, 0, 10)],
  };
}
