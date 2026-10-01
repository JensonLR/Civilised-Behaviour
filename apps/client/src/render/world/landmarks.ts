import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { CAMP, PALETTE, classifyObstacle, hash3, type CollisionWorld, type Obstacle } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import { crateParts } from "./objects.ts";
import type { Lod } from "./flora.ts";
import { FLAG_UV, MAP_UV, boardUv } from "./atlas.ts";
import { villageBanners } from "./banners.ts";
import { hqBanners, hqSolid } from "./hq.ts";
import { gramophone, hammock, lanternFrames, mapTable, post, telescope, washLine } from "./camplife.ts";

/**
 * The expedition camp and the ruined wall, dressed from the tagged obstacles of `createArena`. Everything solid is merged into
 * ONE vertex-coloured geometry (one draw + one ink hull for the whole camp); the pennant and the signboard lettering share one
 * textured geometry (`buildBanners`); the flame is separate because it glows and flickers (`buildFlame`).
 */

const C = PALETTE.camp;
const W = PALETTE.world;
const cPale = new Color(W.rockPale);
const h01 = (seed: number, a: number, b = 0, c = 0): number => hash3(seed, a, b, c) / 4294967296;
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

/** Tagged obstacles of one kind. */
const tagged = (world: CollisionWorld, tag: string): Obstacle[] => world.obstacles.filter((o) => classifyObstacle(o) === tag);

// ---- bell tent -------------------------------------------------------------------------------------------------------------------

const TENT_PROFILE: readonly (readonly [number, number])[] = [
  [1.0, -0.08],
  [1.0, 0.2],
  [1.0, 0.215],
  [1.0, 0.72],
  [0.94, 0.98],
  [0.72, 1.38],
  [0.45, 1.82],
  [0.3, 1.98],
  [0.29, 2.005],
  [0.17, 2.14],
  [0.08, 2.26],
];
const SECTORS = 16;

/** An elliptical bell tent: sixteen flat canvas panels alternating in tone, a red hem, a red crown, a dark doorway between tied-back flaps, a finial and guy ropes. Long axis +x, door at +x. */
export function tent(k: Kit, lod: Lod): void {
  const { hx, hz } = CAMP.tentHalf;
  const body = new LatheGeometry(TENT_PROFILE.map(([r, y]) => new Vector2(r, y)), SECTORS);
  body.rotateY(Math.PI / SECTORS);
  const sector = (p: Vector3): number => Math.floor((Math.atan2(p.x, p.z) - Math.PI / SECTORS) / ((Math.PI * 2) / SECTORS) + SECTORS * 4) % SECTORS;
  const canvas: ColourFn = (p, _n, out) => {
    const s = sector(p);
    blend(out, C.canvas, C.canvasShade, s % 2 ? 0.42 : 0.02);
    if (p.y < 0.205 || p.y > 1.99) out.set(C.canvasTrim);
  };
  k.add(body, { scale: [hx, 1, hz], colour: canvas, flat: true });
  // doorway: one sector, a hair proud of the canvas
  const door = new LatheGeometry(
    TENT_PROFILE.slice(0, 6).map(([r, y]) => new Vector2(r * 1.012, y)),
    1,
    (7 * Math.PI) / 16,
    Math.PI / 8,
  );
  // D-038: the flap is TIED SHUT (canvas, not a dark opening: nobody walks in; the tent is a small solid box): a seam, two ties, a bedroll against the canvas and, on alternate tents, a boot
  k.add(door, { scale: [hx, 1, hz], colour: (p, _n, out) => blend(out, C.canvas, C.canvasShade, 0.65 + 0.2 * Math.sin(p.y * 9)), flat: true });
  k.limb([hx * 0.985, 0.22, 0], [hx * 0.83, 1.55, 0], 0.012, 0.012, C.canvasTrim, 3);
  for (const y of [0.55, 1.0]) {
    k.limb([hx * (1 - y * 0.075), y, -0.18], [hx * (1 - y * 0.075) + 0.05, y - 0.03, 0.18], 0.014, 0.014, C.rope, 3);
    k.add(new SphereGeometry(0.035, 4, 3), { at: [hx * (1 - y * 0.075) + 0.05, y - 0.03, 0], colour: C.rope });
  }
  k.limb([hx - 0.03, 0.14, 0.55], [hx - 0.03, 0.14, 1.35], 0.13, 0.13, C.tentDoor, 6, true);   // (against the canvas: inside the tent's collision footprint)
  if (Math.round(k.yaw * 10) % 2 === 0) box(k, [0.16, 0.2, 0.3], [hx - 0.05, 0.1, -0.6], C.charred, [0, 0.4, 0]);
  // finial
  k.limb([0, 2.2, 0], [0, 2.42, 0], 0.025, 0.02, C.pole, 5);
  k.add(new SphereGeometry(0.05, 6, 4), { at: [0, 2.45, 0], colour: C.brass });
  if (!lod) return;
  // guy ropes and pegs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const top: V3 = [hx * 0.58 * ca, 1.55, hz * 0.58 * sa];
    const peg: V3 = [(hx + 1.15) * ca, 0.03, (hz + 1.15) * sa];
    k.limb(top, peg, 0.011, 0.011, C.rope, 3);
    box(k, [0.05, 0.18, 0.05], [peg[0], 0.07, peg[2]], C.pole, [0, -a, 0.35]);
  }
}

