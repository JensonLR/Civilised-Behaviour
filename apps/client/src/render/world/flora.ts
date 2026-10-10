import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry, SphereGeometry, TorusGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { Vector3 } from "three";
import { Kit, blend, jittered, shaded, topLit, type ColourFn, type V3 } from "./kit.ts";

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
export const TREE_HEIGHT = { broadleaf: 8, acacia: 6, snag: 5.4, birch: 7, pine: 8.6 } as const;
/** Trunk base radius of the local frame: instance scale = collision radius / this. */
export const TREE_BASE_RADIUS = 0.375;

const bark = (top: number, lift = 0.6): ColourFn => (p, n, out) => {
  blend(out, W.trunk, W.barkLight, (p.y / top) * lift + Math.max(0, n.x) * 0.12);
  if (p.y < 0.5) blend(out, W.trunk, W.moss, 0.25); // damp, mossy foot
};

function lobe(k: Kit, lod: Lod, at: V3, scale: V3, colour: ColourFn, seed: number, jitter = 0.13, detail: number = lod): void {
  const fat = lod ? 1 : 1.035;
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
  const fat = lod ? 1 : 1.035;
  const d = (at: V3, s: V3, tone: number, seed: number): void => {
    k.add(new IcosahedronGeometry(1, seg), { at, scale: [s[0] * fat, s[1] * fat, s[2] * fat], colour: dish(tone), flat: true, jitter: lod ? 0.07 : 0.05, seed });
  };
  d([1.1, 4.95, 0.1], [2.9, 0.62, 2.7], 1, 21);
  d([-0.85, 4.45, 0.5], [1.9, 0.46, 1.8], 0.94, 22);
  d([1.35, 5.5, -0.1], [1.5, 0.34, 1.4], 1.1, 23);
  return k.build()!;
}

/**
 * Silver birch: a slender, leaning white trunk with black lenticel dashes, a few thin limbs, and a tall, airy crown of small pale-green
 * lobes stacked like a feather. Local frame like the other trees (trunk base radius ~0.375 at scale 1, 7 m tall).
 */
export function birchGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 6 : 4;
  const bark: ColourFn = (p, n, out) => {
    const dash = Math.abs(Math.sin(Math.floor(p.y * 6.5) * 12.9898 + Math.atan2(p.z, p.x) * 3.1) * 43758.5453) % 1;
    blend(out, W.birchBark, W.birchMark, dash > 0.8 ? 0.85 : dash > 0.7 ? 0.25 : 0);
    if (p.y < 0.6) out.lerp(cMoss, 0.25);
    void n;
  };
  const trunk: readonly (readonly [V3, number])[] = [
    [[0, -0.3, 0], 0.3],
    [[0.08, 1.7, 0.03], 0.21],
    [[-0.04, 3.6, -0.04], 0.15],
    [[0.1, 5.3, 0.02], 0.09],
    [[0.02, 6.7, 0.0], 0.04],
  ];
  for (let i = 0; i + 1 < trunk.length; i++) k.limb(trunk[i]![0], trunk[i + 1]![0], trunk[i]![1], trunk[i + 1]![1], bark, rad);
  k.limb([0.06, 3.0, 0], [0.9, 4.5, 0.3], 0.07, 0.03, bark, rad);
  k.limb([0.0, 3.9, 0], [-0.8, 5.4, -0.3], 0.06, 0.03, bark, rad);
  const leaf = (tone: number): ColourFn => shaded(topLit(W.crownDeep, W.birchLeaf, W.crownLight, 0.3), tone);
  const seg = lod ? 1 : 0;
  const fat = lod ? 1 : 1.035;
  const l = (at: V3, s: V3, tone: number, seed: number): void => {
    k.add(new IcosahedronGeometry(1, seg), { at, scale: [s[0] * fat, s[1] * fat, s[2] * fat], colour: leaf(tone), flat: true, jitter: 0.1, seed });
  };
  l([0.05, 6.0, 0], [0.95, 0.8, 0.9], 1.02, 111);
  l([0.85, 4.7, 0.3], [0.8, 0.65, 0.75], 0.96, 112);
  l([-0.75, 5.3, -0.3], [0.8, 0.65, 0.78], 1.05, 113);
  l([0.1, 4.2, -0.6], [0.7, 0.55, 0.65], 0.9, 114);
  l([0.0, 7.0, 0.05], [0.55, 0.55, 0.55], 1.1, 115);
  return k.build()!;
}

/**
 * Scots pine-ish: a straight, orange-brown trunk bare for a third of its height, then five tiers of dark, ragged cones getting smaller
 * toward a pointed leader. Faceted, with a paler sunlit side. About 8.6 m tall.
 */
export function pineGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 6 : 4;
  const bark: ColourFn = (p, _n, out) => {
    blend(out, W.pineBark, W.trunk, 0.35 + 0.25 * Math.sin(p.y * 5 + Math.atan2(p.z, p.x) * 3));
    if (p.y < 0.5) out.lerp(cMoss, 0.25);
  };
  k.limb([0, -0.3, 0], [0.05, 3.2, 0], 0.3, 0.2, bark, rad);
  k.limb([0.05, 3.2, 0], [0, 8.4, 0.02], 0.2, 0.05, bark, rad);
  const tier = (y: number, r: number, h: number, tone: number, seed: number): void => {
    const c = new ConeGeometry(r * (lod ? 1 : 1.03), h, lod ? 7 : 5, 1, false);
    k.add(c, { at: [0, y + h / 2, 0], colour: shaded(topLit(W.pine, W.pineLight, W.crownLight, 0.5), tone), flat: true, jitter: lod ? 0.08 : 0.06, seed });
  };
  tier(2.6, 1.7, 2.2, 0.92, 121);
  tier(3.8, 1.45, 2.1, 1, 122);
  tier(5.0, 1.15, 1.9, 0.96, 123);
  tier(6.1, 0.85, 1.7, 1.04, 124);
  tier(7.1, 0.55, 1.5, 1.08, 125);
  return k.build()!;
}

