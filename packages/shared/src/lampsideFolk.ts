import type { CollisionWorld } from "./collision.ts";
import { lampsidePlan, stallKeeper, type LampsideHouse, type LampsideStall } from "./lampside.ts";
import { relicPlan } from "./relicWorks.ts";
import { buildFolkFrom, type Appt, type CastDef, type Folk, type FolkSpec, type Meeting } from "./villagers.ts";
import { buildNavFrom, setFolkWater, type Nav, type NavTrail, type StationDef } from "./villagerNav.ts";

/**
 * LAMPSIDE'S PEOPLE (D-120): the Kessarine who live in the Ward's lower town under Kessar's fort (D-119). The same pure schedule as Hollowmere's folk (`villagerAt`:
 * every client computes the same people in the same places from the world clock; nothing simulated, nothing sent, nobody hit), on Lampside's own walking network and
 * stations: the street, the lanes between the houses and the alleys behind them, the garden paths; a back door to every house (the street doors are sealed to the Society,
 * in writing; the town comes and goes by its gardens), the stallkeepers behind their counters, the well, the nine lamps, the plots.
 *
 * Ten people: the Lamp-Trimmer who lives behind "GONE TO TRIM THE LAMPS. BACK AT DUSK" and does exactly that, at dusk and at first light; the brass-seller and the jar-seller
 * at the stalls; the water-carrier between the well and the back doors; a barley-keeper and a date-grower in the gardens; the Clerk of Chits at the street's end (the
 * notice on his house wants one); an elder; and two children. A Kessarine is named for their household's lamp ("Ossery of the Third Lamp"), never for anything real.
 */

/** D-130: what the Relic Works' people's speech slips are headed with (the town's say LAMPSIDE). */
export const RELIC_PLACE = "THE RELIC WORKS";

/** Character facing that looks along (dx, dz) (0 = -Z), as villagerNav's. */
const face = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** A point in a house's or a stall's own frame (collision convention: local +x out of its front, local z along it). */
function at(b: { x: number; z: number; yaw: number }, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + c * lx - s * lz, z: b.z + s * lx + c * lz };
}

/** The town's footpaths (each line's vertices are x, z pairs): the street, the lanes between the houses into the west garden, the alleys behind the houses, the lane into the date grove, the garden paths. */
export const LAMPSIDE_TRAILS: readonly NavTrail[] = [
  { width: 6, line: [0, -2.5, 0, -6, 0, -10, 0, -14, 0, -18, 0, -22, 0, -26, 0, -28] },
  { width: 2.4, line: [-4.6, -11.7, -8, -11.7, -12, -11.7, -14.9, -11.7, -17.5, -11.7, -21, -11.7, -25, -11.7, -28, -11.7] },
  { width: 2.4, line: [-4.6, -20.6, -8, -20.6, -12, -20.6, -14.9, -20.6, -17.5, -20.6, -21, -20.6, -25, -20.6, -28, -20.6] },
  { width: 2.4, line: [-28, -6.8, -28, -11.7, -28, -16.5, -28, -20.6, -28, -25] },
  // (the alleys behind the houses are cut where the lanes cross them: a trail joins the others at its ends)
  { width: 2.2, line: [-14.9, -5, -14.9, -11.7] },
  { width: 2.2, line: [-14.9, -11.7, -14.9, -16.2, -14.9, -20.6] },
  { width: 2.2, line: [-14.9, -20.6, -14.9, -26.2] },
  { width: 2.2, line: [4.6, -10.9, 8, -10.9, 12, -10.9, 14.9, -10.9, 17.5, -10.9, 20, -11.4, 23.8, -11.4, 23.8, -7.5] },
  { width: 2.2, line: [14.9, -5, 14.9, -10.9] },
  { width: 2.2, line: [14.9, -10.9, 14.9, -15.4, 14.9, -19] },
  { width: 1.8, line: [23.8, -11.4, 23.8, -17, 27.5, -17] },
];

/** Open ground over the street and the square (people cross it, not only the paths). */
export const LAMPSIDE_GRID = { x0: -5, x1: 16, z0: -28, z1: -3, step: 2 } as const;

/** Which side of each stall its keeper comes in by (local z sign: the side toward the alley or the street). */
const STALL_SIDE: Readonly<Record<string, number>> = { "stall.e": -1, "stall.n": 1 };

