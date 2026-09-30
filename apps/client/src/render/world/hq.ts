import { BoxGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Shape, SphereGeometry, TorusGeometry, type BufferGeometry } from "three";
import { CAMP, PALETTE, hash3, hqPlan, type CollisionWorld } from "@cb/shared";
import { ARMS_SOCIETY_UV, NOTICE_UV, stencilUv, swatchUv } from "./atlas.ts";
import { facing, type PushQuad } from "./banners.ts";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import { crateSlim } from "./objects.ts";
import type { Lod } from "./flora.ts";

/**
 * The Expedition's HQ, drawn from `CAMP.hq` / `hqPlan()` (the numbers that also make its collision): a striped pavilion pitched in the lee of the ruined wall,
 * open at the front and along its south side, over the survey table; inside, camp chairs and a strongbox, a lamp on the ridge; outside its mouth the two
 * flagpoles flying the Society's arms with bunting between, the notice board, and the supply pyramid of stencilled crates. Solid pieces merge into the camp's
 * geometry; canvas, valances and the lamp merge into the camp's swaying cloth geometry; heraldry, notices and stencils are decals in the banners mesh.
 */

const C = PALETTE.camp;
const W = PALETTE.world;
const M = PALETTE.material;
const f01 = (seed: number, a: number, b = 0): number => hash3(seed, a, b, 0) / 4294967296;

const bx = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3, sway = 0): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true, sway });
};

const RED = C.canvasTrim;
const CREAM = C.canvas;
/** Marquee canvas: stripes of Society red and cream, a little stained and sun-faded. */
const stripes = (across: "x" | "z", seed: number, width = 0.36): ColourFn => (p, n, out) => {
  const v = across === "x" ? p.x : p.z;
  const idx = Math.floor((v + 40) / width);
  out.set(idx & 1 ? CREAM : RED);
  blend(out, (idx & 1 ? CREAM : RED) as number, C.canvasShade, 0.08 + 0.18 * f01(seed, idx, Math.floor((p.y + 40) * 1.5)));
  if (n.y < -0.5) out.multiplyScalar(0.72);
};

// ---- the solid parts (the camp's geometry) --------------------------------------------------------------------------------------------------------

function chair(k: Kit, seed: number): void {
  // a folding camp chair: crossed legs, a canvas seat slung between, a canvas back
  for (const sz of [-1, 1]) {
    k.limb([-0.22, 0.0, sz * 0.22], [0.22, 0.46, sz * 0.22], 0.016, 0.016, C.pole, 4);
    k.limb([0.22, 0.0, sz * 0.22], [-0.22, 0.46, sz * 0.22], 0.016, 0.016, C.pole, 4);
  }
  bx(k, [0.42, 0.025, 0.5], [0, 0.46, 0], (_p, _n, out) => blend(out, C.canvasTrim, C.canvas, f01(seed, 1) * 0.3));
  for (const sz of [-1, 1]) k.limb([-0.2, 0.46, sz * 0.25], [-0.26, 0.98, sz * 0.25], 0.014, 0.014, C.pole, 4);
  bx(k, [0.03, 0.34, 0.5], [-0.24, 0.78, 0], C.canvasTrim);
}

function strongbox(k: Kit, lod: Lod): void {
  const w = 1.1;
  const d = 0.64;
  bx(k, [w, 0.42, d], [0, 0.21, 0], C.leather);
  k.add(new CylinderGeometry(d / 2, d / 2, w, lod ? 10 : 6, 1, false, 0, Math.PI), { at: [0, 0.42, 0], rot: [0, 0, Math.PI / 2], colour: C.leather, flat: true });
  for (const x of [-0.38, 0.38]) {
    bx(k, [0.07, 0.44, d + 0.02], [x, 0.22, 0], C.iron);
    k.add(new CylinderGeometry(d / 2 + 0.012, d / 2 + 0.012, 0.07, lod ? 10 : 6, 1, false, 0, Math.PI), { at: [x, 0.42, 0], rot: [0, 0, Math.PI / 2], colour: C.iron, flat: true });
  }
  bx(k, [0.1, 0.13, 0.03], [0, 0.4, d / 2 + 0.02], C.brass);
}