/** A dead tree: bleached, cracked trunk broken off short, three bare limbs. */
export function snagGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 6 : 5;
  // (bark cracks only: a "dark foot" read the height in each limb's own frame, so every segment of the trunk began dark and the joints showed as
  // steps; where the snag meets the ground the contact band darkens it, D-079)
  const dead: ColourFn = (p, _n, out) => {
    const crack = Math.sin(Math.atan2(p.z, p.x) * 5 + p.y * 1.7) * 0.5 + 0.5;
    blend(out, W.snag, W.trunk, crack * 0.42 + 0.1);
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
const cStrata = new Color(W.rockStrata);
const cLichen = new Color(W.lichen);
const cBoulder = new Color(W.boulder);
const cPale = new Color(W.rockPale);
const cLichenO = new Color(W.lichenOrange);

/**
 * Rock colour: sedimentary strata (bands that wobble with angle), a dark mossy foot, pale weathered upward facets, moss creeping up
 * the shaded flanks and hashed lichen freckles. Pure function of the vertex, so the hull and the mesh agree.
 */
const rockColour: ColourFn = (p, n, out) => {
  const ang = Math.atan2(p.z, p.x);
  const band = Math.floor((p.y + Math.sin(ang * 3 + p.y * 2.3) * 0.07) * 6.5);
  out.copy(cBoulder).lerp(cStrata, ((band % 2) + 2) % 2 === 0 ? 0.6 : 0.05);
  if (band % 5 === 0) out.lerp(cRockDark, 0.28); // a dark seam
  out.lerp(cPale, smooth(0.3, 0.85, n.y) * 0.85);
  const foot = 1 - smooth(-0.1, 0.55, p.y);
  out.lerp(n.y > 0.35 ? cMoss : cRockDark, foot * 0.55);
  if (n.y < -0.2) out.lerp(cRockDark, 0.45);
  // moss on the north-ish side of the flanks and lichen speckles
  const h = Math.abs(Math.sin(Math.floor(p.x * 5) * 12.9898 + Math.floor(p.y * 5) * 78.233 + Math.floor(p.z * 5) * 37.719) * 43758.5453) % 1;
  if (n.y > 0.1 && n.y < 0.7 && h > 0.86) out.lerp(cLichen, 0.7);
  else if (n.y > 0.55 && h > 0.5) out.lerp(cMoss, 0.35);
  // orange crust lichen in bigger rosettes on the sunny flanks (coarser hash cells than the speckle above)
  const hl = Math.abs(Math.sin(Math.floor(p.x * 2.4) * 41.13 + Math.floor(p.y * 2.4) * 97.31 + Math.floor(p.z * 2.4) * 17.77) * 24634.6345) % 1;
  if (n.y > -0.1 && n.y < 0.8 && p.y > 0.32 && hl > 0.9) out.lerp(cLichenO, 0.72);
};

/**
 * The leaning slabs: a weathered sedimentary outcrop. Thin strata (each course its own tone, a dark seam between), vertical cracks where
 * frost has got in, moss on every upward face and up from the foot in drips, orange lichen rosettes and a pale, sun-bleached top edge.
 * A pure function of the vertex, so the ink hull (the same mesh) agrees.
 */
const slabColour: ColourFn = (p, n, out) => {
  const layerF = (p.y + 0.02) * 5.2;
  const layer = Math.floor(layerF);
  const lt = Math.abs(Math.sin(layer * 12.9898 + 4.1) * 43758.5453) % 1;
  out.copy(cBoulder).lerp(cStrata, layer % 2 === 0 ? 0.55 : 0.12);
  if (lt > 0.72) out.lerp(cRockDark, 0.28 + lt * 0.2);
  else if (lt < 0.22) out.lerp(cPale, 0.35);
  const seam = layerF - layer;
  if (seam < 0.14) out.lerp(cRockDark, 0.5);
  // frost cracks: thin dark verticals that wander with height
  const crack = Math.abs(((p.x + Math.sin(p.y * 3.1 + layer) * 0.05) * 2.6) % 1 - 0.5);
  if (crack < 0.035 && n.y < 0.6) out.lerp(cRockDark, 0.6);
  if (n.y > 0.5) {
    out.lerp(cMoss, 0.62);
    if (Math.abs(Math.sin(p.x * 17.0 + p.z * 11.0)) > 0.8) out.lerp(cPale, 0.25);
  } else {
    // moss drips down the faces from the top and creeps up from the foot
    const h = Math.abs(Math.sin(Math.floor(p.x * 6) * 12.9898 + Math.floor(p.z * 6) * 78.233) * 43758.5453) % 1;
    const drip = h > 0.55 ? smooth(0.55, 1.15, p.y) * 0.5 : 0;
    const foot = 1 - smooth(-0.1, 0.5, p.y);
    out.lerp(cMoss, Math.min(0.75, drip + foot * 0.6));
  }
  const hl = Math.abs(Math.sin(Math.floor(p.x * 2.6) * 41.13 + Math.floor(p.y * 3.4) * 97.31 + Math.floor(p.z * 2.6) * 17.77) * 24634.6345) % 1;
  if (n.y > -0.2 && n.y < 0.6 && hl > 0.86) out.lerp(cLichenO, 0.75);
};

/**
 * A chunky faceted rock: one big jittered block with two shoulders and strata. Foot is dark and mossy, the flanks are boulder grey
 * banded with seams, upward facets are pale and weathered, with moss and lichen. Local frame: sits on y = 0 (a little buried), about
 * 1.2 tall, radius 1.
 */
export function boulderGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  // The hull is the SAME mesh (a coarser, fattened hull shows as thick black slabs when a boulder is at arm's length; rocks are few).
  const part = (detail: number, at: V3, s: V3, seed: number, rot: V3): void => {
    k.add(new IcosahedronGeometry(1, detail), { at, scale: s, rot, colour: rockColour, perFace: true, jitter: 0.17, seed });
  };
  part(1, [0, 0.36, 0], [1, 0.85, 1], 41, [0, 0.4, 0]);
  part(0, [0.55, 0.34, 0.24], [0.62, 0.5, 0.56], 42, [0.3, 1.1, 0]);
  part(0, [-0.5, 0.26, -0.3], [0.5, 0.42, 0.54], 43, [0, 2.0, 0.3]);
  return k.build()!;
}

/**
 * A leaning slab of layered stone (a standing stone / tilted outcrop): a tall main plate, a shorter one propped against it, a fallen
 * chunk at the foot and an overhanging, mossy capstone. Local frame: x +-0.95, z +-0.5, about 1.2 tall, sits on y = 0.
 */
export function slabGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  void lod; // the hull is the same mesh: a fattened coarse hull shows as thick black slabs up close
  k.add(new BoxGeometry(1.5, 1.2, 0.62, 2, 7, 1), { at: [0.05, 0.58, 0], rot: [0.06, 0.35, -0.16], colour: slabColour, perFace: true, jitter: 0.07, seed: 61 });
  k.add(new BoxGeometry(1.0, 0.78, 0.4, 2, 5, 1), { at: [-0.62, 0.36, 0.42], rot: [-0.12, 0.85, 0.1], colour: slabColour, perFace: true, jitter: 0.05, seed: 64 });
  k.add(new BoxGeometry(0.9, 0.46, 0.7), { at: [-0.5, 0.2, -0.36], rot: [0.1, 0.8, 0.05], colour: slabColour, flat: true, jitter: 0.05, seed: 62 });
  k.add(new IcosahedronGeometry(0.42, 0), { at: [0.62, 0.2, -0.32], colour: slabColour, flat: true, jitter: 0.08, seed: 63 });
  // the capstone: a broad, thin lid that overhangs its plate
  k.add(new BoxGeometry(1.35, 0.15, 0.78, 2, 1, 1), { at: [0.12, 1.17, 0.03], rot: [0.06, 0.38, -0.2], colour: slabColour, perFace: true, jitter: 0.05, seed: 65 });
  return k.build()!;
}


