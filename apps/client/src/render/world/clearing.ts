import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Shape, TorusGeometry } from "three";
import { PALETTE, PEN, WAYPOST, WELL, bridgeDeck, getBridge, getWayposts, hash3, penFences, type CollisionWorld } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import type { Lod } from "./flora.ts";

/**
 * The furniture round the spawn clearing, drawn from the SAME numbers that make its collision (`shared/clearing.ts`): a stone well with a
 * crank and a bucket, the sheep pen's post-and-rail fence (with its gate hung open), signposts where the paths part, and the footbridge over
 * the stream. One merged geometry (one draw, one ink hull).
 */

const W = PALETTE.world;
const C = PALETTE.camp;
const f01 = (seed: number, a: number, b = 0): number => hash3(seed, a, b, 0) / 4294967296;

const timber = (seed: number, base: number = W.fence, dark: number = W.plankDark): ColourFn => (p, _n, out) => {
  const t = f01(seed, Math.floor(p.y * 5), Math.floor((p.x + p.z) * 4));
  blend(out, base, dark, 0.15 + 0.45 * t);
  if (p.y < 0.12 && p.y > -1) out.lerp(mossC, 0.2);
};
const mossC = new Color(W.moss);

// ---- the well ---------------------------------------------------------------------------------------------------------------------------

function well(k: Kit, lod: Lod): void {
  const stones = lod ? 14 : 9;
  const rMid = (WELL.r + 0.62) / 2;
  const step = (Math.PI * 2) / stones;
  for (let course = 0; course < 2; course++) {
    for (let i = 0; i < stones; i++) {
      const a = (i + (course % 2 ? 0.5 : 0)) * step;
      const len = 2 * rMid * Math.tan(step / 2) + 0.05;
      const inner = a;
      k.add(new BoxGeometry(len, 0.46, WELL.r - 0.62), {
        at: [Math.cos(a) * rMid, 0.2 + course * 0.46, Math.sin(a) * rMid],
        rot: [0, Math.PI / 2 - a, 0],
        colour: (p, n, out) => {
          const t = f01(410, course, i);
          blend(out, W.wellStone, W.ruinShadow, 0.1 + t * 0.4);
          if (n.y > 0.6) out.lerp(paleC, 0.3);
          if (course === 0) out.lerp(mossC, 0.35);
          if (n.x * Math.cos(inner) + n.z * Math.sin(inner) < -0.5) out.multiplyScalar(0.55);
        },
        perFace: true,
        jitter: 0.02,
        seed: 420 + course * 20 + i,
      });
    }
  }
  // dark water down the shaft
  k.add(new CylinderGeometry(0.66, 0.66, 0.04, 12), { at: [0, 0.06, 0], colour: W.wellWater, flat: true });
  // two posts, a crossbeam under a little gabled roof, a crank and a bucket on a rope
  for (const s of [-1, 1]) k.limb([0.05 * s, -0.2, s * (WELL.r - 0.08)], [0.05 * s, 2.0, s * (WELL.r - 0.08)], 0.075, 0.065, timber(430 + s), 6);
  const beamY = 1.85;
  k.limb([0, beamY, -WELL.r + 0.08], [0, beamY, WELL.r - 0.08], 0.07, 0.07, timber(431), 6);
  // a little gabled roof of two boards, sloping down to the posts, on a ridge pole
  k.limb([-0.85, 2.13, 0], [0.85, 2.13, 0], 0.035, 0.035, timber(432), 5);
  for (const s of [-1, 1]) k.add(new BoxGeometry(1.7, 0.05, 1.12), { at: [0, 2.0, s * 0.5], rot: [s * 0.62, 0, 0], colour: (p, _n, out) => blend(out, W.plank, W.plankDark, 0.3 + 0.5 * f01(433, Math.floor(p.x * 8), s)), flat: true });
  if (!lod) return;
  // crank: a handle on a short axle at one end of the beam
  k.limb([0, beamY, WELL.r - 0.05], [0, beamY, WELL.r + 0.18], 0.03, 0.03, C.iron, 5);
  k.limb([0, beamY, WELL.r + 0.16], [0, beamY - 0.3, WELL.r + 0.2], 0.018, 0.018, C.iron, 4);
  k.limb([0, beamY - 0.3, WELL.r + 0.2], [0.22, beamY - 0.3, WELL.r + 0.2], 0.02, 0.02, W.plank, 4);
  // rope and bucket
  k.limb([0, beamY - 0.02, 0.05], [0, 1.15, 0.05], 0.012, 0.012, C.rope, 3);
  k.add(new CylinderGeometry(0.16, 0.13, 0.26, 8, 1, true), { at: [0, 0.98, 0.05], colour: timber(434, W.plank, W.plankDark), flat: true });
  k.add(new TorusGeometry(0.15, 0.012, 3, 10), { at: [0, 1.06, 0.05], rot: [Math.PI / 2, 0, 0], colour: C.iron, flat: true });
  k.add(new TorusGeometry(0.135, 0.012, 3, 10), { at: [0, 0.9, 0.05], rot: [Math.PI / 2, 0, 0], colour: C.iron, flat: true });
}
const paleC = new Color(W.rockPale);

