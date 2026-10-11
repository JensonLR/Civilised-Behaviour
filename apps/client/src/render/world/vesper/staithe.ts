import { BoxGeometry, BufferAttribute, CylinderGeometry, IcosahedronGeometry, SphereGeometry } from "three";
import { PALETTE, STAITHE_LODGINGS, staithePlan, vesperLevel, type CollisionWorld, type StaitheHouse } from "./shared.ts";
import { pane } from "../litWindows.ts";
import { blend, type ColourFn, type Kit } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { sealedDoor } from "../rooms.ts";
import { SEAL, box, gable, notice, planks, slab, stone, type VesperOut } from "./structures.ts";

const P = PALETTE.vesper;

/**
 * D-126, the Staithe (`shared/staithe.ts`): the hamlet at the gorge's mouth, merged into the gorge's solid like everything else here. The Guild's Receiving House is the
 * cloister's own stuff on a small scale (bone plaster on a stone plinth, a plum band under crepe-black slates, a hand-bell under the gable, crepe hung either side of the
 * door), with its coffins stood against the south gable in four sizes, a measuring post by the door and mourning crepe drying on a line behind. The Company's houses are
 * the foreman's office's kin (planks on timber footings, a corrugated gable, a lit window in a side wall); the weigh-house has its steelyard on a gallows. Every door is
 * sealed, its notice on the cloth's plaques. Each house is drawn in its level frame (local +x the door's face) from the same numbers as its collider.
 */
export function addStaithe(k: Kit, world: CollisionWorld, lod: Lod, out: VesperOut): void {
  const p = staithePlan();
  for (const h of p.houses) {
    const lb = vesperLevel().buildings.find((b) => b.id === `staithe.${h.id}`)!;
    const gy = world.terrainHeight(h.x, h.z);
    k.setBase(h.x, gy, h.z, h.yaw);
    if (h.kind === "receiving") receivingHouse(k, h, lod);
    else companyHouse(k, h, lod, out);
    sealedDoor(k, `${lb.id}.door`, lb.hx, 0, lb.door, lb.doorH, SEAL, lod, out.marks, { x: h.x, y: gy, z: h.z, yaw: lb.yaw });
    notice(k, lb.hx, lb.floor, lb.doorH);
    if (STAITHE_LODGINGS.includes(h.id)) backDoor(k, h);
    k.clearBase();
  }
  coffins(k, world, lod);
  measuringPost(k, world);
  crepeLine(k, world);
  steelyard(k, world, lod);
}

/**
 * D-127: a lodging's own way in, on its back (local -x, away from the road): the folk's, not a player's (no handle, not in the door audit), like the gorge's other folk
 * doors (D-125). The Guild's is a crepe leaf in a bone-stone surround; the Company's a plank leaf in a chalk surround over a step.
 */
function backDoor(k: Kit, h: StaitheHouse): void {
  const x = -h.hx;
  if (h.kind === "receiving") {
    box(k, [0.08, 2.35, 1.3], [x - 0.04, 1.17, 0], P.strataBone);
    box(k, [0.06, 2.1, 1.0], [x - 0.1, 1.05, 0], P.crepe);
    return;
  }
  box(k, [0.08, 2.3, 1.3], [x - 0.04, 1.15, 0], P.chalk);
  box(k, [0.06, 2.05, 1.0], [x - 0.1, 1.02, 0], (p, _n, o) => blend(o, P.timber, P.timberLight, (Math.floor((p.z + 50) * 6) & 1) * 0.35));
  box(k, [0.45, 0.12, 1.4], [x - 0.26, 0.03, 0], P.chalk);
}

