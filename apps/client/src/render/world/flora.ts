import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, SphereGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { Kit, blend, shaded, topLit, type ColourFn, type V3 } from "./kit.ts";

/**
 * Scenery geometry builders. Each returns ONE merged, vertex-coloured, non-indexed geometry (with `onormal` for the ink
 * outline) in a unit local frame, ready to be instanced with per-instance colour and size variation. `lod` 1 is the visible
 * mesh; `lod` 0 is a coarser, slightly fattened hull used only for the outline (as the characters do).
 */

const W = PALETTE.world;
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type Lod = 0 | 1;

/** Nominal height (metres, at instance scale 1) of each tree kind: instance scales are chosen relative to these. */
export const TREE_HEIGHT = { broadleaf: 8, acacia: 6, snag: 5.4 } as const;
/** Trunk base radius of the local frame: instance scale = collision radius / this. */
export const TREE_BASE_RADIUS = 0.375;

const bark = (top: number, lift = 0.6): ColourFn => (p, n, out) => {
  blend(out, W.trunk, W.barkLight, (p.y / top) * lift + Math.max(0, n.x) * 0.12);
  if (p.y < 0.5) blend(out, W.trunk, W.moss, 0.25); // damp, mossy foot
};

function lobe(k: Kit, lod: Lod, at: V3, scale: V3, colour: ColourFn, seed: number, jitter = 0.13, detail: number = lod): void {
  const fat = lod ? 1 : 1.06;
  k.add(new IcosahedronGeometry(1, detail), { at, scale: [scale[0] * fat, scale[1] * fat, scale[2] * fat], colour, flat: true, jitter: jitter * (lod ? 1 : 0.7), seed });
}

/** Broadleaf: a leaning, tapered trunk, two limbs and a cluster of five or six crown lobes in two greens (deep underneath, sunlit on top). */
export function broadleafGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 7 : 5;
  const trunk: readonly (readonly [V3, number])[] = [
    [[0, -0.3, 0], 0.46],
    [[0.1, 1.5, 0.04], 0.33],
    [[0.02, 3.3, -0.06], 0.24],
    [[-0.14, 4.7, 0.04], 0.15],
  ];
  const bk = bark(4.7);
  for (let i = 0; i + 1 < trunk.length; i++) k.limb(trunk[i]![0], trunk[i + 1]![0], trunk[i]![1], trunk[i + 1]![1], bk, rad);
  k.limb([0.02, 3.3, -0.06], [1.15, 4.5, 0.6], 0.13, 0.07, bk, rad);
  k.limb([0.0, 3.6, -0.06], [-0.95, 4.3, -0.7], 0.12, 0.06, bk, rad);
  const crown = (tone: number): ColourFn => shaded(topLit(W.crownDeep, W.crown, W.crownLight, 0.3), tone);
  lobe(k, lod, [0.05, 5.7, 0], [2.0, 1.6, 1.9], crown(1), 11);
  lobe(k, lod, [1.35, 4.9, 0.55], [1.35, 1.05, 1.3], crown(0.95), 12);
  lobe(k, lod, [-1.25, 5.0, -0.6], [1.4, 1.1, 1.35], crown(1.06), 13);
  lobe(k, lod, [0.2, 6.9, -0.3], [1.3, 1.05, 1.25], crown(1.1), 14, 0.15, 0);
  lobe(k, lod, [-0.5, 4.5, 1.2], [1.0, 0.8, 1.0], crown(0.9), 15, 0.15, 0);
  lobe(k, lod, [0.7, 5.3, -1.3], [1.1, 0.9, 1.0], crown(1.02), 16, 0.15, 0);
  return k.build()!;
}

