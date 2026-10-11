import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, PlaneGeometry } from "three";
import { PALETTE, SALTMARKET, SALTWORKS, SALTWORKS_PIPE, hash3, insideFootprint, saltworksPlan, smoothstep, valueNoise, type CollisionWorld, type SaltHeap, type SaltHut, type SaltPan } from "./shared.ts";
import { Kit, blend, type ColourFn, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { LIT_SHARE, type LitPane } from "../litWindows.ts";

/**
 * D-121: the Brine Houses' salt works, drawn into the delta's merged solids (no draw of its own). Every piece stands where `saltworksPlan()` puts its collider: the clay bunds a walker
 * steps onto, the windrows in the raked pans, the heaps in the yard (thatched or bare, each with its House's pennant), the sluice gates, the two barrows and the rakes, and the brine
 * pump's suction pipe over the revetment into the Long Cut (the pump's tower is the delta's own windpump, drawn with the hairs). The brine is a flat sheet a hand above the levelled
 * floor, its colour the pan's state: the delta's grey water in the reservoir, sea-green, olive and rose as it thickens, a rose crust as it salts, white windrows when it is raked. The
 * far (north) side of each sheet is paler: the sky in it. Palette colours only.
 */

const P = PALETTE.saltmarket;
const B = SALTWORKS.bund;
const h01 = (seed: number, a: number, b = 0, c = 0): number => hash3(seed, Math.round(a * 10), Math.round(b * 10), c) / 4294967296;
/** The brine's surface above the floor (under the ground audit's 6 cm). */
const SHEET = 0.03;
/** How wide the crust is where the brine meets the bund. */
const RIM = 0.35;
/** The Houses' colours (a pennant on a heap, the board on a pan's lot stake). */
const HOUSE = [P.coralCanvas, P.indigoCanvas, P.brass, P.salt] as const;
const tmp = new Color();

/** Each brine state's tone, and the crust at its rim. */
const BRINE: Record<string, readonly [number, number]> = {
  reservoir: [P.siltWater, P.saltShade],
  green: [P.brineGreen, P.saltShade],
  olive: [P.brineOlive, P.salt],
  rose: [P.brineRose, P.brineRoseLight],
};

const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true, perFace: typeof colour !== "number" });
};

/** A flat sheet `hx` x `hz` (half extents) in nine patches: a rim `RIM` wide round a middle (each vertex its own colour, so the rim's tone fades into the middle's). */
function ninePatch(hx: number, hz: number): BufferGeometry {
  const xs = [-hx, -hx + RIM, hx - RIM, hx], zs = [-hz, -hz + RIM, hz - RIM, hz];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const z of zs) for (const x of xs) pos.push(x, 0, z);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const a = j * 4 + i, b = a + 1, c = a + 4, d = a + 5;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A pan's floor: still brine (a nine-patch, the crust at its rim), a crusting sheet of rose and white, the raked crust, or the bare clay of a lifted pan. */