/** Solid parts of the HQ, world coordinates (call after the camp's base is cleared). */
export function hqSolid(k: Kit, world: CollisionWorld, lod: Lod): void {
  const p = hqPlan();
  const m = p.marquee;
  const g = world.terrainHeight(m.x, m.z);
  k.clearBase();
  // the pavilion's frame: ridge poles, ridge beam, corner posts at the back
  k.setBase(m.x, g, m.z, m.yaw);
  for (const lx of [-1.9, 1.9]) {
    k.limb([lx, -0.1, 0], [lx, m.ridge, 0], 0.07, 0.055, C.pole, 6);
    k.add(new SphereGeometry(0.09, 6, 4), { at: [lx, m.ridge + 0.08, 0], colour: C.brass, flat: true });
  }
  k.limb([-m.hx + 0.2, m.ridge - 0.02, 0], [m.hx + 0.3, m.ridge - 0.02, 0], 0.045, 0.045, C.pole, 5);
  for (const sz of [-1, 1]) {
    k.limb([m.hx + 0.3, -0.1, sz * (m.hz + 0.25)], [m.hx + 0.3, m.wall + 0.08, sz * (m.hz + 0.25)], 0.055, 0.045, C.pole, 5);
    k.limb([-m.hx - 0.3, -0.1, sz * (m.hz + 0.25)], [-m.hx - 0.3, m.wall + 0.08, sz * (m.hz + 0.25)], 0.055, 0.045, C.pole, 5);
    k.limb([m.hx + 0.3, m.wall + 0.05, sz * (m.hz + 0.25)], [m.hx + 0.3, m.wall + 0.05, -sz * (m.hz + 0.25)], 0.035, 0.035, C.pole, 4);
    k.limb([-m.hx - 0.3, m.wall + 0.05, sz * (m.hz + 0.25)], [-m.hx - 0.3, m.wall + 0.05, -sz * (m.hz + 0.25)], 0.035, 0.035, C.pole, 4);
  }
  k.limb([m.hx + 0.3, m.wall + 0.05, -m.hz - 0.25], [m.hx + 0.3, m.wall + 0.05, m.hz + 0.25], 0.035, 0.035, C.pole, 4);
  // a rug: red border round a cream field, under the table
  bx(k, [m.hx * 2 - 0.9, 0.02, m.hz * 2 - 0.5], [0, 0.012, 0], C.canvasTrim);
  bx(k, [m.hx * 2 - 1.3, 0.024, m.hz * 2 - 0.9], [0, 0.016, 0], (q, _n, out) => blend(out, C.canvas, C.canvasShade, 0.2 + 0.4 * f01(3, Math.floor(q.x * 3), Math.floor(q.z * 3))));
  // guy ropes and pegs
  if (lod) for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
    const ex = sx * (m.hx * 0.75) + (sx === 0 ? 0 : sx * 0.7);
    const ez = sz * (m.hz + 1.7);
    k.limb([sx * m.hx * 0.8, m.wall - 0.1, sz * (m.hz + 0.3)], [ex, 0.05, ez], 0.008, 0.008, C.rope, 3);
    k.add(new ConeGeometry(0.03, 0.18, 4), { at: [ex, 0.02, ez], rot: [0, 0, Math.PI], colour: C.pole, flat: true });
  }
  k.clearBase();
  // camp chairs, strongbox
  if (lod) p.chairs.forEach((c, i) => {
    k.setBase(c.x, world.terrainHeight(c.x, c.z), c.z, c.yaw);
    chair(k, i);
  });
  k.setBase(p.chest.x, world.terrainHeight(p.chest.x, p.chest.z), p.chest.z, p.chest.yaw);
  strongbox(k, lod);
  k.clearBase();
  // stencilled crates about the marquee
  for (const c of p.crates) {
    k.setBase(c.x, world.terrainHeight(c.x, c.z) + c.height / 2, c.z, c.yaw);
    if (lod) crateSlim(k, c.half * 2, c.height, c.half * 2, 0.95);
    else bx(k, [c.half * 2, c.height, c.half * 2], [0, 0, 0], PALETTE.props.crate);
  }
  k.clearBase();
  // the supply pyramid: three tiers, crates side by side
  const rows = [3, 2, 1];
  p.pyramid.tiers.forEach((t, ti) => {
    const gy = world.terrainHeight(t.x, t.z);
    for (let i = 0; i < rows[ti]!; i++) {
      const lz = (i - (rows[ti]! - 1) / 2) * 0.7;
      const wx = t.x - Math.sin(t.yaw) * lz;
      const wz = t.z + Math.cos(t.yaw) * lz;
      k.setBase(wx, gy + t.y0 + 0.33, wz, t.yaw + (f01(11, ti, i) - 0.5) * 0.05);
      if (lod) crateSlim(k, 0.8, 0.66, 0.7, 0.9 + 0.16 * f01(12, i, ti));
      else bx(k, [0.8, 0.66, 0.7], [0, 0, 0], PALETTE.props.crate);
    }
  });
  k.clearBase();
  for (const b of p.pyramid.barrels) {
    const gy = world.terrainHeight(b.x, b.z);
    k.add(new CylinderGeometry(0.29, 0.29, 0.9, lod ? 10 : 7, 3), { at: [b.x, gy + 0.45, b.z], colour: (q, _n, out) => blend(out, PALETTE.props.barrel, PALETTE.props.barrelDark, (Math.floor(Math.atan2(q.z, q.x) * 6) & 1) * 0.3 + 0.1), flat: true });
    for (const h of [-0.3, 0.3]) k.add(new TorusGeometry(0.3, 0.018, 3, lod ? 12 : 7), { at: [b.x, gy + 0.45 + h, b.z], rot: [Math.PI / 2, 0, 0], colour: C.iron, flat: true });
  }
  // the notice board: two posts, a framed cork board, a little pent roof
  const n = p.notice;
  const ng = world.terrainHeight(n.x, n.z);
  k.setBase(n.x, ng, n.z, n.yaw);
  const timber: ColourFn = (q, _n, out) => blend(out, C.signWood, W.plankDark, 0.15 + 0.3 * f01(21, Math.floor(q.y * 6)));
  for (const sz of [-1, 1]) k.limb([0, -0.3, sz * (n.hx - 0.1)], [0, n.height, sz * (n.hx - 0.1)], 0.055, 0.05, timber, 6);
  bx(k, [0.1, n.h + 0.14, n.w + 0.14], [0.02, n.y, 0], timber);
  bx(k, [0.06, n.h, n.w], [0.055, n.y, 0], (_q, _n, out) => out.set(W.vlThatch));
  bx(k, [0.42, 0.06, n.w + 0.5], [0.12, n.y + n.h / 2 + 0.18, 0], timber, [0, 0, 0.35]);
  k.clearBase();
  // the flagpoles: tall tapering poles with a brass finial, a cross-arm and a halyard
  for (const q of p.poles) {
    const gy = world.terrainHeight(q.x, q.z);
    k.limb([q.x, gy - 0.4, q.z], [q.x, gy + q.height, q.z], 0.09, 0.05, C.pole, 6);
    k.add(new SphereGeometry(0.1, 6, 4), { at: [q.x, gy + q.height + 0.08, q.z], colour: C.brass, flat: true });
    k.setBase(q.x, gy, q.z, m.yaw);
    k.limb([0, q.height - 0.35, -0.4], [0, q.height - 0.35, 0.4], 0.025, 0.025, C.pole, 4);
    k.limb([0.08, 0.6, 0.0], [0.08, q.height - 1.5, 0.0], 0.008, 0.008, C.rope, 3);
    k.clearBase();
  }
}