// ---- campfire --------------------------------------------------------------------------------------------------------------------

export function fireRing(k: Kit, lod: Lod): void {
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const r = 0.5 + h01(5, i) * 0.06;
    const s: V3 = [0.15 + h01(6, i) * 0.06, 0.1 + h01(7, i) * 0.05, 0.14 + h01(8, i) * 0.05];
    k.add(new IcosahedronGeometry(1, 0), {
      at: [Math.cos(a) * r, 0.07, Math.sin(a) * r],
      scale: s,
      rot: [0, a, 0],
      colour: (_p, n, out) => blend(out, C.fireStone, W.rockPale, n.y * 0.6),
      flat: true,
      jitter: 0.1,
      seed: 50 + i,
    });
  }
  k.add(new CylinderGeometry(0.44, 0.46, 0.05, 10), { at: [0, 0.02, 0], colour: C.charred, flat: true });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const outer: V3 = [Math.cos(a) * 0.5, 0.09, Math.sin(a) * 0.5];
    const inner: V3 = [Math.cos(a) * 0.05, 0.3, Math.sin(a) * 0.05];
    k.limb(outer, inner, 0.06, 0.05, (p, _n, out) => blend(out, C.log, C.charred, 1 - smooth(0.0, 0.5, Math.hypot(p.x, p.z) * 1.4 + 0.05)), 6, true);
  }
  // tripod and hanging pot
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.2;
    k.limb([Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95], [Math.cos(a) * 0.06, 1.55, Math.sin(a) * 0.06], 0.026, 0.02, C.iron, 5);
  }
  if (!lod) return;
  k.limb([0, 1.5, 0], [0, 1.16, 0], 0.008, 0.008, C.iron, 3);
  k.add(new SphereGeometry(0.17, 9, 6), { at: [0, 1.0, 0], scale: [1, 0.78, 1], colour: C.iron, flat: true });
  k.add(new CylinderGeometry(0.15, 0.15, 0.03, 9), { at: [0, 1.14, 0], colour: C.charred, flat: true });
}

/**
 * The flame: seven curling tongues of different heights leaning out of the logs, each graded from deep orange at the root through
 * amber to a pale tip, unlit. Origin at the base of the fire.
 */
export function buildFlame(): BufferGeometry {
  const k = new Kit();
  const prof = [
    [0.0, 0.0],
    [0.2, 0.02],
    [0.22, 0.16],
    [0.17, 0.38],
    [0.09, 0.62],
    [0.03, 0.82],
    [0.0, 0.96],
  ];
  const tongue = (height: number, girth: number, bend: number, at: V3, turn: number, seed: number): void => {
    const g = new LatheGeometry(prof.map(([r, y]) => new Vector2(r, y)), 6);
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + bend * p.getY(i) * p.getY(i));
    k.add(g, {
      at,
      scale: [girth, height, girth],
      rot: [0, turn, 0],
      seed,
      colour: (q, _n, out) => {
        const t = Math.min(1, Math.max(0, q.y / 0.96));
        if (t < 0.5) blend(out, C.flameOuter, C.flameMid, t / 0.5);
        else blend(out, C.flameMid, C.flameCore, (t - 0.5) / 0.5);
      },
    });
  };
  tongue(1.0, 1.0, 0.16, [0, 0, 0], 0.2, 1);
  tongue(0.74, 0.8, -0.22, [0.15, 0, 0.05], 1.4, 2);
  tongue(0.68, 0.8, 0.3, [-0.13, 0, 0.09], 2.4, 3);
  tongue(0.58, 0.7, -0.3, [0.02, 0, -0.16], 3.4, 4);
  tongue(0.5, 0.65, 0.34, [0.1, 0, 0.14], 4.4, 5);
  tongue(0.46, 0.6, -0.36, [-0.16, 0, -0.06], 5.4, 6);
  tongue(0.8, 0.55, 0.05, [0.02, 0.02, 0.02], 0.9, 7);
  return k.build()!;
}

