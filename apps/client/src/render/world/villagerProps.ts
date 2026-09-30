import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshToonMaterial, SphereGeometry, TorusGeometry, type Object3D } from "three";
import { PALETTE, PropKind } from "@cb/shared";
import { outlineMaterial, sharedToonRamp } from "@cb/procedural/three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Kit, blend, type ColourFn } from "./kit.ts";
import { propGeometry } from "./objects.ts";

/**
 * What Hollowmere's people hold and carry: a broom, a smith's hammer, a fishing rod, a hand bell, a lantern, a book, a cane, a lamplighter's pole, an open
 * umbrella, a bucket, and in the arms a sack, a basket (empty, of pears, of loaves, of washing) or a crate of fish. Each is ONE merged geometry with vertex
 * colours from the palette, drawn around the point the hand closes on (long axis +Y), shared by every villager (one geometry per prop, built on first use).
 * The three the game's shared prop kinds already give us (crate, bottle, chair) are those props, scaled to the hand.
 */

const M = PALETTE.material;
const C = PALETTE.camp;
const W = PALETTE.world;

export type PropName = "broom" | "hammer" | "rod" | "bell" | "lantern" | "book" | "cane" | "pole" | "umbrella" | "bucket" | "sack" | "basket" | "pears" | "loaves" | "washing" | "fishcrate" | "bottle" | "chair";

export interface PropDef {
  geometry: BufferGeometry;
  /** A second, unlit geometry (lantern glass): drawn with the glow material. */
  glow?: BufferGeometry | undefined;
  /** Scale applied to the mesh (shared prop kinds are drawn a hand-size smaller). */
  scale: number;
  /** Ink outline weight is skipped on tiny things. */
  ink: boolean;
}

const cache = new Map<string, PropDef>();
let toon: MeshToonMaterial | undefined;
let glowMat: MeshBasicMaterial | undefined;

export const propToon = (): MeshToonMaterial => (toon ??= new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp(), side: DoubleSide }));
export const propGlow = (): MeshBasicMaterial => (glowMat ??= new MeshBasicMaterial({ color: C.glowLantern, fog: true }));

const bands = (a: number, b: number, per = 26): ColourFn => (p, _n, out) => blend(out, a, b, Math.floor(p.y * per) % 2 === 0 ? 0 : 0.5);