function panFloor(k: Kit, p: SaltPan, y: number, i: number): void {
  const hx = (p.x1 - p.x0) / 2, hz = (p.z1 - p.z0) / 2;
  const at: V3 = [(p.x0 + p.x1) / 2, y + SHEET, (p.z0 + p.z1) / 2];
  const tone = BRINE[p.state];
  if (tone) {
    const [brine, crust] = tone;
    // a pan's tone wanders a little toward its neighbour's (no two pans of a row quite alike)
    const wander = (h01(610, p.lot) - 0.5) * 0.25;
    const next = p.state === "reservoir" ? P.brineGreen : p.state === "green" ? P.brineOlive : p.state === "olive" ? P.brineRose : P.brineRoseLight;
    k.add(ninePatch(hx, hz), {
      at,
      colour: (q, _n, out) => {
        const rim = Math.abs(q.x) > hx - 0.01 || Math.abs(q.z) > hz - 0.01;
        if (rim) return void blend(out, crust, brine, 0.15);
        blend(out, brine, next, Math.max(0, wander));
        if (q.z < 0) out.lerp(tmp.set(P.siltWaterPale), 0.28);   // (the far side holds the sky)
      },
    });
    return;
  }
  // the rest are sheets whose tone is a smooth noise over the pan (islands of crust, the scraped clay's seams): a vertex's colour, blended across its faces
  const seg = p.state === "crust" ? 10 : p.state === "raked" ? 6 : 8;
  const g = new PlaneGeometry(hx * 2, hz * 2, seg, seg);
  g.rotateX(-Math.PI / 2);
  const cx = at[0], cz = at[2];
  const colour: ColourFn = (q, _n, out) => {
    const n = valueNoise(621 + i, (cx + q.x) / 1.4, (cz + q.z) / 1.4);
    const edge = Math.min(hx - Math.abs(q.x), hz - Math.abs(q.z));
    if (p.state === "crust") {
      // brine crusting over: rose water between islands of white, the islands joining along the rim
      const crust = Math.max(smoothstep(0.52, 0.66, n), 1 - smoothstep(0.3, 0.9, edge));
      blend(out, P.brineRose, P.brineRoseLight, smoothstep(0.3, 0.5, n));
      return void out.lerp(tmp.set(P.salt), crust * 0.9);
    }
    if (p.state === "raked") return void blend(out, P.saltShade, P.brineRoseLight, smoothstep(0.35, 0.75, n) * 0.7);
    // lifted: the damp clay floor the salt was scraped from, a thin bloom of salt left in its seams
    blend(out, P.mudPale, P.siltPale, smoothstep(0.3, 0.7, n));
    out.lerp(tmp.set(P.saltShade), smoothstep(0.66, 0.8, n) * 0.6);
  };
  k.add(g, { at, colour });
}

/** A clay bund: a box whose top is narrower than its foot (a bank, not a wall), a little uneven, a bead of salt where the brine dried against its foot. */
function bund(k: Kit, x: number, z: number, hx: number, hz: number, height: number, y: number, lod: Lod): void {
  const along = hx > hz ? "x" : "z";
  const len = along === "x" ? hx * 2 : hz * 2;
  const seg = lod ? Math.max(1, Math.round(len / 3.5)) : 1;
  // drawn from a hand below the ground (it is the ground, banked up), its foot `base` wide either side of the line
  const w = B.base * 2, under = 0.05;
  const g = along === "x" ? new BoxGeometry(len, height + under, w, seg, 1, 1) : new BoxGeometry(w, height + under, len, 1, 1, seg);
  const pa = g.attributes.position as BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    if (pa.getY(i) <= 0) continue;
    if (along === "x") pa.setZ(i, Math.sign(pa.getZ(i)) * B.top);
    else pa.setX(i, Math.sign(pa.getX(i)) * B.top);
  }
  const lx = along === "x" ? 0 : 1, lz = 1 - lx;
  k.add(g, {
    at: [x, y + (height - under) / 2, z],
    colour: (q, n, out) => {
      const foot = q.y < -(height + under) / 2 + 0.07;
      if (n.y > 0.6) return void blend(out, P.mudPale, P.siltPale, h01(630, q.x * lz + q.z * lx, x, z) * 0.6);
      if (foot) return void blend(out, P.saltShade, P.mudPale, 0.3);
      blend(out, P.mud, P.mudPale, 0.25 + h01(631, q.x * lz + q.z * lx, x + z) * 0.35);
    },
    perFace: true,
    jitter: lod ? 0.018 : 0,
    seed: 632,
  });
}

/** A windrow: the raked salt in a low lumpy ridge along x. */
function windrow(k: Kit, x: number, z: number, hx: number, hz: number, h: number, y: number, lod: Lod, i: number): void {
  // a ridge: a rounded top a third of its foot, lumped every half metre or so (where the rake stopped), the ends tapered down into the crust
  const seg = lod ? Math.max(3, Math.round(hx * 2.2)) : 2;
  const g = new BoxGeometry(hx * 2, h + 0.03, hz * 2, seg, 2, 1);
  const pa = g.attributes.position as BufferAttribute;
  for (let v = 0; v < pa.count; v++) {
    const vy = pa.getY(v), vx = pa.getX(v);
    const up = (vy + (h + 0.03) / 2) / (h + 0.03);   // 0 at the foot, 1 at the top
    pa.setZ(v, Math.sign(pa.getZ(v)) * hz * (1 - 0.68 * up));
    const end = 1 - smoothstep(hx - 0.7, hx, Math.abs(vx));
    if (up > 0.01) pa.setY(v, -(h + 0.03) / 2 + (vy + (h + 0.03) / 2) * (0.35 + 0.65 * end) * (0.85 + 0.3 * h01(642 + i, vx * 1.7)));
  }
  k.add(g, { at: [x, y + (h - 0.03) / 2, z], colour: (q, n, out) => blend(out, P.salt, P.saltShade, n.y > 0.5 ? h01(640 + i, q.x * 2) * 0.35 : 0.5), perFace: true, jitter: lod ? 0.03 : 0, seed: 641 + i });
}