/**
 * A crag: a stratified escarpment. Local frame: x along the contour (-1..1), y up (0..1), z across it (+z is the exposed, downhill face, -z is buried in the
 * hillside), scaled by the instance to the cliff's length, height and depth. Seven courses of sedimentary stone, each its own tone, stepping in and
 * out so every other one is a ledge with a mossy top; a dark seam between courses, a frost fissure, an overhanging capstone with moss drips, and
 * rubble at the foot. One merged mesh; the ink hull is the same mesh.
 */
export function cliffGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const thick = [0.17, 0.15, 0.15, 0.14, 0.13, 0.13, 0.13];
  const front = [1.0, 0.7, 0.92, 0.62, 0.84, 0.58, 0.76];
  const tones = [cStrata, cBoulder, cPale, cStrata, cBoulder, cRockDark, cPale];
  let y = -0.02;
  thick.forEach((t, i) => {
    const w = [1.0, 0.88, 0.96, 0.76, 0.84, 0.6, 0.68][i]!;
    const back = -0.92;
    const zc = (front[i]! + back) / 2;
    const seg = lod ? 5 : 2;
    k.add(new BoxGeometry(w * 2, t + 0.02, front[i]! - back, seg, 1, lod ? 2 : 1), {
      at: [[0, 0.09, -0.07, 0.14, -0.12, 0.06, -0.02][i]!, y + t / 2, zc],
      rot: [0, ((i % 2) - 0.5) * 0.04, ((i * 5) % 3 - 1) * 0.025],
      colour: (p, n, out) => {
        out.copy(tones[i]!);
        const h = Math.abs(Math.sin(Math.floor((p.x + 1.3) * 4.0) * 12.9898 + i * 37.719) * 43758.5453) % 1;
        out.lerp(cRockDark, h > 0.72 ? 0.25 : 0);
        if (n.y > 0.5) {
          // the ledge top: moss and a pale weathered lip
          out.lerp(cMoss, 0.55);
          if (h < 0.22) out.lerp(cPale, 0.4);
        } else if (n.y < -0.5) out.lerp(cRockDark, 0.6);
        else {
          const drip = Math.abs(Math.sin(Math.floor((p.x + 1.3) * 5.0) * 78.233 + i)) > 0.7 ? 0.4 : 0;
          out.lerp(cMoss, drip * (i / 6));
          if (p.y - y > t * 0.86) out.lerp(cRockDark, 0.3); // the seam under the next course
          if (h > 0.9) out.lerp(cLichenO, 0.7);
        }
      },
      perFace: lod === 1,
      flat: lod === 0,
      jitter: lod ? 0.03 : 0.02,
      seed: 900 + i,
    });
    y += t;
  });
  // the capstone overhangs the face
  k.add(new BoxGeometry(2.1, 0.09, 2.15, lod ? 6 : 2, 1, 2), { at: [0.02, y + 0.03, 0.14], rot: [0.03, 0.02, -0.02], colour: (p, n, out) => (n.y > 0.5 ? out.copy(cMoss).lerp(cPale, 0.25 + 0.2 * Math.sin(p.x * 9)) : out.copy(cRockDark)), perFace: lod === 1, flat: lod === 0, jitter: 0.03, seed: 920 });
  if (lod) {
    // fallen blocks against both ends of the face, and rubble at the foot
    for (const sx of [-1, 1]) k.add(new IcosahedronGeometry(1, 0), { at: [sx * 1.02, 0.11, 0.55], scale: [0.2, 0.2, 0.55], rot: [0, sx * 0.4, 0], colour: rockColour, flat: true, jitter: 0.06, seed: 950 + sx });
    // a frost fissure down the face
    k.add(new BoxGeometry(0.035, 0.7, 0.05), { at: [0.3, 0.5, 0.86], rot: [0, 0, 0.07], colour: W.rockDark, flat: true });
    k.add(new BoxGeometry(0.03, 0.5, 0.05), { at: [-0.55, 0.62, 0.62], rot: [0, 0, -0.05], colour: W.rockDark, flat: true });
    for (let i = 0; i < 6; i++) {
      const r = 0.08 + ((i * 53) % 7) * 0.012;
      // (against the face's foot and sunk into the scree: in front of it, an instance on a slope left them in the air)
      k.add(new IcosahedronGeometry(r, 0), { at: [-1.05 + i * 0.4 + ((i * 17) % 5) * 0.03, r * 0.15, 1.0 + r * 0.7], scale: [0.7, 0.7, 1.3], colour: rockColour, flat: true, jitter: 0.02, seed: 930 + i });
    }
  }
  return k.build()!;
}

/**
 * A flat stepping stone: a thick slab with a worn, pale top and a dark rim, seven-sided and a little irregular. Local frame: radius 1,
 * 0.2 tall, base at y = 0. Scaled by the instance (0.3 m stones); no ink (too flat and small to carry a line).
 */
export function flagstoneGeometry(): BufferGeometry {
  const k = new Kit();
  const g = new CylinderGeometry(1, 1.06, 0.2, 7, 1);
  k.add(g, {
    at: [0, 0.1, 0],
    colour: (p, n, out) => {
      if (n.y > 0.5) blend(out, W.rockPale, W.pebble, 0.2 + 0.5 * Math.abs(Math.sin(p.x * 9 + p.z * 7)));
      else blend(out, W.rockDark, W.boulder, 0.4);
      if (n.y > 0.5 && Math.abs(Math.sin(p.x * 21 + p.z * 13)) > 0.94) out.lerp(cMoss, 0.5);
    },
    flat: true,
    jitter: 0.045,
    seed: 91,
  });
  return k.build()!;
}

/**
 * A lily pad: a flat, slightly cupped disc with a notch cut out, veined, with a small pink bud at its heart. Local frame: radius 1, on y = 0,
 * about 20 triangles. Scaled 0.25-0.5 m by the instance and laid on the water.
 */
export function lilyGeometry(): BufferGeometry {
  const s = new Soup();
  const pad = new Color(W.lily);
  const padLight = new Color(W.crownLight);
  const rim = new Color(W.grassDeep);
  const bud = new Color(W.lilyFlower);
  const N = 9;
  const notch = 0.5; // radians left open
  for (let i = 0; i < N; i++) {
    const a0 = notch / 2 + (i / N) * (Math.PI * 2 - notch);
    const a1 = notch / 2 + ((i + 1) / N) * (Math.PI * 2 - notch);
    const p0: V3 = [Math.cos(a0), 0.04, Math.sin(a0)];
    const p1: V3 = [Math.cos(a1), 0.04, Math.sin(a1)];
    const mid: V3 = [Math.cos((a0 + a1) / 2) * 0.55, 0.0, Math.sin((a0 + a1) / 2) * 0.55];
    // an inner ring and an outer rim, so the pad has a cupped edge and a paler centre
    s.tri([0, 0.01, 0], mid, [Math.cos(a0) * 0.55, 0.0, Math.sin(a0) * 0.55], padLight, [0, 1, 0]);
    s.tri([Math.cos(a0) * 0.55, 0.0, Math.sin(a0) * 0.55], p0, p1, pad, [0, 1, 0], 0, rim, rim);
    s.tri([Math.cos(a0) * 0.55, 0.0, Math.sin(a0) * 0.55], p1, mid, pad, [0, 1, 0], 0, rim, pad);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    s.tri([0, 0.02, 0], [Math.cos(a - 0.4) * 0.16, 0.05, Math.sin(a - 0.4) * 0.16], [Math.cos(a) * 0.05, 0.22, Math.sin(a) * 0.05], bud, [Math.cos(a), 0.5, Math.sin(a)]);
  }
  return s.build();
}

