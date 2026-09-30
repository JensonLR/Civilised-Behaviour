import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, IcosahedronGeometry, OctahedronGeometry, Path, Shape, SphereGeometry, TorusGeometry, Vector3 } from "three";
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


// ---- the tower ------------------------------------------------------------------------------------------------------------------------

const DOOR_COURSE_TOP = 6; // courses below this one are cut by the doorway
const copperFn = (seed: number, bias = 0): ColourFn => (p, n, out) => {
  // Copper gone green: mostly verdigris with brown patches where the weather has not got to it yet, pale where rain has run.
  const t = f01(seed, Math.floor(p.x * 3), Math.floor(p.z * 3 + p.y * 2));
  blend(out, W.copper, W.verdigris, Math.min(1, 0.45 + t * 0.7 + bias));
  if (n.y > 0.4) out.lerp(verdigrisLight, 0.4 * t);
  if (t > 0.86) out.lerp(copperDark, 0.6);
};
const verdigrisLight = new Color(W.verdigrisLight);
const copperDark = new Color(W.copperDark);
const interiorC = new Color(W.ruinInterior);
const leatherC = new Color(PALETTE.camp.leather);

/**
 * The drum: courses of tangent stone blocks in a running bond, cut by a doorway that faces the camp (the jambs are clipped flush to the
 * door), with the crown snapped unevenly where the dome has gone. The inside faces are painted dark (a room with one lantern). Built from
 * blocks instead of a lathe precisely so the doorway is a real opening the collision ring (`ruinObstacles`) agrees with.
 */
function tower(k: Kit, tw: RuinPlan["tower"], tx: number, lod: Lod): void {
  const rows = lod ? 16 : 8;
  const foot = -0.6;
  const course = (tw.h - foot) / rows;
  const N = tw.segments;
  const step = (Math.PI * 2) / N;
  const mid = (tw.r + tw.rIn) / 2;
  const thick = tw.r - tw.rIn;
  const slitA = SLIT_AZ;
  for (let row = 0; row < rows; row++) {
    const y0 = foot + row * course;
    const y1 = y0 + course;
    const odd = row % 2 === 1;
    for (let c = 0; c < N; c++) {
      // the block's angular interval, wrapped so the door test is simple
      const centre = (c + (odd ? 0.5 : 0)) * step;
      const cw = Math.atan2(Math.sin(centre), Math.cos(centre));
      let a0 = cw - step / 2;
      let a1 = cw + step / 2;
      // the crown has snapped: near the dome's gap the wall stops lower
      const gap = Math.abs(Math.atan2(Math.sin(cw - slitA), Math.cos(cw - slitA)));
      const top = tw.h - (gap < 0.5 ? 2 : gap < 0.95 ? 1 : 0) * course * (1 + Math.floor(f01(94, c) * 2));
      if (y1 > top + 1e-6 && row > 0) continue;
      // the doorway cuts everything below its lintel within +-doorHalf of angle 0: keep only what lies outside it, flush to the jamb
      if (row < DOOR_COURSE_TOP && a0 < tw.doorHalf && a1 > -tw.doorHalf) {
        if (cw > 0) a0 = Math.max(a0, tw.doorHalf);
        else a1 = Math.min(a1, -tw.doorHalf);
        if (a1 - a0 < 0.06) continue;
      }
      const ca = (a0 + a1) / 2;
      const len = 2 * mid * Math.tan((a1 - a0) / 2) + 0.05;
      const inward = ca;
      const col: ColourFn = (p, n, out) => {
        const t = f01(96, row, c);
        blend(out, W.ruinPale, W.ruinShadow, 0.12 + t * 0.55);
        if (n.y > 0.6) out.lerp(pale, 0.3);
        else if (n.y < -0.4) out.lerp(shadow, 0.5);
        // moss climbs the outside from the foot; the inside faces (facing the room) are painted dark
        const facing = n.x * Math.cos(inward) + n.z * Math.sin(inward);
        if (facing < -0.5) {
          out.lerp(interiorC, 0.8 - 0.25 * Math.min(1, Math.max(0, (y0 - 1.2) / 6)));
          out.multiplyScalar(0.55 + 0.45 * (1 - Math.min(1, y0 / 9)));
        } else {
          const low = 1 - Math.min(1, Math.max(0, (y0 + 0.4) / 1.8));
          if (low > 0) out.lerp(mossC, Math.min(0.75, low * (0.45 + t)));
          if (y0 > 6 && t > 0.7) out.lerp(verdigrisLight, 0.18); // rain-streaks off the copper above
        }
      };
      k.add(new BoxGeometry(len, course * 0.985, thick), { at: [tx + Math.cos(ca) * mid, (y0 + y1) / 2, Math.sin(ca) * mid], rot: [0, Math.PI / 2 - ca, 0], colour: col, perFace: true, jitter: 0.02, seed: 700 + row * 31 + c });
    }
  }
  // a stout stone sill and a door-stop in the doorway
  k.add(new BoxGeometry(thick + 0.4, 0.14, tw.doorHalf * 2 * mid + 0.5), { at: [tx + mid, 0.03, 0], colour: masonry(0.3, 240, 0.3), flat: true });
  // slit windows, deep and dark
  for (const [a, y] of [[0.8, 6.0], [-0.9, 7.6], [2.2, 5.4], [-2.3, 7.0], [3.14, 6.4]] as const) {
    k.add(new BoxGeometry(0.2, 1.05, thick * 0.55), { at: [tx + Math.cos(a) * (tw.r - 0.05), y, Math.sin(a) * (tw.r - 0.05)], rot: [0, Math.PI / 2 - a, 0], colour: darkFn, flat: true });
  }
  // a heavy plank door, hung open on its hinges and hanging a little crooked
  if (lod) {
    const jamb = tw.doorHalf * mid * 2 * 0.5;
    k.add(new BoxGeometry(0.09, tw.doorH - 0.2, jamb * 1.7), {
      at: [tx + mid + 0.62, (tw.doorH - 0.2) / 2, -jamb * 1.15],
      rot: [0.03, -1.1, 0.02],
      colour: (p, _n, out) => blend(out, PALETTE.props.crate, PALETTE.props.crateDark, 0.35 + 0.5 * f01(250, Math.floor(p.z * 6))),
      flat: true,
      jitter: 0.012,
      seed: 251,
    });
    for (const y of [0.6, tw.doorH - 0.7]) k.add(new BoxGeometry(0.11, 0.09, jamb * 1.75), { at: [tx + mid + 0.62, y, -jamb * 1.15], rot: [0.03, -1.1, 0.02], colour: PALETTE.camp.iron, flat: true });
  }
}

