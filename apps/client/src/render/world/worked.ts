import type { BufferGeometry } from "three";
import { HIVE_STAND, PALETTE } from "@cb/shared";
import { Kit, blend } from "./kit.ts";
import { addFruitTree, addHaycock, addHiveStand, addScarecrow, addStook, addWindfall, ridgeGeometry, type Lod } from "./flora.ts";
import type { Item, ScatterPlan } from "./scatter.ts";

const W = PALETTE.world;

/**
 * D-117: everything that stands in Hollowmere's worked land, as ONE geometry (one draw, and one ink hull where the preset inks): the stooks, haycocks and scarecrows
 * in the fields, the plough's ridges and the young barley's drills, the orchard's trees (their crowns sway: `aSway`, drawn with the village's wind), the hive stand
 * and the windfalls. As instanced sets these were seven draws and four hulls for a few hundred things that never move; the barley, thousands of clumps that bend in
 * the wind, stays instanced (WorldView). `lod` 0 is the coarse build (the low preset draws it, as its trees); `hull` is the ink hull's: the solids only (a ridge or a
 * windfall has no outline worth drawing).
 */
export function buildWorkedLand(p: ScatterPlan, lod: Lod, hull = false): BufferGeometry | undefined {
  const k = new Kit({ sway: true });
  const f = p.fields;
  const at = (it: Item): Kit => k.setBase(it.x, it.y, it.z, -it.yaw);
  for (const it of f.stooks) addStook(at(it), lod);
  for (const it of f.haycocks) addHaycock(at(it), lod);
  for (const it of f.scarecrows) addScarecrow(at(it), lod);
  for (const it of p.hives) addHiveStand(at(it), lod, it.cls, HIVE_STAND.pitch, HIVE_STAND.plank);
  for (const it of p.orchard) addFruitTree(at(it), lod, it.sx);
  if (!hull) {
    for (const it of p.windfalls) addWindfall(at(it), it.cls === 1);
    // the plough's ridges (earth on the crest, the furrow's darker soil down the flanks) and the drills of the young barley (green along the crest)
    const RH = 0.13, DH = 0.16;
    const ridge = ridgeGeometry(W.dirt, W.vlSoil, 0.34, RH);
    const drill = ridgeGeometry(W.vlLeafy, W.dirt, 0.3, DH);
    // (the instanced ridge's per-vertex tint has no place in a merged solid: every part must carry the same attributes)
    ridge.deleteAttribute("aTint");
    drill.deleteAttribute("aTint");
    const lay = (it: Item, g: BufferGeometry, top: number, side: number, height: number): void => {
      k.setBase(it.x, it.y, it.z, 0).add(g, { scale: [1, 1, it.sz], rot: [it.tiltX ?? 0, 0, 0], colour: (q, _n, out) => blend(out, side, top, Math.min(1, Math.max(0, q.y / height))) });
    };
    for (const it of f.furrows) lay(it, ridge, W.dirt, W.vlSoil, RH);
    for (const it of f.drills) lay(it, drill, W.vlLeafy, W.dirt, DH);
    ridge.dispose();
    drill.dispose();
  }
  k.clearBase();
  return k.build();
}