/** A pebble: twenty jittered facets, pale on top and dark underneath. No ink line (too small to carry one). */
export function pebbleGeometry(): BufferGeometry {
  const k = new Kit();
  k.add(new IcosahedronGeometry(1, 0), { at: [0, 0.2, 0], scale: [1, 0.7, 1], colour: topLit(W.rockDark, W.pebble, W.rockPale, 0.3), flat: true, jitter: 0.16, seed: 47 });
  return k.build()!;
}

// ---- ground cover (raw buffers: many thin triangles, no hull, no shadow) ----------------------------------------------------------

/** Accumulates loose triangles with explicit normals, colours and a per-vertex "tint" weight (1 = the instance colour paints it). */
class Soup {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly tint: number[] = [];

  tri(a: V3, b: V3, c: V3, colour: Color, n: V3 = [0, 1, 0], tint = 0, colourB?: Color, colourC?: Color): this {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const cs = [colour, colourB ?? colour, colourC ?? colour];
    [a, b, c].forEach((v, i) => {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(n[0] / l, n[1] / l, n[2] / l);
      this.col.push(cs[i]!.r, cs[i]!.g, cs[i]!.b);
      this.tint.push(tint);
    });
    return this;
  }

  get count(): number {
    return this.pos.length / 9;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute("aTint", new BufferAttribute(new Float32Array(this.tint), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A grass tuft: seven single-triangle blades fanned round a point, leaning outward, dark at the root and bright at the tip.
 * Normals point mostly UP so a tuft is lit like the ground it grows from (no black backfaces, no shimmer). Height ~0.5.
 */
export function grassTuftGeometry(): BufferGeometry {
  const s = new Soup();
  const root = new Color(W.grassDeep);
  const tip = new Color(W.crownLight);
  const mid = new Color(W.grass);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.399963;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = 0.04 + (0.09 * ((i * 5) % 8)) / 7;
    const h = 0.34 + 0.2 * (((i * 37) % 11) / 10);
    const lean = 0.1 + 0.14 * (((i * 53) % 7) / 6);
    const w = 0.042;
    const bx = ca * r0;
    const bz = sa * r0;
    const lx = -sa * w;
    const lz = ca * w;
    const nx = ca * 0.35;
    const nz = sa * 0.35;
    s.tri([bx - lx, 0, bz - lz], [bx + lx, 0, bz + lz], [bx + ca * lean, h, bz + sa * lean], root, [nx, 1, nz], 0, root, i % 2 ? tip : mid);
  }
  return s.build();
}

/**
 * A clump of ripe barley (D-046, the Reapers' Strike's field): eight upright stalks, each with an ear nodding at the top (two half-diamonds in crossed planes, so it has body from
 * every side at three triangles a stalk: Highmark's triangle budget holds), straw at the root and pale
 * gold at the ear. Planted in rows by the scatter, it reads as a crop where the savannah's tufts read as wild grass. Height ~0.95. Normals mostly up, like the grass.
 */
export function barleyGeometry(): BufferGeometry {
  const s = new Soup();
  const H = PALETTE.highmark;
  const root = new Color(H.grassGoldDeep);
  const stalk = new Color(H.grassGold);
  const ear = new Color(H.grassGoldPale);
  for (let i = 0; i < 8; i++) {
    const a = i * 2.399963;
    const ca = Math.cos(a), sa = Math.sin(a);
    const r0 = 0.02 + (0.1 * ((i * 5) % 8)) / 7;
    const h = 0.8 + 0.18 * (((i * 37) % 11) / 10);
    const lean = 0.04 + 0.06 * (((i * 53) % 7) / 6);
    const bx = ca * r0, bz = sa * r0;
    const tx = bx + ca * lean, tz = bz + sa * lean;
    const w = 0.012;
    const n: V3 = [ca * 0.3, 1, sa * 0.3];
    s.tri([bx - sa * w, 0, bz + ca * w], [bx + sa * w, 0, bz - ca * w], [tx, h, tz], root, n, 0, root, stalk);
    // the ear: from just below the top of the stalk to a tip nodding outward
    const droop = 0.06, ew = 0.032;
    const lo: V3 = [tx, h - 0.04, tz];
    const hi: V3 = [tx + ca * droop, h + 0.16, tz + sa * droop];
    const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, cy = h + 0.06;
    s.tri(lo, [cx - sa * ew, cy, cz + ca * ew], hi, stalk, n, 0, ear, ear);   // across the lean
    s.tri(lo, hi, [cx - ca * ew, cy, cz - sa * ew], stalk, n, 0, ear, ear);   // along it
  }
  return s.build();
}

const cStem = new Color(W.fern);
const cStemTop = new Color(W.crownLight);
const cLeaf = new Color(W.fern);
const cWhite = new Color(0xffffff);
const cEye = new Color(W.bloomYellow);
const cEyeDark = new Color(W.dry);

/** A slightly curved stem and two leaves; returns the head anchor. */
function stemAndLeaves(s: Soup, h: number, bend: number): void {
  const w = 0.014;
  const mid: V3 = [bend * 0.5, h * 0.5, 0];
  const top: V3 = [bend, h, 0.02];
  s.tri([-w, 0, 0], [w, 0, 0], [mid[0] + 0, mid[1], 0.006], cStem, [0, 1, 0.2]);
  s.tri([w, 0, 0], [mid[0] + w, mid[1], 0.006], [mid[0] - w, mid[1], 0.006], cStem, [0, 1, 0.2]);
  s.tri([mid[0] - w, mid[1], 0.006], [mid[0] + w, mid[1], 0.006], [top[0], top[1], top[2]], cStem, [0, 1, 0.2], 0, cStem, cStemTop);
  // two leaves, opposite, lifting away from the stem
  const leaf = (y: number, dir: number, len: number): void => {
    const x0 = bend * (y / h) * 0.6;
    s.tri([x0, y, 0], [x0 + dir * len * 0.5, y + 0.035, 0.03], [x0 + dir * len, y + 0.05, 0], cLeaf, [dir * 0.3, 1, 0.3]);
    s.tri([x0, y, 0], [x0 + dir * len * 0.5, y + 0.035, -0.03], [x0 + dir * len, y + 0.05, 0], cLeaf, [dir * 0.3, 1, -0.3]);
  };
  leaf(h * 0.22, -1, 0.13);
  leaf(h * 0.36, 1, 0.11);
}

/**
 * A daisy-type blossom: eight petals round a two-tone eye on a curved stem with two leaves. Petals are white and carry tint 1, so the
 * instance colour paints the bloom while the stem, leaves and eye keep their own colours. Height ~0.4, 30 triangles.
 */
export function daisyGeometry(): BufferGeometry {
  const s = new Soup();
  const h = 0.36;
  const bend = 0.03;
  stemAndLeaves(s, h, bend);
  const tilt = 0.42;
  const P = (u: number, v: number, lift = 0): V3 => [bend + u, h + v * tilt + lift, 0.02 + v * 0.92];
  const N: V3 = [0, 1, 0.35];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const ca = Math.cos(a0);
    const sa = Math.sin(a0);
    const px = -sa * 0.032;
    const pz = ca * 0.032;
    const r0 = 0.03;
    const r1 = 0.13;
    const base: V3 = P(ca * r0, sa * r0, 0.008);
    const tip: V3 = P(ca * r1, sa * r1, -0.012);
    const l: V3 = P(ca * (r0 + r1) * 0.4 + px, sa * (r0 + r1) * 0.4 + pz, 0.012);
    const r: V3 = P(ca * (r0 + r1) * 0.4 - px, sa * (r0 + r1) * 0.4 - pz, 0.012);
    s.tri(base, l, tip, cWhite, N, 1);
    s.tri(base, tip, r, cWhite, N, 1);
  }
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    s.tri(P(0, 0, 0.026), P(Math.cos(a0) * 0.035, Math.sin(a0) * 0.035, 0.012), P(Math.cos(a1) * 0.035, Math.sin(a1) * 0.035, 0.012), i % 2 ? cEye : cEyeDark, N);
  }
  return s.build();
}

/** A cup-shaped blossom (tulip-like): five upright petals on a curved stem with two leaves. Petals carry tint 1. Height ~0.4, 23 triangles. */
export function cupGeometry(): BufferGeometry {
  const s = new Soup();
  const h = 0.32;
  const bend = -0.025;
  stemAndLeaves(s, h, bend);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const at = (r: number, y: number, side = 0): V3 => [bend + ca * r - sa * side, h + y, 0.02 + sa * r + ca * side];
    const n: V3 = [ca * 0.5, 1, sa * 0.5];
    const base = at(0.006, 0);
    const midL = at(0.05, 0.06, -0.04);
    const midR = at(0.05, 0.06, 0.04);
    const tip = at(0.03, 0.15);
    s.tri(base, midL, midR, cWhite, n, 1);
    s.tri(midL, tip, midR, cWhite, n, 1);
  }
  s.tri([bend - 0.03, h + 0.005, 0.02], [bend + 0.03, h + 0.005, 0.02], [bend, h + 0.05, 0.02 + 0.03], cEye, [0, 1, 0]);
  return s.build();
}