// ---- the pen -----------------------------------------------------------------------------------------------------------------------------

function fence(k: Kit, lod: Lod, gy: number): void {
  const rails = penFences();
  const postAt = new Set<string>();
  const post = (x: number, z: number, seed: number): void => {
    const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    if (postAt.has(key)) return;
    postAt.add(key);
    const h = PEN.height + 0.08 + f01(440, seed) * 0.1;
    k.limb([x, gy - 0.4, z], [x, gy + h, z], 0.075, 0.062, timber(441 + seed), lod ? 6 : 5);
    k.add(new ConeGeometry(0.09, 0.09, lod ? 6 : 4), { at: [x, gy + h + 0.04, z], colour: timber(442 + seed), flat: true });
  };
  rails.forEach((f, i) => {
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    post(f.x - c * f.hx, f.z - s * f.hx, i * 2);
    post(f.x + c * f.hx, f.z + s * f.hx, i * 2 + 1);
    k.setBase(f.x, gy, f.z, f.yaw);
    for (const [y, tilt] of [[0.38, 0.012], [0.74, -0.01]] as const) k.add(new BoxGeometry(f.hx * 2 + 0.06, 0.07, 0.045), { at: [0, y, 0], rot: [0, 0, tilt * (f01(443, i) - 0.5) * 10], colour: timber(444 + i), flat: true, jitter: 0.006, seed: 445 + i });
    if (lod && f01(446, i) > 0.4) k.limb([-f.hx + 0.1, 0.42, 0.03], [f.hx - 0.1, 0.72, 0.03], 0.02, 0.02, timber(447 + i), 4); // a diagonal brace
    k.clearBase();
  });
  // the gate: a leaf on the east side's gap, hung open on its north hinge
  const gx = PEN.x + PEN.hx;
  const hinge: V3 = [gx, gy, PEN.z - PEN.gate];
  post(hinge[0], hinge[2], 90);
  post(gx, PEN.z + PEN.gate, 91);
  k.setBase(hinge[0], gy, hinge[2], Math.PI / 2 - 1.15);
  const len = PEN.gate * 2 - 0.12;
  for (const y of [0.32, 0.6, 0.9]) k.add(new BoxGeometry(len, 0.07, 0.04), { at: [len / 2, y, 0], colour: timber(448), flat: true });
  k.add(new BoxGeometry(0.06, 0.95, 0.04), { at: [0.03, 0.6, 0], colour: timber(449), flat: true });
  k.add(new BoxGeometry(0.06, 0.95, 0.04), { at: [len - 0.03, 0.6, 0], colour: timber(450), flat: true });
  k.limb([0.05, 0.3, 0.02], [len - 0.05, 0.92, 0.02], 0.02, 0.02, timber(451), 4);
  k.clearBase();
}

// ---- signposts -----------------------------------------------------------------------------------------------------------------------------

/** An arrow-shaped board pointing along +x, `len` long and `h` deep, with a painted tip. */
function arrowBoard(len: number, h: number, point: boolean): BufferGeometry {
  const s = new Shape();
  const tip = h * 0.55;
  s.moveTo(-len / 2, -h / 2);
  if (point) {
    s.lineTo(len / 2 - tip, -h / 2);
    s.lineTo(len / 2, 0);
    s.lineTo(len / 2 - tip, h / 2);
  } else {
    s.lineTo(len / 2, -h / 2);
    s.lineTo(len / 2, h / 2);
  }
  s.lineTo(-len / 2, h / 2);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: false });
  g.translate(0, 0, -0.0225);
  return g;
}