// ---- flag pole ------------------------------------------------------------------------------------------------------------------

export function flagPole(k: Kit, lod: Lod): void {
  const top = CAMP.flag.height;
  k.limb([0, -0.2, 0], [0, top, 0], 0.075, 0.042, (p, _n, out) => blend(out, C.pole, C.canvas, smooth(0, top, p.y) * 0.3), 8);
  k.add(new CylinderGeometry(0.15, 0.18, 0.28, 8), { at: [0, 0.14, 0], colour: C.brass, flat: true });
  k.add(new SphereGeometry(0.1, 8, 6), { at: [0, top + 0.08, 0], colour: C.brass });
  if (!lod) return;
  k.limb([0.07, 1.0, 0], [0.08, top - 0.8, 0.02], 0.007, 0.007, C.rope, 3);
  box(k, [0.16, 0.05, 0.05], [0.09, 1.3, 0], C.brass);
}

// ---- signpost --------------------------------------------------------------------------------------------------------------------

/** The four boards, top to bottom: height above ground, yaw (three rotation.y), length. */
export const SIGN_BOARDS = [
  { y: 2.45, yaw: -0.3, len: 1.6 },
  { y: 2.05, yaw: -2.2, len: 1.6 },
  { y: 1.65, yaw: Math.PI + 0.12, len: 1.72 },
  { y: 1.25, yaw: Math.PI / 2 + 0.2, len: 1.55 },
] as const;

function arrowShape(len: number): Shape {
  const s = new Shape();
  s.moveTo(-0.12, -0.15);
  s.lineTo(len - 0.28, -0.15);
  s.lineTo(len, 0);
  s.lineTo(len - 0.28, 0.15);
  s.lineTo(-0.12, 0.15);
  s.closePath();
  return s;
}
const BOARD_DEPTH = 0.05;

export function signpost(k: Kit, lod: Lod): void {
  const h = CAMP.sign.height;
  k.limb([0, -0.3, 0], [0.02, h, 0], 0.09, 0.075, (p, _n, out) => blend(out, C.signWood, C.pole, smooth(0, 0.6, p.y) * 0.3), 6);
  k.add(new ConeGeometry(0.13, 0.2, 4), { at: [0.02, h + 0.1, 0], rot: [0, Math.PI / 4, 0], colour: C.signWood, flat: true });
  for (const b of SIGN_BOARDS) {
    const g = new ExtrudeGeometry(arrowShape(b.len), { depth: BOARD_DEPTH, bevelEnabled: false });
    k.add(g, { at: [0, b.y, -BOARD_DEPTH / 2], rot: [0, b.yaw, 0], colour: (_p, n, out) => blend(out, C.signWood, C.pole, Math.abs(n.z) < 0.5 ? 0.5 : 0.08), flat: true });
    if (lod) {
      // iron straps where the board meets the post
      box(k, [0.05, 0.34, BOARD_DEPTH + 0.02], [0, b.y, 0], C.iron, [0, b.yaw, 0]);
    }
  }
}

// ---- luggage ---------------------------------------------------------------------------------------------------------------------

