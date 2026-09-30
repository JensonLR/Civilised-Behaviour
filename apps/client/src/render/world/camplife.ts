import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, LatheGeometry, SphereGeometry, TorusGeometry, Vector2, type Vector3 } from "three";
import { CAMP, PALETTE, hash3, ruinPlan, type CollisionWorld } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import type { Lod } from "./flora.ts";

/**
 * The living details of the camp: the survey table, the brass telescope trained on the Observatory, a gramophone on a tea table, a
 * washing line, a hammock and hanging lanterns. Each collidable one is drawn from the SAME `CAMP` numbers that build its obstacle
 * (camp.ts), so what you see is what stops you. Everything solid merges into the camp's single geometry (no extra draws); the lantern
 * glass is a separate tiny unlit mesh because it glows at dusk.
 */

const C = PALETTE.camp;
const f01 = (seed: number, a: number, b = 0): number => hash3(seed, a, b, 0) / 4294967296;

const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

/** A post: tapered, with a cap and a peg at the foot. The obstacle is a circle of radius `r` and height `h`. */
export function post(k: Kit, r: number, h: number): void {
  k.limb([0, -0.35, 0], [0, h, 0], r * 1.15, r, (p, _n, out) => blend(out, C.signWood, C.pole, Math.min(1, Math.max(0, p.y / h)) * 0.5), 6);
  k.add(new ConeGeometry(r * 1.5, 0.14, 6), { at: [0, h + 0.05, 0], colour: C.signWood, flat: true });
}

// ---- the survey table --------------------------------------------------------------------------------------------------------------

/** A trestle table draped in the Society's maroon baize, the survey pinned flat (the map itself is a textured quad, see `buildBanners`). */
export function mapTable(k: Kit, lod: Lod): void {
  const { hx, hz, height } = CAMP.mapTable;
  box(k, [hx * 2, 0.06, hz * 2], [0, height - 0.03, 0], C.signWood);
  box(k, [hx * 2 + 0.1, 0.02, hz * 2 + 0.1], [0, height + 0.005, 0], C.tableCloth);
  // the cloth hangs over the two long edges
  for (const s of [-1, 1]) box(k, [hx * 2 + 0.1, 0.34, 0.02], [0, height - 0.18, s * (hz + 0.05)], C.tableCloth);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (hx - 0.1), 0, sz * (hz - 0.09)], [sx * (hx - 0.12), height - 0.06, sz * (hz - 0.11)], 0.035, 0.028, C.signWood, 5);
  box(k, [hx * 2 - 0.3, 0.05, 0.05], [0, 0.32, 0], C.signWood); // stretcher
  if (!lod) return;
  // instruments: an inkwell, a brass compass, a roll of paper, a pipe
  k.add(new CylinderGeometry(0.045, 0.05, 0.08, 8), { at: [hx - 0.2, height + 0.05, hz - 0.15], colour: C.iron, flat: true });
  k.limb([hx - 0.2, height + 0.09, hz - 0.15], [hx - 0.33, height + 0.28, hz - 0.2], 0.006, 0.003, C.hatbox, 3);
  k.add(new CylinderGeometry(0.07, 0.07, 0.03, 12), { at: [-hx + 0.25, height + 0.025, hz - 0.12], colour: C.brass, flat: true });
  k.add(new CylinderGeometry(0.035, 0.035, 0.5, 8), { at: [-hx + 0.3, height + 0.05, -hz + 0.13], rot: [0, 0, Math.PI / 2], colour: C.mapPaper, flat: true });
  k.add(new SphereGeometry(0.03, 6, 4), { at: [0.1, height + 0.03, hz - 0.1], colour: C.brass });
}

// ---- the telescope -----------------------------------------------------------------------------------------------------------------

/** A brass field telescope on a tripod, drawn in a frame where +x points where the collision yaw points (at the Observatory). */
export function telescope(k: Kit, lod: Lod): void {
  const { r } = CAMP.scope;
  const pivot: V3 = [0, 1.28, 0];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    k.limb([Math.cos(a) * (r - 0.03), 0, Math.sin(a) * (r - 0.03)], [Math.cos(a) * 0.06, pivot[1] - 0.05, Math.sin(a) * 0.06], 0.026, 0.02, C.signWood, 5);
  }
  k.add(new CylinderGeometry(0.09, 0.07, 0.1, 8), { at: [0, pivot[1] - 0.02, 0], colour: C.brass, flat: true });
  const tip = (t: number): V3 => [-0.42 + t * 1.32, pivot[1] + 0.03 + t * 0.34, 0];
  k.limb(tip(0), tip(0.28), 0.028, 0.034, C.leather, 8);
  k.limb(tip(0.28), tip(0.72), 0.034, 0.05, C.brass, 10);
  k.limb(tip(0.72), tip(1), 0.05, 0.062, C.leather, 10);
  k.add(new TorusGeometry(0.054, 0.012, 4, 10), { at: tip(0.72), rot: [0, Math.PI / 2 - 0.25, 0], colour: C.brass });
  if (!lod) return;
  k.add(new TorusGeometry(0.064, 0.014, 4, 10), { at: tip(1), rot: [0, Math.PI / 2 - 0.25, 0], colour: C.brass });
  k.add(new CylinderGeometry(0.038, 0.038, 0.05, 8), { at: tip(-0.02), rot: [0, 0, Math.PI / 2 - 0.25], colour: C.iron, flat: true });
}