// ---- the swaying parts (the camp's cloth geometry) ---------------------------------------------------------------------------------------------------

/** Canvas, valances, the rolled flap, drapes and the hanging lamp: everything that breathes in the wind. */
export function hqCloth(cloth: Kit, world: CollisionWorld, lod: Lod): void {
  const p = hqPlan();
  const m = p.marquee;
  const g = world.terrainHeight(m.x, m.z);
  cloth.clearBase();
  cloth.setBase(m.x, g, m.z, m.yaw);
  const rise = m.ridge - m.wall;
  const ov = 0.35;
  const slope = Math.atan2(rise + 0.1, m.hz + ov);
  const L = Math.hypot(rise + 0.1, m.hz + ov);
  // the roof: two striped planes from the ridge to the eaves, stripes running down the slope
  for (const s of [-1, 1]) {
    cloth.add(new BoxGeometry(m.hx * 2 + 0.9, 0.05, L, Math.round((m.hx * 2 + 0.9) / 0.36), 1, 1), {
      at: [0.15, m.wall + (rise + 0.1) / 2 - 0.05, (s * (m.hz + ov)) / 2],
      rot: [s * slope, 0, 0],
      colour: stripes("x", 5 + s),
      perFace: true,
      sway: (v) => 0.06 + 0.1 * Math.abs(v.z / L + 0.5),
    });
  }
  // valances: scallops hanging from the eaves and across the mouth
  const scallop = (x: number, y: number, z: number, along: "x" | "z", i: number): void => {
    const g2 = new ConeGeometry(0.19, 0.3, 3);
    cloth.add(g2, { at: [x, y, z], rot: [0, along === "x" ? 0 : Math.PI / 2, Math.PI], colour: i & 1 ? CREAM : RED, flat: true, sway: 0.5 });
  };
  const nx = lod ? Math.round((m.hx * 2 + 0.9) / 0.38) : 6;
  for (let i = 0; i < nx; i++) {
    const x = -m.hx - 0.3 + ((m.hx * 2 + 0.9) * (i + 0.5)) / nx;
    scallop(x + 0.15, m.wall - 0.1, m.hz + ov - 0.02, "x", i);
    scallop(x + 0.15, m.wall - 0.1, -m.hz - ov + 0.02, "x", i);
  }
  const nz = lod ? Math.round((m.hz * 2 + 0.7) / 0.38) : 5;
  for (let i = 0; i < nz; i++) {
    const z = -m.hz - ov + ((m.hz * 2 + ov * 2) * (i + 0.5)) / nz;
    scallop(m.hx + 0.3, m.wall + 0.0, z, "z", i);
  }
  // a long front valance board across the mouth, in red with a cream stripe
  cloth.add(new BoxGeometry(0.05, 0.34, m.hz * 2 + 0.5), { at: [m.hx + 0.3, m.wall + 0.32, 0], colour: RED, flat: true, sway: 0.08 });
  cloth.add(new BoxGeometry(0.06, 0.06, m.hz * 2 + 0.5), { at: [m.hx + 0.3, m.wall + 0.32, 0], colour: CREAM, flat: true, sway: 0.08 });
  // the closed sides: the back wall with its gable, the north wall
  cloth.add(new BoxGeometry(0.06, m.wall + 0.05, m.hz * 2 + 0.1, 1, 1, Math.round((m.hz * 2) / 0.42)), { at: [-m.hx + 0.05, (m.wall + 0.05) / 2, 0], colour: stripes("z", 8, 0.42), perFace: true, sway: (v) => 0.02 + 0.1 * (v.y / m.wall + 0.5) });
  const tri = new Shape();
  tri.moveTo(-m.hz - 0.05, 0);
  tri.lineTo(m.hz + 0.05, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  const gab = new ExtrudeGeometry(tri, { depth: 0.05, bevelEnabled: false });
  cloth.add(gab, { at: [-m.hx + 0.075, m.wall, 0], rot: [0, -Math.PI / 2, 0], colour: CREAM, flat: true, sway: 0.05 });
  cloth.add(new BoxGeometry(m.hx * 2 + 0.1, m.wall + 0.05, 0.06, Math.round((m.hx * 2) / 0.42), 1, 1), { at: [0, (m.wall + 0.05) / 2, -m.hz + 0.05], colour: stripes("x", 10, 0.42), perFace: true, sway: (v) => 0.02 + 0.1 * (v.y / m.wall + 0.5) });
  // the south flap rolled up along the eave and tied with rope; drapes tied back at the mouth
  cloth.add(new CylinderGeometry(0.13, 0.13, m.hx * 2 + 0.2, 8), { at: [0, m.wall - 0.02, m.hz - 0.02], rot: [0, 0, Math.PI / 2], colour: (q, _n, out) => blend(out, CREAM, RED, (Math.floor(q.y * 12) & 1) * 0.45), flat: true, sway: 0.05 });
  for (const x of [-m.hx * 0.7, 0, m.hx * 0.7]) cloth.add(new TorusGeometry(0.135, 0.012, 3, 8), { at: [x, m.wall - 0.02, m.hz - 0.02], rot: [0, Math.PI / 2, 0], colour: C.rope, flat: true, sway: 0.05 });
  for (const s of [-1, 1]) {
    cloth.add(new ConeGeometry(0.22, 1.6, 5), { at: [m.hx + 0.22, m.wall - 0.75, s * (m.hz - 0.15)], rot: [0, 0, 0.12], colour: s > 0 ? CREAM : RED, flat: true, sway: (v) => 0.1 + 0.3 * (0.5 - v.y / 1.6) });
    cloth.add(new SphereGeometry(0.05, 5, 4), { at: [m.hx + 0.22, m.wall - 1.45, s * (m.hz - 0.15)], colour: C.brass, flat: true, sway: 0.4 });
  }
  cloth.clearBase();
  // the lamp on the ridge: a chain, a brass cap and base and ribs, swinging (its glass and glow come from `lanternSpots`)
  for (const l of p.lamps) {
    const y = world.terrainHeight(l.x, l.z) + l.y;
    const top = g + m.ridge - 0.05;
    cloth.limb([l.x, top, l.z], [l.x, y + 0.24, l.z], 0.006, 0.006, C.iron, 3, false, (t) => t * 0.5);
    cloth.add(new ConeGeometry(0.11, 0.1, 6), { at: [l.x, y + 0.2, l.z], colour: C.brass, flat: true, sway: 0.5 });
    cloth.add(new CylinderGeometry(0.085, 0.09, 0.03, 6), { at: [l.x, y - 0.155, l.z], colour: C.brass, flat: true, sway: 0.5 });
    if (lod) for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      cloth.limb([l.x + Math.cos(a) * 0.09, y - 0.14, l.z + Math.sin(a) * 0.09], [l.x + Math.cos(a) * 0.085, y + 0.16, l.z + Math.sin(a) * 0.085], 0.006, 0.006, C.brass, 3, false, 0.5);
    }
  }
}