/** The Guild's: a stone plinth sunk to the low side, bone plaster, a plum band under the eaves, crepe-black slates with a silver ridge, a hand-bell under the front gable, crepe either side of the door. */
function receivingHouse(k: Kit, h: StaitheHouse, lod: Lod): void {
  const { hx, hz, wallH: H, rise } = h;
  slab(k, [hx * 2 + 0.12, 0.7, hz * 2 + 0.12], [0, -0.1, 0], stone(330, P.strataBuff, P.strataRust), lod);
  slab(k, [hx * 2, H - 0.2, hz * 2], [0, 0.2 + (H - 0.2) / 2, 0], stone(331), lod);
  box(k, [hx * 2 + 0.04, 0.24, hz * 2 + 0.04], [0, H - 0.2, 0], P.guildPlum);
  gable(k, hx + 0.3, hz + 0.35, rise, [0, H, 0], (_p, n, o) => blend(o, P.crepe, P.crepeFold, n.y > 0.5 ? 0.35 : 0));
  k.limb([-hx - 0.3, H + rise - 0.05, 0], [hx + 0.3, H + rise - 0.05, 0], 0.05, 0.05, P.guildSilver, 5);
  // the hand-bell under the front gable, on a bracket from the gable's face
  const by = H + rise * 0.42;
  k.limb([hx + 0.3, by + 0.3, 0], [hx + 0.62, by + 0.3, 0], 0.03, 0.03, P.iron, 4);
  k.add(new CylinderGeometry(0.06, 0.16, 0.24, lod ? 10 : 6), { at: [hx + 0.62, by + 0.16, 0], colour: P.guildSilver, flat: true });   // (its crown into the bracket)
  k.add(new SphereGeometry(0.04, 5, 4), { at: [hx + 0.62, by + 0.05, 0], colour: P.iron });   // (the clapper in its mouth)
  // crepe hung either side of the door, folds catching the light
  const folds: ColourFn = (p, _n, o) => blend(o, P.crepe, P.crepeFold, (Math.floor((p.z + 20) * 9) & 1) * 0.5);
  for (const s of [-1, 1]) box(k, [0.03, 2.0, 0.5], [hx + 0.025, H - 1.25, s * 1.32], folds);   // (a centimetre off the plaster: never coplanar with it)
}

/** The Company's: plank walls on timber footings, a sill beam, a corrugated gable, a window with its lantern-glass in a side wall (the bunks have one each side). */
function companyHouse(k: Kit, h: StaitheHouse, lod: Lod, out: VesperOut): void {
  const { hx, hz, wallH: H, rise } = h;
  const seed = 340 + Math.round(h.z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (hx - 0.15), -0.5, sz * (hz - 0.15)], [sx * (hx - 0.15), 0.3, sz * (hz - 0.15)], 0.12, 0.1, P.timber, 5);
  box(k, [hx * 2, H - 0.2, hz * 2], [0, 0.2 + (H - 0.2) / 2, 0], planks(seed));
  box(k, [hx * 2 + 0.08, 0.16, hz * 2 + 0.08], [0, 0.24, 0], P.timber);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k, [0.14, H - 0.3, 0.14], [sx * (hx - 0.03), 0.3 + (H - 0.3) / 2, sz * (hz - 0.03)], P.timber);
  gable(k, hx + 0.35, hz + 0.4, rise, [0, H, 0]);
  // the windows: a dark frame let into the side wall, a sill, the glass (`pane`: the weigh-house's faces its steelyard; the bunks' both sides)
  const sides: (1 | -1)[] = h.kind === "bunk" ? [1, -1] : [1];
  for (const s of sides) {
    const x = h.kind === "bunk" ? -hx * 0.35 : 0;
    box(k, [0.8, 0.72, 0.12], [x, 1.7, s * (hz + 0.02)], P.crepe);
    box(k, [0.95, 0.08, 0.2], [x, 1.3, s * (hz + 0.08)], P.timberLight);
    pane(out.panes, k, x, 1.7, s * (hz + 0.09), s, 0.62, 0.54, seed + (s > 0 ? 1 : 2));
  }
  // a Company-red board under the eaves, over the door's lintel
  box(k, [0.06, 0.2, 1.5], [hx + 0.04, H - 0.12, 0], P.companyRed);
}

/** The coffins against the Receiving House's south gable: four sizes, tapered at the foot and the head, leaning a hair back, a brass plate on each lid. */
function coffins(k: Kit, world: CollisionWorld, lod: Lod): void {
  const c = staithePlan().coffins;
  const sizes = [[0.46, 1.45], [0.52, 1.65], [0.58, 1.85], [0.62, 2.0]] as const;
  const gap = 0.08;
  const total = sizes.reduce((a, [w]) => a + w, 0) + gap * (sizes.length - 1);
  let x = c.x - total / 2;
  sizes.forEach(([w, h], i) => {
    const cx = x + w / 2;
    x += w + gap;
    const gy = world.terrainHeight(cx, c.z);
    const geo = new BoxGeometry(w, h, 0.28, 1, 2, 1);
    const pa = geo.attributes.position as BufferAttribute;
    for (let j = 0; j < pa.count; j++) {
      const y = pa.getY(j);
      if (y < -h / 4) pa.setX(j, pa.getX(j) * 0.7);
      else if (y > h / 4) pa.setX(j, pa.getX(j) * 0.76);
      else pa.setY(j, h * 0.22);
    }
    const wood = i % 2 === 0 ? P.timber : P.crepe;
    k.add(geo, { at: [cx, gy + h / 2 - 0.03, c.z], rot: [-0.025, 0, 0], colour: wood, flat: true });
    if (lod) box(k, [0.16, 0.08, 0.02], [cx, gy + h * 0.62, c.z + 0.145], P.copper);
  });
}

