import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Path, Shape, TorusGeometry, Vector2 } from "three";
import { HILL, PALETTE, RIVER, hash3, ruinPlan, type RuinPlan, type Terrain } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import type { Lod } from "./flora.ts";

/**
 * The Society's abandoned Observatory of Improvement, drawn from the SAME plan that makes its collision (`ruinPlan`, shared): a drum
 * tower that once carried a dome (only the ribs of a quarter of it remain), a colonnade of which some columns stand under their
 * architraves and the rest have snapped, a paved plateau's kerb, and the broken aqueduct that marches down the hill and stops in mid-air
 * above the stream's source. One merged, per-face-coloured geometry: one draw and one ink hull for the whole ruin.
 */

const W = PALETTE.world;
const f01 = (seed: number, a: number, b = 0): number => hash3(seed, a, b, 0) / 4294967296;

/** Masonry: crisp courses and blocks (one colour per face), pale on top, mossy at the foot. */
function masonry(course: number, seed: number, moss = 0.5, yOff = 0): ColourFn {
  return (p, n, out) => {
    const y = p.y + yOff; // height above the piece's foot (Kit colours in the primitive's own frame)
    const row = Math.floor(y / course);
    const col = Math.floor((Math.atan2(p.z, p.x) + Math.PI) * 3.2 + Math.abs(p.x * 0.5) + row * 0.7);
    const t = f01(seed, row, col);
    blend(out, W.ruinPale, W.ruinShadow, 0.12 + t * 0.55);
    if (n.y > 0.6) out.lerp(pale, 0.32);
    else if (n.y < -0.4) out.lerp(shadow, 0.5);
    const low = 1 - Math.min(1, Math.max(0, y / 1.4));
    if (low > 0 && moss > 0) out.lerp(mossC, Math.min(0.7, low * moss * (0.4 + t)));
  };
}

const pale = new Color(W.rockPale);
const shadow = new Color(W.ruinShadow);
const mossC = new Color(W.moss);
const dark = new Color(W.rockDark);
const darkFn: ColourFn = (_p, _n, out) => out.copy(dark);

/** An arch span: the solid spandrel between two piers with a rounded opening, extruded to the aqueduct's width. Local x along the span. */
function archSpan(len: number, spring: number, rise: number, thick: number, width: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-len / 2, 0);
  shape.lineTo(len / 2, 0);
  shape.lineTo(len / 2, thick);
  shape.lineTo(-len / 2, thick);
  shape.closePath();
  const hole = new Path();
  const rx = len / 2 - 0.5;
  hole.moveTo(rx, 0);
  hole.absellipse(0, 0, rx, rise, 0, Math.PI, false);
  hole.lineTo(rx, 0);
  shape.holes.push(hole);
  void spring;
  const g = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -width / 2);
  return g;
}

