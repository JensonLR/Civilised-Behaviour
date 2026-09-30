import { BoxGeometry, SphereGeometry, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { Kit, blend, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";

const K = PALETTE.kessar;

/** Nominal height of a palm at instance scale 1 (the plan's `s` scales it). */
export const PALM_HEIGHT = 7.5;

/**
 * A date palm at the origin: a leaning ringed trunk, a crown of drooping fronds (each a few flat leaf-blades bending down), a knot of dates.
 * Instanced (one draw + one ink hull for every palm in the region), wind-swayed by the tree shader like any tree.
 */
export function palmGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const segs = lod ? 6 : 4;
  const lean = 0.9;
  const at = (t: number): V3 => [lean * t * t, PALM_HEIGHT * t, 0.2 * t * t];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    k.limb(at(t0), at(t1), 0.3 - 0.13 * t0, 0.3 - 0.13 * t1, (p, _n, out) => blend(out, K.trunkPalm, K.timberLight, (Math.floor(p.y * 5) & 1) * 0.35), lod ? 7 : 5);
  }
  const top = at(1);
  k.add(new SphereGeometry(0.34, 7, 5), { at: [top[0], top[1] + 0.05, top[2]], colour: K.frondDark, flat: true });
  const fronds = lod ? 9 : 6;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const blades = lod ? 3 : 2;
    let px = top[0];
    let py = top[1] + 0.1;
    let pz = top[2];
    for (let b = 0; b < blades; b++) {
      const len = 1.45 - 0.22 * b;
      const droop = 0.22 + 0.42 * b;
      const nx = px + dx * len * Math.cos(droop);
      const ny = py + (b === 0 ? 0.55 : -len * Math.sin(droop) * 0.9);
      const nz = pz + dz * len * Math.cos(droop);
      const mid: V3 = [(px + nx) / 2, (py + ny) / 2, (pz + nz) / 2];
      const pitch = Math.atan2(ny - py, len * Math.cos(droop));
      k.add(new BoxGeometry(len * 1.02, 0.04, 0.46 - 0.1 * b), { at: mid, rot: [0, -a, pitch], colour: (_p, _n, out) => blend(out, K.frond, K.frondDark, (b + (f & 1)) / 4), flat: true });
      px = nx;
      py = ny;
      pz = nz;
    }
  }
  if (lod) for (let i = 0; i < 3; i++) k.add(new SphereGeometry(0.11, 5, 4), { at: [top[0] + Math.cos(i * 2.1) * 0.25, top[1] - 0.1, top[2] + Math.sin(i * 2.1) * 0.25], colour: K.clay, flat: true });
  return k.build()!;
}
