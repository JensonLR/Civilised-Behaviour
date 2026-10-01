import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, SphereGeometry } from "three";
import { MODEL_SCALE, PALETTE, outpostPlan, type HqHistoryPiece, type OutpostPiece } from "@cb/shared";
import { Kit } from "./kit.ts";

/**
 * HQ decorated by what the campaign has done (D-035): the shared `historyPieces()` placed ONLY on surfaces HQ already has (the planning table, the strongbox, the marquee's back
 * wall), drawn as ONE merged vertex-coloured geometry (one draw, one ink hull: <= +2 draws). The scale model of the outpost on the table is built from the same `outpostPlan(stage)` the
 * collision world uses, at `MODEL_SCALE`. Palette colours only; no collider anywhere (the pieces stand on, or hang from, solids that already exist).
 */

const O = PALETTE.outpost;
const K = PALETTE.kessar;
const C = PALETTE.camp;
const box = (k: Kit, s: readonly [number, number, number], at: readonly [number, number, number], colour: number, rot?: readonly [number, number, number]): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

const MODEL_COLOUR: Partial<Record<OutpostPiece["kind"], number>> = {
  tent: O.canvas, hut: O.plank, house: O.stoneHouse, hall: O.stoneHouse, palisade: O.palisade, tower: O.palisadeTop, mill: O.plankDark, clock: O.clockFace, wall: O.stoneShade, well: O.stoneShade, stall: K.awning,
  rail: O.plankDark, post: O.pole, bell: O.brass, fire: C.ember,
};

function model(k: Kit, p: HqHistoryPiece, gy: number): void {
  if (!p.stage) return;
  const plan = outpostPlan(p.stage);
  const s = MODEL_SCALE;
  k.setBase(p.x, gy + p.base, p.z, p.yaw);
  box(k, [p.hx * 2, 0.012, p.hz * 2], [0, 0.006, 0], O.mud);
  for (const q of plan.pieces) {
    if (!q.solid) continue;
    const dx = (q.x - plan.site.x) * s, dz = (q.z - plan.site.z) * s;
    const h = Math.max(0.008, q.height * s * 1.6);
    const c = MODEL_COLOUR[q.kind] ?? O.stoneHouse;
    if (q.shape === "circle") k.add(new CylinderGeometry(Math.max(0.006, q.hx * s), Math.max(0.006, q.hx * s), h, 6), { at: [dx, 0.012 + h / 2, dz], colour: c, flat: true });
    else box(k, [Math.max(0.01, q.hx * 2 * s), h, Math.max(0.006, q.hz * 2 * s)], [dx, 0.012 + h / 2, dz], c, [0, -q.yaw, 0]);
  }
  k.clearBase();
}

function piece(k: Kit, p: HqHistoryPiece, gy: number, lod: number): void {
  if (p.kind === "model") return model(k, p, gy);
  k.setBase(p.x, gy + p.base, p.z, p.yaw);
  const w = p.hz * 2, d = p.hx * 2, h = p.height;
  switch (p.kind) {
    case "lamp":
      k.add(new CylinderGeometry(0.06, 0.08, 0.05, 8), { at: [0, 0.025, 0], colour: O.brass, flat: true });
      k.add(new CylinderGeometry(0.075, 0.075, h - 0.1, 8), { at: [0, 0.05 + (h - 0.1) / 2, 0], colour: C.glass, flat: true });
      k.add(new ConeGeometry(0.1, 0.07, 8), { at: [0, h - 0.03, 0], colour: O.brass, flat: true });
      break;
    case "bridge":
      box(k, [d, h, w], [0, h / 2, 0], K.stone);
      box(k, [d * 0.9, h * 0.35, w * 0.4], [0, h + h * 0.17, 0], K.stoneShade, [0, 0.4, 0.2]);
      break;
    case "portrait":
      box(k, [d, h, w], [0, h / 2, 0], O.plankDark);
      box(k, [d + 0.005, h * 0.78, w * 0.8], [0.004, h / 2, 0], C.canvas);
      k.add(new SphereGeometry(w * 0.16, 6, 5), { at: [0.01, h * 0.58, 0], colour: PALETTE.skin[2] ?? C.canvas });
      break;
    case "frame":
      box(k, [d, h, w], [0, h / 2, 0], O.plankDark);
      box(k, [d + 0.005, h * 0.82, w * 0.84], [0.004, h / 2, 0], O.sign);
      break;
    case "crate":
      box(k, [d, h, w], [0, h / 2, 0], C.cartWood);
      box(k, [d + 0.004, h * 0.4, w * 0.5], [0.002, h * 0.55, 0], K.synStripe);
      break;
    case "stone":
      k.add(new CylinderGeometry(p.hx * 0.7, p.hx, h, 4), { at: [0, h / 2, 0], rot: [0, Math.PI / 4, 0], colour: K.stone, flat: true });
      k.add(new ConeGeometry(p.hx * 0.75, 0.04, 4), { at: [0, h + 0.02, 0], rot: [0, Math.PI / 4, 0], colour: K.stoneCap, flat: true });
      break;
    case "board":
      box(k, [d, h, w], [0, h / 2, 0], O.plank, [0, 0, 0.08]);
      break;
    case "key":
      box(k, [d, 0.012, w * 0.3], [0, 0.006, 0], O.brass);
      k.add(new CylinderGeometry(0.03, 0.03, 0.012, 8), { at: [0, 0.006, -w * 0.4], colour: O.brass, flat: true });
      break;
    case "pennant": {
      const col = p.tech === "launch" ? K.wardBlue : p.tech === "telegraph" ? O.pennantRival : O.pennantSociety;
      k.limb([0, 0, -w / 2], [0, h, -w / 2], 0.008, 0.008, O.pole, 4);
      box(k, [d, h * 0.8, w * 0.9], [0, h * 0.55, 0.02], col);
      if (lod) box(k, [d + 0.003, h * 0.14, w * 0.9], [0.002, h * 0.4, 0.02], O.string);
      break;
    }
    case "envelope":
      box(k, [d, h, w], [0, h / 2, 0], O.canvas);
      box(k, [d + 0.003, h, w * 0.3], [0, h / 2 + 0.002, 0], O.canvasShade);
      break;
    case "barrel":
      k.add(new CylinderGeometry(p.hx * 0.7, p.hx, h, 8), { at: [0, h / 2, 0], rot: [0, 0, 0.3], colour: C.iron, flat: true });
      break;
  }
  k.clearBase();
}

/** All pieces merged (undefined when there are none). `ground` gives the terrain height under a piece (HQ is flat, but ask anyway). */
export function buildHqHistoryGeometry(pieces: readonly HqHistoryPiece[], ground: (x: number, z: number) => number, lod: 0 | 1): BufferGeometry | undefined {
  if (pieces.length === 0) return undefined;
  const k = new Kit();
  for (const p of pieces) piece(k, p, ground(p.x, p.z), lod);
  k.clearBase();
  return k.build();
}