/** The order the Lamp-Trimmer lights the nine lamps at dusk (and puts them out, the other way round, at first light): up the street, then the stalls. */
const LAMP_ORDER = ["post:0", "post:1", "w1", "e1", "w2", "e2", "w3", "stall.e", "stall.n"] as const;

/** Every station of the town, from the plan (ideals: `buildNavFrom` nudges each to free ground and drops what cannot be reached). */
export function lampsideStations(): StationDef[] {
  const plan = lampsidePlan();
  const out: StationDef[] = [];
  const add = (d: StationDef): void => void out.push(d);
  const lamps = new Map<string, StationDef>();
  const houseLamp = (h: LampsideHouse): StationDef => {
    // (the lamp hangs 1.25 m along the street face from the door and 0.44 m out: the trimmer stands under it, a step further out, facing the wall)
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    return { key: "", x: h.x + c * (h.hx + 1.25) + s * -1.25, z: h.z + s * (h.hx + 1.25) - c * -1.25, facing: face(-c, -s), reach: 4 };
  };
  for (const h of plan.houses) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    // home: the back step in the alley, and just inside the back door (out of sight)
    const step = at(h, -(h.hx + 0.95), 0);
    add({ key: `step:${h.id}`, x: step.x, z: step.z, facing: face(-c, -s), reach: 4 });
    const door = at(h, -(h.hx + 0.3), 0);
    add({ key: `in:${h.id}`, x: door.x, z: door.z, facing: face(c, s), hidden: true, sheltered: true, parent: `step:${h.id}` });
    // against the street face beside the door (on the side away from its lamp), looking at the street; under the awning, where there is one
    const lean = at(h, h.hx + 0.35, -1.6);
    add({ key: `lean:${h.id}`, x: lean.x, z: lean.z, facing: face(c, s), reach: 4 });
    if (h.awning) {
      const a = at(h, h.hx + 0.6, 0);
      add({ key: `awning:${h.id}`, x: a.x, z: a.z, facing: face(c, s), sheltered: true, reach: 4 });
    }
    lamps.set(h.id, houseLamp(h));
  }
  for (const st of plan.stalls) {
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    const k = stallKeeper(st);
    const side = STALL_SIDE[st.id] ?? 1;
    const keep = at(st, k, 0);
    const way = at(st, k, side * (st.hz + 0.7));
    add({ key: `stall:${stallKey(st)}`, x: keep.x, z: keep.z, facing: face(c, s), sheltered: true, via: [[way.x, way.z]], reach: 6 });
    const front = at(st, st.hx + 0.95, 0);
    add({ key: `front:${stallKey(st)}`, x: front.x, z: front.z, facing: face(-c, -s), reach: 5 });
    // its lamp hangs at the front corner (local z -1.23 in the collision frame): the trimmer stands before it
    const lamp = at(st, st.hx + 1.0, -1.23);
    lamps.set(st.id, { key: "", x: lamp.x, z: lamp.z, facing: face(-c, -s), reach: 5 });
  }
  plan.posts.forEach((p, i) => {
    // (each post's bracket reaches over the street: stand under the lamp's far side, facing the post)
    const dir = p.x < 0 ? 1 : -1;
    lamps.set(`post:${i}`, { key: "", x: p.x + dir * 0.9, z: p.z, facing: face(-dir, 0), reach: 4 });
  });
  LAMP_ORDER.forEach((id, i) => add({ ...lamps.get(id)!, key: `lamp:${i}` }));
  // the well: one each side
  const w = plan.well;
  add({ key: "well", x: w.x - (w.r + 0.5), z: w.z, facing: face(1, 0), reach: 5 });
  add({ key: "well:b", x: w.x + (w.r + 0.5), z: w.z, facing: face(-1, 0), reach: 5 });
  // the gardens: a place in each plot
  add({ key: "garden:w:a", x: -31.5, z: -13.5, facing: face(-1, 0), reach: 5 });
  add({ key: "garden:w:b", x: -24.5, z: -18, facing: face(1, 0), reach: 5 });
  add({ key: "garden:e:a", x: 23.8, z: -15.6, facing: face(0, -1), reach: 5 });
  add({ key: "garden:e:b", x: 29, z: -11.4, facing: face(1, 0), reach: 7 });
  // the Clerk of Chits' place at the street's end, facing whoever comes up from the bar
  add({ key: "chits", x: 5.4, z: -4.9, facing: face(0, 1), reach: 4 });
  // where children play: the square's corner by the street, and the street itself
  add({ key: "play:sq", x: 7, z: -24.6, facing: face(1, 0), reach: 5 });
  add({ key: "play:st", x: -1.6, z: -17.5, facing: face(0, 1), reach: 4 });
  // conversation spots: pairs a metre apart facing each other
  for (const [i, c] of ([[-2.2, -12.4, 0.2], [8, -21.2, 0.6], [2.2, -21.8, 1.3], [-28, -14, 1.57], [2.4, -6, 0.3]] as const).entries()) {
    const [cx, cz, a] = c;
    const ux = Math.cos(a) * 0.55;
    const uz = Math.sin(a) * 0.55;
    add({ key: `chat:${i}:a`, x: cx - ux, z: cz - uz, facing: face(ux, uz), reach: 5 });
    add({ key: `chat:${i}:b`, x: cx + ux, z: cz + uz, facing: face(-ux, -uz), reach: 5 });
  }
  return out;
}

