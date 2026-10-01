import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, type BufferGeometry } from "three";
import { PALETTE, type CollisionWorld } from "@cb/shared";
import { Kit, blend, type ColourFn } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { cart, tent } from "../landmarks.ts";
import { kessarPlan } from "./shared.ts";

/**
 * The three newer Kessar sites (D-034), merged into ONE vertex-coloured geometry (one draw, one ink hull; the integrator adds it beside `buildKessarSolid`):
 *   - Hangman's Orchard, the deserters' camp: a barred cage wagon, three tents round a fire with a log ring, a stack of looted crates, the camp's rag of a flag;
 *   - the Dry Cut: the Syndicate's keg of powder, hooped, on its side by the track (the wagon itself is the Mounts' and the keg is a prop the server spawns);
 *   - Marker Stone No. 4 in the ford, four tally cuts in its face, with a Ward flag on the north bank and a Syndicate flag on the south.
 * Everything is placed from `kessarPlan().sites` and the world's terrain, with the existing builders (`tent`, `cart`). Palette colours only. Looked at: never (its author
 * could not run the screenshot tool), so it is judged by geometry tests alone and BUILD_STATE says so.
 */

const K = PALETTE.kessar;
const C = PALETTE.camp;

const box = (k: Kit, s: readonly [number, number, number], at: readonly [number, number, number], colour: number | ColourFn, rot?: readonly [number, number, number]): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

/** The cage: a plank bed on the cart, four corner posts, a lid, and iron bars on the long faces with a barred door on the +x (front) face. */
function cage(k: Kit, x: number, z: number, yaw: number, gy: number, lod: Lod): void {
  k.setBase(x, gy, z, yaw);
  cart(k, lod);
  const hx = 1.25, hz = 0.8, h = 1.5, y0 = 0.95;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * hx, y0, sz * hz], [sx * hx, y0 + h, sz * hz], 0.07, 0.07, K.timber, 5);
  box(k, [hx * 2 + 0.2, 0.1, hz * 2 + 0.2], [0, y0 + h + 0.05, 0], K.timberLight);
  box(k, [hx * 2 + 0.2, 0.1, 0.1], [0, y0 + 0.05, hz], K.timber);
  box(k, [hx * 2 + 0.2, 0.1, 0.1], [0, y0 + 0.05, -hz], K.timber);
  const bars = lod ? 7 : 4;
  for (let i = 0; i < bars; i++) {
    const t = -hx + ((i + 0.5) * hx * 2) / bars;
    for (const sz of [-1, 1]) k.limb([t, y0, sz * hz], [t, y0 + h, sz * hz], 0.025, 0.025, K.iron, 4);
  }
  const doorBars = lod ? 5 : 3;
  for (let i = 0; i < doorBars; i++) {
    const t = -hz + ((i + 0.5) * hz * 2) / doorBars;
    k.limb([hx, y0, t], [hx, y0 + h, t], 0.025, 0.025, K.ironLight, 4);
  }
  // the crossbar and the padlock the Society's paperwork will describe as "a lock"
  box(k, [0.06, 0.08, hz * 2], [hx + 0.03, y0 + h * 0.55, 0], K.iron);
  k.add(new SphereGeometry(0.1, 5, 4), { at: [hx + 0.1, y0 + h * 0.5, 0.2], colour: C.brass });
  k.clearBase();
}

/** A fire ring: stones, three crossed logs, a core of ash. (The flame itself is the game's, like the expedition camp's.) */
function fire(k: Kit, x: number, z: number, gy: number, lod: Lod): void {
  k.setBase(x, gy, z, 0);
  const n = lod ? 9 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.add(new SphereGeometry(0.2, 5, 4), { at: [Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62], scale: [1, 0.7, 1], colour: C.fireStone, flat: true });
  }
  k.add(new CylinderGeometry(0.55, 0.6, 0.06, 10), { at: [0, 0.03, 0], colour: C.ash, flat: true });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    k.limb([Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5], [-Math.cos(a) * 0.5, 0.2, -Math.sin(a) * 0.5], 0.07, 0.07, i === 0 ? C.charred : C.log, 5);
  }
  k.add(new SphereGeometry(0.16, 5, 4), { at: [0, 0.14, 0], colour: C.ember, flat: true });
  k.clearBase();
}

/** A rag of a flag on a pole: the deserters fly the cloth they walked out with (cream with a rust stripe), upside down. */
function rag(k: Kit, x: number, z: number, gy: number, height: number, yaw: number, cloth: number, stripe: number): void {
  k.clearBase();
  k.limb([x, gy - 0.2, z], [x, gy + height, z], 0.1, 0.07, K.timber, 6);
  k.add(new SphereGeometry(0.15, 5, 4), { at: [x, gy + height + 0.1, z], colour: K.lampGold });
  k.setBase(x, gy + height - 0.9, z, yaw);
  box(k, [0.04, 1.1, 1.7], [0.05, 0, 0.9], cloth);
  box(k, [0.05, 0.3, 1.7], [0.05, 0.1, 0.9], stripe);
  k.clearBase();
}