// ---- the gramophone ----------------------------------------------------------------------------------------------------------------

/** A round tea table (the obstacle) bearing a wooden-cased gramophone with a flared brass horn. */
export function gramophone(k: Kit, lod: Lod): void {
  const { r, height } = CAMP.gramophone;
  k.add(new CylinderGeometry(r, r, 0.04, 14), { at: [0, height - 0.02, 0], colour: C.signWood, flat: true });
  k.add(new CylinderGeometry(r * 0.96, r * 0.96, 0.012, 14), { at: [0, height + 0.006, 0], colour: C.mapPaper, flat: true });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    k.limb([Math.cos(a) * (r - 0.08), 0, Math.sin(a) * (r - 0.08)], [Math.cos(a) * 0.05, height - 0.05, Math.sin(a) * 0.05], 0.03, 0.022, C.signWood, 5);
  }
  const top = height + 0.012;
  box(k, [0.36, 0.17, 0.32], [0, top + 0.085, 0], C.cartWood);
  box(k, [0.38, 0.03, 0.34], [0, top + 0.185, 0], C.signWood);
  k.add(new CylinderGeometry(0.135, 0.135, 0.012, 14), { at: [0, top + 0.206, 0], colour: C.iron, flat: true });
  k.add(new CylinderGeometry(0.02, 0.02, 0.03, 6), { at: [0, top + 0.22, 0], colour: C.brass, flat: true });
  // horn: a brass flare rising from the back of the case, tilted toward the listeners
  const prof: [number, number][] = [
    [0.02, 0],
    [0.035, 0.12],
    [0.07, 0.24],
    [0.13, 0.37],
    [0.22, 0.48],
    [0.235, 0.5],
  ];
  const horn = new LatheGeometry(prof.map(([rr, y]) => new Vector2(rr, y)), lod ? 12 : 8);
  k.add(horn, { at: [-0.17, top + 0.22, 0], rot: [0, 0, 0.95], colour: (p, _n, out) => blend(out, C.horn, C.brass, Math.min(1, p.y * 1.4)), flat: true });
  if (!lod) return;
  k.limb([0.1, top + 0.24, 0.02], [0.02, top + 0.29, 0.05], 0.01, 0.006, C.brass, 3); // the tone arm
  k.add(new CylinderGeometry(0.02, 0.02, 0.16, 6), { at: [0.19, top + 0.13, 0.1], rot: [0, 0, Math.PI / 2], colour: C.brass, flat: true }); // the winding handle
}

// ---- the washing line --------------------------------------------------------------------------------------------------------------