const stallKey = (s: LampsideStall): string => s.id.replace("stall.", "");

/**
 * D-130: the Relic Works' own paths on the west beach (D-129), an island of the network that never meets the town's (the river is between): along the works' front, round
 * its north side (between it and the kiln) and its south (past the drying shelf), down the lane behind it, through the ageing yard's gate and along its lanes between the
 * beds, and out along the beach to the stall by the road.
 */
export const RELIC_TRAILS: readonly NavTrail[] = (() => {
  const p = relicPlan();
  const front = p.works.x + p.works.hx + 1.8;   // (1.8 m off the works' face: the lean and the awning stand between)
  const back = (p.works.x - p.works.hx + p.yard.x1) / 2;   // (the middle of the lane between the works' back and the yard's wall)
  const north = p.works.z - p.works.hz - 1.15;   // (between the works and the kiln)
  const south = p.shelf.z + p.shelf.hz + 1.68;   // (past the drying shelf)
  const lane = p.yard.x1 - 1.35;   // (the yard's east lane, between the near bed and the wall)
  const mid = (p.beds[0]!.x + p.beds[1]!.x) / 2;   // (between the beds)
  const end = p.beds[1]!.z - p.beds[1]!.hz - 0.78;   // (across the beds' north ends)
  const gate = p.yard.gates[0]!;
  return [
    { width: 2, line: [front, north, front, p.works.z, front, south] },
    { width: 1.8, line: [front - 1.6, north, p.works.x, north, back + 1.1, north] },
    { width: 1.8, line: [front - 1.6, south, p.works.x, south, back + 1.1, south] },
    { width: 2.4, line: [back, north + 0.35, back, gate.z, back, south - 0.2] },
    { width: 2, line: [front + 1.6, p.works.z - 0.2, front + 4.4, p.works.z - 0.5, p.stall.x - 1.8, p.stall.z + 2.7] },
    { width: 1.5, line: [back - 1.1, gate.z, lane, gate.z, lane, end, mid, end, mid, gate.z + 0.3] },
    { width: 1.5, line: [lane, p.yard.z1 - 1.1, lane, gate.z + 1.2] },
  ];
})();