/** The Guild's measuring post: notched every quarter metre in plum and crepe, a plum pennant at its top. */
function measuringPost(k: Kit, world: CollisionWorld): void {
  const m = staithePlan().post;
  const gy = world.terrainHeight(m.x, m.z);
  k.limb([m.x, gy - 0.3, m.z], [m.x, gy + m.h, m.z], 0.07, 0.06, P.timberLight, 5);
  for (let i = 0; i < 7; i++) box(k, [0.11, 0.03, 0.05], [m.x + 0.06, gy + 0.5 + i * 0.25, m.z], i % 2 === 0 ? P.crepe : P.guildPlum);
  box(k, [0.02, 0.24, 0.34], [m.x, gy + m.h - 0.16, m.z + 0.2], P.guildPlum);
}

/** The crepe line behind the Receiving House: two posts, a line, the Guild's mourning black hung out to dry (every funeral needs it pressed). */
function crepeLine(k: Kit, world: CollisionWorld): void {
  const l = staithePlan().line;
  const y0 = world.terrainHeight(l.x, l.z0), y1 = world.terrainHeight(l.x, l.z1);
  for (const [z, y] of [[l.z0, y0], [l.z1, y1]] as const) k.limb([l.x, y - 0.3, z], [l.x, y + l.h, z], 0.07, 0.06, P.timber, 5);
  const yl = (z: number): number => y0 + ((y1 - y0) * (z - l.z0)) / (l.z1 - l.z0) + l.h - 0.25;
  k.limb([l.x, yl(l.z0), l.z0], [l.x, yl(l.z1), l.z1], 0.012, 0.012, P.timberLight, 3);
  for (let i = 0; i < l.cloths; i++) {
    const z = l.z0 + 0.75 + (i * (l.z1 - l.z0 - 1.5)) / (l.cloths - 1);
    const drop = 0.8 + (i % 3) * 0.14;
    box(k, [0.02, drop, 0.6], [l.x, yl(z) - drop / 2, z], i % 2 === 0 ? P.crepe : P.crepeFold, [0.04 * (i - 2), 0, 0]);
  }
}

/** The weigh-house's steelyard: a gallows post at the house's corner, an arm and a brace, the iron beam with its sliding weight, the copper pan on chains, a sample sack in it. */
function steelyard(k: Kit, world: CollisionWorld, lod: Lod): void {
  const s = staithePlan().gallows;
  const gy = world.terrainHeight(s.x, s.z);
  const px = s.x - 0.4;
  k.limb([px, gy - 0.4, s.z], [px, gy + s.h, s.z], 0.1, 0.09, P.timber, 6);
  k.limb([px, gy + s.h - 0.15, s.z], [s.panX + 0.2, gy + s.h - 0.15, s.z], 0.06, 0.06, P.timber, 5);
  k.limb([px, gy + s.h - 0.75, s.z], [px + 0.5, gy + s.h - 0.15, s.z], 0.04, 0.04, P.timber, 4);
  const hook = gy + s.h - 0.2, beam = gy + 1.95, panY = gy + 1.0;
  k.limb([s.panX, hook, s.z], [s.panX, beam, s.z], 0.012, 0.012, P.iron, 3);
  k.limb([s.panX - 0.28, beam, s.z], [s.panX + 0.22, beam, s.z], 0.025, 0.025, P.iron, 4);
  k.add(new SphereGeometry(0.06, 6, 4), { at: [s.panX - 0.22, beam - 0.08, s.z], colour: P.iron });
  for (const a of [0, 2.1, 4.2]) k.limb([s.panX, beam, s.z], [s.panX + Math.cos(a) * 0.24, panY + 0.03, s.z + Math.sin(a) * 0.24], 0.008, 0.008, P.iron, 3);
  k.add(new CylinderGeometry(0.28, 0.22, 0.06, lod ? 12 : 7), { at: [s.panX, panY, s.z], colour: P.copper, flat: true });
  k.add(new IcosahedronGeometry(1, 0), { at: [s.panX, panY + 0.15, s.z], scale: [0.18, 0.14, 0.17], colour: P.companyCream, flat: true });
}