/** The Syndicate's keg: a barrel on its side with three iron hoops and a stencilled head (a lighter disc), chocked with two wedges. */
function keg(k: Kit, x: number, z: number, gy: number, yaw: number): void {
  k.setBase(x, gy + 0.42, z, yaw);
  const body = new CylinderGeometry(0.34, 0.34, 0.9, 12);
  k.add(body, { rot: [Math.PI / 2, 0, 0], colour: C.cartWood, flat: true });
  for (const t of [-0.28, 0, 0.28]) k.add(new CylinderGeometry(0.355, 0.355, 0.05, 12), { at: [0, 0, t], rot: [Math.PI / 2, 0, 0], colour: K.iron, flat: true });
  k.add(new CylinderGeometry(0.28, 0.28, 0.02, 10), { at: [0, 0, 0.46], rot: [Math.PI / 2, 0, 0], colour: K.synStripe, flat: true });
  box(k, [0.12, 0.12, 0.2], [0.34, -0.36, 0], K.timber);
  box(k, [0.12, 0.12, 0.2], [-0.34, -0.36, 0], K.timber);
  k.clearBase();
}

/** Marker Stone No. 4: a squared sandstone post, tapered, with a pale cap, a darker footing in the ford and four tally cuts down its face. */
function marker(k: Kit, x: number, z: number, gy: number, lod: Lod): void {
  const masonry: ColourFn = (p, n, out) => {
    if (n.y > 0.6) out.set(K.stoneCap);
    else if (n.y < -0.6) out.set(K.stoneDark);
    else blend(out, K.stone, K.stoneShade, Math.min(1, Math.max(0, (0.9 - p.y) / 1.6)));
  };
  k.setBase(x, gy, z, 0);
  box(k, [1.15, 0.28, 1.15], [0, 0.0, 0], K.stoneDark);
  k.add(new CylinderGeometry(0.34, 0.46, 1.5, 4, 1), { at: [0, 0.89, 0], rot: [0, Math.PI / 4, 0], colour: masonry, flat: true, perFace: true });
  k.add(new ConeGeometry(0.4, 0.28, 4, 1), { at: [0, 1.78, 0], rot: [0, Math.PI / 4, 0], colour: K.stoneCap, flat: true });
  if (lod) for (let i = 0; i < 4; i++) box(k, [0.04, 0.34, 0.06], [-0.18 + i * 0.12, 1.1, 0.4], K.stoneDark, [0, 0, 0.1]);
  k.clearBase();
}

/** Everything the three sites add, merged. `lod` 0 is the cheap shape the ink hull and the low preset use. */
export function buildKessarSites(world: CollisionWorld, lod: Lod): BufferGeometry | undefined {
  const plan = kessarPlan();
  const s = plan.sites;
  const terrain = (x: number, z: number): number => world.terrainHeight(x, z);
  const k = new Kit();
  // Hangman's Orchard
  cage(k, s.camp.wagon.x, s.camp.wagon.z, s.camp.wagon.yaw, terrain(s.camp.wagon.x, s.camp.wagon.z), lod);
  for (const t of s.camp.tents) {
    k.setBase(t.x, terrain(t.x, t.z), t.z, t.yaw);
    tent(k, lod);
  }
  fire(k, s.camp.fire.x, s.camp.fire.z, terrain(s.camp.fire.x, s.camp.fire.z), lod);
  rag(k, s.camp.flag.x, s.camp.flag.z, terrain(s.camp.flag.x, s.camp.flag.z), 5, 0, C.flagCloth, C.flagMark);
  for (const [i, p] of s.camp.posts.entries()) {
    // each carouser's post is marked with an upturned crate and a bottle the Ward would call evidence
    const y = terrain(p.x, p.z);
    k.setBase(p.x + 0.9, y + 0.2, p.z + 0.4, i * 1.3);
    box(k, [0.5, 0.4, 0.5], [0, 0, 0], C.cartWood);
    if (lod) k.add(new CylinderGeometry(0.05, 0.07, 0.28, 6), { at: [0.1, 0.34, 0], colour: C.glass, flat: true });
    k.clearBase();
  }
  // the Dry Cut
  keg(k, s.cut.keg.x, s.cut.keg.z, terrain(s.cut.keg.x, s.cut.keg.z), 0.6);
  // the ford
  marker(k, s.ford.marker.x, s.ford.marker.z, terrain(s.ford.marker.x, s.ford.marker.z) - 0.1, lod);
  for (const f of s.ford.flags) rag(k, f.x, f.z, terrain(f.x, f.z), 5, f.yaw, f.kind === "ward" ? K.wardRed : K.synGreen, f.kind === "ward" ? K.wardCream : K.synStripe);
  k.clearBase();
  return k.build();
}