/** The Relic Works' stations: the works' back door and front, its awning (three under it), the kiln (the keeper's place and the potter's), the shelf, the beds, the yard's gate, the stall and its front, the watch on the landing, the child's places and two conversation spots. */
export function relicStations(): StationDef[] {
  const p = relicPlan();
  const h = p.works;
  const out: StationDef[] = [];
  const add = (d: StationDef): void => void out.push(d);
  const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
  const step = at(h, -(h.hx + 0.95), 0);
  add({ key: "step:works", x: step.x, z: step.z, facing: face(-c, -s), reach: 4 });
  const door = at(h, -(h.hx + 0.3), 0);
  add({ key: "in:works", x: door.x, z: door.z, facing: face(c, s), hidden: true, sheltered: true, parent: "step:works" });
  const lean = at(h, h.hx + 0.35, -1.6);
  add({ key: "lean:works", x: lean.x, z: lean.z, facing: face(c, s), reach: 4 });
  for (const [k, lz] of [["a", -0.6], ["b", 0.15], ["c", 0.9]] as const) {
    const a = at(h, h.hx + 0.6, lz);
    add({ key: `awning:works:${k}`, x: a.x, z: a.z, facing: face(c, s), sheltered: true, reach: 4 });
  }
  const k = p.kiln;
  add({ key: "kiln", x: k.x + k.half + 0.9, z: k.z, facing: face(-1, 0), reach: 5 });
  add({ key: "kiln:b", x: k.x + k.half + 0.7, z: k.z + k.half + 0.6, facing: face(-1, -0.8), reach: 5 });
  const sh = p.shelf;
  add({ key: "shelf", x: sh.x, z: sh.z + sh.hz + 0.78, facing: face(0, -1), reach: 4 });
  const lane = p.yard.x1 - 1.25;
  const near = p.beds[1]!, far = p.beds[0]!;
  add({ key: "bed:e", x: lane, z: near.z - 2.5, facing: face(-1, 0), reach: 4 });
  add({ key: "bed:s", x: lane, z: near.z + 2.8, facing: face(-1, 0), reach: 4 });
  add({ key: "bed:m", x: (near.x + far.x) / 2 - 0.1, z: near.z - 1.3, facing: face(1, 0), reach: 4 });
  const g = p.yard.gates[0]!;
  add({ key: "yardgate", x: g.x + 1.6, z: g.z + 1.1, facing: face(-1, 0), reach: 4 });
  const st = p.stall;
  const sc = Math.cos(st.yaw), ss = Math.sin(st.yaw);
  const keep = at(st, stallKeeper(st), 0);
  const way = at(st, stallKeeper(st), st.hz + 0.7);
  add({ key: "stall:relic", x: keep.x, z: keep.z, facing: face(sc, ss), sheltered: true, via: [[way.x, way.z]], reach: 6 });
  const front = at(st, st.hx + 0.95, 0);
  const round = at(st, st.hx + 0.95, st.hz + 0.7);   // (round the stall's south end from the beach path: the straight line clips its corner)
  add({ key: "front:relic", x: front.x, z: front.z, facing: face(-sc, -ss), via: [[round.x, round.z]], reach: 5 });
  // the guide's watch on the landing, behind the stall's board, turned to the boat
  add({ key: "watch:relic", x: st.x - 1, z: st.z + 5.7, facing: face(12, 4.8), reach: 4 });
  add({ key: "play:shore", x: h.x, z: sh.z + sh.hz + 3.4, facing: face(0, 1), reach: 4 });
  add({ key: "play:lane", x: (h.x - h.hx + p.yard.x1) / 2, z: h.z + 4.3, facing: face(0, -1), reach: 4 });
  // conversation spots: before the works' front, and on the beach south of the lane's end
  for (const [i, cx, cz, a] of [[5, h.x + h.hx + 3.2, h.z + 2.5, Math.PI / 2], [6, (h.x - h.hx + p.yard.x1) / 2, sh.z + sh.hz + 3.1, 0]] as const) {
    const ux = Math.cos(a) * 0.55;
    const uz = Math.sin(a) * 0.55;
    add({ key: `chat:${i}:a`, x: cx - ux, z: cz - uz, facing: face(ux, uz), reach: 5 });
    add({ key: `chat:${i}:b`, x: cx + ux, z: cz + uz, facing: face(-ux, -uz), reach: 5 });
  }
  return out;
}

/** Lampside's walking network in a Kessar world (its water is the river and the sea, not Hollowmere's stream: `setFolkWater`), and since D-130 the Relic Works' island. */
export function lampsideNav(world: CollisionWorld, why?: Map<string, string>): Nav {
  const t = world.terrain as { waterDepth?: (x: number, z: number) => number };
  setFolkWater(world, (x, z) => (t.waterDepth?.(x, z) ?? 0) > 0.02);
  return buildNavFrom(world, { trails: [...LAMPSIDE_TRAILS, ...RELIC_TRAILS], grid: LAMPSIDE_GRID, stations: [...lampsideStations(), ...relicStations()] }, why);
}