function make(name: PropName, umbrellaHue = 1): PropDef {
  const k = new Kit();
  let glow: BufferGeometry | undefined;
  let scale = 1;
  let ink = true;
  switch (name) {
    case "broom": {
      // a long ash handle, a tied head of straw at the foot (the hand closes about a metre above the floor)
      k.limb([0, -0.86, 0], [0, 0.6, 0], 0.014, 0.016, M.wood, 6, true);
      k.add(new CylinderGeometry(0.05, 0.135, 0.34, 8), { at: [0, -1.02, 0], colour: byHeightStraw(), flat: true, jitter: 0.008, seed: 4 });
      k.add(new TorusGeometry(0.058, 0.012, 4, 8), { at: [0, -0.86, 0], rot: [Math.PI / 2, 0, 0], colour: C.rope });
      break;
    }
    case "hammer": {
      k.limb([0, -0.14, 0], [0, 0.33, 0], 0.02, 0.022, M.wood, 6, true);
      k.add(new BoxGeometry(0.2, 0.085, 0.085), { at: [0, 0.36, 0], colour: M.iron, flat: true });
      k.add(new BoxGeometry(0.05, 0.1, 0.1), { at: [0.1, 0.36, 0], colour: C.iron, flat: true });
      break;
    }
    case "rod": {
      k.limb([0, -0.2, 0], [0, 0.06, 0], 0.02, 0.02, M.leatherTan, 6, true);
      k.limb([0, 0.06, 0], [0, 2.3, 0], 0.014, 0.004, M.wood, 5, true);
      k.add(new CylinderGeometry(0.035, 0.035, 0.03, 8), { at: [0.04, 0.1, 0], rot: [0, 0, Math.PI / 2], colour: C.brass });
      // the line drops from the tip (down in the world when the rod is tilted 1.0 rad up: local (0, -cos, sin))
      k.limb([0, 2.3, 0], [0, 2.3 - 1.25 * Math.cos(RODTILT), 1.25 * Math.sin(RODTILT)], 0.0035, 0.0035, M.linen, 3, true);
      k.add(new SphereGeometry(0.03, 6, 4), { at: [0, 2.3 - 1.25 * Math.cos(RODTILT), 1.25 * Math.sin(RODTILT)], colour: C.canvasTrim, flat: true });
      ink = false;
      break;
    }
    case "bell": {
      k.limb([0, -0.06, 0], [0, 0.1, 0], 0.013, 0.013, M.wood, 5, true);
      k.add(new ConeGeometry(0.085, 0.13, 10, 1, true), { at: [0, -0.12, 0], colour: C.brass, flat: true });
      k.add(new SphereGeometry(0.02, 5, 4), { at: [0, -0.19, 0], colour: C.brass });
      break;
    }
    case "lantern": {
      // hangs from the hand by its ring: cap, four posts, a base, a glass box that glows
      k.add(new TorusGeometry(0.035, 0.007, 4, 8), { at: [0, 0, 0], colour: C.brass });
      k.add(new ConeGeometry(0.08, 0.06, 8), { at: [0, -0.07, 0], colour: C.iron, flat: true });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * 0.055, -0.1, sz * 0.055], [sx * 0.055, -0.3, sz * 0.055], 0.006, 0.006, C.iron, 4, true);
      k.add(new CylinderGeometry(0.075, 0.07, 0.03, 8), { at: [0, -0.31, 0], colour: C.iron, flat: true });
      glow = new BoxGeometry(0.09, 0.17, 0.09);
      glow.translate(0, -0.2, 0);
      break;
    }
    case "book": {
      k.add(new BoxGeometry(0.2, 0.03, 0.27), { colour: M.leather, flat: true });
      k.add(new BoxGeometry(0.18, 0.024, 0.25), { at: [0.005, 0, 0], colour: M.cream, flat: true });
      k.add(new BoxGeometry(0.02, 0.034, 0.27), { at: [-0.095, 0, 0], colour: M.leatherOx, flat: true });
      break;
    }
    case "cane": {
      k.limb([0, -0.92, 0], [0, 0, 0], 0.014, 0.017, M.wood, 6, true);
      k.add(new TorusGeometry(0.05, 0.016, 5, 10, Math.PI * 1.15), { at: [0.05, 0.005, 0], rot: [0, 0, Math.PI * 0.35], colour: M.wood });
      k.add(new CylinderGeometry(0.02, 0.02, 0.03, 6), { at: [0, -0.9, 0], colour: C.brass });
      ink = false;
      break;
    }
    case "pole": {
      // the lamplighter's pole: a long staff with a hook and a little lamp at its top
      k.limb([0, -0.9, 0], [0, 1.25, 0], 0.016, 0.014, M.wood, 6, true);
      k.add(new TorusGeometry(0.05, 0.008, 4, 8, Math.PI * 1.4), { at: [0.03, 1.3, 0], rot: [0, 0, 0.3], colour: C.iron });
      k.add(new CylinderGeometry(0.045, 0.03, 0.09, 6), { at: [0, 1.17, 0], colour: C.brass, flat: true });
      glow = new SphereGeometry(0.06, 7, 5);
      glow.translate(0, 1.29, 0);
      ink = false;
      break;
    }
    case "umbrella": {
      // an open umbrella: the shaft with its crook, a dome of eight wedges alternating two dyes, tips at the rim
      const dyeA = PALETTE.cloth[umbrellaHue % PALETTE.cloth.length]!;
      const dyeB = PALETTE.cloth[(umbrellaHue + 5) % PALETTE.cloth.length]!;
      k.limb([0, -0.3, 0], [0, 0.78, 0], 0.011, 0.011, M.wood, 5, true);
      k.add(new TorusGeometry(0.045, 0.012, 4, 8, Math.PI), { at: [0.045, -0.3, 0], rot: [0, 0, Math.PI], colour: M.wood });
      const wedge: ColourFn = (p, _n, out) => out.set(Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 8) % 2 === 0 ? dyeA : dyeB);
      k.add(new ConeGeometry(0.7, 0.3, 16, 1, true), { at: [0, 0.68, 0], colour: wedge, flat: true });
      k.add(new SphereGeometry(0.016, 5, 4), { at: [0, 0.84, 0], colour: C.brass });
      break;
    }
    case "bucket": {
      k.add(new CylinderGeometry(0.17, 0.135, 0.26, 10, 1, true), { at: [0, -0.3, 0], colour: bands(M.wood, C.log), flat: true });
      k.add(new CylinderGeometry(0.135, 0.135, 0.02, 10), { at: [0, -0.42, 0], colour: C.log });
      for (const y of [-0.22, -0.38]) k.add(new TorusGeometry(y === -0.22 ? 0.17 : 0.14, 0.008, 4, 10), { at: [0, y, 0], rot: [Math.PI / 2, 0, 0], colour: C.iron });
      k.add(new TorusGeometry(0.165, 0.007, 4, 10, Math.PI), { at: [0, -0.17, 0], colour: C.rope });
      k.add(new CylinderGeometry(0.15, 0.15, 0.01, 10), { at: [0, -0.2, 0], colour: W.wellWater });
      break;
    }
    case "sack": {
      const sackC: ColourFn = (p, n, out) => {
        blend(out, C.sack, M.leatherTan, Math.max(0, Math.min(1, 0.5 - n.y * 0.4 + Math.sin(p.x * 30 + p.z * 22) * 0.12)));
      };
      k.add(new IcosahedronGeometry(1, 1), { at: [0, 0, 0], scale: [0.2, 0.27, 0.16], colour: sackC, flat: true, jitter: 0.012, seed: 21 });
      k.add(new ConeGeometry(0.075, 0.15, 6), { at: [0.01, 0.3, 0], colour: sackC, flat: true, jitter: 0.008, seed: 22 });
      k.add(new TorusGeometry(0.05, 0.01, 4, 8), { at: [0.01, 0.25, 0], rot: [Math.PI / 2, 0, 0], colour: C.rope });
      break;
    }
    case "basket":
    case "pears":
    case "loaves":
    case "washing": {
      const weave: ColourFn = (p, _n, out) => blend(out, M.leatherTan, M.leather, (Math.floor(p.y * 34) + Math.floor(Math.atan2(p.z, p.x) * 5)) % 2 === 0 ? 0.05 : 0.35);
      k.add(new CylinderGeometry(0.235, 0.16, 0.22, 11, 1, true), { at: [0, 0, 0], colour: weave, flat: true });
      k.add(new CylinderGeometry(0.16, 0.16, 0.02, 11), { at: [0, -0.1, 0], colour: M.leather });
      k.add(new TorusGeometry(0.235, 0.014, 4, 12), { at: [0, 0.11, 0], rot: [Math.PI / 2, 0, 0], colour: M.leather });
      k.add(new TorusGeometry(0.2, 0.01, 4, 10, Math.PI), { at: [0, 0.11, 0], rot: [0, 0, 0], colour: M.leather });
      if (name === "pears") {
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4;
          const r = i === 0 ? 0 : 0.09 + (i % 2) * 0.04;
          k.add(new IcosahedronGeometry(0.055, 0), { at: [Math.cos(a) * r, 0.15 + (i % 3) * 0.02, Math.sin(a) * r], scale: [1, 1.25, 1], colour: i % 3 === 0 ? W.acaciaLight : W.bloomYellow, flat: true });
        }
      } else if (name === "loaves") {
        for (let i = 0; i < 4; i++) {
          const a = i * 1.6 + 0.4;
          k.add(new SphereGeometry(0.07, 7, 5), { at: [Math.cos(a) * 0.08, 0.14 + (i % 2) * 0.03, Math.sin(a) * 0.08], rot: [0, a, 0], scale: [1.7, 0.85, 0.9], colour: blend2(C.hatbox, C.cartWood), flat: true });
        }
      } else if (name === "washing") {
        k.add(new IcosahedronGeometry(0.21, 1), { at: [0, 0.14, 0], scale: [1, 0.55, 0.9], colour: (p, _n, out) => blend(out, M.linen, PALETTE.cloth[10]!, Math.sin(p.x * 14) > 0.3 ? 0.55 : 0), flat: true, jitter: 0.02, seed: 8 });
      }
      break;
    }
    case "fishcrate":
    case "bottle":
    case "chair":
      break; // (the shared prop kinds, below)
  }
  const geometry = name === "bottle" ? propGeometry(PropKind.BOTTLE, 1) : name === "chair" ? propGeometry(PropKind.CHAIR, 1) : name === "fishcrate" ? crateOfFish() : k.build()!;
  if (name === "bottle") scale = 1.5;
  if (name === "chair") scale = 0.72;
  return { geometry, glow, scale, ink };
}