function trunkBox(k: Kit, w: number, h: number, d: number, colour: number, at: V3, yaw: number, lod: Lod): void {
  const rot: V3 = [0, yaw, 0];
  const c: ColourFn = (p, n, out) => blend(out, colour, C.strap, p.y > h * 0.38 ? 0.28 : 0); // the lid is a shade darker
  k.add(new BoxGeometry(w, h, d), { at, rot, colour: c, flat: true });
  const local = (x: number, y: number, z: number): V3 => {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    return [at[0] + x * cs + z * sn, at[1] + y, at[2] - x * sn + z * cs];
  };
  for (const sx of [-0.28, 0.28]) k.add(new BoxGeometry(0.06, h + 0.02, d + 0.02), { at: local(sx * w, 0, 0), rot, colour: C.strap, flat: true });
  k.add(new BoxGeometry(w + 0.02, 0.03, d + 0.02), { at: local(0, h * 0.18, 0), rot, colour: C.strap, flat: true });
  if (!lod) return;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) k.add(new BoxGeometry(0.08, 0.08, 0.08), { at: local(sx * w * 0.5, sy * h * 0.5, sz * d * 0.5), rot, colour: C.brass, flat: true });
  k.add(new BoxGeometry(0.09, 0.1, 0.03), { at: local(0, h * 0.18, d * 0.5 + 0.02), rot, colour: C.brass, flat: true });
}

export function luggage(k: Kit, lod: Lod): void {
  trunkBox(k, 1.7, 0.62, 0.9, C.leather, [0, 0.31, 0], 0, lod);
  trunkBox(k, 1.2, 0.5, 0.7, C.trunkGreen, [-0.15, 0.87, 0.02], 0.15, lod);
  k.add(new CylinderGeometry(0.24, 0.24, 0.28, 12), { at: [0.12, 1.26, 0], colour: (p, _n, out) => blend(out, C.hatbox, C.canvas, p.y > 0.09 ? 1 : p.y < -0.09 ? 0.25 : 0), flat: true });
  if (!lod) return;
  k.limb([0.8, 0.05, 0.5], [0.92, 1.05, 0.34], 0.016, 0.014, C.strap, 4);
  k.add(new TorusGeometry(0.06, 0.012, 4, 8, Math.PI), { at: [0.86, 1.08, 0.34], rot: [0, 0, 0], colour: C.pole });
}

// ---- supply cart -----------------------------------------------------------------------------------------------------------------

function wheel(k: Kit, x: number, z: number, lod: Lod): void {
  const R = 0.52;
  const y = R;
  k.add(new TorusGeometry(R, 0.055, 4, lod ? 16 : 12), { at: [x, y, z], colour: C.cartRed, flat: true });
  k.add(new TorusGeometry(R + 0.045, 0.018, 3, lod ? 16 : 12), { at: [x, y, z], colour: C.iron, flat: true });
  k.add(new CylinderGeometry(0.1, 0.1, 0.13, 8), { at: [x, y, z], rot: [Math.PI / 2, 0, 0], colour: C.cartWood, flat: true });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    box(k, [0.05, R * 2 - 0.06, 0.04], [x, y, z], C.cartWood, [0, 0, a]);
  }
}

export function cart(k: Kit, lod: Lod): void {
  const bedY = 0.86;
  box(k, [2.6, 0.12, 1.3], [0, bedY, 0], C.cartWood);
  for (const sz of [-1, 1]) {
    box(k, [2.6, 0.3, 0.05], [0, bedY + 0.2, sz * 0.63], C.cartRed);
    for (const sx of [-1, 1]) wheel(k, sx * 0.85, sz * 0.75, lod);
  }
  k.limb([0.85, 0.52, -0.8], [0.85, 0.52, 0.8], 0.04, 0.04, C.iron, 5);
  k.limb([-0.85, 0.52, -0.8], [-0.85, 0.52, 0.8], 0.04, 0.04, C.iron, 5);
  // canvas hood on wooden bows
  const hood = new CylinderGeometry(1, 1, 2.5, 14, 1, true, 0, Math.PI);
  hood.rotateZ(Math.PI / 2);
  k.add(hood, { at: [0, bedY + 0.05, 0], scale: [1, 0.86, 0.65], colour: (p, n, out) => blend(out, C.cartCanvas, C.canvasShade, Math.abs(p.x) > 1.15 ? 0.6 : (Math.floor(p.x * 2.4) % 2 ? 0.25 : 0)), flat: true });
  for (let i = 0; i < 5; i++) {
    const bow = new TorusGeometry(1, 0.035, 4, 12, Math.PI);
    bow.rotateY(Math.PI / 2);
    k.add(bow, { at: [-1.2 + i * 0.6, bedY + 0.05, 0], scale: [1, 0.88, 0.67], colour: C.cartWood });
  }
  for (const sz of [-1, 1]) k.limb([1.25, bedY + 0.05, sz * 0.45], [2.55, 0.38, sz * 0.36], 0.045, 0.035, C.cartWood, 5);
  if (!lod) return;
  box(k, [0.3, 0.03, 0.9], [-1.32, bedY - 0.08, 0], C.iron);
}