// ---- the decals (the banners mesh) ------------------------------------------------------------------------------------------------------------------

/** The Society's arms on both flagpoles, bunting between them and across the mouth, the notice board, the crate stencils. */
export function hqBanners(world: CollisionWorld, quad: PushQuad): void {
  const p = hqPlan();
  const m = p.marquee;
  const gy = (x: number, z: number): number => world.terrainHeight(x, z);
  // arms: a hanging banner under each pole's cross-arm, facing the mouth and (mirrored by its back face) the way behind
  for (const q of p.poles) {
    const w = 0.78;
    const h = w * 1.5;
    const top = gy(q.x, q.z) + q.height - 0.37;
    for (const side of [1, -1]) {
      const yaw = m.yaw + (side > 0 ? 0 : Math.PI);
      const off = side * 0.055;
      const cx = q.x + Math.cos(m.yaw) * off;
      const cz = q.z + Math.sin(m.yaw) * off;
      const f = facing(cx, top - h / 2, cz, yaw, w, h);
      quad(f.corners, f.normal, ARMS_SOCIETY_UV, [1, 1, 0, 0]);
    }
  }
  // bunting: alternating flags on a string between the two pole tops (sagging), and a second string across the mouth's valance
  const [a, b] = p.poles;
  if (a && b) {
    const ya = gy(a.x, a.z) + a.height - 0.55;
    const yb = gy(b.x, b.z) + b.height - 0.55;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 0.8) / n;
      const pt = (t: number): V3 => [a.x + (b.x - a.x) * t, ya + (yb - ya) * t - 0.55 * 4 * t * (1 - t), a.z + (b.z - a.z) * t];
      const p0 = pt(t0);
      const p1 = pt(t1);
      const mid = pt((t0 + t1) / 2);
      const [u0, v0, u1, v1] = swatchUv(i % 4);
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      const drop: V3 = [mid[0], mid[1] - 0.34, mid[2]];
      // one double-sided triangle: the quad helper takes four corners, so a degenerate fourth corner makes a triangle
      const nrm: V3 = [Math.cos(m.yaw), 0, Math.sin(m.yaw)];
      quad([p0, p1, drop, drop], nrm, [um - 0.001, vm - 0.001, um + 0.001, vm + 0.001], [0, 0, 0.9, 0.9]);
    }
  }
  // notice board, front face
  const nt = p.notice;
  {
    const f = facing(nt.x + Math.cos(nt.yaw) * 0.09, gy(nt.x, nt.z) + nt.y, nt.z + Math.sin(nt.yaw) * 0.09, nt.yaw, nt.w - 0.08, nt.h - 0.08);
    quad(f.corners, f.normal, NOTICE_UV);
  }
  // stencils on the crates (the face toward +x of each crate, and its neighbour) and on the pyramid's bottom row
  for (const c of p.crates) {
    const w = c.half * 2 * 0.86;
    for (const face of [0, 1]) {
      const yaw = c.yaw + (face ? Math.PI / 2 : 0);
      const cx = c.x + Math.cos(yaw) * (c.half + 0.006);
      const cz = c.z + Math.sin(yaw) * (c.half + 0.006);
      const f = facing(cx, gy(c.x, c.z) + c.height * 0.5, cz, yaw, w, w / 2);
      quad(f.corners, f.normal, stencilUv((c.stencil + face) % 4));
    }
  }
  p.pyramid.tiers.forEach((t, ti) => {
    const rows = [3, 2, 1][ti]!;
    for (let i = 0; i < rows; i++) {
      const lz = (i - (rows - 1) / 2) * 0.7;
      const cx0 = t.x - Math.sin(t.yaw) * lz;
      const cz0 = t.z + Math.cos(t.yaw) * lz;
      const cx = cx0 + Math.cos(t.yaw) * 0.406;
      const cz = cz0 + Math.sin(t.yaw) * 0.406;
      const f = facing(cx, gy(t.x, t.z) + t.y0 + 0.33, cz, t.yaw, 0.6, 0.3);
      quad(f.corners, f.normal, stencilUv((ti * 2 + i) % 4));
    }
  });
}

export type { BufferGeometry };
void CAMP;
void M;