/** A heap: a lumpy cone of salt, greyer at its foot where the yard's mud has got into it; a reed-thatch cap roped down on some; the buying House's pennant on a stick at the top. */
function heap(k: Kit, h: SaltHeap, y: number, lod: Lod, i: number): void {
  const radial = lod ? 14 : 9;
  const cone = new ConeGeometry(h.r, h.height + 0.1, radial, lod ? 3 : 2, true);
  k.add(cone, {
    at: [h.x, y + (h.height + 0.1) / 2 - 0.1, h.z],
    colour: (q, _n, out) => {
      const t = (q.y + (h.height + 0.1) / 2) / (h.height + 0.1);   // 0 at the foot, 1 at the top
      blend(out, P.siltPale, P.saltShade, Math.min(1, t * 4));
      if (t > 0.25) blend(out, P.saltShade, P.salt, Math.min(1, (t - 0.25) * 2.2) * (0.75 + h01(650 + i, q.x * 3, q.z * 3) * 0.25));
    },
    flat: true,
    jitter: lod ? 0.07 : 0,
    seed: 651 + i,
  });
  const top = y + h.height;
  if (h.capped) {
    // the cap: a thatch cone over the top two-thirds, a hand proud of the salt, and two ropes over it pegged into the heap's flank
    const capH = h.height * 0.66, capR = h.r * (capH / h.height) + 0.08;
    k.add(new ConeGeometry(capR, capH + 0.06, lod ? 12 : 8, 1, true), { at: [h.x, top - capH / 2 + 0.03, h.z], colour: (q, n, out) => blend(out, P.thatchDark, P.thatch, 0.4 + Math.max(0, n.y) * 0.3 + h01(660 + i, q.x * 4, q.z * 4) * 0.3), flat: true, jitter: lod ? 0.04 : 0, seed: 661 + i });
    for (const a of [0.4, 0.4 + Math.PI / 2]) for (const s of [-1, 1]) {
      // from the apex down the cap's flank to just below its eave, sunk a little into the thatch
      const ex = Math.cos(a) * s, ez = Math.sin(a) * s;
      const rr = capR - 0.02, yy = top - capH + 0.02;
      k.limb([h.x, top + 0.06, h.z], [h.x + ex * rr, yy, h.z + ez * rr], 0.018, 0.018, P.rope, 3);
    }
  }
  // the pennant: a stick in the top, a flag in the buying House's colour (its edge in the stick)
  const stick = top + (h.capped ? 0.06 : 0) - 0.3;
  k.limb([h.x, stick, h.z], [h.x, stick + 1.5, h.z], 0.025, 0.02, P.tarPlankDark, 4);
  box(k, [0.5, 0.3, 0.02], [h.x + 0.25 + 0.012, stick + 1.32, h.z], HOUSE[h.house]!);
}

/** A sluice: two posts in the bund, a plank gate between them standing a hand above the clay, and the iron handle that lifts it. `along`: the bund runs along x. */
function sluice(k: Kit, x: number, z: number, y: number): void {
  const half = B.base + 0.06;
  k.setBase(x, y, z, Math.PI / 2);   // (local x across the bund)
  for (const s of [-1, 1]) k.limb([-half + 0.2, -0.3, s * 0.45], [-half + 0.2, 0.62, s * 0.45], 0.06, 0.05, P.tarPlankDark, 4);
  box(k, [0.1, 0.5, 0.86], [-half + 0.2, 0.2, 0], P.tarPlank);
  k.limb([-half + 0.2, 0.45, 0], [-half + 0.2, 0.72, 0], 0.02, 0.02, P.iron, 3);
  k.limb([-half + 0.2, 0.72, -0.16], [-half + 0.2, 0.72, 0.16], 0.02, 0.02, P.iron, 3);
  k.clearBase();
}