// ---- ruined wall -----------------------------------------------------------------------------------------------------------------

/**
 * A dry-stone wall in ruin: ten courses of jittered blocks, the top two courses broken, one lower breach, tall end pillars and
 * a scatter of fallen stones. The collision box is the full-height footprint, so breaks are limited to the top ~0.5 m (a stump
 * you can see is a stump that blocks). Local frame: centre of the wall at the origin, ground at y = 0.
 */
export function ruinedWall(k: Kit, lod: Lod, hx: number, hz: number, height: number): void {
  const courses = 9;
  // irregular course heights that still add up to the collision height
  const raw = Array.from({ length: courses }, (_, r) => 0.78 + h01(30, r) * 0.44);
  const sum = raw.reduce((a, b) => a + b, 0);
  const ch = raw.map((v) => (v / sum) * height);
  const base: number[] = [];
  ch.reduce((y, v, i) => ((base[i] = y), y + v), 0);
  const stone = (x: number, y: number, z: number, sx: number, sy: number, sz: number, seed: number, moss: number): void => {
    const tone = h01(3, seed);
    const c: ColourFn = (p, n, out) => {
      if (tone < 0.5) blend(out, W.ruin, W.rock, tone * 1.1);
      else blend(out, W.rock, W.rockPale, (tone - 0.5) * 1.3);
      if (n.y > 0.6) out.lerp(cPale, 0.25);
      const low = 1 - smooth(0.1, 0.55, y);
      if (moss > 0 || low > 0) out.lerp(cMossC, Math.min(0.75, moss + low * 0.6));
    };
    k.add(new BoxGeometry(sx, sy, sz), { at: [x, y, z], rot: [(h01(13, seed) - 0.5) * 0.04, (h01(4, seed) - 0.5) * 0.08, (h01(14, seed) - 0.5) * 0.03], colour: c, flat: true, jitter: 0.03, seed });
  };
  let id = 0;
  for (let r = 0; r < courses; r++) {
    let x = -hx + (r % 2 ? 0.45 : 0) - h01(31, r) * 0.2;
    while (x < hx - 0.05) {
      id++;
      const w = Math.min(0.4 + h01(1, r, id) * 1.0, hx - x);
      const cx = x + w / 2;
      const pillar = Math.abs(cx) > hx - 0.6;
      const top = r >= courses - 2;
      // broken crown: some top stones gone, a two-course breach between x = -2.9 and -1.3
      const missing = top && !pillar && (h01(2, r, id) < (r === courses - 1 ? 0.45 : 0.12) || (r === courses - 2 && cx > -2.6 && cx < -1.6) || (r === courses - 1 && cx > -2.9 && cx < -1.3));
      x += w;
      if (missing || w < 0.12) continue;
      const depth = hz * 2 * (0.9 + h01(9, id) * 0.16) + (pillar ? 0.1 : 0);
      const dz = (h01(10, id) - 0.5) * 0.1;
      stone(cx, base[r]! + ch[r]! / 2, dz, w - 0.03, ch[r]! - 0.02 + (h01(11, id) - 0.5) * 0.04, depth, id, h01(12, id) < 0.22 ? 0.35 : 0);
    }
  }
  if (!lod) return;
  // fallen stones
  for (let i = 0; i < 22; i++) {
    const side = i % 3 ? 1 : -1;
    const x = (h01(20, i) - 0.5) * (hx * 2 - 1);
    const z = side * (hz + 0.3 + h01(21, i) * 1.1);
    const s = 0.16 + h01(22, i) * 0.34;
    k.add(new BoxGeometry(s * 1.4, s * 0.7, s), { at: [x, s * 0.3, z], rot: [(h01(23, i) - 0.5) * 0.5, h01(24, i) * 3, (h01(25, i) - 0.5) * 0.5], colour: (p, n, out) => blend(out, W.ruin, W.rock, h01(26, i) * 0.9).lerp(cMossC, h01(27, i) * 0.35), flat: true, jitter: 0.035, seed: 200 + i });
  }
}
const cMossC = new Color(W.moss);