/** Acacia: a thin curved trunk that forks, carrying two flat dish canopies with a lighter sunlit skin. */
export function acaciaGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 6 : 5;
  const bk = bark(5, 0.5);
  k.limb([0, -0.3, 0], [0.2, 1.6, 0], 0.3, 0.2, bk, rad);
  k.limb([0.2, 1.6, 0], [0.6, 3.2, 0.1], 0.2, 0.16, bk, rad);
  k.limb([0.6, 3.2, 0.1], [1.1, 4.7, 0.1], 0.16, 0.09, bk, rad);
  k.limb([0.45, 2.7, 0.05], [-0.65, 4.2, 0.4], 0.11, 0.06, bk, rad);
  const dish = (tone: number): ColourFn => shaded(topLit(W.crownDeep, W.acacia, W.acaciaLight, 0.4), tone);
  const seg = lod ? 1 : 0;
  const fat = lod ? 1 : 1.06;
  const d = (at: V3, s: V3, tone: number, seed: number): void => {
    k.add(new IcosahedronGeometry(1, seg), { at, scale: [s[0] * fat, s[1] * fat, s[2] * fat], colour: dish(tone), flat: true, jitter: lod ? 0.07 : 0.05, seed });
  };
  d([1.1, 4.95, 0.1], [2.9, 0.62, 2.7], 1, 21);
  d([-0.85, 4.45, 0.5], [1.9, 0.46, 1.8], 0.94, 22);
  d([1.35, 5.5, -0.1], [1.5, 0.34, 1.4], 1.1, 23);
  return k.build()!;
}

/** A dead tree: bleached, cracked trunk broken off short, three bare limbs. */
export function snagGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 6 : 5;
  const dead: ColourFn = (p, _n, out) => {
    const crack = Math.sin(Math.atan2(p.z, p.x) * 5 + p.y * 1.7) * 0.5 + 0.5;
    blend(out, W.snag, W.trunk, crack * 0.42 + (1 - smooth(0, 1.2, p.y)) * 0.3);
  };
  k.limb([0, -0.3, 0], [-0.12, 1.5, 0], 0.4, 0.3, dead, rad);
  k.limb([-0.12, 1.5, 0], [0.1, 3.0, 0.05], 0.3, 0.21, dead, rad);
  k.limb([0.1, 3.0, 0.05], [0.0, 4.5, 0], 0.21, 0.12, dead, rad, true);
  k.limb([0.0, 2.3, 0], [1.3, 3.5, 0.3], 0.14, 0.05, dead, rad);
  k.limb([1.3, 3.5, 0.3], [2.0, 4.5, 0.5], 0.05, 0.025, dead, 4);
  k.limb([0.05, 3.1, 0.02], [-1.15, 4.5, -0.4], 0.11, 0.04, dead, rad);
  k.limb([-1.15, 4.5, -0.4], [-1.6, 5.4, -0.3], 0.04, 0.02, dead, 4);
  k.limb([0.0, 4.1, 0], [0.6, 5.5, 0.1], 0.08, 0.025, dead, 4);
  k.limb([-0.05, 2.0, 0.1], [-0.8, 2.7, 0.7], 0.07, 0.025, dead, 4);
  return k.build()!;
}

/** Low shrub: three overlapping lobes with a mossy shade. */
export function bushGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const c: ColourFn = topLit(W.crownDeep, W.moss, W.crownLight, 0.4);
  lobe(k, lod, [0, 0.5, 0], [0.9, 0.7, 0.9], c, 31, 0.08);
  lobe(k, lod, [0.6, 0.38, 0.3], [0.6, 0.5, 0.6], shaded(c, 1.08), 32, 0.06, 0);
  lobe(k, lod, [-0.5, 0.34, -0.3], [0.55, 0.45, 0.55], shaded(c, 0.92), 33, 0.06, 0);
  return k.build()!;
}

const cRockDark = new Color(W.rockDark);
const cMoss = new Color(W.moss);

/**
 * A chunky faceted rock: one big jittered block with two shoulders. Foot is dark and mossy, the flanks are boulder grey, upward
 * facets are pale and weathered. Local frame: sits on y = 0 (a little buried), about 1.2 tall, radius 1.
 */