/** Reeds and cattails: five arching blades and two brown seed-heads on straight stalks. Height ~1.3, 18 triangles. */
export function reedGeometry(): BufferGeometry {
  const s = new Soup();
  const root = new Color(W.grassDeep);
  const blade = new Color(W.reed);
  const tip = new Color(W.crownLight);
  for (let i = 0; i < 5; i++) {
    const a = i * 2.399963 + 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 0.95 + 0.4 * (((i * 37) % 11) / 10);
    const lean = 0.18 + 0.16 * (((i * 53) % 7) / 6);
    const w = 0.035;
    const lx = -sa * w;
    const lz = ca * w;
    const r0 = 0.05 + 0.03 * i;
    const bx = ca * r0;
    const bz = sa * r0;
    // lower half rises nearly straight, upper half arches over
    const mx = bx + ca * lean * 0.25;
    const mz = bz + sa * lean * 0.25;
    s.tri([bx - lx, 0, bz - lz], [bx + lx, 0, bz + lz], [mx + lx * 0.7, h * 0.55, mz + lz * 0.7], root, [ca * 0.3, 1, sa * 0.3], 0, root, blade);
    s.tri([bx - lx, 0, bz - lz], [mx + lx * 0.7, h * 0.55, mz + lz * 0.7], [mx - lx * 0.7, h * 0.55, mz - lz * 0.7], root, [ca * 0.3, 1, sa * 0.3], 0, blade, blade);
    s.tri([mx - lx * 0.7, h * 0.55, mz - lz * 0.7], [mx + lx * 0.7, h * 0.55, mz + lz * 0.7], [bx + ca * lean, h, bz + sa * lean], blade, [ca * 0.5, 1, sa * 0.5], 0, blade, tip);
  }
  const brown = new Color(W.cattail);
  const brownDark = new Color(W.trunk);
  for (let i = 0; i < 2; i++) {
    const x = i ? 0.12 : -0.1;
    const z = i ? -0.05 : 0.08;
    const top = i ? 1.28 : 1.45;
    const sw = 0.008;
    s.tri([x - sw, 0, z], [x + sw, 0, z], [x, top - 0.28, z], cStem, [0, 1, 0.3]);
    // seed head: a four-sided spindle
    const y0 = top - 0.3;
    const y1 = top;
    const r = 0.038;
    const ring: V3[] = [
      [x + r, y0 + 0.08, z],
      [x, y0 + 0.08, z + r],
      [x - r, y0 + 0.08, z],
      [x, y0 + 0.08, z - r],
    ];
    for (let k = 0; k < 4; k++) {
      const a = ring[k]!;
      const b = ring[(k + 1) % 4]!;
      s.tri([x, y0, z], b, a, brownDark, [(a[0] + b[0]) / 2 - x, 0.4, (a[2] + b[2]) / 2 - z]);
      s.tri(a, b, [x, y1, z], brown, [(a[0] + b[0]) / 2 - x, 0.6, (a[2] + b[2]) / 2 - z]);
    }
  }
  // (the clump is sunk 8 cm: its blades spread up to 17 cm from the instance's foot, and on a slope the outer ones stood off the ground)
  return s.build().translate(0, -0.08, 0);
}