// ---- assembly --------------------------------------------------------------------------------------------------------------------

/** Every solid landmark merged into one geometry, placed on the terrain. */
export function buildLandmarks(world: CollisionWorld, lod: Lod): BufferGeometry | undefined {
  const k = new Kit();
  const ground = (o: Obstacle): number => world.terrainHeight(o.x, o.z);
  for (const o of world.obstacles) {
    const tag = classifyObstacle(o);
    const y = ground(o);
    if (o.kind === "box") {
      switch (tag) {
        case "tent":
          k.setBase(o.x, y, o.z, o.yaw);
          tent(k, lod);
          break;
        case "luggage":
          k.setBase(o.x, y, o.z, o.yaw);
          luggage(k, lod);
          break;
        case "cart":
          k.setBase(o.x, y, o.z, o.yaw);
          cart(k, lod);
          break;
        case "crate": {
          const h = o.y1 - y;
          k.setBase(o.x, y + h / 2, o.z, o.yaw);
          crateParts(k, o.hx * 2, h, o.hz * 2, lod);
          break;
        }
        case "wall":
          k.setBase(o.x, y, o.z, o.yaw);
          ruinedWall(k, lod, o.hx, o.hz, o.y1 - y);
          break;
        case "table":
          k.setBase(o.x, y, o.z, o.yaw);
          mapTable(k, lod);
          break;
        default:
          break;
      }
    } else {
      switch (tag) {
        case "fire":
          k.setBase(o.x, y, o.z);
          fireRing(k, lod);
          break;
        case "flag":
          k.setBase(o.x, y, o.z);
          flagPole(k, lod);
          break;
        case "sign":
          k.setBase(o.x, y, o.z);
          signpost(k, lod);
          break;
        case "table":
          k.setBase(o.x, y, o.z);
          gramophone(k, lod);
          break;
        case "scope":
          k.setBase(o.x, y, o.z, CAMP.scope.yaw);
          telescope(k, lod);
          break;
        case "pole":
          k.setBase(o.x, y, o.z);
          post(k, o.r, o.y1 - y);
          break;
        default:
          break;
      }
    }
  }
  k.clearBase();
  washLine(k, world, lod);
  hammock(k, world, lod);
  lanternFrames(k, world, lod);
  hqSolid(k, world, lod);
  k.clearBase();
  return k.build();
}

// ---- banners: pennant + sign lettering (textured, one draw) --------------------------------------------------------------------

/** Flag geometry constants: pennant hangs below the finial and streams toward +x. */
export const PENNANT = { length: 3.1, hoist: 1.4, columns: 12 } as const;

/**
 * Position/normal/uv/wave geometry for every pennant and the lettering decals on every signboard (both faces). `wave` is 0 for
 * signs and the distance from the hoist (0..1) for the pennant; the material's vertex shader turns it into a ripple.
 */