/** A wheelbarrow: a tapered tray on one wheel, two legs and two handles. Yaw: its local +x points ahead (the wheel). */
function barrow(k: Kit, x: number, z: number, yaw: number, y: number, lod: Lod): void {
  k.setBase(x, y, z, yaw);
  const tray = new BoxGeometry(1.0, 0.36, 0.62);
  const pa = tray.attributes.position as BufferAttribute;
  for (let v = 0; v < pa.count; v++) if (pa.getY(v) < 0) { pa.setX(v, pa.getX(v) * 0.72); pa.setZ(v, pa.getZ(v) * 0.75); }
  k.add(tray, { at: [0.05, 0.5, 0], colour: (q, n, out) => blend(out, P.tarPlank, P.tarPlankLight, n.y > 0.5 ? 0.7 : 0.2 + h01(670, q.x * 4) * 0.3), flat: true, perFace: true });
  box(k, [0.66, 0.06, 0.4], [0.05, 0.66, 0], P.salt);   // (a load of salt, heaped level with the rim)
  k.add(new CylinderGeometry(0.22, 0.22, 0.08, lod ? 10 : 7), { at: [0.62, 0.22, 0], rot: [Math.PI / 2, 0, 0], colour: P.tarPlankDark, flat: true });
  for (const s of [-1, 1]) {
    k.limb([0.62, 0.22, s * 0.06], [-0.3, 0.42, s * 0.24], 0.025, 0.025, P.tarPlankDark, 4);   // the frame from the axle back under the tray
    k.limb([-0.3, 0.42, s * 0.24], [-0.85, 0.66, s * 0.26], 0.025, 0.022, P.tarPlankDark, 4);  // and on as a handle
    k.limb([-0.2, 0.42, s * 0.24], [-0.24, -0.02, s * 0.26], 0.025, 0.025, P.tarPlankDark, 4); // a leg
  }
  k.clearBase();
}

/** A long-handled salt rake left leaning on a heap: its head on the ground a stride from the heap's foot, its handle lying on the salt. */
function rake(k: Kit, h: SaltHeap, yaw: number, y: number): void {
  const cx = Math.cos(yaw), cz = Math.sin(yaw);
  const foot = h.r + 0.6, rest = h.r * 0.4;
  const restY = h.height * (1 - rest / h.r) + 0.03;
  const a: V3 = [h.x + cx * foot, y + 0.09, h.z + cz * foot];
  const b: V3 = [h.x + cx * (rest + 0.03), y + restY, h.z + cz * (rest + 0.03)];
  k.limb(a, b, 0.022, 0.02, P.tarPlankLight, 4);
  // the head: a board across the handle's foot, on its edge in the salt-mud
  k.setBase(a[0], y, a[2], yaw);
  box(k, [0.05, 0.12, 0.6], [0, 0.06, 0], P.tarPlank);
  k.clearBase();
}

/** A pan's lot stake: a stick at the pan's north-west corner with a small board in the buying House's colour. */
function lotStake(k: Kit, p: SaltPan, y: number): void {
  const x = p.x0 + 0.45, z = p.z0 + 0.45;
  k.limb([x, y - 0.25, z], [x, y + 0.95, z], 0.025, 0.022, P.tarPlankDark, 4);
  box(k, [0.3, 0.2, 0.02], [x, y + 0.8, z + 0.035], HOUSE[p.house]!);
}

/**
 * The pump's suction pipe: up from the pump's barrel at the foot of its tower to a head-clear height, east across the towpath and over the revetment (resting on a block on its cap),
 * then down into the Long Cut. The revetment wanders with the seed, so the pipe finds it in the collision world along its own line.
 */