export function boulderGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const c: ColourFn = (p, n, out) => {
    blend(out, W.boulder, W.rockPale, smooth(0.3, 0.8, n.y));
    const foot = 1 - smooth(-0.1, 0.5, p.y);
    out.lerp(n.y > 0.45 ? cMoss : cRockDark, foot * 0.5);
    if (n.y < -0.2) out.lerp(cRockDark, 0.4);
  };
  const fat = lod ? 1 : 1.05;
  const part = (detail: number, at: V3, s: V3, seed: number, rot: V3): void => {
    k.add(new IcosahedronGeometry(1, detail), { at, scale: [s[0] * fat, s[1] * fat, s[2] * fat], rot, colour: c, flat: true, jitter: lod ? 0.17 : 0.13, seed });
  };
  part(lod, [0, 0.36, 0], [1, 0.85, 1], 41, [0, 0.4, 0]);
  part(0, [0.55, 0.34, 0.24], [0.62, 0.5, 0.56], 42, [0.3, 1.1, 0]);
  part(0, [-0.5, 0.26, -0.3], [0.5, 0.42, 0.54], 43, [0, 2.0, 0.3]);
  return k.build()!;
}

/** A pebble: twenty jittered facets, pale on top and dark underneath. No ink line (too small to carry one). */
export function pebbleGeometry(): BufferGeometry {
  const k = new Kit();
  k.add(new IcosahedronGeometry(1, 0), { at: [0, 0.2, 0], scale: [1, 0.7, 1], colour: topLit(W.rockDark, W.pebble, W.rockPale, 0.3), flat: true, jitter: 0.16, seed: 47 });
  return k.build()!;
}

// ---- ground cover (raw buffers: many thin triangles, no hull, no shadow) ----------------------------------------------------------

function toGeometry(pos: number[], nor: number[], col: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * A grass tuft: seven single-triangle blades fanned round a point, leaning outward, dark at the root and bright at the tip.
 * Normals point mostly UP so a tuft is lit like the ground it grows from (no black backfaces, no shimmer). Height ~0.5.
 */
export function grassTuftGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const root = new Color(W.grassDeep);
  const tip = new Color(W.crownLight);
  const mid = new Color(W.grass);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.399963;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = 0.04 + 0.09 * ((i * 5) % 8) / 7;
    const h = 0.34 + 0.2 * (((i * 37) % 11) / 10);
    const lean = 0.1 + 0.14 * (((i * 53) % 7) / 6);
    const w = 0.042;
    const bx = ca * r0;
    const bz = sa * r0;
    // base left/right are perpendicular to the outward direction
    const lx = -sa * w;
    const lz = ca * w;
    pos.push(bx - lx, 0, bz - lz, bx + lx, 0, bz + lz, bx + ca * lean, h, bz + sa * lean);
    const nx = ca * 0.35;
    const nz = sa * 0.35;
    const nl = Math.hypot(nx, 1, nz);
    for (let v = 0; v < 3; v++) nor.push(nx / nl, 1 / nl, nz / nl);
    for (const c of [root, root, i % 2 ? tip : mid]) col.push(c.r, c.g, c.b);
  }
  return toGeometry(pos, nor, col);
}

/** A little wildflower: a stem and a six-petal head tilted toward the light. Petals are white so the instance colour paints the bloom. */
export function flowerGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const stem = new Color(W.crownDeep);
  const petal = new Color(0xffffff);
  const eye = new Color(W.dry);
  const h = 0.36;
  pos.push(-0.014, 0, 0, 0.014, 0, 0, 0, h, 0.02);
  for (let v = 0; v < 3; v++) nor.push(0, 1, 0);
  for (let v = 0; v < 3; v++) col.push(stem.r, stem.g, stem.b);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    const pt = (a: number, r: number): [number, number, number] => [Math.cos(a) * r, h + Math.sin(a) * r * 0.42, 0.02 + Math.sin(a) * r * 0.9];
    const c = pt(0, 0);
    const b0 = pt(a0, 0.115);
    const b1 = pt(a1, 0.115);
    pos.push(c[0], c[1] + 0.012, c[2], ...b0, ...b1);
    for (let v = 0; v < 3; v++) nor.push(0, 1, 0);
    col.push(eye.r, eye.g, eye.b, petal.r, petal.g, petal.b, petal.r, petal.g, petal.b);
  }
  return toGeometry(pos, nor, col);
}

/** Soft sphere used for small blobs (sacks, glints): low poly, smooth. */
export function blobGeometry(): SphereGeometry {
  return new SphereGeometry(1, 8, 6);
}