export function buildBanners(world: CollisionWorld): BufferGeometry | undefined {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const wave: number[] = [];
  const tri = (a: number[], b: number[], c: number[], n: V3, ua: number[], ub: number[], uc: number[], wa: number, wb: number, wc: number): void => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) nor.push(...n);
    uv.push(...ua, ...ub, ...uc);
    wave.push(wa, wb, wc);
  };
  const [fu0, fv0, fu1, fv1] = FLAG_UV;
  for (const o of tagged(world, "flag")) {
    const g = world.terrainHeight(o.x, o.z);
    const topY = g + CAMP.flag.height - 0.3;
    const cols = PENNANT.columns;
    const vert = (i: number, j: number): { p: number[]; uv: number[]; w: number } => {
      const t = i / cols;
      const half = (PENNANT.hoist / 2) * (1 - 0.5 * t);
      let x = PENNANT.length * t;
      if (i === cols && j === 1) x = PENNANT.length * 0.8; // swallow-tail notch
      return { p: [o.x + 0.09 + x, topY - PENNANT.hoist / 2 + (j - 1) * half, o.z + 0.02], uv: [fu0 + (fu1 - fu0) * t, fv0 + (fv1 - fv0) * (j / 2)], w: t };
    };
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < 2; j++) {
        const a = vert(i, j);
        const b = vert(i + 1, j);
        const c = vert(i + 1, j + 1);
        const d = vert(i, j + 1);
        tri(a.p, b.p, c.p, [0, 0, 1], a.uv, b.uv, c.uv, a.w, b.w, c.w);
        tri(a.p, c.p, d.p, [0, 0, 1], a.uv, c.uv, d.uv, a.w, c.w, d.w);
      }
    }
  }
  for (const o of tagged(world, "sign")) {
    const g = world.terrainHeight(o.x, o.z);
    const m = new Matrix4();
    const v = new Vector3();
    SIGN_BOARDS.forEach((b, i) => {
      const [u0, v0, u1, v1] = boardUv(i);
      const textLen = b.len - 0.36;
      for (const side of [1, -1]) {
        // decal quad in board space: x along the board, y up, z = the face; the back face is mirrored so lettering reads correctly
        const zf = side > 0 ? BOARD_DEPTH / 2 + 0.006 : -BOARD_DEPTH / 2 - 0.006;
        const x0 = -0.04;
        const x1 = x0 + textLen / 0.8; // the lettering fills the first 80% of the strip
        const q: [number, number][] = [
          [x0, -0.13],
          [x1, -0.13],
          [x1, 0.13],
          [x0, 0.13],
        ];
        const uvs: [number, number][] = side > 0 ? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] : [[u1, v0], [u0, v0], [u0, v1], [u1, v1]];
        m.makeRotationY(b.yaw).setPosition(o.x, g + b.y, o.z);
        const p = q.map(([x, y]) => v.set(x, y, zf).applyMatrix4(m).toArray());
        const n: V3 = side > 0 ? [Math.sin(b.yaw), 0, Math.cos(b.yaw)] : [-Math.sin(b.yaw), 0, -Math.cos(b.yaw)];
        if (side > 0) {
          tri(p[0]!, p[1]!, p[2]!, n, uvs[0]!, uvs[1]!, uvs[2]!, 0, 0, 0);
          tri(p[0]!, p[2]!, p[3]!, n, uvs[0]!, uvs[2]!, uvs[3]!, 0, 0, 0);
        } else {
          tri(p[0]!, p[2]!, p[1]!, n, uvs[0]!, uvs[2]!, uvs[1]!, 0, 0, 0);
          tri(p[0]!, p[3]!, p[2]!, n, uvs[0]!, uvs[3]!, uvs[2]!, 0, 0, 0);
        }
      }
    });
  }
  // the survey pinned flat on the map table
  for (const o of world.obstacles) {
    if (o.kind !== "box" || o.tag !== "table") continue;
    const g = world.terrainHeight(o.x, o.z);
    const [u0, v0, u1, v1] = MAP_UV;
    const c = Math.cos(o.yaw);
    const sn = Math.sin(o.yaw);
    const hw = o.hx * 0.72;
    const hd = o.hz * 0.78;
    const y = g + CAMP.mapTable.height + 0.016;
    const P = (lx: number, lz: number): number[] => [o.x + lx * c - lz * sn, y, o.z + lx * sn + lz * c];
    // local +x runs along the table; the map's top edge is at local -z, so a player facing the table from +z reads it upright
    const q = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
    const uvs: [number, number][] = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    tri(q[0]!, q[2]!, q[1]!, [0, 1, 0], uvs[0]!, uvs[2]!, uvs[1]!, 0, 0, 0);
    tri(q[0]!, q[3]!, q[2]!, [0, 1, 0], uvs[0]!, uvs[3]!, uvs[2]!, 0, 0, 0);
  }
  // the village's boards and dial, the HQ's heraldry and notice board: flat decals
  const quad = (c: readonly [V3, V3, V3, V3], n: V3, rect: readonly [number, number, number, number], w: readonly [number, number, number, number] = [0, 0, 0, 0]): void => {
    const [u0, v0, u1, v1] = rect;
    const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    tri([...c[0]], [...c[1]], [...c[2]], n, uv[0]!, uv[1]!, uv[2]!, w[0], w[1], w[2]);
    tri([...c[0]], [...c[2]], [...c[3]], n, uv[0]!, uv[2]!, uv[3]!, w[0], w[2], w[3]);
  };
  villageBanners(world, quad);
  hqBanners(world, quad);
  if (pos.length === 0) return undefined;
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute("wave", new BufferAttribute(new Float32Array(wave), 1));
  g.computeBoundingSphere();
  return g;
}