const RODTILT = 1.0;
const byHeightStraw = (): ColourFn => (p, _n, out) => blend(out, C.sack, W.dry, Math.max(0, Math.min(1, (p.y + 1.19) / 0.34)));
const blend2 = (a: number, b: number): ColourFn => (p, n, out) => blend(out, a, b, Math.max(0, Math.min(1, 0.5 - n.y * 0.5 + Math.sin(p.x * 40) * 0.1)));

/** The crate of the shared prop kind, scaled to the arms, with the day's catch laid in the top. */
function crateOfFish(): BufferGeometry {
  const crate = propGeometry(PropKind.CRATE, 1).clone();
  crate.scale(0.62, 0.62, 0.62);
  const k = new Kit();
  // the catch: silver fish with a tail, laid head to tail
  for (let i = 0; i < 5; i++) {
    const x = -0.12 + i * 0.06;
    const z = (i % 2 === 0 ? -1 : 1) * 0.045;
    k.add(new SphereGeometry(0.05, 7, 5), { at: [x, 0.155, z], rot: [0, i % 2 ? 0.5 : -0.5, 0], scale: [0.45, 0.4, 1.55], colour: (p, n, out) => blend(out, M.leatherGrey, M.fur, Math.max(0, n.y)), flat: true });
    k.add(new ConeGeometry(0.03, 0.05, 4), { at: [x, 0.155, z + (i % 2 === 0 ? -1 : 1) * 0.085], rot: [Math.PI / 2, 0, 0], colour: M.leatherGrey, flat: true });
  }
  const fish = k.build()!;
  const merged = mergeGeometries([crate, fish], false);
  crate.dispose();
  fish.dispose();
  return merged;
}