// ---- the cast ----------------------------------------------------------------------------------------------------------------------------------

/**
 * The Lamp-Trimmer's rounds, up the street from the bar to the stalls: the nine lamps put out at first light and lit at dusk, a fifth of an hour each (the farthest
 * two are seventeen metres apart: a walk and a trim), then home by the back door.
 */
function trimmerScript(script: Appt[]): Appt[] {
  const out = script.slice();
  const n = LAMP_ORDER.length;
  for (let i = 0; i < n; i++) out.push([5.7 + i * 0.22, `lamp:${i}`, "lamp", { carryIn: "lantern", carry: "lantern" }]);
  for (let i = 0; i < n; i++) out.push([18.0 + i * 0.22, `lamp:${i}`, "lamp", { carryIn: "lantern", carry: "lantern" }]);
  out.push([20.1, "step:w1", "idle"], [20.45, "in:w1", "sleep"]);
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * The whole cast in priority order (the low preset takes the first few). Hours are clock hours; the first entry is the morning at the back door, the last is bed.
 * Nobody's walk crosses dusk (20.6) or dawn (5.2), where the clock changes speed.
 */
const CAST: readonly CastDef[] = [
  { key: "trimmer", title: "Lamp-Trimmer", occupation: "lamplighter", age: "adult", home: "w1", lines: "kLamp", archetype: 1, script: [
    [5.4, "step:w1", "idle", { carry: "lantern" }], [7.9, "awning:w1|lean:w1", "lean"], [9.0, "front:n", "idle"], [9.6, "awning:w1|lean:w1", "lean"], [14.0, "well", "draw", { to: "step:w1", actTo: "idle", carryOut: "bucket" }], [16.4, "awning:w1|lean:w1", "lean"],
  ] },
  { key: "brass", title: "Brass-Seller", occupation: "seller", age: "adult", home: "e2", lines: "kSeller", archetype: 3, script: [
    [6.6, "step:e2", "idle"], [7.0, "stall:e", "sell", { carryIn: "crate" }], [12.2, "awning:e2|lean:e2", "lean"], [13.2, "stall:e", "sell"], [18.4, "step:e2", "idle"], [19.3, "in:e2", "sleep"],
  ] },
  { key: "jars", title: "Jar-Seller", occupation: "seller", age: "adult", home: "e1", lines: "kSeller", archetype: 0, script: [
    [6.8, "step:e1", "idle"], [7.3, "stall:n", "sell", { carryIn: "basket" }], [13.4, "stall:n", "sell"], [18.6, "step:e1", "idle"], [19.5, "in:e1", "sleep"],
  ] },
  { key: "gardenW", title: "Barley-Keeper", occupation: "gardener", age: "adult", home: "w2", lines: "kGarden", archetype: 4, script: [
    [6.0, "step:w2", "idle"], [6.4, "garden:w:a", "tend"], [9.8, "garden:w:b", "tend"], [13.0, "garden:w:a", "tend"], [16.8, "well", "draw", { to: "garden:w:b", actTo: "tend", carryOut: "bucket" }], [18.6, "step:w2", "idle"], [19.2, "in:w2", "sleep"],
  ] },
  { key: "water", title: "Water-Carrier", occupation: "laundress", age: "adult", home: "w3", lines: "kWater", archetype: 2, script: [
    [6.2, "step:w3", "idle"], [6.6, "well", "draw", { to: "step:w2", actTo: "idle", carryOut: "bucket" }], [9.0, "well:b", "draw", { to: "step:e1", actTo: "idle", carryOut: "bucket" }], [12.0, "lean:w3", "lean"], [13.0, "well", "draw", { to: "step:e2", actTo: "idle", carryOut: "bucket" }], [16.0, "well:b", "draw", { to: "step:w1", actTo: "idle", carryOut: "bucket" }], [18.8, "step:w3", "idle"], [19.4, "in:w3", "sleep"],
  ] },
  { key: "clerk", title: "Clerk of Chits", occupation: "registrar", age: "adult", home: "w2", lines: "kClerk", archetype: 5, script: [
    [7.0, "step:w2", "idle"], [7.6, "chits", "write", { carry: "book" }], [12.3, "lean:w2", "write", { carry: "book" }], [13.4, "chits", "write", { carry: "book" }], [17.0, "front:e", "idle"], [18.0, "step:w2", "idle"], [19.6, "in:w2", "sleep"],
  ] },
  { key: "gardenE", title: "Date-Grower", occupation: "gardener", age: "adult", home: "e1", lines: "kGarden", archetype: 4, script: [
    [6.2, "step:e1", "idle"], [6.7, "garden:e:a", "tend"], [10.2, "garden:e:b", "tend"], [13.2, "garden:e:a", "tend"], [16.5, "garden:e:b", "tend"], [18.4, "step:e1", "idle"], [19.0, "in:e1", "sleep"],
  ] },
  { key: "elder", title: "Lamp-Elder", occupation: "elder", age: "elder", home: "w3", lines: "kElder", archetype: 5, walk: 0.7, script: [
    [8.0, "step:w3", "idle"], [8.5, "lean:w3", "lean"], [12.4, "lean:w3", "lean"], [16.5, "lean:w3", "lean"], [19.0, "step:w3", "idle"], [19.5, "in:w3", "sleep"],
  ] },
  { key: "tamsel", title: "Tamsel", occupation: "child", age: "child", home: "e2", lines: "kChild", scale: 0.68, walk: 1.5, archetype: 3, script: [
    [7.8, "step:e2", "play"], [8.4, "play:sq", "play", { to: "play:st", actTo: "play" }], [12.4, "step:e2", "idle"], [13.4, "play:sq", "play", { to: "well:b", actTo: "play" }], [17.5, "step:e2", "play"], [19.2, "in:e2", "sleep"],
  ] },
  { key: "embry", title: "Embry", occupation: "child", age: "child", home: "w1", lines: "kChild", scale: 0.72, walk: 1.5, archetype: 2, script: [
    [8.0, "step:w1", "play"], [8.6, "play:st", "play", { to: "play:sq", actTo: "play" }], [12.5, "step:w1", "idle"], [13.5, "play:st", "play", { to: "chits", actTo: "play" }], [17.6, "step:w1", "play"], [19.4, "in:w1", "sleep"],
  ] },  // D-130: the Relic Works on the west beach (D-129), the household of the Kiln Lamp, who make the Society's antiquities and sell them to it (their speech slips say so)
  { key: "hawker", title: "Hawker of Antiquities", occupation: "seller", age: "adult", home: "works", lines: "kHawk", archetype: 3, place: RELIC_PLACE, script: [
    [6.6, "step:works", "idle"], [7.1, "stall:relic", "sell", { carryIn: "basket" }], [13.0, "stall:relic", "sell"], [18.6, "step:works", "idle"], [19.4, "in:works", "sleep"],
  ] },
  { key: "guide", title: "Guide to the Dig", occupation: "registrar", age: "adult", home: "works", lines: "kHawk", archetype: 5, place: RELIC_PLACE, script: [
    [7.0, "step:works", "idle"], [7.5, "watch:relic", "idle"], [9.4, "front:relic", "write", { carry: "book" }], [10.6, "watch:relic", "idle"], [11.4, "yardgate", "idle"], [12.0, "watch:relic", "idle"],
    [13.6, "front:relic", "write", { carry: "book" }], [16.4, "watch:relic", "idle"], [18.4, "step:works", "idle"], [19.5, "in:works", "sleep"],
  ] },
  { key: "potter", title: "Potter", occupation: "smith", age: "adult", home: "works", lines: "kRelic", archetype: 0, place: RELIC_PLACE, script: [
    [6.4, "step:works", "idle"], [6.8, "shelf", "tend"], [9.0, "shelf", "tend", { to: "kiln:b", actTo: "tend", carryOut: "basket" }], [11.4, "shelf", "tend"], [13.2, "shelf", "tend"],
    [15.8, "shelf", "tend", { to: "kiln:b", actTo: "tend", carryOut: "basket" }], [18.3, "step:works", "idle"], [19.1, "in:works", "sleep"],
  ] },
  { key: "kiln", title: "Kiln-Keeper", occupation: "smith", age: "adult", home: "works", lines: "kRelic", archetype: 2, place: RELIC_PLACE, script: [
    [6.0, "step:works", "idle"], [6.4, "kiln", "tend"], [10.0, "kiln", "tend"], [13.1, "kiln", "tend"], [16.6, "kiln", "tend"], [19.0, "step:works", "idle"], [19.6, "in:works", "sleep"],
  ] },
  { key: "ager", title: "Ager of Antiquities", occupation: "gardener", age: "adult", home: "works", lines: "kRelic", archetype: 4, place: RELIC_PLACE, script: [
    [6.6, "step:works", "idle"], [7.0, "bed:e", "tend"], [9.2, "bed:m", "tend"], [11.0, "bed:s", "tend"], [12.4, "lean:works", "lean"], [13.4, "bed:e", "tend"], [16.4, "bed:m", "tend"],
    [18.2, "step:works", "idle"], [19.0, "in:works", "sleep"],
  ] },
  { key: "pellow", title: "Pellow", occupation: "child", age: "child", home: "works", lines: "kRelic", scale: 0.7, walk: 1.5, archetype: 1, place: RELIC_PLACE, script: [
    [8.0, "step:works", "play"], [8.5, "play:shore", "play", { to: "play:lane", actTo: "play" }], [12.5, "step:works", "idle"], [13.5, "play:lane", "play", { to: "play:shore", actTo: "play" }],
    [17.6, "step:works", "play"], [19.2, "in:works", "sleep"],
  ] },
];

/** Talking events at the conversation spots. */
const MEETINGS: readonly Meeting[] = [
  { at: 12.1, dur: 0.9, spot: 3, a: "gardenW", b: "gardenE" },
  { at: 12.6, dur: 0.8, spot: 0, a: "trimmer", b: "clerk" },
  { at: 15.2, dur: 0.9, spot: 1, a: "jars", b: "elder" },
  { at: 17.2, dur: 0.8, spot: 2, a: "water", b: "brass" },
  // D-130: the Relic Works' midday and afternoon talk
  { at: 12.2, dur: 0.8, spot: 5, a: "potter", b: "kiln" },
  { at: 15.4, dur: 0.8, spot: 6, a: "guide", b: "ager" },
];

/** Invented given names (no real language's); a person is named for their household's lamp. */
const FIRSTS = ["Ossery", "Talveth", "Sabrel", "Orrel", "Hestry", "Vennet", "Ilbry", "Quorrin", "Tavick", "Pellis", "Orvane", "Tullen", "Yarrel", "Sennick", "Abrith", "Morvel"];
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth"];
/** Each house's lamp, by the plan's order of the houses; the Relic Works' household keeps the Kiln Lamp (D-130: its kiln's mouth is the lamp that burns at night). */
const lampOf = (home: string): string => (home === "works" ? "Kiln" : ORDINALS[Math.max(0, lampsidePlan().houses.findIndex((h) => h.id === home))] ?? ORDINALS[0]!);

export const LAMPSIDE_FOLK: FolkSpec = {
  id: "lampside",
  salt: 0x1a3b5,
  lookSalt: 0x1a3b5,
  cast: CAST,
  meetings: MEETINGS,
  firsts: FIRSTS,
  lasts: ORDINALS,
  roofs: ["stall:e", "stall:n", "awning:w1", "awning:e2", "awning:works:a", "awning:works:b", "awning:works:c"],
  // (children, the elder, the gardeners (the Relic Works' ager among them) and the trimmer go home when it rains; the rest stand under the stalls' and the doors' awnings)
  indoors: (v) => v.age !== "adult" || v.occupation === "gardener" || v.occupation === "lamplighter",
  name: (c, i, firsts) => `${c.age === "child" ? c.title : firsts[i % firsts.length]!} of the ${lampOf(c.home)} Lamp`,
  script: (c, script) => (c.key === "trimmer" ? trimmerScript(script) : script),
  people: "kessarine",
  nav: (world) => lampsideNav(world),
};

/** Lampside's people for a Kessar world and its seed: deterministic in both, built once and cached. */
export function buildLampsideFolk(world: CollisionWorld, seed: number): Folk {
  return buildFolkFrom(world, seed, LAMPSIDE_FOLK);
}

/** The lamps the Lamp-Trimmer tends (every lamp of the town). */
export const LAMPSIDE_FOLK_LAMPS = LAMP_ORDER.length;