function pipe(k: Kit, world: CollisionWorld, y: number): void {
  const pump = saltworksPlan().pump;
  const z = pump.z;
  let rimIn = NaN, rimOut = NaN;
  for (let x = pump.x + 1; x < pump.x + 16; x += 0.05) {
    let hit = false;
    for (const o of world.obstacles) if (o.tag === "fence" && insideFootprint(o, x, z, 0)) { hit = true; break; }
    if (hit && Number.isNaN(rimIn)) rimIn = x;
    if (!hit && !Number.isNaN(rimIn)) { rimOut = x; break; }
  }
  if (Number.isNaN(rimOut)) return;
  const R = SALTWORKS_PIPE.r, top = y + SALTWORKS_PIPE.y;
  const x0 = pump.x, x1 = rimOut + 0.9;
  // the pump's barrel at the tower's foot, and the spout that pours into the reservoir's corner
  box(k, [0.46, 0.8, 0.46], [x0, y + 0.4, z], P.iron);
  const sx = x0 - 0.9, sz = z + 0.9;
  k.limb([x0 - 0.2, y + 0.62, z + 0.2], [sx, y + 0.6, sz], 0.07, 0.07, P.iron, 5);
  k.limb([sx, y + 0.6, sz], [sx, y + SHEET - 0.01, sz], 0.035, 0.05, P.siltWaterPale, 5);   // (the brine falling from it)
  // up, across, over the cap, down
  k.limb([x0, y + 0.78, z], [x0, top, z], R, R, P.iron, 6);
  k.limb([x0, top, z], [x1, top, z], R, R, P.iron, 6);
  k.limb([x1, top, z], [x1, SALTMARKET.waterY - 0.5, z], R, R, P.iron, 6);
  const capY = SALTMARKET.level + SALTMARKET.rimHeight;
  box(k, [0.3, top - R - capY + 0.02, 0.3], [(rimIn + rimOut) / 2, (top - R + capY) / 2, z], P.tarPlankDark);
}

/** D-123: the thatch's thickness, and how far the roof overhangs the walls (front and back) and the gable ends. */
const THATCH = 0.2, EAVE = 0.3, VERGE = 0.3;   // (EAVE under a body's radius: a player or a Brinefolk at the wall stands clear of it)
/** Reed matting: upright bundles in two tones (the gable ends, and the hut's top hand above the daub). `along`: the local axis the wall runs along. */
const reeds = (along: "x" | "z"): ColourFn => (q, _n, out) => {
  blend(out, P.reed, P.reedDark, (Math.floor((along === "x" ? q.x : q.z) * 3.4 + 40) & 1) * 0.55);
};
/** The walls: reed mat daubed with the pans' own pale clay to `daub` (the bundles' ridges still show through), the foot splashed dark, the mat bare above the daub line. */
const daubed = (along: "x" | "z", foot: number, daub: number, seed: number): ColourFn => (q, n, out) => {
  const a = along === "x" ? q.x : q.z;
  if (q.y > daub + h01(seed, a * 1.6) * 0.12) return reeds(along)(q, n, out);
  blend(out, P.mudPale, P.siltPale, 0.25 + h01(seed + 1, a * 2.2, q.y * 3) * 0.45);
  if (Math.floor(a * 3.4 + 40) & 1) blend(out, out.getHex(), P.mud, 0.12);
  if (q.y < foot) blend(out, out.getHex(), P.mud, 0.6);
};

/**
 * D-123: a Brinefolk hut. In its own frame (the collider's: local +x out of the front, to the yard; local z along it): a clay sill; walls `h.wall` high of reed mat daubed with
 * the pans' clay (bare under the eaves) and reed gable ends; a thick thatched roof on a ridge along z whose ridge roll tops out at exactly `h.height` (the collider's top: nothing
 * drawn above it, and the skyline test holds); corner posts; the low plank door at the back (the folk's: `step:hut*` is outside it) with its doorstep; a shuttered window in the
 * front wall (a lit pane at night) and the hut's lot board above it; and a rake left leaning on the east gable. The elder's leaning place (`lean:hut*`, the front's west half) is bare.
 */