/** A fern: five fronds arching outward, each a rib with three pairs of leaflets (about 30 triangles). Height ~0.6. */
export function fernGeometry(): BufferGeometry {
  const s = new Soup();
  const dark = new Color(W.crownDeep);
  const leaf = new Color(W.fern);
  const light = new Color(W.crownLight);
  for (let f = 0; f < 5; f++) {
    const a = (f / 5) * Math.PI * 2 + 0.2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const len = 0.55 + 0.12 * ((f * 7) % 3);
    const rise = 0.42;
    // rib points: outward and up, then drooping; every rib springs from the one crown at the root (t = 0), a little into the soil
    const pt = (t: number): V3 => [ca * len * t, -0.015 + 0.045 * Math.min(1, t * 8) + rise * Math.sin(t * 2.2) * (1 - t * 0.35), sa * len * t];
    for (let k = 0; k < 4; k++) {
      const t0 = (k / 4) * 1.08;
      const t1 = ((k + 1) / 4) * 1.08;
      const p0 = pt(t0);
      const p1 = pt(t1);
      const wd = 0.11 * (1 - t0 * 0.75);
      const px = -sa * wd;
      const pz = ca * wd;
      // one leaflet pair per rib segment, drawn as two triangles fanning from the rib
      const c0 = k === 0 ? dark : leaf;
      s.tri(p0, [p1[0] + px, p1[1] - 0.02, p1[2] + pz], p1, c0, [0.1, 1, 0.1], 0, leaf, k === 3 ? light : leaf);
      s.tri(p0, p1, [p1[0] - px, p1[1] - 0.02, p1[2] - pz], c0, [0.1, 1, 0.1], 0, k === 3 ? light : leaf, leaf);
    }
    // the curled tip hangs off the rib's last point (shared, so it is one piece with the frond)
    const end = pt(1.08);
    const tipP = pt(1.13);
    s.tri(end, [tipP[0], tipP[1] - 0.06, tipP[2]], [tipP[0] - sa * 0.02, tipP[1], tipP[2] + ca * 0.02], leaf, [0.1, 1, 0.1], 0, leaf, light);
  }
  return s.build();
}

/** A toadstool: tapered stem, domed red cap with cream spots. Height 1, cap radius ~0.45 (about 34 triangles); scale it small. */
export function mushroomGeometry(): BufferGeometry {
  const s = new Soup();
  const stem = new Color(W.stemPale);
  const stemDark = new Color(W.mud);
  const cap = new Color(W.capRed);
  const capDark = new Color(W.rockDark);
  const spot = new Color(W.capSpot);
  const sides = 5;
  const R0 = 0.16;
  const R1 = 0.11;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const b0: V3 = [Math.cos(a0) * R0, 0, Math.sin(a0) * R0];
    const b1: V3 = [Math.cos(a1) * R0, 0, Math.sin(a1) * R0];
    const t0: V3 = [Math.cos(a0) * R1, 0.55, Math.sin(a0) * R1];
    const t1: V3 = [Math.cos(a1) * R1, 0.55, Math.sin(a1) * R1];
    const n: V3 = [Math.cos((a0 + a1) / 2), 0.3, Math.sin((a0 + a1) / 2)];
    s.tri(b0, b1, t1, stemDark, n, 0, stemDark, stem);
    s.tri(b0, t1, t0, stemDark, n, 0, stem, stem);
  }
  // cap: a shallow dome in two rings
  const sidesC = 6;
  const rings: [number, number][] = [[0.46, 0.5], [0.34, 0.68], [0.0, 0.8]];
  for (let i = 0; i < sidesC; i++) {
    const a0 = (i / sidesC) * Math.PI * 2;
    const a1 = ((i + 1) / sidesC) * Math.PI * 2;
    const pt = (r: number, y: number, a: number): V3 => [Math.cos(a) * r, y, Math.sin(a) * r];
    const n: V3 = [Math.cos((a0 + a1) / 2) * 0.6, 1, Math.sin((a0 + a1) / 2) * 0.6];
    // underside skirt, then two upper bands
    s.tri([0, 0.5, 0], pt(0.46, 0.5, a1), pt(0.46, 0.5, a0), capDark, [0, -1, 0]);
    s.tri(pt(rings[0]![0], rings[0]![1], a0), pt(rings[0]![0], rings[0]![1], a1), pt(rings[1]![0], rings[1]![1], a1), cap, n);
    s.tri(pt(rings[0]![0], rings[0]![1], a0), pt(rings[1]![0], rings[1]![1], a1), pt(rings[1]![0], rings[1]![1], a0), cap, n);
    s.tri(pt(rings[1]![0], rings[1]![1], a0), pt(rings[1]![0], rings[1]![1], a1), [0, rings[2]![1], 0], cap, n);
  }
  for (const [a, r] of [[0.5, 0.3], [2.4, 0.26], [4.2, 0.28]] as const) {
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const y = 0.5 + (0.46 - r) * 0.7 + 0.16;
    s.tri([cx - 0.05, y, cz], [cx + 0.05, y, cz], [cx, y + 0.01, cz + 0.06], spot, [0, 1, 0]);
  }
  return s.build();
}

/** Soft sphere used for small blobs (sacks, glints): low poly, smooth. */
export function blobGeometry(): SphereGeometry {
  return new SphereGeometry(1, 8, 6);
}

// ---- stumps, logs and berry bushes -------------------------------------------------------------------------------------------------------

const cBarkDark = new Color(W.trunk);
const cBarkLight = new Color(W.barkLight);
const cCut = new Color(W.logCut);
const cRing = new Color(W.ringDark);

/** Tree-ring colour on a cut end: pale wood with dark concentric rings from the centre. */
const cutColour = (cx: number, cz: number): ColourFn => (p, _n, out) => {
  const r = Math.hypot(p.x - cx, p.z - cz);
  out.copy(cCut).lerp(cRing, Math.floor(r * 9) % 2 === 0 ? 0.5 : 0.08);
};

const barkColour: ColourFn = (p, n, out) => {
  const a = Math.atan2(p.z, p.x);
  out.copy(cBarkDark).lerp(cBarkLight, (Math.sin(a * 7 + p.y * 3) * 0.5 + 0.5) * 0.35);
  if (p.y < 0.2) out.lerp(cMoss, 0.4);
  else if (n.y > 0.5) out.lerp(cMoss, 0.3);
};

/** A stump: root flare, barked sides, and a cut top with tree rings. Local frame: radius 1, height 1, sits on y = 0. */
export function stumpGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 9 : 6;
  k.add(new CylinderGeometry(0.86, 1, 1, rad, 1, true), { at: [0, 0.5, 0], colour: barkColour, flat: true, jitter: 0.03, seed: 71 });
  const top = new CylinderGeometry(0.86, 0.86, 0.02, rad);
  k.add(top, { at: [0, 0.99, 0], colour: (p, n, out) => (n.y > 0.5 ? cutColour(0, 0)(p, n, out) : barkColour(p, n, out)), flat: true, jitter: 0.015, seed: 72 });
  if (lod) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      k.limb([Math.cos(a) * 0.7, 0.35, Math.sin(a) * 0.7], [Math.cos(a) * 1.35, -0.02, Math.sin(a) * 1.35], 0.2, 0.1, barkColour, 5);
    }
  }
  return k.build()!;
}

/** A fallen log: barked trunk lying along +x with cut ends, a broken branch stub and moss on top. Local frame: length 2 (x +-1), radius 0.5, sits on y = 0. */
export function logGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const rad = lod ? 9 : 6;
  const body = new CylinderGeometry(0.5, 0.5, 2, rad, 1, true);
  body.rotateZ(Math.PI / 2);
  k.add(body, { at: [0, 0.46, 0], colour: barkColour, flat: true, jitter: 0.035, seed: 81 });
  for (const sx of [-1, 1]) {
    const cap = new CylinderGeometry(0.5, 0.5, 0.02, rad);
    cap.rotateZ(Math.PI / 2);
    k.add(cap, { at: [sx * 1.0, 0.46, 0], colour: (p, n, out) => (Math.abs(n.x) > 0.5 ? cutColour(0, 0)(new Vector3(p.z, 0, p.y - 0.46), n, out) : barkColour(p, n, out)), flat: true });
  }
  if (lod) k.limb([0.1, 0.8, 0.3], [0.45, 1.15, 0.55], 0.09, 0.06, barkColour, 5, true);
  return k.build()!;
}