/**
 * The prop's definition (geometry built the first time). Umbrellas have a colour variant (0..11 = a dye of the palette); every other name has one.
 */
export function propDef(name: PropName, variant = 0): PropDef {
  const key = name === "umbrella" ? `umbrella${variant}` : name;
  let d = cache.get(key);
  if (!d) {
    d = make(name, variant);
    cache.set(key, d);
  }
  return d;
}

/** A group holding a prop's mesh (with its ink line on request) and its glow. Cheap: geometry and materials are shared. */
export function propObject(name: PropName, variant = 0, ink = true): Group {
  const d = propDef(name, variant);
  const g = new Group();
  g.name = `prop_${name}`;
  const m = new Mesh(d.geometry, propToon());
  m.castShadow = true;
  m.scale.setScalar(d.scale);
  g.add(m);
  if (ink && d.ink) {
    const o = new Mesh(d.geometry, outlineMaterial());
    o.name = "prop_ink";
    o.scale.setScalar(d.scale);
    g.add(o);
  }
  if (d.glow) {
    const gl = new Mesh(d.glow, propGlow());
    gl.name = "prop_glow";
    g.add(gl);
  }
  g.visible = false;
  return g;
}

/** Frees the shared prop geometry and materials (the whole village is being torn down). */
export function disposeProps(): void {
  for (const d of cache.values()) {
    d.geometry.dispose();
    d.glow?.dispose();
  }
  cache.clear();
  toon?.dispose();
  toon = undefined;
  glowMat?.dispose();
  glowMat = undefined;
}

export type { Object3D };