/** The dome's azimuth of the observing slit (radians, ruin frame, 0 = toward the camp). */
const SLIT_AZ = Math.PI * 0.72;
const DOME_COLS = 14;
const DOME_BANDS = [0, 0.36, 0.74, 1.08, 1.34] as const; // latitudes (radians above the springing)

/** Which of the dome's panels have survived: the slit is open, the far side has fallen in, the rest is patchy toward the top. */
function panelStands(col: number, band: number): boolean {
  const az = ((col + 0.5) / DOME_COLS) * Math.PI * 2;
  const dSlit = Math.abs(Math.atan2(Math.sin(az - SLIT_AZ), Math.cos(az - SLIT_AZ)));
  if (dSlit < 0.4) return false;
  const dFall = Math.abs(Math.atan2(Math.sin(az - Math.PI * 1.55), Math.cos(az - Math.PI * 1.55)));
  if (dFall < 0.75 && band >= 1 && f01(260, col, band) < 0.72) return false;
  return f01(261, col, band) > 0.06 + 0.1 * band;
}

/** A closed, thick patch of a sphere between two meridians and two parallels (outer skin, inner skin, four edges), wound for flat shading. */
function domePanel(R: number, thick: number, lon0: number, lon1: number, lat0: number, lat1: number, sub: number): BufferGeometry {
  const pos: number[] = [];
  const P = (lon: number, lat: number, r: number): Vector3 => new Vector3(Math.cos(lat) * Math.cos(lon) * r, Math.sin(lat) * r, Math.cos(lat) * Math.sin(lon) * r);
  const panelMid = P((lon0 + lon1) / 2, (lat0 + lat1) / 2, R - thick / 2);
  const origin = new Vector3(0, 0, 0);
  const e1 = new Vector3();
  const e2 = new Vector3();
  const cen = new Vector3();
  /** Emits a triangle facing away from (`away`) or toward `ref`. */
  const tri = (a: Vector3, b: Vector3, c: Vector3, ref: Vector3, away: boolean): void => {
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(ref);
    const facing = e1.cross(e2).dot(cen) > 0;
    if (facing !== away) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < sub; i++) {
    for (let j = 0; j < sub; j++) {
      const l0 = lon0 + ((lon1 - lon0) * i) / sub;
      const l1 = lon0 + ((lon1 - lon0) * (i + 1)) / sub;
      const t0 = lat0 + ((lat1 - lat0) * j) / sub;
      const t1 = lat0 + ((lat1 - lat0) * (j + 1)) / sub;
      for (const [r, away] of [[R, true], [R - thick, false]] as const) {
        const a = P(l0, t0, r);
        const b = P(l1, t0, r);
        const c = P(l1, t1, r);
        const d = P(l0, t1, r);
        tri(a, d, c, origin, away);
        tri(a, c, b, origin, away);
      }
    }
  }
  // the four edges (a strip between the outer and inner skin), each facing away from the panel's middle
  const edge = (fromLon: number, fromLat: number, toLon: number, toLat: number): void => {
    for (let q = 0; q < sub; q++) {
      const u0 = q / sub;
      const u1 = (q + 1) / sub;
      const a = P(fromLon + (toLon - fromLon) * u0, fromLat + (toLat - fromLat) * u0, R);
      const b = P(fromLon + (toLon - fromLon) * u1, fromLat + (toLat - fromLat) * u1, R);
      const c = P(fromLon + (toLon - fromLon) * u1, fromLat + (toLat - fromLat) * u1, R - thick);
      const d = P(fromLon + (toLon - fromLon) * u0, fromLat + (toLat - fromLat) * u0, R - thick);
      tri(a, b, c, panelMid, true);
      tri(a, c, d, panelMid, true);
    }
  };
  edge(lon0, lat0, lon1, lat0);
  edge(lon1, lat0, lon1, lat1);
  edge(lon1, lat1, lon0, lat1);
  edge(lon0, lat1, lon0, lat0);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

/** The dome on its ring beam: fourteen copper ribs, panels of verdigris plate (some fallen), an observing slit, an open oculus at the top. */
function dome(k: Kit, tw: RuinPlan["tower"], tx: number, lod: Lod): void {
  const R = tw.r + 0.06;
  const y0 = tw.h;
  const sub = 1;
  // ring beam
  const beam = new TorusGeometry(R - 0.1, 0.2, 5, lod ? 20 : 12);
  beam.rotateX(Math.PI / 2);
  k.add(beam, { at: [tx, y0 + 0.05, 0], colour: copperFn(270, -0.1), flat: true });
  // panels
  for (let c = 0; c < DOME_COLS; c++) {
    const lon0 = (c / DOME_COLS) * Math.PI * 2;
    const lon1 = ((c + 1) / DOME_COLS) * Math.PI * 2;
    for (let b = 0; b < DOME_BANDS.length - 1; b++) {
      if (!panelStands(c, b)) continue;
      const g = domePanel(R, 0.09, lon0 + 0.012, lon1 - 0.012, DOME_BANDS[b]! + 0.01, DOME_BANDS[b + 1]! - 0.01, sub);
      const seed = 280 + c * 7 + b;
      const bias = -0.15 + f01(281, c, b) * 0.3;
      const outer = copperFn(seed, bias);
      k.add(g, {
        at: [tx, y0, 0],
        colour: (p, n, out) => {
          // the underside of the plate faces the room: dark
          const radial = (n.x * p.x + n.y * p.y + n.z * p.z) / (p.length() || 1);
          if (radial < -0.2) {
            out.copy(interiorC).lerp(copperDark, 0.25);
            return;
          }
          outer(p, n, out);
          // overlapping plates: every other course a shade lighter
          if (Math.floor((Math.asin(Math.min(1, Math.max(-1, p.y / R))) - DOME_BANDS[b]!) * 9) % 2 === 0) out.multiplyScalar(0.92);
        },
        perFace: true,
      });
    }
  }
  // ribs: they outlast the plates; those on the fallen side are snapped part-way up
  for (let c = 0; c < DOME_COLS; c++) {
    const lon = (c / DOME_COLS) * Math.PI * 2;
    const snap = Math.abs(Math.atan2(Math.sin(lon - Math.PI * 1.55), Math.cos(lon - Math.PI * 1.55))) < 0.75 ? 0.45 + f01(290, c) * 0.4 : 1;
    const top = DOME_BANDS[DOME_BANDS.length - 1]!;
    const arc = top * snap;
    const rib = new TorusGeometry(R + 0.03, 0.11, 5, lod ? 16 : 8, arc);
    k.add(rib, { at: [tx, y0, 0], rot: [0, -lon, 0], colour: copperFn(291 + c, -0.25), flat: true });
  }
  // the oculus ring at the crown and a finial on a stub of frame
  const topLat = DOME_BANDS[DOME_BANDS.length - 1]!;
  const ring = new TorusGeometry(R * Math.cos(topLat) + 0.05, 0.16, 5, lod ? 14 : 8);
  ring.rotateX(Math.PI / 2);
  k.add(ring, { at: [tx, y0 + R * Math.sin(topLat) + 0.02, 0], colour: copperFn(299, -0.1), flat: true });
  if (lod) k.add(new SphereGeometry(0.13, 6, 4), { at: [tx + 0.9, y0 + R * Math.sin(topLat) + 0.28, 0.2], colour: copperFn(298, 0.2), flat: true });
}

/** The room inside: a flagged floor, a plinth bearing an armillary sphere, a wall bracket and the one lantern (its glass and glow are added by the world). */
function interior(k: Kit, plan: RuinPlan, tx: number, lod: Lod): void {
  const tw = plan.tower;
  k.add(new CylinderGeometry(tw.rIn + 0.05, tw.rIn + 0.05, 0.1, lod ? 14 : 8), {
    at: [tx, 0.02, 0],
    colour: (p, n, out) => {
      const t = f01(300, Math.floor(p.x * 1.6), Math.floor(p.z * 1.6));
      blend(out, W.ruinShadow, W.ruinInterior, 0.5 + t * 0.45);
      if (n.y < 0.5) out.lerp(interiorC, 0.5);
    },
    perFace: true,
  });
  // plinth
  k.add(new CylinderGeometry(tw.plinth * 0.86, tw.plinth, 1.08, lod ? 10 : 7), { at: [tx, 0.54, 0], colour: masonry(0.36, 301, 0.3), perFace: true, jitter: 0.015, seed: 302 });
  k.add(new CylinderGeometry(tw.plinth * 1.05, tw.plinth * 1.05, 0.08, lod ? 10 : 7), { at: [tx, 1.12, 0], colour: masonry(0.3, 303, 0), flat: true });
  if (!lod) return;
  // the armillary sphere: three brass rings on an axis, and a bead for the earth
  const brass = PALETTE.camp.brass;
  const rings: [number, [number, number, number]][] = [[0.44, [0, 0, 0]], [0.44, [Math.PI / 2, 0, 0]], [0.44, [0.5, 0, Math.PI / 2 + 0.4]], [0.3, [Math.PI / 2, 0.3, 0]]];
  for (const [r, rot] of rings) k.add(new TorusGeometry(r, 0.018, 4, 18), { at: [tx, 1.72, 0], rot, colour: brass, flat: true });
  k.limb([tx, 1.15, 0], [tx, 2.22, 0], 0.02, 0.02, PALETTE.camp.iron, 5);
  k.add(new SphereGeometry(0.09, 7, 5), { at: [tx, 1.72, 0], colour: W.copper, flat: true });
  // the lantern's bracket on the wall behind the plinth (glass and glow are separate)
  const l = plan.lantern;
  void l;
  const wallX = tx - (tw.rIn - 0.02);
  const lx = tx - 2.05;
  k.limb([wallX, 2.85, 0], [wallX, 2.7, 0], 0.05, 0.04, PALETTE.camp.iron, 5);
  k.limb([wallX, 2.8, 0], [lx, 2.8, 0], 0.03, 0.025, PALETTE.camp.iron, 5);
  k.limb([lx, 2.8, 0], [lx, 2.62, 0], 0.008, 0.008, PALETTE.camp.iron, 3);
  k.add(new CylinderGeometry(0.11, 0.09, 0.1, 6), { at: [lx, 2.58, 0], colour: PALETTE.camp.brass, flat: true });
  k.add(new CylinderGeometry(0.09, 0.1, 0.03, 6), { at: [lx, 2.27, 0], colour: PALETTE.camp.brass, flat: true });
}

/** The Society's Great Refractor: a brass-and-leather tube as long as a rowing boat, tilted at the sky on a stone pier. */
function telescope(k: Kit, plan: RuinPlan, lod: Lod): void {
  const t = plan.telescope;
  // the pier's position in the ruin's frame: invert the plan's local() mapping for (t.x, t.z)
  const cy = Math.cos(plan.yaw);
  const sy = Math.sin(plan.yaw);
  const dx = t.x - HILL.x;
  const dz = t.z - HILL.z;
  const lx = dx * cy + dz * sy;
  const lz = -dx * sy + dz * cy;
  const a = t.az - plan.yaw; // tube azimuth in the ruin's frame
  const dir: V3 = [Math.cos(a) * Math.cos(t.el), Math.sin(t.el), Math.sin(a) * Math.cos(t.el)];
  const pivot: V3 = [lx, t.h + 0.62, lz];
  const at = (s: number): V3 => [pivot[0] + dir[0] * s, pivot[1] + dir[1] * s, pivot[2] + dir[2] * s];
  const brass = PALETTE.camp.brass;
  const leather = PALETTE.camp.leather;
  k.add(new CylinderGeometry(t.r * 0.82, t.r, t.h, lod ? 10 : 7), { at: [lx, t.h / 2, lz], colour: masonry(0.4, 310, 0.5), perFace: true, jitter: 0.015, seed: 311 });
  k.add(new CylinderGeometry(t.r * 1.05, t.r * 1.05, 0.1, lod ? 10 : 7), { at: [lx, t.h + 0.03, lz], colour: masonry(0.3, 312, 0), flat: true });
  // a fork of iron cheeks either side of the tube and the axle between them
  const side: V3 = [-Math.sin(a), 0, Math.cos(a)];
  for (const s of [-1, 1]) k.limb([lx, t.h + 0.06, lz], [pivot[0] + side[0] * 0.2 * s, pivot[1], pivot[2] + side[2] * 0.2 * s], 0.05, 0.035, PALETTE.camp.iron, 5);
  k.limb([pivot[0] - side[0] * 0.24, pivot[1], pivot[2] - side[2] * 0.24], [pivot[0] + side[0] * 0.24, pivot[1], pivot[2] + side[2] * 0.24], 0.04, 0.04, brass, 6);
  // the tube: eyepiece end (behind the pivot), body, brass bands, and a wide dew-cap at the far end
  const bandy = (p: Vector3, _n: Vector3, out: Color): void => {
    // polished brass with a green bloom, and a leather-bound grip every so often
    blend(out, brass, W.verdigris, 0.18 + 0.32 * f01(313, Math.floor(p.y * 4)));
    if (Math.floor(p.y * 2.2) % 3 === 0) out.lerp(leatherC, 0.75);
  };
  k.limb(at(-0.9), at(-0.2), 0.05, 0.075, leather, 8);
  k.limb(at(-0.2), at(0.6), 0.09, 0.14, brass, 12);
  k.limb(at(0.6), at(3.5), 0.14, 0.2, bandy, 12);
  k.limb(at(3.5), at(4.3), 0.2, 0.27, brass, 12);
  if (lod) {
    for (const s of [0.6, 1.5, 2.4, 3.4]) k.add(new TorusGeometry(0.15 + s * 0.02, 0.02, 4, 14), { at: at(s), rot: [Math.PI / 2 - t.el, -a + Math.PI / 2 + 0, 0], colour: brass, flat: true });
    // finder scope and counterweight
    const off = (s: number, o: number): V3 => [at(s)[0] + side[0] * o * 0 + 0, at(s)[1] + o, at(s)[2]];
    k.limb(off(-0.1, 0.3), off(0.9, 0.34), 0.02, 0.03, brass, 6);
    k.limb(at(-0.6), [pivot[0] - dir[0] * 0.9 - 0.02, pivot[1] - dir[1] * 0.9 - 0.45, pivot[2] - dir[2] * 0.9], 0.015, 0.015, PALETTE.camp.iron, 3);
    k.add(new IcosahedronGeometry(0.13, 0), { at: [pivot[0] - dir[0] * 0.9, pivot[1] - dir[1] * 0.9 - 0.55, pivot[2] - dir[2] * 0.9], colour: PALETTE.camp.iron, flat: true });
    // a stack of star-charts under a stone on the pier
    k.add(new BoxGeometry(0.34, 0.05, 0.26), { at: [lx + t.r * 0.35, t.h + 0.1, lz - t.r * 0.3], rot: [0, 0.4, 0], colour: PALETTE.camp.mapPaper, flat: true });
  }
}

/**
 * A hanging vine: a drooping chain of thin segments with leaves along it, from `top` down `len` metres, leaning `lean` metres sideways.
 * Static (the wind does not reach into a ruin's shade), one merged part, no ink worth having.
 */
function vine(k: Kit, top: V3, len: number, seed: number, lean = 0.15): void {
  const segs = 5;
  const rnd = (i: number): number => f01(seed, i, 7) - 0.5;
  let prev: V3 = top;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const next: V3 = [top[0] + lean * t + rnd(i) * 0.12, top[1] - len * t, top[2] + lean * 0.4 * t + rnd(i + 9) * 0.12];
    k.limb(prev, next, 0.014 * (1.15 - t * 0.5), 0.012 * (1.15 - t * 0.5), (p, _n, out) => blend(out, W.vine, W.vineLight, 0.3 + 0.4 * f01(seed, Math.floor(p.y * 9))), 3);
    if (i >= 2) {
      const s = 0.055 + 0.03 * f01(seed, i, 1);
      k.add(new OctahedronGeometry(s, 0), { at: [next[0] + rnd(i + 3) * 0.1, next[1], next[2] + rnd(i + 5) * 0.1], scale: [1, 0.35, 1.5], rot: [0, f01(seed, i, 2) * 3, 0.5], colour: (_p, n, out) => blend(out, W.vine, W.vineLight, n.y > 0.2 ? 0.7 : 0.15), flat: true });
    }
    prev = next;
  }
}