/** A shrub in fruit: the bush's three lobes plus a scatter of berries (red and blue) sitting on the crown. */
export function berryBushGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const c: ColourFn = topLit(W.crownDeep, W.moss, W.crownLight, 0.4);
  lobe(k, lod, [0, 0.5, 0], [0.9, 0.7, 0.9], c, 31, 0.08);
  lobe(k, lod, [0.6, 0.38, 0.3], [0.6, 0.5, 0.6], shaded(c, 1.08), 32, 0.06, 0);
  lobe(k, lod, [-0.5, 0.34, -0.3], [0.55, 0.45, 0.55], shaded(c, 0.92), 33, 0.06, 0);
  if (!lod) return k.build()!;
  for (let i = 0; i < 11; i++) {
    const a = i * 2.399963;
    const t = ((i * 37) % 11) / 10;
    const r = 0.25 + 0.55 * t;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = 0.5 + Math.sqrt(Math.max(0, 0.7 - r * r * 0.75)) * 0.72;
    k.add(new OctahedronGeometry(0.06, 0), { at: [x, y, z], colour: i % 3 === 0 ? W.berryBlue : W.berry, flat: true });
  }
  return k.build()!;
}

// ---- D-116: what stands in a worked field (shared/fields.ts: FIELD_THING sizes; the scale is 1, so these are the collision's sizes) ----------------------

/** A stook: six sheaves of straw leaning together to dry, each bound at the waist, their ears bunched at the top. About 1.25 m tall and a metre across. */
export function stookGeometry(lod: Lod): BufferGeometry {
  return addStook(new Kit(), lod).build()!;
}

/** The stook's pieces, added to `k` at its base (a merged field: D-117). */
export function addStook(k: Kit, lod: Lod): Kit {
  const H = PALETTE.highmark;
  const radial = lod ? 5 : 3;
  const straw: ColourFn = (p, _n, out) => blend(out, H.grassGoldDeep, H.grangeWheat, Math.min(1, 0.35 + p.y * 0.7));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const foot: V3 = [Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36];
    const head: V3 = [Math.cos(a) * 0.1, 1.05, Math.sin(a) * 0.1];
    k.limb(foot, head, 0.13, 0.08, straw, radial);
    // the ears: a pale tuft over the head of each sheaf
    k.add(new ConeGeometry(0.13, 0.26, lod ? 4 : 3), { at: [head[0] * 1.3, 1.16, head[2] * 1.3], colour: H.grassGoldPale });
  }
  return k;
}

/** A haycock: a mown field's hay built into a tall dome round a pole, its top capped and the pole's end standing out of it. About 2.3 m tall, 2.7 m across. */
export function haycockGeometry(lod: Lod): BufferGeometry {
  return addHaycock(new Kit(), lod).build()!;
}

export function addHaycock(k: Kit, lod: Lod): Kit {
  const H = PALETTE.highmark;
  const hay: ColourFn = (p, _n, out) => blend(out, H.grassGoldDeep, H.grangeWheat, Math.min(1, 0.3 + p.y * 0.4));
  k.add(new SphereGeometry(1.32, lod ? 12 : 7, lod ? 6 : 4, 0, Math.PI * 2, 0, Math.PI / 2), { at: [0, 0, 0], scale: [1, 1.55, 1], colour: hay });
  k.add(new ConeGeometry(0.42, 0.36, lod ? 8 : 5), { at: [0, 2.12, 0], colour: H.grassGoldDeep });
  k.limb([0, 1.9, 0], [0.04, 2.55, 0.02], 0.045, 0.035, H.timber, lod ? 5 : 4);
  return k;
}

/**
 * A scarecrow, Highmark's own joke on its visitors (and Hollowmere's since D-117: the village took it up): the Grange has dressed it as a gentleman of the Society, in a red coat and a pith helmet over a sack face, its arms
 * spread on a crossbar and straw at its cuffs and hem. About 2.35 m to the top of the helmet; the post is its collision.
 */
export function scarecrowGeometry(lod: Lod): BufferGeometry {
  return addScarecrow(new Kit(), lod).build()!;
}

export function addScarecrow(k: Kit, lod: Lod): Kit {
  const H = PALETTE.highmark;
  const C = PALETTE.camp;
  const box = (): BoxGeometry => new BoxGeometry(1, 1, 1);
  k.add(box(), { at: [0, 1.0, 0], scale: [0.09, 2.0, 0.09], colour: H.timber });
  k.add(box(), { at: [0, 1.62, 0], scale: [1.5, 0.07, 0.07], colour: H.timber });
  // the coat: body and sleeves along the crossbar, the Society's red
  k.add(box(), { at: [0, 1.3, 0], scale: [0.52, 0.72, 0.26], colour: C.flagCloth });
  k.add(box(), { at: [0, 1.62, 0], scale: [1.18, 0.17, 0.17], colour: C.flagCloth });
  // straw at the cuffs and the hem
  for (const x of [-0.66, 0.66]) k.add(new ConeGeometry(0.09, 0.22, lod ? 6 : 4), { at: [x * 1.06, 1.6, 0], rot: [0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2], colour: H.grassGoldPale });
  for (const x of [-0.16, 0, 0.16]) k.add(new ConeGeometry(0.06, 0.2, lod ? 5 : 4), { at: [x, 0.86, 0.02], rot: [Math.PI, 0, 0], colour: H.grassGoldPale });
  // the sack face and the helmet (dome and brim, the Society's canvas)
  k.add(new SphereGeometry(0.17, lod ? 10 : 6, lod ? 7 : 4), { at: [0, 1.95, 0], colour: C.sack });
  k.add(new SphereGeometry(0.21, lod ? 10 : 6, lod ? 5 : 3, 0, Math.PI * 2, 0, Math.PI / 2), { at: [0, 2.04, 0], scale: [1, 0.95, 1.08], colour: C.canvas });
  k.add(new CylinderGeometry(0.3, 0.3, 0.025, lod ? 14 : 8), { at: [0, 2.05, 0], colour: C.canvasShade });
  return k;
}

// ---- D-117: the orchard (shared/fields.ts: ORCHARD_TREE, HIVE_STAND) ------------------------------------------------------------------------------------

/**
 * A fruit tree at scale 1 (shared `ORCHARD_TREE`): a short trunk that forks into three limbs low down, under a wide, round crown in a fresher green than the forest's,
 * hung with apples (most red, some gold) on its sides and underneath. The crown starts 2.1 m up (nobody's head goes into it), reaches 2.3 m from the trunk and tops out
 * at 4.3 m. Its crown sways a little (`aSway`, in a Kit built with `{ sway: true }`); the trunk does not.
 */