export function buildRuins(terrain: Terrain, lod: Lod): BufferGeometry | undefined {
  const plan: RuinPlan = ruinPlan(terrain);
  const k = new Kit();
  const level = plan.level;
  const at = (x: number, z: number): number => terrain.height(x, z);

  // ---- plateau kerb -------------------------------------------------------------------------------------------------------------
  k.setBase(HILL.x, level, HILL.z, plan.yaw);
  const kerb = lod ? 26 : 14;
  for (let i = 0; i < kerb; i++) {
    if (f01(90, i) < 0.14) continue; // missing stones
    const a = (i / kerb) * Math.PI * 2;
    const len = ((Math.PI * 2 * 9.7) / kerb) * 0.92;
    const h = 0.16 + f01(91, i) * 0.14;
    k.add(new BoxGeometry(len, h, 0.42), { at: [Math.cos(a) * 9.7, h / 2 - 0.03, Math.sin(a) * 9.7], rot: [0, -a - Math.PI / 2, 0], colour: masonry(0.3, 92, 0.7), flat: true, jitter: 0.02, seed: 93 + i });
  }

  // ---- the drum tower -----------------------------------------------------------------------------------------------------------
  const tw = plan.tower;
  const seg = lod ? 14 : 9;
  // local frame of the tower: the plan places it at (-1.2, 0) in the ruin's frame
  const tx = -1.2;
  const profile: [number, number][] = [
    [3.95, -0.7],
    [3.95, 0.4],
    [3.6, 0.6],
    [3.33, 1.05],
    [3.3, 3.2],
    [3.3, 6.4],
    [3.3, 9.3],
    [3.55, 9.45],
    [3.55, 9.95],
    [3.3, 10.1],
    [3.3, tw.h],
  ];
  const body = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);
  const bp = body.attributes.position!;
  const broken: number[] = [];
  for (let i = 0; i < seg; i++) broken.push(f01(94, i) < 0.28 ? 0.2 : 0.7 + f01(95, i) * 2.6); // the crown snapped unevenly
  for (let i = 0; i < bp.count; i++) {
    if (bp.getY(i) > tw.h - 0.01) {
      const a = Math.atan2(bp.getZ(i), bp.getX(i));
      const s = ((Math.round((a / (Math.PI * 2)) * seg) % seg) + seg) % seg;
      bp.setY(i, tw.h - broken[s]!);
    } else if (bp.getY(i) > 10.09) {
      // the inner face of the parapet tracks the break
      const a = Math.atan2(bp.getZ(i), bp.getX(i));
      const s = ((Math.round((a / (Math.PI * 2)) * seg) % seg) + seg) % seg;
      bp.setY(i, Math.min(bp.getY(i), tw.h - broken[s]! - 0.01));
    }
  }
  k.setBase(HILL.x, level, HILL.z, plan.yaw);
  k.add(body, { at: [tx, 0, 0], colour: masonry(0.72, 96, 0.6), perFace: true, jitter: 0.03, seed: 97 });
  // doorway (blind: the collision is a solid drum), lintel and slit windows
  k.add(new BoxGeometry(0.2, 2.7, 1.5), { at: [tx + 3.28, 1.35, 0], colour: darkFn, flat: true });
  k.add(new BoxGeometry(0.55, 0.5, 2.3), { at: [tx + 3.3, 2.95, 0], colour: masonry(0.5, 98, 0), flat: true });
  for (const [a, y] of [[0.8, 6.0], [-0.9, 7.6], [2.2, 5.4], [-2.3, 7.0], [3.14, 6.4]] as const) {
    k.add(new BoxGeometry(0.16, 1.15, 0.36), { at: [tx + Math.cos(a) * 3.3, y, Math.sin(a) * 3.3], rot: [0, -a, 0], colour: darkFn, flat: true });
  }
  if (lod) {
    // ribs of the fallen dome on the far side, and the fallen stones round the foot
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.62 + i * 0.19);
      if (broken[((Math.round((a / (Math.PI * 2)) * seg) % seg) + seg) % seg]! > 2.1) continue;
      k.add(new TorusGeometry(3.15, 0.15, 5, 10, Math.PI / 2), { at: [tx, tw.h - 1.9, 0], rot: [0, -a, 0], colour: masonry(0.4, 99, 0), flat: true });
    }
    for (let i = 0; i < 16; i++) {
      const a = f01(100, i) * Math.PI * 2;
      const d = 4.6 + f01(101, i) * 4;
      const s = 0.35 + f01(102, i) * 0.7;
      const x = tx + Math.cos(a) * d;
      const z = Math.sin(a) * d;
      k.add(new BoxGeometry(s * 1.5, s * 0.8, s), { at: [x, s * 0.3, z], rot: [(f01(103, i) - 0.5) * 0.5, f01(104, i) * 3, (f01(105, i) - 0.5) * 0.4], colour: masonry(0.4, 106 + i, 1), flat: true, jitter: 0.04, seed: 300 + i });
    }
  }
  k.clearBase();

  // ---- the colonnade ------------------------------------------------------------------------------------------------------------
  const stand = plan.columns.map((c) => !c.broken);
  plan.columns.forEach((c, i) => {
    const g = at(c.x, c.z);
    k.setBase(c.x, g, c.z, 0);
    const half = c.r * 1.02;
    k.add(new BoxGeometry(half * 2, 0.4, half * 2), { at: [0, 0.2 - 0.05, 0], colour: masonry(0.4, 110 + i, 0.9, 0.15), flat: true, jitter: 0.015, seed: 400 + i });
    const shaftTop = c.broken ? c.h : c.h - 0.6;
    const sh = shaftTop - 0.3;
    const shaft = new CylinderGeometry(c.r * 0.84, c.r * 0.93, sh, lod ? 10 : 7, 1, false);
    if (c.broken) {
      const sp = shaft.attributes.position!;
      for (let v = 0; v < sp.count; v++) if (sp.getY(v) > 0) sp.setY(v, sp.getY(v) - (f01(120 + i, v % 9) * 0.5 - 0.1) * 1.4 * (1 + (sp.getX(v) > 0 ? 0.6 : 0)));
    }
    k.add(shaft, { at: [0, 0.3 + sh / 2, 0], colour: masonry(0.85, 121 + i, 0.8, 0.3 + sh / 2), perFace: true, jitter: 0.012, seed: 500 + i });
    if (!c.broken) {
      k.add(new CylinderGeometry(c.r * 1.3, c.r * 0.97, 0.34, lod ? 10 : 7), { at: [0, c.h - 0.6 + 0.17, 0], colour: masonry(0.3, 140 + i, 0), flat: true });
      k.add(new BoxGeometry(half * 2, 0.24, half * 2), { at: [0, c.h - 0.12, 0], colour: masonry(0.24, 141 + i, 0), flat: true });
    } else if (lod) {
      // a snapped drum lies where it fell
      const a = f01(130, i) * Math.PI * 2;
      const d = 0.9 + f01(131, i) * 1.2;
      const drum = new CylinderGeometry(c.r * 0.9, c.r * 0.9, 0.9 + f01(132, i), 8);
      drum.rotateZ(Math.PI / 2);
      k.add(drum, { at: [Math.cos(a) * d, c.r * 0.8, Math.sin(a) * d], rot: [0, f01(133, i) * 3, 0], colour: masonry(0.9, 134 + i, 1), perFace: true, jitter: 0.015, seed: 600 + i });
    }
    k.clearBase();
  });
  // architraves span neighbouring columns that both stand
  for (let i = 0; i < plan.columns.length; i++) {
    const a = plan.columns[i]!;
    const b = plan.columns[(i + 1) % plan.columns.length]!;
    if (!stand[i] || !stand[(i + 1) % plan.columns.length]) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len > 5.2) continue; // the entrance gap
    const ga = at(a.x, a.z);
    k.add(new BoxGeometry(len + 0.5, 0.55, 0.9), { at: [(a.x + b.x) / 2, ga + a.h + 0.27, (a.z + b.z) / 2], rot: [0, -Math.atan2(dz, dx), 0], colour: masonry(0.28, 150 + i, 0), flat: true, jitter: 0.015, seed: 700 + i });
  }

  // ---- the aqueduct -------------------------------------------------------------------------------------------------------------
  const ayaw = Math.atan2(plan.dir.z, plan.dir.x);
  const piers = plan.piers;
  piers.forEach((p, i) => {
    const g = at(p.x, p.z);
    k.setBase(p.x, g, p.z, ayaw);
    const top = p.top - g;
    k.add(new CylinderGeometry(p.r * 0.82, p.r, top + 0.8, lod ? 8 : 6), { at: [0, (top - 0.8) / 2, 0], colour: masonry(0.8, 160 + i, 0.9, (top - 0.8) / 2), perFace: true, jitter: 0.02, seed: 800 + i });
    // cut-water buttress on the uphill face and an impost block under the springing
    k.add(new BoxGeometry(p.r * 2.3, 0.3, p.r * 2), { at: [0, top - 0.15, 0], colour: masonry(0.3, 170 + i, 0), flat: true });
    if (lod && top > 2) k.add(new BoxGeometry(0.5, Math.min(top, 3.0), 0.5), { at: [-p.r * 0.95, Math.min(top, 3.0) / 2 - 0.2, 0], rot: [0, 0.78, 0], colour: masonry(0.6, 180 + i, 0.9), flat: true });
    k.clearBase();
    const n = piers[i + 1];
    if (!n) return;
    const len = Math.hypot(n.x - p.x, n.z - p.z);
    const my = (p.top + n.top) / 2;
    const slope = Math.atan2(p.top - n.top, len);
    k.setBase((p.x + n.x) / 2, my, (p.z + n.z) / 2, ayaw);
    const rise = Math.min(1.25, Math.max(0.3, (my - Math.max(at(p.x, p.z), at(n.x, n.z))) * 0.55));
    k.add(archSpan(len, 0, rise, 0.95, 2.2), { rot: [0, 0, -slope], colour: masonry(0.6, 190 + i, 0, 3), perFace: true, jitter: 0.012, seed: 900 + i });
    // the water channel: floor and two parapets
    const chan: V3 = [0, 0.95, 0];
    k.add(new BoxGeometry(len, 0.22, 2.5), { at: [0, chan[1] + 0.05, 0], rot: [0, 0, -slope], colour: masonry(0.3, 200 + i, 0), flat: true });
    for (const s of [-1, 1]) k.add(new BoxGeometry(len, 0.55, 0.3), { at: [0, chan[1] + 0.42, s * 1.1], rot: [0, 0, -slope], colour: masonry(0.28, 210 + i + s, 0.2), flat: true, jitter: 0.02, seed: 1000 + i });
    k.clearBase();
  });
  // the last pier carries a stub of deck that snaps off over the stream's source, and rubble lies beneath it
  const last = piers[piers.length - 1];
  if (last) {
    const g = at(last.x, last.z);
    k.setBase(last.x, g, last.z, ayaw);
    const top = last.top - g;
    k.add(new BoxGeometry(2.3, 0.95, 2.2), { at: [1.15, top + 0.47, 0], colour: masonry(0.5, 220, 0, 3), perFace: true, jitter: 0.05, seed: 1100 });
    k.add(new BoxGeometry(2.3, 0.22, 2.5), { at: [1.3, top + 1.0, 0], rot: [0, 0, -0.1], colour: masonry(0.3, 221, 0), flat: true, jitter: 0.04, seed: 1101 });
    if (lod) {
      for (let i = 0; i < 9; i++) {
        const s = 0.3 + f01(230, i) * 0.7;
        const a = f01(231, i) * 1.4 - 0.7;
        const d = 2 + f01(232, i) * 5;
        k.add(new BoxGeometry(s * 1.5, s * 0.8, s), { at: [Math.cos(a) * d + 1, -0.2 + s * 0.25, Math.sin(a) * d * 0.7], rot: [(f01(233, i) - 0.5) * 0.6, f01(234, i) * 3, 0], colour: masonry(0.4, 235 + i, 1), flat: true, jitter: 0.04, seed: 1200 + i });
      }
    }
    k.clearBase();
  }
  void RIVER;
  return k.build();
}