function hut(k: Kit, h: SaltHut, y: number, lod: Lod, i: number, panes: LitPane[] | undefined): void {
  const hx = h.hx, hz = h.hz, wall = h.wall, sill = 0.12;
  k.setBase(h.x, y, h.z, h.yaw);
  box(k, [hx * 2 + 0.16, sill * 2, hz * 2 + 0.16], [0, 0, 0], (q, n, out) => blend(out, P.mud, P.mudPale, n.y > 0.5 ? 0.6 : 0.2 + h01(700 + i, q.x * 3, q.z * 3) * 0.3));
  // the walls: a box of reed mat on the sill (its long faces run along z, its ends along x), the gable ends' triangles over the end walls
  const wallH = wall - sill;
  k.add(new BoxGeometry(hx * 2, wallH, hz * 2), { at: [0, sill + wallH / 2, 0], colour: (q, n, out) => daubed(Math.abs(n.x) > 0.5 ? "z" : "x", -wallH / 2 + 0.16, wallH / 2 - 0.3, 720 + i)(q, n, out), flat: true, perFace: true });
  // the roof's pitch: the thatch's underside from the wall head (x = +-hx at `wall`) up to the ridge line, so its ridge roll's top is the collider's
  const roll = 0.1, ridgeUnder = h.height - roll * 2 - 0.055;
  const rise = ridgeUnder - wall, th = Math.atan2(rise, hx);
  const gableGeo = new BufferGeometry();
  const tri: number[] = [];
  for (const s of [-1, 1]) {
    // (each end's triangle wound to face out of its end)
    const zz = s * (hz + 0.004);
    const a = [-hx, wall, zz], b = [hx, wall, zz], c = [0, ridgeUnder, zz];
    tri.push(...(s > 0 ? [...a, ...b, ...c] : [...b, ...a, ...c]));
  }
  gableGeo.setAttribute("position", new BufferAttribute(new Float32Array(tri), 3));
  gableGeo.computeVertexNormals();
  k.add(gableGeo, { at: [0, 0, 0], colour: reeds("x"), flat: true, perFace: true });
  // two thick slabs of thatch, front and back, from the eave (overhanging the walls by EAVE) to the ridge, the verges past the gables by VERGE
  const len = (hx + EAVE) / Math.cos(th);
  for (const s of [-1, 1]) {
    // the underside's middle, then out along the slope's normal by half the thatch
    const ux = s * (hx + EAVE) / 2, uy = ridgeUnder - (rise / hx) * (hx + EAVE) / 2;
    const nx = s * Math.sin(th), ny = Math.cos(th);
    k.add(new BoxGeometry(len, THATCH, hz * 2 + VERGE * 2, lod ? 3 : 1, 1, lod ? 2 : 1), {
      at: [ux + nx * THATCH / 2, uy + ny * THATCH / 2, 0], rot: [0, 0, -s * th],
      colour: (q, n, out) => blend(out, P.thatchDark, P.thatch, (n.y > 0.5 ? 0.45 : 0.1) + h01(710 + i, q.x * 2.5, q.z * 2.5, s) * 0.4),
      flat: true, perFace: true, jitter: lod ? 0.025 : 0, seed: 711 + i * 2 + (s > 0 ? 1 : 0),
    });
  }
  // the ridge roll along the top, bound with two withies (whose tops are the hut's height)
  const withy = 0.015, rollY = h.height - roll - withy;
  k.add(new CylinderGeometry(roll, roll, hz * 2 + VERGE * 2 + 0.06, lod ? 6 : 4), { at: [0, rollY, 0], rot: [Math.PI / 2, 0, 0], colour: P.thatchDark, flat: true });
  if (lod) for (const z of [-hz * 0.55, hz * 0.55]) k.add(new CylinderGeometry(roll + withy, roll + withy, 0.06, 6), { at: [0, rollY, z], rot: [Math.PI / 2, 0, 0], colour: P.reedDark, flat: true });
  // corner posts, a hand proud of the mat, from below the sill to the wall head
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.limb([sx * (hx - 0.02), -0.2, sz * (hz - 0.02)], [sx * (hx - 0.02), wall - 0.02, sz * (hz - 0.02)], 0.065, 0.06, P.tarPlankDark, 4);
  // the back door: a low plank leaf in a frame, a doorstep before it
  const doorH = 1.42, doorW = 0.72, back = -hx;
  box(k, [0.06, doorH, doorW], [back - 0.03, sill + doorH / 2, 0], (q, _n, out) => blend(out, P.tarPlank, P.tarPlankDark, (Math.floor(q.z * 9 + 40) & 1) * 0.5));
  box(k, [0.1, 0.08, doorW + 0.26], [back - 0.05, sill + doorH + 0.04, 0], P.tarPlankDark);   // (under the eave's thatch)
  for (const s of [-1, 1]) box(k, [0.1, doorH, 0.08], [back - 0.05, sill + doorH / 2, s * (doorW / 2 + 0.05)], P.tarPlankDark);
  box(k, [0.36, 0.1, doorW + 0.2], [back - 0.26, 0.02, 0], P.tarPlankLight);
  if (!lod) return void k.clearBase();
  // the front: a shuttered window east of the middle (its leaves swung back flat on the mat), the pane in it, a sill board, the lot board above
  const wz = hz * 0.42, wy = sill + wallH * 0.56, front = hx;
  box(k, [0.08, 0.58, 0.64], [front + 0.04, wy, wz], P.tarPlankDark);
  for (const s of [-1, 1]) box(k, [0.04, 0.54, 0.3], [front + 0.02, wy, wz + s * 0.49], P.tarPlank);
  box(k, [0.16, 0.05, 0.78], [front + 0.08, wy - 0.31, wz], P.tarPlankLight);
  box(k, [0.03, 0.16, 0.46], [front + 0.015, wall - 0.14, wz], HOUSE[i % HOUSE.length]!);
  if (panes) {
    const a = k.worldPoint(front + 0.08 + 0.012, wy, wz), b = k.worldPoint(front + 1.08 + 0.012, wy, wz);
    const nx = b[0] - a[0], nz = b[2] - a[2], l = Math.hypot(nx, nz) || 1;
    panes.push({ x: a[0], y: a[1], z: a[2], nx: nx / l, nz: nz / l, w: 0.5, h: 0.46, lit: hash3(0x5a17, Math.round(a[0] * 10), Math.round(a[2] * 10)) / 4294967296 < LIT_SHARE });
  }
  // a rake left on the east gable: its head on the clay, its handle against the wall under the verge
  k.limb([0.55, 0.06, hz + 0.42], [0.15, wall - 0.12, hz + 0.025], 0.022, 0.02, P.tarPlankLight, 4);
  box(k, [0.6, 0.12, 0.05], [0.55, 0.06, hz + 0.44], P.tarPlank);
  k.clearBase();
}