export function addFruitTree(k: Kit, lod: Lod, s = 1): Kit {
  const rad = lod ? 6 : 4;
  const bk = bark(2.4 * s, 0.5);
  const P = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  k.limb(P(0, -0.25, 0), P(0.06, 1.15, 0.03), 0.2 * s, 0.15 * s, bk, rad);
  k.limb(P(0.06, 1.15, 0.03), P(0.85, 2.25, 0.3), 0.1 * s, 0.06 * s, bk, rad);
  k.limb(P(0.06, 1.15, 0.03), P(-0.7, 2.3, 0.55), 0.1 * s, 0.06 * s, bk, rad);
  k.limb(P(0.06, 1.15, 0.03), P(0.1, 2.4, -0.8), 0.1 * s, 0.06 * s, bk, rad);
  const crown = (tone: number): ColourFn => shaded(topLit(W.crownDeep, W.vlLeafy, W.crownLight, 0.3), tone);
  /** How loose the crown is at a height (m, at scale 1): still at its foot, loosest at its top. */
  const loose = (y: number): number => smooth(2.1, 4.3, y) * 0.9;
  const lobes: readonly [V3, V3, number][] = [
    [[0, 3.15, 0], [1.85, 1.05, 1.85], 1],
    [[1.05, 2.85, 0.45], [1.1, 0.75, 1.05], 0.95],
    [[-0.95, 2.9, 0.5], [1.05, 0.78, 1.0], 1.05],
    [[0.15, 2.88, -1.0], [1.05, 0.75, 1.05], 0.92],
    [[0.1, 3.85, 0.1], [0.95, 0.48, 0.95], 1.1],
  ];
  const fat = (lod ? 1 : 1.035) * s;
  lobes.forEach(([at, sc, tone], i) =>
    k.add(new IcosahedronGeometry(1, i < 1 ? lod : 0), {
      at: P(at[0], at[1], at[2]),
      scale: [sc[0] * fat, sc[1] * fat, sc[2] * fat],
      colour: crown(tone),
      flat: true,
      jitter: 0.1 * (lod ? 1 : 0.7),
      seed: 41 + i,
      sway: (p) => loose(at[1] + p.y * sc[1]),
    }),
  );
  if (!lod) return k;
  // the apples: each on a corner of the main crown as it is drawn (its jittered vertex, so half of it is in the leaves and none hangs in the air), round its
  // sides and underneath, where fruit hangs
  const [at, sc] = lobes[0]!;
  const c: [number, number, number] = [0, 0, 0];
  APPLE_SPOTS.forEach(([vx, vy, vz], i) => {
    jittered(vx, vy, vz, 41, 0.1, c);
    const y = at[1] + c[1] * sc[1];
    k.add(new OctahedronGeometry(0.075 * s, 0), { at: P(at[0] + c[0] * sc[0], y, at[2] + c[2] * sc[2]), colour: i % 5 === 0 ? W.vlAwningOchre : W.capRed, flat: true, sway: loose(y) });
  });
  return k;
}

/** Sixteen corners of a unit detail-1 icosahedron round its middle and underneath (the main crown lobe's, before its jitter), spread round it. */
const APPLE_SPOTS: readonly V3[] = (() => {
  const g = new IcosahedronGeometry(1, 1);
  const p = g.attributes.position!;
  const seen = new Map<string, V3>();
  for (let i = 0; i < p.count; i++) {
    const v: V3 = [p.getX(i), p.getY(i), p.getZ(i)];
    if (v[1] > -0.8 && v[1] < 0.35) seen.set(v.map((n) => Math.round(n * 1000)).join(","), v);
  }
  g.dispose();
  const ring = [...seen.values()].sort((a, b) => Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]) || a[1] - b[1]);
  const out: V3[] = [];
  for (let i = 0; i < 16; i++) out.push(ring[Math.floor((i * ring.length) / 16)]!);
  return out;
})();

/**
 * A hive stand (shared `HIVE_STAND`): a plank on two legs, along local z, with `n` straw skeps on it (coiled rings tapering to a knob, as the village's), each with
 * its dark mouth at the foot facing local +x.
 */
export function addHiveStand(k: Kit, lod: Lod, n: number, pitch: number, plank: number): Kit {
  const len = n * pitch;
  for (const s of [-1, 1]) k.add(new BoxGeometry(0.12, plank, 0.12), { at: [0, plank / 2, s * (len / 2 - 0.22)], colour: W.vlTimber, flat: true });
  k.add(new BoxGeometry(0.56, 0.06, len), { at: [0, plank + 0.03, 0], colour: W.vlTimberLight, flat: true });
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * pitch;
    for (let r = 0; r < 4; r++) k.add(new TorusGeometry(0.22 - r * 0.04, 0.06, 3, lod ? 8 : 6), { at: [0, plank + 0.12 + r * 0.1, z], rot: [Math.PI / 2, 0, 0], colour: r & 1 ? W.vlHay : W.vlThatch, flat: true });
    k.add(new SphereGeometry(0.06, 5, 4), { at: [0, plank + 0.53, z], colour: W.vlThatchDark, flat: true });
    if (lod) k.add(new BoxGeometry(0.04, 0.05, 0.12), { at: [0.28, plank + 0.09, z], colour: W.vlSoot, flat: true });
  }
  return k;
}

/** A windfall apple on the grass (a little sunk into it). */
export function addWindfall(k: Kit, gold: boolean): Kit {
  return k.add(new OctahedronGeometry(0.065, 0), { at: [0, 0.04, 0], colour: gold ? W.vlAwningOchre : W.capRed, flat: true });
}

/**
 * D-116: one length of a ploughed ridge or a sown drill, a metre long along z (the instance stretches it), a low triangular prism: `top` along its crest, `side` down its
 * flanks. Laid in rows these read as a worked field from the road, where the ground's paint alone (a vertex every metre or so) cannot draw rows a metre apart.
 */
export function ridgeGeometry(top: number, side: number, halfWidth = 0.34, height = 0.13): BufferGeometry {
  const s = new Soup();
  const t = new Color(top);
  const sd = new Color(side);
  const w = halfWidth, h = height;
  for (const sx of [-1, 1]) {
    const n: V3 = [sx * h, w, 0];
    const a: V3 = [sx * w, 0, -0.5], b: V3 = [sx * w, 0, 0.5], c: V3 = [0, h, 0.5], d: V3 = [0, h, -0.5];
    if (sx < 0) {
      s.tri(a, b, c, sd, n, 0, sd, t);
      s.tri(a, c, d, sd, n, 0, t, t);
    } else {
      s.tri(a, c, b, sd, n, 0, t, sd);
      s.tri(a, d, c, sd, n, 0, t, t);
    }
  }
  for (const z of [-0.5, 0.5]) s.tri([-w, 0, z], [w, 0, z], [0, h, z], sd, [0, 0, z * 2], 0, sd, t);
  return s.build();
}