/** Hanging vines from the tower's broken crown, the standing architraves and the dome's ring beam. */
export function ruinVines(k: Kit, plan: RuinPlan, terrain: Terrain): void {
  const tw = plan.tower;
  const tx = -1.2;
  const cy = Math.cos(plan.yaw);
  const sy = Math.sin(plan.yaw);
  k.setBase(HILL.x, plan.level, HILL.z, plan.yaw);
  // off the tower: from the ring beam and the lowered crown
  for (let i = 0; i < 9; i++) {
    const a = f01(320, i) * Math.PI * 2;
    if (Math.abs(a) < 0.5 || Math.abs(a - Math.PI * 2) < 0.5) continue; // keep the doorway clear
    const r = tw.r + 0.08;
    vine(k, [tx + Math.cos(a) * r, tw.h - 0.1 - f01(321, i) * 1.2, Math.sin(a) * r], 1.8 + f01(322, i) * 4.2, 330 + i, 0.05);
  }
  // off the columns' capitals
  plan.columns.forEach((c, i) => {
    if (c.broken || f01(323, i) > 0.7) return;
    const dx = c.x - HILL.x;
    const dz = c.z - HILL.z;
    const lx = dx * cy + dz * sy;
    const lz = -dx * sy + dz * cy;
    const h = terrain.height(c.x, c.z) - plan.level;
    vine(k, [lx + c.r * 0.9, h + c.h - 0.5, lz], 1.6 + f01(324, i) * 2.6, 350 + i, 0.08);
    if (f01(325, i) > 0.4) vine(k, [lx - c.r * 0.6, h + c.h - 0.45, lz + c.r * 0.7], 1.0 + f01(326, i) * 1.8, 370 + i, -0.06);
  });
  k.clearBase();
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

  // ---- the drum tower ------------------------------------------------------------------------------------------------------------
  const tw = plan.tower;
  const tx = -1.2; // the plan places the tower's centre at (-1.2, 0) in the ruin's frame
  k.setBase(HILL.x, level, HILL.z, plan.yaw);
  tower(k, tw, tx, lod);
  dome(k, tw, tx, lod);
  interior(k, plan, tx, lod);
  k.clearBase();

  // ---- the great refractor on its pier -------------------------------------------------------------------------------------------
  k.setBase(HILL.x, level, HILL.z, plan.yaw);
  telescope(k, plan, lod);
  if (lod) {
    // the fallen stones round the tower's foot
    for (let i = 0; i < 16; i++) {
      const a = f01(100, i) * Math.PI * 2;
      const d = 4.6 + f01(101, i) * 4;
      const sz = 0.35 + f01(102, i) * 0.7;
      const x = tx + Math.cos(a) * d;
      const z = Math.sin(a) * d;
      k.add(new BoxGeometry(sz * 1.5, sz * 0.8, sz), { at: [x, sz * 0.3, z], rot: [(f01(103, i) - 0.5) * 0.5, f01(104, i) * 3, (f01(105, i) - 0.5) * 0.4], colour: masonry(0.4, 106 + i, 1), flat: true, jitter: 0.04, seed: 300 + i });
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
  if (lod) ruinVines(k, plan, terrain);
  void RIVER;
  return k.build();
}