/** Rope and laundry between the two wash poles, in WORLD coordinates (call with the base cleared). */
export function washLine(k: Kit, world: CollisionWorld, lod: Lod, cloth?: Kit): void {
  const { a, b, height } = CAMP.wash;
  const ya = world.terrainHeight(a.x, a.z) + height - 0.06;
  const yb = world.terrainHeight(b.x, b.z) + height - 0.06;
  const segs = lod ? 14 : 8;
  const sag = 0.42;
  const pt = (t: number): V3 => [a.x + (b.x - a.x) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t];
  for (let i = 0; i < segs; i++) k.limb(pt(i / segs), pt((i + 1) / segs), 0.008, 0.008, C.rope, 3);
  const yaw = Math.atan2(b.z - a.z, b.x - a.x);
  const linen = PALETTE.material.linen;
  const items: { t: number; w: number; h: number; colour: number; kind: "shirt" | "cloth" | "longs" | "sock" }[] = [
    { t: 0.12, w: 0.55, h: 0.62, colour: linen, kind: "shirt" },
    { t: 0.27, w: 0.3, h: 0.78, colour: PALETTE.cloth[6]!, kind: "longs" },
    { t: 0.42, w: 0.85, h: 0.6, colour: C.canvas, kind: "cloth" },
    { t: 0.58, w: 0.5, h: 0.6, colour: PALETTE.cloth[1]!, kind: "shirt" },
    { t: 0.72, w: 0.14, h: 0.24, colour: PALETTE.cloth[11]!, kind: "sock" },
    { t: 0.79, w: 0.14, h: 0.24, colour: PALETTE.cloth[11]!, kind: "sock" },
    { t: 0.9, w: 0.32, h: 0.75, colour: linen, kind: "longs" },
  ];
  k.clearBase();
  if (!cloth) return; // the laundry moves in the wind: it lives in the camp's cloth geometry (buildCampCloth)
  const swayKit = cloth;
  swayKit.clearBase();
  items.forEach((it, i) => {
    const p = pt(it.t);
    const sway = (f01(300, i) - 0.5) * 0.16;
    swayKit.setBase(p[0], p[1], p[2], yaw);
    const c: ColourFn = (q, _n, out) => blend(out, it.colour, PALETTE.material.soot, 0.06 + Math.abs(q.y) * 0.05);
    const hang = -it.h / 2 - 0.012;
    // loose at the bottom hem, pinned at the line: weight 0 at the top edge, 1 at the hem
    const loose = (h: number, hx = 0) => (v: Vector3): number => Math.max(0, 0.5 - v.y / h) * (0.85 + 0.15 * Math.sin(v.x * 9 + i)) + hx * 0.1;
    if (it.kind === "shirt") {
      swayKit.add(new BoxGeometry(it.w, it.h, 0.025), { at: [0, hang, 0], rot: [sway, 0, 0], colour: c, flat: true, sway: loose(it.h) });
      // sleeves hang loose either side
      for (const s of [-1, 1]) swayKit.add(new BoxGeometry(0.16, 0.36, 0.022), { at: [s * (it.w / 2 + 0.06), hang + it.h * 0.15, 0], rot: [sway, 0, s * 0.15], colour: c, flat: true, sway: loose(0.36, 1) });
    } else if (it.kind === "longs") {
      for (const s of [-1, 1]) swayKit.add(new BoxGeometry(it.w * 0.46, it.h, 0.025), { at: [s * it.w * 0.26, hang, 0], rot: [sway, 0, 0], colour: c, flat: true, sway: loose(it.h) });
      swayKit.add(new BoxGeometry(it.w, it.h * 0.22, 0.026), { at: [0, -it.h * 0.11, 0], rot: [sway, 0, 0], colour: c, flat: true, sway: 0.05 });
    } else {
      swayKit.add(new BoxGeometry(it.w, it.h, 0.02), { at: [0, hang, 0], rot: [sway * 0.5, 0, 0], colour: c, flat: true, sway: loose(it.h) });
    }
    if (lod) for (const s of [-0.7, 0.7]) swayKit.add(new BoxGeometry(0.026, 0.07, 0.04), { at: [s * it.w * 0.4, 0.0, 0], colour: C.signWood, flat: true, sway: 0 });
    swayKit.clearBase();
  });
}

// ---- the hammock -------------------------------------------------------------------------------------------------------------------

/** Canvas hammock slung between the two hammock posts, with spreader bars, rope and a bolster; in WORLD coordinates. */
export function hammock(k: Kit, world: CollisionWorld, lod: Lod, cloth?: Kit): void {
  const { a, b, height } = CAMP.hammock;
  const ya = world.terrainHeight(a.x, a.z) + height - 0.4;
  const yb = world.terrainHeight(b.x, b.z) + height - 0.4;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.z - a.z, b.x - a.x);
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const seg = 12;
  const inner = len - 0.7;
  const clothGeo = new BoxGeometry(inner, 0.035, 0.82, seg, 1, 4);
  const p = clothGeo.attributes.position as BufferAttribute;
  const sag = 0.62;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) + inner / 2) / inner; // 0 at post a, 1 at post b
    const across = p.getZ(i) / 0.41;
    p.setY(i, p.getY(i) + (ya + (yb - ya) * t) - (ya + yb) / 2 - sag * 4 * t * (1 - t) + across * across * 0.09);
  }
  const stripe: ColourFn = (q, _n, out) => blend(out, C.canvas, PALETTE.cloth[0]!, Math.floor((q.z + 0.5) * 5) % 2 === 0 ? 0.55 : 0.05);
  k.setBase(mx, (ya + yb) / 2, mz, yaw);
  // the canvas belly swings most in the middle and is held still at the spreader bars
  const belly = (v: Vector3): number => {
    const t = (v.x + inner / 2) / inner;
    return Math.max(0, 1 - (2 * t - 1) ** 2) * 0.7;
  };
  if (cloth) {
    cloth.setBase(mx, (ya + yb) / 2, mz, yaw);
    cloth.add(clothGeo, { colour: stripe, perFace: true, sway: belly });
  }
  // spreader bars and the ropes up to the posts
  for (const s of [-1, 1]) {
    const y = s < 0 ? ya : yb;
    const yl = y - (ya + yb) / 2 - 0.02;
    box(k, [0.05, 0.05, 0.92], [s * (inner / 2 + 0.05), yl, 0], C.signWood);
    for (const z of [-0.42, 0.42]) k.limb([s * (inner / 2 + 0.05), yl, z], [s * (len / 2 - 0.06), yl + 0.34, 0], 0.011, 0.011, C.rope, 3);
  }
  if (lod && cloth) {
    // a bolster at the head end
    const sagAt = (t: number): number => (ya + (yb - ya) * t) - sag * 4 * t * (1 - t) - (ya + yb) / 2;
    cloth.add(new CylinderGeometry(0.12, 0.12, 0.66, 8), { at: [-inner * 0.36, sagAt(0.14) + 0.14, 0], rot: [Math.PI / 2, 0, 0], colour: PALETTE.material.linen, flat: true, sway: 0.25 });
  }
  k.clearBase();
  cloth?.clearBase();
}