/** Everything of the works, each piece into the kit of its quarter of the map. The pump's tower is the caller's (a hair). */
export function buildSaltworks(kitAt: (x: number, z: number) => Kit, world: CollisionWorld, lod: Lod, panes?: LitPane[]): void {
  const plan = saltworksPlan();
  const g = (x: number, z: number): number => world.terrainHeight(x, z);
  plan.pans.forEach((p, i) => {
    const k = kitAt((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2);
    panFloor(k, p, g((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2), i);
    lotStake(k, p, g(p.x0, p.z0));
  });
  for (const b of plan.bunds) bund(kitAt(b.x, b.z), b.x, b.z, b.hx, b.hz, b.height, g(b.x, b.z), lod);
  plan.rows.forEach((w, i) => windrow(kitAt(w.x, w.z), w.x, w.z, w.hx, w.hz, w.height, g(w.x, w.z), lod, i));
  plan.heaps.forEach((h, i) => heap(kitAt(h.x, h.z), h, g(h.x, h.z), lod, i));
  for (const s of plan.sluices) sluice(kitAt(s.x, s.z), s.x, s.z, g(s.x, s.z));
  for (const b of plan.barrows) barrow(kitAt(b.x, b.z), b.x, b.z, b.yaw, g(b.x, b.z), lod);
  for (const r of plan.rakes) {
    const h = plan.heaps[r.heap]!;
    rake(kitAt(h.x, h.z), h, r.yaw, g(h.x, h.z));
  }
  pipe(kitAt(plan.pump.x, plan.pump.z), world, g(plan.pump.x, plan.pump.z));
  plan.huts.forEach((h, i) => hut(kitAt(h.x, h.z), h, g(h.x, h.z), lod, i, panes));
}
