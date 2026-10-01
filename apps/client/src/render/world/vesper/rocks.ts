import { BoxGeometry, IcosahedronGeometry, type BufferGeometry } from "three";
import { PALETTE, hash3 } from "./shared.ts";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";

/**
 * Vesper's own rocks (the game's boulder and slab carry moss and lichen, which an arid gorge has none of): faceted boulders and leaning slabs banded in the strata's red, plum, buff and violet, bleached
 * pale on every upward face, dark at the foot and under the overhangs. Pure functions of the vertex (the ink hull is the same mesh), local frame like the game's: sit on y = 0, about 1.2 tall, radius 1.
 */

const P = PALETTE.vesper;
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const BANDS = [P.strataRust, P.strataPlum, P.strataBuff, P.strataRustDark, P.strataViolet, P.strataBuff] as const;

export const rockColour: ColourFn = (p, n, out) => {
  const ang = Math.atan2(p.z, p.x);
  const band = Math.floor(p.y * 5.2 + Math.sin(ang * 3 + p.y * 2.1) * 0.35 + 40);
  out.set(BANDS[band % BANDS.length]!);
  if (band % 5 === 0) blend(out, BANDS[band % BANDS.length]!, P.shale, 0.35);
  blend(out, out.getHex(), P.strataBone, smooth(0.3, 0.85, n.y) * 0.55);
  if (p.y < 0.28) blend(out, out.getHex(), P.shale, (1 - smooth(-0.1, 0.28, p.y)) * 0.5);
  if (n.y < -0.2) blend(out, out.getHex(), P.shale, 0.45);
  const h = (hash3(7, Math.floor(p.x * 5), Math.floor(p.y * 5), Math.floor(p.z * 5)) / 4294967296);
  if (n.y > 0.1 && n.y < 0.7 && h > 0.9) blend(out, out.getHex(), P.verdigris, 0.3);
};

export function vesperBoulderGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const part = (detail: number, at: V3, s: V3, seed: number, rot: V3): void => {
    k.add(new IcosahedronGeometry(1, detail), { at, scale: s, rot, colour: rockColour, perFace: true, jitter: 0.17, seed });
  };
  part(lod ? 1 : 0, [0, 0.36, 0], [1, 0.85, 1], 441, [0, 0.4, 0]);
  part(0, [0.55, 0.34, 0.24], [0.62, 0.5, 0.56], 442, [0.3, 1.1, 0]);
  part(0, [-0.5, 0.26, -0.3], [0.5, 0.42, 0.54], 443, [0, 2.0, 0.3]);
  return k.build()!;
}

/** A leaning slab of layered stone: two thick plates propped on each other and a fallen chunk. Local frame: x +-0.95, z +-0.5, about 1.2 tall. */
export function vesperSlabGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  void lod;
  k.add(new BoxGeometry(1.5, 1.2, 0.62, 2, 7, 1), { at: [0.05, 0.58, 0], rot: [0.06, 0.35, -0.16], colour: rockColour, perFace: true, jitter: 0.07, seed: 461 });
  k.add(new BoxGeometry(1.0, 0.78, 0.4, 2, 5, 1), { at: [-0.62, 0.36, 0.42], rot: [-0.12, 0.85, 0.1], colour: rockColour, perFace: true, jitter: 0.05, seed: 464 });
  k.add(new BoxGeometry(0.9, 0.46, 0.7), { at: [-0.5, 0.2, -0.36], rot: [0.1, 0.8, 0.05], colour: rockColour, flat: true, jitter: 0.05, seed: 462 });
  k.add(new IcosahedronGeometry(0.42, 0), { at: [0.62, 0.2, -0.32], colour: rockColour, flat: true, jitter: 0.08, seed: 463 });
  return k.build()!;
}