// ---- lanterns ----------------------------------------------------------------------------------------------------------------------

/** Hook arms, chains and the brass frames of the hanging lanterns (world coordinates). Their glass is `lanternGlass`. */
export function lanternFrames(k: Kit, world: CollisionWorld, lod: Lod, swing?: Kit): void {
  k.clearBase();
  swing?.clearBase();
  for (const l of CAMP.lanterns) {
    const g = world.terrainHeight(l.x, l.z);
    const y = g + l.y;
    const hasPole = world.obstacles.some((o) => o.tag === "pole" && Math.abs(o.x - (l.x - 0.32)) < 0.06 && Math.abs(o.z - l.z) < 0.06);
    const armY = y + 0.5;
    if (!hasPole) k.limb([l.x - 0.32, g - 0.3, l.z], [l.x - 0.32, armY + 0.04, l.z], 0.032, 0.026, C.signWood, 5);
    k.limb([l.x - 0.32, armY, l.z], [l.x, armY, l.z], 0.014, 0.012, C.iron, 4);
    // the lantern swings on its chain: the chain and the frame hang free below the hook (weight grows down the chain, full on the frame)
    swing?.limb([l.x, armY, l.z], [l.x, y + 0.24, l.z], 0.005, 0.005, C.iron, 3, false, (t) => t * LANTERN_SWING);
    swing?.add(new ConeGeometry(0.11, 0.1, 6), { at: [l.x, y + 0.2, l.z], colour: C.brass, flat: true, sway: LANTERN_SWING });
    swing?.add(new CylinderGeometry(0.085, 0.09, 0.03, 6), { at: [l.x, y - 0.155, l.z], colour: C.brass, flat: true, sway: LANTERN_SWING });
    if (lod) for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      swing?.limb([l.x + Math.cos(a) * 0.09, y - 0.14, l.z + Math.sin(a) * 0.09], [l.x + Math.cos(a) * 0.085, y + 0.16, l.z + Math.sin(a) * 0.085], 0.006, 0.006, C.brass, 3, false, LANTERN_SWING);
    }
  }
}

/** How loose a hanging lantern is (the weight `aSway` gives its frame and glass; the glow point uses the same). */
export const LANTERN_SWING = 0.5;

/** Every hanging lantern in the world: the camp's, and the one in the Observatory's dark room (last). */
export function lanternSpots(world: CollisionWorld): readonly { x: number; y: number; z: number }[] {
  if (world.obstacles.length === 0) return [];
  return [...CAMP.lanterns, ruinPlan(world.terrain).lantern];
}

/** The lantern glass as a tiny unlit geometry (vertex colours; the material brightens with the lamp level). Carries `aSway`: it swings with the frame. */
export function lanternGlass(world: CollisionWorld): BufferGeometry | undefined {
  const k = new Kit({ sway: true });
  k.clearBase();
  for (const l of lanternSpots(world)) {
    const y = world.terrainHeight(l.x, l.z) + l.y;
    k.add(new CylinderGeometry(0.078, 0.084, 0.28, 6), { at: [l.x, y, l.z], colour: (p, _n, out) => blend(out, C.glowLantern, C.flameCore, Math.max(0, 1 - Math.abs(p.y) * 6)), flat: true, sway: LANTERN_SWING });
  }
  return k.build();
}

/** Everything in the camp that moves in the wind, as one geometry with `aSway` (the washing, the hammock's canvas, the lanterns' chains and frames). */
export function buildCampCloth(world: CollisionWorld, lod: Lod): BufferGeometry | undefined {
  const cloth = new Kit({ sway: true });
  // the still parts (rope, hooks, posts, spreader bars) go into a throwaway kit here; `buildLandmarks` builds them for real
  const still = new Kit();
  washLine(still, world, lod, cloth);
  hammock(still, world, lod, cloth);
  lanternFrames(still, world, lod, cloth);
  still.build()?.dispose();
  return cloth.build();
}