function wayposts(k: Kit, world: CollisionWorld, lod: Lod): void {
  getWayposts().forEach((w, i) => {
    const y = world.terrainHeight(w.x, w.z);
    k.setBase(w.x, y, w.z, 0);
    k.limb([0, -0.3, 0], [0, WAYPOST.height, 0], WAYPOST.r * 1.1, WAYPOST.r * 0.9, timber(460 + i, W.fence, W.plankDark), 6);
    k.add(new ConeGeometry(0.12, 0.12, 6), { at: [0, WAYPOST.height + 0.05, 0], colour: timber(461 + i), flat: true });
    // boards: one arrow along the way on, a shorter one pointing back the way you came, and a blank spur
    const boards: [number, number, number, number][] = [
      [0, 2.05, 1.15, 0.25],
      [Math.PI, 1.66, 0.95, 0.23],
    ];
    if (lod && i % 2 === 0) boards.push([w.yaw > 0 ? 1.2 : -1.2, 1.28, 0.8, 0.2]);
    boards.forEach(([rel, by, len, bh], bi) => {
      k.setBase(w.x, y, w.z, w.yaw + rel);
      const paint: ColourFn = (p, _n, out) => {
        blend(out, C.signWood, W.plankDark, 0.15 + 0.25 * f01(462, i, bi));
        if (p.x > len / 2 - bh * 0.55 - 0.02) out.lerp(paintC, 0.85); // the painted tip
      };
      k.add(arrowBoard(len, bh, true), { at: [WAYPOST.r + len / 2 - 0.05, by, 0.0], rot: [0, 0, (f01(463, i, bi) - 0.5) * 0.05], colour: paint, flat: true, jitter: 0.004, seed: 464 + i * 3 + bi });
      k.add(new BoxGeometry(0.05, 0.06, 0.12), { at: [WAYPOST.r * 1.1, by, 0], colour: C.iron, flat: true });
    });
    k.clearBase();
  });
}
const paintC = new Color(PALETTE.camp.signPaint);

// ---- the footbridge ---------------------------------------------------------------------------------------------------------------------------

function bridge(k: Kit, world: CollisionWorld, lod: Lod): void {
  const b = getBridge();
  const deck = bridgeDeck(world.terrain);
  b.segments.forEach((s, i) => {
    const cx = (s.x0 + s.x1) / 2;
    const cz = (s.z0 + s.z1) / 2;
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const yaw = Math.atan2(s.z1 - s.z0, s.x1 - s.x0);
    k.setBase(cx, 0, cz, yaw);
    // planks across the walk, a finger apart
    const n = Math.max(3, Math.round(len / 0.34));
    const pl = len / n;
    for (let p = 0; p < n; p++) {
      const x = -len / 2 + pl * (p + 0.5);
      k.add(new BoxGeometry(pl - 0.035, 0.08, b.halfWidth * 2 + 0.1), {
        at: [x, deck - 0.05, 0],
        rot: [0, (f01(470, i, p) - 0.5) * 0.02, (f01(471, i, p) - 0.5) * 0.02],
        colour: (q, nn, out) => {
          blend(out, W.plank, W.plankDark, 0.1 + 0.5 * f01(472, i, p));
          if (nn.y < 0.3) out.lerp(darkC, 0.4);
          void q;
        },
        flat: true,
        jitter: 0.004,
        seed: 473 + i * 20 + p,
      });
    }
    // two stringers under the deck
    for (const sd of [-1, 1]) k.add(new BoxGeometry(len + 0.1, 0.16, 0.14), { at: [0, deck - 0.2, sd * (b.halfWidth - 0.1)], colour: timber(480 + i, W.plankDark, W.rockDark), flat: true });
    // handrail posts and rails
    if (i > 0 && i < b.segments.length - 1) {
      for (const sd of [-1, 1]) {
        k.limb([len / 2, deck - 0.3, sd * (b.halfWidth + 0.02)], [len / 2, deck + b.rail + 0.06, sd * (b.halfWidth + 0.02)], 0.05, 0.045, timber(490 + i, W.fence), 5);
        k.add(new BoxGeometry(len + 0.1, 0.06, 0.07), { at: [0, deck + b.rail, sd * (b.halfWidth + 0.02)], colour: timber(492 + i, W.fence), flat: true });
        k.add(new BoxGeometry(len, 0.04, 0.04), { at: [0, deck + b.rail * 0.5, sd * (b.halfWidth + 0.02)], colour: C.rope, flat: true });
      }
    }
    k.clearBase();
  });
}
const darkC = new Color(W.rockDark);

/** Everything in the clearing's furniture as one merged geometry (world coordinates). */
export function buildClearing(world: CollisionWorld, lod: Lod): BufferGeometry | undefined {
  if (world.obstacles.length === 0) return undefined;
  const k = new Kit();
  k.setBase(WELL.x, world.terrainHeight(WELL.x, WELL.z), WELL.z, 0.5);
  well(k, lod);
  k.clearBase();
  // Sections are short and the pen sits on gentle ground, so the rails run level at the height of the pen's middle; the posts are buried
  // 0.4 m, enough to meet the ground wherever it dips.
  fence(k, lod, world.terrainHeight(PEN.x, PEN.z));
  wayposts(k, world, lod);
  bridge(k, world, lod);
  return k.build();
}
